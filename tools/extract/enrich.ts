/**
 * 스키마 v3 조립 — **v1 필드는 값까지 그대로** 두고 추가 필드만 얹는다(앱 무중단).
 * 단 하나의 예외: `routes[].byDay[*].trips[].note` — 원문 표기가 구조화되면 **비운다**(v3 계약).
 *   · 조건이 구조화된 행: `service`/`durationMinutes` 추가 + `note: null`
 *   · 해석 못 한 행     : `unknownNote`(=원문) + `note` 유지 + `needsReview: true` (버리지 않는다)
 *
 * 보존 원칙(발행 전 검증기가 다시 확인한다 — `validate.ts`):
 *  - `schemaVersion` 2 → 3 (앱은 `schemaVersion` 을 숫자로만 읽는다)
 *  - `semester` · `holidayPeriod` · `dayTypes` · `busRefs` · `contacts` · `source`(url·시각·pages) 불변
 *  - `routes[]` 는 표(columns/keys/rows/offDays/status) **불변** + `tripNotes[]`·`stopWindows[]`·`routeNotes[]`·조건 필드 추가
 *  - `notices[]` 는 **중복 통합만** 수행(갭 ⑥) — 나머지 항목의 kind/text/raw/date/endDate 는 불변
 *  - `contentHash` 는 v3 페이로드(v3 추가 필드 포함, `source` 제외)로 **재계산**한다
 */

import { createHash } from 'node:crypto';

import type { CellValue, DayTable, DayType, Notice, RouteData, Timetable, TripRow } from '../scraper/types.js';
import { DAY_TYPES } from '../scraper/types.js';
import { tripConditionKey, tripSeq } from './trips.js';
import type {
  DateRule,
  EnrichedRouteData,
  EnrichedTimetable,
  EnrichedTimetableBody,
  EnrichedTripRow,
  ExtractionMeta,
  RouteNote,
  StopWindow,
  Term,
  TripConditionEntry,
  TripConditionFields,
  TripNote,
} from './types.js';

export const SCHEMA_VERSION_V3 = 3 as const;

export interface EnrichedParts {
  readonly dateRules: readonly DateRule[];
  readonly terms: readonly Term[];
  readonly tripNotes: readonly { readonly routeId: string; readonly notes: readonly TripNote[] }[];
  readonly stopWindows: readonly { readonly routeId: string; readonly windows: readonly StopWindow[] }[];
  /** v3: 편별 조건(원문 note 해석 결과) — 없으면 조건 없음(편별 note 없는 입력) */
  readonly tripConditions?: readonly { readonly routeId: string; readonly entries: readonly TripConditionEntry[] }[];
  /** v3 개정: 노선 폐지·중단 원문 서술 — `dateRules` 가 아니라 여기로만 표현한다(docs/06 §8-1) */
  readonly routeNotes?: readonly { readonly routeId: string; readonly notes: readonly RouteNote[] }[];
  readonly notices: readonly Notice[];
  readonly dedupedNotices: number;
}

/** v1 필드를 값까지 그대로 복제한다(참조 공유로 인한 조용한 변형 방지). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 구조화 결과 1건 → 행에 얹을 조건 필드(note 처리는 호출부). */
function conditionFields(entry: TripConditionEntry): TripConditionFields {
  if (entry.outcome === 'unknown') {
    return { service: null, durationMinutes: null, unknownNote: entry.sourceQuote, needsReview: true };
  }
  return { service: entry.service, durationMinutes: entry.durationMinutes, needsReview: false };
}

/** 행 1개에 조건을 적용한다 — note 가 있던 행만 바뀌고 `sourceQuote` 는 원문 그대로다. */
export function applyTripCondition(row: TripRow, entry: TripConditionEntry | undefined): EnrichedTripRow {
  if (entry === undefined) return row as EnrichedTripRow;
  const withNote: Record<string, CellValue> = { ...clone(row), note: entry.outcome === 'unknown' ? entry.sourceQuote : null };
  return { ...withNote, ...conditionFields(entry) } as EnrichedTripRow;
}

