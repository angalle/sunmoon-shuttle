/**
 * T37 — 칩 정리 · "오늘로 이동" · 여백 축소 규격 검증 (docs/07-mobile-ux.md §15)
 * T38 — **"전체" 개념 삭제** · 방향은 항상 1개(택1) 규격 검증 (§16)
 *
 * 여기서는 **토큰·소스 계약**을 계산으로 고정한다(화면 실측·기하는 `scripts/t24_smoke.mjs` AC-U15/AC-U16 이 낸다).
 *  · §15-1 → §16-2: 방향 칩은 **2개**(`학교 도착`·`터미널 도착`) — `전체` 칩 없음 · **항상 1개 선택**(해제 불가)
 *  · §15-2: `현재 시간으로` 는 되묻지 않는다 — `오늘로 이동합니다`(1.5초 · 액션 버튼 없음)
 *  · §15-3: 앱바 52 · 요일 40 · 칩 알약 34(터치 44) · 좌우 10 · 행 56 · 고정 영역 128~136px
 *  · §16-2: 0편이면 얇은 1줄 + **전환 수단 1개**(`<다른 방향> 편 보기`) — **자동 전환 금지**
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_TEXT } from '../../src/adapters/in/web/features/schedule/types/texts';
import {
  DEFAULT_DIRECTION_SELECTION,
  DIRECTION_SELECTIONS,
  directionSelectionLabel,
} from '../../src/adapters/in/web/features/schedule/store/selectors';
import { readTokensFromDisk } from './tokens';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_CSS_PATH = join(ROOT, 'src/adapters/in/web/shared/ui/styles/app.css');
const APP_CSS = readFileSync(APP_CSS_PATH, 'utf8');
const tokens = readTokensFromDisk(join(ROOT, 'src/adapters/in/web/shared/ui/styles/tokens.css'));
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

function raw(name: string): string {
  const found = tokens.light[name];
  if (found === undefined) throw new Error(`토큰 --${name} 이 tokens.css 에 없습니다`);
  return found;
}

/** 토큰 값을 px 로 환산한다(`var(--다른토큰)` 참조·`rem`·`px` 해석, 순환 참조 방어). */
function lengthPx(name: string, seen: readonly string[] = []): number {
  if (seen.includes(name)) throw new Error(`토큰 순환 참조: --${name}`);
  const value = raw(name).trim();
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (ref !== null) return lengthPx(ref[1] ?? '', [...seen, name]);
  if (value.endsWith('rem')) return parseFloat(value) * 16;
  if (value.endsWith('px')) return parseFloat(value);
  throw new Error(`px 로 환산할 수 없는 토큰 값: --${name}=${value}`);
}

describe('T37 규격 — 상단 3줄 · 행 (docs/07 §15-3)', () => {
  it('앱바 52px(내용 48 + 아래 여백 4) · 요일 40px · 칩 알약 34px · 오늘 점 4px · 선택 라인 2px', () => {
    expect(lengthPx('appbar-height') + lengthPx('space-1')).toBe(52);
    expect(lengthPx('day-tab-height')).toBe(40);
    expect(lengthPx('chip-height')).toBe(34);
    expect(lengthPx('today-dot-size')).toBe(4);
    expect(lengthPx('day-tab-indicator')).toBe(2);
  });

  it('칩 **터치 영역 44px** 를 알약 밖 투명 여백으로 확보한다(§15-3)', () => {
    expect(lengthPx('chip-touch-height')).toBe(44);
    expect(lengthPx('chip-touch-height') - lengthPx('chip-height')).toBe(10);
    expect(raw('chip-touch-overflow')).toBe('calc((var(--chip-touch-height) - var(--chip-height)) / 2)');
  });

  it('행 높이 56px(터치 최소 48px 이상) · 좌우 여백 10px · 셸 상·하단 여백 8px', () => {
    expect(lengthPx('row-height')).toBe(56);
    expect(lengthPx('row-height')).toBeGreaterThanOrEqual(48);
    expect(lengthPx('shell-pad-x')).toBe(16); // UI v3: 10 → 16(사용자 "답답")
    expect(lengthPx('shell-pad-y')).toBe(8);
  });

  it('고정 영역 총 높이가 문서 값(시안 A 4줄: 188~198px)에 든다 — 실제 값은 JS 가 재서 --fixed-height 로 내린다', () => {
    // 앱바 48 + 아래 여백 4 + (줄 간격 3 × 2) + 요일 40 + 칩 34 + 고정 영역 아래 여백 2 + 경계 1
    const total =
      lengthPx('appbar-height') +
      lengthPx('space-1') +
      lengthPx('fixed-row-gap') * 2 +
      lengthPx('day-tab-height') +
      lengthPx('chip-height') +
      lengthPx('fixed-row-gap') +
      lengthPx('chip-height') +
      lengthPx('fixed-pad-bottom') +
      lengthPx('hairline');
    expect(total).toBeGreaterThanOrEqual(188);
    expect(total).toBeLessThanOrEqual(198);
  });

  it('편수 숫자(11px 캡션)가 라벨(13px)보다 작다(§12-3 유지) · 폰트는 15/13/11 그대로', () => {
    expect(lengthPx('font-size-caption')).toBe(11);
    expect(lengthPx('font-size-row-meta')).toBe(13);
    expect(lengthPx('font-size-row-time')).toBe(15);
    expect(lengthPx('font-size-clock')).toBe(15);
    expect(lengthPx('font-size-caption')).toBeLessThan(lengthPx('font-size-row-meta'));
  });

  it('app.css 가 3줄 규격을 토큰으로만 쓴다(즉석 px 금지)', () => {
    expect(APP_CSS).toContain('height: var(--chip-height)');
    expect(APP_CSS).toContain('height: var(--day-tab-height)');
    expect(APP_CSS).toContain('width: var(--today-dot-size)');
    expect(APP_CSS).toContain('border-bottom: var(--day-tab-indicator)');
    // 요일 줄은 등폭 3분할(개별 알약·줄바꿈 금지)
    expect(APP_CSS).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    // 터치 확장은 알약 밖 여백(::after) — 요소 높이를 늘리지 않는다
    expect(APP_CSS).toContain('inset: calc(-1 * var(--chip-touch-overflow)) 0');
    // 행 높이·여백도 토큰에서 온다
    expect(APP_CSS).toContain('min-height: var(--row-height)');
    expect(APP_CSS).toContain('padding: var(--row-pad-y) var(--row-pad-x)');
    // 자동 스크롤 오프셋은 동적 값 + 토큰 계산식 폴백(하드코딩 금지)
    expect(APP_CSS).toContain('scroll-margin-top: var(--fixed-height, var(--fixed-height-fallback))');
  });
});

