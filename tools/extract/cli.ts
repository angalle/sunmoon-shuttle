/**
 * `npm run extract` 오케스트레이션 — **순수 로직**(파일 IO·시계·AI 호출은 전부 주입).
 *
 * 파이프라인(부록 A):
 *   ① 스냅샷 읽기 → ② 규칙 파서로 뼈대(v1 기준선) → ③ AI 보강(로컬 Ollama, 선택)
 *   → ④ 병합·중복 제거 → ⑤ 검증(인용·스키마·baseline·needsReview) → ⑥ 발행(JSON) + 실행 로그
 *
 * 실패 정책: **인용·스키마 실패는 발행 중단(exit 1)** · 폴백(Ollama 무응답/모델 없음)은 경고 후 규칙 전용으로 발행.
 */

import { parseSnapshot } from '../scraper/parse.js';
import { assembleTimetable } from '../scraper/assemble.js';
import { validateTimetable } from '../scraper/validate.js';
import { findRoute, parseSnapshotFileName } from '../scraper/routeMeta.js';
import type { Snapshot, Timetable } from '../scraper/types.js';
import { harvestCandidates, toSources } from './candidates.js';
import { extractRuleStructures } from './rules.js';
import { pageText } from './text.js';
import { mergeAiDrafts } from './merge.js';
import { buildPrompt, createDisabledStructurer, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, promptTemplateSha256 } from './ai.js';
import type { AiStructurer, TermSource } from './types.js';
import { buildEnrichedTimetable, withExtractionMeta } from './enrich.js';
import { computeGapCoverage, countNeedsReview, hasFatal, validateEnriched } from './validate.js';
import { ExtractError } from './types.js';
import type {
  AiProvider,
  AiStatus,
  AiStructureResult,
  DateRule,
  EnrichedTimetable,
  ExtractionMeta,
  RuleStructures,
  SnapshotSource,
  ValidationIssue,
} from './types.js';

/** AI 보강 모드 — `--ai=<모드>` (기본 `api`). `off` 는 `--no-ai` 와 같다. */
export type AiMode = 'api' | 'ollama' | 'off';

export const AI_MODES: readonly AiMode[] = ['api', 'ollama', 'off'];

export function isAiMode(value: string): value is AiMode {
  return (AI_MODES as readonly string[]).includes(value);
}

export interface ExtractDeps {
  /** 디렉터리의 파일 목록(글롭 확장 없이 — 셸 없이도 동작하게) */
  listFiles(dir: string): string[];
  readTextFile(path: string): string;
  writeTextFile(path: string, text: string): void;
  nowIso(): string;
  nowMs(): number;
  log(line: string): void;
  error(line: string): void;
  createStructurer(options: {
    /** 빈 문자열 = 미지정(어댑터가 환경변수·기본값으로 해석한다) */
    readonly model: string;
    readonly noAi: boolean;
    /** `api` | `ollama` | `off` */
    readonly provider: AiMode;
    readonly baseUrl?: string | undefined;
    readonly timeoutMs?: number | undefined;
  }): AiStructurer;
}

export const DEFAULT_OUT = 'data/timetable.json';
export const DEFAULT_LOG = '.session-notes/T16-extract-run.json';
export const DEFAULT_RAW_DIR = 'data/raw';
/** 기간 수집용 스냅샷(노선 표가 아닌 페이지 — 예: 방학 시간표) 기본 위치 */
export const DEFAULT_TERM_DIR = 'data/raw/terms';
export const EXTRACTOR = 'tools/extract (schema v3)';

export interface ExtractArgs {
  readonly files: readonly string[];
  readonly out: string;
  readonly logPath: string;
  /** 기간 수집용 스냅샷 경로(`--term-page`, 반복 가능). 비어 있으면 `data/raw/terms/*.html` 를 쓴다 */
  readonly termPages: readonly string[];
  /** `--ai=off`/`--no-ai` 와 동일(호환용 — 기존 로그·테스트 필드) */
  readonly noAi: boolean;
  /** AI 보강 모드(기본 `api` — OpenAI 호환 외부 API) */
  readonly aiMode: AiMode;
  /** 빈 문자열 = 미지정(어댑터가 `AI_MODEL`/기본값으로 해석) */
  readonly model: string;
  readonly dryRun: boolean;
  readonly injectFabricated: boolean;
  readonly now: string | null;
}

