/**
 * T35 **규칙 ↔ AI 교차검증**(docs/08 §5 · 총괄 계약 2026-10-09 코멘트).
 *
 * 왜 정규화 비교인가 (T34 실측 근거):
 *  - T34 실 DeepSeek 초안 vs 규칙 정본 = `agreed 78 / disagreed 70 (148행)`. 그 70행은 **데이터 오류가 아니라
 *    표현 차이**였다 — 병합 셀(colspan) 페이지 2개(`cheonan-station/평일` · `cheonan-terminal/평일`)에서
 *    규칙은 병합 셀을 논리 열로 전개해 값을 채우고, AI 는 접힌 셀 순서대로 배정해 **열(의미 키) 배정이 밀렸다**.
 *  - 그대로 "불일치 = 즉시 보류" 로 두면 매 실행마다 발행이 멈춘다 → **표현 차이는 경고, 값 모순만 차단**.
 *
 * 3등급(총괄 계약 #60):
 *  ① **값 모순(contradiction)**: 같은 의미 키에 양쪽 다 값이 있는데 다르고, 그 값이 어느 쪽에서도
 *     다른 키로 발견되지 않는다 → **차단**(발행 보류 + 알림). Stage A 에서 유일한 차단 사유.
 *  ② **key-shift**: 같은 행에 그 값이 존재하지만 **다른 의미 키로 배정**됐다 → **경고**
 *     (Stage A 발행 진행 · Stage B(AI 초안 실제 채택) 에서는 채택 금지).
 *  ③ **null-vs-값**: 정규화 후에도 한쪽만 값 → **경고**(Stage A 발행 진행 · Stage B 는 검증 4종 통과 시 허용).
 *
 * 정규화는 **양쪽에 동일 함수**(`canonicalCellValue`)로 적용한다:
 *  - 공백·전각/반각·`\u00a0` → 일반 공백, 연속 공백 접기, 앞뒤 trim (`tableRegion.normalizeCell`)
 *  - `null` 과 `""` 를 **같은 것으로** 본다(빈칸 표기 차이).
 *  - 시각: **시(hour)만 0패딩**한다(`8:05` ↔ 규칙 정본 `08:05`). **분 자리는 변형하지 않는다** —
 *    `08:5` 같은 불완전 토큰은 여기서 만들지 않는다(그건 검증 4종의 시각 집합에서 실패한다: 원문 토큰만).
 *
 * 순수 함수다 — 파일 IO·시계·네트워크 없음.
 */

import type { CellValue, DayType, TripRow } from '../scraper/types.js';
import { normalizeCell } from './tableRegion.js';
import type { AiTablePageDraft, AiTableRow } from './types.js';

/** `H:MM` — **분 자리는 2자리 그대로**(변형 금지), 시만 0패딩 대상 */
const CLOCK = /^(\d{1,2}):(\d{2})$/;

/** 값 1개를 비교용 정규형으로 만든다(null·"" 는 같은 것으로 본다). */
export function canonicalCellValue(value: CellValue | undefined | null): string | null {
  if (value === null || value === undefined) return null;
  const text = normalizeCell(String(value));
  if (text === '') return null;
  const clock = CLOCK.exec(text);
  if (clock === null) return text;
  return `${(clock[1] ?? '0').padStart(2, '0')}:${clock[2]}`;
}

/** 행 1건의 원문 값 맵 — null·"" 를 뺀 정규형 맵 */
export function canonicalRow(values: Readonly<Record<string, CellValue>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    const canonical = canonicalCellValue(value);
    if (canonical !== null) out.set(key, canonical);
  }
  return out;
}

/** 행 비교 판정 — ①모순 · ②key-shift · ③null-vs-값 · 일치 */
export type RowVerdict = 'agreed' | 'key-shift' | 'null-mismatch' | 'contradiction';

export interface RowComparison {
  /** 1-based 행 위치(비교 기준: `seq` 가 양쪽에 있으면 seq, 아니면 순서) */
  readonly index: number;
  readonly seq: number | null;
  readonly verdict: RowVerdict;
  /** 사람이 읽는 사유(위반 키·값) — 로그·비교표에 쓴다 */
  readonly details: readonly string[];
}

