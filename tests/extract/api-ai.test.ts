/**
 * T19 AI 계층 **API 모드** 테스트 — OpenAI 호환 외부 API + 비용·안전 가드.
 *
 * **모의 HTTP 서버만** 쓴다(`tests/extract/mock-ai-server.ts`) — 실 API 호출·과금 0, 실 키 불필요.
 * 어댑터 조립은 실제 코드 경로(`createStructurerFor`, `index.ts` 가 쓰는 그 함수)를 그대로 부른다.
 *
 * 시나리오 커버(태스크 ①~⑦):
 *   ① 정상 응답 → AI 항목 반영  ② 키 없음 → 규칙 전용 폴백 + 경고  ③ 401/500/타임아웃 → 폴백
 *   ④ 스키마 위반 응답 → 항목 폐기(조용한 통과 금지)  ⑤ 인용 불일치 → 발행 중단
 *   ⑥ 결정성(같은 응답 2회 → 동일 산출물)  ⑦ 토큰·입력 상한 초과 잘림 기록
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  API_CHAT_PATH,
  buildPrompt,
  capToPromptLimit,
  createApiStructurer,
  dedupeCandidates,
  estimateTokens,
  parseAiDrafts,
} from '../../tools/extract/ai.js';
import { effectiveProvider, resolveFallbackReason, runExtract } from '../../tools/extract/cli.js';
import type { ExtractDeps } from '../../tools/extract/cli.js';
import type { Candidate } from '../../tools/extract/types.js';
import { createStructurerFor } from '../../tools/extract/structurer.js';
import type { StructurerEnv } from '../../tools/extract/structurer.js';
import { completionBody, startMockApi } from './mock-ai-server.js';
import type { MockApi, MockApiHandler } from './mock-ai-server.js';
import { loadFixture, makeRunHarness } from './support.js';

const OUT = 'tmp/t19-out.json';
const LOG_PATH = 'tmp/t19-run.json';
const NOW = '2026-10-06T09:00:00+09:00';
const MOCK_MODEL = 'mock-model-v1';
const MOCK_KEY = 'test-key-not-real';

const servers: MockApi[] = [];

async function mock(handler: MockApiHandler = () => ({})): Promise<MockApi> {
  const server = await startMockApi(handler);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/**
 * `index.ts` 와 같은 조립 함수를 쓴다(테스트 전용 우회 없음).
 * `extra` 로 비용 가드 임계값만 낮춘다 — 후보 25개를 **한 요청**에 담아 호출 수를 결정적으로 만든다.
 */
function structurerFactory(
  env: StructurerEnv,
  extra: { maxPromptChars?: number; maxCandidatesPerCall?: number } = {},
): ExtractDeps['createStructurer'] {
  return ({ model, noAi, provider }) =>
    createStructurerFor(noAi ? 'off' : provider, {
      model,
      env,
      maxCandidatesPerCall: extra.maxCandidatesPerCall ?? 400,
      ...(extra.maxPromptChars === undefined ? {} : { maxPromptChars: extra.maxPromptChars }),
    });
}

/** 규칙이 설명하지 않는 문장(=`extractedBy: ai` 로 채택되는 대상). T26: 노선 폐지 문장은 더 이상 AI 대상이 아니다 */
function aiTargetCandidate(): Candidate {
  const target = loadFixture().candidates.find((candidate) => candidate.text.startsWith('*소요시간: 등교시 아산역>캠퍼스'));
  if (target === undefined) throw new Error('픽스처에서 AI 대상 후보를 찾지 못했다');
  return target;
}

function apiDraftFor(candidate: Candidate, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateId: candidate.id,
    sourceQuote: candidate.text,
    kind: 'route-change',
    dayTypes: [],
    note: '경유·소요시간 안내(규칙 밖 문장)',
    confidence: 0.9,
    ...override,
  };
}

// ─────────────────────────── 어댑터 계약 ───────────────────────────

