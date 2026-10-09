/**
 * AI 표 추출 **실행기**(T34 · docs/08 §4·§6·§8 / **T35 §5 교차검증·Stage B·§8 개정**).
 *
 *  - **비용 가드(§6)**: ① 페이지 내용 해시 캐시(내용이 같으면 **호출 0회** — 캐시 재사용)
 *    ② 바뀐 페이지만 호출 ③ **실행당 호출 상한 12회**(초과분은 규칙 전용 + 로그).
 *  - **검증 4종(§4)**: `aiTableValidate.ts` — 통과한 초안만 초안 산출물·캐시에 들어간다.
 *    실패 무게: 환각(초과·조작·원문에 없는 값) = `fatal`(발행 중단), 누락·형식 = `drop`(초안 폐기·규칙 정본 발행).
 *  - **교차검증(§5 · T35)**: 규칙 정본 vs AI 초안을 **정규화 후 행 단위**로 비교한다(`aiCrossCheck.ts`).
 *    ① 값 모순 = **차단**(발행 보류) · ② key-shift · ③ null-vs-값 = **경고**(발행 진행).
 *  - **Stage B(§5 · T35)**: 규칙이 그 페이지에서 **행을 0건** 만든 경우에만 AI 초안을 채택 후보로 삼는다
 *    (검증 4종 통과 + ①·② 0건 + 계약 열 집합 일치). 채택분은 `extractedBy: "ai"`·`needsReview: true`.
 *  - **기록(§8)**: `AiExtractMeta`(`source.extraction.aiExtract`) — 정규화 후/전 카운트를 모두 남긴다.
 *  - **드리프트(§7)** 는 발행 직전 단계다 — 호출측(`cli.ts` + `driftGate.ts`)이 채운다.
 *
 * 순수 함수다 — 파일 IO·HTTP·시계는 전부 주입된다(`createTableExtractor`·`nowIso`·`nowMs`).
 */

import type { DayType, TripRow } from '../scraper/types.js';
import type { TableRegion } from './tableRegion.js';
import { validateTableDraft } from './aiTableValidate.js';
import { adoptable, crossCheckPage, sumCrossCheck, type CrossCheckResult } from './aiCrossCheck.js';
import { canAdopt, type AdoptedPage } from './aiAdopt.js';
import type { AiTableExtractor, AiTablePageRequest } from './aiTable.js';
import type {
  AiExtractMeta,
  AiProvider,
  AiTableCheck,
  AiTableColumn,
  AiTablePageDraft,
  AiTableRow,
  ValidationIssue,
} from './types.js';

/** §6 실행당 호출 상한 — 초과분은 규칙 전용 + 로그 */
export const MAX_AI_TABLE_CALLS = 12;
/** 페이지 내용 해시 캐시 파일 형식 버전 */
export const TABLE_CACHE_VERSION = 1;

// ─────────────────────────── 해시 캐시(§6) ───────────────────────────

export interface TableCacheEntry {
  readonly page: string;
  /** AI 입력(표 영역 텍스트)의 내용 해시 — 같으면 호출하지 않는다 */
  readonly contentHash: string;
  readonly model: string;
  readonly promptTemplateSha256: string;
  readonly draft: AiTablePageDraft;
  readonly storedAt: string;
}

export interface TableCache {
  readonly version: number;
  readonly entries: Readonly<Record<string, TableCacheEntry>>;
}

export function emptyTableCache(): TableCache {
  return { version: TABLE_CACHE_VERSION, entries: {} };
}

/** AI 표 단계를 돌리지 않은 실행의 §8 기록값(소비자가 필드 존재를 가정할 수 있게 0 값으로 채운다) */
export function emptyAiExtractMeta(): AiExtractMeta {
  return {
    pagesSent: 0,
    pagesSkippedByHash: 0,
    calls: 0,
    totalTokens: 0,
    agreedRows: 0,
    rawAgreedRows: 0,
    disagreedRows: 0,
    rawDisagreedRows: 0,
    keyShiftRows: 0,
    nullMismatchRows: 0,
    contradictedRows: 0,
    rowSetMismatchRows: 0,
    adoptedPages: [],
    drift: { checked: false, blocked: false, reasons: [] },
  };
}

