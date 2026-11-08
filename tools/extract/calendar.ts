/**
 * 학사력(학사일정) 규칙 파서 — `docs/10-academic-calendar.md` §6 · T42.
 *
 * 입력: `scripts/calendar_hwp_to_txt.sh` 가 만든 **텍스트 정본**(`data/raw/calendar/<N>학년도-학사력.txt`).
 *   2026학년도 학사력
 *   3월 / MARCH
 *   ◉ 1(일) 삼일절
 *   ◉ 3(화)~ 9(월) 수강신청 최종정정, …
 *   2027년 1월 / JANUARY
 *   ◉ 1(금) 신정
 *
 * 출력: `academicEvents[]` — 날짜(ISO)·분류(kind)·원문 인용. 순수 함수(파일 IO 없음).
 *
 * 원칙(docs/08 §3 와 같다):
 *  - 날짜·요일은 **원문 토큰만** 쓴다. 연도는 제목/월 머리글에서 오고, **요일이 실제 달력과 다르면 즉시 실패**한다.
 *  - 형식이 낯선 `◉` 줄은 조용히 건너뛰지 않고 실패한다(조용한 손상 금지).
 *  - 분류는 문자열 패턴 표(`CALENDAR_RULES`) 하나 — 위에서부터 먼저 맞는 것. 아무것도 안 맞으면 `ignored`.
 *  - AI 는 분류만 교차검증한다(`aiCalendar.ts` → `crossCheckCalendar`). 날짜는 AI 가 만들지 않는다.
 */

import { ExtractError } from './types.js';

/** 학사일정 분류 — 셔틀 화면에서 쓰는 것만 이름을 갖고, 나머지는 `ignored`(저장은 하되 화면 미노출). */
export type AcademicEventKind =
  | 'holiday'
  | 'observance'
  | 'vacation-start'
  | 'semester-start'
  | 'semester-end'
  | 'exam'
  | 'ignored';

export const ACADEMIC_EVENT_KINDS: readonly AcademicEventKind[] = [
  'holiday',
  'observance',
  'vacation-start',
  'semester-start',
  'semester-end',
  'exam',
  'ignored',
];

export function isAcademicEventKind(value: unknown): value is AcademicEventKind {
  return typeof value === 'string' && (ACADEMIC_EVENT_KINDS as readonly string[]).includes(value);
}

/** 분류별 뜻 — AI 프롬프트와 문서가 같은 설명을 쓴다. */
export const KIND_DESCRIPTIONS: Readonly<Record<AcademicEventKind, string>> = {
  holiday: '법정 공휴일·대체공휴일·명절 연휴·선거일·근로자의날·개교기념일',
  observance: '학교(재단) 기념일 — 참부모의 날·참자녀의 날처럼 공휴일은 아니지만 학교가 기념하는 날',
  'vacation-start': '방학(하계·동계, 계절학기 포함)이 시작되는 날',
  'semester-start': '학기 개강일(입학일·학기개시일과 같은 날). `학기개시 30/60/90일` 같은 경과일 표기는 아니다',
  'semester-end': '종강일',
  exam: '중간고사·기말고사 기간(실기고사·면접고사 같은 입시 일정은 아니다)',
  ignored: '그 밖의 일정(수강신청·등록·성적·입시·졸업·축제·수업일수 등) — 셔틀 화면과 무관',
};

export interface CalendarRule {
  readonly kind: AcademicEventKind;
  readonly pattern: RegExp;
}

/** 분류 규칙 — **위에서부터 먼저 맞는 것 하나**(serviceDay.ts `NOTICE_RULES` 와 같은 방식). */
export const CALENDAR_RULES: readonly CalendarRule[] = [
  { kind: 'semester-start', pattern: /개강일/ },
  { kind: 'semester-end', pattern: /종강/ },
  { kind: 'vacation-start', pattern: /방학.*시작/ },
  { kind: 'exam', pattern: /(중간|기말)고사/ },
  {
    kind: 'holiday',
    pattern:
      /(신정|설날|삼일절|어린이날|부처님\s*오신\s*날|현충일|광복절|추석|개천절|한글날|성탄절|대체\s*공휴일|개교기념일|근로자의\s*날|선거)/,
  },
  { kind: 'observance', pattern: /(참부모의\s*날|참자녀의\s*날)/ },
];

export function classifyCalendarLabel(label: string): AcademicEventKind {
  for (const rule of CALENDAR_RULES) {
    if (rule.pattern.test(label)) return rule.kind;
  }
  return 'ignored';
}

