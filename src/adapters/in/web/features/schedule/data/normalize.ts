/**
 * 외부 계약(data/timetable.json) → 앱 뷰모델 + 도메인 모델 정규화.
 *
 * 이 파일이 **유일한 계약 경계**다. 화면 코드는 여기서 만든 뷰모델만 보고,
 * 요일·시각·운행 판정은 도메인 함수(`nextDepartures`·`resolveDayService`)만 쓴다(이중 구현 금지).
 *
 * 왜 정규화가 필요한가 (T5 계약 점검에서 확인 — 카드 코멘트 · .session-notes/T5-증거.md)
 * - 외부 계약의 `routes[].byDay[dayType]` 은 객체 `{columns, keys, trips}`(tools/scraper/types.ts `DayTable`)인데,
 *   도메인 `Route.byDay` 는 `Trip[]` 이다 → 그대로 넣으면 `trips is not iterable` 로 던진다.
 * - `status`·`suspendedReason`·`offDays`·원문 헤더 `columns` 는 외부 계약에만 있다(F2b·F2 표시용) → 뷰모델에 보존.
 * - 시각 열 키가 노선별로 다르다: 아산KTX·천안역은 `depStation`, **천안터미널은 `depTerminal`**
 *   (tools/scraper/routeMeta.ts 의 `kind:'time'` 열). 두 키 모두 "출발(역/터미널)" 열이므로
 *   도메인 `Trip.depStation` 으로 정규화한다(`tripDepartureTime` = `depCampus ?? depStation` 계약).
 *
 * 파싱 실패는 **조용히 넘기지 않는다**: 원인 경로를 담은 `TimetableDataError` 를 던지고
 * 화면은 에러 배너를 띄운다(빈 화면·크래시 금지 — F8).
 */
import { DAY_TYPES, isDayType, weekdayCodesOf, type DayType } from '../../../../../../domain/entities/DayType';
import type { Notice } from '../../../../../../domain/entities/Notice';
import type { Route } from '../../../../../../domain/entities/Route';
import type { Schedule } from '../../../../../../domain/entities/Schedule';
import type { Trip, TripServiceCondition } from '../../../../../../domain/entities/Trip';
import type {
  BusRef,
  Contacts,
  Notice as RawNotice,
  SemesterPeriod,
  SourcePage,
  TripRow,
} from '../types/contract';
import type {
  DateRuleView,
  DayTableView,
  RouteView,
  SourceView,
  StopWindowTimeView,
  StopWindowView,
  TermView,
  TimetableModel,
  TripNoteView,
} from '../types/model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 계약 위반 — 원인 위치(path)를 메시지에 담는다. */
export class TimetableDataError extends Error {
  public readonly path: string;

  public constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'TimetableDataError';
    this.path = path;
  }
}

/** 도메인 `Trip` 필드 ← 외부 시각 열 키 별칭(위 주석의 1건). */
const DEPARTURE_KEY_ALIASES: Readonly<Record<keyof Pick<Trip, 'depCampus' | 'depStation'>, readonly string[]>> = {
  depCampus: ['depCampus'],
  depStation: ['depStation', 'depTerminal'],
};

