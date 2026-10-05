import { DAY_TYPES, type DayType } from './DayType';
import type { Notice } from './Notice';
import type { Route } from './Route';
import type { Trip } from './Trip';

/**
 * 시간표 전체(노선 × 요일) — 데이터 스키마 `docs/01-architecture.md §4` 의 최상위와 1:1.
 */
export interface ScheduleSource {
  readonly url: string;
  readonly sourceUpdatedAt: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
}

export interface Semester {
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface Schedule {
  readonly schemaVersion: number;
  readonly source: ScheduleSource;
  readonly semester: Semester;
  readonly dayTypes: readonly DayType[];
  readonly routes: readonly Route[];
  readonly notices: readonly Notice[];
}

/** 노선 id 로 조회. 없으면 null(오류를 던지지 않는다 — 호출부가 명확한 상태로 처리). */
export function findRoute(schedule: Schedule, routeId: string): Route | null {
  for (const route of schedule.routes) {
    if (route.id === routeId) return route;
  }
  return null;
}

/** 스키마에 기록된 노선 id 목록(순서 유지). */
export function routeIds(schedule: Schedule): readonly string[] {
  return schedule.routes.map((route) => route.id);
}

/**
 * (노선 × 요일) 회차. 노선이 없거나 그 요일 표가 비었으면 **빈 배열**을 준다.
 */
export function tripsFor(schedule: Schedule, routeId: string, dayType: DayType): readonly Trip[] {
  const route = findRoute(schedule, routeId);
  if (route === null) return [];
  return route.byDay[dayType] ?? [];
}

/** 요일 구분 정본 순서인지 검사(파서 출력 검증용). */
export function hasAllDayTypes(schedule: Schedule): boolean {
  if (schedule.dayTypes.length !== DAY_TYPES.length) return false;
  return DAY_TYPES.every((dayType) => schedule.dayTypes.includes(dayType));
}
