/**
 * 넓은 화면 두 열(2026-11-20 · 사용자 결정 "양방향을 나란히") — 정적 계약.
 *
 * 열 **배치**는 CSS(@media), 열 **내용**(오른쪽 열을 그릴지)은 JS(matchMedia)가 정한다.
 * 두 기준이 어긋나면 "빈 오른쪽 칸" 이나 "한 열 화면에 반대 방향이 끼어듦" 이 생기므로 같은 값인지 여기서 묶는다.
 * 런타임(DOM) 확인은 `scripts/render_smoke.mjs`(1280px 두 열)와 `scripts/t24_smoke.mjs`(휴대폰 폭 한 열)가 한다(jsdom 미설치).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const page = read('src/adapters/in/web/features/schedule/pages/SchedulePage.ts');
const table = read('src/adapters/in/web/features/schedule/components/organisms/DailyTimetable.ts');
const appCss = read('src/adapters/in/web/shared/ui/styles/app.css');
const tokensCss = read('src/adapters/in/web/shared/ui/styles/tokens.css');

const wideQuery = /const WIDE_QUERY = '([^']+)';/.exec(page)?.[1] ?? null;

describe('넓은 화면 두 열 — 기준 폭이 한 값', () => {
  it('JS 기준(WIDE_QUERY)이 있다', () => {
    expect(wideQuery).toBe('(min-width: 56.25rem)');
  });

  it('app.css 두 열 배치가 같은 기준을 쓴다', () => {
    const block = appCss.slice(appCss.indexOf('넓은 화면 두 열'));
    expect(block).toContain(`@media ${String(wideQuery)}`);
    expect(block).toMatch(/\.shuttle-tabpanel\s*\{[^}]*grid-template-columns/);
  });

  it('tokens.css 가 같은 기준에서 셸을 넓힌다(두 열이 들어갈 폭)', () => {
    expect(tokensCss).toMatch(new RegExp(`@media ${String(wideQuery).replace(/[()]/g, '\\$&')}\\s*\\{\\s*:root\\s*\\{\\s*--shell-max-width:\\s*64rem`));
  });
});

describe('오른쪽 열 — 기존 계약을 흐리지 않는다', () => {
  it('오른쪽 열 행·목록·구역 testid 는 `-alt` 로 끝난다(`timetable-row` = 지금 고른 방향 유지)', () => {
    expect(table).toContain("const suffix = props.secondary === true ? '-alt' : '';");
    expect(table).toContain('`timetable-row${suffix}`');
    expect(table).toContain('`timetable-list${suffix}`');
    expect(table).toContain('`timetable-section${suffix}`');
  });

  it('오른쪽 열에는 방향 전환 버튼을 두지 않는다(방향은 왼쪽 머리 하나가 바꾼다)', () => {
    expect(table).toContain('props.secondary === true) return line;');
  });

  it('페이지는 넓을 때만 오른쪽 열을 그리고, 반대 방향으로 그린다', () => {
    expect(page).toMatch(/if \(!isWide\(\) \|\| state\.model === null\) \{\s*replaceChildren\(altListHost, \[\]\);/);
    expect(page).toContain("const opposite: DirectionSelection = direction === 'in' ? 'out' : 'in';");
    expect(page).toContain('secondary: true');
  });
});
