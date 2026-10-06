/**
 * T22 — schema v3 편별 조건(`trip.service`)의 **화면 반영** 테스트 (수용 기준 AC-D7·AC-D8 의 선택자 근거).
 *
 * 검증 대상은 **표시 계층**이다: `parseTimetable`(v3 읽기) → 선택자(`todayBoardView`) → 컴포넌트가 쓰는 값.
 * 판정(운행 여부·사유 코드)은 도메인 `tripStatus` 몫이므로 여기서 다시 계산하지 않는다.
 *
 * 검증하는 것(`docs/06 §5`)
 *  ① 목록·히어로는 **오늘 실제 운행하는 편만** (금요일에 `금(X)` 편이 사라진다)
 *  ② 사유 배지 — `금요일 운행 없음` · `월·화만 운행` · `2대 운행` · 표기 통일본(`중간노선 전용`)
 *  ③ 소요시간 — 값이 있을 때만(`약 15분 소요`), 도착 옆 보조 문구
 *  ④ `needsReview` 는 **내부 플래그** — 화면 값에 나오지 않는다
 *  ⑤ v1·v2 데이터(신규 필드 없음)는 지금과 **같은** 렌더(하위호환)
 *  ⑥ 실제 발행물(`data/timetable.json` v3)의 금요일/월요일 실측
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTimetable } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import { serviceNoticeView, todayBoardView, type DepartureEventView } from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import { BOARD_RAW } from './boardFixtures';

/* ───────────────────────── v3 픽스처(구조 조건이 있는 행) ───────────────────────── */

const WEEKDAY_COLUMNS = ['순', '아산캠퍼스 출발', '천안아산역 출발', '아산캠퍼스 도착', '운행 특이사항'];
const WEEKDAY_KEYS = ['seq', 'depCampus', 'depStation', 'arrCampus', 'note'];

const excluded = (quote: string) => ({ excludedDays: ['fri'], dayScope: null, vehicleCount: null, label: null, sourceQuote: quote });

