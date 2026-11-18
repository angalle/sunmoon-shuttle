/**
 * 네이버 지도 열기 (features/schedule/api) — 링크를 실행 환경에 맞게 넘기는 얇은 부작용 층.
 *
 *  - Android 앱(Capacitor): `nmap://` → Capacitor 가 ACTION_VIEW 로 네이버 지도 앱을 연다.
 *      앱이 없으면 아무 일도 안 일어나므로, 1.5초 안에 화면이 가려지지 않으면 웹 길찾기로 넘어간다.
 *  - Android 브라우저(Chrome): `intent://…;S.browser_fallback_url=…` — 앱이 없으면 Chrome 이 웹으로 넘긴다.
 *  - iPhone·iPad(Safari·홈 화면 웹앱): 웹 길찾기를 바로 연다.
 *      Safari 는 설치 안 된 앱 주소(`nmap://`)에 "주소가 유효하지 않음" 경고를 띄우고 멈춘다(2026-11-18 iOS 시뮬 실측).
 *      네이버 웹 길찾기 화면에서 앱으로 이어서 열 수 있다.
 *  - 데스크톱: 웹 길찾기를 새 탭으로.
 */
import { isNativeApp } from '../../../shared/lib/platform';
import type { NaverRouteLinks } from '../data/mapLinks';

const APP_WAIT_MS = 1500;

export type MapOpenMode = 'native-app' | 'android-web' | 'web-same-tab' | 'web-new-tab';

/** 실행 환경 → 여는 방식(순수 · 테스트용으로 분리). */
export function mapOpenMode(env: { readonly native: boolean; readonly userAgent: string; readonly maxTouchPoints: number }): MapOpenMode {
  if (env.native) return 'native-app';
  if (/Android/i.test(env.userAgent)) return 'android-web';
  if (/iPhone|iPad|iPod/i.test(env.userAgent) || (/Macintosh/i.test(env.userAgent) && env.maxTouchPoints > 1)) return 'web-same-tab';
  return 'web-new-tab';
}

export function openNaverRoute(links: NaverRouteLinks): void {
  const mode = mapOpenMode({ native: isNativeApp(), userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
  if (mode === 'web-new-tab') {
    window.open(links.web, '_blank', 'noopener');
    return;
  }
  if (mode === 'web-same-tab') {
    window.location.href = links.web;
    return;
  }
  if (mode === 'android-web') {
    window.location.href = links.intent;
    return;
  }
  // native-app — 앱이 열리면 WebView 가 가려진다(visibilitychange). 안 가려지면 웹으로.
  let left = false;
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') left = true;
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    if (!left && document.visibilityState === 'visible') window.location.href = links.web;
  }, APP_WAIT_MS);
  window.location.href = links.app;
}
