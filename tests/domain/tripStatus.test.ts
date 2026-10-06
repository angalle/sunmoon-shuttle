/**
 * T22 — `tripStatus` 단위 테스트 (수용 기준 AC-D7).
 *
 * `docs/06-data-model.md §2` 의 판정 우선순위를 **그대로** 검증한다.
 *   ① 날짜 규칙(dateRules)  ② 편별 요일 조건(trip.service)  ③ 기본(byDay 버킷)
 *
 * 케이스: 금요일 / 월요일 / 토요일 / 일요일 / 공휴일(한글날) / 대체휴일(개천절) /
 *        dayScope / excludedDays / v1·v2 데이터(신규 필드 없음) / 미해석 표기 / 방학 기간.
 * 판정은 순수 함수라 시계·브라우저 없이 날짜만 주면 된다.
 */
import { describe, expect, it } from 'vitest';

import type { Trip, TripServiceCondition } from '../../src/domain/entities/Trip';
import { kstDayFromInstant } from '../../src/domain/rules/kst';
import {
  tripStatus,
  TRIP_REASON_CODES,
  type TripDateRule,
  type TripTerm,
} from '../../src/domain/rules/tripStatus';

/* ───────────────────────── 기준 날짜 (2026-10-06 은 화요일 — 기존 픽스처 실측) ───────────────────────── */
const day = (kstIso: string) => kstDayFromInstant(new Date(kstIso));
const MON = day('2026-10-19T08:00:00+09:00'); // 월
const TUE = day('2026-10-20T08:00:00+09:00'); // 화
const WED = day('2026-10-21T08:00:00+09:00'); // 수
const FRI = day('2026-10-16T08:00:00+09:00'); // 금(평일)
const SAT = day('2026-10-17T08:00:00+09:00'); // 토
const SUN = day('2026-10-18T08:00:00+09:00'); // 일
const HANGUL = day('2026-10-09T09:00:00+09:00'); // 한글날(금) — 운행 없음
const GAECHEON = day('2026-10-05T09:00:00+09:00'); // 개천절 대체휴일(월) — 일요일 시간표

/** 그 요일에 실린 평범한 회차(v3 구조 조건 없음). */
function plainTrip(seq: number, departure: string): Trip {
  return { seq, depCampus: departure, depStation: null, arrCampus: null, note: null, service: null, durationMinutes: null, unknownNote: null, needsReview: false };
}

/** 구조화된 편별 요일 조건을 가진 회차(v3). */
function serviceTrip(seq: number, departure: string, service: Partial<TripServiceCondition>): Trip {
  return {
    seq,
    depCampus: null,
    depStation: departure,
    arrCampus: null,
    note: null,
    service: {
      excludedDays: service.excludedDays ?? [],
      dayScope: service.dayScope ?? null,
      vehicleCount: service.vehicleCount ?? null,
      label: service.label ?? null,
      sourceQuote: service.sourceQuote ?? null,
    },
    durationMinutes: null,
    unknownNote: null,
    needsReview: false,
  };
}

/** v1·v2 데이터(구조 조건 없음 — `note` 문자열만). */
function legacyTrip(seq: number, departure: string, note: string | null): Trip {
  return { seq, depCampus: null, depStation: departure, arrCampus: null, note };
}

const HANGUL_RULE: TripDateRule = {
  kind: 'no-service',
  start: '2026-10-09',
  end: null,
  effect: { appliesTo: 'all-routes' },
  sourceQuote: '*한글날[10. 9.(금)]: 셔틀버스 운행 없음',
  needsReview: false,
};

const GAECHEON_RULE: TripDateRule = {
  kind: 'alternate-schedule',
  start: '2026-10-05',
  end: null,
  effect: { timetable: 'sunday', appliesTo: 'all-routes' },
  sourceQuote: '*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행',
  needsReview: false,
};

/* ───────────────────────── ② 편별 요일 조건 ───────────────────────── */

