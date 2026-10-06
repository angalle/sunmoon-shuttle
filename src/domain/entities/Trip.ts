/**
 * 회차(출발 1건) — 데이터 스키마 `docs/01-architecture.md §4` · `docs/06-data-model.md §3` 의 `trips[]` 와 1:1.
 *
 * `null` 은 원본의 `Χ`(운행 없음/해당 없음)다. 빈 문자열과 구분한다(파서 규칙 고정).
 * `note` 는 원본 '운행 특이사항' 열의 문자열 그대로 — 해석은 `rules/tripStatus.ts` 의 패턴 표가 한다.
 *
 * v3(`docs/06`) 추가 필드 — **없으면 undefined**(v1·v2 데이터 = 조건 없음 = 기본 동작):
 * - `service`        : 편별 요일 조건(구조). 예 `{excludedDays:['fri']}` = 매주 금요일 미운행
 * - `durationMinutes`: 그 회차의 소요시간(분). 예 `0:15` → `15`
 * - `unknownNote`    : 미해석 표기 원문(내부 플래그 — 화면 미노출)
 * - `needsReview`    : 사람이 확인해야 하는 행 표시(내부 플래그 — 화면 미노출)
 */
import type { WeekdayCode } from './DayType';

/** 편별 요일 조건(`docs/06 §3` `trip.service`). 원문 `note` 는 `sourceQuote` 로 보존한다. */
export interface TripServiceCondition {
  /** 매주 이 요일에는 운행하지 않는다(`금(X)` → `["fri"]`). 비어 있으면 조건 없음. */
  readonly excludedDays: readonly WeekdayCode[];
  /** 이 요일 범위에서만 운행한다(`월~화 2대 운행` → `["mon","tue"]`). `null` = 요일 범위 조건 없음. */
  readonly dayScope: readonly WeekdayCode[] | null;
  /** `dayScope` 와 함께 오는 운행 대수 안내(`2대 운행` → `2`). 없으면 null. */
  readonly vehicleCount: number | null;
  /** 표기 통일본(예 `중간노선 전용`). 없으면 null — 화면 배지 문구로 쓴다. */
  readonly label: string | null;
  /** 판정 근거가 된 **원문**(표기 변형 금지, 예 `금(X)`). 없으면 null. */
  readonly sourceQuote: string | null;
}

export interface Trip {
  readonly seq: number;
  readonly depCampus: string | null;
  readonly depStation: string | null;
  readonly arrCampus: string | null;
  readonly note: string | null;
  /** v3 편별 요일 조건 — v1·v2 데이터에는 없다(조건 없음으로 본다). */
  readonly service?: TripServiceCondition | null;
  /** v3 그 회차의 소요시간(분) — 없으면 null/미정의. */
  readonly durationMinutes?: number | null;
  /** v3 미해석 표기 원문(내부 플래그) — 없으면 null/미정의. */
  readonly unknownNote?: string | null;
  /** v3 검수 필요 표시(내부 플래그) — 없으면 false/미정의. */
  readonly needsReview?: boolean;
}

/**
 * 회차의 안내용 출발 시각 = 캠퍼스 출발(`depCampus`), 없으면 역 출발(`depStation`).
 * 둘 다 `Χ`(=null)면 이 회차는 안내 대상이 아니다(운행 시각이 없다).
 */
export function tripDepartureTime(trip: Trip): string | null {
  return trip.depCampus ?? trip.depStation ?? null;
}
