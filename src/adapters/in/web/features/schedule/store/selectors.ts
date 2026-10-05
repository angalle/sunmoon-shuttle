/**
 * 파생 뷰 (features/schedule/store/selectors) — 상태 → 화면이 그릴 값. **모든 순수 함수**.
 *
 * 이 파일이 "도메인 상태 → 화면 문구" 매핑표의 구현이다(수용 기준 · .session-notes/T5-증거.md 표).
 * 요일·시각·운행 판정은 도메인만 계산한다:
 *  - 요일:        `dayTypeFromDate` / `dayTypeLabel` (domain/rules/dayType)
 *  - 다음 출발:   `nextDepartures`            (domain/rules/nextDeparture)
 *  - 표시 문자열: shared/lib/format (KST 변환은 domain/rules/kst 사용)
 */
import { dayTypeFromDate, dayTypeLabel } from '../../../../../../domain/rules/dayType';
import { WEEKDAY_LABELS } from '../../../../../../domain/rules/kst';
import {
  DEFAULT_NEXT_DEPARTURE_COUNT,
  nextDepartures,
  type NextDeparture,
  type NextDepartureResult,
} from '../../../../../../domain/rules/nextDeparture';
import {
  ageHours,
  ageHoursOfDate,
  formatAge,
  formatAgeOfDate,
  formatKstDate,
  formatKstInstant,
  formatRemaining,
} from '../../../shared/lib/format';
import type { Notice } from '../types/contract';
import type { DayTableView, RouteView, TimetableModel } from '../types/model';
import { DAY_TAB_LABEL, UI_TEXT } from '../types/texts';
import type { ScheduleState } from './scheduleStore';

/** 48시간 — 신선도 경고 기준(docs/00 F5 · 카드 지시) */
export const STALE_AFTER_HOURS = 48;

/* ───────────────────────── 요일 탭 ───────────────────────── */

export interface DayTabView {
  readonly dayType: 'weekday' | 'saturday' | 'sunday';
  readonly label: string;
  readonly isToday: boolean;
  /** 그 요일에 표가 있는 노선 수 — "주말은 노선이 3개뿐" 을 탭에서 바로 보이게 */
  readonly routesWithTable: number;
  readonly routeTotal: number;
}

function todayDayTypeOf(nowMs: number): 'weekday' | 'saturday' | 'sunday' {
  return dayTypeFromDate(new Date(nowMs));
}

export function dayTabs(state: ScheduleState): readonly DayTabView[] {
  const model = state.model;
  if (model === null) return [];
  const today = todayDayTypeOf(state.nowMs);
  return (['weekday', 'saturday', 'sunday'] as const).map((dayType) => {
    const routesWithTable = model.routes.filter(
      (route) => route.status === 'active' && route.byDay[dayType] !== null,
    ).length;
    return {
      dayType,
      label: DAY_TAB_LABEL[dayType],
      isToday: dayType === today,
      routesWithTable,
      routeTotal: model.routes.length,
    };
  });
}

/** 모델 로딩 전에도 탭을 그릴 수 있게(로딩 중에도 요일 탭은 보인다). */
export function dayTabsWithoutModel(nowMs: number, dayTypes: readonly ('weekday' | 'saturday' | 'sunday')[]): readonly DayTabView[] {
  const today = todayDayTypeOf(nowMs);
  return dayTypes.map((dayType) => ({
    dayType,
    label: DAY_TAB_LABEL[dayType],
    isToday: dayType === today,
    routesWithTable: 0,
    routeTotal: 0,
  }));
}

/* ───────────────────────── 선택 ───────────────────────── */

export function selectedRoute(state: ScheduleState): RouteView | null {
  const model = state.model;
  if (model === null || state.routeId === null) return null;
  return model.routes.find((route) => route.id === state.routeId) ?? null;
}

export function selectedDayTable(state: ScheduleState): DayTableView | null {
  const route = selectedRoute(state);
  if (route === null) return null;
  return route.byDay[state.dayType] ?? null;
}

/* ───────────────────────── 다음 버스 카드 ───────────────────────── */

export type NextBusTone = 'ok' | 'warn' | 'danger' | 'info';

export interface DepartureRowView {
  readonly seq: number;
  readonly dayLabel: string;
  readonly departure: string;
  readonly remaining: string;
  readonly annotations: readonly string[];
  readonly isFirst: boolean;
}