export const USAGE = [
  '사용법: npm run extract [-- --ai=api|ollama|off] [--local] [data/raw/*.html] [--out data/timetable.json]',
  '          [--model=<이름>] [--dry-run] [--log .session-notes/T16-extract-run.json] [--term-page <html>]…',
  '',
  '  --ai=api              OpenAI 호환 외부 API 로 AI 보강한다(기본. AI_BASE_URL·AI_MODEL·AI_API_KEY)',
  '  --ai=ollama           로컬 Ollama 로 AI 보강한다(대안. 기본 모델 ' + DEFAULT_MODEL + ')',
  '  --ai=off              AI 없이 규칙만으로 발행한다(--no-ai 와 동일)',
  '  --no-ai               `--ai=off` 와 동일(호환 유지)',
  '  --local               로컬 스냅샷만 사용한다(원격 수집 없음 — robots.txt 차단, docs/01 §8)',
  '  --model=<이름>        모델명(비우면 ollama=기본 모델 · api=AI_MODEL env)',
  '  --term-page <경로>    기간 수집용 스냅샷(예: 방학 시간표 페이지). 반복 지정 가능. 생략하면 ' + DEFAULT_TERM_DIR + '/*.html',
  '  --dry-run             발행 없이 검증만(파일 쓰기 0, 로그는 남긴다)',
  '  --out <경로>          출력 JSON 경로(기본 data/timetable.json)',
  '  --log <경로>          실행 로그 경로(기본 .session-notes/T16-extract-run.json)',
  '  --now <ISO8601+09:00> 수집 시각 고정(결정성 확인용)',
  '  --inject-fabricated   [증거용] 원본에 없는 문장을 주입해 검증 FAIL(exit 1)을 재현한다',
  '',
  '  ※ 키 없음·401/403·타임아웃·5xx(재시도 1회)면 자동으로 규칙 전용으로 폴백한다(경고 기록 — 배치 유지).',
].join('\n');

const ISO_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseExtractArgs(argv: readonly string[]): ExtractArgs {
  const args: {
    files: string[];
    out: string;
    logPath: string;
    termPages: string[];
    noAi: boolean;
    aiMode: AiMode;
    model: string;
    dryRun: boolean;
    injectFabricated: boolean;
    now: string | null;
  } = {
    files: [],
    out: DEFAULT_OUT,
    logPath: DEFAULT_LOG,
    termPages: [],
    noAi: false,
    aiMode: 'api',
    model: '',
    dryRun: false,
    injectFabricated: false,
    now: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '--local' || token === '--no-ai' || token === '--dry-run' || token === '--inject-fabricated') {
      if (token === '--no-ai') {
        args.noAi = true;
        args.aiMode = 'off';
      }
      if (token === '--dry-run') args.dryRun = true;
      if (token === '--inject-fabricated') args.injectFabricated = true;
      continue;
    }
    if (token === '--ai' || token.startsWith('--ai=')) {
      const inline = token.startsWith('--ai=') ? token.slice('--ai='.length) : undefined;
      const value = inline ?? argv[i + 1];
      if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) {
        throw new ExtractError(`--ai 뒤에 모드가 필요합니다(${AI_MODES.join('|')})`);
      }
      if (!isAiMode(value)) throw new ExtractError(`--ai 값이 ${AI_MODES.join('|')} 가 아닙니다 — "${value}"`);
      args.aiMode = value;
      args.noAi = value === 'off';
      if (inline === undefined) i += 1;
      continue;
    }
    if (token === '--model' || token.startsWith('--model=')) {
      const inline = token.startsWith('--model=') ? token.slice('--model='.length) : undefined;
      const value = inline ?? argv[i + 1];
      if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) {
        throw new ExtractError('--model 뒤에 모델명이 필요합니다');
      }
      args.model = value;
      if (inline === undefined) i += 1;
      continue;
    }
    if (token === '--out' || token === '--log' || token === '--now' || token === '--term-page') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ExtractError(`${token} 뒤에 값이 필요합니다`);
      if (token === '--out') args.out = value;
      else if (token === '--log') args.logPath = value;
      else if (token === '--term-page') args.termPages.push(value);
      else {
        if (!ISO_OFFSET_PATTERN.test(value)) throw new ExtractError(`--now 값이 ISO8601(+오프셋) 형식이 아닙니다 — "${value}"`);
        args.now = value;
      }
      i += 1;
      continue;
    }
    if (token.startsWith('--')) throw new ExtractError(`알 수 없는 옵션: ${token}`);
    args.files.push(token);
  }
  return args;
}