describe('tripStatus ② — excludedDays(금(X))', () => {
  const fridayExcluded = serviceTrip(2, '08:35', { excludedDays: ['fri'], sourceQuote: '금(X)' });

  it('금요일: 운행하지 않는다 — 사유 weekday-excluded · 근거 원문 보존', () => {
    const status = tripStatus(fridayExcluded, FRI);
    expect(status.runs).toBe(false);
    expect(status.reason).toBe('weekday-excluded');
    expect(status.sourceQuote).toBe('금(X)');
    expect(status.excludedDays).toEqual(['fri']);
  });

  it('월요일: 같은 편이 운행한다 — 사유 normal 이지만 제외 요일은 배지 근거로 남는다', () => {
    const status = tripStatus(fridayExcluded, MON);
    expect(status.runs).toBe(true);
    expect(status.reason).toBe('normal');
    expect(status.excludedDays).toEqual(['fri']);
  });

  it('주말(토·일)은 excludedDays 와 무관하게 기본 동작이다 — 토요일 표 회차는 운행', () => {
    expect(tripStatus(plainTrip(1, '09:00'), SAT).reason).toBe('normal');
    expect(tripStatus(plainTrip(1, '10:00'), SUN).reason).toBe('normal');
    expect(tripStatus(fridayExcluded, SAT).runs).toBe(true);
  });
});

describe('tripStatus ② — dayScope(월~화 2대 운행)', () => {
  const scoped = serviceTrip(4, '08:45', { dayScope: ['mon', 'tue'], vehicleCount: 2, sourceQuote: '월~화 2대 운행' });

  it('범위 안(월·화): 운행 · 사유 day-scope · 대수 보존', () => {
    for (const target of [MON, TUE]) {
      const status = tripStatus(scoped, target);
      expect(status.runs).toBe(true);
      expect(status.reason).toBe('day-scope');
      expect(status.dayScope).toEqual(['mon', 'tue']);
      expect(status.vehicleCount).toBe(2);
    }
  });

  it('범위 밖(수·금): 운행하지 않는다 — 사유 day-scope(요일 조건)', () => {
    for (const target of [WED, FRI]) {
      const status = tripStatus(scoped, target);
      expect(status.runs).toBe(false);
      expect(status.reason).toBe('day-scope');
      expect(status.dayScope).toEqual(['mon', 'tue']);
    }
  });

  it('표기 통일본(label)만 있는 편(중간노선 전용)은 운행 여부를 바꾸지 않는다', () => {
    const labeled = serviceTrip(5, '11:00', { label: '중간노선 전용', sourceQuote: '중간노선전용' });
    const status = tripStatus(labeled, FRI);
    expect(status.runs).toBe(true);
    expect(status.reason).toBe('normal');
    expect(status.label).toBe('중간노선 전용');
    expect(status.sourceQuote).toBe('중간노선전용');
  });

  it('두 조건이 함께 있으면 제외가 우선한다(금요일 미운행 + 월~화 범위)', () => {
    const both = serviceTrip(6, '09:00', { excludedDays: ['fri'], dayScope: ['mon', 'tue'], vehicleCount: 2 });
    const status = tripStatus(both, FRI);
    expect(status.runs).toBe(false);
    expect(status.reason).toBe('weekday-excluded');
  });
});

/* ───────────────────────── ① 날짜 규칙 ───────────────────────── */

