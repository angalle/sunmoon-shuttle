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
import { DAY_TYPES, isDayType, type DayType } from '../../../../../../domain/entities/DayType';
import type { Notice } from '../../../../../../domain/entities/Notice';
import type { Route } from '../../../../../../domain/entities/Route';
import type { Schedule } from '../../../../../../domain/entities/Schedule';
import type { Trip } from '../../../../../../domain/entities/Trip';
import type {
  BusRef,
  Contacts,
  Notice as RawNotice,
  SemesterPeriod,
  SourcePage,
  TripRow,
} from '../types/contract';
import type { DayTableView, RouteView, SourceView, TimetableModel } from '../types/model';

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

/** 원시 행 → 도메인 `Trip`(5필드 고정). 위 파일 주석의 열 별칭 규칙만 적용한다. */
function toDomainTrip(row: TripRow, index: number): Trip {
  const rawSeq = row['seq'];
  const seq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) ? rawSeq : index + 1;
  return {
    seq,
    depCampus: cellText(row, DEPARTURE_KEY_ALIASES.depCampus),
    depStation: cellText(row, DEPARTURE_KEY_ALIASES.depStation),
    arrCampus: cellText(row, ['arrCampus']),
    note: cellText(row, ['note']),
  };
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

/* ───────────────────────── 원시 값 가드 ───────────────────────── */

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TimetableDataError(path, `객체가 아닙니다 (${describe(value)})`);
  }
  return value as Record<string, unknown>;
}

function requireRow(value: unknown, path: string): TripRow {
  const record = requireRecord(value, path);
  for (const [key, cell] of Object.entries(record)) {
    if (cell !== null && typeof cell !== 'string' && typeof cell !== 'number') {
      throw new TimetableDataError(`${path}.${key}`, `셀 값은 문자열·숫자·null 이어야 합니다 (${describe(cell)})`);
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
