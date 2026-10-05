/**
 * 문장 → **날짜·요일 유도**. 규칙·AI 산출물 모두 이 함수만 쓴다.
 *
 * 원칙(`FR-A2`): **AI 는 수치를 만들지 않는다.** 날짜는 항상 ① 원본 문장에서 파싱하거나
 * ② 학기 라벨(예: `2026-2학기부터`)을 학기 시작일로 환산해 얻는다 — 그 환산도 여기(규칙)에서만 한다.
 *
 * 연도 생략 표기(`[10.3.~10.4.]`, `~ 12.13.`)는 **학기 시작 연도**에서 추론하고
 * `yearInferred: true` 로 **명시**한다(갭 ⑥ 수용 기준).
 */

import type { DayType, SemesterPeriod } from './types.js';

export type DateDerivation = 'bracket' | 'explicit' | 'semester' | 'none';

export interface DerivedDates {
  readonly start: string | null;
  readonly end: string | null;
  /** 원본 표기에 연도가 없어 학기에서 추론했는가 */
  readonly yearInferred: boolean;
  readonly derivation: DateDerivation;
}

const EMPTY: DerivedDates = { start: null, end: null, yearInferred: false, derivation: 'none' };

const KR_WEEKDAY: Readonly<Record<string, DayType>> = {
  월: 'weekday',
  화: 'weekday',
  수: 'weekday',
  목: 'weekday',
  금: 'weekday',
  토: 'saturday',
  일: 'sunday',
};

/** `(토)`, `(일)`, `(월)` 표기 → `dayTypes` (순서는 DAY_TYPES 순) */
export function deriveDayTypes(text: string, dayOrder: readonly DayType[] = ['weekday', 'saturday', 'sunday']): DayType[] {
  const found = new Set<DayType>();
  for (const match of text.matchAll(/\(([월화수목금토일])\)/g)) {
    const token = match[1];
    if (token === undefined) continue;
    const dayType = KR_WEEKDAY[token];
    if (dayType !== undefined) found.add(dayType);
  }
  return dayOrder.filter((day) => found.has(day));
}

/** `(월)`~`(금)` 만 있으면 평일 전체(`weekday`)로 본다 — 위 함수가 이미 그렇게 매핑한다. */
export function weekdayTokensOf(text: string): string[] {
  return [...text.matchAll(/\(([월화수목금토일])\)/g)].map((m) => m[1] ?? '');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function semesterYear(semester: SemesterPeriod | null): number | null {
  if (semester === null) return null;
  const year = Number.parseInt(semester.startsOn.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

const BRACKET = /\[([^\]]{1,60})\]/;
const BRACKET_PAIR = /(\d{1,2})\s*\.\s*(\d{1,2})/g;
const EXPLICIT_WITH_YEAR = /(\d{4})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})/;
const EXPLICIT_NO_YEAR = /(\d{1,2})\s*\.\s*(\d{1,2})/;
const SEMESTER_LABEL = /(\d{4})\s*-\s*(\d)\s*학기/;

/**
 * 문장에서 날짜 범위를 유도한다.
 * - `[…]` 안 날짜 쌍(공지 표기) → bracket
 * - `2026.9.5. ~ 12.13.` / `2026-09-01 ~ 2026-12-14` → explicit
 * - `2026-2학기부터` → semester(학기 시작일로 환산: 1학기 3/1 · 2학기 9/1)
 */
export function deriveDates(quote: string, semester: SemesterPeriod | null): DerivedDates {
  const year = semesterYear(semester);

  // ① 공지 표기 `[10.3.(토)~10.4(일)]`
  const bracket = BRACKET.exec(quote);
  if (bracket?.[1] !== undefined) {
    const pairs = [...bracket[1].matchAll(BRACKET_PAIR)]
      .map((m) => ({ month: Number(m[1]), day: Number(m[2]) }))
      .filter((pair) => pair.month >= 1 && pair.month <= 12 && pair.day >= 1 && pair.day <= 31);
    if (pairs.length > 0 && year !== null) {
      const first = pairs[0];
      const last = pairs[pairs.length - 1];
      if (first !== undefined && last !== undefined) {
        const start = toIso(year, first.month, first.day);
        const end = toIso(year, last.month, last.day);
        return { start, end, yearInferred: !/\d{4}/.test(bracket[1]), derivation: 'bracket' };
      }
    }
  }

  // ② 명시적 날짜 범위 `2026.9.5.(토) ~ 12.13.(일)`
  const rangeParts = quote.split('~');
  if (rangeParts.length === 2) {
    const left = rangeParts[0] ?? '';
    const right = rangeParts[1] ?? '';
    const startMatch = EXPLICIT_WITH_YEAR.exec(left);
    if (startMatch !== null) {
      const start = toIso(Number(startMatch[1]), Number(startMatch[2]), Number(startMatch[3]));
      const endWithYear = EXPLICIT_WITH_YEAR.exec(right);
      let end: string | null = null;
      let yearInferred = false;
      if (endWithYear !== null) {
        end = toIso(Number(endWithYear[1]), Number(endWithYear[2]), Number(endWithYear[3]));
      } else {
        const endNoYear = EXPLICIT_NO_YEAR.exec(right);
        if (endNoYear !== null) {
          end = toIso(Number(startMatch[1]), Number(endNoYear[1]), Number(endNoYear[2]));
          yearInferred = true;
        }
      }
      return { start, end, yearInferred, derivation: 'explicit' };
    }
  }

  // ③ 학기 라벨 → 학기 시작일 환산
  const label = SEMESTER_LABEL.exec(quote);
  if (label !== null) {
    const currentMatch = semester !== null && semester.label === `${label[1]}-${label[2]}학기`;
    const labelYear = Number(label[1]);
    const term = Number(label[2]);
    const start = currentMatch ? semester.startsOn : toIso(labelYear, term === 1 ? 3 : 9, 1);
    return { start, end: null, yearInferred: false, derivation: 'semester' };
  }

  return EMPTY;
}

/** `2026-2학기부터` 처럼 특정 학기 라벨을 가리키면 그 학기 시작일(현재 학기와 같을 때만) — 아니면 null */
export function semesterStartForLabel(quote: string, semester: SemesterPeriod | null): string | null {
  const label = SEMESTER_LABEL.exec(quote);
  if (label === null || semester === null) return null;
  return semester.label === `${label[1]}-${label[2]}학기` ? semester.startsOn : null;
}
