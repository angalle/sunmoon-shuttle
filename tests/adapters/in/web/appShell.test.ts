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
import {
  AUTO_SCROLL_COOLDOWN_MS,
  INSTANT_SCROLL_WINDOW_MS,
  MOVE_ANIMATION_MS,
  MOVE_SETTLE_MS,
  moveScrollStyle,
} from '../../../../src/adapters/in/web/features/schedule/pages/SchedulePage';
import { UI_TEXT } from '../../../../src/adapters/in/web/features/schedule/types/texts';
import {
  SPLASH_FADE_MS,
  SPLASH_MAX_MS,
  SPLASH_MIN_MS,
  decideSplash,
  splashFadeMs,
} from '../../../../src/adapters/in/web/features/schedule/data/splash';

describe('스플래시 표시 시간 — 최소 1.2s · 최대 2.5s', () => {
  it('상수 계약(1200 / 2500 / 200ms 페이드 — 약 1.4초에 사라짐)', () => {
    expect(SPLASH_MIN_MS).toBe(1200);
    expect(SPLASH_MAX_MS).toBe(2500);
    expect(SPLASH_FADE_MS).toBe(200);
  });

  it('데이터가 빨리 준비돼도 하한(1200ms)까지 기다린다', () => {
    expect(decideSplash({ elapsedMs: 100, dataSettled: true })).toEqual({
      hide: true,
      reason: 'data',
      delayMs: 1100,
    });
  });

  it('하한을 넘겼으면 즉시 숨긴다', () => {
    expect(decideSplash({ elapsedMs: 1200, dataSettled: true })).toEqual({
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

describe('이동 버튼 계약 (T28 · docs/07 §10-1)', () => {
  it('두 버튼의 접근성 이름이 문서 그대로다(화면 문구는 아이콘+라벨 없음)', () => {
    expect(UI_TEXT.moveNowLabel).toBe('현재 시간으로');
    expect(UI_TEXT.moveTopLabel).toBe('맨 위로');
  });

  it('이동 방식 — reduced-motion 이면 즉시(애니메이션 0), 아니면 짧은 애니메이션', () => {
    expect(moveScrollStyle(true)).toBe('instant');
    expect(moveScrollStyle(false)).toBe('animate');
  });

  it('이동 애니메이션은 문서 계약(150~200ms) 안이고, 보정 타이머가 그 뒤에 온다', () => {
    expect(MOVE_ANIMATION_MS).toBeGreaterThanOrEqual(150);
    expect(MOVE_ANIMATION_MS).toBeLessThanOrEqual(200);
    expect(MOVE_SETTLE_MS).toBeGreaterThan(0);
    // 프로그램 스크롤 계측 창은 애니메이션보다 길어야 한다(사용자 스크롤 오인 방지).
    expect(INSTANT_SCROLL_WINDOW_MS).toBeGreaterThan(0);
    expect(MOVE_ANIMATION_MS + MOVE_SETTLE_MS).toBeLessThan(AUTO_SCROLL_COOLDOWN_MS);
  });
});
