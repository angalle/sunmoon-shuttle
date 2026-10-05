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
    el('li', { dataset: { testid: 'notice-item' } }, [
      item.dateRange === null ? null : el('strong', { text: `[${item.dateRange}] ` }),
      item.text,
    ]),
  ));
}
