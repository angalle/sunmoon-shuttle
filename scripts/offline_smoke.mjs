#!/usr/bin/env node
/**
 * 오프라인 · 수집 실패 폴백 스모크 (T6 · AC-5 · AC-6) — **헤드리스 Chrome CDP**, 의존성 0.
 *
 * 검증하는 것 (docs/03 §1 AC-5·AC-6)
 *  ① 캐시 계층이 실제로 채워진다: Service Worker 등록·제어 + 셸/데이터 캐시 + IndexedDB 레코드(원문·contentHash·저장시각)
 *  ② **오프라인**(AC-6): 네트워크를 끊고 새로고침해도 첫 화면이 뜨고, 요일 전환·다음 출발 행 강조가 동작한다(T27 §9)
 *  ③ **수집 실패 폴백**(AC-5): 데이터 요청만 실패시키면 **마지막 정상 데이터**를 표시하고, 앱이 낸 콘솔 오류는 0
 *  ④ 캐시 나이 24h 초과: 캐시는 그대로 쓰되 "24시간 초과" 를 문구로 알린다(docs/01 §5 만료 정책)
 *  ⑤ 캐시조차 없을 때: 조용히 빈 화면이 되지 않고 **오류 UI(F8)** 로 정직하게 실패한다
 *
 * 의존성 0: node:http·node:child_process + Node 내장 WebSocket(≥22) 로 CDP 를 직접 말한다(런타임 의존성 0 계약 유지).
 * 원본 학교 서버로는 **요청하지 않는다**(robots.txt `/Page` 차단 · 로컬 dist 만 서빙). CDP 로 끊는 것은 로컬 자산뿐이다.
 *
 * 사용:
 *   node scripts/offline_smoke.mjs                        # dist/ 를 /sunmoon-shuttle/ 하위 경로로 서빙
 *   node scripts/offline_smoke.mjs --base=/               # 루트 경로
 *   node scripts/offline_smoke.mjs --now=2026-10-05T14:40:00+09:00
 *   node scripts/offline_smoke.mjs --shots=none           # 스크린샷 생략(빠른 확인)
 * 종료코드: 검사 하나라도 실패하면 1.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const DATA_FILE = join(ROOT, 'data', 'timetable.json');
const SHOT_DIR = join(ROOT, '.session-notes');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const BASE = normalizeBase(args.get('base') ?? '/sunmoon-shuttle/');
const NOW = args.get('now') ?? '2026-10-05T14:40:00+09:00';
/** 만료 경로 검증용 두 번째 시각(5일 뒤) — 캐시 나이 24h 초과 */
const NOW_EXPIRED = args.get('now-expired') ?? '2026-10-10T14:40:00+09:00';
const WANT_SHOTS = args.get('shots') !== 'none';
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * `true` 면 정적 서버가 `sw.js` 를 404 로 답한다(스모크 후반 단계 전용).
 * 앱은 페이지를 열 때마다 SW 를 다시 등록하므로, **앱 계층(IndexedDB) 폴백만** 검증하는 단계에서는
 * SW 스크립트 자체가 없어야 한다. (CDP 의 요청 차단은 브라우저가 직접 받는 SW 스크립트 요청에는 적용되지 않는다.)
 */
let blockSwScripts = false;

const failures = [];
const notes = [];
const shots = [];
let cdp = null;
let chrome = null;
let server = null;
let profileDir = null;

function normalizeBase(value) {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function check(label, ok, detail = '') {
  const line = `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`;
  (ok ? notes : failures).push(line);
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
    // SW 스크립트·문서는 항상 재검증되게 한다(로컬 스모크에서 캐시가 판정을 흐리지 않도록).
    if (file.endsWith('sw.js') || file.endsWith('index.html')) headers['cache-control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    instance.listen(port, '127.0.0.1', () => resolve(instance));
  });
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** 페이지 안에서 조건이 참이 될 때까지 폴링한다(식은 JSON 직렬화 가능한 값). */
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

async function clickTab(dayType) {
  const ok = await evaluate(`
    const node = document.querySelector('#shuttle-day-tab-${dayType}');
    if (node === null) return false;
    node.click();
    return true;
  `);
  await delay(200);
  return ok;
}

/**
 * T27(§9-1) — 화면 하나. 앱 셸 [지금]/[전체] 탭은 없어졌고, 시간표는 항상 본문에 있다.
 * (요일 전환은 `clickTab` 하나로 충분하다.)
 */

async function capture(fileName, selector = null) {
  if (!WANT_SHOTS) return null;
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
    const contentHeight = Math.ceil(layout.cssContentSize?.height ?? 1200);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: Math.min(contentHeight, 9000),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(120);
  }
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    ...(clip === null ? {} : { clip }),
  });
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  shots.push(path);
  return path;
}

