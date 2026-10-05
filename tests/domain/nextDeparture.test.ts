import { describe, expect, it } from 'vitest';

import type { NextDeparture, NextDepartureInput, NextDepartureResult } from '../../src/domain/rules/nextDeparture';
import { nextDepartures } from '../../src/domain/rules/nextDeparture';
import { FIXTURE_SCHEDULE, clockAt } from './fixtures/timetable';

const ROUTE = 'asan-ktx';

function run(kstIso: string, routeId = ROUTE, count?: number): NextDepartureResult {
  const base: NextDepartureInput = { schedule: FIXTURE_SCHEDULE, routeId, clock: clockAt(kstIso) };
  return nextDepartures(count === undefined ? base : { ...base, count });
}

function departureList(result: NextDepartureResult): readonly NextDeparture[] {
  if (result.status === 'unknown-route') throw new Error('노선 없음');
  if (result.status === 'empty-schedule') throw new Error('빈 스케줄');
  return result.departures;
}

function first(result: NextDepartureResult): NextDeparture {
  const head = departureList(result).at(0);
  if (head === undefined) throw new Error('departures 가 비었습니다');
  return head;
}

const summary = (d: NextDeparture) => `${d.date} ${d.departure} (${d.dayLabel}, offset ${d.dayOffset}, ${d.dayType})`;

