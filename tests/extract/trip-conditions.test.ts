/**
 * T21 편별 조건(v3) 테스트 — **표기 정규화 사전 · 미해석 보존 · 검증기 불변식 · 방학 기간**.
 *
 * 실제 원본 스냅샷(`data/raw/*.html`)을 입력으로 쓴다(픽스처를 손으로 적지 않는다).
 */

import { describe, expect, it } from 'vitest';

import { loadFixture } from './support.js';
import { compactNote, parseTripNote, structureTripConditions, tripConditionKey, WEEKDAY_ORDER } from '../../tools/extract/trips.js';
import { findVacationPeriodInText, searchVacationPeriod } from '../../tools/extract/rules.js';
import { buildEnrichedTimetable } from '../../tools/extract/enrich.js';
import { validateEnriched } from '../../tools/extract/validate.js';
import type { EnrichedTimetableBody, TermSource } from '../../tools/extract/types.js';

function enrichedWith(condition = loadFixture().rules.tripConditions): EnrichedTimetableBody {
  const { base, rules } = loadFixture();
  return buildEnrichedTimetable(base, {
    dateRules: rules.dateRules,
    terms: rules.terms,
    tripNotes: rules.tripNotes,
    stopWindows: rules.stopWindows,
    tripConditions: condition,
    notices: rules.notices,
    dedupedNotices: rules.dedupedNotices,
  });
}

function mutate(
  edit: (body: EnrichedTimetableBody) => EnrichedTimetableBody,
  condition = loadFixture().rules.tripConditions,
): ReturnType<typeof validateEnriched> {
  const { base, sources, termSources } = loadFixture();
  const edited = edit(JSON.parse(JSON.stringify(enrichedWith(condition))) as EnrichedTimetableBody);
  return validateEnriched(edited, { baseline: base, sources, termSources });
}

describe('T21 표기 정규화 사전(docs/06 §3)', () => {
  it('`금(X)` → excludedDays ["fri"]', () => {
    const parsed = parseTripNote('금(X)');
    expect(parsed.outcome).toBe('service');
    expect(parsed.service).toEqual({ excludedDays: ['fri'], dayScope: null, vehicleCount: null, label: null, sourceQuote: '금(X)' });
  });

  it('표기 변형 `금X` · `금요일 없음` 도 같은 결과다', () => {
    for (const note of ['금X', '금 X', '금요일 없음', '금 ( X )']) {
      expect(parseTripNote(note).service?.excludedDays).toEqual(['fri']);
    }
  });

  it('`월~화 2대 운행` → dayScope ["mon","tue"] + vehicleCount 2', () => {
    const parsed = parseTripNote('월~화 2대 운행');
    expect(parsed.service).toMatchObject({ dayScope: ['mon', 'tue'], vehicleCount: 2, excludedDays: [] });
  });

  it('`월~목 2대 운행` → 4요일 범위다(계약 순서)', () => {
    const parsed = parseTripNote('월~목 2대 운행');
    expect(parsed.service?.dayScope).toEqual(['mon', 'tue', 'wed', 'thu']);
    expect(parsed.service?.vehicleCount).toBe(2);
  });

  it('`0:15` → durationMinutes 15 (문자열 잔존 0)', () => {
    const parsed = parseTripNote('0:15');
    expect(parsed.outcome).toBe('duration');
    expect(parsed.durationMinutes).toBe(15);
    expect(parsed.service).toBeNull();
    expect(parsed.unknownNote).toBeNull();
  });

  it('`중간노선 전용` / `중간노선전용` → label "중간노선 전용"(공백 표기 통일)', () => {
    for (const note of ['중간노선 전용', '중간노선전용']) {
      const parsed = parseTripNote(note);
      expect(parsed.service?.label).toBe('중간노선 전용');
      expect(parsed.service?.sourceQuote).toBe(note); // 인용은 원문 그대로
    }
  });

  it('사전에 없는 표기는 버리지 않는다 — unknown + 원문 보존', () => {
    const parsed = parseTripNote('학기 중 운행');
    expect(parsed.outcome).toBe('unknown');
    expect(parsed.service).toBeNull();
    expect(parsed.durationMinutes).toBeNull();
    expect(parsed.unknownNote).toBe('학기 중 운행');
  });

  it('범위 밖 소요시간(`0:00`)은 미해석으로 보존한다(잡음)', () => {
    expect(parseTripNote('0:00').outcome).toBe('unknown');
    expect(parseTripNote('99:59').outcome).toBe('unknown');
  });

  it('compactNote 는 공백만 제거한다(다른 문자는 그대로)', () => {
    expect(compactNote('금 ( X )')).toBe('금(X)');
    expect(WEEKDAY_ORDER[0]).toBe('mon');
  });
});

