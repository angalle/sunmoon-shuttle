/**
 * 파생 뷰 (features/schedule/store/selectors) — 상태 → 화면이 그릴 값. **모든 순수 함수**.
 *
 * 이 파일이 "도메인 상태 → 화면 문구" 매핑표의 구현이다(수용 기준 · .session-notes/T5-증거.md 표).
 * 요일·시각·운행 판정은 도메인만 계산한다:
 *  - 요일:        `dayTypeFromDate` / `dayTypeLabel` (domain/rules/dayType)
 *  - 다음 출발:   `nextDepartures`            (domain/rules/nextDeparture)
 *  - 표시 문자열: shared/lib/format (KST 변환은 domain/rules/kst 사용)
 */
import { dayTypeFromDate, dayTypeFromWeekday, dayTypeLabel } from '../../../../../../domain/rules/dayType';
import { addKstDays, formatIsoDate, kstDayFromInstant, kstInstantOf, parseHhMm, type KstDay } from '../../../../../../domain/rules/kst';
import { isDayType, type DayType, type WeekdayCode } from '../../../../../../domain/entities/DayType';
import {
  DEFAULT_NEXT_DEPARTURE_COUNT,
  nextDepartures,
  type NextDeparture,
  type NextDepartureResult,
} from '../../../../../../domain/rules/nextDeparture';
import { resolveDayService, resolveTripService } from '../../../../../../domain/rules/serviceDay';
import { tripStatus, type TripStatus, type TripStatusContext } from '../../../../../../domain/rules/tripStatus';
import { tripDepartureTime, type Trip } from '../../../../../../domain/entities/Trip';
import {
  ageHours,
  formatAge,
  formatKstClockLabel,
  formatKstDayLabel,
  formatKstInstant,
  formatMonthDayWeekday,
  formatRemaining,
} from '../../../shared/lib/format';
import type { Notice, TripRow } from '../types/contract';
import type { DateRuleView, DayTableView, RouteView, TimetableModel } from '../types/model';
import { DAY_TAB_LABEL, UI_TEXT, WEEKDAY_CODE_LABEL } from '../types/texts';
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

/* ───────────────────────── 데이터 갱신 (T14 간소화) ───────────────────────── */

/**
 * 신선도 뷰(T14) — 예전에는 ①학교 페이지 최근 업데이트 ②우리 반영 시각 **2행 + 페이지별 상세**를
 * 보여줬지만, 이제는 앱 기준 **한 줄**(`데이터 갱신: <반영 시각> (<경과>)`)만 만든다.
 * 48시간 초과 판정은 그대로 남겨 색이 아니라 문구로 알린다(경고를 숨기지 않는다).
 */
export interface FreshnessView {
  /** `데이터 갱신: 2026-10-05 14:39 (KST) (3시간 전)` — 화면에 그대로 쓰는 한 줄 */
  readonly line: string;
  readonly label: string;
  readonly value: string;
  readonly age: string;
  readonly stale: boolean;
  readonly warning: string | null;
}

