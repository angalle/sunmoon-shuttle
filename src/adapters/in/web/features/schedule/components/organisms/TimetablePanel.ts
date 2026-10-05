/**
 * 유기체: 시간표 패널 (features/schedule/components/organisms)
 * 노선 표시 + 상태(운행 중단 F2b / 이 요일 표 없음) + 원문 열 구성 표(F2 가변 열).
 * 표가 없을 때도 **빈 화면이 아니라 이유**를 보여준다.
 */
import { el } from '../../../../shared/lib/dom';
import { badge } from '../../../../shared/ui/atoms/Badge';
import { dayTypeLabel } from '../../../../../../../domain/rules/dayType';
import type { DayType } from '../../../../../../../domain/entities/DayType';
import type { DayTableView, RouteView } from '../../types/model';
import { UI_TEXT } from '../../types/texts';
import { timetableTable } from '../molecules/TimetableTable';

export interface TimetablePanelProps {
  readonly route: RouteView | null;
  readonly dayType: DayType;
  readonly table: DayTableView | null;
  readonly headingId: string;
}

export function timetablePanel(props: TimetablePanelProps): HTMLElement {
  const dayLabel = dayTypeLabel(props.dayType);
  const heading = el('h2', {
    class: 'shuttle-card__title',
    attrs: { id: props.headingId },
    text: props.route === null ? UI_TEXT.loading : `${props.route.name} · ${dayLabel} 시간표`,
  });

  if (props.route === null) {
    return el('section', { class: 'shuttle-card', attrs: { 'aria-labelledby': props.headingId }, dataset: { testid: 'timetable-panel' } }, [heading]);
  }

  const route = props.route;
  const meta: (HTMLElement | null)[] = [
    el('p', { class: 'shuttle-header__subtitle', text: route.path === '' ? dayLabel : route.path }),
  ];
  if (route.status === 'suspended') {
    meta.push(badge({ text: UI_TEXT.routeStatusSuspended, tone: 'warn', title: route.suspendedReason ?? '' }));
  }
  if (route.offDays.includes(props.dayType)) {
    meta.push(badge({ text: UI_TEXT.routeOffDay, tone: 'neutral' }));
  }

  let body: HTMLElement;
  if (props.table === null) {
    // 운행 중단이면 원본 문구를, 아니면 "원본에 이 요일 표가 없다"를 명시한다.
    body =
      route.status === 'suspended'
        ? el('p', { class: 'shuttle-card__reason', dataset: { testid: 'suspended-reason' } }, [
            el('strong', { text: '원본 안내: ' }),
            route.suspendedReason ?? UI_TEXT.routeStatusSuspended,
          ])
        : el('p', { class: 'shuttle-banner shuttle-banner--info', dataset: { testid: 'no-table' }, text: `${route.name} 노선은 원본에 ${dayLabel} 표가 없습니다.` });
  } else {
    body = el('div', { class: 'shuttle-table-scroll' }, [
      timetableTable({
        caption: `${UI_TEXT.tableCaptionPrefix} · ${route.name} ${dayLabel} (회차 ${String(props.table.rows.length)}개)`,
        columns: props.table.columns,
        keys: props.table.keys,
        rows: props.table.rows,
      }),
    ]);
  }

  return el(
    'section',
    {
      class: 'shuttle-card',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'timetable-panel', routeId: route.id, dayType: props.dayType },
    },
    [heading, ...meta, body],
  );
}