interface RunRecord {
  generatedAt: string;
  /** 발행 계약 스키마 버전(v3) */
  schemaVersion: number;
  /** 기간 스냅샷(방학 시간표 등) 경로 — 비어 있으면 기간 미수집 */
  termPages: readonly string[];
  model: string;
  /** AI 를 실제로 어디서 받았는가(NFR-A4) */
  provider: AiProvider;
  /** 규칙 전용으로 내려간 사유(정상이면 null · `--ai=off` 는 null) */
  fallbackReason: string | null;
  aiMode: AiMode;
  /** 실제 나간 AI 호출 수(재시도 포함) */
  calls: number;
  /** 입력 상한 초과로 잘라낸 후보 문장 수 */
  truncated: number;
  /** 토큰 추정치(정확한 과금값 아님) */
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTemplateSha256: string;
  promptChars: number;
  aiStatus: AiStatus;
  aiError: string | null;
  durationMs: number;
  aiDurationMs: number;
  files: readonly string[];
  candidates: number;
  candidatesRejected: number;
  ruleEntries: number;
  aiDrafts: number;
  aiAccepted: number;
  aiDropped: number;
  aiRepairs: number;
  aiConflicts: number;
  needsReview: number;
  dedupedNotices: number;
  fatalIssues: readonly ValidationIssue[];
  reviewReasons: readonly string[];
  output: string | null;
  dryRun: boolean;
  noAi: boolean;
}

