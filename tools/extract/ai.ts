/**
 * AI 보강 추출 — **두 어댑터**(같은 포트 `AiStructurer`):
 *   ① `createApiStructurer`    : 외부 **OpenAI 호환 API**(`AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`) — 기본 경로
 *   ② `createOllamaStructurer` : 로컬 Ollama(`http://127.0.0.1:11434`) — 대안 경로(과금 0)
 * 그리고 `createDisabledStructurer`(=`--ai=off`/`--no-ai`) — 네트워크를 아예 부르지 않는다.
 *
 * 역할 분담(FR-A2): AI 는 **규칙이 못 잡은 문장의 분류만** 한다.
 *   - AI 가 만들 수 있는 것: `kind` · `dayTypes` · `note` · `confidence` (+ 원문 인용)
 *   - AI 가 **만들 수 없는 것**: 날짜·시각·분·행 수 — 수치는 전부 규칙(`rules.ts`)이 만든다.
 * 프롬프트가 그 규칙을 강제하고, 검증기(`validate.ts`·`merge.ts`)가 결과를 다시 확인한다.
 *
 * 폴백(FR-A6): 키 없음 · base URL 없음 · 401/403 · 타임아웃 · 5xx(1회 재시도 후) 면
 *   **임의 설치·우회를 시도하지 않고** `unavailable` 을 돌려주고 호출측이 규칙 전용으로 진행한다
 *   (경고 기록 — 배치를 죽이지 않는다).
 *
 * 비용·안전 가드(NFR-A4):
 *   - 입력 길이 상한(`maxPromptChars`, 기본 8000자): 초과 시 **후보 문장을 잘라내고**(문장 단위 —
 *     부분 문자열을 자르면 `sourceQuote` 계약이 깨진다) 잘림 수를 `usage.truncated` 에 기록한다.
 *   - 실패 시 **재시도 1회**(429·5xx·네트워크/타임아웃 한정. 4xx 인증·요청 오류는 재시도하지 않는다).
 *   - **같은 실행에서 같은 문장을 두 번 보내지 않는다**: 문장 텍스트 중복 제거 + 프롬프트 캐시.
 *   - 호출 수·대략 토큰 수를 `usage` 에 기록한다(토큰은 **추정치** — `estimateTokens`).
 *
 * HTTP 는 Node 내장 `fetch` 만 쓴다(런타임 의존성 0). 벤더 도메인은 코드에 없다 — `AI_BASE_URL` 로만 나간다.
 */

import { createHash } from 'node:crypto';

import { DATE_RULE_KINDS } from './types.js';
import type { AiProvider, AiRuleDraft, AiStructureResult, AiStructurer, AiUsage, Candidate } from './types.js';

export const DEFAULT_MODEL = 'lfm2.5:latest';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
/** 모델 응답 대기 상한(ms) — 초과 시 폴백 */
export const DEFAULT_TIMEOUT_MS = 180_000;
/** OpenAI 호환 API 응답 대기 상한(ms) — 원격이므로 로컬보다 짧게 잡는다 */
export const DEFAULT_API_TIMEOUT_MS = 60_000;
/** 한 번에 모델에 넘기는 최대 후보 수(초과분은 호출측이 나눠 부른다) */
export const MAX_CANDIDATES_PER_CALL = 24;
/** 요청 1건의 입력 길이 상한(문자) — 초과 시 후보 문장을 잘라내고 기록한다 */
export const MAX_PROMPT_CHARS = 8_000;
/** 실패 시 재시도 횟수(최초 시도 1 + 재시도 1) */
export const MAX_API_RETRIES = 1;
/** OpenAI 호환 chat completions 경로 */
export const API_CHAT_PATH = '/chat/completions';

