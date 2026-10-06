/**
 * 유기체: 전체 시간표 목록 (features/schedule/components/organisms) — T24 · docs/07 §4-2 ②.
 *
 * 선택된 요일 탭의 **전체 편 목록**이다([지금] 화면의 "지금 탈 수 있는 편"과 분리 — 화면 분리의 핵심).
 * 값(출발·도착·방향·사유 배지·`약 N분 소요`)은 전부 선택자(`fullDayView`)가 도메인 규칙으로 만든 값이고,
 * 여기서는 그리기만 한다(판정 재계산 금지 — docs/06 §2 · T22 계약).
 *  - 사유 배지: `금요일 운행 없음` · `월·화만 운행` · `2대 운행` 등(도메인 `tripStatus` 결과)
 *  - 지난 편은 색이 아니라 **배지 문구**로도 알린다(`지난 편`).
 */
import { el } from '../../../../shared/lib/dom';
import { badge } from '../../../../shared/ui/atoms/Badge';
import type { FullDayView, FullTripView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface FullTimetableListProps {
  readonly view: FullDayView;
  readonly headingId: string;
}

export function fullTimetableList(props: FullTimetableListProps): HTMLElement {
  const { view } = props;
  return el(
    'section',
    {
      class: 'shuttle-card',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'full-list-card', day: view.dayType },
    },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId } }, [
        el('span', { text: UI_TEXT.fullListTitle }),
        view.total === 0
          ? null
          : el('span', {
              class: 'shuttle-board__counts',
              dataset: { testid: 'full-counts' },
              text: ` (${UI_TEXT.fullListTotalPrefix} ${String(view.total)}${UI_TEXT.boardListCountSuffix})`,
            }),
      ]),
      view.trips.length === 0
        ? el('p', { class: 'shuttle-board__empty', dataset: { testid: 'full-empty' }, text: UI_TEXT.fullListEmpty })
        : el(
            'ul',
            {
              class: 'shuttle-departures',
              attrs: { 'aria-label': UI_TEXT.fullListTitle },
              dataset: { testid: 'full-list' },
            },
            view.trips.map((trip) => fullRow(trip)),
          ),
    ],
  );
}

function fullRow(trip: FullTripView): HTMLElement {
  const parts = [trip.directionLabel];
  if (trip.arrival !== null) parts.push(`${trip.arrival} ${UI_TEXT.boardArrivalSuffix}`);
  if (trip.durationNote !== null) parts.push(trip.durationNote);
  return el(
    'li',
    {
      class: trip.isPast ? 'shuttle-departure shuttle-departure--past' : 'shuttle-departure',
      dataset: {
        testid: 'full-row',
        direction: trip.direction,
        past: trip.isPast ? 'true' : 'false',
        route: trip.routeName,
      },
    },
    [
      el('span', { class: 'shuttle-departure__time', text: trip.departure }),
      el('span', { class: 'shuttle-departure__body' }, [
        el('span', { class: 'shuttle-departure__route', text: trip.routeName }),
        el('span', { class: 'shuttle-departure__dir', text: parts.join(' · ') }),
      ]),
      el('span', { class: 'shuttle-departure__marks' }, [
        trip.isPast ? badge({ text: UI_TEXT.fullListPastBadge, tone: 'info' }) : null,
        ...trip.badges.map((note) => badge({ text: note, tone: 'warn' })),
      ]),
    ],
  );
}