describe('T21 실데이터 구조화(원문 카운트 대조)', () => {
  it('원문 note 64행이 전부 구조화된다 — 59 + 1 + 1 + 1 + 2', () => {
    const { rules } = loadFixture();
    const entries = rules.tripConditions.flatMap((item) => item.entries);
    expect(entries).toHaveLength(64);
    const byOutcome = entries.filter((entry) => entry.outcome === 'service' && entry.service?.excludedDays.includes('fri')).length;
    expect(byOutcome).toBe(59);
    expect(entries.filter((entry) => entry.durationMinutes === 15)).toHaveLength(1);
    expect(entries.filter((entry) => entry.service?.label === '중간노선 전용')).toHaveLength(2);
    expect(entries.filter((entry) => entry.outcome === 'unknown')).toHaveLength(0);
    for (const entry of entries) expect(entry.sourceQuote.trim()).not.toBe('');
  });

  it('모든 sourceQuote 가 원본 스냅샷의 정확한 부분문자열이다(인용률 100%)', () => {
    const { rules, sources } = loadFixture();
    for (const entry of rules.tripConditions.flatMap((item) => item.entries)) {
      expect(sources.some((source) => source.text.includes(entry.sourceQuote))).toBe(true);
    }
  });

  it('구조화된 행은 note 를 비우고 service/durationMinutes 를 채운다(중복 표현 금지)', () => {
    const { enriched } = loadFixture();
    let conditioned = 0;
    for (const route of enriched.routes) {
      for (const dayType of ['weekday', 'saturday', 'sunday'] as const) {
        for (const row of route.byDay[dayType].trips) {
          const raw = row as Record<string, unknown>;
          if (!('service' in raw)) continue;
          conditioned += 1;
          expect(raw['note']).toBeNull();
          expect(raw['needsReview']).toBe(false);
        }
      }
    }
    expect(conditioned).toBe(64);
  });

  it('`금(X)` 표기가 발행 본문 어디에도 남지 않는다', () => {
    const { enriched } = loadFixture();
    expect(JSON.stringify(enriched.routes).includes('금(X)')).toBe(true); // 출처 인용(service.sourceQuote)에는 남는다
    const notes = enriched.routes.flatMap((route) =>
      ['weekday', 'saturday', 'sunday'].flatMap((dayType) => {
        const table = route.byDay[dayType as 'weekday'].trips as readonly Record<string, unknown>[];
        return table.map((row) => row['note']);
      }),
    );
    expect(notes.every((note) => note === null || note === undefined || typeof note === 'string')).toBe(true);
    // 원문 note 가 없던 행은 v3 에서도 v1 그대로다(키 없음) → `undefined` 도 "비어 있음"이다.
    expect(notes.filter((note) => typeof note === 'string' && note.includes('금(X)'))).toHaveLength(0);
  });

  it('대표(평일) 배열에도 같은 조건이 적용된다(같은 행 계약)', () => {
    const { enriched } = loadFixture();
    const asan = enriched.routes.find((route) => route.id === 'asan-ktx');
    const representative = asan?.trips.find((row) => (row as Record<string, unknown>)['service'] !== undefined);
    expect(representative).toBeDefined();
    expect((representative as Record<string, unknown>)['note']).toBeNull();
  });

  it('조건 구조화는 결정적이다(2회 호출 동일)', () => {
    const { base } = loadFixture();
    expect(JSON.stringify(structureTripConditions(base))).toBe(JSON.stringify(structureTripConditions(base)));
  });

  it('tripConditionKey 는 노선·요일·순번을 구분한다', () => {
    expect(tripConditionKey('asan-ktx', 'weekday', 2)).not.toBe(tripConditionKey('asan-ktx', 'saturday', 2));
  });
});