describe('T37/T38 소스 계약 — 칩 2개 · 택1(해제 불가) · 되묻지 않음 (§15-1·§15-2 · §16-2)', () => {
  it('방향 칩 순서가 `학교 도착`(in) → `터미널 도착`(out) 이고 `전체` 값이 없다', () => {
    const filter = read('src/adapters/in/web/features/schedule/components/molecules/DirectionFilter.ts');
    expect(filter).toContain("export const CHIP_ORDER: readonly DirectionSelection[] = ['in', 'out'];");
    expect(filter).not.toContain("'all'");
    expect(filter).toContain('UI_TEXT.filterDirectionLegend');
  });

  it('`전체` 칩 문구 상수(filterDirectionAll)가 UI_TEXT 에서 사라졌다(§15-1)', () => {
    expect(Object.keys(UI_TEXT)).not.toContain('filterDirectionAll');
    expect(UI_TEXT.filterDirectionSchool).toBe('학교 도착');
    expect(UI_TEXT.filterDirectionTerminal).toBe('터미널 도착');
  });

  it('T38 §16-2 — 방향 선택 값은 택1(`out`·`in`)뿐이고 기본은 `터미널 도착`(out)이다', () => {
    const selectors = read('src/adapters/in/web/features/schedule/store/selectors.ts');
    expect(DIRECTION_SELECTIONS.join('|')).toBe('out|in');
    expect(DIRECTION_SELECTIONS).not.toContain('all');
    expect(DEFAULT_DIRECTION_SELECTION).toBe('out');
    expect(directionSelectionLabel(DEFAULT_DIRECTION_SELECTION)).toBe('터미널 도착');
    expect(directionSelectionLabel('in')).toBe('학교 도착');
    // 기본값은 **한 곳**(상수 1개)에서만 정한다 — 페이지는 그 상수를 기본으로 쓴다.
    expect(selectors).toContain('export const DEFAULT_DIRECTION_SELECTION: DirectionSelection = \'out\';');
    const page = read('src/adapters/in/web/features/schedule/pages/SchedulePage.ts');
    expect(page).toContain('options.initialDirection ?? DEFAULT_DIRECTION_SELECTION');
    // 해제(=`all` 로 복귀) 경로가 코드에 남아 있지 않다 — 눌린 값이 그대로 선택이 된다.
    expect(page).not.toContain("fullFilter = fullFilter === value ? 'all' : value;");
    expect(page).toContain('selectDirection(value);');
  });

  it('T38 §16-2 — 0편이면 얇은 1줄 + **전환 수단 1개**(자동 전환 금지)', () => {
    expect(UI_TEXT.timetableEmptyFilter).toBe('선택한 방향의 편이 없습니다');
    expect(UI_TEXT.timetableEmptyFilterSwitchSuffix).toBe('편 보기');
    const selectors = read('src/adapters/in/web/features/schedule/store/selectors.ts');
    expect(selectors).toContain('emptySwitch');
    const table = read('src/adapters/in/web/features/schedule/components/organisms/DailyTimetable.ts');
    expect(table).toContain("testid: 'timetable-filter-switch'");
    const page = read('src/adapters/in/web/features/schedule/pages/SchedulePage.ts');
    expect(page).toContain('onSwitchDirection:');
  });

  it('`오늘로 이동합니다` 안내가 문구 상수에 있고 1.5초 수명을 쓴다(§15-2)', () => {
    const page = read('src/adapters/in/web/features/schedule/pages/SchedulePage.ts');
    expect(page).toContain('export const MOVE_NOTICE_MS = 1500;');
    expect(page).toContain('showToast(hint.message, MOVE_NOTICE_MS);');
    expect(UI_TEXT.moveNowTodayNotice).toBe('오늘로 이동합니다');
  });

  it('되묻는 확인형(`오늘 보기` 액션 버튼)이 코드·CSS 에서 사라졌다(§15-2)', () => {
    const toast = read('src/adapters/in/web/features/schedule/components/molecules/Toast.ts');
    expect(toast).not.toContain('actionLabel');
    expect(toast).not.toContain('toast-action');
    expect(APP_CSS).not.toContain('shuttle-toast__action');
    expect(Object.keys(UI_TEXT)).not.toContain('moveNowTodayAction');
  });
});