/** 캐시 파일 파싱 — 못 읽으면 빈 캐시 + `invalid`(조용히 넘어가지 않는다: 호출측이 경고를 남긴다). */
export function parseTableCache(raw: string | null): { readonly cache: TableCache; readonly invalid: boolean } {
  if (raw === null || raw.trim() === '') return { cache: emptyTableCache(), invalid: false };
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { cache: emptyTableCache(), invalid: true };
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { cache: emptyTableCache(), invalid: true };
  const entriesRaw = (payload as { entries?: unknown }).entries;
  if (entriesRaw === null || typeof entriesRaw !== 'object' || Array.isArray(entriesRaw)) {
    return { cache: emptyTableCache(), invalid: true };
  }
  const entries: Record<string, TableCacheEntry> = {};
  for (const [page, value] of Object.entries(entriesRaw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const contentHash = record['contentHash'];
    const model = record['model'];
    const promptTemplateSha256 = record['promptTemplateSha256'];
    const draft = record['draft'];
    if (typeof contentHash !== 'string' || typeof model !== 'string' || typeof promptTemplateSha256 !== 'string') continue;
    if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) continue;
    const draftRecord = draft as Record<string, unknown>;
    if (!Array.isArray(draftRecord['columns']) || !Array.isArray(draftRecord['rows'])) continue;
    entries[page] = {
      page,
      contentHash,
      model,
      promptTemplateSha256,
      draft: draft as unknown as AiTablePageDraft,
      storedAt: typeof record['storedAt'] === 'string' ? record['storedAt'] : '',
    };
  }
  return { cache: { version: TABLE_CACHE_VERSION, entries }, invalid: false };
}

export function serializeTableCache(cache: TableCache): string {
  const pages = Object.keys(cache.entries).sort();
  const entries: Record<string, TableCacheEntry> = {};
  for (const page of pages) {
    const entry = cache.entries[page];
    if (entry !== undefined) entries[page] = entry;
  }
  return `${JSON.stringify({ version: TABLE_CACHE_VERSION, entries }, null, 2)}\n`;
}

// ─────────────────────────── 실행 입력·결과 ───────────────────────────

export interface AiTablePageJob {
  readonly request: AiTablePageRequest;
  readonly region: TableRegion;
  /** 같은 페이지의 규칙(v1) 행 — 교차검증 기준. **0건이면 Stage B 채택 후보** */
  readonly ruleRows: readonly TripRow[];
}

/** 페이지 1건의 처리 결과(리포트 단위) */
export interface AiTablePageOutcome {
  readonly page: string;
  readonly routeId: string;
  readonly dayType: DayType;
  readonly contentHash: string;
  /**
   * ok=검증 통과 · cached=해시 캐시 재사용 · **adopted=Stage B 로 AI 초안 채택** ·
   * dropped=초안 폐기 · skipped=호출 상한/표 없음 · unavailable=AI 불가 · **blocked=① 값 모순(발행 보류)**
   */
  readonly status: 'ok' | 'cached' | 'adopted' | 'dropped' | 'skipped' | 'unavailable' | 'blocked';
  readonly reason: string | null;
  readonly checks: readonly AiTableCheck[];
  readonly draft: AiTablePageDraft | null;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** 교차검증(정규화 후) — 초안이 없으면 null */
  readonly crossCheck: CrossCheckResult | null;
}

export interface AiTableDraftArtifact {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly provider: AiProvider;
  readonly model: string;
  readonly promptTemplateSha256: string;
  readonly pages: readonly {
    readonly page: string;
    readonly routeId: string;
    readonly dayType: DayType;
    readonly contentHash: string;
    readonly status: string;
    readonly columns: readonly AiTableColumn[];
    readonly rows: readonly AiTableRow[];
  }[];
}