export function freshnessView(model: TimetableModel, nowMs: number): FreshnessView {
  const source = model.source;
  const fetchedAge = ageHours(source.fetchedAt, nowMs);
  const stale = fetchedAge !== null && fetchedAge > STALE_AFTER_HOURS;
  const value = formatKstInstant(source.fetchedAt);
  const age = formatAge(source.fetchedAt, nowMs);
  return {
    label: UI_TEXT.freshnessFetchedLabel,
    value,
    age,
    stale,
    line: `${UI_TEXT.freshnessFetchedLabel}: ${value} (${age})`,
    warning: stale ? `${UI_TEXT.freshnessFetchedLabel}: ${age} — ${UI_TEXT.freshnessStaleWarn}` : null,
  };
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

/* ─────────────── v2: 다가오는 운행 변동 · 방학 · 정차 창 (T17) ───────────────
 * 값은 전부 schema v2 데이터(`dateRules[]`·`terms[]`·`stopWindows[]`)에서만 온다.
 * 여기서 하는 일은 **표시를 위한 날짜 창 필터**(오늘 ~ +14일)와 문구 조립뿐이다 —
 * 날짜·기간의 해석(연도 추론·기간의 의미·중복 통합)은 T16 산출물(JSON)이 이미 끝냈고 앱은 다시 판정하지 않는다.
 * `needsReview=true` 항목은 **내부 플래그**라 화면에 올리지 않는다(태스크 ⑥ · 로그·검증 전용).
 */

/** 다가오는 변동을 안내하는 창(일) — 태스크 지시: 오늘 이후 14일 내 */
export const UPCOMING_RULE_WINDOW_DAYS = 14;
/** 홈 상단에 올리는 최대 줄 수 — 넘치면 가까운 날짜부터 2줄만 남긴다(지시 ①) */
export const UPCOMING_RULE_LINE_LIMIT = 2;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface UpcomingChangeView {
  readonly key: string;
  readonly kind: 'no-service' | 'alternate-schedule';
  /** `10월 9일 (금)` · 기간 규칙이면 `9월 24일 (목) ~ 9월 26일 (토)` */
  readonly dateText: string;
  /** 데이터에서 뽑은 표기 이름(예 `한글날`) — 못 뽑았으면 null */
  readonly label: string | null;
  /** `운행 없음` · `일요일 시간표로 운행` */
  readonly statusText: string;
  /** 화면에 그대로 쓰는 한 줄 — `10월 9일 (금) 한글날 — 운행 없음` */
  readonly text: string;
}

export interface UpcomingChangesView {
  readonly lines: readonly UpcomingChangeView[];
  /** 창 안의 규칙 수(잘린 것 포함) */
  readonly total: number;
  /** 2줄 상한을 넘어 화면에 없는 수 */
  readonly hiddenCount: number;
}

/**
 * 홈 상단 "다가오는 운행 변동"(지시 ①) — `dateRules[]` 중 오늘 이후 14일 내 `no-service`·
 * `alternate-schedule` 을 가까운 순서로 **최대 2줄**.
 * 오늘이 포함된 규칙은 상단 배너(`serviceNoticeView` → `resolveDayService`)가 우선이므로 여기서 뺀다
 * (지시 ② — 같은 날 두 번 말하지 않는다).
 */
export function upcomingChanges(state: ScheduleState): UpcomingChangesView {
  const model = state.model;
  if (model === null) return { lines: [], total: 0, hiddenCount: 0 };
  const today = kstDayFromInstant(new Date(state.nowMs));
  const todayIso = formatIsoDate(today);
  const windowEndIso = formatIsoDate(addKstDays(today, UPCOMING_RULE_WINDOW_DAYS));
  const relevant = model.dateRules
    .filter((rule) => isUpcomingRule(rule, todayIso, windowEndIso))
    .sort(compareDateRules);
  return {
    lines: relevant.slice(0, UPCOMING_RULE_LINE_LIMIT).map(toUpcomingChangeView),
    total: relevant.length,
    hiddenCount: Math.max(0, relevant.length - UPCOMING_RULE_LINE_LIMIT),
  };
}

/** 안내 대상 규칙인가 — ① kind ② needsReview 제외 ③ 오늘은 배너 담당(중복 금지) ④ 14일 창 안 */
function isUpcomingRule(rule: DateRuleView, todayIso: string, windowEndIso: string): boolean {
  if (rule.kind !== 'no-service' && rule.kind !== 'alternate-schedule') return false;
  if (rule.needsReview) return false;
  if (rule.start === null || !ISO_DATE.test(rule.start)) return false;
  const end = rule.end !== null && ISO_DATE.test(rule.end) ? rule.end : rule.start;
  if (end < todayIso) return false;
  if (rule.start <= todayIso && todayIso <= end) return false;
  return rule.start <= windowEndIso;
}

/** 가까운 날짜 → 기간 끝 → kind 순(`YYYY-MM-DD` 는 문자열 비교가 곧 날짜 비교다). */
function compareDateRules(a: DateRuleView, b: DateRuleView): number {
  const aStart = a.start ?? '';
  const bStart = b.start ?? '';
  if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  const aEnd = a.end ?? '';
  const bEnd = b.end ?? '';
  if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return (a.label ?? '') < (b.label ?? '') ? -1 : 1;
}

function toUpcomingChangeView(rule: DateRuleView): UpcomingChangeView {
  const start = rule.start ?? '';
  const end = rule.end;
  const dateText =
    end === null || end === start
      ? formatMonthDayWeekday(start)
      : `${formatMonthDayWeekday(start)} ~ ${formatMonthDayWeekday(end)}`;
  const statusText = ruleStatusText(rule);
  const namePart = rule.label === null ? '' : ` ${rule.label}`;
  return {
    key: `${rule.kind}:${start}:${end ?? ''}`,
    kind: rule.kind === 'no-service' ? 'no-service' : 'alternate-schedule',
    dateText,
    label: rule.label,
    statusText,
    text: `${dateText}${namePart} — ${statusText}`,
  };
}

/** 상태 문구 — 대체 시간표는 `effect.timetable`(예 `sunday`)을 요일 라벨로 옮겨 만든다(데이터에서만). */
function ruleStatusText(rule: DateRuleView): string {
  if (rule.kind === 'no-service') return UI_TEXT.upcomingNoService;
  const timetable = rule.effect['timetable'];
  if (isDayType(timetable)) return `${dayTypeLabel(timetable)} ${UI_TEXT.upcomingAlternateSuffix}`;
  return UI_TEXT.upcomingAlternateFallback;
}

export interface VacationView {
  /** 데이터의 기간 이름(예 `방학`) */
  readonly label: string;
  /** 배너 1줄 — `<기간 이름> — 방학 기간입니다` */
  readonly text: string;
  /** 그 기간에 적용되는 시간표 페이지(원본에 없으면 null → 링크를 그리지 않는다) */
  readonly sourceUrl: string | null;
  readonly sourceLabel: string;
}

/**
 * 오늘이 **방학 기간**인가(`terms[]`, 지시 ⑤).
 * 시작·끝이 **모두 있고**(기간 미상 항목은 판단하지 않는다 — 추측 금지) `needsReview` 가 아닌 항목만 본다.
 * 해당 기간이 없으면 아무것도 표시하지 않는다(null). 링크는 `timetableSource` 가 있을 때만 그린다.
 */
export function vacationNotice(state: ScheduleState): VacationView | null {
  const model = state.model;
  if (model === null) return null;
  const todayIso = formatIsoDate(kstDayFromInstant(new Date(state.nowMs)));
  for (const term of model.terms) {
    if (term.kind !== 'vacation') continue;
    if (term.needsReview) continue;
    if (term.start === null || term.end === null) continue;
    if (!ISO_DATE.test(term.start) || !ISO_DATE.test(term.end)) continue;
    if (term.start <= todayIso && todayIso <= term.end) {
      return {
        label: term.label,
        text: `${term.label} — ${UI_TEXT.vacationTitle}`,
        sourceUrl: term.timetableSource,
        sourceLabel: UI_TEXT.vacationSourceLinkLabel,
      };
    }
  }
  return null;
}

export interface StopWindowLineView {
  readonly key: string;
  /** 화면에 그대로 쓰는 한 줄 — `학생회관 승강장 (학기 중): 13:30~15:30 · 19:30~막차까지` */
  readonly text: string;
}

/**
 * 정차 시간창(`routes[].stopWindows[]`, 지시 ④) — 도착 옆 한 줄이 아니라 **접힘 1개**에 모아 보여준다
 * (홈 본문은 심플하게 유지). 여러 노선이 같은 원본 문장을 공유하므로 같은 문구는 한 줄로 합친다.
 * 표기는 데이터의 `windows[].raw`(원문 그대로)를 쓴다.
 */
export function stopWindowLines(model: TimetableModel): readonly StopWindowLineView[] {
  const out: StopWindowLineView[] = [];
  const seen = new Set<string>();
  for (const route of model.routes) {
    for (const stopWindow of route.stopWindows) {
      if (stopWindow.needsReview) continue;
      const times = stopWindow.windows.map((window) => window.raw).filter((raw) => raw.trim() !== '');
      if (times.length === 0) continue;
      const location =
        stopWindow.term === null ? stopWindow.location : `${stopWindow.location} (${stopWindow.term})`;
      const text = `${location}: ${times.join(' · ')}`;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ key: text, text });
    }
  }
  return out;
}

