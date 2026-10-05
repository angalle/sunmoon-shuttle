/* 선문대 셔틀버스 시간표 — Service Worker (T6 · docs/01-architecture.md §5 캐싱 전략)
 *
 * 계약
 * 1. **앱 셸 정적 자산** = stale-while-revalidate(SWR): 즉시 표시 + 백그라운드 갱신.
 *    (index.html · 번들 js/css · manifest · 아이콘 — 해시가 붙은 자산 이름을 빌드 때 알 수 없으므로 런타임 캐시가 정본)
 * 2. **data/timetable.json** = **캐시 우선** + 백그라운드 재검증(SWR). 캐시에 있으면 네트워크를 기다리지 않고 즉시 응답하고,
 *    성공한 응답으로 캐시를 갱신한다. `contentHash`/`fetchedAt` 비교와 24h 만료 판정은 **앱(IndexedDB) 계층**이 한다
 *    (`src/application/cache/timetableCachePolicy.ts`) — 여기서는 바이트만 보관한다.
 * 3. **버전 상수로 자산 무효화**: `SW_VERSION` 을 올리면 activate 에서 이전 버전 캐시를 전부 삭제한다.
 *    배포 직후 이전 버전이 계속 보이는 문제(Pages CDN 캐시 최대 10분)를 막기 위해 `skipWaiting`+`clients.claim` 을 쓴다.
 * 4. **오프라인에서 실패하지 않는다**: 네트워크가 죽어도 캐시를 유지하고 그대로 응답한다(실패해도 캐시 유지 — docs/01 §5).
 * 5. **하위 경로 배포**: 모든 경로는 `self.registration.scope` 기준 상대경로다(`vite.config.ts` 의 `base: './'`).
 *    그래서 GitHub Pages 의 `/sunmoon-shuttle/` 에서도, 루트 배포에서도 같은 파일이 동작한다.
 * 6. **원본 학교 서버로 요청하지 않는다**(robots.txt `/Page` 차단 · 결정 D5/D7): 이 SW 는 **같은 출처의 앱 자산만** 다룬다.
 *    교차 출처 요청은 손대지 않는다(자동 크롤 금지).
 *
 * 배포 시 할 일: `SW_VERSION` 을 새 값으로 올린다(예: `2026-10-05.2`). 그 외에는 손댈 필요가 없다.
 */

const SW_VERSION = '2026-10-05.1';
const CACHE_PREFIX = 'sunmoon-shuttle';
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${SW_VERSION}`;
const DATA_CACHE = `${CACHE_PREFIX}-data-${SW_VERSION}`;

/** 이 SW 가 책임지는 범위(예: '/sunmoon-shuttle/') — 상대경로 해석의 기준 */
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const DATA_PATH = `${SCOPE_PATH}data/timetable.json`;

/** 미리 담아 둘 앱 셸 자산(상대경로 = SW 스크립트 기준). */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  // 개인정보처리방침(T11) — 오프라인에서도 앱 푸터의 방침 링크가 방침 페이지로 열리게 한다.
  './privacy.html',
  './privacy.css',
];

/* ───────────────────────── 설치: 셸 프리캐시 + 즉시 활성화 ───────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 낱개로 담는다: 자산 하나가 404 여도 **설치 자체는 실패하지 않게**(오프라인 기능을 통째로 잃지 않는다).
      const results = await Promise.allSettled(
        SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' }))),
      );
      const failed = SHELL_ASSETS.filter((_asset, index) => results[index].status === 'rejected');
      if (failed.length > 0) {
        // 실패 목록은 진단용이다(설치를 막지 않는다).
        console.warn('[sw] 셸 자산 일부를 미리 캐시하지 못했습니다:', failed.join(', '));
      }
      await self.skipWaiting();
    })(),
  );
});

/* ──────────────── 활성화: 이전 버전 캐시 삭제(자산 무효화) + 즉시 제어 ──────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter((key) => key.startsWith(CACHE_PREFIX) && !key.endsWith(SW_VERSION));
      await Promise.all(stale.map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/* ───────────────────────── 요청 처리 ───────────────────────── */

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 같은 출처의 앱 자산만 다룬다(원본 학교 서버·교차 출처 요청은 건드리지 않는다).
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;

  const cacheName = url.pathname === DATA_PATH ? DATA_CACHE : SHELL_CACHE;
  event.respondWith(staleWhileRevalidate(event, cacheName));
});

/**
 * 캐시 우선 + 백그라운드 재검증(SWR).
 * - 캐시에 있으면 **즉시** 그대로 응답하고, 갱신은 `waitUntil` 로 백그라운드에서 한다(응답을 늦추지 않는다).
 * - 캐시에 없으면 네트워크를 기다린다. 네트워크도 실패하면:
 *   내비게이션 요청은 셸(index.html)로, 그 밖에는 503 으로 정직하게 답한다(빈 화면 대신 앱이 상태를 표시할 수 있게).
 */
async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request, { ignoreSearch: true });

  if (cached !== undefined) {
    event.waitUntil(revalidate(cache, event.request));
    return cached;
  }

  const fresh = await revalidate(cache, event.request);
  if (fresh !== undefined) return fresh;

  if (event.request.mode === 'navigate') {
    const shell = await cache.match('./index.html', { ignoreSearch: true });
    if (shell !== undefined) return shell;
  }

  return new Response('오프라인 — 이 자산은 캐시에 없습니다.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/** 네트워크에서 받아 캐시에 넣는다. 실패하면 `undefined`(예외를 밖으로 내보내지 않는다). */
async function revalidate(cache, request) {
  try {
    const response = await fetch(request);
    // same-origin 정상 응답만 저장한다(opaque·redirect·부분 응답 제외).
    if (response.ok && response.type === 'basic' && !response.headers.has('content-range')) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return undefined;
  }
}
