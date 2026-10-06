/**
 * T31 — 쓸데없는 문구 제거(docs/07-mobile-ux.md §13) **정적 계약 검사** (AC-U13-1·2·3).
 *
 * 사용자 지시(2026-10-06): "쓸데없는 문구는 빼. 홈화면 어쩌구 전체화면열립니다는 왜있는거야?"
 * ① 설치 안내 카드(문구 상수·컴포넌트·판정 API·CSS)를 **코드째** 지운다 — 죽은 참조 0.
 * ② 본문에 남는 텍스트는 **값·상태·컨트롤 라벨(5종)** 뿐이다 — 설명문·안내문·메타 문구 0.
 *
 * 런타임(실제 DOM) 실측은 헤드리스 Chrome 스모크가 한다(jsdom 미설치 — 저장소 정책):
 *   · scripts/a11y_smoke.mjs  — 본문 텍스트 노드 **전수 목록**(문자열+위치+크기) 덤프 + 금지어 0건
 *   · scripts/qa/ios_pwa_smoke.mjs — "설치 안내 문구 0건"(기존 UA 검사 반전, AC-U13-4)
 * 여기서는 **문구 상수·조립 소스**가 규칙을 지키는지 본다(no-source-ui.test.ts 와 같은 방식).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_TEXT } from '../../src/adapters/in/web/features/schedule/types/texts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const WEB_DIR = 'src/adapters/in/web';
const APP_CSS = 'src/adapters/in/web/shared/ui/styles/app.css';
const IOS_SMOKE = 'scripts/qa/ios_pwa_smoke.mjs';
const A11Y_SMOKE = 'scripts/a11y_smoke.mjs';

/**
 * 화면 **본문**에 실제로 나가는 조립·컴포넌트 소스(§13-1 의 5종 밖 문구가 있으면 위반).
 * 정보 시트(ⓘ)는 문서가 예외로 둔 곳이라 목록에 넣지 않는다(§13-1).
 */
const BODY_SOURCES = [
  'src/adapters/in/web/features/schedule/pages/SchedulePage.ts',
  'src/adapters/in/web/features/schedule/components/molecules/DayTabs.ts',
  'src/adapters/in/web/features/schedule/components/molecules/DirectionFilter.ts',
  'src/adapters/in/web/features/schedule/components/molecules/MoveButtons.ts',
  'src/adapters/in/web/features/schedule/components/molecules/Toast.ts',
  'src/adapters/in/web/features/schedule/components/molecules/SkeletonCards.ts',
  'src/adapters/in/web/features/schedule/components/organisms/DailyTimetable.ts',
  'src/adapters/in/web/features/schedule/components/organisms/DayNotice.ts',
];

/** AC-U13-1 — 본문에서 0건이어야 하는 문자열(설치 안내·메타 문구의 흔적). */
const FORBIDDEN = ['홈 화면', '전체화면', '한 번만', '하세요', '합니다'];

/** 설치 안내가 남긴 **식별자**들 — 하나라도 참조가 남으면 죽은 코드다(AC-U13-3). */
const INSTALL_SYMBOLS = ['installHint', 'InstallHint', 'install-hint', 'shuttle-install'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) sourceFiles(relative, out);
    else if (/\.(ts|css|html)$/.test(entry)) out.push(relative);
  }
  return out;
}

/** UI_TEXT 의 모든 문자열 값(중첩 포함)을 모은다. */
function textValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) textValues(child, out);
  }
  return out;
}

describe('T31 ① 설치 안내 카드 — 문구·컴포넌트·판정 API 삭제 (§13-2)', () => {
  it('설치 안내 문구 상수(installHint*)가 UI_TEXT 에 0건', () => {
    const keys = Object.keys(UI_TEXT).filter((key) => key.startsWith('installHint'));
    expect(keys).toEqual([]);
  });

  it('삭제 대상 문구가 상수에 남아 있지 않다(문자열 원문 대조)', () => {
    const texts = textValues(UI_TEXT).join('\n');
    for (const phrase of ['홈 화면에 추가', '이 안내는 한 번만 표시됩니다', 'Safari 하단의 공유 버튼', 'Chrome 오른쪽 위']) {
      expect(texts).not.toContain(phrase);
    }
  });

  it('렌더 컴포넌트·판정 API 파일이 실제로 없다(미사용으로 남기지 않는다)', () => {
    expect(existsSync(join(ROOT, 'src/adapters/in/web/features/schedule/components/molecules/InstallHint.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/adapters/in/web/features/schedule/api/installHintApi.ts'))).toBe(false);
  });

  it('웹 소스 전체에 설치 안내 심볼 참조 0건(주석 포함)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(WEB_DIR)) {
      const source = read(file);
      for (const symbol of INSTALL_SYMBOLS) {
        if (source.includes(symbol)) offenders.push(`${file}:${symbol}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('설치 안내 CSS(.shuttle-install*)가 app.css 에 0건', () => {
    expect(read(APP_CSS)).not.toContain('shuttle-install');
  });
});

describe('T31 ② 본문 텍스트 — 값·상태·라벨 5종만 (§13-1)', () => {
  it('본문 조립·컴포넌트 소스에 금지 문구 5종 0건', () => {
    const offenders: string[] = [];
    for (const file of BODY_SOURCES) {
      const source = read(file);
      for (const phrase of FORBIDDEN) {
        if (source.includes(phrase)) offenders.push(`${file}:${phrase}`);
      }
    }
    expect(offenders, `본문 소스에 남은 금지 문구: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('정보 시트(ⓘ)는 예외 구역이다 — 출처·갱신·정차창은 시트가 계속 맡는다(§13-1·AC-U13-5)', () => {
    const sheet = read('src/adapters/in/web/features/schedule/components/organisms/GuideSheet.ts');
    expect(sheet).toContain('sourceFooter(');
    expect(sheet).toContain('stopWindows');
    expect(sheet).toContain('freshness');
  });
});

describe('T31 ③ 스모크가 삭제를 실제 DOM 에서 검사한다 (§13-3·AC-U13-4)', () => {
  it('ios_pwa_smoke 가 "설치 안내 문구 0건"으로 반전되어 있다', () => {
    const smoke = read(IOS_SMOKE);
    expect(smoke).toContain('A.no-install-hint');
    expect(smoke).toContain('install-hint');
    expect(smoke).toContain("'홈 화면'");
    // 옛 통과 조건(설치 안내가 iOS 문구로 떠야 PASS)이 남아 있으면 반전이 아니다.
    //  (주석에도 옛 검사 id 가 등장할 수 있으므로 **검사 호출**만 본다.)
    expect(smoke).not.toContain("check('A.ua-ios-hint'");
  });

  it('a11y_smoke 가 본문 텍스트 노드 전수 목록 + 금지어 0건을 검사한다', () => {
    const smoke = read(A11Y_SMOKE);
    expect(smoke).toContain('T31');
    expect(smoke).toContain('forbidden');
    expect(smoke).toContain('본문 텍스트 노드');
  });
});
