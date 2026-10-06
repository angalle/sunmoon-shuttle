/**
 * 유기체: 상단 바 아래 최소 1줄 (features/schedule/components/organisms) — T27 · docs/07 §9-4.
 *
 * 본문에서 잡텍스트를 걷어낸 대신, **스크롤 대상이 없거나 반드시 알아야 하는** 안내만 남긴다:
 *  ① 오늘 운행이 아예 없음(+ 다음 운행 시각) ② 대체 시간표 ③ 방학 기간 ④ 오늘 운행 종료
 * 동시에 **최대 1줄**이다(우선순위는 선택자 `dayNoticeLine` 이 정한다 — 여기서 판정하지 않는다).
 *
 * 계약: 문구가 항상 있고 `data-kind` 로도 남긴다(색만으로 알리지 않음 · 스모크·낭독기 검증).
 *  - 운행 없음·대체·종료: `[data-testid="day-notice"]`
 *  - 방학: `[data-testid="vacation-notice"]` (+ `[data-testid="vacation-line"]`)
 */
import { el } from '../../../../shared/lib/dom';
import type { DayNoticeLine } from '../../store/selectors';

export interface DayNoticeProps {
  readonly line: DayNoticeLine;
}

export function dayNotice(props: DayNoticeProps): HTMLElement {
  const { line } = props;
  const tone = line.kind === 'no-service' ? 'warn' : 'info';
  const vacation = line.kind === 'vacation';
  return el(
    'div',
    {
      class: `shuttle-strip shuttle-strip--${tone}`,
      attrs: { role: 'status' },
      dataset: vacation
        ? { testid: 'vacation-notice', kind: line.kind }
        : { testid: 'day-notice', kind: line.kind },
    },
    [
      el('p', {
        class: 'shuttle-strip__line',
        ...(vacation ? { dataset: { testid: 'vacation-line' } } : {}),
        text: line.text,
      }),
    ],
  );
}
