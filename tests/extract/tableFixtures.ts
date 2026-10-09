/**
 * T34 AI 표 추출 테스트 픽스처 — **프롬프트에 실린 표를 되읽어** 모의 AI 응답을 만든다.
 *
 * 왜 프롬프트에서 읽는가: 모의 서버가 디스크의 원본을 따로 읽으면, 테스트가 페이지를 바꿔 끼웠을 때
 * (해시 캐시 시나리오) 응답과 원문이 어긋나 검증이 엉뚱하게 실패한다. 프롬프트로 되읽으면 **항상 정합**이다.
 */

import { findRoute } from '../../tools/scraper/routeMeta.js';
import type { DayType } from '../../tools/scraper/types.js';
import type { AiTableColumn, AiTablePageDraft, AiTableRow } from '../../tools/extract/types.js';
import type { MockApiHandler } from './mock-ai-server.js';
import { EMPTY_COMPLETION_BODY } from './mock-ai-server.js';

/** `buildTablePrompt` 가 넣는 입력 마커(프롬프트 구조 계약) */
export const TABLE_INPUT_MARKER = '\n표:\n';
export const TABLE_CONTEXT_PATTERN = /\(파일: (.+?) · 노선: (.+?) · 요일: (weekday|saturday|sunday)\)/;

