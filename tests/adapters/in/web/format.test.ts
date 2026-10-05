/**
 * 표시 포맷 테스트 — KST 변환은 도메인 규칙(`domain/rules/kst`)을 통과한 값만 쓴다.
 */
import { describe, expect, it } from 'vitest';
import {
  ageHours,
  ageHoursOfDate,
  formatAge,
  formatAgeOfDate,
  formatKstDate,
  formatKstInstant,
  formatRemaining,
} from '../../../../src/adapters/in/web/shared/lib/format';
import { WEEKDAY_LABELS } from '../../../../src/domain/rules/kst';

describe('formatRemaining', () => {
  it('1분 미만·분·시간 단위를 구분한다', () => {
    expect(formatRemaining(30)).toBe('곧 출발(1분 미만)');
    expect(formatRemaining(45 * 60)).toBe('약 45분 후');
    expect(formatRemaining(90 * 60)).toBe('약 1시간 30분 후');
    expect(formatRemaining(120 * 60)).toBe('약 2시간 후');
  });
});

describe('KST 포맷', () => {
  it('ISO 인스턴트를 KST 로 표시한다(호스트 TZ 무관)', () => {
    expect(formatKstInstant('2026-10-05T14:39:32+09:00')).toBe('2026-10-05 14:39 (KST)');
    expect(formatKstInstant('2026-10-05T05:39:32Z')).toBe('2026-10-05 14:39 (KST)');
    expect(formatKstInstant('이상한 값')).toBe('이상한 값');
  });

  it('날짜에 요일을 붙인다', () => {
    expect(formatKstDate('2026-10-09', WEEKDAY_LABELS)).toBe('2026-10-09 (금)');
    expect(formatKstDate('2026-08-20', WEEKDAY_LABELS)).toBe('2026-08-20 (목)');
  });
});

describe('경과 시간', () => {
  const now = Date.parse('2026-10-06T07:40:00+09:00');

  it('분·시간·일 단위 문구', () => {
    expect(formatAge('2026-10-06T07:39:30+09:00', now)).toBe('방금');
    expect(formatAge('2026-10-06T07:10:00+09:00', now)).toBe('30분 전');
    expect(formatAge('2026-10-06T01:40:00+09:00', now)).toBe('6시간 전');
    expect(formatAge('2026-10-04T07:40:00+09:00', now)).toBe('2일 전');
    expect(formatAgeOfDate('2026-08-20', now)).toBe('47일 전');
  });

  it('48시간 판정용 시간 계산', () => {
    expect(ageHours('2026-10-05T14:39:32+09:00', now)).toBeCloseTo(17.0, 1);
    expect(ageHoursOfDate('2026-08-20', now)).toBeGreaterThan(48);
    expect(ageHours('이상한 값', now)).toBeNull();
    expect(ageHoursOfDate('2026-8-1', now)).toBeNull();
  });
});