describe('rules/nextDeparture — 경계 12종 (수용 기준 AC-3)', () => {
  it('①a 자정 직전(2026-10-06 23:59:30) → 다음날(수) 첫 차', () => {
    const result = run('2026-10-06T23:59:30+09:00');
    expect(result.status).toBe('ok');
    expect(summary(first(result))).toBe('2026-10-07 08:05 (내일, offset 1, weekday)');
  });

  it('①b 자정 직후(2026-10-06 00:00:30) → 그날(화) 첫 차 3개, 남은 시간 계산', () => {
    const result = run('2026-10-06T00:00:30+09:00');
    expect(departureList(result).map((d) => d.departure)).toEqual(['08:05', '08:35', '09:00']);
    expect(first(result).dayOffset).toBe(0);
    expect(first(result).dayLabel).toBe('오늘');
    expect(first(result).remainingMinutes).toBe(8 * 60 + 4); // 00:00:30 → 08:05 = 484분 30초
    expect(first(result).remainingSeconds).toBe(8 * 60 * 60 + 4 * 60 + 30);
    expect(first(result).departureAt).toBe('2026-10-06T08:05:00+09:00');
  });

  it('② 금요일 밤(2026-10-16 22:00) → 토요일 첫 차부터', () => {
    const result = run('2026-10-16T22:00:00+09:00');
    expect(summary(first(result))).toBe('2026-10-17 09:30 (내일, offset 1, saturday)');
    expect(departureList(result).map((d) => d.departure)).toEqual(['09:30', '13:00', '10:00']);
  });

  it('③ 토요일 밤(2026-10-17 22:00) → 일요일 첫 차부터', () => {
    const result = run('2026-10-17T22:00:00+09:00');
    expect(summary(first(result))).toBe('2026-10-18 10:00 (내일, offset 1, sunday)');
  });

  it('④ 일요일 밤(2026-10-18 23:00) → 월요일 첫 차부터', () => {
    const result = run('2026-10-18T23:00:00+09:00');
    expect(summary(first(result))).toBe('2026-10-19 08:05 (내일, offset 1, weekday)');
  });

  it('⑤a 마지막 차 30초 전(2026-10-06 21:14:30) → 21:15 를 포함', () => {
    const result = run('2026-10-06T21:14:30+09:00');
    expect(summary(first(result))).toBe('2026-10-06 21:15 (오늘, offset 0, weekday)');
    expect(first(result).remainingSeconds).toBe(30);
    expect(first(result).remainingMinutes).toBe(0);
  });

  it('⑤b 마지막 차 30초 후(2026-10-06 21:15:30) → "없음"이 아니라 다음날 첫 차', () => {
    const result = run('2026-10-06T21:15:30+09:00');
    expect(summary(first(result))).toBe('2026-10-07 08:05 (내일, offset 1, weekday)');
  });

  it('⑥ 운행 없는 날(한글날 2026-10-09) → 그 사실을 먼저 반환 + 다음 운행일 안내', () => {
    const result = run('2026-10-09T09:00:00+09:00');
    expect(result.status).toBe('no-service-today');
    if (result.status !== 'no-service-today') return;
    expect(result.today.serviceOn).toBe(false);
    expect(result.reason).toContain('운행 없음');
    expect(result.nextServiceDate).toBe('2026-10-10');
    expect(summary(first(result))).toBe('2026-10-10 09:30 (내일, offset 1, saturday)');
  });

  it('⑥b 운행 없는 날(개교기념일 2026-10-28) → 같은 상태 반환', () => {
    const result = run('2026-10-28T10:00:00+09:00');
    expect(result.status).toBe('no-service-today');
    if (result.status !== 'no-service-today') return;
    expect(result.reason).toContain('개교기념일');
    expect(result.nextServiceDate).toBe('2026-10-29');
  });

  it('⑦a 금(X) 회차는 금요일 안내에서 제외된다', () => {
    const result = run('2026-10-16T08:00:00+09:00'); // 금요일 08:00
    expect(departureList(result).map((d) => d.departure)).toEqual(['08:05', '09:00', '11:00']);
    expect(departureList(result).some((d) => d.seq === 2)).toBe(false);
  });

  it('⑦b 같은 회차(금(X))가 월요일에는 운행된다', () => {
    const result = run('2026-10-19T08:00:00+09:00'); // 월요일 08:00
    expect(departureList(result).map((d) => d.departure)).toEqual(['08:05', '08:35', '09:00']);
    expect(departureList(result).some((d) => d.seq === 2)).toBe(true);
  });

  it('⑧ 월~화 2대 운행 주석은 회차를 제외하지 않고 주석으로만 남는다', () => {
    const result = run('2026-10-19T08:00:00+09:00', ROUTE, 3);
    const annotated = departureList(result).find((d) => d.seq === 3);
    expect(annotated?.departure).toBe('09:00');
    expect(annotated?.annotations).toEqual(['월~화 2대 운행']);
  });

  it('⑨ Χ(null) 회차는 어디에도 나오지 않는다', () => {
    const result = run('2026-10-19T00:00:00+09:00', ROUTE, 6);
    const list = departureList(result);
    expect(list.some((d) => d.seq === 5)).toBe(false);
    expect(list.map((d) => d.departure)).toEqual(['08:05', '08:35', '09:00', '11:00', '20:45', '21:15']);
    if (result.status === 'unknown-route' || result.status === 'empty-schedule') return;
    expect(result.warnings.some((w) => w.includes('출발 시각이 없는 회차'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('중간노선 전용'))).toBe(true); // 미등록 표기는 경고로
  });

  it('⑩ 요일별 표가 다를 때: 토요일에는 토요일 표를 쓴다', () => {
    const result = run('2026-10-17T09:00:00+09:00');
    expect(departureList(result).map((d) => d.departure)).toEqual(['09:30', '13:00', '10:00']);
    expect(first(result).dayType).toBe('saturday');
    expect(first(result).dayOffset).toBe(0);
  });

  it('⑩b 안내문 대체 시간표(2026-10-05 개천절대체휴일, 월) → 일요일 표를 쓴다', () => {
    const result = run('2026-10-05T09:00:00+09:00');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.today.dayType).toBe('weekday');
    expect(result.today.effectiveDayType).toBe('sunday');
    expect(summary(first(result))).toBe('2026-10-05 10:00 (오늘, offset 0, sunday)');
  });

  it('⑪a 노선이 여러 개일 때: 지정한 노선의 표만 쓴다', () => {
    const asan = run('2026-10-19T00:00:00+09:00');
    const cheonan = run('2026-10-19T00:00:00+09:00', 'cheonan-station');
    expect(first(asan).departure).toBe('08:05');
    expect(first(cheonan).departure).toBe('07:40');
  });

  it('⑪b 없는 노선 id: 오류 대신 unknown-route + 알려진 노선 목록', () => {
    const result = run('2026-10-19T08:00:00+09:00', 'nope');
    expect(result.status).toBe('unknown-route');
    if (result.status !== 'unknown-route') return;
    expect(result.knownRouteIds).toEqual(['asan-ktx', 'cheonan-station', 'cheonan-campus']);
  });

  it('⑫ 스케줄이 비었을 때: 오류를 던지지 않고 empty-schedule 상태 반환', () => {
    const result = run('2026-10-19T08:00:00+09:00', 'cheonan-campus');
    expect(result.status).toBe('empty-schedule');
    if (result.status !== 'empty-schedule') return;
    expect(result.reason).toContain('비어 있습니다');
    expect(result.today.serviceOn).toBe(true);
  });
});
