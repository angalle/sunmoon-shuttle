/**
 * 스키마 검증 — **통과하지 못하면 호출측은 JSON 을 쓰지 않는다**(조용한 손상 금지).
 *
 * 검사 항목: 필수 필드 · 형식 · 행 수 하한 · 빈 배열 금지(단, 원본에 페이지가 없는 요일은 예외 — `offDays`),
 * `columns`/`trips` 정합(열 키 일치·순번 연속·빈 문자열 금지·시각 형식), `contentHash` 재계산 일치.
 *
 * 계약 근거: `docs/01 §4`(스키마) · `docs/00` F2/F2b(열 구성 가변·운행 중단 표시)
 */

import { DAY_TYPES } from './types.js';
import type { DayTable, DayType, RouteData, Timetable, TripRow } from './types.js';
import { ROUTES, findDay } from './routeMeta.js';
import { canonicalPayload, sha256Hex } from './assemble.js';

export interface ValidationIssue {
  readonly where: string;
  readonly message: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const MAX_ROWS_PER_DAY = 200;

const isDayType = (value: string): value is DayType => (DAY_TYPES as readonly string[]).includes(value);

export function validateTimetable(timetable: Timetable): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (where: string, message: string): void => {
    issues.push({ where, message });
  };

  // ── 최상위 ──
  if (timetable.schemaVersion !== 1) {
    add('schemaVersion', `1 이어야 합니다(현재 ${String(timetable.schemaVersion)})`);
  }

  // ── source ──
  if (!/^https?:\/\/\S+$/u.test(timetable.source.url)) add('source.url', 'http(s) URL 이 아닙니다');
  if (!DATE_PATTERN.test(timetable.source.sourceUpdatedAt)) add('source.sourceUpdatedAt', 'YYYY-MM-DD 형식이 아닙니다');
  if (!ISO_OFFSET_PATTERN.test(timetable.source.fetchedAt)) add('source.fetchedAt', 'ISO8601(+오프셋) 형식이 아닙니다');
  if (!HASH_PATTERN.test(timetable.source.contentHash)) {
    add('source.contentHash', 'sha256:<64hex> 형식이 아닙니다');
  } else {
    const recomputed = `sha256:${sha256Hex(canonicalPayload(timetable))}`;
    if (recomputed !== timetable.source.contentHash) {
      add('source.contentHash', `재계산 해시와 다릅니다 — 기대 ${recomputed}, 실제 ${timetable.source.contentHash}`);
    }
  }
  if (timetable.source.pages.length === 0) add('source.pages', '페이지별 출처가 비어 있습니다(빈 배열 금지)');
  timetable.source.pages.forEach((page, i) => {
    const where = `source.pages[${i}]`;
    if (!ROUTES.some((r) => r.id === page.routeId)) add(where, `알 수 없는 노선 id "${page.routeId}"`);
    if (!isDayType(page.dayType)) add(where, `알 수 없는 요일 "${page.dayType}"`);
    if (!/^https?:\/\/\S+$/u.test(page.url)) add(where, 'url 이 http(s) 가 아닙니다');
    if (!DATE_PATTERN.test(page.sourceUpdatedAt)) add(where, 'sourceUpdatedAt 이 YYYY-MM-DD 가 아닙니다');
  });

  // ── 학기/휴일 기간 ──
  for (const [key, period] of [
    ['semester', timetable.semester],
    ['holidayPeriod', timetable.holidayPeriod],
  ] as const) {
    if (period === null) {
      if (key === 'semester') add(key, '필수입니다(주말 페이지가 없는 학기도 평일 문구는 있어야 합니다)');
      continue;
    }
    if (period.label.trim() === '') add(key, 'label 이 비었습니다');
    if (!DATE_PATTERN.test(period.startsOn)) add(key, 'startsOn 이 YYYY-MM-DD 가 아닙니다');
    if (!DATE_PATTERN.test(period.endsOn)) add(key, 'endsOn 이 YYYY-MM-DD 가 아닙니다');
    if (period.startsOn > period.endsOn) add(key, `기간이 뒤집혔습니다(${period.startsOn} > ${period.endsOn})`);
    if (period.title.trim() === '') add(key, 'title(원본 문구)이 비었습니다');
  }

  // ── dayTypes ──
  if (timetable.dayTypes.length === 0) add('dayTypes', '빈 배열 금지');
  if (new Set(timetable.dayTypes).size !== timetable.dayTypes.length) add('dayTypes', '중복된 요일이 있습니다');
  for (const day of timetable.dayTypes) {
    if (!isDayType(day)) add('dayTypes', `알 수 없는 요일 "${day}"`);
  }

