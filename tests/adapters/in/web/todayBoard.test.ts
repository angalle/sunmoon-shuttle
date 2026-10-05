/**
 * V1 간편 홈 보드(T12) 테스트 — 수용 기준 1(신규 테스트 ≥12)의 실행 증거.
 *
 * 검증 대상은 **순수 선택자**(`todayBoardView`·`serviceNoticeView`)와 표시 포맷이다.
 * 도메인 계산(요일·시각·운행 판정·남은 시간)은 `src/domain/**` 몫이므로 여기서 다시 계산하지 않는다.
 *
 * 기준 시각 두 가지(픽스처에서 유도)
 *  - EARLY(07:00): 아직 지난 편이 없어 **모든 회차**가 남아 있다(목록 잘림·특이사항 검증).
 *  - MORNING(08:01): 07:30·08:00 편이 지난 뒤(지난 편 제외·상위 3편 검증).
 */
import { describe, expect, it } from 'vitest';
import { parseTimetable } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import {
  BOARD_LIST_LIMIT,
  serviceNoticeView,
  todayBoardView,
  type DepartureEventView,
} from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import { formatKstClockLabel, formatKstDayLabel } from '../../../../src/adapters/in/web/shared/lib/format';
import { BOARD_RAW } from './boardFixtures';

const model = parseTimetable(BOARD_RAW);

const EARLY = '2026-10-06T07:00:00+09:00';
const MORNING = '2026-10-06T08:01:00+09:00';

function state(now: string, overrides: Partial<ScheduleState> = {}): ScheduleState {
  return {
    status: 'ready',
    model,
    errorMessage: null,
    dataSource: 'network',
    cacheAgeMs: null,
    offlineReason: null,
    dayType: 'weekday',
    routeId: 'r-asan',
    nowMs: Date.parse(now),
    ...overrides,
  };
}

const departuresOf = (events: readonly DepartureEventView[]): string[] => events.map((event) => event.departure);

describe('상태줄 — 오늘 날짜·현재 시각(KST)', () => {
  it('주입된 clock 을 `10월 6일 (화) 07:00` / `2026-10-06 (화)` 로 표시한다', () => {
    const now = Date.parse(EARLY);
    expect(formatKstClockLabel(now)).toBe('10월 6일 (화) 07:00');
    expect(formatKstDayLabel(now)).toBe('2026-10-06 (화)');
    const board = todayBoardView(state(EARLY));
    expect(board.clockLabel).toBe('10월 6일 (화) 07:00');
    expect(board.dateLabel).toBe('2026-10-06 (화)');
  });
});

describe('오늘 자동 dayType 선택(수동 기본값 제거)', () => {
  it('달력 요일을 now 에서만 유도한다(화=평일, 토=토요일, 일=일요일)', () => {
    expect(todayBoardView(state('2026-10-06T07:00:00+09:00')).calendarDayType).toBe('weekday');
    expect(todayBoardView(state('2026-10-10T07:00:00+09:00')).calendarDayType).toBe('saturday');
    expect(todayBoardView(state('2026-10-11T07:00:00+09:00')).calendarDayType).toBe('sunday');
  });

  it('상태에 남아 있는 수동 dayType 은 보드 계산에 쓰이지 않는다', () => {
    const board = todayBoardView(state(EARLY, { dayType: 'sunday' }));
    expect(board.calendarDayType).toBe('weekday');
    expect(board.effectiveDayType).toBe('weekday');
    expect(departuresOf(board.next)).toContain('08:05');
  });
});

