/**
 * 분자: 하단 안내(토스트) (features/schedule/components/molecules) — T29 · docs/07 §11-2.
 *
 * 쓰임: `현재 시간으로` 버튼이 **그냥 스크롤하면 안 되는 상황**(오늘이 아닌 요일 등)일 때 띄우는 한 줄 안내.
 * 문구·액션 유무는 선택자(`moveNowHint`)가 정하고, 여기서는 **표현만** 한다(배치·문구·액션·닫힘).
 *
 * 규격(문서 그대로):
 *  - 하단, **이동 버튼 스택 위쪽**(버튼을 가리지 않는다 — 배치는 CSS 토큰이 맡는다)
 *  - 문구는 **1줄**(넘치면 말줄임 — 줄바꿈으로 높이를 늘리지 않는다)
 *  - `role="status"` + `aria-live="polite"` (화면 낭독기가 부드럽게 읽는다)
 *  - **탭하면 즉시 닫힘**(자동 3초 소멸은 페이지 타이머가 관리한다 — 표현은 닫힘 콜백만 부른다)
 *  - 액션(`오늘 보기`)은 실제 `<button>` 이고 터치 타깃 48px 이상(토큰)
 *
 * 승격하지 않는다: 지금 쓰는 기능이 `schedule` 하나뿐이라 기능 안에 둔다(스킬 §3 "승격 2회 규칙").
 */
import { el } from '../../../../shared/lib/dom';

export interface ToastProps {
  /** 화면에 그대로 쓰는 한 줄 */
  readonly message: string;
  /** 액션 라벨(`오늘 보기`) — null 이면 액션 없이 안내만 */
  readonly actionLabel: string | null;
  readonly onAction: () => void;
  /** 탭(또는 액션)으로 닫을 때 — 자동 소멸 타이머 정리도 페이지가 한다 */
  readonly onDismiss: () => void;
}

export function toast(props: ToastProps): HTMLElement {
  const action =
    props.actionLabel === null
      ? null
      : el('button', {
          class: 'shuttle-toast__action',
          attrs: { type: 'button' },
          dataset: { testid: 'toast-action' },
          text: props.actionLabel,
          on: {
            click: (event: Event) => {
              // 액션 클릭은 컨테이너의 "탭하면 닫힘"과 겹치지 않게 여기서 끝낸다(액션 → 닫힘 순서를 명시).
              event.stopPropagation();
              props.onAction();
              props.onDismiss();
            },
          },
        });

  return el(
    'div',
    {
      class: 'shuttle-toast',
      // `role="status"` + `aria-live="polite"` 만 둔다 — `aria-label` 을 붙이면 접근성 이름이 그 라벨로
      // 바뀌어 **문구가 읽히지 않는다**. 닫기는 탭(터치) 또는 Escape(키보드, 페이지가 처리) / 자동 3초 소멸.
      attrs: { role: 'status', 'aria-live': 'polite' },
      dataset: { testid: 'toast', kind: props.actionLabel === null ? 'info' : 'action' },
      on: {
        click: () => {
          props.onDismiss();
        },
      },
    },
    [
      el('span', { class: 'shuttle-toast__text', dataset: { testid: 'toast-text' }, text: props.message }),
      action,
    ],
  );
}
