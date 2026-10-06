/**
 * 편별 운행 판정 — `docs/06-data-model.md §2` 의 **판정 우선순위를 구현한 유일한 곳**.
 *
 * ```
 * tripStatus(trip, date) → { runs, reason, label, sourceQuote }
 *
 * 1) 날짜 규칙(dateRules)  no-service → 운행 없음 / alternate-schedule → 대체 시간표로 운행
 * 2) 편별 요일 조건(trip.service)  excludedDays → 제외 / dayScope → 범위 밖 제외
 * 3) 기본(byDay 버킷에 실린 회차) → 운행
 * ```
 *
 * 규칙
 * - **판정(운행 여부·사유 코드)은 여기서만** 한다 — 표시 계층은 결과를 문구로 옮기기만 한다.
 * - 문자열 패턴 표는 아래 `TRIP_NOTE_RULES` 하나뿐이다(코드에 매직 분기 금지).
 * - 해석하지 못한 표기는 **버리지 않고** 경고로 모은다(조용히 무시 금지).
 * - v1·v2 데이터(`note` 문자열만 있던 시절)도 같은 판정을 받는다 — 조건 필드가 없으면 기본 동작이다.
 * - 사유 코드(`TripReasonCode`)는 확정 enum 이다: UI 문구는 이 코드에서 **코드로 만들어** 낸다.
 */
import { isDayType, weekdayCodeOf, weekdayIndexOfCode, type DayType, type WeekdayCode } from '../entities/DayType';
import type { Trip } from '../entities/Trip';
import { formatIsoDate, weekdayIndexFromLabel, type KstDay } from './kst';

/* ────────────────────────── 사유 코드 (docs/06 §2) ────────────────────────── */

export type TripReasonCode =
  | 'normal'
  | 'holiday-no-service'
  | 'holiday-alternate'
  | 'weekday-excluded'
  | 'day-scope'
  | 'vacation-timetable'
  | 'unknown-note';

export const TRIP_REASON_CODES: readonly TripReasonCode[] = [
  'normal',
  'holiday-no-service',
  'holiday-alternate',
  'weekday-excluded',
  'day-scope',
  'vacation-timetable',
  'unknown-note',
];

/* ────────────────────────── 회차 특이사항(note) 패턴 표 — v1·v2 하위호환 ────────────────────────── */

export type TripNoteRuleId = 'weekday-exclusion' | 'multi-bus-annotation' | 'duration-annotation';

export interface TripNoteRule {
  readonly id: TripNoteRuleId;
  readonly pattern: RegExp;
  readonly description: string;
}

/**
 * 회차 특이사항(`trip.note`) → 규칙. **위에서부터 먼저 맞는 것 하나**를 쓴다.
 * 근거 원문(스냅샷 '운행 특이사항' 열): `금(X)` · `월~화 2대 운행` · `월~목 2대 운행` ·
 * `0:15`(소요시간) · `중간노선 전용`
 * - `금(X)`      → 그 요일에는 이 회차가 운행되지 않는다(제외).
 * - `월~화 2대 운행` → 운행 여부와 무관한 **주석**(2대 운행 안내)이다. 회차는 운행된다.
 * - `0:15`       → **소요시간(HH:MM) 표기**다. 회차는 운행되고 표시용 주석으로만 남긴다(T13 승인).
 * - 그 밖의 미등록 표기는 경고로 수집하고 운행 여부는 바꾸지 않는다.
 *
 * ⚠️ v3(`docs/06 §3`)부터는 이 표기가 `trip.service` 로 **구조화**되므로 `note` 에는 남지 않는다.
 *    이 표는 v1·v2 데이터(구조화 이전 발행물)를 같은 판정으로 읽기 위해 유지한다.
 */
export const TRIP_NOTE_RULES: readonly TripNoteRule[] = [
  {
    id: 'weekday-exclusion',
    pattern: /^([월화수목금토일])\s*\(\s*[XxΧ×]\s*\)$/,
    description: '해당 요일에는 미운행 (예: "금(X)")',
  },
  {
    id: 'multi-bus-annotation',
    pattern: /^([월화수목금토일])\s*~\s*([월화수목금토일])\s*(\d+)\s*대\s*운행$/,
    description: '기간 중 N대 운행 안내 — 운행 여부를 바꾸지 않는 주석 (예: "월~화 2대 운행")',
  },
  {
    id: 'duration-annotation',
    // 소요시간(HH:MM) — 시:분. `0:15`(15분)처럼 한 자리 시(時)도 온다(원본 실측).
    pattern: /^\d{1,3}:\d{2}$/,
    description: '소요시간(HH:MM) 표기 — 운행 여부를 바꾸지 않는 주석 (예: "0:15")',
  },
];

