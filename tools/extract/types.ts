/**
 * `tools/extract` 공용 타입 — **스키마 v2**(`docs` 01 부록 A) 구현.
 *
 * v1(`tools/scraper/types.ts`, `schemaVersion: 1`)은 **그대로 유지**한다 — 이 단계는 v1 필드를
 * 하나도 바꾸지 않고 **추가 필드만** 얹는다(앱 무중단).
 *
 * 추가되는 것:
 *  - `dateRules[]`  : 날짜·기간·조건 규칙(갭 ①③⑤⑥) — `kind` 별 필수 필드가 다르다
 *  - `terms[]`      : 학기/방학 구간 + 그 기간에 적용되는 시간표 소스(갭 ④)
 *  - `routes[].tripNotes[]`  : 방향별 소요시간(갭 ②)
 *  - `routes[].stopWindows[]`: 시간창 조건부 정차(갭 ③)
 *
 * **계약(모든 v2 항목 공통)**: `sourceQuote` 는 원본 스냅샷 문장의 **부분문자열**이어야 하고,
 * `extractedBy` 로 규칙/`ai` 출처를 구분한다.
 */

import type { DayType, Notice, RouteData, SemesterPeriod, Timetable } from '../scraper/types.js';

export type { DayType, Notice, RouteData, SemesterPeriod, Timetable };

// ─────────────────────────── dateRules ───────────────────────────

export type DateRuleKind =
  | 'no-service'
  | 'alternate-schedule'
  | 'route-change'
  | 'stop-time-window'
  | 'term'
  | 'vacation'
  | 'period-meaning';

export const DATE_RULE_KINDS: readonly DateRuleKind[] = [
  'no-service',
  'alternate-schedule',
  'route-change',
  'stop-time-window',
  'term',
  'vacation',
  'period-meaning',
];

export function isDateRuleKind(value: string): value is DateRuleKind {
  return (DATE_RULE_KINDS as readonly string[]).includes(value);
}

export type ExtractedBy = 'rule' | 'ai';

export interface DateRule {
  readonly kind: DateRuleKind;
  /** `YYYY-MM-DD` 또는 null(날짜 범위 규칙이 아니면 null) */
  readonly start: string | null;
  readonly end: string | null;
  /** 원본 표기에 연도가 없어 학기에서 추론했는가(갭 ⑥) */
  readonly yearInferred: boolean;
  /** 규칙이 특정 요일에만 적용되면 채운다. 빈 배열 = 요일 한정 없음 */
  readonly dayTypes: readonly DayType[];
  /** 적용 노선 id. 빈 배열 = 전 노선 */
  readonly scope: readonly string[];
  /** kind 별 구조화 값(자유 형식이지만 kind 마다 필수 키가 있다 — validate.ts 참조) */
  readonly effect: Readonly<Record<string, unknown>>;
  readonly note: string | null;
  readonly sourceQuote: string;
  /** 근거 스냅샷 파일명 */
  readonly sourcePage: string;
  readonly extractedBy: ExtractedBy;
  readonly confidence: number;
  readonly needsReview: boolean;
  /** 같은 기간의 중복 공지를 통합했을 때, 제거된 표기 원문(갭 ⑥) */
  readonly mergedQuotes?: readonly string[];
}

// ─────────────────────────── 방향별 소요시간(갭 ②) ───────────────────────────

/** inbound = 등교(역/터미널 → 캠퍼스), outbound = 하교(캠퍼스 → 역/터미널) */
export type TripDirection = 'inbound' | 'outbound' | 'both';

export interface TripNote {
  readonly direction: TripDirection;
  /** 원문에 적힌 소요 분. 원문에 없으면 null */
  readonly minutes: number | null;
  /** 원문 구간 표기(예: `아산역 > 캠퍼스`) */
  readonly segment: string | null;
  readonly conditions: readonly string[];
  readonly note: string | null;
  readonly sourceQuote: string;
  readonly sourcePage: string;
  readonly extractedBy: ExtractedBy;
  readonly confidence: number;
  readonly needsReview: boolean;
}

// ─────────────────────────── 시간창 정차(갭 ③) ───────────────────────────

export interface TimeWindow {
  /** `HH:MM` */
  readonly start: string;
  /** `HH:MM` 또는 null(= 막차까지처럼 끝이 열려 있음) */
  readonly end: string | null;
  /** 원문 표기 그대로 */
  readonly raw: string;
}

export interface StopWindow {
  readonly location: string;
  readonly dayTypes: readonly DayType[];
  readonly term: string | null;
  readonly windows: readonly TimeWindow[];
  readonly note: string | null;
  readonly sourceQuote: string;
  readonly sourcePage: string;
  readonly extractedBy: ExtractedBy;
  readonly confidence: number;
  readonly needsReview: boolean;
}

// ─────────────────────────── 학기/방학(갭 ④) ───────────────────────────

export interface Term {
  readonly kind: 'semester' | 'vacation';
  readonly label: string;
  readonly start: string | null;
  readonly end: string | null;
  /** 이 기간에 적용되는 시간표 페이지(원본 URL). 스냅샷에 없으면 null */
  readonly timetableSource: string | null;
  readonly note: string | null;
  readonly sourceQuote: string;
  readonly sourcePage: string;
  readonly extractedBy: ExtractedBy;
  readonly confidence: number;
  readonly needsReview: boolean;
}

