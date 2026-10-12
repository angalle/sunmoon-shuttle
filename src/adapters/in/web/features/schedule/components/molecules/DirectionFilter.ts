/**
 * 분자: 방향 택1 세그먼트 (features/schedule/components/molecules) — docs/07 §16-2(T38) · §15-1(T37) · §12-3(T30).
 *
 * 칩은 **2개**이고 **택1**이다 — `학교 도착`(in) · `터미널 도착`(out). **`전체` 칩도, 아무것도 선택되지 않은
 * 상태도 없다**(§16-2). 기본은 `터미널 도착`(`DEFAULT_DIRECTION_SELECTION`, 페이지가 정한다).
 *   · `학교 도착`   = **학교로 도착하는 편**(역/터미널 출발 → 캠퍼스 도착, `data-direction="in"`)
 *   · `터미널 도착` = **역/터미널로 도착하는 편**(캠퍼스 출발, `data-direction="out"`)
 *
 * 선택 해제는 **없다**: 같은 칩을 다시 눌러도 그 방향이 그대로 선택되어 있다(§16-2 "선택 해제 불가").
 * 그 판단(눌린 값 → 선택 값)은 페이지가 한다 — 여기서는 받은 값 하나만 그리고, 클릭은 그대로 알린다(스킬 §5).
 *
 * T30 §12-3 — 라벨만 남기고 **편수는 작은 숫자**로 적는다: `학교 도착 24`.
 *  · `편`·`개` 접미사와 괄호를 쓰지 않는다(의미는 유지하고 **표기만** 줄인다 — 편수를 숨기지 않는다).
 *  · 숫자는 라벨(13px)보다 작은 11px·보조색으로 라벨 오른쪽에 붙인다(`.shuttle-chip__count`).
 *  · 0건이면 **흐리게 + `0`**(빈 결과를 숨기지 않는다).
 *
 * 규격(T37 §15-3): 보이는 알약 **34px** · **터치 영역 44px**(알약 밖 투명 여백으로 확보 — CSS `::after`) ·
 * `--touch-target-min`(48px)은 행에만 적용된다(칩은 문서가 정한 44px · 가로 ≥48px).
 *
 * 이 분자는 **표현만** 한다(라벨·편수·선택 상태·이벤트). 편수 계산은 선택자(`timetableView`)가 도메인 규칙으로
 * 끝내고 여기서는 받은 숫자를 그리기만 한다.
 *
 * 접근성: `role="group"` + `aria-label` · 선택 상태는 `aria-pressed` **속성**과 배경 톤 + 굵기로 함께 전달한다
 * (색만으로 전달 금지 — 항상 정확히 1개가 `true`). 0건 칩은 색을 낮추되 대비 4.5:1 이상인 토큰
 * (`--color-text-dim`)만 쓴다.
 */
import { el } from '../../../../shared/lib/dom';
import {
  directionSelectionLabel,
  type DirectionFilter,
  type DirectionSelection,
} from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DirectionFilterProps {
  /** 현재 선택 — **항상 1개**다(§16-2 · 해제 상태 없음). */
  readonly value: DirectionSelection;
  /** 방향별 편수 — 칩 옆에 숫자로 붙인다(색만으로 구분하지 않게) */
  readonly counts: Readonly<Record<DirectionFilter, number>>;
  /** 칩 클릭 — 눌린 방향을 그대로 알린다(택1 유지 판단은 페이지가 한다) */
  readonly onSelect: (value: DirectionSelection) => void;
}

/** 화면 표시 순서 — `학교 도착` → `터미널 도착`(§15-1 · T29 §11-1 의 순서에서 `전체` 만 빠졌다). */
export const CHIP_ORDER: readonly DirectionSelection[] = ['in', 'out'];
const ORDER = CHIP_ORDER;

/** 편수 표기 — `24`(접미사 없음 · §12-3). 0 도 `0` 으로 적는다(빈 결과를 숨기지 않는다). */
function countText(count: number): string {
  return String(count);
}

export function directionFilter(props: DirectionFilterProps): HTMLElement {
  const group = el('div', {
    class: 'shuttle-chips',
    attrs: { role: 'group', 'aria-label': UI_TEXT.filterDirectionLegend },
    dataset: { testid: 'direction-filter' },
  });

  for (const value of ORDER) {
    const selected = value === props.value;
    const count = props.counts[value];
    const classes = ['shuttle-chip'];
    // 0건은 흐리게 — 다만 글자 대비는 토큰(text-dim)으로 4.5:1 이상을 유지한다(§11-1).
    if (count === 0) classes.push('shuttle-chip--empty');
    group.appendChild(
      el(
        'button',
        {
          class: classes.join(' '),
          // 택1 세그먼트 — 항상 정확히 1개가 눌린 상태다(§16-2). 눌린 칩을 다시 눌러도 그대로다.
          attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
          dataset: { testid: 'direction-chip', direction: value, count: String(count) },
          on: {
            click: () => {
              props.onSelect(value);
            },
          },
        },
        [
          el('span', { class: 'shuttle-chip__label', text: directionSelectionLabel(value) }),
          // 라벨과 편수 사이에 **실제 공백 문자**를 둔다(낭독기·텍스트 대조가 `학교 도착 24` 로 읽도록).
          ' ',
          el('span', { class: 'shuttle-chip__count', text: countText(count) }),
        ],
      ),
    );
  }

  return group;
}
