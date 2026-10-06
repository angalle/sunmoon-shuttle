/**
 * T26 — **AI 초안 수용 규칙**(docs/06 §8). 실 DeepSeek 실행에서 AI 가 만든 항목의 **의미가 틀렸다**:
 *   원문 `천안캠퍼스(2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.)` = **특정 노선 폐지**인데
 *   AI 는 ① 전 노선(scope: []) ② 날짜 규칙 ③ `dayTypes: []` 로 표현했다.
 *
 * 여기서 못 박는 것:
 *   ① 노선 폐지·중단은 dateRule 이 아니다 → `routes[].status` + `routes[].routeNotes[] { quote, note }`
 *   ② `no-service`/`alternate-schedule` 의 scope 는 **원문 근거**가 있어야 한다
 *      (특정 노선 → `scope: [routeId]` · "전 노선·전체" 명시 → `scope: []`)
 *   ③ `dayTypes: []` 금지 — 요일 의미가 없으면 **필드를 만들지 않는다**
 *   ④ 위반은 조용히 통과하지 않는다(검증기 치명 또는 폐기 + 사유 로그)
 *
 * 합성 입력(작은 가짜 스냅샷)을 쓴다 — 실제 사이트 문장과 섞이지 않게 해 판정을 명확히 본다.
 */

import { describe, expect, it } from 'vitest';

import { buildEnrichedTimetable, enrichedCanonicalPayload, sha256Hex } from '../../tools/extract/enrich.js';
import { mergeAiDrafts } from '../../tools/extract/merge.js';
import { extractRuleStructures } from '../../tools/extract/rules.js';
import { hasFatal, validateEnriched } from '../../tools/extract/validate.js';
import { runExtract } from '../../tools/extract/cli.js';
import type { AiRuleDraft, DateRule, EnrichedTimetableBody, SnapshotSource } from '../../tools/extract/types.js';
import type { RouteData, SemesterPeriod, Timetable } from '../../tools/scraper/types.js';
import { fakeStructurer, loadFixture, makeRunHarness } from './support.js';

const SEMESTER: SemesterPeriod = {
  title: '2026-2학기 셔틀버스 시간표(2026.9.1(화)~2026.12.14(월))',
  label: '2026-2학기',
  startsOn: '2026-09-01',
  endsOn: '2026-12-14',
  kind: 'semester',
};

/** 원문 문장 4종 — 각 판정 경로를 분리해 본다 */
const ALL_ROUTES_SENTENCE = '*한글날[10. 9.(금)]: 셔틀버스 운행 없음';
const ROUTE_SCOPED_SENTENCE = '*개교기념일[10. 28.(수)]: 천안역 노선 운행 없음';
const NO_BASIS_SENTENCE = '*개천절대체휴일[10. 5.(월)]: 운행 없음';
const SUSPENSION_SENTENCE = '천안캠퍼스(2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.)';

const PAGE_TEXT = `${ALL_ROUTES_SENTENCE} ${ROUTE_SCOPED_SENTENCE} ${NO_BASIS_SENTENCE} ${SUSPENSION_SENTENCE}`;
const TEMP_PAGE = 'data/raw/t26-합성-평일.html';

function routeOf(id: string, name: string, status: RouteData['status'] = 'active', suspendedReason?: string): RouteData {
  const empty = { columns: [], keys: [], trips: [] };
  return {
    id,
    name,
    path: null,
    status,
    ...(suspendedReason === undefined ? {} : { suspendedReason }),
    columns: [],
    trips: [],
    byDay: { weekday: empty, saturday: empty, sunday: empty },
    offDays: [],
  };
}

function syntheticBase(): Timetable {
  return {
    schemaVersion: 1,
    source: {
      url: 'https://example.test/Page2/About/t26.aspx',
      sourceUpdatedAt: '2026-09-01',
      fetchedAt: '2026-10-06T09:00:00+09:00',
      contentHash: 'sha256:0'.padEnd(71, '0'),
      pages: [],
    },
    semester: SEMESTER,
    holidayPeriod: null,
    dayTypes: ['weekday', 'saturday', 'sunday'],
    routes: [routeOf('asan-ktx', '아산(KTX)역'), routeOf('cheonan-station', '천안역'), routeOf('cheonan-campus', '천안캠퍼스', 'suspended', '2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.')],
    notices: [],
    busRefs: [],
    contacts: { team: '학생지원팀', tel: '041-530-2152' },
  };
}

