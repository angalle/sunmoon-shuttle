/**
 * v3 검증기 — **여기서 정하는 것: 발행 여부**.
 *
 * 두 종류의 문제를 구분한다(요구사항 `AC-A3` · 부록 A 검증 규칙):
 *  - `fatal: true`  → **발행 중단(exit 1)**: 스키마 위반(잘못된 kind·날짜 형식·필수 필드 누락),
 *                     **인용이 원본 부분문자열이 아님**(위조), 중복 규칙, contentHash 불일치,
 *                     v3 편별 조건 계약 위반(원문 note 유실·표기 변형·중복 표현).
 *  - `fatal: false` → **발행은 하되 `needsReview` 로 표시**: 규칙 baseline(행 수·시각) 불일치,
 *                     AI 저신뢰인데 표시가 빠짐, 날짜 미기재 항목.
 *
 * 검증 순서: ① v1 보존(앱 무중단) ② v3 스키마 ③ 편별 조건(v3) ④ 인용 ⑤ 중복 ⑥ baseline ⑦ needsReview 판정
 */

import { DAY_TYPES } from '../scraper/types.js';
import type { CellValue, DayTable, Notice, Timetable, TripRow } from '../scraper/types.js';
import { dedupeNotices } from './rules.js';
import { enrichedCanonicalPayload, sha256Hex } from './enrich.js';
import { noteTextOf } from './trips.js';
import { findExactQuote } from './text.js';
import type { QuoteSource } from './text.js';
import { isDateRuleKind, isWeekdayCode } from './types.js';
import type {
  DateRule,
  EnrichedTimetableBody,
  SnapshotSource,
  StopWindow,
  TermSource,
  TripNote,
  ValidationIssue,
} from './types.js';

export const CONFIDENCE_REVIEW_THRESHOLD = 0.6;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_DURATION_MINUTES = 300;

/** v3 조건 필드 — v1 보존 비교에서 제외한다(값이 바뀌는 것이 계약이다). */
const CONDITION_KEYS: readonly string[] = ['service', 'durationMinutes', 'unknownNote', 'needsReview'];
/** 원문 표기가 구조화되면 비우는 키(비교 제외 — v3 계약) */
const CLEARED_KEYS: readonly string[] = [...CONDITION_KEYS, 'note'];

export interface ValidateContext {
  /** 규칙 파서가 만든 v1 기준선(불변 대조 대상) */
  readonly baseline: Timetable;
  /** 인용 검증용 원본 스냅샷 본문 */
  readonly sources: readonly SnapshotSource[];
  /** v3: 기간 수집용 스냅샷(방학 페이지 등) — 인용 검증 대상에 포함한다(없으면 노선 스냅샷만) */
  readonly termSources?: readonly TermSource[];
}

export function hasFatal(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.fatal);
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