const V3_RAW: unknown = {
  schemaVersion: 3,
  semester: { title: '2026-2학기 셔틀버스 시간표', label: '2026-2학기', startsOn: '2026-09-01', endsOn: '2026-12-14', kind: 'semester' },
  holidayPeriod: null,
  dayTypes: ['weekday', 'saturday', 'sunday'],
  routes: [
    {
      id: 'r-asan',
      name: '아산(KTX)역',
      path: '캠퍼스 > 역 > 캠퍼스',
      status: 'active',
      offDays: [],
      columns: WEEKDAY_COLUMNS,
      trips: [],
      tripNotes: [],
      stopWindows: [],
      byDay: {
        weekday: {
          columns: WEEKDAY_COLUMNS,
          keys: WEEKDAY_KEYS,
          trips: [
            // 0:15 → durationMinutes 15 (행 단위 소요시간)
            { seq: 1, depCampus: '08:00', depStation: '08:20', arrCampus: '08:35', note: null, service: null, durationMinutes: 15, needsReview: false },
            // 금(X) → 매주 금요일 미운행
            { seq: 2, depCampus: null, depStation: '08:30', arrCampus: '08:45', note: null, service: excluded('금(X)'), durationMinutes: null, needsReview: false },
            // 월~화 2대 운행 → 월·화만 운행 + 2대 운행
            { seq: 3, depCampus: null, depStation: '09:00', arrCampus: '09:15', note: null, service: { excludedDays: [], dayScope: ['mon', 'tue'], vehicleCount: 2, label: null, sourceQuote: '월~화 2대 운행' }, durationMinutes: null, needsReview: false },
            // 표기 통일본(중간노선 전용) — 운행 여부는 바꾸지 않는다
            { seq: 4, depCampus: '10:00', depStation: '10:20', arrCampus: '10:35', note: null, service: { excludedDays: [], dayScope: null, vehicleCount: null, label: '중간노선 전용', sourceQuote: '중간노선전용' }, durationMinutes: null, needsReview: false },
            // 미해석 표기 — 내부 플래그(needsReview) · 원문(unknownNote)은 화면에 올리지 않는다
            { seq: 5, depCampus: null, depStation: '11:00', arrCampus: '11:15', note: '확인필요 표기', service: null, unknownNote: '확인필요 표기', needsReview: true },
          ],
        },
        saturday: {
          columns: WEEKDAY_COLUMNS,
          keys: WEEKDAY_KEYS,
          trips: [{ seq: 1, depCampus: '09:00', depStation: '09:20', arrCampus: '09:35', note: null, service: null, durationMinutes: null, needsReview: false }],
        },
        sunday: {
          columns: WEEKDAY_COLUMNS,
          keys: WEEKDAY_KEYS,
          trips: [
            { seq: 1, depCampus: '09:00', depStation: '09:20', arrCampus: '09:35', note: null, service: null, durationMinutes: null, needsReview: false },
            { seq: 2, depCampus: '12:00', depStation: '12:20', arrCampus: '12:35', note: null, service: null, durationMinutes: null, needsReview: false },
          ],
        },
      },
    },
  ],
  dateRules: [
    { kind: 'no-service', start: '2026-10-09', end: null, dayTypes: ['weekday'], scope: [], effect: { appliesTo: 'all-routes' }, note: null, sourceQuote: '*한글날[10. 9.(금)]: 셔틀버스 운행 없음', needsReview: false },
    { kind: 'alternate-schedule', start: '2026-10-05', end: null, dayTypes: ['weekday'], scope: [], effect: { timetable: 'sunday' }, note: null, sourceQuote: '*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행', needsReview: false },
  ],
  terms: [],
  notices: [
    { kind: 'no-service', text: '한글날: 셔틀버스 운행 없음', raw: '*한글날[10. 9.(금)]: 셔틀버스 운행 없음', date: '2026-10-09' },
    { kind: 'alternate-schedule', text: '개천절대체휴일: 일요일 시간표로 운행', raw: '*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행', date: '2026-10-05' },
  ],
  busRefs: [],
  contacts: null,
  source: {
    url: 'https://example.test/shuttle',
    sourceUpdatedAt: '2026-10-05',
    fetchedAt: '2026-10-05T14:39:32+09:00',
    contentHash: 'sha256:fixture-v3',
    pages: [],
  },
};

const model = parseTimetable(V3_RAW);
const v1Model = parseTimetable(BOARD_RAW);

function state(nowMs: number, overrides: Partial<ScheduleState> = {}): ScheduleState {
  return {
    status: 'ready',
    model,
    errorMessage: null,
    dataSource: 'network',
    cacheAgeMs: null,
    offlineReason: null,
    dayType: 'weekday',
    routeId: 'r-asan',
    nowMs,
    ...overrides,
  };
}

const at = (kstIso: string): number => Date.parse(kstIso);
/** 기준 시각(07:00) — 아직 지난 편이 없어 하루치가 그대로 보인다. */
const FRI = at('2026-10-16T07:00:00+09:00'); // 금(평일)
const MON = at('2026-10-19T07:00:00+09:00'); // 월
const TUE = at('2026-10-20T07:00:00+09:00'); // 화
const WED = at('2026-10-21T07:00:00+09:00'); // 수

const of = (events: readonly DepartureEventView[]): string[] => events.map((event) => event.departure);
const eventAt = (events: readonly DepartureEventView[], departure: string): DepartureEventView | undefined =>
  events.find((event) => event.departure === departure);

/* ───────────────────────── ① 오늘 실제 운행하는 편만 ───────────────────────── */

