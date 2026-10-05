/**
 * 분자: 이어서 오는 버스 목록 (features/schedule/components/molecules)
 * 값은 도메인 `nextDepartures` 반환을 그대로 받는다(화면에서 계산하지 않는다).
 */
import { el } from '../../../../shared/lib/dom';
import type { DepartureRowView } from '../../store/selectors';

export interface NextBusListProps {
  readonly title: string;
  readonly departures: readonly DepartureRowView[];
}

export function nextBusList(props: NextBusListProps): HTMLUListElement {
  const list = el('ul', {
    class: 'shuttle-nextbus__list',
    attrs: { 'aria-label': props.title },
    dataset: { testid: 'next-bus-list' },
  });

  for (const departure of props.departures) {
    list.appendChild(
      el('li', { class: 'shuttle-nextbus__item', dataset: { testid: 'next-bus-row' } }, [
        el('span', {
          class: 'shuttle-nextbus__time',
          text: `${departure.dayLabel} ${departure.departure}`,
        }),
        el('span', { class: 'shuttle-nextbus__remaining', text: departure.remaining }),
        departure.annotations.length === 0
          ? null
          : el('span', {
              class: 'shuttle-nextbus__annotations',
              text: `특이사항: ${departure.annotations.join(' · ')}`,
            }),
      ]),
    );
  }

  return list;
}
