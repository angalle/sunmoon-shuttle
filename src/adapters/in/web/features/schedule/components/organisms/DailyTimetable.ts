/**
 * 유기체: 본문 시간표 (features/schedule/components/organisms) — T27 · docs/07 §9-1 · §9-3.
 *
 * 화면의 주인공은 **시간표 하나**다(히어로 카드·소개문구·변동·출처·요금 안내는 본문에서 걷어냈다 — 정보 시트로 이동).
 * 선택한 요일의 **전체 회차**를 출발 시각 순으로 한 목록에 그린다.
 *
 * 값은 전부 선택자(`timetableView`)가 도메인 규칙으로 만든 값이고 여기서는 그리기만 한다:
 *  - `isPast`  → dim(지나간 행) — 색·굵기를 낮춘다(`--color-text-muted`). 색만으로 알리지 않는다(sr-only `지난 편`).
 *  - `isNext`  → **살짝 강조**: 좌측 3px 액센트 라인 + 배경 톤 한 단계. **배지·테두리·문구 없음**(§9-3).
 *  - `token`   → 요일 조건 요약 **짧은 토큰 1개 이하**(`금 휴` · `월·화` · `2대`). 긴 사유 문구 금지.
 *    강조 행에는 토큰을 붙이지 않는다(강조 행은 라인+배경만 — §9-3).
 *
 * 계약(스모크): `[data-testid="timetable-list"]` 안의 각 행은 `[data-testid="timetable-row"]` 이고
 * `data-past`/`data-next`/`data-token`/`data-direction`/`data-route` 를 갖는다. 시각 셀은
 * `.shuttle-departure__time`(기존 클래스 재사용 — 검증 스크립트가 행 시각을 읽는다).
 */
import { el } from '../../../../shared/lib/dom';
import type { TimetableRowView, TimetableView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DailyTimetableProps {
  readonly view: TimetableView;
  readonly headingId: string;
}

export function dailyTimetable(props: DailyTimetableProps): HTMLElement {
  const { view } = props;
  return el(
    'section',
    {
      class: 'shuttle-timetable',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'timetable-section', day: view.dayType, today: view.isToday ? 'true' : 'false' },
    },
    [
      // 제목은 화면에 보이지 않는다(본문이 곧 시간표다) — 낭독기용 구조만 남긴다.
      el('h2', { class: 'shuttle-sr-only', attrs: { id: props.headingId }, text: UI_TEXT.timetableTitle }),
      view.rows.length === 0
        ? el('p', {
            class: 'shuttle-board__empty',
            dataset: { testid: 'timetable-empty' },
            text: UI_TEXT.timetableEmptyDay,
          })
        : el(
            'ul',
            {
              class: 'shuttle-departures',
              attrs: { 'aria-label': `${view.dayLabel} ${UI_TEXT.timetableTitle}` },
              dataset: { testid: 'timetable-list' },
            },
            view.rows.map((row) => timetableRow(row)),
          ),
    ],
  );
}

/** 행 하나 — 지난 편 dim · 다음 출발 강조 · 조건 토큰 ≤1. */
function timetableRow(row: TimetableRowView): HTMLElement {
  const classes = ['shuttle-departure'];
  if (row.isPast) classes.push('shuttle-departure--past');
  if (row.isNext) classes.push('shuttle-departure--next');
  // 강조 행은 라인+배경만 쓴다(§9-3) — 요일 조건 토큰도 붙이지 않는다.
  else if (row.token !== null) classes.push('shuttle-departure--limited');

  const detail = [row.directionLabel];
  if (row.arrival !== null) detail.push(`${row.arrival} ${UI_TEXT.boardArrivalSuffix}`);
  if (row.durationNote !== null) detail.push(row.durationNote);

  return el(
    'li',
    {
      class: classes.join(' '),
      dataset: {
        testid: 'timetable-row',
        key: row.key,
        route: row.routeName,
        direction: row.direction,
        past: row.isPast ? 'true' : 'false',
        next: row.isNext ? 'true' : 'false',
        token: row.token ?? '',
      },
    },
    [
      el('span', { class: 'shuttle-departure__time', text: row.departure }),
      el('span', { class: 'shuttle-departure__body' }, [
        el('span', { class: 'shuttle-departure__route', text: row.routeName }),
        el('span', { class: 'shuttle-departure__dir', text: detail.join(' · ') }),
      ]),
      el('span', { class: 'shuttle-departure__marks' }, [
        row.isNext
          ? null
          : row.token === null
            ? null
            : el('span', { class: 'shuttle-departure__token', dataset: { testid: 'row-token' }, text: row.token }),
        // 색·배경만으로 상태를 전달하지 않는다 — 낭독기용 표시를 함께 둔다.
        row.isNext ? el('span', { class: 'shuttle-sr-only', text: UI_TEXT.srNextDeparture }) : null,
        row.isPast ? el('span', { class: 'shuttle-sr-only', text: UI_TEXT.srPastDeparture }) : null,
      ]),
    ],
  );
}