describe('T22 ① 목록·히어로는 오늘 실제 운행하는 편만', () => {
  it('금요일: 금(X) 편(08:30)과 월~화 편(09:00)이 목록에서 사라진다', () => {
    const friday = todayBoardView(state(FRI));
    expect(of(friday.events)).toEqual(['08:00', '10:00', '11:00']);
    expect(friday.counts.all).toBe(3);
    expect(friday.todayTotal).toBe(3);
  });

  it('월요일: 같은 데이터에서 두 편이 다시 나타난다(비교 기준)', () => {
    const monday = todayBoardView(state(MON));
    expect(of(monday.events)).toEqual(['08:00', '08:30', '09:00', '10:00', '11:00']);
    expect(monday.counts.all).toBe(5);
  });

  it('수요일: 월~화 편은 빠지고 금(X) 편은 살아 있다(요일별로 다른 편이 빠진다)', () => {
    const wednesday = todayBoardView(state(WED));
    expect(of(wednesday.events)).toEqual(['08:00', '08:30', '10:00', '11:00']);
  });

  it('화요일: 월~화 편이 운행 대상이다', () => {
    expect(of(todayBoardView(state(TUE)).events)).toContain('09:00');
  });
});

/* ───────────────────────── ② 사유 배지 ───────────────────────── */

describe('T22 ② 사유 배지 — 도메인 판정에서 만든 문구', () => {
  it('금(X) 편은 평일(월)에 `금요일 운행 없음` 배지로 이유를 밝힌다', () => {
    const monday = todayBoardView(state(MON));
    expect(eventAt(monday.events, '08:30')?.notes).toEqual(['금요일 운행 없음']);
  });

  it('요일 범위 편은 `월·화만 운행` + `2대 운행` 두 배지를 단다', () => {
    const monday = todayBoardView(state(MON));
    expect(eventAt(monday.events, '09:00')?.notes).toEqual(['월·화만 운행', '2대 운행']);
  });

  it('표기 통일본(중간노선 전용)은 데이터 값 그대로 배지가 된다', () => {
    const monday = todayBoardView(state(MON));
    expect(eventAt(monday.events, '10:00')?.notes).toEqual(['중간노선 전용']);
  });

  it('금요일에는 그 사유 배지가 목록에 남지 않는다(해당 편 자체가 없다)', () => {
    const friday = todayBoardView(state(FRI));
    expect(friday.events.some((event) => event.notes.includes('금요일 운행 없음'))).toBe(false);
    expect(friday.events.some((event) => event.notes.includes('월·화만 운행'))).toBe(false);
  });

  it('조건이 없는 편에는 배지가 없다(빈 배지 금지)', () => {
    const monday = todayBoardView(state(MON));
    expect(eventAt(monday.events, '08:00')?.notes).toEqual([]);
  });
});

/* ───────────────────────── ③ 소요시간 ───────────────────────── */

describe('T22 ③ 소요시간 — 값이 있을 때만 도착 옆 보조 문구', () => {
  it('행의 durationMinutes(0:15 → 15)로 `약 15분 소요` 를 만든다', () => {
    const monday = todayBoardView(state(MON));
    expect(eventAt(monday.events, '08:00')?.durationNote).toBe('약 15분 소요');
  });

  it('값이 없는 편에는 문구를 붙이지 않는다(추측 금지)', () => {
    const monday = todayBoardView(state(MON));
    expect(eventAt(monday.events, '08:30')?.durationNote).toBeNull();
    expect(eventAt(monday.events, '09:00')?.durationNote).toBeNull();
  });
});

/* ───────────────────────── ④ 내부 플래그 미노출 ───────────────────────── */

describe('T22 ④ needsReview·unknownNote 는 내부 플래그 — 화면 미노출', () => {
  it('검수 필요 행은 목록에 남되 사유 배지를 만들지 않는다', () => {
    const monday = todayBoardView(state(MON));
    const row = eventAt(monday.events, '11:00');
    expect(row).toBeDefined();
    expect(row?.notes).toEqual([]);
    // 원문은 **내부 경고**로만 남는다(사용자 홈 안내 1줄에는 올리지 않는다 — T14 규칙).
    expect(monday.warnings.some((warning) => warning.includes('확인필요 표기'))).toBe(true);
    expect(monday.warningsNoticeCount).toBe(0);
    expect(monday.warningsNotice).toBeNull();
  });

  it('미해석 표기 원문(unknownNote)은 화면에 그리는 값(행·머리 문구)에 나타나지 않는다', () => {
    const monday = todayBoardView(state(MON));
    const rendered = JSON.stringify({ events: monday.events, list: monday.list, next: monday.next, headline: monday.listHeadline });
    expect(rendered).not.toContain('확인필요 표기');
    expect(rendered).not.toContain('unknownNote');
    expect(rendered).not.toContain('needsReview');
  });
});