describe('T19 API 어댑터 — 설정·요청 계약', () => {
  it('① 정상 응답 → 초안 반영 + 요청이 AI_BASE_URL 의 /chat/completions 로만 나간다', async () => {
    const target = aiTargetCandidate();
    const server = await mock(() => ({ body: completionBody([apiDraftFor(target)]) }));
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: server.baseUrl,
      apiKey: MOCK_KEY,
      maxCandidatesPerCall: 400,
      log: () => {},
    });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('ok');
    expect(result.provider).toBe('api');
    expect(result.model).toBe(MOCK_MODEL);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.sourceQuote).toBe(target.text);
    expect(result.usage.calls).toBe(1);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.truncated).toBe(0);

    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request?.url).toBe(`/v1${API_CHAT_PATH}`);
    expect(request?.auth).toBe(`Bearer ${MOCK_KEY}`);
    expect(request?.body.model).toBe(MOCK_MODEL);
    expect(request?.body.temperature).toBe(0);
    expect(request?.body.stream).toBe(false);
    expect(request?.body.response_format).toEqual({ type: 'json_object' });
    expect(String(request?.body.messages?.[0]?.content)).toContain(target.text);
  });

  it('② 키가 없으면 호출 0회 — 네트워크로 나가지 않고 규칙 전용 사유를 돌려준다', async () => {
    const server = await mock();
    const structurer = createApiStructurer({ model: MOCK_MODEL, baseUrl: server.baseUrl, apiKey: '' });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('unavailable');
    expect(result.drafts).toEqual([]);
    expect(result.error).toContain('AI_API_KEY');
    expect(result.usage.calls).toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it('AI_BASE_URL·AI_MODEL 이 없으면 각각 호출 전에 멈춘다(벤더 기본 도메인 없음)', async () => {
    const noBase = createApiStructurer({ model: MOCK_MODEL, baseUrl: '', apiKey: MOCK_KEY });
    const noModel = createApiStructurer({ model: '', baseUrl: 'http://127.0.0.1:1/v1', apiKey: MOCK_KEY });

    const first = await noBase.structure(loadFixture().candidates);
    const second = await noModel.structure(loadFixture().candidates);

    expect(first.status).toBe('unavailable');
    expect(first.error).toContain('AI_BASE_URL');
    expect(second.status).toBe('unavailable');
    expect(second.error).toContain('AI_MODEL');
    expect(second.usage.calls).toBe(0);
  });

  it('모드→어댑터 조립: off 는 네트워크를 부르지 않고, --model 이 AI_MODEL 을 이긴다', () => {
    const off = createStructurerFor('off', { model: 'ignored', env: { AI_API_KEY: 'x' } });
    const ollama = createStructurerFor('ollama', { model: '', env: {} });
    const cliWins = createStructurerFor('api', { model: 'cli-model', env: { AI_MODEL: 'env-model' } });
    const envFallback = createStructurerFor('api', { model: '', env: { AI_MODEL: 'env-model' } });

    expect(off.model).toBe('ignored');
    expect(ollama.model).toBe('lfm2.5:latest');
    expect(cliWins.model).toBe('cli-model');
    expect(envFallback.model).toBe('env-model');
  });
});

// ─────────────────────────── 실패·재시도·폴백 ───────────────────────────

