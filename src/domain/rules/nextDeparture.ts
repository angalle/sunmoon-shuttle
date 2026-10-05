import type { Clock } from '../../ports/clock';
import type { DayType } from '../entities/DayType';
import { findRoute, routeIds, tripsFor, type Schedule } from '../entities/Schedule';
import { tripDepartureTime, type Trip } from '../entities/Trip';
import { addKstDays, formatHhMm, formatIsoDate, formatKstIso, kstDayFromInstant, kstInstantOf, parseHhMm, type KstDay } from './kst';
import { resolveDayService, resolveTripService, type DayServiceStatus } from './serviceDay';

/**
 * 다음 출발 계산 규칙 (요구사항 F3 · 수용 기준 AC-3).
 *
 * 규칙
 * 1. 시각은 **주입된 clock** 으로만 받는다(`Date.now()` 금지) — 테스트 결정성.
 * 2. 지난 회차는 제외한다. 당일 마지막 차 이후면 **다음 운행일의 첫 차**를 안내한다
 *    (무한정 "없음"으로 두지 않는다 — 예: "내일 08:05").
 * 3. 운행 없는 날(연휴·개교기념일)이면 **그 사실을 먼저** 반환한다(`status='no-service-today'`)
 *    하되, 다음 운행일 회차도 함께 실어 화면이 "오늘 운행 없음 · 내일 08:05" 를 보여줄 수 있게 한다.
 * 4. 자정·요일 전환은 KST 고정 오프셋으로 계산한다(호스트 TZ 무관).
 * 5. 스케줄이 비었거나 노선이 없으면 오류를 던지지 않고 **명확한 상태**로 반환한다.
 */

export const DEFAULT_NEXT_DEPARTURE_COUNT = 3;
export const DEFAULT_HORIZON_DAYS = 14;

export interface NextDepartureInput {
  readonly schedule: Schedule;
  readonly routeId: string;
  /** 현재 시각 공급자(포트) */
  readonly clock: Clock;
  /** 몇 개까지 안내할지 (기본 3) */
  readonly count?: number;
  /** 며칠 앞까지 찾아볼지 (기본 14) */
  readonly horizonDays?: number;
}

export interface NextDeparture {
  readonly seq: number;
  /** `HH:MM` (KST, 0 채움) */
  readonly departure: string;
  /** `YYYY-MM-DD` (KST) */
  readonly date: string;
  /** `YYYY-MM-DDTHH:MM:SS+09:00` */
  readonly departureAt: string;
  /** 0=오늘, 1=내일 … */
  readonly dayOffset: number;
  /** 그 회차에 적용된 시간표 구분(안내문 대체 반영) */
  readonly dayType: DayType;
  /** `오늘` | `내일` | `모레` | `MM-DD` */
  readonly dayLabel: string;
  readonly remainingMinutes: number;
  readonly remainingSeconds: number;
  /** 회차 특이사항 주석(예: `월~화 2대 운행`) — 표시용 */
  readonly annotations: readonly string[];
}

interface OkBase {
  readonly routeId: string;
  /** 오늘(KST)의 운행 여부·적용 시간표 */
  readonly today: DayServiceStatus;
  readonly horizonDays: number;
  /** 해석 못 한 표기 등 — 조용히 무시하지 않고 모아서 올린다 */
  readonly warnings: readonly string[];
}

export interface NextDepartureOk extends OkBase {
  readonly status: 'ok';
  readonly departures: readonly NextDeparture[];
  readonly nextServiceDate: string;
}

export interface NextDepartureNoServiceToday extends OkBase {
  readonly status: 'no-service-today';
  /** 오늘 안내할 회차는 없다. 다음 운행일 회차(있으면)가 담긴다. */
  readonly departures: readonly NextDeparture[];
  /** 운행 없음 사유(안내문 원문) */
  readonly reason: string;
  readonly nextServiceDate: string | null;
}

export interface NextDepartureEmptySchedule extends OkBase {
  readonly status: 'empty-schedule';
  /** 그 노선의 표가 비어 있어 안내할 회차가 없다(오류 아님) */
  readonly reason: string;
}

export interface NextDepartureUnknownRoute {
  readonly status: 'unknown-route';
  readonly routeId: string;
  readonly knownRouteIds: readonly string[];
}

export type NextDepartureResult =
  | NextDepartureOk
  | NextDepartureNoServiceToday
  | NextDepartureEmptySchedule
  | NextDepartureUnknownRoute;

