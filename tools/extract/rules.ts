/**
 * 규칙 기반 구조화 — **결정적**이며 AI 없이도 동작한다(`--no-ai` 폴백 = 이 경로).
 *
 * 담당(갭 6종):
 *   ① 시점 조건부 운행 변경  → `dateRules[kind=route-change]`
 *   ② 방향별 소요시간        → `routes[].tripNotes[]`
 *   ③ 시간창 조건부 정차      → `dateRules[kind=stop-time-window]` + `routes[].stopWindows[]`
 *   ④ 방학/학기 시간표 구분   → `terms[]`(semester / vacation + 해당 시간표 소스)
 *   ⑤ 기간의 의미 연결        → `dateRules[kind=period-meaning]`
 *   ⑥ 중복 공지 제거 + 연도 추론 → `notices` 중복 제거 + `dateRules[kind=no-service|alternate-schedule]`
 *
 * **수치는 전부 여기서만 만든다**(행 수·시각·분·날짜). AI 는 분류만 한다(`FR-A2`).
 * 문장을 찾지 못하면 **추측하지 않고 비워 둔다** — 그 후보는 AI/사람 몫으로 남는다.
 */

import { DAY_TYPES } from '../scraper/types.js';
import type { Timetable } from '../scraper/types.js';
import { ROUTES } from '../scraper/routeMeta.js';
import { deriveDates, deriveDayTypes } from './dateparse.js';
import { findExactQuote } from './text.js';
import type {
  Candidate,
  DateRule,
  RuleStructures,
  SemesterPeriod,
  SnapshotSource,
  StopWindow,
  Term,
  TimeWindow,
  TripDirection,
  TripNote,
} from './types.js';

export interface RuleInput {
  readonly sources: readonly SnapshotSource[];
  readonly base: Timetable;
  readonly candidates: readonly Candidate[];
}

const ORIGIN = 'https://lily.sunmoon.ac.kr';
/** 학기 시간표 소스 — 평일 아산KTX 페이지(계약 routeMeta 의 URL 을 그대로 쓴다) */
const SEMESTER_SOURCE_FALLBACK = `${ORIGIN}/Page2/About/About08_04_02_01_01_01.aspx`;

const MIN_REVIEW_CONFIDENCE = 0.6;

interface CandidateIndex {
  readonly byPage: ReadonlyMap<string, readonly Candidate[]>;
}

function indexCandidates(sources: readonly SnapshotSource[], candidates: readonly Candidate[]): CandidateIndex {
  const byPage = new Map<string, Candidate[]>();
  for (const source of sources) byPage.set(source.file, []);
  for (const candidate of candidates) {
    for (const page of candidate.pages) {
      const list = byPage.get(page);
      if (list === undefined) continue;
      list.push(candidate);
    }
  }
  return { byPage };
}

function pageOfQuote(quote: string, sources: readonly SnapshotSource[]): string {
  return findExactQuote(quote, sources)?.file ?? sources[0]?.file ?? '';
}

// ─────────────────────── 갭 ① 시점 조건부 운행 변경 ───────────────────────

const VIA_PATTERN = /([가-힣A-Za-z()]+)\s*경유/;

interface RouteChangeGroup {
  readonly quote: string;
  readonly dayTypes: Set<string>;
  readonly scope: Set<string>;
  readonly pages: Set<string>;
  readonly start: string | null;
  readonly derivation: string;
  readonly via: string | null;
}

