/**
 * 표시 포맷 (shared/lib) — 순수 함수만. KST 달력 변환은 **도메인 규칙**을 쓴다
 * (화면에서 날짜/시간 계산을 다시 구현하지 않는다 — T5 스택 제약).
 */
import { formatIsoDate, kstDayOf, toKstParts } from '../../../../../domain/rules/kst';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** ISO 문자열(스키마의 `+09:00` 표기) → `YYYY-MM-DD HH:MM (KST)`. 해석 실패 시 원문 그대로. */
export function formatKstInstant(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  const parts = toKstParts(instant);
  const date = formatIsoDate(kstDayOf(parts));
  const hh = pad2(parts.hour);
  const mm = pad2(parts.minute);
  return `${date} ${hh}:${mm} (KST)`;
}

/** `YYYY-MM-DD`(KST 날짜) → `YYYY-MM-DD (요일)`. */
export function formatKstDate(isoDate: string, weekdayLabels: readonly string[]): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const label = weekdayLabels[parsed.getUTCDay()] ?? '';
  return `${isoDate} (${label})`;
}

/** 기준 시각 대비 경과 시간을 사람 문구로: `방금` · `37분 전` · `5시간 전` · `46일 전`. */
export function formatAge(fromIso: string, nowMs: number): string {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return '시각 해석 실패';
  const diff = nowMs - from;
  if (diff < 0) return '예정 시각(시계 확인 필요)';
  if (diff < MS_PER_MINUTE) return '방금';
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)}분 전`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}시간 전`;
  return `${Math.floor(diff / MS_PER_DAY)}일 전`;
}

/** `YYYY-MM-DD`(KST 자정) 기준 경과 */
export function formatAgeOfDate(isoDate: string, nowMs: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 9 * MS_PER_HOUR;
  return formatAge(new Date(start).toISOString(), nowMs);
}

/** 남은 시간(초) → `곧 출발` · `약 25분 후` · `약 1시간 20분 후`. */
export function formatRemaining(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  if (seconds < 60) return '곧 출발(1분 미만)';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `약 ${minutes}분 후`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `약 ${hours}시간 후`;
  return `약 ${hours}시간 ${rest}분 후`;
}

/** 경과 시간(시간) — 48h 초과 판정용. 해석 실패는 null. */
export function ageHours(fromIso: string, nowMs: number): number | null {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return null;
  return (nowMs - from) / MS_PER_HOUR;
}

/** `YYYY-MM-DD`(KST) 기준 경과 시간. 해석 실패는 null. */
export function ageHoursOfDate(isoDate: string, nowMs: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return null;
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 9 * MS_PER_HOUR;
  return (nowMs - start) / MS_PER_HOUR;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
