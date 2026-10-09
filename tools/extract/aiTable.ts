/**
 * **시간표 전용 AI 표 추출기**(T34 · docs/08 §2~§4·§6).
 *
 * 하는 일: 페이지의 **표 영역 원문 텍스트**(`tableRegion.ts`) → ① **열 이름 → 의미 키 매핑** ② **행 값 초안**(JSON).
 * 하지 않는 일: **수치 창작**(§3). 시각·분·행 수는 원문 토큰만 쓸 수 있고, 그 규칙은 검증기
 * (`aiTableValidate.ts`)가 기계적으로 확인한다. AI 단독 채택은 없다(정본은 규칙 파서 — §2 Stage A).
 *
 * 프롬프트는 **일반 추출기가 아니다**(§1): 페이지 종류가 시간표로 고정이라는 전제로 열 사전(의미 키)·
 * 원문 복사 규칙·행 수/시각 집합 검증 예고를 명시한다. `temperature: 0` · JSON 출력 강제 ·
 * 프롬프트 템플릿 해시 기록 — 모두 공용 전송 계층(`aiTransport.ts`)과 함께 지켜진다(중복 구현 없음).
 *
 * 페이지 1개 = 호출 1건이다(호출 상한·내용 해시 캐시는 `aiTableRun.ts`).
 */

import { createHash } from 'node:crypto';

import { ROUTES } from '../scraper/routeMeta.js';
import type { DayType } from '../scraper/types.js';
import {
  addUsage,
  asString,
  createApiChatTransport,
  createOllamaChatTransport,
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_MODEL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  diffUsage,
  extractJson,
  messageOf,
  newChatUsage,
  snapshotUsage,
  type ChatUsageCounters,
} from './aiTransport.js';
import type { AiProvider, AiStatus, AiTableColumn, AiTablePageDraft, AiTableRow, AiUsage } from './types.js';

/** 의미 키 사전 — 계약(`routeMeta`)에서 **파생**한다(손으로 적은 목록은 계약과 어긋난다). */
export interface TableKeyEntry {
  readonly key: string;
  /** 원문 머리글 예시(계약의 라벨 — 그대로 AI 에게 보여 준다) */
  readonly labels: readonly string[];
}

export function tableKeyVocabulary(): readonly TableKeyEntry[] {
  const order: string[] = [];
  const labels = new Map<string, string[]>();
  for (const route of ROUTES) {
    for (const day of route.days) {
      for (const column of day.columns) {
        if (!labels.has(column.key)) {
          labels.set(column.key, []);
          order.push(column.key);
        }
        const list = labels.get(column.key);
        if (list !== undefined && !list.includes(column.label)) list.push(column.label);
      }
    }
  }
  return order.map((key) => ({ key, labels: labels.get(key) ?? [] }));
}

/** 사전의 의미 키 집합(schema 검증의 enum) */
export function tableKeySet(): ReadonlySet<string> {
  return new Set(tableKeyVocabulary().map((entry) => entry.key));
}

export interface AiTablePageRequest {
  /** 스냅샷 파일 경로(캐시·기록의 키) */
  readonly page: string;
  readonly routeId: string;
  readonly dayType: DayType;
  /** 표 영역 원문 텍스트(`열1 | 열2 | …` 줄들) */
  readonly regionText: string;
  /** 페이지 본문(정규화) — 셀 앵커 검증(§4-1)의 기준 */
  readonly pageText: string;
}