describe('T21 v3 검증기 불변식(치명)', () => {
  const withUnknown = () =>
    loadFixture().rules.tripConditions.map((item) => ({
      routeId: item.routeId,
      entries: item.entries.map((entry) => ({
        ...entry,
        outcome: 'unknown' as const,
        service: null,
        durationMinutes: null,
        unknownNote: entry.sourceQuote,
      })),
    }));

  it('정상 본문은 치명 0건이다', () => {
    expect(mutate((body) => body).filter((issue) => issue.fatal)).toHaveLength(0);
  });

  it('원문 note 를 그대로 둔 채(구조화 안 함) 두면 치명 — 유실 차단', () => {
    const { base, sources, termSources } = loadFixture();
    const body = JSON.parse(JSON.stringify(enrichedWith())) as EnrichedTimetableBody;
    const row = body.routes[0]?.byDay.weekday.trips[1] as Record<string, unknown>;
    row['service'] = null;
    row['durationMinutes'] = null;
    row['unknownNote'] = null;
    row['note'] = '금(X)';
    const fatal = validateEnriched(body, { baseline: base, sources, termSources }).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('구조화되지 않았습니다'))).toBe(true);
  });

  it('원문 표기를 변형하면 치명 — 위조 차단', () => {
    const fatal = mutate((body) => {
      const row = body.routes[0]?.byDay.weekday.trips[1] as Record<string, unknown>;
      row['service'] = { excludedDays: ['fri'], dayScope: null, vehicleCount: null, label: null, sourceQuote: '금요일 휴무' };
      return body;
    }).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('변형'))).toBe(true);
  });

  it('구조화된 행에 note 를 남기면 치명 — 중복 표현 금지', () => {
    const fatal = mutate((body) => {
      const row = body.routes[0]?.byDay.weekday.trips[1] as Record<string, unknown>;
      row['note'] = '금(X)';
      return body;
    }).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('중복 표현'))).toBe(true);
  });

  it('원문 note 가 없던 행에 조건을 주입하면 치명 — 위조 차단', () => {
    const fatal = mutate((body) => {
      const row = body.routes[0]?.byDay.weekday.trips[0] as Record<string, unknown>;
      row['service'] = { excludedDays: ['fri'], dayScope: null, vehicleCount: null, label: null, sourceQuote: '금(X)' };
      return body;
    }).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('주입'))).toBe(true);
  });

  it('미해석 항목이 needsReview 를 빠뜨리면 치명', () => {
    const fatal = mutate((body) => {
      for (const route of body.routes) {
        for (const row of route.byDay.weekday.trips as readonly Record<string, unknown>[]) {
          if (row['unknownNote'] !== undefined) row['needsReview'] = false;
        }
      }
      return body;
    }, withUnknown()).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('needsReview=true'))).toBe(true);
  });

  it('미해석 항목(withUnknown)도 치명 0건으로 발행 가능하다 — 버리지 않는다', () => {
    expect(mutate((body) => body, withUnknown()).filter((issue) => issue.fatal)).toHaveLength(0);
  });

  it('요일 코드가 아니면 치명', () => {
    const fatal = mutate((body) => {
      const row = body.routes[0]?.byDay.weekday.trips[1] as Record<string, unknown>;
      row['service'] = { excludedDays: ['friday'], dayScope: null, vehicleCount: null, label: null, sourceQuote: '금(X)' };
      return body;
    }).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('요일 코드'))).toBe(true);
  });
});

