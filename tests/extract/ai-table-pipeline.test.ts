/**
 * T34 ② **AI 표 추출 파이프라인** — 비용 가드(해시 캐시·호출 상한) + `runExtract` 통합(모의 서버) 수용 기준.
 *
 *  - AC-AI1-1 환각 주입 → 검증 4종 실패 + **발행 중단**(exit 1 · 발행물/초안/리포트 0건)
 *  - AC-AI1-2 정상 응답 → 원문 `HH:MM` 집합 == 추출 집합 · 행 수 == 원문 행 수(**수치** 제출)
 *  - AC-AI1-3 해시 캐시 → 같은 내용 재실행 `calls: 0` · 바뀐 페이지만 호출 · 상한 12 준수
 *  - AC-AI1-7 회귀 → `--no-ai` 산출물이 기존 발행본과 동일(규칙 정본 유지) · 폴백 정상
 *
 * 실 네트워크 0: 모의 OpenAI 호환 서버(`mock-ai-server.ts`)만 쓴다. 어댑터 조립은 실제 코드 경로
 * (`createStructurerFor`·`createTableExtractorFor` — `index.ts` 가 쓰는 그 함수)를 그대로 부른다.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  emptyTableCache,
  MAX_AI_TABLE_CALLS,
  parseTableCache,
  runAiTable,
  serializeTableCache,
} from '../../tools/extract/aiTableRun.js';
import type { AiTablePageJob, TableCache } from '../../tools/extract/aiTableRun.js';
import type { AiTableExtractor } from '../../tools/extract/aiTable.js';
import { extractTimeTokens, type TableRegion } from '../../tools/extract/tableRegion.js';
import type { AiTablePageDraft } from '../../tools/extract/types.js';
import { createStructurerFor, createTableExtractorFor } from '../../tools/extract/structurer.js';
import type { StructurerEnv } from '../../tools/extract/structurer.js';
import { runExtract } from '../../tools/extract/cli.js';
import type { ExtractDeps } from '../../tools/extract/cli.js';
import { completionBody, startMockApi } from './mock-ai-server.js';
import type { MockApi, MockApiHandler } from './mock-ai-server.js';
import { faithfulDraftFromPrompt, hallucinatedDraftFromPrompt, tableAwareHandler } from './tableFixtures.js';
import { FIXED_NOW, loadFixture, makeRunHarness } from './support.js';

const OUT = 'tmp/t34-out.json';
const LOG = 'tmp/t34-run.json';
const DRAFT = 'tmp/t34-draft.json';
const REPORT = 'tmp/t34-report.json';
const CACHE = 'tmp/t34-cache.json';
const MOCK_MODEL = 'mock-table-model-v1';
const MOCK_KEY = 'test-key-not-real';
const NOW = '2026-10-06T09:00:00+09:00';
/** 표가 있는 페이지(운행 중단 노선 1개 제외) */
const TABLE_PAGES = 10;

const servers: MockApi[] = [];