export interface ParsedTablePrompt {
  readonly file: string;
  readonly routeId: string;
  readonly dayType: DayType;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** 표 추출 프롬프트면 표를, 문장 분류 프롬프트면 null 을 돌려준다. */
export function parseTablePrompt(prompt: string): ParsedTablePrompt | null {
  const at = prompt.indexOf(TABLE_INPUT_MARKER);
  if (at < 0) return null;
  const lines = prompt
    .slice(at + TABLE_INPUT_MARKER.length)
    .split('\n')
    .filter((line) => line.trim() !== '');
  const context = lines[0];
  const headerLine = lines[1];
  if (context === undefined || headerLine === undefined) return null;
  const parsed = TABLE_CONTEXT_PATTERN.exec(context);
  if (parsed === null) return null;
  const dayType = parsed[3];
  if (dayType !== 'weekday' && dayType !== 'saturday' && dayType !== 'sunday') return null;
  return {
    file: parsed[1] ?? '',
    routeId: parsed[2] ?? '',
    dayType,
    header: headerLine.split(' | '),
    rows: lines.slice(2).map((line) => line.split(' | ')),
  };
}

/** 노선·요일의 계약 열(라벨·키) — 원문 머리글 → 의미 키 매핑의 정본 */
export function contractColumns(routeId: string, dayType: DayType): readonly { readonly label: string; readonly key: string }[] {
  const day = findRoute(routeId).days.find((entry) => entry.dayType === dayType);
  return (day?.columns ?? []).map((column) => ({ label: column.label, key: column.key }));
}

/**
 * **정답 초안** — 셀 값은 원문 토큰 그대로(§3), `Χ`·빈칸은 null.
 * 열 매핑은 계약 라벨 → 키(없으면 같은 위치의 계약 키).
 */
export function faithfulDraftFromPrompt(prompt: string): AiTablePageDraft | null {
  const parsed = parseTablePrompt(prompt);
  if (parsed === null) return null;
  const contract = contractColumns(parsed.routeId, parsed.dayType);
  const byLabel = new Map(contract.map((column) => [column.label, column.key] as const));
  const keyAt = (header: string, index: number): string => byLabel.get(header) ?? contract[index]?.key ?? `col${String(index)}`;
  const columns: AiTableColumn[] = parsed.header.map((header, index) => ({ header, key: keyAt(header, index) }));
  const rows: AiTableRow[] = parsed.rows.map((cells) => {
    const values: Record<string, string | null> = {};
    cells.forEach((cell, index) => {
      if (index === 0) return;
      const column = columns[index];
      if (column === undefined) return;
      values[column.key] = cell === '' || cell === 'Χ' ? null : cell;
    });
    const seq = Number(cells[0]);
    return { seq: Number.isInteger(seq) ? seq : null, values };
  });
  return { page: parsed.file, columns, rows };
}

/**
 * **환각 초안**(AC-AI1-1) — 표에 없는 시각·행을 추가한다.
 *  - 마지막 행에 표에 없는 시각을 끼워 넣는다(셀 앵커·시각 집합 위반)
 *  - 원문에 없는 행(순번 = 행 수 + 1)을 덧붙인다(행 수 위반)
 */
export function hallucinatedDraftFromPrompt(prompt: string, fakeTime = '23:59'): AiTablePageDraft | null {
  const faithful = faithfulDraftFromPrompt(prompt);
  if (faithful === null) return null;
  const firstKey = faithful.columns[1]?.key;
  const rows: AiTableRow[] = faithful.rows.map((row, index) =>
    index === 0 && firstKey !== undefined
      ? { ...row, values: { ...row.values, [firstKey]: fakeTime } }
      : row,
  );
  const bogusValues: Record<string, string | null> = {};
  for (const column of faithful.columns) {
    if (column.key === 'seq') continue;
    bogusValues[column.key] = column.key === firstKey ? fakeTime : null;
  }
  rows.push({ seq: faithful.rows.length + 1, values: bogusValues });
  return { ...faithful, rows };
}

/** 모의 chat completion 본문(표 초안) */
export function draftBody(draft: AiTablePageDraft): unknown {
  return { choices: [{ message: { content: JSON.stringify(draft) } }] };
}

const TIME_TOKEN = /\d{1,2}:\d{2}/;

/**
 * **① 값 모순 주입**(T35 AC-AI1-4c①) — 첫 두 행에서 `arrCampus`(없으면 값이 서로 다른 첫 시각 열)의
 * 값을 **맞바꾼다**. 검증 4종은 통과한다(시각 **집합**·행 수·앵커 불변) → 교차검증만 ① 값 모순으로
 * 판정 → `runExtract` 가 **발행을 보류**한다(exit 1 · 산출물 0건).
 */
export function contradictedDraftFromPrompt(prompt: string): AiTablePageDraft | null {
  const faithful = faithfulDraftFromPrompt(prompt);
  if (faithful === null) return null;
  const [first, second] = faithful.rows;
  if (first === undefined || second === undefined) return faithful;
  const timeKeys = faithful.columns
    .map((column) => column.key)
    .filter((key) => key !== 'seq' && (TIME_TOKEN.test(String(first.values[key] ?? '')) || TIME_TOKEN.test(String(second.values[key] ?? ''))));
  const ordered = ['arrCampus', ...timeKeys.filter((key) => key !== 'arrCampus')];
  for (const key of ordered) {
    const a = first.values[key] ?? null;
    const b = second.values[key] ?? null;
    if (a === null || b === null || a === b) continue;
    return {
      ...faithful,
      rows: faithful.rows.map((row, index) =>
        index === 0
          ? { ...row, values: { ...row.values, [key]: b } }
          : index === 1
            ? { ...row, values: { ...row.values, [key]: a } }
            : row,
      ),
    };
  }
  return faithful;
}

/**
 * **③ null-vs-값 주입**(T35 AC-AI1-4c③) — 시각이 아닌 열(`note` 우선)의 첫 행에만 값을 넣는다
 * (규칙 정본은 그 열이 비어 있다). 시각 집합·행 수·앵커는 불변 → 검증 4종 통과 → 교차검증 ③ 경고만
 * → **규칙 정본으로 정상 발행**한다(§5: 표현 차이로 앱을 멈추지 않는다).
 */
export function nullMismatchDraftFromPrompt(prompt: string): AiTablePageDraft | null {
  const faithful = faithfulDraftFromPrompt(prompt);
  if (faithful === null) return null;
  const first = faithful.rows[0];
  if (first === undefined) return faithful;
  const timeKeys = new Set<string>();
  for (const row of faithful.rows) {
    for (const [key, value] of Object.entries(row.values)) {
      if (typeof value === 'string' && TIME_TOKEN.test(value)) timeKeys.add(key);
    }
  }
  const columns = faithful.columns.filter((column) => column.key !== 'seq' && !timeKeys.has(column.key));
  const chosen = columns.find((column) => column.key === 'note') ?? columns[columns.length - 1];
  if (chosen === undefined) return faithful;
  // 값은 **그 표의 머리글 토큰** — 페이지 본문에 존재하므로 ① 셀 앵커를 깨지 않는다(시각 토큰 아님).
  const value = chosen.header === '' ? '비고' : chosen.header;
  return {
    ...faithful,
    rows: faithful.rows.map((row, index) => (index === 0 ? { ...row, values: { ...row.values, [chosen.key]: value } } : row)),
  };
}

/**
 * 표 프롬프트에는 표 초안을, 문장 분류 프롬프트에는 빈 규칙을 돌려주는 핸들러.
 * `inject` 로 초안을 변형한다(환각·누락 주입).
 */
export function tableAwareHandler(
  inject?: (draft: AiTablePageDraft, prompt: string) => AiTablePageDraft,
  counter?: { calls: number; pages: string[] },
): MockApiHandler {
  return (request) => {
    const prompt = String(request.body.messages?.[0]?.content ?? '');
    const draft = faithfulDraftFromPrompt(prompt);
    if (draft === null) return { body: EMPTY_COMPLETION_BODY };
    if (counter !== undefined) {
      counter.calls += 1;
      counter.pages.push(draft.page);
    }
    return { body: draftBody(inject === undefined ? draft : inject(draft, prompt)) };
  };
}
