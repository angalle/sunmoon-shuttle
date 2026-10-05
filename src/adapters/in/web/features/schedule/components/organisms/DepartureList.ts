/**
 * 유기체: 오늘 남은 출발 목록 (features/schedule/components/organisms) — V1 §5·§8.
 *
 * 노선을 통합해 다음 10~15편을 보여주고, 넘치는 편은 `<details>`("더 보기")로 접는다.
 * 지난 시각은 도메인(`nextDepartures`)이 이미 제외했으므로 여기서 다시 거르지 않는다.
 * 오늘 남은 편이 없으면(운행 종료) 머리에 "오늘 운행이 끝났습니다 · 다음 운행 …"을 붙이고
 * 목록은 다음 운행일(`내일`/`모레`) 편을 보여준다 — 카드와 같은 규칙(dayLabel).
 */
import { el } from '../../../../shared/lib/dom';
import { badge } from '../../../../shared/ui/atoms/Badge';
import type { DepartureEventView, TodayBoardView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DepartureListProps {
  readonly view: TodayBoardView;
  readonly headingId: string;
}

export function departureList(props: DepartureListProps): HTMLElement {
  const { view } = props;
  const total = `${UI_TEXT.boardListTotalPrefix} ${String(view.todayTotal)}${UI_TEXT.boardListCountSuffix}`;
  const remaining = `${UI_TEXT.boardListRemainingPrefix} ${String(view.counts.all)}${UI_TEXT.boardListCountSuffix}`;
  const next: DepartureEventView | undefined = view.next.at(0);
  const empty = view.list.length === 0 && view.rest.length === 0;

  return el(
    'section',
    {
      class: 'shuttle-card',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'departure-list-card', status: view.status },
    },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId } }, [
        el('span', { text: UI_TEXT.boardListTitle }),
        el('span', { class: 'shuttle-board__counts', dataset: { testid: 'board-counts' }, text: ` (${total} · ${remaining})` }),
      ]),
      view.nextIsToday || next === undefined
        ? null
        : el('p', {
            class: 'shuttle-banner shuttle-banner--info',
            dataset: { testid: 'board-today-over' },
            text: `${UI_TEXT.boardTodayOverTitle} · ${UI_TEXT.boardNextServicePrefix}: ${next.dayLabel} ${next.departure}`,
          }),
      empty
        ? el('p', { class: 'shuttle-board__empty', dataset: { testid: 'departure-empty' }, text: UI_TEXT.boardListEmpty })
        : el(
            'ul',
            { class: 'shuttle-departures', attrs: { 'aria-label': UI_TEXT.boardListTitle }, dataset: { testid: 'departure-list' } },
            view.list.map((event) => departureRow(event)),
          ),
      view.rest.length === 0
        ? null
        : el('details', { class: 'shuttle-details', dataset: { testid: 'departure-more' } }, [
            el('summary', {
              text: `${UI_TEXT.boardListMorePrefix} (${String(view.rest.length)}${UI_TEXT.boardListCountSuffix})`,
            }),
            el(
              'ul',
              { class: 'shuttle-departures', attrs: { 'aria-label': UI_TEXT.boardListMorePrefix }, dataset: { testid: 'departure-rest' } },
              view.rest.map((event) => departureRow(event)),
            ),
          ]),
    ],
  );
}

function departureRow(event: DepartureEventView): HTMLElement {
  const detail =
    event.arrival === null
      ? event.directionLabel
      : `${event.directionLabel} · ${event.arrival} ${UI_TEXT.boardArrivalSuffix}`;
  return el('li', { class: 'shuttle-departure', dataset: { testid: 'departure-row', direction: event.direction, dayOffset: String(event.dayOffset) } }, [
    el('span', { class: 'shuttle-departure__time', text: event.departure }),
    el('span', { class: 'shuttle-departure__body' }, [
      el('span', { class: 'shuttle-departure__route', text: event.routeName }),
      el('span', { class: 'shuttle-departure__dir', text: detail }),
    ]),
    el('span', { class: 'shuttle-departure__remaining', text: event.remaining }),
    el('span', { class: 'shuttle-departure__marks' }, [
      // 오늘이 아니면 어느 날 편인지 문구로 알린다(내일/모레).
      event.dayOffset === 0 ? null : badge({ text: event.dayLabel, tone: 'info' }),
      ...event.notes.map((note) => badge({ text: note, tone: 'warn' })),
    ]),
  ]);
}
