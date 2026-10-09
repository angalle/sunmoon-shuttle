/**
 * AI 표 초안 **검증 4종**(docs/08 §4) — 발행 전 기계 판정. 사람이 눈으로 보지 않는다.
 *
 *   ① 셀 앵커   : 모든 셀 값·머리글이 그 **페이지 본문에 실제로 존재**한다(§3 정규화: 공백만)
 *   ② 시각 집합 : 원문 **표 영역**의 `HH:MM` 집합 == 추출 시각 집합(초과·누락 모두 실패)
 *   ③ 행 수     : 추출 행 수 == 원문 표의 행 수(= `순` 최대값) · 순번은 1..N 정확히
 *   ④ 스키마    : 열/행 구조·의미 키 enum(계약 `routeMeta` 파생 사전) 통과
 *
 * 실패의 무게(§3·§4 + T19 ⑤ 선례):
 *   - **환각(초과·조작·원문에 없는 값)** → `fatal` → `runExtract` 가 **발행하지 않는다**(exit 1 · 산출물 0건)
 *   - **누락·형식 위반** → `drop` → AI 초안만 폐기하고 규칙 정본으로 발행한다(사유 기록)
 * 둘 다 "AI 가 조용히 정본을 덮어쓰지 않는다"를 지킨다 — 절대 통과시키지 않는다.
 */

import { extractTimeTokens, normalizeCell, type TableRegion } from './tableRegion.js';
import { tableKeySet } from './aiTable.js';
import type { AiTableCheck, AiTableCheckSeverity, AiTablePageDraft, AiTableRow, AiTableValidation } from './types.js';

export interface TableValidationContext {
  /** 원문 표 영역(시각 집합·행 수의 기준) */
  readonly region: TableRegion;
  /** 페이지 본문(정규화) — 셀 앵커의 기준 */
  readonly pageText: string;
}

/** 상세 문자열에 넣을 샘플 개수(로그가 폭발하지 않게) */
const MAX_SAMPLES = 6;

function sample(values: readonly string[]): string {
  const head = values.slice(0, MAX_SAMPLES).join(', ');
  return values.length > MAX_SAMPLES ? `${head} … (+${String(values.length - MAX_SAMPLES)})` : head;
}

function check(
  id: AiTableCheck['id'],
  ok: boolean,
  severity: AiTableCheckSeverity,
  detail: string,
): AiTableCheck {
  return { id, ok, severity, detail };
}

/** ① 셀 앵커 — 셀 값·머리글이 원문 부분문자열인가(§3) */
function checkCellAnchor(draft: AiTablePageDraft, pageText: string): AiTableCheck {
  const haystack = normalizeCell(pageText);
  const violations: string[] = [];
  for (const column of draft.columns) {
    const header = normalizeCell(column.header);
    if (header === '' || !haystack.includes(header)) violations.push(`header="${column.header}"`);
  }
  const keys = new Set(draft.columns.map((column) => column.key));
  for (const row of draft.rows) {
    for (const [key, value] of Object.entries(row.values)) {
      if (value === null) continue;
      if (!keys.has(key)) continue; // 구조 위반은 ④ 스키마가 잡는다
      const cell = normalizeCell(value);
      if (cell === '' || !haystack.includes(cell)) violations.push(`${key}="${value}"`);
    }
  }
  const ok = violations.length === 0;
  return check(
    'cell-anchor',
    ok,
    'fatal',
    ok
      ? '모든 셀 값·머리글이 원문에 존재한다'
      : `원문에 없는 값 ${String(violations.length)}건(환각): ${sample(violations)}`,
  );
}