describe('tripStatus ① — 날짜 규칙이 요일 조건보다 앞선다', () => {
  it('공휴일(한글날): 전 편 운행 없음 — 사유 holiday-no-service · 근거는 규칙 원문', () => {
    const status = tripStatus(plainTrip(1, '08:05'), HANGUL, { dateRules: [HANGUL_RULE] });
    expect(status.runs).toBe(false);
    expect(status.reason).toBe('holiday-no-service');
    expect(status.sourceQuote).toBe('*한글날[10. 9.(금)]: 셔틀버스 운행 없음');
  });

  it('공휴일 규칙은 편별 요일 조건보다 먼저 판정한다(금(X) 편도 같은 사유)', () => {
    const excluded = serviceTrip(2, '08:35', { excludedDays: ['fri'], sourceQuote: '금(X)' });
    const status = tripStatus(excluded, HANGUL, { dateRules: [HANGUL_RULE] });
    expect(status.runs).toBe(false);
    expect(status.reason).toBe('holiday-no-service');
  });

  it('대체휴일(개천절): 운행은 하되 사유는 holiday-alternate · 대체 시간표(일요일)를 알려 준다', () => {
    const status = tripStatus(plainTrip(1, '09:00'), GAECHEON, { dateRules: [GAECHEON_RULE] });
    expect(status.runs).toBe(true);
    expect(status.reason).toBe('holiday-alternate');
    expect(status.alternateDayType).toBe('sunday');
    expect(status.sourceQuote).toBe('*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행');
  });

  it('대체 시간표 값을 해석할 수 없으면 null 로 두고 사유만 남긴다(추측 금지)', () => {
    const vague: TripDateRule = { kind: 'alternate-schedule', start: '2026-10-16', end: null, effect: {}, sourceQuote: '*행사[10.16.(금)]: 대체 시간표로 운행' };
    const status = tripStatus(plainTrip(1, '09:00'), FRI, { dateRules: [vague] });
    expect(status.reason).toBe('holiday-alternate');
    expect(status.alternateDayType).toBeNull();
  });

  it('날짜 규칙이 오늘을 덮지 않으면 요일 조건으로 내려간다(범위 규칙: end 없으면 당일만)', () => {
    const ranged: TripDateRule = { kind: 'no-service', start: '2026-10-22', end: '2026-10-23', sourceQuote: '*연휴[10.22~10.23]: 셔틀버스 운행 없음' };
    expect(tripStatus(plainTrip(1, '08:05'), FRI, { dateRules: [ranged] }).reason).toBe('normal');
    expect(tripStatus(plainTrip(1, '08:05'), day('2026-10-23T09:00:00+09:00'), { dateRules: [ranged] }).reason).toBe('holiday-no-service');
  });

  it('needsReview 날짜 규칙은 판정 근거로 쓰지 않는다(내부 플래그)', () => {
    const unverified: TripDateRule = { ...HANGUL_RULE, needsReview: true };
    expect(tripStatus(plainTrip(1, '08:05'), HANGUL, { dateRules: [unverified] }).runs).toBe(true);
  });

  it('날짜 규칙 문맥이 없으면 요일 조건만 본다(하위호환)', () => {
    expect(tripStatus(plainTrip(1, '08:05'), HANGUL).reason).toBe('normal');
    expect(tripStatus(plainTrip(1, '08:05'), FRI, {}).reason).toBe('normal');
  });
});

/* ───────────────────────── ③ 방학 기간 ───────────────────────── */

describe('tripStatus — 방학 기간(vacation-timetable)', () => {
  const vacation: TripTerm = { kind: 'vacation', start: '2026-12-21', end: '2027-02-28', needsReview: false };

  it('기간 안이면 방학 시간표로 운행한다 — 사유 vacation-timetable', () => {
    const status = tripStatus(plainTrip(1, '09:00'), day('2026-12-25T09:00:00+09:00'), { terms: [vacation] });
    expect(status.runs).toBe(true);
    expect(status.reason).toBe('vacation-timetable');
  });

  it('기간 밖이면 기본 동작 · 기간 미상(시작·끝 null)은 판단하지 않는다', () => {
    expect(tripStatus(plainTrip(1, '09:00'), FRI, { terms: [vacation] }).reason).toBe('normal');
    const unknownPeriod: TripTerm = { kind: 'vacation', start: null, end: null, needsReview: false };
    expect(tripStatus(plainTrip(1, '09:00'), FRI, { terms: [unknownPeriod] }).reason).toBe('normal');
  });

  it('제외 요일 조건이 방학 안내보다 우선한다(운행 없음이 더 강한 근거)', () => {
    const excluded = serviceTrip(2, '08:35', { excludedDays: ['fri'], sourceQuote: '금(X)' });
    // 2026-12-25 는 금요일 — 방학 기간이지만 그 편의 제외 요일이라 운행하지 않는다.
    const status = tripStatus(excluded, day('2026-12-25T09:00:00+09:00'), { terms: [vacation] });
    expect(status.runs).toBe(false);
    expect(status.reason).toBe('weekday-excluded');
    // 같은 편이 방학 기간의 월요일이면 방학 시간표로 운행한다(요일 조건이 바꾸지 않을 때의 사유).
    expect(tripStatus(excluded, day('2026-12-21T09:00:00+09:00'), { terms: [vacation] }).reason).toBe('vacation-timetable');
  });
});

