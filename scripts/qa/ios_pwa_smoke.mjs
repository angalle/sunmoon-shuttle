#!/usr/bin/env node
/**
 * iOS/PWA 경로 스모크 (T9 · docs/03 AC-7 · AC-6 부분집합) — **헤드리스 Chrome CDP**, 의존성 0.
 *
 * 왜 Chrome 인가: 이 머신에는 iOS 시뮬레이터/Xcode 전체가 없다(docs/00 §7 실측). 실기기에서만 확인 가능한
 * 항목은 scripts/qa/iOS-CHECKLIST.md 로 넘기고, **기계 검증 가능한 계약**만 여기서 실측한다.
 *   → iPhone 뷰포트·iPhone Safari UA / PWA 로 표시되는 정보 / manifest 파싱 / 아이콘·manifest HTTP 200
 *     / Service Worker 등록 / 오프라인 / standalone 표시 모드 / IndexedDB 없는 환경 폴백
 *
 * scripts/render_smoke.mjs · scripts/offline_smoke.mjs 의 **검증된 CDP 패턴을 재사용**한다
 * (node:http 정적 서버 + Node 내장 WebSocket 으로 CDP 직접 호출 · 추가 라이브러리 0).
 * 판정 기준값은 손으로 적지 않고 **계약 파일에서 파생**한다: data/timetable.json(행 수) · public/manifest.webmanifest(아이콘·표시모드).
 *
 * 원본 학교 서버로는 **요청하지 않는다**(robots.txt 차단 · 로컬 dist 만 서빙).
 *
 * 사용:
 *   node scripts/qa/ios_pwa_smoke.mjs                     # dist/ 를 /sunmoon-shuttle/ 하위 경로로 서빙
 *   node scripts/qa/ios_pwa_smoke.mjs --base=/ --shots=none
 *   node scripts/qa/ios_pwa_smoke.mjs --now=2026-10-05T14:40:00+09:00
 * 종료코드: 검사 하나라도 실패하면 1.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');
const DATA_FILE = join(ROOT, 'data', 'timetable.json');
const MANIFEST_FILE = join(ROOT, 'public', 'manifest.webmanifest');
const SHOT_DIR = join(ROOT, '.session-notes');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const BASE = normalizeBase(args.get('base') ?? '/sunmoon-shuttle/');
const NOW = args.get('now') ?? '2026-10-05T14:40:00+09:00';
const WANT_SHOTS = args.get('shots') !== 'none';
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** iPhone Safari 16 계열 UA — 앱의 iOS 분기(설치 안내 문구)와 iOS 뷰포트를 태운다. */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
/** iPhone 14/15 CSS 뷰포트(px) */
const IPHONE_VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3 };

let blockSwScripts = false;
const failures = [];
const notes = [];
const shots = [];
const apps = [];
let server = null;