describe('공지 배너 — resolveDayService 결과만 쓴다', () => {
  it('대체 시간표(2026-10-05 개천절 대체휴일): "일요일 시간표로 운행합니다" + 근거 안내문', () => {
    const view = serviceNoticeView(state('2026-10-05T10:00:00+09:00'));
    expect(view).not.toBeNull();
    expect(view?.kind).toBe('alternate');
    expect(view?.title).toBe('일요일 시간표로 운행합니다');
    expect(view?.detail).toContain('개천절대체휴일');
  });

  it('대체휴일에는 적용 시간표(일요일) 회차와 편수를 쓴다', () => {
    const board = todayBoardView(state('2026-10-05T10:00:00+09:00'));
    expect(board.effectiveDayType).toBe('sunday');
    expect(board.notice?.kind).toBe('alternate');
    // 일요일 표 = r-sunday 2편(09:00·12:00). 10:00 기준 남은 편은 12:00 하나.
    expect(board.todayTotal).toBe(2);
    expect(board.counts.all).toBe(1);
    expect(departuresOf(board.next)).toEqual(['12:00']);
    expect(board.nextIsToday).toBe(true);
  });

  it('운행 없음(2026-10-09 한글날): 배너 제목 + 원본 사유, 상태 no-service', () => {
    const board = todayBoardView(state('2026-10-09T09:00:00+09:00'));
    expect(board.status).toBe('no-service');
    expect(board.notice?.kind).toBe('no-service');
    expect(board.notice?.title).toBe('오늘 셔틀버스 운행이 없습니다');
    expect(board.notice?.detail).toBe('사유: 한글날: 셔틀버스 운행 없음');
    expect(board.counts.all).toBe(0);
    expect(board.todayTotal).toBe(0);
  });

  it('안내문이 없는 평일에는 배너가 없다', () => {
    expect(serviceNoticeView(state(EARLY))).toBeNull();
    expect(todayBoardView(state(EARLY)).notice).toBeNull();
  });
});

describe('다음 출발 카드 — 노선 통합 상위 편', () => {
  it('노선을 통합해 출발 시각 오름차순 상위 3편을 준다', () => {
    const board = todayBoardView(state(MORNING));
    expect(departuresOf(board.next)).toEqual(['08:05', '08:30', '09:00']);
    expect(board.next.map((event) => event.routeId)).toEqual(['r-cheonan', 'r-asan', 'r-asan']);
    expect(board.next).toHaveLength(3);
  });

  it('지난 편은 넣지 않는다(도메인 반환만 사용)', () => {
    const nowMs = Date.parse(MORNING);
    const board = todayBoardView(state(MORNING));
    expect(board.events.length).toBeGreaterThan(0);
    for (const event of board.events) {
      expect(Date.parse(event.departureAt)).toBeGreaterThanOrEqual(nowMs);
    }
    // 07:30(r-cheonan)·08:00(r-asan) 편은 기준 시각 이전이라 빠진다.
    expect(departuresOf(board.events)).not.toContain('07:30');
    expect(departuresOf(board.events)).not.toContain('08:00');
  });

  it('방향·도착 시각·특이사항·남은 시간을 함께 준다', () => {
    const board = todayBoardView(state(EARLY));
    const out = board.events.find((event) => event.routeId === 'r-asan' && event.departure === '08:00');
    const inbound = board.events.find((event) => event.routeId === 'r-asan' && event.departure === '08:30');
    expect(out?.direction).toBe('out');
    expect(out?.directionLabel).toBe('학교에서 출발');
    expect(out?.arrival).toBe('08:20');
    expect(out?.notes).toContain('0:15');
    expect(inbound?.direction).toBe('in');
    expect(inbound?.directionLabel).toBe('학교로 도착');
    expect(inbound?.arrival).toBe('08:45');
    expect(inbound?.notes).toContain('금(X)');
    // 남은 시간은 도메인 값(remainingMinutes/remaining)만 쓴다.
    const first = board.next.at(0);
    expect(first?.departure).toBe('07:30');
    expect(first?.remainingMinutes).toBe(30);
    expect(first?.remaining).toBe('약 30분 후');
  });

  it('운행 중단 노선은 등장하지 않는다(F2b — 원본 패널이 사유를 보여준다)', () => {
    const board = todayBoardView(state(MORNING));
    expect(board.events.some((event) => event.routeId === 'r-suspended')).toBe(false);
    expect(board.counts.all).toBe(17);
  });

  it('해석하지 못한 원본 표기는 경고로 모아 남긴다(조용히 무시 금지)', () => {
    const board = todayBoardView(state(EARLY));
    expect(board.warnings.some((warning) => warning.includes('중간노선 전용'))).toBe(true);
  });
});

