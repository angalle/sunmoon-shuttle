/**
 * 유기체: 이용 안내 시트 (features/schedule/components/organisms) — T24 · docs/07 §4-3.
 *
 * [지금] 화면에서 접힘으로 밀어 넣지 않고 **별도 시트**로 분리한 이용 안내다(항목 ④ "접힘 대신 별도 시트/화면").
 * 내용: 정차창(`stopWindows`) · 요금·지연 안내(안내문 원문) · 시내버스 참고 · 방학 시간표 링크(기간이 있을 때만) ·
 *       비공식 고지.
 *
 * 계약
 * - **DOM 에 항상 있다**(열림/닫힘은 `hidden` 속성) — T14/T17 스모크가 요소 존재로 계약을 검사한다.
 * - 링크: 화면에 학교 링크가 2개가 되지 않게 **호출부(페이지)가 한 곳만 링크를 갖게** 정한다
 *   (방학 배너가 링크를 그리면 여기 `vacation` 은 null 로 온다 — T14 계약 유지).
 * - 열림/닫힘·포커스는 페이지가 관리한다(여기는 표현 + 닫기 콜백만).
 */
import { el } from '../../../../shared/lib/dom';
import { button } from '../../../../shared/ui/atoms/Button';
import type { BusRef } from '../../types/contract';
import type {
  FreshnessView,
  NoticeGroupsView,
  StopWindowLineView,
  UpcomingChangesView,
  VacationView,
} from '../../store/selectors';
import type { TimetableModel } from '../../types/model';
import { UI_TEXT } from '../../types/texts';
import { dataRefreshLine } from './DataRefreshLine';
import { noticePanel } from './NoticePanel';
import { sourceFooter } from './SourceFooter';
import { upcomingChangeBanner } from './UpcomingChanges';

/** 출처·고지 블록(§9-5) — 모델이 있을 때만 온다. */
export interface GuideSheetSourceProps {
  readonly model: TimetableModel;
  readonly headingId: string;
  /** 방학 시간표 링크가 시트에 있으면 대표 출처 앵커는 접는다(학교 링크 ≤1 계약) */
  readonly hideSourceLink: boolean;
}

export interface GuideSheetProps {
  readonly headingId: string;
  readonly noticeHeadingId: string;
  readonly groups: NoticeGroupsView;
  readonly busRefs: readonly BusRef[];
  readonly stopWindows: readonly StopWindowLineView[];
  /** 방학 시간표 링크를 **여기서** 그릴 때만 값이 온다(아니면 null — T14 학교 링크 1개 유지) */
  readonly vacation: VacationView | null;
  /** `데이터 갱신: <시각>` 한 줄(T27 §9-5) — 모델이 있을 때만 */
  readonly freshness: FreshnessView | null;
  /** 출처·고지 · 개인정보처리방침(T27 §9-5) — 모델이 있을 때만 */
  readonly source: GuideSheetSourceProps | null;
  /** 미해석 표기 안내 1줄(내부 경고 — §9-5). 없으면 null */
  readonly warningsNotice: string | null;
  /** 다가오는 운행 변동(14일 내) — §9-1 로 본문에서 걷어내 시트로 옮긴 블록 */
  readonly upcoming: UpcomingChangesView;
  readonly onClose: () => void;
}

export function guideSheet(props: GuideSheetProps): HTMLElement {
  return el(
    'div',
    {
      class: 'shuttle-sheet',
      attrs: {
        role: 'dialog',
        'aria-modal': 'false',
        'aria-labelledby': props.headingId,
        hidden: '',
      },
      dataset: { testid: 'guide-sheet' },
    },
    [
      el('div', { class: 'shuttle-sheet__panel' }, [
        el('div', { class: 'shuttle-sheet__head' }, [
          el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.guideTitle }),
          button({
            label: UI_TEXT.guideClose,
            variant: 'secondary',
            testid: 'guide-close',
            onClick: props.onClose,
          }),
        ]),
        noticePanel({
          groups: props.groups,
          busRefs: props.busRefs,
          stopWindows: props.stopWindows,
          headingId: props.noticeHeadingId,
        }),
        // 미해석 표기 안내(내부) — 사용자 판단에 영향을 주는 경고만, 본문이 아니라 여기서만 보여준다(§9-5).
        props.warningsNotice === null
          ? null
          : el('p', {
              class: 'shuttle-board__warn',
              attrs: { role: 'status' },
              dataset: { testid: 'guide-warnings' },
              text: props.warningsNotice,
            }),
        // 다가오는 운행 변동(14일 내 최대 2줄) — §9-1 로 본문에서 걷어낸 블록(값은 dateRules[] 에서만).
        upcomingChangeBanner({ view: props.upcoming, headingId: `${props.headingId}-upcoming` }),
        // `데이터 갱신: <시각>` — 본문에서 걷어낸 1줄(§9-5).
        props.freshness === null
          ? null
          : dataRefreshLine({ view: props.freshness, headingId: `${props.headingId}-freshness` }),
        // 출처·고지(학교 안내 페이지 링크 1개 · 비공식 고지 · 개인정보처리방침) — 화면의 유일한 학교 링크(§9-5).
        props.source === null
          ? null
          : sourceFooter({
              model: props.source.model,
              headingId: props.source.headingId,
              hideSourceLink: props.source.hideSourceLink,
            }),
        props.vacation === null || props.vacation.sourceUrl === null
          ? null
          : el('section', { class: 'shuttle-card', dataset: { testid: 'guide-vacation' } }, [
              el('h3', { class: 'shuttle-card__title', text: props.vacation.label }),
              el('p', {}, [
                el('span', { text: `${UI_TEXT.vacationSourcePrefix} — ` }),
                el('a', {
                  attrs: { href: props.vacation.sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
                  dataset: { testid: 'vacation-source-link' },
                  text: props.vacation.sourceLabel,
                }),
              ]),
            ]),
        el('p', { class: 'shuttle-footer__notice', text: UI_TEXT.unofficialNotice }),
      ]),
    ],
  );
}
