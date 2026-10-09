#!/usr/bin/env node
/**
 * T32 증거 하네스 — SW 캐시 무효화(SW_VERSION 범프) 실측. `docs/07-mobile-ux.md §14` · AC-U14-1·2·5.
 *
 * 왜 이 스크립트가 필요한가
 *   T31 이 코드에서 설치 안내를 지웠는데도 사용자 화면에는 계속 보였다. 원인은 **서비스워커 캐시**다:
 *   `public/sw.js` 의 `SW_VERSION` 이 `2026-10-05.1` 에 멈춰 있어, SWR(stale-while-revalidate)이
 *   **옛 셸(index.html + 옛 번들)을 먼저 응답**했다. 코드만 보고는 "정말 그런가"를 알 수 없다 —
 *   실제 브라우저에서 **옛 셸을 캐시시킨 뒤 새 SW 가 옛 캐시를 지우고 새 번들로 바꾸는지**를 수치로 잰다.
 *
 * 시나리오(의존성 0 · node:http + node:child_process + Node 내장 WebSocket)
 *   ① OLD  : `android/app/src/main/assets/public/`(T25 빌드 = **진짜 옛 번들** `index-qWPrV94-.js`,
 *            설치 안내 문구 포함, `SW_VERSION=2026-10-05.1`) 을 서빙 → 로드 → SW 등록·제어 → 옛 캐시 저장.
 *   ② MID  : **새 자산 + 옛 sw.js** 를 서빙하고 재로드 → SW 는 여전히 옛 버전이라 **캐시된 옛 셸을 먼저 응답**
 *            (SWR 실측). 이게 사용자가 본 화면이다.
 *   ③ NEW  : `dist/`(새 빌드 · `SW_VERSION=2026-10-09.1`) 로 교체 → 재로드 → SW 갱신(skipWaiting)
 *            → activate 가 **옛 버전 캐시 삭제** → 재로드(2차) → **새 번들** + DOM 금지어 0건.
 *   ④ 오프라인: 네트워크를 끊고 재로드 → SW 캐시 폴백이 깨지지 않았는지(§14-2 · AC-U14-5).
 *
 * 사용: node .session-notes/T32-sw-cache-evidence.mjs
 * 종료코드: 검사 하나라도 실패하면 1.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const OLD_ROOT = join(ROOT, 'android/app/src/main/assets/public');
const DATA_FILE = join(ROOT, 'data/timetable.json');
const SHOT_DIR = join(ROOT, '.session-notes');
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = '/sunmoon-shuttle/';
const OLD_VERSION = '2026-10-05.1';
const NEW_VERSION = '2026-10-09.1';
/** 운행일 주입 시각 — 오늘(2026-10-09 한글날)은 운행이 없어 데이터 경로 검증에 쓸 수 없다. */
const SERVICE_NOW = '2026-10-19T08:00:00+09:00';

