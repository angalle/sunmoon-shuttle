/**
 * T24 — [전체] 화면의 전체 편 목록(`fullDayView`) 테스트 (docs/07-mobile-ux.md §4-2).
 *
 * [지금]의 "오늘 남은 편"과 달리 **그 요일의 모든 회차**(지난 편 포함)를 담는다.
 * 판정(운행 여부·사유)은 도메인 몫이므로 여기서는 **표시 계층의 계약**만 고정한다:
 * ① 빈 모델 ② 출발 시각 오름차순 ③ 운행 중단 노선 제외 ④ 방향 필터는 목록만 줄인다 ⑤ 기준일(사유 판정일).
 */
import { describe, expect, it } from 'vitest';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import { fullDayView } from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import { buildFixtureModel, NOW } from './fixtures';

const model = buildFixtureModel();

function state(overrides: Partial<ScheduleState> = {}): ScheduleState {
  return {
    status: 'ready',
    model,
    errorMessage: null,
    dataSource: 'network',
    cacheAgeMs: null,
    offlineReason: null,
    dayType: 'weekday',
    routeId: 'route-a',
    nowMs: NOW,
    ...overrides,
  };
}

const minuteOf = (hhmm: string): number => {
  const [hour = '0', minute = '0'] = hhmm.split(':');
  return Number(hour) * 60 + Number(minute);
};

describe('fullDayView — [전체] 화면의 전체 편 목록', () => {
  it('모델이 없으면 빈 목록이고 편수도 0이다(빈 화면은 컴포넌트가 문구로 막는다)', () => {
    const view = fullDayView(state({ model: null }));
    expect(view.trips).toEqual([]);
    expect(view.total).toBe(0);
    expect(view.counts).toEqual({ all: 0, out: 0, in: 0 });
    expect(view.referenceDate).toBe('');
    expect(view.dayLabel).toBe('평일');
  });

  it('선택한 요일의 회차를 출발 시각 오름차순으로 담는다(첫 편 08:05)', () => {
    const view = fullDayView(state());
    expect(view.total).toBeGreaterThanOrEqual(3);
    expect(view.trips.map((trip) => trip.departure).at(0)).toBe('08:05');
    const minutes = view.trips.map((trip) => minuteOf(trip.departure));
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it('운행 중단 노선(status=suspended)의 회차는 전체 목록에도 올리지 않는다', () => {
    const view = fullDayView(state());
    expect(view.trips.every((trip) => trip.routeId !== 'route-suspended')).toBe(true);
    expect(view.total).toBe(view.trips.length);
  });

  it('방향 필터는 목록만 줄이고 전체 편수(total)·방향별 편수는 그대로다', () => {
    const all = fullDayView(state(), 'all');
    const out = fullDayView(state(), 'out');
    const inbound = fullDayView(state(), 'in');
    expect(out.counts).toEqual(all.counts);
    expect(inbound.counts).toEqual(all.counts);
    expect(out.total).toBe(all.total);
    expect(out.trips.every((trip) => trip.direction === 'out')).toBe(true);
    expect(inbound.trips.every((trip) => trip.direction === 'in')).toBe(true);
    expect(out.trips.length + inbound.trips.length).toBe(all.total);
  });

  it('사유 판정 기준일은 선택한 요일이 돌아오는 날이다(오늘이 그 요일이면 오늘)', () => {
    const monday = new Date('2026-10-05T14:40:00+09:00').getTime(); // 월요일
    const view = fullDayView(state({ dayType: 'weekday', nowMs: monday }));
    expect(view.referenceDate).toBe('2026-10-05');

    // 토요일 탭은 다음 토요일(2026-10-10)을 기준으로 사유를 판정한다.
    const saturday = fullDayView(state({ dayType: 'saturday', nowMs: monday }));
    expect(saturday.referenceDate).toBe('2026-10-10');
  });

  it('편의 사유 배지·소요시간은 도메인/데이터 값에서 온다(배지 문자열은 확정 enum 문구)', () => {
    const view = fullDayView(state({ dayType: 'weekday', nowMs: new Date('2026-10-19T08:00:00+09:00').getTime() }));
    const badges = view.trips.flatMap((trip) => trip.badges);
    for (const text of badges) expect(typeof text).toBe('string');
    expect(view.trips.every((trip) => trip.directionLabel === '학교에서 출발' || trip.directionLabel === '학교로 도착')).toBe(true);
  });
});
