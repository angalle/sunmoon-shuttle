/**
 * 후보 문장 수집 — 원본 스냅샷에서 **날짜·기간·조건 문장 후보**를 결정적으로 뽑는다.
 *
 * 수집 방식(규칙·AI 공통 입력):
 *   ① 원본 HTML 에서 **잎(leaf) 요소**의 텍스트만 취한다(`<span>`, `<u>`, `<p>`, `<li>`, `<h4>` …).
 *      표(`<table>`) 안쪽은 제외한다 — 시간표 셀이 문장처럼 섞여 들어오면 AI 가 오분류한다.
 *   ② 키워드(`경유|소요|정차|운행기간|학기|방학|막차|승강장|부터|없음|시간표|교통정체|운영시간`)가
 *      있는 줄만 남기고, 길이 8~240자로 자른다.
 *   ③ **페이지 본문(`pageText`)의 정확한 부분문자열**인 것만 채택한다 —
 *      그렇지 않으면 `sourceQuote` 계약(원본 부분문자열)을 만족할 수 없다(버린 개수를 보고한다).
 *   ④ 노선(ROUTES 순서)·요일(DAY_TYPES 순서)·문서 순서로 정렬해 `c001…` id 를 붙이고,
 *      같은 문장은 한 후보로 합치며 등장 페이지 목록을 모은다.
 *
 * 여기서 **분류(kind·날짜)는 하지 않는다**. 분류는 규칙(`rules.ts`) 또는 AI(`ai.ts`) 몫이다.
 */

import { DAY_TYPES } from '../scraper/types.js';
import type { DayType } from '../scraper/types.js';
import { ROUTES } from '../scraper/routeMeta.js';
import { pageText, stripNonContent } from './text.js';
import type { Candidate, SnapshotSource } from './types.js';

/** 후보로 볼 키워드 — 날짜·기간·조건 문장에 나타나는 말들 */
export const CANDIDATE_KEYWORDS: readonly string[] = [
  '경유',
  '소요',
  '정차',
  '운행기간',
  '학기',
  '방학',
  '막차',
  '승강장',
  '부터',
  '없음',
  '시간표',
  '교통정체',
  '운영시간',
];

const MIN_LENGTH = 4;
const MAX_LENGTH = 240;

const VOID_TAGS = new Set([
  'br',
  'img',
  'input',
  'meta',
  'link',
  'hr',
  'source',
  'area',
  'base',
  'col',
  'embed',
  'param',
  'track',
  'wbr',
]);

const TABLE_CONTEXT = new Set(['table', 'thead', 'tbody', 'tr']);

export interface LeafText {
  readonly text: string;
  /** 페이지 본문의 부분문자열인가 */
  readonly inPageText: boolean;
}

interface OpenTag {
  readonly name: string;
  readonly contentStart: number;
  readonly insideTable: boolean;
}

/**
 * 잎 요소 텍스트를 **문서 순서대로** 뽑는다.
 * 표 안쪽(및 표에 중첩된) 요소는 제외한다 — 시간표 셀은 문장 후보가 아니다.
 */
export function harvestLeafTexts(html: string): string[] {
  const cleaned = stripNonContent(html);
  const out: string[] = [];
  const stack: OpenTag[] = [];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(cleaned)) !== null) {
    const closing = match[1] === '/';
    const name = (match[2] ?? '').toLowerCase();
    const selfClosed = match[3] === '/';
    if (closing) {
      const index = stack.map((tag) => tag.name).lastIndexOf(name);
      if (index < 0) continue;
      const open = stack[index];
      stack.length = index;
      if (open === undefined || open.insideTable) continue;
      const inner = cleaned.slice(open.contentStart, match.index);
      if (inner.includes('<')) continue; // 중첩 태그가 있으면 잎이 아니다
      const normalized = pageText(inner);
      if (normalized !== '') out.push(normalized);
      continue;
    }
    if (selfClosed || VOID_TAGS.has(name)) continue;
    const insideTable = stack.some((tag) => TABLE_CONTEXT.has(tag.name)) || TABLE_CONTEXT.has(name);
    stack.push({ name, contentStart: tagPattern.lastIndex, insideTable });
  }
  return out;
}

export interface HarvestOptions {
  /** 후보로 인정할 키워드(기본 `CANDIDATE_KEYWORDS`) */
  readonly keywords?: readonly string[];
}

export interface HarvestResult {
  readonly candidates: readonly Candidate[];
  /** 부분문자열 계약을 못 지켜 버린 줄 수(정직 보고) */
  readonly rejected: number;
}

/** 스냅샷 목록(계약 순서로 정렬되어 들어온다) → 후보 목록(결정적). */
export function harvestCandidates(
  sources: readonly SnapshotSource[],
  options: HarvestOptions = {},
): HarvestResult {
  const keywords = options.keywords ?? CANDIDATE_KEYWORDS;
  const byText = new Map<string, { text: string; keywords: Set<string>; pages: string[] }>();
  let rejected = 0;

  for (const source of sources) {
    for (const leaf of harvestLeafTexts(source.html)) {
      if (leaf.length < MIN_LENGTH || leaf.length > MAX_LENGTH) continue;
      const matched = keywords.filter((keyword) => leaf.includes(keyword));
      if (matched.length === 0) continue;
      if (!source.text.includes(leaf)) {
        rejected += 1;
        continue;
      }
      const existing = byText.get(leaf);
      if (existing === undefined) {
        byText.set(leaf, { text: leaf, keywords: new Set(matched), pages: [source.file] });
        continue;
      }
      for (const keyword of matched) existing.keywords.add(keyword);
      if (!existing.pages.includes(source.file)) existing.pages.push(source.file);
    }
  }

  const candidates: Candidate[] = [...byText.values()].map((entry, index) => ({
    id: `c${String(index + 1).padStart(3, '0')}`,
    text: entry.text,
    keywords: [...entry.keywords],
    pages: [...entry.pages],
  }));
  return { candidates, rejected };
}

/**
 * 스냅샷 파일들 → 계약 순서(노선 → 요일)로 정렬된 소스.
 * 입력 순서(글롭 순서)가 달라도 결과가 같도록 **여기서 정렬**한다.
 */
export function toSources(
  snapshots: readonly { readonly file: string; readonly routeId: string; readonly dayType: DayType; readonly html: string }[],
): SnapshotSource[] {
  const routeIndex = new Map<string, number>(ROUTES.map((route, index) => [route.id, index]));
  const orderOf = (routeId: string, dayType: DayType): number =>
    (routeIndex.get(routeId) ?? ROUTES.length) * 10 + (DAY_TYPES as readonly string[]).indexOf(dayType);
  return [...snapshots]
    .sort((a, b) => orderOf(a.routeId, a.dayType) - orderOf(b.routeId, b.dayType))
    .map((snapshot) => ({
      file: snapshot.file,
      routeId: snapshot.routeId,
      dayType: snapshot.dayType,
      html: snapshot.html,
      text: pageText(snapshot.html),
    }));
}
