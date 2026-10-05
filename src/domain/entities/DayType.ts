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
