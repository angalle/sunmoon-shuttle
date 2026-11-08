/**
 * 분자: 안내문 목록 (features/schedule/components/molecules)
 * 문구는 **원본 그대로**(뷰모델이 `raw` 를 우선 담는다) — 판정 문구를 우리가 만들지 않는다.
 */
import { el } from '../../../../shared/lib/dom';

export interface NoticeItemView {
  readonly text: string;
  readonly dateRange: string | null;
}

export interface NoticeListProps {
  readonly items: readonly NoticeItemView[];
  readonly emptyText?: string;
}

export function noticeList(props: NoticeListProps): HTMLElement {
  if (props.items.length === 0) {
    return el('p', { text: props.emptyText ?? '표시할 안내문이 없습니다.' });
  }
  return el('ul', { class: 'shuttle-list', dataset: { testid: 'notice-list' } }, props.items.map((item) =>
    el('li', { class: 'shuttle-notice-item', dataset: { testid: 'notice-item' } }, noticeItemParts(item)),
  ));
}

/** 원문 앞의 목록 기호(`-`·`*`·`•`)를 걷는다 — 화면 목록 점과 두 번 찍히지 않게(UI v3). 내용은 바꾸지 않는다. */
export function stripListMarker(text: string): string {
  return text.replace(/^[\s*\-–—•·]+/, '').trim();
}

/** `10. 9.(금)` → `10.9(금)` — 원문 날짜 표기의 공백·군더더기 점만 정리한다(값은 그대로). */
export function tidyDateText(text: string): string {
  return text.replace(/\.\s+/g, '.').replace(/\.\(/g, '(').replace(/\s*~\s*/g, '~').trim();
}

/** ISO 기간 `2026-09-24 ~ 2026-09-26` → `9.24~9.26` (원문에 날짜 표기가 없을 때만 쓴다) */
export function shortIsoRange(range: string): string {
  return range.replace(/\d{4}-0?(\d{1,2})-0?(\d{1,2})/g, '$1.$2').replace(/\s*~\s*/g, '~');
}

const QUOTE_RE = /^(.+?)\s*\[([^\]]+)\]\s*[:：]\s*(.+)$/;

/**
 * 안내 한 줄 — 원문 `*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음` 을
 * **날짜 · 이름 · 효과** 세 조각으로 보여 준다(같은 날짜를 ISO 와 원문으로 두 번 쓰지 않는다).
 * 형식이 다르면 기존처럼 날짜(있으면) + 원문 한 줄.
 */
function noticeItemParts(item: NoticeItemView): (HTMLElement | string)[] {
  const text = stripListMarker(item.text);
  const match = QUOTE_RE.exec(text);
  if (match !== null) {
    const [, name, dates, effect] = match;
    return [
      el('span', { class: 'shuttle-notice-item__date', text: tidyDateText(dates ?? '') }),
      el('span', { class: 'shuttle-notice-item__name', text: (name ?? '').trim() }),
      el('span', { class: 'shuttle-notice-item__effect', text: (effect ?? '').trim() }),
    ];
  }
  return [
    item.dateRange === null ? null : el('span', { class: 'shuttle-notice-item__date', text: shortIsoRange(item.dateRange) }),
    el('span', { class: 'shuttle-notice-item__text', text }),
  ].filter((part): part is HTMLElement => part !== null);
}
