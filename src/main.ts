/**
 * 앱 진입점(부트스트랩) — 마운트만 한다. 화면·상태·도메인 로직은 각 계층에 있다.
 * 흐름: index.html → main.ts → adapters/in/web/app/mount.ts → features/schedule/pages/SchedulePage
 */
import './adapters/in/web/shared/ui/styles/tokens.css';
import './adapters/in/web/shared/ui/styles/app.css';
import { mountScheduleApp } from './adapters/in/web/app/mount';
import { initThemeColor } from './adapters/in/web/shared/lib/theme';

const root = document.querySelector<HTMLDivElement>('#app');

// 브라우저 UI 색(theme-color)은 토큰에서 읽어 채운다 — 라이트/다크 전환도 따라간다(T7).
initThemeColor();

if (root !== null) {
  mountScheduleApp(root);
} else {
  throw new Error('#app 루트를 찾지 못했습니다 — index.html 을 확인하세요.');
}