export interface AcademicEvent {
  /** 원문 일정명 그대로 */
  readonly label: string;
  readonly kind: AcademicEventKind;
  /** YYYY-MM-DD */
  readonly start: string;
  /** 기간이면 마지막 날(YYYY-MM-DD), 하루짜리면 null */
  readonly end: string | null;
  /** 원문 요일 — 연도 추론 검증에 쓴 값(시작[, 끝]) */
  readonly weekdays: readonly string[];
  /** 연도를 월 머리글이 아니라 학년도 제목에서 추론했으면 true */
  readonly yearInferred: boolean;
  /** 원문 한 줄 그대로(`◉ 15(화) 동계방학/계절학기 시작`) */
  readonly sourceQuote: string;
  readonly sourcePage: string;
  /** 분류 출처 — 규칙(`rule`) 또는 AI 가 규칙의 `ignored` 를 채운 경우(`ai`) */
  readonly extractedBy: 'rule' | 'ai';
  /** AI 가 분류를 채웠거나 규칙과 AI 가 다르게 본 항목 */
  readonly needsReview: boolean;
}

export interface CalendarParseResult {
  readonly academicYear: number;
  readonly events: readonly AcademicEvent[];
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const TITLE_RE = /^(\d{4})학년도 학사력$/;
const MONTH_RE = /^(?:(\d{4})년 )?(\d{1,2})월 \/ [A-Z]+$/;
const EVENT_RE = /^◉ (\d{1,2})\(([일월화수목금토])\)(?:\s*~\s*(\d{1,2})\(([일월화수목금토])\))?\s+(\S.*)$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(year: number, month: number, day: number, where: string): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ExtractError(`${where}: 존재하지 않는 날짜 ${String(year)}-${pad2(month)}-${pad2(day)}`);
  }
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/**
 * 학사력 텍스트 → `academicEvents[]`.
 * 실패(형식 위반·요일 불일치·존재하지 않는 날짜)는 `ExtractError` 로 던진다 — 발행 중단 사유다.
 */
export function parseAcademicCalendar(text: string, sourcePage: string): CalendarParseResult {
  let academicYear: number | null = null;
  let month: { year: number; month: number; explicitYear: boolean } | null = null;
  const events: AcademicEvent[] = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const where = `${sourcePage}:${String(index + 1)}`;
    if (line === '' || line.startsWith('#')) return;

    const title = TITLE_RE.exec(line);
    if (title !== null) {
      academicYear = Number(title[1]);
      return;
    }

    const header = MONTH_RE.exec(line);
    if (header !== null) {
      if (academicYear === null) throw new ExtractError(`${where}: 학년도 제목(\`N학년도 학사력\`)보다 월 머리글이 먼저 나왔다`);
      const monthNo = Number(header[2]);
      if (monthNo < 1 || monthNo > 12) throw new ExtractError(`${where}: 월 값이 이상하다 — "${line}"`);
      const explicit = header[1];
      // 학년도는 3월에 시작한다 — 연도가 안 적힌 1·2월은 다음 해다.
      const year = explicit !== undefined ? Number(explicit) : monthNo >= 3 ? academicYear : academicYear + 1;
      month = { year, month: monthNo, explicitYear: explicit !== undefined };
      return;
    }

    if (!line.startsWith('◉')) {
      throw new ExtractError(`${where}: 학사력 형식이 아닌 줄 — "${line}" (원본 형식이 바뀌었는지 확인)`);
    }
    const current = month as { year: number; month: number; explicitYear: boolean } | null;
    if (current === null) throw new ExtractError(`${where}: 월 머리글 없이 일정이 나왔다 — "${line}"`);

    const match = EVENT_RE.exec(line);
    if (match === null) throw new ExtractError(`${where}: 일정 줄의 날짜 형식을 읽지 못했다 — "${line}"`);
    const [, startDay, startWd, endDay, endWd, label] = match;

    const start = isoDate(current.year, current.month, Number(startDay), where);
    let end: string | null = null;
    if (endDay !== undefined) {
      // 끝 날이 시작 날보다 작으면 다음 달로 넘어간 기간이다(예: 28(월)~3(수)).
      const crosses = Number(endDay) < Number(startDay);
      const endMonth = crosses ? (current.month % 12) + 1 : current.month;
      const endYear = crosses && current.month === 12 ? current.year + 1 : current.year;
      end = isoDate(endYear, endMonth, Number(endDay), where);
    }

    const weekdays = end === null ? [startWd ?? ''] : [startWd ?? '', endWd ?? ''];
    const actual = end === null ? [weekdayOf(start)] : [weekdayOf(start), weekdayOf(end)];
    weekdays.forEach((written, i) => {
      if (written !== actual[i]) {
        throw new ExtractError(
          `${where}: 요일 불일치 — 원문 "${written}" · 실제 ${i === 0 ? start : (end ?? '')} 는 "${actual[i] ?? ''}" (연도 추론 오류 또는 원본 오기)`,
        );
      }
    });

    const cleanLabel = (label ?? '').trim();
    events.push({
      label: cleanLabel,
      kind: classifyCalendarLabel(cleanLabel),
      start,
      end,
      weekdays,
      yearInferred: !current.explicitYear,
      sourceQuote: line,
      sourcePage,
      extractedBy: 'rule',
      needsReview: false,
    });
  });

  if (academicYear === null) throw new ExtractError(`${sourcePage}: 학년도 제목(\`N학년도 학사력\`)을 찾지 못했다`);
  if (events.length === 0) throw new ExtractError(`${sourcePage}: 일정이 0건이다 — 변환이 잘못됐는지 확인`);
  return { academicYear, events };
}

