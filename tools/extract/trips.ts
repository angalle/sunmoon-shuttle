/**
 * 편별 조건 구조화(스키마 v3) — 원본 표의 `운행 특이사항` 열 표기를 **구조**로 옮긴다.
 *
 * 왜 필요한가: v2 까지 이 열은 문자열(`금(X)` 등)로 남아 있었고, 앱은 그 문자열을 패턴 표로 다시
 * 해석해야 했다. 그래서 **금요일에 운행하지 않는 편이 금요일 목록에도 그대로 실렸다**(판정 불가).
 * v3 는 편별 조건을 `service`/`durationMinutes` 로 구조화하고 `note` 를 비운다(`docs/06 §3`).
 *
 * 원칙
 *  - **수치는 여기서만 만든다**(요일 코드·대수·분). AI 금지 영역(FR-A2).
 *  - `sourceQuote` 는 **원문 표기 그대로**(trim 만) — 인용 검증의 진본이다.
 *  - 표에 없는 표기는 **버리지 않는다** → `outcome: 'unknown'` + `unknownNote` + `needsReview`.
 *  - 표기 변환은 아래 `TRIP_NOTE_RULES` **표에만** 있다(코드에 매직 분기 금지 — `serviceDay.ts` 와 같은 원칙).
 */

import { DAY_TYPES } from '../scraper/types.js';
import type { DayType, Timetable, TripRow } from '../scraper/types.js';
import { ROUTES } from '../scraper/routeMeta.js';
import type { TripConditionEntry, TripService, WeekdayCode } from './types.js';

/** 원문 요일 한 글자 → 계약 요일 코드. 순서(월→일)는 `WEEKDAY_ORDER` 로 고정한다. */
const WEEKDAY_LABEL: Readonly<Record<string, WeekdayCode>> = {
  월: 'mon',
  화: 'tue',
  수: 'wed',
  목: 'thu',
  금: 'fri',
  토: 'sat',
  일: 'sun',
};

/** 요일 코드 계약 순서(월요일 시작) — `dayScope` 를 이 순서로 정렬한다(결정적). */
export const WEEKDAY_ORDER: readonly WeekdayCode[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface TripNoteRule {
  readonly id: 'weekday-exclusion' | 'weekday-scope-with-count' | 'duration-annotation' | 'label';
  /** 공백을 제거한 표기에 적용한다(`중간노선전용` == `중간노선 전용`) */
  readonly pattern: RegExp;
  readonly apply: (match: RegExpExecArray) => Pick<TripService, 'excludedDays' | 'dayScope' | 'vehicleCount' | 'label'> | { readonly durationMinutes: number };
}

/** 공백 제거 표기 — 사전의 대조 기준(`금 ( X )` · `중간노선 전용` 둘 다 같은 값으로 본다). */
export function compactNote(note: string): string {
  return note.replace(/[\s\u3000]+/gu, '');
}

function weekdayRange(from: WeekdayCode, to: WeekdayCode): WeekdayCode[] {
  const start = WEEKDAY_ORDER.indexOf(from);
  const end = WEEKDAY_ORDER.indexOf(to);
  if (start < 0 || end < 0 || start > end) return [];
  return WEEKDAY_ORDER.slice(start, end + 1);
}

/**
 * 표기 정규화 사전(`docs/06 §3`) — **위에서부터 먼저 맞는 규칙 하나**를 쓴다.
 * `금(X)` · `금X` · `금요일 없음` → 미운행 요일 / `월~화 2대 운행` → 요일 범위 + 대수 /
 * `0:15` → 소요 분 / `중간노선전용` → 라벨(공백 표기 통일).
 */
export const TRIP_NOTE_RULES: readonly TripNoteRule[] = [
  {
    id: 'weekday-exclusion',
    // `금(X)` · `금X` · `금(X` · `금요일 없음` — 괄호·X·`없음` 변형을 모두 흡수한다.
    pattern: /^([월화수목금토일])(?:요일)?(?:[([]?[XxΧ×][)\]）]?|없음)$/,
    apply: (match) => {
      const code = WEEKDAY_LABEL[match[1] ?? ''];
      return { excludedDays: code === undefined ? [] : [code], dayScope: null, vehicleCount: null, label: null };
    },
  },
  {
    id: 'weekday-scope-with-count',
    pattern: /^([월화수목금토일])[~\-]([월화수목금토일])(\d{1,2})대운행$/,
    apply: (match) => {
      const from = WEEKDAY_LABEL[match[1] ?? ''];
      const to = WEEKDAY_LABEL[match[2] ?? ''];
      const count = Number(match[3]);
      const scope = from === undefined || to === undefined ? [] : weekdayRange(from, to);
      return {
        excludedDays: [],
        dayScope: scope.length === 0 ? null : scope,
        vehicleCount: scope.length === 0 || !Number.isInteger(count) || count <= 0 ? null : count,
        label: null,
      };
    },
  },
  {
    id: 'duration-annotation',
    // 소요시간(H:MM) — `0:15`(15분)처럼 한 자리 시(時)도 온다(원본 실측).
    pattern: /^(\d{1,3}):(\d{2})$/,
    apply: (match) => ({ durationMinutes: Number(match[1]) * 60 + Number(match[2]) }),
  },
  {
    id: 'label',
    pattern: /^중간노선전용$/,
    apply: () => ({ excludedDays: [], dayScope: null, vehicleCount: null, label: '중간노선 전용' }),
  },
];

const MAX_DURATION_MINUTES = 300;

/** `durationMinutes` 가 계약 범위(1~300분)인가 — 검증기와 같은 기준을 쓴다. */
export function isValidDurationMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_DURATION_MINUTES;
}