/* ───────────────────────── V1 간편 홈 보드 (T12) ───────────────────────── */

/** 목록에 한 번에 보여줄 최대 편수 — 나머지는 "더 보기"로 접는다. (T13: 12 → 5, 더 심플하게) */
export const BOARD_LIST_LIMIT = 5;
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
  /**
   * 방향별 소요시간 보조 문구(`약 15분 소요`) — `routes[].tripNotes[]` 의 **조건 없는** 소요시간만.
   * 조건부(예 `교통정체` 08:00~9:00)는 적용 시각 판정이 필요해 앱이 고르지 않고 **표시하지 않는다**(null).
   */
  readonly durationNote: string | null;
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

/**
 * 목록 영역 머리 문구 종류(T13) — 문구 결정은 여기(도메인 값 기반)에서만 하고 컴포넌트는 그리기만 한다.
 * - `no-service`: 운행 없는 날. **"끝났습니다"를 쓰지 않는다**(상단 배너와 충돌).
 * - `today-over` : 운행은 했지만 오늘 편이 다 지난 경우 → 다음 운행일 안내.
 */
export type BoardHeadlineKind = 'loading' | 'no-service' | 'today-over' | 'empty';

export interface TodayBoardView {
  readonly status: BoardStatus;
  /** 목록 영역 머리 문구(없으면 null) — 값은 도메인 판정 결과에서만 만든다. */
  readonly listHeadline: string | null;
  readonly listHeadlineKind: BoardHeadlineKind | null;
  /** 목록 행을 그릴지 — 운행 없는 날/빈 목록은 숨기고 머리 문구만 남긴다. */
  readonly listVisible: boolean;
  /**
   * 방향 필터 칩을 보여줄지 — **오늘 남은 편이 있을 때만**.
   * 운행 없는 날·오늘 종료 뒤에는 모든 칩이 `0편`이라 정보가 아니라 소음이다(T13 심플화).
   */
  readonly directionFilterVisible: boolean;
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
  /** 원본 표기 중 해석하지 못한 항목 — 조용히 숨기지 않는다(내부 값·증거용) */
  readonly warnings: readonly string[];
  /** 미해석 항목 수(= `warnings.length`) */
  readonly warningsCount: number;
  /**
   * 홈에 두는 **안내 1줄**(없으면 null, T14) — 사용자 판단에 영향을 주는 경고
   * (회차가 목록에서 빠질 수 있음)만 센다. 주석성 표기는 세지 않는다.
   */
  readonly warningsNoticeCount: number;
  /** 위 개수의 안내 1줄. 0건이면 null(빈 경고 줄을 그리지 않는다). */
  readonly warningsNotice: string | null;
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
      listHeadline: UI_TEXT.loading,
      listHeadlineKind: 'loading',
      listVisible: false,
      directionFilterVisible: false,
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
      warningsCount: 0,
      warningsNoticeCount: 0,
      warningsNotice: null,
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
    for (const departure of result.departures) upcoming.push(departureEvent(model, route, departure));
  }
  upcoming.sort(compareEvents);

  const todayEvents = upcoming.filter((event) => event.dayOffset === 0);
  // 오늘 남은 편이 하나도 없으면(운행 종료·운행 없는 날) **다음 운행일 하루**만 안내한다(V1 §8).
  // (도메인은 다음 운행일 편을 함께 실어 주므로, 그중 가장 가까운 날짜로 좁힌다.)
  const nextOffset = upcoming.at(0)?.dayOffset ?? 0;
  const pool = todayEvents.length > 0 ? todayEvents : upcoming.filter((event) => event.dayOffset === nextOffset);
  const filtered = filter === 'all' ? pool : pool.filter((event) => event.direction === filter);
  const list = filtered.slice(0, BOARD_LIST_LIMIT);
  const status: BoardStatus = !service.serviceOn ? 'no-service' : upcoming.length === 0 ? 'empty' : 'ready';
  // 다음 운행 편은 **방향 필터와 무관하게** 안내한다(필터로 0편이 되면 "다음 운행"이 사라져 버린다).
  const nextService = pool.at(0) ?? null;
  const nextServiceLabel =
    nextService === null ? null : `${nextService.dayLabel} ${nextService.departure}`;
  const headline = listHeadlineOf(status, service.serviceOn, todayEvents.length > 0, nextServiceLabel);
  const warningList = [...warnings];

  return {
    ...base,
    status,
    listHeadline: headline.text,
    listHeadlineKind: headline.kind,
    listVisible: headline.kind !== 'no-service' && headline.kind !== 'empty' && headline.kind !== 'loading',
    // 오늘 남은 편이 있을 때만 방향 필터를 보여준다(운행 없는 날·종료 뒤에는 모두 0편 = 소음).
    directionFilterVisible: todayEvents.length > 0,
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
    warnings: warningList,
    warningsCount: warningList.length,
    warningsNoticeCount: warningList.filter(isJudgmentWarning).length,
    warningsNotice: warningsNoticeOf(warningList),
  };
}

