/**
 * 유기체: 안내 패널 (features/schedule/components/organisms)
 * F7 — 운행 없는 날 · 대체 시간표 · 이용 안내 · 시내버스 참고(원본 문구 그대로).
 */
import { el } from '../../../../shared/lib/dom';
import type { BusRef } from '../../types/contract';
import type { NoticeGroupsView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';
import { noticeList } from '../molecules/NoticeList';

export interface NoticePanelProps {
  readonly groups: NoticeGroupsView;
  readonly busRefs: readonly BusRef[];
  readonly headingId: string;
}

export function noticePanel(props: NoticePanelProps): HTMLElement {
  const sections: (HTMLElement | null)[] = [
    subSection('운행 없는 날(원본 안내)', props.groups.noService),
    subSection('대체 시간표(원본 안내)', props.groups.alternate),
    subSection(UI_TEXT.noticeTitle, props.groups.notices),
    busRefSection(props.busRefs),
  ];

  return el(
    'section',
    { class: 'shuttle-card', attrs: { 'aria-labelledby': props.headingId }, dataset: { testid: 'notice-panel' } },
    [el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.suspectTitle }), ...sections],
  );
}

function subSection(title: string, items: NoticeGroupsView['noService']): HTMLElement | null {
  if (items.length === 0) return null;
  return el('div', {}, [el('h3', { class: 'shuttle-card__title', text: title }), noticeList({ items })]);
}

function busRefSection(busRefs: readonly BusRef[]): HTMLElement | null {
  if (busRefs.length === 0) return null;
  const columns = UI_TEXT.busRefColumns;
  const table = el('table', { class: 'shuttle-table', dataset: { testid: 'busref-table' } }, [
    el('caption', { text: `${UI_TEXT.busRefTitle} (회차 ${String(busRefs.length)}개)` }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { attrs: { scope: 'col' }, text: columns.line }),
        el('th', { attrs: { scope: 'col' }, text: columns.stop }),
        el('th', { attrs: { scope: 'col' }, text: columns.to }),
      ]),
    ]),
    el(
      'tbody',
      {},
      busRefs.map((busRef) =>
        el('tr', {}, [
          el('td', { text: busRef.line }),
          el('td', { text: busRef.stop }),
          el('td', { text: busRef.to }),
        ]),
      ),
    ),
  ]);
  return el('details', { class: 'shuttle-details' }, [
    el('summary', { text: UI_TEXT.busRefTitle }),
    el('div', { class: 'shuttle-table-scroll' }, [table]),
  ]);
}