function syntheticSources(): SnapshotSource[] {
  return [
    { file: TEMP_PAGE, routeId: 'asan-ktx', dayType: 'weekday', html: `<p>${PAGE_TEXT}</p>`, text: PAGE_TEXT },
    // 노선 폐지 문장은 **그 노선의 스냅샷**에도 있는 형태로 둔다(routeNotes 근거 수집 경로)
    {
      file: 'data/raw/t26-합성-cheonan-campus-평일.html',
      routeId: 'cheonan-campus',
      dayType: 'weekday',
      html: `<h4>${SUSPENSION_SENTENCE}</h4>`,
      text: SUSPENSION_SENTENCE,
    },
  ];
}

function draft(partial: Partial<AiRuleDraft> & { sourceQuote: string }): AiRuleDraft {
  return { candidateId: null, kind: 'no-service', dayTypes: [], note: null, confidence: 0.9, ...partial };
}

function mergeWith(drafts: readonly AiRuleDraft[], base: Timetable = syntheticBase()): ReturnType<typeof mergeAiDrafts> {
  return mergeAiDrafts({
    ruleDateRules: [],
    ruleTerms: [],
    drafts,
    candidates: [],
    sources: syntheticSources(),
    base,
  });
}

/** 본문을 손본 뒤 contentHash 를 다시 계산한다(검증기 해시 검사 통과용) */
function rehash(payload: EnrichedTimetableBody): EnrichedTimetableBody {
  return { ...payload, source: { ...payload.source, contentHash: `sha256:${sha256Hex(enrichedCanonicalPayload(payload))}` } };
}

function emptyEnriched(base: Timetable): EnrichedTimetableBody {
  return buildEnrichedTimetable(base, {
    dateRules: [],
    terms: [],
    tripNotes: [],
    stopWindows: [],
    tripConditions: [],
    routeNotes: [],
    notices: base.notices,
    dedupedNotices: 0,
  });
}

const ISSUE_RULE: DateRule = {
  kind: 'no-service',
  start: '2026-10-09',
  end: null,
  yearInferred: true,
  dayTypes: ['weekday'],
  scope: [],
  effect: { appliesTo: 'all-routes' },
  note: null,
  sourceQuote: ALL_ROUTES_SENTENCE,
  sourcePage: TEMP_PAGE,
  extractedBy: 'ai',
  confidence: 1,
  needsReview: false,
};

/** 합성 본문에 dateRule 1건을 얹고 해시를 다시 계산한다(검증기 단독 검사용) */
function withRule(base: Timetable, override: Partial<DateRule>): EnrichedTimetableBody {
  return rehash({ ...emptyEnriched(base), dateRules: [{ ...ISSUE_RULE, ...override }] });
}

function messagesOf(body: EnrichedTimetableBody, base: Timetable): string[] {
  return validateEnriched(body, { baseline: base, sources: syntheticSources() }).map((issue) => `${issue.fatal ? 'FATAL' : 'warn'} ${issue.where}: ${issue.message}`);
}

