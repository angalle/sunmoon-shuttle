/**
 * 학사일정 **AI 분류 교차검증기** — `docs/10-academic-calendar.md` §6-2 · T42.
 *
 * 하는 일: 학사력 일정 줄 목록(번호 | 원문 한 줄) → 줄마다 분류(`kind`) 하나.
 * 하지 않는 일: **날짜를 만들거나 고치는 것**. 날짜·요일은 규칙 파서(`calendar.ts`)가 원문에서만 뽑는다.
 *   AI 응답에는 날짜 칸 자체가 없다 → 환각으로 날짜가 바뀔 경로가 없다(docs/08 §3).
 *
 * 정본은 규칙 분류다. AI 결과는 `crossCheckCalendar` 가 항목별로 비교해
 *  규칙이 `ignored` 로 놓친 것만 채택(needsReview)하고, 서로 다르면 규칙을 유지한다.
 *
 * 호출: 학사력 파일 1개 = 호출 1건(72줄 ≈ 수천 토큰). 같은 실행에서 같은 프롬프트는 전송 계층 캐시가 막는다.
 * 전송·재시도·키 처리·`temperature: 0`·JSON 강제는 공용 전송 계층(`aiTransport.ts`)을 그대로 쓴다.
 */

import { createHash } from 'node:crypto';

import {
  createApiChatTransport,
  createOllamaChatTransport,
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_MODEL,
  extractJson,
  messageOf,
  type ChatTransport,
} from './aiTransport.js';
import { ACADEMIC_EVENT_KINDS, isAcademicEventKind, KIND_DESCRIPTIONS } from './calendar.js';
import type { AcademicEvent, AcademicEventKind } from './calendar.js';
import type { AiProvider, AiStatus } from './types.js';

export interface CalendarClassifyRequest {
  readonly sourcePage: string;
  readonly events: readonly AcademicEvent[];
}

export interface CalendarClassifyResult {
  readonly status: AiStatus;
  readonly provider: AiProvider;
  readonly model: string;
  /** 줄 번호(0부터) → AI 분류. status 가 ok 가 아니면 null */
  readonly kinds: ReadonlyMap<number, AcademicEventKind> | null;
  readonly calls: number;
  readonly error: string | null;
}

export interface AiCalendarClassifier {
  readonly model: string;
  readonly promptTemplateSha256: string;
  classify(request: CalendarClassifyRequest): Promise<CalendarClassifyResult>;
}

/** 프롬프트 템플릿 — `{{ITEMS}}` 만 치환한다. 해시가 발행 메타에 기록된다(재현성). */
export function calendarPromptTemplate(): string {
  const dictionary = ACADEMIC_EVENT_KINDS.map((kind) => `- ${kind} : ${KIND_DESCRIPTIONS[kind]}`).join('\n');
  return [
    '너는 선문대학교 **학사력(학사일정)** 의 일정 줄을 분류하는 도구다. 결과는 셔틀버스 시간표 앱이',
    '공휴일·방학·시험 기간을 안내하는 데 쓴다.',
    '',
    '입력은 `번호 | 원문 한 줄` 목록이다. 원문은 `◉ 날짜(요일)[~날짜(요일)] 일정명` 형식이다.',
    '',
    '규칙(반드시 지킨다):',
    '1) 모든 번호에 대해 kind 를 **하나씩** 적는다. 번호를 빠뜨리거나 새로 만들지 않는다.',
    '2) kind 는 아래 사전의 값만 쓴다. 애매하면 ignored 를 쓴다.',
    '3) 날짜는 적지 않는다(날짜는 이미 원문에서 확정돼 있다).',
    '4) `학기개시 30일`·`수업일수 1/4` 같은 경과일 표기는 semester-start 가 아니라 ignored 다.',
    '5) `수시 실기고사`·`수시 면접고사` 같은 입시 일정은 exam 이 아니라 ignored 다.',
    '',
    'kind 사전:',
    dictionary,
    '',
    '출력은 JSON 하나만. 형식:',
    '{"items":[{"id":0,"kind":"holiday"},{"id":1,"kind":"ignored"}]}',
    '',
    '일정:',
    '{{ITEMS}}',
  ].join('\n');
}

export function buildCalendarPrompt(request: CalendarClassifyRequest): string {
  const items = request.events.map((event, index) => `${String(index)} | ${event.sourceQuote}`).join('\n');
  return calendarPromptTemplate().replace('{{ITEMS}}', `(파일: ${request.sourcePage})\n${items}`);
}

