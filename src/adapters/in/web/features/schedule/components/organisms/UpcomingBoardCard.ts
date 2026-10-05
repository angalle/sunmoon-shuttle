/**
 * 유기체: 다음 출발 카드 (features/schedule/components/organisms) — V1 §3.
 *
 * 노선을 통합한 **상위 3편**을 큰 시각 + 노선명 + 방향(학교 → 역/터미널 | 역/터미널 → 학교)
 * + 도착 시각 + 특이사항 배지로 보여준다. 남은 시간은 도메인이 준 값(`remaining`)을 그대로 쓴다.
 * `data-testid="next-bus-card"`/`next-bus-time`/`shuttle-hero__remaining` 은 기존 스모크 계약이다.
 */
import { el } from '../../../../shared/lib/dom';
import { badge } from '../../../../shared/ui/atoms/Badge';
import type { DepartureEventView, TodayBoardView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface UpcomingBoardCardProps {
  readonly view: TodayBoardView;
  readonly headingId: string;
}

export function upcomingBoardCard(props: UpcomingBoardCardProps): HTMLElement {
  const { view } = props;
  const first: DepartureEventView | undefined = view.next.at(0);
  const rest = view.next.slice(1);

  return el(
    'section',
    {
      class: 'shuttle-card',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'next-bus-card', status: view.status },
    },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.boardNowTitle }),
      first === undefined
        ? el('p', {
            class: 'shuttle-board__empty',
            dataset: { testid: 'next-bus-empty' },
            text: view.status === 'loading' ? UI_TEXT.loading : UI_TEXT.boardEmptyTitle,
          })
        : el(
            'div',
            { class: 'shuttle-hero', attrs: { role: 'status', 'aria-live': 'polite' }, dataset: { testid: 'next-bus-live' } },
            [
              el('p', { class: 'shuttle-hero__label', text: UI_TEXT.boardHeroLabel }),
              el('p', {
                class: 'shuttle-hero__time',
                dataset: { testid: 'next-bus-time' },
                text: `${first.dayLabel} ${first.departure} ${UI_TEXT.boardDepartureSuffix}`,
              }),
              el('p', {
                class: 'shuttle-hero__remaining',
                dataset: { testid: 'next-bus-remaining' },
                text: `${first.routeName} · ${detailOf(first)} · ${first.remaining}`,
              }),
              first.notes.length === 0
                ? null
                : el('p', { class: 'shuttle-hero__notes' }, first.notes.map((note) => badge({ text: note, tone: 'warn' }))),
            ],
          ),
      rest.length === 0
        ? null
        : el('div', {}, [
            el('h3', { class: 'shuttle-card__title', text: UI_TEXT.nextBusListTitle }),
            el(
              'ul',
              { class: 'shuttle-nextbus__list', attrs: { 'aria-label': UI_TEXT.nextBusListTitle }, dataset: { testid: 'next-bus-list' } },
              rest.map((event) => nextRow(event)),
            ),
          ]),
      view.warnings.length === 0
        ? null
        : el(
            'div',
            { class: 'shuttle-banner shuttle-banner--warn', attrs: { role: 'status' }, dataset: { testid: 'next-bus-warnings' } },
            [
              el('p', {}, [el('strong', { text: UI_TEXT.nextBusWarningsTitle })]),
              el('p', { text: UI_TEXT.nextBusWarningsDetail }),
              el('ul', { class: 'shuttle-list' }, view.warnings.map((warning) => el('li', { text: warning }))),
            ],
          ),
    ],
  );
}

/** `학교에서 출발 · 08:25 도착` — 도착 시각이 없으면 방향만. */
function detailOf(event: DepartureEventView): string {
  if (event.arrival === null) return event.directionLabel;
  return `${event.directionLabel} · ${event.arrival} ${UI_TEXT.boardArrivalSuffix}`;
}

function nextRow(event: DepartureEventView): HTMLElement {
  const notes = event.notes.length === 0 ? null : `${UI_TEXT.boardNotesPrefix}: ${event.notes.join(' · ')}`;
  return el('li', { class: 'shuttle-nextbus__item', dataset: { testid: 'next-bus-row' } }, [
    el('span', { class: 'shuttle-nextbus__time', text: `${event.dayLabel} ${event.departure}` }),
    el('span', { class: 'shuttle-nextbus__route', text: event.routeName }),
    el('span', { class: 'shuttle-nextbus__dir', text: detailOf(event) }),
    el('span', { class: 'shuttle-nextbus__remaining', text: event.remaining }),
    notes === null ? null : el('span', { class: 'shuttle-nextbus__annotations', text: notes }),
  ]);
}