/** 원시 JSON(`unknown`) → 뷰모델 + 도메인 브리지. */
export function parseTimetable(raw: unknown): TimetableModel {
  const root = requireRecord(raw, '$');
  const schemaVersion = requireNumber(root['schemaVersion'], '$.schemaVersion');
  const semester = parsePeriod(root['semester'], '$.semester');
  const holidayPeriod = root['holidayPeriod'] === null || root['holidayPeriod'] === undefined
    ? null
    : parsePeriod(root['holidayPeriod'], '$.holidayPeriod');

  const dayTypes = requireArray(root['dayTypes'], '$.dayTypes').map((value, index) => {
    if (!isDayType(value)) throw new TimetableDataError(`$.dayTypes[${index}]`, `알 수 없는 요일 구분 ${JSON.stringify(value)}`);
    return value;
  });

  const rawRoutes = requireArray(root['routes'], '$.routes');
  const routeViews: RouteView[] = [];
  const domainRoutes: Route[] = [];
  for (const [index, rawRoute] of rawRoutes.entries()) {
    const parsed = parseRoute(rawRoute, `$.routes[${index}]`);
    routeViews.push(parsed.view);
    domainRoutes.push(parsed.domain);
  }

  const notices = parseNotices(requireArray(root['notices'], '$.notices'));
  const busRefs = parseBusRefs(requireArray(root['busRefs'], '$.busRefs'));
  const contacts = parseContacts(root['contacts']);
  const source = parseSource(requireRecord(root['source'], '$.source'));
  // v2 — 없으면 빈 배열(v1 파일도 그대로 동작 = 무중단 하위호환).
  const dateRules = parseDateRules(root['dateRules']);
  const terms = parseTerms(root['terms']);

  const schedule: Schedule = {
    schemaVersion,
    source: {
      url: source.url,
      sourceUpdatedAt: source.sourceUpdatedAt,
      fetchedAt: source.fetchedAt,
      contentHash: source.contentHash,
    },
    semester: { label: semester.label, startsOn: semester.startsOn, endsOn: semester.endsOn },
    dayTypes,
    routes: domainRoutes,
    notices: toDomainNotices(notices),
  };

  return {
    schemaVersion,
    semester,
    holidayPeriod,
    dayTypes,
    routes: routeViews,
    dateRules,
    terms,
    notices,
    busRefs,
    contacts,
    source,
    schedule,
  };
}

interface ParsedRoute {
  readonly view: RouteView;
  readonly domain: Route;
}

function parseRoute(raw: unknown, path: string): ParsedRoute {
  const record = requireRecord(raw, path);
  const id = requireString(record['id'], `${path}.id`);
  const name = requireString(record['name'], `${path}.name`);
  const rawPath = record['path'];
  const routePath = typeof rawPath === 'string' ? rawPath : '';
  const status = record['status'] === 'suspended' ? 'suspended' : 'active';
  const rawReason = record['suspendedReason'];
  const suspendedReason = typeof rawReason === 'string' && rawReason.trim() !== '' ? rawReason : null;

  const rawByDay = requireRecord(record['byDay'], `${path}.byDay`);
  const byDayViews: Partial<Record<DayType, DayTableView | null>> = {};
  const byDayTrips: Record<DayType, Trip[]> = { weekday: [], saturday: [], sunday: [] };
  const domainByDayColumns: Partial<Record<DayType, string[]>> = {};
  for (const dayType of DAY_TYPES) {
    const table = parseDayTable(rawByDay[dayType], `${path}.byDay.${dayType}`, dayType);
    byDayViews[dayType] = table.view;
    byDayTrips[dayType] = table.trips;
    if (table.view !== null) domainByDayColumns[dayType] = [...table.view.keys];
  }

  const offDays = requireArray(record['offDays'] ?? [], `${path}.offDays`).filter((value): value is DayType =>
    isDayType(value),
  );

  // v2 보조 데이터(없으면 빈 배열). v2 항목은 **표시 보조**라 한 항목이 깨져도 앱이 죽지 않게
  // 항목 단위로 걸러 낸다(정본 검증은 T16 파이프라인 몫 — normalize 는 v1 계약만 강제한다).
  const tripNotes = parseTripNotes(record['tripNotes']);
  const stopWindows = parseStopWindows(record['stopWindows']);

  const representative = byDayViews.weekday ?? null;
  const rawTrips = record['trips'];
  let topLevelTrips: Trip[];
  let topLevelKeys: string[] = [];
  if (Array.isArray(rawTrips)) {
    const rows = rawTrips.map((row, index) => requireRow(row, `${path}.trips[${index}]`));
    topLevelKeys = Object.keys(rows[0] ?? {});
    topLevelTrips = rows.map((row, index) => toDomainTrip(row, index));
  } else {
    topLevelTrips = [...byDayTrips.weekday];
  }

  const domainColumns =
    representative !== null
      ? [...representative.keys]
      : (domainByDayColumns.weekday ?? topLevelKeys);

  return {
    view: {
      id,
      name,
      path: routePath,
      status,
      suspendedReason,
      offDays,
      tripNotes,
      stopWindows,
      byDay: {
        weekday: byDayViews.weekday ?? null,
        saturday: byDayViews.saturday ?? null,
        sunday: byDayViews.sunday ?? null,
      },
    },
    domain: {
      id,
      name,
      path: routePath,
      columns: domainColumns,
      trips: topLevelTrips,
      byDay: { weekday: byDayTrips.weekday, saturday: byDayTrips.saturday, sunday: byDayTrips.sunday },
    },
  };
}

