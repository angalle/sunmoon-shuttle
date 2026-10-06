/**
 * 유기체: 방학 기간 배너 (features/schedule/components/organisms) — T17 지시 ⑤.
 *
 * `terms[]`(schema v2) 로 **오늘이 방학 기간**일 때만 배너 1줄을 그린다(선택자 `vacationNotice`).
 * 기간 이름·링크 주소는 데이터에서만 온다(하드코딩 금지). 해당 기간이 없거나 기간(시작·끝)이
 * 확정되지 않은 항목뿐이면 호출부가 이 컴포넌트를 **아예 그리지 않는다**.
 *
 * 링크는 `timetableSource` 가 있을 때만 그린다. 링크를 그리는 동안에는 대표 출처 링크를 접어
 * 학교 링크가 화면에 2개가 되지 않게 한다(T14 계약 — 호출부 `SchedulePage` 가 `sourceFooter` 에 알린다).
 */
import { el } from '../../../../shared/lib/dom';
import type { VacationView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface VacationNoticeBannerProps {
  readonly view: VacationView;
  readonly headingId: string;
}

export function vacationNoticeBanner(props: VacationNoticeBannerProps): HTMLElement {
  const { view } = props;
  return el(
    'section',
    {
      class: 'shuttle-notice shuttle-notice--info',
      attrs: { role: 'status', 'aria-labelledby': props.headingId },
      dataset: { testid: 'vacation-notice' },
    },
    [
      el('h2', {
        class: 'shuttle-notice__title',
        attrs: { id: props.headingId },
        text: UI_TEXT.vacationTitle,
      }),
      el('p', { class: 'shuttle-notice__detail', dataset: { testid: 'vacation-line' }, text: view.text }),
      // 소스 링크는 데이터에 있을 때만(없으면 줄 자체를 만들지 않는다).
      view.sourceUrl === null
        ? null
        : el('p', { class: 'shuttle-notice__detail', dataset: { testid: 'vacation-source' } }, [
            el('span', { text: `${UI_TEXT.vacationSourcePrefix} — ` }),
            el('a', {
              attrs: { href: view.sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
              dataset: { testid: 'vacation-source-link' },
              text: view.sourceLabel,
            }),
          ]),
    ],
  );
}
