/**
 * F2b(사용자 결정 2026-11-08) — **운행 중단 노선은 앱에서 완전히 제거**된다.
 *
 * 배경: 데이터 계층(`data/timetable.json`)은 원본 보존을 위해 중단 노선(`cheonan-campus`)과
 * 그 원문 안내문(`notices[14]`: `[원문 제목] 천안캠퍼스(2024-2학기 부터 … 운행하지 않습니다.)`)을
 * 그대로 담는다. 그런데 그 줄이 `ⓘ 이용 안내` 패널에 그대로 나와 "완전 제거" 결정과 어긋났다(T5c).
 *
 * 여기서 고정하는 계약
 *  ① 중단 노선을 가리키는 안내문 줄은 **뷰모델에서 사라진다**(패널이 그릴 수 없다)
 *  ② 다른 안내(운행 없는 날·대체 시간표·요금/승강장/안전·문의처)는 **그대로 남는다**
 *  ③ 중단 노선의 출처 페이지 항목도 뷰모델에서 사라진다
 *  ④ 중단 노선 자체(`routes[]` 뷰모델)는 데이터 계층 무손실을 위해 보존된다(화면 노출은 선택자가 막는다)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTimetable } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import { noticeGroups } from '../../../../src/adapters/in/web/features/schedule/store/selectors';
import { FIXTURE_RAW } from './fixtures';

const RAW = JSON.parse(readFileSync(new URL('../../../../data/timetable.json', import.meta.url), 'utf8')) as unknown;
const model = parseTimetable(RAW);

/** 뷰모델 안내문에서 `천안캠퍼스`·`운행 중단` 문자열이 나오는 줄 수 */
function countSuspendedLines(notices: readonly { readonly text: string }[]): number {
  return notices.filter((notice) => notice.text.includes('천안캠퍼스') || notice.text.includes('운행 중단')).length;
}

describe('F2b — 운행 중단 노선 안내문 제거(T5c)', () => {
  it('실제 데이터: 패널에 그려지는 안내문에 `천안캠퍼스`·`운행 중단` 0건', () => {
    const groups = noticeGroups(model);
    const all = [...groups.noService, ...groups.alternate, ...groups.notices];
    expect(countSuspendedLines(all)).toBe(0);
    // 원본 데이터에는 그 줄이 있다(데이터 계층은 손대지 않았다) — 필터가 실제로 일한 것이다.
    const rawNotices = (RAW as { notices: { text: string; raw: string }[] }).notices;
    expect(rawNotices.some((notice) => notice.raw.includes('천안캠퍼스'))).toBe(true);
  });

  it('실제 데이터: 다른 안내는 그대로 남는다(운행 없는 날·대체·요금/승강장/안전/문의처)', () => {
    const groups = noticeGroups(model);
    const noServiceText = groups.noService.map((notice) => notice.text).join('|');
    expect(noServiceText).toContain('추석연휴');
    expect(noServiceText).toContain('개천절');
    expect(noServiceText).toContain('한글날');
    expect(noServiceText).toContain('개교기념일');
    expect(noServiceText).toContain('셔틀버스 운행 없음');

    expect(groups.alternate).toHaveLength(1);
    expect(groups.alternate[0]?.text).toContain('개천절대체휴일');
    expect(groups.alternate[0]?.text).toContain('일요일 시간표로 운행');

    const texts = groups.notices.map((notice) => notice.text).join('|');
    for (const kept of [
      '요금 결제',
      '학생회관 승강장',
      '지연',
      '음주 탑승',
      '입석',
      '중간경유지 승차장소',
      '하차벨',
      '큰소리 대화',
      '학생회관 승차 가능 시간',
      '모모관광 041-544-8710',
    ]) {
      expect(texts).toContain(kept);
    }
  });

  it('과잉 필터 금지 — 중단 노선을 언급하지 않는 원본 안내문은 한 줄도 잃지 않는다', () => {
    const rawNotices = (RAW as { notices: { text: string; raw: string }[] }).notices;
    const rendered = new Set([
      ...model.notices.map((notice) => notice.raw),
    ]);
    const missing = rawNotices
      .filter((notice) => !notice.raw.includes('천안캠퍼스') && !notice.text.includes('천안캠퍼스'))
      .filter((notice) => !rendered.has(notice.raw));
    expect(missing).toEqual([]);
  });

  it('실제 데이터: 중단 노선 출처 페이지 항목도 뷰모델에서 사라진다(11 → 10)', () => {
    const rawPages = (RAW as { source: { pages: { routeId: string }[] } }).source.pages;
    expect(rawPages).toHaveLength(11);
    expect(model.source.pages).toHaveLength(10);
    expect(model.source.pages.some((page) => page.routeId === 'cheonan-campus')).toBe(false);
  });

  it('중단 노선 자체는 뷰모델에 보존된다(데이터 계층 무손실 · 화면 노출은 선택자가 막는다)', () => {
    const suspended = model.routes.find((route) => route.id === 'cheonan-campus');
    expect(suspended?.status).toBe('suspended');
    expect(suspended?.suspendedReason).toContain('운행하지 않습니다');
  });

  it('중단 노선을 언급하지 않는 안내문은 필터를 통과한다(픽스처 단위 검증)', () => {
    const raw = structuredClone(FIXTURE_RAW) as {
      notices: { kind: string; text: string; raw: string; date?: string }[];
      source: { pages: { routeId: string; dayType: string; url: string; sourceUpdatedAt: string }[] };
    };
    raw.notices.push({
      kind: 'notice',
      text: '운행중단노선: 2024-2학기 부터 운행하지 않습니다.',
      raw: '[원문 제목] 운행중단노선(2024-2학기 부터 운행하지 않습니다.)',
    });
    raw.source.pages = [
      { routeId: 'route-a', dayType: 'weekday', url: 'https://example.test/a', sourceUpdatedAt: '2026-08-20' },
      { routeId: 'route-suspended', dayType: 'weekday', url: 'https://example.test/s', sourceUpdatedAt: '2026-08-20' },
    ];
    const fixtureModel = parseTimetable(raw);
    expect(fixtureModel.notices.some((notice) => notice.text.includes('운행중단노선'))).toBe(false);
    // 남는 안내: 한글날(운행 없음) · 개천절대체휴일 · 요금 안내 3건 그대로
    expect(fixtureModel.notices).toHaveLength(3);
    expect(fixtureModel.source.pages.map((page) => page.routeId)).toEqual(['route-a']);
  });
});
