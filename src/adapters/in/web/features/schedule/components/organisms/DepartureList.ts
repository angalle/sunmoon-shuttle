/**
 * 유기체: 오늘 남은 출발 목록 (features/schedule/components/organisms) — V1 §5·§8 · T13.
 *
 * 노선을 통합해 **상위 5편**(`BOARD_LIST_LIMIT`)을 보여주고, 넘치는 편은 `<details>`("더 보기")로 접는다.
 * 지난 시각은 도메인(`nextDepartures`)이 이미 제외했으므로 여기서 다시 거르지 않는다.
 *
 * 머리 문구(운행 없음 / 오늘 종료 / 빈 목록)는 **선택자가 도메인 값으로 정해 준다**(`listHeadline*`).
 * 여기서 다시 판정하지 않는다 — T13 결함 A: 운행 없는 날에 "끝났습니다"가 나오지 않게 하는 근거는
 * `resolveDayService().serviceOn` 뿐이다.
 *  - `no-service`: `오늘은 운행이 없습니다 · 다음 운행: 내일 08:00` (사유는 상단 배너 1회만, 목록은 숨김)
 *  - `today-over` : `오늘 운행이 끝났습니다 · 다음 운행: 내일 07:30` (목록은 다음 운행일 편)
 */
import { el } from '../../../../shared/lib/dom';
import { badge } from '../../../../shared/ui/atoms/Badge';
import type { BoardHeadlineKind, DepartureEventView, TodayBoardView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DepartureListProps {
  readonly view: TodayBoardView;
  readonly headingId: string;
}

/** 머리 문구 종류 → 스모크·검증용 testid (기존 계약 `board-today-over` 유지). */
const HEADLINE_TESTID: Readonly<Record<BoardHeadlineKind, string>> = {
  loading: 'departure-loading',
  'no-service': 'departure-no-service',
  'today-over': 'board-today-over',
  empty: 'departure-empty',
};

export function departureList(props: DepartureListProps): HTMLElement {
  const { view } = props;
  const total = `${UI_TEXT.boardListTotalPrefix} ${String(view.todayTotal)}${UI_TEXT.boardListCountSuffix}`;
  const remaining = `${UI_TEXT.boardListRemainingPrefix} ${String(view.counts.all)}${UI_TEXT.boardListCountSuffix}`;
  const headlineKind = view.listHeadlineKind;
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
        // 편수는 **정상 운행일 때만** 붙인다 — 운행 없는 날의 `총 0편 · 남은 0편`은 정보가 아니라 소음이다(T13).
        view.status !== 'ready'
          ? null
          : el('span', { class: 'shuttle-board__counts', dataset: { testid: 'board-counts' }, text: ` (${total} · ${remaining})` }),
      ]),
      view.listHeadline === null || headlineKind === null
        ? null
        : el('p', {
            // 운행 없음·빈 목록은 담백한 한 줄, 오늘 종료 안내는 다음 운행일 정보라 배너 톤을 쓴다.
            class: headlineKind === 'today-over' ? 'shuttle-banner shuttle-banner--info' : 'shuttle-board__empty',
            dataset: { testid: HEADLINE_TESTID[headlineKind] },
            text: view.listHeadline,
          }),
      !view.listVisible || empty
        ? null
        : el(
            'ul',
            { class: 'shuttle-departures', attrs: { 'aria-label': UI_TEXT.boardListTitle }, dataset: { testid: 'departure-list' } },
            view.list.map((event) => departureRow(event)),
          ),
      view.rest.length === 0 || !view.listVisible
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
  const parts = [event.directionLabel];
  if (event.arrival !== null) parts.push(`${event.arrival} ${UI_TEXT.boardArrivalSuffix}`);
  // T17 ③ — 소요시간(데이터에 있을 때만) 보조 문구.
  if (event.durationNote !== null) parts.push(event.durationNote);
  const detail = parts.join(' · ');
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
