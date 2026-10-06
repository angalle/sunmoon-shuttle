/**
 * 분자: 방향 필터 칩 (features/schedule/components/molecules) — docs/07 §11-1(T29) · V1 §4.
 *
 * `전체`(기본) · `학교 도착` · `터미널 도착` — 누르면 즉시 반영(페이지가 재렌더). **표시 순서도 이 순서다.**
 *   · `전체`       = 모든 편
 *   · `학교 도착`   = **학교로 도착하는 편**(역/터미널 출발 → 캠퍼스 도착, `data-direction="in"`)
 *   · `터미널 도착` = **역/터미널로 도착하는 편**(캠퍼스 출발, `data-direction="out"`)
 * 각 칩에 **해당 편수**를 함께 적는다(`전체 115편`) — 0건이면 **흐리게 + `0편`**(빈 결과를 숨기지 않는다).
 *
 * 이 분자는 **표현만** 한다(라벨·편수·선택 상태·이벤트). 편수 계산은 선택자(`fullDayView`)가 도메인 규칙으로
 * 끝내고 여기서는 받은 숫자를 그리기만 한다. 상태(선택 값)는 페이지 지역 상태다(스킬 §5).
 *
 * 접근성: `role="group"` + `aria-label` · 선택 상태는 `aria-pressed` **속성**과 배경 톤 + 굵기로 함께 전달한다
 * (색만으로 전달 금지). 칩 높이는 CSS 토큰(`--touch-target-min`)으로 48px 이상, 좁으면 **가로 스크롤**한다.
 * 0건 칩은 색을 낮추되 대비 4.5:1 이상인 토큰(`--color-text-dim`)만 쓴다.
 */
import { el } from '../../../../shared/lib/dom';
import type { DirectionFilter } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DirectionFilterProps {
  readonly value: DirectionFilter;
  /** 필터별 편수 — 칩 옆에 숫자로 붙인다(색만으로 구분하지 않게) */
  readonly counts: Readonly<Record<DirectionFilter, number>>;
  readonly onSelect: (value: DirectionFilter) => void;
}

/** 화면 표시 순서 — 문서 §11-1 그대로(`전체` → `학교 도착` → `터미널 도착`). 검증도 이 순서를 본다. */
export const CHIP_ORDER: readonly DirectionFilter[] = ['all', 'in', 'out'];
const ORDER = CHIP_ORDER;

function labelOf(value: DirectionFilter): string {
  if (value === 'in') return UI_TEXT.filterDirectionSchool;
  if (value === 'out') return UI_TEXT.filterDirectionTerminal;
  return UI_TEXT.filterDirectionAll;
}

/** 편수 표기 — `115편`(0 도 `0편` 으로 적는다 — 빈 결과를 숨기지 않는다). */
function countText(count: number): string {
  return `${String(count)}${UI_TEXT.boardListCountSuffix}`;
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
          attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
          dataset: { testid: 'direction-chip', direction: value, count: String(count) },
          on: {
            click: () => {
              props.onSelect(value);
            },
          },
        },
        [
          el('span', { class: 'shuttle-chip__label', text: labelOf(value) }),
          // 라벨과 편수 사이에 **실제 공백 문자**를 둔다(낭독기·텍스트 대조가 `전체 115편` 으로 읽도록).
          ' ',
          el('span', { class: 'shuttle-chip__count', text: countText(count) }),
        ],
      ),
    );
  }

  return group;
}