describe('T19 실패 경로 — 자동 폴백(배치를 죽이지 않는다)', () => {
  it('③ 401 은 재시도 없이 즉시 폴백한다(호출 1회 · 사유에 401)', async () => {
    const server = await mock(() => ({ status: 401, body: { error: 'invalid api key' } }));
    const structurer = createApiStructurer({ model: MOCK_MODEL, baseUrl: server.baseUrl, apiKey: MOCK_KEY });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('unavailable');
    expect(result.drafts).toEqual([]);
    expect(result.error).toContain('401');
    expect(result.usage.calls).toBe(1);
    expect(server.requests).toHaveLength(1);
  });

  it('③ 500 은 1회 재시도 후 폴백한다(호출 2회)', async () => {
    const server = await mock(() => ({ status: 500, body: { error: 'internal' } }));
    const logs: string[] = [];
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: server.baseUrl,
      apiKey: MOCK_KEY,
      log: (line) => logs.push(line),
    });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('unavailable');
    expect(result.error).toContain('500');
    expect(result.usage.calls).toBe(2);
    expect(server.requests).toHaveLength(2);
    expect(logs.join('\n')).toContain('API 재시도');
  });

  it('③ 500 뒤 성공 → 재시도가 살아나 초안을 채택한다(호출 2회 · status ok)', async () => {
    const target = aiTargetCandidate();
    const server = await mock((_request, index) =>
      index === 0 ? { status: 503, body: { error: 'unavailable' } } : { body: completionBody([apiDraftFor(target)]) },
    );
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: server.baseUrl,
      apiKey: MOCK_KEY,
      maxCandidatesPerCall: 400,
    });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('ok');
    expect(result.drafts).toHaveLength(1);
    expect(result.usage.calls).toBe(2);
  });

  it('③ 타임아웃은 예외를 던지지 않고 폴백 사유로 바뀐다', async () => {
    const server = await mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { body: completionBody([]) };
    });
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: server.baseUrl,
      apiKey: MOCK_KEY,
      timeoutMs: 20,
    });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('unavailable');
    expect(result.error).not.toBeNull();
    expect(result.usage.calls).toBeGreaterThanOrEqual(1);
  });

  it('③ 서버가 죽어 있으면(연결 실패) 폴백하고 예외가 새지 않는다', async () => {
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: MOCK_KEY,
      retries: 0,
    });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('unavailable');
    expect(result.drafts).toEqual([]);
    expect(result.error).not.toBeNull();
  });
});

// ─────────────────────────── 응답 스키마·환각 방어 ───────────────────────────

describe('T19 응답 스키마 방어(파싱 단계)', () => {
  it('④ JSON 이 아닌 응답은 초안 0건으로 버린다(조용한 통과 금지)', async () => {
    const server = await mock(() => ({ body: { choices: [{ message: { content: '설명만 하고 JSON 이 없다' } }] } }));
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: server.baseUrl,
      apiKey: MOCK_KEY,
      maxCandidatesPerCall: 400,
    });

    const result = await structurer.structure(loadFixture().candidates);

    expect(result.status).toBe('ok');
    expect(result.drafts).toEqual([]);
    expect(result.usage.calls).toBe(1);
  });

  it('④ 필수 필드(sourceQuote·kind)가 없는 항목은 파싱에서 버린다', () => {
    expect(parseAiDrafts('{"rules":[{"candidateId":"c1","kind":"no-service"}]}')).toEqual([]);
    expect(parseAiDrafts('{"rules":[{"candidateId":"c1","sourceQuote":"문장"}]}')).toEqual([]);
    const kept = parseAiDrafts('{"rules":[{"candidateId":"c1","sourceQuote":"문장","kind":"no-service","confidence":0.9}]}');
    expect(kept).toHaveLength(1);
    expect(kept[0]?.confidence).toBeCloseTo(0.9);
  });

  it('④ 배열/코드펜스 응답도 받되 형식이 깨진 값은 기본값으로 정규화한다', () => {
    expect(parseAiDrafts('```json\n[{"sourceQuote":"문장","kind":"route-change","confidence":"0.7","dayTypes":["토요일"]}]\n```')).toHaveLength(1);
    const [draft] = parseAiDrafts('[{"sourceQuote":"문장","kind":"route-change","confidence":"이상한 값"}]');
    expect(draft?.confidence).toBe(0.5);
    expect(draft?.dayTypes).toEqual([]);
  });

  it('⑤ 원문에 없는 문장(환각)은 병합 단계에서 치명 오류로 잡힌다 — 발행 중단은 통합 테스트에서 확인', () => {
    const hallucinated = parseAiDrafts('{"rules":[{"candidateId":null,"sourceQuote":"원본에 없는 위조 문장","kind":"no-service","confidence":1}]}');
    expect(hallucinated).toHaveLength(1);
    const { sources } = loadFixture();
    expect(sources.some((source) => source.text.includes('원본에 없는 위조 문장'))).toBe(false);
  });
});

// ─────────────────────────── 비용·안전 가드 ───────────────────────────