function routeChangeRules(input: RuleInput, index: CandidateIndex, consumed: Set<string>): DateRule[] {
  const groups = new Map<string, RouteChangeGroup>();
  for (const source of input.sources) {
    for (const candidate of index.byPage.get(source.file) ?? []) {
      if (!candidate.text.includes('경유')) continue;
      if (!candidate.text.includes('부터') && !candidate.text.includes('학기부터')) continue;
      const derived = deriveDates(candidate.text, input.base.semester);
      const existing = groups.get(candidate.text);
      const via = VIA_PATTERN.exec(candidate.text)?.[1] ?? null;
      if (existing === undefined) {
        groups.set(candidate.text, {
          quote: candidate.text,
          dayTypes: new Set<string>([source.dayType]),
          scope: new Set<string>([source.routeId]),
          pages: new Set<string>([source.file]),
          start: derived.start,
          derivation: derived.derivation,
          via,
        });
        consumed.add(candidate.id);
        continue;
      }
      existing.dayTypes.add(source.dayType);
      existing.scope.add(source.routeId);
      existing.pages.add(source.file);
      consumed.add(candidate.id);
    }
  }

  return [...groups.values()].map((group) => ({
    kind: 'route-change',
    start: group.start,
    end: null,
    yearInferred: false,
    dayTypes: orderDays([...group.dayTypes]),
    scope: ROUTES.map((route) => route.id).filter((id) => group.scope.has(id)),
    effect: {
      via: group.via,
      statement: group.quote,
      appliesFrom: group.derivation === 'semester' ? 'semester-start' : null,
    },
    note:
      group.derivation === 'semester'
        ? '원문 "…학기부터" 문구를 해당 학기 시작일로 환산'
        : '원문 문구에서 직접 파싱',
    sourceQuote: group.quote,
    sourcePage: pageOfQuote(group.quote, input.sources),
    extractedBy: 'rule',
    confidence: 1,
    needsReview: group.start === null,
  }));
}

// ─────────────────────── 갭 ② 방향별 소요시간 ───────────────────────

const MINUTES_PATTERN = /(\d{1,2})\s*분\s*소요/g;
const SEGMENT_CHAIN = /([가-힣A-Za-z()]+(?:\s*>\s*[가-힣A-Za-z()\s]+)+)$/;
const TRAILING_NOISE = /(?:\s*(?:운행|소요|까지|입니다|예상))+$/;

function cleanSegment(raw: string): string | null {
  let text = raw.replace(/\s+/gu, ' ').trim();
  text = text.replace(TRAILING_NOISE, '').trim();
  text = text.replace(/\s*>\s*/gu, '>').replace(/>+/gu, '>').replace(/>$|^>/gu, '');
  if (!text.includes('>')) return null;
  if (text.length < 3) return null;
  return text;
}

function directionOf(segment: string | null, window: string): TripDirection {
  const inIndex = Math.max(window.lastIndexOf('등교'), window.lastIndexOf('등교시'));
  const outIndex = Math.max(window.lastIndexOf('하교'), window.lastIndexOf('하교시'));
  if (inIndex >= 0 && inIndex > outIndex) return 'inbound';
  if (outIndex >= 0 && outIndex > inIndex) return 'outbound';
  if (segment === null) return 'both';
  const parts = segment.split('>');
  const from = parts[0] ?? '';
  const to = parts[parts.length - 1] ?? '';
  const fromCampus = from.includes('캠퍼스') || from.includes('선문대');
  const toCampus = to.includes('캠퍼스') || to.includes('선문대');
  if (fromCampus && !toCampus) return 'outbound';
  if (toCampus && !fromCampus) return 'inbound';
  return 'both';
}

const CONDITION_KEYWORDS: readonly { readonly keyword: string; readonly label: string }[] = [
  { keyword: '교통정체', label: '교통정체' },
  { keyword: '운영시간', label: '운영시간' },
  { keyword: '이외 시간', label: '이외 시간' },
  { keyword: '이외시간', label: '이외 시간' },
];

/**
 * 조건은 **가장 가까운 앞쪽 조건 키워드 하나**만 취한다.
 * 한 문장이 여러 구간을 나열할 때(`교통정체로 인하여 A 35분, B 30분`) 조건이 뒤 구간에도 적용되게 하되,
 * 다른 절(`, 이외 시간 30분`)로는 새지 않게 하는 규칙이다. 80자를 넘으면 다른 문맥으로 본다.
 */
function nearestCondition(text: string, at: number): string[] {
  let best: { label: string; index: number } | null = null;
  for (const { keyword, label } of CONDITION_KEYWORDS) {
    const index = text.lastIndexOf(keyword, at);
    if (index < 0) continue;
    if (best === null || index > best.index) best = { label, index };
  }
  if (best === null) return [];
  if (at - best.index > 80) return [];
  return [best.label];
}

