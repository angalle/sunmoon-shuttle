/**
 * 원자: 버튼 (shared/ui/atoms) — 재시도 등 단순 동작. 도메인 지식 없음.
 */
import { el, type DomChild } from '../../lib/dom';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps {
  readonly label: string;
  readonly variant?: ButtonVariant;
  /** 텍스트가 아닌 이름이 필요할 때(아이콘 버튼)만 쓴다. */
  readonly ariaLabel?: string;
  /** 스모크·검증에서 요소를 찾기 위한 표식(data-testid). */
  readonly testid?: string;
  /** 진행 중 표시(예: 새로고침 스피너) — 스크린리더에 `aria-busy` 로도 알린다. */
  readonly busy?: boolean;
  /** 라벨 앞에 붙는 장식 요소(스피너 등). 문구가 항상 있으므로 장식은 aria-hidden 이다. */
  readonly leading?: DomChild;
  readonly onClick: () => void;
}

export function button(props: ButtonProps): HTMLButtonElement {
  const variant = props.variant ?? 'secondary';
  return el(
    'button',
    {
      class: `shuttle-button shuttle-button--${variant}`,
      attrs: {
        type: 'button',
        ...(props.ariaLabel === undefined ? {} : { 'aria-label': props.ariaLabel }),
        ...(props.busy === undefined ? {} : { 'aria-busy': props.busy ? 'true' : 'false' }),
      },
      ...(props.testid === undefined ? {} : { dataset: { testid: props.testid } }),
      on: {
        click: () => {
          props.onClick();
        },
      },
    },
    [props.leading ?? null, props.label],
  );
}
