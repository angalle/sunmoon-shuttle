/**
 * AI **전송 계층**(공용) — OpenAI 호환 API · 로컬 Ollama 두 어댑터가 **같은** 재시도·타임아웃·프롬프트 캐시·
 * 사용량 집계를 쓴다(T34: 중복 구현 금지 — T19 규칙 분류기와 T34 시간표 표 추출기가 이 계층을 함께 쓴다).
 *
 * 여기에는 **도메인 지식이 없다**: 프롬프트를 넣으면 JSON 문자열을 돌려줄 뿐이다.
 *  - 프롬프트 조립·응답 해석(스키마)은 각 유스케이스(`ai.ts`=문장 분류, `aiTable.ts`=표 추출)가 한다.
 *  - 실패 분류: 4xx(인증·요청)는 재시도하지 않고, 429·5xx·타임아웃·네트워크 오류는 1회 재시도한다.
 *  - 비용 가드: 같은 프롬프트는 실행(어댑터 수명) 안에서 **한 번만** 보낸다(프롬프트 캐시).
 *  - 시크릿(`AI_API_KEY`)은 헤더로만 나가고 로그·산출물에 남지 않는다.
 *  - 벤더 도메인은 코드에 없다 — `baseUrl` 로만 나간다. HTTP 는 Node 내장 `fetch`(런타임 의존성 0).
 */

import type { AiProvider } from './types.js';

export const DEFAULT_MODEL = 'lfm2.5:latest';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
/** OpenAI 호환 chat completions 경로 */
export const API_CHAT_PATH = '/chat/completions';
/** OpenAI 호환 API 응답 대기 상한(ms) — 원격이므로 로컬보다 짧게 잡는다 */
export const DEFAULT_API_TIMEOUT_MS = 60_000;
/** 로컬 모델 응답 대기 상한(ms) */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 180_000;
/** 실패 시 재시도 횟수(최초 시도 1 + 재시도 1) */
export const MAX_API_RETRIES = 1;

/** 토큰 수 **추정**(비용 추적용 — 정확한 과금값이 아니다). 한글·영문 혼합 기준 1 토큰 ≈ 2 문자 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 어댑터 내부용 가변 카운터(`AiUsage` 는 발행물 계약이라 readonly 다) */
export interface ChatUsageCounters {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  truncated: number;
}

export function newChatUsage(): ChatUsageCounters {
  return { calls: 0, promptTokens: 0, completionTokens: 0, truncated: 0 };
}