export function validateEnriched(timetable: EnrichedTimetableBody, context: ValidateContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fatal = (where: string, message: string): void => {
    issues.push({ where, message, fatal: true });
  };
  const warn = (where: string, message: string): void => {
    issues.push({ where, message, fatal: false });
  };

  // ① 스키마 버전 · 해시
  if (timetable.schemaVersion !== 3) fatal('schemaVersion', `3 이어야 합니다(현재 ${String(timetable.schemaVersion)})`);
  if (!HASH_PATTERN.test(timetable.source.contentHash)) {
    fatal('source.contentHash', 'sha256:<64hex> 형식이 아닙니다');
  } else {
    const recomputed = `sha256:${sha256Hex(enrichedCanonicalPayload(timetable))}`;
    if (recomputed !== timetable.source.contentHash) {
      fatal('source.contentHash', `재계산 해시와 다릅니다 — 기대 ${recomputed}, 실제 ${timetable.source.contentHash}`);
    }
  }

  // ② v1 보존(앱 무중단) — 값 비교
  const baseline = context.baseline;
  for (const [where, before, after] of [
    ['semester', baseline.semester, timetable.semester],
    ['holidayPeriod', baseline.holidayPeriod, timetable.holidayPeriod],
    ['dayTypes', baseline.dayTypes, timetable.dayTypes],
    ['busRefs', baseline.busRefs, timetable.busRefs],
    ['contacts', baseline.contacts, timetable.contacts],
    ['source.url', baseline.source.url, timetable.source.url],
    ['source.sourceUpdatedAt', baseline.source.sourceUpdatedAt, timetable.source.sourceUpdatedAt],
    ['source.fetchedAt', baseline.source.fetchedAt, timetable.source.fetchedAt],
    ['source.pages', baseline.source.pages, timetable.source.pages],
  ] as const) {
    if (stable(before) !== stable(after)) {
      fatal(where, 'v1 필드가 변경되었습니다(앱 무중단 위반) — v3 는 추가 필드만 얹어야 합니다');
    }
  }

  // ③ routes: 표(행 수·시각·열) 불변 — 조건 필드와 `note`(구조화 시 비움)는 비교에서 제외한다.
  //    다르면 **needsReview**(발행은 하되 표시).
  if (timetable.routes.length !== baseline.routes.length) {
    warn('routes', `노선 수가 기준선과 다릅니다 — 기준 ${baseline.routes.length}, 실제 ${timetable.routes.length}`);
  }
  baseline.routes.forEach((baseRoute, index) => {
    const route = timetable.routes[index];
    const where = `routes[${route?.id ?? index}]`;
    if (route === undefined) {
      warn(where, '기준선에 있는 노선이 없습니다');
      return;
    }
    if (route.id !== baseRoute.id) warn(where, `노선 순서/ id 가 기준선과 다릅니다 — 기준 ${baseRoute.id}, 실제 ${route.id}`);
    if (stable(route.columns) !== stable(baseRoute.columns)) {
      warn(where, '열 구성이 규칙 baseline 과 다릅니다 — needsReview 로 표시합니다');
    }
    for (const dayType of DAY_TYPES) {
      const before = baseRoute.byDay[dayType];
      const after = route.byDay[dayType];
      if (stable(stripDayTable(before)) !== stable(stripDayTable(after))) {
        warn(`${where}.byDay.${dayType}`, '표가 규칙 baseline 과 다릅니다(행 수·시각 불변 위반) — needsReview 로 표시합니다');
      }
    }
    if (stable(stripTrips(baseRoute.trips)) !== stable(stripTrips(route.trips))) {
      warn(where, '대표(평일) 표가 규칙 baseline 과 다릅니다 — needsReview 로 표시합니다');
    }
  });

  // ③-b 편별 조건(v3) — 원문 note 의 **유실·변형·중복 표현**을 막는다(치명)
  checkTripConditions(timetable, baseline, context, fatal, warn);

  // ④ notices: 중복 통합 결과와 정확히 일치해야 한다
  const expectedNotices: readonly Notice[] = dedupeNotices(baseline.notices, context.sources).notices;
  if (stable(timetable.notices) !== stable(expectedNotices)) {
    fatal('notices', '중복 제거 결과가 기대와 다릅니다(안내문 값 변경·누락)');
  }

  // ⑤ dateRules
  const seenRules = new Set<string>();
  timetable.dateRules.forEach((rule, index) => {
    const where = `dateRules[${index}](${rule.kind})`;
    if (!isDateRuleKind(rule.kind)) {
      fatal(where, `알 수 없는 kind "${String(rule.kind)}"`);
      return;
    }
    checkQuote(rule.sourceQuote, rule.sourcePage, where, context, fatal);
    checkDateRange(rule.start, rule.end, `${where}.start`, fatal);
    if (typeof rule.confidence !== 'number' || rule.confidence < 0 || rule.confidence > 1) {
      fatal(`${where}.confidence`, `0~1 범위가 아닙니다 — ${String(rule.confidence)}`);
    }
    if (rule.needsReview !== true && rule.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
      warn(`${where}.needsReview`, `confidence ${rule.confidence} 인데 needsReview=false 입니다(AI 저신뢰 표시 누락)`);
    }
    const required = requiredRuleFields(rule);
    for (const [field, ok] of required) {
      if (!ok) fatal(`${where}.${field}`, `${rule.kind} 의 필수 필드가 비었습니다`);
    }
    const key = `${rule.kind}|${rule.start ?? ''}|${rule.end ?? ''}|${rule.dayTypes.join(',')}|${[...rule.scope].sort().join(',')}|${rule.sourceQuote}`;
    if (seenRules.has(key)) fatal(where, '같은 규칙이 중복입니다(중복 제거 위반)');
    seenRules.add(key);
    for (const quote of rule.mergedQuotes ?? []) {
      if (quote.trim() === '') fatal(`${where}.mergedQuotes`, '빈 인용이 있습니다');
      // 통합된 표기는 다른 페이지에서 온 것일 수 있으므로 근거 페이지 대조는 하지 않는다(인용 존재만 확인)
      else checkQuote(quote, '', `${where}.mergedQuotes`, context, fatal);
    }
    for (const day of rule.dayTypes) {
      if (!(DAY_TYPES as readonly string[]).includes(day)) fatal(`${where}.dayTypes`, `알 수 없는 요일 "${String(day)}"`);
    }
  });

  // ⑥ terms
  const seenTerms = new Set<string>();
  timetable.terms.forEach((term, index) => {
    const where = `terms[${index}](${term.kind})`;
    if (term.kind !== 'semester' && term.kind !== 'vacation') fatal(where, `알 수 없는 kind "${String(term.kind)}"`);
    if (term.label.trim() === '') fatal(`${where}.label`, 'label 이 비었습니다');
    checkQuote(term.sourceQuote, term.sourcePage, where, context, fatal);
    checkDateRange(term.start, term.end, `${where}.start`, fatal);
    if (term.start === null && term.needsReview !== true) {
      warn(`${where}.needsReview`, '기간 미기재 항목인데 needsReview=false 입니다');
    }
    checkPeriodSearch(term.periodSearch ?? null, term.start, term.end, `${where}.periodSearch`, context, fatal);
    const key = `${term.kind}|${term.label}|${term.start ?? ''}`;
    if (seenTerms.has(key)) fatal(where, '같은 term 이 중복입니다');
    seenTerms.add(key);
  });

  // ⑦ routes[].tripNotes / stopWindows
  timetable.routes.forEach((route) => {
    route.tripNotes.forEach((note: TripNote, index: number) => {
      const where = `routes[${route.id}].tripNotes[${index}]`;
      if (note.minutes !== null && (!Number.isInteger(note.minutes) || note.minutes <= 0 || note.minutes > 300)) {
        fatal(`${where}.minutes`, `1~300 정수가 아닙니다 — ${String(note.minutes)}`);
      }
      if (!['inbound', 'outbound', 'both'].includes(note.direction)) fatal(`${where}.direction`, `알 수 없는 방향 "${String(note.direction)}"`);
      checkQuote(note.sourceQuote, note.sourcePage, where, context, fatal);
    });
    route.stopWindows.forEach((window: StopWindow, index: number) => {
      const where = `routes[${route.id}].stopWindows[${index}]`;
      if (window.location.trim() === '') fatal(`${where}.location`, 'location 이 비었습니다');
      if (window.windows.length === 0) fatal(`${where}.windows`, '시간창이 비었습니다');
      window.windows.forEach((time, timeIndex) => {
        if (!TIME_PATTERN.test(time.start)) fatal(`${where}.windows[${timeIndex}].start`, `HH:MM 이 아닙니다 — "${time.start}"`);
        if (time.end !== null && !TIME_PATTERN.test(time.end)) {
          fatal(`${where}.windows[${timeIndex}].end`, `HH:MM 이 아닙니다 — "${time.end}"`);
        }
      });
      checkQuote(window.sourceQuote, window.sourcePage, where, context, fatal);
    });
  });

  return issues;
}

