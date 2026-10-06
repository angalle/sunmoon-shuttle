/**
 * 원자: 진행 표시(스피너) (shared/ui/atoms) — 단일 책임 시각 요소.
 *
 * 장식이므로 `aria-hidden` 이다 — "무엇을 기다리는지"는 항상 **문구**(호출부)가 말한다
 * (색·애니메이션만으로 상태를 전달하지 않는다).
 * 도메인 지식·store·api 를 모른다(스킬 §2·§3).
 */
import { el } from '../../lib/dom';

export interface SpinnerProps {
  /** 원형 크기 변형 — `sm`(앱바 버튼 안) | `md`(스플래시) */
  readonly size?: 'sm' | 'md';
}

export function spinner(props: SpinnerProps = {}): HTMLSpanElement {
  const size = props.size ?? 'md';
  return el('span', {
    class: size === 'sm' ? 'shuttle-spinner shuttle-spinner--sm' : 'shuttle-spinner',
    attrs: { 'aria-hidden': 'true' },
  });
}