export interface AiTableReportArtifact {
  readonly generatedAt: string;
  readonly cap: number;
  readonly pagesSent: number;
  readonly pagesSkippedByHash: number;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** §5 교차검증 합계(정규화 후) */
  readonly agreedRows: number;
  readonly keyShiftRows: number;
  readonly nullMismatchRows: number;
  readonly contradictedRows: number;
  readonly rowSetMismatchRows: number;
  /** 정규화 전(T34 정의) — 추세 비교용 */
  readonly rawAgreedRows: number;
  readonly rawDisagreedRows: number;
  readonly pages: readonly {
    readonly page: string;
    readonly routeId: string;
    readonly dayType: DayType;
    readonly status: string;
    readonly reason: string | null;
    readonly contentHash: string;
    readonly calls: number;
    readonly rows: number;
    readonly agreedRows: number;
    readonly keyShiftRows: number;
    readonly nullMismatchRows: number;
    readonly contradictedRows: number;
    readonly rowSetMismatchRows: number;
    readonly rawAgreedRows: number;
    readonly rawDisagreedRows: number;
    readonly columnKeys: readonly string[];
    /** 경고·차단 사유(사람이 읽는 형태, 최대 6건) */
    readonly details: readonly string[];
    readonly checks: readonly { readonly id: string; readonly ok: boolean; readonly severity: string; readonly detail: string }[];
  }[];
  /** Stage B 채택 페이지 */
  readonly adopted: readonly { readonly page: string; readonly routeId: string; readonly dayType: DayType; readonly rows: number; readonly reason: string }[];
  readonly dropped: readonly string[];
  readonly capped: readonly string[];
  readonly noTable: readonly string[];
  readonly fatal: readonly string[];
  readonly blocked: readonly { readonly page: string; readonly reason: string }[];
}

export interface AiTableRunInput {
  readonly jobs: readonly AiTablePageJob[];
  /** 표 영역을 찾지 못한(운행 중단 등) 페이지 — 호출하지 않는다 */
  readonly noTablePages: readonly string[];
  readonly extractor: AiTableExtractor;
  readonly provider: AiProvider;
  readonly cache: TableCache;
  readonly cap: number;
  readonly log: (line: string) => void;
  readonly nowIso: () => string;
  readonly nowMs: () => number;
}

export interface AiTableRunOutcome {
  readonly status: 'ok' | 'unavailable' | 'disabled';
  readonly model: string;
  readonly provider: AiProvider;
  readonly promptTemplateSha256: string;
  readonly pages: readonly AiTablePageOutcome[];
  /** §8 `source.extraction.aiExtract` (drift 는 발행 직전에 호출측이 채운다) */
  readonly meta: AiExtractMeta;
  /** 환각(치명) 실패 — 호출측이 발행을 중단한다 */
  readonly fatalIssues: readonly ValidationIssue[];
  /** ① 값 모순 또는 행 집합 불일치 — 호출측이 **발행을 보류**한다(§5) */
  readonly blockedPages: readonly { readonly page: string; readonly reason: string }[];
  /** Stage B 로 채택한 페이지(발행 타임테이블에 반영할 대상) */
  readonly adopted: readonly AdoptedPage[];
  readonly cache: TableCache;
  readonly draftArtifact: AiTableDraftArtifact;
  readonly reportArtifact: AiTableReportArtifact;
  readonly capped: readonly string[];
  readonly dropped: readonly string[];
  readonly durationMs: number;
}

/** @deprecated T34 이름 — 정규화 전 단순 일치 카운트(`aiCrossCheck.rawAgreementRows` 와 같은 정의) */
export { rawAgreementRows as countAgreementRows } from './aiCrossCheck.js';

// ─────────────────────────── 실행 ───────────────────────────

function cacheHit(entry: TableCacheEntry | undefined, job: AiTablePageJob, extractor: AiTableExtractor): boolean {
  if (entry === undefined) return false;
  return (
    entry.contentHash === job.region.contentHash &&
    entry.model === extractor.model &&
    entry.promptTemplateSha256 === extractor.promptTemplateSha256
  );
}