/** ② 시각 집합 — 원문 표의 `HH:MM` 집합과 추출 시각 집합이 **동일**해야 한다 */
function checkTimeSet(draft: AiTablePageDraft, region: TableRegion): AiTableCheck {
  const expected = extractTimeTokens(region.text);
  const got = new Set<string>();
  for (const row of draft.rows) {
    for (const value of Object.values(row.values)) {
      if (value === null) continue;
      for (const token of extractTimeTokens(value)) got.add(token);
    }
  }
  const extra = [...got].filter((token) => !expected.has(token)).sort();
  const missing = [...expected].filter((token) => !got.has(token)).sort();
  const ok = extra.length === 0 && missing.length === 0;
  const severity: AiTableCheckSeverity = extra.length > 0 ? 'fatal' : 'drop';
  const detail = ok
    ? `원문 시각 ${String(expected.size)}개 == 추출 시각 ${String(got.size)}개`
    : `원문 시각 ${String(expected.size)}개 · 추출 ${String(got.size)}개 / 표에 없는 시각 ${String(extra.length)}건${extra.length === 0 ? '' : ` [${sample(extra)}]`} · 빠뜨린 시각 ${String(missing.length)}건${missing.length === 0 ? '' : ` [${sample(missing)}]`}`;
  return check('time-set', ok, severity, detail);
}

/** ③ 행 수 — 추출 행 수 = 원문 행 수, 순번은 1..N 정확히 */
function checkRowCount(draft: AiTablePageDraft, region: TableRegion): AiTableCheck {
  const expected = region.rowCount;
  const got = draft.rows.length;
  const seqs = draft.rows.map((row: AiTableRow) => row.seq);
  const integers = seqs.filter((seq): seq is number => seq !== null && Number.isInteger(seq));
  const unique = new Set(integers);
  const seqOk = integers.length === got && unique.size === got && [...unique].every((seq) => seq >= 1 && seq <= got);
  const over = got > expected;
  const ok = got === expected && seqOk;
  const severity: AiTableCheckSeverity = over || !seqOk ? 'fatal' : 'drop';
  const detail = ok
    ? `추출 행 ${String(got)}개 == 원문 행 ${String(expected)}개 · 순번 1..${String(got)}`
    : `원문 행 ${String(expected)}개 · 추출 행 ${String(got)}개${over ? ' (원문에 없는 행을 만들었다)' : ''} · 순번 ${seqOk ? `1..${String(got)}` : `불일치 [${sample(seqs.map((seq) => String(seq)))}]`}`;
  return check('row-count', ok, severity, detail);
}

/** ④ 스키마 — 열/행 구조·의미 키 enum */
function checkSchema(draft: AiTablePageDraft): AiTableCheck {
  const violations: string[] = [];
  const vocabulary = tableKeySet();
  const keys = draft.columns.map((column) => column.key);
  const unique = new Set(keys);
  if (draft.columns.length === 0) violations.push('columns 가 비었다');
  if (unique.size !== keys.length) violations.push(`key 중복: ${sample(keys)}`);
  for (const key of keys) if (!vocabulary.has(key)) violations.push(`사전에 없는 key: ${key}`);
  for (const row of draft.rows) {
    if (row.seq === null || !Number.isInteger(row.seq) || row.seq < 1) violations.push(`seq 가 정수가 아니다: ${String(row.seq)}`);
    for (const key of Object.keys(row.values)) {
      if (!unique.has(key)) violations.push(`columns 에 없는 key 의 값: ${key}`);
    }
  }
  const ok = violations.length === 0;
  return check(
    'schema',
    ok,
    'drop',
    ok ? `열 ${String(keys.length)}개·행 ${String(draft.rows.length)}개 — 의미 키 사전 통과` : `스키마 위반 ${String(violations.length)}건: ${sample(violations)}`,
  );
}

/** 검증 4종을 모두 수행한다(전부 통과해야 `ok === true`). */
export function validateTableDraft(draft: AiTablePageDraft, context: TableValidationContext): AiTableValidation {
  const checks: AiTableCheck[] = [
    checkCellAnchor(draft, context.pageText),
    checkTimeSet(draft, context.region),
    checkRowCount(draft, context.region),
    checkSchema(draft),
  ];
  const failures = checks.filter((entry) => !entry.ok).map((entry) => `${entry.id}(${entry.severity}): ${entry.detail}`);
  return {
    ok: failures.length === 0,
    fatal: checks.some((entry) => !entry.ok && entry.severity === 'fatal'),
    checks,
    failures,
  };
}
