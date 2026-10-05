/**
 * 원자: 배지 (shared/ui/atoms)
 * 단일 책임 시각 요소 — props 로만 제어하고 도메인 상태·store·api 를 모른다(스킬 §2·§3).
 * 색만으로 정보를 전달하지 않기 위해 **문구를 항상 함께** 받는다(대비 4.5:1 토큰 사용).
 */
import { el } from '../../lib/dom';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

export interface BadgeProps {
  readonly text: string;
  readonly tone?: BadgeTone;
  readonly title?: string;
}

export function badge(props: BadgeProps): HTMLSpanElement {
  const tone = props.tone ?? 'neutral';
  const node = el('span', {
    class: tone === 'neutral' ? 'shuttle-badge' : `shuttle-badge shuttle-badge--${tone}`,
    text: props.text,
  });
  if (props.title !== undefined) node.setAttribute('title', props.title);
  return node;
}
