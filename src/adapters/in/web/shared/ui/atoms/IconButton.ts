/**
 * 원자: 아이콘 버튼 (shared/ui/atoms) — 아이콘만 보이는 버튼. 도메인 지식 없음(스킬 §2).
 *
 * 화면에 문구를 길게 쓰지 않는 자리(T28 우하단 이동 버튼 등)에 쓴다:
 *  - 접근성 이름은 `aria-label` 이 갖고, 아이콘은 **장식**(`aria-hidden`)이다.
 *  - 크기는 토큰(`--floating-button-size` = 터치 타깃 ≥48px)만 쓴다 — 컴포넌트에 즉석 값 금지(스킬 §6).
 *  - `<button>` 이므로 키보드 포커스가 기본으로 되고, 포커스 링은 전역 `:focus-visible` 규칙을 따른다.
 */
import { el, type DomChild } from '../../lib/dom';

export interface IconButtonProps {
  /** 접근성 이름(`aria-label`) — 화면에 보이지 않는다. 예: `맨 위로` · `현재 시간으로` */
  readonly label: string;
  /** 아이콘(장식). 보통 `svgIcon(...)` 결과를 넣는다. */
  readonly icon: DomChild;
  /** 스모크·검증에서 요소를 찾기 위한 표식(data-testid). */
  readonly testid?: string;
  readonly onClick: () => void;
}

export function iconButton(props: IconButtonProps): HTMLButtonElement {
  return el(
    'button',
    {
      class: 'shuttle-icon-button',
      attrs: { type: 'button', 'aria-label': props.label },
      ...(props.testid === undefined ? {} : { dataset: { testid: props.testid } }),
      on: {
        click: () => {
          props.onClick();
        },
      },
    },
    [props.icon],
  );
}