// ─────────────────────────── 후보 문장 ───────────────────────────

export interface Candidate {
  /** 결정적 id(`c001`…) — AI 프롬프트가 이 id 로 문장을 지칭한다 */
  readonly id: string;
  /** 원본 페이지 본문의 **정확한 부분문자열** */
  readonly text: string;
  readonly keywords: readonly string[];
  readonly pages: readonly string[];
}

// ─────────────────────────── 입력 소스 ───────────────────────────

export interface SnapshotSource {
  readonly file: string;
  readonly routeId: string;
  readonly dayType: DayType;
  readonly html: string;
  /** 태그 제거·엔티티 해석·공백 정규화 본문(AI/규칙 모두 이 본문에서 문장을 찾는다) */
  readonly text: string;
}

// ─────────────────────────── AI ───────────────────────────

/** AI 가 돌려주는 초안 — **수치는 담지 않는다**(FR-A2: 시각·행 수는 AI 금지 영역) */
export interface AiRuleDraft {
  readonly candidateId: string | null;
  readonly sourceQuote: string;
  readonly kind: string;
  readonly dayTypes: readonly string[];
  readonly note: string | null;
  readonly confidence: number;
}

export type AiStatus = 'ok' | 'unavailable' | 'error' | 'disabled';

export interface AiStructureResult {
  readonly status: AiStatus;
  readonly model: string;
  readonly durationMs: number;
  readonly drafts: readonly AiRuleDraft[];
  /** 원시 응답(증거·디버깅용, 로그에만 남긴다) */
  readonly raw: string;
  readonly error: string | null;
}

export interface AiStructurer {
  readonly model: string;
  readonly promptTemplateSha256: string;
  structure(candidates: readonly Candidate[]): Promise<AiStructureResult>;
}

// ─────────────────────────── 병합 결과 ───────────────────────────

export interface DroppedDraft {
  readonly quote: string;
  readonly reason: string;
}

export interface MergeOutcome {
  readonly dateRules: readonly DateRule[];
  readonly dropped: readonly DroppedDraft[];
  readonly repairs: number;
  readonly conflicts: number;
  readonly fatal: readonly ValidationIssue[];
}

// ─────────────────────────── 스키마 v2 문서 ───────────────────────────

export interface EnrichedRouteData extends RouteData {
  readonly tripNotes: readonly TripNote[];
  readonly stopWindows: readonly StopWindow[];
}

/** 갭 6종 커버리지 자기보고(검증기가 데이터에서 계산 — 하드코딩 아님) */
export interface GapCoverage {
  readonly gap: number;
  readonly name: string;
  /** 이 갭이 구조화된 위치(스키마 경로) */
  readonly where: string;
  readonly count: number;
}

export interface ExtractionMeta {
  /** 추출기 식별자 */
  readonly extractor: string;
  readonly model: string | null;
  readonly promptTemplateSha256: string;
  readonly promptChars: number;
  readonly aiStatus: AiStatus;
  readonly aiError: string | null;
  readonly candidates: number;
  readonly ruleEntries: number;
  readonly aiDrafts: number;
  readonly aiAccepted: number;
  readonly aiDropped: number;
  readonly aiRepairs: number;
  readonly aiConflicts: number;
  readonly needsReview: number;
  readonly dedupedNotices: number;
  readonly reviewReasons: readonly string[];
  readonly gaps: readonly GapCoverage[];
}

/**
 * v2 본문 — 추출 메타(`source.extraction`)를 붙이기 **전** 상태.
 * (검증 → 메타 부착 순서를 타입으로 강제한다: 메타의 `needsReview`·`reviewReasons` 는 검증 결과에서 나온다.)
 */
export interface EnrichedTimetableBody extends Omit<Timetable, 'schemaVersion' | 'routes' | 'source'> {
  readonly schemaVersion: 2;
  readonly routes: readonly EnrichedRouteData[];
  readonly dateRules: readonly DateRule[];
  readonly terms: readonly Term[];
  readonly source: Timetable['source'];
}

export interface EnrichedTimetable extends Omit<EnrichedTimetableBody, 'source'> {
  readonly source: Timetable['source'] & { readonly extraction: ExtractionMeta };
}

// ─────────────────────────── 검증 ───────────────────────────

export interface ValidationIssue {
  readonly where: string;
  readonly message: string;
  /** true = 발행 중단(exit 1). false = `needsReview` 표시 후 발행 */
  readonly fatal: boolean;
}

export interface RuleStructures {
  readonly dateRules: readonly DateRule[];
  readonly terms: readonly Term[];
  /** 중복 제거된 v1 안내문(그대로 v2 `notices` 로 발행된다) */
  readonly notices: readonly Notice[];
  readonly dedupedNotices: number;
  readonly dedupedQuotes: readonly string[];
  readonly tripNotes: readonly { readonly routeId: string; readonly notes: readonly TripNote[] }[];
  readonly stopWindows: readonly { readonly routeId: string; readonly windows: readonly StopWindow[] }[];
  /** 규칙이 설명한 후보 id(중복 판정·보고용) */
  readonly consumedCandidateIds: readonly string[];
}

/** 추출 단계 오류 — 조용한 손상 금지(원인을 메시지에 담는다) */
export class ExtractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}
