/**
 * 유기체: 출처·고지 푸터 (features/schedule/components/organisms) — F6.
 * 원본 페이지 링크 + "비공식 앱" 고지 + 문의처(원본 값).
 */
import { el } from '../../../../shared/lib/dom';
import type { TimetableModel } from '../../types/model';
import { UI_TEXT } from '../../types/texts';

export interface SourceFooterProps {
  readonly model: TimetableModel;
  readonly headingId: string;
}

export function sourceFooter(props: SourceFooterProps): HTMLElement {
  const { source, contacts } = props.model;

  return el(
    'footer',
    { class: 'shuttle-footer', attrs: { 'aria-labelledby': props.headingId }, dataset: { testid: 'source-footer' } },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.sourceTitle }),
      el('p', { text: UI_TEXT.unofficialNotice }),
      el('p', {}, [
        el('a', {
          attrs: { href: source.url, target: '_blank', rel: 'noopener noreferrer' },
          text: `${UI_TEXT.sourceLinkLabel} (${source.url})`,
        }),
      ]),
      el('p', {
        text: `${UI_TEXT.sourcePagesLabel}: ${String(source.pages.length)}개 · 원본 최근 업데이트 ${source.sourceUpdatedAt} · 반영 ${source.fetchedAt} · ${source.contentHash.slice(0, 19)}…`,
      }),
      el('p', {
        text:
          contacts === null
            ? UI_TEXT.contactsMissing
            : `${UI_TEXT.contactsLabel}: ${contacts.team} ${contacts.tel}`,
      }),
      el('p', { text: `${props.model.semester.label} (${props.model.semester.startsOn} ~ ${props.model.semester.endsOn})` }),
    ],
  );
}