/**
 * 목록 영역 머리 문구를 **도메인 판정값만으로** 정한다(T13 결함 A).
 * - 운행 없는 날(`no-service`): `오늘은 운행이 없습니다 · 다음 운행: 내일 08:00`.
 *   **"끝났습니다"를 쓰지 않는다** — 상단 배너(`오늘 셔틀버스 운행이 없습니다`)와 충돌하기 때문.
 *   사유(원본 안내문)는 배너가 이미 보여주므로 여기서 반복하지 않는다.
 * - 운행은 했지만 오늘 편이 다 지난 경우(`today-over`): `오늘 운행이 끝났습니다 · 다음 운행: …`.
 * - 그 밖에는 머리 문구 없음(목록을 그대로 보여준다).
 */
function listHeadlineOf(
  status: BoardStatus,
  serviceOn: boolean,
  hasTodayEvents: boolean,
  nextServiceLabel: string | null,
): { readonly kind: BoardHeadlineKind | null; readonly text: string | null } {
  const nextPart =
    nextServiceLabel === null ? '' : ` · ${UI_TEXT.boardNextServicePrefix}: ${nextServiceLabel}`;
  if (status === 'no-service' || !serviceOn) {
    return { kind: 'no-service', text: `${UI_TEXT.boardListNoService}${nextPart}` };
  }
  if (status === 'empty') return { kind: 'empty', text: UI_TEXT.boardListEmpty };
  if (!hasTodayEvents) return { kind: 'today-over', text: `${UI_TEXT.boardTodayOverTitle}${nextPart}` };
  return { kind: null, text: null };
}

/** 홈에 두는 미해석 표기 안내 1줄(T14) — 사용자 판단에 영향을 주는 경고만. */
function warningsNoticeOf(warnings: readonly string[]): string | null {
  const count = warnings.filter(isJudgmentWarning).length;
  if (count === 0) return null;
  return `${UI_TEXT.boardWarningsNoticePrefix}${String(count)}${UI_TEXT.boardWarningsNoticeCountSuffix}${UI_TEXT.boardWarningsNoticeDetail}`;
}

/**
 * 미해석 표기 분류(T14) — **사용자 판단에 영향을 주는 경고**만 화면으로 올린다.
 * - 대상 ✅: 출발 시각이 없거나 형식이 깨져 **회차가 목록에서 빠질 수 있는** 경고.
 * - 제외 ❌: `회차 특이사항을 해석하지 못했습니다(…)` 처럼 **주석성 표기**(예: `중간노선 전용`,
 *   소요시간 `0:15`)만 못 읽은 경고 — 회차 시각에는 영향이 없어 화면에 내보내지 않는다.
 *   (T14 지시: 주석성 표기는 아예 노출하지 않는다 — 내부 로그·증거로만.)
 */
function isJudgmentWarning(warning: string): boolean {
  return !warning.startsWith('회차 특이사항을 해석하지 못했습니다');
}

/** 도메인 반환 1편 + 원본 행(방향·도착·특이사항) → 화면 값. */
function departureEvent(model: TimetableModel, route: RouteView, departure: NextDeparture): DepartureEventView {
  const table: DayTableView | null = route.byDay[departure.dayType];
  const row = findTripRow(table, departure);
  // 방향 판정은 도메인 `tripDepartureTime`(= depCampus ?? depStation) 규칙과 같은 축을 쓴다:
  // 캠퍼스 출발이 있으면 학교에서 출발(out), 없으면 역/터미널 출발(in).
  const direction: DepartureDirection = cellText(row, ['depCampus']) === null ? 'in' : 'out';
  const arrival =
    direction === 'out' ? cellText(row, ['depStation', 'depTerminal']) : cellText(row, ['arrCampus']);
  // T22 — 사유 배지는 **도메인 판정 결과**에서만 만든다(표시 계층은 코드를 문구로 옮기기만 한다).
  const trip = findDomainTrip(model.schedule, route.id, departure.dayType, departure.seq);
  const status = tripStatusForDeparture(trip, departure, model);
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
    durationNote: durationNoteFor(route, direction, row),
    notes: uniqueNotes([...conditionBadges(trip, status, row), ...departure.annotations]),
    dayType: departure.dayType,
  };
}

