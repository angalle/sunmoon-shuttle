/**
 * 유기체: 안내 패널 (features/schedule/components/organisms)
 * F7 — 운행 없는 날 · 대체 시간표 · 이용 안내 · 시내버스 참고(원본 문구 그대로).
 */
import { el } from '../../../../shared/lib/dom';
import type { BusRef } from '../../types/contract';
import type { NoticeGroupsView, StopWindowLineView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';
import { noticeList } from '../molecules/NoticeList';

export interface NoticePanelProps {
  readonly groups: NoticeGroupsView;
  readonly busRefs: readonly BusRef[];
  /** T17 ④ — 정차 시간창(`routes[].stopWindows[]`) 접힘 1개. 없으면 섹션을 그리지 않는다. */
  readonly stopWindows: readonly StopWindowLineView[];
  readonly headingId: string;
}

export function noticePanel(props: NoticePanelProps): HTMLElement {
  const sections: (HTMLElement | null)[] = [
    // T14 — 섹션 제목에서 `(원본 안내)` 표현을 뺐다(문구는 texts.ts 단일 출처).
    subSection(UI_TEXT.noticeNoServiceTitle, props.groups.noService),
    subSection(UI_TEXT.noticeAlternateTitle, props.groups.alternate),
    subSection(UI_TEXT.noticeTitle, props.groups.notices),
    stopWindowSection(props.stopWindows),
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

/**
 * T17 ④ — 정차 시간창(`routes[].stopWindows[]`)을 **접힘 1개**에 정리해 노출한다.
 * 홈 본문(첫 화면)에는 넣지 않는다 — 이 패널 자체가 요일 탭 아래 보조 영역이고, 안은 `<details>` 다.
 * 줄이 없으면 섹션을 만들지 않는다(빈 접힘 금지).
 */
function stopWindowSection(lines: readonly StopWindowLineView[]): HTMLElement | null {
  if (lines.length === 0) return null;
  return el('details', { class: 'shuttle-details', dataset: { testid: 'stop-window-details' } }, [
    el('summary', { text: UI_TEXT.stopWindowTitle }),
    el(
      'ul',
      { class: 'shuttle-list', dataset: { testid: 'stop-window-list' } },
      lines.map((line) => el('li', { text: line.text })),
    ),
  ]);
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
