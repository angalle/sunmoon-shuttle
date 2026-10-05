/**
 * 원본 HTML 스냅샷 → 노선 단위 부분 객체 (순수 함수 — 파일 IO 없음, DOM 없음).
 *
 * 파싱 방식: **정규식으로 문서 전체를 훑지 않는다.**
 *   ① 표를 태그 경계로 잘라낸다(`<table>` … `</table>`, 중첩 깊이 계산)
 *   ② 그 안에서 `<tr>`/`<t[hd]>` 경계로 행·셀을 나눈다
 *   ③ `colspan` 을 **슬롯(논리 열)** 으로 확장해 헤더 셀과 대응시킨다
 *      — 병합 셀은 하나의 텍스트 값이며, 대응하는 헤더 열 모두에 같은 값을 넣는다(셀 수 강제 금지)
 *   ④ 헤더 원문을 계약(`routeMeta` 의 label)과 대조하고, 다르면 **어느 열이 어떻게 다른지** 오류로 던진다
 *
 * 실패는 전부 `ScrapeError`(명확한 메시지)로 던진다 — 조용한 손상 금지.
 */

import { ScrapeError } from './types.js';
import type { BusRef, Contacts, Notice, RouteMeta, SemesterPeriod, Snapshot, TripRow } from './types.js';

// ─────────────────────────── 텍스트 유틸 ───────────────────────────

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', hellip: '…',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
      return whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** 셀/헤더 텍스트 — `<br>` 은 공백, 태그 제거, 엔티티 해석, 공백 정규화(trim) */
export function normalizeText(fragment: string): string {
  const withSpaces = fragment.replace(/<br\s*\/?>/gi, ' ');
  const withoutTags = withSpaces.replace(/<[^>]*>/g, '');
  return decodeEntities(withoutTags).replace(/\s+/gu, ' ').trim();
}

/** 문서 일부를 줄 단위 텍스트로 바꾼다(블록 태그 = 줄바꿈, `span`/`u` 같은 인라인 태그는 줄바꿈 아님). 안내문·참고문구 파싱용. */
function toLines(fragment: string): string[] {
  const withBreaks = fragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|table|ul|h4)>/gi, '\n');
  const withoutTags = withBreaks.replace(/<[^>]*>/g, '');
  return decodeEntities(withoutTags)
    .replace(/\u3000/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line !== '');
}

// ─────────────────────────── 표 스캔 ───────────────────────────

interface TableBlock {
  readonly index: number;
  readonly html: string;
}

/** 중첩 깊이를 세어 `<table>` 블록을 뽑는다. 닫히지 않은 표(잘린 HTML)는 **버리지 않고 후보에서 제외**한다. */
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
      if (close < 0) break; // 닫힘 없음 = 잘렸거나 미완성
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

interface RawCell {
  readonly text: string;
  readonly span: number;
}

function findRows(fragment: string): string[] {
  return [...fragment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1] ?? '');
}

function findCells(rowFragment: string): RawCell[] {
  const cells: RawCell[] = [];
  for (const match of rowFragment.matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
    const attrs = match[2] ?? '';
    const body = match[3] ?? '';
    const spanMatch = /colspan\s*=\s*"?(\d+)"?/i.exec(attrs);
    const span = spanMatch?.[1] === undefined ? 1 : Number.parseInt(spanMatch[1], 10);
    if (!Number.isFinite(span) || span < 1 || span > 20) {
      throw new ScrapeError(`표 셀의 colspan 값이 비정상입니다: ${span} (attrs="${attrs.trim()}")`);
    }
    cells.push({ text: normalizeText(body), span });
  }
  return cells;
}