/** 회차 특이사항 문자열에 맞는 규칙(없으면 null). */
export function matchTripNoteRule(note: string): TripNoteRule | null {
  for (const rule of TRIP_NOTE_RULES) {
    if (rule.pattern.test(note)) return rule;
  }
  return null;
}

/* ────────────────────────── 판정 입력 문맥 (날짜 규칙 · 학기/방학) ────────────────────────── */

/**
 * 날짜 규칙 1건 — 앱 뷰모델(`DateRuleView`)이 구조적으로 만족한다(표시 계층에서 그대로 넘긴다).
 * 판정에 쓰는 필드만 요구한다(나머지 키는 무시).
 */
export interface TripDateRule {
  readonly kind: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly effect?: Readonly<Record<string, unknown>>;
  readonly sourceQuote?: string | null;
  readonly needsReview?: boolean;
}

/** 학기/방학 구간 1건 — 앱 뷰모델(`TermView`)이 구조적으로 만족한다. */
export interface TripTerm {
  readonly kind: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly needsReview?: boolean;
}

export interface TripStatusContext {
  /** 날짜 규칙(운행 없음·대체 시간표). 없으면 날짜 규칙 판정을 건너뛴다. */
  readonly dateRules?: readonly TripDateRule[] | undefined;
  /** 학기/방학 구간(방학 기간이면 방학 시간표). 없으면 건너뛴다. */
  readonly terms?: readonly TripTerm[] | undefined;
}

/* ────────────────────────── 판정 결과 ────────────────────────── */

/** `tripStatus(trip, date)` 반환 — `docs/06 §2` 계약(뒤 필드는 배지·증거용 상세). */
export interface TripStatus {
  /** 그 날짜에 이 회차가 운행하는가 */
  readonly runs: boolean;
  /** 운행 여부의 **사유 코드**(문구는 표시 계층이 코드에서 만든다) */
  readonly reason: TripReasonCode;
  /** 표기 통일본(예 `중간노선 전용`) — 배지 문구로 쓰는 값. 없으면 null */
  readonly label: string | null;
  /** 판정 근거가 된 **원문**(예 `금(X)` · `*한글날[10. 9.(금)]: 셔틀버스 운행 없음`). 없으면 null */
  readonly sourceQuote: string | null;
  /** 매주 운행하지 않는 요일(`금(X)` → `["fri"]`) */
  readonly excludedDays: readonly WeekdayCode[];
  /** 이 요일 범위에서만 운행(`월~화` → `["mon","tue"]`). 조건 없으면 null */
  readonly dayScope: readonly WeekdayCode[] | null;
  /** 운행 대수 안내(`2대 운행` → `2`). 없으면 null */
  readonly vehicleCount: number | null;
  /** 미해석 표기 원문(내부 플래그 — 화면 미노출) */
  readonly unknownNote: string | null;
  /** `holiday-alternate` 일 때 대체할 시간표 구분(데이터의 `effect.timetable`) */
  readonly alternateDayType: DayType | null;
  /** 운행 여부를 바꾸지 않는 표시용 주석(v1·v2 `note` 유래) */
  readonly notes: readonly string[];
  /** 해석하지 못한 표기 — 조용히 숨기지 않는다 */
  readonly warnings: readonly string[];
}

/* ────────────────────────── 판정 본체 ────────────────────────── */

/**
 * 그 날짜에 그 회차가 운행하는지, 그리고 **왜 그런지**를 사유 코드로 돌려준다.
 *
 * @param trip    회차(행)
 * @param day     판정 기준 날짜(KST) — 요일 계산은 이 값만 쓴다
 * @param context 날짜 규칙 · 학기/방학 구간(없으면 요일 조건만 본다)
 */