function normalizeBase(value) {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}
function check(id, label, ok, detail = '') {
  const line = `  ${ok ? 'PASS' : 'FAIL'}  [${id}] ${label}${detail === '' ? '' : ` — ${detail}`}`;
  (ok ? notes : failures).push(line);
}
function info(text) {
  notes.push(`  INFO  ${text}`);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function startStaticServer(port, base) {
  const instance = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/favicon.ico')) {
      res.writeHead(204).end();
      return;
    }
    if (blockSwScripts && pathname.endsWith('/sw.js')) {
      res.writeHead(404).end('sw.js disabled for this phase');
      return;
    }
    if (!pathname.startsWith(base)) {
      res.writeHead(404).end('outside base');
      return;
    }
    const rel = pathname.slice(base.length);
    const file = rel === '' ? join(DIST, 'index.html') : join(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      res.writeHead(404).end(`not found: ${pathname}`);
      return;
    }
    const headers = { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' };
    if (file.endsWith('sw.js') || file.endsWith('index.html')) headers['cache-control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(readFileSync(file));
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

async function waitForDebugger(port, timeoutMs = 25_000) {
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

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails !== undefined) throw new Error(`evaluate 실패: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, `return ${expression};`);
    if (last === true) return true;
    await delay(200);
  }
  info(`대기 시간 초과(${label}) — 마지막 값: ${JSON.stringify(last)}`);
  return false;
}

async function capture(cdp, fileName, selector = null) {
  if (!WANT_SHOTS) return null;
  let clip = null;
  if (selector !== null) {
    const rect = await evaluate(
      cdp,
      `const node = document.querySelector(${JSON.stringify(selector)});
       if (node === null) return null;
       const r = node.getBoundingClientRect();
       return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };`,
    );
    if (rect !== null) clip = { ...rect, scale: 1 };
  }
  if (clip === null) {
    const layout = await cdp.send('Page.getLayoutMetrics');
    const height = Math.ceil(layout.cssContentSize?.height ?? 1200);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: IPHONE_VIEWPORT.width,
      height: Math.min(height, 9000),
      deviceScaleFactor: 2,
      mobile: true,
    });
    await delay(150);
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip === null ? {} : { clip }) });
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  shots.push(path);
  return path;
}

/**
 * 앱이 로딩을 끝낸 상태(데이터 성공이든 오류 UI 든).
 * T27 §9-1 — 본문은 시간표 하나다(`[data-testid="timetable"]` 표는 T14 이후 UI 에 없다).
 * 운행 없는 날은 목록 대신 빈 안내(`timetable-empty`)가 그 자리다.
 */
const READY =
  '(() => {' +
  ' const loading = document.querySelector(\'[data-testid="loading"]\') === null;' +
  ' const body = document.querySelector(\'[data-testid="timetable-list"]\') !== null || document.querySelector(\'[data-testid="timetable-empty"]\') !== null;' +
  ' const failed = document.querySelector(\'[data-testid="data-error"]\') !== null;' +
  ' return loading && (body || failed);' +
  ' })()';

const READ_STATE = `
  const listCard = document.querySelector('[data-testid="timetable-section"]');
  const notice = document.querySelector('[data-testid="offline-notice"]');
  const hint = document.querySelector('[data-testid="install-hint"]');
  const tabs = [...document.querySelectorAll('[data-testid="day-tabs"] [role="tab"]')];
  const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
  const nextRow = document.querySelector('[data-testid="timetable-row"][data-next="true"]');
  return {
    hasApp: document.querySelector('.shuttle-app') !== null,
    hasCard: listCard !== null,
    // T27: 행 수가 곧 그 요일 판정 편수다 — 섹션이 없으면 null(오류 UI 등).
    rows: listCard === null ? null : listCard.querySelectorAll('[data-testid="timetable-row"]').length,
    listDay: listCard?.dataset.day ?? null,
    emptyShown: document.querySelector('[data-testid="timetable-empty"]') !== null,
    nextTime: nextRow === null ? null : (nextRow.querySelector('.shuttle-departure__time')?.textContent ?? null),
    selectedTab: selected?.id ?? null,
    offlineNotice: notice === null ? null : { source: notice.dataset.source ?? null, text: notice.textContent },
    installHint: hint === null ? null : { platform: hint.dataset.platform ?? null, text: hint.textContent },
    errorBanner: document.querySelector('[data-testid="data-error"]') !== null,
    swController: navigator.serviceWorker.controller !== null,
  };
`;

const READ_IDB = `
  return await new Promise((resolve) => {
    if (!('indexedDB' in window) || window.indexedDB === undefined) { resolve('no-indexeddb'); return; }
    const request = indexedDB.open('sunmoon-shuttle', 1);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('timetable_cache')) { db.close(); resolve(null); return; }
      const get = db.transaction('timetable_cache', 'readonly').objectStore('timetable_cache').get('current');
      get.onerror = () => { db.close(); resolve(null); };
      get.onsuccess = () => {
        db.close();
        const value = get.result;
        resolve(value === undefined || value === null ? null : { contentHash: value.contentHash ?? null, cachedAtMs: value.cachedAtMs ?? null, routeCount: Array.isArray(value.raw?.routes) ? value.raw.routes.length : null });
      };
    };
  });
`;

async function launch(port, extraArgs) {
  const profileDir = join(tmpdir(), `t9-ios-${String(port)}-${String(process.pid)}`);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${String(port)}`,
      ...extraArgs,
    ],
    { stdio: 'ignore' },
  );
  const wsUrl = await waitForDebugger(port);
  const cdp = await connectCdp(wsUrl);
  apps.push({ chrome, cdp, profileDir });
  return cdp;
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  if (!existsSync(join(DIST, 'sw.js'))) throw new Error('dist/sw.js 가 없습니다 — public/sw.js 를 확인하세요.');
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');
  if (!existsSync(MANIFEST_FILE)) throw new Error('public/manifest.webmanifest 가 없습니다.');

  const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const rowsOf = (routeId, dayType) => data.routes.find((route) => route.id === routeId)?.byDay?.[dayType]?.trips?.length ?? 0;
  const asanWeekday = rowsOf('asan-ktx', 'weekday');
  const asanSaturday = rowsOf('asan-ktx', 'saturday');
  /**
   * 발행물에서 계산한 **그 요일 기대 행 수** — 출발 시각이 있는 회차만(앱의 행 수와 같은 필터).
   * T27 §9-1 로 본문이 `그 요일 전체 회차`가 됐으므로 행 수가 곧 그 요일 판정 편수다.
   */
  const hasDepartureTime = (row) => (row['depCampus'] ?? row['depStation'] ?? row['depTerminal'] ?? null) !== null;
  const expectedRowsOf = (dayType) =>
    data.routes.reduce((sum, route) => {
      const table = route.byDay?.[dayType];
      if (table === null || table === undefined) return sum;
      return sum + table.trips.filter((row) => hasDepartureTime(row)).length;
    }, 0);
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));

  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));
  mkdirSync(SHOT_DIR, { recursive: true });

  const webPort = await freePort();
  server = await startStaticServer(webPort, BASE);
  const base = `http://127.0.0.1:${String(webPort)}${BASE}`;
  const urlFor = (now) => `${base}?now=${encodeURIComponent(now)}`;

  console.log(`ios_pwa_smoke: base=${BASE} now=${NOW} asan-ktx 평일=${String(asanWeekday)} 토=${String(asanSaturday)} manifest icons=${String(manifest.icons?.length ?? 0)}`);

  /* ═════════ Phase A. iPhone 뷰포트 · 온라인 ═════════ */
  const cdp = await launch(await freePort(), ['--window-size=390,844', 'about:blank']);
  const appErrors = [];
  const networkLogs = [];
  const warnings = [];
  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') appErrors.push(`exception: ${message.params?.exceptionDetails?.text ?? 'unknown'}`);
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
      if (message.params?.type === 'error') appErrors.push(`console.error: ${text}`);
      if (message.params?.type === 'warning') warnings.push(`console.warn: ${text}`);
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      const text = message.params.entry.text ?? '';
      const isResourceLog = /net::ERR_|Failed to load resource|HTTP response code/.test(text);
      (isResourceLog ? networkLogs : appErrors).push(`log: ${text} (${message.params.entry.url ?? ''})`);
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...IPHONE_VIEWPORT, mobile: true });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  await cdp.send('Page.navigate', { url: urlFor(NOW) });

  check('A.render', 'iPhone 뷰포트(390x844)에서 첫 화면 렌더', await waitFor(cdp, READY, 25_000, 'A-ready'));
  const a = await evaluate(cdp, READ_STATE);
  // T27 §9-1: 본문이 그 요일 전체 회차 목록이 됐다 — 행 수를 발행물의 그 요일 편수와 대조한다.
  check(
    'A.rows',
    '시간표 행 수 = data/timetable.json(그 요일 전체 회차)',
    a.rows !== null && a.rows === expectedRowsOf(String(a.listDay)),
    `day=${String(a.listDay)} rows=${String(a.rows)} json(그 요일)=${String(expectedRowsOf(String(a.listDay)))}`,
  );
  check('A.next-departure', '다음 출발 행이 강조되어 시각이 보인다', String(a.nextTime ?? '').length > 0, `next=${String(a.nextTime)}`);
  check('A.ua-ios-hint', 'iPhone UA → 설치 안내가 iOS 문구("홈 화면에 추가")', a.installHint?.platform === 'ios' && String(a.installHint?.text ?? '').includes('홈 화면에 추가'), JSON.stringify(a.installHint?.platform));

  const head = await evaluate(
    cdp,
    `const q = (sel) => document.querySelector(sel);
     const meta = (name) => q('meta[name="' + name + '"]')?.getAttribute('content') ?? null;
     const link = (rel) => q('link[rel="' + rel + '"]')?.getAttribute('href') ?? null;
     return {
       themeColor: meta('theme-color'),
       bgToken: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
       appleCapable: meta('apple-mobile-web-app-capable'),
       appleTitle: meta('apple-mobile-web-app-title'),
       viewport: meta('viewport'),
       manifestHref: link('manifest'),
       appleTouch: link('apple-touch-icon'),
       manifestHrefResolved: q('link[rel="manifest"]')?.href ?? null,
     };`,
  );
  // 빌드 CSS 는 hex 를 압축한다(`#ffffff` → `#fff`) — 그래서 "6자리 hex" 를 요구하지 않고
  //   **--color-bg 토큰과 같은 색인지**로 본다(빈 값 아님 + 하드코딩 아님을 함께 확인).
  const rgbOf = (value) => {
    const text = String(value).trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex !== null) {
      const short = hex[1];
      const full = short.length === 3 ? `${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}` : short;
      return `rgb(${String(parseInt(full.slice(0, 2), 16))}, ${String(parseInt(full.slice(2, 4), 16))}, ${String(parseInt(full.slice(4, 6), 16))})`;
    }
    const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
    if (rgb === null) return null;
    return `rgb(${rgb[1]
      .split(',')
      .slice(0, 3)
      .map((part) => String(Number(part.trim())))
      .join(', ')})`;
  };
  check(
    'A.theme-color-runtime',
    'theme-color 가 --color-bg 토큰 값으로 실제로 채워진다(빈 값·하드코딩 아님)',
    rgbOf(head.themeColor) !== null && rgbOf(head.themeColor) === rgbOf(head.bgToken),
    `content="${String(head.themeColor)}" · 토큰 --color-bg=${String(head.bgToken)}`,
  );
  check('A.apple-meta-runtime', 'apple-mobile-web-app-capable/title 이 DOM 에 있다', head.appleCapable === 'yes' && String(head.appleTitle ?? '').length > 0, `capable=${String(head.appleCapable)} title=${String(head.appleTitle)}`);
  check('A.viewport-runtime', 'viewport-fit=cover 가 실제로 적용', /viewport-fit\s*=\s*cover/.test(String(head.viewport)), String(head.viewport));

  const appManifest = await cdp.send('Page.getAppManifest');
  const manifestErrors = (appManifest.errors ?? []).filter((entry) => entry.critical === 1 || entry.critical === true);
  check(
    'A.manifest-parse',
    '브라우저가 manifest 를 오류 없이 파싱(Page.getAppManifest)',
    appManifest.url !== undefined && manifestErrors.length === 0,
    `url=${String(appManifest.url)} critical=${JSON.stringify(manifestErrors)}`,
  );
  // CDP 는 파싱 결과를 `data`(매니페스트 원문 문자열)로 준다 — 아이콘 개수는 그 원문에서 파생해 대조한다.
  let browserManifest = null;
  try {
    browserManifest = JSON.parse(String(appManifest.data ?? ''));
  } catch {
    browserManifest = appManifest.parsed?.manifest ?? null;
  }
  check(
    'A.manifest-declared-icons',
    `파싱된 manifest 아이콘 ${String(manifest.icons?.length ?? 0)}종(192/512/maskable-192/512)`,
    Array.isArray(browserManifest?.icons) && browserManifest.icons.length === (manifest.icons?.length ?? 0),
    `browser=${String(browserManifest?.icons?.length ?? 0)} file=${String(manifest.icons?.length ?? 0)}`,
  );

  // manifest · 아이콘 HTTP 200 (실제 배포 경로에서 응답하는지 — 정적 검사가 못 보는 부분)
  const assetPaths = ['manifest.webmanifest', 'apple-touch-icon.png', 'favicon.svg', 'icons/favicon-32.png', ...(manifest.icons ?? []).map((icon) => String(icon.src).replace(/^\.\//, ''))];
  const assetResults = [];
  for (const asset of [...new Set(assetPaths)]) {
    const response = await fetch(`${base}${asset}`).catch(() => null);
    assetResults.push({ asset, status: response === null ? 0 : response.status, type: response === null ? null : response.headers.get('content-type') });
  }
  const badAssets = assetResults.filter((entry) => entry.status !== 200);
  check('A.assets-200', `manifest·아이콘 ${String(assetResults.length)}종 HTTP 200`, badAssets.length === 0, badAssets.length === 0 ? assetResults.map((entry) => `${entry.asset}:${String(entry.status)}`).join(' ') : badAssets.map((entry) => `${entry.asset}: HTTP ${String(entry.status)}`).join(' | '));
  const manifestType = assetResults.find((entry) => entry.asset === 'manifest.webmanifest');
  check('A.manifest-mime', 'manifest Content-Type = application/manifest+json', String(manifestType?.type ?? '').includes('application/manifest+json'), String(manifestType?.type));

  check('A.sw-registered', 'Service Worker 등록 성공', await waitFor(cdp, '(await navigator.serviceWorker.getRegistration()) !== undefined', 25_000, 'A-sw'));
  await cdp.send('Page.reload', { ignoreCache: false });
  check('A.reload-ready', '재로드 후 화면 렌더(SW 제어 상태)', await waitFor(cdp, READY, 25_000, 'A-reload'));
  check('A.sw-controller', 'SW 가 페이지를 제어(clients.claim)', await waitFor(cdp, 'navigator.serviceWorker.controller !== null', 20_000, 'A-claim'));
  const idb = await evaluate(cdp, READ_IDB);
  check('A.idb-record', 'IndexedDB 캐시 레코드 저장(contentHash·저장시각)', idb !== null && idb !== 'no-indexeddb' && typeof idb.contentHash === 'string' && typeof idb.cachedAtMs === 'number', JSON.stringify(idb));

  const layout = await evaluate(
    cdp,
    `const appEl = document.querySelector('.shuttle-app');
     const before = getComputedStyle(appEl).paddingTop;
     document.documentElement.style.setProperty('--safe-area-top', '59px');
     const after = getComputedStyle(appEl).paddingTop;
     document.documentElement.style.removeProperty('--safe-area-top');
     const scroll = document.querySelector('.shuttle-table-scroll');
     return {
       before, after,
       innerWidth: window.innerWidth,
       docScrollWidth: document.documentElement.scrollWidth,
       tableOverflowX: scroll === null ? null : getComputedStyle(scroll).overflowX,
       safeAreaToken: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top').trim(),
     };`,
  );
  check('A.no-horizontal-overflow', '가로 스크롤(페이지 전체) 없음 — iPhone 폭에서 잘리지 않음', layout.docScrollWidth <= layout.innerWidth + 1, `docScrollWidth=${String(layout.docScrollWidth)} innerWidth=${String(layout.innerWidth)}`);
  check(
    'A.safe-area-wiring',
    '안전영역 토큰이 레이아웃 여백을 실제로 바꾼다(노치 주입 모사: 59px)',
    Number.parseFloat(layout.after) >= 58 && Number.parseFloat(layout.after) > Number.parseFloat(layout.before),
    `padding-top ${String(layout.before)} → ${String(layout.after)} (토큰 기본값=${String(layout.safeAreaToken)}, 표 오버플로=${String(layout.tableOverflowX)})`,
  );
  check('A.console-errors', '앱이 낸 콘솔 오류 0', appErrors.length === 0, appErrors.join(' | '));
  const onlineShot = await capture(cdp, 'T9-1-아이폰뷰포트-온라인.png');

  /* ═════════ Phase B. 오프라인 (AC-6 부분집합) ═════════ */
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Page.reload', { ignoreCache: false });
  const offlineReady = await waitFor(cdp, READY, 25_000, 'B-offline');
  check('B.offline-first-screen', '오프라인 새로고침 후 첫 화면', offlineReady);
  const b = await evaluate(cdp, READ_STATE);
  check(
    'B.offline-rows',
    '오프라인 시간표 행 수 = 계약 JSON(그 요일 전체 회차)',
    b.rows !== null && b.rows === expectedRowsOf(String(b.listDay)),
    `day=${String(b.listDay)} rows=${String(b.rows)} json=${String(expectedRowsOf(String(b.listDay)))}`,
  );
  check('B.offline-next-departure', '오프라인에서도 다음 출발 행 강조가 동작', String(b.nextTime ?? '').length > 0, `next=${String(b.nextTime)}`);
  const offlineShot = await capture(cdp, 'T9-2-오프라인-첫화면.png');
  const tabClicked = await evaluate(
    cdp,
    `const node = document.querySelector('#shuttle-day-tab-saturday');
     if (node === null) return false;
     node.click();
     return true;`,
  );
  await delay(250);
  const saturday = await evaluate(cdp, READ_STATE);
  check('B.offline-day-switch', '오프라인 요일 전환(토요일 행 수 = 계약 JSON)', tabClicked && saturday.selectedTab === 'shuttle-day-tab-saturday' && saturday.rows === expectedRowsOf('saturday'), `selected=${String(saturday.selectedTab)} rows=${String(saturday.rows)} json=${String(expectedRowsOf('saturday'))}`);
  const saturdayShot = await capture(cdp, 'T9-3-오프라인-요일전환.png');
  check('B.console-errors', '오프라인에서 앱이 낸 콘솔 오류 0', appErrors.length === 0, appErrors.join(' | '));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  /* ═════════ Phase D. IndexedDB 없는 환경(Safari 프라이빗 모드 모사) ═════════ */
  const unregistered = await evaluate(
    cdp,
    `const registrations = await navigator.serviceWorker.getRegistrations();
     await Promise.all(registrations.map((registration) => registration.unregister()));
     const keys = await caches.keys();
     await Promise.all(keys.map((key) => caches.delete(key)));
     return { unregistered: registrations.length, caches: keys.length };`,
  );
  blockSwScripts = true;
  info(`Phase D 준비 — SW 해제 + 캐시 삭제 + sw.js 404: ${JSON.stringify(unregistered)}`);
  const errorsBeforeD = appErrors.length;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });",
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  const noIdbReady = await waitFor(cdp, READY, 25_000, 'D-no-idb');
  check('D.no-idb-render', 'IndexedDB 없는 환경에서도 화면이 뜬다(예외 없음)', noIdbReady);
  const d = await evaluate(cdp, READ_STATE);
  check('D.no-idb-rows', 'IndexedDB 없음 → 네트워크 경로로 데이터 표시(행 수 = 계약 JSON)', d.rows !== null && d.rows === expectedRowsOf(String(d.listDay)), `day=${String(d.listDay)} rows=${String(d.rows)} json=${String(expectedRowsOf(String(d.listDay)))}`);
  check('D.no-idb-source', 'IndexedDB 없음 → 캐시 폴백 배너 없이 네트워크 성공으로 처리', d.offlineNotice === null, JSON.stringify(d.offlineNotice));
  check('D.no-idb-not-error-ui', '오류 UI(F8)로 가지 않는다 — 조용한 실패도 아니다', d.errorBanner === false);
  const noIdbIdb = await evaluate(cdp, READ_IDB);
  check('D.no-idb-detect', '앱이 IndexedDB 부재를 감지(읽기 시도가 no-op)', noIdbIdb === 'no-indexeddb' || noIdbIdb === null, JSON.stringify(noIdbIdb));
  check('D.no-idb-console-errors', 'IndexedDB 없는 환경에서 앱이 낸 콘솔 오류 0', appErrors.length === errorsBeforeD, appErrors.slice(errorsBeforeD).join(' | '));
  const noIdbShot = await capture(cdp, 'T9-5-IndexedDB없음-폴백.png');

  /* ═════════ Phase C. standalone 표시 모드 (홈 화면 실행 모사) ═════════ */
  const standalonePort = await freePort();
  const cdp2 = await launch(standalonePort, [`--app=${urlFor(NOW)}`]);
  await cdp2.send('Runtime.enable');
  await cdp2.send('Page.enable');
  await cdp2.send('Emulation.setDeviceMetricsOverride', { ...IPHONE_VIEWPORT, mobile: true });
  const standaloneReady = await waitFor(cdp2, READY, 25_000, 'C-standalone');
  const standalone = await evaluate(
    cdp2,
    `const listCard = document.querySelector('[data-testid="timetable-section"]');
     return {
       standalone: matchMedia('(display-mode: standalone)').matches,
       hint: document.querySelector('[data-testid="install-hint"]') === null ? null : document.querySelector('[data-testid="install-hint"]')?.dataset.platform ?? 'present',
       hasApp: document.querySelector('.shuttle-app') !== null,
       listDay: listCard?.dataset.day ?? null,
       rows: listCard === null ? -1 : listCard.querySelectorAll('[data-testid="timetable-row"]').length,
     };`,
  );
  check('C.standalone-mode', '홈 화면 실행 모사(--app=)에서 display-mode: standalone = true', standaloneReady && standalone.standalone === true, JSON.stringify(standalone));
  check(
    'C.standalone-rows',
    '전체화면에서도 시간표 렌더(행 수 = 계약 JSON)',
    standalone.rows === expectedRowsOf(String(standalone.listDay)),
    `day=${String(standalone.listDay)} rows=${String(standalone.rows)} json=${String(expectedRowsOf(String(standalone.listDay)))}`,
  );
  check('C.standalone-no-hint', '이미 설치(standalone) 상태면 설치 안내를 띄우지 않는다', standalone.hint === null, `hint=${JSON.stringify(standalone.hint)}`);
  const standaloneShot = await capture(cdp2, 'T9-4-standalone-전체화면.png');

  /* ═════════ 요약 ═════════ */
  info(`브라우저가 낸 자원 실패 로그 ${String(networkLogs.length)}건(요청 실패 주입·sw.js 404 의 필연적 결과 — 앱 오류 아님)`);
  for (const log of networkLogs.slice(0, 4)) info(log);
  info(`콘솔 경고 ${String(warnings.length)}건${warnings.length === 0 ? '' : `: ${warnings.slice(0, 3).join(' | ')}`}`);
  for (const unused of [onlineShot, offlineShot, saturdayShot, noIdbShot, standaloneShot]) void unused;

  console.log('\n검사 결과:');
  for (const line of notes) console.log(line);
  if (shots.length > 0) {
    console.log('\n스크린샷:');
    for (const path of shots) console.log(`  ${path}`);
  }
}

async function cleanup() {
  for (const app of apps) {
    try {
      await app.cdp.send('Browser.close');
    } catch {
      /* 무시 */
    }
    app.chrome.kill('SIGTERM');
    try {
      rmSync(app.profileDir, { recursive: true, force: true });
    } catch {
      /* 무시 */
    }
  }
  server?.close();
}

main()
  .then(async () => {
    await cleanup();
    if (failures.length > 0) {
      console.log('\n실패:');
      for (const line of failures) console.log(line);
      process.exitCode = 1;
    } else {
      console.log('\nIOS PWA SMOKE: PASS');
    }
  })
  .catch(async (error) => {
    console.error(`IOS PWA SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
    console.log('\n여기까지의 검사 결과:');
    for (const line of notes) console.log(line);
    for (const line of failures) console.log(line);
    await cleanup();
    process.exitCode = 1;
  });
