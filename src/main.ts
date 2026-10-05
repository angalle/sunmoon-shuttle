/**
 * 앱 진입점(부트스트랩). T0 골격 단계에서는 **번들이 실제로 빌드되는 최소 동작**만 둔다.
 * 화면(요일 탭·표·카운트다운·신선도)은 T5 가 `src/adapters/in/web/**` 에 구현하고 이 파일에서 마운트한다.
 * 여기서 화면 로직을 구현하지 않는다(경계 — UI 는 T5 소관).
 */
import { DAY_TYPES, type DayType } from './domain/entities/DayType';

const root = document.querySelector<HTMLDivElement>('#app');

if (root !== null) {
  const supported: DayType[] = [...DAY_TYPES];
  root.textContent = `선문대 셔틀버스 시간표 — 골격 빌드 OK (요일 구분: ${supported.join(' / ')}) · 화면은 T5`;
}