describe('T19 비용 가드 — 입력 상한 · 캐시 · 중복 제거 · 토큰 추정', () => {
  it('⑦ 입력 길이 상한을 넘으면 후보를 잘라내고 truncated 로 기록한다', async () => {
    const { candidates } = loadFixture();
    const server = await mock(() => ({ body: completionBody([]) }));
    const logs: string[] = [];
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: server.baseUrl,
      apiKey: MOCK_KEY,
      maxPromptChars: 1_200,
      log: (line) => logs.push(line),
    });

    const result = await structurer.structure(candidates);

    expect(result.status).toBe('ok');
    expect(result.usage.truncated).toBeGreaterThan(0);
    expect(logs.join('\n')).toContain('입력 길이 상한 초과');
    for (const request of server.requests) {
      expect(String(request.body.messages?.[0]?.content).length).toBeLessThanOrEqual(1_200);
    }
    const fullPromptLength = buildPrompt(candidates).length;
    expect(Number(server.requests[0]?.body.messages?.[0]?.content?.toString().length)).toBeLessThan(fullPromptLength);
  });

  it('⑦ 상한이 한 문장보다 작아도 빈 요청을 보내지 않고 잘림으로만 기록한다', async () => {
    const { candidates } = loadFixture();
    const capped = capToPromptLimit(candidates.slice(0, 1), 10);
    expect(capped.group).toHaveLength(0);
    expect(capped.dropped).toBe(1);
    expect(estimateTokens('가나다라')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });

  it('같은 프롬프트를 두 번 보내지 않는다(캐시 — 호출 1회 · 결과 동일)', async () => {
    const target = aiTargetCandidate();
    const server = await mock(() => ({ body: completionBody([apiDraftFor(target)]) }));
    const structurer = createApiStructurer({
      model: MOCK_MODEL,
      baseUrl: server.baseUrl,
      apiKey: MOCK_KEY,
      maxCandidatesPerCall: 400,
    });
    const { candidates } = loadFixture();

    const first = await structurer.structure(candidates);
    const second = await structurer.structure(candidates);

    expect(server.requests).toHaveLength(1);
    expect(JSON.stringify(second.drafts)).toBe(JSON.stringify(first.drafts));
    expect(second.usage.calls).toBe(0);
  });

  it('같은 문장은 한 번만 보낸다(후보 중복 제거)', () => {
    const { candidates } = loadFixture();
    const duplicated: Candidate[] = [...candidates, ...candidates];
    expect(dedupeCandidates(duplicated)).toHaveLength(candidates.length);
    expect(dedupeCandidates([duplicated[0]!, duplicated[0]!])).toHaveLength(1);
  });
});

// ─────────────────────────── runExtract 통합(모의 서버) ───────────────────────────

