import { describe, expect, it } from 'vitest';

import type { Notice } from '../../src/domain/entities/Notice';
import { tripDepartureTime } from '../../src/domain/entities/Trip';
import { kstDayFromInstant } from '../../src/domain/rules/kst';
import {
  matchNoticeRule,
  matchTripNoteRule,
  resolveDayService,
  resolveTripService,
} from '../../src/domain/rules/serviceDay';
import { FIXTURE_SCHEDULE } from './fixtures/timetable';

const NOTICES = FIXTURE_SCHEDULE.notices;
const ASAN_WEEKDAY = FIXTURE_SCHEDULE.routes[0]?.byDay.weekday ?? [];
const tripBySeq = (seq: number) => {
  const found = ASAN_WEEKDAY.find((trip) => trip.seq === seq);
  if (found === undefined) throw new Error(`픽스처에 없는 회차: ${seq}`);
  return found;
};

const friday = kstDayFromInstant(new Date('2026-10-16T08:00:00+09:00')); // 금
const monday = kstDayFromInstant(new Date('2026-10-19T08:00:00+09:00')); // 월

describe('rules/serviceDay — 안내문 패턴 표', () => {
  it('문구 표: 운행 없음 / 대체 시간표 / 미등록', () => {
    expect(matchNoticeRule('*한글날[10. 9.(금)]: 셔틀버스 운행 없음')?.id).toBe('no-service');
    expect(matchNoticeRule('*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음')?.id).toBe('no-service');
    const override = matchNoticeRule('*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행');
    expect(override?.id).toBe('day-type-override');
    expect(override?.dayType).toBe('sunday');
    expect(matchNoticeRule('그냥 안내 문구입니다')).toBeNull();
  });

  it('운행 없는 날(한글날 2026-10-09): 서비스 off + 사유는 안내문 원문', () => {
    const day = kstDayFromInstant(new Date('2026-10-09T09:00:00+09:00'));
    const status = resolveDayService(day, NOTICES);
    expect(status.serviceOn).toBe(false);
    expect(status.date).toBe('2026-10-09');
    expect(status.dayType).toBe('weekday');
    expect(status.reason).toBe('*한글날[10. 9.(금)]: 셔틀버스 운행 없음');
    expect(status.warnings).toEqual([]);
  });

  it('대체 시간표(개천절대체휴일 2026-10-05 월): 운행은 하되 일요일 시간표를 쓴다', () => {
    const day = kstDayFromInstant(new Date('2026-10-05T09:00:00+09:00'));
    const status = resolveDayService(day, NOTICES);
    expect(status.serviceOn).toBe(true);
    expect(status.dayType).toBe('weekday');
    expect(status.effectiveDayType).toBe('sunday');
    expect(status.overrideNotice?.text).toContain('일요일 시간표로 운행');
  });

  it('안내문 없는 평일: 서비스 on · 대체 없음 · 경고 없음', () => {
    const day = kstDayFromInstant(new Date('2026-10-06T09:00:00+09:00'));
    const status = resolveDayService(day, NOTICES);
    expect(status.serviceOn).toBe(true);
    expect(status.effectiveDayType).toBe('weekday');
    expect(status.reason).toBeNull();
    expect(status.warnings).toEqual([]);
  });

  it('해석 못 하는 안내문 문구는 경고로 수집(조용히 무시 금지)', () => {
    const day = kstDayFromInstant(new Date('2026-10-12T09:00:00+09:00'));
    const status = resolveDayService(day, NOTICES);
    expect(status.serviceOn).toBe(true);
    expect(status.warnings.length).toBe(1);
    expect(status.warnings[0]).toContain('패턴 표에 없는 안내 문구');
  });

  it('안내문 날짜가 하루(YYYY-MM-DD)로 전개되지 않으면 경고 — 파서(T2) 계약 위반 감지', () => {
    const rangeNotice: Notice = {
      kind: 'no-service',
      date: '9.24(목)~9.26(토)',
      text: '*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음',
    };
    const status = resolveDayService(kstDayFromInstant(new Date('2026-10-06T09:00:00+09:00')), [rangeNotice]);
    expect(status.serviceOn).toBe(true);
    expect(status.warnings[0]).toContain('YYYY-MM-DD');
  });
});

describe('rules/serviceDay — 회차 특이사항 패턴 표', () => {
  it('금(X): 금요일에는 제외, 월요일에는 운행', () => {
    const fridayStatus = resolveTripService(tripBySeq(2), friday);
    expect(fridayStatus.runs).toBe(false);
    expect(fridayStatus.reason).toBe('weekday-exclusion');
    expect(fridayStatus.excludedWeekday).toBe(5);

    const mondayStatus = resolveTripService(tripBySeq(2), monday);
    expect(mondayStatus.runs).toBe(true);
    expect(mondayStatus.reason).toBe('runs');
    expect(mondayStatus.warnings).toEqual([]);
  });

  it('월~화 2대 운행: 운행 여부를 바꾸지 않는 주석으로 처리(수용 기준 ⑦)', () => {
    const status = resolveTripService(tripBySeq(3), monday);
    expect(status.runs).toBe(true);
    expect(status.reason).toBe('runs');
    expect(status.annotations).toEqual(['월~화 2대 운행']);
    expect(status.warnings).toEqual([]);
    expect(matchTripNoteRule('월~화 2대 운행')?.id).toBe('multi-bus-annotation');
  });

  it('미등록 표기(중간노선 전용): 경고로 수집하고 운행 여부는 바꾸지 않는다', () => {
    const status = resolveTripService(tripBySeq(4), monday);
    expect(status.runs).toBe(true);
    expect(status.reason).toBe('unknown-note');
    expect(status.warnings[0]).toContain('중간노선 전용');
  });

  it('빈 특이사항(전각 공백 포함)은 주석 없음', () => {
    const status = resolveTripService({ seq: 9, depCampus: '10:00', depStation: null, arrCampus: '10:20', note: '　' }, monday);
    expect(status.runs).toBe(true);
    expect(status.annotations).toEqual([]);
    expect(status.warnings).toEqual([]);
  });

  it('출발 시각이 없는 회차(Χ)는 안내 대상이 아니다', () => {
    const trip = tripBySeq(5);
    expect(tripDepartureTime(trip)).toBeNull();
    const status = resolveTripService(trip, monday);
    expect(status.runs).toBe(false);
    expect(status.reason).toBe('no-departure-time');
  });

  it('출발 시각은 캠퍼스 출발 → 없으면 역 출발', () => {
    expect(tripDepartureTime(tripBySeq(1))).toBe('08:05'); // depCampus
    expect(tripDepartureTime(tripBySeq(2))).toBe('08:35'); // depCampus Χ → depStation
  });
});