/**
 * 원문 note 1건 → 구조화 결과(결정적).
 * `sourceQuote` 는 원문 그대로(trim)이고, 해석 실패는 **버리지 않고** `unknown` 으로 남긴다.
 */
export function parseTripNote(note: string): Omit<TripConditionEntry, 'routeId' | 'dayType' | 'seq'> {
  const sourceQuote = note.trim();
  const compact = compactNote(sourceQuote);
  for (const rule of TRIP_NOTE_RULES) {
    const match = rule.pattern.exec(compact);
    if (match === null) continue;
    const applied = rule.apply(match);
    if ('durationMinutes' in applied) {
      // 범위 밖(0:00 · 999:00)은 표기가 아니라 잡음으로 본다 → 미해석 보존
      if (!isValidDurationMinutes(applied.durationMinutes)) break;
      return {
        sourceQuote,
        outcome: 'duration',
        service: null,
        durationMinutes: applied.durationMinutes,
        unknownNote: null,
      };
    }
    const hasMeaning = applied.excludedDays.length > 0 || applied.dayScope !== null || applied.label !== null;
    if (!hasMeaning) break;
    return {
      sourceQuote,
      outcome: 'service',
      service: { ...applied, sourceQuote },
      durationMinutes: null,
      unknownNote: null,
    };
  }
  return { sourceQuote, outcome: 'unknown', service: null, durationMinutes: null, unknownNote: sourceQuote };
}

/** 원문 note 가 있는 행인가(빈 문자열·공백은 없는 것으로 본다 — v1 파서가 `Χ` 를 null 로 만든다). */
export function noteTextOf(row: TripRow): string | null {
  const raw = row['note'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** 행의 순번(없으면 배열 위치 + 1 — v1 조립본과 같은 규칙) */
export function tripSeq(row: TripRow, index: number): number {
  const raw = row['seq'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : index + 1;
}

/**
 * 기준선(v1 조립본)의 모든 노선·요일 표에서 원문 note 를 읽어 구조화한다.
 * `routes[].trips`(대표=평일) 와 `byDay[*].trips` 는 **같은 행을 공유**하므로, 여기서는
 * `byDay` 만 순회한다(중복 계산 금지). 대표 배열은 `enrich.ts` 가 평일 표와 같은 키로 채운다.
 */
export function structureTripConditions(
  base: Timetable,
): readonly { readonly routeId: string; readonly entries: readonly TripConditionEntry[] }[] {
  const out: { routeId: string; entries: TripConditionEntry[] }[] = [];
  for (const route of ROUTES.map((meta) => meta.id)) {
    const routeData = base.routes.find((item) => item.id === route);
    if (routeData === undefined) continue;
    const entries: TripConditionEntry[] = [];
    for (const dayType of DAY_TYPES as readonly DayType[]) {
      const table = routeData.byDay[dayType];
      if (table === undefined) continue;
      table.trips.forEach((row, index) => {
        const note = noteTextOf(row);
        if (note === null) return;
        entries.push({ routeId: route, dayType, seq: tripSeq(row, index), ...parseTripNote(note) });
      });
    }
    if (entries.length > 0) out.push({ routeId: route, entries });
  }
  return out;
}

/** 구조화 결과를 노선·요일·순번 키로 조회한다(enrich·검증 공용). */
export function tripConditionKey(routeId: string, dayType: DayType, seq: number): string {
  return `${routeId}|${dayType}|${seq}`;
}