/**
 * 그 편의 사유 배지(v3 `trip.service` 기반).
 *
 * - 조건이 **구조화된 행**(v3)만 코드에서 문구를 만든다 — `금요일 운행 없음` · `월·화만 운행` ·
 *   `2대 운행` · 데이터의 표기 통일본(`중간노선 전용`).
 * - 구조화 이전 발행물(v1·v2)은 표 문자열(`note`)을 **그대로** 배지로 쓴다(기존 화면과 동일 — 하위호환).
 * - `needsReview`(검수 필요) 행은 내부 플래그이므로 배지를 만들지 않는다(화면 미노출).
 */
function conditionBadges(trip: Trip | null, status: TripStatus | null, row: TripRow | null): readonly string[] {
  // 검수 필요(`needsReview`) 행은 **내부 플래그**다 — 확인되지 않은 표기를 사유로 단정하지 않는다.
  if (trip !== null && trip.needsReview === true) return [];
  if (trip === null || status === null || trip.service == null) return rawNotes(row);
  return [
    ...excludedBadges(status.excludedDays),
    ...dayScopeBadges(status),
    ...(status.label === null ? [] : [status.label]),
  ];
}

/** `금` → `금요일 운행 없음`, `월·화` → `월·화요일 운행 없음`. 조건 없으면 빈 배열. */
function excludedBadges(codes: readonly WeekdayCode[]): readonly string[] {
  if (codes.length === 0) return [];
  const days = codes.map((code) => WEEKDAY_CODE_LABEL[code]).join('·');
  return [`${days}${UI_TEXT.tripWeekdayExcludedSuffix}`];
}

/** `월·화만 운행` + (값이 있으면) `2대 운행` — 요일 범위 조건이 있는 편만. */
function dayScopeBadges(status: TripStatus): readonly string[] {
  const out: string[] = [];
  if (status.dayScope !== null && status.dayScope.length > 0) {
    const days = status.dayScope.map((code) => WEEKDAY_CODE_LABEL[code]).join('·');
    out.push(`${days}${UI_TEXT.tripDayScopeSuffix}`);
  }
  if (status.vehicleCount !== null) out.push(`${String(status.vehicleCount)}${UI_TEXT.tripVehicleCountSuffix}`);
  return out;
}

/**
 * 편 1건의 도메인 판정 — **그 편의 날짜**(내일·모레 편이면 그 날)로 판정한다.
 * 날짜 규칙·학기/방학 구간은 뷰모델(`dateRules`·`terms`)을 그대로 넘긴다(판정은 도메인 몫).
 */
function tripStatusForDeparture(trip: Trip | null, departure: NextDeparture, model: TimetableModel): TripStatus | null {
  if (trip === null) return null;
  const day = kstDayFromInstant(new Date(departure.departureAt));
  const context: TripStatusContext = { dateRules: model.dateRules, terms: model.terms };
  return tripStatus(trip, day, context);
}

/** 요일 구분 표에서 그 순번의 도메인 회차(조건 필드 포함)를 찾는다. */
function findDomainTrip(
  schedule: TimetableModel['schedule'],
  routeId: string,
  dayType: DayType,
  seq: number,
): Trip | null {
  for (const route of schedule.routes) {
    if (route.id !== routeId) continue;
    for (const trip of route.byDay[dayType] ?? []) {
      if (trip.seq === seq) return trip;
    }
    return null;
  }
  return null;
}

/**
 * 방향별 소요시간 문구(`약 15분 소요`, 지시 ③) — 값의 출처는 두 곳이고 **더 구체적인 쪽이 이긴다**.
 *  ① `routes[].tripNotes[]`(v2) — 방향이 맞고(또는 `both`) `minutes` 가 있으며 **조건 표기가 없는** 항목.
 *     조건부 소요시간(`교통정체` 08:00~9:00 / `이외 시간`)은 어느 값이 적용되는지 판정하려면
 *     기간·시각 해석이 필요한데, 앱은 그 판정을 하지 않는다(판정 로직 신규 작성 금지) → 숨긴다.
 *  ② 그 회차 행의 `durationMinutes`(v3, `0:15` → 15) — ①이 없을 때만 쓴다.
 *     (v2 실측: 아산KTX 는 ①이 등교 15·하교 20 을 이미 주고 있어 화면 값이 바뀌지 않는다.)
 *  둘 다 없으면 null(문구를 그리지 않는다 — 추측 금지).
 */
function durationNoteFor(route: RouteView, direction: DepartureDirection, row: TripRow | null): string | null {
  const wanted = direction === 'out' ? 'outbound' : 'inbound';
  for (const tripNote of route.tripNotes) {
    if (tripNote.needsReview) continue;
    if (tripNote.minutes === null) continue;
    if (tripNote.conditions.length > 0) continue;
    if (tripNote.direction !== wanted && tripNote.direction !== 'both') continue;
    return durationText(tripNote.minutes);
  }
  const minutes = numberCell(row, ['durationMinutes']);
  return minutes === null ? null : durationText(minutes);
}

