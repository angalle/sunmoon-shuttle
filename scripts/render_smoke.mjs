#!/usr/bin/env node
/**
 * 렌더 스모크 (T5) — **헤드리스 브라우저(Chrome CDP)** 로 빌드본을 열어 실제 화면을 검증한다.
 *
 * 검증 항목(카드 지시 ⑦)
 *   ① 콘솔 오류 0
 *   ② 요일 탭·노선 선택이 동작(키보드 포함)
 *   ③ 표 행 수가 `data/timetable.json` 과 일치
 *   ④ 스크린샷 저장(`.session-notes/T5-*.png`)
 * 추가(운영자 지시): **Pages 하위 경로 시뮬레이션**(기본 `/sunmoon-shuttle/`)에서 데이터가 로드되는지.
 *
 * 의존성 0: node:http·node:child_process + Node 내장 WebSocket(≥22) 로 CDP 를 직접 말한다
 * (런타임 의존성 0 계약을 테스트 도구에도 유지).
 *
 * 사용:
 *   node scripts/render_smoke.mjs                     # dist/ 를 /sunmoon-shuttle/ 하위 경로로 서빙
 *   node scripts/render_smoke.mjs --base=/            # 루트 경로로 서빙(로컬 dev 형태)
 *   node scripts/render_smoke.mjs --now=2026-10-05T14:40:00+09:00
 * 종료코드: 검사 하나라도 실패하면 1.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
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
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const failures = [];
const notes = [];
let cdp = null;
let chrome = null;

function normalizeBase(value) {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function check(label, ok, detail = '') {
  if (ok) {
    notes.push(`  PASS  ${label}${detail === '' ? '' : ` — ${detail}`}`);
  } else {
    failures.push(`  FAIL  ${label}${detail === '' ? '' : ` — ${detail}`}`);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startStaticServer(port, base) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    // favicon 404 는 스모크 서버 산출물 문제이지 앱 결함이 아니다 → 204 로 응답해 콘솔 오류에서 제외.
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
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** CDP Runtime.evaluate 로 값을 읽는다(반환값은 JSON 직렬화). */
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

async function clickByTestId(testid) {
  const ok = await evaluate(`
    const node = document.querySelector('[data-testid="${testid}"]');
    if (node === null) return false;
    node.click();
    return true;
  `);
  await delay(150);
  return ok;
}

async function clickTab(dayType) {
  const ok = await evaluate(`
    const node = document.querySelector('#shuttle-day-tab-${dayType}');
    if (node === null) return false;
    node.click();
    return true;
  `);
  await delay(150);
  return ok;
}

async function clickRoute(routeId) {
  const ok = await evaluate(`
    const node = document.querySelector('[data-testid="route-button"][data-route-id="${routeId}"]');
    if (node === null) return false;
    node.click();
    return true;
  `);
  await delay(200);
  return ok;
}