/**
 * 앱이 로딩을 끝낸 상태(데이터 성공이든 F8 오류 UI 든).
 * T14: 홈은 **오늘 남은 출발 보드**가 본문이다(`[data-testid="timetable"]` 은 UI 에서 제거됨).
 */
const READY =
  'document.querySelector(\'[data-testid="loading"]\') === null && (document.querySelector(\'[data-testid="timetable-section"]\') !== null || document.querySelector(\'[data-testid="data-error"]\') !== null)';

/** 화면 상태를 한 번에 읽는다(증거용) — T27 홈 구조(시간표 하나 + 상단 바 + 정보 시트). */
const READ_STATE = `
  const listCard = document.querySelector('[data-testid="timetable-section"]');
  const notice = document.querySelector('[data-testid="offline-notice"]');
  // T27(§9-1) — 화면 하나. 여기서 보는 탭은 **요일 탭**이다(앱 셸 [지금]/[전체] 탭은 제거됐다).
  const tabs = [...document.querySelectorAll('[data-testid="day-tabs"] [role="tab"]')];
  const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
  // T27(§9-3) — 히어로 카운트다운 카드 대신 **강조된 다음 출발 행**이 그 역할을 한다.
  const nextRow = document.querySelector('[data-testid="timetable-row"][data-next="true"]');
  return {
    hasApp: document.querySelector('.shuttle-app') !== null,
    hasCard: listCard !== null,
    // T27: timetable-section 에는 status 데이터셋이 없다 — **섹션 자체의 존재**가 계약이다.
    tableDay: listCard?.dataset.day ?? null,
    tableToday: listCard?.dataset.today ?? null,
    listReady: listCard !== null,
    nextTime: nextRow === null ? null : (nextRow.querySelector('.shuttle-departure__time')?.textContent ?? null),
    nextKey: nextRow?.dataset.key ?? null,
    departureRows: document.querySelectorAll('[data-testid="timetable-list"] [data-testid="timetable-row"]').length,
    emptyShown: document.querySelector('[data-testid="timetable-empty"]') !== null,
    refreshLine: document.querySelector('[data-testid="data-refresh-line"]')?.textContent ?? null,
    selectedTab: selected?.id ?? null,
    offlineNotice: notice === null ? null : { source: notice.dataset.source ?? null, text: notice.textContent },
    dataSource: document.querySelector('.shuttle-app')?.dataset.dataSource ?? null,
    errorBanner: document.querySelector('[data-testid="data-error"]') !== null,
    swController: navigator.serviceWorker.controller !== null,
    schoolLinks: document.querySelectorAll('a[href*="lily.sunmoon.ac.kr"]').length,
    visibleSourceCount: (document.body.innerText.match(/원본/g) ?? []).length,
  };
`;

/** 앱이 쓴 IndexedDB 캐시 레코드를 직접 읽는다(어댑터가 실제로 저장했는지 확인). */
const READ_IDB = `
  return await new Promise((resolve) => {
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
        resolve(value === undefined ? null : {
          keys: Object.keys(value).sort(),
          contentHash: value.contentHash ?? null,
          fetchedAt: value.fetchedAt ?? null,
          cachedAtMs: value.cachedAtMs ?? null,
          hasRaw: value.raw !== undefined && value.raw !== null,
          routeCount: Array.isArray(value.raw?.routes) ? value.raw.routes.length : null,
        });
      };
    };
  });
`;

