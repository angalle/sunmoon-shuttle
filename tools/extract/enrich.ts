/**
 * 스키마 v2 조립 — **v1 필드는 값까지 그대로** 두고 추가 필드만 얹는다(앱 무중단).
 *
 * 보존 원칙(발행 전 검증기가 다시 확인한다 — `validate.ts`):
 *  - `schemaVersion` 1 → 2 (앱은 `schemaVersion` 을 숫자로만 읽는다)
 *  - `semester` · `holidayPeriod` · `dayTypes` · `busRefs` · `contacts` · `source`(url·시각·pages) 불변
 *  - `routes[]` 는 표(columns/keys/trips/byDay/offDays/status) **불변** + `tripNotes[]`·`stopWindows[]` 추가
 *  - `notices[]` 는 **중복 통합만** 수행(갭 ⑥) — 나머지 항목의 kind/text/raw/date/endDate 는 불변
 *  - `contentHash` 는 v2 페이로드(v2 추가 필드 포함, `source` 제외)로 **재계산**한다
 */

import { createHash } from 'node:crypto';

import type { Notice, RouteData, Timetable } from '../scraper/types.js';
import type {
  DateRule,
  EnrichedRouteData,
  EnrichedTimetable,
  EnrichedTimetableBody,
  ExtractionMeta,
  StopWindow,
  Term,
  TripNote,
} from './types.js';

export const SCHEMA_VERSION_V2 = 2 as const;

export interface EnrichedParts {
  readonly dateRules: readonly DateRule[];
  readonly terms: readonly Term[];
  readonly tripNotes: readonly { readonly routeId: string; readonly notes: readonly TripNote[] }[];
  readonly stopWindows: readonly { readonly routeId: string; readonly windows: readonly StopWindow[] }[];
  readonly notices: readonly Notice[];
  readonly dedupedNotices: number;
}

/** v1 필드를 값까지 그대로 복제한다(참조 공유로 인한 조용한 변형 방지). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildEnrichedTimetable(base: Timetable, parts: EnrichedParts): EnrichedTimetableBody {
  const tripNotesByRoute = new Map(parts.tripNotes.map((entry) => [entry.routeId, entry.notes]));
  const stopWindowsByRoute = new Map(parts.stopWindows.map((entry) => [entry.routeId, entry.windows]));

  const routes: EnrichedRouteData[] = base.routes.map((route: RouteData) => ({
    ...clone(route),
    tripNotes: clone(tripNotesByRoute.get(route.id) ?? []),
    stopWindows: clone(stopWindowsByRoute.get(route.id) ?? []),
  }));

  const payload = {
    schemaVersion: SCHEMA_VERSION_V2 as 2,
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
