/**
 * 규칙 산출물 + AI 초안 병합 — **규칙이 이긴다**(같은 인용·같은 기간을 두고 충돌하면 규칙 채택).
 *
 * AI 초안 처리 규칙(정직성의 핵심):
 *   ① 인용 해석: 원본 부분문자열(정확) → 후보 id → 후보 유사도(≥0.85) 순으로 **정본 문장**을 확정한다.
 *      정본을 찾지 못하면 **치명 오류**(발행 중단) — 원본에 없는 문장은 통과시키지 않는다(AC-A3).
 *   ② `kind` 가 계약 목록에 없으면 **버리고 기록**한다(조용한 통과 금지 — 산출물·로그에 사유를 남긴다).
 *   ③ 수치는 AI 것이 아니라 **규칙/문장 파서**가 만든다(`deriveDates`). 수치를 못 만들면
 *      `kind` 별 필수 필드가 비므로 그 초안도 버린다.
 *   ④ `confidence < 0.6` 이면 `needsReview: true` 로 **발행은 하되 표시**한다.
 *   ⑤ AI 가 만든 항목은 `extractedBy: 'ai'` 로 구분한다(결정성 기준은 규칙 산출물에만 적용).
 *   ⑥ **중복은 치명이 아니다**(T23): AI 초안이 규칙 산출물과 *같은 항목*(dateRule = 같은 `kind`+같은 시점,
 *      term = 같은 `kind`+같은 `label` 또는 같은 기간)이면 **규칙 우선** — dateRule 은 인용을
 *      `mergedQuotes` 로 **병합(근거 보존)**, term 은 폐기하고, AI 초안끼리 겹쳐도 첫 초안만 채택한다.
 *      병합·폐기 어느 쪽이든 **사유를 `merged`/`dropped` 로 남긴다**(조용한 소실 금지).
 *      치명(fatal)은 ① 인용 위조처럼 **진짜 위험**에만 쓴다 — 중복 때문에 발행 전체가 막히지 않는다.
 *
 * T26 — **AI 초안 수용 규칙**(docs/06 §8, 실 DeepSeek 실행에서 의미가 틀린 초안이 발행된 뒤):
 *   ⑦ **노선 폐지·중단은 dateRule 이 아니다** — `routes[].status`·`routes[].routeNotes[]` 로만 표현한다.
 *      원문이 노선을 지목하며 중단을 말하면(`운행하지 않습니다` 등) 그 초안은 **폐기 + 사유**다.
 *   ⑧ **scope 근거 강제** — `no-service`/`alternate-schedule` 은 ①원문이 특정 노선을 말하면 `scope: [routeId]`,
 *      ②원문이 "전 노선·전체"를 명시했을 때만 `scope: []` + `appliesTo: "all-routes"`.
 *      근거가 없는데 전 노선으로 넓히면 **폐기**(로그 남김) — 조용히 넓히지 않는다.
 *   ⑨ **`dayTypes: []` 금지** — 요일 의미가 없으면 필드를 **만들지 않는다**(빈 배열은 해석이 갈린다).
 */

import { deriveDates } from './dateparse.js';
import { compareDateRules } from './rules.js';
import { findExactQuote, normalizeQuote, similarity } from './text.js';
import { isDateRuleKind } from './types.js';
import type {
  AiRuleDraft,
  Candidate,
  DateRule,
  DateRuleKind,
  DayType,
  DroppedDraft,
  SnapshotSource,
  Term,
  Timetable,
  ValidationIssue,
} from './types.js';

/** AI 인용을 후보 문장으로 되돌릴 때 허용하는 최소 유사도 */
export const QUOTE_REPAIR_SIMILARITY = 0.85;

const CONFIDENCE_REVIEW_THRESHOLD = 0.6;

/**
 * 원문이 **전 노선·전체**를 말하는 표기(docs/06 §8-2).
 * 이 근거가 있을 때만 `scope: []` + `effect.appliesTo: "all-routes"` 를 허용한다 —
 * 근거 없이 전 노선으로 넓히면 그 초안은 폐기한다.
 */
