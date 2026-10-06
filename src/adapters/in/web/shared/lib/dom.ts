/**
 * DOM 헬퍼 (shared/lib) — 프레임워크 없이 요소를 만든다(런타임 의존성 0, docs/01 §2).
 * shared 는 features/·store·api 를 알지 않는다(스킬 §3). 순수 DOM API 만 쓴다.
 */

export type DomChild = Node | string | null | undefined | false;

export interface ElOptions {
  readonly class?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly on?: Readonly<Record<string, (event: Event) => void>>;
}

/** 요소 하나 생성. `attrs` 는 setAttribute(문자열) — boolean/ARIA 속성 포함. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: readonly DomChild[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class !== undefined) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs !== undefined) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
  }
  if (options.dataset !== undefined) {
    for (const [name, value] of Object.entries(options.dataset)) node.dataset[name] = value;
  }
  if (options.on !== undefined) {
    for (const [type, handler] of Object.entries(options.on)) node.addEventListener(type, handler);
  }
  append(node, children);
  return node;
}

/** 자식들을 붙인다(null/undefined/false 는 무시). */
export function append(parent: Node, children: readonly DomChild[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/**
 * 자식 교체(기존 제거 → 새로 붙임). 재렌더 시 리스너 누수를 막기 위해 노드를 새로 만든다.
 */
export function replaceChildren(parent: Element, children: readonly DomChild[]): void {
  while (parent.firstChild !== null) parent.removeChild(parent.firstChild);
  append(parent, children);
}

/** 화면 밖 스크린리더 전용 텍스트. */
export function srOnly(text: string): HTMLSpanElement {
  return el('span', { class: 'shuttle-sr-only', text });
}

/**
 * SVG 아이콘 도형 — 아이콘은 **코드로 그린다**(외부 아이콘 CDN 금지 · 오프라인 원칙, 스킬 §0).
 * 좌표는 24×24 뷰박스 기준이고, 색은 `currentColor`(글자색)를 따라간다.
 */
export type SvgShape =
  | { readonly kind: 'path'; readonly d: string }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number };

/**
 * 장식용 인라인 SVG(T28 — 이동 버튼 아이콘).
 * 항상 `aria-hidden` + `focusable=false` 다: 아이콘은 장식이고 이름은 버튼의 `aria-label` 이 갖는다.
 * 텍스트 노드를 만들지 않으므로 화면 문구 계약(`원본` 0건 등)에도 영향을 주지 않는다.
 */
export function svgIcon(
  shapes: readonly SvgShape[],
  options: { readonly size?: string; readonly viewBox?: string } = {},
): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', options.viewBox ?? '0 0 24 24');
  svg.setAttribute('width', options.size ?? '1em');
  svg.setAttribute('height', options.size ?? '1em');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const shape of shapes) {
    const node = document.createElementNS(NS, shape.kind === 'path' ? 'path' : 'circle');
    if (shape.kind === 'path') node.setAttribute('d', shape.d);
    else {
      node.setAttribute('cx', String(shape.cx));
      node.setAttribute('cy', String(shape.cy));
      node.setAttribute('r', String(shape.r));
    }
    svg.appendChild(node);
  }
  return svg;
}
