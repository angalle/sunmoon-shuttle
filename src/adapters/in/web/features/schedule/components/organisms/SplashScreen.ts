/**
 * 유기체: 스플래시 (features/schedule/components/organisms) — T24 · docs/07 §3.
 *
 * 진입 경험: 로고 + 앱 이름 + 진행 표시 + `시간표 불러오는 중` → 데이터가 준비되면 200ms 페이드아웃.
 * - 접근성: `role="status"` + `aria-live="polite"` 로 "불러오는 중"을 알린다(포커스 이동은 페이지가 한다).
 * - 광고·브랜딩 놀이터로 쓰지 않는다(표시 시간은 페이지가 400ms~2.5s 로 제한한다).
 * - 로고는 **앱 아이콘**(빌드 산출물 · SW 프리캐시 대상)이라 오프라인에서도 뜬다(외부 CDN 금지).
 * - 네이티브(Capacitor) 스플래시와 색·로고를 맞추기 위해 배경은 `--color-bg`, 아이콘은 앱 아이콘을 쓴다(T25 정합).
 */
import { el } from '../../../../shared/lib/dom';
import { spinner } from '../../../../shared/ui/atoms/Spinner';
import { UI_TEXT } from '../../types/texts';

export function splashScreen(): HTMLElement {
  return el(
    'div',
    {
      class: 'shuttle-splash',
      attrs: { role: 'status', 'aria-live': 'polite' },
      dataset: { testid: 'splash' },
    },
    [
      el('img', {
        class: 'shuttle-splash__logo',
        attrs: { src: './icons/icon-192.png', alt: '', width: '96', height: '96' },
      }),
      el('p', { class: 'shuttle-splash__title', text: UI_TEXT.appBarTitle }),
      spinner(),
      el('p', { class: 'shuttle-splash__message', text: UI_TEXT.splashMessage }),
    ],
  );
}