  // ── routes ──
  if (timetable.routes.length === 0) add('routes', '빈 배열 금지');
  const seenIds = new Set<string>();
  timetable.routes.forEach((route) => {
    const where = `routes[${route.id}]`;
    if (seenIds.has(route.id)) add(where, '노선 id 가 중복입니다');
    seenIds.add(route.id);
    const meta = ROUTES.find((r) => r.id === route.id);
    if (meta === undefined) {
      add(where, `계약(routeMeta)에 없는 노선입니다`);
      return;
    }
    if (route.name.trim() === '') add(where, 'name 이 비었습니다');
    if (route.status !== meta.status) add(where, `status 가 계약과 다릅니다 — 계약 ${meta.status}, 실제 ${route.status}`);

    for (const day of DAY_TYPES) {
      const table = route.byDay[day];
      if (table === undefined) {
        add(where, `byDay.${day} 이 없습니다`);
      }
    }

    if (route.status === 'suspended') {
      if (route.suspendedReason === undefined || route.suspendedReason.trim() === '') {
        add(where, 'suspendedReason(원본 문구)이 필요합니다 — 빈 상태로 넘기지 않습니다(docs/00 F2b)');
      }
      if (route.trips.length !== 0 || route.columns.length !== 0) add(where, '운행 중단 노선은 columns/trips 가 비어야 합니다');
      for (const day of DAY_TYPES) {
        const table = route.byDay[day];
        if (table !== undefined && (table.trips.length !== 0 || table.keys.length !== 0)) {
          add(where, `byDay.${day} 은 비어 있어야 합니다(운행 중단)`);
        }
      }
      return;
    }

    if (route.columns.length === 0) add(where, 'columns 가 비었습니다(빈 배열 금지)');
    if (route.trips.length === 0) add(where, 'trips 가 비었습니다(행 수 하한 위반)');

    const expectedOffDays = DAY_TYPES.filter((d) => findDay(meta, d) === null);
    for (const day of DAY_TYPES) {
      const table = route.byDay[day];
      if (table === undefined) continue;
      const dayMeta = findDay(meta, day);
      if (dayMeta === null) {
        if (!expectedOffDays.includes(day)) add(where, `byDay.${day} 이 계약에 없습니다`);
        if (table.trips.length !== 0 || table.keys.length !== 0 || table.columns.length !== 0) {
          add(where, `byDay.${day}: 원본에 페이지가 없는 요일이므로 비어 있어야 합니다`);
        }
        continue;
      }
      validateDayTable(route, day, table, dayMeta.columns.map((c) => c.key), dayMeta.columns.map((c) => c.label), add);
    }

    // 대표(평일) 열/행과 byDay.weekday 의 일치
    const weekday = route.byDay.weekday;
    if (weekday !== undefined && route.status === 'active') {
      if (JSON.stringify(route.columns) !== JSON.stringify(weekday.keys)) {
        add(where, 'route.columns 가 byDay.weekday.keys 와 다릅니다(대표=평일)');
      }
      if (JSON.stringify(route.trips) !== JSON.stringify(weekday.trips)) {
        add(where, 'route.trips 가 byDay.weekday.trips 와 다릅니다(대표=평일)');
      }
    }
  });

  // dayTypes 와 실제 데이터 일치
  const daysWithData = DAY_TYPES.filter((day) =>
    timetable.routes.some((route) => (route.byDay[day]?.trips.length ?? 0) > 0),
  );
  if (JSON.stringify(daysWithData) !== JSON.stringify(timetable.dayTypes)) {
    add('dayTypes', `실제 데이터가 있는 요일과 다릅니다 — 데이터 [${daysWithData.join(', ')}] vs 선언 [${timetable.dayTypes.join(', ')}]`);
  }

  // ── notices / busRefs / contacts ──
  if (timetable.notices.length === 0) add('notices', '빈 배열 금지');
  const seenNoticeRaw = new Set<string>();
  timetable.notices.forEach((notice, i) => {
    const where = `notices[${i}]`;
    if (!['no-service', 'alternate-schedule', 'notice'].includes(notice.kind)) add(where, `알 수 없는 kind "${notice.kind}"`);
    if (notice.text.trim() === '') add(where, 'text 가 비었습니다');
    if (notice.raw.trim() === '') add(where, 'raw(원문)가 비었습니다');
    if (notice.date !== undefined && !DATE_PATTERN.test(notice.date)) add(where, 'date 가 YYYY-MM-DD 가 아닙니다');
    if (notice.endDate !== undefined && !DATE_PATTERN.test(notice.endDate)) add(where, 'endDate 가 YYYY-MM-DD 가 아닙니다');
    if (seenNoticeRaw.has(notice.raw)) add(where, `같은 원문 안내문이 중복입니다 — ${notice.raw}`);
    seenNoticeRaw.add(notice.raw);
  });