export function calendarPromptTemplateSha256(): string {
  return `sha256:${createHash('sha256').update(calendarPromptTemplate(), 'utf8').digest('hex')}`;
}

/**
 * 응답 해석 — 형식이 틀리면 **전부 버린다**(부분 채택 없음). 사유를 문자열로 돌려준다.
 *  - `items` 배열 · 각 항목 `id`(정수, 0 ≤ id < n) · `kind`(사전 값) · id 중복 금지
 */
export function parseCalendarKinds(raw: string, count: number): { kinds: Map<number, AcademicEventKind> | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (error) {
    return { kinds: null, error: `JSON 해석 실패 — ${messageOf(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null) return { kinds: null, error: 'JSON 객체가 아니다' };
  const items = (parsed as Record<string, unknown>)['items'];
  if (!Array.isArray(items)) return { kinds: null, error: '`items` 배열이 없다' };
  const kinds = new Map<number, AcademicEventKind>();
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return { kinds: null, error: '항목이 객체가 아니다' };
    const id = (item as Record<string, unknown>)['id'];
    const kind = (item as Record<string, unknown>)['kind'];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= count) {
      return { kinds: null, error: `원문에 없는 번호 — ${JSON.stringify(id)}` };
    }
    if (!isAcademicEventKind(kind)) return { kinds: null, error: `사전에 없는 kind — ${JSON.stringify(kind)} (번호 ${String(id)})` };
    if (kinds.has(id)) return { kinds: null, error: `번호 중복 — ${String(id)}` };
    kinds.set(id, kind);
  }
  return { kinds, error: null };
}

/** 전송 계층 하나로 분류기를 만든다(api·ollama 공용). 설정이 모자라면 호출하지 않고 `unavailable`. */
export function createCalendarClassifier(transport: ChatTransport): AiCalendarClassifier {
  return {
    model: transport.model,
    promptTemplateSha256: calendarPromptTemplateSha256(),
    async classify(request: CalendarClassifyRequest): Promise<CalendarClassifyResult> {
      const callsBefore = transport.usage.calls;
      const finish = (status: AiStatus, kinds: ReadonlyMap<number, AcademicEventKind> | null, error: string | null): CalendarClassifyResult => ({
        status,
        provider: status === 'ok' ? transport.provider : 'rule-only',
        model: transport.model,
        kinds,
        calls: transport.usage.calls - callsBefore,
        error,
      });
      let unavailable: string | null;
      try {
        unavailable = await transport.unavailableReason();
      } catch (error) {
        return finish('unavailable', null, messageOf(error));
      }
      if (unavailable !== null) return finish('unavailable', null, unavailable);
      let raw: string;
      try {
        raw = await transport.chat(buildCalendarPrompt(request));
      } catch (error) {
        return finish('error', null, messageOf(error));
      }
      const parsed = parseCalendarKinds(raw, request.events.length);
      if (parsed.kinds === null) return finish('error', null, parsed.error);
      return finish('ok', parsed.kinds, null);
    },
  };
}

export interface ApiCalendarClassifierOptions {
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

export function createApiCalendarClassifier(options: ApiCalendarClassifierOptions = {}): AiCalendarClassifier {
  return createCalendarClassifier(
    createApiChatTransport({
      model: options.model ?? '',
      baseUrl: options.baseUrl ?? '',
      apiKey: options.apiKey ?? '',
      timeoutMs: options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.log === undefined ? {} : { log: options.log }),
    }),
  );
}

export function createOllamaCalendarClassifier(options: { readonly model?: string; readonly log?: (line: string) => void } = {}): AiCalendarClassifier {
  return createCalendarClassifier(
    createOllamaChatTransport({
      model: options.model ?? DEFAULT_MODEL,
      ...(options.log === undefined ? {} : { log: options.log }),
    }),
  );
}

/** `--ai=off` — 호출 0회, 규칙 분류만. */
export function createDisabledCalendarClassifier(model: string = DEFAULT_MODEL): AiCalendarClassifier {
  return {
    model,
    promptTemplateSha256: calendarPromptTemplateSha256(),
    async classify(): Promise<CalendarClassifyResult> {
      return { status: 'disabled', provider: 'rule-only', model, kinds: null, calls: 0, error: null };
    },
  };
}
