import type { DayType } from '../entities/DayType';
import { toKstParts } from './kst';

/**
 * 요일 번호 → `DayType` (요구사항 F1: 평일 / 토요일 / 일요일).
 * `0=일 … 6=토` (JS `Date` 규약).
 */
export function dayTypeFromWeekday(weekday: number): DayType {
  if (weekday === 0) return 'sunday';
  if (weekday === 6) return 'saturday';
  return 'weekday';
}

/**
 * 인스턴트 → 그 시각의 **KST 기준** `DayType`.
 * 호스트 TZ 와 무관하게 같은 결과를 준다(`rules/kst.ts` 의 고정 오프셋).
 */
export function dayTypeFromDate(instant: Date): DayType {
  return dayTypeFromWeekday(toKstParts(instant).weekday);
}

/** `DayType` → 사람이 읽는 라벨(화면·로그용). */
export function dayTypeLabel(dayType: DayType): string {
  if (dayType === 'weekday') return '평일';
  if (dayType === 'saturday') return '토요일';
  return '일요일';
}
