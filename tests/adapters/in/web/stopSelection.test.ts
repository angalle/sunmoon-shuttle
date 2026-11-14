/**
 * 시안 A — 요일 · **정류장** · 방향 (2026-11-08 사용자 결정 · `전체` 없음)
 *
 * 발행 데이터(data/timetable.json)로 선택자 계약을 고정한다:
 *  ① 정류장 선택지 = 운행 중인 노선(운행 중단·편 0 노선 제외) · 데이터 순서
 *  ② 정류장을 고르면 그 노선의 편만 · 편수(counts)도 그 노선 기준
 *  ③ 방향 라벨 = `천안역 → 학교` / `학교 → 천안역`
 *  ④ 저장값이 선택지에 없으면 첫 정류장
 *  ⑤ 그 요일에 다니지 않는 정류장은 0편(흐린 칩) — 빈 목록은 그 이유를 말한다
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTimetable } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import {
  directionLabelFor,
  resolveStopId,
  stopOptions,
  timetableView,
} from '../../../../src/adapters/in/web/features/schedule/store/selectors';

const model = parseTimetable(JSON.parse(readFileSync('data/timetable.json', 'utf8')) as unknown);
/** 2026-11-09(월) 08:20 KST — 평일 */
const MONDAY = Date.parse('2026-11-09T08:20:00+09:00');

function state(overrides: Partial<ScheduleState> = {}): ScheduleState {
  return {
    status: 'ready',
    model,
    errorMessage: null,
    dataSource: 'network',
    cacheAgeMs: null,
    offlineReason: null,
    dayType: 'weekday',
    routeId: null,
    nowMs: MONDAY,
    ...overrides,
  };
}

describe('정류장 선택지', () => {
  it('운행 중인 4개 노선만 · 데이터 순서 · `전체` 없음', () => {
    const options = stopOptions(state());
    expect(options.map((option) => option.id)).toEqual(['asan-ktx', 'cheonan-station', 'cheonan-terminal', 'onyang']);
    expect(options.some((option) => option.id === 'cheonan-campus')).toBe(false); // 운행 중단
    expect(options.some((option) => option.name === '전체')).toBe(false);
  });

  it('편수는 화면 목록과 같은 판정 — 평일 합계 = 노선별 합', () => {
    const options = stopOptions(state());
    const total = timetableView(state(), 'all').rows.length;
    expect(options.reduce((sum, option) => sum + option.count, 0)).toBe(total);
    expect(options.every((option) => option.count > 0)).toBe(true);
  });

  it('주말에는 온양 노선이 0편(흐린 칩)이고 숨기지 않는다', () => {
    const saturday = stopOptions(state({ dayType: 'saturday', nowMs: Date.parse('2026-11-14T08:20:00+09:00') }));
    expect(saturday.find((option) => option.id === 'onyang')?.count).toBe(0);
  });

  it('저장값이 선택지에 있으면 그대로, 없으면 첫 정류장', () => {
    const options = stopOptions(state());
    expect(resolveStopId(options, 'cheonan-terminal')).toBe('cheonan-terminal');
    expect(resolveStopId(options, 'cheonan-campus')).toBe('asan-ktx');
    expect(resolveStopId(options, null)).toBe('asan-ktx');
    expect(resolveStopId([], 'x')).toBeNull();
  });
});

describe('정류장으로 좁힌 시간표', () => {
  it('고른 노선의 편만 · 편수도 그 노선 기준 · 방향 섞임 0', () => {
    const view = timetableView(state(), 'in', 'cheonan-station');
    expect(view.stopName).toBe('천안역');
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows.every((row) => row.routeId === 'cheonan-station' && row.direction === 'in')).toBe(true);
    const all = timetableView(state(), 'all', 'cheonan-station');
    expect(view.counts.in + view.counts.out).toBe(all.rows.length);
  });

  it('방향 라벨 — 정류장 이름으로 바뀌고, 정류장을 모르면 기존 라벨', () => {
    expect(directionLabelFor('in', '천안역')).toBe('천안역 → 학교');
    expect(directionLabelFor('out', '천안역')).toBe('학교 → 천안역');
    expect(directionLabelFor('in', null)).toBe('학교 도착');
  });

  it('0편 방향의 전환 버튼도 정류장 라벨을 쓴다', () => {
    // 온양 노선은 평일 학교 출발(out) 편이 0 이면 전환 버튼이 `온양역/터미널 → 학교 편 보기` 다
    const view = timetableView(state(), 'out', 'onyang');
    if (view.rows.length === 0) {
      expect(view.emptySwitch?.label).toBe('온양역/터미널 → 학교 편 보기');
    } else {
      expect(view.emptySwitch).toBeNull();
    }
  });

  it('그 요일에 다니지 않는 정류장 — 0편 · 운행 없는 날이 아님(빈 목록이 이유를 말할 수 있다)', () => {
    const view = timetableView(state({ dayType: 'saturday', nowMs: Date.parse('2026-11-14T08:20:00+09:00') }), 'in', 'onyang');
    expect(view.total).toBe(0);
    expect(view.noService).toBe(false);
    expect(view.stopName).toBe('온양역/터미널');
  });
});

