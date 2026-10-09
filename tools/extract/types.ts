/**
 * `tools/extract` 공용 타입 — **스키마 v3**(`docs/06-data-model.md` §3) 구현.
 *
 * v1(`tools/scraper/types.ts`, `schemaVersion: 1`)의 표·시각·순번은 **그대로** 유지한다 — 이 단계는
 * v1 필드를 값까지 바꾸지 않고 **추가 필드만** 얹는다(앱 무중단). 예외는 하나뿐이다:
 * `routes[].byDay[*].trips[].note` — 원문 표기가 구조화되면 **비운다**(v3 계약, 중복 표현 금지).
 *
 * 추가되는 것:
 *  - `dateRules[]`  : 날짜·기간·조건 규칙(갭 ①③⑤⑥) — `kind` 별 필수 필드가 다르다
 *  - `terms[]`      : 학기/방학 구간 + 그 기간에 적용되는 시간표 소스(갭 ④) + `periodSearch`(v3)
 *  - `routes[].tripNotes[]`  : 방향별 소요시간(갭 ②)
 *  - `routes[].stopWindows[]`: 시간창 조건부 정차(갭 ③)
 *  - `routes[].routeNotes[]` : 노선 폐지·중단 **원문 서술**(`status: "suspended"` 와 짝) — v3 개정(docs/06 §8-1).
 *                              같은 사실을 `dateRules` 로 표현하지 않는다(날짜 규칙은 "그 날짜에만" 으로 읽힌다)
 *  - `routes[].byDay[*].trips[].service`·`durationMinutes`·`unknownNote`·`needsReview` (v3 편별 조건)
 *  - `source.extraction.schemaVersion`·`termSources` (v3 실행 메타)
 *
 * **계약(모든 v2·v3 항목 공통)**: `sourceQuote` 는 원본 스냅샷 문장의 **부분문자열**이어야 하고,
 * `extractedBy` 로 규칙/`ai` 출처를 구분한다.
 */

import type { DayType, Notice, RouteData, SemesterPeriod, Timetable, TripRow } from '../scraper/types.js';

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
  /**
   * 규칙이 특정 요일에만 적용되면 채운다.
   * **요일 의미가 없으면 필드를 만들지 않는다** — 빈 배열은 소비자마다 해석이 갈리므로 금지한다(docs/06 §8-3).
   */
  readonly dayTypes?: readonly DayType[];
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

// ─────────────────────────── 편별 조건(스키마 v3) ───────────────────────────

/**
 * 편별 요일 조건(v3) — 원본 표의 `운행 특이사항` 열 표기를 **구조**로 옮긴 것.
 * 수치는 규칙(`trips.ts`)이 만들고, `sourceQuote` 는 **원문 표기 그대로**다(표기 변형 금지).
 */