  if (timetable.busRefs.length === 0) add('busRefs', '빈 배열 금지');
  const seenBus = new Set<string>();
  timetable.busRefs.forEach((ref, i) => {
    const where = `busRefs[${i}]`;
    if (ref.line.trim() === '' || ref.stop.trim() === '' || ref.to.trim() === '') {
      add(where, 'line/stop/to 는 비어 있을 수 없습니다');
    }
    const key = `${ref.to}|${ref.line}|${ref.stop}`;
    if (seenBus.has(key)) add(where, `중복된 참고 항목입니다 — ${key}`);
    seenBus.add(key);
  });

  if (timetable.contacts.team.trim() === '' || timetable.contacts.tel.trim() === '') {
    add('contacts', 'team/tel 은 비어 있을 수 없습니다');
  }

  return issues;
}

function validateDayTable(
  route: RouteData,
  day: DayType,
  table: DayTable,
  expectedKeys: readonly string[],
  expectedLabels: readonly string[],
  add: (where: string, message: string) => void,
): void {
  const where = `routes[${route.id}].byDay.${day}`;
  if (table.trips.length === 0) {
    add(where, 'trips 가 비었습니다(행 수 하한 위반 — 원본에 페이지가 있다면 파싱 실패)');
    return;
  }
  if (table.trips.length > MAX_ROWS_PER_DAY) {
    add(where, `행 수가 상한(${MAX_ROWS_PER_DAY})을 넘습니다 — ${table.trips.length}행(파싱 폭주 의심)`);
  }
  if (JSON.stringify(table.keys) !== JSON.stringify(expectedKeys)) {
    add(where, `keys 가 계약과 다릅니다 — 계약 [${expectedKeys.join(', ')}] vs 실제 [${table.keys.join(', ')}]`);
  }
  if (table.columns.length !== expectedLabels.length) {
    add(where, `columns(원문 헤더) 개수가 계약과 다릅니다 — 계약 ${expectedLabels.length}, 실제 ${table.columns.length}`);
  }

  const seenSeq = new Set<number>();
  table.trips.forEach((trip, i) => {
    const rowWhere = `${where}.trips[${i}]`;
    const keys = Object.keys(trip);
    if (JSON.stringify(keys) !== JSON.stringify(table.keys)) {
      add(rowWhere, `행의 키가 열과 다릅니다 — 기대 [${table.keys.join(', ')}] vs 실제 [${keys.join(', ')}]`);
    }
    for (const [key, value] of Object.entries(trip)) {
      if (value === '') add(rowWhere, `"${key}" 값이 빈 문자열입니다(null 또는 값이어야 합니다)`);
      if (value === undefined) add(rowWhere, `"${key}" 값이 undefined 입니다`);
    }
    const seq = trip['seq'];
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq !== i + 1) {
      add(rowWhere, `seq 가 순번(${i + 1})과 다릅니다 — ${String(seq)}`);
    } else if (seenSeq.has(seq)) {
      add(rowWhere, `seq ${seq} 가 중복입니다`);
    } else {
      seenSeq.add(seq);
    }
    // 값 타입: string | number | null
    for (const [key, value] of Object.entries(trip)) {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        add(rowWhere, `"${key}" 값 타입이 string|number|null 이 아닙니다`);
      }
    }
  });

  // 시각 열 형식(계약 kind 기준)
  const meta = ROUTES.find((r) => r.id === route.id);
  const dayMeta = meta === undefined ? null : findDay(meta, day);
  if (dayMeta === null) return;
  dayMeta.columns.forEach((spec, columnIndex) => {
    if (spec.kind !== 'time') return;
    table.trips.forEach((trip: TripRow, i) => {
      const value = trip[spec.key];
      if (typeof value === 'string' && !TIME_PATTERN.test(value)) {
        add(`${where}.trips[${i}]`, `시각 열 "${spec.key}"(${columnIndex + 1}번째) 값이 HH:MM 이 아닙니다 — "${value}"`);
      }
    });
  });
}