/** 프롬프트 템플릿 — 해시가 산출물·로그에 기록된다(재현성). `{{CANDIDATES}}` 만 치환한다. */
export const PROMPT_TEMPLATE = [
  '너는 대학 셔틀버스 원본 페이지의 문장을 분류하는 도구다.',
  '',
  '규칙(반드시 지킨다):',
  '1) 아래 "후보 문장" 목록에 있는 문장만 다룬다. 목록 밖의 문장을 만들지 않는다.',
  '2) sourceQuote 에는 그 문장을 **한 글자도 바꾸지 않고 그대로** 복사한다(공백·기호 포함).',
  '3) 날짜·시각·소요시간(분) 같은 **수치는 절대 만들지 않는다**. 문장에 적힌 수치를 새로 계산하지도 않는다.',
  '4) kind 는 다음 중 하나만 쓴다:',
  `   ${DATE_RULE_KINDS.join(' | ')}`,
  '5) dayTypes 는 weekday | saturday | sunday 중 해당하는 것만. 모르면 빈 배열.',
  '6) 확실하지 않으면 confidence 를 0.5 이하로 낮춘다. 모르면 항목을 아예 만들지 않는다.',
  '7) 분류할 수 없는 문장(안내·문의·링크 등)은 결과에서 뺀다.',
  '',
  '출력은 JSON 하나만. 형식:',
  '{"rules":[{"candidateId":"c001","sourceQuote":"...","kind":"no-service","dayTypes":[],"note":"짧은 설명","confidence":0.9}]}',
  '',
  '후보 문장:',
  '{{CANDIDATES}}',
].join('\n');

export function buildPrompt(candidates: readonly Candidate[]): string {
  const lines = candidates.map((candidate) => `${candidate.id}. ${candidate.text}`);
  return PROMPT_TEMPLATE.replace('{{CANDIDATES}}', lines.join('\n'));
}

export function promptTemplateSha256(): string {
  return `sha256:${createHash('sha256').update(PROMPT_TEMPLATE, 'utf8').digest('hex')}`;
}

/**
 * 토큰 수 **추정**(NFR-A4 비용 추적용 — 정확한 과금값이 아니다).
 * 한글·영문 혼합 문서 기준 1 토큰 ≈ 2 문자 휴리스틱을 쓴다(보수적으로 크게 잡지 않는다).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 어댑터 내부용 가변 카운터(`AiUsage` 는 발행물 계약이라 readonly 다) */
export interface AiUsageCounters {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  truncated: number;
}

export function newUsageCounters(): AiUsageCounters {
  return { calls: 0, promptTokens: 0, completionTokens: 0, truncated: 0 };
}

export function emptyUsage(): AiUsage {
  return { ...newUsageCounters(), totalTokens: 0 };
}

function withUsage(usage: AiUsageCounters): AiUsage {
  return { ...usage, totalTokens: usage.promptTokens + usage.completionTokens };
}

/** 모델 응답에서 JSON 을 관용적으로 꺼낸다(코드펜스·앞뒤 설명 허용). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) {
      const arrayStart = trimmed.indexOf('[');
      const arrayEnd = trimmed.lastIndexOf(']');
      if (arrayStart < 0 || arrayEnd <= arrayStart) return null;
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asConfidence(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return Math.min(1, Math.max(0, num));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

/** 모델 응답 파싱 — `{rules:[…]}` / `[…]` / `{dateRules:[…]}` 를 모두 받는다. 형식 위반은 버린다. */
export function parseAiDrafts(raw: string): AiRuleDraft[] {
  const payload = extractJson(raw);
  const list = Array.isArray(payload)
    ? payload
    : payload !== null && typeof payload === 'object' && Array.isArray((payload as { rules?: unknown }).rules)
      ? ((payload as { rules: unknown[] }).rules as unknown[])
      : payload !== null && typeof payload === 'object' && Array.isArray((payload as { dateRules?: unknown }).dateRules)
        ? ((payload as { dateRules: unknown[] }).dateRules as unknown[])
        : [];
  const drafts: AiRuleDraft[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sourceQuote = asString(record['sourceQuote']) ?? asString(record['quote']) ?? asString(record['text']);
    const kind = asString(record['kind']);
    if (sourceQuote === null || kind === null) continue;
    const note = asString(record['note']);
    drafts.push({
      candidateId: asString(record['candidateId']) ?? asString(record['id']),
      sourceQuote,
      kind,
      dayTypes: asStringArray(record['dayTypes']),
      note,
      confidence: asConfidence(record['confidence']),
    });
  }
  return drafts;
}

