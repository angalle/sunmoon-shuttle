/**
 * T24·T27 — 앱 셸 상태·시간 규칙 테스트 (docs/07-mobile-ux.md §3 · §9).
 *
 * DOM 없이 검증 가능한 **순수 규칙**만 본다(저장소는 주입 → 브라우저 API 불필요 · jsdom 미설치 정책 유지):
 * ① 스플래시 표시 시간(400ms~2.5s · reduced-motion) ② T27 자동 스크롤 쉬는 시간(3초).
 *
 * T27 은 화면 분리(하단 탭)를 없애고 본문을 시간표 하나로 만들었다(§9-2) — 탭 관련 계약은 사라졌고,
 * 그 자리를 **다음 출발 자동 스크롤** 계약이 대신한다(§9-3).
 */
import { describe, expect, it } from 'vitest';
import { AUTO_SCROLL_COOLDOWN_MS } from '../../../../src/adapters/in/web/features/schedule/pages/SchedulePage';
import {
  SPLASH_FADE_MS,
  SPLASH_MAX_MS,
  SPLASH_MIN_MS,
  decideSplash,
  splashFadeMs,
} from '../../../../src/adapters/in/web/features/schedule/data/splash';

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

describe('자동 스크롤 계약 (T27 · docs/07 §9-3)', () => {
  it('사용자가 스크롤한 뒤 3초 동안은 다시 스크롤하지 않는다', () => {
    expect(AUTO_SCROLL_COOLDOWN_MS).toBe(3000);
  });
});