/** `약 15분 소요` — 틀 문구는 `UI_TEXT`, 숫자는 데이터 값. */
function durationText(minutes: number): string {
  return `${UI_TEXT.durationNotePrefix} ${String(minutes)}${UI_TEXT.durationNoteSuffix}`;
}

/** 원시 셀에서 숫자 값 하나를 꺼낸다(없거나 숫자가 아니면 null). */
function numberCell(row: TripRow | null, keys: readonly string[]): number | null {
  if (row === null) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
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

/* ───────────────────── [전체] 화면 — 전체 편 목록 (T24 · docs/07 §4-2) ─────────────────────
 * [지금]("오늘 남은 편")과 달리, 요일 탭이 고른 **그 요일의 전체 회차**(지난 편 포함)를 보여준다.
 * 판정(운행 여부·사유)은 도메인만 한다 — 여기서는 도메인 함수를 호출해 **표시 값으로 옮기기만** 한다:
 *   · 운행 여부: `resolveTripService(trip, day).runs`  (serviceDay)
 *   · 사유 코드: `tripStatus(trip, day, context)`      (tripStatus — T22 계약)
 *   · 출발 시각: `tripDepartureTime(trip)`              (Trip)
 * 기준일(`referenceDate`)은 "선택한 요일이 다음으로 돌아오는 날"이다(오늘이 그 요일이면 오늘).
 * 그래야 사유 배지가 **그 요일 기준**으로 맞는다(예: 월요일 기준 `금요일 운행 없음`).
 */

/** 전체 목록의 편 1건 — 값은 도메인/JSON 에서만 온다(화면 계산 금지). */
export interface FullTripView {
  readonly key: string;
  readonly routeId: string;
  readonly routeName: string;
  readonly departure: string;
  readonly arrival: string | null;
  readonly direction: DepartureDirection;
  readonly directionLabel: string;
  /** 조건 없는 방향별 소요시간만(`약 15분 소요`) — 조건부는 앱이 고르지 않는다(T17) */
  readonly durationNote: string | null;
  /** 사유·조건 배지(도메인 `tripStatus` 결과) + 원본 특이사항 */
  readonly badges: readonly string[];
  /** 기준일의 현재 시각보다 이른 출발인가(지난 편) */
  readonly isPast: boolean;
}

export interface FullDayView {
  readonly dayType: DayType;
  readonly dayLabel: string;
  /** 사유 판정 기준일(`YYYY-MM-DD`) — 증거·검증용 */
  readonly referenceDate: string;
  /** 방향 필터가 적용된 목록 */
  readonly trips: readonly FullTripView[];
  /** 필터 전 전체 편수 */
  readonly total: number;
  readonly counts: Readonly<Record<DirectionFilter, number>>;
}

export interface FullDayOptions {
  /** 표를 그릴 요일 구분(기본: 선택된 요일). 대체 시간표 날에는 **적용 시간표**가 온다 */
  readonly dayType: DayType;
  /**
   * 사유 판정·지난 편 판정의 기준일(기본: 선택한 요일이 돌아오는 날).
   * 오늘 화면에서는 **오늘**이 온다 — 대체 시간표 날(예: 개천절대체휴일 → 일요일 시간표)에도
   * "지금 시각 기준 지난 편/다음 출발" 판정이 오늘을 기준으로 맞아야 하기 때문이다.
   */
  readonly referenceDay: KstDay;
}

export function fullDayView(
  state: ScheduleState,
  filter: DirectionFilter = 'all',
  options?: FullDayOptions,
): FullDayView {
  const dayType = options?.dayType ?? state.dayType;
  const model = state.model;
  if (model === null) {
    return {
      dayType,
      dayLabel: dayTypeLabel(dayType),
      referenceDate: '',
      trips: [],
      total: 0,
      counts: { all: 0, out: 0, in: 0 },
    };
  }

  const day = options?.referenceDay ?? referenceDay(state, dayType);
  const all: FullTripView[] = [];
  for (const route of model.routes) {
    // 운행 중단 노선은 전체 목록에도 올리지 않는다(상태·사유는 이용 안내가 원문으로 보여준다).
    if (route.status === 'suspended') continue;
    const table = route.byDay[dayType];
    if (table === null) continue;
    const domainRoute = model.schedule.routes.find((candidate) => candidate.id === route.id);
    for (const trip of domainRoute?.byDay[dayType] ?? []) {
      const departure = tripDepartureTime(trip);
      if (departure === null) continue;
      if (!resolveTripService(trip, day).runs) continue;
      const row = rowBySeq(table, trip.seq);
      const direction: DepartureDirection = cellText(row, ['depCampus']) === null ? 'in' : 'out';
      const arrival =
        direction === 'out' ? cellText(row, ['depStation', 'depTerminal']) : cellText(row, ['arrCampus']);
      const status = tripStatus(trip, day, { dateRules: model.dateRules, terms: model.terms });
      all.push({
        key: `${route.id}:${String(trip.seq)}`,
        routeId: route.id,
        routeName: route.name,
        departure,
        arrival,
        direction,
        directionLabel: direction === 'out' ? UI_TEXT.boardDirectionOut : UI_TEXT.boardDirectionIn,
        durationNote: durationNoteFor(route, direction, row),
        badges: uniqueNotes([...conditionBadges(trip, status, row)]),
        isPast: isPastDeparture(departure, day, state.nowMs),
      });
    }
  }
  all.sort(compareFullTrips);

  const counts = {
    all: all.length,
    out: all.filter((trip) => trip.direction === 'out').length,
    in: all.filter((trip) => trip.direction === 'in').length,
  };
  return {
    dayType,
    dayLabel: dayTypeLabel(dayType),
    referenceDate: formatIsoDate(day),
    trips: filter === 'all' ? all : all.filter((trip) => trip.direction === filter),
    total: all.length,
    counts,
  };
}

/**
 * 사유 판정 기준일 — 선택한 요일이 **다음으로 돌아오는 날**(오늘이 그 요일이면 오늘).
 * 달력 산술만 쓴다(도메인 `addKstDays`·`dayTypeFromWeekday`) — 운행 판정은 하지 않는다.
 */
function referenceDay(state: ScheduleState, dayType: DayType): KstDay {
  const today = kstDayFromInstant(new Date(state.nowMs));
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addKstDays(today, offset);
    if (dayTypeFromWeekday(day.weekday) === dayType) return day;
  }
  return today;
}

