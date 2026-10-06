/**
 * T17 — schema v2 표시 테스트(수용 기준 1: 신규 ≥10).
 *
 * 검증 대상은 **표시 계층**이다: `parseTimetable`(v2 읽기) → 선택자(`upcomingChanges`·
 * `vacationNotice`·`stopWindowLines`·`durationNote`) → 컴포넌트가 쓰는 값.
 * 판정·기간 해석(연도 추론·중복 통합)은 T16 산출물(`data/timetable.json`)이 이미 했으므로 여기서 다시 하지 않는다.
 *
 * 두 종류의 입력을 쓴다.
 *  - `V2_RAW`  : 경계값(14일 창 · 오늘 중복 · needsReview · 조건부 소요시간)을 담은 손 픽스처
 *  - `BOARD_RAW`: v1 픽스처(`tests/adapters/in/web/boardFixtures.ts`) — **하위호환** 실측
 *  - 실제 계약 `data/timetable.json`(v2) — 발행물 그대로의 표시 결과(태스크 예시 문구 포함)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dateRuleLabel, parseTimetable } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import {
  stopWindowLines,
  todayBoardView,
  upcomingChanges,
  UPCOMING_RULE_LINE_LIMIT,
  UPCOMING_RULE_WINDOW_DAYS,
  vacationNotice,
  type DepartureEventView,
} from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import type { ScheduleState } from '../../../../src/adapters/in/web/features/schedule/store/scheduleStore';
import { BOARD_RAW } from './boardFixtures';

/* ───────────────────────── 픽스처 ───────────────────────── */

