/**
 * 분자: 정류장 칩 줄(시안 A · 2026-11-08 사용자 결정) — 천안역 · 아산(KTX)역 · 천안터미널 · 온양역/터미널.
 *
 * - **항상 1개 선택**(`전체` 없음 — 사용자 결정). 같은 칩을 다시 눌러도 그대로다.
 * - 그 요일에 편이 없는 정류장은 흐리게(`shuttle-chip--empty`) — 숨기지 않는다(눌러서 이유를 볼 수 있다).
 * - 칩이 화면보다 넓으면 **그 줄 안에서만** 가로로 넘긴다(페이지 가로 스크롤 0).
 */
import { el } from '../../../../shared/lib/dom';
import type { StopOptionView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface StopFilterProps {
  readonly options: readonly StopOptionView[];
  readonly value: string | null;
  readonly onSelect: (stopId: string) => void;
}

export function stopFilter(props: StopFilterProps): HTMLElement {
  return el(
    'div',
    {
      class: 'shuttle-chips shuttle-chips--scroll',
      attrs: { role: 'group', 'aria-label': UI_TEXT.stopFilterLegend },
      dataset: { testid: 'stop-filter' },
    },
    props.options.map((option) => {
      const selected = option.id === props.value;
      const classes = ['shuttle-chip'];
      if (option.count === 0) classes.push('shuttle-chip--empty');
      return el(
        'button',
        {
          class: classes.join(' '),
          attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
          dataset: { testid: 'stop-chip', stop: option.id, count: String(option.count) },
          on: {
            click: () => {
              props.onSelect(option.id);
            },
          },
        },
        [el('span', { class: 'shuttle-chip__label', text: option.name })],
      );
    }),
  );
}
