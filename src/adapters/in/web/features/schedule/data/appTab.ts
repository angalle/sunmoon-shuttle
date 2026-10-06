/**
 * 하단 탭(앱 셸) 선택 상태 (features/schedule/data) — 순수 함수 + 주입된 저장소.
 *
 * 계약(`docs/07-mobile-ux.md` §2): `지금`/`전체` 2개 탭 · **마지막 탭 유지**(재실행 후에도).
 * - 저장소는 **주입받는다**(`KeyValueStorage`) — 이 모듈은 브라우저 API 를 직접 만지지 않는다(테스트 가능).
 * - 저장소가 막힌 환경(사파리 프라이빗 등)에서는 **기본 탭(지금)으로 시작**하고 예외를 던지지 않는다.
 * - 탭은 화면(UI) 상태이므로 store(도메인 상태 기계)에는 넣지 않는다 — 페이지 지역 상태 + 이 모듈로 저장만 한다.
 */
import type { KeyValueStorage } from '../api/installHintApi';

/** 탭 정본 순서([지금] → [전체]) — 탭바 렌더 순서이자 키보드 이동 순서다. */
export const APP_TABS = ['now', 'all'] as const;

export type AppTab = (typeof APP_TABS)[number];

export const APP_TAB_STORAGE_KEY = 'sunmoon-shuttle:app-tab:v1';

/** 저장된 값이 없거나 읽을 수 없을 때의 탭 — 첫 화면은 [지금](docs/07 §4-1). */
export const DEFAULT_APP_TAB: AppTab = 'now';

/** 외부 값(저장소·URL)이 유효한 탭인지 좁히는 타입 가드. */
export function isAppTab(value: unknown): value is AppTab {
  return typeof value === 'string' && (APP_TABS as readonly string[]).includes(value);
}

/** 마지막으로 본 탭. 저장소가 없거나 값이 이상하면 `지금`. */
export function readAppTab(storage: KeyValueStorage | null): AppTab {
  if (storage === null) return DEFAULT_APP_TAB;
  try {
    const raw = storage.getItem(APP_TAB_STORAGE_KEY);
    return isAppTab(raw) ? raw : DEFAULT_APP_TAB;
  } catch {
    return DEFAULT_APP_TAB;
  }
}

/** 마지막 탭 기록. 저장 실패는 삼킨다(탭 전환 자체는 성공해야 한다). */
export function writeAppTab(storage: KeyValueStorage | null, tab: AppTab): void {
  if (storage === null) return;
  try {
    storage.setItem(APP_TAB_STORAGE_KEY, tab);
  } catch {
    /* 저장 불가 환경 — 이번 세션에서는 전환된 탭으로 계속 동작한다. */
  }
}

/**
 * WAI-ARIA tabs 패턴의 키보드 이동(T24) — ←/→/Home/End.
 * 탭 2개짜리 탭바이므로 계산은 단순하지만, 규칙을 순수 함수로 빼서 테스트한다.
 * 처리하지 않는 키면 `null`(= 호출부가 기본 동작을 유지).
 */
export function appTabIndexAfterKey(
  current: number,
  key: string,
  count: number = APP_TABS.length,
): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
