/**
 * AI 표 추출 **실행기**(T34 · docs/08 §4·§6·§8) — 페이지별 호출·검증·집계.
 *
 *  - **비용 가드(§6)**: ① 페이지 내용 해시 캐시(내용이 같으면 **호출 0회** — 캐시 재사용)
 *    ② 바뀐 페이지만 호출 ③ **실행당 호출 상한 12회**(초과분은 규칙 전용 + 로그).
 *  - **검증 4종(§4)**: `aiTableValidate.ts` — 통과한 초안만 초안 산출물·캐시에 들어간다.
 *    실패 무게: 환각(초과·조작·원문에 없는 값) = `fatal`(발행 중단), 누락·형식 = `drop`(초안 폐기·규칙 정본 발행).
 *  - **기록(§8)**: `AiExtractMeta`(`source.extraction.aiExtract`)를 만든다. `agreedRows/disagreedRows` 는
 *    규칙 결과와의 **단순 카운트**다(정식 교차검증 게이트 §5 = T35).
 *  - **구조화 산출물**: 초안 JSON + 검증 리포트(T35 가 그대로 비교 입력으로 쓴다).
 *
 * 순수 함수다 — 파일 IO·HTTP·시계는 전부 주입된다(`createTableExtractor`·`nowIso`·`nowMs`).
 */

import type { DayType, TripRow } from '../scraper/types.js';
import { normalizeCell, type TableRegion } from './tableRegion.js';
import { validateTableDraft } from './aiTableValidate.js';
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
    disagreedRows: 0,
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
  /** 같은 페이지의 규칙(v1) 행 — 단순 일치 카운트용 */
  readonly ruleRows: readonly TripRow[];
}

/** 페이지 1건의 처리 결과(리포트 단위) */
export interface AiTablePageOutcome {
  readonly page: string;
  readonly routeId: string;
  readonly dayType: DayType;
  readonly contentHash: string;
  /** ok=검증 통과 · cached=해시 캐시 재사용 · dropped=초안 폐기 · skipped=호출 상한/표 없음 · unavailable=AI 불가 */
  readonly status: 'ok' | 'cached' | 'dropped' | 'skipped' | 'unavailable';
  readonly reason: string | null;
  readonly checks: readonly AiTableCheck[];
  readonly draft: AiTablePageDraft | null;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly agreedRows: number;
  readonly disagreedRows: number;
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
  readonly agreedRows: number;
  readonly disagreedRows: number;
  readonly pages: readonly {
    readonly page: string;
    readonly routeId: string;
    readonly dayType: DayType;
    readonly status: string;
    readonly reason: string | null;
    readonly contentHash: string;
    readonly calls: number;
    readonly agreedRows: number;
    readonly disagreedRows: number;
    readonly checks: readonly { readonly id: string; readonly ok: boolean; readonly severity: string; readonly detail: string }[];
  }[];
  readonly dropped: readonly string[];
  readonly capped: readonly string[];
  readonly noTable: readonly string[];
  readonly fatal: readonly string[];
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
  /** §8 `source.extraction.aiExtract` */
  readonly meta: AiExtractMeta;
  /** 환각(치명) 실패 — 호출측이 발행을 중단한다 */
  readonly fatalIssues: readonly ValidationIssue[];
  readonly cache: TableCache;
  readonly draftArtifact: AiTableDraftArtifact;
  readonly reportArtifact: AiTableReportArtifact;
  readonly capped: readonly string[];
  readonly dropped: readonly string[];
  readonly durationMs: number;
}

// ─────────────────────────── 행 단위 단순 일치(T34) ───────────────────────────

const CLOCK = /^(\d{1,2}):(\d{2})$/;

function comparable(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = normalizeCell(String(value));
  const clock = CLOCK.exec(text);
  if (clock === null) return text;
  return `${(clock[1] ?? '0').padStart(2, '0')}:${clock[2]}`;
}

/**
 * AI 초안 행 ↔ 규칙 행의 **단순 일치 수**(§5 정식 교차검증은 T35).
 * AI 가 실제로 돌려준 열만 비교한다(매핑하지 않은 열은 불일치로 세지 않는다 — 그건 시각/행 수 검증이 잡는다).
 */