/** 후보를 프롬프트 길이 상한에 맞춰 **문장 단위로** 잘라낸다(부분 문자열 절단 금지 — 인용 계약). */
export function capToPromptLimit(
  candidates: readonly Candidate[],
  maxPromptChars: number,
): { readonly group: readonly Candidate[]; readonly dropped: number } {
  let current: readonly Candidate[] = [...candidates];
  let dropped = 0;
  while (current.length > 0 && buildPrompt(current).length > maxPromptChars) {
    current = current.slice(0, -1);
    dropped += 1;
  }
  return { group: current, dropped };
}

/** 같은 실행에서 같은 문장을 두 번 보내지 않도록 문장 텍스트 기준으로 중복을 제거한다. */
export function dedupeCandidates(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.text)) continue;
    seen.add(candidate.text);
    unique.push(candidate);
  }
  return unique;
}

export function chunkCandidates(candidates: readonly Candidate[], size: number): Candidate[][] {
  const groups: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += size) {
    groups.push(candidates.slice(i, i + size) as Candidate[]);
  }
  return groups;
}

// ─────────────────────────── ① 외부 API(OpenAI 호환) ───────────────────────────

export interface ApiStructurerOptions {
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** `AI_API_KEY` — 로그·산출물에 절대 남기지 않는다 */
  readonly apiKey?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxPromptChars?: number | undefined;
  readonly maxCandidatesPerCall?: number | undefined;
  readonly retries?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly nowMs?: (() => number) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** OpenAI 호환 오류 — 4xx(인증·요청)는 재시도해도 소용없고, 429·5xx 는 재시도 가치가 있다. */
export class ApiHttpError extends Error {
  public readonly status: number;

  public constructor(status: number, statusText: string) {
    super(`HTTP ${String(status)}${statusText === '' ? '' : ` ${statusText}`}`);
    this.name = 'ApiHttpError';
    this.status = status;
  }

  public get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiHttpError) return error.retryable;
  // 타임아웃(AbortError)·네트워크 오류는 재시도한다
  return true;
}

interface ApiChatPayload {
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
}

/**
 * 외부 OpenAI 호환 API 구조화 어댑터.
 * 설정이 비어 있으면(키·base URL·모델) **호출하지 않고** `unavailable` 로 끝난다(규칙 전용 폴백).
 */
