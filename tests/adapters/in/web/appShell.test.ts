/**
 * T24 — 앱 셸 상태·시간 규칙 테스트 (docs/07-mobile-ux.md §2~§3).
 *
 * DOM 없이 검증 가능한 **순수 규칙**만 본다(저장소는 주입 → 브라우저 API 불필요 · jsdom 미설치 정책 유지):
 * ① 마지막 탭 유지(저장소 읽기/쓰기) ② 탭 키보드 이동(ARIA tabs) ③ 스플래시 표시 시간(400ms~2.5s · reduced-motion).
 */
import { describe, expect, it } from 'vitest';
import {
  APP_TAB_STORAGE_KEY,
  APP_TABS,
  DEFAULT_APP_TAB,
  appTabIndexAfterKey,
  isAppTab,
  readAppTab,
  writeAppTab,
} from '../../../../src/adapters/in/web/features/schedule/data/appTab';
import {
  SPLASH_FADE_MS,
  SPLASH_MAX_MS,
  SPLASH_MIN_MS,
  decideSplash,
  splashFadeMs,
} from '../../../../src/adapters/in/web/features/schedule/data/splash';

/** 메모리 저장소 — localStorage 를 주입 가능하게 만든 계약(KeyValueStorage)을 그대로 흉내 낸다. */
function memoryStorage(initial: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('마지막 탭 유지 — 지금/전체', () => {
  it('탭 정본 순서는 [지금] → [전체] 이고 기본값은 지금이다', () => {
    expect(APP_TABS).toEqual(['now', 'all']);
    expect(DEFAULT_APP_TAB).toBe('now');
    expect(isAppTab('all')).toBe(true);
    expect(isAppTab('nope')).toBe(false);
    expect(isAppTab(null)).toBe(false);
  });

  it('값이 없으면 기본 탭(지금)으로 시작한다', () => {
    expect(readAppTab(memoryStorage())).toBe('now');
  });

  it('저장된 탭을 그대로 되읽는다(재실행 후 마지막 탭)', () => {
    const storage = memoryStorage({ [APP_TAB_STORAGE_KEY]: 'all' });
    expect(readAppTab(storage)).toBe('all');
  });

  it('알 수 없는 값·저장소 없음·접근 예외는 모두 기본 탭으로 떨어진다(앱은 계속 동작)', () => {
    expect(readAppTab(memoryStorage({ [APP_TAB_STORAGE_KEY]: 'weird' }))).toBe('now');
    expect(readAppTab(null)).toBe('now');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readAppTab(throwing)).toBe('now');
    expect(() => writeAppTab(throwing, 'all')).not.toThrow();
  });

  it('탭 전환을 저장하면 다음 실행이 그 탭으로 시작한다', () => {
    const storage = memoryStorage();
    writeAppTab(storage, 'all');
    expect(storage.data[APP_TAB_STORAGE_KEY]).toBe('all');
    expect(readAppTab(storage)).toBe('all');
  });
});

describe('탭 키보드 이동 — WAI-ARIA tabs 패턴', () => {
  it('←/→ 는 순환하고 Home/End 는 양 끝으로 간다', () => {
    expect(appTabIndexAfterKey(0, 'ArrowRight')).toBe(1);
    expect(appTabIndexAfterKey(1, 'ArrowRight')).toBe(0);
    expect(appTabIndexAfterKey(0, 'ArrowLeft')).toBe(1);
    expect(appTabIndexAfterKey(1, 'ArrowLeft')).toBe(0);
    expect(appTabIndexAfterKey(1, 'Home')).toBe(0);
    expect(appTabIndexAfterKey(0, 'End')).toBe(1);
  });

  it('처리하지 않는 키는 null(호출부가 기본 동작을 유지한다)', () => {
    expect(appTabIndexAfterKey(0, 'Enter')).toBeNull();
    expect(appTabIndexAfterKey(0, 'Tab')).toBeNull();
    expect(appTabIndexAfterKey(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('스플래시 표시 시간 — 최소 400ms · 최대 2.5s', () => {
  it('상수 계약(400 / 2500 / 200ms 페이드)', () => {
    expect(SPLASH_MIN_MS).toBe(400);
    expect(SPLASH_MAX_MS).toBe(2500);
    expect(SPLASH_FADE_MS).toBe(200);
  });

  it('데이터가 빨리 준비돼도 하한(400ms)까지 기다린다', () => {
    expect(decideSplash({ elapsedMs: 100, dataSettled: true })).toEqual({
      hide: true,
      reason: 'data',
      delayMs: 300,
    });
  });

  it('하한을 넘겼으면 즉시 숨긴다', () => {
    expect(decideSplash({ elapsedMs: 400, dataSettled: true })).toEqual({
      hide: true,
      reason: 'data',
      delayMs: 0,
    });
    expect(decideSplash({ elapsedMs: 1900, dataSettled: true }).delayMs).toBe(0);
  });

  it('아직 로딩이면 스스로 숨기지 않는다(상한은 페이지 타이머가 처리 → 스켈레톤으로 진행)', () => {
    expect(decideSplash({ elapsedMs: 200, dataSettled: false })).toEqual({
      hide: false,
      reason: null,
      delayMs: 0,
    });
    expect(decideSplash({ elapsedMs: 2400, dataSettled: false }).hide).toBe(false);
  });

  it('reduced-motion 이면 페이드 0ms(즉시 전환)', () => {
    expect(splashFadeMs(true)).toBe(0);
    expect(splashFadeMs(false)).toBe(SPLASH_FADE_MS);
  });
});