export const ALL_ROUTES_PHRASES: readonly string[] = [
  '전 노선',
  '전노선',
  '전체 노선',
  '모든 노선',
  '전체 차량',
  '전체차량',
  '전 차량',
  '모든 셔틀버스',
  '전체 셔틀버스',
  '셔틀버스 운행 없음',
  '셔틀버스 운행없음',
];

/**
 * 원문이 **노선 폐지·중단**을 말하는 표기(docs/06 §8-1).
 * 노선명과 함께 나오면 그 문장은 `dateRules` 가 아니라 `routes[].status`·`routeNotes` 의 재료다.
 */
export const SUSPENSION_PHRASES: readonly string[] = [
  '운행하지 않습니다',
  '운행하지 않음',
  '운행하지 않는다',
  '운행되지 않',
  '운행 중단',
  '운행중단',
  '미운행',
  '폐지',
];

/** 원문이 지목한 노선 id(노선명이 그대로 등장할 때만 — 추측하지 않는다) */
export function routeIdsMentionedIn(quote: string, base: Timetable): string[] {
  return base.routes.filter((route) => route.name !== '' && quote.includes(route.name)).map((route) => route.id);
}

/** 원문이 "전 노선·전체"를 명시했는가(scope: [] 의 유일한 근거) */
export function isAllRoutesStatement(quote: string): boolean {
  return ALL_ROUTES_PHRASES.some((phrase) => quote.includes(phrase));
}

/** 원문이 **특정 노선의 폐지·중단**을 말하는가 — dateRule 금지 대상 판정(docs/06 §8-1) */
export function isRouteSuspensionStatement(quote: string, base: Timetable): boolean {
  if (routeIdsMentionedIn(quote, base).length === 0) return false;
  if (SUSPENSION_PHRASES.some((phrase) => quote.includes(phrase))) return true;
  return base.routes.some(
    (route) => route.suspendedReason !== undefined && route.suspendedReason !== '' && quote.includes(route.suspendedReason),
  );
}

const DAY_TOKEN: Readonly<Record<string, DayType>> = {
  평일: 'weekday',
  주중: 'weekday',
  weekday: 'weekday',
  월요일: 'weekday',
  화요일: 'weekday',
  수요일: 'weekday',
  목요일: 'weekday',
  금요일: 'weekday',
  토요일: 'saturday',
  토: 'saturday',
  saturday: 'saturday',
  일요일: 'sunday',
  일: 'sunday',
  sunday: 'sunday',
};

export interface AiMergeInput {
  readonly ruleDateRules: readonly DateRule[];
  readonly ruleTerms: readonly Term[];
  readonly drafts: readonly AiRuleDraft[];
  readonly candidates: readonly Candidate[];
  readonly sources: readonly SnapshotSource[];
  readonly base: Timetable;
}

export interface QuoteRepair {
  readonly from: string;
  readonly to: string;
  readonly how: 'candidate-id' | 'similarity';
}

export interface MergedDraft {
  /** 규칙 항목으로 흡수된 AI 인용(정본) */
  readonly quote: string;
  /** 흡수 대상이 된 규칙 항목 식별자(사람이 읽는 문자열) */
  readonly into: string;
  readonly reason: string;
}

export interface AiMergeResult {
  readonly dateRules: readonly DateRule[];
  readonly terms: readonly Term[];
  readonly dropped: readonly DroppedDraft[];
  /** T23: 중복이라 **규칙 항목에 병합**한 AI 초안(폐기와 구분해 로그·집계한다) */
  readonly merged: readonly MergedDraft[];
  readonly repairs: readonly QuoteRepair[];
  readonly conflicts: number;
  readonly accepted: number;
  readonly fatal: readonly ValidationIssue[];
}

