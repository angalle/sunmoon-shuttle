/**
 * 원자: 버튼 (shared/ui/atoms) — 재시도 등 단순 동작. 도메인 지식 없음.
 */
import { el } from '../../lib/dom';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps {
  readonly label: string;
  readonly variant?: ButtonVariant;
  /** 텍스트가 아닌 이름이 필요할 때(아이콘 버튼)만 쓴다. */
  readonly ariaLabel?: string;
  /** 스모크·검증에서 요소를 찾기 위한 표식(data-testid). */
  readonly testid?: string;
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
      },
      ...(props.testid === undefined ? {} : { dataset: { testid: props.testid } }),
      on: {
        click: () => {
          props.onClick();
        },
      },
    },
    [props.label],
  );
}
