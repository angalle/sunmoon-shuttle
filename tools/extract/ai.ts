/**
 * AI 보강 추출 — **로컬 Ollama 전용**(`http://127.0.0.1:11434`, 외부 API·과금 0).
 *
 * 역할 분담(FR-A2): AI 는 **규칙이 못 잡은 문장의 분류만** 한다.
 *   - AI 가 만들 수 있는 것: `kind` · `dayTypes` · `note` · `confidence` (+ 원문 인용)
 *   - AI 가 **만들 수 없는 것**: 날짜·시각·분·행 수 — 수치는 전부 규칙(`rules.ts`)이 만든다.
 * 프롬프트가 그 규칙을 강제하고, 검증기(`validate.ts`)가 결과를 다시 확인한다.
 *
 * 폴백: 모델이 없거나 무응답/타임아웃이면 **임의 설치를 시도하지 않고** `unavailable` 을 돌려주고
 * 호출측이 규칙 전용 모드로 진행한다(경고 기록 — 배치를 죽이지 않는다).
 */

import { createHash } from 'node:crypto';

import { DATE_RULE_KINDS } from './types.js';
import type { AiRuleDraft, AiStructureResult, AiStructurer, Candidate } from './types.js';

export const DEFAULT_MODEL = 'lfm2.5:latest';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
/** 모델 응답 대기 상한(ms) — 초과 시 폴백 */
export const DEFAULT_TIMEOUT_MS = 180_000;
/** 한 번에 모델에 넘기는 최대 후보 수(초과분은 호출측이 나눠 부른다) */
export const MAX_CANDIDATES_PER_CALL = 24;

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
  const model = options.model ?? DEFAULT_MODEL;
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
      const finish = (
        status: AiStructureResult['status'],
        drafts: AiRuleDraft[],
        raw: string,
        error: string | null,
      ): AiStructureResult => ({
        status,
        model,
        durationMs: Math.round(nowMs() - started),
        drafts,
        raw,
        error,
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
        const groups: Candidate[][] = [];
        for (let i = 0; i < candidates.length; i += MAX_CANDIDATES_PER_CALL) {
          groups.push(candidates.slice(i, i + MAX_CANDIDATES_PER_CALL) as Candidate[]);
        }
        for (const group of groups) {
          const payload = (await callJson('/api/chat', {
            model,
            stream: false,
            format: 'json',
            options: { temperature: 0 },
            messages: [{ role: 'user', content: buildPrompt(group) }],
          })) as { message?: { content?: unknown; thinking?: unknown } };
          const content =
            asString(payload.message?.content) ?? asString(payload.message?.thinking) ?? '';
          if (content === '') continue;
          raws.push(content);
          drafts.push(...parseAiDrafts(content));
        }
        return finish('ok', drafts, raws.join('\n'), null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`[extract] ollama 실패: ${message}`);
        return finish('unavailable', [], '', message);
      }
    },
  };
}

/** `--no-ai` 모드 — 네트워크를 아예 부르지 않는다. */
export function createDisabledStructurer(model: string = DEFAULT_MODEL): AiStructurer {
  return {
    model,
    promptTemplateSha256: promptTemplateSha256(),
    async structure(): Promise<AiStructureResult> {
      return { status: 'disabled', model, durationMs: 0, drafts: [], raw: '', error: null };
    },
  };
}
