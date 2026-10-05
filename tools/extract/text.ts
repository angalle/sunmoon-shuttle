/**
 * 원본 HTML → **인용 검증용 본문**과 인용 정규화 유틸.
 *
 * 인용(`sourceQuote`) 검증의 정본은 **페이지 본문 텍스트**(`pageText`)다.
 * 태그를 공백으로 바꾸고 엔티티(`&gt;` 등)를 해석한 뒤 공백을 하나로 접는다 —
 * 원본이 `&gt;` 로 적은 `>` 도, `&nbsp;` 로 띄운 칸도 사람이 읽는 문장 그대로 비교하기 위해서다.
 *
 * `normalizeQuote` 는 **공백만** 지운 비교용 투영이다. 부분문자열이 아닌 인용을
 * 임의로 통과시키지 않기 위해, 이 투영은 ① AI 초안을 후보 목록과 대조(오탈자·공백 차이 흡수)할 때만
 * 쓰고 ② 발행 문서의 `sourceQuote` 는 **정확한 부분문자열**만 허용한다.
 */

import type { SnapshotSource } from './types.js';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  middot: '·',
  hellip: '…',
  rarr: '→',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** script/style/주석 제거 — 문장 후보·본문에서 코드/스타일 텍스트를 배제한다. */
export function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
}

/** 태그 → 공백, 엔티티 해석, 공백 정규화(trim). 원본 문장 부분문자열 검증의 기준 본문. */
export function pageText(html: string): string {
  const withSpaces = stripNonContent(html).replace(/<[^>]*>/g, ' ');
  return decodeEntities(withSpaces)
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** 비교용 투영 — 공백 전부 제거 + 따옴표류 통일. 발행 검증이 아니라 후보 대조에만 쓴다. */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[\s\u00a0\u3000]+/gu, '')
    .replace(/[`"'“”‘’]/gu, '')
    .toLowerCase();
}

export interface QuoteHit {
  /** 인용이 실제로 등장한 스냅샷 파일명 */
  readonly file: string;
  /** 인용이 등장한 페이지 본문(문자열) */
  readonly pageText: string;
}

/**
 * 페이지 본문에서 **정확한 부분문자열**로 인용을 찾는다(없으면 null).
 * 여러 페이지에 있으면 ROUTES/DAY 순서로 넘어온 첫 페이지를 근거로 삼는다(결정적).
 */
export function findExactQuote(quote: string, sources: readonly SnapshotSource[]): QuoteHit | null {
  if (quote.trim() === '') return null;
  for (const source of sources) {
    if (source.text.includes(quote)) return { file: source.file, pageText: source.text };
  }
  return null;
}

/** 편집 거리(표준 DP). 짧은 문장(≤300자) 비교 전용이다. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const up = (previous[j] ?? 0) + 1;
      const left = (current[j - 1] ?? 0) + 1;
      const diagonal = (previous[j - 1] ?? 0) + cost;
      current.push(Math.min(up, left, diagonal));
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

/** 0..1 유사도(1 = 동일). 길이 차가 큰 인용을 통과시키지 않도록 길이 비율을 곱한다. */
export function similarity(a: string, b: string): number {
  const na = normalizeQuote(a);
  const nb = normalizeQuote(b);
  if (na === '' && nb === '') return 1;
  if (na === '' || nb === '') return 0;
  const distance = levenshtein(na, nb);
  const ratio = 1 - distance / Math.max(na.length, nb.length);
  const lengthRatio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
  return ratio * lengthRatio;
}