/** 그 요일 표에서 순번으로 회차 행을 찾는다(없으면 null — 추측하지 않는다). */
function rowBySeq(table: DayTableView, seq: number): TripRow | null {
  for (const row of table.rows) {
    if (Number(row['seq']) === seq) return row;
  }
  return null;
}

/** 기준일의 그 시각이 지났는가 — 달력 비교만 한다(운행 판정 아님). */
function isPastDeparture(departure: string, day: KstDay, nowMs: number): boolean {
  const parsed = parseHhMm(departure);
  if (parsed === null) return false;
  return kstInstantOf(day, parsed.hour, parsed.minute).getTime() < nowMs;
}

/** 출발 시각 오름차순(같으면 노선 id) — 전체 목록의 단일 정렬 기준. */
function compareFullTrips(a: FullTripView, b: FullTripView): number {
  if (a.departure !== b.departure) return a.departure < b.departure ? -1 : 1;
  if (a.routeId !== b.routeId) return a.routeId < b.routeId ? -1 : 1;
  return a.key < b.key ? -1 : a.key === b.key ? 0 : 1;
}

/* ───────────────────── 본문 = 시간표 하나 (T27 · docs/07 §9) ─────────────────────
 * 화면의 주인공은 시간표다(§9-1). 본문은 **선택한 요일의 전체 회차 목록 하나**이고,
 *  - 이미 지난 편은 dim(`isPast`)
 *  - 지금 시각 기준 **다음 출발 편 하나**만 살짝 강조(`isNext`) — 좌측 라인 + 배경 톤
 *  - 요일 조건이 걸린 편은 **짧은 토큰 1개 이하**(`token`) — 긴 사유 문구·배지 나열 금지(§9-3)
 * 판정(운행 여부·사유 코드)은 전부 도메인(`resolveTripService`·`tripStatus`)이 하고 여기서는
 * `fullDayView` 가 만든 값에 **표시용 요약(토큰)·강조 위치**만 얹는다(재계산 없음).
 */

/** 본문 시간표 행 — `FullTripView` + 화면 강조용 값. */
export interface TimetableRowView extends FullTripView {
  /** 요일 조건 요약 토큰(최대 1개) — `금 휴` · `월·화` · `2대`. 없으면 null */
  readonly token: string | null;
  /** 다음 출발 행인가(강조 대상 — 오늘 시간표일 때만 하나뿐) */
  readonly isNext: boolean;
}

export interface TimetableView {
  readonly dayType: DayType;
  readonly dayLabel: string;
  /** 사유 판정 기준일(`YYYY-MM-DD`) — 증거·검증용 */
  readonly referenceDate: string;
  /** 선택한 요일이 **오늘**인가(강조·자동 스크롤은 오늘일 때만 의미가 있다) */
  readonly isToday: boolean;
  readonly total: number;
  readonly counts: Readonly<Record<DirectionFilter, number>>;
  readonly rows: readonly TimetableRowView[];
  /** 강조(다음 출발) 행 key — 없으면 null */
  readonly nextKey: string | null;
}

/**
 * 본문 시간표 뷰(§9-1·§9-3) — `fullDayView`(그 요일 실제 운행 편) 위에
 * **다음 출발 행 하나**와 **짧은 조건 토큰**만 얹는다. 오늘이 아닌 요일 탭([토]/[일] 미리보기)에는
 * 강조할 "다음 출발"이 없다(오늘 기준 지난 편 판정이 의미를 갖지 않는다).
 *
 * 오늘 화면의 두 가지 계약(T13·T22 유지):
 *  - **운행 없는 날**(공휴일 등)에는 시간표 행을 그리지 않는다 — 상단 바 아래 1줄이 "다음 운행"을 안내한다.
 *  - **대체 시간표 날**에는 **적용 시간표**(예: 일요일)를 그린다(캘린더 요일 표가 아니다).
 */
