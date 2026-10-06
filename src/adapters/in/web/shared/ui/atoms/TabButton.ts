/**
 * 원자: 요일 탭 버튼 (shared/ui/atoms)
 * WAI-ARIA `tab` 패턴의 버튼 하나. 키보드 이동(←/→/Home/End)은 **분자(DayTabs)** 가 처리하고,
 * 여기서는 표현과 이벤트 위임만 한다(props/emit 계약).
 */
import { el } from '../../lib/dom';

export interface TabButtonProps {
  readonly id: string;
  /** 연결된 패널 id (`aria-controls`) */
  readonly controls: string;
  readonly label: string;
  /** 탭 아래 보조 문구(예: "노선 3개") */
  readonly note?: string;
  readonly selected: boolean;
  /** roving tabindex — 선택된 탭만 0 */
  readonly tabIndex: number;
  readonly onSelect: () => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
}

export function tabButton(props: TabButtonProps): HTMLButtonElement {
  const node = el(
    'button',
    {
      class: 'shuttle-tab',
      attrs: {
        type: 'button',
        role: 'tab',
        id: props.id,
        'aria-controls': props.controls,
        'aria-selected': props.selected ? 'true' : 'false',
        tabindex: String(props.tabIndex),
      },
      on: {
        click: () => {
          props.onSelect();
        },
      },
    },
    [props.label, props.note === undefined ? null : el('span', { class: 'shuttle-tab__note', text: props.note })],
  );
  if (props.onKeyDown !== undefined) node.addEventListener('keydown', props.onKeyDown);
  return node;
}
