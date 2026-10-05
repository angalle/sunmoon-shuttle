/**
 * 테스트 헬퍼: 디자인 토큰 파서 + 대비 계산 (tests/web)
 *
 * 토큰(`tokens.css`)은 색의 **단일출처**다. 여기서 라이트/다크 값을 읽어
 * ① 매니페스트 색과 일치하는지 ② 실제 대비가 4.5:1(WCAG AA 본문) 이상인지 검증한다.
 * 색 계산은 WCAG 2.x 상대휘도 공식을 그대로 구현한다(눈대중 금지 — 검수 기준 3·4번).
 */
import { readFileSync } from 'node:fs';

export interface TokenSets {
  readonly light: Readonly<Record<string, string>>;
  readonly dark: Readonly<Record<string, string>>;
}

export function parseTokens(css: string): TokenSets {
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const head = darkStart === -1 ? css : css.slice(0, darkStart);
  const tail = darkStart === -1 ? '' : css.slice(darkStart);
  return { light: collect(head), dark: collect(tail) };
}

function collect(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    out[name] = value.trim();
  }
  return out;
}

export function readTokensFromDisk(path: string): TokenSets {
  return parseTokens(readFileSync(path, 'utf8'));
}

/** `#rrggbb` 만 지원(토큰은 hex 로만 색을 정의한다). */
export function hexToRgb(hex: string): [number, number, number] {
  const body = hex.trim().replace(/^#/, '');
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`hex 색이 아닙니다: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 상대휘도. */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  return (
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2])
  );
}

/** WCAG 대비비(1~21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** 대비비를 소수 둘째 자리 문자열로(증거 표기용). */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
