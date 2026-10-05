/**
 * 회차(출발 1건) — 데이터 스키마 `docs/01-architecture.md §4` 의 `trips[]` 와 1:1.
 *
 * `null` 은 원본의 `Χ`(운행 없음/해당 없음)다. 빈 문자열과 구분한다(파서 규칙 고정).
 * `note` 는 원본 '운행 특이사항' 열의 문자열 그대로 — 해석은 `rules/serviceDay.ts` 의 패턴 표가 한다.
 */
export interface Trip {
  readonly seq: number;
  readonly depCampus: string | null;
  readonly depStation: string | null;
  readonly arrCampus: string | null;
  readonly note: string | null;
}

/**
 * 회차의 안내용 출발 시각 = 캠퍼스 출발(`depCampus`), 없으면 역 출발(`depStation`).
 * 둘 다 `Χ`(=null)면 이 회차는 안내 대상이 아니다(운행 시각이 없다).
 */
export function tripDepartureTime(trip: Trip): string | null {
  return trip.depCampus ?? trip.depStation ?? null;
}
