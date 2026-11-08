/**
 * T42 — 학사력 → `academicEvents[]` (docs/10-academic-calendar.md §6 · §8)
 *
 *  · 규칙 파서: 실제 2026학년도 학사력 정본(72건 · 요일 98/98)을 골든으로 고정한다.
 *  · 실패 경로: 요일 불일치 · 형식 위반 · 월 머리글 없음 → `ExtractError`(발행 중단 사유).
 *  · AI 분류 교차검증: 규칙이 정본 — `ignored` 만 AI 로 채택(needsReview), 불일치는 규칙 유지.
 *  · 응답 검증: 원문에 없는 번호 · 사전에 없는 kind · 번호 중복 → 전부 버림(부분 채택 없음).
 *  · 통합: `runExtract` 가 목업 OpenAI 호환 API 로 학사력 1건을 1회 호출해 발행본에 싣는다.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  calendarDriftReasons,
  classifyCalendarLabel,
  countByKind,
  crossCheckCalendar,
  parseAcademicCalendar,
} from '../../tools/extract/calendar.js';
import type { AcademicEventKind } from '../../tools/extract/calendar.js';
import { buildCalendarPrompt, createCalendarClassifier, parseCalendarKinds } from '../../tools/extract/aiCalendar.js';
import type { ChatTransport } from '../../tools/extract/aiTransport.js';
import { newChatUsage } from '../../tools/extract/aiTransport.js';
import { runExtract } from '../../tools/extract/cli.js';
import { createCalendarClassifierFor } from '../../tools/extract/structurer.js';
import { ExtractError } from '../../tools/extract/types.js';
import { startMockApi } from './mock-ai-server.js';
import type { MockApi } from './mock-ai-server.js';
import { fakeStructurer, makeRunHarness } from './support.js';

const FILE = 'data/raw/calendar/2026학년도-학사력.txt';
const TEXT = readFileSync(FILE, 'utf8');

describe('규칙 파서 — 2026학년도 학사력 골든', () => {
  const result = parseAcademicCalendar(TEXT, FILE);

  it('학년도 2026 · 일정 72건 · 분류별 건수', () => {
    expect(result.academicYear).toBe(2026);
    expect(result.events).toHaveLength(72);
    expect(countByKind(result.events)).toEqual({
      holiday: 19,
      observance: 2,
      'semester-start': 2,
      'vacation-start': 2,
      exam: 4,
      ignored: 43,
    });
  });

  it('셔틀에 쓰는 핵심 날짜가 원문 그대로 나온다', () => {
    const find = (label: string, start: string) => result.events.find((event) => event.label === label && event.start === start);
    expect(find('동계방학/계절학기 시작', '2026-12-15')).toMatchObject({ kind: 'vacation-start', end: null, weekdays: ['화'] });
    expect(find('기말고사', '2026-12-08')).toMatchObject({ kind: 'exam', end: '2026-12-14', weekdays: ['화', '월'] });
    expect(find('성탄절', '2026-12-25')).toMatchObject({ kind: 'holiday' });
    expect(find('추석 연휴', '2026-09-24')).toMatchObject({ kind: 'holiday', end: '2026-09-26' });
    expect(find('개강일, 학기개시일, 입학일', '2026-09-01')).toMatchObject({ kind: 'semester-start' });
    // 월 머리글에 연도가 적힌 블록(2027년 1월)은 yearInferred=false
    expect(find('신정', '2027-01-01')).toMatchObject({ kind: 'holiday', yearInferred: false });
    expect(find('설날 연휴', '2027-02-06')).toMatchObject({ kind: 'holiday', end: '2027-02-08' });
  });

  it('셔틀 안내문의 휴일(추석·개천절·대체공휴일·한글날·개교기념일)이 같은 날짜의 holiday 로 들어 있다', () => {
    const holidays = new Set(result.events.filter((event) => event.kind === 'holiday').map((event) => event.start));
    for (const day of ['2026-09-24', '2026-10-03', '2026-10-05', '2026-10-09', '2026-10-28']) expect(holidays.has(day)).toBe(true);
  });

  it('모든 항목이 원문 한 줄을 인용하고 출처 파일을 가진다', () => {
    for (const event of result.events) {
      expect(TEXT).toContain(event.sourceQuote);
      expect(event.sourceQuote).toContain(event.label);
      expect(event.sourcePage).toBe(FILE);
      expect(event.extractedBy).toBe('rule');
    }
  });
});

describe('규칙 파서 — 실패는 조용히 넘기지 않는다', () => {
  const head = '2026학년도 학사력\n12월 / DECEMBER\n';

  it('요일이 실제 달력과 다르면 실패(연도 추론 오류·원본 오기)', () => {
    expect(() => parseAcademicCalendar(`${head}◉ 15(수) 동계방학/계절학기 시작\n`, 'x.txt')).toThrow(ExtractError);
    expect(() => parseAcademicCalendar(`${head}◉ 15(수) 동계방학/계절학기 시작\n`, 'x.txt')).toThrow(/요일 불일치/);
  });

  it('형식이 낯선 줄 · 월 머리글 없는 일정 · 제목 없음 → 실패', () => {
    expect(() => parseAcademicCalendar(`${head}◉ 십오일 방학\n`, 'x.txt')).toThrow(/날짜 형식/);
    expect(() => parseAcademicCalendar(`${head}엉뚱한 줄\n`, 'x.txt')).toThrow(/형식이 아닌 줄/);
    expect(() => parseAcademicCalendar('2026학년도 학사력\n◉ 1(금) 신정\n', 'x.txt')).toThrow(/월 머리글 없이/);
    expect(() => parseAcademicCalendar('12월 / DECEMBER\n◉ 25(금) 성탄절\n', 'x.txt')).toThrow(/학년도 제목/);
  });

  it('달을 넘는 기간(28(월)~3(수))과 연도 미표기 1·2월(다음 해)을 맞게 계산한다', () => {
    const cross = parseAcademicCalendar('2026학년도 학사력\n12월 / DECEMBER\n◉ 28(월)~ 1(금) 연말 휴무\n', 'x.txt');
    expect(cross.events[0]).toMatchObject({ start: '2026-12-28', end: '2027-01-01' });
    const jan = parseAcademicCalendar('2026학년도 학사력\n1월 / JANUARY\n◉ 1(금) 신정\n', 'x.txt');
    expect(jan.events[0]).toMatchObject({ start: '2027-01-01', yearInferred: true });
  });

  it('분류 규칙의 경계 — 경과일·입시 일정은 ignored', () => {
    expect(classifyCalendarLabel('학기개시 90일')).toBe('ignored');
    expect(classifyCalendarLabel('수시 실기고사')).toBe('ignored');
    expect(classifyCalendarLabel('수업일수 1/4(개강 후 19일째)')).toBe('ignored');
    expect(classifyCalendarLabel('2026 지방선거')).toBe('holiday');
    expect(classifyCalendarLabel('참부모의 날(음3.1)')).toBe('observance');
  });
});

describe('AI 분류 교차검증 — 규칙이 정본', () => {
  const events = parseAcademicCalendar(
    '2026학년도 학사력\n12월 / DECEMBER\n◉ 8(화)~14(월) 기말고사\n◉ 15(화) 동계방학/계절학기 시작\n◉ 25(금) 성탄절\n◉ 22(화)~24(목) 성적공고/이의신청 및 정정\n',
    'x.txt',
  ).events;

  it('AI 를 안 쓰면 규칙 분류 그대로', () => {
    const checked = crossCheckCalendar(events, null);
    expect(checked.events).toEqual(events);
    expect(checked.agreed).toBe(0);
  });

  it('일치 · 규칙 ignored 를 AI 가 채움(채택) · 규칙과 다름(규칙 유지) · 누락', () => {
    const ai = new Map<number, AcademicEventKind>([
      [0, 'exam'], // 일치
      [1, 'holiday'], // 불일치 → 규칙(vacation-start) 유지 + needsReview
      [3, 'exam'], // 규칙 ignored → AI 채택(needsReview)
      // 2(성탄절) 누락 → 규칙 유지
    ]);
    const checked = crossCheckCalendar(events, ai);
    expect(checked.agreed).toBe(1);
    expect(checked.missing).toBe(1);
    expect(checked.conflicts).toEqual([{ index: 1, label: '동계방학/계절학기 시작', rule: 'vacation-start', ai: 'holiday' }]);
    expect(checked.events[1]).toMatchObject({ kind: 'vacation-start', needsReview: true, extractedBy: 'rule' });
    expect(checked.adopted).toHaveLength(1);
    expect(checked.events[3]).toMatchObject({ kind: 'exam', needsReview: true, extractedBy: 'ai' });
    expect(checked.events[2]).toMatchObject({ kind: 'holiday', needsReview: false });
  });

  it('응답 검증 — 원문에 없는 번호 · 사전에 없는 kind · 중복 · 형식 오류는 전부 버린다', () => {
    expect(parseCalendarKinds('{"items":[{"id":0,"kind":"exam"}]}', 4).kinds?.get(0)).toBe('exam');
    expect(parseCalendarKinds('{"items":[{"id":9,"kind":"exam"}]}', 4)).toMatchObject({ kinds: null });
    expect(parseCalendarKinds('{"items":[{"id":0,"kind":"party"}]}', 4).error).toMatch(/사전에 없는 kind/);
    expect(parseCalendarKinds('{"items":[{"id":0,"kind":"exam"},{"id":0,"kind":"exam"}]}', 4).error).toMatch(/중복/);
    expect(parseCalendarKinds('{"rows":[]}', 4).error).toMatch(/items/);
    expect(parseCalendarKinds('not json', 4).kinds).toBeNull();
  });

  it('프롬프트는 번호 | 원문 한 줄만 담고 날짜를 요구하지 않는다', () => {
    const prompt = buildCalendarPrompt({ sourcePage: 'x.txt', events });
    expect(prompt).toContain('0 | ◉ 8(화)~14(월) 기말고사');
    expect(prompt).toContain('날짜는 적지 않는다');
  });
});

/** 응답을 고정한 가짜 전송(네트워크 0) */
function fakeTransport(reply: string | Error, unavailable: string | null = null): ChatTransport {
  const usage = newChatUsage();
  return {
    provider: 'api',
    model: 'fake-model',
    usage,
    async unavailableReason() {
      return unavailable;
    },
    async chat() {
      usage.calls += 1;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

describe('분류기 상태 — 실패해도 규칙 분류로 계속(폴백)', () => {
  const request = { sourcePage: 'x.txt', events: parseAcademicCalendar('2026학년도 학사력\n12월 / DECEMBER\n◉ 25(금) 성탄절\n', 'x.txt').events };

  it('ok · unavailable(호출 0) · error(HTTP 실패 · 잘못된 응답)', async () => {
    expect(await createCalendarClassifier(fakeTransport('{"items":[{"id":0,"kind":"holiday"}]}')).classify(request)).toMatchObject({
      status: 'ok',
      provider: 'api',
      calls: 1,
    });
    expect(await createCalendarClassifier(fakeTransport('{}', '키 없음')).classify(request)).toMatchObject({
      status: 'unavailable',
      provider: 'rule-only',
      calls: 0,
      kinds: null,
    });
    expect(await createCalendarClassifier(fakeTransport(new Error('HTTP 500'))).classify(request)).toMatchObject({ status: 'error', kinds: null });
    expect(await createCalendarClassifier(fakeTransport('{"items":[{"id":3,"kind":"holiday"}]}')).classify(request)).toMatchObject({
      status: 'error',
      kinds: null,
    });
  });
});

describe('드리프트 — 화면에 쓰는 분류가 줄면 보류', () => {
  const events = parseAcademicCalendar(TEXT, FILE).events;
  it('직전 발행본이 없거나 같으면 신호 0 · 공휴일이 줄면 신호', () => {
    expect(calendarDriftReasons(null, events)).toEqual([]);
    expect(calendarDriftReasons(events, events)).toEqual([]);
    const fewer = events.filter((event) => event.label !== '성탄절');
    expect(calendarDriftReasons(events, fewer)).toEqual(['학사일정 holiday 19 → 18건(감소)']);
  });
});

// ═══════════════════════════ 통합 — runExtract 가 목업 API 로 학사력을 분류해 발행 ═══════════════════════════

const servers: MockApi[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('통합 — npm run extract 경로(목업 OpenAI 호환 API)', () => {
  it('학사력 1건 = AI 호출 1회 · 발행본에 academicEvents + source.extraction.calendar 기록', async () => {
    const rules = parseAcademicCalendar(TEXT, FILE).events;
    // 목업 AI: 학사일정 프롬프트에만 규칙과 같은 분류를 돌려준다(그 밖의 호출은 빈 응답)
    const server = await startMockApi((request) => {
      const prompt = String(request.body.messages?.[0]?.content ?? '');
      if (!prompt.includes('학사력(학사일정)')) return { body: { choices: [{ message: { content: '{"rules":[]}' } }] } };
      const items = rules.map((event, id) => ({ id, kind: event.kind }));
      return { body: { choices: [{ message: { content: JSON.stringify({ items }) } }] } };
    });
    servers.push(server);
    const env = { AI_BASE_URL: server.baseUrl, AI_MODEL: 'mock-calendar', AI_API_KEY: 'test-key-not-real' };
    const harness = makeRunHarness(() => fakeStructurer([]), {});
    const deps = {
      ...harness.deps,
      createCalendarClassifier: ({ model, noAi, provider }: { model: string; noAi: boolean; provider: 'api' | 'ollama' | 'off' }) =>
        createCalendarClassifierFor(noAi ? 'off' : provider, { model, env }),
    };
    const code = await runExtract(['--ai=api', '--out', 'tmp/t42-out.json', '--log', 'tmp/t42-log.json', '--baseline', ''], deps);
    expect(code, harness.errors.join('\n')).toBe(0);

    const calendarCalls = server.requests.filter((request) => String(request.body.messages?.[0]?.content ?? '').includes('학사력(학사일정)'));
    expect(calendarCalls).toHaveLength(1);

    const out = JSON.parse(harness.written.get('tmp/t42-out.json') ?? '{}') as {
      schemaVersion: number;
      academicEvents: { kind: string; needsReview: boolean }[];
      source: { extraction: { calendar: { ai: { status: string; agreed: number; calls: number }; events: number } } };
    };
    expect(out.schemaVersion).toBe(3);
    expect(out.academicEvents).toHaveLength(72);
    expect(out.academicEvents.every((event) => !event.needsReview)).toBe(true);
    expect(out.source.extraction.calendar).toMatchObject({ events: 72, ai: { status: 'ok', agreed: 72, calls: 1 } });
  });
});
