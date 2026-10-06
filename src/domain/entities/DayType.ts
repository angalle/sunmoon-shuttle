/**
 * 요일 구분 값 객체 — 요구사항 `docs/00-requirements.md` F1 (평일 / 토요일 / 일요일).
 *
 * 도메인 규칙: 브라우저·네트워크·시간 API(fetch, document, window, indexedDB, localStorage,
 * import.meta.env, Date.now)를 쓰지 않는다 → `npm run lint:boundary` 가 강제한다.
 * 데이터 스키마의 `dayTypes`(docs/01-architecture.md §4)와 값이 1:1 이다.
 */
export type DayType = 'weekday' | 'saturday' | 'sunday';

/** 스키마·UI 에서 쓰는 정본 순서(평일 → 토 → 일). */
export const DAY_TYPES = ['weekday', 'saturday', 'sunday'] as const;

/** 원본 페이지의 한 글자 요일 표기 → DayType. */
const LABEL_TO_DAY_TYPE: Readonly<Record<string, DayType>> = {
  월: 'weekday',
  화: 'weekday',
  수: 'weekday',
  목: 'weekday',
  금: 'weekday',
  토: 'saturday',
  일: 'sunday',
};

/**
 * 요일 문자열('월'..'일') → `DayType`.
 * 해석할 수 없는 표기는 **조용히 넘기지 않고 명시적으로 실패**한다(원본 표기가 바뀌면 즉시 드러나게).
 */
export function dayTypeFromWeekdayLabel(label: string): DayType {
  const key = label.trim();
  const dayType = LABEL_TO_DAY_TYPE[key];
  if (dayType === undefined) {
    throw new Error(
      `알 수 없는 요일 표기: ${JSON.stringify(label)} (기대: 월/화/수/목/금/토/일)`,
    );
  }
  return dayType;
}

/** 외부 입력(JSON 등)이 유효한 `DayType` 인지 좁히는 타입 가드. */
export function isDayType(value: unknown): value is DayType {
  return typeof value === 'string' && (DAY_TYPES as readonly string[]).includes(value);
}

/**
 * 요일 코드 — 데이터(JSON) 표기와 **같은 값**이다(`docs/06-data-model.md §3`:
 * `excludedDays: ["fri"]` · `dayScope: ["mon","tue"]`).
 *
 * 인덱스가 곧 JS `Date` 규약의 요일 번호(0=일 … 6=토)이므로 `kst.ts` 의 계산과 그대로 맞물린다.
 */
export const WEEKDAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** 외부 입력(JSON 등)이 유효한 요일 코드인지 좁히는 타입 가드. */
export function isWeekdayCode(value: unknown): value is WeekdayCode {
  return typeof value === 'string' && (WEEKDAY_CODES as readonly string[]).includes(value);
}

/** 요일 번호(0=일 … 6=토) → 요일 코드. 범위를 벗어나면 null(추측하지 않는다). */
export function weekdayCodeOf(weekday: number): WeekdayCode | null {
  return WEEKDAY_CODES[weekday] ?? null;
}

/** 요일 코드 → 요일 번호(0=일 … 6=토). */
export function weekdayIndexOfCode(code: WeekdayCode): number {
  return WEEKDAY_CODES.indexOf(code);
}

/** 요일 코드 배열을 코드 규약(`sun`…`sat`)으로만 걸러 낸다(외부 JSON 관용 읽기). */
export function weekdayCodesOf(value: unknown): WeekdayCode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is WeekdayCode => isWeekdayCode(item));
}
