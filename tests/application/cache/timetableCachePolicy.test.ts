/**
 * 캐시 만료 정책 테스트 (tests/application) — **순수 함수**, 프레임워크·DB 없이.
 *
 * 카드 지시 ①·수용기준 1: "만료/폴백 경계 테스트". 경계값(정확히 24h)을 명시적으로 고정한다.
 */
import { describe, expect, it } from 'vitest';
import {
  formatCacheAge,
  timetableCacheAge,
  TIMETABLE_CACHE_TTL_MS,
} from '../../../src/application/cache/timetableCachePolicy';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CACHED_AT = Date.parse('2026-10-05T14:40:00+09:00');

describe('timetableCacheAge — 24h 만료 경계', () => {
  it('기본 TTL 은 24시간이다', () => {
    expect(TIMETABLE_CACHE_TTL_MS).toBe(DAY_MS);
  });

  it('막 저장한 캐시는 fresh(나이 0)', () => {
    expect(timetableCacheAge(CACHED_AT, CACHED_AT)).toEqual({ ageMs: 0, expired: false });
  });

  it('23시간 59분 59초는 fresh', () => {
    const age = timetableCacheAge(CACHED_AT, CACHED_AT + DAY_MS - 1000);
    expect(age.ageMs).toBe(DAY_MS - 1000);
    expect(age.expired).toBe(false);
  });

  it('정확히 24시간은 만료(경계는 >=)', () => {
    const age = timetableCacheAge(CACHED_AT, CACHED_AT + DAY_MS);
    expect(age.ageMs).toBe(DAY_MS);
    expect(age.expired).toBe(true);
  });

  it('24시간을 1ms 넘기면 만료', () => {
    expect(timetableCacheAge(CACHED_AT, CACHED_AT + DAY_MS + 1).expired).toBe(true);
  });

  it('시계 역행(now < cachedAt)은 나이 0 · fresh 로 본다(음수 금지)', () => {
    expect(timetableCacheAge(CACHED_AT, CACHED_AT - 5 * HOUR_MS)).toEqual({ ageMs: 0, expired: false });
  });

  it('TTL 을 주입하면 그 기준으로 판정한다', () => {
    expect(timetableCacheAge(CACHED_AT, CACHED_AT + 2 * HOUR_MS, HOUR_MS).expired).toBe(true);
    expect(timetableCacheAge(CACHED_AT, CACHED_AT + 2 * HOUR_MS, 3 * HOUR_MS).expired).toBe(false);
  });
});

describe('formatCacheAge — 화면 문구', () => {
  it('1분 미만은 "방금"', () => {
    expect(formatCacheAge(0)).toBe('방금');
    expect(formatCacheAge(59_000)).toBe('방금');
  });

  it('분·시간·일 단위로 읽기 쉽게', () => {
    expect(formatCacheAge(3 * 60_000)).toBe('3분 전');
    expect(formatCacheAge(2 * HOUR_MS)).toBe('2시간 전');
    expect(formatCacheAge(2 * HOUR_MS + 5 * 60_000)).toBe('2시간 5분 전');
    expect(formatCacheAge(DAY_MS)).toBe('1일 전');
    expect(formatCacheAge(DAY_MS + 3 * HOUR_MS)).toBe('1일 3시간 전');
  });

  it('음수는 0 으로(=방금) 처리한다', () => {
    expect(formatCacheAge(-1000)).toBe('방금');
  });
});
