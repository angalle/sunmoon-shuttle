/**
 * KST(한국 표준시, UTC+09:00) 달력 계산 — 순수 도메인 규칙.
 *
 * 왜 고정 오프셋인가
 * - 한국은 서머타임이 없다 → UTC+9 고정이 정확하다.
 * - 호스트 TZ(개발자는 KST, CI 는 UTC 일 수 있음)에 결과가 흔들리지 않도록
 *   `getUTC*` 계열만 사용한다 → 같은 입력 = 같은 출력(결정적 테스트).
 *
 * 경계: 이 파일은 `Date.now()` 를 쓰지 않는다. 현재 시각은 포트(`src/ports/clock.ts`)로 주입한다.
 */

/** KST 오프셋(분). */
export const KST_OFFSET_MINUTES = 540;

const MS_PER_MINUTE = 60_000;

/** 요일 라벨 — `0=일 … 6=토` (원본 안내문·특이사항 표기와 같은 순서). */
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** KST 기준 시각(날짜 + 시:분:초 + 요일). */
export interface KstParts {
  readonly year: number;
  readonly month: number; // 1..12
  readonly day: number; // 1..31
  readonly hour: number; // 0..23
  readonly minute: number; // 0..59
  readonly second: number; // 0..59
  readonly weekday: number; // 0=일 .. 6=토 (KST 기준)
}

/** KST 기준 '날짜'만(시각 없음). 날짜 단위 규칙(요일·운행 여부)의 입력. */
export interface KstDay {
  readonly year: number;
  readonly month: number; // 1..12
  readonly day: number; // 1..31
  readonly weekday: number; // 0=일 .. 6=토
}

/** 인스턴트 → KST 시각. 호스트 TZ 와 무관. */
export function toKstParts(instant: Date): KstParts {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

/** KST 시각 → 날짜만. */
export function kstDayOf(parts: KstParts): KstDay {
  return { year: parts.year, month: parts.month, day: parts.day, weekday: parts.weekday };
}

/** 인스턴트 → KST 날짜(편의). 현재 시각에서 "오늘"을 얻을 때 쓴다. */
export function kstDayFromInstant(instant: Date): KstDay {
  return kstDayOf(toKstParts(instant));
}

/** KST 날짜 + (시,분) → 인스턴트. */
export function kstInstantOf(day: KstDay, hour: number, minute: number, second = 0): Date {
  const utcMs =
    Date.UTC(day.year, day.month - 1, day.day, hour, minute, second) -
    KST_OFFSET_MINUTES * MS_PER_MINUTE;
  return new Date(utcMs);
}

/** KST 날짜 + 일수 (월·연 경계 자동 정규화). */
export function addKstDays(day: KstDay, days: number): KstDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** `YYYY-MM-DD` (KST). */
export function formatIsoDate(day: KstDay): string {
  return `${pad4(day.year)}-${pad2(day.month)}-${pad2(day.day)}`;
}

/** `YYYY-MM-DDTHH:MM:SS+09:00` — 스키마(source.fetchedAt)와 같은 표기. */
export function formatKstIso(day: KstDay, hour: number, minute: number, second = 0): string {
  return `${formatIsoDate(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+09:00`;
}

/** `H:MM` · `HH:MM` → (시,분). 범위를 벗어나면 null(추측하지 않는다). */
export function parseHhMm(value: string): { readonly hour: number; readonly minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** `HH:MM` (0 채움). */
export function formatHhMm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 요일 라벨(`월`..`일`) → 요일 번호(0=일..6=토). 모르는 표기는 null. */
export function weekdayIndexFromLabel(label: string): number | null {
  const index = WEEKDAY_LABELS.indexOf(label.trim() as (typeof WEEKDAY_LABELS)[number]);
  return index < 0 ? null : index;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}
