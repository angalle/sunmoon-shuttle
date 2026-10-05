import { describe, expect, it } from 'vitest';

import {
  DAY_TYPES,
  dayTypeFromWeekdayLabel,
  isDayType,
} from '../../src/domain/entities/DayType';

describe('DayType — 요일 표기 → DayType (요구사항 F1)', () => {
  it('평일: 월~금 은 weekday', () => {
    for (const label of ['월', '화', '수', '목', '금']) {
      expect(dayTypeFromWeekdayLabel(label)).toBe('weekday');
    }
  });

  it('토요일: 토 는 saturday', () => {
    expect(dayTypeFromWeekdayLabel('토')).toBe('saturday');
  });

  it('일요일: 일 은 sunday', () => {
    expect(dayTypeFromWeekdayLabel('일')).toBe('sunday');
  });

  it('알 수 없는 표기는 명시적 오류(조용한 무시 금지)', () => {
    expect(() => dayTypeFromWeekdayLabel('X')).toThrowError(/알 수 없는 요일 표기/);
  });

  it('정본 순서와 타입 가드', () => {
    expect([...DAY_TYPES]).toEqual(['weekday', 'saturday', 'sunday']);
    expect(isDayType('weekday')).toBe(true);
    expect(isDayType('holiday')).toBe(false);
    expect(isDayType(1)).toBe(false);
  });
});
