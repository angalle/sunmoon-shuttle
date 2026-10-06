/**
 * 원자: 요일 탭 버튼 (shared/ui/atoms)
 * WAI-ARIA `tab` 패턴의 **세그먼트 한 칸**(docs/07 §12-2 — 등폭 3분할 컨트롤의 일부).
 * 키보드 이동(←/→/Home/End)은 **분자(DayTabs)** 가 처리하고, 여기서는 표현과 이벤트 위임만 한다(props/emit 계약).
 *
 * 표현 계약(§12-2 · T30)
 *  - 라벨은 **문자열 하나**(`평일`·`토요일`·`일요일`). 부가 텍스트(`(오늘)`, `노선 N/M개`)를 붙이지 않는다.
 *  - 오늘 표시는 **작은 점 1개**만: `todayDotLabel` 이 있으면 라벨 오른쪽에 점을 그린다(화면 텍스트 아님).
 *    점은 `role="img"` + `aria-label` 로 낭독기에만 이름을 준다 — 탭의 접근 이름(라벨)은 바뀌지 않는다.
 *  - 등폭·높이·선택 상태(배경 톤·굵기·하단 라인)는 CSS 가 맡는다(개별 알약 금지 — 컨트롤은 분자가 만든다).
 */
import { el } from '../../lib/dom';

export interface TabButtonProps {
  readonly id: string;
  /** 연결된 패널 id (`aria-controls`) */
  readonly controls: string;
  readonly label: string;
  /**
   * 오늘 요일 표시 — 값이 있으면 라벨 오른쪽에 **점 하나**를 그린다(§12-2).
   * 값 자체는 화면 텍스트가 아니라 점의 낭독기 이름이다(`aria-label`).
   */
  readonly todayDotLabel?: string | undefined;
  readonly selected: boolean;
  /** roving tabindex — 선택된 탭만 0 */
  readonly tabIndex: number;
  readonly onSelect: () => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
}

export function tabButton(props: TabButtonProps): HTMLButtonElement {
  const todayDot =
    props.todayDotLabel === undefined
      ? null
      : el('span', {
          class: 'shuttle-tab__today',
          attrs: { role: 'img', 'aria-label': props.todayDotLabel },
          dataset: { testid: 'today-dot' },
        });

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
    [el('span', { class: 'shuttle-tab__label', text: props.label }), todayDot],
  );
  if (props.onKeyDown !== undefined) node.addEventListener('keydown', props.onKeyDown);
  return node;
}
