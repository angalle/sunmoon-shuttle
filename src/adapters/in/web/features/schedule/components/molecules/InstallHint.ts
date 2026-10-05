/**
 * 분자: 설치 안내 (features/schedule/components/molecules) — T7.
 *
 * 카드 지시⑤: 홈 화면 추가 안내를 **과하지 않게 1회** 보여준다.
 * - 닫기 동작·표시 여부 판정은 밖(api/installHintApi.ts + app/mount.ts)에서 하고,
 *   여기는 **표현과 이벤트 전달만** 한다(props/emit 계약 — store·localStorage 를 모른다).
 * - 색만으로 전달하지 않는다: 안내는 문구 + `role="note"` 로 읽힌다.
 * - 문구는 한/영 병기(설치 경로가 OS·언어마다 다르다) — 영어 문장에는 `lang="en"` 을 준다.
 */
import { el } from '../../../../shared/lib/dom';
import { button } from '../../../../shared/ui/atoms/Button';
import type { InstallHintPlatform } from '../../api/installHintApi';
import { UI_TEXT } from '../../types/texts';

export interface InstallHintProps {
  readonly platform: InstallHintPlatform;
  readonly headingId: string;
  readonly onDismiss: () => void;
}

function platformText(platform: InstallHintPlatform): string {
  if (platform === 'ios') return UI_TEXT.installHintIos;
  if (platform === 'android') return UI_TEXT.installHintAndroid;
  return UI_TEXT.installHintOther;
}

export function installHint(props: InstallHintProps): HTMLElement {
  return el(
    'section',
    {
      class: 'shuttle-install',
      attrs: { role: 'note', 'aria-labelledby': props.headingId },
      dataset: { testid: 'install-hint', platform: props.platform },
    },
    [
      el('h2', { class: 'shuttle-install__title', attrs: { id: props.headingId }, text: UI_TEXT.installHintTitle }),
      el('p', { class: 'shuttle-install__body', text: platformText(props.platform) }),
      el('p', { class: 'shuttle-install__en', attrs: { lang: 'en' }, text: UI_TEXT.installHintEn }),
      el('p', { class: 'shuttle-install__note', text: UI_TEXT.installHintNote }),
      button({
        label: UI_TEXT.installHintDismiss,
        variant: 'secondary',
        testid: 'install-hint-dismiss',
        onClick: () => {
          props.onDismiss();
        },
      }),
    ],
  );
}