/** v1 보존 비교용 — 조건 필드와 `note` 를 뺀 값(그 둘은 v3 계약으로 바뀐다). */
function stripTripRow(row: TripRow): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (CLEARED_KEYS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

function stripTrips(trips: readonly TripRow[]): readonly Record<string, CellValue>[] {
  return trips.map(stripTripRow);
}

function stripDayTable(table: DayTable): Record<string, unknown> {
  return { columns: table.columns, keys: table.keys, trips: stripTrips(table.trips) };
}

interface ConditionRead {
  readonly present: boolean;
  readonly service: Record<string, unknown> | null;
  readonly serviceRaw: unknown;
  readonly durationMinutes: unknown;
  readonly unknownNote: unknown;
  readonly needsReview: unknown;
  readonly note: unknown;
}

function readCondition(row: TripRow): ConditionRead {
  const raw = row as Record<string, unknown>;
  const serviceRaw = raw['service'];
  const service = typeof serviceRaw === 'object' && serviceRaw !== null && !Array.isArray(serviceRaw)
    ? (serviceRaw as Record<string, unknown>)
    : null;
  const present = CONDITION_KEYS.some((key) => key in raw);
  return {
    present,
    service,
    serviceRaw,
    durationMinutes: raw['durationMinutes'],
    unknownNote: raw['unknownNote'],
    needsReview: raw['needsReview'],
    note: raw['note'],
  };
}

function checkWeekdayList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && isWeekdayCode(item));
}

