/**
 * T16 병합·검증 테스트 — **삽입력 자체검증(AC-A3)** · kind 필수 필드 · 날짜 형식 · 중복 · baseline · needsReview.
 *
 * 위조 주입 시나리오: AI 초안/산출물에 **원본에 없는 문장**을 넣으면 검증이 FAIL(fatal) 해야 한다.
 */

import { describe, expect, it } from 'vitest';

import { draftToEntry, mergeAiDrafts, resolveQuote } from '../../tools/extract/merge.js';
import { hasFatal, validateEnriched } from '../../tools/extract/validate.js';
import { buildEnrichedTimetable, enrichedCanonicalPayload, sha256Hex } from '../../tools/extract/enrich.js';
import type { AiRuleDraft, DateRule, EnrichedTimetableBody } from '../../tools/extract/types.js';
import { loadFixture } from './support.js';

const HALL_SENTENCE = '천안캠퍼스(2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.)';
/**
 * T26 — 규칙이 설명하지 **않고** dateRule 로 표현해도 되는 문장(AI 채택 대상).
 * 노선 폐지 문장(`HALL_SENTENCE`)은 이제 dateRule 이 아니라 `routes[].status`·`routeNotes` 몫이라
 * AI 초안이면 폐기된다(아래 T26 스위트).
 */
const AI_ONLY_SENTENCE = '*소요시간: 등교시 아산역>캠퍼스 15분 소요 / 하교시 캠퍼스>탕정역 경유>아산역 20분 소요';

function draft(partial: Partial<AiRuleDraft> & { sourceQuote: string }): AiRuleDraft {
  return {
    candidateId: null,
    kind: 'no-service',
    dayTypes: [],
    note: null,
    confidence: 0.9,
    ...partial,
  };
}

function mergeWith(drafts: readonly AiRuleDraft[]): ReturnType<typeof mergeAiDrafts> {
  const { base, sources, candidates, rules } = loadFixture();
  return mergeAiDrafts({
    ruleDateRules: rules.dateRules,
    ruleTerms: rules.terms,
    drafts,
    candidates,
    sources,
    base,
  });
}

function withFabricated(enriched: EnrichedTimetableBody, rule: Partial<DateRule>): EnrichedTimetableBody {
  const fabricated: DateRule = {
    kind: 'no-service',
    start: '2026-01-01',
    end: null,
    yearInferred: false,
    dayTypes: [],
    scope: [],
    effect: { appliesTo: 'all-routes' },
    note: '위조 주입 테스트',
    sourceQuote: '원본에 없는 위조 문장: 셔틀버스 운행 없음',
    sourcePage: 'data/raw/2026-2학기-asan-ktx-평일.html',
    extractedBy: 'ai',
    confidence: 1,
    needsReview: false,
    ...rule,
  };
  const dateRules = [...enriched.dateRules, fabricated];
  const payload = { ...enriched, dateRules };
  return { ...payload, source: { ...payload.source, contentHash: `sha256:${sha256Hex(enrichedCanonicalPayload(payload))}` } };
}

describe('T16 검출력 자체검증 — 위조 주입은 FAIL(발행 중단)', () => {
  it('원본에 없는 문장을 넣으면 검증이 치명 오류를 낸다(exit 1 경로)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const issues = validateEnriched(withFabricated(enriched, {}), { baseline: base, sources, termSources });
    const fatal = issues.filter((issue) => issue.fatal);
    expect(hasFatal(issues)).toBe(true);
    expect(fatal.some((issue) => issue.message.includes('인용 검증 실패'))).toBe(true);
  });

  it('AI 초안 단계의 위조 인용도 병합에서 치명으로 잡힌다', () => {
    const result = mergeWith([draft({ sourceQuote: '원본에 없는 위조 문장입니다 — 셔틀버스 운행 없음' })]);
    expect(result.fatal).toHaveLength(1);
    expect(result.fatal[0]?.message).toContain('인용 검증 실패');
    expect(result.dateRules.some((rule) => rule.sourceQuote.includes('위조'))).toBe(false);
  });

  it('인용을 조금 흉내낸 문장도 후보와 유사도가 낮으면 FAIL 이다', () => {
    const result = mergeWith([draft({ sourceQuote: '학생회관 승강장 정차시간은 13:30부터 15:30까지이며 19:30부터 막차까지입니다' })]);
    expect(result.fatal.length + result.dropped.length).toBeGreaterThan(0);
  });
});

