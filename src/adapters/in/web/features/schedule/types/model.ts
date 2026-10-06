/**
 * 앱 내부 뷰모델 (features/schedule/types) — 외부 JSON 계약(`contract.ts`)을 화면이 쓰기 좋게 정리한 형태.
 *
 * 원칙
 * - **요일·시각 계산은 여기서 하지 않는다.** 계산은 도메인 함수(`nextDepartures` 등)만 한다.
 * - 외부 계약에만 있는 필드(`status`·`suspendedReason`·`offDays`·원문 헤더 `columns`)는
 *   **표시용으로 보존**한다(F2b 운행 중단 · F2 가변 열).
 * - 도메인이 아는 형태(`Schedule`)는 `schedule` 필드로 함께 들고 다닌다(브리지는 `data/normalize.ts` 한 곳).
 */
import type { DayType } from '../../../../../../domain/entities/DayType';
import type { Schedule } from '../../../../../../domain/entities/Schedule';
import type { Notice, SemesterPeriod, TripRow } from './contract';

/* ─────────────── schema v2 보조 데이터 (T17 — 표시 전용) ───────────────
 * T16 이 `data/timetable.json` 을 schemaVersion 2 로 넓히며 추가한 배열들이다.
 * 앱은 **읽기만** 한다(스키마·판정 로직 신규 작성 금지).
 * v1 파일에는 이 키들이 없으므로 전부 **빈 배열**이 되고, 화면은 조용히 숨긴다(하위호환).
 * `needsReview` 는 v2 내부 플래그다 — 사용자에게 노출하지 않고 선택자가 거른다(태스크 ⑥).
 */

/** `dateRules[]` — 날짜·기간 규칙(운행 없음·대체 시간표 등). 표시에 쓰는 필드만 옮긴다. */
export interface DateRuleView {
  readonly kind: string;
  /** `YYYY-MM-DD` 또는 null(날짜 범위 규칙이 아니면 null) */
  readonly start: string | null;
  readonly end: string | null;
  readonly dayTypes: readonly DayType[];
  /** 적용 노선 id(빈 배열 = 전 노선) */
  readonly scope: readonly string[];
  readonly effect: Readonly<Record<string, unknown>>;
  /**
   * 데이터에서 뽑은 표기 이름(예 `한글날`·`개교기념일`) — 원문 인용의 대괄호 앞부분.
   * 뽑지 못하면 null 이고 화면은 날짜+상태만 보여준다(하드코딩 금지).
   */
  readonly label: string | null;
  /** 판정 근거가 된 **원문 인용**(도메인 `tripStatus` 에 그대로 넘긴다 — 사유 코드의 근거). 없으면 null */
  readonly sourceQuote: string | null;
  readonly needsReview: boolean;
}

/** `routes[].tripNotes[]` — 방향별 소요시간(갭 ②). */
export interface TripNoteView {
  readonly direction: 'inbound' | 'outbound' | 'both';
  /** 원문에 적힌 소요 분. 없으면 null */
  readonly minutes: number | null;
  readonly segment: string | null;
  /** 조건 표기(예 `교통정체`·`이외 시간`). 비어 있지 않으면 조건부 소요시간이다 */
  readonly conditions: readonly string[];
  readonly note: string | null;
  readonly needsReview: boolean;
}

/** `routes[].stopWindows[].windows[]` — 시각창 1개(`13:30~15:30` / `19:30~막차까지`). */
export interface StopWindowTimeView {
  readonly start: string;
  readonly end: string | null;
  /** 원문 표기 그대로(화면에 쓰는 값) */
  readonly raw: string;
}

/** `routes[].stopWindows[]` — 시간창 조건부 정차(갭 ③). */
export interface StopWindowView {
  readonly location: string;
  readonly term: string | null;
  readonly dayTypes: readonly DayType[];
  readonly windows: readonly StopWindowTimeView[];
  readonly needsReview: boolean;
}

/** `terms[]` — 학기/방학 구간 + 그 기간에 적용되는 시간표 소스(갭 ④·⑤). */
export interface TermView {
  readonly kind: 'semester' | 'vacation';
  readonly label: string;
  readonly start: string | null;
  readonly end: string | null;
  /** 이 기간에 적용되는 시간표 페이지(원본에 없으면 null) */
  readonly timetableSource: string | null;
  readonly needsReview: boolean;
}

/** 한 요일의 표(원문 헤더 + 행). 요일별로 열 구성이 다르다(docs/01 §4 가변 열). */
export interface DayTableView {
  readonly dayType: DayType;
  /** 원본 헤더 원문(공백 정규화) — 이 순서대로 열을 렌더한다 */
  readonly columns: readonly string[];
  /** `columns` 와 같은 순서의 JSON 키 */
  readonly keys: readonly string[];
  readonly rows: readonly TripRow[];
}

export interface SourcePageView {
  readonly routeId: string;
  readonly dayType: DayType;
  readonly url: string;
  readonly sourceUpdatedAt: string;
}

export interface SourceView {
  readonly url: string;
  readonly sourceUpdatedAt: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly pages: readonly SourcePageView[];
}

export interface RouteView {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly status: 'active' | 'suspended';
  /** 운행 중단 사유(원본 문구) — `status='suspended'` 일 때 */
  readonly suspendedReason: string | null;
  /** 원본에 페이지가 없는 요일(예: 온양 주말) */
  readonly offDays: readonly DayType[];
  /** 방향별 소요시간(v2, 없으면 빈 배열) */
  readonly tripNotes: readonly TripNoteView[];
  /** 시간창 조건부 정차(v2, 없으면 빈 배열) */
  readonly stopWindows: readonly StopWindowView[];
  /** 요일별 표. `null` = 그 요일 데이터 없음(원본에 페이지 없음/운행 중단) */
  readonly byDay: Readonly<Record<DayType, DayTableView | null>>;
}

export interface TimetableModel {
  readonly schemaVersion: number;
  readonly semester: SemesterPeriod;
  readonly holidayPeriod: SemesterPeriod | null;
  readonly dayTypes: readonly DayType[];
  readonly routes: readonly RouteView[];
  /** 날짜·기간 규칙(v2, 없으면 빈 배열 = v1 하위호환) */
  readonly dateRules: readonly DateRuleView[];
  /** 학기/방학 구간(v2, 없으면 빈 배열) */
  readonly terms: readonly TermView[];
  /** 원본 안내문(정규화 전 — `date` 없는 문구 포함, F7) */
  readonly notices: readonly Notice[];
  readonly busRefs: readonly { readonly line: string; readonly stop: string; readonly to: string }[];
  readonly contacts: { readonly team: string; readonly tel: string } | null;
  readonly source: SourceView;
  /** 도메인 함수 입력. 외부 계약 → 도메인 모델 정규화 결과(`data/normalize.ts`) */
  readonly schedule: Schedule;
}
