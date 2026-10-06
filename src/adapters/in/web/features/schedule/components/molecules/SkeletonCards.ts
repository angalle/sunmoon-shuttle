/**
 * 분자: 로딩 스켈레톤 카드 (features/schedule/components/molecules) — T24.
 *
 * 계약(`docs/07-mobile-ux.md` §5): "로딩 = **스켈레톤 카드 3장**(빈 화면·텍스트만 금지)".
 * - 데이터를 기다리는 동안 화면이 **비어 보이지 않게** 카드 골격을 그린다(장식 = aria-hidden).
 * - 상태는 문구로 알린다: 화면 낭독기용 한 줄(`shuttle-sr-only`) + `role="status"`.
 * - `data-testid="loading"` 은 기존 스모크 계약(로딩 완료 판정)이라 그대로 유지한다.
 */
import { el } from '../../../../shared/lib/dom';
import { UI_TEXT } from '../../types/texts';

export interface SkeletonCardsProps {
  /** 카드 장수(기본 3 — docs/07 §5) */
  readonly count?: number;
}

export function skeletonCards(props: SkeletonCardsProps = {}): HTMLElement {
  const count = props.count ?? 3;
  const cards: HTMLElement[] = [];
  for (let index = 0; index < count; index += 1) cards.push(skeletonCard());
  return el(
    'div',
    {
      class: 'shuttle-skeleton',
      attrs: { role: 'status', 'aria-live': 'polite' },
      dataset: { testid: 'loading' },
    },
    [el('p', { class: 'shuttle-sr-only', text: UI_TEXT.skeletonLabel }), ...cards],
  );
}

/** 카드 1장 — 제목 줄 + 본문 줄 2개(값이 들어올 자리). 구조만 있고 텍스트는 없다(장식). */
function skeletonCard(): HTMLElement {
  return el('div', { class: 'shuttle-skeleton__card', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { class: 'shuttle-skeleton__bar shuttle-skeleton__bar--title' }),
    el('span', { class: 'shuttle-skeleton__bar' }),
    el('span', { class: 'shuttle-skeleton__bar shuttle-skeleton__bar--short' }),
  ]);
}
