#!/usr/bin/env node
/**
 * T27 — 시간표 중심 화면 스모크(구 T24 앱 셸 스모크) · **헤드리스 Chrome CDP**, 의존성 0.
 *
 * 검증하는 것 (`docs/07-mobile-ux.md` §9 수용 기준 AC-U9 + 유지되는 T24 셸 계약)
 *  AC-U1  **스플래시**(T24 유지): ① 진입 시 표시(로고+앱이름+진행+문구 · `role=status`) ② 표시 시간 실측 400ms≤t≤2.5s
 *         ③ 본문 전환(시간표 행 렌더 + 스플래시 노드 제거)
 *  AC-U9-1 상단 바에 **현재 날짜·시각**(`10월 6일 (화) · 08:00`) + 분 단위 갱신 실측(`window.__shuttleTick`) ·
 *          진입 시 **다음 출발 행이 보이는 상태**(기하 실측 + `window.__shuttleScroll` 계측값)
 *  AC-U9-2 본문(`[data-testid="day-panel"]`) 텍스트에 제거 대상 문구 **0건**(소개문구·`데이터 갱신`·출처·요금·변동)
 *  AC-U9-3 강조는 **좌측 라인 + 배경 톤만**(테두리 0 · 배지 0 · 강조 행 토큰 0) · 지난 행 dim(계산색 실측) ·
 *          조건 토큰은 행당 **1개 이하**
 *  AC-U9-4 자동 스크롤이 **가려짐 없이** 동작(행 y ≥ 상단 바 하단 · `scroll-margin-top` 실측) ·
 *          사용자 스크롤 뒤 **3초** 재스크롤 0회, 3초 뒤에는 다시 맞춘다
 *  AC-U3  두 크기(390×844 · 360×800)에서 **가로 스크롤 0**(실측) + 스크린샷
 *  AC-U4  safe-area: 노치·홈 인디케이터(47/34px 주입)에서 상단 바·본문이 잘리지 않는다
 *  AC-U5  **스켈레톤**(캐시 없는 첫 실행 · 카드 3장) · 스플래시가 **2.5s 상한**에서 스스로 빠져나온다
 *  AC-U6  `prefers-reduced-motion: reduce` 에서 전환 애니메이션 **0**(계산값 실측 — 일반 모드와 대조)
 *  AC-U10 이동 버튼 2개(우하단 `현재 시간으로`·`맨 위로`) + 폰트 한 단계 축소 (T28 · §10)
 *         - AC-U10-1 `현재 시간으로` → 다음 출발 행이 상단 바 아래로(전/후 scrollTop·행 y 실측, 억제 상태에서도 동작)
 *         - AC-U10-2 `맨 위로` → `scrollTop = 0`
 *         - AC-U10-3 터치 ≥48×48 · `aria-label` · 키보드 포커스 · safe-area bottom+16px · 마지막 행 겹침 0
 *         - AC-U10-4 행 시각 15px · 보조 13px · 토큰 11px · 상단 바 15px · 11px 미만 0건 · 행 높이 48px 이상
 *  회귀   화면 `원본` 0회 · 학교 링크 ≤1 · `source-details` 0개 · 정보 시트가 출처·데이터 갱신·정차창을 갖는다 · 콘솔 오류 0
 *
 * 사용: node scripts/t24_smoke.mjs [--base=/sunmoon-shuttle/] [--now=<ISO8601>]
 * 산출물: .session-notes/T27-*.png · .session-notes/T28-*.png
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

/** `?now=`(KST ISO) → 상단 바 기대 문구(`10월 6일 (화) · 08:00`) — 시각은 KST 로 읽는다. */
const KST_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (value) => String(value).padStart(2, '0');
function kstClockText(iso, addMinutes = 0) {
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000 + addMinutes * 60 * 1000);
  return `${String(kst.getUTCMonth() + 1)}월 ${String(kst.getUTCDate())}일 (${KST_WEEKDAY[kst.getUTCDay()]}) · ${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}`;
}
const EXPECTED_CLOCK = kstClockText(NOW);
const EXPECTED_CLOCK_TICKED = kstClockText(NOW, 1);

/** 본문에 남아 있으면 안 되는 문구(§9-1 · §9-5 — 정보 시트로 옮긴 것들) */
const BODY_FORBIDDEN = [
  '지금 탈 수 있는 셔틀버스를 바로 보여줍니다',
  'Shows the shuttle',
  '데이터 갱신',
  '출처',
  '요금',
  '다가오는 운행 변동',
  '정차 시간 안내',
  '원본',
];

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

/** 데이터 준비(스켈레톤 제거 + 시간표 본문 등장)까지 대기. */
async function waitReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `const loading = document.querySelector('[data-testid="loading"]') === null;
       const body = document.querySelector('[data-testid="timetable-list"]') !== null || document.querySelector('[data-testid="timetable-empty"]') !== null;
       return loading && body;`,
    );
    if (ready === true) return true;
    await delay(150);
  }
  return false;
}