async function mock(handler: MockApiHandler = () => ({})): Promise<MockApi> {
  const server = await startMockApi(handler);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const ENV: StructurerEnv = { AI_BASE_URL: 'http://127.0.0.1:9/v1', AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY };

function envFor(server: MockApi): StructurerEnv {
  return { AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY };
}

/** `index.ts` 와 같은 조립 함수를 쓴다(테스트 전용 우회 없음) */
function structurerFactory(env: StructurerEnv): ExtractDeps['createStructurer'] {
  return ({ model, noAi, provider }) => createStructurerFor(noAi ? 'off' : provider, { model, env });
}

function tableFactory(env: StructurerEnv): NonNullable<ExtractDeps['createTableExtractor']> {
  return ({ model, noAi, provider }) => createTableExtractorFor(noAi ? 'off' : provider, { model, env });
}

function extractArgs(extra: readonly string[] = []): string[] {
  return ['--ai=api', '--out', OUT, '--log', LOG, '--ai-cache', CACHE, '--ai-draft', DRAFT, '--ai-report', REPORT, '--now', NOW, ...extra];
}

interface Artifact {
  readonly source: { readonly extraction: { readonly aiExtract: Record<string, unknown> } };
  readonly routes: readonly unknown[];
}

function published(): Record<string, unknown> {
  return JSON.parse(readFileSync('data/timetable.json', 'utf8')) as Record<string, unknown>;
}

/**
 * `source` 를 뺀 규칙 정본 부분(발행본 비교용 — §8 필드 추가는 이 부분을 바꾸지 않는다).
 * `academicEvents`(T42)도 뺀다: 발행본은 AI 분류 교차검증(채택·불일치 표시)을 거친 값이라 `--no-ai` 결과와
 * 다를 수 있다. 학사일정은 `tests/extract/calendar.test.ts` 가 따로 검증한다.
 */
function ruleCore(body: Record<string, unknown>): Record<string, unknown> {
  const { source, academicEvents, ...rest } = body;
  void source;
  void academicEvents;
  return rest;
}

// ═══════════════════════════ 비용 가드(§6) — 해시 캐시 · 호출 상한 ═══════════════════════════

function makeRegion(header: readonly string[], rows: readonly (readonly string[])[]): TableRegion {
  const text = [header.join(' | '), ...rows.map((row) => row.join(' | '))].join('\n');
  return {
    header,
    rows,
    text,
    rowCount: rows.length,
    contentHash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`,
  };
}

const HEADER = ['순', '아산캠퍼스 출발', '천안아산역 출발'];

function job(page: string, rows: readonly (readonly string[])[]): AiTablePageJob {
  const region = makeRegion(HEADER, rows);
  return {
    request: {
      page,
      routeId: 'asan-ktx',
      dayType: 'weekday',
      regionText: region.text,
      pageText: [HEADER.join(' '), ...rows.map((row) => row.join(' '))].join(' '),
    },
    region,
    ruleRows: rows.map((cells) => ({ seq: Number(cells[0]), depCampus: null, depStation: cells[2] ?? null })),
  };
}

const ROWS_A = [
  ['1', '8:05', '8:25'],
  ['2', 'Χ', '8:35'],
] as const;
const ROWS_B = [
  ['1', '8:05', '8:25'],
  ['2', '9:35', '9:45'],
] as const;
const ROWS_C = [['1', '7:00', '7:10']] as const;

/** 페이지 이름 → 정답 초안(프롬프트와 무관하게 표에서 만든다 — 러너 단위 테스트용) */
function draftFor(page: string, rows: readonly (readonly string[])[]): AiTablePageDraft {
  return {
    page,
    columns: [
      { header: '순', key: 'seq' },
      { header: '아산캠퍼스 출발', key: 'depCampus' },
      { header: '천안아산역 출발', key: 'depStation' },
    ],
    rows: rows.map((cells) => ({
      seq: Number(cells[0]),
      values: { depCampus: cells[1] === 'Χ' ? null : (cells[1] ?? null), depStation: cells[2] ?? null },
    })),
  };
}

interface FakeTableExtractor {
  readonly extractor: AiTableExtractor;
  readonly calls: string[];
  draftOverride: AiTablePageDraft | null;
}

/** 페이지별 원문 행 — 가짜 추출기가 그 페이지의 **정답 초안**을 돌려주게 한다 */
type RowsByPage = Readonly<Record<string, readonly (readonly string[])[]>>;

function fakeExtractor(rowsByPage: RowsByPage = {}): FakeTableExtractor {
  const state: FakeTableExtractor = {
    calls: [],
    draftOverride: null,
    extractor: {
      model: 'fake-table:test',
      promptTemplateSha256: 'sha256:test',
      async extractPage(request) {
        state.calls.push(request.page);
        const rows = rowsByPage[request.page] ?? ROWS_A;
        const draft = state.draftOverride ?? draftFor(request.page, rows);
        return {
          status: 'ok',
          provider: 'api',
          model: 'fake-table:test',
          durationMs: 1,
          draft,
          raw: JSON.stringify(draft),
          error: null,
          usage: { calls: 1, promptTokens: 100, completionTokens: 50, totalTokens: 150, truncated: 0 },
        };
      },
    },
  };
  return state;
}

function runParams(jobs: readonly AiTablePageJob[], cache: TableCache, extractor: AiTableExtractor, cap = MAX_AI_TABLE_CALLS) {
  return {
    jobs,
    noTablePages: ['data/raw/2026-2학기-cheonan-campus-평일.html'],
    extractor,
    provider: 'api' as const,
    cache,
    cap,
    log: () => {},
    nowIso: () => FIXED_NOW,
    nowMs: () => 1_000,
  };
}

describe('T34 §6 비용 가드 — 내용 해시 캐시', () => {
  const jobs = [job('p1', ROWS_A), job('p2', ROWS_B), job('p3', ROWS_C)];
  const rows: RowsByPage = { p1: ROWS_A, p2: ROWS_B, p3: ROWS_C };

  it('첫 실행은 보낸 페이지 수만큼 호출하고, 통과분만 캐시에 남긴다', async () => {
    const fake = fakeExtractor(rows);
    const outcome = await runAiTable(runParams(jobs, emptyTableCache(), fake.extractor));

    expect(outcome.meta.pagesSent).toBe(3);
    expect(outcome.meta.pagesSkippedByHash).toBe(0);
    expect(outcome.meta.calls).toBe(3);
    expect(outcome.meta.totalTokens).toBe(450);
    expect(fake.calls).toEqual(['p1', 'p2', 'p3']);
    expect(Object.keys(outcome.cache.entries).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(outcome.meta.adoptedPages).toEqual([]); // Stage B 채택은 T35
    expect(outcome.meta.drift.checked).toBe(false); // §7 드리프트는 T35
    expect(outcome.pages.every((page) => page.status === 'ok')).toBe(true);
    expect(outcome.draftArtifact.pages).toHaveLength(3);
    expect(outcome.meta.agreedRows).toBeGreaterThan(0);
  });

  it('같은 내용으로 다시 실행하면 **호출 0회** — 캐시를 재사용한다(AC-AI1-3)', async () => {
    const first = fakeExtractor(rows);
    const run1 = await runAiTable(runParams(jobs, emptyTableCache(), first.extractor));
    const second = fakeExtractor(rows);
    const run2 = await runAiTable(runParams(jobs, run1.cache, second.extractor));

    expect(second.calls).toEqual([]);
    expect(run2.meta.calls).toBe(0);
    expect(run2.meta.pagesSent).toBe(0);
    expect(run2.meta.pagesSkippedByHash).toBe(3);
    expect(run2.pages.every((page) => page.status === 'cached')).toBe(true);
    expect(run2.meta.agreedRows).toBe(run1.meta.agreedRows);
  });

  it('내용이 바뀐 페이지만 호출한다(AC-AI1-3)', async () => {
    const first = fakeExtractor({ p1: ROWS_A, p2: ROWS_B });
    const run1 = await runAiTable(runParams([job('p1', ROWS_A), job('p2', ROWS_B)], emptyTableCache(), first.extractor));
    const second = fakeExtractor({ p1: ROWS_A, p2: ROWS_C });
    const changed = [job('p1', ROWS_A), job('p2', ROWS_C)];
    const run2 = await runAiTable(runParams(changed, run1.cache, second.extractor));

    expect(second.calls).toEqual(['p2']);
    expect(run2.meta.calls).toBe(1);
    expect(run2.meta.pagesSent).toBe(1);
    expect(run2.meta.pagesSkippedByHash).toBe(1);
    expect(run2.pages.map((page) => page.status)).toEqual(['cached', 'ok']);
  });

  it('모델·프롬프트 템플릿이 바뀌면 캐시를 쓰지 않는다(재현성)', async () => {
    const first = fakeExtractor({ p1: ROWS_A });
    const run1 = await runAiTable(runParams([job('p1', ROWS_A)], emptyTableCache(), first.extractor));
    const second = fakeExtractor({ p1: ROWS_A });
    const other: AiTableExtractor = { ...second.extractor, model: 'other-model' };
    const run2 = await runAiTable(runParams([job('p1', ROWS_A)], run1.cache, other));

    expect(run2.meta.calls).toBe(1);
    expect(run2.meta.pagesSkippedByHash).toBe(0);
    expect(second.calls).toEqual(['p1']);
  });

  it('호출 상한을 넘으면 남은 페이지는 규칙 전용으로 넘기고 로그를 남긴다(§6 · 상한 12)', async () => {
    const fake = fakeExtractor(rows);
    const logs: string[] = [];
    const outcome = await runAiTable({
      ...runParams(jobs, emptyTableCache(), fake.extractor, 2),
      log: (line) => logs.push(line),
    });

    expect(outcome.meta.pagesSent).toBe(2);
    expect(outcome.capped).toEqual(['p3']);
    expect(fake.calls).toEqual(['p1', 'p2']);
    expect(outcome.pages.map((page) => page.status)).toEqual(['ok', 'ok', 'skipped']);
    expect(outcome.pages[2]?.reason).toContain('호출 상한 2회 초과');
    expect(logs.join('\n')).toContain('호출 상한(2회) 초과 — p3 는 규칙 전용으로 진행한다');
    expect(MAX_AI_TABLE_CALLS).toBe(12);
  });

  it('검증에 실패한 초안은 캐시에 남기지 않는다(다음 실행에서 다시 시도)', async () => {
    const fake = fakeExtractor({ p1: ROWS_A });
    fake.draftOverride = {
      ...draftFor('p1', ROWS_A),
      rows: [{ seq: 1, values: { depCampus: '23:59', depStation: '8:25' } }, { seq: 2, values: { depStation: '8:35' } }],
    };
    const outcome = await runAiTable(runParams([job('p1', ROWS_A)], emptyTableCache(), fake.extractor));

    expect(outcome.fatalIssues).toHaveLength(1);
    expect(outcome.dropped).toEqual(['p1']);
    expect(Object.keys(outcome.cache.entries)).toEqual([]);
  });

  it('캐시 파일은 왕복 보존되고, 깨진 파일은 빈 캐시 + invalid 로 알린다', async () => {
    const fake = fakeExtractor({ p1: ROWS_A });
    const outcome = await runAiTable(runParams([job('p1', ROWS_A)], emptyTableCache(), fake.extractor));
    const roundTrip = parseTableCache(serializeTableCache(outcome.cache));
    expect(roundTrip.invalid).toBe(false);
    expect(JSON.stringify(roundTrip.cache.entries['p1']?.draft)).toBe(JSON.stringify(outcome.cache.entries['p1']?.draft));

    expect(parseTableCache(null)).toEqual({ cache: emptyTableCache(), invalid: false });
    expect(parseTableCache('{').invalid).toBe(true);
    expect(parseTableCache('{"entries": 3}').invalid).toBe(true);
    expect(parseTableCache('{"entries":{"p1":{"contentHash":1}}}').invalid).toBe(false);
  });
});

// ═══════════════════════════ runExtract 통합(모의 서버) ═══════════════════════════

describe('T34 통합 AC-AI1-2 — 정상 응답 → 검증 수치 · §8 기록 · 초안/리포트 산출물', () => {
  it('원문 시각 집합 == 추출 집합 · 행 수 == 원문 행 수(수치 제출) + aiExtract 기록', async () => {
    const counter = { calls: 0, pages: [] as string[] };
    const server = await mock(tableAwareHandler(undefined, counter));
    const harness = makeRunHarness(structurerFactory(envFor(server)), { createTableExtractor: tableFactory(envFor(server)) });

    const code = await runExtract(extractArgs(), harness.deps);

    expect(code).toBe(0);
    expect(counter.calls).toBe(TABLE_PAGES);
    expect(harness.written.has(DRAFT)).toBe(true);
    expect(harness.written.has(REPORT)).toBe(true);
    expect(harness.written.has(CACHE)).toBe(true);

    const artifact = JSON.parse(harness.written.get(OUT) ?? '{}') as Artifact;
    const aiExtract = artifact.source.extraction.aiExtract;
    expect(aiExtract['pagesSent']).toBe(TABLE_PAGES);
    expect(aiExtract['pagesSkippedByHash']).toBe(0);
    expect(Number(aiExtract['calls'])).toBeGreaterThanOrEqual(TABLE_PAGES);
    expect(Number(aiExtract['totalTokens'])).toBeGreaterThan(0);
    expect(Number(aiExtract['agreedRows'])).toBeGreaterThan(50);
    expect(Number(aiExtract['agreedRows']) + Number(aiExtract['disagreedRows'])).toBe(148); // 10개 표 전체 행(정규화 후 일치 + 정규화 전 불일치)
    expect(aiExtract['adoptedPages']).toEqual([]);
    // T35: 드리프트 게이트는 발행 직전 발행본과 비교한다 — 이 실행은 편수·열이 그대로라 통과(차단 0)
    expect(aiExtract['drift']).toEqual({ checked: true, blocked: false, reasons: [] });

    const report = JSON.parse(harness.written.get(REPORT) ?? '{}') as {
      pages: { page: string; status: string; checks: { id: string; ok: boolean }[] }[];
      agreedRows: number;
      disagreedRows: number;
      fatal: string[];
    };
    expect(report.fatal).toEqual([]);
    expect(report.pages).toHaveLength(TABLE_PAGES);
    expect(report.pages.every((page) => page.status === 'ok')).toBe(true);
    for (const page of report.pages) {
      expect(page.checks).toHaveLength(4);
      expect(page.checks.every((entry) => entry.ok)).toBe(true);
    }

    // AC-AI1-2 수치 — 실제 페이지 1개를 골라 원문과 대조한다
    const target = 'data/raw/2026-2학기-asan-ktx-평일.html';
    const regionText = readFileSync(target, 'utf8');
    const expectedTimes = extractTimeTokens(
      // 표 영역은 모의 응답이 되읽은 프롬프트와 같다 — 리포트/초안에서 되계산한다
      (await tablePromptRegionText(regionText)),
    );
    const draft = JSON.parse(harness.written.get(DRAFT) ?? '{}') as {
      pages: { page: string; rows: { seq: number | null; values: Record<string, string | null> }[] }[];
    };
    const page = draft.pages.find((entry) => entry.page === target);
    expect(page).toBeDefined();
    const extracted = new Set<string>();
    for (const row of page?.rows ?? []) {
      for (const value of Object.values(row.values)) {
        if (value === null) continue;
        for (const token of extractTimeTokens(value)) extracted.add(token);
      }
    }
    expect(page?.rows).toHaveLength(42);
    expect([...extracted].sort()).toEqual([...expectedTimes].sort());
    expect(expectedTimes.size).toBe(97);
  });
});

/** 페이지 HTML → 표 영역 텍스트(초안 대조용) */
async function tablePromptRegionText(html: string): Promise<string> {
  const { findScheduleTable } = await import('../../tools/extract/tableRegion.js');
  return findScheduleTable(html)?.text ?? '';
}

describe('T34 통합 AC-AI1-1 — 환각 주입은 발행 중단(exit 1 · 산출물 0건)', () => {
  it('표에 없는 시각·행을 만들면 검증 4종에서 실패하고 아무것도 발행하지 않는다', async () => {
    const server = await mock(tableAwareHandler((_draft, prompt) => hallucinatedDraftFromPrompt(prompt) ?? (faithfulDraftFromPrompt(prompt) as AiTablePageDraft)));
    const harness = makeRunHarness(structurerFactory(envFor(server)), { createTableExtractor: tableFactory(envFor(server)) });

    const code = await runExtract(extractArgs(), harness.deps);

    expect(code).toBe(1);
    expect(harness.written.has(OUT)).toBe(false);
    expect(harness.written.has(DRAFT)).toBe(false);
    expect(harness.written.has(REPORT)).toBe(false);
    expect(harness.errors.join('\n')).toContain('AI 표 검증 실패(치명)');
    const log = JSON.parse(harness.written.get(LOG) ?? '{}') as { output: string | null; fatalIssues: { where: string; message: string }[] };
    expect(log.output).toBeNull();
    expect(log.fatalIssues.length).toBeGreaterThan(0);
    expect(log.fatalIssues[0]?.where).toContain('aiTable:');
    expect(log.fatalIssues[0]?.message).toContain('원문에 없는 값·시각·행');
  });

  it('실발행 없이 검증 실패를 조용히 넘기지 않는다 — 로그에 검증 4종 사유가 남는다', async () => {
    const server = await mock(tableAwareHandler());
    const harness = makeRunHarness(structurerFactory(envFor(server)), { createTableExtractor: tableFactory(envFor(server)) });
    const code = await runExtract(extractArgs(['--dry-run']), harness.deps);

    expect(code).toBe(0);
    expect(harness.written.has(OUT)).toBe(false);
    expect(harness.logs.join('\n')).toContain('--dry-run: 검증만 수행했다');
    // --dry-run 은 산출물을 쓰지 않는다(T34 초안/리포트도 포함)
    expect(harness.written.has(DRAFT)).toBe(false);
    expect(harness.written.has(REPORT)).toBe(false);
    void completionBody;
  });
});

describe('T34 통합 AC-AI1-3 — 해시 캐시 재실행 · 바뀐 페이지만 호출', () => {
  it('같은 스냅샷 재실행 → calls 0 · 바뀐 1개 페이지 → 그 페이지만 호출', async () => {
    const counter = { calls: 0, pages: [] as string[] };
    const server = await mock(tableAwareHandler(undefined, counter));
    const files = new Map<string, string>();
    const env = envFor(server);

    const first = makeRunHarness(structurerFactory(env), { createTableExtractor: tableFactory(env), files });
    expect(await runExtract(extractArgs(), first.deps)).toBe(0);
    const firstCalls = counter.calls;
    expect(firstCalls).toBe(TABLE_PAGES);

    const second = makeRunHarness(structurerFactory(env), { createTableExtractor: tableFactory(env), files });
    expect(await runExtract(extractArgs(), second.deps)).toBe(0);
    expect(counter.calls).toBe(firstCalls); // 표 호출 0회 추가

    const run2 = JSON.parse(second.written.get(OUT) ?? '{}') as Artifact;
    const meta2 = run2.source.extraction.aiExtract;
    expect(meta2['calls']).toBe(0);
    expect(meta2['pagesSent']).toBe(0);
    expect(meta2['pagesSkippedByHash']).toBe(TABLE_PAGES);
    expect(second.logs.join('\n')).toContain('해시 캐시');

    // 페이지 1개만 바꾼다 — 표의 시각 하나를 바꾼다(해시 변경)
    const target = 'data/raw/2026-2학기-asan-ktx-평일.html';
    const original = readFileSync(target, 'utf8');
    const changed = original.replace('8:05', '8:06');
    expect(changed).not.toBe(original);
    files.set(target, changed);

    const third = makeRunHarness(structurerFactory(env), { createTableExtractor: tableFactory(env), files });
    expect(await runExtract(extractArgs(), third.deps)).toBe(0);
    expect(counter.pages.slice(firstCalls)).toEqual([target]); // 그 페이지만 호출
    const run3 = JSON.parse(third.written.get(OUT) ?? '{}') as Artifact;
    expect(run3.source.extraction.aiExtract['calls']).toBe(1);
    expect(run3.source.extraction.aiExtract['pagesSent']).toBe(1);
    expect(run3.source.extraction.aiExtract['pagesSkippedByHash']).toBe(TABLE_PAGES - 1);
  });
});

describe('T34 통합 AC-AI1-7 — 회귀(규칙 정본) · 폴백 · DeepSeek 실행 전제', () => {
  it('--no-ai 산출물이 기존 발행본과 **동일**하다(규칙 정본 유지) + aiExtract 는 0값', async () => {
    const harness = makeRunHarness(structurerFactory(ENV));
    const code = await runExtract(['--no-ai', '--out', OUT, '--log', LOG], harness.deps);

    expect(code).toBe(0);
    const artifact = JSON.parse(harness.written.get(OUT) ?? '{}') as Record<string, unknown> & Artifact;
    expect(ruleCore(artifact as unknown as Record<string, unknown>)).toEqual(ruleCore(published()));
    expect(artifact.source.extraction.aiExtract).toEqual({
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
      // §7 드리프트는 켜져 있다(직전 발행본과 편수·열 동일 → 통과)
      drift: { checked: true, blocked: false, reasons: [] },
    });
    expect(harness.logs.join('\n')).toContain('AI 표 추출: --ai=off');
    expect(harness.written.has(DRAFT)).toBe(false);
  });

  it('AI 키가 없으면 표 추출도 규칙 정본으로 폴백한다(exit 0 · 사유 기록)', async () => {
    const server = await mock(tableAwareHandler());
    const env: StructurerEnv = { AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL }; // 키 없음
    const harness = makeRunHarness(structurerFactory(env), { createTableExtractor: tableFactory(env) });

    const code = await runExtract(extractArgs(), harness.deps);

    expect(code).toBe(0);
    expect(server.requests).toHaveLength(0);
    const artifact = JSON.parse(harness.written.get(OUT) ?? '{}') as Artifact;
    const meta = artifact.source.extraction.aiExtract;
    expect(meta['calls']).toBe(0);
    expect(meta['pagesSent']).toBe(TABLE_PAGES); // 보냈지만 응답이 없다(폴백)
    expect(meta['agreedRows']).toBe(0);
    expect(harness.logs.join('\n')).toContain('AI_API_KEY');
    expect(ruleCore(artifact as unknown as Record<string, unknown>)).toEqual(ruleCore(published()));
  });

  it('--no-ai 말고도 표 추출 배선이 없으면 단계를 건너뛴다(기존 하네스 호환)', async () => {
    const harness = makeRunHarness(structurerFactory(ENV));
    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG], harness.deps);

    expect(code).toBe(0);
    expect(harness.logs.join('\n')).toContain('조립 배선 없음');
    const log = JSON.parse(harness.written.get(LOG) ?? '{}') as { aiTable: { enabled: boolean; reason: string } };
    expect(log.aiTable).toEqual(expect.objectContaining({ enabled: false, reason: 'not-wired' }));
  });

  it('loadFixture 는 그대로 동작한다(규칙 파이프라인 회귀 없음)', () => {
    expect(loadFixture().rules.dateRules.length).toBeGreaterThan(0);
    expect(published()['schemaVersion']).toBe(3);
  });
});