export interface CrossCheckResult {
  readonly page: string;
  readonly routeId: string;
  readonly dayType: DayType;
  /** 비교한 행 수(규칙 행 ∪ AI 행) */
  readonly comparedRows: number;
  readonly agreedRows: number;
  readonly keyShiftRows: number;
  readonly nullMismatchRows: number;
  readonly contradictedRows: number;
  /** 한쪽에만 있는 행(행 집합 불일치) — **차단** */
  readonly rowSetMismatchRows: number;
  /** 정규화 전(T34 `countAgreementRows`) 일치/불일치 — 추세 비교용 */
  readonly rawAgreedRows: number;
  readonly rawDisagreedRows: number;
  /** AI 초안이 제시한 열 의미 키(정렬) — 드리프트 게이트 §7-⑤ 입력 */
  readonly aiColumnKeys: readonly string[];
  /** 사람이 읽는 사유(차단·경고 공통) — 없으면 빈 배열 */
  readonly details: readonly string[];
  /** ① 값 모순 또는 행 집합 불일치 → 발행 차단 */
  readonly blocked: boolean;
}

const MAX_DETAILS = 6;

function oneLine(details: readonly string[]): string {
  if (details.length <= MAX_DETAILS) return details.join(' · ');
  return `${details.slice(0, MAX_DETAILS).join(' · ')} … (+${String(details.length - MAX_DETAILS)})`;
}

interface PairRead {
  readonly verdict: RowVerdict;
  readonly detail: string | null;
}

/**
 * 행 1쌍(의미 키 → 값)을 3등급으로 판정한다.
 * `shifted`: 값이 **다른 키**로 옮겨간 경우(②). `contradiction`: 어느 쪽에서도 그 값을 다른 키에서 찾지 못한 차이(①).
 */
function comparePair(key: string, ai: string | null, rule: string | null, aiRow: Map<string, string>, ruleRow: Map<string, string>): PairRead {
  if (ai === null && rule === null) return { verdict: 'agreed', detail: null };
  if (ai !== null && rule !== null && ai === rule) return { verdict: 'agreed', detail: null };

  const aiMoved = ai !== null && [...ruleRow.entries()].some(([other, value]) => other !== key && value === ai);
  const ruleMoved = rule !== null && [...aiRow.entries()].some(([other, value]) => other !== key && value === rule);
  if (aiMoved || ruleMoved) {
    return { verdict: 'key-shift', detail: `${key}: AI=${ai ?? 'null'} ↔ 규칙=${rule ?? 'null'} (다른 열로 배정됨)` };
  }
  if (ai !== null && rule !== null) {
    return { verdict: 'contradiction', detail: `${key}: AI="${ai}" ≠ 규칙="${rule}"` };
  }
  return { verdict: 'null-mismatch', detail: `${key}: ${ai === null ? 'AI=null' : `AI="${ai}"`} ↔ ${rule === null ? '규칙=null' : `규칙="${rule}"`}` };
}

/** 한 행의 모든 키를 판정해 행 등급(차단 > 경고 순)으로 합친다. */
function compareRowPairs(aiMask: Readonly<Record<string, CellValue>>, ruleMask: Readonly<Record<string, CellValue>>): { verdict: RowVerdict; details: string[] } {
  const aiRow = canonicalRow(aiMask);
  const ruleRow = canonicalRow(ruleMask);
  const keys = [...new Set([...aiRow.keys(), ...ruleRow.keys()])].sort();
  const details: string[] = [];
  let shifted = 0;
  let nullMismatched = 0;
  let contradicted = 0;
  for (const key of keys) {
    const read = comparePair(key, aiRow.get(key) ?? null, ruleRow.get(key) ?? null, aiRow, ruleRow);
    if (read.verdict === 'contradiction') contradicted += 1;
    else if (read.verdict === 'key-shift') shifted += 1;
    else if (read.verdict === 'null-mismatch') nullMismatched += 1;
    if (read.detail !== null && read.verdict !== 'agreed') details.push(read.detail);
  }
  if (contradicted > 0) return { verdict: 'contradiction', details };
  if (shifted > 0) return { verdict: 'key-shift', details };
  if (nullMismatched > 0) return { verdict: 'null-mismatch', details };
  return { verdict: 'agreed', details: [] };
}