/** 요일 탭 선택(이미 선택돼 있으면 아무 일도 하지 않는다). */
async function showDayTab(dayType) {
  return (
    (await evaluate(`
      const node = document.querySelector('#shuttle-day-tab-${dayType}');
      if (node === null) return false;
      if (node.getAttribute('aria-selected') !== 'true') node.click();
      return true;
    `)) === true
  );
}

/** 이동 버튼 클릭(T28 §10-1) — 실제 사용자 클릭과 같은 경로(HTMLElement.click). */
async function clickMove(id) {
  return (
    (await evaluate(`
      const node = document.querySelector('[data-testid="${id}"]');
      if (node === null) return false;
      node.click();
      return true;
    `)) === true
  );
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

/** 가로 스크롤 실측 — 스크롤포트를 끝까지 밀어 실제 이동량을 본다. */
const HORIZONTAL_PROBE = `
  const scroller = document.scrollingElement ?? document.documentElement;
  const before = scroller.scrollLeft;
  scroller.scrollLeft = 99999;
  const after = scroller.scrollLeft;
  scroller.scrollLeft = before;
  const main = document.querySelector('.shuttle-scroll');
  return {
    canScrollHorizontally: after > 0,
    scrollLeftAfter: after,
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    innerWidth: window.innerWidth,
    listScrollWidth: main === null ? 0 : main.scrollWidth,
    listClientWidth: main === null ? 0 : main.clientWidth,
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

/** 상단 바·시간표·강조·스크롤 계측을 한 번에 읽는다(증거·검사 공용). */
const BODY_PROBE = `
  const rows = [...document.querySelectorAll('[data-testid="timetable-list"] [data-testid="timetable-row"]')];
  const next = rows.find((row) => row.dataset.next === 'true') ?? null;
  const firstPast = rows.find((row) => row.dataset.past === 'true') ?? null;
  const scroller = document.querySelector('.shuttle-scroll');
  const appbar = document.querySelector('.shuttle-appbar').getBoundingClientRect();
  const rect = next === null ? null : next.getBoundingClientRect();
  const styleOf = (node) => {
    const s = getComputedStyle(node);
    return {
      color: s.color,
      background: s.backgroundColor,
      boxShadow: s.boxShadow,
      borderTop: s.borderTopWidth,
      borderLeft: s.borderLeftWidth,
      borderRight: s.borderRightWidth,
    };
  };
  const tokensOf = (row) => [...row.querySelectorAll('[data-testid="row-token"]')].map((node) => (node.textContent || '').trim());
  const panel = document.querySelector('[data-testid="day-panel"]');
  const panelText = panel === null ? '' : panel.innerText || '';
  return {
    count: rows.length,
    pastCount: rows.filter((row) => row.dataset.past === 'true').length,
    nextCount: rows.filter((row) => row.dataset.next === 'true').length,
    nextKey: next === null ? null : next.dataset.key,
    nextTime: next === null ? null : (next.querySelector('.shuttle-departure__time')?.textContent ?? '').trim(),
    nextBadges: next === null ? 0 : next.querySelectorAll('.shuttle-badge').length,
    nextTokens: next === null ? 0 : tokensOf(next).length,
    nextStyle: next === null ? null : styleOf(next),
    normalStyle: rows.length === 0 ? null : styleOf(rows[rows.length - 1]),
    pastStyle: firstPast === null ? null : styleOf(firstPast),
    tokenRows: rows.filter((row) => (row.dataset.token ?? '') !== '').length,
    maxTokensPerRow: rows.reduce((max, row) => Math.max(max, tokensOf(row).length), 0),
    maxTokenLength: rows.reduce((max, row) => tokensOf(row).reduce((inner, text) => Math.max(inner, text.length), max), 0),
    longestToken: rows.reduce((longest, row) => tokensOf(row).reduce((inner, text) => (text.length > inner.length ? text : inner), longest), ''),
    nextTop: rect === null ? null : Math.round(rect.top),
    nextBottom: rect === null ? null : Math.round(rect.bottom),
    appbarBottom: Math.round(appbar.bottom),
    innerHeight: window.innerHeight,
    scrollTop: scroller === null ? null : Math.round(scroller.scrollTop),
    scrollMarginTop: rows.length === 0 ? null : parseFloat(getComputedStyle(rows[0]).scrollMarginTop),
    scrollBar: window.__shuttleScroll ?? null,
    legacyNodes: ['next-bus-card', 'shortcut-card', 'app-tabs', 'source-footer', 'data-refresh', 'source-details']
      .filter((id) => document.querySelector('#shuttle-main [data-testid="' + id + '"]') !== null),
    panelText,
  };
`;

/**
 * T28 §10-1 · §10-2 — 우하단 이동 버튼 + 폰트 실측(증거·검사 공용).
 * 버튼은 아이콘만 보이므로 문구 대신 `aria-label`·기하(48px·safe-area·겹침)·동작으로 판정한다.
 * `minText` 는 **화면에 실제로 보이는 텍스트 중 가장 작은 폰트**다(§10-2 하한 11px 실측).
 */
const MOVE_PROBE = `
  const stack = document.querySelector('[data-testid="move-buttons"]');
  const nowButton = document.querySelector('[data-testid="move-now"]');
  const topButton = document.querySelector('[data-testid="move-top"]');
  const scroller = document.querySelector('.shuttle-scroll');
  const appbar = document.querySelector('.shuttle-appbar');
  const rows = [...document.querySelectorAll('[data-testid="timetable-row"]')];
  const next = rows.find((row) => row.dataset.next === 'true') ?? null;
  const last = rows.length === 0 ? null : rows[rows.length - 1];
  const rectOf = (node) => {
    if (node === null) return null;
    const r = node.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const fontOf = (node) => (node === null ? null : parseFloat(getComputedStyle(node).fontSize));
  const stackRect = rectOf(stack);
  let minText = null;
  for (const node of document.querySelectorAll('.shuttle-app *')) {
    const own = [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent.trim()).join('').trim();
    if (own === '') continue;
    if (node.closest('.shuttle-sr-only') !== null) continue;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const size = parseFloat(style.fontSize);
    if (minText === null || size < minText.size) {
      const cls = typeof node.className === 'string' && node.className !== '' ? '.' + node.className.split(' ').join('.') : '';
      minText = { size, text: own.slice(0, 24), label: node.tagName.toLowerCase() + cls };
    }
  }
  return {
    stackPresent: stack !== null,
    nowPresent: nowButton !== null,
    topPresent: topButton !== null,
    labels: [nowButton === null ? null : nowButton.getAttribute('aria-label'), topButton === null ? null : topButton.getAttribute('aria-label')],
    nowRect: rectOf(nowButton),
    topRect: rectOf(topButton),
    stackRect,
    position: stack === null ? null : getComputedStyle(stack).position,
    zIndex: stack === null ? 0 : parseFloat(getComputedStyle(stack).zIndex) || 0,
    gapBottom: stackRect === null ? null : Math.round(window.innerHeight - stackRect.bottom),
    gapRight: stackRect === null ? null : Math.round(window.innerWidth - stackRect.right),
    scrollTop: scroller === null ? null : Math.round(scroller.scrollTop),
    nextTop: next === null ? null : Math.round(next.getBoundingClientRect().top),
    appbarBottom: appbar === null ? null : Math.round(appbar.getBoundingClientRect().bottom),
    rowHeight: rows.length === 0 ? null : Math.round(rows[0].getBoundingClientRect().height),
    lastBottom: last === null ? null : Math.round(last.getBoundingClientRect().bottom),
    innerHeight: window.innerHeight,
    fonts: {
      clock: fontOf(document.querySelector('[data-testid="app-clock"]')),
      rowTime: fontOf(document.querySelector('.shuttle-departure__time')),
      rowMeta: fontOf(document.querySelector('.shuttle-departure__dir')),
      token: fontOf(document.querySelector('[data-testid="row-token"]')),
    },
    minText,
    scrollBar: window.__shuttleScroll ?? null,
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
  const profileDir = join(tmpdir(), `t27-shell-${String(process.pid)}`);
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

    /* ── AC-U1 스플래시 (T24 계약 유지) ─────────────────────────────── */
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
    const splashShot = await capture('T27-1-스플래시.png');

    check('AC-U1 본문 전환(시간표 렌더)', await waitReady());
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
    const bodyShot = await capture('T27-2-본문-390x844.png');
    const body = await evaluate(BODY_PROBE);
    check('AC-U1 본문 전환 스크린샷 + 시간표 행 렌더', body.count > 0 && typeof bodyShot === 'string', `rows=${String(body.count)}`);

    /* ── AC-U9-1 상단 바 현재 날짜·시각 + 분 단위 갱신 ──────────────── */
    const clock0 = await evaluate(`
      const node = document.querySelector('[data-testid="app-clock"]');
      if (node === null) return null;
      return { text: (node.textContent || '').replace(/\\s+/g, ' ').trim(), datetime: node.getAttribute('datetime'), fontSize: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight };
    `);
    check(
      'AC-U9-1 상단 바에 현재 날짜·시각이 `10월 6일 (화) · 08:00` 형식으로 있다',
      clock0 !== null &&
        /^\d{1,2}월 \d{1,2}일 \([일월화수목금토]\) · \d{2}:\d{2}$/.test(String(clock0.text)) &&
        String(clock0.text) === EXPECTED_CLOCK,
      JSON.stringify({ clock: clock0, expected: EXPECTED_CLOCK }),
    );
    // 분 단위 갱신 실측 — 주입 시계는 고정이라 계측 훅으로 1분 이동시킨다(`window.__shuttleTick`).
    const tickIso = new Date(new Date(NOW).getTime() + 60_000).toISOString();
    const ticked = await evaluate(`
      if (typeof window.__shuttleTick !== 'function') return null;
      window.__shuttleTick(${JSON.stringify(tickIso)});
      const node = document.querySelector('[data-testid="app-clock"]');
      return (node.textContent || '').replace(/\\s+/g, ' ').trim();
    `);
    check(
      'AC-U9-1 시각이 분 단위로 갱신된다(+1분 실측)',
      String(ticked) === EXPECTED_CLOCK_TICKED,
      `got=${String(ticked)} expected=${EXPECTED_CLOCK_TICKED}`,
    );
    await evaluate(
      `if (typeof window.__shuttleTick === 'function') window.__shuttleTick(${JSON.stringify(NOW)}); return true;`,
    );

    /* ── AC-U9-1/9-3/9-4 본문 시간표 = 다음 출발이 보이는 상태 ──────── */
    const first = await evaluate(BODY_PROBE);
    check(
      'AC-U9-1 진입 시 "다음 출발" 행이 정확히 하나 있고(가장 가까운 남은 편) 그 행이 화면에 보인다',
      first.nextCount === 1 &&
        first.nextTime !== null &&
        first.nextTop !== null &&
        first.nextBottom !== null &&
        first.nextTop >= first.appbarBottom - 2 &&
        first.nextBottom <= first.innerHeight + 1,
      JSON.stringify({
        nextTime: first.nextTime,
        nextTop: first.nextTop,
        nextBottom: first.nextBottom,
        appbarBottom: first.appbarBottom,
        innerHeight: first.innerHeight,
      }),
    );
    check(
      'AC-U9-1/9-4 자동 스크롤 계측값 + `scroll-margin-top` 적용(상단 바 높이)',
      first.scrollBar !== null && first.scrollBar.autoScrolls >= 1 && first.scrollBar.lastTargetKey === first.nextKey && typeof first.scrollBar.lastOffset === 'number' && first.scrollMarginTop !== null && first.scrollMarginTop >= 56,
      JSON.stringify({ scroll: first.scrollBar, scrollMarginTop: first.scrollMarginTop, nextKey: first.nextKey }),
    );
    check(
      'AC-U9-3 강조는 좌측 라인 + 배경 톤만 — 테두리 0 · 배지 0 · 강조 행 토큰 0',
      first.nextStyle !== null &&
        first.normalStyle !== null &&
        first.nextStyle.borderLeft === '0px' &&
        first.nextStyle.borderTop === '0px' &&
        first.nextStyle.borderRight === '0px' &&
        first.nextStyle.background !== first.normalStyle.background &&
        /inset/.test(first.nextStyle.boxShadow) &&
        first.nextBadges === 0 &&
        first.nextTokens === 0,
      JSON.stringify({ next: first.nextStyle, normal: first.normalStyle, badges: first.nextBadges, tokens: first.nextTokens }),
    );
    check(
      'AC-U9-3 지나간 행은 dim(계산색 실측) — 지난 편 수 > 0',
      first.pastCount > 0 && first.pastStyle !== null && first.pastStyle.color !== first.normalStyle.color,
      JSON.stringify({ pastCount: first.pastCount, pastColor: first.pastStyle?.color, normalColor: first.normalStyle?.color }),
    );
    check(
      'AC-U9-3 조건 토큰은 행당 1개 이하 · 짧다(긴 사유 문구 금지 — 8자 이하 실측)',
      first.maxTokensPerRow <= 1 && first.maxTokenLength <= 8,
      JSON.stringify({ tokenRows: first.tokenRows, maxPerRow: first.maxTokensPerRow, maxLength: first.maxTokenLength, longest: first.longestToken }),
    );
    const nextShot = await capture('T27-3-다음출발-자동스크롤.png');
    info(`AC-U9-1 스크린샷(다음 출발 강조): ${nextShot.slice(ROOT.length)}`);

    /* ── AC-U9-2 본문에 잡텍스트 0건 ───────────────────────────────── */
    const forbidden = BODY_FORBIDDEN.map((phrase) => ({ phrase, count: (first.panelText.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length }));
    check(
      'AC-U9-2 본문 텍스트에 제거 대상 문구 0건(소개문구·데이터 갱신·출처·요금·변동·원본)',
      forbidden.every((entry) => entry.count === 0),
      JSON.stringify(forbidden),
    );
    check(
      'AC-U9-2 히어로 카드·바로가기·앱 탭·원본표 노드 0개',
      first.legacyNodes.length === 0,
      JSON.stringify(first.legacyNodes),
    );

    /* ── 요일 탭(시간표의 축) 계약 — T24 의 [지금]/[전체] 탭을 대신한다 ── */
    const dayTabs = await evaluate(`
      const bar = document.querySelector('[data-testid="day-tabs"]');
      const nodes = [...bar.querySelectorAll('[role="tab"]')];
      return {
        role: bar === null ? null : bar.getAttribute('role'),
        labels: nodes.map((node) => (node.textContent || '').trim()),
        selected: nodes.map((node) => node.getAttribute('aria-selected')),
        tabIndexes: nodes.map((node) => node.getAttribute('tabindex')),
        hiddenPanels: [...document.querySelectorAll('.shuttle-tabpanel[hidden]')].length,
      };
    `);
    check(
      '요일 전환 컨트롤 유지 — role=tablist · 3개(평일/토/일) · roving tabindex · 화면은 하나(숨은 패널 0)',
      dayTabs.role === 'tablist' && dayTabs.labels.length === 3 && dayTabs.tabIndexes.join('|') === '0|-1|-1' && dayTabs.hiddenPanels === 0,
      JSON.stringify(dayTabs),
    );

    /* ── AC-U9-4 사용자 스크롤 3초 재스크롤 금지 → 3초 뒤 다시 맞춘다 ── */
    const cooldown = await evaluate(`
      const scroller = document.querySelector('.shuttle-scroll');
      scroller.scrollTop = 400;                    // 사용자 스크롤(프로그램 스크롤 아님)
      return { scrollTop: Math.round(scroller.scrollTop), auto: (window.__shuttleScroll ?? {}).autoScrolls ?? -1 };
    `);
    await delay(120);
    await showDayTab('saturday');
    await delay(200);
    await showDayTab('weekday');
    const during = await evaluate(`return { auto: (window.__shuttleScroll ?? {}).autoScrolls ?? -1, skipped: (window.__shuttleScroll ?? {}).skipped ?? -1 };`);
    check(
      'AC-U9-4 사용자가 스크롤한 뒤 3초 안에는 자동 스크롤하지 않는다(스킵 실측)',
      during.auto === cooldown.auto && during.skipped >= 1,
      JSON.stringify({ before: cooldown, during }),
    );
    await delay(3200);
    await showDayTab('saturday');
    await delay(200);
    await showDayTab('weekday');
    await delay(200);
    const after = await evaluate(`return { auto: (window.__shuttleScroll ?? {}).autoScrolls ?? -1, scrollTop: Math.round(document.querySelector('.shuttle-scroll').scrollTop) };`);
    check(
      'AC-U9-4 3초가 지나면 다시 다음 출발로 맞춘다(재스크롤 허용)',
      after.auto > during.auto,
      JSON.stringify({ during, after }),
    );
    const scrolled = await evaluate(BODY_PROBE);
    check(
      'AC-U9-4 자동 스크롤이 가려지지 않는다(다음 출발 행 y ≥ 상단 바 하단)',
      scrolled.nextTop !== null && scrolled.nextTop >= scrolled.appbarBottom - 2,
      JSON.stringify({ nextTop: scrolled.nextTop, appbarBottom: scrolled.appbarBottom }),
    );

    /* ── AC-U10 이동 버튼 2개 (T28 · docs/07 §10-1) ──────────────────── */
    const move0 = await evaluate(MOVE_PROBE);
    check(
      'AC-U10-3 두 버튼이 우하단 **세로 스택**으로 있다(아이콘 + `aria-label` — 화면 문구 없음)',
      move0.stackPresent === true &&
        move0.nowPresent === true &&
        move0.topPresent === true &&
        move0.labels[0] === '현재 시간으로' &&
        move0.labels[1] === '맨 위로' &&
        move0.position === 'absolute' &&
        move0.zIndex > 0 &&
        move0.nowRect !== null &&
        move0.topRect !== null &&
        move0.topRect.top >= move0.nowRect.bottom - 1,
      JSON.stringify({ labels: move0.labels, position: move0.position, zIndex: move0.zIndex, now: move0.nowRect, top: move0.topRect }),
    );
    check(
      'AC-U10-3 두 버튼 터치 타깃 ≥48×48 (실측)',
      move0.nowRect !== null && move0.topRect !== null && move0.nowRect.width >= 48 && move0.nowRect.height >= 48 && move0.topRect.width >= 48 && move0.topRect.height >= 48,
      JSON.stringify({ now: move0.nowRect, top: move0.topRect }),
    );
    const moveFocus = await evaluate(`
      return ['move-now', 'move-top'].map((id) => {
        const node = document.querySelector('[data-testid="' + id + '"]');
        if (node === null) return false;
        node.focus();
        const ok = document.activeElement === node;
        node.blur();
        return ok;
      });
    `);
    check(
      'AC-U10-3 두 버튼이 키보드 포커스를 받는다(focus() → activeElement 실측)',
      Array.isArray(moveFocus) && moveFocus.every((value) => value === true),
      JSON.stringify(moveFocus),
    );
    const safeGap = await evaluate(`
      document.documentElement.style.setProperty('--safe-area-bottom', '34px');
      const stack = document.querySelector('[data-testid="move-buttons"]');
      const rect = stack.getBoundingClientRect();
      const out = { gapBottom: Math.round(window.innerHeight - rect.bottom), gapRight: Math.round(window.innerWidth - rect.right), innerHeight: window.innerHeight };
      document.documentElement.style.removeProperty('--safe-area-bottom');
      return out;
    `);
    check(
      'AC-U10-3 safe-area bottom(34px) + 16px 만큼 띄운다(하단 여백 실측)',
      safeGap.gapBottom >= 34 + 16 - 1 && safeGap.gapRight >= 16 - 1,
      JSON.stringify(safeGap),
    );
    // 본문 하단 여백(clearance) — 맨 아래까지 스크롤해도 마지막 행이 버튼과 겹치지 않아야 한다.
    await evaluate(`const s = document.querySelector('.shuttle-scroll'); s.scrollTop = 999999; return true;`);
    await delay(250);
    const atBottom = await evaluate(MOVE_PROBE);
    check(
      'AC-U10-3 맨 아래까지 스크롤해도 마지막 행이 버튼 스택과 겹치지 않는다(겹침 0 실측)',
      atBottom.lastBottom !== null && atBottom.stackRect !== null && atBottom.lastBottom <= atBottom.stackRect.top + 1,
      JSON.stringify({ lastBottom: atBottom.lastBottom, stackTop: atBottom.stackRect === null ? null : atBottom.stackRect.top, scrollTop: atBottom.scrollTop }),
    );
    const moveShot1 = await capture('T28-1-이동버튼-본문-390x844.png');
    info(`AC-U10-3 스크린샷(우하단 이동 버튼): ${moveShot1.slice(ROOT.length)}`);

    /* AC-U10-2 `맨 위로` → scrollTop = 0 */
    const beforeTop = await evaluate(`const s = document.querySelector('.shuttle-scroll'); return { scrollTop: Math.round(s.scrollTop) };`);
    await clickMove('move-top');
    await delay(700);
    const afterTop = await evaluate(MOVE_PROBE);
    check(
      'AC-U10-2 `맨 위로` 클릭 → scrollTop = 0 (수치)',
      beforeTop.scrollTop > 0 && afterTop.scrollTop === 0,
      JSON.stringify({ before: beforeTop, after: { scrollTop: afterTop.scrollTop, buttons: afterTop.scrollBar === null ? null : afterTop.scrollBar.buttonScrolls } }),
    );
    const moveShot3 = await capture('T28-3-맨위로-클릭후.png');
    info(`AC-U10-2 스크린샷(맨 위로 클릭 후): ${moveShot3.slice(ROOT.length)}`);

    /* AC-U10-1 `현재 시간으로` → 다음 출발 행이 상단 바 아래로(클릭 전/후 수치) */
    const beforeNow = await evaluate(MOVE_PROBE);
    await clickMove('move-now');
    await delay(800);
    const afterNow = await evaluate(MOVE_PROBE);
    check(
      'AC-U10-1 `현재 시간으로` 클릭 → 다음 출발 행이 상단 바 아래로 이동(전/후 scrollTop + 행 y좌표)',
      beforeNow.scrollTop === 0 &&
        beforeNow.nextTop !== null &&
        beforeNow.appbarBottom !== null &&
        afterNow.scrollTop !== null &&
        afterNow.scrollTop > 0 &&
        afterNow.nextTop !== null &&
        afterNow.appbarBottom !== null &&
        afterNow.innerHeight !== null &&
        beforeNow.nextTop > afterNow.nextTop &&
        afterNow.nextTop >= afterNow.appbarBottom &&
        afterNow.nextTop <= afterNow.innerHeight - 48,
      JSON.stringify({
        before: { scrollTop: beforeNow.scrollTop, nextTop: beforeNow.nextTop, appbarBottom: beforeNow.appbarBottom },
        after: { scrollTop: afterNow.scrollTop, nextTop: afterNow.nextTop, appbarBottom: afterNow.appbarBottom, innerHeight: afterNow.innerHeight },
      }),
    );
    const moveShot2 = await capture('T28-2-현재시간으로-클릭후.png');
    info(`AC-U10-1 스크린샷(현재 시간으로 클릭 후): ${moveShot2.slice(ROOT.length)}`);

    /* AC-U10-1(2) 사용자 스크롤로 억제된 상태에서도 버튼은 동작한다(억제 해제) */
    const suppressed = await evaluate(`
      const s = document.querySelector('.shuttle-scroll');
      s.scrollTop = 0;                                  // 사용자 스크롤 → 자동 스크롤 억제 창(3초) 진입
      const bar = window.__shuttleScroll ?? {};
      const probe = { userScrollAt: performance.now() };
      return { scrollTop: Math.round(s.scrollTop), buttonScrolls: bar.buttonScrolls ?? -1, skipped: bar.skipped ?? -1, probe };
    `);
    await delay(150);
    await clickMove('move-now');
    await delay(800);
    const afterForce = await evaluate(MOVE_PROBE);
    check(
      'AC-U10-1 사용자 스크롤로 억제된 상태(3초 이내)에서도 `현재 시간으로`는 동작한다(억제 해제 실측)',
      suppressed.scrollTop === 0 &&
        afterForce.scrollTop !== null &&
        afterForce.scrollTop > 0 &&
        afterForce.scrollBar !== null &&
        afterForce.scrollBar.lastUserScrollAt !== null &&
        afterForce.scrollBar.buttonScrolls > suppressed.buttonScrolls &&
        afterForce.nextTop !== null &&
        afterForce.appbarBottom !== null &&
        afterForce.nextTop >= afterForce.appbarBottom,
      JSON.stringify({
        before: { scrollTop: suppressed.scrollTop, buttonScrolls: suppressed.buttonScrolls, skipped: suppressed.skipped },
        after: { scrollTop: afterForce.scrollTop, buttonScrolls: afterForce.scrollBar === null ? null : afterForce.scrollBar.buttonScrolls, userScrollAt: afterForce.scrollBar === null ? null : afterForce.scrollBar.lastUserScrollAt },
      }),
    );

    /* AC-U10-4 폰트 한 단계 축소 실측(§10-2) */
    check(
      'AC-U10-4 폰트 실측 — 행 시각 15px · 행 보조 13px · 조건 토큰 11px · 상단 바 15px',
      afterForce.fonts.clock === 15 && afterForce.fonts.rowTime === 15 && afterForce.fonts.rowMeta === 13 && afterForce.fonts.token === 11,
      JSON.stringify(afterForce.fonts),
    );
    check(
      'AC-U10-4 화면 텍스트 중 11px 미만 0건(하한 실측) · 행 높이 ≥48px(불변)',
      afterForce.minText !== null && afterForce.minText.size >= 11 && afterForce.rowHeight !== null && afterForce.rowHeight >= 48,
      JSON.stringify({ minText: afterForce.minText, rowHeight: afterForce.rowHeight }),
    );

    /* ── AC-U3 두 크기에서 가로 스크롤 0 + 스크린샷 ────────────────── */
    const sizes = [
      { label: '390×844(iPhone)', width: 390, height: 844 },
      { label: '360×800(Android)', width: 360, height: 800 },
    ];
    for (const size of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 2, mobile: true });
      await delay(200);
      const horiz = await evaluate(HORIZONTAL_PROBE);
      check(
        `AC-U3 ${size.label} 가로 스크롤 0(문서·본문 스크롤포트 둘 다)`,
        horiz.canScrollHorizontally === false &&
          horiz.scrollWidth <= horiz.clientWidth + 1 &&
          horiz.listScrollWidth <= horiz.listClientWidth + 1,
        `scrollWidth=${String(horiz.scrollWidth)} clientWidth=${String(horiz.clientWidth)} list=${String(horiz.listScrollWidth)}/${String(horiz.listClientWidth)}`,
      );
      await capture(`T27-4-본문-${String(size.width)}x${String(size.height)}.png`, size.width, size.height);
    }
    info(`AC-U3 스크린샷: ${shots.filter((path) => path.includes('T27-4')).map((path) => path.slice(ROOT.length)).join(' · ')}`);

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
      const scroll = document.querySelector('.shuttle-scroll').getBoundingClientRect();
      return {
        appPaddingTop: parseFloat(getComputedStyle(app).paddingTop),
        appPaddingBottom: parseFloat(getComputedStyle(app).paddingBottom),
        appbarTop: Math.round(appbar.top),
        appbarHeight: Math.round(appbar.height),
        scrollBottom: Math.round(scroll.bottom),
        innerHeight: window.innerHeight,
      };
    `);
    check(
      'AC-U4 노치·홈인디케이터(47/34px)만큼 셸이 여백을 확보한다(상단 바·본문이 잘리지 않음)',
      safe.appPaddingTop >= 47 && safe.appPaddingBottom >= 34 && safe.appbarTop >= 0 && safe.appbarHeight >= 56 && safe.scrollBottom <= safe.innerHeight + 1,
      JSON.stringify(safe),
    );
    info(`AC-U4 safe-area: CDP inset 주입 ${insetsSupported ? '지원' : '미지원(토큰 주입으로 실측)'}`);
    const safeShot = await capture('T27-5-safe-area-390x844.png');
    await evaluate(`document.documentElement.style.removeProperty('--safe-area-top'); document.documentElement.style.removeProperty('--safe-area-bottom'); return true;`);

    /* ── AC-U5 스켈레톤(캐시 없는 첫 실행) + 2.5s 상한 ─────────────── */
    dataDelayMs = 4000;
    // **캐시 없는 첫 실행**을 실제로 만든다 — 앱 캐시(IndexedDB)와 Cache Storage 를 지우지 않으면
    // 데이터가 즉시 준비돼 스플래시가 하한(400ms)만에 'data' 로 빠지고 스켈레톤도 스쳐 지나간다.
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
    // 계약: 타이머를 **거는 시점**(shownAt 기준 남은 시간)이 2.5s 를 넘지 않는다 → `maxDelayMs ≤ 2500`.
    // 관측값(capMs)은 브라우저 타이머 지연(수십 ms — setTimeout 은 실행 시각을 보장하지 않는다)을 포함하므로
    //   문서화된 잡음 상한(2.7s)까지 본다. 두 값을 함께 출력해 어느 쪽이 문제인지 남긴다.
    const capDelay = capMetric === null ? -1 : Number(capMetric.maxDelayMs ?? -1);
    check(
      'AC-U5 스플래시 2.5s 상한 실측(초과 시 스켈레톤으로 진행)',
      capMetric !== null && capMetric.reason === 'timeout' && capDelay >= 0 && capDelay <= 2500 && capMs >= 400 && capMs <= 2700,
      `t=${String(capMs)}ms 예약=${String(capDelay)}ms reason=${String(capMetric?.reason)}`,
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
        rows: document.querySelectorAll('[data-testid="timetable-row"]').length,
        splash: document.querySelector('[data-testid="splash"]') !== null,
      };
    `);
    check(
      'AC-U5 캐시 없는 첫 실행에서 스켈레톤 카드 3장(빈 화면·텍스트만 아님)',
      skeleton.present === true && skeleton.cards === 3 && skeleton.bars === 9 && skeleton.rows === 0 && skeleton.splash === false,
      JSON.stringify(skeleton),
    );
    const skeletonShot = await capture('T27-6-스켈레톤.png');
    dataDelayMs = 0;
    check('AC-U5 지연 해제 후 본문 렌더(스켈레톤→본문)', await waitReady());
    info(`AC-U5 스켈레톤 스크린샷: ${skeletonShot.slice(ROOT.length)}`);

    /* ── AC-U6 reduced-motion 에서 전환 애니메이션 0 ───────────────── */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    // (a) 일반 모드 값 — 대조군
    const normalMotion = await evaluate(`
      const panel = document.querySelector('[data-testid="day-panel"]');
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
      const panel = document.querySelector('[data-testid="day-panel"]');
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
    /* §10-1 — reduced-motion 에서는 **이동 버튼도 즉시**다(60ms 값 = 600ms 값 → 추가 애니메이션 0). */
    await evaluate(`const s = document.querySelector('.shuttle-scroll'); s.scrollTop = 0; return true;`);
    await delay(150);
    await clickMove('move-now');
    await delay(60);
    const moveImmediate = await evaluate(`return Math.round(document.querySelector('.shuttle-scroll').scrollTop);`);
    await delay(600);
    const moveSettled = await evaluate(`return Math.round(document.querySelector('.shuttle-scroll').scrollTop);`);
    check(
      'AC-U10-1(보조) reduced-motion 에서 `현재 시간으로`는 즉시 이동(60ms 값 = 600ms 값)',
      moveImmediate > 0 && moveImmediate === moveSettled,
      `60ms=${String(moveImmediate)} 600ms=${String(moveSettled)}`,
    );
    await capture('T27-7-reduced-motion-본문.png');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    /* ── 회귀: T14 계약 + 정보 시트(§9-5) + 콘솔 ───────────────────── */
    await delay(200);
    const regression = await evaluate(`
      return {
        innerTextSource: (document.body.innerText.match(/원본/g) ?? []).length,
        domSource: (document.body.textContent.match(/원본/g) ?? []).length,
        schoolLinks: document.querySelectorAll('a[href*="lily.sunmoon.ac.kr"]').length,
        sourceDetails: document.querySelectorAll('[data-testid="source-details"]').length,
        elements: document.querySelectorAll('.shuttle-app *').length,
        sheetHidden: document.querySelector('[data-testid="guide-sheet"]').hasAttribute('hidden'),
      };
    `);
    check(
      '회귀: 화면 `원본` 0회 · 학교 링크 ≤1 · 원본표 0개 (T14 계약 유지)',
      regression.innerTextSource === 0 && regression.domSource === 0 && regression.schoolLinks <= 1 && regression.sourceDetails === 0,
      JSON.stringify(regression),
    );
    check('정보 시트(ⓘ)는 기본 숨김이다', regression.sheetHidden === true, JSON.stringify(regression));
    // ⓘ 열기 → 출처·데이터 갱신·정차창이 시트 안에 있다(§9-5 목적지).
    await evaluate(`document.querySelector('[data-testid="app-info"]').click(); return true;`);
    await delay(200);
    const sheet = await evaluate(`
      const sheet = document.querySelector('[data-testid="guide-sheet"]');
      return {
        open: sheet.hasAttribute('hidden') === false,
        sourceLine: sheet.querySelector('[data-testid="source-line"]') !== null,
        refreshLine: sheet.querySelector('[data-testid="data-refresh-line"]') !== null,
        stopWindow: sheet.querySelector('[data-testid="stop-window-details"]') !== null,
        noticePanel: sheet.querySelector('[data-testid="notice-panel"]') !== null,
        bodyText: (document.querySelector('[data-testid="day-panel"]').innerText || '').includes('데이터 갱신'),
      };
    `);
    check(
      '정보 시트(ⓘ): 출처·데이터 갱신·요금/정차창이 본문이 아니라 시트 안에 있다(§9-5)',
      sheet.open === true && sheet.sourceLine === true && sheet.refreshLine === true && sheet.stopWindow === true && sheet.noticePanel === true && sheet.bodyText === false,
      JSON.stringify(sheet),
    );
    await evaluate(`document.querySelector('[data-testid="guide-close"]').click(); return true;`);
    await delay(150);
    check('회귀: 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    check('회귀: 셸이 비어 있지 않다(화면 요소 200개 초과)', regression.elements > 200, `elements=${String(regression.elements)}`);
    info(`스플래시 스크린샷: ${splashShot.slice(ROOT.length)} · ${safeShot.slice(ROOT.length)} · ${bodyShot.slice(ROOT.length)}`);

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
    console.log('\nT27·T28 SMOKE: PASS');
  }
}

main().catch((error) => {
  console.error(`T27·T28 SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  process.exitCode = 1;
});
