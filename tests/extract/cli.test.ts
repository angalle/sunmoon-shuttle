/**
 * T16 CLI·AI 테스트 — 인자 파싱 · `--no-ai`/`--dry-run`/`--inject-fabricated` · 폴백 · 프롬프트/파싱.
 *
 * 실 네트워크를 쓰지 않는다: structurer 는 주입된 가짜다(`ExtractDeps.createStructurer`).
 */

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseExtractArgs, runExtract } from '../../tools/extract/cli.js';
import type { ExtractDeps } from '../../tools/extract/cli.js';
import {
  buildPrompt,
  createDisabledStructurer,
  extractJson,
  parseAiDrafts,
  promptTemplateSha256,
} from '../../tools/extract/ai.js';
import { fakeStructurer, loadFixture } from './support.js';

const FIXED_NOW = '2026-10-06T09:00:00+09:00';

interface Harness {
  readonly written: Map<string, string>;
  readonly logs: string[];
  readonly errors: string[];
  readonly deps: ExtractDeps;
}

function harness(aiStatus: 'ok' | 'unavailable' = 'ok', drafts: readonly unknown[] = []): Harness {
  const written = new Map<string, string>();
  const logs: string[] = [];
  const errors: string[] = [];
  const deps: ExtractDeps = {
    listFiles: (dir) => readdirSync(dir),
    readTextFile: (path) => readFileSync(path, 'utf8'),
    writeTextFile: (path, text) => written.set(path, text),
    nowIso: () => FIXED_NOW,
    nowMs: () => 1_000,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    createStructurer: ({ model, noAi }) =>
      noAi ? createDisabledStructurer(model) : (fakeStructurer(drafts, aiStatus) as unknown as ReturnType<ExtractDeps['createStructurer']>),
  };
  return { written, logs, errors, deps };
}

const OUT = 'tmp/test-out.json';
const LOG = 'tmp/test-run.json';

describe('T16 CLI 인자', () => {
  it('기본값 — 출력 data/timetable.json · 로그 .session-notes/T16-extract-run.json · AI 모드 api(T19 신규 기본)', () => {
    expect(parseExtractArgs([])).toEqual({
      files: [],
      out: 'data/timetable.json',
      logPath: '.session-notes/T16-extract-run.json',
      termPages: [],
      noAi: false,
      aiMode: 'api',
      model: '',
      dryRun: false,
      injectFabricated: false,
      now: null,
    });
  });

  it('--no-ai · --dry-run · --model=<이름> · --out/--log/--now 를 읽는다', () => {
    const args = parseExtractArgs([
      '--local',
      '--no-ai',
      '--dry-run',
      '--model=qwen3-vl:4b',
      '--out',
      OUT,
      '--log',
      LOG,
      '--now',
      FIXED_NOW,
      'data/raw/a.html',
    ]);
    expect(args).toMatchObject({ noAi: true, aiMode: 'off', dryRun: true, model: 'qwen3-vl:4b', out: OUT, logPath: LOG, now: FIXED_NOW });
    expect(args.files).toEqual(['data/raw/a.html']);
  });

  it('T19 --ai=api|ollama|off · --ai <모드> 를 읽고 잘못된 값은 던진다', () => {
    expect(parseExtractArgs(['--ai=api'])).toMatchObject({ aiMode: 'api', noAi: false });
    expect(parseExtractArgs(['--ai=ollama'])).toMatchObject({ aiMode: 'ollama', noAi: false });
    expect(parseExtractArgs(['--ai=off'])).toMatchObject({ aiMode: 'off', noAi: true });
    expect(parseExtractArgs(['--ai', 'ollama'])).toMatchObject({ aiMode: 'ollama', noAi: false });
    expect(parseExtractArgs(['--no-ai'])).toMatchObject({ aiMode: 'off', noAi: true });
    expect(() => parseExtractArgs(['--ai=auto'])).toThrow(/api\|ollama\|off/);
    expect(() => parseExtractArgs(['--ai'])).toThrow(/모드가 필요/);
  });

  it('--model 을 공백으로 넘겨도 되고 값이 없으면 던진다', () => {
    expect(parseExtractArgs(['--model', 'lfm2.5:latest']).model).toBe('lfm2.5:latest');
    expect(parseExtractArgs([]).model).toBe('');
    expect(() => parseExtractArgs(['--model'])).toThrow(/모델명/);
    expect(() => parseExtractArgs(['--now', '2026-10-06'])).toThrow(/ISO8601/);
    expect(() => parseExtractArgs(['--bogus'])).toThrow(/알 수 없는 옵션/);
  });
});

