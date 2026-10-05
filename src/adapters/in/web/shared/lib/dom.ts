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
