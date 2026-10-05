/**
 * 유기체: 공지 배너 (features/schedule/components/organisms) — V1 §2(최상단, 조건부).
 *
 * 값은 `resolveDayService` 결과에서만 온다(`ServiceNoticeView`).
 * ① 오늘 운행 없음 → 제목 + 사유(원본 안내문 원문)
 * ② 대체 시간표  → `일요일 시간표로 운행합니다` + 근거 안내문
 * 색만으로 알리지 않는다 — 문구가 항상 있고 `data-kind` 로도 남긴다(검증·스크린리더).
 */
import { el } from '../../../../shared/lib/dom';
import type { ServiceNoticeView } from '../../store/selectors';

export interface ServiceNoticeBannerProps {
  readonly notice: ServiceNoticeView;
  readonly headingId: string;
}

export function serviceNoticeBanner(props: ServiceNoticeBannerProps): HTMLElement {
  const tone = props.notice.kind === 'no-service' ? 'warn' : 'info';
  return el(
    'div',
    {
      class: `shuttle-notice shuttle-notice--${tone}`,
      attrs: { role: 'status', 'aria-labelledby': props.headingId },
      dataset: { testid: 'board-notice', kind: props.notice.kind },
    },
    [
      el('h2', { class: 'shuttle-notice__title', attrs: { id: props.headingId }, text: props.notice.title }),
      el('p', { class: 'shuttle-notice__detail', text: props.notice.detail }),
    ],
  );
}