async function capture(fileName, selector = null) {
  const layout = await cdp.send('Page.getLayoutMetrics');
  const contentHeight = Math.ceil(layout.cssContentSize?.height ?? layout.contentSize?.height ?? 1200);
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
  return path;
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');

  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const rowsOf = (routeId, dayType) => raw.routes.find((route) => route.id === routeId)?.byDay?.[dayType]?.trips?.length ?? 0;

  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));
  mkdirSync(SHOT_DIR, { recursive: true });

  const webPort = await freePort();
  const debugPort = await freePort();
  const server = await startStaticServer(webPort, BASE);
  const profileDir = join(tmpdir(), `t5-smoke-${String(process.pid)}`);
  const url = `http://127.0.0.1:${webPort}${BASE}?now=${encodeURIComponent(NOW)}`;

  console.log(`render_smoke: ${url} (base=${BASE}, now=${NOW})`);

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

  const consoleErrors = [];
  const consoleWarnings = [];
  try {
    const wsUrl = await waitForDebugger(debugPort);
    cdp = await connectCdp(wsUrl);
    cdp.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(`exception: ${message.params?.exceptionDetails?.text ?? 'unknown'}`);
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (message.params?.type === 'error') consoleErrors.push(`console.error: ${text}`);
        if (message.params?.type === 'warning') consoleWarnings.push(`console.warn: ${text}`);
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        consoleErrors.push(`log: ${message.params.entry.text} (${message.params.entry.url ?? ''})`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url });

    // 카드가 그려질 때까지 대기
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      ready = (await evaluate(`return document.querySelector('[data-testid="next-bus-card"]') !== null;`)) === true;
      if (!ready) await delay(250);
    }
    check('화면 렌더(next-bus-card 존재)', ready);

    // ── ③ 행 수가 JSON 과 일치 / ② 탭 전환 ──────────────────────────
    const initial = await evaluate(`
      const table = document.querySelector('[data-testid="timetable"]');
      const card = document.querySelector('[data-testid="next-bus-card"]');
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
      return {
        tabs: tabs.length,
        selectedTab: selected?.id ?? null,
        tabNotes: tabs.map((tab) => tab.textContent.trim()),
        cardStatus: card?.dataset.status ?? null,
        heroTime: document.querySelector('[data-testid="next-bus-time"]')?.textContent ?? null,
        timetableRows: table === null ? null : Number(table.dataset.rows),
        bodyRows: document.querySelectorAll('[data-testid="timetable"] tbody tr').length,
        emptyCells: document.querySelectorAll('[data-cell="empty"]').length,
        nextBusRows: document.querySelectorAll('[data-testid="next-bus-row"]').length,
        freshnessRows: document.querySelectorAll('[data-testid="freshness-row"]').length,
      };
    `);
    check('요일 탭 3개', initial.tabs === 3, `tabs=${String(initial.tabs)}`);
    check('오늘(KST) 탭이 기본 선택', initial.selectedTab === 'shuttle-day-tab-weekday', `selected=${String(initial.selectedTab)}`);
    check('주말 탭이 노선 수를 반영', String(initial.tabNotes[1]).includes('노선 3/5개'), `토요일 탭="${String(initial.tabNotes[1])}"`);
    check('평일 표 행 수 = JSON(asan-ktx weekday)', initial.timetableRows === rowsOf('asan-ktx', 'weekday'), `화면=${String(initial.timetableRows)} JSON=${String(rowsOf('asan-ktx', 'weekday'))}`);
    check('평일 tbody 행 수 일치', initial.bodyRows === rowsOf('asan-ktx', 'weekday'), `tbody=${String(initial.bodyRows)}`);
    check('미운행(Χ) 셀이 — 로 구분 표시', initial.emptyCells > 0, `empty cells=${String(initial.emptyCells)}`);
    check('다음 버스 카드 상태 ok(개천절 대체휴일 → 일요일 시간표)', initial.cardStatus === 'ok', `status=${String(initial.cardStatus)}`);
    check('다음 버스 3개(히어로 1 + 목록 2)', initial.nextBusRows === 2, `list rows=${String(initial.nextBusRows)}`);
    check('신선도 2행(원본 업데이트 + 우리 반영)', initial.freshnessRows === 2, `rows=${String(initial.freshnessRows)}`);
    check('히어로 시각이 도메인 계산값', initial.heroTime === '오늘 16:10 출발', `hero=${String(initial.heroTime)}`);

    const freshPath = await capture('T5-4-다음버스카드.png', '[data-testid="next-bus-card"]');

    // 키보드만으로 요일 탭 이동(←/→)
    await evaluate(`
      const tab = document.querySelector('#shuttle-day-tab-weekday');
      tab.focus();
      return true;
    `);
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await delay(200);
    const afterKey = await evaluate(`
      return {
        selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null,
        focus: document.activeElement?.id ?? null,
        rows: Number(document.querySelector('[data-testid="timetable"]')?.dataset.rows ?? -1),
      };
    `);
    check('키보드(→)로 토요일 탭 이동', afterKey.selected === 'shuttle-day-tab-saturday', `selected=${String(afterKey.selected)}`);
    check('키보드 이동 후 포커스 유지', afterKey.focus === 'shuttle-day-tab-saturday', `focus=${String(afterKey.focus)}`);
    check('토요일 표 행 수 = JSON(asan-ktx saturday)', afterKey.rows === rowsOf('asan-ktx', 'saturday'), `화면=${String(afterKey.rows)} JSON=${String(rowsOf('asan-ktx', 'saturday'))}`);
    const saturdayPath = await capture('T5-2-토요일탭.png');

    // 평일 탭으로 되돌리고 노선을 바꿔 본다(② 노선 선택)
    check('평일 탭 클릭', await clickTab('weekday'));
    const weekdayPath = await capture('T5-1-평일탭.png');
    check('운행 중단 노선 선택', await clickRoute('cheonan-campus'));
    const suspended = await evaluate(`
      return {
        cardStatus: document.querySelector('[data-testid="next-bus-card"]')?.dataset.status ?? null,
        reason: document.querySelector('[data-testid="suspended-reason"]')?.textContent ?? null,
        badge: [...document.querySelectorAll('[data-testid="route-list"] .shuttle-badge')].map((n) => n.textContent),
      };
    `);
    check('운행 중단 상태 표시(F2b)', suspended.cardStatus === 'suspended-route', `status=${String(suspended.cardStatus)}`);
    check('운행 중단 사유(원본 문구) 표시', String(suspended.reason).includes('운행하지 않습니다'), String(suspended.reason));
    check('목록에 운행 중단 배지', suspended.badge.includes('운행 중단'), JSON.stringify(suspended.badge));
    const suspendedPath = await capture('T5-3-운행중단노선.png');

    // ── 데이터 로드 실패 시 오류 UI(조용한 실패 금지) — CDP 로 요청을 실제로 실패시켜 확인 ──
    const consoleErrorsBeforeOffline = consoleErrors.length;
    cdp.on((message) => {
      if (message.method === 'Fetch.requestPaused') {
        void cdp.send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' });
      }
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*timetable.json*', requestStage: 'Request' }] });
    await cdp.send('Page.reload', { ignoreCache: true });
    const offlineDeadline = Date.now() + 15_000;
    let errorBanner = null;
    while (Date.now() < offlineDeadline && errorBanner === null) {
      errorBanner = await evaluate(`
        const banner = document.querySelector('[data-testid="data-error"]');
        if (banner === null) return null;
        return {
          text: banner.textContent,
          link: banner.querySelector('a')?.getAttribute('href') ?? null,
          role: banner.getAttribute('role'),
          hasRetry: [...banner.querySelectorAll('button')].some((b) => b.textContent === '다시 시도'),
          notBlank: document.querySelector('.shuttle-app') !== null,
        };
      `);
      if (errorBanner === null) await delay(250);
    }
    check('데이터 로드 실패 시 오류 UI + 원본 링크', errorBanner !== null && String(errorBanner.link).startsWith('https://lily.sunmoon.ac.kr'), JSON.stringify(errorBanner));
    check('오류 UI 는 alert 역할 · 재시도 버튼 포함', errorBanner?.role === 'alert' && errorBanner?.hasRetry === true, `role=${String(errorBanner?.role)} retry=${String(errorBanner?.hasRetry)}`);
    check('오류 상태에서도 빈 화면 아님', errorBanner?.notBlank === true, `app=${String(errorBanner?.notBlank)}`);
    await cdp.send('Fetch.disable');

    // ── ① 콘솔 오류 0 (정상 경로) ────────────────────────────────────
    check('콘솔 오류 0(정상 경로)', consoleErrorsBeforeOffline === 0, consoleErrors.slice(0, consoleErrorsBeforeOffline).join(' | '));
    notes.push(`  INFO  콘솔 경고 ${String(consoleWarnings.length)}건${consoleWarnings.length === 0 ? '' : `: ${consoleWarnings.slice(0, 2).join(' | ')}`}`);

    console.log('\n검사 결과:');
    for (const line of notes) console.log(line);
    console.log('\n스크린샷:');
    for (const path of [weekdayPath, saturdayPath, suspendedPath, freshPath]) console.log(`  ${path}`);
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
    console.log('\nRENDER SMOKE: PASS');
  }
}

main().catch((error) => {
  console.error(`RENDER SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  process.exitCode = 1;
});