interface HeaderSlot {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function headerSlots(cells: readonly RawCell[]): HeaderSlot[] {
  const slots: HeaderSlot[] = [];
  let cursor = 0;
  for (const cell of cells) {
    slots.push({ start: cursor, end: cursor + cell.span, text: cell.text });
    cursor += cell.span;
  }
  return slots;
}

const SCHEDULE_HEADER_FIRST_CELL = '순';

/**
 * 시간표 표 선택: 헤더 첫 칸이 `순` 인 행을 가진 표가 **정확히 1개**여야 한다.
 * (빈 표·`학생회관 승차 가능 시간` 안내표는 헤더가 없으므로 자연히 제외된다)
 */
function selectScheduleTable(tables: readonly TableBlock[]): { table: TableBlock; headerRow: number; rows: string[] } {
  const candidates: { table: TableBlock; headerRow: number; rows: string[] }[] = [];
  for (const table of tables) {
    const rows = findRows(table.html);
    const headerRow = rows.findIndex((row) => findCells(row)[0]?.text === SCHEDULE_HEADER_FIRST_CELL);
    if (headerRow >= 0) candidates.push({ table, headerRow, rows });
  }
  if (candidates.length === 0) {
    throw new ScrapeError(
      `시간표 표를 찾지 못했습니다 — 헤더 첫 칸이 "${SCHEDULE_HEADER_FIRST_CELL}" 인 행이 있는 표가 없습니다(표 ${tables.length}개, 원본 개편/잘림 의심)`,
    );
  }
  if (candidates.length > 1) {
    const where = candidates.map((c) => `표#${c.table.index}(헤더 ${c.headerRow + 1}행)`).join(' · ');
    throw new ScrapeError(`시간표 표가 여러 개로 보입니다 — 어느 것이 본표인지 확정할 수 없습니다: ${where}`);
  }
  const only = candidates[0];
  if (only === undefined) throw new ScrapeError('내부 오류: 후보 표 선택 실패');
  return only;
}

// ─────────────────────────── 셀 값 변환 ───────────────────────────

const NO_SERVICE_MARKS = new Set(['Χ', 'X', 'x', 'χ']);
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function convertCell(raw: string, key: string, kind: string, where: string): TripRow[string] {
  const text = raw.trim();
  if (text === '' || NO_SERVICE_MARKS.has(text)) return null;

  if (kind === 'note') return text; // 원문 보존(예: `금(X)`, `0:15`, `중간노선전용`)

  const timeMatch = TIME_PATTERN.exec(text);
  if (timeMatch !== null) {
    const hour = timeMatch[1];
    const minute = timeMatch[2];
    if (hour === undefined || minute === undefined) throw new ScrapeError(`내부 오류: 시각 파싱 실패 (${text})`);
    return `${hour.padStart(2, '0')}:${minute}`;
  }

  if (kind === 'seq') {
    const num = Number.parseInt(text, 10);
    if (!Number.isInteger(num) || String(num) !== text) {
      throw new ScrapeError(`${where}: 순번 열("${key}") 값이 정수가 아닙니다 — "${text}"`);
    }
    return num;
  }
  if (kind === 'time') {
    throw new ScrapeError(
      `${where}: 시각 열("${key}") 값이 시각(H:MM/HH:MM)도 Χ 도 아닙니다 — "${text}" (열 밀림/표 개편 의심)`,
    );
  }
  return text; // kind === 'text' — 원문 보존(예: `경유`, `5분~10분 소요예상`)
}

// ─────────────────────────── 페이지 조각 추출 ───────────────────────────

function findH4ByClass(html: string, className: string): string | null {
  const re = new RegExp(`<h4[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</h4>`, 'i');
  const match = re.exec(html);
  return match?.[1] === undefined ? null : normalizeText(match[1]);
}

function findSemesterTitle(html: string): string | null {
  for (const match of html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)) {
    const text = normalizeText(match[1] ?? '');
    if (text.includes('셔틀버스') && (text.includes('시간표') || text.includes('운행기간'))) return text;
  }
  return null;
}