/** 다음 출발 N개(기본 3개) + 남은 시간(분/초). */
export function nextDepartures(input: NextDepartureInput): NextDepartureResult {
  const count = input.count ?? DEFAULT_NEXT_DEPARTURE_COUNT;
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const route = findRoute(input.schedule, input.routeId);
  if (route === null) {
    return { status: 'unknown-route', routeId: input.routeId, knownRouteIds: routeIds(input.schedule) };
  }

  const now = input.clock.now();
  const today = kstDayFromInstant(now);
  const warnings = new Set<string>();

  const todayStatus = resolveDayService(today, input.schedule.notices);
  collect(warnings, todayStatus.warnings);

  const departures: NextDeparture[] = [];
  let emptyScheduleDays = 0;

  for (let offset = 0; offset <= horizonDays && departures.length < count; offset += 1) {
    const day: KstDay = offset === 0 ? today : addKstDays(today, offset);
    const dayStatus = offset === 0 ? todayStatus : resolveDayService(day, input.schedule.notices);
    if (offset > 0) collect(warnings, dayStatus.warnings);
    if (!dayStatus.serviceOn) continue;

    const trips = tripsFor(input.schedule, input.routeId, dayStatus.effectiveDayType);
    if (trips.length === 0) {
      emptyScheduleDays += 1;
      continue;
    }

    for (const upcoming of upcomingTrips(trips, day, now.getTime(), warnings)) {
      if (departures.length >= count) break;
      departures.push(toNextDeparture(upcoming, now, day, offset, dayStatus.effectiveDayType));
    }
  }

  const warningList = [...warnings];
  const first = departures.at(0);
  const nextServiceDate = first === undefined ? null : first.date;
  const base: OkBase = { routeId: input.routeId, today: todayStatus, horizonDays, warnings: warningList };

  if (!todayStatus.serviceOn) {
    return {
      ...base,
      status: 'no-service-today',
      departures,
      reason: todayStatus.reason ?? `${todayStatus.date} 운행 없음`,
      nextServiceDate,
    };
  }

  if (first === undefined) {
    const detail = emptyScheduleDays > 0
      ? `요일 표가 비어 있습니다(빈 표 ${emptyScheduleDays}일) — 노선 ${input.routeId}`
      : `앞으로 ${horizonDays}일 안에 안내할 회차가 없습니다 — 노선 ${input.routeId}`;
    return { ...base, status: 'empty-schedule', reason: detail };
  }

  return { ...base, status: 'ok', departures, nextServiceDate: first.date };
}

interface UpcomingTrip {
  readonly trip: Trip;
  readonly hour: number;
  readonly minute: number;
  readonly at: Date;
  readonly annotations: readonly string[];
}

/** 그 날짜의 회차 중 아직 지나지 않은 것만, 시각 오름차순으로. */
function upcomingTrips(
  trips: readonly Trip[],
  day: KstDay,
  nowMs: number,
  warnings: Set<string>,
): readonly UpcomingTrip[] {
  const upcoming: UpcomingTrip[] = [];
  for (const trip of trips) {
    const tripStatus = resolveTripService(trip, day);
    collect(warnings, tripStatus.warnings);
    if (!tripStatus.runs) continue;

    const departure = tripDepartureTime(trip);
    if (departure === null) continue;
    const parsed = parseHhMm(departure);
    if (parsed === null) {
      warnings.add(
        `출발 시각 형식을 해석하지 못했습니다: ${JSON.stringify(departure)} (${formatIsoDate(day)} 순번 ${trip.seq})`,
      );
      continue;
    }

    const at = kstInstantOf(day, parsed.hour, parsed.minute);
    if (at.getTime() <= nowMs) continue; // 지난 회차 제외
    upcoming.push({ trip, hour: parsed.hour, minute: parsed.minute, at, annotations: tripStatus.annotations });
  }
  upcoming.sort((a, b) => a.at.getTime() - b.at.getTime());
  return upcoming;
}

function toNextDeparture(
  upcoming: UpcomingTrip,
  now: Date,
  day: KstDay,
  dayOffset: number,
  dayType: DayType,
): NextDeparture {
  const { trip, hour, minute, at } = upcoming;
  const seconds = Math.max(0, Math.round((at.getTime() - now.getTime()) / 1000));
  return {
    seq: trip.seq,
    departure: formatHhMm(hour, minute),
    date: formatIsoDate(day),
    departureAt: formatKstIso(day, hour, minute),
    dayOffset,
    dayType,
    dayLabel: dayLabelFor(day, dayOffset),
    remainingMinutes: Math.floor(seconds / 60),
    remainingSeconds: seconds,
    annotations: upcoming.annotations,
  };
}

function dayLabelFor(day: KstDay, dayOffset: number): string {
  if (dayOffset === 0) return '오늘';
  if (dayOffset === 1) return '내일';
  if (dayOffset === 2) return '모레';
  return `${pad2(day.month)}-${pad2(day.day)}`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function collect(target: Set<string>, values: readonly string[]): void {
  for (const value of values) target.add(value);
}