interface ParsedDayTable {
  /** 표가 없거나 비어 있으면 null(정상 — 원본에 페이지가 없는 요일) */
  readonly view: DayTableView | null;
  readonly trips: Trip[];
}

function parseDayTable(raw: unknown, path: string, dayType: DayType): ParsedDayTable {
  if (raw === null || raw === undefined) return { view: null, trips: [] };

  // 관용: 계약이 평탄화(배열)로 바뀌어도 행은 읽는다 — 헤더는 행 키에서 유도한다.
  if (Array.isArray(raw)) {
    const rows = raw.map((row, index) => requireRow(row, `${path}[${index}]`));
    if (rows.length === 0) return { view: null, trips: [] };
    const keys = Object.keys(rows[0] ?? {});
    return {
      view: { dayType, columns: [], keys, rows },
      trips: rows.map((row, index) => toDomainTrip(row, index)),
    };
  }

  const record = requireRecord(raw, path);
  const rows = requireArray(record['trips'], `${path}.trips`).map((row, index) =>
    requireRow(row, `${path}.trips[${index}]`),
  );
  const columns = asStringArray(record['columns']);
  const declaredKeys = asStringArray(record['keys']);
  const keys = declaredKeys.length > 0 ? declaredKeys : Object.keys(rows[0] ?? {});
  if (rows.length === 0 && columns.length === 0) return { view: null, trips: [] };

  return {
    view: { dayType, columns, keys, rows },
    trips: rows.map((row, index) => toDomainTrip(row, index)),
  };
}

/** 원시 행 → 도메인 `Trip`(5필드 고정 + v3 조건 필드). 위 파일 주석의 열 별칭 규칙만 적용한다. */
function toDomainTrip(row: TripRow, index: number): Trip {
  const rawSeq = row['seq'];
  const seq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) ? rawSeq : index + 1;
  return {
    seq,
    depCampus: cellText(row, DEPARTURE_KEY_ALIASES.depCampus),
    depStation: cellText(row, DEPARTURE_KEY_ALIASES.depStation),
    arrCampus: cellText(row, ['arrCampus']),
    note: cellText(row, ['note']),
    // v3(docs/06 §3) — 신규 필드. v1·v2 행에는 키가 없으므로 null/false 가 되고 판정은 기본 동작이다.
    service: parseServiceCondition(row['service']),
    durationMinutes: numberCell(row['durationMinutes']),
    unknownNote: cellText(row, ['unknownNote']),
    needsReview: booleanCell(row['needsReview']),
  };
}

/**
 * v3 `trip.service`(구조) → 도메인 조건. 규약 밖 값은 **버리지 않고** 있는 것만 옮긴다
 * (`docs/06 §3`: 원문은 `sourceQuote` 로 보존 — 판정은 `rules/tripStatus.ts` 가 한다).
 */
