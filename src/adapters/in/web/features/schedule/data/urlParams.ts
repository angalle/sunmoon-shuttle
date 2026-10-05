/**
 * 웹 어댑터의 URL 파라미터 해석 (features/schedule/data).
 *
 * 왜 필요한가
 * - **clock 주입**: 도메인은 `Date.now()` 금지(경계) → 현재 시각은 포트(`src/ports/clock.ts`)로 넣는다.
 *   배포 앱은 시스템 시각을 쓰고, `?now=<ISO8601>` 이 있으면 그 시각을 쓴다(스모크 스크립트 결정성용).
 * - **초기 선택**: `?day=weekday|saturday|sunday`, `?route=<routeId>` — 스모크·공유 링크용.
 *   값이 이상하면 무시하고 기본값(오늘 KST 요일 / 첫 노선)을 쓴다.
 */
import { isDayType, type DayType } from '../../../../../../domain/entities/DayType';
import type { Clock } from '../../../../../../ports/clock';

export interface InitialSelection {
  readonly dayType: DayType | null;
  readonly routeId: string | null;
}

/** `?now=` 를 읽어 Clock 을 만든다. 없거나 잘못되면 시스템 시각. */
export function createWebClock(search: string, systemNow: () => Date = () => new Date()): Clock {
  const raw = new URLSearchParams(search).get('now');
  if (raw === null) return { now: systemNow };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { now: systemNow };
  return { now: () => new Date(parsed.getTime()) };
}

/** `?day=`·`?route=` 초기 선택. 잘못된 값은 null(기본값 사용). */
export function readInitialSelection(search: string): InitialSelection {
  const params = new URLSearchParams(search);
  const day = params.get('day');
  const route = params.get('route');
  return {
    dayType: isDayType(day) ? day : null,
    routeId: route !== null && route.trim() !== '' ? route.trim() : null,
  };
}
