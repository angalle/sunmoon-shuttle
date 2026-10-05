/**
 * 분자: 방향 필터 칩 (features/schedule/components/molecules) — V1 §4.
 *
 * `전체`(기본) · `학교에서 출발` · `학교로 도착` — 누르면 즉시 반영(페이지가 재렌더).
 * 상태는 페이지 지역 상태이고, 여기서는 props/emit 계약만 지킨다(도메인 계산 없음).
 * 접근성: `role="group"` + `aria-pressed`(선택 상태를 색이 아니라 속성으로도 전달).
 */
import { el } from '../../../../shared/lib/dom';
import type { DirectionFilter } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DirectionFilterProps {
  readonly value: DirectionFilter;
  /** 필터별 편수 — 칩 옆에 숫자로 붙인다(색만으로 구분하지 않게) */
  readonly counts: Readonly<Record<DirectionFilter, number>>;
  readonly onSelect: (value: DirectionFilter) => void;
}

const ORDER: readonly DirectionFilter[] = ['all', 'out', 'in'];

function labelOf(value: DirectionFilter): string {
  if (value === 'out') return UI_TEXT.boardDirectionOut;
  if (value === 'in') return UI_TEXT.boardDirectionIn;
  return UI_TEXT.boardDirectionAll;
}

export function directionFilter(props: DirectionFilterProps): HTMLElement {
  const group = el('div', {
    class: 'shuttle-chips',
    attrs: { role: 'group', 'aria-label': UI_TEXT.boardDirectionLegend },
    dataset: { testid: 'direction-filter' },
  });

  for (const value of ORDER) {
    const selected = value === props.value;
    group.appendChild(
      el(
        'button',
        {
          class: 'shuttle-chip',
          attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
          dataset: { testid: 'direction-chip', direction: value },
          on: {
            click: () => {
              props.onSelect(value);
            },
          },
        },
        [
          el('span', { text: `${labelOf(value)} ` }),
          el('span', { class: 'shuttle-chip__count', text: `${String(props.counts[value])}${UI_TEXT.boardListCountSuffix}` }),
        ],
      ),
    );
  }

  return group;
}