export interface NextBusView {
  readonly tone: NextBusTone;
  readonly title: string;
  readonly subtitle: string | null;
  /** 원본 안내문 원문 — 있으면 **제목보다 먼저** 보여준다(운행 없음 사유 등) */
  readonly reason: string | null;
  readonly detail: string | null;
  readonly departures: readonly DepartureRowView[];
  readonly warnings: readonly string[];
  /** 도메인 status 문자열(증거·테스트용, 화면에는 문구로만 노출) */
  readonly domainStatus: NextDepartureResult['status'] | 'suspended-route' | 'no-data-table' | 'no-route-selected';
}

export function nextBusView(state: ScheduleState): NextBusView {
  const route = selectedRoute(state);
  if (route === null) {
    return {
      tone: 'info',
      title: UI_TEXT.loading,
      subtitle: null,
      reason: null,
      detail: null,
      departures: [],
      warnings: [],
      domainStatus: 'no-route-selected',
    };
  }

  // F2b — 운행 중단 노선은 목록에서 조용히 숨기지 않고 상태·원문 문구를 보여준다.
  if (route.status === 'suspended') {
    return {
      tone: 'warn',
      title: UI_TEXT.nextBusSuspendedTitle,
      subtitle: `${route.name} · ${dayTypeLabel(state.dayType)}`,
      reason: route.suspendedReason,
      detail: UI_TEXT.nextBusSuspendedDetail,
      departures: [],
      warnings: [],
      domainStatus: 'suspended-route',
    };
  }

  const table = selectedDayTable(state);
  if (table === null) {
    return {
      tone: 'info',
      title: `${dayTypeLabel(state.dayType)} 시간표가 이 노선에 없습니다`,
      subtitle: route.name,
      reason: null,
      detail: '원본에 이 노선의 해당 요일 페이지가 없습니다. 다른 요일 탭이나 다른 노선을 선택해 주세요.',
      departures: [],
      warnings: [],
      domainStatus: 'no-data-table',
    };
  }

  const result = nextDepartures({
    schedule: state.model?.schedule ?? { ...EMPTY_SCHEDULE },
    routeId: route.id,
    clock: { now: () => new Date(state.nowMs) },
    count: DEFAULT_NEXT_DEPARTURE_COUNT,
  });

  return mapDomainResult(result, state);
}

function mapDomainResult(result: NextDepartureResult, state: ScheduleState): NextBusView {
  const rawDepartures: readonly NextDeparture[] = 'departures' in result ? result.departures : [];
  const departures = rawDepartures.map(toRowView);
  const warnings = result.status === 'unknown-route' ? [] : [...result.warnings];

  if (result.status === 'ok') {
    const first = result.departures.at(0);
    return {
      tone: 'ok',
      title: first === undefined ? UI_TEXT.nextBusEmptyTitle : `${first.dayLabel} ${first.departure} 출발`,
      subtitle: first === undefined ? null : formatRemaining(first.remainingSeconds),
      reason: null,
      detail: first === null || first === undefined ? null : `${routeDayNote(state)}`,
      departures,
      warnings,
      domainStatus: 'ok',
    };
  }

  if (result.status === 'no-service-today') {
    const next = result.departures.at(0);
    return {
      tone: 'warn',
      title: UI_TEXT.nextBusNoServiceTitle,
      subtitle: `${UI_TEXT.nextBusNoServiceNextPrefix}: ${
        next === undefined ? UI_TEXT.nextBusNoServiceNone : `${next.dayLabel} ${next.departure}`
      }`,
      // 사유(안내문 원문)를 **먼저** 보여준다(카드 지시 ③)
      reason: result.reason,
      detail: next === undefined ? null : `남은 시간 ${formatRemaining(next.remainingSeconds)}`,
      departures,
      warnings,
      domainStatus: 'no-service-today',
    };
  }

  if (result.status === 'empty-schedule') {
    return {
      tone: 'info',
      title: UI_TEXT.nextBusEmptyTitle,
      subtitle: result.reason,
      reason: null,
      detail: UI_TEXT.nextBusEmptyDetail,
      departures,
      warnings,
      domainStatus: 'empty-schedule',
    };
  }

  return {
    tone: 'danger',
    title: UI_TEXT.nextBusUnknownRouteTitle,
    subtitle: `요청한 노선 id: ${result.routeId}`,
    reason: null,
    detail: `${UI_TEXT.nextBusUnknownRouteDetail} 등록된 노선: ${result.knownRouteIds.join(', ')}`,
    departures,
    warnings,
    domainStatus: 'unknown-route',
  };
}

function routeDayNote(state: ScheduleState): string {
  return `${dayTypeLabel(state.dayType)} 시간표 기준 · ${state.model?.semester.label ?? ''}`.trim();
}

