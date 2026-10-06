#!/usr/bin/env node
/**
 * T24 모바일 앱 셸 스모크 — **헤드리스 Chrome CDP**, 의존성 0(v1_smoke.mjs 와 같은 방식).
 *
 * 검증하는 것 (`docs/07-mobile-ux.md` §7 수용 기준 AC-U1~U6 + T14 계약 유지)
 *  AC-U1 **스플래시**: ① 진입 시 표시(스크린샷 · `role=status`/`aria-live` · 로고+앱이름+진행+문구)
 *        ② 표시 시간 실측 **400ms ≤ t ≤ 2.5s**(페이지가 남긴 `window.__shuttleSplash` 계측값)
 *        ③ 본문 전환(보드 카드 렌더 + 스플래시 노드 제거) · 전환 스크린샷
 *  AC-U2 **탭 2개**(지금/전체) · `role=tablist`/`tab`/`tabpanel` · 키보드(←/→) 이동 · **마지막 탭 유지**(재로드 후)
 *  AC-U3 [지금]/[전체] 스크린샷 각 1장 + **390×844 · 360×800** 두 크기에서 **가로 스크롤 0**(실측 수치)
 *  AC-U4 **safe-area**: 노치·홈 인디케이터(47/34px 주입)에서 앱바·탭바가 잘리지 않는다(기하 실측 + 스크린샷)
 *  AC-U5 **스켈레톤**: 캐시 없는 첫 실행(데이터 응답 3s 지연)에서 스켈레톤 카드 3장(스크린샷) ·
 *        스플래시가 **2.5s 상한**에서 스스로 빠져나온다(계측 reason='timeout')
 *  AC-U6 `prefers-reduced-motion: reduce` 에서 전환 애니메이션 **0**(계산값 실측) — 일반 모드 값과 대조
 *  회귀 화면 `원본` 0회 · 학교 링크 ≤1 · `source-details` 0개 · 콘솔 오류 0
 *
 * 사용: node scripts/t24_smoke.mjs [--base=/sunmoon-shuttle/] [--now=<ISO8601>]
 * 산출물: .session-notes/T24-*.png
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
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const BASE = normalizeBase(args.get('base') ?? '/sunmoon-shuttle/');
const NOW = args.get('now') ?? '2026-10-06T08:00:00+09:00';

const failures = [];
const notes = [];
const shots = [];
let cdp = null;
let chrome = null;
/** 데이터 응답 지연(ms) — AC-U5(스켈레톤·2.5s 상한) 시나리오에서만 올린다. */
let dataDelayMs = 0;

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
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startStaticServer(port, base) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/favicon.ico')) {
      res.writeHead(204).end();
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
    const body = readFileSync(file);
    const send = () => {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    };
    // 계약 데이터만 지연시킨다 — 앱 셸(html/js/css)은 즉시 응답해 스플래시/스켈레톤을 실제로 본다.
    if (dataDelayMs > 0 && pathname.endsWith('/data/timetable.json')) {
      setTimeout(send, dataDelayMs);
      return;
    }
    send();
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
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
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(`evaluate 실패: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

/** 뷰포트 스크린샷(라이트 고정 — 헤드리스는 호스트 다크 설정을 물려받는다). */
async function capture(fileName, width = 390, height = 844) {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await delay(150);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  shots.push(path);
  return path;
}

/** 앱 탭 전환 + (선택) 지연. */
async function showAppTab(tab) {
  return (
    (await evaluate(`
      const node = document.querySelector('#shuttle-tab-${tab}');
      if (node === null) return false;
      if (node.getAttribute('aria-selected') !== 'true') node.click();
      return true;
    `)) === true
  );
}

/** 데이터 준비(스켈레톤 제거 + 보드 카드 등장)까지 대기. */
async function waitReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `return document.querySelector('[data-testid="loading"]') === null && document.querySelector('[data-testid="next-bus-card"]') !== null;`,
    );
    if (ready === true) return true;
    await delay(150);
  }
  return false;
}

/**
 * 스플래시가 **완전히 사라질 때까지** 기다린다(노드 제거 + 계측 `hiddenAt` 기록).
 * 표시 시간(t = hiddenAt - shownAt)은 **전환이 끝난 뒤에** 읽어야 한다 — 하한 400ms 는
 * 본문이 먼저 렌더돼도 스플래시가 그만큼 남아 있다는 뜻이라, 렌더 직후에 읽으면 0/-1 이 나온다.
 */
async function waitSplashGone(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let probe = await evaluate(SPLASH_PROBE);
  while (Date.now() < deadline) {
    if (probe.present === false && probe.metric !== null && probe.metric.hiddenAt !== null) return probe;
    await delay(50);
    probe = await evaluate(SPLASH_PROBE);
  }
  return probe;
}

/** 가로 스크롤 실측 — 스크롤포트를 끝까지 밀어 실제 이동량을 본다(a11y_smoke 와 같은 방식). */
const HORIZONTAL_PROBE = `
  const scroller = document.scrollingElement ?? document.documentElement;
  const before = scroller.scrollLeft;
  scroller.scrollLeft = 99999;
  const after = scroller.scrollLeft;
  scroller.scrollLeft = before;
  return {
    canScrollHorizontally: after > 0,
    scrollLeftAfter: after,
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    innerWidth: window.innerWidth,
  };
`;

const SPLASH_PROBE = `
  const node = document.querySelector('[data-testid="splash"]');
  const metric = window.__shuttleSplash ?? null;
  if (node === null) return { present: false, metric };
  const rect = node.getBoundingClientRect();
  return {
    present: true,
    metric,
    role: node.getAttribute('role'),
    live: node.getAttribute('aria-live'),
    text: (node.textContent || '').replace(/\\s+/g, ' ').trim(),
    logo: node.querySelector('img') === null ? null : node.querySelector('img').getAttribute('src'),
    spinner: node.querySelector('.shuttle-spinner') !== null,
    covers: rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1,
  };
`;

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');

  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));
  mkdirSync(SHOT_DIR, { recursive: true });

  const webPort = await freePort();
  const debugPort = await freePort();
  const server = await startStaticServer(webPort, BASE);
  const profileDir = join(tmpdir(), `t24-shell-${String(process.pid)}`);
  const urlFor = (now) => `http://127.0.0.1:${String(webPort)}${BASE}?now=${encodeURIComponent(now)}`;
  const url = urlFor(NOW);

  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${String(debugPort)}`,
      '--window-size=390,844',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const consoleErrors = [];
  try {
    cdp = await connectCdp(await waitForDebugger(debugPort));
    cdp.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(`exception: ${message.params?.exceptionDetails?.text ?? 'unknown'}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        consoleErrors.push(`console.error: ${(message.params?.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        consoleErrors.push(`log: ${message.params.entry.text} (${message.params.entry.url ?? ''})`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    /* ── AC-U1 스플래시 ─────────────────────────────────────────────── */
    await cdp.send('Page.navigate', { url });
    let splashSeen = false;
    const splashDeadline = Date.now() + 4_000;
    while (Date.now() < splashDeadline && !splashSeen) {
      splashSeen = (await evaluate(`return document.querySelector('[data-testid="splash"]') !== null;`)) === true;
      if (!splashSeen) await delay(25);
    }
    const splash = await evaluate(SPLASH_PROBE);
    check('AC-U1 스플래시가 진입 시 표시된다', splashSeen && splash.present === true, JSON.stringify(splash.text ?? null));
    check(
      'AC-U1 스플래시 내용 — 로고(src) + 앱 이름 + 진행 표시 + `시간표 불러오는 중`',
      typeof splash.logo === 'string' && splash.logo.includes('icon-192.png') && splash.spinner === true && String(splash.text).includes('선문대 셔틀') && String(splash.text).includes('시간표 불러오는 중'),
      JSON.stringify({ logo: splash.logo, spinner: splash.spinner, text: splash.text }),
    );
    check('AC-U1 접근성 — role="status" + aria-live="polite"', splash.role === 'status' && splash.live === 'polite', `role=${String(splash.role)} live=${String(splash.live)}`);
    check('AC-U1 스플래시가 화면을 덮는다(전체화면 진입 경험)', splash.covers === true, `covers=${String(splash.covers)}`);
    const splashShot = await capture('T24-1-스플래시.png');

    check('AC-U1 본문 전환(보드 카드 렌더)', await waitReady());
    // 본문이 먼저 렌더돼도 스플래시는 하한(400ms)+페이드(200ms)만큼 남는다 — 제거까지 기다린 뒤 계측한다.
    const splashAfter = await waitSplashGone();
    const metric = splashAfter.metric ?? {};
    const displayMs = typeof metric.hiddenAt === 'number' && typeof metric.shownAt === 'number' ? Math.round(metric.hiddenAt - metric.shownAt) : -1;
    check(
      'AC-U1 표시 시간 실측 400ms ≤ t ≤ 2.5s (하한: 깜빡임 방지)',
      displayMs >= 400 && displayMs <= 2500,
      `t=${String(displayMs)}ms (shownAt=${String(Math.round(metric.shownAt ?? -1))} hiddenAt=${String(Math.round(metric.hiddenAt ?? -1))} reason=${String(metric.reason)})`,
    );
    check('AC-U1 스플래시 노드가 사라진다(전환 완료)', splashAfter.present === false, `present=${String(splashAfter.present)}`);
    const nowShot = await capture('T24-2-지금화면-390x844.png');
    check(
      'AC-U1 본문 전환 스크린샷 + [지금] 화면(히어로 카드 + 지금 탈 수 있는 편)',
      (await evaluate(`return document.querySelector('[data-testid="next-bus-time"]') !== null && document.querySelectorAll('[data-testid="departure-list"] [data-testid="departure-row"]').length > 0;`)) === true,
      nowShot.slice(ROOT.length),
    );

    /* ── AC-U2 탭 2개 · ARIA · 키보드 · 마지막 탭 유지 ──────────────── */
    const tabs = await evaluate(`
      const bar = document.querySelector('[data-testid="app-tabs"]');
      const nodes = [...document.querySelectorAll('.shuttle-tabbar [role="tab"]')];
      const panels = nodes.map((node) => {
        const panel = document.getElementById(node.getAttribute('aria-controls'));
        return panel === null ? null : { id: panel.id, role: panel.getAttribute('role'), hidden: panel.hasAttribute('hidden'), labelledby: panel.getAttribute('aria-labelledby') };
      });
      return {
        barRole: bar === null ? null : bar.getAttribute('role'),
        labels: nodes.map((node) => node.textContent.trim()),
        selected: nodes.map((node) => node.getAttribute('aria-selected')),
        tabIndexes: nodes.map((node) => node.getAttribute('tabindex')),
        panels,
      };
    `);
    check('AC-U2 탭 2개(지금/전체) + role=tablist', tabs.barRole === 'tablist' && tabs.labels.length === 2 && tabs.labels.join('|') === '지금|전체', JSON.stringify(tabs.labels));
    check(
      'AC-U2 role=tab/tabpanel · aria-controls↔aria-labelledby 연결 · 비활성 패널 hidden',
      tabs.panels.every((panel) => panel !== null && panel.role === 'tabpanel') &&
        tabs.panels[0].hidden === false &&
        tabs.panels[1].hidden === true &&
        tabs.panels[0].labelledby === 'shuttle-tab-now',
      JSON.stringify(tabs.panels),
    );
    check('AC-U2 roving tabindex(선택 탭만 0)', tabs.tabIndexes.join('|') === '0|-1', JSON.stringify(tabs.tabIndexes));
    // 키보드: [전체] 로 초점 이동 후 ←/→
    const keyboard = await evaluate(`
      const all = document.querySelector('#shuttle-tab-all');
      all.focus();
      all.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      const afterLeft = { active: document.activeElement.id, allSelected: all.getAttribute('aria-selected') };
      const now = document.querySelector('#shuttle-tab-now');
      now.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      return {
        afterLeft,
        afterRight: { active: document.activeElement.id, allSelected: all.getAttribute('aria-selected'), nowSelected: now.getAttribute('aria-selected'), nowHidden: document.querySelector('#shuttle-tabpanel-now').hasAttribute('hidden') },
      };
    `);
    check(
      'AC-U2 키보드 ←/→ 이동·선택(포커스도 함께 이동)',
      keyboard.afterLeft.active === 'shuttle-tab-now' && keyboard.afterLeft.allSelected === 'false' && keyboard.afterRight.active === 'shuttle-tab-all' && keyboard.afterRight.allSelected === 'true' && keyboard.afterRight.nowHidden === true,
      JSON.stringify(keyboard),
    );
    // 마지막 탭 유지: [전체] 로 두고 재로드
    await showAppTab('all');
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitReady();
    const persisted = await evaluate(`
      return {
        stored: window.localStorage.getItem('sunmoon-shuttle:app-tab:v1'),
        allSelected: document.querySelector('#shuttle-tab-all').getAttribute('aria-selected'),
        allHidden: document.querySelector('#shuttle-tabpanel-all').hasAttribute('hidden'),
        nowHidden: document.querySelector('#shuttle-tabpanel-now').hasAttribute('hidden'),
      };
    `);
    check(
      'AC-U2 마지막 탭 유지(재로드 후 [전체])',
      persisted.stored === 'all' && persisted.allSelected === 'true' && persisted.allHidden === false && persisted.nowHidden === true,
      JSON.stringify(persisted),
    );

    /* ── AC-U3 두 크기에서 가로 스크롤 0 + 뷰 스크린샷 ────────────── */
    const sizes = [
      { label: '390×844(iPhone)', width: 390, height: 844 },
      { label: '360×800(Android)', width: 360, height: 800 },
    ];
    for (const size of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 2, mobile: true });
      await delay(150);
      for (const tab of ['now', 'all']) {
        await showAppTab(tab);
        await delay(250);
        const horiz = await evaluate(HORIZONTAL_PROBE);
        check(
          `AC-U3 ${size.label} · [${tab === 'now' ? '지금' : '전체'}] 가로 스크롤 0`,
          horiz.canScrollHorizontally === false && horiz.scrollWidth <= horiz.clientWidth + 1,
          `scrollWidth=${String(horiz.scrollWidth)} clientWidth=${String(horiz.clientWidth)} scrollLeft→${String(horiz.scrollLeftAfter)}`,
        );
        await capture(`T24-3-${tab === 'now' ? '지금' : '전체'}-${String(size.width)}x${String(size.height)}.png`, size.width, size.height);
      }
    }
    info(`AC-U3 스크린샷: ${shots.filter((path) => path.includes('T24-3')).map((path) => path.slice(ROOT.length)).join(' · ')}`);

    /* ── AC-U4 safe-area(노치 47 · 홈 인디케이터 34) ───────────────── */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    let insetsSupported = true;
    try {
      await cdp.send('Emulation.setSafeAreaInsets', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
    } catch {
      insetsSupported = false;
    }
    const safe = await evaluate(`
      const root = document.documentElement;
      // 헤드리스가 safe-area inset 을 CSS env() 로 넘기지 못하는 경우가 있어 **토큰을 직접 주입**해
      // 셸이 그 값을 실제로 소비하는지(= 노치에서 잘리지 않는지) 본다.
      root.style.setProperty('--safe-area-top', '47px');
      root.style.setProperty('--safe-area-bottom', '34px');
      const app = document.querySelector('.shuttle-app');
      const appbar = document.querySelector('.shuttle-appbar').getBoundingClientRect();
      const tabbar = document.querySelector('.shuttle-tabbar').getBoundingClientRect();
      const scroll = document.querySelector('.shuttle-scroll');
      return {
        appPaddingTop: parseFloat(getComputedStyle(app).paddingTop),
        appPaddingBottom: parseFloat(getComputedStyle(app).paddingBottom),
        appbarTop: Math.round(appbar.top),
        appbarHeight: Math.round(appbar.height),
        tabbarBottom: Math.round(tabbar.bottom),
        tabbarHeight: Math.round(tabbar.height),
        innerHeight: window.innerHeight,
        scrollHeight: Math.round(scroll.getBoundingClientRect().height),
      };
    `);
    check(
      'AC-U4 노치·홈인디케이터(47/34px)만큼 셸이 여백을 확보한다(앱바·탭바가 잘리지 않음)',
      safe.appPaddingTop >= 47 && safe.appPaddingBottom >= 34 && safe.appbarTop >= 0 && safe.tabbarBottom <= safe.innerHeight + 1 && safe.appbarHeight >= 56 && safe.tabbarHeight >= 56,
      JSON.stringify(safe),
    );
    info(`AC-U4 safe-area: CDP inset 주입 ${insetsSupported ? '지원' : '미지원(토큰 주입으로 실측)'}`);
    const safeShot = await capture('T24-4-safe-area-390x844.png');
    await evaluate(`document.documentElement.style.removeProperty('--safe-area-top'); document.documentElement.style.removeProperty('--safe-area-bottom'); return true;`);

    /* ── AC-U5 스켈레톤(캐시 없는 첫 실행) + 2.5s 상한 ─────────────── */
    dataDelayMs = 4000;
    // **캐시 없는 첫 실행**을 실제로 만든다 — 직전 단계들이 채워 둔 IndexedDB(앱 캐시)와
    // Cache Storage(SW·data/timetable.json 캐시 우선)를 지우지 않으면 데이터가 즉시 준비돼
    // 스플래시가 하한(400ms)만에 'data' 로 빠지고 스켈레톤도 스쳐 지나간다(그러면 AC-U5 가 무의미해진다).
    await cdp.send('Storage.clearDataForOrigin', {
      origin: `http://127.0.0.1:${String(webPort)}`,
      storageTypes: 'all',
    });
    await cdp.send('Page.navigate', { url });
    let capMetric = null;
    const capDeadline = Date.now() + 6_000;
    while (Date.now() < capDeadline) {
      const probe = await evaluate(SPLASH_PROBE);
      if (probe.metric !== null && probe.metric.hiddenAt !== null) {
        capMetric = probe.metric;
        break;
      }
      await delay(100);
    }
    const capMs = capMetric === null ? -1 : Math.round(capMetric.hiddenAt - capMetric.shownAt);
    check(
      'AC-U5 스플래시 2.5s 상한 실측(초과 시 스켈레톤으로 진행)',
      capMs >= 400 && capMs <= 2550 && capMetric !== null && capMetric.reason === 'timeout',
      `t=${String(capMs)}ms reason=${String(capMetric?.reason)}`,
    );
    // 스플래시가 노드에서 사라진 뒤(페이드아웃 완료) 스켈레톤을 본다 — 데이터는 아직 4s 지연 중이다.
    await waitSplashGone();
    const skeleton = await evaluate(`
      const node = document.querySelector('[data-testid="loading"]');
      return {
        present: node !== null,
        cards: node === null ? 0 : node.querySelectorAll('.shuttle-skeleton__card').length,
        bars: node === null ? 0 : node.querySelectorAll('.shuttle-skeleton__bar').length,
        role: node === null ? null : node.getAttribute('role'),
        boardCard: document.querySelector('[data-testid="next-bus-card"]') !== null,
        splash: document.querySelector('[data-testid="splash"]') !== null,
      };
    `);
    check(
      'AC-U5 캐시 없는 첫 실행에서 스켈레톤 카드 3장(빈 화면·텍스트만 아님)',
      skeleton.present === true && skeleton.cards === 3 && skeleton.bars === 9 && skeleton.splash === false,
      JSON.stringify(skeleton),
    );
    const skeletonShot = await capture('T24-5-스켈레톤.png');
    dataDelayMs = 0;
    check('AC-U5 지연 해제 후 본문 렌더(스켈레톤→본문)', await waitReady());
    info(`AC-U5 스켈레톤 스크린샷: ${skeletonShot.slice(ROOT.length)}`);

    /* ── AC-U6 reduced-motion 에서 전환 애니메이션 0 ───────────────── */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    // (a) 일반 모드 값 — 대조군
    const normalMotion = await evaluate(`
      const all = document.querySelector('#shuttle-tab-all');
      document.querySelector('#shuttle-tab-now').click();
      all.click();
      const panel = document.querySelector('#shuttle-tabpanel-all');
      const splash = document.createElement('div');
      splash.className = 'shuttle-splash';
      document.body.appendChild(splash);
      const out = {
        panelAnimation: getComputedStyle(panel).animationDuration,
        splashTransition: getComputedStyle(splash).transitionDuration,
        reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      };
      splash.remove();
      return out;
    `);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitReady();
    // reduced-motion 이면 페이드아웃이 0ms 라 스플래시가 곧바로 제거된다 — 제거를 기다린 뒤 계측한다.
    const reducedSplash = await waitSplashGone();
    const reducedMetric = reducedSplash.metric ?? null;
    const reducedMotion = await evaluate(`
      const all = document.querySelector('#shuttle-tab-all');
      document.querySelector('#shuttle-tab-now').click();
      all.click();
      const panel = document.querySelector('#shuttle-tabpanel-all');
      const splash = document.createElement('div');
      splash.className = 'shuttle-splash';
      document.body.appendChild(splash);
      const spinnerNode = document.createElement('span');
      spinnerNode.className = 'shuttle-spinner';
      document.body.appendChild(spinnerNode);
      const out = {
        reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        panelAnimation: getComputedStyle(panel).animationDuration,
        splashTransition: getComputedStyle(splash).transitionDuration,
        spinnerAnimation: getComputedStyle(spinnerNode).animationName,
      };
      splash.remove();
      spinnerNode.remove();
      return out;
    `);
    check(
      'AC-U6 prefers-reduced-motion: reduce 에서 전환 애니메이션 0(계산값)',
      reducedMotion.reduced === true &&
        parseFloat(reducedMotion.panelAnimation) === 0 &&
        parseFloat(reducedMotion.splashTransition) === 0 &&
        reducedMotion.spinnerAnimation === 'none',
      JSON.stringify(reducedMotion),
    );
    info(
      `AC-U6 대조군(일반 모드): panel animation=${String(normalMotion.panelAnimation)} · splash transition=${String(normalMotion.splashTransition)} → reduce: panel=${String(reducedMotion.panelAnimation)} · splash=${String(reducedMotion.splashTransition)}`,
    );
    const reducedFadeMs = reducedMetric === null ? -1 : Math.round(reducedMetric.hiddenAt - reducedMetric.shownAt);
    check(
      'AC-U6 reduced-motion 에서도 스플래시 하한(400ms)은 지킨다(즉시 페이드아웃)',
      reducedFadeMs >= 400 && reducedFadeMs <= 2500,
      `t=${String(reducedFadeMs)}ms`,
    );
    await capture('T24-6-reduced-motion-전체.png');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    /* ── 회귀: T14 계약 + 콘솔 ─────────────────────────────────────── */
    await showAppTab('all');
    await delay(200);
    const regression = await evaluate(`
      return {
        innerTextSource: (document.body.innerText.match(/원본/g) ?? []).length,
        domSource: (document.body.textContent.match(/원본/g) ?? []).length,
        schoolLinks: document.querySelectorAll('a[href*="lily.sunmoon.ac.kr"]').length,
        sourceDetails: document.querySelectorAll('[data-testid="source-details"]').length,
        elements: document.querySelectorAll('.shuttle-app *').length,
        sheetHidden: document.querySelector('[data-testid="guide-sheet"]').hasAttribute('hidden'),
        stopWindowInSheet: document.querySelector('[data-testid="guide-sheet"] [data-testid="stop-window-details"]') !== null,
        refreshLine: document.querySelector('[data-testid="data-refresh-line"]') !== null,
        sourceLine: document.querySelector('[data-testid="source-line"]') !== null,
      };
    `);
    check(
      '회귀: 화면 `원본` 0회 · 학교 링크 ≤1 · 원본표 0개 (T14 계약 유지)',
      regression.innerTextSource === 0 && regression.domSource === 0 && regression.schoolLinks <= 1 && regression.sourceDetails === 0,
      JSON.stringify(regression),
    );
    check(
      '화면 분리: [전체] 탭이 출처·데이터 갱신·이용 안내 시트(정차창)를 갖는다',
      regression.refreshLine === true && regression.sourceLine === true && regression.stopWindowInSheet === true,
      JSON.stringify(regression),
    );
    check('회귀: 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    check('회귀: 셸이 비어 있지 않다(화면 요소 200개 초과)', regression.elements > 200, `elements=${String(regression.elements)}`);
    info(`스플래시 스크린샷: ${splashShot.slice(ROOT.length)} · ${safeShot.slice(ROOT.length)}`);
    info(`지금/전체: ${nowShot.slice(ROOT.length)}`);

    console.log('\n검사 결과:');
    for (const line of notes) console.log(line);
    console.log('\n스크린샷:');
    for (const path of shots) console.log(`  ${path}`);
  } finally {
    try {
      if (cdp !== null) await cdp.send('Browser.close');
    } catch {
      /* 무시 */
    }
    chrome?.kill('SIGTERM');
    server.close();
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* 무시 */
    }
  }

  if (failures.length > 0) {
    console.log('\n실패:');
    for (const line of failures) console.log(line);
    process.exitCode = 1;
  } else {
    console.log('\nT24 SMOKE: PASS');
  }
}

main().catch((error) => {
  console.error(`T24 SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  process.exitCode = 1;
});
