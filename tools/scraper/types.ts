/**
 * tools/scraper 공용 타입 — `docs/01-architecture.md §4` 스키마(계약) 구현.
 *
 * 계약 정정(2026-10-05, 총괄 `docs/01 §4` 주석 · `docs/00` F2/F2b):
 *  - `columns` 는 **노선·요일별로 가변**(평일 5/7/8/8열, 주말 4열) → 요일별 열 구성은 `byDay[day]` 에 담는다.
 *  - `colspan` 병합 셀은 **하나의 텍스트 값**으로 파싱한다(셀 개수 강제 금지).
 *  - 천안캠퍼스는 **운행 중단** → `status: 'suspended'` + 원본 문구 보존(빈 배열로 조용히 넘어가지 않는다).
 */

export type DayType = 'weekday' | 'saturday' | 'sunday';

export const DAY_TYPES: readonly DayType[] = ['weekday', 'saturday', 'sunday'];

/** 원본 요일 탭 표기(사람용) */
export const DAY_LABEL_KO: Readonly<Record<DayType, string>> = {
  weekday: '평일',
  saturday: '토요일',
  sunday: '일요일',
};

/**
 * 셀 값 해석 방식.
 * - `seq`  : 순번(정수)
 * - `time` : 시각(H:MM → HH:MM 정규화)
 * - `text` : 자유 텍스트(예: `경유`, `5분~10분 소요예상`) — 값 보존
 * - `note` : 원문 보존(예: `금(X)`, `0:15`) — 시각 정규화·빈값 처리 규칙은 동일하되 표기 변형 금지
 */
export type ColumnKind = 'seq' | 'time' | 'text' | 'note';

export interface ColumnSpec {
  /** JSON 키(ASCII) — `docs/01 §4` 예시와 동일한 규칙 */
  readonly key: string;
  /** 원본 표 헤더 **원문**(공백 정규화만) — 열 개수 대조에 사용 */
  readonly label: string;
  readonly kind: ColumnKind;
}

/** 원본 노선 페이지 1개(노선 × 요일) = 스냅샷 파일 1개 */
export interface DayTableMeta {
  readonly dayType: DayType;
  readonly url: string;
  readonly columns: readonly ColumnSpec[];
}

export interface RouteMeta {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'suspended';
  /** 대표(평일) 페이지 URL — 운행 중단 노선은 표가 없으므로 이 URL 이 출처가 된다 */
  readonly url: string;
  readonly days: readonly DayTableMeta[];
}

export type CellValue = string | number | null;
export type TripRow = Record<string, CellValue>;

/** 한 요일의 표 = 열(원문+키) + 행 */
export interface DayTable {
  /** 헤더 원문 문자열(요일별로 다르다) */
  readonly columns: readonly string[];
  /** `columns` 와 같은 순서의 JSON 키 */
  readonly keys: readonly string[];
  readonly trips: readonly TripRow[];
}

export interface SemesterPeriod {
  /** 원본 제목 전문(문구 하드코딩 금지 — 원문 보존) */
  readonly title: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly kind: 'semester' | 'holiday';
}

export type NoticeKind = 'no-service' | 'alternate-schedule' | 'notice';

export interface Notice {
  readonly kind: NoticeKind;
  /** 사람이 읽는 정규화 문구(원문에서 파생) */
  readonly text: string;
  /** 원본 문구 그대로(증거) */
  readonly raw: string;
  /** 해당 날짜(YYYY-MM-DD) — 날짜가 있는 안내문만 */
  readonly date?: string;
  /** 기간 안내문의 끝 날짜 */
  readonly endDate?: string;
}

export interface BusRef {
  readonly line: string;
  readonly stop: string;
  readonly to: string;
}

export interface Contacts {
  readonly team: string;
  readonly tel: string;
}

/** 스냅샷 1개(= 페이지 1개) 파싱 결과 */
export interface Snapshot {
  readonly routeId: string;
  /** 원본 `h4.title22` 의 노선 제목(○ 제거) */
  readonly routeTitle: string;
  /** `- 운행노선:` 원문 경로(없으면 null) */
  readonly path: string | null;
  readonly status: 'active' | 'suspended';
  /** 운행 중단 사유(원본 문구 그대로) — status='suspended' 일 때 */
  readonly suspendedReason: string | null;
  readonly dayType: DayType;
  /** 원본 헤더 원문(정규화) */
  readonly columns: readonly string[];
  /** 계약 키(`routeMeta` 기준) */
  readonly keys: readonly string[];
  readonly trips: readonly TripRow[];
  readonly notices: readonly Notice[];
  readonly busRefs: readonly BusRef[];
  readonly contacts: Contacts | null;
  /** 이 페이지의 학기/휴일 문구 */
  readonly period: SemesterPeriod | null;
  /** 이 페이지의 "최근 업데이트" 날짜 */
  readonly sourceUpdatedAt: string | null;
}

/** 페이지 1개분 출처 메타(확장 — T1 §9.2-3: 원본 "최근 업데이트"가 페이지별로 다르다) */
export interface SourcePage {
  readonly routeId: string;
  readonly dayType: DayType;
  readonly url: string;
  readonly sourceUpdatedAt: string;
}

export interface SourceInfo {
  readonly url: string;
  readonly sourceUpdatedAt: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  /** 확장: 페이지별 출처·신선도(원본 값이 페이지마다 다르다) */
  readonly pages: readonly SourcePage[];
}

export interface RouteData {
  readonly id: string;
  readonly name: string;
  readonly path: string | null;
  readonly status: 'active' | 'suspended';
  /** 운행 중단 사유(원본 문구) — status='suspended' 일 때만 */
  readonly suspendedReason?: string;
  /** 대표(평일) 열 키 — `docs/01 §4` 예시와 동일한 형태 */
  readonly columns: readonly string[];
  /** 대표(평일) 행 — `docs/01 §4` 예시와 동일한 형태 */
  readonly trips: readonly TripRow[];
  /** 요일별 표(요일마다 열 구성이 다르다) */
  readonly byDay: Readonly<Record<DayType, DayTable>>;
  /** 확장: 원본에 페이지가 없는 요일(예: 온양·천안캠퍼스의 주말) */
  readonly offDays: readonly DayType[];
}

export interface Timetable {
  readonly schemaVersion: 1;
  readonly source: SourceInfo;
  readonly semester: SemesterPeriod;
  /** 확장: 주말 페이지의 "휴일 운행기간" 문구(평일 학기 문구와 다르다) */
  readonly holidayPeriod: SemesterPeriod | null;
  readonly dayTypes: readonly DayType[];
  readonly routes: readonly RouteData[];
  readonly notices: readonly Notice[];
  readonly busRefs: readonly BusRef[];
  readonly contacts: Contacts;
}

/** 파서/조립 단계에서 던지는 오류 — 원인 위치를 메시지에 담는다(조용한 손상 금지) */
export class ScrapeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ScrapeError';
  }
}
