import type { DayType } from '../entities/DayType';
import type { Notice } from '../entities/Notice';
import { tripDepartureTime, type Trip } from '../entities/Trip';
import { dayTypeFromWeekday } from './dayType';
import { formatIsoDate, type KstDay } from './kst';
import {
  matchTripNoteRule,
  TRIP_NOTE_RULES,
  tripStatus,
  weekdayIndexFromCode,
  type TripNoteRule,
  type TripNoteRuleId,
  type TripReasonCode,
  type TripStatusContext,
  type TripStatus,
} from './tripStatus';

/**
 * 운행 여부 판정 규칙 (요구사항 F3·F7 · `docs/06 §2`).
 *
 * - **날짜 단위** 판정은 이 파일(`resolveDayService`)이 담당한다(안내문 원문 → 운행 없음/대체 시간표).
 * - **회차(편) 단위** 판정은 `rules/tripStatus.ts` 의 `tripStatus` 가 담당한다 — 여기서는 그 결과를
 *   옛 계약(`TripServiceStatus`)으로 옮겨 주기만 한다(판정 재구현 금지).
 * - 규칙(문자열 패턴 표)은 `tripStatus.ts` 의 `TRIP_NOTE_RULES` 하나뿐이다 — 아래에서 재노출한다.
 * - 해석하지 못하는 표기는 **경고(`warnings`)로 수집**한다 — 조용히 무시하지 않는다.
 * - 해석 못 한 표기가 운행 여부를 바꾸지는 않는다(표에 실린 회차는 운행으로 본다).
 *   근거: `docs/00-requirements.md` F8(빈 화면 금지) + 회차 표가 정본.
 */

/* ────────────────────────── 안내문(notices) 패턴 표 ────────────────────────── */

export type NoticeRuleId = 'no-service' | 'day-type-override';

export interface NoticeRule {
  readonly id: NoticeRuleId;
  readonly pattern: RegExp;
  /** `day-type-override` 일 때 대체할 시간표 */
  readonly dayType: DayType | null;
  readonly description: string;
}

/**
 * 안내문 문구 → 규칙. **위에서부터 먼저 맞는 것 하나**를 쓴다.
 * 근거 원문(원본 스냅샷 `data/raw/2026-2학기-asan-ktx-요일혼합.html` 안내사항):
 *   `*한글날[10. 9.(금)]: 셔틀버스 운행 없음`
 *   `*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음`
 *   `*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행`
 */
export const NOTICE_RULES: readonly NoticeRule[] = [
  {
    id: 'no-service',
    pattern: /운행\s*없음|운행\s*중단|미운행/,
    dayType: null,
    description: '해당 날짜 셔틀버스 운행 없음 (예: "*한글날[10. 9.(금)]: 셔틀버스 운행 없음")',
  },
  {
    id: 'day-type-override',
    pattern: /일요일\s*시간표로\s*운행/,
    dayType: 'sunday',
    description: '해당 날짜는 일요일 시간표로 운행 (예: "*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행")',
  },
  {
    id: 'day-type-override',
    pattern: /토요일\s*시간표로\s*운행/,
    dayType: 'saturday',
    description: '해당 날짜는 토요일 시간표로 운행',
  },
  {
    id: 'day-type-override',
    pattern: /평일\s*시간표로\s*운행/,
    dayType: 'weekday',
    description: '해당 날짜는 평일 시간표로 운행',
  },
];

/** 안내문 문구에 맞는 규칙(없으면 null). */
export function matchNoticeRule(text: string): NoticeRule | null {
  for (const rule of NOTICE_RULES) {
    if (rule.pattern.test(text)) return rule;
  }
  return null;
}

/* ────────────────────────── 회차 특이사항 패턴 표 재노출 ──────────────────────────
 * 구현(판정)은 `tripStatus.ts` 에 있다 — 여기 import 경로를 쓰던 호출부·테스트를 깨지 않게 재노출한다.
 */

export { matchTripNoteRule, TRIP_NOTE_RULES };
export type { TripNoteRule, TripNoteRuleId };

/* ────────────────────────── 날짜 단위 판정 ────────────────────────── */

