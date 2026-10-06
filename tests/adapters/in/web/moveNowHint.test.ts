/**
 * T29 — `현재 시간으로` 의 "오늘 아님" 안내 (docs/07-mobile-ux.md §11-2 · AC-U11-5).
 *
 * 버튼이 **그냥 스크롤하면 안 되는** 네 가지 상황을 순수 함수로 고정한다(DOM 없이 — jsdom 미설치 정책).
 * 문구는 문서의 표를 **그대로** 쓰는지 확인한다(값·날짜는 도메인/`timetableView` 결과에서 온다).
 *  ① 이 시간표에 편 0건      → `오늘 시간표에 해당하는 편이 없습니다` (+ 오늘이 다른 요일이면 `오늘 보기`)
 *  ② 오늘이 아닌 요일        → `오늘은 <오늘요일>이 아닙니다 · 오늘(<오늘요일>) 시간표로 이동할까요?` + `오늘 보기`
 *  ③ 오늘이고 남은 편 없음    → `오늘 남은 편이 없습니다 · 다음 운행: <날짜(요일)> <시각>`
 *  ④ 오늘이고 남은 편 있음    → 안내 없음(null — 그냥 스크롤)
 */
import { describe, expect, it } from 'vitest';
import { parseTimetable } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import { moveNowHint } from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import { FIXTURE_RAW, buildFixtureModel, NOW } from './fixtures';

const model = buildFixtureModel();
/** 회차가 하나도 없는 발행물(운행 없는 날/빈 시간표에서의 안내 확인용). */
const emptyModel = parseTimetable({ ...(FIXTURE_RAW as Record<string, unknown>), routes: [] });

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
    nowMs: NOW, // 2026-10-06(화) 07:40
    ...overrides,
  };
}

const at = (kstIso: string, overrides: Partial<ScheduleState> = {}): ScheduleState =>
  state({ nowMs: Date.parse(kstIso), ...overrides });

describe('moveNowHint — 오늘이면 안내 없이 스크롤한다(§11-2 표 2행)', () => {
  it('오늘(화요일) 버킷이고 남은 편이 있으면 null', () => {
    expect(moveNowHint(state())).toBeNull();
  });

  it('오늘 버킷에서 막차 전(10:00)이면 null', () => {
    expect(moveNowHint(at('2026-10-06T10:00:00+09:00'))).toBeNull();
  });
});

describe('moveNowHint — 오늘이 아닌 요일이면 안내 + `오늘 보기`(§11-2 표 1행)', () => {
  it('토요일을 보는 중(오늘=화요일) — 문구에 오늘 요일이 두 번 들어간다', () => {
    const hint = moveNowHint(state({ dayType: 'saturday' }));
    expect(hint).toEqual({
      kind: 'other-day',
      message: '오늘은 화요일이 아닙니다 · 오늘(화요일) 시간표로 이동할까요?',
      showTodayAction: true,
    });
  });

  it('일요일을 보는 중(오늘=수요일) — 요일 이름이 오늘을 따라간다', () => {
    const hint = moveNowHint(at('2026-10-07T09:00:00+09:00', { dayType: 'sunday' }));
    expect(hint?.kind).toBe('other-day');
    expect(hint?.message).toBe('오늘은 수요일이 아닙니다 · 오늘(수요일) 시간표로 이동할까요?');
    expect(hint?.showTodayAction).toBe(true);
  });
});

describe('moveNowHint — 오늘인데 남은 편이 없으면 다음 운행을 알린다(§11-2 표 3행)', () => {
  it('막차 이후(23:00) — `다음 운행: 10월 7일 (수) 08:05`', () => {
    const hint = moveNowHint(at('2026-10-06T23:00:00+09:00'));
    expect(hint).toEqual({
      kind: 'today-over',
      message: '오늘 남은 편이 없습니다 · 다음 운행: 10월 7일 (수) 08:05',
      showTodayAction: false,
    });
  });

  it('다음 운행 편을 알 수 없으면 문구만 남는다(추측 금지)', () => {
    const hint = moveNowHint(at('2026-10-06T23:00:00+09:00', { model: emptyModel }));
    // 발행물에 회차가 아예 없으면 ①(편 0건)이 먼저 걸린다 — 다음 운행을 지어내지 않는다.
    expect(hint?.kind).toBe('no-trips');
    expect(hint?.message).toBe('오늘 시간표에 해당하는 편이 없습니다');
  });
});

describe('moveNowHint — 이 시간표에 편이 0건이면 빈 결과를 그대로 알린다(§11-2 표 4행)', () => {
  it('오늘이 다른 요일(일요일 보기) — `오늘 보기` 액션이 붙는다', () => {
    const hint = moveNowHint(state({ model: emptyModel, dayType: 'sunday' }));
    expect(hint).toEqual({
      kind: 'no-trips',
      message: '오늘 시간표에 해당하는 편이 없습니다',
      showTodayAction: true,
    });
  });

  it('오늘 요일(화요일) 자체가 0건(운행 없는 날) — 오늘로 옮길 곳이 없으니 액션 없음', () => {
    const hint = moveNowHint(state({ model: emptyModel, dayType: 'weekday' }));
    expect(hint).toEqual({
      kind: 'no-trips',
      message: '오늘 시간표에 해당하는 편이 없습니다',
      showTodayAction: false,
    });
  });
});
