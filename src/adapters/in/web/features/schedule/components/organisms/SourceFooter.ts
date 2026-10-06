/**
 * 유기체: 출처·고지 푸터 (features/schedule/components/organisms) — F6 · T14.
 *
 * T14 규칙(사용자 지시 `원본은 왜 보여?`):
 *  - **출처 표시는 대표 페이지 1줄 + 링크 1개**로 끝낸다(`출처: 선문대학교 셔틀버스 안내 페이지`).
 *    노선·요일별 페이지 링크 목록(11개)·contentHash·"최근 업데이트" 같은 내부 사정은 화면에 내보내지 않는다.
 *  - 비공식 고지는 유지한다(저작권·스토어 요건) — `tests/web/privacy.test.ts` 가 문구 정합을 검사한다.
 *  - 개인정보처리방침 링크는 내부 정적 페이지(`./privacy.html`)로 간다(내부 링크 → rel/target 불필요).
 *
 * 부수효과로 화면의 `https://lily.sunmoon.ac.kr` 링크는 **정확히 1개**가 된다(스모크 계약).
 */
import { el } from '../../../../shared/lib/dom';
import type { TimetableModel } from '../../types/model';
import { UI_TEXT } from '../../types/texts';

export interface SourceFooterProps {
  readonly model: TimetableModel;
  readonly headingId: string;
  /**
   * T17 — 방학 배너가 자기 소스 링크(같은 학교 도메인)를 그릴 때 `true` 로 온다.
   * 화면에 학교 링크가 **2개**가 되면 T14 계약(`학교 링크 ≤1`)이 깨지므로, 그때는 대표 링크 문구만
   * 남기고 앵커를 접는다(배너 쪽 링크가 그 기간의 정본 페이지다).
   */
  readonly hideSourceLink?: boolean;
}

export function sourceFooter(props: SourceFooterProps): HTMLElement {
  const { source, contacts } = props.model;
  const sourceLine =
    props.hideSourceLink === true
      ? // 방학 배너가 링크를 갖는다 — 여기서는 어떤 페이지인지만 문구로 남긴다.
        el('span', { text: `${UI_TEXT.sourceLinePrefix}: ${UI_TEXT.sourceLineLabel}` })
      : el('span', { text: `${UI_TEXT.sourceLinePrefix}: ${UI_TEXT.sourceLineLabel} — ` });

  return el(
    'footer',
    { class: 'shuttle-footer', attrs: { 'aria-labelledby': props.headingId }, dataset: { testid: 'source-footer' } },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.sourceTitle }),
      el('p', { text: UI_TEXT.unofficialNotice }),
      // 출처 1줄 — 대표 URL 하나만 링크한다(노선·요일별 링크 목록 금지, T14).
      el('p', { dataset: { testid: 'source-line' } }, [
        sourceLine,
        props.hideSourceLink === true
          ? null
          : el('a', {
              attrs: { href: source.url, target: '_blank', rel: 'noopener noreferrer' },
              dataset: { testid: 'source-link' },
              text: UI_TEXT.sourceLinkLabel,
            }),
      ]),
      // 개인정보처리방침(T11) — 앱과 같은 출처의 정적 페이지로 간다(내부 링크 → rel/target 불필요).
      el('p', {}, [
        el('a', {
          attrs: { href: './privacy.html' },
          dataset: { testid: 'privacy-link' },
          text: UI_TEXT.privacyLinkLabel,
        }),
      ]),
      el('p', {
        dataset: { testid: 'contacts-line' },
        text:
          contacts === null
            ? UI_TEXT.contactsMissing
            : `${UI_TEXT.contactsLabel}: ${contacts.team} ${contacts.tel}`,
      }),
      el('p', { text: `${props.model.semester.label} (${props.model.semester.startsOn} ~ ${props.model.semester.endsOn})` }),
    ],
  );
}
