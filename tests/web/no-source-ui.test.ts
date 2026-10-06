/**
 * T14 — 앱 UI 에서 "읽어 온 원본"을 걷어냈는지 **정적으로** 검사한다.
 *
 * 배경(사용자 지시 2026-10-05): 이 앱은 학교 사이트를 실시간으로 읽지 않는다(수집된 JSON 만 읽는다).
 * 그런데 화면에는 `원본 시간표`·`원본 페이지`·`원본 최근 업데이트`가 남아 "원본을 읽어 온다"고
 * 오해하게 만들었다. 그래서 UI 문구·홈 조립에서 `원본` 노출을 0으로 만든다.
 *
 * 런타임(DOM) 검증은 `scripts/v1_smoke.mjs` 가 헤드리스 Chrome 으로 한다
 * (jsdom 미설치 — 저장소 정책). 여기서는 **문구·조립 소스**가 규칙을 지키는지 본다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_TEXT } from '../../src/adapters/in/web/features/schedule/types/texts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const PAGE_PATH = 'src/adapters/in/web/features/schedule/pages/SchedulePage.ts';
const SHEET_PATH = 'src/adapters/in/web/features/schedule/components/organisms/GuideSheet.ts';
const FOOTER_PATH = 'src/adapters/in/web/features/schedule/components/organisms/SourceFooter.ts';
const REFRESH_PATH = 'src/adapters/in/web/features/schedule/components/organisms/DataRefreshLine.ts';
const SMOKE_PATH = 'scripts/v1_smoke.mjs';

/**
 * 소스에서 **주석을 걷어낸 코드만** 본다.
 * T14 규칙은 "사용자 노출 문구 0건"이지 "주석에 `원본`·`source-details` 금지"가 아니다 —
 * 코드 추적용 주석은 허용되므로(태스크 본문: `내부 주석은 허용`) 여기서 제거하고 검사한다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const page = stripComments(read(PAGE_PATH));
const footer = stripComments(read(FOOTER_PATH));
const manifest = JSON.parse(read('public/manifest.webmanifest')) as { description?: string };
const indexHtml = read('index.html');

/** UI_TEXT 의 모든 문자열 값(중첩 포함)을 모은다. */
function textValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) textValues(child, out);
  }
  return out;
}

