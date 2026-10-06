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
  /**
   * 시각 변형 — `day`(요일 탭, 기본) | `app`(앱 셸 하단 탭바, T24).
   * 표현만 바꾼다(props 계약은 동일) — 클래스만 다르고 역할·이벤트는 같다.
   */
  readonly variant?: 'day' | 'app';
  readonly onSelect: () => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
}

export function tabButton(props: TabButtonProps): HTMLButtonElement {
  const variant = props.variant ?? 'day';
  const node = el(
    'button',
    {
      class: variant === 'app' ? 'shuttle-tab shuttle-tab--app' : 'shuttle-tab',
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