interface ResolvedQuote {
  readonly canonical: string;
  readonly page: string;
  readonly repair: QuoteRepair | null;
}

/** AI 인용 → 원본 정본 문장. 실패는 null(=원본에 없는 문장). */
export function resolveQuote(
  draft: AiRuleDraft,
  candidates: readonly Candidate[],
  sources: readonly SnapshotSource[],
): ResolvedQuote | null {
  const exact = findExactQuote(draft.sourceQuote, sources);
  if (exact !== null) return { canonical: draft.sourceQuote, page: exact.file, repair: null };

  if (draft.candidateId !== null) {
    const byId = candidates.find((candidate) => candidate.id === draft.candidateId);
    if (byId !== undefined) {
      return {
        canonical: byId.text,
        page: byId.pages[0] ?? fileOfAny(sources),
        repair: { from: draft.sourceQuote, to: byId.text, how: 'candidate-id' },
      };
    }
  }

  const normalized = normalizeQuote(draft.sourceQuote);
  if (normalized !== '') {
    const contained = candidates.find((candidate) => normalizeQuote(candidate.text).includes(normalized));
    if (contained !== undefined) {
      return {
        canonical: contained.text,
        page: contained.pages[0] ?? fileOfAny(sources),
        repair: { from: draft.sourceQuote, to: contained.text, how: 'similarity' },
      };
    }
  }

  let best: { candidate: Candidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = similarity(draft.sourceQuote, candidate.text);
    if (best === null || score > best.score) best = { candidate, score };
  }
  if (best !== null && best.score >= QUOTE_REPAIR_SIMILARITY) {
    return {
      canonical: best.candidate.text,
      page: best.candidate.pages[0] ?? fileOfAny(sources),
      repair: { from: draft.sourceQuote, to: best.candidate.text, how: 'similarity' },
    };
  }
  return null;
}

function fileOfAny(sources: readonly SnapshotSource[]): string {
  return sources[0]?.file ?? '';
}

function toDayTypes(tokens: readonly string[] | undefined): DayType[] {
  // 모델이 요일 의미가 없을 때 `dayTypes` 를 아예 넣지 않는다(prompt 5) — 없는 값은 "요일 한정 없음"이다.
  if (!Array.isArray(tokens)) return [];
  const found = new Set<DayType>();
  for (const token of tokens) {
    const day = DAY_TOKEN[token.trim()];
    if (day !== undefined) found.add(day);
  }
  return (['weekday', 'saturday', 'sunday'] as const).filter((day) => found.has(day));
}

const NEEDS_DATE: readonly DateRuleKind[] = ['no-service', 'alternate-schedule', 'period-meaning'];

interface DraftOutcome {
  readonly rule: DateRule | null;
  readonly term: Term | null;
  readonly dropped: DroppedDraft | null;
}