describe('T19 runExtract 통합 — 모의 서버', () => {
  it('① 정상 응답 → extractedBy=ai 항목 + extraction.provider=api·호출 수·토큰 기록', async () => {
    const target = aiTargetCandidate();
    const server = await mock(() => ({ body: completionBody([apiDraftFor(target)]) }));
    const harness = makeRunHarness(
      structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY }),
    );

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as {
      dateRules: { extractedBy: string; sourceQuote: string; needsReview: boolean }[];
      source: { extraction: Record<string, unknown> };
    };
    const aiRules = json.dateRules.filter((rule) => rule.extractedBy === 'ai');
    expect(aiRules).toHaveLength(1);
    expect(aiRules[0]?.sourceQuote).toBe(target.text);
    const extraction = json.source.extraction;
    expect(extraction['provider']).toBe('api');
    expect(extraction['model']).toBe(MOCK_MODEL);
    expect(extraction['calls']).toBe(1);
    expect(extraction['truncated']).toBe(0);
    expect(extraction['fallbackReason']).toBeNull();
    expect(Number(extraction['promptTokens'])).toBeGreaterThan(0);
    expect(Number(extraction['totalTokens'])).toBeGreaterThanOrEqual(Number(extraction['promptTokens']));
    expect(server.requests).toHaveLength(1);
  });

  it('② 키 없음 → 규칙 전용으로 폴백하고 경고를 남기되 발행은 계속한다(exit 0)', async () => {
    const server = await mock();
    const harness = makeRunHarness(structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL }));

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(harness.logs.join('\n')).toContain('⚠️ AI 보강 불가');
    expect(harness.logs.join('\n')).toContain('AI_API_KEY');
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as {
      dateRules: { extractedBy: string }[];
      source: { extraction: Record<string, unknown> };
    };
    expect(json.dateRules.every((rule) => rule.extractedBy === 'rule')).toBe(true);
    expect(json.source.extraction['provider']).toBe('rule-only');
    expect(json.source.extraction['aiStatus']).toBe('unavailable');
    expect(String(json.source.extraction['fallbackReason'])).toContain('AI_API_KEY');
    expect(json.source.extraction['calls']).toBe(0);
  });

  it('③ 401 → 규칙 전용 폴백 + 경고 + 정상 발행(모의 서버, 실 키 불필요)', async () => {
    const server = await mock(() => ({ status: 401, body: { error: 'nope' } }));
    const harness = makeRunHarness(
      structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY }),
    );

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    expect(harness.written.has(OUT)).toBe(true);
    expect(harness.logs.join('\n')).toContain('규칙 전용으로 계속한다');
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as { source: { extraction: Record<string, unknown> } };
    expect(json.source.extraction['provider']).toBe('rule-only');
    expect(String(json.source.extraction['fallbackReason'])).toContain('401');
  });

  it('④ 알 수 없는 kind 응답 → 해당 항목만 폐기하고 로그에 사유를 남긴다(발행 계속)', async () => {
    const target = aiTargetCandidate();
    const server = await mock(() => ({ body: completionBody([apiDraftFor(target, { kind: 'bogus-kind' })]) }));
    const harness = makeRunHarness(
      structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY }),
    );

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    const logs = harness.logs.join('\n');
    expect(logs).toContain('AI 초안 버림');
    expect(logs).toContain('알 수 없는 kind');
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as {
      dateRules: { extractedBy: string }[];
      source: { extraction: Record<string, unknown> };
    };
    expect(json.dateRules.some((rule) => rule.extractedBy === 'ai')).toBe(false);
    expect(json.source.extraction['aiDropped']).toBe(1);
    expect(json.source.extraction['aiAccepted']).toBe(0);
  });

  it('④ 낮은 confidence → 발행은 하되 needsReview 로 표시한다', async () => {
    const target = aiTargetCandidate();
    const server = await mock(() => ({ body: completionBody([apiDraftFor(target, { confidence: 0.4 })]) }));
    const harness = makeRunHarness(
      structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY }),
    );

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as {
      dateRules: { extractedBy: string; needsReview: boolean }[];
      source: { extraction: Record<string, unknown> };
    };
    const aiRule = json.dateRules.find((rule) => rule.extractedBy === 'ai');
    expect(aiRule?.needsReview).toBe(true);
    // 규칙 기준선에도 needsReview 1건(방학 term — 기간 미기재)이 있으므로 AI 항목까지 2건 이상
    expect(Number(json.source.extraction['needsReview'])).toBeGreaterThanOrEqual(2);
    expect(harness.logs.join('\n')).toContain('needsReview');
  });

  it('⑤ 인용 불일치(원문에 없는 문장) → 발행 중단(exit 1 · 산출물 0건)', async () => {
    const server = await mock(() =>
      ({ body: completionBody([{ candidateId: null, sourceQuote: '원본에 없는 위조 문장', kind: 'no-service', confidence: 1 }]) }),
    );
    const harness = makeRunHarness(
      structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY }),
    );

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(1);
    expect(harness.written.has(OUT)).toBe(false);
    expect(harness.errors.join('\n')).toContain('인용 검증 실패');
    const log = JSON.parse(harness.written.get(LOG_PATH) ?? '{}') as { output: string | null; provider: string };
    expect(log.output).toBeNull();
    expect(log.provider).toBe('api');
  });

  it('⑧ 후보 인용이 부분 일치로 복구되면 aiRepairs 로 기록된다(기존 복구 경로 유지)', async () => {
    const target = aiTargetCandidate();
    const server = await mock(() =>
      ({ body: completionBody([apiDraftFor(target, { candidateId: null, sourceQuote: target.text.replace('15분 소요', '15 분 정도 소요') })]) }),
    );
    const harness = makeRunHarness(
      structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY }),
    );

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as { source: { extraction: Record<string, unknown> } };
    expect(Number(json.source.extraction['aiRepairs'])).toBeGreaterThanOrEqual(1);
  });

  it('⑥ 결정성 — 같은 모의 응답으로 2회 실행하면 발행 바이트가 같다', async () => {
    const target = aiTargetCandidate();
    const server = await mock(() => ({ body: completionBody([apiDraftFor(target)]) }));
    const env: StructurerEnv = { AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY };
    const first = makeRunHarness(structurerFactory(env));
    const second = makeRunHarness(structurerFactory(env));

    const codeA = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], first.deps);
    const codeB = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], second.deps);

    expect(codeA).toBe(0);
    expect(codeB).toBe(0);
    expect(second.written.get(OUT)).toBe(first.written.get(OUT));
  });

  it('⑦ 입력 상한 초과가 산출물 extraction.truncated 에 기록된다(발행은 계속)', async () => {
    const server = await mock(() => ({ body: completionBody([]) }));
    const harness = makeRunHarness(
      structurerFactory({ AI_BASE_URL: server.baseUrl, AI_MODEL: MOCK_MODEL, AI_API_KEY: MOCK_KEY }, { maxPromptChars: 1_200 }),
    );

    const code = await runExtract(['--ai=api', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    expect(harness.logs.join('\n')).toMatch(/AI 비용 가드: 호출 [1-9]\d*회 .*잘림 [1-9]\d*건/);
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as { source: { extraction: Record<string, unknown> } };
    expect(Number(json.source.extraction['truncated'])).toBeGreaterThan(0);
    expect(json.source.extraction['provider']).toBe('api');
  });

  it('--ai=off 경로는 모의 서버 없이 동일하게 규칙 전용으로 발행된다(회귀 없음)', async () => {
    const harness = makeRunHarness(structurerFactory({ AI_BASE_URL: 'http://127.0.0.1:9/v1', AI_API_KEY: 'x' }));

    const code = await runExtract(['--ai=off', '--out', OUT, '--log', LOG_PATH, '--now', NOW], harness.deps);

    expect(code).toBe(0);
    const json = JSON.parse(harness.written.get(OUT) ?? '{}') as { source: { extraction: Record<string, unknown> } };
    expect(json.source.extraction['provider']).toBe('rule-only');
    expect(json.source.extraction['aiStatus']).toBe('disabled');
    expect(json.source.extraction['fallbackReason']).toBeNull();
    expect(json.source.extraction['calls']).toBe(0);
  });

  it('provider·fallbackReason 헬퍼 — 의도된 off 는 폴백 사유가 아니다', () => {
    const cases: readonly (readonly [Parameters<typeof effectiveProvider>[0], Parameters<typeof effectiveProvider>[1], string])[] = [
      ['api', 'ok', 'api'],
      ['ollama', 'ok', 'ollama'],
      ['api', 'unavailable', 'rule-only'],
      ['api', 'error', 'rule-only'],
      ['api', 'disabled', 'rule-only'],
      ['ollama', 'unavailable', 'rule-only'],
      ['ollama', 'error', 'rule-only'],
      ['off', 'disabled', 'rule-only'],
      ['off', 'unavailable', 'rule-only'],
    ];
    for (const [mode, status, expected] of cases) {
      expect(effectiveProvider(mode, status)).toBe(expected);
    }
    expect(resolveFallbackReason('off', 'disabled', null)).toBeNull();
    expect(resolveFallbackReason('api', 'ok', null)).toBeNull();
    expect(resolveFallbackReason('api', 'unavailable', 'AI_API_KEY 가 없다')).toContain('AI_API_KEY');
    expect(resolveFallbackReason('api', 'error', null)).toBe('AI 사용 불가(error)');
  });
});