function rowSeq(row: AiTableRow | TripRow): number | null {
  const raw = (row as Record<string, CellValue>)['seq'];
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/** AI 행의 값 맵(seq 제외) — `values` 는 seq 열을 담지 않는 계약이다. */
function aiValues(row: AiTableRow): Readonly<Record<string, CellValue>> {
  return row.values;
}

/** 규칙 행의 값 맵(seq 제외) */
function ruleValues(row: TripRow): Readonly<Record<string, CellValue>> {
  const out: Record<string, CellValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'seq') continue;
    out[key] = value;
  }
  return out;
}

/**
 * 정규화 전(T34) 일치 카운트 — **T34 `countAgreementRows` 정의 그대로**(공백 정규화 + 시 0패딩만,
 * AI 가 돌려준 열만 비교, `null`/`""` 구분 없음). T34 실측 78/70 의 그 수치다 → 추세 비교용으로만 쓴다.
 * 판정(차단/경고)은 `crossCheckPage` 의 3등급이 한다.
 */
export function rawAgreementRows(draft: AiTablePageDraft, ruleRows: readonly TripRow[]): { readonly agreed: number; readonly disagreed: number } {
  const comparable = (value: CellValue | undefined | null): string => canonicalCellValue(value) ?? '';
  const total = Math.max(draft.rows.length, ruleRows.length);
  let agreed = 0;
  let disagreed = 0;
  for (let index = 0; index < total; index += 1) {
    const aiRow = draft.rows[index];
    const ruleRow = ruleRows[index];
    if (aiRow === undefined || ruleRow === undefined) {
      disagreed += 1;
      continue;
    }
    let same = comparable(aiRow.seq ?? null) === comparable(ruleRow['seq'] ?? null);
    for (const [key, value] of Object.entries(aiRow.values)) {
      if (!(key in ruleRow)) continue;
      if (comparable(value) !== comparable(ruleRow[key] ?? null)) same = false;
    }
    if (same) agreed += 1;
    else disagreed += 1;
  }
  return { agreed, disagreed };
}

export interface CrossCheckInput {
  readonly page: string;
  readonly routeId: string;
  readonly dayType: DayType;
  readonly draft: AiTablePageDraft;
  /** 같은 페이지의 규칙 정본 행(0건이면 채택 후보 판정 — Stage B) */
  readonly ruleRows: readonly TripRow[];
}

/**
 * 페이지 1건 교차검증 — 행 단위로 3등급 판정해 카운트·사유를 만든다.
 * 행 짝짓기는 `seq` 를 우선하고, 한쪽에만 있는 행은 **행 집합 불일치(차단)** 로 센다.
 */
