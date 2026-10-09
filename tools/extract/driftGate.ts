/**
 * T35 **드리프트 게이트**(docs/08 §7 · 총괄 계약 2026-10-09: 임계 **±10%** + `--force-publish` 탈출구).
 *
 * 발행 **직전 발행본**(= 저장소의 `data/timetable.json`)과 새 발행본을 비교해 아래 중 하나라도 걸리면
 * **발행 보류 + 워크플로 실패(알림)** 한다 — 조용한 데이터 손상(편수 급감·노선 소실)을 앱에 내보내지 않는다.
 *
 * | 신호 | 조건 |
 * |---|---|
 * | 전체 편 수 변동 | **±10% 이상**(`DRIFT_TRIP_THRESHOLD`) |
 * | 노선 소실 | 직전 `routes[].id` 중 사라진 것 ≥ 1 |
 * | 시각 0건 | 특정 노선×요일 편 수가 `>0 → 0` |
 * | 요일 버킷 소실 | `byDay` 키가 줄어듦(= 직전 발행본에 있던 요일 표가 사라짐) |
 * | 열 구성 변경 | 열 의미 키(`keys`) 집합이 달라짐 |
 *
 * - 비교는 **개수·구조만** 본다(값 비교는 §5 교차검증·검증 4종 몫) → 정상 개편의 값 수정은 걸리지 않는다.
 * - `--force-publish` 는 보류를 해제하고 발행하되 `aiExtract.drift = {blocked:true, forced:true, reasons:[…]}`
 *   로 **강제 발행 사실을 데이터에 남긴다**(조용한 우회 금지). 알림은 그대로다.
 * - 임계 근거: 10% 는 민감한 값이라 **정상 학기 개편에서도 걸릴 수 있다** → 그때는 `--force-publish` 로 승인 발행.
 *   반복되면 임계를 재조정한다(임의로 완화하지 않는다 — docs/08 §7).
 *
 * 순수 함수다 — 파일 IO 는 호출측(cli)이 한다.
 */

import type { DayType } from '../scraper/types.js';
import { DAY_TYPES } from '../scraper/types.js';

/** 전체 편 수 변동 임계 — **±10% 이상이면 보류**(사용자 지시 2026-10-09) */
export const DRIFT_TRIP_THRESHOLD = 0.1;

export type DriftSignalId = 'trip-count' | 'route-lost' | 'day-trips-zero' | 'byday-key-lost' | 'column-keys-changed';

export interface DriftSignal {
  readonly id: DriftSignalId;
  /** 사람이 읽는 근거(수치 포함) */
  readonly detail: string;
}

/** 직전 발행본에서 게이트가 쓰는 최소 정보(발행 JSON 을 그대로 파싱 — v1·v3 모두 허용) */
export interface DriftBaseline {
  readonly schemaVersion: number | null;
  readonly totalTrips: number;
  readonly routes: readonly {
    readonly id: string;
    readonly totalTrips: number;
    readonly days: readonly {
      readonly dayType: DayType;
      readonly present: boolean;
      readonly trips: number;
      readonly keys: readonly string[];
    }[];
  }[];
}

export interface DriftTotals {
  readonly before: number;
  readonly after: number;
  /** 백분율(소수 1자리 반올림) */
  readonly deltaPct: number;
}

export interface DriftRouteRow {
  readonly routeId: string;
  readonly before: number;
  readonly after: number;
  readonly lost: boolean;
  readonly days: readonly { readonly dayType: DayType; readonly before: number; readonly after: number; readonly keysBefore: readonly string[]; readonly keysAfter: readonly string[] }[];
}

export interface DriftReport {
  readonly checked: boolean;
  readonly blocked: boolean;
  /** `--force-publish` 로 보류를 해제하고 발행했는가 */
  readonly forced: boolean;
  readonly reasons: readonly string[];
  readonly signals: readonly DriftSignal[];
  readonly threshold: number;
  readonly baseline: string | null;
  readonly totals: DriftTotals;
  readonly routes: readonly DriftRouteRow[];
  /** 게이트를 켜지 못한 사유(직전 발행본 없음·손상 등). `checked=false` 일 때만 채운다 */
  readonly skippedReason: string | null;
}

function readTrips(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? (value as readonly Record<string, unknown>[]) : [];
}

