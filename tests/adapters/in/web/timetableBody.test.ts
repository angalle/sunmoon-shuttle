/**
 * T27 — 본문 = 시간표 하나 (docs/07-mobile-ux.md §9-1 · §9-3 · §9-4).
 *
 * 화면에서 가장 중요한 계약만 순수 함수로 고정한다(DOM 없이 — jsdom 미설치 정책):
 *  ① `timetableView` — 오늘 시간표의 **다음 출발 행 하나**만 강조되고, 지난 편은 dim 플래그가 선다.
 *  ② `shortTripToken` — 사유는 **짧은 토큰 1개**(`금 휴` · `월·화` · `2대`)로만 나간다(긴 문구 금지).
 *  ③ 오늘의 두 예외 — **운행 없는 날**(행 0 + "다음 운행" 1줄) · **대체 시간표 날**(적용 시간표를 그린다).
 *  ④ `dayNoticeLine` — 상단 바 아래 최대 1줄(우선순위: 운행없음 > 대체 > 방학 > 오늘 종료).
 */
import { describe, expect, it } from 'vitest';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import {
  dayNoticeLine,
  shortTripToken,
  timetableView,
} from '../../../../src/adapters/in/web/features/schedule/store/selectors';
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
    nowMs: NOW, // 2026-10-06(화) 07:40
    ...overrides,
  };
}

const at = (kstIso: string): ScheduleState => state({ nowMs: Date.parse(kstIso) });

describe('shortTripToken — 사유는 짧은 토큰 하나로만(§9-3)', () => {
  it('요일 휴무는 `<요일> 휴` 로 줄인다 — `금요일 운행 없음` → `금 휴`', () => {
    expect(shortTripToken(['금요일 운행 없음'])).toBe('금 휴');
    expect(shortTripToken(['금·토요일 운행 없음'])).toBe('금·토 휴');
  });

  it('요일 범위·대수는 조건 표기만 남긴다 — `월·화만 운행` → `월·화`, `2대 운행` → `2대`', () => {
    expect(shortTripToken(['월·화만 운행'])).toBe('월·화');
    expect(shortTripToken(['2대 운행'])).toBe('2대');
    expect(shortTripToken(['월·화만 운행', '2대 운행'])).toBe('월·화 2대');
  });

  it('요일이 3개 이상이면 범위 표기로 줄인다 — `월·화·수·목만 운행` → `월~목`', () => {
    expect(shortTripToken(['월·화·수·목만 운행'])).toBe('월~목');
    expect(shortTripToken(['월·화·수·목만 운행', '2대 운행'])).toBe('월~목 2대');
    // 토큰은 항상 8자 이하다(§9-3 "짧은 토큰 하나" — 긴 사유 문구 금지).
    expect(String(shortTripToken(['월·화·수·목만 운행', '2대 운행'])).length).toBeLessThanOrEqual(8);
  });

  it('데이터에서 온 표기는 그대로 쓴다(지어내지 않는다) · 조건이 없으면 null', () => {
    expect(shortTripToken(['중간노선 전용'])).toBe('중간노선 전용');
    expect(shortTripToken([])).toBeNull();
    expect(shortTripToken(['   '])).toBeNull();
  });

  it('토큰은 항상 1개(또는 null)다 — 여러 조건이 있어도 합쳐서 하나로 만든다', () => {
    const token = shortTripToken(['요일 운행 없음', '월·화만 운행', '2대 운행']);
    expect(token).not.toBeNull();
    expect(typeof token).toBe('string');
  });
});

describe('timetableView — 본문 시간표 하나(§9-1 · §9-3)', () => {
  it('오늘(2026-10-06 화 07:40)에는 회차가 출발 시각 오름차순이고, 다음 출발 행이 하나뿐이다', () => {
    const view = timetableView(state());
    expect(view.isToday).toBe(true);
    expect(view.referenceDate).toBe('2026-10-06');
    expect(view.rows.length).toBeGreaterThanOrEqual(4);
    expect(view.rows.map((row) => row.departure).slice(0, 2)).toEqual(['08:05', '09:05']);
    const next = view.rows.filter((row) => row.isNext);
    expect(next).toHaveLength(1);
    expect(next[0]?.departure).toBe('08:05');
    expect(view.nextKey).toBe(next[0]?.key);
    // 07:40 기준으로 지난 편은 없다.
    expect(view.rows.some((row) => row.isPast)).toBe(false);
  });

  it('지난 편은 dim 플래그가 서고, 다음 출발은 지나지 않은 첫 편으로 옮겨간다(09:30 기준)', () => {
    const view = timetableView(at('2026-10-06T09:30:00+09:00'));
    const past = view.rows.filter((row) => row.isPast).map((row) => row.departure);
    expect(past).toEqual(['08:05', '09:05']);
    const next = view.rows.find((row) => row.isNext);
    expect(next?.departure).toBe('10:05');
  });

  it('오늘이 아닌 요일 탭(미리보기)에는 강조할 다음 출발이 없다', () => {
    const view = timetableView(state({ dayType: 'saturday' }));
    expect(view.isToday).toBe(false);
    expect(view.nextKey).toBeNull();
    expect(view.rows.every((row) => row.isNext === false)).toBe(true);
  });

  it('운행 없는 날(한글날)에는 행을 그리지 않는다 — 상단 1줄이 다음 운행을 안내한다', () => {
    const view = timetableView(at('2026-10-09T08:00:00+09:00'));
    expect(view.rows).toEqual([]);
    expect(view.total).toBe(0);
    expect(view.counts).toEqual({ all: 0, out: 0, in: 0 });
    expect(view.isToday).toBe(false);
  });

  it('대체 시간표 날(개천절대체휴일)에는 적용 시간표(일요일)를 그린다', () => {
    const view = timetableView(at('2026-10-05T10:00:00+09:00'));
    expect(view.dayType).toBe('sunday');
    expect(view.dayLabel).toBe('일요일');
    expect(view.rows.map((row) => row.departure)).toEqual(['12:00']);
  });

  it('방향 필터는 목록만 줄인다(편수 계약은 그대로)', () => {
    const all = timetableView(state());
    const out = timetableView(state(), 'out');
    expect(out.counts).toEqual(all.counts);
    expect(out.rows.every((row) => row.direction === 'out')).toBe(true);
  });
});

describe('dayNoticeLine — 상단 바 아래 최대 1줄(§9-4)', () => {
  it('평범한 날에는 아무 줄도 두지 않는다', () => {
    expect(dayNoticeLine(state())).toBeNull();
  });

  it('운행 없는 날: `오늘 셔틀버스 운행이 없습니다` + 사유 + 다음 운행 시각(§9-4 ①)', () => {
    const line = dayNoticeLine(at('2026-10-09T08:00:00+09:00'));
    expect(line?.kind).toBe('no-service');
    expect(line?.text).toContain('한글날');
    expect(line?.text).toContain('다음 운행');
  });

  it('대체 시간표 날: `일요일 시간표로 운행합니다` 한 줄(§9-4 ②)', () => {
    const line = dayNoticeLine(at('2026-10-05T10:00:00+09:00'));
    expect(line?.kind).toBe('alternate');
    expect(line?.text).toContain('일요일');
  });

  it('오늘 운행이 끝났으면 다음 운행일을 알린다(T13 계약 — 스크롤 대상이 없다)', () => {
    const line = dayNoticeLine(at('2026-10-06T23:00:00+09:00'));
    expect(line?.kind).toBe('today-over');
    expect(line?.text).toContain('다음 운행');
  });
});
