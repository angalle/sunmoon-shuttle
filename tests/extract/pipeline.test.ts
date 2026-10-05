/**
 * T16 파이프라인 테스트 — **스키마 v2 변환 · v1 보존 · 갭 6종 · 중복 제거 · 연도 추론 · 결정성 · 앱 호환**.
 *
 * 실제 원본 스냅샷(`data/raw/*.html`)을 입력으로 쓴다 — 픽스처를 손으로 적지 않는다.
 */

import { describe, expect, it } from 'vitest';

import { enrichTimetableFixture } from './support.js';
import { loadFixture, ruleOnlyEnriched } from './support.js';
import { parseTimetable } from '../../src/adapters/in/web/features/schedule/data/normalize.js';
import { buildEnrichedTimetable } from '../../tools/extract/enrich.js';

describe('T16 스키마 v2 변환 — v1 필드 보존(앱 무중단)', () => {
  it('schemaVersion 이 2 가 되고 v1 표 필드(routes/semester/dayTypes/busRefs/contacts)는 값까지 그대로다', () => {
    const { base, enriched } = loadFixture();
    expect(enriched.schemaVersion).toBe(2);
    expect(enriched.semester).toEqual(base.semester);
    expect(enriched.holidayPeriod).toEqual(base.holidayPeriod);
    expect(enriched.dayTypes).toEqual(base.dayTypes);
    expect(enriched.busRefs).toEqual(base.busRefs);
    expect(enriched.contacts).toEqual(base.contacts);
    expect(enriched.source.url).toBe(base.source.url);
    expect(enriched.source.sourceUpdatedAt).toBe(base.source.sourceUpdatedAt);
    expect(enriched.source.pages).toEqual(base.source.pages);
    // 표(행·시각·열)는 v2 추가 필드와 무관하게 동일하다
    enriched.routes.forEach((route, index) => {
      const before = base.routes[index];
      expect(before).toBeDefined();
      expect(route.byDay).toEqual(before?.byDay);
      expect(route.columns).toEqual(before?.columns);
      expect(route.trips).toEqual(before?.trips);
      expect(route.status).toBe(before?.status);
    });
  });

  it('v2 추가 필드가 전부 존재한다(dateRules/terms/routes[].tripNotes/routes[].stopWindows)', () => {
    const { enriched } = loadFixture();
    expect(Array.isArray(enriched.dateRules)).toBe(true);
    expect(Array.isArray(enriched.terms)).toBe(true);
    for (const route of enriched.routes) {
      expect(Array.isArray(route.tripNotes)).toBe(true);
      expect(Array.isArray(route.stopWindows)).toBe(true);
    }
  });

  it('앱 계약 파서(parseTimetable)가 v2 JSON 을 그대로 읽는다 — 도메인 트립 수 동일', () => {
    const { enriched, base } = loadFixture();
    const v2 = parseTimetable(JSON.parse(JSON.stringify(enriched)));
    const v1 = parseTimetable(JSON.parse(JSON.stringify(base)));
    expect(v2.routes.length).toBe(v1.routes.length);
    expect(v2.dayTypes).toEqual(v1.dayTypes);
    const v2Asan = v2.schedule.routes.find((route) => route.id === 'asan-ktx');
    const v1Asan = v1.schedule.routes.find((route) => route.id === 'asan-ktx');
    expect(v2Asan?.byDay.weekday.length).toBe(v1Asan?.byDay.weekday.length);
    expect(v2Asan?.byDay.weekday.length).toBe(42);
    expect(v2.schedule.source.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('T16 갭 6종 구조화', () => {
  it('갭① 시점 조건부 운행 변경 — 평일/주말 2건, 시점은 학기 시작일로 환산', () => {
    const { enriched } = loadFixture();
    const rules = enriched.dateRules.filter((rule) => rule.kind === 'route-change');
    expect(rules).toHaveLength(2);
    expect(rules[0]?.start).toBe('2026-09-01');
    expect(rules[0]?.scope).toEqual(['asan-ktx']);
    expect(rules[0]?.sourceQuote).toContain('탕정역 경유');
    expect(rules[1]?.dayTypes).toEqual(['saturday', 'sunday']);
    for (const rule of rules) expect(rule.extractedBy).toBe('rule');
  });

  it('갭② 방향별 소요시간 — tripNotes 에 방향·분·구간이 구조화된다', () => {
    const { enriched } = loadFixture();
    const asan = enriched.routes.find((route) => route.id === 'asan-ktx');
    expect(asan?.tripNotes.map((note) => `${note.direction}:${note.minutes}`)).toEqual(['inbound:15', 'outbound:20']);
    expect(asan?.tripNotes[0]?.segment).toBe('아산역>캠퍼스');
    const station = enriched.routes.find((route) => route.id === 'cheonan-station');
    expect(station?.tripNotes).toEqual([
      expect.objectContaining({ direction: 'outbound', minutes: 35, segment: '캠퍼스>천안역', conditions: ['교통정체'] }),
      expect.objectContaining({ direction: 'inbound', minutes: 30, conditions: ['교통정체'] }),
      expect.objectContaining({ direction: 'outbound', minutes: 30, conditions: ['이외 시간'] }),
      expect.objectContaining({ direction: 'inbound', minutes: 25, conditions: ['이외 시간'] }),
    ]);
    const terminal = enriched.routes.find((route) => route.id === 'cheonan-terminal');
    expect(terminal?.tripNotes.map((note) => `${note.direction}:${note.minutes}:${note.conditions.join('+')}`)).toEqual([
      'both:40:교통정체',
      'both:30:이외 시간',
    ]);
  });

  it('갭③ 시간창 조건부 정차 — stopWindows + dateRule(stop-time-window)', () => {
    const { enriched } = loadFixture();
    const rule = enriched.dateRules.find((item) => item.kind === 'stop-time-window');
    expect(rule?.effect).toMatchObject({
      location: '학생회관 승강장',
      term: '학기 중',
      windows: [
        { start: '13:30', end: '15:30' },
        { start: '19:30', end: null },
      ],
      limit: '막차까지',
    });
    expect(rule?.dayTypes).toEqual(['weekday']);
    const asan = enriched.routes.find((route) => route.id === 'asan-ktx');
    expect(asan?.stopWindows).toHaveLength(1);
    expect(asan?.stopWindows[0]?.windows[1]).toEqual({ start: '19:30', end: null, raw: '19:30~막차까지' });
  });

  it('갭④ 학기/방학 구분 — terms 에 기간과 해당 시간표 소스가 있다', () => {
    const { enriched } = loadFixture();
    const semester = enriched.terms.find((term) => term.kind === 'semester');
    expect(semester).toMatchObject({ label: '2026-2학기', start: '2026-09-01', end: '2026-12-14' });
    expect(semester?.timetableSource).toContain('About08_04_02_01_01_01.aspx');
    const vacation = enriched.terms.find((term) => term.kind === 'vacation');
    expect(vacation?.sourceQuote).toBe('방학 시간표');
    expect(vacation?.timetableSource).toContain('About08_04_03_01_01.aspx');
    expect(vacation?.needsReview).toBe(true); // 기간 미기재 → 발행은 하되 표시
  });

  it('갭⑤ 기간의 의미 연결 — 휴일 운행기간 → 주말 시간표 적용', () => {
    const { enriched } = loadFixture();
    const rule = enriched.dateRules.find((item) => item.kind === 'period-meaning');
    expect(rule).toMatchObject({ start: '2026-09-05', end: '2026-12-13', dayTypes: ['saturday', 'sunday'] });
    expect(rule?.effect).toMatchObject({ appliesTo: 'weekend-timetable' });
    expect(rule?.yearInferred).toBe(true); // 끝 날짜에 연도가 없다
  });

  it('갭⑥ 중복 공지 제거 + 연도 추론 — 17→16건, 합쳐진 표기가 기록된다', () => {
    const { base, enriched, rules } = loadFixture();
    expect(base.notices).toHaveLength(17);
    expect(enriched.notices).toHaveLength(16);
    expect(rules.dedupedNotices).toBe(1);
    expect(rules.dedupedQuotes).toEqual(['*개천절[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음']);
    const merged = enriched.dateRules.find((rule) => (rule.mergedQuotes?.length ?? 0) > 0);
    expect(merged?.sourceQuote).toBe('*개천절연휴[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음');
    expect(merged?.mergedQuotes).toEqual(['*개천절[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음']);
    // 연도 없는 표기 → 학기 연도 추론 + 명시
    const hangeul = enriched.dateRules.find((rule) => rule.sourceQuote.includes('한글날'));
    expect(hangeul?.start).toBe('2026-10-09');
    expect(hangeul?.yearInferred).toBe(true);
    expect(hangeul?.dayTypes).toEqual(['weekday']);
  });

  it('갭 커버리지는 데이터에서 계산된다(하드코딩 아님) — 6종 모두 > 0', () => {
    const { enriched } = loadFixture();
    expect(computeGapCounts(enriched)).toEqual([2, 8, 5, 2, 1, 7]);
  });
});

function computeGapCounts(enriched: ReturnType<typeof ruleOnlyEnriched>): number[] {
  const rules = enriched.dateRules;
  const tripNotes = enriched.routes.reduce((total, route) => total + route.tripNotes.length, 0);
  const stopWindows = enriched.routes.reduce((total, route) => total + route.stopWindows.length, 0);
  return [
    rules.filter((rule) => rule.kind === 'route-change').length,
    tripNotes,
    rules.filter((rule) => rule.kind === 'stop-time-window').length + stopWindows,
    enriched.terms.length,
    rules.filter((rule) => rule.kind === 'period-meaning').length,
    rules.reduce((total, rule) => total + (rule.mergedQuotes?.length ?? 0), 0) + rules.filter((rule) => rule.yearInferred).length,
  ];
}

describe('T16 결정성', () => {
  it('같은 입력 2회 조립 → 바이트 동일 · contentHash 동일(규칙 산출물 결정성)', () => {
    const { base, rules } = loadFixture();
    const parts = {
      dateRules: rules.dateRules,
      terms: rules.terms,
      tripNotes: rules.tripNotes,
      stopWindows: rules.stopWindows,
      notices: rules.notices,
      dedupedNotices: rules.dedupedNotices,
    };
    const first = JSON.stringify(buildEnrichedTimetable(base, parts));
    const second = JSON.stringify(buildEnrichedTimetable(base, parts));
    expect(second).toBe(first);
    expect(buildEnrichedTimetable(base, parts).source.contentHash).toBe(
      buildEnrichedTimetable(base, parts).source.contentHash,
    );
  });

  it('규칙 항목은 모두 extractedBy=rule 이다(AI 산출물과 구분)', () => {
    const { enriched } = loadFixture();
    for (const rule of enriched.dateRules) expect(rule.extractedBy).toBe('rule');
    for (const term of enriched.terms) expect(term.extractedBy).toBe('rule');
  });

  it('fixture 헬퍼(enrichTimetableFixture)는 v2 본문을 그대로 돌려준다', () => {
    expect(enrichTimetableFixture().source.contentHash).toBe(ruleOnlyEnriched().source.contentHash);
  });
});
