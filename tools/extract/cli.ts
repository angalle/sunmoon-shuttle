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
import { mergeAiDrafts } from './merge.js';
import { buildPrompt, createDisabledStructurer, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, promptTemplateSha256 } from './ai.js';
import type { AiStructurer } from './types.js';
import { buildEnrichedTimetable, withExtractionMeta } from './enrich.js';
import { computeGapCoverage, countNeedsReview, hasFatal, validateEnriched } from './validate.js';
import { ExtractError } from './types.js';
import type {
  AiStatus,
  DateRule,
  EnrichedTimetable,
  ExtractionMeta,
  RuleStructures,
  SnapshotSource,
  ValidationIssue,
} from './types.js';

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
    readonly model: string;
    readonly noAi: boolean;
    readonly baseUrl?: string | undefined;
    readonly timeoutMs?: number | undefined;
  }): AiStructurer;
}

export const DEFAULT_OUT = 'data/timetable.json';
export const DEFAULT_LOG = '.session-notes/T16-extract-run.json';
export const DEFAULT_RAW_DIR = 'data/raw';
export const EXTRACTOR = 'tools/extract (schema v2)';

export interface ExtractArgs {
  readonly files: readonly string[];
  readonly out: string;
  readonly logPath: string;
  readonly noAi: boolean;
  readonly model: string;
  readonly dryRun: boolean;
  readonly injectFabricated: boolean;
  readonly now: string | null;
}

export const USAGE = [
  '사용법: npm run extract [-- --local] [data/raw/*.html] [--out data/timetable.json]',
  '          [--no-ai] [--model=<이름>] [--dry-run] [--log .session-notes/T16-extract-run.json]',
  '',
  '  --local               로컬 스냅샷만 사용한다(원격 수집 없음 — robots.txt 차단, docs/01 §8)',
  '  --no-ai               AI 없이 규칙만으로 발행한다(폴백 모드 — 경고 기록)',
  '  --model=<이름>        로컬 Ollama 모델명(기본 ' + DEFAULT_MODEL + ')',
  '  --dry-run             발행 없이 검증만(파일 쓰기 0, 로그는 남긴다)',
  '  --out <경로>          출력 JSON 경로(기본 data/timetable.json)',
  '  --log <경로>          실행 로그 경로(기본 .session-notes/T16-extract-run.json)',
  '  --now <ISO8601+09:00> 수집 시각 고정(결정성 확인용)',
  '  --inject-fabricated   [증거용] 원본에 없는 문장을 주입해 검증 FAIL(exit 1)을 재현한다',
].join('\n');

