/**
 * 앱 진입점(부트스트랩) — 마운트만 한다. 화면·상태·도메인 로직은 각 계층에 있다.
 * 흐름: index.html → main.ts → adapters/in/web/app/mount.ts → features/schedule/pages/SchedulePage
 */
import './adapters/in/web/shared/ui/styles/tokens.css';
import './adapters/in/web/shared/ui/styles/app.css';
import { mountScheduleApp } from './adapters/in/web/app/mount';

const root = document.querySelector<HTMLDivElement>('#app');

if (root !== null) {
  mountScheduleApp(root);
} else {
  throw new Error('#app 루트를 찾지 못했습니다 — index.html 을 확인하세요.');
}
