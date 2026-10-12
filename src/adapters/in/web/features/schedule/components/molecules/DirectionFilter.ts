/**
 * 분자: 방향 필터 칩 (features/schedule/components/molecules) — docs/07 §15-1(T37) · §12-3(T30) · V1 §4.
 *
 * 칩은 **2개**다 — `학교 도착`(in) · `터미널 도착`(out). **`전체` 칩은 없다**(§15-1).
 *   · `학교 도착`   = **학교로 도착하는 편**(역/터미널 출발 → 캠퍼스 도착, `data-direction="in"`)
 *   · `터미널 도착` = **역/터미널로 도착하는 편**(캠퍼스 출발, `data-direction="out"`)
 *   · **아무것도 선택하지 않은 상태가 곧 \"전체\"** 다 — 그래서 `전체` 를 그리는 대신 비워 둔다.
 *
 * 칩은 **토글**이다: 누르면 그 방향만(`aria-pressed=\"true\"`), **다시 누르면 해제**되어 전체로 복귀한다.
 * 토글 규칙(선택 → 해제)은 페이지가 갖고 여기서는 받은 값만 그린다(상태 소유는 페이지 · 스킬 §5).
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
 * 접근성: `role=\"group\"` + `aria-label` · 선택 상태는 `aria-pressed` **속성**과 배경 톤 + 굵기로 함께 전달한다
 * (색만으로 전달 금지). 0건 칩은 색을 낮추되 대비 4.5:1 이상인 토큰(`--color-text-dim`)만 쓴다.
 */
import { el } from '../../../../shared/lib/dom';
import type { DirectionFilter } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DirectionFilterProps {
  /** 현재 선택 — `all` 이면 **선택 없음(= 전체)** 이다(§15-1). */
  readonly value: DirectionFilter;
  /** 필터별 편수 — 칩 옆에 숫자로 붙인다(색만으로 구분하지 않게) */
  readonly counts: Readonly<Record<DirectionFilter, number>>;
  /** 칩 클릭 — 토글 판단(같은 값을 다시 누르면 해제)은 페이지가 한다 */
  readonly onSelect: (value: DirectionFilter) => void;
}

/** 화면 표시 순서 — `학교 도착` → `터미널 도착`(§15-1 · T29 §11-1 의 순서에서 `전체` 만 빠졌다). */
export const CHIP_ORDER: readonly DirectionFilter[] = ['in', 'out'];
const ORDER = CHIP_ORDER;

function labelOf(value: DirectionFilter): string {
  return value === 'in' ? UI_TEXT.filterDirectionSchool : UI_TEXT.filterDirectionTerminal;
}

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
          // 라벨과 편수 사이에 **실제 공백 문자**를 둔다(낭독기·텍스트 대조가 `학교 도착 24` 로 읽도록).
          ' ',
          el('span', { class: 'shuttle-chip__count', text: countText(count) }),
        ],
      ),
    );
  }

  return group;
}