/* ───────────────────────── ⑤ 하위호환(v1·v2 데이터) ───────────────────────── */

describe('T22 ⑤ v1·v2 데이터(신규 필드 없음)는 같은 렌더', () => {
  const v1State = (nowMs: number): ScheduleState => state(nowMs, { model: v1Model });

  it('v1 픽스처에는 조건 필드가 없고 판정은 note 문자열로 이어진다(월요일 운행)', () => {
    const asan = v1Model.routes.find((route) => route.id === 'r-asan');
    const row = asan?.byDay.weekday?.rows.find((entry) => entry['seq'] === 2);
    expect(row?.['service']).toBeUndefined();
    expect(row?.['note']).toBe('금(X)');
    expect(v1Model.schedule.routes[0]?.byDay.weekday[1]?.note).toBe('금(X)');
  });

  it('v1 데이터도 금요일에 note `금(X)` 편을 제외한다(구조화 이전과 같은 동작)', () => {
    const friday = todayBoardView(v1State(FRI));
    expect(of(friday.events)).not.toContain('08:30');
  });

  it('v1 데이터의 배지는 예전처럼 표 문자열 그대로다(문구를 새로 만들지 않는다)', () => {
    const monday = todayBoardView(v1State(MON));
    expect(eventAt(monday.events, '08:30')?.notes).toEqual(['금(X)']);
    expect(eventAt(monday.events, '09:00')?.notes).toEqual(['월~화 2대 운행']);
  });

  it('v1 데이터는 소요시간 문구가 하나도 없다(tripNotes·durationMinutes 없음)', () => {
    const monday = todayBoardView(v1State(MON));
    expect(monday.events.every((event) => event.durationNote === null)).toBe(true);
  });
});

/* ───────────────────────── 공휴일·대체휴일(날짜 규칙과의 정합) ───────────────────────── */

describe('T22 — 날짜 규칙(공휴일·대체휴일)과 편별 조건의 정합', () => {
  it('공휴일(한글날 금): 전 노선 운행 없음 — 목록을 그리지 않고 사유를 배너로 알린다', () => {
    const hangul = todayBoardView(state(at('2026-10-09T09:00:00+09:00')));
    expect(hangul.status).toBe('no-service');
    expect(hangul.notice?.kind).toBe('no-service');
    expect(hangul.listVisible).toBe(false);
    expect(hangul.counts.all).toBe(0);
  });

  it('대체휴일(개천절 월): 대체 시간표(일요일) 편으로 바뀐다 — 오늘 편별 조건은 걸리지 않는다', () => {
    const alternate = todayBoardView(state(at('2026-10-05T07:00:00+09:00')));
    expect(serviceNoticeView(state(at('2026-10-05T07:00:00+09:00')))?.kind).toBe('alternate');
    expect(alternate.effectiveDayType).toBe('sunday');
    expect(of(alternate.events)).toEqual(['09:00', '12:00']);
    expect(alternate.events.every((event) => event.notes.length === 0)).toBe(true);
  });

  it('토·일 시간표 편은 평일과 다른 날로 안내된다(주말 주입 시 목록은 그 요일 표)', () => {
    const saturday = todayBoardView(state(at('2026-10-17T08:00:00+09:00')));
    expect(saturday.calendarDayType).toBe('saturday');
    expect(of(saturday.events)).toEqual(['09:00']);
  });
});

/* ───────────────────────── ⑥ 실제 발행물(v3) 실측 ───────────────────────── */