export type WeekdayCode = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAY_CODES: readonly WeekdayCode[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function isWeekdayCode(value: string): value is WeekdayCode {
  return (WEEKDAY_CODES as readonly string[]).includes(value);
}

export interface TripService {
  /** 이 요일에는 운행하지 않는다(`금(X)` → `["fri"]`). 빈 배열 = 요일 제외 없음 */
  readonly excludedDays: readonly WeekdayCode[];
  /** 이 요일들에만 운행(`월~화 2대 운행` → `["mon","tue"]`). null = 요일 한정 없음 */
  readonly dayScope: readonly WeekdayCode[] | null;
  /** `dayScope` 와 함께 오는 대수(`월~화 2대 운행` → 2) */
  readonly vehicleCount: number | null;
  /** 표기 통일본(`중간노선 전용`) — 공백 차이만 정규화한다 */
  readonly label: string | null;
  /** ★ 원문 note 그대로(필수) — 이 값이 원본 표기의 진본이다 */
  readonly sourceQuote: string;
}

/** 원문 note 1건의 해석 결과(결정적) */
export interface TripConditionEntry {
  readonly routeId: string;
  readonly dayType: DayType;
  readonly seq: number;
  /** 원문 note(공백만 trim) — 인용 검증 대상 */
  readonly sourceQuote: string;
  /** 해석 결과: 구조화된 조건 / 소요시간 / 미해석 */
  readonly outcome: 'service' | 'duration' | 'unknown';
  readonly service: TripService | null;
  readonly durationMinutes: number | null;
  /** 미해석일 때만 원문 표기(= `sourceQuote`) */
  readonly unknownNote: string | null;
}

/** v3 조건 필드 — **원문 note 가 있던 행에만** 붙는다(없던 행은 v1 그대로). */
export interface TripConditionFields {
  readonly service?: TripService | null;
  readonly durationMinutes?: number | null;
  readonly unknownNote?: string | null;
  readonly needsReview?: boolean;
}

/** v3 여행 행 — v1 `TripRow` + 조건 필드(선택) */
export type EnrichedTripRow = TripRow & TripConditionFields;

// ─────────────────────────── 방학/학기 스냅샷(노선 표가 아닌 페이지) ───────────────────────────

/**
 * 노선 시간표가 **아닌** 안내 페이지 스냅샷(예: 방학 시간표 페이지).
 * 파일명이 `<학기>-<노선>-<요일>` 규약 밖이라 노선 스냅샷과 섞이면 안 된다 → `data/raw/terms/` 하위에 둔다.
 * 쓰임: 기간 문구(방학 기간) 수집 + 그 근거 인용 검증.
 */
export interface TermSource {
  readonly file: string;
  readonly html: string;
  readonly text: string;
}

/** 기간(방학 등)을 어디서 찾았고 결과가 무엇인가 — 추측 금지 원칙의 기록 */
export interface TermPeriodSearch {
  /** 기간 문구를 찾은/못 찾은 스냅샷 파일 */
  readonly file: string;
  /** `found` = 기간 채움 · `not-found` = 페이지는 있으나 기간 문구 없음 · `not-provided` = 스냅샷 미포함 */
  readonly result: 'found' | 'not-found' | 'not-provided';
  /** 판정 근거가 된 **원문 문장**(부분문자열이어야 한다) */
  readonly evidenceQuote: string | null;
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

// ─────────────────────────── 노선 폐지·중단(스키마 v3 개정 · docs/06 §8-1) ───────────────────────────

/**
 * 노선 운행 중단(폐지) 서술 1건 — **날짜 규칙이 아니라 노선 서술이다**.
 *
 * `routes[].status: "suspended"` 가 "지금 운행하지 않는다"는 사실을, `routeNotes[]` 가 **원문 문구**를 담는다.
 * 같은 사실을 `dateRules`(`kind: no-service`)에 중복 기재하지 않는다 — 날짜 규칙으로 표현하면
 * "그 날짜에만 운행이 없다"로 읽혀 의미가 틀린다(docs/06 §8-1, 실 DeepSeek 실행에서 발견).
 */
export interface RouteNote {
  /** 원본 스냅샷 본문의 **정확한 부분문자열**(원문 인용 — 추측·요약 금지) */
  readonly quote: string;
  /** 사람이 읽는 설명(왜 이 노선이 중단인가) — 원문에 없는 내용은 쓰지 않는다 */
  readonly note: string | null;
}

// ─────────────────────────── 학기/방학(갭 ④) ───────────────────────────

export interface Term {
  readonly kind: 'semester' | 'vacation';
  readonly label: string;
  readonly start: string | null;
  readonly end: string | null;
  /** 이 기간에 적용되는 시간표 페이지(원본 URL). 스냅샷에 없으면 null */
  readonly timetableSource: string | null;
  /** v3: 기간(방학)을 어디서 찾았고 결과가 무엇인가 — 추측 금지의 기록 */
  readonly periodSearch?: TermPeriodSearch | null;
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

/**
 * AI 를 **실제로 어디서 받았는가**(NFR-A4).
 *  - `api`       : 외부 OpenAI 호환 API(`AI_BASE_URL`) — 호스티드 러너 기본
 *  - `ollama`    : 로컬 Ollama(`127.0.0.1:11434`) — 대안 경로
 *  - `rule-only` : AI 없음(요청에 의한 off **또는** 키 없음·실패로 인한 폴백)
 */
export type AiProvider = 'api' | 'ollama' | 'rule-only';

/**
 * AI 호출 비용 추적(NFR-A4). 토큰 수는 **추정치**다(문자수 기반 휴리스틱 — `ai.ts estimateTokens`).
 * 정확한 과금 값이 아니라 상한·이상치 감시용이다.
 */
export interface AiUsage {
  /** 실제로 나간 HTTP 요청 수(재시도 포함) */
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** 입력 길이 상한 초과로 **잘라낸 후보 문장 수**(0 = 잘림 없음) */
  readonly truncated: number;
}

export interface AiStructureResult {
  readonly status: AiStatus;
  /** 이 결과를 만든 어댑터 신원(폴백 여부와 무관) — `rule-only` 는 비활성 어댑터만 쓴다 */
  readonly provider: AiProvider;
  readonly model: string;
  readonly durationMs: number;
  readonly drafts: readonly AiRuleDraft[];
  /** 원시 응답(증거·디버깅용, 로그에만 남긴다) */
  readonly raw: string;
  readonly error: string | null;
  /** 호출 수·토큰 추정·잘림(NFR-A4) */
  readonly usage: AiUsage;
}

export interface AiStructurer {
  readonly model: string;
  readonly promptTemplateSha256: string;
  structure(candidates: readonly Candidate[]): Promise<AiStructureResult>;
}

// ─────────────────────────── AI 표 추출기(시간표 전용 — T34 · docs/08) ───────────────────────────

/**
 * AI 가 만든 **열 매핑** 1건.
 * `header` 는 원문 머리글(**그대로 복사** — 공백만 정리), `key` 는 의미 키(아래 사전의 enum).
 * 수치는 담지 않는다 — 시각·행 수는 **원문 토큰**만 쓴다(§3).
 */
export interface AiTableColumn {
  readonly header: string;
  readonly key: string;
}

/** AI 가 만든 **행** 1건 — `seq` 는 원문 `순`(정수), `values` 는 나머지 열의 원문 셀 값(또는 null = 빈칸/Χ) */
export interface AiTableRow {
  readonly seq: number | null;
  readonly values: Readonly<Record<string, string | null>>;
}

/** 페이지 1개(= 시간표 표 1개)의 AI 초안 (§2 — 열 매핑 + 행 배열) */
export interface AiTablePageDraft {
  readonly page: string;
  readonly columns: readonly AiTableColumn[];
  readonly rows: readonly AiTableRow[];
}

/** 검증 4종 식별자(§4) */
export type AiTableCheckId = 'cell-anchor' | 'time-set' | 'row-count' | 'schema';

/**
 * 실패의 **무게**(T34 결정 — docs/08 §2·§3·§4와 T19 ⑤ 선례를 합친 것):
 *  - `fatal` : 원문에 **없는** 값·시각·행을 만들었다(환각) → 검증 실패 + **발행 중단(exit 1 · 산출물 0건)**
 *  - `drop`  : 원문의 값을 **빠뜨렸거나** 스키마가 깨졌다(누락·형식) → **AI 초안 폐기** 후 규칙 정본으로 발행(사유 기록)
 */
export type AiTableCheckSeverity = 'fatal' | 'drop';

export interface AiTableCheck {
  readonly id: AiTableCheckId;
  readonly ok: boolean;
  readonly severity: AiTableCheckSeverity;
  /** 사람이 읽는 판정 근거(위반 값 목록 포함) */
  readonly detail: string;
}

export interface AiTableValidation {
  readonly ok: boolean;
  readonly fatal: boolean;
  readonly checks: readonly AiTableCheck[];
  /** 실패한 검사만 모은 사유(로그·리포트용) */
  readonly failures: readonly string[];
}

/** 드리프트 게이트 결과(§7 — T35 가 채운다. T34 는 `checked: false` 로 자리만 만든다) */
export interface AiExtractDrift {
  readonly checked: boolean;
  readonly blocked: boolean;
  readonly reasons: readonly string[];
}

/** 발행 JSON `source.extraction.aiExtract` (§8 — 키 이름 고정) */
export interface AiExtractMeta {
  /** AI 에게 실제로 보낸(호출한) 페이지 수 — 호출 상한 12 이내 */
  readonly pagesSent: number;
  /** 내용 해시가 같아 **호출하지 않고** 캐시를 재사용한 페이지 수 */
  readonly pagesSkippedByHash: number;
  /** 실제 HTTP 호출 수(재시도 포함) */
  readonly calls: number;
  /** 토큰 **추정치**(§6 비용 가드) */
  readonly totalTokens: number;
  /** 규칙 결과와 행 단위로 일치한 수(T34 는 **단순 카운트**, 정식 비교는 T35 §5) */
  readonly agreedRows: number;
  readonly disagreedRows: number;
  /** Stage B 로 AI 초안을 **채택한** 페이지(§5 — T34 는 항상 빈 배열, 채택은 T35/사용자 승인) */
  readonly adoptedPages: readonly string[];
  readonly drift: AiExtractDrift;
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
  /** 노선 폐지·중단 원문 서술(`status: "suspended"` 와 짝) — 없으면 빈 배열 */
  readonly routeNotes: readonly RouteNote[];
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
  /** 산출물 스키마 버전(추출기가 발행한 계약 버전) */
  readonly schemaVersion: number;
  /** 기간 수집용 스냅샷(노선 표가 아닌 페이지) 파일 목록 — v3 */
  readonly termSources: readonly string[];
  readonly model: string | null;
  /** AI 를 실제로 어디서 받았는가(`api`|`ollama`|`rule-only`) — NFR-A4 */
  readonly provider: AiProvider;
  readonly promptTemplateSha256: string;
  readonly promptChars: number;
  readonly aiStatus: AiStatus;
  readonly aiError: string | null;
  /** 실제 나간 AI 호출 수(재시도 포함) */
  readonly calls: number;
  /** 입력 상한 초과로 잘라낸 후보 문장 수 */
  readonly truncated: number;
  /** 토큰 **추정치**(정확한 과금값 아님) */
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** 규칙 전용으로 내려간 사유(정상 AI 사용이면 null · `--ai=off` 는 null) */
  readonly fallbackReason: string | null;
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
  /** §8 AI 표 추출 기록(T34) — AI 를 안 쓴 실행도 0 값으로 존재한다 */
  readonly aiExtract: AiExtractMeta;
}

/**
 * v3 본문 — 추출 메타(`source.extraction`)를 붙이기 **전** 상태.
 * (검증 → 메타 부착 순서를 타입으로 강제한다: 메타의 `needsReview`·`reviewReasons` 는 검증 결과에서 나온다.)
 */
export interface EnrichedTimetableBody extends Omit<Timetable, 'schemaVersion' | 'routes' | 'source'> {
  readonly schemaVersion: 3;
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
  /** v3: 편별 조건(원문 note 해석 결과) — 노선별 */
  readonly tripConditions: readonly { readonly routeId: string; readonly entries: readonly TripConditionEntry[] }[];
  /** v3 개정: 노선 폐지·중단 원문 서술(노선별) — `dateRules` 가 아니라 여기로만 표현한다 */
  readonly routeNotes: readonly { readonly routeId: string; readonly notes: readonly RouteNote[] }[];
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