function readKeys(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * 발행 JSON(직전 발행본) → 게이트 입력. 형식이 어긋나면 `null`(게이트를 켜지 않는다 — 추측 금지).
 */
export function parseBaseline(raw: string): DriftBaseline | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const routesRaw = record['routes'];
  if (!Array.isArray(routesRaw)) return null;
  const routes: { id: string; totalTrips: number; days: { dayType: DayType; present: boolean; trips: number; keys: readonly string[] }[] }[] = [];
  for (const item of routesRaw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const route = item as Record<string, unknown>;
    const id = route['id'];
    if (typeof id !== 'string' || id === '') return null;
    const byDay = route['byDay'];
    const days: { dayType: DayType; present: boolean; trips: number; keys: readonly string[] }[] = [];
    let total = 0;
    for (const dayType of DAY_TYPES) {
      const table = byDay !== null && typeof byDay === 'object' && !Array.isArray(byDay) ? (byDay as Record<string, unknown>)[dayType] : undefined;
      const present = table !== null && typeof table === 'object' && !Array.isArray(table);
      const trips = present ? readTrips((table as Record<string, unknown>)['trips']).length : 0;
      const keys = present ? readKeys((table as Record<string, unknown>)['keys']) : [];
      total += trips;
      days.push({ dayType, present, trips, keys });
    }
    routes.push({ id, totalTrips: total, days });
  }
  const schemaRaw = record['schemaVersion'];
  return {
    schemaVersion: typeof schemaRaw === 'number' ? schemaRaw : null,
    totalTrips: routes.reduce((sum, route) => sum + route.totalTrips, 0),
    routes,
  };
}

/** 새 발행본에서 게이트가 쓰는 최소 형태 — v1(`Timetable`)·v3(`EnrichedTimetableBody`) 둘 다 만족한다 */
export interface DriftSource {
  readonly routes: readonly {
    readonly id: string;
    readonly byDay: Readonly<Record<string, { readonly keys: readonly string[]; readonly trips: readonly unknown[] } | undefined>>;
  }[];
}

/** 새 발행본(조립된 타임테이블) → 같은 형태의 요약 */
export function summariseTimetable(timetable: DriftSource): Omit<DriftBaseline, 'schemaVersion'> {
  const routes = timetable.routes.map((route) => {
    const days = DAY_TYPES.map((dayType) => {
      const table = route.byDay[dayType];
      const trips = table === undefined ? 0 : table.trips.length;
      return { dayType, present: table !== undefined, trips, keys: table === undefined ? [] : [...table.keys] };
    });
    return { id: route.id, totalTrips: days.reduce((sum, day) => sum + day.trips, 0), days };
  });
  return { totalTrips: routes.reduce((sum, route) => sum + route.totalTrips, 0), routes };
}

function pct(delta: number, before: number): number {
  if (before === 0) return delta === 0 ? 0 : 100;
  return Math.round((delta / before) * 1000) / 10;
}

export interface DriftCheckInput {
  /** 직전 발행본(없으면 `checked: false`) */
  readonly baseline: DriftBaseline | null;
  /** 직전 발행본 경로(근거 기록용) */
  readonly baselinePath: string | null;
  /** 게이트를 켜지 못한 사유(파일 없음·손상 등) */
  readonly baselineIssue: string | null;
  readonly next: DriftSource;
}

/**
 * §7 신호를 전부 계산한다. `blocked=true` 면 호출측(cli)이 **발행을 보류**하고 exit 1 한다.
 * (`--force-publish` 는 호출측이 `forced=true` 로 덮어쓰고 발행한다.)
 */