export function tripStatus(trip: Trip, day: KstDay, context: TripStatusContext = {}): TripStatus {
  const warnings: string[] = [];
  const notes: string[] = [];
  const service = trip.service ?? null;
  const code = weekdayCodeOf(day.weekday);
  const date = formatIsoDate(day);

  const base: Omit<TripStatus, 'runs' | 'reason'> = {
    label: service?.label ?? null,
    sourceQuote: service?.sourceQuote ?? null,
    excludedDays: service?.excludedDays ?? [],
    dayScope: service?.dayScope ?? null,
    vehicleCount: service?.vehicleCount ?? null,
    unknownNote: trip.unknownNote ?? null,
    alternateDayType: null,
    notes,
    warnings,
  };

  /* ① 날짜 규칙 — `start ≤ date ≤ end`(end 없으면 start 당일) */
  const rule = findDateRule(context.dateRules, date);
  if (rule !== null) {
    if (rule.kind === 'no-service') {
      return {
        ...base,
        runs: false,
        reason: 'holiday-no-service',
        sourceQuote: rule.sourceQuote ?? base.sourceQuote,
      };
    }
    if (rule.kind === 'alternate-schedule') {
      const timetable = rule.effect?.['timetable'];
      return {
        ...base,
        runs: true,
        reason: 'holiday-alternate',
        alternateDayType: isDayType(timetable) ? timetable : null,
        sourceQuote: rule.sourceQuote ?? base.sourceQuote,
      };
    }
  }

  /* ② 편별 요일 조건 — 구조화된 필드가 있는 행(v3) */
  if (service !== null) {
    if (code !== null && service.excludedDays.includes(code)) {
      return { ...base, runs: false, reason: 'weekday-excluded' };
    }
    if (service.dayScope !== null && service.dayScope.length > 0) {
      const inScope = code !== null && service.dayScope.includes(code);
      return { ...base, runs: inScope, reason: 'day-scope' };
    }
    return fallback(base, date, context);
  }

  /* ②b 회차 특이사항 문자열 — v1·v2 데이터(구조화 이전 발행물) 하위호환 */
  const compact = (trip.note ?? '').replace(/[\s\u3000]+/g, '');
  if (compact !== '') {
    const noteRule = matchTripNoteRule(compact);
    if (noteRule === null) {
      warnings.push(
        `회차 특이사항을 해석하지 못했습니다(패턴 표 미등록): ${JSON.stringify(trip.note)} (순번 ${trip.seq})`,
      );
      return { ...base, runs: true, reason: 'unknown-note', unknownNote: base.unknownNote ?? trip.note };
    }
    if (noteRule.id === 'weekday-exclusion') {
      const label = noteRule.pattern.exec(compact)?.[1] ?? '';
      const excludedWeekday = weekdayIndexFromLabel(label);
      const excludedCode = excludedWeekday === null ? null : weekdayCodeOf(excludedWeekday);
      if (excludedCode === null) {
        warnings.push(`요일 표기를 해석하지 못했습니다: ${JSON.stringify(trip.note)} (순번 ${trip.seq})`);
        return { ...base, runs: true, reason: 'unknown-note', unknownNote: base.unknownNote ?? trip.note };
      }
      const excludedDays = [excludedCode];
      if (excludedWeekday === day.weekday) {
        return { ...base, excludedDays, runs: false, reason: 'weekday-excluded' };
      }
      return fallback({ ...base, excludedDays }, date, context);
    }
    notes.push(trip.note ?? compact);
  }

  /* ③ 기본 — 표(byDay 버킷)에 실린 회차는 운행이다 */
  return fallback(base, date, context);
}

/**
 * 편별 요일 조건이 운행 여부를 바꾸지 않았을 때의 사유 — 방학 기간이면 `vacation-timetable`,
 * 아니면 기본(`normal`). 값은 어느 쪽이든 운행이다(표에 실린 회차).
 */
function fallback(base: Omit<TripStatus, 'runs' | 'reason'>, date: string, context: TripStatusContext): TripStatus {
  if (containsDate(context.terms, date, 'vacation')) {
    return { ...base, runs: true, reason: 'vacation-timetable' };
  }
  return { ...base, runs: true, reason: 'normal' };
}

/** `start ≤ date ≤ end`(end 없으면 start 당일)인 첫 규칙. `needsReview` 규칙은 판정 근거로 쓰지 않는다. */
function findDateRule(rules: readonly TripDateRule[] | undefined, date: string): TripDateRule | null {
  if (rules === undefined) return null;
  for (const rule of rules) {
    if (rule.needsReview === true) continue;
    if (rule.start === null) continue;
    const end = rule.end ?? rule.start;
    if (rule.start <= date && date <= end) return rule;
  }
  return null;
}

/** 그 날짜를 덮는(기간이 모두 채워진) 학기/방학 구간이 있는가. */
function containsDate(terms: readonly TripTerm[] | undefined, date: string, kind: string): boolean {
  if (terms === undefined) return false;
  for (const term of terms) {
    if (term.kind !== kind) continue;
    if (term.needsReview === true) continue;
    if (term.start === null || term.end === null) continue;
    if (term.start <= date && date <= term.end) return true;
  }
  return false;
}

/** 요일 코드 → 요일 번호(0=일 … 6=토) — 표시 계층·어댑터가 옛 계약으로 옮길 때 쓴다. */
export function weekdayIndexFromCode(code: WeekdayCode): number {
  return weekdayIndexOfCode(code);
}