function toRowView(departure: NextDeparture, index: number): DepartureRowView {
  return {
    seq: departure.seq,
    dayLabel: departure.dayLabel,
    departure: departure.departure,
    remaining: formatRemaining(departure.remainingSeconds),
    annotations: departure.annotations,
    isFirst: index === 0,
  };
}

/** 도메인 입력 최소 골격(모델이 아직 없을 때만 쓰인다 — 정상 경로에서는 사용되지 않는다). */
const EMPTY_SCHEDULE = {
  schemaVersion: 1,
  source: { url: '', sourceUpdatedAt: '', fetchedAt: '', contentHash: '' },
  semester: { label: '', startsOn: '', endsOn: '' },
  dayTypes: ['weekday', 'saturday', 'sunday'] as const,
  routes: [],
  notices: [],
} as const;

/* ───────────────────────── 신선도 ───────────────────────── */

export interface FreshnessRowView {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly age: string;
  readonly stale: boolean;
}

export interface PageFreshnessView {
  readonly routeId: string;
  readonly dayLabel: string;
  readonly url: string;
  readonly sourceUpdatedAt: string;
  readonly age: string;
  readonly stale: boolean;
}

export interface FreshnessView {
  readonly rows: readonly FreshnessRowView[];
  readonly warnings: readonly string[];
  readonly pages: readonly PageFreshnessView[];
}

export function freshnessView(model: TimetableModel, nowMs: number): FreshnessView {
  const source = model.source;
  const fetchedAge = ageHours(source.fetchedAt, nowMs);
  const sourceAge = ageHoursOfDate(source.sourceUpdatedAt, nowMs);
  const fetchedStale = fetchedAge !== null && fetchedAge > STALE_AFTER_HOURS;
  const sourceStale = sourceAge !== null && sourceAge > STALE_AFTER_HOURS;

  const rows: FreshnessRowView[] = [
    {
      key: 'source-updated-at',
      label: UI_TEXT.freshnessSourceUpdatedLabel,
      value: formatKstDate(source.sourceUpdatedAt, WEEKDAY_LABELS),
      age: formatAgeOfDate(source.sourceUpdatedAt, nowMs),
      stale: sourceStale,
    },
    {
      key: 'fetched-at',
      label: UI_TEXT.freshnessFetchedLabel,
      value: formatKstInstant(source.fetchedAt),
      age: formatAge(source.fetchedAt, nowMs),
      stale: fetchedStale,
    },
  ];

  const warnings: string[] = [];
  if (fetchedStale) {
    warnings.push(`${UI_TEXT.freshnessFetchedLabel}: ${formatAge(source.fetchedAt, nowMs)} — ${UI_TEXT.freshnessStaleWarn}`);
  }
  if (sourceStale) {
    warnings.push(
      `${UI_TEXT.freshnessSourceUpdatedLabel}: ${source.sourceUpdatedAt} (${formatAgeOfDate(source.sourceUpdatedAt, nowMs)}) — ${UI_TEXT.freshnessStaleWarn}`,
    );
  }

  const pages: PageFreshnessView[] = source.pages.map((page) => {
    const age = ageHoursOfDate(page.sourceUpdatedAt, nowMs);
    return {
      routeId: page.routeId,
      dayLabel: DAY_TAB_LABEL[page.dayType],
      url: page.url,
      sourceUpdatedAt: page.sourceUpdatedAt,
      age: formatAgeOfDate(page.sourceUpdatedAt, nowMs),
      stale: age !== null && age > STALE_AFTER_HOURS,
    };
  });

  return { rows, warnings, pages };
}

/* ───────────────────────── 안내문 ───────────────────────── */

export interface NoticeView {
  /** 원본 문구 그대로(기간 표기 포함 — `raw` 가 있으면 그것을 쓴다) */
  readonly text: string;
  readonly dateRange: string | null;
  readonly kind: Notice['kind'];
}

export interface NoticeGroupsView {
  readonly noService: readonly NoticeView[];
  readonly alternate: readonly NoticeView[];
  readonly notices: readonly NoticeView[];
}

export function noticeGroups(model: TimetableModel): NoticeGroupsView {
  const noService: NoticeView[] = [];
  const alternate: NoticeView[] = [];
  const notices: NoticeView[] = [];
  for (const notice of model.notices) {
    const view: NoticeView = {
      text: notice.raw ?? notice.text,
      dateRange: notice.date === undefined ? null : `${notice.date}${notice.endDate === undefined ? '' : ` ~ ${notice.endDate}`}`,
      kind: notice.kind,
    };
    if (notice.kind === 'no-service') noService.push(view);
    else if (notice.kind === 'alternate-schedule') alternate.push(view);
    else notices.push(view);
  }
  return { noService, alternate, notices };
}