export async function runExtract(argv: readonly string[], deps: ExtractDeps): Promise<number> {
  const started = deps.nowMs();
  let args: ExtractArgs;
  try {
    args = parseExtractArgs(argv);
  } catch (error) {
    deps.error(`[extract] ${error instanceof Error ? error.message : String(error)}`);
    deps.error(USAGE);
    return 1;
  }

  const files = resolveFiles(args, deps);
  if (files.length === 0) {
    deps.error(`[extract] 스냅샷 파일이 없습니다 — ${args.out} 를 만들 수 없습니다(예: npm run extract -- --local data/raw/*.html)`);
    return 1;
  }

  // ① 스냅샷 읽기
  const snapshotInputs: { file: string; routeId: string; dayType: Snapshot['dayType']; html: string }[] = [];
  const snapshots: Snapshot[] = [];
  for (const file of files) {
    let ref;
    try {
      ref = parseSnapshotFileName(file);
      findRoute(ref.routeId);
    } catch (error) {
      deps.error(`[extract] 스냅샷 이름/노선 확인 실패: ${file} — ${message(error)}`);
      return 1;
    }
    let html: string;
    try {
      html = deps.readTextFile(file);
    } catch (error) {
      deps.error(`[extract] 파일을 읽을 수 없습니다: ${file} — ${message(error)}`);
      return 1;
    }
    try {
      snapshots.push(parseSnapshot(html, findRoute(ref.routeId), ref.dayType));
    } catch (error) {
      deps.error(`[extract] 파싱 실패: ${file} — ${message(error)}`);
      return 1;
    }
    snapshotInputs.push({ file, routeId: ref.routeId, dayType: ref.dayType, html });
  }

  // ② 규칙 파서로 v1 기준선
  let base: Timetable;
  try {
    base = assembleTimetable(snapshots, { fetchedAt: args.now ?? deps.nowIso() });
  } catch (error) {
    deps.error(`[extract] 조립 실패: ${message(error)}`);
    return 1;
  }
  const baseIssues = validateTimetable(base);
  if (baseIssues.length > 0) {
    deps.error(`[extract] v1 기준선 검증 실패 — ${baseIssues.length}건(파서 회귀 의심)`);
    for (const issue of baseIssues) deps.error(`[extract]   ${issue.where}: ${issue.message}`);
    return 1;
  }

  const sources: SnapshotSource[] = toSources(snapshotInputs);
  const { candidates, rejected } = harvestCandidates(sources);
  const promptChars = buildPrompt(candidates).length;

  // ②-b 기간 수집용 스냅샷(노선 표가 아닌 페이지 — 방학 시간표 등). 없으면 방학 기간은 null + 사유 기록.
  const termFiles = resolveTermPages(args, deps);
  const termSources: TermSource[] = [];
  for (const file of termFiles) {
    let html: string;
    try {
      html = deps.readTextFile(file);
    } catch (error) {
      deps.error(`[extract] 기간 스냅샷을 읽을 수 없습니다: ${file} — ${message(error)}`);
      return 1;
    }
    termSources.push({ file, html, text: pageText(html) });
  }
  if (termSources.length > 0) deps.log(`[extract] 기간 스냅샷 ${String(termSources.length)}개: ${termFiles.join(', ')}`);

  const rules = extractRuleStructures({ sources, base, candidates, termSources });

  // ③ AI 보강(선택)
  const structurer = args.noAi
    ? createDisabledStructurer(args.model === '' ? DEFAULT_MODEL : args.model)
    : deps.createStructurer({ model: args.model, noAi: args.noAi, provider: args.aiMode });
  const aiResult = await structurer.structure(candidates);
  const fallbackReason = resolveFallbackReason(args.aiMode, aiResult.status, aiResult.error);
  if (aiResult.status === 'unavailable' || aiResult.status === 'error') {
    deps.log(`[extract] ⚠️ AI 보강 불가(${aiResult.status}) — 규칙 전용으로 계속한다: ${fallbackReason ?? ''}`);
  }

  // ④ 병합·중복 제거
  const merged = mergeAiDrafts({
    ruleDateRules: rules.dateRules,
    ruleTerms: rules.terms,
    drafts: aiResult.drafts,
    candidates,
    sources,
    base,
  });
  for (const drop of merged.dropped) {
    deps.log(`[extract] ⚠️ AI 초안 버림 — ${drop.reason}: "${drop.quote.slice(0, 60)}"`);
  }
  for (const issue of merged.fatal) deps.error(`[extract] ${issue.where}: ${issue.message}`);
  if (merged.fatal.length > 0) {
    deps.error('[extract] 인용 검증 실패 — **발행하지 않는다**(위조 주입 차단)');
    writeLog(deps, args, buildRecord(args, files, 0, merged, rules, aiResult, deps.nowMs() - started, [], [], [], true));
    return 1;
  }

  // ⑤ 조립 + (증거용) 위조 주입
  const parts = {
    dateRules: merged.dateRules,
    terms: merged.terms,
    tripNotes: rules.tripNotes,
    stopWindows: rules.stopWindows,
    tripConditions: rules.tripConditions,
    notices: rules.notices,
    dedupedNotices: rules.dedupedNotices,
  };
  let enriched = buildEnrichedTimetable(base, parts);
  if (args.injectFabricated) {
    enriched = { ...enriched, dateRules: [...enriched.dateRules, fabricatedRule(sources)] };
    deps.log('[extract] ⚠️ --inject-fabricated: 원본에 없는 문장을 주입했다(검증 FAIL 이어야 정상)');
  }

  // ⑥ 검증
  const issues = validateEnriched(enriched, { baseline: base, sources, termSources });
  const fatalIssues = issues.filter((issue) => issue.fatal);
  const reviewReasons = issues.filter((issue) => !issue.fatal).map((issue) => `${issue.where}: ${issue.message}`);
  const needsReview = countNeedsReview(enriched);

  const record = buildRecord(args, files, candidates.length, merged, rules, aiResult, deps.nowMs() - started, fatalIssues, reviewReasons, issues, fatalIssues.length > 0, {
    candidatesRejected: rejected,
    needsReview,
    promptChars,
    termPages: termFiles,
  });

  if (fatalIssues.length > 0) {
    deps.error(`[extract] 검증 실패(치명) — ${fatalIssues.length}건. **JSON 을 쓰지 않는다**`);
    for (const issue of fatalIssues) deps.error(`[extract]   ${issue.where}: ${issue.message}`);
    writeLog(deps, args, record);
    return 1;
  }

  const gaps = computeGapCoverage(enriched);
  const meta: ExtractionMeta = {
    extractor: EXTRACTOR,
    schemaVersion: 3,
    termSources: [...termFiles],
    model: args.noAi || aiResult.model === '' ? null : aiResult.model,
    provider: effectiveProvider(args.aiMode, aiResult.status),
    promptTemplateSha256: promptTemplateSha256(),
    promptChars: promptChars,
    aiStatus: aiResult.status,
    aiError: aiResult.error,
    calls: aiResult.usage.calls,
    truncated: aiResult.usage.truncated,
    promptTokens: aiResult.usage.promptTokens,
    completionTokens: aiResult.usage.completionTokens,
    totalTokens: aiResult.usage.totalTokens,
    fallbackReason: fallbackReason,
    candidates: candidates.length,
    ruleEntries: rules.dateRules.length + rules.terms.length,
    aiDrafts: aiResult.drafts.length,
    aiAccepted: merged.accepted,
    aiDropped: merged.dropped.length,
    aiRepairs: merged.repairs.length,
    aiConflicts: merged.conflicts,
    needsReview,
    dedupedNotices: rules.dedupedNotices,
    reviewReasons,
    gaps,
  };
  const final: EnrichedTimetable = withExtractionMeta(enriched, meta);

  logSummary(deps, final, args, aiResult, needsReview, reviewReasons);
  writeLog(deps, args, record);

  if (args.dryRun) {
    deps.log('[extract] --dry-run: 검증만 수행했다(발행 없음)');
    return 0;
  }

  const serialized = `${JSON.stringify(final, null, 2)}\n`;
  try {
    deps.writeTextFile(args.out, serialized);
  } catch (error) {
    deps.error(`[extract] 출력 실패: ${args.out} — ${message(error)}`);
    return 1;
  }
  deps.log(`[extract] 발행: ${args.out} (${new TextEncoder().encode(serialized).length} bytes) · schemaVersion=3 · ${final.source.contentHash}`);
  return 0;
}