describe('T14 ① UI 문구 — 사용자 노출 `원본` 0건', () => {
  it('UI_TEXT 의 모든 문구에 `원본` 이 남아 있지 않다', () => {
    const offenders = textValues(UI_TEXT).filter((text) => text.includes('원본'));
    expect(offenders, `문구에 남은 \`원본\`: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('새 소개문구(한/영)가 취지를 그대로 말한다 — 옛 "원본 시간표를 그대로" 문구 제거', () => {
    expect(UI_TEXT.appSubtitle).toBe('지금 탈 수 있는 셔틀버스를 바로 보여줍니다');
    expect(UI_TEXT.appSubtitleEn).toBe('Shows the shuttle you can take right now.');
    expect([UI_TEXT.appSubtitle, UI_TEXT.appSubtitleEn].join(' ')).not.toContain('원본');
    expect(UI_TEXT.appSubtitle).not.toContain('그대로');
  });

  it('출처·데이터 문구가 앱 기준 1줄 형태다(`출처` · `데이터 갱신`)', () => {
    expect(UI_TEXT.sourceLinePrefix).toBe('출처');
    expect(UI_TEXT.freshnessFetchedLabel).toBe('데이터 갱신');
    expect(UI_TEXT.unofficialNotice).toContain('학교 안내 페이지를 출처로 표시합니다');
  });
});

describe('T14 ② 매니페스트·메타 설명 정합', () => {
  it('manifest.description 이 새 소개문구와 같은 취지이고 `원본` 을 쓰지 않는다', () => {
    const description = manifest.description ?? '';
    expect(description).toContain('지금 탈 수 있는 셔틀버스를 바로 보여줍니다');
    expect(description).not.toContain('원본');
  });

  it('index.html 의 meta description 도 같은 취지로 정렬돼 있다', () => {
    expect(indexHtml).toContain('지금 탈 수 있는 셔틀버스를 바로 보여줍니다');
    expect(indexHtml).not.toContain('원본');
  });
});

describe('T14 ③ 홈 조립 — 원본표·노선 선택을 렌더하지 않는다', () => {
  it('접힘 원본표(`source-details`)와 `TimetableTable` 렌더가 없다', () => {
    expect(page).not.toContain('source-details');
    expect(page).not.toContain('timetablePanel');
    expect(page).not.toContain('timetableHost');
    expect(page).not.toContain('sourceDetailsSummary');
  });

  it('노선 선택·노선별 카드·미해석 상세 목록을 홈에서 그리지 않는다', () => {
    expect(page).not.toContain('routeList(');
    expect(page).not.toContain('nextBusCard(');
    expect(page).not.toContain('sourceWarnings(');
    expect(page).not.toContain('freshnessPanel(');
  });

  /**
   * T27 — 본문은 **시간표 하나**다(§9-1). 히어로 카드·탭바·소개문구를 본문에서 걷어내고,
   * 출처·데이터 갱신·요금 안내는 **정보 시트(ⓘ)** 가 맡는다(§9-5).
   */
  it('본문은 시간표 하나 + 상단 1줄 안내만 조립한다(히어로 카드·탭바 없음)', () => {
    expect(page).toContain('dailyTimetable(');
    expect(page).toContain('dayNotice(');
    expect(page).not.toContain('appTabs(');
    expect(page).not.toContain('upcomingBoardCard(');
    expect(page).not.toContain('departureList(');
    expect(page).not.toContain('shortcutCard(');
    // 히어로 카드·요일별 변동·데이터 갱신은 본문 조립에 없다(시트로 이동).
    expect(page).not.toContain('sourceFooter(');
    expect(page).not.toContain('dataRefreshLine(');
  });

  it('정보 시트가 출처·데이터 갱신·변동을 조립한다(§9-5 목적지)', () => {
    const sheet = stripComments(read(SHEET_PATH));
    expect(sheet).toContain('sourceFooter(');
    expect(sheet).toContain('noticePanel(');
    expect(sheet).toContain('upcomingChangeBanner(');
    expect(read(REFRESH_PATH)).toContain("testid: 'data-refresh'");
  });
});

describe('T14 ④ 출처는 대표 1줄 + 링크 1개', () => {
  it('푸터가 대표 출처 1줄을 그리고 내부 사정(페이지 목록·해시·최근 업데이트)을 노출하지 않는다', () => {
    expect(footer).toContain('sourceLinePrefix');
    expect(footer).toContain('sourceLineLabel');
    expect(footer).not.toContain('source.pages');
    expect(footer).not.toContain('contentHash');
    expect(footer).not.toContain('sourceUpdatedAt');
    // 학교 링크는 이 앵커 하나뿐이다(스모크가 DOM 에서 1개 이하를 재확인한다).
    expect(footer.match(/testid: 'source-link'/g) ?? []).toHaveLength(1);
    expect(footer.match(/href: source\.url/g) ?? []).toHaveLength(1);
  });

  it('개인정보처리방침 링크는 그대로 있다(T11 요건 유지)', () => {
    expect(footer).toContain("href: './privacy.html'");
    expect(footer).toContain('text: UI_TEXT.privacyLinkLabel');
    expect(footer).not.toContain('privacy.html", target');
  });
});

describe('T14 ⑤ 스모크가 요청 출처를 실제로 검사한다', () => {
  const smoke = read(SMOKE_PATH);

  it('v1 스모크에 모든 리소스 요청의 출처 검사(학교 도메인 0건)가 들어 있다', () => {
    expect(smoke).toContain('Network.requestWillBeSent');
    expect(smoke).toContain('lily.sunmoon.ac.kr');
    expect(smoke).toContain('requestOrigins');
  });

  it('스모크가 홈의 원본 노출 0건을 DOM 에서 검사한다', () => {
    expect(smoke).toContain('source-details');
    expect(smoke).toContain("document.body.innerText");
    expect(smoke).toContain('원본');
  });
});
