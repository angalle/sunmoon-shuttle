/**
 * 화면 설정 저장 (features/schedule/api) — 브라우저 저장소를 다루는 **기능의 IO 경계**.
 *
 * 계약(docs/07-mobile-ux.md §11-1 · §16-2): 요일(평일/토/일)·**방향 선택**(택1 — `학교 도착`/`터미널 도착`) 상태는
 * **저장한다**(재실행 시 유지). 저장소가 막힌 환경(사파리 프라이빗 등)에서도 **예외를 던지지 않는다** —
 * 저장이 안 되면 그냥 기본값(오늘 요일 / 기본 방향)으로 동작한다(앱은 계속 돈다).
 *
 * 이 모듈은 DOM 을 직접 만지지 않는다 — 저장소를 **주입받아** 읽고/쓰기만 한다(테스트 가능).
 * (결선은 app/mount.ts, 값 소비는 pages/SchedulePage.ts)
 */
import { isDayType, type DayType } from '../../../../../../domain/entities/DayType';
import { DIRECTION_SELECTIONS, type DirectionSelection } from '../store/selectors';
import type { KeyValueStorage } from '../../../shared/lib/storage';

/** 저장 키 — 접미사 `:v1` 은 값 형식이 바뀔 때 올린다(옛 값은 조용히 무시된다). */
export const UI_PREFS_STORAGE_KEY = 'sunmoon-shuttle:ui-prefs:v1';

export interface UiPrefs {
  /** 저장된 요일 선택 — 없거나 이상하면 null(기본: 오늘 요일) */
  readonly dayType: DayType | null;
  /**
   * 저장된 방향 선택 — 없거나 이상하면 null(기본: `DEFAULT_DIRECTION_SELECTION` = `터미널 도착`).
   * T38 §16-2 — **`all`(전체)은 더 이상 유효한 값이 아니다**: 옛 버전이 저장해 둔 `"all"` 은 무효로 보고 기본값을 쓴다.
   */
  readonly direction: DirectionSelection | null;
  /** 저장된 정류장(노선 id · 시안 A) — 없으면 null(첫 정류장). 선택지에 없는 값은 페이지가 무시한다 */
  readonly stop: string | null;
  /**
   * 저장 시점의 KST 날짜 키(`YYYY-MM-DD`).
   * 요일 선택은 **그날 안에서만** 유효하다 — 날이 바뀌면(또는 다른 날짜의 화면을 열면) 무시하고 오늘 요일로 시작한다.
   */
  readonly date: string | null;
}

const EMPTY: UiPrefs = { dayType: null, direction: null, stop: null, date: null };

/** KST 날짜 키 형식 — 이 형식이 아니면 날짜 없음으로 본다(요일 선택은 그때 무효). */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** §16-2 — 저장값은 **택1 방향**(`out`·`in`)만 유효하다(`all` 은 옛 값이라 무시). */
function isDirectionSelection(value: unknown): value is DirectionSelection {
  return typeof value === 'string' && (DIRECTION_SELECTIONS as readonly string[]).includes(value);
}

/**
 * 저장된 화면 설정을 읽는다. 저장소 없음·값 없음·깨진 JSON·모르는 값은 모두 **null**(기본값 사용).
 * 한 항목이 이상해도 다른 항목은 살린다(부분 복구).
 */
export function readUiPrefs(storage: KeyValueStorage | null): UiPrefs {
  if (storage === null) return EMPTY;
  let raw: string | null;
  try {
    raw = storage.getItem(UI_PREFS_STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === null) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY;
  const record = parsed as Record<string, unknown>;
  return {
    dayType: isDayType(record['dayType']) ? record['dayType'] : null,
    direction: isDirectionSelection(record['direction']) ? record['direction'] : null,
    stop: typeof record['stop'] === 'string' && /^[a-z0-9-]{1,40}$/.test(record['stop']) ? record['stop'] : null,
    date: typeof record['date'] === 'string' && DATE_KEY.test(record['date']) ? record['date'] : null,
  };
}

/**
 * 요일·방향 선택을 저장한다(둘 다 항상 함께 쓴다 — 한쪽만 바뀌어도 나머지는 유지된다).
 * `date` 는 저장 시점의 KST 날짜 키 — 읽는 쪽이 **같은 날일 때만** 요일 선택을 되살린다(요일 선택은 그날 한정).
 * 저장 실패는 삼킨다(이번 세션의 화면 동작 자체는 성공해야 한다 — 무음 실패가 아니라 설계된 동작).
 */
export function writeUiPrefs(
  storage: KeyValueStorage | null,
  prefs: { readonly dayType: DayType; readonly direction: DirectionSelection; readonly stop?: string | null; readonly date: string },
): void {
  if (storage === null) return;
  try {
    storage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ dayType: prefs.dayType, direction: prefs.direction, stop: prefs.stop ?? null, date: prefs.date }));
  } catch {
    /* 저장 불가 환경 — 이번 세션 값으로만 동작한다. */
  }
}

/**
 * 저장된 요일 탭을 돌려준다 — **마지막에 누른 탭을 날짜와 상관없이 기억한다**(2026-11-08 사용자 결정).
 * 예전 규칙(그날 안에서만 유효)은 폐기했다: 사용자는 주말 시간표를 자주 보면 다음 날에도 그 탭으로 열리길 원한다.
 * 오늘 시간표로 돌아가는 길은 `현재 시간으로` 버튼(오늘 요일로 전환 + 다음 출발로 이동)이 맡는다.
 * `todayKey` 는 호출 호환을 위해 남겨 둔다(쓰지 않는다).
 */
export function effectiveStoredDayType(prefs: UiPrefs, todayKey: string): DayType | null {
  void todayKey;
  return prefs.dayType;
}