describe('T16 CLI 실행', () => {
  it('--no-ai --dry-run → exit 0, 발행 파일 0건(로그만 기록)', async () => {
    const h = harness();
    const code = await runExtract(['--no-ai', '--dry-run', '--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(0);
    expect(h.written.has(OUT)).toBe(false);
    expect(h.written.has(LOG)).toBe(true);
    expect(h.logs.join('\n')).toContain('--dry-run: 검증만 수행했다');
  });

  it('--no-ai → 계약 JSON 발행(PASS) · schemaVersion 3 · v1 필드 보존', async () => {
    const h = harness();
    const code = await runExtract(['--no-ai', '--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(0);
    const json = JSON.parse(h.written.get(OUT) ?? '{}') as Record<string, unknown>;
    expect(json['schemaVersion']).toBe(3);
    expect(Array.isArray(json['routes'])).toBe(true);
    expect((json['source'] as Record<string, unknown>)['contentHash']).toMatch(/^sha256:/);
    const extraction = (json['source'] as Record<string, { aiStatus: string }>)['extraction'];
    expect(extraction?.aiStatus).toBe('disabled');
    expect(h.logs.join('\n')).toContain('갭 6 중복 공지 제거');
  });

  it('Ollama 무응답/모델 없음 → 경고 후 규칙 전용으로 계속(배치를 죽이지 않는다)', async () => {
    const h = harness('unavailable');
    const code = await runExtract(['--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(0);
    expect(h.logs.join('\n')).toContain('AI 보강 불가(unavailable)');
    expect(h.written.has(OUT)).toBe(true);
  });

  it('AI 초안이 규칙 밖 문장을 채택하면 extractedBy=ai 항목이 산출물에 들어간다', async () => {
    const { candidates } = loadFixture();
    const target = candidates.find((candidate) => candidate.text.startsWith('*소요시간: 등교시 아산역>캠퍼스'));
    expect(target).toBeDefined();
    const h = harness('ok', [
      { candidateId: target!.id, sourceQuote: target!.text, kind: 'route-change', dayTypes: [], note: '경유·소요시간 안내(규칙 밖 문장)', confidence: 0.9 },
    ]);
    const code = await runExtract(['--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(0);
    const json = JSON.parse(h.written.get(OUT) ?? '{}') as { dateRules: { extractedBy: string; sourceQuote: string }[] };
    const ai = json.dateRules.filter((rule) => rule.extractedBy === 'ai');
    expect(ai).toHaveLength(1);
    expect(ai[0]?.sourceQuote).toBe(target!.text);
    const log = JSON.parse(h.written.get(LOG) ?? '{}') as { aiAccepted: number; model: string; promptTemplateSha256: string };
    expect(log.aiAccepted).toBe(1);
    expect(log.model).toBe('fake-model:test');
    expect(log.promptTemplateSha256).toMatch(/^sha256:/);
  });

  it('T26: 노선 폐지 문장을 AI 가 dateRule 로 내면 폐기되고 발행은 계속된다(사유 로그)', async () => {
    const { candidates } = loadFixture();
    const target = candidates.find((candidate) => candidate.text.startsWith('천안캠퍼스(2024-2학기'));
    expect(target).toBeDefined();
    const h = harness('ok', [
      { candidateId: target!.id, sourceQuote: target!.text, kind: 'no-service', dayTypes: [], note: '노선 중단(2024-2학기부터)', confidence: 0.9 },
    ]);
    const code = await runExtract(['--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(0);
    const log = JSON.parse(h.written.get(LOG) ?? '{}') as { aiAccepted: number; aiDropped: number; fatalIssues: unknown[] };
    expect(log.fatalIssues).toHaveLength(0);
    expect(log.aiAccepted).toBe(0);
    expect(log.aiDropped).toBe(1);
    expect(h.logs.join('\n')).toContain('노선 폐지·중단 서술은 dateRule 이 아니다');
  });

  it('--inject-fabricated → exit 1, 발행 파일 없음(위조 주입 차단)', async () => {
    const h = harness();
    const code = await runExtract(['--no-ai', '--inject-fabricated', '--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(1);
    expect(h.written.has(OUT)).toBe(false);
    expect(h.errors.join('\n')).toContain('인용 검증 실패');
  });

  it('검증 실패(치명) 시 로그에 fatalIssues 가 기록된다', async () => {
    const h = harness();
    await runExtract(['--no-ai', '--inject-fabricated', '--out', OUT, '--log', LOG], h.deps);
    const log = JSON.parse(h.written.get(LOG) ?? '{}') as { fatalIssues: unknown[]; output: string | null };
    expect(log.fatalIssues.length).toBeGreaterThan(0);
    expect(log.output).toBeNull();
  });

  it('스냅샷 파일이 하나도 없으면 exit 1(조용한 빈 발행 금지)', async () => {
    const h = harness();
    const deps: ExtractDeps = { ...h.deps, listFiles: () => [] };
    const code = await runExtract(['--out', OUT, '--log', LOG], deps);
    expect(code).toBe(1);
    expect(h.errors.join('\n')).toContain('스냅샷 파일이 없습니다');
  });
});

describe('T16 프롬프트 · 응답 파싱', () => {
  it('프롬프트에 후보 id/문장과 금지 규칙(수치 생성 금지·그대로 인용)이 들어간다', () => {
    const prompt = buildPrompt(loadFixture().candidates.slice(0, 3));
    expect(prompt).toContain('c001.');
    expect(prompt).toContain('한 글자도 바꾸지 않고 그대로');
    expect(prompt).toContain('수치는 절대 만들지 않는다');
    expect(promptTemplateSha256()).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('코드펜스/설명이 섞여도 JSON 을 꺼낸다 · 형식 위반 항목은 버린다', () => {
    expect(extractJson('```json\n{"rules":[]}\n```')).toEqual({ rules: [] });
    const drafts = parseAiDrafts('설명\n{"rules":[{"candidateId":"c1","sourceQuote":"문장","kind":"no-service","confidence":"0.8"},{"kind":"no-service"}]}');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.confidence).toBeCloseTo(0.8);
  });

  it('--no-ai structurer 는 네트워크를 부르지 않는다(disabled)', async () => {
    const result = await createDisabledStructurer('lfm2.5:latest').structure([]);
    expect(result.status).toBe('disabled');
    expect(result.drafts).toEqual([]);
  });
});
