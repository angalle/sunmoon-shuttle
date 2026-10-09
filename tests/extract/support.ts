/**
 * `tests/extract` 공용 픽스처 — 원본 스냅샷(`data/raw/*.html`)에서 실제 파이프라인 재료를 만든다.
 * 네트워크·실 AI 호출 없음(순수). AI 는 테스트마다 가짜 structurer 로 대체한다.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { assembleTimetable } from '../../tools/scraper/assemble.js';
import { parseSnapshot } from '../../tools/scraper/parse.js';
import { findRoute, parseSnapshotFileName } from '../../tools/scraper/routeMeta.js';
import type { Snapshot, Timetable } from '../../tools/scraper/types.js';
import { harvestCandidates, toSources } from '../../tools/extract/candidates.js';
import { pageText } from '../../tools/extract/text.js';
import { extractRuleStructures } from '../../tools/extract/rules.js';
import { buildEnrichedTimetable } from '../../tools/extract/enrich.js';
import type { ExtractDeps } from '../../tools/extract/cli.js';
import type { EnrichedTimetableBody, RuleStructures, SnapshotSource, TermSource } from '../../tools/extract/types.js';

export const RAW_DIR = join(process.cwd(), 'data', 'raw');
/** 기간 스냅샷(방학 시간표 등) — CLI 기본값(`data/raw/terms`)과 같은 위치 */
export const TERM_DIR = join(RAW_DIR, 'terms');
export const FIXED_NOW = '2026-10-06T09:00:00+09:00';

/** `data/raw/terms/*.html` — 노선 표가 아닌 안내 페이지(없으면 빈 배열). */
export function loadTermSources(): TermSource[] {
  let files: string[] = [];
  try {
    files = readdirSync(TERM_DIR)
      .filter((file) => file.endsWith('.html'))
      .sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const html = readFileSync(join(TERM_DIR, file), 'utf8');
    return { file: `data/raw/terms/${file}`, html, text: pageText(html) };
  });
}

export interface Fixture {
  readonly files: readonly string[];
  /** 기간 스냅샷(방학 페이지) — v3 */
  readonly termSources: readonly TermSource[];
  readonly sources: readonly SnapshotSource[];
  readonly base: Timetable;
  readonly candidates: ReturnType<typeof harvestCandidates>['candidates'];
  readonly rejectedCandidates: number;
  readonly rules: RuleStructures;
  readonly enriched: EnrichedTimetableBody;
}

let cached: Fixture | null = null;

export function loadFixture(): Fixture {
  if (cached !== null) return cached;
  const files = readdirSync(RAW_DIR)
    .filter((file) => file.endsWith('.html'))
    .sort();
  const inputs = files.map((file) => {
    const ref = parseSnapshotFileName(file);
    return { file, routeId: ref.routeId, dayType: ref.dayType, html: readFileSync(join(RAW_DIR, file), 'utf8') };
  });
  const snapshots: Snapshot[] = inputs.map((input) => parseSnapshot(input.html, findRoute(input.routeId), input.dayType));
  const base = assembleTimetable(snapshots, { fetchedAt: FIXED_NOW });
  const sources = toSources(inputs);
  const { candidates, rejected } = harvestCandidates(sources);
  const termSources = loadTermSources();
  const rules = extractRuleStructures({ sources, base, candidates, termSources });
  const enriched = buildEnrichedTimetable(base, {
    dateRules: rules.dateRules,
    terms: rules.terms,
    tripNotes: rules.tripNotes,
    stopWindows: rules.stopWindows,
    tripConditions: rules.tripConditions,
    routeNotes: rules.routeNotes,
    notices: rules.notices,
    dedupedNotices: rules.dedupedNotices,
  });
  cached = { files, termSources, sources, base, candidates, rejectedCandidates: rejected, rules, enriched };
  return cached;
}

/** 규칙만 쓴 결과(=`--no-ai` 산출물과 같은 본문) */
export function ruleOnlyEnriched(): EnrichedTimetableBody {
  return loadFixture().enriched;
}

/** 별칭 — 파이프라인 테스트에서 읽기 쉬운 이름 */
export const enrichTimetableFixture = ruleOnlyEnriched;

export const FILE_NAMES = {
  asanWeekday: 'data/raw/2026-2학기-asan-ktx-평일.html',
  asanSaturday: 'data/raw/2026-2학기-asan-ktx-토요일.html',
  stationWeekday: 'data/raw/2026-2학기-cheonan-station-평일.html',
  terminalWeekday: 'data/raw/2026-2학기-cheonan-terminal-평일.html',
} as const;

/**
 * `runExtract` 테스트 하네스 — 파일 IO 를 메모리로 바꾼다(디스크 쓰기 0).
 * `createStructurer` 만 주입한다(T19: 모의 서버를 향하는 `createApiStructurer` 등).
 * T34 부터는 `createTableExtractor`·메모리 파일(캐시 재사용 시나리오)도 주입할 수 있다.
 */
export interface RunHarness {
  readonly written: Map<string, string>;
  readonly logs: string[];
  readonly errors: string[];
  readonly deps: ExtractDeps;
}

export interface RunHarnessOptions {
  /** T34 AI 표 추출기 조립(없으면 표 추출 단계를 건너뛴다) */
  readonly createTableExtractor?: ExtractDeps['createTableExtractor'];
  /**
   * 메모리 파일 — `readTextFile` 이 실제 파일보다 **먼저** 본다.
   * `written` 을 넘기면 이전 실행의 산출물(캐시)을 다음 실행이 그대로 읽는다(해시 캐시 시나리오).
   */
  readonly files?: Map<string, string>;
}

export function makeRunHarness(
  createStructurer: ExtractDeps['createStructurer'],
  options: RunHarnessOptions = {},
): RunHarness {
  const written = new Map<string, string>();
  const logs: string[] = [];
  const errors: string[] = [];
  const files = options.files;
  return {
    written,
    logs,
    errors,
    deps: {
      listFiles: (dir) => readdirSync(dir),
      readTextFile: (path) => files?.get(path) ?? readFileSync(path, 'utf8'),
      writeTextFile: (path, text) => {
        written.set(path, text);
        files?.set(path, text);
      },
      nowIso: () => FIXED_NOW,
      nowMs: () => 1_000,
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
      createStructurer,
      ...(options.createTableExtractor === undefined ? {} : { createTableExtractor: options.createTableExtractor }),
    },
  };
}

/** 테스트용 가짜 AI structurer(네트워크 0) */
export function fakeStructurer(
  drafts: readonly unknown[],
  status: 'ok' | 'unavailable' | 'error' = 'ok',
  provider: 'api' | 'ollama' = 'ollama',
): {
  model: string;
  promptTemplateSha256: string;
  structure: () => Promise<{
    status: 'ok' | 'unavailable' | 'disabled' | 'error';
    provider: 'api' | 'ollama' | 'rule-only';
    model: string;
    durationMs: number;
    drafts: readonly { candidateId: string | null; sourceQuote: string; kind: string; dayTypes: readonly string[]; note: string | null; confidence: number }[];
    raw: string;
    error: string | null;
    usage: {
      calls: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      truncated: number;
    };
  }>;
} {
  return {
    model: 'fake-model:test',
    promptTemplateSha256: 'sha256:test',
    structure: async () => ({
      status,
      provider,
      model: 'fake-model:test',
      durationMs: 1,
      drafts: drafts as never,
      raw: '',
      error: status === 'ok' ? null : '모델 없음(테스트)',
      usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, truncated: 0 },
    }),
  };
}
