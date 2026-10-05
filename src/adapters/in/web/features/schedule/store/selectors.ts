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
import {
  kstDayFromInstant,
  WEEKDAY_LABELS,
  type KstDay,
} from '../../../../../../domain/rules/kst';
import {
  DEFAULT_NEXT_DEPARTURE_COUNT,
  nextDepartures,
  type NextDeparture,
  type NextDepartureResult,
} from '../../../../../../domain/rules/nextDeparture';
import { resolveDayService, resolveTripService } from '../../../../../../domain/rules/serviceDay';
import { tripDepartureTime } from '../../../../../../domain/entities/Trip';
import type { DayType } from '../../../../../../domain/entities/DayType';
import {
  ageHours,
  ageHoursOfDate,
  formatAge,
  formatAgeOfDate,
  formatKstClockLabel,
  formatKstDate,
  formatKstDayLabel,
  formatKstInstant,
  formatRemaining,
} from '../../../shared/lib/format';
import type { Notice, TripRow } from '../types/contract';
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

/* ───────────────────────── V1 간편 홈 보드 (T12) ───────────────────────── */

/** 목록에 한 번에 보여줄 최대 편수 — 나머지는 "더 보기"로 접는다. */
export const BOARD_LIST_LIMIT = 12;
/**
 * 노선별로 도메인에서 받아올 다음 출발 개수.
 * 하루치(최대 42편)를 덮어 **오늘 남은 편수 집계가 정확**하도록 크게 잡는다(시각 계산은 도메인 몫).
 */
const BOARD_PER_ROUTE_FETCH = 64;
/** 카드(다음 출발)에 보여줄 상위 편수 — 승인 시안 V1 의 "상위 3편". */
const BOARD_TOP_COUNT = 3;

export type DirectionFilter = 'all' | 'out' | 'in';
/** `out` = 학교 → 역/터미널, `in` = 역/터미널 → 학교 */
export type DepartureDirection = 'out' | 'in';

/** 노선 통합 출발 1편 — 값은 도메인 `nextDepartures` 반환이 정본이다(화면 계산 금지). */
export interface DepartureEventView {
  readonly key: string;
  readonly routeId: string;
  readonly routeName: string;
  readonly direction: DepartureDirection;
  readonly directionLabel: string;
  /** 출발 시각 `HH:MM` (도메인) */
  readonly departure: string;
  /** 도착 시각(원본 표 값, 없으면 null) */
  readonly arrival: string | null;
  readonly dayLabel: string;
  readonly dayOffset: number;
  readonly departureAt: string;
  /** 남은 시간(분) — 도메인 값. 화면에서 다시 계산하지 않는다. */
  readonly remainingMinutes: number;
  /** 남은 시간 문구(`formatRemaining`) */
  readonly remaining: string;
  /** 원본 특이사항 + 도메인 주석(예: `금(X)`, `월~화 2대 운행`) */
  readonly notes: readonly string[];
  readonly dayType: DayType;
}

/** 최상단 공지 배너(V1 §2) — 문자열은 `resolveDayService` 결과에서만 만든다. */
export interface ServiceNoticeView {
  readonly kind: 'no-service' | 'alternate';
  readonly title: string;
  readonly detail: string;
}

export type BoardStatus = 'loading' | 'ready' | 'no-service' | 'empty';

export interface TodayBoardView {
  readonly status: BoardStatus;
  /** `10월 5일 (월) 21:52` — 주입된 clock 기준(60초 갱신) */
  readonly clockLabel: string;
  /** `2026-10-05 (월)` */
  readonly dateLabel: string;
  /** 달력 요일(탭·원본표가 쓰는 구분) */
  readonly calendarDayType: DayType;
  /** 안내문 대체가 반영된 **실제 적용** 시간표 구분(보드·편수 집계가 쓰는 구분) */
  readonly effectiveDayType: DayType;
  readonly notice: ServiceNoticeView | null;
  /** 방향 필터별 오늘 남은 편수 */
  readonly counts: Readonly<Record<DirectionFilter, number>>;
  /** 오늘 전체 편수(지난 편 포함 — 적용 시간표 기준) */
  readonly todayTotal: number;
  /** 필터 적용된 편(오늘 남은, 오늘 것이 없으면 다음 운행일) */
  readonly events: readonly DepartureEventView[];
  /** 카드용 상위 편(최대 3) */
  readonly next: readonly DepartureEventView[];
  /** 카드가 오늘 편인가(오늘 운행이 끝났으면 false → dayLabel 이 내일/모레) */
  readonly nextIsToday: boolean;
  /** 목록에 실제로 그리는 편(잘림) */
  readonly list: readonly DepartureEventView[];
  /** "더 보기"로 펼칠 나머지 */
  readonly rest: readonly DepartureEventView[];
  readonly hasMore: boolean;
  readonly listLimit: number;
  /** 원본 표기 중 해석하지 못한 항목 — 조용히 숨기지 않는다 */
  readonly warnings: readonly string[];
}

