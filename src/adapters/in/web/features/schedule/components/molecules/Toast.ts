/**
 * 분자: 하단 안내(토스트) (features/schedule/components/molecules) — T29 §11-2 · T37 §15-2.
 *
 * 쓰임: `현재 시간으로` 를 눌렀을 때의 **짧은 한 줄 안내**.
 *  · 오늘이 아닌 요일 → 이동 안내 `UI_TEXT.moveNowTodayNotice`(1.5초 · **액션 버튼 없음** — §15-2)
 *  · 오늘이고 남은 편이 없음 → `오늘 남은 편이 없습니다 · 다음 운행: …`(정보 1줄)
 * 문구는 선택자(`moveNowHint`)가 정하고, 여기서는 **표현만** 한다(배치·문구·닫힘).
 * T37 §15-2 로 **되묻는 UI(`오늘 보기` 확인형)를 없앴다** — 그래서 액션 버튼을 그리지 않는다
 * (액션 파라미터도 두지 않는다: 쓰지 않는 분기를 남기지 않는다).
 *
 * 규격(문서 그대로):
 *  - 하단, **이동 버튼 스택 위쪽**(버튼을 가리지 않는다 — 배치는 CSS 토큰이 맡는다)
 *  - 문구는 **1줄**(넘치면 말줄임 — 줄바꿈으로 높이를 늘리지 않는다)
 *  - `role="status"` + `aria-live="polite"` (화면 낭독기가 부드럽게 읽는다)
 *  - **탭하면 즉시 닫힘**(자동 소멸 타이머는 페이지가 관리한다 — 표현은 닫힘 콜백만 부른다)
 *
 * 승격하지 않는다: 지금 쓰는 기능이 `schedule` 하나뿐이라 기능 안에 둔다(스킬 §3 "승격 2회 규칙").
 */
import { el } from '../../../../shared/lib/dom';

export interface ToastProps {
  /** 화면에 그대로 쓰는 한 줄 */
  readonly message: string;
  /** 탭(또는 Escape)으로 닫을 때 — 자동 소멸 타이머 정리도 페이지가 한다 */
  readonly onDismiss: () => void;
}

export function toast(props: ToastProps): HTMLElement {
  return el(
    'div',
    {
      class: 'shuttle-toast',
      // `role="status"` + `aria-live="polite"` 만 둔다 — `aria-label` 을 붙이면 접근성 이름이 그 라벨로
      // 바뀌어 **문구가 읽히지 않는다**. 닫기는 탭(터치) 또는 Escape(키보드, 페이지가 처리) / 자동 소멸.
      attrs: { role: 'status', 'aria-live': 'polite' },
      dataset: { testid: 'toast', kind: 'info' },
      on: {
        click: () => {
          props.onDismiss();
        },
      },
    },
    [el('span', { class: 'shuttle-toast__text', dataset: { testid: 'toast-text' }, text: props.message })],
  );
}
