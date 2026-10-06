/**
 * T23 AI 경로 발행 중단 수정 — **중복은 치명이 아니다**(규칙 산출물 우선 + 병합/폐기 + 사유 기록).
 *
 * 실 DeepSeek 실행에서 드러난 실패: AI 가 규칙이 이미 만든 `terms[semester]` 를 **다른 인용으로 다시 제안**했고,
 * 검증기가 이를 치명(중복)으로 처리해 **발행 전체가 중단**됐다(exit 1 · JSON 미발행).
 * 계약(사용자 확정 원칙)은 "중복·불일치 = 병합 또는 폐기 + 표시" 이고, 치명은 **인용 위조·스키마 위반**에만 쓴다.
 *
 * 여기서 못 박는 것:
 *   ① 같은 `kind` + 같은 기간/`label` term → 규칙 채택, AI 초안 **폐기 + 사유**
 *   ② 같은 `kind` + 같은 시점 dateRule → 규칙 채택, AI 인용은 `mergedQuotes` 로 **병합(근거 보존)**
 *   ③ AI 초안끼리 중복 → 첫 초안만 채택(조용한 소실 금지 — 사유 기록)
 *   ④ 중복이 있어도 **발행은 성공(exit 0)** · 산출물에 중복 항목 0
 *   ⑤ 인용 불일치(원본에 없는 문장)는 **여전히 치명**(중복 재분류가 위조를 통과시키지 않는다)
 *   ⑥ `--inject-fabricated` exit 1 유지
 */

import { describe, expect, it } from 'vitest';

import { mergeAiDrafts } from '../../tools/extract/merge.js';
import { hasFatal, validateEnriched } from '../../tools/extract/validate.js';
import { buildEnrichedTimetable, enrichedCanonicalPayload, sha256Hex } from '../../tools/extract/enrich.js';
import { runExtract } from '../../tools/extract/cli.js';
import type { ExtractDeps } from '../../tools/extract/cli.js';
import { findExactQuote } from '../../tools/extract/text.js';
import { deriveDates } from '../../tools/extract/dateparse.js';
import type { AiRuleDraft, DateRule, EnrichedTimetableBody, Term } from '../../tools/extract/types.js';
import { FILE_NAMES, fakeStructurer, loadFixture, makeRunHarness } from './support.js';

const OUT = 'tmp/test-t23-out.json';
const LOG = 'tmp/test-t23-run.json';

function draft(partial: Partial<AiRuleDraft> & { sourceQuote: string }): AiRuleDraft {
  return { candidateId: null, kind: 'no-service', dayTypes: [], note: null, confidence: 0.9, ...partial };
}

/** 픽스처의 규칙 산출물 기준으로 병합만 돌린다(파일 IO·네트워크 0). */
function mergeWith(
  drafts: readonly AiRuleDraft[],
  override?: { readonly ruleDateRules?: readonly DateRule[]; readonly ruleTerms?: readonly Term[] },
): ReturnType<typeof mergeAiDrafts> {
  const { base, sources, candidates, rules } = loadFixture();
  return mergeAiDrafts({
    ruleDateRules: override?.ruleDateRules ?? rules.dateRules,
    ruleTerms: override?.ruleTerms ?? rules.terms,
    drafts,
    candidates,
    sources,
    base,
  });
}

/** 초안 고정 structurer — `runExtract` 하네스에 주입한다(네트워크 0). */
function structurerOf(drafts: readonly unknown[]): ExtractDeps['createStructurer'] {
  return (() => fakeStructurer(drafts)) as unknown as ExtractDeps['createStructurer'];
}

/** 본문을 손본 뒤 contentHash 를 다시 계산한다(검증기 해시 검사 통과용). */
function rehash(payload: EnrichedTimetableBody): EnrichedTimetableBody {
  return { ...payload, source: { ...payload.source, contentHash: `sha256:${sha256Hex(enrichedCanonicalPayload(payload))}` } };
}