/** 기간 스냅샷 경로 — `--term-page` 우선, 없으면 `data/raw/terms/*.html`(없으면 빈 목록) */
export function resolveTermPages(args: ExtractArgs, deps: ExtractDeps): string[] {
  if (args.termPages.length > 0) return [...args.termPages];
  try {
    return deps
      .listFiles(DEFAULT_TERM_DIR)
      .filter((file) => file.endsWith('.html'))
      .map((file) => `${DEFAULT_TERM_DIR}/${file}`)
      .sort();
  } catch {
    // 디렉터리가 없으면 "기간 스냅샷 없음" 이다(오류 아님 — 방학 기간은 null + 사유 기록)
    return [];
  }
}

function resolveFiles(args: ExtractArgs, deps: ExtractDeps): string[] {
  if (args.files.length > 0) return [...args.files];
  return deps
    .listFiles(DEFAULT_RAW_DIR)
    .filter((file) => file.endsWith('.html'))
    .map((file) => `${DEFAULT_RAW_DIR}/${file}`)
    .sort();
}

function fabricatedRule(sources: readonly SnapshotSource[]): DateRule {
  return {
    kind: 'no-service',
    start: '2026-01-01',
    end: null,
    yearInferred: false,
    dayTypes: [],
    scope: [],
    effect: { appliesTo: 'all-routes' },
    note: '증거용 위조 주입(--inject-fabricated)',
    sourceQuote: '원본에 없는 위조 문장: 셔틀버스 운행 없음',
    sourcePage: sources[0]?.file ?? '',
    extractedBy: 'ai',
    confidence: 1,
    needsReview: false,
  };
}

function buildRecord(
  args: ExtractArgs,
  files: readonly string[],
  candidates: number,
  merged: { readonly accepted: number; readonly dropped: readonly unknown[]; readonly repairs: readonly unknown[]; readonly conflicts: number },
  rules: RuleStructures,
  aiResult: AiStructureResult,
  durationMs: number,
  fatalIssues: readonly ValidationIssue[],
  reviewReasons: readonly string[],
  allIssues: readonly ValidationIssue[],
  aborted: boolean,
  extra?: {
    readonly candidatesRejected?: number;
    readonly needsReview?: number;
    readonly promptChars?: number;
    readonly termPages?: readonly string[];
  },
): RunRecord {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 3,
    termPages: extra?.termPages ?? [],
    model: aiResult.model,
    provider: effectiveProvider(args.aiMode, aiResult.status),
    fallbackReason: resolveFallbackReason(args.aiMode, aiResult.status, aiResult.error),
    aiMode: args.aiMode,
    calls: aiResult.usage.calls,
    truncated: aiResult.usage.truncated,
    promptTokens: aiResult.usage.promptTokens,
    completionTokens: aiResult.usage.completionTokens,
    totalTokens: aiResult.usage.totalTokens,
    promptTemplateSha256: promptTemplateSha256(),
    promptChars: extra?.promptChars ?? 0,
    aiStatus: aiResult.status,
    aiError: aiResult.error,
    durationMs,
    aiDurationMs: aiResult.durationMs,
    files,
    candidates,
    candidatesRejected: extra?.candidatesRejected ?? 0,
    ruleEntries: rules.dateRules.length + rules.terms.length,
    aiDrafts: aiResult.drafts.length,
    aiAccepted: merged.accepted,
    aiDropped: merged.dropped.length,
    aiRepairs: merged.repairs.length,
    aiConflicts: merged.conflicts,
    needsReview: extra?.needsReview ?? 0,
    dedupedNotices: rules.dedupedNotices,
    fatalIssues,
    reviewReasons,
    output: aborted ? null : args.out,
    dryRun: args.dryRun,
    noAi: args.noAi,
  };
  void allIssues;
}

