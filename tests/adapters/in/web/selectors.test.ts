/**
 * 화면 문구 매핑 테스트 — 도메인 상태별로 화면에 **무엇이 뜨는지** 고정한다(수용 기준 매핑표의 실행 증거).
 */
import { describe, expect, it } from 'vitest';
import { ScheduleStore, type ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import {
  dayTabs,
  freshnessView,
  nextBusView,
  noticeGroups,
  selectedDayTable,
} from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import { buildFixtureModel, clockAt, NOW } from './fixtures';

const model = buildFixtureModel();

function state(overrides: Partial<ScheduleState> = {}): ScheduleState {
  return {
    status: 'ready',
    model,
    errorMessage: null,
    dayType: 'weekday',
    routeId: 'route-a',
    nowMs: NOW,
    ...overrides,
  };
}

describe('nextBusView — 도메인 상태 → 화면 문구', () => {
  it('ok: 오늘 회차는 시각·남은 시간과 함께, 3개까지', () => {
    const view = nextBusView(state());
    expect(view.domainStatus).toBe('ok');
    expect(view.tone).toBe('ok');
    expect(view.title).toBe('오늘 08:05 출발');
    expect(view.subtitle).toBe('약 25분 후');
    expect(view.departures).toHaveLength(3);
    expect(view.departures.map((departure) => departure.departure)).toEqual(['08:05', '09:05', '10:05']);
  });

  it('ok: 당일 회차가 없으면 "내일 08:05" 처럼 다음 운행일을 보여준다(대체휴일 → 평일 회차)', () => {
    const view = nextBusView(state({ nowMs: Date.parse('2026-10-05T14:40:00+09:00') }));
    expect(view.title).toBe('내일 08:05 출발');
    expect(view.departures[0]?.dayLabel).toBe('내일');
  });

  it('no-service-today: 사유(원본 안내문 원문)를 먼저 담는다', () => {
    const view = nextBusView(state({ nowMs: Date.parse('2026-10-09T09:00:00+09:00') }));
    expect(view.domainStatus).toBe('no-service-today');
    expect(view.tone).toBe('warn');
    expect(view.reason).toContain('한글날');
    expect(view.title).toBe('오늘은 셔틀버스 운행이 없습니다');
    expect(view.subtitle).toContain('다음 운행');
  });

  it('empty-schedule: 빈 표는 "안내할 회차 없음" + 도메인 사유 문구', () => {
    const view = nextBusView(state({ routeId: 'route-b' }));
    expect(view.domainStatus).toBe('empty-schedule');
    expect(view.title).toContain('안내할 회차가 없습니다');
    expect(view.subtitle).toContain('요일 표가 비어 있습니다');
  });

  it('운행 중단 노선은 상태와 원본 문구를 보여준다(F2b)', () => {
    const view = nextBusView(state({ routeId: 'route-suspended' }));
    expect(view.domainStatus).toBe('suspended-route');
    expect(view.tone).toBe('warn');
    expect(view.title).toBe('운행 중단 노선입니다');
    expect(view.reason).toContain('운행하지 않습니다');
  });

  it('원본에 그 요일 표가 없으면 이유를 설명한다', () => {
    const view = nextBusView(state({ dayType: 'sunday' }));
    expect(view.domainStatus).toBe('no-data-table');
    expect(view.title).toContain('일요일 시간표가 이 노선에 없습니다');
  });

  it('unknown-route: 빈 화면 대신 노선 id·등록 목록을 보여준다', () => {
    const broken = { ...model, schedule: { ...model.schedule, routes: [] } };
    const view = nextBusView(state({ model: broken, routeId: 'route-a' }));
    expect(view.domainStatus).toBe('unknown-route');
    expect(view.title).toBe('노선 정보를 찾을 수 없습니다');
    expect(view.subtitle).toContain('요청한 노선 id: route-a');
  });

  it('데이터 로딩 전에도 카드가 문구를 갖는다(빈 화면 금지)', () => {
    const view = nextBusView(state({ model: null, routeId: null }));
    expect(view.domainStatus).toBe('no-route-selected');
    expect(view.title).toBe('시간표를 불러오는 중…');
  });
});

describe('freshnessView — 신선도(F5)', () => {
  it('원본 최근 업데이트와 우리 반영 시각을 함께, 48시간 초과는 경고', () => {
    const view = freshnessView(model, NOW);
    expect(view.rows.map((row) => row.key)).toEqual(['source-updated-at', 'fetched-at']);
    expect(view.rows[1]?.value).toBe('2026-10-05 14:39 (KST)');
    // 2026-08-20 원본 업데이트는 48시간 초과 → 경고 1건
    expect(view.rows[0]?.stale).toBe(true);
    expect(view.warnings.some((warning) => warning.includes('원본 페이지 최근 업데이트'))).toBe(true);
  });

  it('우리 반영 시각이 48시간을 넘으면 경고가 늘어난다', () => {
    const stale = { ...model, source: { ...model.source, fetchedAt: '2026-10-01T00:00:00+09:00' } };
    const view = freshnessView(stale, NOW);
    expect(view.rows[1]?.stale).toBe(true);
    expect(view.warnings.some((warning) => warning.includes('우리 반영 시각'))).toBe(true);
  });
});

describe('noticeGroups · dayTabs', () => {
  it('안내문은 원문(raw)을 우선 표시한다', () => {
    const groups = noticeGroups(model);
    expect(groups.noService).toHaveLength(1);
    expect(groups.noService[0]?.text).toContain('[10. 9.(금)]');
    expect(groups.alternate).toHaveLength(1);
    expect(groups.notices).toHaveLength(1);
  });

  it('요일 탭은 그 요일에 표가 있는 노선 수를 보여준다(주말은 노선이 적다)', () => {
    const tabs = dayTabs(state());
    expect(tabs.map((tab) => tab.routesWithTable)).toEqual([2, 1, 1]);
    expect(tabs[0]?.isToday).toBe(true);
    expect(tabs[0]?.routeTotal).toBe(4);
  });
});

describe('ScheduleStore', () => {
  it('요일을 바꾸면 그 요일에 표가 없는 노선은 표가 있는 노선으로 옮긴다', () => {
    const store = new ScheduleStore(state());
    store.selectDay('sunday');
    expect(store.getState().routeId).toBe('route-c');
    store.selectDay('saturday');
    expect(store.getState().routeId).toBe('route-a');
  });

  it('로딩 실패는 상태로 남고 이전 데이터는 유지된다(F8)', () => {
    const store = new ScheduleStore(state());
    store.setError('네트워크 요청 실패: Failed to fetch');
    expect(store.getState().status).toBe('error');
    expect(store.getState().model).not.toBeNull();
    expect(store.getState().errorMessage).toContain('Failed to fetch');
  });

  it('시각 틱은 값이 같으면 알리지 않는다', () => {
    const store = new ScheduleStore(state());
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const before = notifications;
    store.tick(NOW);
    expect(notifications).toBe(before);
    store.tick(NOW + 60_000);
    expect(notifications).toBe(before + 1);
  });

  it('선택 요일의 표를 조회한다', () => {
    const store = new ScheduleStore(state());
    expect(selectedDayTable(store.getState())?.rows).toHaveLength(4);
    store.selectDay('saturday');
    expect(selectedDayTable(store.getState())?.rows).toHaveLength(1);
  });

  it('clock 주입으로 만든 시각 기준으로 동작한다(도메인은 Date.now 금지)', () => {
    const clock = clockAt('2026-10-06T07:40:00+09:00');
    expect(clock.now().getTime()).toBe(NOW);
  });
});
