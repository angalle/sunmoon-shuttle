/**
 * 원자: 버튼 (shared/ui/atoms) — 재시도 등 단순 동작. 도메인 지식 없음.
 */
import { el } from '../../lib/dom';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly onClick: () => void;
}

export function button(props: ButtonProps): HTMLButtonElement {
  const variant = props.variant ?? 'secondary';
  return el(
    'button',
    {
      class: `shuttle-button shuttle-button--${variant}`,
      attrs: { type: 'button' },
      on: {
        click: () => {
          props.onClick();
        },
      },
    },
    [props.label],
  );
}