/** AI 초안 1건 → dateRule/term 또는 drop 사유. */
export function draftToEntry(
  draft: AiRuleDraft,
  resolved: ResolvedQuote,
  base: Timetable,
): DraftOutcome {
  const kind = draft.kind.trim();
  if (!isDateRuleKind(kind)) {
    return { rule: null, term: null, dropped: { quote: resolved.canonical, reason: `알 수 없는 kind "${kind}"` } };
  }
  const isTermKind = kind === 'term' || kind === 'vacation';
  // ⑦ 노선 폐지·중단은 dateRule 이 아니다(docs/06 §8-1) — `routes[].status`·`routeNotes` 몫이다.
  //    (term 경로는 같은 항목 중복 판정이 규칙 우선으로 흡수한다 — 기존 계약 유지)
  if (!isTermKind && isRouteSuspensionStatement(resolved.canonical, base)) {
    return {
      rule: null,
      term: null,
      dropped: {
        quote: resolved.canonical,
        reason:
          '노선 폐지·중단 서술은 dateRule 이 아니다 — routes[].status·routeNotes 로 표현한다(날짜 규칙으로 적으면 "그 날짜에만 운행 없음"으로 읽힌다, docs/06 §8-1)',
      },
    };
  }
  const dates = deriveDates(resolved.canonical, base.semester);
  const dayTypes = toDayTypes(draft.dayTypes);
  const confidence = draft.confidence;
  const note = draft.note ?? null;
  const baseFields = {
    sourceQuote: resolved.canonical,
    sourcePage: resolved.page,
    extractedBy: 'ai' as const,
    confidence,
  };
  /** ⑨ 요일 의미가 없으면 `dayTypes` 필드를 **만들지 않는다**(빈 배열 금지, docs/06 §8-3) */
  const dayFields = dayTypes.length > 0 ? { dayTypes } : {};

  if (isTermKind) {
    const termKind: Term['kind'] = kind === 'vacation' ? 'vacation' : 'semester';
    const label = kind === 'vacation' ? '방학' : (/(\d{4})\s*-\s*(\d)\s*학기/.exec(resolved.canonical)?.[0] ?? '학기');
    if (dates.start === null) {
      return {
        rule: null,
        term: null,
        dropped: { quote: resolved.canonical, reason: `${kind} 인데 원문에 날짜가 없다(수치는 AI 가 만들지 않는다)` },
      };
    }
    return {
      rule: null,
      term: {
        ...baseFields,
        kind: termKind,
        label,
        start: dates.start,
        end: dates.end,
        timetableSource: null,
        note,
        needsReview: confidence < CONFIDENCE_REVIEW_THRESHOLD,
      },
      dropped: null,
    };
  }

  // kind 별 필수 필드(AI 는 수치를 못 만들므로 문장에 수치가 없으면 여기서 버려진다)
  if (kind === 'stop-time-window') {
    return {
      rule: null,
      term: null,
      dropped: { quote: resolved.canonical, reason: 'stop-time-window 인데 원문에서 시간창을 못 읽었다(수치는 AI 금지 영역)' },
    };
  }
  if (kind === 'route-change' && dates.start === null && !resolved.canonical.includes('경유')) {
    return { rule: null, term: null, dropped: { quote: resolved.canonical, reason: 'route-change 인데 경유·시점 정보가 원문에 없다' } };
  }
  if (NEEDS_DATE.includes(kind) && dates.start === null) {
    return { rule: null, term: null, dropped: { quote: resolved.canonical, reason: `${kind} 인데 원문에 날짜가 없다` } };
  }

  // ⑧ scope 근거 강제(docs/06 §8-2): 특정 노선 서술 → `scope: [routeId]`,
  //    "전 노선·전체" 명시 → `scope: []` + all-routes. 어느 쪽 근거도 없으면 **폐기**한다.
  const scoped = kind === 'no-service' || kind === 'alternate-schedule';
  const scopeIds = scoped ? routeIdsMentionedIn(resolved.canonical, base) : [];
  if (scoped && scopeIds.length === 0 && !isAllRoutesStatement(resolved.canonical)) {
    return {
      rule: null,
      term: null,
      dropped: {
        quote: resolved.canonical,
        reason:
          'scope 근거 없음 — 원문이 특정 노선도 "전 노선·전체"도 말하지 않는다(근거 없이 전 노선으로 넓히지 않는다, docs/06 §8-2)',
      },
    };
  }
  const appliesTo = scopeIds.length > 0 ? 'specific-routes' : 'all-routes';

  const effect: Record<string, unknown> =
    kind === 'alternate-schedule'
      ? { timetable: resolved.canonical.includes('일요일') ? 'sunday' : null, appliesTo }
      : kind === 'no-service'
        ? { appliesTo }
        : kind === 'period-meaning'
          ? { appliesTo: 'unknown', statement: resolved.canonical }
          : kind === 'route-change'
            ? { via: /([가-힣A-Za-z()]+)\s*경유/.exec(resolved.canonical)?.[1] ?? null, statement: resolved.canonical }
            : { statement: resolved.canonical };

  return {
    rule: {
      ...baseFields,
      ...dayFields,
      kind,
      start: dates.start,
      end: dates.end,
      yearInferred: dates.yearInferred,
      scope: scopeIds,
      effect,
      note,
      needsReview: confidence < CONFIDENCE_REVIEW_THRESHOLD,
    },
    term: null,
    dropped: null,
  };
}

