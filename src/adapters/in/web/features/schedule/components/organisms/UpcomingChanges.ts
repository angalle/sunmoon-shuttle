/**
 * 유기체: 다가오는 운행 변동 (features/schedule/components/organisms) — T17 지시 ①.
 *
 * 홈 상단에 `dateRules[]`(schema v2) 중 오늘 이후 14일 내 운행 변동을 **최대 2줄**로 안내한다.
 * 값·날짜·표기 이름은 전부 선택자(`upcomingChanges`) 결과에서 온다 — 여기서 날짜를 계산하지 않는다
 * (판정·기간 해석은 T16 산출물(JSON)과 선택자 몫, 컴포넌트는 그리기만).
 *
 * 줄이 없으면 **아무것도 그리지 않는다**(null) — 빈 배너·빈 제목을 남기지 않는다.
 * 색만으로 알리지 않는다: 제목·줄 문구가 항상 있고 `data-kind` 로도 남긴다(검증·스크린리더).
 */
import { el } from '../../../../shared/lib/dom';
import type { UpcomingChangesView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface UpcomingChangeBannerProps {
  readonly view: UpcomingChangesView;
  readonly headingId: string;
}

export function upcomingChangeBanner(props: UpcomingChangeBannerProps): HTMLElement | null {
  if (props.view.lines.length === 0) return null;
  return el(
    'section',
    {
      class: 'shuttle-notice shuttle-notice--info',
      attrs: { role: 'status', 'aria-labelledby': props.headingId },
      dataset: {
        testid: 'upcoming-change',
        count: String(props.view.lines.length),
        total: String(props.view.total),
      },
    },
    [
      el('h2', {
        class: 'shuttle-notice__title',
        attrs: { id: props.headingId },
        text: UI_TEXT.upcomingChangeTitle,
      }),
      el(
        'ul',
        { class: 'shuttle-notice__list', dataset: { testid: 'upcoming-change-list' } },
        props.view.lines.map((line) =>
          el('li', {
            class: 'shuttle-notice__detail',
            dataset: { testid: 'upcoming-change-line', kind: line.kind },
            text: line.text,
          }),
        ),
      ),
    ],
  );
}