/** 프롬프트 템플릿 — `{{TABLE}}` 만 치환한다. 해시가 로그·산출물에 기록된다(재현성). */
export function tablePromptTemplate(): string {
  const dictionary = tableKeyVocabulary()
    .map((entry) => `- ${entry.key} : ${entry.labels.map((label) => `\`${label}\``).join(' · ')}`)
    .join('\n');
  return [
    '너는 선문대 셔틀버스 **시간표 표 페이지**를 JSON 으로 옮기는 도구다. 이 페이지는 시간표 전용 페이지다.',
    '',
    '입력은 표를 `열1 | 열2 | …` 형식으로 적은 것이다. **첫 줄이 머리글, 나머지가 데이터 행**이다.',
    '',
    '규칙(반드시 지킨다):',
    '1) columns: 표의 **모든 열**을 표 순서대로 적는다. header 는 원문 머리글을 **그대로** 복사하고, key 는 아래 사전에서 의미가 맞는 것 하나를 고른다.',
    '2) rows: 표의 **모든 데이터 행**을 표 순서대로 적는다. seq 는 `순` 열의 정수값, values 는 **나머지 열**의 값이다(values 에 seq 열은 넣지 않는다).',
    '3) values 의 값은 **원문 글자 그대로** 복사한다. 한 글자도 바꾸지 않는다(앞뒤 공백만 정리).',
    '   - 원문이 `8:05` 이면 `08:05` 로 고치지 말고 `8:05` 그대로 쓴다. `0:15` 같은 표기도 그대로 둔다.',
    '4) 원문에 없는 값·계산한 값(예: 소요시간을 분으로 환산)을 만들면 **즉시 검증 실패**한다.',
    '5) 빈 칸과 `Χ`(운행 없음)는 null 로 적는다.',
    '6) 행을 빠뜨리거나 더 만들지 않는다 — 행 수와 시각 집합이 원문과 대조된다.',
    '7) 머리글이 `아산캠퍼스 출발`/`아산캠퍼스 (출발)` 처럼 달라도 의미가 같으면 **같은 key** 를 쓴다.',
    '',
    'key 사전(의미 키 : 원문 머리글 예시):',
    dictionary,
    '',
    '출력은 JSON 하나만. 형식:',
    '{"page":"<파일명>","columns":[{"header":"순","key":"seq"}],"rows":[{"seq":1,"values":{"depCampus":"8:05"}}]}',
    '',
    '표:',
    '{{TABLE}}',
  ].join('\n');
}

export function buildTablePrompt(request: AiTablePageRequest): string {
  const context = `(파일: ${request.page} · 노선: ${request.routeId} · 요일: ${request.dayType})`;
  return tablePromptTemplate().replace('{{TABLE}}', `${context}\n${request.regionText}`);
}

export function tablePromptTemplateSha256(): string {
  return `sha256:${createHash('sha256').update(tablePromptTemplate(), 'utf8').digest('hex')}`;
}

function asValue(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined; // 객체·배열·불리언 = 스키마 위반(초안 폐기)
}

/**
 * 모델 응답 → 초안. 형식이 깨지면 **null**(초안 폐기 — 조용한 통과 금지).
 * 값 타입은 `string | number | null` 만 받는다(그 외는 스키마 위반으로 폐기).
 */
export function parseTableDraft(raw: string, page: string): AiTablePageDraft | null {
  const payload = extractJson(raw);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const columnsRaw = record['columns'];
  const rowsRaw = record['rows'];
  if (!Array.isArray(columnsRaw) || !Array.isArray(rowsRaw)) return null;

  const columns: AiTableColumn[] = [];
  for (const item of columnsRaw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    const header = asString(entry['header']) ?? asString(entry['label']);
    const key = asString(entry['key']);
    if (header === null || key === null) return null;
    columns.push({ header, key });
  }
  if (columns.length === 0) return null;

  const rows: AiTableRow[] = [];
  for (const item of rowsRaw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    const seqRaw = entry['seq'];
    const seq = typeof seqRaw === 'number' ? seqRaw : Number(seqRaw);
    const valuesRaw = entry['values'] ?? entry['cells'];
    if (valuesRaw === null || typeof valuesRaw !== 'object' || Array.isArray(valuesRaw)) return null;
    const values: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(valuesRaw as Record<string, unknown>)) {
      const parsed = asValue(value);
      if (parsed === undefined) return null;
      values[key] = parsed;
    }
    rows.push({ seq: Number.isFinite(seq) ? Math.trunc(seq) : null, values });
  }
  if (rows.length === 0) return null;

  return { page, columns, rows };
}

// ─────────────────────────── 어댑터(포트 `AiTableExtractor`) ───────────────────────────

export interface AiTablePageResult {
  readonly status: AiStatus;
  readonly provider: AiProvider;
  readonly model: string;
  readonly durationMs: number;
  /** 파싱된 초안(형식 오류면 null — 호출측이 사유와 함께 폐기한다) */
  readonly draft: AiTablePageDraft | null;
  /** 원시 응답(증거·디버깅용 — 로그/리포트에만 남긴다) */
  readonly raw: string;
  readonly error: string | null;
  /** 이 페이지 호출분(재시도 포함) */
  readonly usage: AiUsage;
}

export interface AiTableExtractor {
  readonly model: string;
  readonly promptTemplateSha256: string;
  extractPage(request: AiTablePageRequest): Promise<AiTablePageResult>;
}

function withUsage(usage: ChatUsageCounters): AiUsage {
  return { ...usage, totalTokens: usage.promptTokens + usage.completionTokens };
}

export interface ApiTableExtractorOptions {
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** `AI_API_KEY` — 로그·산출물에 절대 남기지 않는다 */
  readonly apiKey?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retries?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly nowMs?: (() => number) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** 외부 OpenAI 호환 API 표 추출 어댑터(설정이 비면 호출하지 않고 `unavailable`). */
export function createApiTableExtractor(options: ApiTableExtractorOptions = {}): AiTableExtractor {
  const nowMs = options.nowMs ?? ((): number => Date.now());
  const log = options.log ?? ((): void => {});
  const transport = createApiChatTransport({
    model: options.model ?? '',
    baseUrl: (options.baseUrl ?? '').replace(/\/$/, ''),
    apiKey: options.apiKey ?? '',
    timeoutMs: options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    log,
  });

  return {
    model: transport.model,
    promptTemplateSha256: tablePromptTemplateSha256(),
    async extractPage(request: AiTablePageRequest): Promise<AiTablePageResult> {
      const started = nowMs();
      const usage = newChatUsage();
      const finish = (status: AiStatus, draft: AiTablePageDraft | null, raw: string, error: string | null): AiTablePageResult => ({
        status,
        provider: 'api',
        model: transport.model,
        durationMs: Math.round(nowMs() - started),
        draft,
        raw,
        error,
        usage: withUsage(usage),
      });

      const unavailable = await transport.unavailableReason();
      if (unavailable !== null) return finish('unavailable', null, '', unavailable);

      const before = snapshotUsage(transport.usage);
      let raw: string;
      try {
        raw = await transport.chat(buildTablePrompt(request));
      } catch (error) {
        addUsage(usage, diffUsage(before, transport.usage));
        const message = messageOf(error);
        log(`[extract] ⚠️ AI 표 추출 실패(${request.page}) — 규칙 정본으로 진행한다: ${message}`);
        return finish('unavailable', null, '', message);
      }
      addUsage(usage, diffUsage(before, transport.usage));
      const draft = parseTableDraft(raw, request.page);
      if (draft === null) {
        log(`[extract] ⚠️ AI 표 초안 폐기(${request.page}) — 응답이 표 스키마가 아니다`);
        return finish('ok', null, raw, 'AI 응답이 표 스키마(columns·rows)가 아니다');
      }
      return finish('ok', draft, raw, null);
    },
  };
}

export interface OllamaTableExtractorOptions {
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly nowMs?: (() => number) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** 로컬 Ollama 표 추출 어댑터(모델이 없으면 설치하지 않고 `unavailable`). */
export function createOllamaTableExtractor(options: OllamaTableExtractorOptions = {}): AiTableExtractor {
  const nowMs = options.nowMs ?? ((): number => Date.now());
  const log = options.log ?? ((): void => {});
  const transport = createOllamaChatTransport({
    model: options.model === undefined || options.model === '' ? DEFAULT_MODEL : options.model,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    timeoutMs: options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    log,
  });

  return {
    model: transport.model,
    promptTemplateSha256: tablePromptTemplateSha256(),
    async extractPage(request: AiTablePageRequest): Promise<AiTablePageResult> {
      const started = nowMs();
      const usage = newChatUsage();
      const finish = (status: AiStatus, draft: AiTablePageDraft | null, raw: string, error: string | null): AiTablePageResult => ({
        status,
        provider: 'ollama',
        model: transport.model,
        durationMs: Math.round(nowMs() - started),
        draft,
        raw,
        error,
        usage: withUsage(usage),
      });

      const before = snapshotUsage(transport.usage);
      let raw: string;
      try {
        const unavailable = await transport.unavailableReason();
        if (unavailable !== null) return finish('unavailable', null, '', unavailable);
        raw = await transport.chat(buildTablePrompt(request));
      } catch (error) {
        addUsage(usage, diffUsage(before, transport.usage));
        const message = messageOf(error);
        log(`[extract] ⚠️ AI 표 추출 실패(ollama · ${request.page}): ${message}`);
        return finish('unavailable', null, '', message);
      }
      addUsage(usage, diffUsage(before, transport.usage));
      const draft = parseTableDraft(raw, request.page);
      if (draft === null) {
        log(`[extract] ⚠️ AI 표 초안 폐기(${request.page}) — 응답이 표 스키마가 아니다`);
        return finish('ok', null, raw, 'AI 응답이 표 스키마(columns·rows)가 아니다');
      }
      return finish('ok', draft, raw, null);
    },
  };
}

/** `--ai=off` / `--no-ai` — 네트워크를 아예 부르지 않는다. */
export function createDisabledTableExtractor(model: string = DEFAULT_MODEL): AiTableExtractor {
  return {
    model,
    promptTemplateSha256: tablePromptTemplateSha256(),
    async extractPage(): Promise<AiTablePageResult> {
      return {
        status: 'disabled',
        provider: 'rule-only',
        model,
        durationMs: 0,
        draft: null,
        raw: '',
        error: null,
        usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, truncated: 0 },
      };
    },
  };
}