const failures = [];
const notes = [];
const shots = [];
let cdp = null;
let chrome = null;
let server = null;
let profileDir = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(label, ok, detail = '') {
  (ok ? notes : failures).push(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
}
function info(label) {
  notes.push(`  INFO  ${label}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 서빙 루트 — 검사 도중에 바꾼다(①→②→③). `roots` 는 앞에서부터 찾고 없으면 다음으로 폴백. */
let roots = [OLD_ROOT];

function startStaticServer(port) {
  const instance = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/favicon.ico')) {
      res.writeHead(204).end();
      return;
    }
    if (!pathname.startsWith(BASE)) {
      res.writeHead(404).end('outside base');
      return;
    }
    const rel = pathname.slice(BASE.length);
    const candidate = rel === '' ? 'index.html' : rel;
    for (const root of roots) {
      const file = join(root, candidate);
      if (!file.startsWith(root) || !existsSync(file)) continue;
      const headers = { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' };
      // SW 스크립트·문서는 항상 재검증되게 한다(로컬 실측에서 HTTP 캐시가 판정을 흐리지 않도록).
      if (file.endsWith('sw.js') || file.endsWith('index.html')) headers['cache-control'] = 'no-store';
      res.writeHead(200, headers);
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404).end(`not found: ${pathname}`);
  });
  return new Promise((resolve) => instance.listen(port, '127.0.0.1', () => resolve(instance)));
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForDebugger(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page !== undefined && typeof page.webSocketDebuggerUrl === 'string') return page.webSocketDebuggerUrl;
    } catch {
      /* 아직 안 떴다 */
    }
    await delay(200);
  }
  throw new Error(`Chrome 디버거(${port}) 응답 없음`);
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const client = { socket, id: 0, pending: new Map(), listeners: new Set() };
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = client.pending.get(message.id);
        if (pending !== undefined) {
          client.pending.delete(message.id);
          if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
        return;
      }
      for (const listener of client.listeners) listener(message);
    });
    socket.addEventListener('error', reject);
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const id = ++client.id;
          return new Promise((res, rej) => {
            client.pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        on(listener) {
          client.listeners.add(listener);
        },
      }),
    );
  });
}

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(`evaluate 실패: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(`return ${expression};`);
    if (last === true) return true;
    await delay(200);
  }
  info(`대기 시간 초과(${label}) — 마지막 값: ${JSON.stringify(last)}`);
  return false;
}

async function capture(fileName, selector = null) {
  let clip = null;
  if (selector !== null) {
    const rect = await evaluate(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (node === null) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    `);
    if (rect !== null) clip = { ...rect, scale: 1 };
  }
  if (clip === null) {
    const layout = await cdp.send('Page.getLayoutMetrics');
    const contentHeight = Math.ceil(layout.cssContentSize?.height ?? 900);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: Math.min(Math.max(contentHeight, 844), 4000),
      deviceScaleFactor: 2,
      mobile: true,
    });
    await delay(150);
  }
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    ...(clip === null ? {} : { clip }),
  });
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  shots.push(path);
  // 뷰포트를 원래 크기로 되돌린다.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  return path;
}

const READY =
  'document.querySelector(\'[data-testid="loading"]\') === null && (document.querySelector(\'[data-testid="timetable-section"]\') !== null || document.querySelector(\'[data-testid="data-error"]\') !== null)';

/** 옛 셸(T25 빌드)의 준비 조건 — 스플래시가 있어 T27+ 와 같은 셀렉터가 아니다. 스크립트·본문이 있으면 본다. */
const OLD_READY = 'document.querySelector(\'script[src]\') !== null && document.body.innerText.trim().length > 20';

/** 화면 상태 한 번에 읽기 — 셸 신원(번들 이름) + 금지어 + SW/캐시 상태. */
const READ_STATE = `
  const forbidden = ['홈 화면', '전체화면', '한 번만', '하세요', '합니다'];
  const body = document.body.innerText;
  const counts = {};
  for (const phrase of forbidden) counts[phrase] = (body.match(new RegExp(phrase, 'g')) ?? []).length;
  const bundle = document.querySelector('script[src], script[src*="assets"]')?.getAttribute('src') ?? null;
  const keys = await caches.keys();
  const reg = await navigator.serviceWorker.getRegistration();
  return {
    bundle,
    counts,
    forbiddenTotal: Object.values(counts).reduce((sum, n) => sum + n, 0),
    textLen: body.trim().length,
    emptyShown: document.querySelector('[data-testid="timetable-empty"]') !== null,
    errorShown: document.querySelector('[data-testid="data-error"]') !== null,
    bodySample: body.replace(/\\s+/g, ' ').slice(0, 200),
    cacheKeys: keys.sort(),
    controllerState: reg?.active?.state ?? null,
    controlled: navigator.serviceWorker.controller !== null,
    rows: document.querySelectorAll('[data-testid="timetable-row"]').length,
    hasApp: document.querySelector('.shuttle-app') !== null,
  };
`;

/** 캐시 저장소 안의 **셸 신원**을 직접 읽는다 — "옛 셸이 캐시되어 있다"의 물증. */
const readCachedShell = (oldBundle, newBundle) => `
  const index = await caches.match('./index.html');
  const indexText = index === undefined ? '' : await index.text();
  const oldAsset = await caches.match('./${oldBundle}');
  const newAsset = await caches.match('./${newBundle}');
  return {
    hasCachedIndex: index !== undefined,
    cachedIndexHasOldBundle: indexText.includes('${oldBundle}'),
    cachedIndexHasNewBundle: indexText.includes('${newBundle}'),
    oldBundleAssetCached: oldAsset !== undefined,
    newBundleAssetCached: newAsset !== undefined,
  };
`;

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  for (const [label, path] of [
    ['dist/index.html', join(DIST, 'index.html')],
    ['dist/sw.js', join(DIST, 'sw.js')],
    ['옛 셸(android 자산)', join(OLD_ROOT, 'index.html')],
    ['data/timetable.json', DATA_FILE],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} 이 없습니다: ${path}`);
  }

  // dist 에 데이터 JSON 을 둔다(빌드 산출물에는 data/ 가 없다 — 스모크들과 같은 방식).
  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));

  const newBundle = /assets\/index-[^"']+\.js/.exec(readFileSync(join(DIST, 'index.html'), 'utf8'))?.[0] ?? '(못 찾음)';
  const oldBundle = /assets\/index-[^"']+\.js/.exec(readFileSync(join(OLD_ROOT, 'index.html'), 'utf8'))?.[0] ?? '(못 찾음)';
  const newSwVersion = /const SW_VERSION = '([^']+)'/.exec(readFileSync(join(DIST, 'sw.js'), 'utf8'))?.[1] ?? '';
  const oldSwVersion = /const SW_VERSION = '([^']+)'/.exec(readFileSync(join(OLD_ROOT, 'sw.js'), 'utf8'))?.[1] ?? '';

  // ② 단계용: 새 자산 + **옛 sw.js** 를 섞은 디렉터리(전환기 = 사용자가 겪은 상태).
  const midRoot = join(tmpdir(), `t32-mid-${String(process.pid)}`);
  cpSync(DIST, midRoot, { recursive: true });
  copyFileSync(join(OLD_ROOT, 'sw.js'), join(midRoot, 'sw.js'));

  mkdirSync(SHOT_DIR, { recursive: true });
  const webPort = await freePort();
  const debugPort = await freePort();
  server = await startStaticServer(webPort, BASE);
  profileDir = join(tmpdir(), `t32-sw-${String(process.pid)}`);
  const url = `http://127.0.0.1:${webPort}${BASE}`;

  console.log(`t32_sw_evidence: 옛 셸=${oldBundle} (SW ${oldSwVersion}) → 새 셸=${newBundle} (SW ${newSwVersion})`);
  check('SW_VERSION 이 올라갔다(2026-10-05.1 → 최신 빌드 날짜)', newSwVersion === NEW_VERSION && oldSwVersion === OLD_VERSION, `old=${oldSwVersion} new=${newSwVersion}`);
  check('옛 셸과 새 셸의 번들 해시가 다르다(교체 판정 근거)', oldBundle !== newBundle && newBundle !== '(못 찾음)', `old=${oldBundle} new=${newBundle}`);

  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      '--window-size=430,932',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const appErrors = [];

  try {
    const wsUrl = await waitForDebugger(debugPort);
    cdp = await connectCdp(wsUrl);
    cdp.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        appErrors.push(`exception: ${message.params?.exceptionDetails?.text ?? 'unknown'}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        appErrors.push(`console.error: ${(message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    // HTTP 캐시를 끈다: 판정에 쓰는 것은 **캐시 스토리지**(Service Worker)뿐이어야 한다.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
    });

    // ── ① OLD: 진짜 옛 셸(T25 빌드)을 로드·캐시 ──────────────────────────────────────
    await cdp.send('Page.navigate', { url });
    await waitFor(OLD_READY, 25_000, 'old-ready');
    check('① 옛 셸 로드 — SW 등록', await waitFor('(await navigator.serviceWorker.getRegistration()) !== undefined', 25_000, 'old-reg'));
    check('① 옛 셸 — SW 가 페이지를 제어(clients.claim)', await waitFor('navigator.serviceWorker.controller !== null', 25_000, 'old-controller'));
    // 제어 상태 재로드: 이때부터 응답이 **캐시**에서 온다(사용자 기기와 같은 상태).
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(OLD_READY, 25_000, 'old-controlled');
    const oldState = await evaluate(READ_STATE);
    const oldCachedShell = await evaluate(readCachedShell(oldBundle, newBundle));
    info(`① 옛 셸 상태: ${JSON.stringify({ bundle: oldState.bundle, forbidden: oldState.counts, cacheKeys: oldState.cacheKeys })}`);
    info(`① 캐시 저장소 물증: ${JSON.stringify(oldCachedShell)}`);
    check(
      '① 옛 셸이 실제로 옛 번들을 실행한다(캐시 저장의 전제)',
      String(oldState.bundle ?? '').includes(oldBundle.replace('assets/', '')),
      `bundle=${String(oldState.bundle)}`,
    );
    check(
      `① 옛 버전 캐시 키가 저장되어 있다(SW ${OLD_VERSION})`,
      oldState.cacheKeys.some((key) => key.endsWith(OLD_VERSION)),
      JSON.stringify(oldState.cacheKeys),
    );
    check(
      '① 캐시된 index.html 이 **옛 셸**이다(옛 번들 참조 · 새 번들 없음)',
      oldCachedShell.hasCachedIndex === true && oldCachedShell.cachedIndexHasOldBundle === true && oldCachedShell.cachedIndexHasNewBundle === false,
      JSON.stringify(oldCachedShell),
    );
    check(
      '① 옛 셸 화면에 지운 문구가 남아 있다(사용자가 본 그 화면 — 재현의 증거)',
      oldState.forbiddenTotal > 0,
      JSON.stringify(oldState.counts),
    );
    // 스플래시가 걷힌 뒤의 **실제 화면**을 찍는다(스플래시 프레임이 아니라 사용자가 본 화면).
    const hintReady = await waitFor(
      'document.querySelector(\'.shuttle-splash\') === null && document.querySelector(\'[data-testid="install-hint"]\') !== null',
      20_000,
      'old-hint-visible',
    );
    // 옛 셸은 안내 카드가 안쪽 스크롤 영역 아래에 있다 — 사용자처럼 스크롤해서 화면에 올린 뒤 찍는다.
    const scrolledTo = await evaluate(`
      const hint = document.querySelector('[data-testid="install-hint"]');
      if (hint === null) return null;
      let node = hint.parentElement;
      while (node !== null) {
        if (node.scrollHeight > node.clientHeight + 4) node.scrollTop = hint.offsetTop - 24;
        node = node.parentElement;
      }
      hint.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const r = hint.getBoundingClientRect();
      return { top: Math.round(r.top), inViewport: r.top >= 0 && r.bottom <= window.innerHeight + 1 };
    `);
    info(`① 안내 카드 스크롤 위치: ${JSON.stringify(scrolledTo)}`);
    const hintProbe = await evaluate(`
      const node = document.querySelector('[data-testid="install-hint"]');
      if (node === null) return { present: false };
      const r = node.getBoundingClientRect();
      return {
        present: true,
        visible: r.width > 0 && r.height > 0,
        text: node.innerText.replace(/\\s+/g, ' ').slice(0, 180),
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top + window.scrollY),
        scrollY: Math.round(window.scrollY),
        docHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    `);
    info(`① 설치 안내 노드: ${JSON.stringify(hintProbe)}`);
    check(
      '① 옛 셸에서 설치 안내 카드가 실제로 보인다(스플래시 걷힘 후 · 문구 원문)',
      hintReady && hintProbe.present === true && hintProbe.visible === true && String(hintProbe.text ?? '').includes('홈 화면에 추가'),
      JSON.stringify(hintProbe),
    );
    await capture('T32-1-옛셸-캐시상태.png');

    // ── ② MID: 새 자산 + 옛 sw.js → SW 는 캐시된 옛 셸을 먼저 응답(SWR) ────────────────
    roots = [midRoot, OLD_ROOT];
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(OLD_READY, 25_000, 'mid-ready');
    const midState = await evaluate(READ_STATE);
    info(`② 전환기(서버는 새 셸, SW 는 옛 버전) 상태: ${JSON.stringify({ bundle: midState.bundle, cacheKeys: midState.cacheKeys })}`);
    check(
      '② SWR — 서버가 새 셸을 줘도 **캐시된 옛 셸이 먼저** 응답된다(§14-1 의 원인)',
      String(midState.bundle ?? '').includes(oldBundle.replace('assets/', '')) === true &&
        String(midState.bundle ?? '').includes(newBundle.replace('assets/', '')) === false,
      `bundle=${String(midState.bundle)} (새 셸=${newBundle})`,
    );
    check('② 옛 버전 캐시 키가 아직 그대로다(무효화 전)', midState.cacheKeys.some((key) => key.endsWith(OLD_VERSION)) === true, JSON.stringify(midState.cacheKeys));
    await capture('T32-2-옛셸이-먼저-응답.png');

    // ── ③ NEW: 새 sw.js 로 교체 → 갱신 → activate 가 옛 캐시 삭제 → 2차 로드 ─────────────
    roots = [DIST];
    const beforeSwap = await evaluate(`const keys = await caches.keys(); return keys.sort();`);
    await cdp.send('Page.reload', { ignoreCache: false });
    let swapped = await waitFor(
      `(await caches.keys()).every((key) => !key.endsWith('${OLD_VERSION}')) && (await caches.keys()).length > 0`,
      25_000,
      'sw-swap',
    );
    if (!swapped) {
      // 브라우저가 이번 내비게이션에서 갱신을 안 봤다면 명시적 update() 로 같은 경로를 태운다.
      info('SW 자동 갱신이 지연돼 registration.update() 로 갱신 경로를 태운다(브라우저가 하는 것과 같은 호출)');
      await evaluate('const reg = await navigator.serviceWorker.getRegistration(); if (reg !== null) { await reg.update(); } return true;');
      swapped = await waitFor(
        `(await caches.keys()).every((key) => !key.endsWith('${OLD_VERSION}')) && (await caches.keys()).length > 0`,
        25_000,
        'sw-swap-retry',
      );
    }
    const afterSwap = await evaluate(`const keys = await caches.keys(); return keys.sort();`);
    info(`③ 갱신 전 캐시 키: ${JSON.stringify(beforeSwap)} → 갱신 후: ${JSON.stringify(afterSwap)}`);
    check(
      `③ activate 가 옛 버전 캐시를 지웠다(이전 버전 키 0개 — SW ${OLD_VERSION})`,
      afterSwap.every((key) => !key.endsWith(OLD_VERSION)) && afterSwap.some((key) => key.endsWith(NEW_VERSION)),
      `before=${JSON.stringify(beforeSwap)} after=${JSON.stringify(afterSwap)}`,
    );
    check('③ 새 버전 캐시 키가 생겼다', afterSwap.some((key) => key.endsWith(NEW_VERSION)), JSON.stringify(afterSwap));

    // 2차 로드 — 이제 새 셸이 나와야 한다.
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(READY, 25_000, 'new-ready');
    const newState = await evaluate(READ_STATE);
    info(`③ 2차 로드 상태: ${JSON.stringify({ bundle: newState.bundle, rows: newState.rows, counts: newState.counts })}`);
    check(
      '③ 2차 로드에서 **새 번들**이 적용된다(해시 교체 실측)',
      String(newState.bundle ?? '').includes(newBundle.replace('assets/', '')),
      `bundle=${String(newState.bundle)} 기대=${newBundle}`,
    );
    check(
      '③ 2차 로드 DOM 금지어 0건(홈 화면·전체화면·한 번만·하세요·합니다)',
      newState.forbiddenTotal === 0,
      JSON.stringify(newState.counts),
    );
    check('③ 새 셸이 SW 에 제어된다', newState.controlled === true);
    // 새 셸의 스플래시가 걷힌 뒤를 찍는다(로딩 프레임이 아니라 사용자 화면).
    await waitFor('document.querySelector(\'[data-testid="splash"]\') === null', 15_000, 'new-splash-gone');
    await capture('T32-3-2차로드-새번들.png');

    // 운행일 주입(?now=)으로 **데이터 경로**까지 확인한다 — 오늘(한글날)은 원래 운행이 없다(빈 상태가 정상).
    const serviceUrl = `${url}?now=${encodeURIComponent(SERVICE_NOW)}`;
    await cdp.send('Page.navigate', { url: serviceUrl });
    await waitFor(READY, 25_000, 'service-day-ready');
    const serviceState = await evaluate(READ_STATE);
    info(`③ 운행일(${SERVICE_NOW}) 상태: ${JSON.stringify({ bundle: serviceState.bundle, rows: serviceState.rows, empty: serviceState.emptyShown, error: serviceState.errorShown, text: serviceState.bodySample })}`);
    check(
      '③ 운행일 화면에서 시간표가 정상 렌더(행 ≥1 · 오류 UI 아님 · 앱 셸)',
      serviceState.rows >= 1 && serviceState.errorShown === false && serviceState.hasApp === true,
      `rows=${String(serviceState.rows)} error=${String(serviceState.errorShown)}`,
    );
    check('③ 운행일 화면에도 금지어 0건', serviceState.forbiddenTotal === 0, JSON.stringify(serviceState.counts));
    await waitFor('document.querySelector(\'[data-testid="splash"]\') === null', 15_000, 'service-splash-gone');
    await capture('T32-4-운행일-새셸.png');

    // ── ④ 오프라인 폴백 유지(SW 를 바꿔도 깨지지 않아야 한다) ─────────────────────────
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.send('Page.reload', { ignoreCache: false });
    const offlineOk = await waitFor(READY, 25_000, 'offline-ready');
    const offlineState = await evaluate(READ_STATE);
    check(
      '④ 오프라인 재로드 후에도 첫 화면이 뜬다(SW 변경으로 오프라인 폴백이 깨지지 않음)',
      offlineOk && offlineState.hasApp === true && offlineState.rows >= 1 && offlineState.errorShown === false,
      `rows=${String(offlineState.rows)} bundle=${String(offlineState.bundle)} error=${String(offlineState.errorShown)}`,
    );
    await waitFor('document.querySelector(\'[data-testid="splash"]\') === null', 15_000, 'offline-splash-gone');
    await capture('T32-5-오프라인-폴백.png');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    check('전 구간에서 앱 콘솔 오류 0', appErrors.length === 0, appErrors.join(' | '));

    console.log('\n검사 결과:');
    for (const line of notes) console.log(line);
    if (shots.length > 0) {
      console.log('\n스크린샷:');
      for (const path of shots) console.log(`  ${path}`);
    }
  } finally {
    try {
      await cdp?.send('Browser.close');
    } catch {
      /* 무시 */
    }
    chrome?.kill('SIGTERM');
    server?.close();
    for (const dir of [profileDir, midRoot]) {
      if (dir !== null && dir !== undefined) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* 무시 */
        }
      }
    }
  }

  if (failures.length > 0) {
    console.log('\n실패:');
    for (const line of failures) console.log(line);
    process.exitCode = 1;
  } else {
    console.log('\nT32 SW CACHE EVIDENCE: PASS');
  }
}

main().catch((error) => {
  console.error(`T32 SW CACHE EVIDENCE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  server?.close();
  process.exitCode = 1;
});
