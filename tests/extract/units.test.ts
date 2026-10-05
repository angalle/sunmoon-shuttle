/**
 * T16 단위 테스트 — 텍스트 정규화 · 날짜/요일 유도 · 후보 수집 · 규칙 파서 헬퍼.
 */

import { describe, expect, it } from 'vitest';

import { findExactQuote, pageText, similarity } from '../../tools/extract/text.js';
import { deriveDates, deriveDayTypes } from '../../tools/extract/dateparse.js';
import { CANDIDATE_KEYWORDS, harvestCandidates, harvestLeafTexts } from '../../tools/extract/candidates.js';
import { dedupeNotices, parseDurationNotes, parseStopWindows } from '../../tools/extract/rules.js';
import type { SemesterPeriod } from '../../tools/scraper/types.js';
import { loadFixture } from './support.js';

const SEMESTER: SemesterPeriod = {
  title: '2026-2학기 셔틀버스 시간표(2026.9.1(화)~2026.12.14(월))',
  label: '2026-2학기',
  startsOn: '2026-09-01',
  endsOn: '2026-12-14',
  kind: 'semester',
};

describe('T16 텍스트/인용', () => {
  it('pageText 는 태그를 공백으로 바꾸고 엔티티를 해석한다', () => {
    expect(pageText('<p>아산역&gt;캠퍼스&nbsp;<b>15분</b></p>')).toBe('아산역>캠퍼스 15분');
    expect(pageText('<script>var x=1;</script><div>본문</div>')).toBe('본문');
  });

  it('findExactQuote 는 원본 부분문자열만 찾고, 없는 문장은 null 이다', () => {
    const { sources } = loadFixture();
    const real = findExactQuote('*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음', sources);
    expect(real?.file).toContain('평일');
    expect(findExactQuote('원본에 없는 위조 문장입니다', sources)).toBeNull();
  });

  it('similarity 는 공백·기호 차이를 흡수하되 다른 문장은 낮게 나온다', () => {
    expect(similarity('아산역>캠퍼스 15분 소요', '아산역 > 캠퍼스 15분 소요')).toBeGreaterThan(0.95);
    expect(similarity('아산역>캠퍼스 15분 소요', '개교기념일 운행 없음')).toBeLessThan(0.5);
  });
});

describe('T16 날짜/요일 유도', () => {
  it('공지 표기(연도 없음) → 학기 연도 추론 + yearInferred', () => {
    expect(deriveDates('*개천절[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음', SEMESTER)).toEqual({
      start: '2026-10-03',
      end: '2026-10-04',
      yearInferred: true,
      derivation: 'bracket',
    });
  });

  it('명시 날짜 범위 — 시작에만 연도가 있으면 끝은 추론', () => {
    expect(deriveDates('2026-2학기 셔틀버스 휴일 운행기간 : 2026.9.5.(토) ~ 12.13.(일)', SEMESTER)).toEqual({
      start: '2026-09-05',
      end: '2026-12-13',
      yearInferred: true,
      derivation: 'explicit',
    });
  });

  it('학기 라벨 → 학기 시작일 환산(현재 학기 / 과거 학기)', () => {
    expect(deriveDates('* 2026-2학기부터 학교출발->천안아산역 하교버스는 전체 차량 모두 탕정역 경유', SEMESTER)).toMatchObject({
      start: '2026-09-01',
      derivation: 'semester',
    });
    expect(deriveDates('천안캠퍼스(2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.)', SEMESTER)).toMatchObject({
      start: '2024-09-01',
    });
  });

  it('날짜가 없는 문장은 none 이다(추측 금지)', () => {
    expect(deriveDates('일요일 시간표로 운행', SEMESTER)).toEqual({
      start: null,
      end: null,
      yearInferred: false,
      derivation: 'none',
    });
  });

  it('요일 표기 → dayTypes', () => {
    expect(deriveDayTypes('*개천절[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음')).toEqual(['saturday', 'sunday']);
    expect(deriveDayTypes('*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행')).toEqual(['weekday']);
    expect(deriveDayTypes('날짜 없음')).toEqual([]);
  });
});