/* ───────────────────────── v1·v2 데이터 하위호환(note 문자열) ───────────────────────── */

describe('tripStatus — v1·v2 데이터(note 문자열)도 같은 판정을 받는다', () => {
  it('금(X) 문자열: 금요일 제외 / 월요일 운행', () => {
    const legacy = legacyTrip(2, '08:35', '금(X)');
    const friday = tripStatus(legacy, FRI);
    expect(friday.runs).toBe(false);
    expect(friday.reason).toBe('weekday-excluded');
    expect(friday.excludedDays).toEqual(['fri']);
    expect(tripStatus(legacy, MON).runs).toBe(true);
  });

  it('주석성 표기(월~화 2대 운행 · 0:15)는 운행 여부를 바꾸지 않고 주석으로만 남는다', () => {
    const multi = legacyTrip(3, '09:00', '월~화 2대 운행');
    const multiStatus = tripStatus(multi, MON);
    expect(multiStatus.runs).toBe(true);
    expect(multiStatus.reason).toBe('normal');
    expect(multiStatus.notes).toEqual(['월~화 2대 운행']);

    const duration = legacyTrip(1, '08:05', '0:15');
    const durationStatus = tripStatus(duration, MON);
    expect(durationStatus.runs).toBe(true);
    expect(durationStatus.notes).toEqual(['0:15']);
    expect(durationStatus.warnings).toEqual([]);
  });

  it('미해석 표기는 버리지 않는다 — 사유 unknown-note · 원문 보존 · 경고 수집', () => {
    const unknown = legacyTrip(16, '20:00', '중간노선 전용');
    const status = tripStatus(unknown, MON);
    expect(status.runs).toBe(true);
    expect(status.reason).toBe('unknown-note');
    expect(status.unknownNote).toBe('중간노선 전용');
    expect(status.warnings[0]).toContain('중간노선 전용');
  });

  it('빈 특이사항(공백·전각 공백)은 주석도 경고도 만들지 않는다', () => {
    for (const note of [null, '', '　']) {
      const status = tripStatus(legacyTrip(9, '10:00', note), MON);
      expect(status.runs).toBe(true);
      expect(status.reason).toBe('normal');
      expect(status.notes).toEqual([]);
      expect(status.warnings).toEqual([]);
    }
  });

  it('평일 표 회차(조건 없음)는 평일·토·일 어디서나 기본 동작이다', () => {
    for (const target of [MON, TUE, WED, SAT, SUN]) {
      expect(tripStatus(plainTrip(1, '08:05'), target).reason).toBe('normal');
    }
  });
});

/* ───────────────────────── 계약(enum·기본값) ───────────────────────── */

describe('tripStatus — 사유 코드 계약', () => {
  it('사유 코드 7종은 docs/06 §2 확정 enum 이다', () => {
    expect(TRIP_REASON_CODES).toEqual([
      'normal',
      'holiday-no-service',
      'holiday-alternate',
      'weekday-excluded',
      'day-scope',
      'vacation-timetable',
      'unknown-note',
    ]);
  });

  it('조건이 없는 회차는 계약 필드 4종(runs·reason·label·sourceQuote)을 항상 준다', () => {
    const status = tripStatus(plainTrip(1, '08:05'), MON);
    expect(Object.keys(status)).toEqual(
      expect.arrayContaining(['runs', 'reason', 'label', 'sourceQuote']),
    );
    expect(status.label).toBeNull();
    expect(status.sourceQuote).toBeNull();
  });
});