/**
 * 편별 조건(v3) 계약 — 원문 note 는 **정확히 한 가지 방식으로** 설명되어야 한다.
 *   ① `service` (요일 조건) ② `durationMinutes` (소요시간) ③ `unknownNote` + `needsReview`(미해석)
 * 원문 note 가 있는데 아무 설명도 없으면 **치명**(유실), 표기가 변형되면 **치명**(위조).
 */
function checkTripConditions(
  timetable: EnrichedTimetableBody,
  baseline: Timetable,
  context: ValidateContext,
  fatal: (where: string, message: string) => void,
  warn: (where: string, message: string) => void,
): void {
  baseline.routes.forEach((baseRoute, routeIndex) => {
    const route = timetable.routes[routeIndex];
    if (route === undefined) return;
    for (const dayType of DAY_TYPES) {
      const baseTrips = baseRoute.byDay[dayType]?.trips ?? [];
      const trips = route.byDay[dayType]?.trips ?? [];
      if (baseTrips.length !== trips.length) {
        warn(`routes[${route.id}].byDay.${dayType}`, '행 수가 기준선과 다릅니다 — needsReview 로 표시합니다');
        continue;
      }
      trips.forEach((row, index) => {
        const where = `routes[${route.id}].byDay.${dayType}.trips[${index}]`;
        const rawNote = noteTextOf(baseTrips[index] ?? {});
        const condition = readCondition(row);
        if (rawNote === null) {
          if (condition.present) fatal(where, '원문에 없던 조건 필드가 주입되었습니다(위조)');
          return;
        }
        // 원문 note 는 **정확히 한 가지 방식**으로만 설명된다(docs/06 §3):
        //   service(요일 조건) / durationMinutes(소요시간) / unknownNote(미해석 보존)
        const serviceSet = condition.service !== null;
        const durationSet = typeof condition.durationMinutes === 'number';
        const unknownSet = typeof condition.unknownNote === 'string' && condition.unknownNote.trim() !== '';
        const explained = [serviceSet, durationSet, unknownSet].filter(Boolean).length;
        if (explained === 0) {
          fatal(where, `원문 note "${rawNote}" 가 구조화되지 않았습니다(유실 — service/durationMinutes/unknownNote 중 하나 필요)`);
          return;
        }
        if (explained > 1) {
          fatal(
            where,
            `원문 note "${rawNote}" 에 없는 조건이 주입되었습니다 — 해석 결과(service=${String(serviceSet)}, duration=${String(durationSet)}, unknown=${String(unknownSet)})가 정확히 하나여야 합니다`,
          );
          return;
        }
        if (unknownSet) {
          if (condition.unknownNote !== rawNote) {
            fatal(`${where}.unknownNote`, `원문 표기를 변형했습니다 — 원문 "${rawNote}", 기록 "${String(condition.unknownNote)}"`);
          }
          if (condition.note !== rawNote) fatal(`${where}.note`, '미해석 항목은 note 를 원문 그대로 유지해야 합니다');
          if (condition.needsReview !== true) fatal(`${where}.needsReview`, '미해석 항목은 needsReview=true 여야 합니다');
          checkQuote(rawNote, '', where, context, fatal);
          return;
        }
        // 구조화된 항목 — note 는 비운다(중복 표현 금지)
        if (condition.note !== null) {
          fatal(`${where}.note`, `구조화된 항목의 note 는 null 이어야 합니다(중복 표현 금지) — 실제 ${JSON.stringify(condition.note)}`);
        }
        if (condition.needsReview === true) fatal(`${where}.needsReview`, '구조화된 항목은 needsReview=false 여야 합니다');
        if (durationSet) {
          const minutes = condition.durationMinutes as number;
          if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES) {
            fatal(`${where}.durationMinutes`, `1~${String(MAX_DURATION_MINUTES)} 정수가 아닙니다 — ${String(minutes)}`);
          }
        }
        const service = condition.service;
        if (service !== null) {
          const serviceQuote = service['sourceQuote'];
          const excluded = service['excludedDays'];
          const dayScope = service['dayScope'];
          const vehicleCount = service['vehicleCount'];
          const label = service['label'];
          if (typeof serviceQuote !== 'string' || serviceQuote.trim() === '') {
            fatal(`${where}.service.sourceQuote`, '원문 인용이 비었습니다');
          } else if (serviceQuote !== rawNote) {
            fatal(`${where}.service.sourceQuote`, `원문 표기를 변형했습니다 — 원문 "${rawNote}", 인용 "${serviceQuote}"`);
          } else {
            checkQuote(serviceQuote, '', `${where}.service`, context, fatal);
          }
          if (!checkWeekdayList(excluded)) fatal(`${where}.service.excludedDays`, '요일 코드 배열이 아닙니다');
          if (dayScope !== null && !checkWeekdayList(dayScope)) {
            fatal(`${where}.service.dayScope`, 'null 또는 요일 코드 배열이어야 합니다');
          }
          if (Array.isArray(dayScope) && dayScope.length === 0) fatal(`${where}.service.dayScope`, '빈 배열은 null 이어야 합니다');
          if (vehicleCount !== null && (typeof vehicleCount !== 'number' || !Number.isInteger(vehicleCount) || vehicleCount <= 0)) {
            fatal(`${where}.service.vehicleCount`, 'null 또는 양의 정수여야 합니다');
          }
          if (label !== null && (typeof label !== 'string' || label.trim() === '')) {
            fatal(`${where}.service.label`, 'null 또는 비어 있지 않은 문자열이어야 합니다');
          }
          const meaningful = (Array.isArray(excluded) && excluded.length > 0) || dayScope !== null || label !== null;
          if (!meaningful) fatal(`${where}.service`, '조건 값이 모두 비었습니다(원문을 설명하지 못함)');
        }
      });
    }
  });
}

