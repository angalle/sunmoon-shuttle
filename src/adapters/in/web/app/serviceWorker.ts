/**
 * Service Worker 등록 (app/ — **등록 경로는 앱 엔트리에서 이 1곳뿐** · T6 ④).
 *
 * 계약
 * - 배포본(빌드)에서만 등록한다(`import.meta.env.PROD`). 개발 서버(HMR)에서는 등록하지 않아 캐시가 개발을 방해하지 않는다.
 * - 파일은 `public/sw.js` → 빌드 산출물 루트(`dist/sw.js`). 상대경로 `./sw.js` 로 등록해야
 *   Pages 하위 경로(`/sunmoon-shuttle/`)에서 scope 가 그 하위로 잡힌다(`vite.config.ts` 의 `base: './'`).
 * - 실패는 **콘솔 error 가 아니라 warn** 으로 남긴다(AC-5 콘솔 오류 0). SW 가 없어도 앱은 그대로 동작한다.
 * - 등록 후 `update()` 를 한 번 불러 배포 직후 이전 버전 방지에 힘쓴다(무효화 정본은 `sw.js` 의 버전 상수).
 */
export interface RegisterServiceWorkerOptions {
  /** 등록 여부(기본: 빌드 산출물에서만). 테스트에서 끼워 넣는다. */
  readonly enabled?: boolean | undefined;
  /** SW 스크립트 경로(문서 기준 상대) */
  readonly scriptPath?: string | undefined;
  readonly warn?: ((message: string, error: unknown) => void) | undefined;
}

export function registerServiceWorker(options: RegisterServiceWorkerOptions = {}): void {
  const enabled = options.enabled ?? import.meta.env.PROD;
  if (!enabled) return;
  const warn = options.warn ?? ((message: string, error: unknown) => { console.warn(message, error); });
  if (!('serviceWorker' in navigator)) {
    warn('[sw] 이 브라우저는 Service Worker 를 지원하지 않습니다 — 캐시 없이 동작합니다.', null);
    return;
  }
  const scriptPath = options.scriptPath ?? './sw.js';
  void navigator.serviceWorker
    .register(scriptPath)
    .then((registration) => {
      // 배포 직후 갱신 확인 — 실패는 무해하다(다음 내비게이션에서 다시 확인).
      void registration.update().catch(() => undefined);
    })
    .catch((error: unknown) => {
      warn('[sw] Service Worker 등록 실패 — 네트워크 계층 없이 동작합니다.', error);
    });
}