export function timetableView(state: ScheduleState, filter: DirectionFilter = 'all'): TimetableView {
  const now = new Date(state.nowMs);
  const today = kstDayFromInstant(now);
  const todayDayType = dayTypeFromDate(now);
  const selectedIsToday = state.dayType === todayDayType;
  const model = state.model;
  const service = model === null ? null : resolveDayService(today, model.schedule.notices);
  const noService = selectedIsToday && service !== null && !service.serviceOn;
  const effectiveDayType: DayType =
    selectedIsToday && service !== null && service.serviceOn ? service.effectiveDayType : state.dayType;

  // 오늘 화면이면 적용 요일 + 기준일=오늘, 미리보기 탭이면 그 요일이 돌아오는 날을 기준으로 판정한다.
  const full = fullDayView(
    state,
    filter,
    selectedIsToday ? { dayType: effectiveDayType, referenceDay: today } : undefined,
  );
  const isToday = selectedIsToday && !noService;
  const trips = noService ? [] : full.trips;

  let nextKey: string | null = null;
  const rows = trips.map((trip): TimetableRowView => {
    const isNext = isToday && nextKey === null && !trip.isPast;
    if (isNext) nextKey = trip.key;
    return { ...trip, token: shortTripToken(trip.badges), isNext };
  });
  return {
    dayType: full.dayType,
    dayLabel: full.dayLabel,
    referenceDate: noService ? formatIsoDate(today) : full.referenceDate,
    isToday,
    total: noService ? 0 : full.total,
    counts: noService ? { all: 0, out: 0, in: 0 } : full.counts,
    rows,
    nextKey,
  };
}

/**
 * 사유 배지(도메인 문구) → **짧은 토큰 하나**(§9-3: 긴 사유 문구 금지).
 *  - `금요일 운행 없음` → `금 휴`   (그 요일에는 이 편이 뜨지 않는다 — 한 눈에)
 *  - `월·화만 운행`    → `월·화`
 *  - `2대 운행`        → `2대`      (요일 범위와 함께면 `월·화 2대`)
 *  - 그 밖(데이터에서 온 표기, 예 `중간노선 전용`)은 그대로 쓴다(지어내지 않는다).
 * 우선순위: 요일 휴무 > 요일 범위(+대수) > 대수 > 데이터 표기. 결과는 항상 1개(또는 null).
 */
export function shortTripToken(badges: readonly string[]): string | null {
  let scope: string | null = null;
  let count: string | null = null;
  let label: string | null = null;
  for (const raw of badges) {
    const text = raw.trim();
    if (text === '') continue;
    const excluded = /^(.+)요일 운행 없음$/.exec(text);
    if (excluded !== null) return `${compressWeekdayScope(excluded[1] ?? '')} ${UI_TEXT.tokenHolidaySuffix}`;
    const scoped = /^(.+)만 운행$/.exec(text);
    if (scoped !== null) {
      scope = compressWeekdayScope(scoped[1] ?? '');
      continue;
    }
    const vehicles = /^(\d+)대 운행$/.exec(text);
    if (vehicles !== null) {
      count = `${vehicles[1] ?? ''}${UI_TEXT.tokenVehicleSuffix}`;
      continue;
    }
    if (label === null) label = text;
  }
  if (scope !== null) return count === null ? scope : `${scope} ${count}`;
  return count ?? label;
}

/**
 * 요일 목록을 **짧은 토큰**으로 줄인다 — 3일 이상 연속이면 `월·화·수·목` → `월~목`.
 * (§9-3 "짧은 토큰 하나" — 한글 요일 4개 + 대수까지 붙으면 토큰이 문구가 된다.)
 */
function compressWeekdayScope(days: string): string {
  const parts = days.split('·').filter((part) => part.trim() !== '');
  if (parts.length < 3) return days;
  const first = parts[0];
  const last = parts.at(-1);
  if (first === undefined || last === undefined) return days;
  return `${first}~${last}`;
}

/* ───────────────────── 상단 바 아래 최소 1줄 (T27 · docs/07 §9-4) ─────────────────────
 * §9-1 로 본문에서 걷어낸 안내 중 **스크롤 대상이 없거나 사용자가 반드시 알아야 하는** 것만
 * 상단 바 아래 **얇은 한 줄**로 남긴다(동시에 최대 1줄). 우선순위: 운행없음 > 대체 > 방학.
 * (T13 계약인 "오늘 운행 종료" 안내도 같은 슬롯을 쓴다 — 다음 출발 행이 없는 상태를 알린다.)
 */

export type DayNoticeKind = 'no-service' | 'alternate' | 'vacation' | 'today-over';

export interface DayNoticeLine {
  readonly kind: DayNoticeKind;
  /** 화면에 그대로 쓰는 한 줄 */
  readonly text: string;
}

export function dayNoticeLine(state: ScheduleState): DayNoticeLine | null {
  const notice = serviceNoticeView(state);
  if (notice !== null && notice.kind === 'no-service') {
    // 다음 운행 시각을 함께 알린다(§9-4 ①) — 값은 도메인 `nextDepartures` 결과에서만 온다.
    const board = todayBoardView(state);
    const next = board.next.at(0);
    const nextPart =
      next === undefined
        ? ''
        : ` · ${UI_TEXT.boardNextServicePrefix}: ${next.dayLabel} ${next.departure}`;
    return { kind: 'no-service', text: `${notice.title} · ${notice.detail}${nextPart}` };
  }
  if (notice !== null) return { kind: 'alternate', text: `${notice.title} · ${notice.detail}` };
  const vacation = vacationNotice(state);
  if (vacation !== null) return { kind: 'vacation', text: vacation.text };
  const board = todayBoardView(state);
  if (board.listHeadlineKind === 'today-over' && board.listHeadline !== null) {
    return { kind: 'today-over', text: board.listHeadline };
  }
  return null;
}
