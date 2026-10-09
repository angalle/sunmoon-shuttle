/**
 * 원본 HTML → **시간표 표 영역**(셀 원문 텍스트) — T34 AI 표 추출기의 입력이자 검증 ②③의 기준.
 *
 * 왜 별도 모듈인가:
 *  - AI 는 **원문 셀 토큰**(`8:05`, `Χ`, `0:15`, `금(X)`)을 봐야 한다. 규칙 파서(`parse.ts`)의 결과는
 *    이미 정규화(`8:05`→`08:05`, `Χ`→null)된 값이라 AI 입력으로 쓸 수 없다 — 그러면 §3(원문 토큰만)이 깨진다.
 *  - 그래서 **같은 규칙으로**(헤더 첫 칸이 `순`인 표를 정확히 1개) 표를 찾되, 셀은 **정규화만** 해서 넘긴다.
 *    `tools/scraper/parse.ts` 는 이 태스크의 커밋 경로 밖이라 그대로 두고, 표 스캔만 여기서 다시 한다
 *    (규칙 파서는 정본 그대로 유지 — AI 는 규칙을 대체하지 않는다).
 *
 * `text` 는 헤더 1줄 + 데이터 행들(`열1 | 열2 | …`)이다. 시각 집합 검증(§4-2)은 **이 텍스트**의
 * `HH:MM` 토큰과 AI 추출 시각을 비교한다(페이지의 안내문 시각과 섞이지 않게 하기 위해서다 —
 * 실측: 안내문 `13:30/15:30/19:30` 이 페이지 본문에 섞여 있다).
 */

import { createHash } from 'node:crypto';

import { normalizeText } from '../scraper/parse.js';

export const SCHEDULE_HEADER_FIRST_CELL = '순';

export interface TableRegion {
  /** 헤더 셀 원문(공백 정규화) — 표 열 순서 */
  readonly header: readonly string[];
  /** 데이터 행 셀 원문(공백 정규화) — 표 행 순서. 병합 셀은 한 값이다 */
  readonly rows: readonly (readonly string[])[];
  /** AI 에게 주는 본문: 헤더 1줄 + 데이터 행들(` | ` 구분) */
  readonly text: string;
  /** 원문 표의 데이터 행 수(= `순` 번호 최대값) */
  readonly rowCount: number;
  /** 이 입력의 내용 해시(`sha256:…`) — AI 호출 캐시 키(§6) */
  readonly contentHash: string;
}

interface TableBlock {
  readonly index: number;
  readonly html: string;
}

/** 중첩 깊이를 세어 `<table>` 블록을 뽑는다(닫히지 않은 표는 버린다 — `parse.ts` 와 같은 규칙). */
function findTables(html: string): TableBlock[] {
  const tables: TableBlock[] = [];
  let cursor = 0;
  let index = 0;
  for (;;) {
    const start = html.indexOf('<table', cursor);
    if (start < 0) break;
    let depth = 0;
    let pos = start;
    let end = -1;
    while (pos < html.length) {
      const open = html.indexOf('<table', pos);
      const close = html.indexOf('</table', pos);
      if (close < 0) break;
      if (open >= 0 && open < close) {
        depth += 1;
        pos = open + '<table'.length;
        continue;
      }
      depth -= 1;
      if (depth === 0) {
        const gt = html.indexOf('>', close);
        end = gt < 0 ? html.length : gt + 1;
        break;
      }
      pos = close + '</table'.length;
    }
    if (end < 0) {
      cursor = start + '<table'.length;
      continue;
    }
    tables.push({ index, html: html.slice(start, end) });
    index += 1;
    cursor = end;
  }
  return tables;
}

function findRows(fragment: string): string[] {
  return [...fragment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? '');
}

/** 행의 셀 원문(공백 정규화) — 병합 셀은 하나의 값이다 */
function findCells(rowFragment: string): string[] {
  return [...rowFragment.matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)].map((match) => normalizeText(match[3] ?? ''));
}

/**
 * 시간표 표를 찾는다 — 헤더 첫 칸이 `순` 인 행을 가진 표가 **정확히 1개**여야 한다.
 * 0개/2개 이상이면 null(추측하지 않는다: AI 를 건너뛰고 규칙 정본으로만 발행).
 */
export function findScheduleTable(html: string): TableRegion | null {
  const candidates: { headerCells: string[]; dataRows: string[][] }[] = [];
  for (const table of findTables(html)) {
    const rows = findRows(table.html);
    const headerRow = rows.findIndex((row) => findCells(row)[0] === SCHEDULE_HEADER_FIRST_CELL);
    if (headerRow < 0) continue;
    const headerCells = findCells(rows[headerRow] ?? '');
    const dataRows = rows.slice(headerRow + 1).map(findCells).filter((cells) => cells.length > 0);
    candidates.push({ headerCells, dataRows });
  }
  if (candidates.length !== 1) return null;
  const only = candidates[0];
  if (only === undefined || only.headerCells.length === 0 || only.dataRows.length === 0) return null;
  const lines = [only.headerCells.join(' | '), ...only.dataRows.map((cells) => cells.join(' | '))];
  const text = lines.join('\n');
  return {
    header: only.headerCells,
    rows: only.dataRows,
    text,
    rowCount: only.dataRows.length,
    contentHash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`,
  };
}

/** `HH:MM`/`H:MM` 토큰을 `HH:MM` 으로 정규화한 **집합**(§4-2 시각 집합 비교). */
export function extractTimeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const hour = match[1];
    const minute = match[2];
    if (hour === undefined || minute === undefined) continue;
    tokens.add(`${hour.padStart(2, '0')}:${minute}`);
  }
  return tokens;
}

/** 셀 값 비교용 정규화(§3): 앞뒤 공백·전각/반각 공백·`\u00a0` → 일반 공백, 연속 공백 접기. */
export function normalizeCell(value: string): string {
  return value.replace(/[\u00a0\u3000]/g, ' ').replace(/\s+/gu, ' ').trim();
}
