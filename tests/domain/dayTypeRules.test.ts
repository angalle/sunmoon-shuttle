import { describe, expect, it } from 'vitest';

import { dayTypeFromDate, dayTypeFromWeekday, dayTypeLabel } from '../../src/domain/rules/dayType';
import { kstDayFromInstant, toKstParts } from '../../src/domain/rules/kst';

describe('rules/dayType — 요일 판정 (요구사항 F1)', () => {
  it('요일 번호 0=일·6=토 → sunday/saturday, 나머지는 weekday', () => {
    expect(dayTypeFromWeekday(0)).toBe('sunday');
    expect(dayTypeFromWeekday(1)).toBe('weekday');
    expect(dayTypeFromWeekday(5)).toBe('weekday');
    expect(dayTypeFromWeekday(6)).toBe('saturday');
  });

  it('인스턴트 → KST 기준 DayType (UTC 14:59 = KST 23:59 같은 날 / UTC 15:00 = KST 다음날 00:00)', () => {
    // 2026-10-09(금) 14:59:00Z = KST 2026-10-09 23:59 → 아직 금요일(평일)
    expect(dayTypeFromDate(new Date('2026-10-09T14:59:00Z'))).toBe('weekday');
    // KST 자정을 넘기면 토요일
    expect(dayTypeFromDate(new Date('2026-10-09T15:00:01Z'))).toBe('saturday');
  });

  it('호스트 TZ 와 무관하게 KST 달력으로 계산한다(고정 +09:00)', () => {
    const instant = new Date('2026-10-05T00:30:00+09:00');
    const parts = toKstParts(instant);
    expect({ ...kstDayFromInstant(instant) }).toEqual({ year: 2026, month: 10, day: 5, weekday: 1 });
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(30);
    expect(dayTypeLabel('saturday')).toBe('토요일');
  });
});
