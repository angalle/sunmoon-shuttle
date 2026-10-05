/**
 * 유기체: 데이터 갱신 한 줄 (features/schedule/components/organisms) — T14.
 *
 * 이 앱이 **마지막으로 데이터를 반영한 시각**(`fetchedAt`)만 앱 기준으로 한 줄 보여준다.
 * (옛 `FreshnessPanel`(T5·F5)은 학교 페이지의 "최근 업데이트"까지 2행 + 페이지별 상세로 펼쳐
 *  보여줬지만, T14 에서는 앱 기준 1줄로 줄이고 학교 페이지 이름·링크를 화면에서 걷어냈다.)
 *
 * 48시간을 넘긴 값에는 경고 문구를 함께 붙인다 — 색만으로 전달하지 않는다.
 * 값 계산은 전부 선택자(`freshnessView`)가 한다(여기서 시각 계산 금지).
 */
import { el } from '../../../../shared/lib/dom';
import type { FreshnessView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DataRefreshLineProps {
  readonly view: FreshnessView;
  readonly headingId: string;
}

export function dataRefreshLine(props: DataRefreshLineProps): HTMLElement {
  return el(
    'section',
    {
      class: 'shuttle-card',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'data-refresh', stale: String(props.view.stale) },
    },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.freshnessTitle }),
      el('p', { class: 'shuttle-meta__key', dataset: { testid: 'data-refresh-line' }, text: props.view.line }),
      props.view.warning === null
        ? null
        : el('p', {
            class: 'shuttle-banner shuttle-banner--warn',
            attrs: { role: 'status' },
            dataset: { testid: 'data-refresh-warning' },
            text: props.view.warning,
          }),
    ],
  );
}