describe('T22 ⑥ 실제 발행물(data/timetable.json v3) — 금요일 실측', () => {
  const raw = JSON.parse(readFileSync(new URL('../../../../data/timetable.json', import.meta.url), 'utf8')) as unknown;
  const real = parseTimetable(raw);
  const realState = (nowMs: number): ScheduleState => state(nowMs, { model: real });

  /**
   * 발행물에서 **금요일에 구조화 조건으로 빠지는** 회차의 목록(대조 기준 — 스크립트가 앱 판정을 재구현하지 않는다).
   *  ① `excludedDays` 에 `fri` 포함  ② `dayScope` 가 있는데 `fri` 미포함
   * 키는 앱이 쓰는 것과 같은 표기(`routeId:YYYY-MM-DD:seq`)로 만든다.
   */
  const fridayNotRunningKeys = (): readonly string[] => {
    const out: string[] = [];
    const routeList = (raw as { routes: { id: string; byDay: Record<string, { trips: Record<string, unknown>[] } | null> }[] }).routes;
    for (const route of routeList) {
      const table = route.byDay['weekday'];
      if (table === null || table === undefined) continue;
      for (const row of table.trips) {
        const service = row['service'] as { excludedDays?: string[]; dayScope?: string[] | null } | null;
        if (service === null || service === undefined) continue;
        const excludedDays = service.excludedDays ?? [];
        const dayScope = service.dayScope ?? null;
        const offOnFriday =
          excludedDays.includes('fri') || (dayScope !== null && dayScope.length > 0 && !dayScope.includes('fri'));
        if (!offOnFriday) continue;
        const departure = (row['depCampus'] ?? row['depStation'] ?? row['depTerminal'] ?? null) as string | null;
        if (departure === null) continue;
        out.push(`${route.id}:2026-10-16:${String(row['seq'])}`);
      }
    }
    return out;
  };

  it('금요일 주입: 구조화 조건으로 금요일에 빠지는 편이 목록에 하나도 없다(발행물 대조)', () => {
    const excludedKeys = fridayNotRunningKeys();
    expect(excludedKeys.length).toBeGreaterThan(0); // v3 에 금요일 미운행 구조화 행이 있다
    const friday = todayBoardView(realState(FRI));
    const presentKeys = new Set(friday.events.map((event) => event.key));
    const leaked = excludedKeys.filter((key) => presentKeys.has(key));
    expect(leaked, `금요일 목록에 미운행 편이 남아 있다: ${leaked.join(', ')}`).toEqual([]);
  });

  it('금요일 주입: 08:35(아산KTX 금(X) 편)이 목록에서 사라진다 — 실측 시각 대조', () => {
    const friday = todayBoardView(realState(FRI));
    const asanTimes = friday.events.filter((event) => event.routeId === 'asan-ktx').map((event) => event.departure);
    expect(asanTimes).not.toContain('08:35');
    expect(asanTimes).not.toContain('09:00');
    expect(asanTimes).toContain('08:05');
  });

  it('월요일 주입: 같은 편이 목록에 있고 `금요일 운행 없음` 배지가 붙는다', () => {
    const monday = todayBoardView(realState(MON));
    const asanSeq2 = monday.events.find((event) => event.routeId === 'asan-ktx' && event.departure === '08:35');
    expect(asanSeq2).toBeDefined();
    expect(asanSeq2?.notes).toContain('금요일 운행 없음');
  });

  it('금요일 편수는 월요일보다 적다(실제 발행물 기준 — 대조 실측)', () => {
    const friday = todayBoardView(realState(FRI));
    const monday = todayBoardView(realState(MON));
    expect(friday.todayTotal).toBeLessThan(monday.todayTotal);
    expect(friday.counts.all).toBeLessThan(monday.counts.all);
  });

  it('주말(토·일)은 조건이 없어 편수 변화가 없다 — 주입한 요일 표 그대로', () => {
    const saturday = todayBoardView(realState(at('2026-10-17T07:00:00+09:00')));
    const sunday = todayBoardView(realState(at('2026-10-18T07:00:00+09:00')));
    expect(saturday.calendarDayType).toBe('saturday');
    expect(sunday.calendarDayType).toBe('sunday');
    expect(saturday.counts.all).toBe(saturday.events.length);
    expect(sunday.counts.all).toBe(sunday.events.length);
  });
});