/** 사용량 **스냅샷**(차이 계산용) — 유스케이스는 전송의 누적이 아니라 자기 호출분만 기록한다(T19·T34 계약). */
export interface UsageSnapshot {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export function snapshotUsage(usage: ChatUsageCounters): UsageSnapshot {
  return { calls: usage.calls, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
}

/** 스냅샷 이후 늘어난 사용량(이 호출에서 실제로 나간 비용) */
export function diffUsage(before: UsageSnapshot, usage: ChatUsageCounters): ChatUsageCounters {
  return {
    calls: usage.calls - before.calls,
    promptTokens: usage.promptTokens - before.promptTokens,
    completionTokens: usage.completionTokens - before.completionTokens,
    truncated: 0,
  };
}

/** 유스케이스별 가변 카운터에 `delta` 를 더한다(호출 1건 단위 집계) */
export function addUsage(target: ChatUsageCounters, delta: ChatUsageCounters): void {
  target.calls += delta.calls;
  target.promptTokens += delta.promptTokens;
  target.completionTokens += delta.completionTokens;
  target.truncated += delta.truncated;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
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

export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiHttpError) return error.retryable;
  // 타임아웃(AbortError)·네트워크 오류는 재시도한다
  return true;
}

/**
 * 채팅 전송 포트 — 유스케이스(프롬프트 조립·응답 해석)는 이 인터페이스에만 의존한다.
 * `unavailableReason()` 이 비어 있지 않으면 **호출하지 않고** 규칙 전용으로 폴백한다(경고 기록).
 */
export interface ChatTransport {
  readonly provider: AiProvider;
  readonly model: string;
  /** 이 전송이 실제로 나간 호출 수·토큰 **추정치**(재시도 포함) */
  readonly usage: ChatUsageCounters;
  /** 설정이 모자라 호출할 수 없는 사유(호출 0회). null = 호출 가능 */
  unavailableReason(): Promise<string | null>;
  /** 프롬프트 1건 → 응답 문자열(재시도·타임아웃·캐시 포함). 실패는 던진다. */
  chat(prompt: string): Promise<string>;
}

interface ApiChatPayload {
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
}

export interface ApiChatOptions {
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** `AI_API_KEY` — 로그·산출물에 절대 남기지 않는다 */
  readonly apiKey?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retries?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** OpenAI 호환 API 전송 어댑터. 설정이 비면 호출하지 않고 사유만 돌려준다. */
export function createApiChatTransport(options: ApiChatOptions = {}): ChatTransport {
  const model = options.model ?? '';
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const apiKey = options.apiKey ?? '';
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const retries = options.retries ?? MAX_API_RETRIES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const log = options.log ?? ((): void => {});
  const usage = newChatUsage();
  /**
   * 프롬프트 → 응답 캐시 — **어댑터 수명 동안 유지**된다(같은 실행에서 같은 프롬프트를 두 번 보내지 않는다).
   * 어댑터는 실행 1회당 1개 만들어지므로 런 전체가 캐시 범위다.
   */
  const cache = new Map<string, string>();

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

  return {
    provider: 'api',
    model,
    usage,
    async unavailableReason(): Promise<string | null> {
      if (apiKey === '') return 'AI_API_KEY 가 없다 — 규칙 전용으로 폴백한다(--ai=off 와 같은 경로)';
      if (baseUrl === '') return 'AI_BASE_URL 이 없다 — 규칙 전용으로 폴백한다';
      if (model === '') return 'AI_MODEL(--model)이 없다 — 규칙 전용으로 폴백한다';
      return null;
    },
    async chat(prompt: string): Promise<string> {
      const cached = cache.get(prompt);
      if (cached !== undefined) {
        log('[extract] 캐시 사용 — 같은 프롬프트를 다시 보내지 않는다(비용 가드)');
        return cached;
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const content = await requestOnce(prompt);
          cache.set(prompt, content);
          return content;
        } catch (error) {
          lastError = error;
          if (!isRetryable(error) || attempt === retries) throw error;
          log(`[extract] API 재시도 ${String(attempt + 1)}/${String(retries)} — ${messageOf(lastError)}`);
        }
      }
      throw lastError ?? new Error('API 호출 실패(원인 미상)');
    },
  };
}

interface OllamaTags {
  readonly models?: readonly { readonly name?: string }[];
}

export interface OllamaChatOptions {
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly nowMs?: (() => number) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** 로컬 Ollama 전송 어댑터. **모델이 없으면 설치하지 않고** 사유를 돌려준다. */
export function createOllamaChatTransport(options: OllamaChatOptions = {}): ChatTransport {
  const model = options.model === undefined || options.model === '' ? DEFAULT_MODEL : options.model;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const nowMs = options.nowMs ?? ((): number => Date.now());
  const log = options.log ?? ((): void => {});
  const usage = newChatUsage();
  let probe: Promise<string | null> | null = null;

  const checkModel = async (): Promise<string | null> => {
    const tagsResponse = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!tagsResponse.ok) throw new Error(`/api/tags HTTP ${String(tagsResponse.status)}`);
    const tags = (await tagsResponse.json()) as OllamaTags;
    const names = (tags.models ?? []).map((entry) => entry.name ?? '').filter((name) => name !== '');
    if (!names.includes(model)) {
      return `모델 "${model}" 이 로컬 Ollama 에 없다(설치하지 않는다 — --no-ai 폴백). 있는 모델: ${names.join(', ') || '없음'}`;
    }
    return null;
  };

  return {
    provider: 'ollama',
    model,
    usage,
    async unavailableReason(): Promise<string | null> {
      if (probe === null) {
        // 실패한 프로브를 캐시하지 않는다(다음 호출에서 다시 확인)
        probe = checkModel().catch((error: unknown) => {
          probe = null;
          throw error;
        });
      }
      return probe;
    },
    async chat(prompt: string): Promise<string> {
      const started = nowMs();
      usage.calls += 1;
      usage.promptTokens += estimateTokens(prompt);
      const response = await fetchImpl(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)} ${response.statusText}`.trim());
      const payload = (await response.json()) as { readonly message?: { readonly content?: unknown; readonly thinking?: unknown } };
      const content = asString(payload.message?.content) ?? asString(payload.message?.thinking) ?? '';
      usage.completionTokens += estimateTokens(content);
      log(`[extract] ollama /api/chat 응답 ${String(Math.round(nowMs() - started))}ms`);
      return content;
    },
  };
}