/** 원본 페이지 본문에서 **정확한 부분문자열**을 잘라낸다(AI 가 더 넓게 인용한 상황 재현). */
function sliceFromPage(file: string, from: string, to: string): string {
  const name = file.split('/').pop() ?? file;
  const page = loadFixture().sources.find((source) => source.file === name);
  expect(page).toBeDefined();
  const text = page?.text ?? '';
  const start = text.indexOf(from);
  const end = text.indexOf(to, start) + to.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('T23 중복 term — 규칙 산출물 우선(발행은 계속된다)', () => {
  it('AI 가 같은 학기 term 을 다른 인용으로 다시 제안하면 규칙이 이기고 AI 초안은 폐기·기록된다', () => {
    const { candidates, rules } = loadFixture();
    // 규칙 semester term 의 정본 인용과 **다른** 문장(같은 학기 표기) — 실패했던 실 실행의 형태
    const semesterQuote = '2026-2학기 셔틀버스 시간표(2026.9.1(화)~2026.12.14(월))';
    const other = candidates.find((candidate) => candidate.text === semesterQuote);
    expect(other).toBeDefined();

    const result = mergeWith([draft({ candidateId: other!.id, sourceQuote: other!.text, kind: 'term' })]);

    expect(result.fatal).toHaveLength(0);
    expect(result.accepted).toBe(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain('중복(규칙 산출물 우선)');
    expect(result.dropped[0]?.reason).toContain('semester');
    // 산출물에는 규칙 term 하나만 남는다(중복 0)
    expect(result.terms).toHaveLength(rules.terms.length);
    expect(result.terms.every((term) => term.extractedBy === 'rule')).toBe(true);
  });

  it('같은 label(방학) 이면 기간이 달라도 규칙 우선으로 폐기한다', () => {
    const { candidates, rules } = loadFixture();
    const hall = candidates.find((candidate) => candidate.text.startsWith('천안캠퍼스(2024-2학기'));
    expect(hall).toBeDefined();

    const result = mergeWith([draft({ candidateId: hall!.id, sourceQuote: hall!.text, kind: 'vacation' })]);

    expect(result.fatal).toHaveLength(0);
    expect(result.accepted).toBe(0);
    expect(result.dropped[0]?.reason).toContain('중복(규칙 산출물 우선)');
    expect(result.dropped[0]?.reason).toContain('vacation');
    expect(result.terms).toHaveLength(rules.terms.length);
  });
});

describe('T23 중복 dateRules — 규칙 채택 + AI 인용은 mergedQuotes 로 보존', () => {
  it('같은 kind·같은 시점 규칙이면 AI 인용을 규칙 항목에 병합한다(근거 소실 없음)', () => {
    const { rules } = loadFixture();
    // 한글날 안내와 개교기념일 안내를 한 번에 인용한 문장 — 규칙의 정본 인용과 다르지만 같은 날짜(10.9)를 담는다
    const span = sliceFromPage(FILE_NAMES.asanWeekday, '*한글날[10. 9.(금)]', '*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음');
    expect(findExactQuote(span, loadFixture().sources)).not.toBeNull();
    expect(deriveDates(span, loadFixture().base.semester).start).toBe('2026-10-09');

    const result = mergeWith([draft({ sourceQuote: span, kind: 'no-service' })]);

    expect(result.fatal).toHaveLength(0);
    expect(result.accepted).toBe(0);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.reason).toContain('중복(규칙 산출물 우선)');
    expect(result.merged[0]?.into).toContain('no-service');
    expect(result.dropped).toHaveLength(0);

    const hangeul = result.dateRules.filter((rule) => rule.kind === 'no-service' && rule.start === '2026-10-09');
    expect(hangeul).toHaveLength(1);
    expect(hangeul[0]?.extractedBy).toBe('rule');
    expect(hangeul[0]?.mergedQuotes).toContain(span);
    // 규칙 항목 수는 그대로다(중복이 늘지 않는다)
    expect(result.dateRules).toHaveLength(rules.dateRules.length);
    // 입력 규칙 산출물은 변형되지 않는다(사본에만 병합)
    expect(rules.dateRules.some((rule) => (rule.mergedQuotes ?? []).includes(span))).toBe(false);
  });

  it('AI 초안끼리 같은 규칙이면 첫 초안만 채택하고 나머지는 사유와 함께 버린다', () => {
    const { candidates } = loadFixture();
    // T26: 노선 폐지 문장은 dateRule 대상이 아니다 — 규칙 밖의 다른 문장으로 같은 판정을 확인한다.
    const target = candidates.find((candidate) => candidate.text.startsWith('*소요시간: 등교시 아산역>캠퍼스'));
    expect(target).toBeDefined();

    const result = mergeWith([
      draft({ candidateId: target!.id, sourceQuote: target!.text, kind: 'route-change' }),
      draft({ candidateId: target!.id, sourceQuote: target!.text, kind: 'route-change' }),
    ]);

    expect(result.fatal).toHaveLength(0);
    expect(result.accepted).toBe(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain('AI 초안끼리');
  });

  it('AI 초안끼리 같은 term 이면 첫 초안만 채택한다(규칙 term 이 없는 입력에서)', () => {
    const { candidates } = loadFixture();
    const hall = candidates.find((candidate) => candidate.text.startsWith('천안캠퍼스(2024-2학기'));
    expect(hall).toBeDefined();

    const result = mergeWith(
      [
        draft({ candidateId: hall!.id, sourceQuote: hall!.text, kind: 'term' }),
        draft({ candidateId: hall!.id, sourceQuote: hall!.text, kind: 'term' }),
      ],
      { ruleTerms: [] },
    );

    expect(result.accepted).toBe(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain('AI 초안끼리');
    expect(result.terms).toHaveLength(1);
  });
});

describe('T23 중복이어도 발행은 성공한다(exit 0)', () => {
  it('중복 term + 중복 dateRule 초안이 섞여도 발행되고, 산출물에 중복·사유 없는 소실이 없다', async () => {
    const { candidates } = loadFixture();
    const semester = candidates.find((candidate) => candidate.text.startsWith('2026-2학기 셔틀버스 시간표(2026.9.1(화)'));
    expect(semester).toBeDefined();
    const span = sliceFromPage(FILE_NAMES.asanWeekday, '*한글날[10. 9.(금)]', '*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음');

    const h = makeRunHarness(
      structurerOf([
        { candidateId: semester!.id, sourceQuote: semester!.text, kind: 'term', dayTypes: [], note: null, confidence: 0.9 },
        { candidateId: null, sourceQuote: span, kind: 'no-service', dayTypes: [], note: null, confidence: 0.9 },
      ]),
    );
    const code = await runExtract(['--out', OUT, '--log', LOG], h.deps);

    expect(code).toBe(0);
    const artifact = JSON.parse(h.written.get(OUT) ?? '{}') as {
      dateRules: { kind: string; start: string | null; extractedBy: string; mergedQuotes?: string[] }[];
      terms: { kind: string; label: string; extractedBy: string }[];
    };
    // ① AI 가 만든 중복 항목이 없다 — terms 는 규칙 것만, 10.9 no-service 규칙은 하나
    expect(artifact.terms.every((term) => term.extractedBy === 'rule')).toBe(true);
    const hangeul = artifact.dateRules.filter((rule) => rule.kind === 'no-service' && rule.start === '2026-10-09');
    expect(hangeul).toHaveLength(1);
    expect(hangeul[0]?.mergedQuotes).toContain(span);
    const termKeys = artifact.terms.map((term) => `${term.kind}|${term.label}`);
    expect(new Set(termKeys).size).toBe(termKeys.length);

    // ② 로그(파일·stdout)에 병합/폐기 사유가 남는다 — 조용한 소실 금지
    const log = JSON.parse(h.written.get(LOG) ?? '{}') as {
      aiAccepted: number;
      aiDropped: number;
      aiMerged: number;
      fatalIssues: unknown[];
    };
    expect(log.fatalIssues).toHaveLength(0);
    expect(log.aiAccepted).toBe(0);
    expect(log.aiDropped).toBe(1);
    expect(log.aiMerged).toBe(1);
    const stdout = h.logs.join('\n');
    expect(stdout).toContain('AI 초안 버림 — 중복(규칙 산출물 우선)');
    expect(stdout).toContain('AI 초안 병합(중복)');
  });
});

describe('T23 치명은 진짜 위험에만 남는다', () => {
  it('원본에 없는 문장(인용 위조)은 병합 단계에서 여전히 치명이다', () => {
    const result = mergeWith([draft({ sourceQuote: '원본에 없는 위조 문장입니다 — 셔틀버스 운행 없음' })]);
    expect(result.fatal).toHaveLength(1);
    expect(result.fatal[0]?.message).toContain('인용 검증 실패');
    expect(result.dropped.some((drop) => drop.reason.includes('중복'))).toBe(false);
  });

  it('위조 인용이 섞이면 발행하지 않는다(exit 1 · 파일 0건)', async () => {
    const h = makeRunHarness(
      structurerOf([
        { candidateId: null, sourceQuote: '원본에 없는 위조 문장입니다', kind: 'no-service', dayTypes: [], note: null, confidence: 0.9 },
      ]),
    );
    const code = await runExtract(['--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(1);
    expect(h.written.has(OUT)).toBe(false);
    expect(h.errors.join('\n')).toContain('인용 검증 실패');
  });

  it('--inject-fabricated 는 계속 exit 1 이다(T23 회귀 방지)', async () => {
    const h = makeRunHarness(structurerOf([]));
    const code = await runExtract(['--no-ai', '--inject-fabricated', '--out', OUT, '--log', LOG], h.deps);
    expect(code).toBe(1);
    expect(h.written.has(OUT)).toBe(false);
    expect(h.errors.join('\n')).toContain('검증 실패(치명)');
  });
});

describe('T23 검증기 — 중복은 경고(치명 아님)', () => {
  it('중복 dateRule·중복 term 은 발행을 막지 않고 경고로 표시된다', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    const duplicated: EnrichedTimetableBody = rehash({
      ...enriched,
      dateRules: [...enriched.dateRules, { ...(enriched.dateRules[0] as DateRule) }],
      terms: [...enriched.terms, { ...(enriched.terms[0] as Term) }],
    });

    const issues = validateEnriched(duplicated, { baseline: base, sources, termSources });
    expect(hasFatal(issues)).toBe(false);
    const warnings = issues.filter((issue) => !issue.fatal).map((issue) => issue.message);
    expect(warnings.some((message) => message.includes('같은 규칙이 중복'))).toBe(true);
    expect(warnings.some((message) => message.includes('같은 term 이 중복'))).toBe(true);
    // 경고 문구가 '치명 아님' 을 명시한다(모니터링이 두 종류를 구분할 수 있어야 한다)
    expect(warnings.filter((message) => message.includes('중복은 치명 아님'))).toHaveLength(2);
  });

  it('중복을 넣어도 contentHash·스키마 검사는 그대로 동작한다(정상 본문은 문제 0건)', () => {
    const { base, sources, termSources, enriched } = loadFixture();
    expect(validateEnriched(enriched, { baseline: base, sources, termSources })).toEqual([]);
    const built = buildEnrichedTimetable(base, {
      dateRules: enriched.dateRules,
      terms: enriched.terms,
      tripNotes: [],
      stopWindows: [],
      tripConditions: [],
      notices: enriched.notices,
      dedupedNotices: 1,
    });
    expect(built.source.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