export function buildEnrichedTimetable(base: Timetable, parts: EnrichedParts): EnrichedTimetableBody {
  const tripNotesByRoute = new Map(parts.tripNotes.map((entry) => [entry.routeId, entry.notes]));
  const stopWindowsByRoute = new Map(parts.stopWindows.map((entry) => [entry.routeId, entry.windows]));
  const routeNotesByRoute = new Map((parts.routeNotes ?? []).map((entry) => [entry.routeId, entry.notes]));
  const conditionsByRoute = new Map(
    (parts.tripConditions ?? []).map((entry) => [
      entry.routeId,
      new Map(entry.entries.map((condition) => [tripConditionKey(entry.routeId, condition.dayType, condition.seq), condition])),
    ]),
  );

  const routes: EnrichedRouteData[] = base.routes.map((route: RouteData) => {
    const conditions = conditionsByRoute.get(route.id) ?? new Map<string, TripConditionEntry>();
    const apply = (table: DayTable, dayType: DayType | null): DayTable => ({
      ...clone(table),
      trips: table.trips.map((row, index) =>
        applyTripCondition(
          row,
          dayType === null ? undefined : conditions.get(tripConditionKey(route.id, dayType, tripSeq(row, index))),
        ),
      ),
    });
    const byDay = Object.fromEntries(
      (DAY_TYPES as readonly DayType[]).map((dayType) => [dayType, apply(route.byDay[dayType], dayType)]),
    ) as Readonly<Record<DayType, DayTable>>;
    // 대표 배열(`routes[].trips`)은 평일 표와 같은 행이다 → 평일 키로 같은 조건을 적용한다.
    const representativeDay: DayType | null = route.byDay.weekday === undefined ? null : 'weekday';
    return {
      ...clone(route),
      byDay,
      trips: route.trips.map((row, index) =>
        applyTripCondition(
          row,
          representativeDay === null ? undefined : conditions.get(tripConditionKey(route.id, representativeDay, tripSeq(row, index))),
        ),
      ),
      tripNotes: clone(tripNotesByRoute.get(route.id) ?? []),
      stopWindows: clone(stopWindowsByRoute.get(route.id) ?? []),
      routeNotes: clone(routeNotesByRoute.get(route.id) ?? []),
    };
  });

  const payload = {
    schemaVersion: SCHEMA_VERSION_V3 as 3,
    semester: clone(base.semester),
    holidayPeriod: base.holidayPeriod === null ? null : clone(base.holidayPeriod),
    dayTypes: [...base.dayTypes],
    routes,
    dateRules: clone(parts.dateRules),
    terms: clone(parts.terms),
    notices: clone(parts.notices),
    busRefs: clone(base.busRefs),
    contacts: clone(base.contacts),
  };

  return {
    ...payload,
    source: {
      ...clone(base.source),
      contentHash: `sha256:${sha256Hex(enrichedCanonicalPayload(payload))}`,
    },
  };
}

/** `contentHash` 대상 = `source`(실행 시각·추출 메타)를 뺀 v2 페이로드. */
export function enrichedCanonicalPayload(payload: Omit<EnrichedTimetableBody, 'source'>): string {
  return JSON.stringify({
    schemaVersion: payload.schemaVersion,
    semester: payload.semester,
    holidayPeriod: payload.holidayPeriod,
    dayTypes: payload.dayTypes,
    routes: payload.routes,
    dateRules: payload.dateRules,
    terms: payload.terms,
    notices: payload.notices,
    busRefs: payload.busRefs,
    contacts: payload.contacts,
  });
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 추출 메타(모델·프롬프트 해시·건수·갭 커버리지)를 `source.extraction` 에 붙인다. */
export function withExtractionMeta(timetable: EnrichedTimetableBody, meta: ExtractionMeta): EnrichedTimetable {
  return { ...timetable, source: { ...timetable.source, extraction: meta } };
}
