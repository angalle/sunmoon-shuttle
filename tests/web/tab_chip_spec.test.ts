/**
 * T30 — 탭·칩 UI 정리(텍스트 축소·배치) 규격 검증 (docs/07-mobile-ux.md §12)
 *
 * 여기서는 **토큰·소스 계약**을 계산으로 고정한다(화면 실측·기하는 `scripts/t24_smoke.mjs` AC-U12 가 낸다).
 *  · §12-4: 요일 탭 44px · 방향 칩 40px · 오늘 점 4px · 3줄 총 높이 ≈153px(146~160)
 *  · §12-3: 편수 숫자는 라벨(13px)보다 작은 11px 캡션
 *  · §12-1·§12-2: 탭에서 노선 수 부가 텍스트가 사라지고 오늘은 점으로만 표시
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTokensFromDisk } from './tokens';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_CSS_PATH = join(ROOT, 'src/adapters/in/web/shared/ui/styles/app.css');
const tokens = readTokensFromDisk(join(ROOT, 'src/adapters/in/web/shared/ui/styles/tokens.css'));

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

describe('T30 규격 — 요일 세그먼트 · 방향 칩 (docs/07 §12-4)', () => {
  it('요일 탭 44px · 방향 칩 40px · 오늘 점 4px · 선택 하단 라인 2px 로 정의된다', () => {
    expect(lengthPx('day-tab-height')).toBe(44);
    expect(lengthPx('chip-height')).toBe(40);
    expect(lengthPx('today-dot-size')).toBe(4);
    expect(lengthPx('today-dot-gap')).toBe(4);
    expect(lengthPx('day-tab-indicator')).toBe(2);
  });

  it('고정 3줄 총 높이가 문서 값(≈153px, 146~160px)에 든다', () => {
    // 앱바 56 + (줄 간격 4 × 2) + 요일 44 + 칩 40 + 고정 영역 하단 여백 8
    const total =
      lengthPx('appbar-height') +
      lengthPx('fixed-row-gap') * 2 +
      lengthPx('day-tab-height') +
      lengthPx('chip-height') +
      lengthPx('space-2');
    expect(total).toBeGreaterThanOrEqual(146);
    expect(total).toBeLessThanOrEqual(160);
  });

  it('편수 숫자(11px 캡션)가 라벨(13px)보다 작다(§12-3)', () => {
    expect(lengthPx('font-size-caption')).toBe(11);
    expect(lengthPx('font-size-row-meta')).toBe(13);
    expect(lengthPx('font-size-caption')).toBeLessThan(lengthPx('font-size-row-meta'));
  });

  it('app.css 가 3줄 규격을 토큰으로만 쓴다(즉석 px 금지)', () => {
    const css = readFileSync(APP_CSS_PATH, 'utf8');
    expect(css).toContain('height: var(--day-tab-height)');
    expect(css).toContain('min-height: var(--chip-height)');
    expect(css).toContain('width: var(--today-dot-size)');
    expect(css).toContain('border-bottom: var(--day-tab-indicator)');
    // 요일 줄은 등폭 3분할(개별 알약·줄바꿈 금지)
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });
});

describe('T30 소스 계약 — 부가 텍스트 제거 (docs/07 §12-1~§12-3)', () => {
  const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

  it('요일 탭은 라벨만 그리고 노선 수 부가 텍스트를 쓰지 않는다(§12-1)', () => {
    const tabs = read('src/adapters/in/web/features/schedule/components/molecules/DayTabs.ts');
    expect(tabs).not.toContain('routesWithTable');
    expect(tabs).not.toContain('boardListCountSuffix');
  });

  it('오늘 표시는 점(`shuttle-tab__today`) 요소 하나로만 한다(§12-2)', () => {
    const atom = read('src/adapters/in/web/shared/ui/atoms/TabButton.ts');
    expect(atom).toContain("'shuttle-tab__today'");
    expect(atom).toContain("role: 'img'");
    expect(atom).toContain("'aria-label': props.todayDotLabel");
  });

  it('방향 칩 편수는 접미사 없이 숫자만 그린다(§12-3)', () => {
    const filter = read('src/adapters/in/web/features/schedule/components/molecules/DirectionFilter.ts');
    expect(filter).not.toContain('boardListCountSuffix');
    expect(filter).toContain('return String(count);');
  });
});