const PERIOD_LABEL_PATTERN = /(\d{4})\s*-\s*(\d)\s*학기/;
const START_PATTERN = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/;
const END_WITH_YEAR_PATTERN = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/;
const END_NO_YEAR_PATTERN = /(\d{1,2})\s*\.\s*(\d{1,2})/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-2학기 셔틀버스 시간표(2026.9.1(화)~2026.12.14(월))` / `… 휴일 운행기간 : 2026.9.5.(토) ~ 12.13.(일)` */
export function parsePeriod(title: string): SemesterPeriod {
  const labelMatch = PERIOD_LABEL_PATTERN.exec(title);
  if (labelMatch === null) {
    throw new ScrapeError(`학기 문구에서 "<연도>-<학기>학기" 를 찾지 못했습니다 — "${title}" (문구 하드코딩 금지)`);
  }
  const [labelYear, labelTerm] = [labelMatch[1], labelMatch[2]];
  const kind: SemesterPeriod['kind'] = title.includes('휴일') ? 'holiday' : 'semester';
  const [left, right] = title.split('~');
  if (left === undefined || right === undefined) {
    throw new ScrapeError(`학기 문구에 "~" 기간 구분자가 없습니다 — "${title}"`);
  }
  const startMatch = START_PATTERN.exec(left);
  if (startMatch === null) {
    throw new ScrapeError(`학기 문구의 시작일을 찾지 못했습니다 — "${title}"`);
  }
  const startYear = Number.parseInt(startMatch[1] ?? '', 10);
  const startMonth = Number.parseInt(startMatch[2] ?? '', 10);
  const startDay = Number.parseInt(startMatch[3] ?? '', 10);
  const endWithYear = END_WITH_YEAR_PATTERN.exec(right);
  const endNoYear = END_NO_YEAR_PATTERN.exec(right.replace(/\([^)]*\)/g, ''));
  const endYear = endWithYear === null ? startYear : Number.parseInt(endWithYear[1] ?? '', 10);
  const endMonth = Number.parseInt((endWithYear ?? endNoYear)?.[endWithYear === null ? 1 : 2] ?? '', 10);
  const endDay = Number.parseInt((endWithYear ?? endNoYear)?.[endWithYear === null ? 2 : 3] ?? '', 10);
  if (![startYear, startMonth, startDay, endYear, endMonth, endDay].every((n) => Number.isFinite(n))) {
    throw new ScrapeError(`학기 문구의 기간을 해석하지 못했습니다 — "${title}"`);
  }
  return {
    title,
    label: `${labelYear}-${labelTerm}학기`,
    startsOn: `${startYear}-${pad2(startMonth)}-${pad2(startDay)}`,
    endsOn: `${endYear}-${pad2(endMonth)}-${pad2(endDay)}`,
    kind,
  };
}

const CONTACT_PATTERNS = {
  team: /콘텐츠\s*관리\s*담당\s*:\s*<strong>([\s\S]*?)<\/strong>/i,
  tel: /Tel\s*:\s*<strong>([\s\S]*?)<\/strong>/i,
  updatedAt: /최근\s*업데이트\s*:\s*<strong>([\s\S]*?)<\/strong>/i,
};

function extractContacts(html: string): Contacts | null {
  const team = CONTACT_PATTERNS.team.exec(html);
  const tel = CONTACT_PATTERNS.tel.exec(html);
  if (team?.[1] === undefined || tel?.[1] === undefined) return null;
  const teamText = normalizeText(team[1]);
  const telText = normalizeText(tel[1]);
  if (teamText === '' || telText === '') return null;
  return { team: teamText, tel: telText };
}

function extractSourceUpdatedAt(html: string): string | null {
  const match = CONTACT_PATTERNS.updatedAt.exec(html);
  if (match?.[1] === undefined) return null;
  const text = normalizeText(match[1]);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function extractPath(html: string): string | null {
  const inParagraph = /<p\b[^>]*>([^<]*운행노선[^<]*)<\/p>/i.exec(html);
  const source = inParagraph?.[1] ?? /([^<>]*운행노선[^<>]*)/.exec(html)?.[1];
  if (source === undefined) return null;
  const text = normalizeText(source).replace(/^-\s*운행노선\s*:?\s*/u, '');
  if (text === '') return null;
  return text.replace(/\s*>\s*/g, ' > ').replace(/\s+/gu, ' ').trim();
}

const NOTICE_DATE_PATTERN = /^\*(?<label>[^[]*)\[(?<when>[^\]]*)\]\s*[:：]\s*(?<message>.+)$/u;
const DATE_PAIR_PATTERN = /(\d{1,2})\s*\.\s*(\d{1,2})/g;

function noticeKindFor(message: string): Notice['kind'] {
  if (message.includes('운행 없음') || message.includes('운행없음')) return 'no-service';
  if (message.includes('시간표로 운행')) return 'alternate-schedule';
  return 'notice';
}

function parseDatedNotice(raw: string, year: number): Notice {
  const match = NOTICE_DATE_PATTERN.exec(raw);
  const label = match?.groups?.['label']?.trim();
  const when = match?.groups?.['when'];
  const message = match?.groups?.['message']?.trim();
  if (label === undefined || when === undefined || message === undefined) {
    throw new ScrapeError(`안내문 형식을 해석하지 못했습니다(*이름[날짜]: 내용) — "${raw}"`);
  }
  const pairs = [...when.matchAll(DATE_PAIR_PATTERN)].map((m) => ({ month: Number(m[1]), day: Number(m[2]) }));
  if (pairs.length === 0) {
    throw new ScrapeError(`안내문에서 날짜를 찾지 못했습니다 — "${raw}"`);
  }
  for (const pair of pairs) {
    if (!(pair.month >= 1 && pair.month <= 12) || !(pair.day >= 1 && pair.day <= 31)) {
      throw new ScrapeError(`안내문 날짜 범위가 비정상입니다 — "${raw}" (${pair.month}.${pair.day})`);
    }
  }
  const first = pairs[0];
  const last = pairs[pairs.length - 1];
  if (first === undefined || last === undefined) throw new ScrapeError(`내부 오류: 안내문 날짜 파싱 — "${raw}"`);
  const start = `${year}-${pad2(first.month)}-${pad2(first.day)}`;
  const end = `${year}-${pad2(last.month)}-${pad2(last.day)}`;
  return {
    kind: noticeKindFor(message),
    text: `${label}: ${message}`,
    raw,
    date: start,
    ...(pairs.length > 1 ? { endDate: end } : {}),
  };
}

interface ProseBlocks {
  readonly notices: readonly Notice[];
  readonly busRefs: readonly BusRef[];
}

const BUS_MARKER = '노선별 시내버스 참고';
const NOTICE_MARKER = '안내사항';
const PROSE_END_MARKERS = ['goto_bus', 'manager_wrap', '방학 시간표'] as const;

/** 안내문(휴일·요금·승차 안내)과 시내버스 참고줄을 줄 단위로 뽑는다. */
function extractProse(html: string, period: SemesterPeriod | null): ProseBlocks {
  const start = html.indexOf(BUS_MARKER);
  if (start < 0) return { notices: [], busRefs: [] };
  let end = html.length;
  for (const marker of PROSE_END_MARKERS) {
    const at = html.indexOf(marker, start);
    if (at >= 0 && at < end) end = at;
  }
  const lines = toLines(html.slice(start, end));
  const splitAt = lines.findIndex((line) => line.includes(NOTICE_MARKER));
  const busLines = (splitAt < 0 ? lines : lines.slice(0, splitAt)).filter((l) => l.startsWith('-'));
  const noticeLines = (splitAt < 0 ? [] : lines.slice(splitAt + 1)).filter(
    (l) => l.startsWith('*') || l.startsWith('-'),
  );

  const yearText = period?.startsOn.slice(0, 4);
  if (noticeLines.some((l) => l.startsWith('*')) && yearText === undefined) {
    throw new ScrapeError('안내문 날짜에 쓸 연도를 알 수 없습니다(학기 문구 파싱 실패)');
  }
  const year = yearText === undefined ? 0 : Number.parseInt(yearText, 10);

  const notices: Notice[] = noticeLines.map((line) =>
    line.startsWith('*') ? parseDatedNotice(line, year) : { kind: 'notice', text: line.replace(/^-\s*/u, ''), raw: line },
  );
  return { notices, busRefs: parseBusRefs(busLines) };
}

/** `- 천안터미널 : 970번, 971번 (탑승장소: 선문대 서문 승강장)` / `- 탕정역: 700번(선문대 서문), …` */
function parseBusRefs(lines: readonly string[]): BusRef[] {
  const refs: BusRef[] = [];
  for (const line of lines) {
    const body = line.replace(/^-\s*/u, '');
    const colon = body.indexOf(':');
    if (colon < 0) continue;
    const to = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1).trim();
    if (to === '' || rest === '') continue;
    const boarding = /\(탑승장소\s*:\s*([^)]*)\)\s*$/u.exec(rest);
    if (boarding?.[1] !== undefined) {
      const stop = boarding[1].trim();
      for (const item of rest.slice(0, boarding.index).split(',')) {
        const line0 = normalizeBusLine(item);
        if (line0 !== '') refs.push({ line: line0, stop, to });
      }
      continue;
    }
    for (const item of splitTopLevel(rest)) {
      const paren = /^(.*?)\(([^)]*)\)\s*$/u.exec(item);
      const line0 = normalizeBusLine(paren?.[1] ?? item);
      if (line0 === '') continue;
      refs.push({ line: line0, stop: (paren?.[2] ?? '').trim() || '미기재', to });
    }
  }
  return refs;
}

function normalizeBusLine(text: string): string {
  return text
    .replace(/\s+/gu, '')
    .replace(/번$/u, '')
    .trim();
}

/** 괄호 안 쉼표는 구분자로 보지 않는다(승강장 여러 곳이 한 괄호에 들어 있다). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts.filter((p) => p !== '');
}

function extractHallNotice(html: string): Notice | null {
  const match = /학생회관 승차 가능 시간[^<]*/u.exec(html);
  if (match === null) return null;
  const raw = normalizeText(match[0]);
  if (raw === '') return null;
  return { kind: 'notice', text: raw, raw };
}

/** 운행 중단 페이지: 제목 괄호 안 사유 + 문의 줄 */
function extractSuspendedNotice(html: string, routeTitle: string): Notice[] {
  const notices: Notice[] = [];
  const paren = /^(?<name>[^(]*)\((?<reason>[^)]*)\)\s*$/u.exec(routeTitle);
  const name = paren?.groups?.['name']?.trim() ?? routeTitle;
  const reason = paren?.groups?.['reason']?.trim();
  if (reason !== undefined && reason !== '') {
    notices.push({
      kind: 'notice',
      text: `${name}: ${reason}`,
      raw: `[원문 제목] ${routeTitle}`,
    });
  }
  const h4 = /<h4\b[^>]*class="title22[^"]*"[^>]*>[\s\S]*?<\/h4>/i.exec(html);
  if (h4 !== null) {
    for (const line of toLines(html.slice(h4.index, h4.index + 2000))) {
      if (line.startsWith('-') && line.includes('문의')) {
        notices.push({ kind: 'notice', text: line.replace(/^-\s*/u, ''), raw: line });
      }
    }
  }
  return notices;
}

// ─────────────────────────── 진입점 ───────────────────────────

/**
 * 스냅샷 1개(= 원본 페이지 1개)를 파싱한다.
 *
 * @param html     저장된 원본 HTML
 * @param meta     노선 메타(계약)
 * @param dayType  파일명에서 읽은 요일(`data/raw/<학기>-<노선>-<요일>.html`)
 */
export function parseSnapshot(html: string, meta: RouteMeta, dayType: Snapshot['dayType']): Snapshot {
  if (html.trim() === '') throw new ScrapeError('빈 HTML 입니다(스냅샷 손상)');

  const routeTitle = findH4ByClass(html, 'title22');
  if (routeTitle === null) {
    throw new ScrapeError('노선 제목(<h4 class="title22">)을 찾지 못했습니다 — 원본 개편/잘림 의심');
  }
  const periodTitle = findSemesterTitle(html);
  const period = periodTitle === null ? null : parsePeriod(periodTitle);
  const contacts = extractContacts(html);
  const sourceUpdatedAt = extractSourceUpdatedAt(html);
  const path = extractPath(html);
  const prose = extractProse(html, period);
  const hall = extractHallNotice(html);
  const baseNotices = [...prose.notices, ...(hall === null ? [] : [hall])];

  const dayMeta = meta.days.find((d) => d.dayType === dayType) ?? null;

  // ── 운행 중단 노선(계약상 표가 없는 요일) ──
  if (dayMeta === null) {
    if (meta.status !== 'suspended') {
      throw new ScrapeError(
        `계약(${meta.id})의 ${dayType} 열 구성이 없습니다 — routeMeta.days 에 (노선, 요일) 을 등록하거나 status 를 확인하세요`,
      );
    }
    const tables = findTables(html);
    const scheduleTables = tables.filter((t) =>
      findRows(t.html).some((row) => findCells(row)[0]?.text === SCHEDULE_HEADER_FIRST_CELL),
    );
    if (scheduleTables.length > 0) {
      throw new ScrapeError(
        `운행 중단(${meta.id})으로 계약된 페이지에 시간표 표가 있습니다 — 원본이 바뀌었습니다(계약·routeMeta 갱신 필요)`,
      );
    }
    const empty = { columns: [] as readonly string[], keys: [] as readonly string[], trips: [] as readonly TripRow[] };
    return {
      routeId: meta.id,
      routeTitle,
      path,
      status: 'suspended',
      suspendedReason: routeTitle.includes('(')
        ? routeTitle.slice(routeTitle.indexOf('(') + 1, routeTitle.lastIndexOf(')'))
        : null,
      dayType,
      columns: empty.columns,
      keys: empty.keys,
      trips: empty.trips,
      notices: [...baseNotices, ...extractSuspendedNotice(html, routeTitle)],
      busRefs: prose.busRefs,
      contacts,
      period,
      sourceUpdatedAt,
    };
  }

  // ── 정상 노선: 시간표 표 파싱 ──
  const tables = findTables(html);
  const selected = selectScheduleTable(tables);
  const headerCells = findCells(selected.rows[selected.headerRow] ?? '');
  const header = headerSlots(headerCells);

  if (header.length !== dayMeta.columns.length) {
    throw new ScrapeError(
      `${meta.id}/${dayType}: 헤더 열 수가 계약과 다릅니다 — 계약 ${dayMeta.columns.length}열, 실제 ${header.length}열. ` +
        `실제 헤더: [${header.map((h) => `"${h.text}"`).join(', ')}]`,
    );
  }
  const columns: string[] = [];
  const keys: string[] = [];
  dayMeta.columns.forEach((spec, i) => {
    const actual = header[i]?.text ?? '';
    if (actual !== spec.label) {
      throw new ScrapeError(
        `${meta.id}/${dayType}: 헤더 ${i + 1}번째 열이 계약과 다릅니다 — 계약 "${spec.label}", 실제 "${actual}"`,
      );
    }
    columns.push(actual);
    keys.push(spec.key);
  });
  const kindByKey = new Map(dayMeta.columns.map((spec) => [spec.key, spec.kind] as const));

  const dataRows = selected.rows.slice(selected.headerRow + 1);
  if (dataRows.length === 0) {
    throw new ScrapeError(`${meta.id}/${dayType}: 시간표 데이터 행이 없습니다 — 원본 개편/잘림 의심`);
  }

  const trips: TripRow[] = [];
  dataRows.forEach((rowFragment, rowIndex) => {
    const cells = findCells(rowFragment);
    const where = `${meta.id}/${dayType} ${rowIndex + 1}번째 데이터 행`;
    const values: TripRow = {};
    let slot = 0;
    for (const cell of cells) {
      const overlaps = header.filter((h) => h.start < slot + cell.span && h.end > slot);
      // 병합 셀은 대응하는 헤더 열들을 **완전히** 덮어야 한다(일부만 걸치면 열 밀림 = 구조 변조)
      const partial = overlaps.filter((h) => !(h.start >= slot && h.end <= slot + cell.span));
      if (overlaps.length === 0 || partial.length > 0) {
        throw new ScrapeError(
          `${where}: 셀 경계가 헤더 열과 어긋납니다(slot ${slot}, colspan ${cell.span}, 값 "${cell.text}") — 표 구조 변조 의심`,
        );
      }
      for (const h of overlaps) {
        const key = keys[header.indexOf(h)];
        if (key === undefined) throw new ScrapeError(`${where}: 내부 오류 — 헤더 슬롯에 대응하는 키가 없습니다`);
        const kind = kindByKey.get(key) ?? 'text';
        values[key] = convertCell(cell.text, key, kind, where);
      }
      slot += cell.span;
    }
    const lastSlot = header[header.length - 1]?.end;
    if (lastSlot !== undefined && slot !== lastSlot) {
      throw new ScrapeError(
        `${where}: 셀 슬롯 합계(${slot})가 헤더 슬롯(${lastSlot})과 다릅니다 — 표 구조 변조 의심`,
      );
    }
    const seq = values['seq'];
    if (seq !== rowIndex + 1) {
      throw new ScrapeError(`${where}: 순번이 연속이 아닙니다 — 기대 ${rowIndex + 1}, 실제 ${String(seq)}`);
    }
    trips.push(values);
  });

  return {
    routeId: meta.id,
    routeTitle,
    path,
    status: 'active',
    suspendedReason: null,
    dayType,
    columns,
    keys,
    trips,
    notices: baseNotices,
    busRefs: prose.busRefs,
    contacts,
    period,
    sourceUpdatedAt,
  };
}