describe('T16 후보 수집', () => {
  it('잎 요소 텍스트만 뽑고 표 안쪽은 제외한다', () => {
    const html = '<div><p>첫 문장입니다</p><table><tr><td>표셀값</td></tr></table></div>';
    expect(harvestLeafTexts(html)).toEqual(['첫 문장입니다']);
  });

  it('같은 입력 2회 → 같은 후보 목록(결정성) · 모든 후보가 원본 부분문자열', () => {
    const { sources, candidates, rejectedCandidates } = loadFixture();
    const again = harvestCandidates(sources).candidates;
    expect(JSON.stringify(again)).toBe(JSON.stringify(candidates));
    expect(rejectedCandidates).toBe(0);
    for (const candidate of candidates) {
      expect(sources.some((source) => source.text.includes(candidate.text))).toBe(true);
    }
  });

  it('갭 관련 문장이 후보에 모두 들어 있다', () => {
    const { candidates } = loadFixture();
    const texts = candidates.map((candidate) => candidate.text);
    expect(texts).toContain('* 2026-2학기부터 학교출발->천안아산역 하교버스는 전체 차량 모두 탕정역 경유');
    expect(texts).toContain('2026-2학기 셔틀버스 휴일 운행기간 : 2026.9.5.(토) ~ 12.13.(일)');
    expect(texts).toContain('- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30 / 19:30~ 막차까지 이용가능');
    expect(texts).toContain('방학 시간표');
    expect(texts.some((text) => text.includes('*소요시간:'))).toBe(true);
    expect(CANDIDATE_KEYWORDS).toContain('경유');
  });
});

describe('T16 규칙 파서 헬퍼', () => {
  it('parseDurationNotes — 등교/하교 방향과 구간을 분리한다', () => {
    const { sources } = loadFixture();
    const asan = sources.find((source) => source.file.includes('asan-ktx-평일'));
    expect(asan).toBeDefined();
    const notes = parseDurationNotes(
      '*소요시간: 등교시 아산역>캠퍼스 15분 소요 / 하교시 캠퍼스>탕정역 경유>아산역 20분 소요',
      asan!,
    );
    expect(notes.map((note) => `${note.direction}:${note.minutes}:${note.segment}`)).toEqual([
      'inbound:15:아산역>캠퍼스',
      'outbound:20:캠퍼스>탕정역 경유>아산역',
    ]);
  });

  it('parseDurationNotes — 조건(교통정체/이외 시간)은 같은 절에서만 읽는다', () => {
    const { sources } = loadFixture();
    const terminal = sources.find((source) => source.file.includes('cheonan-terminal-평일'));
    const notes = parseDurationNotes(
      '* 소요시간: 운영시간 8:00~09:00/ 16:30~19:30, 교통정체로 인하여 40분 소요, 이외 시간 30분 소요',
      terminal!,
    );
    expect(notes.map((note) => `${note.minutes}:${note.conditions.join('+')}`)).toEqual(['40:교통정체', '30:이외 시간']);
  });

  it('parseStopWindows — 닫힌 창과 열린 창(막차)을 구분한다', () => {
    expect(parseStopWindows('- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30 / 19:30~ 막차까지 이용가능')).toEqual([
      { start: '13:30', end: '15:30', raw: '13:30~15:30' },
      { start: '19:30', end: null, raw: '19:30~막차까지' },
    ]);
  });

  it('dedupeNotices — 같은 기간 중복을 1건으로 합치고 제거 표기를 남긴다', () => {
    const { base, sources } = loadFixture();
    const result = dedupeNotices(base.notices, sources);
    expect(base.notices.length - result.notices.length).toBe(1);
    expect(result.removed[0]?.keptRaw).toBe('*개천절연휴[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음');
    // 날짜 없는 안내문은 원문 그대로 유지된다
    expect(result.notices.some((notice) => notice.raw === '- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30 / 19:30~ 막차까지 이용가능')).toBe(true);
  });
});