describe('T21 방학 기간 수집(null 유지 + 사유 기록)', () => {
  it('원본 방학 페이지 본문에서 기간을 찾는다(합성 픽스처 — found)', () => {
    const found = findVacationPeriodInText('방학기간: 2026.12.15~2027.2.28 까지 방학 시간표로 운행');
    expect(found.start).toBe('2026-12-15');
    expect(found.end).toBe('2027-02-28');
    expect(found.evidenceQuote).toContain('2026.12.15');
  });

  it('기간 문구가 없으면 null + 근거 문장이다(추측 금지)', () => {
    const missing = findVacationPeriodInText('현재는 2026-2학기 시간표로 운행되고 있습니다. 학기중 시간표를 확인해주시기 바랍니다.');
    expect(missing.start).toBeNull();
    expect(missing.end).toBeNull();
    expect(missing.evidenceQuote).toContain('운행되고 있습니다');
  });

  it('스냅샷이 없으면 not-provided 다', () => {
    const searched = searchVacationPeriod([]);
    expect(searched.periodSearch.result).toBe('not-provided');
    expect(searched.start).toBeNull();
  });

  it('픽스처 원본 방학 페이지 → not-found(기간 미기재) + 근거 문장', () => {
    const { termSources, enriched } = loadFixture();
    expect(termSources.length).toBeGreaterThan(0);
    const vacation = enriched.terms.find((term) => term.kind === 'vacation');
    expect(vacation?.start).toBeNull();
    expect(vacation?.end).toBeNull();
    expect(vacation?.needsReview).toBe(true);
    if (termSources.length > 0) {
      expect(vacation?.periodSearch?.result).not.toBe('found');
      expect(vacation?.periodSearch?.evidenceQuote ?? '').not.toBe('');
    }
  });

  it('기간을 찾은 스냅샷을 주면 found 로 채워진다(파이프라인 배선)', () => {
    const synthetic: TermSource = {
      file: 'data/raw/terms/합성-방학.html',
      html: '<p>방학기간: 2026.12.15~2027.2.28</p>',
      text: '방학기간: 2026.12.15~2027.2.28',
    };
    const searched = searchVacationPeriod([synthetic]);
    expect(searched.periodSearch).toEqual({ file: synthetic.file, result: 'found', evidenceQuote: '2026.12.15~2027.2.28' });
    expect(searched.start).toBe('2026-12-15');
    expect(searched.end).toBe('2027-02-28');
  });

  it('found 인데 기간이 비면 치명(추측 금지 계약)', () => {
    const fatal = mutate((body) => {
      const vacation = body.terms.find((term) => term.kind === 'vacation');
      if (vacation !== undefined) {
        (vacation as { start: string | null; end: string | null }).start = null;
        (vacation as { start: string | null; end: string | null }).end = null;
        (vacation as { periodSearch?: unknown }).periodSearch = { file: 'x.html', result: 'found', evidenceQuote: '방학 시간표' };
      }
      return body;
    }).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('기간이 비었습니다'))).toBe(true);
  });

  it('not-found 인데 기간을 채우면 치명(추측 금지 계약)', () => {
    const fatal = mutate((body) => {
      const vacation = body.terms.find((term) => term.kind === 'vacation');
      if (vacation !== undefined) {
        (vacation as { start: string | null }).start = '2026-12-15';
        (vacation as { end: string | null }).end = '2027-02-28';
      }
      return body;
    }).filter((issue) => issue.fatal);
    expect(fatal.some((issue) => issue.message.includes('추측 금지'))).toBe(true);
  });
});
