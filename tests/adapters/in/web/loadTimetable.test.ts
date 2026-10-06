/**
 * 캐시 계층 포함 로더 테스트 (tests/adapters/in/web) — T6 수용기준 4 "실패 주입"의 단위판.
 *
 * 검증하는 계약(`features/schedule/api/timetableApi.ts` · docs/01 §5)
 * - 네트워크 성공 → 계약 파싱 + 캐시 저장(저장 시각은 주입된 시계에서)
 * - 네트워크 실패 + 캐시 있음 → **마지막 정상 데이터**를 돌려준다(예외 금지 · 24h 넘으면 `cache-expired`)
 * - 네트워크 실패 + 캐시 없음(또는 캐시가 깨짐/스키마 불일치) → `TimetableDataError`(화면은 F8 오류 배너)
 * 실 DB·실 네트워크 금지: fetch 는 stub, 캐시는 인메모리 페이크.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  loadTimetableModel,
  SUPPORTED_SCHEMA_VERSIONS,
  type FetchLike,
} from '../../../../src/adapters/in/web/features/schedule/api/timetableApi';
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
/** `FIXTURE_RAW`(v1)의 계약 버전 — 캐시 레코드의 버전은 **데이터의 실제 버전**을 그대로 쓴다. */
const FIXTURE_SCHEMA_VERSION = 1;
/** 게이트가 버려야 하는 버전 = 지원 목록 **밖**(미래 계약 — 마이그레이션 없음). */
const UNSUPPORTED_SCHEMA_VERSION = Math.max(...SUPPORTED_SCHEMA_VERSIONS) + 1;

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
    schemaVersion: FIXTURE_SCHEMA_VERSION,
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
    expect(cache.entry?.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
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

/**
 * T18 회귀 — T16 이 `data/timetable.json` 을 **schemaVersion 2** 로 발행한 뒤, 캐시 게이트가 v1 만 통과시켜
 * 캐시 폴백이 통째로 죽었다(`npm run verify:offline` FAIL 5건 · AC-5). 게이트는 "한 버전"이 아니라
 * **파서가 읽는 버전 목록**으로 판정한다(목록 밖 = 버림 — 마이그레이션 없음).
 */
describe('loadTimetableModel — schema v2 캐시도 폴백한다 (T18 회귀)', () => {
  const V2_RAW = { ...(FIXTURE_RAW as Record<string, unknown>), schemaVersion: 2 };

  it('지원 목록에 현재 계약 버전(2)이 들어 있다 — 발행물과 게이트의 동기화', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain(2);
  });

  it('v2 원문 캐시(schemaVersion 2)를 파싱해 캐시로 폴백한다', async () => {
    const cache = new MemoryCache();
    cache.entry = cachedEntry(HOUR_MS, { raw: V2_RAW, schemaVersion: 2 });

    const loaded = await loadTimetableModel({ fetchImpl: offlineFetch, cache, nowMs: () => NOW_MS });

    expect(loaded.source).toBe('cache');
    expect(loaded.model.schemaVersion).toBe(2);
    expect(loaded.model.routes.map((route) => route.id)).toEqual(parseTimetable(V2_RAW).routes.map((route) => route.id));
  });

  it('네트워크로 받은 v2 데이터를 저장한 캐시로 오프라인 폴백이 된다(발행→저장→폴백 왕복)', async () => {
    const cache = new MemoryCache();
    const v2Fetch: FetchLike = async () => jsonResponse(V2_RAW);

    const online = await loadTimetableModel({ fetchImpl: v2Fetch, cache, nowMs: () => NOW_MS });
    await flush();
    expect(online.source).toBe('network');
    expect(cache.entry?.schemaVersion).toBe(2);

    const offline = await loadTimetableModel({ fetchImpl: offlineFetch, cache, nowMs: () => NOW_MS });
    expect(offline.source).toBe('cache');
    expect(offline.model.schemaVersion).toBe(2);
  });

  it('실제 발행물(data/timetable.json v3)도 캐시로 폴백한다', async () => {
    const published = JSON.parse(
      readFileSync(new URL('../../../../data/timetable.json', import.meta.url), 'utf8'),
    ) as { schemaVersion: number; routes: unknown[] };
    expect(published.schemaVersion).toBe(3);

    const cache = new MemoryCache();
    cache.entry = cachedEntry(HOUR_MS, { raw: published, schemaVersion: published.schemaVersion });

    const loaded = await loadTimetableModel({ fetchImpl: offlineFetch, cache, nowMs: () => NOW_MS });

    expect(loaded.source).toBe('cache');
    expect(loaded.model.routes.length).toBe(published.routes.length);
  });
});

describe('loadTimetableModel — 폴백할 캐시가 없으면 정직하게 실패한다 (F8)', () => {
  it('캐시 없음 + 네트워크 실패 → TimetableDataError', async () => {
    const cache = new MemoryCache();
    await expect(loadTimetableModel({ fetchImpl: offlineFetch, cache, nowMs: () => NOW_MS })).rejects.toBeInstanceOf(
      TimetableDataError,
    );
  });

  it('스키마 버전이 앱의 지원 목록 밖이거나 깨진 캐시는 버리고 실패한다', async () => {
    const wrongSchema = new MemoryCache();
    wrongSchema.entry = cachedEntry(HOUR_MS, { schemaVersion: UNSUPPORTED_SCHEMA_VERSION });
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
