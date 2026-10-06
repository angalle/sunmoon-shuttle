/**
 * 스플래시 표시 시간 결정 (features/schedule/data) — **순수 함수만**.
 *
 * 계약(`docs/07-mobile-ux.md` §3):
 * - 진입 시 **항상** 표시하고, 데이터가 준비되면 사라진다.
 * - **최소 400ms**(깜빡임 방지) · **최대 2.5s**(초과 시 스켈레톤·캐시 폴백으로 진행 — 스플래시에 갇히지 않는다).
 * - 전환은 200ms 페이드아웃, `prefers-reduced-motion: reduce` 면 즉시(0ms).
 *
 * 시간 계산(경과 → 언제 숨길지)을 여기서 순수하게 정하고, 타이머·DOM 은 페이지가 다룬다.
 * ⚠️ 주입된 clock(`?now=`)은 스모크에서 **고정**되어 흐르지 않으므로, 스플래시 시간은
 *    반드시 단조 시각(`performance.now()`)으로 잰다 — 그래서 상태(`ScheduleState`)와 분리돼 있다.
 */

/** 최소 표시 시간(ms) — 깜빡임 방지 하한 */
export const SPLASH_MIN_MS = 400;
/** 최대 표시 시간(ms) — 넘기면 스켈레톤/캐시 폴백으로 진행한다 */
export const SPLASH_MAX_MS = 2500;
/** 페이드아웃 시간(ms) */
export const SPLASH_FADE_MS = 200;

/** 왜 사라졌는가 — `data`(데이터 준비) | `timeout`(2.5s 상한). 증거용으로 남긴다. */
export type SplashHideReason = 'data' | 'timeout';

export interface SplashDecision {
  /** 지금 숨길지 */
  readonly hide: boolean;
  readonly reason: SplashHideReason | null;
  /** `hide` 가 true 일 때 숨기기까지 기다릴 시간(ms). 하한(400ms) 보정에 쓴다. */
  readonly delayMs: number;
}

export interface SplashInput {
  /** 스플래시를 띄운 뒤 흐른 시간(ms, 단조 시각 기준) */
  readonly elapsedMs: number;
  /** 데이터가 준비됐는가(`status !== 'loading'`) — 준비되면 하한(400ms)까지만 기다린다 */
  readonly dataSettled: boolean;
}

/**
 * 경과 시간 + 데이터 준비 여부 → 숨김 결정.
 * - 데이터 준비됨: `elapsed ≥ MIN` 이면 즉시, 아니면 `MIN - elapsed` 후에 숨긴다.
 * - 아직 로딩: 숨기지 않는다(상한은 페이지가 `SPLASH_MAX_MS` 타이머로 처리 — 스켈레톤으로 진행).
 */
export function decideSplash(input: SplashInput): SplashDecision {
  if (!input.dataSettled) return { hide: false, reason: null, delayMs: 0 };
  const remaining = SPLASH_MIN_MS - input.elapsedMs;
  if (remaining <= 0) return { hide: true, reason: 'data', delayMs: 0 };
  return { hide: true, reason: 'data', delayMs: remaining };
}

/** 페이드아웃 시간 — `prefers-reduced-motion: reduce` 면 0(즉시 전환). */
export function splashFadeMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : SPLASH_FADE_MS;
}