/** 사람이 읽는 규칙 식별자(로그·사유 문구용) */
function describeRule(rule: DateRule): string {
  const start = rule.start ?? '시점없음';
  const end = rule.end === null ? '' : `~${rule.end}`;
  return `${rule.kind} ${start}${end}`.trim();
}

/** 사람이 읽는 term 식별자(로그·사유 문구용) */
function describeTerm(term: Term): string {
  return `${term.kind} ${term.label}${term.start === null ? '' : ` ${term.start}`}`;
}

/**
 * T23-⑥-a: term 이 규칙 산출물과 **같은 항목**인가 — 같은 `kind` 이고
 *  ① 같은 `label`(예: 규칙 `방학` vs AI `방학`) 이거나
 *  ② 같은 기간(시작이 같고 끝이 같거나 한쪽이 열려 있음)
 * 이면 같은 항목으로 본다(규칙 우선).
 */
function sameTermItem(candidate: Term, existing: Term): boolean {
  if (candidate.kind !== existing.kind) return false;
  if (candidate.label !== '' && candidate.label === existing.label) return true;
  if (candidate.start === null || existing.start === null) return false;
  if (candidate.start !== existing.start) return false;
  return candidate.end === null || existing.end === null || candidate.end === existing.end;
}

/**
 * T23-⑥-c: dateRule 이 규칙 산출물과 **같은 규칙**인가 — 같은 `kind` + 같은 시점(시작일 동일,
 * 끝은 같거나 한쪽이 열려 있음). 시점이 없는 규칙(시간창 등)은 이 판정에서 제외한다(별개 항목일 수 있다).
 */
function sameRulePeriod(candidate: DateRule, existing: DateRule): boolean {
  if (candidate.kind !== existing.kind) return false;
  if (candidate.start === null || existing.start === null) return false;
  if (candidate.start !== existing.start) return false;
  return candidate.end === null || existing.end === null || candidate.end === existing.end;
}

