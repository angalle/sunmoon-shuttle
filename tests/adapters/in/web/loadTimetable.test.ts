/**
 * 캐시 계층 포함 로더 테스트 (tests/adapters/in/web) — T6 수용기준 4 "실패 주입"의 단위판.
 *
 * 검증하는 계약(`features/schedule/api/timetableApi.ts` · docs/01 §5)
 * - 네트워크 성공 → 계약 파싱 + 캐시 저장(저장 시각은 주입된 시계에서)
 * - 네트워크 실패 + 캐시 있음 → **마지막 정상 데이터**를 돌려준다(예외 금지 · 24h 넘으면 `cache-expired`)
 * - 네트워크 실패 + 캐시 없음(또는 캐시가 깨짐/스키마 불일치) → `TimetableDataError`(화면은 F8 오류 배너)
 * 실 DB·실 네트워크 금지: fetch 는 stub, 캐시는 인메모리 페이크.
 */
import { describe, expect, it } from 'vitest';
import { loadTimetableModel, SUPPORTED_SCHEMA_VERSION, type FetchLike } from '../../../../src/adapters/in/web/features/schedule/api/timetableApi';
import { parseTimetable, TimetableDataError } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import { TIMETABLE_CACHE_TTL_MS } from '../../../../src/application/cache/timetableCachePolicy';
import type {
  CachedTimetableEntry,
  CachedTimetableInput,
  TimetableCachePort,
} from '../../../../src/ports/timetable_cache';
import { FIXTURE_RAW } from './fixtures';

const NOW_MS = Date.parse('2026-10-06T07:40:00+09:00');
const HOUR_MS = 60 * 60 * 1000;

/** 인메모리 캐시 페이크(포트 계약만 구현: 어떤 경우에도 던지지 않는다) */
class MemoryCache implements TimetableCachePort {
  public entry: CachedTimetableEntry | null = null;
  public readonly writes: CachedTimetableInput[] = [];

  public async read(): Promise<CachedTimetableEntry | null> {
    return this.entry;
  }

  public async write(input: CachedTimetableInput, cachedAtMs: number): Promise<boolean> {
    this.writes.push(input);
    this.entry = { ...input, cachedAtMs };
    return true;
  }

