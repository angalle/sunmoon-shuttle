/**
 * Android 앱 데이터 경로(B안 · docs/07 §17) — 화면은 앱 안, 데이터는 GitHub Pages 에서.
 *
 * 순서: 원격(Pages) → 마지막 캐시 → 앱 안 번들 사본 → 오류.
 * 웹은 기존 그대로(같은 출처 상대 경로 · 번들 폴백 없음).
 */
import { describe, expect, it } from 'vitest';

import { isNativeApp } from '../../../../src/adapters/in/web/app/platform';
import {
  loadTimetableModel,
  REMOTE_TIMETABLE_URL,
  TIMETABLE_PATH,
  type FetchLike,
} from '../../../../src/adapters/in/web/features/schedule/api/timetableApi';
import { TimetableDataError } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import type { CachedTimetableEntry, CachedTimetableInput, TimetableCachePort } from '../../../../src/ports/timetable_cache';
import { FIXTURE_RAW } from './fixtures';

const FIXTURE_FETCHED_AT_MS = Date.parse('2026-10-05T14:39:32+09:00');
const HOUR_MS = 3_600_000;

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** 경로별 응답 — 원격 주소는 실패, 번들 사본은 성공처럼 갈라 쓴다. 요청 순서를 기록한다. */
function routedFetch(routes: Record<string, 'ok' | 'offline' | 'missing'>): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    calls.push(input);
    const mode = routes[input] ?? 'missing';
    if (mode === 'offline') throw new Error('Failed to fetch');
    if (mode === 'missing') return new Response('nope', { status: 404, statusText: 'Not Found' });
    return json(FIXTURE_RAW);
  };
  return { fetchImpl, calls };
}

class MemoryCache implements TimetableCachePort {
  public constructor(public entry: CachedTimetableEntry | null = null) {}
  public async read(): Promise<CachedTimetableEntry | null> {
    return this.entry;
  }
  public async write(input: CachedTimetableInput, cachedAtMs: number): Promise<boolean> {
    this.entry = { ...input, cachedAtMs };
    return true;
  }
  public async clear(): Promise<void> {
    this.entry = null;
  }
}

const nativeOptions = { path: REMOTE_TIMETABLE_URL, fallbackPath: TIMETABLE_PATH } as const;

describe('Android 앱 — 원격 → 캐시 → 번들 사본', () => {
  it('원격 주소는 GitHub Pages 발행본이다', () => {
    expect(REMOTE_TIMETABLE_URL).toBe('https://angalle.github.io/sunmoon-shuttle/data/timetable.json');
  });

  it('원격이 되면 원격을 쓰고(번들은 읽지 않는다) 캐시에 저장한다', async () => {
    const { fetchImpl, calls } = routedFetch({ [REMOTE_TIMETABLE_URL]: 'ok', [TIMETABLE_PATH]: 'ok' });
    const cache = new MemoryCache();
    const loaded = await loadTimetableModel({ ...nativeOptions, fetchImpl, cache, nowMs: () => FIXTURE_FETCHED_AT_MS });
    expect(loaded.source).toBe('network');
    expect(calls).toEqual([REMOTE_TIMETABLE_URL]);
    await Promise.resolve();
    expect(cache.entry).not.toBeNull();
  });

  it('원격 실패 + 캐시 있음 → 캐시(번들보다 캐시가 먼저)', async () => {
    const { fetchImpl, calls } = routedFetch({ [REMOTE_TIMETABLE_URL]: 'offline', [TIMETABLE_PATH]: 'ok' });
    const now = FIXTURE_FETCHED_AT_MS + 2 * HOUR_MS;
    const cache = new MemoryCache({
      raw: FIXTURE_RAW,
      contentHash: 'sha256:fixture',
      fetchedAt: '2026-10-05T14:39:32+09:00',
      schemaVersion: 1,
      cachedAtMs: now - HOUR_MS,
    });
    const loaded = await loadTimetableModel({ ...nativeOptions, fetchImpl, cache, nowMs: () => now });
    expect(loaded.source).toBe('cache');
    expect(loaded.cacheAgeMs).toBe(HOUR_MS);
    expect(calls).toEqual([REMOTE_TIMETABLE_URL]);
  });

  it('원격 실패 + 캐시 없음(첫 실행 오프라인) → 앱 안 번들 사본 · 나이는 발행 시각 기준', async () => {
    const { fetchImpl, calls } = routedFetch({ [REMOTE_TIMETABLE_URL]: 'offline', [TIMETABLE_PATH]: 'ok' });
    const fresh = await loadTimetableModel({ ...nativeOptions, fetchImpl, cache: null, nowMs: () => FIXTURE_FETCHED_AT_MS + 3 * HOUR_MS });
    expect(fresh.source).toBe('cache');
    expect(fresh.cacheAgeMs).toBe(3 * HOUR_MS);
    expect(fresh.networkError).toMatch(/네트워크 요청 실패/);
    expect(calls).toEqual([REMOTE_TIMETABLE_URL, TIMETABLE_PATH]);

    const old = await loadTimetableModel({ ...nativeOptions, fetchImpl, cache: null, nowMs: () => FIXTURE_FETCHED_AT_MS + 72 * HOUR_MS });
    expect(old.source).toBe('cache-expired');
  });

  it('원격·캐시·번들이 모두 없으면 원래 오류를 던진다(빈 화면 대신 오류 배너)', async () => {
    const { fetchImpl } = routedFetch({ [REMOTE_TIMETABLE_URL]: 'offline', [TIMETABLE_PATH]: 'missing' });
    await expect(loadTimetableModel({ ...nativeOptions, fetchImpl, cache: null })).rejects.toBeInstanceOf(TimetableDataError);
  });

  it('웹(번들 폴백 미지정)은 기존 그대로 — 상대 경로만 읽고 실패하면 던진다', async () => {
    const { fetchImpl, calls } = routedFetch({ [TIMETABLE_PATH]: 'offline' });
    await expect(loadTimetableModel({ fetchImpl, cache: null })).rejects.toBeInstanceOf(TimetableDataError);
    expect(calls).toEqual([TIMETABLE_PATH]);
  });
});

describe('isNativeApp — Capacitor 브리지 전역으로 판별', () => {
  it('네이티브 · 웹 · 브리지 없음 · 브리지가 던짐', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNativeApp({})).toBe(false);
    expect(
      isNativeApp({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('x');
          },
        },
      }),
    ).toBe(false);
  });
});

describe('최신을 못 받았을 때의 조용한 재시도 간격', async () => {
  const { retryDelayMs, RETRY_AFTER_FALLBACK_MS, RETRY_MAX_MS } = await import('../../../../src/adapters/in/web/app/mount');
  it('20s → 40s → 80s … 5분에서 멈춘다', () => {
    expect(RETRY_AFTER_FALLBACK_MS).toBe(20_000);
    expect([0, 1, 2, 3].map(retryDelayMs)).toEqual([20_000, 40_000, 80_000, 160_000]);
    expect(retryDelayMs(4)).toBe(RETRY_MAX_MS);
    expect(retryDelayMs(10)).toBe(RETRY_MAX_MS);
  });
});
