/**
 * 분자: 노선 목록 (features/schedule/components/molecules)
 * 노선 목록은 **데이터에서 온다**(하드코딩 금지). 운행 중단(F2b)·해당 요일 표 없음(offDays)을
 * 목록에서 조용히 숨기지 않고 배지로 표시한다.
 */
import { el } from '../../../../shared/lib/dom';
import { badge } from '../../../../shared/ui/atoms/Badge';
import { dayTypeLabel } from '../../../../../../../domain/rules/dayType';
import type { DayType } from '../../../../../../../domain/entities/DayType';
import type { RouteView } from '../../types/model';
import { UI_TEXT } from '../../types/texts';

export interface RouteListProps {
  readonly routes: readonly RouteView[];
  readonly selectedRouteId: string | null;
  readonly dayType: DayType;
  readonly onSelect: (routeId: string) => void;
}

export function routeList(props: RouteListProps): HTMLElement {
  const list = el('ul', {
    class: 'shuttle-routelist',
    attrs: { 'aria-label': UI_TEXT.routeLegend },
    dataset: { testid: 'route-list' },
  });

  for (const route of props.routes) {
    const selected = route.id === props.selectedRouteId;
    const hasTable = route.byDay[props.dayType] !== null;
    const markers: (HTMLElement | null)[] = [];
    if (route.status === 'suspended') {
      markers.push(badge({ text: UI_TEXT.routeStatusSuspended, tone: 'warn', title: route.suspendedReason ?? '' }));
    } else if (!hasTable) {
      markers.push(badge({ text: UI_TEXT.routeOffDay, tone: 'neutral' }));
    }

    const button = el(
      'button',
      {
        class: 'shuttle-routelist__button',
        attrs: {
          type: 'button',
          'aria-current': selected ? 'true' : 'false',
        },
        dataset: { testid: 'route-button', routeId: route.id },
        on: {
          click: () => {
            props.onSelect(route.id);
          },
        },
      },
      [
        el('span', { text: route.name }),
        markers.length === 0 ? null : el('span', { class: 'shuttle-routelist__badges' }, markers),
        el('span', {
          class: 'shuttle-routelist__meta',
          text: route.path === '' ? dayTypeLabel(props.dayType) : route.path,
        }),
      ],
    );

    list.appendChild(el('li', {}, [button]));
  }

  return list;
}