export function mergeAiDrafts(input: AiMergeInput): AiMergeResult {
  const dropped: DroppedDraft[] = [];
  const merged: MergedDraft[] = [];
  const repairs: QuoteRepair[] = [];
  const fatal: ValidationIssue[] = [];
  const aiRules: DateRule[] = [];
  const aiTerms: Term[] = [];
  // 규칙 산출물 — 병합(mergedQuotes)이 생기면 **이 사본의 원소만** 바뀐다(입력 불변).
  const ruleRules: DateRule[] = [...input.ruleDateRules];
  const ruleTerms: Term[] = [...input.ruleTerms];
  // 규칙 산출물이 이미 설명한 문장 = ① 각 규칙의 정본 인용 ② **중복 통합으로 흡수된 인용**(mergedQuotes).
  // rules.ts 의 `explained` 집합과 같은 기준이다 — AI 는 규칙이 못 잡은 문장만 구조화한다.
  const ruleQuotes = new Set<string>();
  for (const rule of input.ruleDateRules) {
    ruleQuotes.add(rule.sourceQuote);
    for (const quote of rule.mergedQuotes ?? []) ruleQuotes.add(quote);
  }
  const seenKeys = new Set<string>();
  let conflicts = 0;

  input.drafts.forEach((draft, index) => {
    const resolved = resolveQuote(draft, input.candidates, input.sources);
    if (resolved === null) {
      fatal.push({
        where: `ai.drafts[${index}]`,
        message: `인용 검증 실패 — 원본 스냅샷 어디에도 없는 문장이다: "${draft.sourceQuote.slice(0, 80)}"`,
        fatal: true,
      });
      return;
    }
    if (resolved.repair !== null) repairs.push(resolved.repair);

    if (ruleQuotes.has(resolved.canonical)) {
      // 규칙이 이미 설명한 문장 → 규칙 채택, AI 는 중복으로 집계(조용히 버리지 않는다)
      conflicts += 1;
      return;
    }

    const outcome = draftToEntry(draft, resolved, input.base);
    if (outcome.dropped !== null) {
      dropped.push(outcome.dropped);
      return;
    }
    if (outcome.term !== null) {
      const term = outcome.term;
      // ⑥-a 규칙 산출물과 같은 항목(같은 kind + 같은 label/기간) → **규칙 우선**, AI 초안 폐기(사유 기록)
      const duplicate = ruleTerms.find((existing) => sameTermItem(term, existing));
      if (duplicate !== undefined) {
        dropped.push({
          quote: resolved.canonical,
          reason: `중복(규칙 산출물 우선) — 같은 ${term.kind} 항목이 이미 규칙 산출물에 있다(${describeTerm(duplicate)})`,
        });
        return;
      }
      // ⑥-b AI 초안끼리 같은 항목 → 먼저 온 초안을 채택하고 사유를 남긴다(조용한 소실 금지)
      const key = `term|${term.kind}|${term.label}|${term.start ?? ''}`;
      if (seenKeys.has(key)) {
        dropped.push({
          quote: resolved.canonical,
          reason: `중복(AI 초안끼리) — 같은 ${term.kind} 항목이 이미 채택됐다(첫 초안 우선)`,
        });
        return;
      }
      seenKeys.add(key);
      aiTerms.push(term);
      return;
    }
    if (outcome.rule !== null) {
      const rule = outcome.rule;
      // ⑥-c 규칙 산출물과 같은 규칙(같은 kind + 같은 시점) → **규칙 우선** + AI 인용을 근거로 병합(보존)
      const duplicateIndex = ruleRules.findIndex((existing) => sameRulePeriod(rule, existing));
      if (duplicateIndex >= 0) {
        const existing = ruleRules[duplicateIndex] as DateRule;
        const already = [...(existing.mergedQuotes ?? []), existing.sourceQuote].includes(rule.sourceQuote);
        if (!already) {
          ruleRules[duplicateIndex] = { ...existing, mergedQuotes: [...(existing.mergedQuotes ?? []), rule.sourceQuote] };
        }
        merged.push({
          quote: rule.sourceQuote,
          into: describeRule(existing),
          reason: already
            ? `중복(규칙 산출물 우선) — 같은 인용이 이미 규칙 항목에 병합돼 있다(${describeRule(existing)})`
            : `중복(규칙 산출물 우선) — 같은 ${existing.kind} 시점의 규칙 항목에 인용을 병합했다(근거 보존: mergedQuotes)`,
        });
        return;
      }
      // ⑥-d AI 초안끼리 같은 규칙 → 첫 초안만 채택(사유 기록)
      const key = `${rule.kind}|${rule.start ?? ''}|${rule.end ?? ''}|${(rule.dayTypes ?? []).join(',')}|${rule.sourceQuote}`;
      if (seenKeys.has(key)) {
        dropped.push({
          quote: resolved.canonical,
          reason: `중복(AI 초안끼리) — 같은 ${rule.kind} 규칙이 이미 채택됐다(첫 초안 우선)`,
        });
        return;
      }
      seenKeys.add(key);
      aiRules.push(rule);
    }
  });

  return {
    dateRules: [...ruleRules, ...aiRules].sort(compareDateRules),
    terms: [...ruleTerms, ...aiTerms].sort(
      (a, b) => (a.start ?? '9999-99-99').localeCompare(b.start ?? '9999-99-99') || a.kind.localeCompare(b.kind),
    ),
    dropped,
    merged,
    repairs,
    conflicts,
    accepted: aiRules.length + aiTerms.length,
    fatal,
  };
}
