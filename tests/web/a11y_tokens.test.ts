/**
 * T7 — 대비·터치 타깃 토큰 검증 (docs/00 §4 비기능 · 카드 수용기준 3·4)
 *
 * 토큰 값을 **실제로 계산**해 WCAG AA(본문 4.5:1)를 만족하는지 본다.
 * (라이트/다크 두 테마 모두 — 색만으로 정보를 전달하지 않으므로 배지/배너 조합도 포함)
 *
 * 실패 메시지에 계산값이 그대로 나온다 → 증거 표의 근거가 된다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, formatRatio, readTokensFromDisk } from './tokens';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOKENS_PATH = join(ROOT, 'src/adapters/in/web/shared/ui/styles/tokens.css');
const tokens = readTokensFromDisk(TOKENS_PATH);

/** [라벨, 전경 토큰, 배경 토큰, 최소 대비] — 본문 텍스트는 4.5, 큰 글씨·비텍스트는 3.0 */
const PAIRS: readonly (readonly [string, string, string, number])[] = [
  ['본문/표면', 'color-text', 'color-surface', 4.5],
  ['본문/보조표면', 'color-text', 'color-surface-alt', 4.5],
  ['본문/배경', 'color-text', 'color-bg', 4.5],
  ['보조글자/표면', 'color-text-muted', 'color-surface', 4.5],
  ['보조글자/보조표면', 'color-text-muted', 'color-surface-alt', 4.5],
  ['약한글자/보조표면', 'color-text-subtle', 'color-surface-alt', 4.5],
  // T27 — 본문 시간표의 흐림(dim)·강조 배경(§9-3): 흐려도 본문 대비(4.5)는 지킨다.
  ['흐린글자/표면', 'color-text-dim', 'color-surface', 4.5],
  ['흐린글자/보조표면', 'color-text-dim', 'color-surface-alt', 4.5],
  ['보조글자/강조배경', 'color-text-muted', 'color-highlight', 4.5],
  ['본문글자/강조배경', 'color-text', 'color-highlight', 4.5],
  ['강조색/표면(링크)', 'color-accent', 'color-surface', 4.5],
  ['강조 위 글자(버튼)', 'color-on-accent', 'color-accent', 4.5],
  ['정상 배지', 'color-ok-text', 'color-ok-bg', 4.5],
  ['경고 배지', 'color-warn-text', 'color-warn-bg', 4.5],
  ['위험 배지', 'color-danger-text', 'color-danger-bg', 4.5],
  ['정보 배지', 'color-info-text', 'color-info-bg', 4.5],
  ['포커스 링/배경', 'focus-ring-color', 'color-bg', 3.0],
  ['테두리(강)/표면', 'color-border-strong', 'color-surface', 3.0],
  ['테두리(강)/보조표면', 'color-border-strong', 'color-surface-alt', 3.0],
];

function value(set: Readonly<Record<string, string>>, name: string): string {
  const hex = set[name];
  if (hex === undefined) throw new Error(`토큰 --${name} 이 tokens.css 에 없습니다`);
  return hex;
}

describe('토큰 실측 대비 (라이트/다크)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const set = tokens[theme];
    it(`${theme} — ${String(PAIRS.length)}개 조합이 기준 대비를 넘는다`, () => {
      const lines: string[] = [];
      for (const [label, fg, bg, min] of PAIRS) {
        const ratio = contrastRatio(value(set, fg), value(set, bg));
        lines.push(`  [${theme}] ${label} ${value(set, fg)} on ${value(set, bg)} = ${formatRatio(ratio)} (≥${min.toFixed(1)})`);
        expect(ratio, `${theme} ${label} = ${formatRatio(ratio)} < ${min.toFixed(1)}`).toBeGreaterThanOrEqual(min);
      }
      console.log(lines.join('\n'));
    });
  }

  it('두 테마가 같은 토큰 이름 집합을 정의한다(다크 누락 방지)', () => {
    const missing = Object.keys(tokens.light).filter((name) => !(name in tokens.dark));
    // 레이아웃/치수 토큰(간격·타이포·안전영역)은 라이트 한 곳에만 있어도 된다 → 색 토큰만 검사.
    const colorMissing = missing.filter((name) => name.startsWith('color-'));
    expect(colorMissing, `다크에 없는 색 토큰: ${colorMissing.join(', ')}`).toEqual([]);
  });

  it('터치 타깃 최소 토큰이 48px 이다(docs/00 §4)', () => {
    expect(tokens.light['touch-target-min']).toBe('48px');
  });

  it('안전영역 토큰이 safe-area-inset 을 참조한다(전체화면 대응)', () => {
    for (const name of ['safe-area-top', 'safe-area-right', 'safe-area-bottom', 'safe-area-left']) {
      expect(value(tokens.light, name)).toContain('safe-area-inset');
    }
  });
});

describe('스타일 규율 — 하드코딩 색 0건', () => {
  it('컴포넌트 스타일(app.css)에 색 하드코딩이 없다(토큰만 사용)', () => {
    const appCss = readFileSync(join(ROOT, 'src/adapters/in/web/shared/ui/styles/app.css'), 'utf8');
    const hits = [...appCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
    expect(hits, `app.css 색 하드코딩: ${hits.join(', ')}`).toEqual([]);
  });
});