describe('T16 AI 병합', () => {
  it('규칙이 이미 설명한 문장이면 규칙이 이긴다(중복 집계)', () => {
    const result = mergeWith([draft({ sourceQuote: '*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음', kind: 'no-service' })]);
    expect(result.conflicts).toBe(1);
    expect(result.accepted).toBe(0);
    expect(result.dateRules.filter((rule) => rule.sourceQuote.includes('추석연휴'))).toHaveLength(1);
    expect(result.dateRules.every((rule) => rule.extractedBy === 'rule')).toBe(true);
  });

  it('규칙이 못 잡은 문장은 AI 항목으로 추가되고 extractedBy=ai 로 구분된다', () => {
    const result = mergeWith([draft({ sourceQuote: AI_ONLY_SENTENCE, kind: 'route-change', confidence: 0.5 })]);
    const added = result.dateRules.find((rule) => rule.sourceQuote === AI_ONLY_SENTENCE);
    expect(added).toBeDefined();
    expect(added?.extractedBy).toBe('ai');
    expect(added?.kind).toBe('route-change');
    expect(added?.start).toBeNull(); // 원문에 날짜가 없다 — 수치는 AI 가 만들지 않는다
    expect(added?.needsReview).toBe(true); // confidence 0.5 < 0.6 → 발행은 하되 표시
  });

  it('후보 id 로 인용을 복구한다(AI 가 공백/오탈자를 내도 정본 문장으로 확정)', () => {
    const { candidates } = loadFixture();
    const target = candidates.find((candidate) => candidate.text === AI_ONLY_SENTENCE);
    expect(target).toBeDefined();
    const result = mergeWith([
      draft({ candidateId: target!.id, sourceQuote: AI_ONLY_SENTENCE.replace('하교시', '하교 시'), kind: 'route-change' }),
    ]);
    expect(result.repairs).toEqual([
      { from: AI_ONLY_SENTENCE.replace('하교시', '하교 시'), to: AI_ONLY_SENTENCE, how: 'candidate-id' },
    ]);
    expect(result.dateRules.some((rule) => rule.sourceQuote === AI_ONLY_SENTENCE)).toBe(true);
  });

  it('규칙이 중복 통합으로 흡수한 문장(mergedQuotes)도 AI 는 다시 구조화하지 않는다', () => {
    // 개천절[10.3~10.4] 은 규칙 파서가 '개천절연휴[10.3~10.4]' 규칙의 mergedQuotes 로 흡수했다.
    // AI 가 같은 문장을 다시 내도 규칙이 이긴다 — dateRules 에 같은 기간이 두 번 생기면 안 된다(gap⑥).
    const { rules } = loadFixture();
    const absorbed = rules.dateRules.flatMap((rule) => rule.mergedQuotes ?? []);
    expect(absorbed).toContain('*개천절[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음');

    const result = mergeWith([draft({ sourceQuote: absorbed[0]!, kind: 'no-service' })]);
    expect(result.conflicts).toBe(1);
    expect(result.accepted).toBe(0);
    const d3 = result.dateRules.filter((rule) => rule.start === '2026-10-03' && rule.end === '2026-10-04');
    expect(d3).toHaveLength(1);
    expect(d3[0]?.extractedBy).toBe('rule');
  });

  it('계약에 없는 kind 는 버리고 사유를 남긴다(조용한 통과 금지)', () => {
    const result = mergeWith([draft({ sourceQuote: HALL_SENTENCE, kind: 'traffic-jam' })]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain('알 수 없는 kind');
    expect(result.accepted).toBe(0);
  });

  it('수치가 필요한 kind 인데 원문에 수치가 없으면 버린다(수치는 AI 금지 영역)', () => {
    const result = mergeWith([draft({ sourceQuote: '일요일 시간표로 운행', kind: 'no-service' })]);
    expect(result.dropped[0]?.reason).toContain('날짜가 없다');
    expect(result.accepted).toBe(0);
  });

  it('resolveQuote 는 정확 부분문자열을 그대로 정본으로 쓴다', () => {
    const { candidates, sources } = loadFixture();
    const resolved = resolveQuote(draft({ sourceQuote: HALL_SENTENCE }), candidates, sources);
    expect(resolved).toEqual({ canonical: HALL_SENTENCE, page: expect.stringContaining('cheonan-campus'), repair: null });
  });

  it('draftToEntry — term/vacation 은 terms 쪽으로 간다', () => {
    const { base, candidates, sources } = loadFixture();
    const resolved = resolveQuote(draft({ sourceQuote: HALL_SENTENCE }), candidates, sources);
    const outcome = draftToEntry(draft({ sourceQuote: HALL_SENTENCE, kind: 'vacation', confidence: 0.9 }), resolved!, base);
    expect(outcome.term?.kind).toBe('vacation');
    expect(outcome.rule).toBeNull();
  });
});

describe('T16 검증기 규칙', () => {
  it('정상(규칙 전용) 산출물은 문제 0건이다', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    expect(validateEnriched(enriched, { baseline: base, sources, termSources })).toEqual([]);
  });

  it('kind 필수 필드 누락은 치명이다(stop-time-window 인데 시간창 없음)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const broken = withFabricated(enriched, {
      kind: 'stop-time-window',
      start: null,
      effect: { windows: [] },
      sourceQuote: '*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음',
    });
    const issues = validateEnriched(broken, { baseline: base, sources, termSources });
    expect(issues.some((issue) => issue.fatal && issue.where.includes('effect.windows'))).toBe(true);
  });

  it('날짜 형식 위반(YYYY-MM-DD 아님)은 치명이다', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const broken = withFabricated(enriched, {
      start: '2026/01/01',
      sourceQuote: '*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음',
    });
    const issues = validateEnriched(broken, { baseline: base, sources, termSources });
    expect(issues.some((issue) => issue.fatal && issue.where.includes('dateRules'))).toBe(true);
  });

  it('규칙 중복은 치명이 아니라 경고다(T23 재분류 — 병합 단계가 흡수한다)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const first = enriched.dateRules.find((rule) => rule.kind === 'period-meaning');
    const issues = validateEnriched(withFabricated(enriched, { ...first!, extractedBy: 'ai' }), { baseline: base, sources, termSources });
    // 중복은 발행을 막지 않는다 — 검증기는 방어적으로 경고만 낸다(인용·스키마 위반과 구분)
    expect(hasFatal(issues)).toBe(false);
    expect(issues.some((issue) => !issue.fatal && issue.message.includes('중복'))).toBe(true);
  });

  it('baseline(행 수·시각) 불일치는 치명이 아니라 needsReview 경고다(발행은 하되 표시)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const payload = {
      ...enriched,
      routes: enriched.routes.map((route, index) =>
        index === 0 ? { ...route, trips: route.trips.slice(0, route.trips.length - 1) } : route,
      ),
    };
    const mutated: EnrichedTimetableBody = {
      ...payload,
      source: { ...payload.source, contentHash: `sha256:${sha256Hex(enrichedCanonicalPayload(payload))}` },
    };
    const issues = validateEnriched(mutated, { baseline: base, sources, termSources });
    expect(hasFatal(issues)).toBe(false);
    expect(issues.some((issue) => issue.message.includes('baseline'))).toBe(true);
  });

  it('notices 중복 제거를 건너뛰면 치명이다', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const payload = { ...enriched, notices: base.notices };
    const mutated: EnrichedTimetableBody = {
      ...payload,
      source: { ...payload.source, contentHash: `sha256:${sha256Hex(enrichedCanonicalPayload(payload))}` },
    };
    expect(hasFatal(validateEnriched(mutated, { baseline: base, sources, termSources }))).toBe(true);
  });

  it('contentHash 재계산 불일치는 치명이다', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const mutated: EnrichedTimetableBody = {
      ...enriched,
      source: { ...enriched.source, contentHash: `sha256:${'0'.repeat(64)}` },
    };
    const issues = validateEnriched(mutated, { baseline: base, sources, termSources });
    expect(issues.some((issue) => issue.fatal && issue.where === 'source.contentHash')).toBe(true);
  });

  it('AI 저신뢰(confidence<0.6)인데 needsReview=false 면 경고가 뜬다(치명 아님)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const merged = mergeWith([draft({ sourceQuote: AI_ONLY_SENTENCE, kind: 'route-change', confidence: 0.4 })]);
    const payload = { ...enriched, dateRules: merged.dateRules };
    const withAi: EnrichedTimetableBody = {
      ...payload,
      source: { ...payload.source, contentHash: `sha256:${sha256Hex(enrichedCanonicalPayload(payload))}` },
    };
    const clean = validateEnriched(withAi, { baseline: base, sources, termSources });
    expect(hasFatal(clean)).toBe(false);

    const tampered = {
      ...withAi,
      dateRules: withAi.dateRules.map((rule) => (rule.extractedBy === 'ai' ? { ...rule, needsReview: false } : rule)),
    };
    const issues = validateEnriched(tampered, { baseline: base, sources, termSources });
    expect(issues.some((issue) => !issue.fatal && issue.message.includes('needsReview'))).toBe(true);
  });

  it('v1 필드를 바꾸면 치명이다(앱 무중단 위반)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const mutated: EnrichedTimetableBody = { ...enriched, semester: { ...enriched.semester, endsOn: '2026-12-15' } };
    const issues = validateEnriched(mutated, { baseline: base, sources, termSources });
    expect(issues.some((issue) => issue.fatal && issue.where === 'semester')).toBe(true);
  });

  it('v2 본문 조립은 v1 표를 건드리지 않는다(회귀 방지)', () => {
    const { base, rules } = loadFixture();
    const built = buildEnrichedTimetable(base, {
      dateRules: rules.dateRules,
      terms: rules.terms,
      tripNotes: rules.tripNotes,
      stopWindows: rules.stopWindows,
      notices: rules.notices,
      dedupedNotices: rules.dedupedNotices,
    });
    expect(JSON.stringify(built.routes.map((route) => route.trips))).toBe(
      JSON.stringify(base.routes.map((route) => route.trips)),
    );
    expect(built.source.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
