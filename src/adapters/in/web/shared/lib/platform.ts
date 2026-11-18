/**
 * 실행 환경 판별 — 웹(GitHub Pages) vs Android 앱(Capacitor 네이티브 WebView).
 *
 * Capacitor 는 네이티브 WebView 에 `window.Capacitor` 브리지를 주입한다(`@capacitor/core` 를 import 하지 않아도).
 * 웹 번들에 런타임 의존성을 늘리지 않으려고 그 전역만 본다(docs/01 §2 — 런타임 의존성 0).
 */
interface CapacitorBridge {
  readonly isNativePlatform?: () => boolean;
}

export function isNativeApp(win: { readonly Capacitor?: CapacitorBridge } = window as unknown as { Capacitor?: CapacitorBridge }): boolean {
  try {
    return win.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}