function writeLog(deps: ExtractDeps, args: ExtractArgs, record: RunRecord): void {
  if (args.logPath === '') return;
  try {
    deps.writeTextFile(args.logPath, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    deps.error(`[extract] 실행 로그 저장 실패: ${args.logPath} — ${message(error)}`);
  }
}

function logSummary(
  deps: ExtractDeps,
  timetable: EnrichedTimetable,
  args: ExtractArgs,
  aiResult: AiStructureResult,
  needsReview: number,
  reviewReasons: readonly string[],
): void {
  deps.log(
    `[extract] 입력 스냅샷 ${String(args.files.length || timetable.source.pages.length)}개 · 후보 문장 ${String(timetable.source.extraction.candidates)}개 · 규칙 항목 ${String(timetable.source.extraction.ruleEntries)}개`,
  );
  deps.log(
    `[extract] AI: mode=${args.aiMode} provider=${timetable.source.extraction.provider} status=${aiResult.status} model=${aiResult.model} 초안=${String(aiResult.drafts.length)} 채택=${String(timetable.source.extraction.aiAccepted)} 버림=${String(timetable.source.extraction.aiDropped)} 인용복구=${String(timetable.source.extraction.aiRepairs)} 충돌=${String(timetable.source.extraction.aiConflicts)} (${String(aiResult.durationMs)}ms)`,
  );
  deps.log(
    `[extract] AI 비용 가드: 호출 ${String(aiResult.usage.calls)}회 · 토큰(추정) prompt ${String(aiResult.usage.promptTokens)} + completion ${String(aiResult.usage.completionTokens)} = ${String(aiResult.usage.totalTokens)} · 잘림 ${String(aiResult.usage.truncated)}건${timetable.source.extraction.fallbackReason === null ? '' : ` · 폴백 사유: ${timetable.source.extraction.fallbackReason}`}`,
  );
  for (const gap of timetable.source.extraction.gaps) {
    deps.log(`[extract] 갭 ${String(gap.gap)} ${gap.name}: ${gap.count}건 — ${gap.where}`);
  }
  deps.log(`[extract] dateRules ${String(timetable.dateRules.length)}건 · terms ${String(timetable.terms.length)}건 · notices 중복 제거 ${String(timetable.source.extraction.dedupedNotices)}건`);
  deps.log(
    `[extract] 편별 조건 ${String(countTripConditions(timetable))}건(원문 note 구조화) · 기간 스냅샷 ${String(timetable.source.extraction.termSources.length)}개`,
  );
  deps.log(`[extract] needsReview ${String(needsReview)}건${needsReview > 0 ? ` — ${reviewReasons.length}건의 검증 경고` : ''}`);
  for (const reason of reviewReasons) deps.log(`[extract]   ⚠️ ${reason}`);
  deps.log('[extract] 검증 통과(치명 0) · schemaVersion=3 · v1 표(행·시각·열) 보존 확인');
}

/** 산출물에서 편별 조건이 붙은 행 수를 센다(모니터링 로그용). */
function countTripConditions(timetable: EnrichedTimetable): number {
  let total = 0;
  for (const route of timetable.routes) {
    for (const dayType of ['weekday', 'saturday', 'sunday'] as const) {
      for (const row of route.byDay[dayType].trips) {
        if ('service' in row) total += 1;
      }
    }
  }
  return total;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 산출물 `extraction.provider` — **실제로 AI 를 받은 경로**.
 * `off`(의도) · 키 없음 · 실패(폴백)는 모두 `rule-only` 다(사유는 `fallbackReason`).
 */
export function effectiveProvider(mode: AiMode, status: AiStatus): AiProvider {
  if (status !== 'ok') return 'rule-only';
  if (mode === 'ollama') return 'ollama';
  if (mode === 'api') return 'api';
  return 'rule-only';
}

/** 규칙 전용으로 내려간 **사유**(정상 사용·의도된 off 는 null — 모니터링 지표, docs/02 부록 A-2) */
export function resolveFallbackReason(mode: AiMode, status: AiStatus, error: string | null): string | null {
  if (mode === 'off') return null;
  if (status === 'ok') return null;
  return error !== null && error !== '' ? error : `AI 사용 불가(${status})`;
}

export { hasFatal, DEFAULT_TIMEOUT_MS };