const V2_RAW: unknown = {
  schemaVersion: 2,
  semester: {
    title: '2026-2학기 셔틀버스 시간표',
    label: '2026-2학기',
    startsOn: '2026-09-01',
    endsOn: '2026-12-14',
    kind: 'semester',
  },
  holidayPeriod: null,
  dayTypes: ['weekday', 'saturday', 'sunday'],
  routes: [
    {
      id: 'r-asan',
      name: '아산(KTX)역',
      path: '캠퍼스 > 역 > 캠퍼스',
      status: 'active',
      offDays: [],
      columns: ['순', '캠퍼스 출발', '역 출발', '캠퍼스 도착'],
      trips: [],
      byDay: {
        weekday: {
          columns: ['순', '캠퍼스 출발', '역 출발', '캠퍼스 도착'],
          keys: ['seq', 'depCampus', 'depStation', 'arrCampus'],
          trips: [
            { seq: 1, depCampus: '08:00', depStation: '08:20', arrCampus: '08:35' },
            { seq: 2, depCampus: null, depStation: '08:30', arrCampus: '08:45' },
          ],
        },
        saturday: null,
        sunday: null,
      },
      // 무조건 소요시간(등교 15 · 하교 20) + 조건부(교통정체 35) + 미검수(needsReview)
      tripNotes: [
        { direction: 'outbound', minutes: 20, segment: '캠퍼스>역', conditions: [], note: null, sourceQuote: '하교시 20분 소요', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
        { direction: 'inbound', minutes: 15, segment: '역>캠퍼스', conditions: [], note: null, sourceQuote: '등교시 15분 소요', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
        { direction: 'outbound', minutes: 35, segment: null, conditions: ['교통정체'], note: '교통정체', sourceQuote: '교통정체로 35분 소요', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
        { direction: 'both', minutes: 99, segment: null, conditions: [], note: null, sourceQuote: '검수 필요 99분', sourcePage: 'x.html', extractedBy: 'ai', confidence: 0.4, needsReview: true },
      ],
      stopWindows: [
        {
          location: '학생회관 승강장',
          dayTypes: ['weekday'],
          term: '학기 중',
          windows: [
            { start: '13:30', end: '15:30', raw: '13:30~15:30' },
            { start: '19:30', end: null, raw: '19:30~막차까지' },
          ],
          note: null,
          sourceQuote: '- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30 / 19:30~ 막차까지 이용가능',
          sourcePage: 'x.html',
          extractedBy: 'rule',
          confidence: 1,
          needsReview: false,
        },
        {
          location: '검수 필요 승강장',
          dayTypes: ['weekday'],
          term: null,
          windows: [{ start: '09:00', end: null, raw: '09:00~' }],
          note: null,
          sourceQuote: '검수 필요 정차',
          sourcePage: 'x.html',
          extractedBy: 'ai',
          confidence: 0.3,
          needsReview: true,
        },
      ],
    },
    {
      // 조건부 소요시간만 있는 노선 — 화면에 소요시간을 붙이지 않는다(판정 금지)
      id: 'r-cheonan',
      name: '천안터미널',
      path: '캠퍼스 > 터미널 > 캠퍼스',
      status: 'active',
      offDays: ['saturday', 'sunday'],
      columns: ['순', '캠퍼스 출발', '터미널', '캠퍼스 도착'],
      trips: [],
      byDay: {
        weekday: {
          columns: ['순', '캠퍼스 출발', '터미널', '캠퍼스 도착'],
          keys: ['seq', 'depCampus', 'depTerminal', 'arrCampus'],
          trips: [{ seq: 1, depCampus: '07:30', depTerminal: '08:00', arrCampus: '08:30' }],
        },
        saturday: null,
        sunday: null,
      },
      tripNotes: [
        { direction: 'both', minutes: 40, segment: null, conditions: ['교통정체'], note: '교통정체', sourceQuote: '운영시간 교통정체로 40분 소요', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
      ],
      // 같은 원본 문장을 다른 노선과 공유 → 화면에는 한 줄로만
      stopWindows: [
        {
          location: '학생회관 승강장',
          dayTypes: ['weekday'],
          term: '학기 중',
          windows: [
            { start: '13:30', end: '15:30', raw: '13:30~15:30' },
            { start: '19:30', end: null, raw: '19:30~막차까지' },
          ],
          note: null,
          sourceQuote: '- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30 / 19:30~ 막차까지 이용가능',
          sourcePage: 'x.html',
          extractedBy: 'rule',
          confidence: 1,
          needsReview: false,
        },
      ],
    },
  ],
  dateRules: [
    // 오늘(2026-10-06) — 상단 배너가 담당하므로 목록에서 빠져야 한다(중복 금지)
    { kind: 'no-service', start: '2026-10-06', end: null, yearInferred: false, dayTypes: ['weekday'], scope: [], effect: { appliesTo: 'all-routes' }, note: null, sourceQuote: '*개교기념일[10. 6.(화)]: 셔틀버스 운행 없음', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    { kind: 'alternate-schedule', start: '2026-10-06', end: null, yearInferred: false, dayTypes: ['weekday'], scope: [], effect: { timetable: 'sunday' }, note: null, sourceQuote: '*대체휴일[10. 6.(화)]: 일요일 시간표로 운행', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // 3일 뒤 — 표시 대상 1
    { kind: 'no-service', start: '2026-10-09', end: null, yearInferred: true, dayTypes: ['weekday'], scope: [], effect: { appliesTo: 'all-routes' }, note: null, sourceQuote: '*한글날[10. 9.(금)]: 셔틀버스 운행 없음', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // 기간 규칙 — 표시 대상 2
    { kind: 'no-service', start: '2026-10-12', end: '2026-10-13', yearInferred: true, dayTypes: ['weekday'], scope: [], effect: { appliesTo: 'all-routes' }, note: null, sourceQuote: '*개교기념일연휴[10.12.(월)~10.13.(화)]: 셔틀버스 운행 없음', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // 표시 대상 3 (대체 시간표)
    { kind: 'alternate-schedule', start: '2026-10-15', end: null, yearInferred: true, dayTypes: ['weekday'], scope: [], effect: { timetable: 'sunday' }, note: null, sourceQuote: '*재량휴업일[10. 15.(목)]: 일요일 시간표로 운행', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // 표시 대상 4 — timetable 해석 불가 → 대체 문구
    { kind: 'alternate-schedule', start: '2026-10-16', end: null, yearInferred: true, dayTypes: ['weekday'], scope: [], effect: {}, note: null, sourceQuote: '*개교기념일행사[10. 16.(금)]: 대체 시간표로 운행', sourcePage: 'x.html', extractedBy: 'rule', confidence: 0.8, needsReview: false },
    // 14일 창(10-06 ~ 10-20) 밖
    { kind: 'no-service', start: '2026-10-28', end: null, yearInferred: true, dayTypes: ['weekday'], scope: [], effect: { appliesTo: 'all-routes' }, note: null, sourceQuote: '*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // 과거
    { kind: 'no-service', start: '2026-09-24', end: '2026-09-26', yearInferred: true, dayTypes: ['weekday'], scope: [], effect: { appliesTo: 'all-routes' }, note: null, sourceQuote: '*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // needsReview — 내부 플래그(노출 금지)
    { kind: 'no-service', start: '2026-10-08', end: null, yearInferred: true, dayTypes: ['weekday'], scope: [], effect: { appliesTo: 'all-routes' }, note: null, sourceQuote: '*확인필요[10. 8.(목)]: 셔틀버스 운행 없음', sourcePage: 'x.html', extractedBy: 'ai', confidence: 0.4, needsReview: true },
    // 표시 대상 아님(kind)
    { kind: 'route-change', start: '2026-10-07', end: null, yearInferred: false, dayTypes: ['weekday'], scope: ['r-asan'], effect: { via: '탕정역' }, note: null, sourceQuote: '* 2026-2학기부터 탕정역 경유', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // 날짜 없음 — 기간 규칙이 아니므로 창 판정 대상이 아니다
    { kind: 'stop-time-window', start: null, end: null, yearInferred: false, dayTypes: ['weekday'], scope: [], effect: { location: '학생회관 승강장' }, note: null, sourceQuote: '- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
  ],
  terms: [
    { kind: 'semester', label: '2026-2학기', start: '2026-09-01', end: '2026-12-14', timetableSource: 'https://example.test/semester', note: null, sourceQuote: '2026-2학기 시간표', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    { kind: 'vacation', label: '겨울방학', start: '2026-12-21', end: '2027-02-28', timetableSource: 'https://example.test/vacation', note: null, sourceQuote: '겨울방학 시간표', sourcePage: 'x.html', extractedBy: 'rule', confidence: 1, needsReview: false },
    // 검수 전(needsReview) 방학 — 기간은 오늘이지만 화면에 올리지 않는다
    { kind: 'vacation', label: '방학(검수 전)', start: '2026-10-01', end: '2026-10-31', timetableSource: 'https://example.test/vacation-unverified', note: null, sourceQuote: '방학 시간표', sourcePage: 'x.html', extractedBy: 'ai', confidence: 0.4, needsReview: true },
  ],
  notices: [],
  busRefs: [],
  contacts: null,
  source: {
    url: 'https://example.test/shuttle',
    sourceUpdatedAt: '2026-10-05',
    fetchedAt: '2026-10-05T14:39:32+09:00',
    contentHash: 'sha256:fixture-v2',
    pages: [],
  },
};

const model = parseTimetable(V2_RAW);
const v1Model = parseTimetable(BOARD_RAW);

function state(now: string, overrides: Partial<ScheduleState> = {}): ScheduleState {
  return {
    status: 'ready',
    model,
    errorMessage: null,
    dataSource: 'network',
    cacheAgeMs: null,
    offlineReason: null,
    dayType: 'weekday',
    routeId: 'r-asan',
    nowMs: Date.parse(now),
    ...overrides,
  };
}

const TUESDAY = '2026-10-06T08:00:00+09:00'; // 2026-10-06 은 화요일

/* ───────────────────────── ① 다가오는 운행 변동 ───────────────────────── */

describe('T17 ① 다가오는 운행 변동 — 14일 창 · 최대 2줄', () => {
  it('창 상수는 14일 · 2줄이다(지시 ①)', () => {
    expect(UPCOMING_RULE_WINDOW_DAYS).toBe(14);
    expect(UPCOMING_RULE_LINE_LIMIT).toBe(2);
  });

  it('오늘 이후 14일 내 규칙만 가까운 순서로 2줄 뽑는다(날짜·문구는 데이터에서)', () => {
    const view = upcomingChanges(state(TUESDAY));
    expect(view.lines.map((line) => line.text)).toEqual([
      '10월 9일 (금) 한글날 — 운행 없음',
      '10월 12일 (월) ~ 10월 13일 (화) 개교기념일연휴 — 운행 없음',
    ]);
    // 창 안에는 10-09·10-12~13·10-15·10-16 네 건이 있고 그중 2줄만 화면에 올라간다.
    expect(view.total).toBe(4);
    expect(view.hiddenCount).toBe(2);
    expect(view.lines.length).toBeLessThanOrEqual(UPCOMING_RULE_LINE_LIMIT);
  });

  it('오늘이 포함된 규칙은 뺀다 — 상단 배너와 중복해서 말하지 않는다(지시 ②)', () => {
    const view = upcomingChanges(state(TUESDAY));
    expect(view.lines.some((line) => line.dateText.includes('10월 6일'))).toBe(false);
    // 오늘자 규칙 2건(운행 없음 · 대체 시간표)은 목록에 없다.
    expect(view.lines.filter((line) => line.key.includes('2026-10-06'))).toEqual([]);
  });

  it('창 밖(10-28)과 지난 규칙(9월)은 넣지 않는다', () => {
    const dates = upcomingChanges(state(TUESDAY)).lines.map((line) => line.dateText);
    expect(dates.join(' ')).not.toContain('10월 28일');
    expect(dates.join(' ')).not.toContain('9월');
  });

  it('창 경계: 10-27 기준이면 10-28 개교기념일이 1줄로 올라온다(태스크 예시 문구)', () => {
    const view = upcomingChanges(state('2026-10-27T09:00:00+09:00'));
    expect(view.lines[0]?.text).toBe('10월 28일 (수) 개교기념일 — 운행 없음');
  });

  it('대체 시간표 문구는 effect.timetable(데이터)로 만들고, 해석 불가면 대체 문구를 쓴다', () => {
    const view = upcomingChanges(state('2026-10-14T09:00:00+09:00'));
    expect(view.lines.map((line) => line.statusText)).toEqual([
      '일요일 시간표로 운행',
      '대체 시간표로 운행',
    ]);
  });

  it('needsReview 항목과 표시 대상이 아닌 kind 는 화면 값에 들어가지 않는다(지시 ⑥)', () => {
    const view = upcomingChanges(state('2026-10-07T09:00:00+09:00'));
    const text = view.lines.map((line) => line.text).join(' | ');
    expect(text).not.toContain('확인필요'); // needsReview (10-08)
    expect(text).not.toContain('탕정역'); // route-change (10-07)
    expect(view.total).toBe(4);
  });

  it('모델이 없으면(로딩) 빈 결과를 준다 — 크래시 없음', () => {
    expect(upcomingChanges(state(TUESDAY, { model: null }))).toEqual({ lines: [], total: 0, hiddenCount: 0 });
  });
});

/* ───────────────────────── ② 방학 기간(terms) ───────────────────────── */

describe('T17 ⑤ 방학/학기 구분 — terms[] 로 오늘만 본다', () => {
  it('오늘이 방학 기간이 아니면 아무것도 표시하지 않는다(null)', () => {
    expect(vacationNotice(state(TUESDAY))).toBeNull();
  });

  it('needsReview 인 방학 항목은 오늘이 기간 안이어도 노출하지 않는다(검수 전)', () => {
    // 검수 전 항목(2026-10-01~10-31)은 오늘을 덮지만 화면에 올리지 않는다.
    expect(vacationNotice(state(TUESDAY))).toBeNull();
  });

  it('오늘이 방학 기간이면 1줄 + 데이터의 시간표 소스를 준다', () => {
    const view = vacationNotice(state('2026-12-25T09:00:00+09:00'));
    expect(view?.text).toBe('겨울방학 — 방학 기간입니다');
    expect(view?.label).toBe('겨울방학');
    expect(view?.sourceUrl).toBe('https://example.test/vacation');
  });

  it('v1 데이터에는 terms 가 없어 방학 배너가 뜨지 않는다(하위호환)', () => {
    expect(vacationNotice(state(TUESDAY, { model: v1Model }))).toBeNull();
    expect(v1Model.terms).toEqual([]);
  });
});

/* ───────────────────────── ③ 방향별 소요시간 ───────────────────────── */

describe('T17 ③ 방향별 소요시간 — tripNotes[] 를 도착 옆 보조 문구로', () => {
  const durationsOf = (events: readonly DepartureEventView[]): string[] =>
    events.map((event) => `${event.departure}:${String(event.durationNote)}`);

  it('방향에 맞는 무조건 소요시간만 붙인다(등교 15 / 하교 20)', () => {
    const board = todayBoardView(state('2026-10-06T07:00:00+09:00'));
    expect(durationsOf(board.events)).toEqual(['07:30:null', '08:00:약 20분 소요', '08:30:약 15분 소요']);
  });

  it('조건부 소요시간(교통정체)만 있는 노선은 표시하지 않는다(판정 금지)', () => {
    const board = todayBoardView(state('2026-10-06T07:00:00+09:00'));
    const cheonan = board.events.find((event) => event.routeId === 'r-cheonan');
    expect(cheonan?.durationNote).toBeNull();
  });

  it('needsReview 인 tripNote 는 쓰지 않는다', () => {
    const board = todayBoardView(state('2026-10-06T07:00:00+09:00'));
    expect(durationsOf(board.events).join(' ')).not.toContain('99분');
  });

  it('v1 데이터(tripNotes 없음)는 소요시간 문구가 하나도 없다(하위호환)', () => {
    const board = todayBoardView(state(TUESDAY, { model: v1Model }));
    expect(board.events.length).toBeGreaterThan(0);
    expect(board.events.every((event) => event.durationNote === null)).toBe(true);
    expect(v1Model.routes.every((route) => route.tripNotes.length === 0)).toBe(true);
  });
});

/* ───────────────────────── ④ 정차 시간창 ───────────────────────── */

describe('T17 ④ 정차 시간창 — 접힘 1개에 모아 노출', () => {
  it('stopWindows 를 원문 표기 그대로 한 줄로 만들고 같은 문구는 합친다', () => {
    const lines = stopWindowLines(model);
    expect(lines.map((line) => line.text)).toEqual(['학생회관 승강장 (학기 중): 13:30~15:30 · 19:30~막차까지']);
  });

  it('needsReview 정차 창은 노출하지 않는다', () => {
    const text = stopWindowLines(model).map((line) => line.text).join(' | ');
    expect(text).not.toContain('검수 필요');
    expect(text).not.toContain('09:00~');
  });

  it('v1 데이터에는 stopWindows 가 없어 빈 결과다(하위호환)', () => {
    expect(stopWindowLines(v1Model)).toEqual([]);
    expect(v1Model.routes.every((route) => route.stopWindows.length === 0)).toBe(true);
  });
});

/* ───────────────────────── ⑤ v2 읽기(정규화) ───────────────────────── */

describe('T17 parseTimetable — v2 를 읽기만 한다(스키마·판정 신규 작성 없음)', () => {
  it('dateRules·terms·tripNotes·stopWindows 를 그대로 담는다', () => {
    expect(model.schemaVersion).toBe(2);
    expect(model.dateRules).toHaveLength(11);
    expect(model.terms).toHaveLength(3);
    const asan = model.routes.find((route) => route.id === 'r-asan');
    expect(asan?.tripNotes).toHaveLength(4);
    expect(asan?.stopWindows).toHaveLength(2);
    expect(model.schemaVersion).toBe(2);
  });

  it('표기 이름은 원문 인용에서만 뽑는다(하드코딩 없음 · 못 뽑으면 null)', () => {
    expect(dateRuleLabel('*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음')).toBe('개교기념일');
    expect(dateRuleLabel('- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30')).toBeNull();
    const rule = model.dateRules.find((entry) => entry.start === '2026-10-09');
    expect(rule?.label).toBe('한글날');
    expect(model.dateRules.find((entry) => entry.start === null)?.label).toBeNull();
  });

  it('깨진 v2 항목은 그 항목만 버리고 나머지 v1 렌더는 살린다(무중단)', () => {
    const patched = structuredClone(V2_RAW) as Record<string, unknown>;
    patched['dateRules'] = 'not-an-array';
    patched['terms'] = [null, 'nope', { label: '' }];
    const brokenRoutes = patched['routes'] as Record<string, unknown>[];
    brokenRoutes[0]!['tripNotes'] = [{ direction: 'sideways', minutes: 10 }];
    brokenRoutes[0]!['stopWindows'] = [null, { location: '' }];
    expect(() => parseTimetable(patched)).not.toThrow();
    const broken = parseTimetable(patched);
    expect(broken.dateRules).toEqual([]);
    expect(broken.terms).toEqual([]);
    expect(broken.routes[0]?.tripNotes).toEqual([]); // 규약 밖 방향은 버린다
    expect(broken.routes[0]?.stopWindows).toEqual([]);
    // v1 부분(표·노선)은 그대로 살아 있다.
    expect(broken.routes[0]?.byDay.weekday?.rows.length).toBe(2);
  });
});

/* ───────────────────────── ⑥ 실제 발행물(v2) ───────────────────────── */

describe('T17 실제 계약 데이터(data/timetable.json v2) 실측', () => {
  const raw = JSON.parse(readFileSync(new URL('../../../../data/timetable.json', import.meta.url), 'utf8')) as unknown;
  const real = parseTimetable(raw);

  it('v2 배열을 읽는다(schemaVersion 2 · dateRules · terms · tripNotes · stopWindows)', () => {
    expect(real.schemaVersion).toBe(2);
    expect(real.dateRules.length).toBeGreaterThan(0);
    expect(real.terms.length).toBeGreaterThan(0);
    const asan = real.routes.find((route) => route.id === 'asan-ktx');
    expect(asan?.tripNotes.some((note) => note.direction === 'inbound' && note.minutes === 15)).toBe(true);
    expect(asan?.tripNotes.some((note) => note.direction === 'outbound' && note.minutes === 20)).toBe(true);
    expect(asan?.stopWindows.length).toBeGreaterThan(0);
  });

  it('오늘(2026-10-06) 기준 다가오는 변동 1줄 = 한글날 운행 없음', () => {
    const view = upcomingChanges(state(TUESDAY, { model: real }));
    expect(view.lines.map((line) => line.text)).toEqual(['10월 9일 (금) 한글날 — 운행 없음']);
    expect(view.total).toBe(1);
    expect(view.hiddenCount).toBe(0);
  });

  it('정차 시간 안내는 원본 문구 1줄로 합쳐진다(노선 3개가 같은 문장 공유)', () => {
    const lines = stopWindowLines(real).map((line) => line.text);
    expect(lines).toEqual(['학생회관 승강장 (학기 중): 13:30~15:30 · 19:30~막차까지']);
  });

  it('방학 term 은 기간이 미상이고 needsReview 라 배너가 뜨지 않는다(오늘 · 실제 데이터)', () => {
    const term = real.terms.find((entry) => entry.kind === 'vacation');
    expect(term?.needsReview).toBe(true);
    expect(term?.start).toBeNull();
    expect(vacationNotice(state(TUESDAY, { model: real }))).toBeNull();
  });

  it('아산KTX 하교 편에는 `약 20분 소요` 보조 문구가 붙는다(실제 데이터)', () => {
    const board = todayBoardView(state('2026-10-06T07:00:00+09:00', { model: real, routeId: 'asan-ktx' }));
    const out = board.events.find((event) => event.routeId === 'asan-ktx' && event.direction === 'out');
    const inbound = board.events.find((event) => event.routeId === 'asan-ktx' && event.direction === 'in');
    expect(out?.durationNote).toBe('약 20분 소요');
    expect(inbound?.durationNote).toBe('약 15분 소요');
  });
});