describe('왕복 편 — 학교 출발 편의 역·터미널 출발 시각은 학교행 편이기도 하다', () => {
  it('평일 아산(KTX)역: 학교행 = 역 출발 편 + 왕복 편의 돌아오는 편 (월요일은 모든 편 운행)', () => {
    const raw = JSON.parse(readFileSync('data/timetable.json', 'utf8')) as {
      routes: { id: string; byDay: Record<string, { trips: Record<string, unknown>[] } | null> }[];
    };
    const trips = raw.routes.find((route) => route.id === 'asan-ktx')?.byDay['weekday']?.trips ?? [];
    const inOnly = trips.filter((t) => t['depCampus'] == null && t['depStation'] != null).length;
    const roundTrips = trips.filter((t) => t['depCampus'] != null && t['depStation'] != null && t['arrCampus'] != null).length;
    const view = timetableView(state(), 'in', 'asan-ktx');
    expect(roundTrips).toBeGreaterThan(0);
    expect(view.counts.in).toBe(inOnly + roundTrips);
    expect(view.rows.every((row) => row.arrival !== null)).toBe(true);
  });

  it('돌아오는 편은 역 출발 시각으로 정렬되고 key 가 겹치지 않는다', () => {
    const view = timetableView(state(), 'all', 'asan-ktx');
    const keys = view.rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    const times = view.rows.map((row) => row.departure);
    expect([...times].sort()).toEqual(times);
  });

  it('주말에도 `역 → 학교` 편이 있다(예전엔 0편으로 보였다)', () => {
    const sunday = timetableView(state({ dayType: 'sunday', nowMs: Date.parse('2026-11-15T08:20:00+09:00') }), 'in', 'asan-ktx');
    expect(sunday.rows.length).toBeGreaterThan(0);
  });
});

describe('중간 정류장 출발 편 — 학교·역 시각 없이 중간 정류장에만 시각이 있는 편(T2b 5건)', () => {
  /** 2026-11-16(월) 06:00 — 모든 편 운행 */
  const monday = state({ nowMs: Date.parse('2026-11-16T06:00:00+09:00') });
  const find = (stopId: string, departure: string) =>
    timetableView(monday, 'in', stopId).rows.find((row) => row.departure === departure);

  it('천안역 노선 하이렉스파 건너편 08:50 · 천안터미널 노선 두정동 맥도날드 08:55', () => {
    expect(find('cheonan-station', '08:50')).toMatchObject({ originLabel: '하이렉스파 건너편', arrival: '09:05' });
    expect(find('cheonan-terminal', '08:55')).toMatchObject({ originLabel: '두정동 맥도날드', arrival: '09:10' });
  });

  it('온양 노선 아침 3편 — 출발 시각은 온양온천역, 더 앞 정류장(주은아파트)에서 출발하면 그 시각을 함께 적는다', () => {
    expect(find('onyang', '08:10')).toMatchObject({ originLabel: '주은아파트 버스정류장 08:00', arrival: '08:40' });
    expect(find('onyang', '08:45')).toMatchObject({ originLabel: null, arrival: '09:15' });
    expect(find('onyang', '08:50')).toMatchObject({ originLabel: '주은아파트 버스정류장 08:40', arrival: '09:20' });
  });

  it('요일 제외는 그대로 지킨다 — 금요일에는 `금(X)` 편(온양 08:45)이 빠진다', () => {
    const friday = state({ nowMs: Date.parse('2026-11-20T06:00:00+09:00') });
    const rows = timetableView(friday, 'in', 'onyang').rows;
    expect(rows.some((row) => row.departure === '08:45')).toBe(false);
  });

  it('온양 노선 왕복 편도 돌아오는 편(온양온천역 → 학교)이 잡힌다', () => {
    const inbound = timetableView(monday, 'in', 'onyang').rows;
    const outbound = timetableView(monday, 'out', 'onyang').rows;
    expect(outbound.length).toBeGreaterThan(0);
    expect(inbound.length).toBe(3 + outbound.length);
  });
});
