/**
 * T37 — `현재 시간으로` 의 "오늘이 아니면 묻지 않고 이동" (docs/07-mobile-ux.md §15-2 · AC-U15-2).
 *
 * 버튼이 **되묻지 않고**(예전 `오늘 보기` 확인형 제거) 무엇을 하는지를 순수 함수로 고정한다(DOM 없이 — jsdom 미설치 정책).
 *  ① 선택 요일 ≠ 오늘      → `오늘로 이동합니다` + **이동 실행**(`moveToToday`) — 화면은 1.5초만 알린다
 *  ② 오늘이고 편 0건        → `오늘 시간표에 해당하는 편이 없습니다` (알리기만 · 옮길 대상이 없다)
 *  ③ 오늘이고 남은 편 없음  → `오늘 남은 편이 없습니다 · 다음 운행: <날짜(요일)> <시각>` (정보 1줄)
 *  ④ 오늘이고 남은 편 있음  → 안내 없음(null — 그냥 스크롤)
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

describe('moveNowHint — 오늘이면 안내 없이 스크롤한다(§15-2 ④)', () => {
  it('오늘(화요일) 버킷이고 남은 편이 있으면 null', () => {
    expect(moveNowHint(state())).toBeNull();
  });

  it('오늘 버킷에서 막차 전(10:00)이면 null', () => {
    expect(moveNowHint(at('2026-10-06T10:00:00+09:00'))).toBeNull();
  });
});

describe('moveNowHint — 오늘이 아닌 요일이면 **묻지 않고** 오늘로 이동(§15-2 ①)', () => {
  it('토요일을 보는 중(오늘=화요일) — `오늘로 이동합니다` + 이동 실행 · 액션 버튼 없음', () => {
    const hint = moveNowHint(state({ dayType: 'saturday' }));
    expect(hint).toEqual({ kind: 'other-day', message: '오늘로 이동합니다', moveToToday: true });
  });

  it('일요일을 보는 중(오늘=수요일) — 어느 요일을 보든 같은 안내·같은 이동', () => {
    const hint = moveNowHint(at('2026-10-07T09:00:00+09:00', { dayType: 'sunday' }));
    expect(hint).toEqual({ kind: 'other-day', message: '오늘로 이동합니다', moveToToday: true });
  });

  it('오늘이 운행 없는 날이어도 **되묻지 않는다** — 이동을 실행하고 안내는 짧게(§15-2)', () => {
    // `오늘 보기` 확인형이 없어졌으므로 "오늘로 갈지" 판단은 앱이 한다 — 판정은 요일 비교만 본다.
    const hint = moveNowHint(state({ dayType: 'sunday', model: emptyModel }));
    expect(hint).toEqual({ kind: 'other-day', message: '오늘로 이동합니다', moveToToday: true });
  });
});

describe('moveNowHint — 오늘인데 남은 편이 없으면 다음 운행을 알린다(§15-2 ③)', () => {
  it('막차 이후(23:00) — `다음 운행: 10월 7일 (수) 08:05` · 이동하지 않는다', () => {
    const hint = moveNowHint(at('2026-10-06T23:00:00+09:00'));
    expect(hint).toEqual({
      kind: 'today-over',
      message: '오늘 남은 편이 없습니다 · 다음 운행: 10월 7일 (수) 08:05',
      moveToToday: false,
    });
  });

  it('다음 운행 편을 알 수 없으면 문구만 남는다(추측 금지)', () => {
    const hint = moveNowHint(at('2026-10-06T23:00:00+09:00', { model: emptyModel }));
    // 발행물에 회차가 아예 없으면 ②(편 0건)가 먼저 걸린다 — 다음 운행을 지어내지 않는다.
    expect(hint).toEqual({ kind: 'no-trips', message: '오늘 시간표에 해당하는 편이 없습니다', moveToToday: false });
  });
});

describe('moveNowHint — 오늘 시간표에 편이 0건이면 빈 결과를 그대로 알린다(§15-2 ②)', () => {
  it('오늘 요일(화요일) 자체가 0건 — 옮길 곳이 없으니 이동하지 않는다', () => {
    const hint = moveNowHint(state({ model: emptyModel, dayType: 'weekday' }));
    expect(hint).toEqual({ kind: 'no-trips', message: '오늘 시간표에 해당하는 편이 없습니다', moveToToday: false });
  });
});
