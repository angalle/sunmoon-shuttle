/**
 * T38 — 방향은 **항상 하나**(택1) · 목록에 두 방향이 섞이지 않는다 (docs/07-mobile-ux.md §16-2 · AC-U16-1~3).
 *
 * 화면 실측(칩 눌림 1개·섞임 0건·편수 대조)은 `scripts/t24_smoke.mjs` AC-U16 이 낸다.
 * 여기서는 **선택자 계약**만 순수하게 고정한다:
 *  ① 선택한 방향의 편만 담긴다(섞임 0건) ② 편수(counts)는 방향별로 그대로다(115 = 24 + 91 규칙)
 *  ③ 선택한 방향이 0편이면 **전환 수단 1개**(`<다른 방향> 편 보기`)가 나오고 **자동 전환은 없다**
 *  ④ 기본값은 **`터미널 도착`(out)** 한 곳에서 정한다(§16-2).
 */
import { describe, expect, it } from 'vitest';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import {
  DEFAULT_DIRECTION_SELECTION,
  DIRECTION_SELECTIONS,
  directionSelectionLabel,
  timetableView,
} from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import { UI_TEXT } from '../../../../src/adapters/in/web/features/schedule/types/texts';
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

describe('§16-2 택1 — 선택한 방향의 편만 목록에 온다(섞임 0건)', () => {
  it('방향 선택 값은 `out`·`in` 두 개뿐이고 `all`(전체)은 선택 값이 아니다', () => {
    expect([...DIRECTION_SELECTIONS]).toEqual(['out', 'in']);
    expect((DIRECTION_SELECTIONS as readonly string[]).includes('all')).toBe(false);
  });

  it('기본값은 `터미널 도착`(out) 이고 라벨도 그 방향이다', () => {
    expect(DEFAULT_DIRECTION_SELECTION).toBe('out');
    expect(directionSelectionLabel(DEFAULT_DIRECTION_SELECTION)).toBe(UI_TEXT.filterDirectionTerminal);
    expect(directionSelectionLabel('in')).toBe(UI_TEXT.filterDirectionSchool);
  });

  it('`out` 선택 → 모든 행이 `out`, `in` 선택 → 모든 행이 `in`(섞임 0)', () => {
    const out = timetableView(state(), 'out');
    const inbound = timetableView(state(), 'in');
    expect(out.direction).toBe('out');
    expect(inbound.direction).toBe('in');
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.rows.every((row) => row.direction === 'out')).toBe(true);
    // 이 픽스처의 평일 편은 전부 학교 출발(`out`)이라 `in` 은 0편이다 — 섞여 나오면 안 된다.
    expect(inbound.rows.every((row) => row.direction === 'in')).toBe(true);
    expect(inbound.rows.length).toBe(0);
  });

  it('편수(counts)는 방향 선택과 무관하게 그대로다 — 방향별 합 = 전체 편수', () => {
    const out = timetableView(state(), 'out');
    const inbound = timetableView(state(), 'in');
    expect(out.counts).toEqual(inbound.counts);
    expect(out.counts.out + out.counts.in).toBe(out.counts.all);
    expect(out.total).toBe(out.counts.all);
    expect(out.rows.length).toBe(out.counts.out);
  });
});

describe('§16-2 0편 — 얇은 1줄 + 전환 수단 1개(자동 전환 금지)', () => {
  it('선택한 방향이 0편이고 그 요일에 편이 있으면 다른 방향 전환 수단이 나온다', () => {
    const inbound = timetableView(state(), 'in');
    expect(inbound.rows.length).toBe(0);
    expect(inbound.total).toBeGreaterThan(0);
    expect(inbound.emptySwitch).toEqual({
      direction: 'out',
      label: `${UI_TEXT.filterDirectionTerminal} ${UI_TEXT.timetableEmptyFilterSwitchSuffix}`,
    });
    expect(inbound.emptySwitch?.label).toBe('터미널 도착 편 보기');
  });

  it('편이 있는 방향을 골랐으면 전환 수단이 없다(0편 안내도 없다)', () => {
    const out = timetableView(state(), 'out');
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.emptySwitch).toBeNull();
  });

  it('그 요일 자체에 편이 없으면(운행 없음) 전환 수단을 만들지 않는다 — 안내만 남긴다', () => {
    // 한글날(운행 없음) — 선택 요일이 오늘이고 안내문이 운행 없음을 말한다.
    const holiday = timetableView(state({ nowMs: Date.parse('2026-10-09T09:00:00+09:00'), dayType: 'weekday' }), 'in');
    expect(holiday.rows).toEqual([]);
    expect(holiday.total).toBe(0);
    expect(holiday.emptySwitch).toBeNull();
  });

  it('선택자 내부의 `all`(필터 무관 판정용) 경로에는 전환 수단이 없다 — 화면 값이 아니다', () => {
    const all = timetableView(state(), 'all');
    expect(all.direction).toBe('all');
    expect(all.emptySwitch).toBeNull();
    expect(all.rows.length).toBe(all.total);
  });
});
