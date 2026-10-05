/**
 * 유기체: 미해석 원본 표기 상세 (features/schedule/components/organisms) — T13 결함 B.
 *
 * 홈 첫 화면에는 **요약 1줄**(`next-bus-warnings`)만 두고, 사람이 확인해야 하는 상세 목록은
 * 접힌 원본 영역(`details[data-testid="source-details"]`) 안에서만 보여준다(심플 UI).
 * 값은 도메인이 모아 준 `warnings` 문자열을 **그대로** 옮긴다(화면에서 재해석·요약 금지).
 */
import { el } from '../../../../shared/lib/dom';
import { UI_TEXT } from '../../types/texts';

export interface SourceWarningsProps {
  readonly warnings: readonly string[];
  readonly headingId: string;
}

/** 항목이 없으면 null(호출부가 빈 카드를 그리지 않게). */
export function sourceWarnings(props: SourceWarningsProps): HTMLElement | null {
  if (props.warnings.length === 0) return null;
  return el(
    'section',
    {
      class: 'shuttle-card',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'source-warnings', count: String(props.warnings.length) },
    },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.boardWarningsDetailsTitle }),
      el('p', { class: 'shuttle-meta__key', text: UI_TEXT.boardWarningsDetailsNote }),
      el(
        'ul',
        { class: 'shuttle-list', attrs: { 'aria-label': UI_TEXT.boardWarningsDetailsTitle }, dataset: { testid: 'source-warnings-list' } },
        props.warnings.map((warning) => el('li', { text: warning })),
      ),
    ],
  );
}