/**
 * 최상단 공지 배너 — `resolveDayService(kstDay(now), notices)` 결과만 사용한다.
 * ① 운행 없음 ② 대체 시간표. 둘 다 아니면 `null`(배너 없음).
 */
export function serviceNoticeView(state: ScheduleState): ServiceNoticeView | null {
  const model = state.model;
  if (model === null) return null;
  return serviceNoticeOf(kstDayFromInstant(new Date(state.nowMs)), model);
}

function serviceNoticeOf(day: KstDay, model: TimetableModel): ServiceNoticeView | null {
  const status = resolveDayService(day, model.schedule.notices);
  if (!status.serviceOn) {
    return {
      kind: 'no-service',
      title: UI_TEXT.serviceNoServiceTitle,
      detail: `${UI_TEXT.serviceReasonPrefix}: ${status.reason ?? status.date}`,
    };
  }
  if (status.overrideNotice !== null) {
    return {
      kind: 'alternate',
      title: `${dayTypeLabel(status.effectiveDayType)} ${UI_TEXT.serviceAlternateSuffix}`,
      detail: status.overrideNotice.text,
    };
  }
  return null;
}

/**
 * V1 홈 보드 — 주입된 clock 기준으로 노선을 통합해 다음 출발·오늘 남은 출발을 만든다.
 * - 다음 출발 값은 노선별 `nextDepartures` 반환을 **합쳐 정렬**한 것이다(새 계산 금지).
 * - 지난 회차는 도메인이 이미 제외한다(`ok` 결과에 없다).
 * - 오늘 남은 편이 없으면(운행 종료) 카드·목록이 **다음 운행일**(`내일`/`모레`)로 넘어간다.
 */
export function todayBoardView(state: ScheduleState, filter: DirectionFilter = 'all'): TodayBoardView {
  const now = new Date(state.nowMs);
  const day = kstDayFromInstant(now);
  const calendarDayType = dayTypeFromDate(now);
  const base = {
    clockLabel: formatKstClockLabel(state.nowMs),
    dateLabel: formatKstDayLabel(state.nowMs),
    calendarDayType,
    listLimit: BOARD_LIST_LIMIT,
  } as const;

  const model = state.model;
  if (model === null) {
    return {
      ...base,
      status: 'loading',
      effectiveDayType: calendarDayType,
      notice: null,
      counts: { all: 0, out: 0, in: 0 },
      todayTotal: 0,
      events: [],
      next: [],
      nextIsToday: true,
      list: [],
      rest: [],
      hasMore: false,
      warnings: [],
    };
  }

  const service = resolveDayService(day, model.schedule.notices);
  const warnings = new Set<string>();
  const upcoming: DepartureEventView[] = [];
  for (const route of model.routes) {
    // 운행 중단 노선은 안내 대상이 아니다(상태·사유는 원본 패널이 보여준다).
    if (route.status === 'suspended') continue;
    const result = nextDepartures({
      schedule: model.schedule,
      routeId: route.id,
      clock: { now: () => new Date(state.nowMs) },
      count: BOARD_PER_ROUTE_FETCH,
    });
    if (!('departures' in result)) continue;
    for (const warning of result.warnings) warnings.add(warning);
    for (const departure of result.departures) upcoming.push(departureEvent(route, departure));
  }
  upcoming.sort(compareEvents);

  const todayEvents = upcoming.filter((event) => event.dayOffset === 0);
  // 오늘 남은 편이 하나도 없으면(운행 종료·운행 없는 날) **다음 운행일 하루**만 안내한다(V1 §8).
  // (도메인은 다음 운행일 편을 함께 실어 주므로, 그중 가장 가까운 날짜로 좁힌다.)
  const nextOffset = upcoming.at(0)?.dayOffset ?? 0;
  const pool = todayEvents.length > 0 ? todayEvents : upcoming.filter((event) => event.dayOffset === nextOffset);
  const filtered = filter === 'all' ? pool : pool.filter((event) => event.direction === filter);
  const list = filtered.slice(0, BOARD_LIST_LIMIT);

  return {
    ...base,
    status: !service.serviceOn ? 'no-service' : upcoming.length === 0 ? 'empty' : 'ready',
    effectiveDayType: service.effectiveDayType,
    notice: serviceNoticeOf(day, model),
    counts: {
      all: todayEvents.length,
      out: todayEvents.filter((event) => event.direction === 'out').length,
      in: todayEvents.filter((event) => event.direction === 'in').length,
    },
    todayTotal: service.serviceOn ? countServiceTrips(model, day, service.effectiveDayType) : 0,
    events: filtered,
    next: filtered.slice(0, BOARD_TOP_COUNT),
    nextIsToday: todayEvents.length > 0,
    list,
    rest: filtered.slice(BOARD_LIST_LIMIT),
    hasMore: filtered.length > list.length,
    warnings: [...warnings],
  };
}