function parseServiceCondition(raw: unknown): TripServiceCondition | null {
  const record = recordOrNull(raw);
  if (record === null) return null;
  const dayScopeRaw = record['dayScope'];
  return {
    excludedDays: weekdayCodesOf(record['excludedDays']),
    dayScope: Array.isArray(dayScopeRaw) ? weekdayCodesOf(dayScopeRaw) : null,
    vehicleCount: numberCell(record['vehicleCount']),
    label: nullableString(record['label']),
    sourceQuote: nullableString(record['sourceQuote']),
  };
}

/** 셀 값(숫자) → number. 숫자가 아니면 null(추측하지 않는다). */
function numberCell(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 셀 값 → boolean. `true` 만 참으로 본다(v3 내부 플래그 `needsReview`). */
function booleanCell(value: unknown): boolean {
  return value === true;
}

/** 값 후보 키 중 **처음으로 값이 있는** 셀을 문자열로. 빈 문자열은 null(원본 Χ=null 과 같은 취급은 하지 않는다). */
function cellText(row: TripRow, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') return trimmed;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** 도메인에 넘길 안내문 = 날짜(YYYY-MM-DD)가 있는 것만(`resolveDayService` 계약). 원문 문구는 그대로. */
function toDomainNotices(notices: readonly RawNotice[]): readonly Notice[] {
  const out: Notice[] = [];
  for (const notice of notices) {
    if (notice.date === undefined || !ISO_DATE.test(notice.date)) continue;
    out.push({ kind: notice.kind, date: notice.date, text: notice.text });
  }
  return out;
}

function parseNotices(raw: readonly unknown[]): readonly RawNotice[] {
  return raw.map((value, index) => {
    const path = `$.notices[${index}]`;
    const record = requireRecord(value, path);
    const kind = requireString(record['kind'], `${path}.kind`);
    const text = requireString(record['text'], `${path}.text`);
    const rawText = record['raw'];
    const date = record['date'];
    const endDate = record['endDate'];
    const notice: RawNotice = {
      kind: kind as RawNotice['kind'],
      text,
      raw: typeof rawText === 'string' ? rawText : text,
      ...(typeof date === 'string' ? { date } : {}),
      ...(typeof endDate === 'string' ? { endDate } : {}),
    };
    return notice;
  });
}

function parseBusRefs(raw: readonly unknown[]): readonly BusRef[] {
  return raw.map((value, index) => {
    const path = `$.busRefs[${index}]`;
    const record = requireRecord(value, path);
    return {
      line: requireString(record['line'], `${path}.line`),
      stop: requireString(record['stop'], `${path}.stop`),
      to: requireString(record['to'], `${path}.to`),
    };
  });
}

function parseContacts(raw: unknown): Contacts | null {
  if (raw === null || raw === undefined) return null;
  const record = requireRecord(raw, '$.contacts');
  const team = record['team'];
  const tel = record['tel'];
  if (typeof team !== 'string' || typeof tel !== 'string') return null;
  return { team, tel };
}

function parseSource(record: Record<string, unknown>): SourceView {
  const rawPages = record['pages'];
  const pages: SourcePage[] = Array.isArray(rawPages)
    ? rawPages.map((value, index) => {
        const path = `$.source.pages[${index}]`;
        const page = requireRecord(value, path);
        const dayType = page['dayType'];
        if (!isDayType(dayType)) {
          throw new TimetableDataError(`${path}.dayType`, `알 수 없는 요일 구분 ${JSON.stringify(dayType)}`);
        }
        return {
          routeId: requireString(page['routeId'], `${path}.routeId`),
          dayType,
          url: requireString(page['url'], `${path}.url`),
          sourceUpdatedAt: requireString(page['sourceUpdatedAt'], `${path}.sourceUpdatedAt`),
        };
      })
    : [];
  return {
    url: requireString(record['url'], '$.source.url'),
    sourceUpdatedAt: requireString(record['sourceUpdatedAt'], '$.source.sourceUpdatedAt'),
    fetchedAt: requireString(record['fetchedAt'], '$.source.fetchedAt'),
    contentHash: requireString(record['contentHash'], '$.source.contentHash'),
    pages,
  };
}

function parsePeriod(raw: unknown, path: string): SemesterPeriod {
  const record = requireRecord(raw, path);
  const kind = record['kind'];
  return {
    title: typeof record['title'] === 'string' ? record['title'] : '',
    label: requireString(record['label'], `${path}.label`),
    startsOn: requireString(record['startsOn'], `${path}.startsOn`),
    endsOn: requireString(record['endsOn'], `${path}.endsOn`),
    kind: kind === 'holiday' ? 'holiday' : 'semester',
  };
}

/* ───────────────── schema v2 보조 데이터 (T17 — 표시 전용) ─────────────────
 * T16 파이프라인이 발행한 v2 배열(`dateRules[]`·`terms[]`·`routes[].tripNotes[]`·`stopWindows[]`)을
 * **읽기만** 한다. 정본 검증(인용 부분문자열·kind 필수 키·날짜 형식·중복)은 T16 검증기가 이미 했으므로
 * 여기서 다시 판정하지 않는다(판정 로직 신규 작성 금지).
 *
 * 대신 이 파일의 원칙을 따라 **관용**적으로 읽는다:
 *  - 키가 없거나 배열이 아니면 `[]` — v1 파일이 정확히 이 경우다(무중단 하위호환).
 *  - 항목 하나가 깨져 있으면 그 항목만 버린다 — 표시 보조 데이터 때문에 홈 전체가 죽으면 안 된다(AC-5).
 */

/** 배열이 아닌 값(없음·null·객체)은 "항목 없음". 배열이면 객체 항목만 남긴다. */
function optionalEntries(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => recordOrNull(item) !== null);
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function needsReviewOf(record: Record<string, unknown>): boolean {
  return record['needsReview'] === true;
}

function dayTypesOf(value: unknown): DayType[] {
  return Array.isArray(value) ? value.filter((item): item is DayType => isDayType(item)) : [];
}

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * v2 규칙의 **표기 이름** — 원문 인용에서 이름 부분만 뽑는다(값은 데이터에서만 온다 · 하드코딩 금지).
 *   `*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음` → `개교기념일`
 * 대괄호 표기가 없으면 null 이고, 화면은 날짜·상태만 보여준다(추측 금지).
 */
export function dateRuleLabel(sourceQuote: string): string | null {
  const match = /^[\s*\-–—]*(.+?)\s*\[/.exec(sourceQuote);
  const label = match?.[1]?.trim() ?? '';
  return label === '' ? null : label;
}

function parseDateRules(raw: unknown): DateRuleView[] {
  const out: DateRuleView[] = [];
  for (const record of optionalEntries(raw)) {
    const kind = nullableString(record['kind']);
    if (kind === null) continue;
    const quote = record['sourceQuote'];
    out.push({
      kind,
      start: nullableString(record['start']),
      end: nullableString(record['end']),
      dayTypes: dayTypesOf(record['dayTypes']),
      scope: stringListOf(record['scope']),
      effect: recordOrNull(record['effect']) ?? {},
      label: typeof quote === 'string' ? dateRuleLabel(quote) : null,
      sourceQuote: typeof quote === 'string' ? quote : null,
      needsReview: needsReviewOf(record),
    });
  }
  return out;
}

function parseTerms(raw: unknown): TermView[] {
  const out: TermView[] = [];
  for (const record of optionalEntries(raw)) {
    const label = nullableString(record['label']);
    if (label === null) continue;
    out.push({
      kind: record['kind'] === 'vacation' ? 'vacation' : 'semester',
      label,
      start: nullableString(record['start']),
      end: nullableString(record['end']),
      timetableSource: nullableString(record['timetableSource']),
      needsReview: needsReviewOf(record),
    });
  }
  return out;
}

function parseTripNotes(raw: unknown): TripNoteView[] {
  const out: TripNoteView[] = [];
  for (const record of optionalEntries(raw)) {
    const direction = record['direction'];
    // 방향 표기가 규약 밖이면 그 항목을 쓴다 — 소요시간을 엉뚱한 방향에 붙이지 않는다.
    if (direction !== 'inbound' && direction !== 'outbound' && direction !== 'both') continue;
    out.push({
      direction,
      minutes: numberOrNull(record['minutes']),
      segment: nullableString(record['segment']),
      conditions: stringListOf(record['conditions']),
      note: nullableString(record['note']),
      needsReview: needsReviewOf(record),
    });
  }
  return out;
}

function parseStopWindows(raw: unknown): StopWindowView[] {
  const out: StopWindowView[] = [];
  for (const record of optionalEntries(raw)) {
    const location = nullableString(record['location']);
    if (location === null) continue;
    out.push({
      location,
      term: nullableString(record['term']),
      dayTypes: dayTypesOf(record['dayTypes']),
      windows: parseTimeWindows(record['windows']),
      needsReview: needsReviewOf(record),
    });
  }
  return out;
}

function parseTimeWindows(raw: unknown): StopWindowTimeView[] {
  const out: StopWindowTimeView[] = [];
  for (const record of optionalEntries(raw)) {
    const start = nullableString(record['start']);
    const rawText = nullableString(record['raw']);
    if (start === null || rawText === null) continue;
    out.push({ start, end: nullableString(record['end']), raw: rawText });
  }
  return out;
}

/* ───────────────────────── 원시 값 가드 ───────────────────────── */

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TimetableDataError(path, `객체가 아닙니다 (${describe(value)})`);
  }
  return value as Record<string, unknown>;
}

/**
 * 행 1개를 검사한다. **표 셀**(`seq`·시각·`note`·…)은 문자열·숫자·null 만 허용하지만,
 * v3 편별 조건 필드(`service`·`durationMinutes`·`unknownNote`·`needsReview`)는 셀이 아니라
 * **구조**이므로 각자 타입 규칙으로 따로 검사한다(docs/06 §3 · T21).
 * 모르는 키는 셀 규칙으로 검사한다(v1 계약 유지 — v1/v2 파일은 이 분기를 타지 않는다).
 */
function requireRow(value: unknown, path: string): TripRow {
  const record = requireRecord(value, path);
  for (const [key, cell] of Object.entries(record)) {
    switch (key) {
      case 'service':
        if (cell !== null && recordOrNull(cell) === null) {
          throw new TimetableDataError(`${path}.service`, `객체 또는 null 이어야 합니다 (${describe(cell)})`);
        }
        continue;
      case 'needsReview':
        if (typeof cell !== 'boolean') {
          throw new TimetableDataError(`${path}.needsReview`, `true/false 여야 합니다 (${describe(cell)})`);
        }
        continue;
      case 'durationMinutes':
        if (cell !== null && typeof cell !== 'number') {
          throw new TimetableDataError(`${path}.durationMinutes`, `숫자 또는 null 이어야 합니다 (${describe(cell)})`);
        }
        continue;
      case 'unknownNote':
        if (cell !== null && typeof cell !== 'string') {
          throw new TimetableDataError(`${path}.unknownNote`, `문자열 또는 null 이어야 합니다 (${describe(cell)})`);
        }
        continue;
      default:
        if (cell !== null && typeof cell !== 'string' && typeof cell !== 'number') {
          throw new TimetableDataError(`${path}.${key}`, `셀 값은 문자열·숫자·null 이어야 합니다 (${describe(cell)})`);
        }
    }
  }
  return record as TripRow;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TimetableDataError(path, `배열이 아닙니다 (${describe(value)})`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TimetableDataError(path, `비어 있지 않은 문자열이어야 합니다 (${describe(value)})`);
  }
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TimetableDataError(path, `숫자가 아닙니다 (${describe(value)})`);
  }
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