describe('방향 필터', () => {
  it('필터별 편수를 준다(전체/학교에서 출발/학교로 도착)', () => {
    const board = todayBoardView(state(MORNING));
    expect(board.counts).toEqual({ all: 17, out: 14, in: 3 });
  });

  it('필터를 주면 그 방향 편만 남는다', () => {
    const outbound = todayBoardView(state(MORNING), 'out');
    const inbound = todayBoardView(state(MORNING), 'in');
    expect(outbound.events.every((event) => event.direction === 'out')).toBe(true);
    expect(inbound.events.every((event) => event.direction === 'in')).toBe(true);
    expect(departuresOf(inbound.next)).toEqual(['08:30', '09:00', '20:00']);
    expect(departuresOf(outbound.next)).toEqual(['08:05', '09:30', '09:30']);
  });
});

describe('오늘 남은 출발 목록', () => {
  it('목록은 12편까지만 그리고 나머지는 "더 보기"로 분리한다', () => {
    const board = todayBoardView(state(EARLY));
    expect(board.events).toHaveLength(19);
    expect(board.list).toHaveLength(BOARD_LIST_LIMIT);
    expect(board.rest).toHaveLength(board.events.length - BOARD_LIST_LIMIT);
    expect(board.hasMore).toBe(true);
    expect(board.listLimit).toBe(BOARD_LIST_LIMIT);
  });

  it('편수가 적으면 잘리지 않고 "더 보기"도 없다', () => {
    const board = todayBoardView(state('2026-10-05T10:00:00+09:00'));
    expect(board.list).toHaveLength(1);
    expect(board.rest).toHaveLength(0);
    expect(board.hasMore).toBe(false);
  });
});

describe('자정 경계와 운행 종료', () => {
  it('23:59(10월 5일)에는 오늘 편이 없어 다음 운행일(내일) 하루만 안내한다', () => {
    const board = todayBoardView(state('2026-10-05T23:59:00+09:00'));
    expect(board.clockLabel).toBe('10월 5일 (월) 23:59');
    expect(board.notice?.kind).toBe('alternate');
    expect(board.counts.all).toBe(0);
    expect(board.nextIsToday).toBe(false);
    expect(board.events.length).toBeGreaterThan(0);
    expect(board.events.every((event) => event.dayOffset === 1)).toBe(true);
    expect(board.events.every((event) => event.dayLabel === '내일')).toBe(true);
    expect(board.next.at(0)?.dayLabel).toBe('내일');
  });

  it('00:01(10월 6일)에는 같은 목록이 "오늘"로 넘어온다(라벨·목록이 다음 날로)', () => {
    const board = todayBoardView(state('2026-10-06T00:01:00+09:00'));
    expect(board.clockLabel).toBe('10월 6일 (화) 00:01');
    expect(board.dateLabel).toBe('2026-10-06 (화)');
    expect(board.notice).toBeNull();
    expect(board.nextIsToday).toBe(true);
    expect(board.events.every((event) => event.dayOffset === 0)).toBe(true);
    expect(board.events.every((event) => event.dayLabel === '오늘')).toBe(true);
  });
});

describe('로딩 상태', () => {
  it('모델이 없으면 loading 상태로 빈 목록을 준다(크래시 없음)', () => {
    const board = todayBoardView(state(EARLY, { model: null }));
    expect(board.status).toBe('loading');
    expect(board.events).toHaveLength(0);
    expect(board.next).toHaveLength(0);
    expect(board.todayTotal).toBe(0);
    expect(board.clockLabel).toBe('10월 6일 (화) 07:00');
  });
});
