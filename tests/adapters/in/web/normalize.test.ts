/**
 * 계약 브리지 테스트 — **실제 T2 산출물**(`data/timetable.json`)을 그대로 넣어
 * 도메인 함수가 동작하는지 확인한다.
 *
 * 배경(카드 코멘트 · .session-notes/T5-증거.md): 외부 계약의 `byDay[dayType]` 은
 * `{columns, keys, trips}` 객체인데 도메인 `Route.byDay` 는 `Trip[]` 이라 그대로 넣으면
 * `trips is not iterable` 로 던진다. `data/normalize.ts` 가 그 간극을 메운다.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTimetable, TimetableDataError } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import { findRoute, tripsFor } from '../../../../src/domain/entities/Schedule';
import { DAY_TYPES } from '../../../../src/domain/entities/DayType';
import { nextDepartures } from '../../../../src/domain/rules/nextDeparture';

const RAW = JSON.parse(
  readFileSync(new URL('../../../../data/timetable.json', import.meta.url), 'utf8'),
) as unknown;

const model = parseTimetable(RAW);
const clockAt = (kstIso: string): { now: () => Date } => ({ now: () => new Date(kstIso) });

describe('parseTimetable — 실제 계약 데이터', () => {
  it('노선 5개·요일 3종·운행 중단 상태를 보존한다(F2b)', () => {
    expect(model.routes).toHaveLength(5);
    expect(model.dayTypes).toEqual([...DAY_TYPES]);
    const suspended = model.routes.find((route) => route.id === 'cheonan-campus');
    expect(suspended?.status).toBe('suspended');
    expect(suspended?.suspendedReason).toContain('운행하지 않습니다');
    // 원본에 표가 0개(운행 중단) → 요일 표는 null, 상태·원문 문구로만 보여준다(F2b).
    expect(suspended?.byDay.weekday).toBeNull();
    expect(suspended?.offDays).toHaveLength(3);
  });

  it('열 구성은 노선·요일별로 다르다 — 원문 헤더를 그대로 보존한다(F2)', () => {
    const asan = model.routes.find((route) => route.id === 'asan-ktx');
    expect(asan?.byDay.weekday?.columns).toHaveLength(5);
    expect(asan?.byDay.saturday?.columns).toHaveLength(4);
    expect(asan?.byDay.saturday?.columns).not.toContain('운행 특이사항');
  });

  it('요일별 행 수가 JSON 과 같고, 원본 Χ(null)는 null 로 유지된다', () => {
    const asan = model.routes.find((route) => route.id === 'asan-ktx');
    expect(asan?.byDay.weekday?.rows).toHaveLength(42);
    expect(asan?.byDay.saturday?.rows).toHaveLength(4);
    expect(asan?.byDay.sunday?.rows).toHaveLength(6);
    const withNullDeparture = asan?.byDay.weekday?.rows.find((row) => row['depCampus'] === null);
    expect(withNullDeparture).toBeDefined();
  });

  it('도메인 브리지: 모든 노선·요일에서 tripsFor 행 수가 원문 표와 일치한다', () => {
    for (const route of model.routes) {
      for (const dayType of DAY_TYPES) {
        const table = route.byDay[dayType];
        expect(tripsFor(model.schedule, route.id, dayType)).toHaveLength(table?.rows.length ?? 0);
      }
    }
  });

  it('시각 열 키 정규화: 천안터미널의 depTerminal 이 도메인 depStation 으로 온다', () => {
    const domainRoute = findRoute(model.schedule, 'cheonan-terminal');
    const first = domainRoute?.byDay.weekday[0];
    expect(first?.seq).toBe(1);
    expect(first?.depStation).toBe('08:10');
    expect(first?.depCampus).toBe('07:30');
  });

  it('nextDepartures 가 실제 데이터에서 동작한다 — 개천절 대체휴일(일요일 시간표)', () => {
    const result = nextDepartures({
      schedule: model.schedule,
      routeId: 'asan-ktx',
      clock: clockAt('2026-10-05T14:40:00+09:00'),
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.today.effectiveDayType).toBe('sunday');
    expect(result.departures.map((departure) => departure.departure)).toEqual(['16:10', '18:20', '19:10']);
    expect(result.departures[0]?.dayLabel).toBe('오늘');
    expect(result.departures[0]?.remainingMinutes).toBe(90);
  });

  it('운행 없는 날(한글날)은 사유를 담아 반환한다(F3·F7)', () => {
    const result = nextDepartures({
      schedule: model.schedule,
      routeId: 'asan-ktx',
      clock: clockAt('2026-10-09T09:00:00+09:00'),
    });
    expect(result.status).toBe('no-service-today');
    if (result.status !== 'no-service-today') return;
    expect(result.reason).toContain('한글날');
  });

  it('계약 위반은 원인 경로를 담은 TimetableDataError 로 실패한다(조용한 손상 금지)', () => {
    expect(() => parseTimetable({ ...(RAW as Record<string, unknown>), routes: 'nope' })).toThrow(TimetableDataError);
    expect(() => parseTimetable({ ...(RAW as Record<string, unknown>), routes: 'nope' })).toThrow(/\$\.routes/);
    const broken = structuredClone(RAW) as { routes: { byDay: { weekday: { trips: unknown } } }[] };
    broken.routes[0]!.byDay.weekday.trips = [{ seq: 1, depCampus: { weird: true } }];
    expect(() => parseTimetable(broken)).toThrow(/routes\[0\]\.byDay\.weekday\.trips\[0\]\.depCampus/);
  });
});