  public async clear(): Promise<void> {
    this.entry = null;
  }
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const okFetch: FetchLike = async () => jsonResponse(FIXTURE_RAW);
const offlineFetch: FetchLike = async () => {
  throw new Error('Failed to fetch');
};
const serverErrorFetch: FetchLike = async () => new Response('nope', { status: 500, statusText: 'Server Error' });
const brokenJsonFetch: FetchLike = async () => new Response('{oops', { status: 200 });
const contractBrokenFetch: FetchLike = async () =>
  jsonResponse({ ...(FIXTURE_RAW as Record<string, unknown>), routes: 'nope' });

function cachedEntry(ageMs: number, overrides: Partial<CachedTimetableEntry> = {}): CachedTimetableEntry {
  return {
    raw: FIXTURE_RAW,
    contentHash: 'sha256:fixture',
    fetchedAt: '2026-10-05T14:39:32+09:00',
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    cachedAtMs: NOW_MS - ageMs,
    ...overrides,
  };
}

/** 캐시 저장(fire-and-forget)이 끝날 여유를 준다 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('loadTimetableModel — 네트워크 성공', () => {
  it('계약을 파싱하고 캐시에 저장한다(저장 시각 = 주입된 시계)', async () => {
    const cache = new MemoryCache();
    const loaded = await loadTimetableModel({ fetchImpl: okFetch, cache, nowMs: () => NOW_MS });
    await flush();

    expect(loaded.source).toBe('network');
    expect(loaded.networkError).toBeNull();
    expect(loaded.cacheAgeMs).toBeNull();
    expect(loaded.model.routes).toHaveLength(4);
    expect(cache.writes).toHaveLength(1);
    expect(cache.entry?.contentHash).toBe(loaded.model.source.contentHash);
    expect(cache.entry?.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(cache.entry?.cachedAtMs).toBe(NOW_MS);
  });

  it('캐시가 없어도(주입 없음) 네트워크만으로 동작한다', async () => {
    const loaded = await loadTimetableModel({ fetchImpl: okFetch });
    expect(loaded.source).toBe('network');
    expect(loaded.cacheAgeMs).toBeNull();
  });
});

describe('loadTimetableModel — 실패 주입: 마지막 정상 데이터 폴백 (AC-5)', () => {
  it('네트워크 실패 + 캐시(2시간) → 캐시 데이터를 돌려주고 예외를 던지지 않는다', async () => {
    const cache = new MemoryCache();
    cache.entry = cachedEntry(2 * HOUR_MS);

    const loaded = await loadTimetableModel({ fetchImpl: offlineFetch, cache, nowMs: () => NOW_MS });

    expect(loaded.source).toBe('cache');
    expect(loaded.cacheAgeMs).toBe(2 * HOUR_MS);
    expect(loaded.networkError).toContain('네트워크 요청 실패');
    // 캐시 원문이 계약대로 파싱되어 화면이 그대로 그릴 수 있다
    expect(loaded.model.routes.map((route) => route.id)).toEqual(
      parseTimetable(FIXTURE_RAW).routes.map((route) => route.id),
    );
  });

  it('캐시가 24시간을 넘으면 cache-expired 로 표시한다(데이터는 유지)', async () => {
    const cache = new MemoryCache();
    cache.entry = cachedEntry(TIMETABLE_CACHE_TTL_MS + 1);

    const loaded = await loadTimetableModel({ fetchImpl: offlineFetch, cache, nowMs: () => NOW_MS });

    expect(loaded.source).toBe('cache-expired');
    expect(loaded.cacheAgeMs).toBe(TIMETABLE_CACHE_TTL_MS + 1);
    expect(loaded.model.routes.length).toBeGreaterThan(0);
  });

  it('HTTP 500 이어도 캐시가 있으면 캐시로 폴백한다', async () => {
    const cache = new MemoryCache();
    cache.entry = cachedEntry(HOUR_MS);

    const loaded = await loadTimetableModel({ fetchImpl: serverErrorFetch, cache, nowMs: () => NOW_MS });
    expect(loaded.source).toBe('cache');
    expect(loaded.networkError).toContain('HTTP 500');
  });

  it('응답이 계약 위반이어도(JSON 아님·구조 깨짐) 캐시가 있으면 폴백한다', async () => {
    const cache = new MemoryCache();
    cache.entry = cachedEntry(HOUR_MS);

    const fromBrokenJson = await loadTimetableModel({ fetchImpl: brokenJsonFetch, cache, nowMs: () => NOW_MS });
    expect(fromBrokenJson.source).toBe('cache');
    expect(fromBrokenJson.networkError).toContain('JSON 파싱 실패');

    const fromBrokenContract = await loadTimetableModel({ fetchImpl: contractBrokenFetch, cache, nowMs: () => NOW_MS });
    expect(fromBrokenContract.source).toBe('cache');
    expect(fromBrokenContract.networkError).toContain('$.routes');
  });
});

describe('loadTimetableModel — 폴백할 캐시가 없으면 정직하게 실패한다 (F8)', () => {
  it('캐시 없음 + 네트워크 실패 → TimetableDataError', async () => {
    const cache = new MemoryCache();
    await expect(loadTimetableModel({ fetchImpl: offlineFetch, cache, nowMs: () => NOW_MS })).rejects.toBeInstanceOf(
      TimetableDataError,
    );
  });

  it('스키마 버전이 다르거나 깨진 캐시는 버리고 실패한다', async () => {
    const wrongSchema = new MemoryCache();
    wrongSchema.entry = cachedEntry(HOUR_MS, { schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 });
    await expect(
      loadTimetableModel({ fetchImpl: offlineFetch, cache: wrongSchema, nowMs: () => NOW_MS }),
    ).rejects.toBeInstanceOf(TimetableDataError);

    const brokenRaw = new MemoryCache();
    brokenRaw.entry = cachedEntry(HOUR_MS, { raw: { schemaVersion: 1 } });
    await expect(
      loadTimetableModel({ fetchImpl: offlineFetch, cache: brokenRaw, nowMs: () => NOW_MS }),
    ).rejects.toBeInstanceOf(TimetableDataError);
  });

  it('오류 메시지에 데이터 경로가 담긴다(화면이 원인을 보여줄 수 있게)', async () => {
    const cache = new MemoryCache();
    await expect(
      loadTimetableModel({ fetchImpl: offlineFetch, cache, path: './data/timetable.json', nowMs: () => NOW_MS }),
    ).rejects.toThrow(/\.\/data\/timetable\.json/);
  });
});