/** terms[].periodSearch(v3) — 결과와 기간 필드가 **일치**해야 하고 근거 문장이 원문이어야 한다. */
function checkPeriodSearch(
  periodSearch: { readonly file: string; readonly result: string; readonly evidenceQuote: string | null } | null,
  start: string | null,
  end: string | null,
  where: string,
  context: ValidateContext,
  fatal: (where: string, message: string) => void,
): void {
  if (periodSearch === null) return;
  const { result, evidenceQuote, file } = periodSearch;
  if (result !== 'found' && result !== 'not-found' && result !== 'not-provided') {
    fatal(`${where}.result`, `알 수 없는 결과 "${String(result)}"`);
    return;
  }
  if (result === 'found') {
    if (start === null || end === null) fatal(where, 'periodSearch=found 인데 기간이 비었습니다');
  } else if (start !== null || end !== null) {
    fatal(where, `periodSearch=${result} 인데 기간이 채워졌습니다(추측 금지)`);
  }
  if (result === 'not-provided') {
    if (evidenceQuote !== null) fatal(`${where}.evidenceQuote`, 'not-provided 인데 근거 문장이 있습니다');
    return;
  }
  if (evidenceQuote === null || evidenceQuote.trim() === '') {
    fatal(`${where}.evidenceQuote`, '기간 판정 근거 문장이 없습니다(추측 금지 — 페이지 본문 인용 필요)');
    return;
  }
  checkQuote(evidenceQuote, file, `${where}.evidenceQuote`, context, fatal);
}

function requiredRuleFields(rule: DateRule): readonly (readonly [string, boolean])[] {
  const effect = (rule.effect ?? {}) as Record<string, unknown>;
  switch (rule.kind) {
    case 'no-service':
    case 'alternate-schedule':
      return [
        ['start', rule.start !== null],
        ['effect.appliesTo', typeof effect['appliesTo'] === 'string'],
      ];
    case 'route-change':
      return [['effect.statement', typeof effect['statement'] === 'string' && effect['statement'] !== '']];
    case 'stop-time-window':
      return [['effect.windows', Array.isArray(effect['windows']) && effect['windows'].length > 0]];
    case 'period-meaning':
      return [
        ['start', rule.start !== null],
        ['end', rule.end !== null],
      ];
    case 'term':
    case 'vacation':
      return [['effect.label', typeof effect['label'] === 'string']];
    default:
      return [];
  }
}