/** Service Worker 등록 해제 + SW 캐시 삭제(IndexedDB 는 남긴다 — 앱 캐시 폴백을 검증하기 위해). */
const DROP_SW = `
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  return { unregistered: registrations.length, caches: keys };
`;

const CLEAR_IDB = `
  return await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('sunmoon-shuttle');
    request.onsuccess = () => resolve('deleted');
    request.onerror = () => resolve('error');
    request.onblocked = () => resolve('blocked');
  });
`;

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  if (!existsSync(join(DIST, 'sw.js'))) throw new Error('dist/sw.js 가 없습니다 — public/sw.js 를 확인하세요.');
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');

  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const rowsOf = (routeId, dayType) =>
    raw.routes.find((route) => route.id === routeId)?.byDay?.[dayType]?.trips?.length ?? 0;
  const routesCount = raw.routes.length;
  const asanWeekday = rowsOf('asan-ktx', 'weekday');
  const asanSaturday = rowsOf('asan-ktx', 'saturday');
  /**
   * 발행물에서 계산한 **그 요일 기대 행 수** — 출발 시각이 있는 회차만(앱의 행 수와 같은 필터).
   * T38 §16-2 — 화면은 **선택한 방향의 편만** 그린다: 기본 방향은 `터미널 도착`(`out` = `depCampus` 가 있는 편)이다.
   */
  const hasDepartureTime = (row) => (row['depCampus'] ?? row['depStation'] ?? row['depTerminal'] ?? null) !== null;
  const expectedRowsOf = (dayType, direction = 'out') =>
    raw.routes.reduce((sum, route) => {
      const table = route.byDay?.[dayType];
      if (table === null || table === undefined) return sum;
      return (
        sum +
        table.trips.filter(
          (row) =>
            hasDepartureTime(row) &&
            (direction === 'all' || ((row['depCampus'] ?? null) !== null) === (direction === 'out')),
        ).length
      );
    }, 0);

  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));
  mkdirSync(SHOT_DIR, { recursive: true });

  const webPort = await freePort();
  const debugPort = await freePort();
  server = await startStaticServer(webPort, BASE);
  profileDir = join(tmpdir(), `t6-offline-${String(process.pid)}`);
  const urlFor = (now) => `http://127.0.0.1:${webPort}${BASE}?now=${encodeURIComponent(now)}`;

  console.log(`offline_smoke: base=${BASE} now=${NOW} expired=${NOW_EXPIRED} routes=${String(routesCount)} asan-ktx 평일=${String(asanWeekday)} 토=${String(asanSaturday)}`);

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
      '--window-size=1280,1600',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  /** 앱이 낸 오류(예외·console.error)와 브라우저가 낸 네트워크 실패 로그를 **분리**해 센다. */
  const appErrors = [];
  const networkLogs = [];
  const warnings = [];

  try {
    const wsUrl = await waitForDebugger(debugPort);
    cdp = await connectCdp(wsUrl);
    cdp.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        appErrors.push(`exception: ${message.params?.exceptionDetails?.text ?? 'unknown'}`);
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (message.params?.type === 'error') appErrors.push(`console.error: ${text}`);
        if (message.params?.type === 'warning') warnings.push(`console.warn: ${text}`);
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        const text = message.params.entry.text ?? '';
        // 브라우저가 남기는 **자원 로딩 실패 로그**는 앱 코드의 오류가 아니다(실패를 주입한 결과이거나,
        // 후반 단계에서 검증 장치로 sw.js 를 404 로 내린 결과다). 앱이 낸 오류와 분리해 센다.
        const isResourceLog = /net::ERR_|Failed to load resource|HTTP response code/.test(text);
        (isResourceLog ? networkLogs : appErrors).push(`log: ${text} (${message.params.entry.url ?? ''})`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    // HTTP 캐시를 끈다: 이 스모크는 **네트워크 실패를 주입**해야 하므로, 브라우저 HTTP 캐시가 요청을 가로채면
    // 주입한 실패가 적용되지 않는다(그러면 AC-5 경로를 검증하지 못한다). Service Worker/Cache Storage 는 별개라 영향 없다.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Page.navigate', { url: urlFor(NOW) });

    // ── ① 온라인 1차 로드: 앱 + 캐시 계층이 실제로 채워지는지 ────────────────────────────
    check('온라인 1차 로드 완료(데이터 표시)', await waitFor(READY, 20_000, 'first-ready'));
    check('SW 등록 성공', await waitFor('(await navigator.serviceWorker.getRegistration()) !== undefined', 20_000, 'sw-register'));
    check('SW 가 페이지를 제어(claim) — 다음 로드부터 캐시가 응답한다', await waitFor('navigator.serviceWorker.controller !== null', 20_000, 'sw-claim'));
    check(
      'SW 셸 프리캐시(index.html) 준비 — 오프라인 첫 화면의 전제',
      await waitFor("(await caches.match('./index.html')) !== undefined", 20_000, 'shell-cache'),
    );

    // 제어되는 두 번째 로드: 이때부터 앱의 데이터 요청이 SW 를 지나가고 DATA_CACHE 가 채워진다.
    await cdp.send('Page.reload', { ignoreCache: false });
    check('SW 제어 상태 재로드 완료', await waitFor(READY, 20_000, 'controlled-ready'));
    check(
      'SW 데이터 캐시(data/timetable.json) 준비',
      await waitFor("(await caches.match('./data/timetable.json')) !== undefined", 20_000, 'data-cache'),
    );
    const swState = await evaluate(`
      const keys = await caches.keys();
      const shell = await caches.match('./index.html');
      const data = await caches.match('./data/timetable.json');
      const reg = await navigator.serviceWorker.getRegistration();
      return { keys, shell: shell !== undefined, data: data !== undefined, active: reg?.active?.state ?? null };
    `);
    info(`SW 캐시: ${JSON.stringify(swState)}`);

    const idb = await evaluate(READ_IDB);
    check(
      'IndexedDB 캐시 레코드 저장(원문·contentHash·fetchedAt·저장시각)',
      idb !== null && idb.hasRaw === true && typeof idb.contentHash === 'string' && typeof idb.cachedAtMs === 'number',
      JSON.stringify(idb),
    );
    check('IndexedDB 원문이 앱 데이터와 같은 노선 수', idb?.routeCount === routesCount, `idb=${String(idb?.routeCount)} json=${String(routesCount)}`);

    const online = await evaluate(READ_STATE);
    check('온라인: 캐시 폴백 배너 없음(네트워크 성공)', online.offlineNotice === null, JSON.stringify(online.offlineNotice));
    check('온라인: 콘솔 오류 0', appErrors.length === 0, appErrors.join(' | '));

    // ── ② AC-6 오프라인: 네트워크를 끊고 새로고침 ─────────────────────────────────────
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.send('Page.reload', { ignoreCache: false });
    const offlineRendered = await waitFor(READY, 20_000, 'offline-ready');
    check('오프라인 새로고침 후 첫 화면이 뜬다(AC-6)', offlineRendered);
    const offlineFirst = await evaluate(READ_STATE);
    info(`오프라인 화면 데이터 출처: ${offlineFirst.offlineNotice === null ? 'SW 캐시(앱 입장에서는 네트워크 성공)' : JSON.stringify(offlineFirst.offlineNotice.source)}`);
    check('오프라인: 앱 셸이 그려짐(빈 화면 아님)', offlineFirst.hasApp === true);
    check('오프라인: SW 가 계속 제어', offlineFirst.swController === true);
    const expectedFirst = expectedRowsOf(String(offlineFirst.tableDay));
    // T27 §9-1: 본문은 **시간표 하나** — 그 요일 전체 회차가 행으로 그려진다(보드 카드·편수 문구 없음).
    check(
      '오프라인: 시간표가 계약 데이터로 그려진다(요일 섹션 · 행 ≥1 · 발행물 편수와 일치)',
      offlineFirst.listReady === true && offlineFirst.departureRows >= 1 && offlineFirst.departureRows === expectedFirst,
      `day=${String(offlineFirst.tableDay)} rows=${String(offlineFirst.departureRows)} 기대(발행물)=${String(expectedFirst)}`,
    );
    // T14: 홈에서 `원본` 노출 0 · 학교 링크 ≤1(대표 출처 1줄만).
    check(
      '오프라인: 홈에 `원본` 0회 · 학교 링크 ≤1(대표 출처 1줄)',
      offlineFirst.visibleSourceCount === 0 && offlineFirst.schoolLinks <= 1,
      `원본=${String(offlineFirst.visibleSourceCount)} schoolLinks=${String(offlineFirst.schoolLinks)}`,
    );
    // T27 §9-3: 히어로 카운트다운 카드 대신 **강조된 다음 출발 행**이 그 역할을 한다.
    check(
      '오프라인: 다음 출발 행이 강조되어 있다(강조 행 1개 · 출발 시각 표시)',
      String(offlineFirst.nextTime ?? '').length > 0,
      `next=${String(offlineFirst.nextTime)} key=${String(offlineFirst.nextKey)}`,
    );
    const firstShot = await capture('T6-1-오프라인-첫화면.png');

    check('오프라인: 요일 탭(토요일) 전환', await clickTab('saturday'));
    const saturday = await evaluate(READ_STATE);
    const expectedSaturday = expectedRowsOf('saturday');
    check(
      '오프라인: 토요일 탭 전환 후에도 시간표가 데이터로 그려진다(발행물 편수와 일치)',
      saturday.selectedTab === 'shuttle-day-tab-saturday' &&
        saturday.tableDay === 'saturday' &&
        saturday.departureRows === expectedSaturday &&
        saturday.errorBanner === false,
      `selected=${String(saturday.selectedTab)} day=${String(saturday.tableDay)} rows=${String(saturday.departureRows)} 기대(발행물)=${String(expectedSaturday)}`,
    );
    const saturdayShot = await capture('T6-2-오프라인-요일전환.png');

    await clickTab('weekday');
    await delay(200);
    const countdownShot = await capture('T6-3-오프라인-카운트다운.png', '[data-testid="timetable-list"]');
    const backToWeekday = await evaluate(READ_STATE);
    check(
      '오프라인: 평일 탭 복귀 후에도 그 요일 시간표로 돌아온다',
      backToWeekday.selectedTab === 'shuttle-day-tab-weekday' && backToWeekday.departureRows >= 1,
      `selected=${String(backToWeekday.selectedTab)} day=${String(backToWeekday.tableDay)} rows=${String(backToWeekday.departureRows)} next=${String(backToWeekday.nextTime)}`,
    );
    check('오프라인: 앱이 낸 콘솔 오류 0 (AC-6)', appErrors.length === 0, appErrors.join(' | '));

    // ── ③ AC-5 수집 실패 폴백: 네트워크는 살리고 **데이터 요청만** 실패시킨다 ────────────────
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    const dropped = await evaluate(DROP_SW);
    // ⚠️ 앱은 페이지를 열 때마다 SW 를 **다시 등록**한다(설계대로). 그래서 SW 를 끄려면 스크립트 자체를 내려야 한다.
    //    이 단계의 목적은 **앱 계층(IndexedDB) 폴백** 검증이므로 SW 개입을 배제한다(서버가 sw.js 를 404 로 답한다).
    blockSwScripts = true;
    info(`SW 해제 + SW 캐시 삭제 + 재등록 차단(sw.js→404): ${JSON.stringify(dropped)} (IndexedDB 는 남긴다 — 앱 캐시 폴백 검증)`);

    const appErrorsBeforeFail = appErrors.length;
    cdp.on((message) => {
      if (message.method === 'Fetch.requestPaused') {
        void cdp.send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' });
      }
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*timetable.json*', requestStage: 'Request' }] });
    await cdp.send('Page.reload', { ignoreCache: true });

    const fallbackRendered = await waitFor(READY, 20_000, 'fallback-ready');
    check('수집 실패 후에도 화면이 뜬다(빈 화면 아님)', fallbackRendered);
    const fallback = await evaluate(READ_STATE);
    check('수집 실패 검증 조건: SW 미제어(앱 계층 폴백을 본다)', fallback.swController === false, `controller=${String(fallback.swController)}`);
    check(
      '수집 실패: 마지막 정상 데이터 표시(시간표가 데이터로 그려짐)',
      fallback.listReady === true && fallback.departureRows >= 1 && fallback.errorBanner === false,
      `day=${String(fallback.tableDay)} rows=${String(fallback.departureRows)}`,
    );
    // 2026-11-08 사용자 결정: 오프라인 안내 문구를 띄우지 않는다 — 마지막 데이터를 조용히 보여 주고 출처는 속성으로만 남긴다
    check('수집 실패: 안내 문구 없이 마지막 데이터로 표시(data-source=cache)', fallback.offlineNotice === null && fallback.dataSource === 'cache', `notice=${JSON.stringify(fallback.offlineNotice)} source=${String(fallback.dataSource)}`);
    check('수집 실패: 오류 UI(F8)로 가지 않는다 — 데이터가 있으므로', fallback.errorBanner === false);
    check(
      '수집 실패: 앱이 낸 콘솔 오류 0 (AC-5)',
      appErrors.length === appErrorsBeforeFail,
      appErrors.slice(appErrorsBeforeFail).join(' | '),
    );
    const fallbackShot = await capture('T6-4-수집실패-폴백.png');

    // ── ④ 만료 경로: 캐시 나이 24h 초과(시각 주입) ─────────────────────────────────────
    await cdp.send('Page.navigate', { url: urlFor(NOW_EXPIRED) });
    await waitFor(READY, 20_000, 'expired-ready');
    const expired = await evaluate(READ_STATE);
    info(`만료 경로 상태: ${JSON.stringify(expired)}`);
    check('만료 검증 조건: SW 미제어(앱 계층 만료 판정을 본다)', expired.swController === false, `controller=${String(expired.swController)}`);
    check(
      '만료 캐시도 유지한다(안내 문구 없음 · data-source=cache-expired)',
      expired.offlineNotice === null && expired.dataSource === 'cache-expired' && expired.departureRows >= 1,
      `notice=${JSON.stringify(expired.offlineNotice)} source=${String(expired.dataSource)} rows=${String(expired.departureRows)}`,
    );
    await capture('T6-5-캐시만료.png');
    await cdp.send('Fetch.disable');

    // ── ⑤ 캐시조차 없을 때: 조용한 실패 금지(F8 오류 UI) ────────────────────────────────
    const cleared = await evaluate(CLEAR_IDB);
    info(`IndexedDB 삭제: ${String(cleared)}`);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*timetable.json*', requestStage: 'Request' }] });
    await cdp.send('Page.reload', { ignoreCache: true });
    const errorUi = await waitFor('document.querySelector(\'[data-testid="data-error"]\') !== null', 20_000, 'error-ui');
    check('캐시가 없으면 오류 UI + 원본 링크를 보여준다(조용한 실패 금지)', errorUi);
    await capture('T6-6-캐시없음-오류UI.png');

    // ── 요약 ──────────────────────────────────────────────────────────────────────
    info(`브라우저가 낸 자원 실패 로그 ${String(networkLogs.length)}건(요청 실패 주입·sw.js 404 의 필연적 결과 — 앱 오류 아님)`);
    for (const log of networkLogs.slice(0, 4)) info(log);
    info(`콘솔 경고 ${String(warnings.length)}건${warnings.length === 0 ? '' : `: ${warnings.slice(0, 3).join(' | ')}`}`);

    console.log('\n검사 결과:');
    for (const line of notes) console.log(line);
    if (shots.length > 0) {
      console.log('\n스크린샷:');
      for (const path of shots) console.log(`  ${path}`);
    }
    for (const unused of [firstShot, saturdayShot, countdownShot, fallbackShot]) void unused;
  } finally {
    try {
      await cdp?.send('Browser.close');
    } catch {
      /* 무시 */
    }
    chrome?.kill('SIGTERM');
    server?.close();
    if (profileDir !== null) {
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* 무시 */
      }
    }
  }

  if (failures.length > 0) {
    console.log('\n실패:');
    for (const line of failures) console.log(line);
    process.exitCode = 1;
  } else {
    console.log('\nOFFLINE SMOKE: PASS');
  }
}

main().catch((error) => {
  console.error(`OFFLINE SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  server?.close();
  process.exitCode = 1;
});