export function crossCheckPage(input: CrossCheckInput): CrossCheckResult {
  const { draft, ruleRows } = input;
  const aiColumnKeys = [...new Set(draft.columns.map((column) => column.key))].sort();

  // Stage B 후보(규칙이 이 페이지에서 행을 0건 만들었다) — 비교 대상이 없으므로 차단 사유도 없다.
  //   채택 여부는 `adoptable()`(① · ② 0건) + 계약 열 검사로 판단한다(검증 4종은 별도 통과 필요).
  if (ruleRows.length === 0) {
    return {
      page: input.page,
      routeId: input.routeId,
      dayType: input.dayType,
      comparedRows: 0,
      agreedRows: 0,
      keyShiftRows: 0,
      nullMismatchRows: 0,
      contradictedRows: 0,
      rowSetMismatchRows: 0,
      rawAgreedRows: 0,
      rawDisagreedRows: 0,
      aiColumnKeys,
      details: [`규칙 0건 — 비교 대상 없음(Stage B 채택 후보 · AI 행 ${String(draft.rows.length)}개)`],
      blocked: false,
    };
  }

  const raw = rawAgreementRows(draft, ruleRows);

  const aiBySeq = new Map<number, AiTableRow>();
  const aiUnsequenced: AiTableRow[] = [];
  for (const row of draft.rows) {
    const seq = rowSeq(row);
    if (seq === null) aiUnsequenced.push(row);
    else if (!aiBySeq.has(seq)) aiBySeq.set(seq, row);
    else aiUnsequenced.push(row);
  }
  const ruleBySeq = new Map<number, TripRow>();
  const ruleUnsequenced: TripRow[] = [];
  for (const row of ruleRows) {
    const seq = rowSeq(row);
    if (seq === null) ruleUnsequenced.push(row);
    else if (!ruleBySeq.has(seq)) ruleBySeq.set(seq, row);
    else ruleUnsequenced.push(row);
  }

  const pairs: { index: number; seq: number | null; ai: AiTableRow | null; rule: TripRow | null }[] = [];
  for (const [seq, rule] of [...ruleBySeq.entries()].sort((a, b) => a[0] - b[0])) {
    pairs.push({ index: pairs.length + 1, seq, ai: aiBySeq.get(seq) ?? null, rule });
  }
  for (const [seq, ai] of [...aiBySeq.entries()].sort((a, b) => a[0] - b[0])) {
    if (!ruleBySeq.has(seq)) pairs.push({ index: pairs.length + 1, seq, ai, rule: null });
  }
  const leftover = Math.max(ruleUnsequenced.length, aiUnsequenced.length);
  for (let index = 0; index < leftover; index += 1) {
    pairs.push({ index: pairs.length + 1, seq: null, ai: aiUnsequenced[index] ?? null, rule: ruleUnsequenced[index] ?? null });
  }

  let agreed = 0;
  let keyShift = 0;
  let nullMismatch = 0;
  let contradiction = 0;
  let rowSetMismatch = 0;
  const details: string[] = [];
  const contradictions: string[] = [];
  const shifts: string[] = [];

  for (const pair of pairs) {
    if (pair.ai === null || pair.rule === null) {
      rowSetMismatch += 1;
      const where = pair.seq === null ? `#${String(pair.index)}` : `seq ${String(pair.seq)}`;
      const side = pair.ai === null ? 'AI 초안에 없음' : '규칙에 없음';
      details.push(`행 ${where}: ${side}`);
      continue;
    }
    const read = compareRowPairs(aiValues(pair.ai), ruleValues(pair.rule));
    if (read.verdict === 'contradiction') {
      contradiction += 1;
      contradictions.push(`행 ${String(pair.seq ?? pair.index)}: ${oneLine(read.details)}`);
    } else if (read.verdict === 'key-shift') {
      keyShift += 1;
      shifts.push(`행 ${String(pair.seq ?? pair.index)}: ${oneLine(read.details)}`);
    } else if (read.verdict === 'null-mismatch') {
      nullMismatch += 1;
    } else {
      agreed += 1;
    }
  }

  return {
    page: input.page,
    routeId: input.routeId,
    dayType: input.dayType,
    comparedRows: pairs.length,
    agreedRows: agreed,
    keyShiftRows: keyShift,
    nullMismatchRows: nullMismatch,
    contradictedRows: contradiction,
    rowSetMismatchRows: rowSetMismatch,
    rawAgreedRows: raw.agreed,
    rawDisagreedRows: raw.disagreed,
    aiColumnKeys,
    details: [...details, ...contradictions, ...shifts],
    blocked: contradiction > 0 || rowSetMismatch > 0,
  };
}

/** 여러 페이지 결과를 합산(§8 기록) */
export interface CrossCheckTotals {
  readonly agreedRows: number;
  readonly keyShiftRows: number;
  readonly nullMismatchRows: number;
  readonly contradictedRows: number;
  readonly rowSetMismatchRows: number;
  readonly rawAgreedRows: number;
  readonly rawDisagreedRows: number;
}

export function sumCrossCheck(results: readonly CrossCheckResult[]): CrossCheckTotals {
  const total: CrossCheckTotals = {
    agreedRows: 0,
    keyShiftRows: 0,
    nullMismatchRows: 0,
    contradictedRows: 0,
    rowSetMismatchRows: 0,
    rawAgreedRows: 0,
    rawDisagreedRows: 0,
  };
  const acc = { ...total } as Record<keyof CrossCheckTotals, number>;
  for (const result of results) {
    acc.agreedRows += result.agreedRows;
    acc.keyShiftRows += result.keyShiftRows;
    acc.nullMismatchRows += result.nullMismatchRows;
    acc.contradictedRows += result.contradictedRows;
    acc.rowSetMismatchRows += result.rowSetMismatchRows;
    acc.rawAgreedRows += result.rawAgreedRows;
    acc.rawDisagreedRows += result.rawDisagreedRows;
  }
  return acc;
}

/** Stage B 채택 가능 여부 — ① 0건 **그리고** ② 0건(총괄 계약 #60: AI 출력을 실제로 쓸 때만 열 배정까지 요구). */
export function adoptable(result: CrossCheckResult): boolean {
  return result.contradictedRows === 0 && result.keyShiftRows === 0 && result.rowSetMismatchRows === 0;
}