describe('T26-① 노선 폐지·중단은 dateRule 이 아니다', () => {
  it('AI 가 노선 폐지 문장을 dateRule 로 내면 폐기되고 사유가 남는다', () => {
    const result = mergeWith([draft({ sourceQuote: SUSPENSION_SENTENCE, kind: 'no-service' })]);

    expect(result.fatal).toHaveLength(0);
    expect(result.accepted).toBe(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain('노선 폐지·중단 서술은 dateRule 이 아니다');
    expect(result.dateRules.some((rule) => rule.sourceQuote === SUSPENSION_SENTENCE)).toBe(false);
  });

  it('규칙 파서는 폐지 문장을 routes[].routeNotes 로 남긴다(status=suspended 와 짝)', () => {
    const base = syntheticBase();
    const rules = extractRuleStructures({ sources: syntheticSources(), base, candidates: [] });

    const note = rules.routeNotes.find((entry) => entry.routeId === 'cheonan-campus');
    expect(note?.notes.map((item) => item.quote)).toEqual([SUSPENSION_SENTENCE]);
    expect(note?.notes[0]?.note).toContain('routeNotes');
    // 같은 사실이 날짜 규칙으로 새지 않는다
    expect(rules.dateRules.some((rule) => rule.sourceQuote === SUSPENSION_SENTENCE)).toBe(false);
  });

  it('폐지 문장이 어떤 경로로든 dateRule 에 들어가면 검증기가 **치명**으로 막는다', () => {
    const base = syntheticBase();
    const issues = messagesOf(withRule(base, { sourceQuote: SUSPENSION_SENTENCE, dayTypes: ['weekday'] }), base);

    expect(issues.some((message) => message.startsWith('FATAL') && message.includes('노선 폐지·중단 서술을 dateRule 로 표현'))).toBe(true);
  });

  it('routeNotes 의 인용은 원문 부분문자열이어야 한다(없으면 치명)', () => {
    const base = syntheticBase();
    const body = rehash({
      ...emptyEnriched(base),
      routes: emptyEnriched(base).routes.map((route) =>
        route.id === 'cheonan-campus' ? { ...route, routeNotes: [{ quote: '원본에 없는 문장', note: null }] } : route,
      ),
    });
    const issues = validateEnriched(body, { baseline: base, sources: syntheticSources() });

    expect(hasFatal(issues)).toBe(true);
    expect(issues.some((issue) => issue.fatal && issue.where.includes('routeNotes') && issue.message.includes('인용 검증 실패'))).toBe(true);
  });
});

describe('T26-② scope 근거 강제', () => {
  it('원문이 특정 노선을 말하면 scope=[그 노선] + appliesTo=specific-routes 로 좁힌다', () => {
    const result = mergeWith([draft({ sourceQuote: ROUTE_SCOPED_SENTENCE, kind: 'no-service' })]);

    expect(result.fatal).toHaveLength(0);
    const rule = result.dateRules.find((item) => item.sourceQuote === ROUTE_SCOPED_SENTENCE);
    expect(rule?.scope).toEqual(['cheonan-station']);
    expect(rule?.effect).toMatchObject({ appliesTo: 'specific-routes' });
    expect(rule?.start).toBe('2026-10-28');
  });

  it('"전 노선"을 명시한 원문은 scope=[] + all-routes 로 허용한다', () => {
    const result = mergeWith([draft({ sourceQuote: ALL_ROUTES_SENTENCE, kind: 'no-service' })]);

    expect(result.accepted).toBe(1);
    const rule = result.dateRules.find((item) => item.sourceQuote === ALL_ROUTES_SENTENCE);
    expect(rule?.scope).toEqual([]);
    expect(rule?.effect).toMatchObject({ appliesTo: 'all-routes' });
  });

  it('근거가 없는데 전 노선으로 넓히면 폐기된다(사유 로그)', () => {
    const result = mergeWith([draft({ sourceQuote: NO_BASIS_SENTENCE, kind: 'no-service' })]);

    expect(result.accepted).toBe(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain('scope 근거 없음');
  });

  it('근거 없는 scope: [] 규칙이 발행물에 들어가면 검증기가 **치명**으로 막는다', () => {
    const base = syntheticBase();
    const issues = messagesOf(withRule(base, { sourceQuote: NO_BASIS_SENTENCE, dayTypes: ['weekday'] }), base);

    expect(issues.some((message) => message.startsWith('FATAL') && message.includes('"전 노선·전체" 근거가 없는데 scope: []'))).toBe(true);
  });

  it('원문이 말하지 않은 노선을 scope 에 넣으면 **치명**이다', () => {
    const base = syntheticBase();
    const issues = messagesOf(withRule(base, { sourceQuote: NO_BASIS_SENTENCE, scope: ['cheonan-station'], dayTypes: ['weekday'] }), base);

    expect(issues.some((message) => message.startsWith('FATAL') && message.includes('원문이 말하지 않은 노선을 scope 에 넣었습니다'))).toBe(true);
  });
});

describe('T26-③ dayTypes: [] 금지', () => {
  it('요일 의미가 없으면 AI 가 준 빈 배열은 발행물에 **필드를 만들지 않는다**(undefined)', () => {
    const result = mergeWith([draft({ sourceQuote: ALL_ROUTES_SENTENCE, kind: 'no-service', dayTypes: [] })]);

    const rule = result.dateRules.find((item) => item.sourceQuote === ALL_ROUTES_SENTENCE);
    expect(rule).toBeDefined();
    expect('dayTypes' in (rule as object)).toBe(false);
  });

  it('요일 의미가 있으면 그대로 담는다', () => {
    const result = mergeWith([draft({ sourceQuote: ALL_ROUTES_SENTENCE, kind: 'no-service', dayTypes: ['금요일'] })]);

    const rule = result.dateRules.find((item) => item.sourceQuote === ALL_ROUTES_SENTENCE);
    expect(rule?.dayTypes).toEqual(['weekday']);
  });

  it('AI 규칙에 dayTypes: [] 가 들어 있으면 검증기가 **치명**으로 막는다(조용한 통과 금지)', () => {
    const base = syntheticBase();
    const issues = messagesOf(withRule(base, { dayTypes: [] }), base);

    expect(issues.some((message) => message.startsWith('FATAL') && message.includes('dayTypes 가 빈 배열'))).toBe(true);
  });

  it('규칙 파서 산출물의 빈 dayTypes 는 경고에 그친다(회귀 감시 — 발행은 계속)', () => {
    const base = syntheticBase();
    const body = withRule(base, { dayTypes: [], extractedBy: 'rule', scope: [] });
    const issues = validateEnriched(body, { baseline: base, sources: syntheticSources() });

    expect(hasFatal(issues)).toBe(false);
    expect(issues.some((issue) => !issue.fatal && issue.message.includes('dayTypes 가 빈 배열'))).toBe(true);
  });
});

describe('T26-④ 실제 발행물 정정(픽스처 회귀)', () => {
  it('중단 노선의 원문 서술은 routeNotes 에 있고, 같은 문장이 dateRule 에는 없다', () => {
    const { rules, base } = loadFixture();
    const hall = '천안캠퍼스(2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.)';

    const note = rules.routeNotes.find((entry) => entry.routeId === 'cheonan-campus');
    expect(note?.notes.map((item) => item.quote)).toEqual([hall]);
    expect(rules.dateRules.some((rule) => rule.sourceQuote === hall)).toBe(false);
    expect(base.routes.find((route) => route.id === 'cheonan-campus')?.status).toBe('suspended');
  });

  it('빌드된 본문에서 routeNotes 인용이 원문 부분문자열로 검증된다(규칙 전용 발행은 문제 0건)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const hall = enriched.routes.find((route) => route.id === 'cheonan-campus');
    expect(hall?.routeNotes.map((item) => item.quote)).toEqual(['천안캠퍼스(2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.)']);
    expect(validateEnriched(enriched, { baseline: base, sources, termSources })).toEqual([]);
  });

  it('규칙 전용 실행(--no-ai)이 routeNotes 를 발행하고, 폐지 문장이 dateRule 에 없다', async () => {
    const harness = makeRunHarness((() => fakeStructurer([])) as never);
    const code = await runExtract(['--no-ai', '--out', 'tmp/t26-out.json', '--log', 'tmp/t26-run.json'], harness.deps);

    expect(code).toBe(0);
    const artifact = JSON.parse(harness.written.get('tmp/t26-out.json') ?? '{}') as {
      routes: { id: string; status: string; routeNotes: { quote: string }[] }[];
      dateRules: { sourceQuote: string }[];
    };
    const hall = artifact.routes.find((route) => route.id === 'cheonan-campus');
    expect(hall?.status).toBe('suspended');
    expect(hall?.routeNotes).toHaveLength(1);
    expect(hall?.routeNotes[0]?.quote).toContain('운행하지 않습니다');
    expect(artifact.dateRules.some((rule) => rule.sourceQuote.includes('운행하지 않습니다'))).toBe(false);
  });
});