export function createApiStructurer(options: ApiStructurerOptions = {}): AiStructurer {
  const model = options.model ?? '';
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const apiKey = options.apiKey ?? '';
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const maxPromptChars = options.maxPromptChars ?? MAX_PROMPT_CHARS;
  const maxCandidatesPerCall = options.maxCandidatesPerCall ?? MAX_CANDIDATES_PER_CALL;
  const retries = options.retries ?? MAX_API_RETRIES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const nowMs = options.nowMs ?? (() => Date.now());
  const log = options.log ?? (() => {});

  const provider: AiProvider = 'api';
  /**
   * 프롬프트 → 응답 캐시 — **어댑터 수명 동안 유지**된다(같은 실행에서 같은 문장을 두 번 보내지 않는다).
   * 어댑터는 실행 1회당 1개 만들어지므로(`structurer.ts`) 런 전체가 캐시 범위다.
   */
  const cache = new Map<string, string>();

  return {
    model,
    promptTemplateSha256: promptTemplateSha256(),
    async structure(candidates: readonly Candidate[]): Promise<AiStructureResult> {
      const started = nowMs();
      const usage = newUsageCounters();
      const finish = (
        status: AiStructureResult['status'],
        drafts: AiRuleDraft[],
        raw: string,
        error: string | null,
      ): AiStructureResult => ({
        status,
        provider,
        model,
        durationMs: Math.round(nowMs() - started),
        drafts,
        raw,
        error,
        usage: withUsage(usage),
      });

      if (candidates.length === 0) return finish('ok', [], '', null);
      if (apiKey === '') {
        return finish('unavailable', [], '', 'AI_API_KEY 가 없다 — 규칙 전용으로 폴백한다(--ai=off 와 같은 경로)');
      }
      if (baseUrl === '') {
        return finish('unavailable', [], '', 'AI_BASE_URL 이 없다 — 규칙 전용으로 폴백한다');
      }
      if (model === '') {
        return finish('unavailable', [], '', 'AI_MODEL(--model)이 없다 — 규칙 전용으로 폴백한다');
      }

      /** 요청 1건 — 실패는 던진다(재시도 판단은 호출측). 키는 헤더로만 나가고 로그에 남기지 않는다. */
      const requestOnce = async (prompt: string): Promise<string> => {
        usage.calls += 1;
        usage.promptTokens += estimateTokens(prompt);
        const response = await fetchImpl(`${baseUrl}${API_CHAT_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            stream: false,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new ApiHttpError(response.status, response.statusText);
        const payload = (await response.json()) as ApiChatPayload;
        const content = asString(payload.choices?.[0]?.message?.content) ?? '';
        usage.completionTokens += estimateTokens(content);
        return content;
      };

      const drafts: AiRuleDraft[] = [];
      const raws: string[] = [];

      try {
        for (const group of chunkCandidates(dedupeCandidates(candidates), maxCandidatesPerCall)) {
          const capped = capToPromptLimit(group, maxPromptChars);
          if (capped.dropped > 0) {
            usage.truncated += capped.dropped;
            log(
              `[extract] ⚠️ 입력 길이 상한 초과 — 후보 ${String(capped.dropped)}개를 잘라냈다(요청 ≤ ${String(maxPromptChars)}자, NFR-A4)`,
            );
          }
          if (capped.group.length === 0) continue;
          const prompt = buildPrompt(capped.group);

          let content = cache.get(prompt);
          if (content === undefined) {
            let lastError: unknown = null;
            for (let attempt = 0; attempt <= retries; attempt += 1) {
              try {
                content = await requestOnce(prompt);
                break;
              } catch (error) {
                lastError = error;
                if (!isRetryable(error) || attempt === retries) {
                  throw error;
                }
                log(`[extract] API 재시도 ${String(attempt + 1)}/${String(retries)} — ${messageOf(lastError)}`);
              }
            }
            if (content === undefined) throw lastError ?? new Error('API 호출 실패(원인 미상)');
            cache.set(prompt, content);
          } else {
            log('[extract] 캐시 사용 — 같은 프롬프트를 다시 보내지 않는다(비용 가드)');
          }

          if (content === '') continue;
          raws.push(content);
          drafts.push(...parseAiDrafts(content));
        }
        return finish('ok', drafts, raws.join('\n'), null);
      } catch (error) {
        const message = messageOf(error);
        log(`[extract] API 실패(${String(usage.calls)}회 호출) — 규칙 전용으로 폴백한다: ${message}`);
        // 부분 성공을 섞지 않는다: 실패 시 AI 보강 전체를 버리고 규칙 전용으로 간다(예측 가능한 산출물)
        return finish('unavailable', [], raws.join('\n'), message);
      }
    },
  };
}

// ─────────────────────────── ② 로컬 Ollama ───────────────────────────

export interface OllamaStructurerOptions {
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly nowMs?: (() => number) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

interface OllamaTags {
  readonly models?: readonly { readonly name?: string }[];
}

/**
 * 로컬 Ollama 구조화 어댑터. **모델이 없으면 설치하지 않고** `unavailable` 로 끝난다.
 * HTTP 는 Node 내장 `fetch` 만 쓴다(런타임 의존성 0).
 */
export function createOllamaStructurer(options: OllamaStructurerOptions = {}): AiStructurer {
  const model = options.model === undefined || options.model === '' ? DEFAULT_MODEL : options.model;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const nowMs = options.nowMs ?? (() => Date.now());
  const log = options.log ?? (() => {});

  async function callJson(path: string, body: unknown): Promise<unknown> {
    const started = nowMs();
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)} ${response.statusText}`.trim());
    const payload = (await response.json()) as unknown;
    log(`[extract] ollama ${path} 응답 ${String(Math.round(nowMs() - started))}ms`);
    return payload;
  }

  return {
    model,
    promptTemplateSha256: promptTemplateSha256(),
    async structure(candidates: readonly Candidate[]): Promise<AiStructureResult> {
      const started = nowMs();
      const usage = newUsageCounters();
      const finish = (
        status: AiStructureResult['status'],
        drafts: AiRuleDraft[],
        raw: string,
        error: string | null,
      ): AiStructureResult => ({
        status,
        provider: 'ollama',
        model,
        durationMs: Math.round(nowMs() - started),
        drafts,
        raw,
        error,
        usage: withUsage(usage),
      });

      if (candidates.length === 0) return finish('ok', [], '', null);

      try {
        const tagsResponse = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!tagsResponse.ok) throw new Error(`/api/tags HTTP ${String(tagsResponse.status)}`);
        const tags = (await tagsResponse.json()) as OllamaTags;
        const names = (tags.models ?? []).map((entry) => entry.name ?? '').filter((name) => name !== '');
        if (!names.includes(model)) {
          return finish(
            'unavailable',
            [],
            '',
            `모델 "${model}" 이 로컬 Ollama 에 없다(설치하지 않는다 — --no-ai 폴백). 있는 모델: ${names.join(', ') || '없음'}`,
          );
        }

        const drafts: AiRuleDraft[] = [];
        const raws: string[] = [];
        const groups: Candidate[][] = chunkCandidates(dedupeCandidates(candidates), MAX_CANDIDATES_PER_CALL);
        for (const group of groups) {
          const prompt = buildPrompt(group);
          usage.calls += 1;
          usage.promptTokens += estimateTokens(prompt);
          const payload = (await callJson('/api/chat', {
            model,
            stream: false,
            format: 'json',
            options: { temperature: 0 },
            messages: [{ role: 'user', content: prompt }],
          })) as { message?: { content?: unknown; thinking?: unknown } };
          const content =
            asString(payload.message?.content) ?? asString(payload.message?.thinking) ?? '';
          usage.completionTokens += estimateTokens(content);
          if (content === '') continue;
          raws.push(content);
          drafts.push(...parseAiDrafts(content));
        }
        return finish('ok', drafts, raws.join('\n'), null);
      } catch (error) {
        const message = messageOf(error);
        log(`[extract] ollama 실패: ${message}`);
        return finish('unavailable', [], '', message);
      }
    },
  };
}

// ─────────────────────────── ③ 비활성(`--ai=off`) ───────────────────────────

/** `--ai=off` / `--no-ai` 모드 — 네트워크를 아예 부르지 않는다. */
export function createDisabledStructurer(model: string = DEFAULT_MODEL): AiStructurer {
  return {
    model,
    promptTemplateSha256: promptTemplateSha256(),
    async structure(): Promise<AiStructureResult> {
      return {
        status: 'disabled',
        provider: 'rule-only',
        model,
        durationMs: 0,
        drafts: [],
        raw: '',
        error: null,
        usage: emptyUsage(),
      };
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