const ISO_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseExtractArgs(argv: readonly string[]): ExtractArgs {
  const args: {
    files: string[];
    out: string;
    logPath: string;
    noAi: boolean;
    model: string;
    dryRun: boolean;
    injectFabricated: boolean;
    now: string | null;
  } = {
    files: [],
    out: DEFAULT_OUT,
    logPath: DEFAULT_LOG,
    noAi: false,
    model: DEFAULT_MODEL,
    dryRun: false,
    injectFabricated: false,
    now: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '--local' || token === '--no-ai' || token === '--dry-run' || token === '--inject-fabricated') {
      if (token === '--no-ai') args.noAi = true;
      if (token === '--dry-run') args.dryRun = true;
      if (token === '--inject-fabricated') args.injectFabricated = true;
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
    if (token === '--out' || token === '--log' || token === '--now') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ExtractError(`${token} 뒤에 값이 필요합니다`);
      if (token === '--out') args.out = value;
      else if (token === '--log') args.logPath = value;
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
  model: string;
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
  const rules = extractRuleStructures({ sources, base, candidates });

  // ③ AI 보강(선택)
  const structurer = args.noAi
    ? createDisabledStructurer(args.model)
    : deps.createStructurer({ model: args.model, noAi: args.noAi });
  const aiResult = await structurer.structure(candidates);
  if (aiResult.status === 'unavailable' || aiResult.status === 'error') {
    deps.log(`[extract] ⚠️ AI 보강 불가(${aiResult.status}) — 규칙 전용으로 계속한다: ${aiResult.error ?? ''}`);
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
    notices: rules.notices,
    dedupedNotices: rules.dedupedNotices,
  };
  let enriched = buildEnrichedTimetable(base, parts);
  if (args.injectFabricated) {
    enriched = { ...enriched, dateRules: [...enriched.dateRules, fabricatedRule(sources)] };
    deps.log('[extract] ⚠️ --inject-fabricated: 원본에 없는 문장을 주입했다(검증 FAIL 이어야 정상)');
  }

  // ⑥ 검증
  const issues = validateEnriched(enriched, { baseline: base, sources });
  const fatalIssues = issues.filter((issue) => issue.fatal);
  const reviewReasons = issues.filter((issue) => !issue.fatal).map((issue) => `${issue.where}: ${issue.message}`);
  const needsReview = countNeedsReview(enriched);

  const record = buildRecord(args, files, candidates.length, merged, rules, aiResult, deps.nowMs() - started, fatalIssues, reviewReasons, issues, fatalIssues.length > 0, {
    candidatesRejected: rejected,
    needsReview,
    promptChars,
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
    model: args.noAi ? null : aiResult.model,
    promptTemplateSha256: promptTemplateSha256(),
    promptChars: promptChars,
    aiStatus: aiResult.status,
    aiError: aiResult.error,
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
  deps.log(`[extract] 발행: ${args.out} (${new TextEncoder().encode(serialized).length} bytes) · schemaVersion=2 · ${final.source.contentHash}`);
  return 0;
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
  aiResult: { readonly model: string; readonly status: AiStatus; readonly error: string | null; readonly durationMs: number; readonly drafts: readonly unknown[] },
  durationMs: number,
  fatalIssues: readonly ValidationIssue[],
  reviewReasons: readonly string[],
  allIssues: readonly ValidationIssue[],
  aborted: boolean,
  extra?: { readonly candidatesRejected?: number; readonly needsReview?: number; readonly promptChars?: number },
): RunRecord {
  return {
    generatedAt: new Date().toISOString(),
    model: aiResult.model,
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
  aiResult: { readonly status: AiStatus; readonly model: string; readonly durationMs: number; readonly drafts: readonly unknown[] },
  needsReview: number,
  reviewReasons: readonly string[],
): void {
  deps.log(
    `[extract] 입력 스냅샷 ${String(args.files.length || timetable.source.pages.length)}개 · 후보 문장 ${String(timetable.source.extraction.candidates)}개 · 규칙 항목 ${String(timetable.source.extraction.ruleEntries)}개`,
  );
  deps.log(
    `[extract] AI: status=${aiResult.status} model=${aiResult.model} 초안=${String(aiResult.drafts.length)} 채택=${String(timetable.source.extraction.aiAccepted)} 버림=${String(timetable.source.extraction.aiDropped)} 인용복구=${String(timetable.source.extraction.aiRepairs)} 충돌=${String(timetable.source.extraction.aiConflicts)} (${String(aiResult.durationMs)}ms)`,
  );
  for (const gap of timetable.source.extraction.gaps) {
    deps.log(`[extract] 갭 ${String(gap.gap)} ${gap.name}: ${gap.count}건 — ${gap.where}`);
  }
  deps.log(`[extract] dateRules ${String(timetable.dateRules.length)}건 · terms ${String(timetable.terms.length)}건 · notices 중복 제거 ${String(timetable.source.extraction.dedupedNotices)}건`);
  deps.log(`[extract] needsReview ${String(needsReview)}건${needsReview > 0 ? ` — ${reviewReasons.length}건의 검증 경고` : ''}`);
  for (const reason of reviewReasons) deps.log(`[extract]   ⚠️ ${reason}`);
  deps.log('[extract] 검증 통과(치명 0) · schemaVersion=2 · v1 필드 보존 확인');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { hasFatal, DEFAULT_TIMEOUT_MS };