/** 한 후보 문장에서 `N분 소요` 마다 방향·구간·조건을 뽑는다(문장에 있는 값만). */
export function parseDurationNotes(text: string, source: SnapshotSource): TripNote[] {
  const notes: TripNote[] = [];
  const seen = new Set<string>();
  const separators = [',', '/', ':'];
  for (const match of text.matchAll(MINUTES_PATTERN)) {
    const minutes = Number(match[1]);
    const at = match.index;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 300 || at === undefined) continue;
    // 조건·방향은 **같은 절(clause)** 안에서만 읽는다 — 앞 절의 `교통정체` 가 뒤 절로 새지 않게.
    const clauseStart = Math.max(...separators.map((sep) => text.lastIndexOf(sep, at)), -1) + 1;
    const nextEnds = separators.map((sep) => text.indexOf(sep, at)).filter((index) => index >= 0);
    const clauseEnd = nextEnds.length === 0 ? text.length : Math.min(...nextEnds);
    const clause = text.slice(clauseStart, clauseEnd);
    // 구간 표기는 `N분` **앞부분**에서만 찾는다(`$` 앵커가 `20분 소요` 에 걸리지 않도록).
    const beforeMinutes = text.slice(clauseStart, at);
    const segment = cleanSegment(SEGMENT_CHAIN.exec(beforeMinutes)?.[1] ?? '');
    const direction = directionOf(segment, clause);
    const conditions = nearestCondition(text, at);
    const key = `${direction}|${minutes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({
      direction,
      minutes,
      segment,
      conditions,
      note: conditions.length > 0 ? conditions.join(' / ') : null,
      sourceQuote: text,
      sourcePage: source.file,
      extractedBy: 'rule',
      confidence: 1,
      needsReview: false,
    });
  }
  return notes;
}

function durationNotes(input: RuleInput, index: CandidateIndex, consumed: Set<string>): { routeId: string; notes: TripNote[] }[] {
  const byRoute = new Map<string, TripNote[]>();
  for (const source of input.sources) {
    for (const candidate of index.byPage.get(source.file) ?? []) {
      if (!candidate.text.includes('분 소요')) continue;
      const notes = parseDurationNotes(candidate.text, source);
      if (notes.length === 0) continue;
      consumed.add(candidate.id);
      const list = byRoute.get(source.routeId) ?? [];
      for (const note of notes) {
        // 같은 노선·같은 방향·같은 분은 한 건만 남긴다(평일/주말이 같은 값을 반복 진술).
        const duplicate = list.some(
          (existing) => existing.direction === note.direction && existing.minutes === note.minutes,
        );
        if (!duplicate) list.push(note);
      }
      byRoute.set(source.routeId, list);
    }
  }
  return ROUTES.map((route) => ({ routeId: route.id, notes: byRoute.get(route.id) ?? [] })).filter(
    (entry) => entry.notes.length > 0,
  );
}

// ─────────────────────── 갭 ③ 시간창 조건부 정차 ───────────────────────

const STOP_WINDOW_PATTERN = /([가-힣]+)\s*승강장\s*정차시간/;
const WINDOW_PATTERN = /(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/g;
const OPEN_END_PATTERN = /(\d{2}:\d{2})\s*~\s*([가-힣]+)/;

export function parseStopWindows(text: string): TimeWindow[] {
  const windows: TimeWindow[] = [];
  for (const match of text.matchAll(WINDOW_PATTERN)) {
    const start = match[1];
    const end = match[2];
    if (start === undefined || end === undefined) continue;
    windows.push({ start, end, raw: `${start}~${end}` });
  }
  const open = OPEN_END_PATTERN.exec(text);
  if (open?.[1] !== undefined && open[2] !== undefined && !windows.some((w) => w.start === open[1])) {
    windows.push({ start: open[1], end: null, raw: `${open[1]}~${open[2]}` });
  }
  return windows;
}

function stopWindowRules(
  input: RuleInput,
  index: CandidateIndex,
  consumed: Set<string>,
): { windows: { routeId: string; windows: StopWindow[] }[]; rules: DateRule[] } {
  interface Group {
    readonly quote: string;
    readonly location: string;
    readonly term: string | null;
    /** 문장이 요일을 명시했으면 그 값(예: "평일" → weekday), 아니면 페이지 요일을 모은다 */
    readonly explicitDays: readonly string[] | null;
    readonly dayTypes: Set<string>;
    readonly windows: TimeWindow[];
  }
  const groups = new Map<string, Group>();
  for (const source of input.sources) {
    for (const candidate of index.byPage.get(source.file) ?? []) {
      const location = STOP_WINDOW_PATTERN.exec(candidate.text)?.[1];
      if (location === undefined) continue;
      const windows = parseStopWindows(candidate.text);
      if (windows.length === 0) continue;
      consumed.add(candidate.id);
      const explicitDays = candidate.text.includes('평일') ? (['weekday'] as const) : null;
      const existing = groups.get(candidate.text);
      if (existing !== undefined) {
        if (existing.explicitDays === null) existing.dayTypes.add(source.dayType);
        continue;
      }
      groups.set(candidate.text, {
        quote: candidate.text,
        location: `${location} 승강장`,
        term: candidate.text.includes('학기 중') ? '학기 중' : null,
        explicitDays,
        dayTypes: new Set<string>(explicitDays ?? [source.dayType]),
        windows,
      });
    }
  }

  const rules: DateRule[] = [];
  const windows: { routeId: string; windows: StopWindow[] }[] = [];
  for (const group of groups.values()) {
    const stopWindow: StopWindow = {
      location: group.location,
      dayTypes: orderDays([...group.dayTypes]),
      term: group.term,
      windows: group.windows,
      note: null,
      sourceQuote: group.quote,
      sourcePage: pageOfQuote(group.quote, input.sources),
      extractedBy: 'rule',
      confidence: 1,
      needsReview: false,
    };
    rules.push({
      kind: 'stop-time-window',
      start: null,
      end: null,
      yearInferred: false,
      dayTypes: stopWindow.dayTypes,
      scope: [],
      effect: {
        location: group.location,
        term: group.term,
        windows: group.windows.map((w) => ({ start: w.start, end: w.end })),
        limit: group.windows.some((w) => w.end === null) ? '막차까지' : null,
      },
      note: '시간창(정차 가능 시간) 조건 — 날짜 범위 규칙이 아니라 매일 반복 조건이다',
      sourceQuote: group.quote,
      sourcePage: stopWindow.sourcePage,
      extractedBy: 'rule',
      confidence: 1,
      needsReview: false,
    });
    // 정차 조건은 특정 노선 한정이 아니라 **운행 중인 전 노선 공통**(캠퍼스 내 승강장 안내문)이다.
    for (const route of ROUTES) {
      if (route.status !== 'active') continue;
      windows.push({ routeId: route.id, windows: [stopWindow] });
    }
  }
  return { windows, rules };
}

// ─────────────────────── 갭 ⑥ 안내문(중복 제거 + 연도 추론) ───────────────────────

interface DatedNotice {
  readonly kind: 'no-service' | 'alternate-schedule' | 'notice';
  readonly text: string;
  readonly raw: string;
  readonly date?: string;
  readonly endDate?: string;
}

export interface NoticeDedupeResult {
  readonly notices: readonly DatedNotice[];
  readonly removed: readonly { readonly removed: DatedNotice; readonly keptRaw: string }[];
  readonly dateRules: readonly DateRule[];
}

/** 같은 (kind, 날짜, 끝날짜) 안내문은 **한 건으로 통합**한다(갭 ⑥). 첫 등장을 남긴다(결정적). */
export function dedupeNotices(notices: readonly DatedNotice[], sources: readonly SnapshotSource[]): NoticeDedupeResult {
  const keys = new Map<string, DatedNotice>();
  const merged = new Map<string, string[]>();
  const removed: { removed: DatedNotice; keptRaw: string }[] = [];
  const ordered: DatedNotice[] = [];

  for (const notice of notices) {
    const key = notice.date === undefined ? `raw|${notice.raw}` : `${notice.kind}|${notice.date}|${notice.endDate ?? ''}`;
    const kept = keys.get(key);
    if (kept === undefined) {
      keys.set(key, notice);
      ordered.push(notice);
      continue;
    }
    removed.push({ removed: notice, keptRaw: kept.raw });
    const quotes = merged.get(key) ?? [];
    if (notice.raw !== kept.raw) quotes.push(notice.raw);
    merged.set(key, quotes);
  }

  const dateRules: DateRule[] = [];
  for (const notice of ordered) {
    if (notice.date === undefined) continue;
    const mergedQuotes = merged.get(`${notice.kind}|${notice.date}|${notice.endDate ?? ''}`) ?? [];
    const isAlternate = notice.kind === 'alternate-schedule';
    dateRules.push({
      kind: isAlternate ? 'alternate-schedule' : 'no-service',
      start: notice.date,
      end: notice.endDate ?? null,
      yearInferred: !/\d{4}/.test(notice.raw),
      dayTypes: deriveDayTypes(notice.raw, DAY_TYPES),
      scope: [],
      effect: isAlternate
        ? { timetable: notice.text.includes('일요일') ? 'sunday' : null, appliesTo: 'all-routes' }
        : { appliesTo: 'all-routes' },
      note: mergedQuotes.length > 0 ? `중복 공지 ${mergedQuotes.length}건 통합(같은 기간)` : null,
      sourceQuote: notice.raw,
      sourcePage: pageOfQuote(notice.raw, sources),
      extractedBy: 'rule',
      confidence: 1,
      needsReview: false,
      ...(mergedQuotes.length > 0 ? { mergedQuotes } : {}),
    });
  }
  return { notices: ordered, removed, dateRules };
}

// ─────────────────────── 갭 ④ 학기/방학 ───────────────────────

const VACATION_MENU = '방학 시간표';
const VACATION_HREF = /<a[^>]+href="([^"]+)"[^>]*>\s*방학\s*시간표\s*<\/a>/i;

export function termStructures(
  input: RuleInput,
  index: CandidateIndex,
  consumed: Set<string>,
): Term[] {
  const terms: Term[] = [];
  const semester = input.base.semester;
  const semesterPage = pageOfQuote(semester.title, input.sources);
  terms.push({
    kind: 'semester',
    label: semester.label,
    start: semester.startsOn,
    end: semester.endsOn,
    timetableSource: semesterSourceUrl(),
    note: '원문 제목의 기간 = 학기 시간표 적용 구간',
    sourceQuote: semester.title,
    sourcePage: semesterPage,
    extractedBy: 'rule',
    confidence: 1,
    needsReview: false,
  });

  // 방학 시간표: 원본 메뉴에만 존재(별도 페이지) → 링크·문구를 인용으로 남긴다.
  const vacationPage = input.sources.find((source) => source.text.includes(VACATION_MENU) || VACATION_HREF.test(source.html));
  const href = vacationPage === undefined ? null : (VACATION_HREF.exec(vacationPage.html)?.[1] ?? null);
  if (vacationPage !== undefined) {
    for (const candidate of index.byPage.get(vacationPage.file) ?? []) {
      if (candidate.text.includes('방학')) consumed.add(candidate.id);
    }
    terms.push({
      kind: 'vacation',
      label: '방학',
      start: null,
      end: null,
      timetableSource: href === null ? null : `${ORIGIN}${href}`,
      note: '원본 메뉴의 별도 페이지 — 이 스냅샷에는 방학 표 본문·기간 문구가 없다(기간 미기재)',
      sourceQuote: VACATION_MENU,
      sourcePage: vacationPage.file,
      extractedBy: 'rule',
      confidence: 0.5,
      needsReview: true,
    });
  }
  return terms;
}

function semesterSourceUrl(): string {
  const meta = ROUTES.find((route) => route.id === 'asan-ktx');
  const weekday = meta?.days.find((day) => day.dayType === 'weekday');
  return weekday?.url ?? SEMESTER_SOURCE_FALLBACK;
}

// ─────────────────────── 갭 ⑤ 기간의 의미 연결 ───────────────────────

function periodMeaningRules(input: RuleInput): DateRule[] {
  const period: SemesterPeriod | null = input.base.holidayPeriod;
  if (period === null) return [];
  return [
    {
      kind: 'period-meaning',
      start: period.startsOn,
      end: period.endsOn,
      yearInferred: true,
      dayTypes: ['saturday', 'sunday'],
      scope: [],
      effect: {
        appliesTo: 'weekend-timetable',
        statement: period.title,
      },
      note: '원본의 "휴일 운행기간" 은 주말(토·일) 시간표 적용 구간을 뜻한다(기간 → 시간표 연결)',
      sourceQuote: period.title,
      sourcePage: pageOfQuote(period.title, input.sources),
      extractedBy: 'rule',
      confidence: 1,
      needsReview: false,
    },
  ];
}

// ─────────────────────── 조립 ───────────────────────

function orderDays(days: readonly string[]): (typeof DAY_TYPES)[number][] {
  return DAY_TYPES.filter((day) => days.includes(day));
}

export function extractRuleStructures(input: RuleInput): RuleStructures {
  const index = indexCandidates(input.sources, input.candidates);
  const consumed = new Set<string>();

  const noticeResult = dedupeNotices(input.base.notices as readonly DatedNotice[], input.sources);
  const durationEntries = durationNotes(input, index, consumed);
  const stopResult = stopWindowRules(input, index, consumed);

  const dateRules: DateRule[] = [
    ...noticeResult.dateRules,
    ...routeChangeRules(input, index, consumed),
    ...stopResult.rules,
    ...periodMeaningRules(input),
  ].sort(compareDateRules);

  const terms = termStructures(input, index, consumed).sort(compareTerms);

  // 규칙이 만든 모든 인용을 후보 목록과 대조해 "설명된 후보"로 표시한다(보고·AI 대상 산정에 쓴다).
  const explained = new Set<string>();
  for (const rule of dateRules) explained.add(rule.sourceQuote);
  for (const rule of dateRules) for (const quote of rule.mergedQuotes ?? []) explained.add(quote);
  for (const term of terms) explained.add(term.sourceQuote);
  for (const entry of durationEntries) for (const note of entry.notes) explained.add(note.sourceQuote);
  for (const entry of stopResult.windows) for (const window of entry.windows) explained.add(window.sourceQuote);
  for (const candidate of input.candidates) if (explained.has(candidate.text)) consumed.add(candidate.id);

  return {
    dateRules,
    terms,
    notices: noticeResult.notices,
    dedupedNotices: noticeResult.removed.length,
    dedupedQuotes: noticeResult.removed.map((entry) => entry.removed.raw),
    tripNotes: durationEntries.map((entry) => ({ routeId: entry.routeId, notes: entry.notes })),
    stopWindows: stopResult.windows
      .filter((entry) => entry.windows.length > 0)
      .map((entry) => ({ routeId: entry.routeId, windows: entry.windows })),
    consumedCandidateIds: [...consumed].sort(),
  };
}

export function compareDateRules(a: DateRule, b: DateRule): number {
  const startA = a.start ?? '9999-99-99';
  const startB = b.start ?? '9999-99-99';
  if (startA !== startB) return startA < startB ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.sourceQuote < b.sourceQuote ? -1 : a.sourceQuote > b.sourceQuote ? 1 : 0;
}

function compareTerms(a: Term, b: Term): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const startA = a.start ?? '9999-99-99';
  const startB = b.start ?? '9999-99-99';
  if (startA !== startB) return startA < startB ? -1 : 1;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** 규칙 산출물이 참조하는 이 상수는 검증기와 공유한다(임계 일관성). */
export const CONFIDENCE_REVIEW_THRESHOLD = MIN_REVIEW_CONFIDENCE;