export async function runAiTable(input: AiTableRunInput): Promise<AiTableRunOutcome> {
  const started = input.nowMs();
  const pages: AiTablePageOutcome[] = [];
  const entries: Record<string, TableCacheEntry> = { ...input.cache.entries };
  const fatalIssues: ValidationIssue[] = [];
  const blockedPages: { page: string; reason: string }[] = [];
  const adoptedPagesList: AdoptedPage[] = [];
  const capped: string[] = [];
  const dropped: string[] = [];
  const crossChecks: CrossCheckResult[] = [];
  let pagesSent = 0;
  let pagesSkippedByHash = 0;
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let unavailablePages = 0;

  /** 검증·교차검증 결과를 넘겨받아 페이지 결과를 확정한다(호출·캐시 경로 공통). */
  const finishPage = (
    job: AiTablePageJob,
    draft: AiTablePageDraft,
    validation: ReturnType<typeof validateTableDraft>,
    status: 'ok' | 'cached',
    usage: { calls: number; promptTokens: number; completionTokens: number },
  ): AiTablePageOutcome => {
    const { page, routeId, dayType } = job.request;
    const crossCheck = crossCheckPage({ page, routeId, dayType, draft, ruleRows: job.ruleRows });
    crossChecks.push(crossCheck);

    for (const detail of crossCheck.details.slice(0, 6)) {
      const tag = crossCheck.contradictedRows > 0 ? '⛔' : '⚠️';
      input.log(`[extract] ${tag} 교차검증(${page}) ${crossCheck.contradictedRows > 0 ? '차단' : '경고'} — ${detail}`);
    }

    // Stage B — 규칙이 그 페이지에서 행을 0건 만들었다: 채택 조건을 만족할 때만 AI 를 실제로 쓴다.
    if (job.ruleRows.length === 0) {
      const gate = canAdopt(draft, routeId, dayType);
      if (adoptable(crossCheck) && gate.ok) {
        entries[page] = {
          page,
          contentHash: job.region.contentHash,
          model: input.extractor.model,
          promptTemplateSha256: input.extractor.promptTemplateSha256,
          draft,
          storedAt: input.nowIso(),
        };
        const adopted: AdoptedPage = {
          page,
          routeId,
          dayType,
          rows: draft.rows.length,
          extractedBy: 'ai',
          needsReview: true,
          reason: `${gate.reason} · 검증 4종 통과 · ①0 ②0 ③${String(crossCheck.nullMismatchRows)}`,
        };
        adoptedPagesList.push(adopted);
        input.log(
          `[extract] ✅ Stage B 채택(${page}) — 규칙 0건 · AI ${String(draft.rows.length)}행 채택(extractedBy="ai"·needsReview=true, docs/08 §5)`,
        );
        return { page, routeId, dayType, contentHash: job.region.contentHash, status: 'adopted', reason: adopted.reason, checks: validation.checks, draft, ...usage, crossCheck };
      }
      const reason = `규칙 0건 · 채택 조건 미충족: ${gate.ok ? `①${String(crossCheck.contradictedRows)} ②${String(crossCheck.keyShiftRows)} ③${String(crossCheck.nullMismatchRows)}` : gate.reason}`;
      dropped.push(page);
      input.log(`[extract] ⛔ Stage B 채택 불가(${page}) — ${reason} → 규칙 정본 발행 불가(보류)`);
      return { page, routeId, dayType, contentHash: job.region.contentHash, status: 'dropped', reason, checks: validation.checks, draft: null, ...usage, crossCheck };
    }

    // ① 값 모순 · 행 집합 불일치 → 발행 보류(§5) · ②③ 은 경고 후 진행
    if (crossCheck.blocked) {
      const reason = `AI ① 값 모순 ${String(crossCheck.contradictedRows)}건 · 행 집합 불일치 ${String(crossCheck.rowSetMismatchRows)}건 — ${crossCheck.details.slice(0, 3).join(' · ')}`;
      blockedPages.push({ page, reason });
      input.log(`[extract] ⛔ 교차검증 차단(${page}) — ${reason}`);
      return { page, routeId, dayType, contentHash: job.region.contentHash, status: 'blocked', reason, checks: validation.checks, draft: null, ...usage, crossCheck };
    }
    if (crossCheck.keyShiftRows > 0 || crossCheck.nullMismatchRows > 0) {
      input.log(
        `[extract] ⚠️ 교차검증 경고(${page}) — ② key-shift ${String(crossCheck.keyShiftRows)}행 · ③ null-vs-값 ${String(crossCheck.nullMismatchRows)}행 → 규칙 정본 발행 진행(docs/08 §5)`,
      );
    }
    return {
      page,
      routeId,
      dayType,
      contentHash: job.region.contentHash,
      status,
      reason: null,
      checks: validation.checks,
      draft,
      ...usage,
      crossCheck,
    };
  };

  for (const job of input.jobs) {
    const { page, routeId, dayType } = job.request;
    const entry = input.cache.entries[page];
    const base = { page, routeId, dayType, contentHash: job.region.contentHash };

    // ① 내용 해시 캐시 — 같으면 호출하지 않는다(§6)
    if (cacheHit(entry, job, input.extractor)) {
      const draft = entry?.draft ?? null;
      const validation = draft === null ? null : validateTableDraft(draft, { region: job.region, pageText: job.request.pageText });
      pagesSkippedByHash += 1;
      if (draft === null || validation === null || !validation.ok) {
        // 캐시된 초안이 지금 검증을 못 넘으면(검증 규칙 변경 등) 캐시에서 버린다
        delete entries[page];
        dropped.push(page);
        input.log(`[extract] ⚠️ 캐시된 AI 초안 폐기(${page}) — 재검증 실패: ${validation?.failures.join(' · ') ?? '초안 없음'}`);
        pages.push({ ...base, status: 'dropped', reason: '캐시 초안 재검증 실패', checks: validation?.checks ?? [], draft: null, calls: 0, promptTokens: 0, completionTokens: 0, crossCheck: null });
        continue;
      }
      input.log(`[extract] AI 표 캐시 적중(${page}) — 호출 0회(내용 해시 동일, §6)`);
      pages.push(finishPage(job, draft, validation, 'cached', { calls: 0, promptTokens: 0, completionTokens: 0 }));
      continue;
    }

    // ② 호출 상한(§6) — 초과분은 규칙 전용 + 로그
    if (pagesSent >= input.cap) {
      capped.push(page);
      input.log(`[extract] ⚠️ AI 표 호출 상한(${String(input.cap)}회) 초과 — ${page} 는 규칙 전용으로 진행한다(§6)`);
      pages.push({ ...base, status: 'skipped', reason: `호출 상한 ${String(input.cap)}회 초과`, checks: [], draft: null, calls: 0, promptTokens: 0, completionTokens: 0, crossCheck: null });
      continue;
    }

    // ③ 호출 1건
    pagesSent += 1;
    const result = await input.extractor.extractPage(job.request);
    calls += result.usage.calls;
    promptTokens += result.usage.promptTokens;
    completionTokens += result.usage.completionTokens;
    const usage = {
      calls: result.usage.calls,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    };

    if (result.status !== 'ok' || result.draft === null) {
      unavailablePages += 1;
      const reason = result.error ?? 'AI 응답을 표 초안으로 해석하지 못했다';
      input.log(`[extract] ⚠️ AI 표 초안 없음(${page}) — 규칙 정본으로 진행한다: ${reason}`);
      pages.push({ ...base, status: 'unavailable', reason, checks: [], draft: null, ...usage, crossCheck: null });
      continue;
    }

    // ④ 검증 4종
    const validation = validateTableDraft(result.draft, { region: job.region, pageText: job.request.pageText });
    if (!validation.ok) {
      dropped.push(page);
      for (const failure of validation.failures) {
        input.log(`[extract] ${validation.fatal ? '⛔' : '⚠️'} AI 표 검증 실패(${page}) — ${failure}`);
      }
      if (validation.fatal) {
        fatalIssues.push({
          where: `aiTable:${page}`,
          message: `AI 가 원문에 없는 값·시각·행을 만들었다 — ${validation.failures.join(' · ')}`,
          fatal: true,
        });
      }
      pages.push({ ...base, status: 'dropped', reason: validation.failures.join(' · '), checks: validation.checks, draft: null, ...usage, crossCheck: null });
      continue;
    }

    input.log(
      `[extract] AI 표 검증 통과(${page}) — 열 ${String(result.draft.columns.length)}개 · 행 ${String(result.draft.rows.length)}개`,
    );
    const outcome = finishPage(job, result.draft, validation, 'ok', usage);
    // 초안이 실제로 쓰이는 경우(ok·adopted)만 캐시에 남긴다 — 차단분은 캐시하지 않는다(다음 실행에서 재판정)
    if (outcome.status === 'ok') {
      entries[page] = {
        page,
        contentHash: job.region.contentHash,
        model: input.extractor.model,
        promptTemplateSha256: input.extractor.promptTemplateSha256,
        draft: result.draft,
        storedAt: input.nowIso(),
      };
    } else if (outcome.status === 'blocked' || outcome.status === 'dropped') {
      delete entries[page];
    }
    pages.push(outcome);
  }

  for (const page of input.noTablePages) {
    input.log(`[extract] AI 표 대상 아님(${page}) — 시간표 표가 없는 페이지(운행 중단 등)`);
  }

  const totals = sumCrossCheck(crossChecks);
  const totalTokens = promptTokens + completionTokens;
  const meta: AiExtractMeta = {
    pagesSent,
    pagesSkippedByHash,
    calls,
    totalTokens,
    agreedRows: totals.agreedRows,
    rawAgreedRows: totals.rawAgreedRows,
    disagreedRows: totals.rawDisagreedRows,
    rawDisagreedRows: totals.rawDisagreedRows,
    keyShiftRows: totals.keyShiftRows,
    nullMismatchRows: totals.nullMismatchRows,
    contradictedRows: totals.contradictedRows,
    rowSetMismatchRows: totals.rowSetMismatchRows,
    adoptedPages: adoptedPagesList.map((page) => page.page).sort(),
    // §7 드리프트는 발행 직전(cli)에서 채운다 — 여기서는 자리만 만든다
    drift: { checked: false, blocked: false, reasons: [] },
  };

  const generatedAt = input.nowIso();
  const draftArtifact: AiTableDraftArtifact = {
    generatedAt,
    schemaVersion: 1,
    provider: input.provider,
    model: input.extractor.model,
    promptTemplateSha256: input.extractor.promptTemplateSha256,
    pages: pages
      .filter((page) => page.draft !== null)
      .map((page) => ({
        page: page.page,
        routeId: page.routeId,
        dayType: page.dayType,
        contentHash: page.contentHash,
        status: page.status,
        columns: page.draft?.columns ?? [],
        rows: page.draft?.rows ?? [],
      })),
  };
  const reportArtifact: AiTableReportArtifact = {
    generatedAt,
    cap: input.cap,
    pagesSent,
    pagesSkippedByHash,
    calls,
    promptTokens,
    completionTokens,
    totalTokens,
    agreedRows: totals.agreedRows,
    keyShiftRows: totals.keyShiftRows,
    nullMismatchRows: totals.nullMismatchRows,
    contradictedRows: totals.contradictedRows,
    rowSetMismatchRows: totals.rowSetMismatchRows,
    rawAgreedRows: totals.rawAgreedRows,
    rawDisagreedRows: totals.rawDisagreedRows,
    pages: pages.map((page) => ({
      page: page.page,
      routeId: page.routeId,
      dayType: page.dayType,
      status: page.status,
      reason: page.reason,
      contentHash: page.contentHash,
      calls: page.calls,
      rows: page.crossCheck?.comparedRows ?? 0,
      agreedRows: page.crossCheck?.agreedRows ?? 0,
      keyShiftRows: page.crossCheck?.keyShiftRows ?? 0,
      nullMismatchRows: page.crossCheck?.nullMismatchRows ?? 0,
      contradictedRows: page.crossCheck?.contradictedRows ?? 0,
      rowSetMismatchRows: page.crossCheck?.rowSetMismatchRows ?? 0,
      rawAgreedRows: page.crossCheck?.rawAgreedRows ?? 0,
      rawDisagreedRows: page.crossCheck?.rawDisagreedRows ?? 0,
      columnKeys: page.crossCheck?.aiColumnKeys ?? [],
      details: (page.crossCheck?.details ?? []).slice(0, 6),
      checks: page.checks.map((entry) => ({ id: entry.id, ok: entry.ok, severity: entry.severity, detail: entry.detail })),
    })),
    adopted: adoptedPagesList.map((page) => ({ page: page.page, routeId: page.routeId, dayType: page.dayType, rows: page.rows, reason: page.reason })),
    dropped,
    capped,
    noTable: [...input.noTablePages],
    fatal: fatalIssues.map((issue) => `${issue.where}: ${issue.message}`),
    blocked: blockedPages.map((page) => ({ page: page.page, reason: page.reason })),
  };

  const status: AiTableRunOutcome['status'] =
    input.jobs.length > 0 && unavailablePages === input.jobs.length ? 'unavailable' : 'ok';

  return {
    status,
    model: input.extractor.model,
    provider: input.provider,
    promptTemplateSha256: input.extractor.promptTemplateSha256,
    pages,
    meta,
    fatalIssues,
    blockedPages,
    adopted: adoptedPagesList,
    cache: { version: TABLE_CACHE_VERSION, entries },
    draftArtifact,
    reportArtifact,
    capped,
    dropped,
    durationMs: Math.round(input.nowMs() - started),
  };
}