export function countAgreementRows(
  draft: AiTablePageDraft,
  ruleRows: readonly TripRow[],
): { readonly agreed: number; readonly disagreed: number } {
  const total = Math.max(draft.rows.length, ruleRows.length);
  let agreed = 0;
  let disagreed = 0;
  for (let index = 0; index < total; index += 1) {
    const aiRow = draft.rows[index];
    const ruleRow = ruleRows[index];
    if (aiRow === undefined || ruleRow === undefined) {
      disagreed += 1;
      continue;
    }
    let same = comparable(aiRow.seq) === comparable(ruleRow['seq'] ?? null);
    for (const [key, value] of Object.entries(aiRow.values)) {
      if (!(key in ruleRow)) continue;
      if (comparable(value) !== comparable(ruleRow[key] ?? null)) same = false;
    }
    if (same) agreed += 1;
    else disagreed += 1;
  }
  return { agreed, disagreed };
}

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
  const capped: string[] = [];
  const dropped: string[] = [];
  let pagesSent = 0;
  let pagesSkippedByHash = 0;
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let agreedRows = 0;
  let disagreedRows = 0;
  let unavailablePages = 0;

  for (const job of input.jobs) {
    const { page, routeId, dayType } = job.request;
    const entry = input.cache.entries[page];
    const base = { page, routeId, dayType, contentHash: job.region.contentHash };

    // ① 내용 해시 캐시 — 같으면 호출하지 않는다(§6)
    if (cacheHit(entry, job, input.extractor)) {
      const draft = entry?.draft ?? null;
      const validation = draft === null ? null : validateTableDraft(draft, { region: job.region, pageText: job.request.pageText });
      const agreement = draft === null ? { agreed: 0, disagreed: 0 } : countAgreementRows(draft, job.ruleRows);
      pagesSkippedByHash += 1;
      agreedRows += agreement.agreed;
      disagreedRows += agreement.disagreed;
      if (draft === null || validation === null || !validation.ok) {
        // 캐시된 초안이 지금 검증을 못 넘으면(검증 규칙 변경 등) 캐시에서 버린다
        delete entries[page];
        dropped.push(page);
        input.log(`[extract] ⚠️ 캐시된 AI 초안 폐기(${page}) — 재검증 실패: ${validation?.failures.join(' · ') ?? '초안 없음'}`);
        pages.push({ ...base, status: 'dropped', reason: '캐시 초안 재검증 실패', checks: validation?.checks ?? [], draft: null, calls: 0, promptTokens: 0, completionTokens: 0, agreedRows: 0, disagreedRows: 0 });
        continue;
      }
      input.log(`[extract] AI 표 캐시 적중(${page}) — 호출 0회(내용 해시 동일, §6)`);
      pages.push({ ...base, status: 'cached', reason: null, checks: validation.checks, draft, calls: 0, promptTokens: 0, completionTokens: 0, agreedRows: agreement.agreed, disagreedRows: agreement.disagreed });
      continue;
    }

    // ② 호출 상한(§6) — 초과분은 규칙 전용 + 로그
    if (pagesSent >= input.cap) {
      capped.push(page);
      input.log(`[extract] ⚠️ AI 표 호출 상한(${String(input.cap)}회) 초과 — ${page} 는 규칙 전용으로 진행한다(§6)`);
      pages.push({ ...base, status: 'skipped', reason: `호출 상한 ${String(input.cap)}회 초과`, checks: [], draft: null, calls: 0, promptTokens: 0, completionTokens: 0, agreedRows: 0, disagreedRows: 0 });
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
      pages.push({ ...base, status: 'unavailable', reason, checks: [], draft: null, ...usage, agreedRows: 0, disagreedRows: 0 });
      continue;
    }

    // ④ 검증 4종
    const validation = validateTableDraft(result.draft, { region: job.region, pageText: job.request.pageText });
    const agreement = countAgreementRows(result.draft, job.ruleRows);
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
      pages.push({ ...base, status: 'dropped', reason: validation.failures.join(' · '), checks: validation.checks, draft: null, ...usage, agreedRows: 0, disagreedRows: 0 });
      continue;
    }

    input.log(
      `[extract] AI 표 검증 통과(${page}) — 열 ${String(result.draft.columns.length)}개 · 행 ${String(result.draft.rows.length)}개 · 규칙과 일치 ${String(agreement.agreed)}/${String(agreement.agreed + agreement.disagreed)}행`,
    );
    entries[page] = {
      page,
      contentHash: job.region.contentHash,
      model: input.extractor.model,
      promptTemplateSha256: input.extractor.promptTemplateSha256,
      draft: result.draft,
      storedAt: input.nowIso(),
    };
    agreedRows += agreement.agreed;
    disagreedRows += agreement.disagreed;
    pages.push({ ...base, status: 'ok', reason: null, checks: validation.checks, draft: result.draft, ...usage, agreedRows: agreement.agreed, disagreedRows: agreement.disagreed });
  }

  for (const page of input.noTablePages) {
    input.log(`[extract] AI 표 대상 아님(${page}) — 시간표 표가 없는 페이지(운행 중단 등)`);
  }

  const totalTokens = promptTokens + completionTokens;
  const meta: AiExtractMeta = {
    pagesSent,
    pagesSkippedByHash,
    calls,
    totalTokens,
    agreedRows,
    disagreedRows,
    // Stage B 채택은 T35(§5) — T34 는 절대 채택하지 않는다
    adoptedPages: [],
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
    agreedRows,
    disagreedRows,
    pages: pages.map((page) => ({
      page: page.page,
      routeId: page.routeId,
      dayType: page.dayType,
      status: page.status,
      reason: page.reason,
      contentHash: page.contentHash,
      calls: page.calls,
      agreedRows: page.agreedRows,
      disagreedRows: page.disagreedRows,
      checks: page.checks.map((entry) => ({ id: entry.id, ok: entry.ok, severity: entry.severity, detail: entry.detail })),
    })),
    dropped,
    capped,
    noTable: [...input.noTablePages],
    fatal: fatalIssues.map((issue) => `${issue.where}: ${issue.message}`),
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
    cache: { version: TABLE_CACHE_VERSION, entries },
    draftArtifact,
    reportArtifact,
    capped,
    dropped,
    durationMs: Math.round(input.nowMs() - started),
  };
}