export interface DayServiceStatus {
  /** 그 날짜에 셔틀버스가 운행되는가 */
  readonly serviceOn: boolean;
  /** 날짜(KST) */
  readonly date: string;
  /** 달력 요일로 정한 구분 */
  readonly dayType: DayType;
  /** 안내문 대체가 반영된 실제로 쓸 시간표 구분 */
  readonly effectiveDayType: DayType;
  /** 대체 근거가 된 안내문(없으면 null) */
  readonly overrideNotice: Notice | null;
  /** 운행 없음 사유(안내문 원문, 운행일이면 null) */
  readonly reason: string | null;
  readonly warnings: readonly string[];
}

/**
 * 그 날짜의 운행 여부·적용 시간표를 정한다.
 * - 그 날짜(`YYYY-MM-DD`)에 해당하는 안내문만 본다. 날짜가 없거나 형식이 어긋나면 경고.
 * - `운행 없음` 안내문이 있으면 `serviceOn=false`(그 사실을 사유와 함께 반환).
 * - `일요일 시간표로 운행` 안내문이 있으면 `effectiveDayType` 만 바꾼다(운행은 한다).
 */
export function resolveDayService(day: KstDay, notices: readonly Notice[]): DayServiceStatus {
  const date = formatIsoDate(day);
  const warnings: string[] = [];
  const dayType = dayTypeFromWeekday(day.weekday);

  let serviceOn = true;
  let reason: string | null = null;
  let overrideNotice: Notice | null = null;
  let effectiveDayType: DayType = dayType;

  for (const notice of notices) {
    if (!isIsoDate(notice.date)) {
      warnings.push(`안내문 날짜가 YYYY-MM-DD 형식이 아닙니다: ${JSON.stringify(notice.date)} / ${notice.text}`);
      continue;
    }
    if (notice.date !== date) continue;

    const rule = matchNoticeRule(notice.text);
    if (rule === null) {
      warnings.push(`안내문 문구를 해석하지 못했습니다(패턴 표 미등록): ${JSON.stringify(notice.text)}`);
      continue;
    }
    if (rule.id === 'no-service') {
      serviceOn = false;
      reason = notice.text;
      continue;
    }
    if (rule.dayType !== null) {
      overrideNotice = notice;
      effectiveDayType = rule.dayType;
    }
  }

  return { serviceOn, date, dayType, effectiveDayType, overrideNotice, reason, warnings };
}

/* ────────────────────────── 회차 단위 판정 (옛 계약 어댑터) ────────────────────────── */

export type TripServiceReason =
  | 'runs'
  | 'weekday-exclusion'
  | 'no-departure-time'
  | 'holiday-no-service'
  | 'unknown-note';

export interface TripServiceStatus {
  readonly runs: boolean;
  readonly reason: TripServiceReason;
  /** 제외 근거가 된 요일 번호(0=일..6=토), 아니면 null */
  readonly excludedWeekday: number | null;
  /** 운행 안내 주석(예: "월~화 2대 운행") — 표시용 */
  readonly annotations: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * 그 날짜에 그 회차가 안내 대상인지 판정한다 — 판정 자체는 `tripStatus` 가 한다(단일 책임).
 * 이 함수는 ① 출발 시각 없는 회차 제외(`no-departure-time`) ② 사유 코드 → 옛 계약 이름 변환만 한다.
 * `context`(날짜 규칙·학기/방학)를 넘기면 `tripStatus` 가 우선순위 ①·③까지 반영한다.
 */
export function resolveTripService(
  trip: Trip,
  day: KstDay,
  context: TripStatusContext = {},
): TripServiceStatus {
  if (tripDepartureTime(trip) === null) {
    return {
      runs: false,
      reason: 'no-departure-time',
      excludedWeekday: null,
      annotations: [],
      warnings: [`출발 시각이 없는 회차입니다(순번 ${trip.seq}) — 안내 대상에서 제외`],
    };
  }

  const status: TripStatus = tripStatus(trip, day, context);
  const firstExcluded = status.excludedDays[0];
  return {
    runs: status.runs,
    reason: legacyReasonOf(status.reason),
    excludedWeekday: firstExcluded === undefined ? null : weekdayIndexFromCode(firstExcluded),
    annotations: status.notes,
    warnings: status.warnings,
  };
}

/** `docs/06 §2` 사유 코드 → 이 파일의 옛 계약 이름(호출부·테스트 하위호환). */
function legacyReasonOf(reason: TripReasonCode): TripServiceReason {
  switch (reason) {
    case 'weekday-excluded':
      return 'weekday-exclusion';
    case 'unknown-note':
      return 'unknown-note';
    case 'holiday-no-service':
      return 'holiday-no-service';
    default:
      return 'runs';
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
