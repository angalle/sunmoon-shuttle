/**
 * 유기체: 바로가기 카드 (features/schedule/components/organisms) — T24 · docs/07 §4-1 ④.
 *
 * [지금] 화면의 마지막 카드. 접힘(`<details>`) 대신 **별도 화면/시트로 이동**한다:
 *  - `전체 시간표 보기` → [전체] 탭으로 전환
 *  - `이용 안내`        → 이용 안내 시트 열기
 * 이동 결정은 페이지가 한다(여기는 콜백만 받는다 — organisms 는 라우팅을 결정하지 않는다, 스킬 §2).
 */
import { el } from '../../../../shared/lib/dom';
import { button } from '../../../../shared/ui/atoms/Button';
import { UI_TEXT } from '../../types/texts';

export interface ShortcutCardProps {
  readonly headingId: string;
  readonly onOpenAll: () => void;
  readonly onOpenGuide: () => void;
}

export function shortcutCard(props: ShortcutCardProps): HTMLElement {
  return el(
    'section',
    {
      class: 'shuttle-card shuttle-shortcut',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'shortcut-card' },
    },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.shortcutTitle }),
      el('div', { class: 'shuttle-shortcut__actions' }, [
        button({
          label: UI_TEXT.shortcutAll,
          variant: 'primary',
          testid: 'shortcut-all',
          onClick: props.onOpenAll,
        }),
        button({
          label: UI_TEXT.shortcutGuide,
          variant: 'secondary',
          testid: 'shortcut-guide',
          onClick: props.onOpenGuide,
        }),
      ]),
    ],
  );
}
