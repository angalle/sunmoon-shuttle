/**
 * 분자: 시간표 머리 — `천안역 → 학교` (2026-11-08 사용자 결정).
 *
 * 정류장 칩 아래에 따로 있던 방향 칩 줄을 없애고, 방향을 **시간표 머리**에 둔다.
 * 머리 전체가 버튼이다: 누르면 방향이 뒤집혀 반대 시간표(`학교 → 천안역`)가 나온다.
 *  - 출발지 · 화살표 · 도착지 순서로 쓰고, 화살표는 원 안에 둬서 "누를 수 있는 곳"으로 보이게 한다.
 *  - 오른쪽에 지금 방향의 편수와 반대 방향 편수를 작게 둔다(색만으로 전달하지 않게 문구로).
 *  - 접근성 이름: `방향 바꾸기 — 지금 천안역 → 학교, 누르면 학교 → 천안역`.
 */
import { el, svgIcon } from '../../../../shared/lib/dom';
import { directionLabelFor, type DirectionFilter, type DirectionSelection } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DirectionHeaderProps {
  readonly value: DirectionSelection;
  /** 고른 정류장 이름 — 모델 전이면 null(자리만 지킨다) */
  readonly stopName: string | null;
  readonly counts: Readonly<Record<DirectionFilter, number>>;
  readonly onToggle: (next: DirectionSelection) => void;
}

export function directionHeader(props: DirectionHeaderProps): HTMLElement {
  const next: DirectionSelection = props.value === 'in' ? 'out' : 'in';
  const stop = props.stopName ?? UI_TEXT.directionHeaderPending;
  const [from, to] = props.value === 'in' ? [stop, UI_TEXT.stopCampusName] : [UI_TEXT.stopCampusName, stop];
  const count = props.counts[props.value];
  const otherCount = props.counts[next];
  return el(
    'button',
    {
      class: 'shuttle-dirhead',
      attrs: {
        type: 'button',
        'aria-label': `${UI_TEXT.directionHeaderToggleLabel} — ${directionLabelFor(props.value, props.stopName)}, ${UI_TEXT.directionHeaderToggleHint} ${directionLabelFor(next, props.stopName)}`,
        ...(props.stopName === null ? { disabled: '' } : {}),
      },
      dataset: {
        testid: 'direction-toggle',
        direction: props.value,
        countIn: String(props.counts.in),
        countOut: String(props.counts.out),
      },
      on: {
        click: () => {
          props.onToggle(next);
        },
      },
    },
    [
      el('span', { class: 'shuttle-dirhead__place', text: from }),
      el('span', { class: 'shuttle-dirhead__arrow', attrs: { 'aria-hidden': 'true' } }, [
        svgIcon([{ kind: 'path', d: 'M5 12h14M13 6l6 6-6 6' }], { size: '18' }),
      ]),
      el('span', { class: 'shuttle-dirhead__place', text: to }),
      el('span', { class: 'shuttle-dirhead__count', attrs: { 'aria-hidden': 'true' } }, [
        el('span', { class: 'shuttle-dirhead__num', text: `${String(count)}${UI_TEXT.directionHeaderCountSuffix}` }),
        el('span', { class: 'shuttle-dirhead__swap', text: `⇄ ${String(otherCount)}` }),
      ]),
    ],
  );
}