/** 도메인 반환 1편 + 원본 행(방향·도착·특이사항) → 화면 값. */
function departureEvent(route: RouteView, departure: NextDeparture): DepartureEventView {
  const table: DayTableView | null = route.byDay[departure.dayType];
  const row = findTripRow(table, departure);
  // 방향 판정은 도메인 `tripDepartureTime`(= depCampus ?? depStation) 규칙과 같은 축을 쓴다:
  // 캠퍼스 출발이 있으면 학교에서 출발(out), 없으면 역/터미널 출발(in).
  const direction: DepartureDirection = cellText(row, ['depCampus']) === null ? 'in' : 'out';
  const arrival =
    direction === 'out' ? cellText(row, ['depStation', 'depTerminal']) : cellText(row, ['arrCampus']);
  return {
    key: `${route.id}:${departure.date}:${String(departure.seq)}`,
    routeId: route.id,
    routeName: route.name,
    direction,
    directionLabel: direction === 'out' ? UI_TEXT.boardDirectionOut : UI_TEXT.boardDirectionIn,
    departure: departure.departure,
    arrival,
    dayLabel: departure.dayLabel,
    dayOffset: departure.dayOffset,
    departureAt: departure.departureAt,
    remainingMinutes: departure.remainingMinutes,
    remaining: formatRemaining(departure.remainingSeconds),
    notes: uniqueNotes([...rawNotes(row), ...departure.annotations]),
    dayType: departure.dayType,
  };
}

/** 그 요일 표에서 회차 행을 찾는다 — 순번 우선, 없으면 출발 시각으로 되짚는다. */
function findTripRow(table: DayTableView | null, departure: NextDeparture): TripRow | null {
  if (table === null) return null;
  for (const row of table.rows) {
    if (Number(row['seq']) === departure.seq) return row;
  }
  for (const row of table.rows) {
    if (cellText(row, ['depCampus', 'depStation', 'depTerminal']) === departure.departure) return row;
  }
  return null;
}

/** 원시 셀 값(문자열·숫자·null) → 문자열. 빈 값은 null(없는 값과 같게 다루지 않는다). */
function cellText(row: TripRow | null, keys: readonly string[]): string | null {
  if (row === null) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function rawNotes(row: TripRow | null): readonly string[] {
  const note = cellText(row, ['note']);
  return note === null ? [] : [note];
}

function uniqueNotes(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (text !== '' && !out.includes(text)) out.push(text);
  }
  return out;
}

/** 출발 시각 오름차순(같으면 노선 id) — 노선 통합 정렬의 단일 기준. */
function compareEvents(a: DepartureEventView, b: DepartureEventView): number {
  if (a.departureAt !== b.departureAt) return a.departureAt < b.departureAt ? -1 : 1;
  if (a.routeId !== b.routeId) return a.routeId < b.routeId ? -1 : 1;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

/**
 * 적용 시간표(effective dayType)의 오늘 안내 대상 회차 수 — 원본 표를 **도메인 규칙으로만** 센다.
 * 화면에 "총 N편"을 숫자로 보여주기 위한 값(대체휴일이면 일요일 편수가 나온다).
 */
function countServiceTrips(model: TimetableModel, day: KstDay, dayType: DayType): number {
  let total = 0;
  for (const route of model.schedule.routes) {
    for (const trip of route.byDay[dayType] ?? []) {
      if (tripDepartureTime(trip) === null) continue;
      if (!resolveTripService(trip, day).runs) continue;
      total += 1;
    }
  }
  return total;
}
