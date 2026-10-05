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
import { extractRuleStructures } from '../../tools/extract/rules.js';
import { buildEnrichedTimetable } from '../../tools/extract/enrich.js';
import type { EnrichedTimetableBody, RuleStructures, SnapshotSource } from '../../tools/extract/types.js';

export const RAW_DIR = join(process.cwd(), 'data', 'raw');
export const FIXED_NOW = '2026-10-06T09:00:00+09:00';

export interface Fixture {
  readonly files: readonly string[];
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
  const rules = extractRuleStructures({ sources, base, candidates });
  const enriched = buildEnrichedTimetable(base, {
    dateRules: rules.dateRules,
    terms: rules.terms,
    tripNotes: rules.tripNotes,
    stopWindows: rules.stopWindows,
    notices: rules.notices,
    dedupedNotices: rules.dedupedNotices,
  });
  cached = { files, sources, base, candidates, rejectedCandidates: rejected, rules, enriched };
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

/** 테스트용 가짜 AI structurer */
export function fakeStructurer(drafts: readonly unknown[], status: 'ok' | 'unavailable' = 'ok'): {
  model: string;
  promptTemplateSha256: string;
  structure: () => Promise<{
    status: 'ok' | 'unavailable' | 'disabled';
    model: string;
    durationMs: number;
    drafts: readonly { candidateId: string | null; sourceQuote: string; kind: string; dayTypes: readonly string[]; note: string | null; confidence: number }[];
    raw: string;
    error: string | null;
  }>;
} {
  return {
    model: 'fake-model:test',
    promptTemplateSha256: 'sha256:test',
    structure: async () => ({
      status,
      model: 'fake-model:test',
      durationMs: 1,
      drafts: drafts as never,
      raw: '',
      error: status === 'unavailable' ? '모델 없음(테스트)' : null,
    }),
  };
}