export function checkDrift(input: DriftCheckInput): DriftReport {
  const next = summariseTimetable(input.next);
  const baseline = input.baseline;
  const signals: DriftSignal[] = [];
  const reasons: string[] = [];
  const baselineByRoute = new Map((baseline?.routes ?? []).map((route) => [route.id, route]));
  const nextByRoute = new Map(next.routes.map((route) => [route.id, route]));

  const totals: DriftTotals = {
    before: baseline?.totalTrips ?? 0,
    after: next.totalTrips,
    deltaPct: 0,
  };

  const routes: DriftRouteRow[] = [];
  for (const route of [...(baseline?.routes ?? []), ...next.routes]) {
    if (routes.some((row) => row.routeId === route.id)) continue;
    const before = baselineByRoute.get(route.id);
    const after = nextByRoute.get(route.id);
    routes.push({
      routeId: route.id,
      before: before?.totalTrips ?? 0,
      after: after?.totalTrips ?? 0,
      lost: before !== undefined && after === undefined,
      days: DAY_TYPES.map((dayType) => ({
        dayType,
        before: before?.days.find((day) => day.dayType === dayType)?.trips ?? 0,
        after: after?.days.find((day) => day.dayType === dayType)?.trips ?? 0,
        keysBefore: before?.days.find((day) => day.dayType === dayType)?.keys ?? [],
        keysAfter: after?.days.find((day) => day.dayType === dayType)?.keys ?? [],
      })),
    });
  }

  if (baseline === null) {
    return {
      checked: false,
      blocked: false,
      forced: false,
      reasons: [],
      signals: [],
      threshold: DRIFT_TRIP_THRESHOLD,
      baseline: input.baselinePath,
      totals,
      routes,
      skippedReason: input.baselineIssue ?? '직전 발행본이 없다(첫 발행 — 비교 기준 없음)',
    };
  }

  // ① 전체 편 수 변동 ±10% 이상
  const delta = totals.after - totals.before;
  const deltaPct = pct(delta, totals.before);
  if (Math.abs(deltaPct) >= DRIFT_TRIP_THRESHOLD * 100) {
    signals.push({
      id: 'trip-count',
      detail: `전체 편 수 ${String(totals.before)} → ${String(totals.after)} (${deltaPct >= 0 ? '+' : ''}${String(deltaPct)}%) · 임계 ±${String(DRIFT_TRIP_THRESHOLD * 100)}%`,
    });
  }

  for (const row of routes) {
    // ② 노선 소실
    if (row.lost) {
      signals.push({ id: 'route-lost', detail: `노선 ${row.routeId} 소실(직전 ${String(row.before)}편) — 직전 발행본에만 있다` });
    }
    for (const day of row.days) {
      // ③ 특정 노선×요일 편 수 >0 → 0
      if (day.before > 0 && day.after === 0) {
        signals.push({ id: 'day-trips-zero', detail: `노선 ${row.routeId} ${day.dayType}: ${String(day.before)}편 → 0편` });
      }
      // ④ byDay 키 감소(직전 발행본에 있던 요일 표가 사라짐)
      const beforePresent = baselineByRoute.get(row.routeId)?.days.find((entry) => entry.dayType === day.dayType)?.present ?? false;
      const afterPresent = nextByRoute.get(row.routeId)?.days.find((entry) => entry.dayType === day.dayType)?.present ?? false;
      if (beforePresent && !afterPresent) {
        signals.push({ id: 'byday-key-lost', detail: `노선 ${row.routeId} ${day.dayType}: byDay 키 소실` });
      }
      // ⑤ 열 의미 키 집합 변경
      if (day.keysBefore.length > 0 && day.keysAfter.length > 0 && JSON.stringify(day.keysBefore) !== JSON.stringify(day.keysAfter)) {
        signals.push({
          id: 'column-keys-changed',
          detail: `노선 ${row.routeId} ${day.dayType}: 열 키 [${day.keysBefore.join(', ')}] → [${day.keysAfter.join(', ')}]`,
        });
      }
    }
  }

  for (const signal of signals) reasons.push(`${signal.id}: ${signal.detail}`);
  const checked = true;
  return {
    checked,
    blocked: signals.length > 0,
    forced: false,
    reasons,
    signals,
    threshold: DRIFT_TRIP_THRESHOLD,
    baseline: input.baselinePath,
    totals: { before: totals.before, after: totals.after, deltaPct },
    routes,
    skippedReason: null,
  };
}

/** `--force-publish` — 보류를 해제하고 발행. **강제 발행 사실을 남긴다**(조용한 우회 금지). */
export function forceDrift(report: DriftReport): DriftReport {
  if (!report.blocked) return report;
  return { ...report, blocked: false, forced: true };
}

/** 사람이 5분 안에 판단할 수 있는 **비교 표**(텍스트 — 아티팩트로 첨부) */
export function driftTableText(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`T35 드리프트 게이트 — checked=${String(report.checked)} blocked=${String(report.blocked)} forced=${String(report.forced)}`);
  lines.push(`직전 발행본: ${report.baseline ?? '(없음)'} · 임계 ±${String(report.threshold * 100)}% · 건너뜀 사유: ${report.skippedReason ?? '-'}`);
  lines.push(`전체 편 수: ${String(report.totals.before)} → ${String(report.totals.after)} (${report.totals.deltaPct >= 0 ? '+' : ''}${String(report.totals.deltaPct)}%)`);
  lines.push('');
  lines.push('노선×요일 비교 (편 수 · 열 의미 키 집합)');
  lines.push('| 노선 | 요일 | 직전 | 신규 | 열 키 변경 |');
  lines.push('|---|---|---|---|---|');
  for (const route of report.routes) {
    for (const day of route.days) {
      const keysChanged = day.keysBefore.length > 0 && day.keysAfter.length > 0 && JSON.stringify(day.keysBefore) !== JSON.stringify(day.keysAfter) ? 'O' : '-';
      lines.push(`| ${route.routeId} | ${day.dayType} | ${String(day.before)} | ${String(day.after)} | ${keysChanged} |`);
    }
  }
  lines.push('');
  lines.push(report.signals.length === 0 ? '신호: 없음(정상)' : `신호 ${String(report.signals.length)}건:`);
  for (const signal of report.signals) lines.push(`  - ${signal.id}: ${signal.detail}`);
  return `${lines.join('\n')}\n`;
}
