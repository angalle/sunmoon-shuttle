/**
 * 유기체: 본문 시간표 (features/schedule/components/organisms) — T27 · docs/07 §9-1 · §9-3.
 *
 * 화면의 주인공은 **시간표 하나**다(히어로 카드·소개문구·변동·출처·요금 안내는 본문에서 걷어냈다 — 정보 시트로 이동).
 * **선택한 방향**(택1 · §16-2)의 회차를 출발 시각 순으로 한 목록에 그린다 — 두 방향이 섞이지 않는다.
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
import { button } from '../../../../shared/ui/atoms/Button';
import type { DirectionSelection, TimetableRowView, TimetableView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DailyTimetableProps {
  readonly view: TimetableView;
  readonly headingId: string;
  /**
   * T38 §16-2 — 선택한 방향의 편이 0편일 때 **다른 방향으로 가는 짧은 전환 수단**(버튼 1개)의 동작.
   * 자동 전환은 없다 — 이 버튼을 눌렀을 때만 방향이 바뀐다(동작 본체는 페이지).
   */
  readonly onSwitchDirection?: ((direction: DirectionSelection) => void) | undefined;
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
        ? timetableEmpty(view, props)
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

/**
 * 목록이 빈 경우의 **얇은 1줄**(빈 화면 금지) — 원인이 둘이라 문구를 나눈다(§16-2 · T37 §15-1):
 *  · **선택한 방향**의 편이 0편(그 요일에 편은 있다: `total > 0`) → `선택한 방향의 편이 없습니다`
 *    + **전환 수단 1개**(`<다른 방향> 편 보기` · §16-2). **자동 전환은 하지 않는다** — 눌러야 바뀐다.
 *  · 그 요일 표 자체에 안내할 회차가 없다(`total === 0`) → `이 시간표에 안내할 회차가 없습니다`
 */
function timetableEmpty(view: TimetableView, props: DailyTimetableProps): HTMLElement {
  const filtered = view.total > 0;
  const line = el('p', {
    class: 'shuttle-timetable__empty',
    dataset: { testid: filtered ? 'timetable-filter-empty' : 'timetable-empty', reason: filtered ? 'filter' : 'day' },
    text: filtered ? UI_TEXT.timetableEmptyFilter : UI_TEXT.timetableEmptyDay,
  });
  if (!filtered || view.emptySwitch === null) return line;
  const switchView = view.emptySwitch;
  return el('div', { class: 'shuttle-timetable__empty-block' }, [
    line,
    // 짧은 전환 수단 — 방향을 바꾸는 유일한 경로다(자동 전환 금지 · §16-2).
    button({
      label: switchView.label,
      variant: 'secondary',
      testid: 'timetable-filter-switch',
      onClick: () => {
        props.onSwitchDirection?.(switchView.direction);
      },
    }),
  ]);
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