// ─────────────────────────── AI 교차검증 ───────────────────────────

export interface CalendarConflict {
  readonly index: number;
  readonly label: string;
  readonly rule: AcademicEventKind;
  readonly ai: AcademicEventKind;
}

export interface CalendarCrossCheck {
  readonly events: readonly AcademicEvent[];
  /** 규칙·AI 분류 일치 */
  readonly agreed: number;
  /** 규칙이 `ignored` 로 둔 것을 AI 분류로 채택(needsReview) */
  readonly adopted: readonly CalendarConflict[];
  /** 규칙이 분류했는데 AI 가 다르게 본 것 — 규칙을 유지하고 needsReview */
  readonly conflicts: readonly CalendarConflict[];
  /** AI 응답에 없던 항목 수(규칙 유지) */
  readonly missing: number;
}

/**
 * 규칙 분류(정본)와 AI 분류를 항목별로 비교한다(docs/08 §2 Stage A 와 같은 정책).
 *  - 같음 → 그대로.
 *  - 규칙 `ignored` · AI 가 다른 분류 → **AI 분류 채택**(`extractedBy:"ai"`, `needsReview:true`) — 규칙 표가 놓친 일정을 메운다.
 *  - 규칙이 분류함 · AI 가 다르게 봄 → **규칙 유지**, `needsReview:true` 로 표시하고 보고한다(AI 가 정본을 덮지 않는다).
 */
export function crossCheckCalendar(
  events: readonly AcademicEvent[],
  aiKinds: ReadonlyMap<number, AcademicEventKind> | null,
): CalendarCrossCheck {
  if (aiKinds === null) return { events: [...events], agreed: 0, adopted: [], conflicts: [], missing: 0 };
  let agreed = 0;
  let missing = 0;
  const adopted: CalendarConflict[] = [];
  const conflicts: CalendarConflict[] = [];
  const next = events.map((event, index) => {
    const ai = aiKinds.get(index);
    if (ai === undefined) {
      missing += 1;
      return event;
    }
    if (ai === event.kind) {
      agreed += 1;
      return event;
    }
    const entry: CalendarConflict = { index, label: event.label, rule: event.kind, ai };
    if (event.kind === 'ignored') {
      adopted.push(entry);
      return { ...event, kind: ai, extractedBy: 'ai' as const, needsReview: true };
    }
    conflicts.push(entry);
    return { ...event, needsReview: true };
  });
  return { events: next, agreed, adopted, conflicts, missing };
}

// ─────────────────────────── 드리프트 ───────────────────────────

/** 화면에 쓰는 분류 — 직전 발행본보다 줄어들면 발행 보류(docs/10 §8-5). */
export const DRIFT_KINDS: readonly AcademicEventKind[] = ['holiday', 'observance', 'vacation-start', 'semester-start', 'exam'];

export function countByKind(events: readonly { readonly kind: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
}

/** 직전 발행본의 `academicEvents` 와 비교한 감소 신호. 직전본에 없으면 비교하지 않는다(첫 반입). */
export function calendarDriftReasons(
  baseline: readonly { readonly kind: string }[] | null,
  next: readonly AcademicEvent[],
): string[] {
  if (baseline === null || baseline.length === 0) return [];
  const before = countByKind(baseline);
  const after = countByKind(next);
  const reasons: string[] = [];
  for (const kind of DRIFT_KINDS) {
    const b = before[kind] ?? 0;
    const a = after[kind] ?? 0;
    if (a < b) reasons.push(`학사일정 ${kind} ${String(b)} → ${String(a)}건(감소)`);
  }
  return reasons;
}

/** 발행 JSON 의 `academicEvents` 를 읽는다(없거나 형식이 다르면 null). */
export function baselineAcademicEvents(raw: unknown): { readonly kind: string }[] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const list = (raw as Record<string, unknown>)['academicEvents'];
  if (!Array.isArray(list)) return null;
  return list.filter(
    (item): item is { kind: string } =>
      typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>)['kind'] === 'string',
  );
}