/** 인용 검증 대상 = 노선 스냅샷 + 기간 수집용 스냅샷(v3) */
function quotableSources(context: ValidateContext): readonly QuoteSource[] {
  return [...context.sources, ...(context.termSources ?? [])];
}

function checkQuote(
  quote: string,
  sourcePage: string,
  where: string,
  context: ValidateContext,
  fatal: (where: string, message: string) => void,
): void {
  if (quote.trim() === '') {
    fatal(where, 'sourceQuote 가 비었습니다');
    return;
  }
  const sources = quotableSources(context);
  const hit = findExactQuote(quote, sources);
  if (hit === null) {
    fatal(where, `인용 검증 실패 — 원본 스냅샷 어디에도 없는 문장이다: "${quote.slice(0, 80)}"`);
    return;
  }
  if (sourcePage !== '' && hit.file !== sourcePage) {
    // 같은 문장이 여러 페이지에 있으면 `sourcePage` 는 첫 등장 페이지여야 한다(결정적)
    const first = sources.find((source) => source.text.includes(quote));
    if (first !== undefined && first.file !== sourcePage) {
      fatal(`${where}.sourcePage`, `근거 페이지가 다릅니다 — 기대 ${first.file}, 실제 ${sourcePage}`);
    }
  }
}

function checkDateRange(
  start: string | null,
  end: string | null,
  where: string,
  fatal: (where: string, message: string) => void,
): void {
  if (start !== null && !DATE_PATTERN.test(start)) fatal(where, `YYYY-MM-DD 가 아닙니다 — "${start}"`);
  if (end !== null && !DATE_PATTERN.test(end)) fatal(where, `YYYY-MM-DD 가 아닙니다 — "${end}"`);
  if (start !== null && end !== null && start > end) fatal(where, `기간이 뒤집혔습니다(${start} > ${end})`);
}

/** 갭 6종 커버리지 — 산출물에서 **계산**한다(하드코딩 아님). */
export function computeGapCoverage(timetable: EnrichedTimetableBody): readonly {
  readonly gap: number;
  readonly name: string;
  readonly where: string;
  readonly count: number;
}[] {
  const countRules = (kind: DateRule['kind']): number => timetable.dateRules.filter((rule) => rule.kind === kind).length;
  const tripNotes = timetable.routes.reduce((total, route) => total + route.tripNotes.length, 0);
  const stopWindows = timetable.routes.reduce((total, route) => total + route.stopWindows.length, 0);
  const deduped = timetable.dateRules.reduce((total, rule) => total + (rule.mergedQuotes?.length ?? 0), 0);
  const yearInferred = timetable.dateRules.filter((rule) => rule.yearInferred).length;
  return [
    { gap: 1, name: '시점 조건부 운행 변경', where: 'dateRules[kind=route-change]', count: countRules('route-change') },
    { gap: 2, name: '방향별 소요시간', where: 'routes[].tripNotes[]', count: tripNotes },
    { gap: 3, name: '시간창 조건부 정차', where: 'dateRules[kind=stop-time-window] + routes[].stopWindows[]', count: countRules('stop-time-window') + stopWindows },
    { gap: 4, name: '방학/학기 시간표 구분', where: 'terms[]', count: timetable.terms.length },
    { gap: 5, name: '기간의 의미 연결', where: 'dateRules[kind=period-meaning]', count: countRules('period-meaning') },
    { gap: 6, name: '중복 공지 제거 + 연도 추론', where: 'notices 중복 제거 + dateRules[yearInferred]', count: deduped + yearInferred },
  ];
}

/** `needsReview` 로 표시된 항목 수(모니터링 지표 — docs/02 부록 A). v3: 편별 조건도 포함한다. */
export function countNeedsReview(timetable: EnrichedTimetableBody): number {
  let total = 0;
  for (const rule of timetable.dateRules) if (rule.needsReview) total += 1;
  for (const term of timetable.terms) if (term.needsReview) total += 1;
  for (const route of timetable.routes) {
    for (const note of route.tripNotes) if (note.needsReview) total += 1;
    for (const window of route.stopWindows) if (window.needsReview) total += 1;
    for (const dayType of DAY_TYPES) {
      for (const row of route.byDay[dayType]?.trips ?? []) {
        if (readCondition(row).needsReview === true) total += 1;
      }
    }
  }
  return total;
}
