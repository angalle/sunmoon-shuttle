#!/usr/bin/env node
/**
 * 렌더 스모크 (T5 → **T14 재기준**) — **헤드리스 브라우저(Chrome CDP)** 로 빌드본을 열어 실제 화면을 검증한다.
 *
 * 검증 항목(카드 지시 ⑦ · T14 재기준)
 *   ① 콘솔 오류 0
 *   ② 요일 탭(키보드 포함) 동작 — **노선 선택은 T14 에서 홈에서 제거**되어 더 이상 검사하지 않는다
 *   ③ 보드가 계약 JSON 기반으로 그려진다(회차 수는 도메인 계산값 — 접힘 원본표·tbody 는 UI 에서 제거됨)
 *   ④ **홈에 `원본` 노출 0 · 학교 링크 ≤1**(T14: 출처는 대표 1줄만)
 *   ⑤ 스크린샷 저장(`.session-notes/T5-*.png`)
 * 추가(운영자 지시): **Pages 하위 경로 시뮬레이션**(기본 `/sunmoon-shuttle/`)에서 데이터가 로드되는지.
 *
 * ⚠️ T14 이후 이 스크립트가 보는 것은 **현재 홈**이다. 옛 T5 화면(노선 선택·접힘 원본표·신선도 2행·미운행 셀 `—`)은
 *    앱 UI 에서 사라졌으므로 그 검사들도 함께 제거했다(컴포넌트 파일은 남아 있으나 홈에서 렌더하지 않는다).
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

/**
 * `true` 면 정적 서버가 `sw.js` 를 404 로 답한다(T6 이후 추가).
 * 오류 UI(F8) 검증 단계는 **캐시가 전혀 없는 상태**를 만들어야 하는데, 앱은 페이지를 열 때마다 SW 를 다시 등록하므로
 * SW 스크립트 자체를 내려서 개입을 배제한다(상세: scripts/offline_smoke.mjs 의 같은 이름 플래그).
 */
let blockSwScripts = false;

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
  // T7 추가: manifest·SVG 아이콘은 브라우저가 MIME 을 검사한다(octet-stream 이면 콘솔 오류로 잡힌다).
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

  // T38 §16-2: 화면은 **선택한 방향의 편만** 그린다(기본 `터미널 도착` = `out` · `depCampus` 가 있는 편) → 방향까지 맞춰 센다.
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const hasDepartureTime = (row) => (row['depCampus'] ?? row['depStation'] ?? row['depTerminal'] ?? null) !== null;
  // 시안 A(2026-11-08): 화면은 고른 정류장 하나의 편만 그린다 — 새로 연 화면의 기본 정류장 = 첫 노선(asan-ktx)
  const expectedRowsOf = (dayType, direction = 'out', stopId = 'asan-ktx') =>
    raw.routes.reduce((sum, route) => {
      if (stopId !== null && route.id !== stopId) return sum;
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
      ready = (await evaluate(`return document.querySelector('[data-testid="timetable-list"]') !== null;`)) === true;
      if (!ready) await delay(250);
    }
    check('화면 렌더(시간표 목록 존재)', ready);

    // ── ③ 본문이 계약 JSON 기반으로 그려진다 / ② 요일 탭 전환 ───────────────
    const initial = await evaluate(`
      const card = document.querySelector('[data-testid="timetable-list"]');
      const listCard = document.querySelector('[data-testid="timetable-section"]');
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
      return {
        tabs: tabs.length,
        selectedTab: selected?.id ?? null,
        tabNotes: tabs.map((tab) => tab.textContent.trim()),
        cardReady: card !== null,
        listReady: listCard !== null,
        listDay: listCard?.dataset.day ?? null,
        nextTime: document.querySelector('[data-testid="timetable-row"][data-next="true"] .shuttle-departure__time')?.textContent ?? null,
        nextCount: document.querySelectorAll('[data-testid="timetable-row"][data-next="true"]').length,
        clock: document.querySelector('[data-testid="app-clock"]')?.textContent ?? null,
        boardNotice: document.querySelector('[data-testid="day-notice"]')?.textContent ?? null,
        chips: document.querySelectorAll('[data-testid="direction-toggle"]').length,
        stopChips: document.querySelectorAll('[data-testid="stop-chip"]').length,
        listRows: document.querySelectorAll('[data-testid="timetable-list"] [data-testid="timetable-row"]').length,
        refreshLine: document.querySelector('[data-testid="data-refresh-line"]')?.textContent ?? null,
        sourceDetails: document.querySelectorAll('[data-testid="source-details"]').length,
        timetable: document.querySelector('[data-testid="timetable"]') !== null,
        schoolLinks: document.querySelectorAll('a[href*="lily.sunmoon.ac.kr"]').length,
        visibleSourceCount: (document.body.innerText.match(/원본/g) ?? []).length,
      };
    `);
    check('요일 탭 3개', initial.tabs === 3, `tabs=${String(initial.tabs)}`);
    check('오늘(KST) 탭이 기본 선택', initial.selectedTab === 'shuttle-day-tab-weekday', `selected=${String(initial.selectedTab)}`);
    check(
      '요일 탭 라벨이 `평일`·`토요일`·`일요일` 만이다(부가 텍스트 0 — T30 §12-2)',
      initial.tabNotes.join('|') === '평일|토요일|일요일' && !initial.tabNotes.some((note) => /노선|개|\(|\)|오늘/.test(String(note))),
      `탭=${JSON.stringify(initial.tabNotes)}`,
    );
    // ── T27 시간표 중심 구조(§9) ──
    check('T27 상단 바: 오늘 날짜·현재 시각(KST, `·` 구분)', String(initial.clock).includes('10월 5일 (월) · 14:40'), `clock=${String(initial.clock)}`);
    check('V1 공지 배너: 대체 시간표 안내', String(initial.boardNotice).includes('일요일 시간표로 운행합니다'), String(initial.boardNotice));
    // T27: 히어로 카드 대신 **시간표 섹션 하나**가 본문이다(대체휴일 → 일요일 시간표 적용).
    check('T27 본문 = 시간표 섹션 하나(적용 시간표 일요일)', initial.listReady === true && initial.listDay === 'sunday', `day=${String(initial.listDay)}`);
    check('T27 다음 출발 행이 정확히 하나 강조된다', initial.nextCount === 1, `count=${String(initial.nextCount)}`);
    check('T27 강조 행 시각이 고른 정류장(아산(KTX)역)의 가장 가까운 남은 편', initial.nextTime === '16:10', `next=${String(initial.nextTime)}`);
    // 2026-11-08 — 방향은 시간표 머리 토글 1개 · 정류장 칩 4개(`전체` 없음)
    check('방향 토글 1개 · 정류장 칩 4개', initial.chips === 1 && initial.stopChips === 4, `toggle=${String(initial.chips)} stops=${String(initial.stopChips)}`);
    check('V1 오늘 남은 출발 목록', initial.listRows > 0, `list rows=${String(initial.listRows)}`);
    check(
      'T27 시간표 행 수 = 발행물 판정 편수',
      initial.listRows === expectedRowsOf(String(initial.listDay)),
      `화면=${String(initial.listRows)}행 · 발행물=${String(expectedRowsOf(String(initial.listDay)))}편`,
    );
    // ── T14: 홈에서 원본 노출 0 ──
    check('T14 접힘 원본표·원본 시간표가 홈에 없다', initial.sourceDetails === 0 && initial.timetable === false, `sourceDetails=${String(initial.sourceDetails)} timetable=${String(initial.timetable)}`);
    check('T14 최신 데이터 1줄(`데이터 갱신: …`)', String(initial.refreshLine ?? '').startsWith('데이터 갱신:'), String(initial.refreshLine));
    check('T14 홈에 `원본` 0회 · 학교 링크 ≤1(대표 출처 1줄)', initial.visibleSourceCount === 0 && initial.schoolLinks <= 1, `원본=${String(initial.visibleSourceCount)} links=${String(initial.schoolLinks)}`);

    const freshPath = await capture('T5-4-다음버스카드.png', '[data-testid="timetable-list"]');

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
        listDay: document.querySelector('[data-testid="timetable-section"]')?.dataset.day ?? null,
        listRows: document.querySelectorAll('[data-testid="timetable-list"] [data-testid="timetable-row"]').length,
      };
    `);
    check('키보드(→)로 토요일 탭 이동', afterKey.selected === 'shuttle-day-tab-saturday', `selected=${String(afterKey.selected)}`);
    check('키보드 이동 후 포커스 유지', afterKey.focus === 'shuttle-day-tab-saturday', `focus=${String(afterKey.focus)}`);
    check(
      '토요일 탭에서도 시간표가 데이터로 그려진다',
      afterKey.listDay === 'saturday' && afterKey.listRows === expectedRowsOf('saturday'),
      `day=${String(afterKey.listDay)} rows=${String(afterKey.listRows)} 기대(발행물)=${String(expectedRowsOf('saturday'))}`,
    );
    const saturdayPath = await capture('T5-2-토요일탭.png');

    // 평일 탭으로 되돌린다(② 탭 왕복 — 노선 선택은 T14 에서 홈에서 제거됐다)
    check('평일 탭 클릭', await clickTab('weekday'));
    const weekdayPath = await capture('T5-1-평일탭.png');
    const back = await evaluate(`
      return {
        selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null,
        clock: document.querySelector('[data-testid="app-clock"]')?.textContent ?? null,
        nextTime: document.querySelector('[data-testid="timetable-row"][data-next="true"] .shuttle-departure__time')?.textContent ?? null,
        visibleSourceCount: (document.body.innerText.match(/원본/g) ?? []).length,
      };
    `);
    check('탭 왕복 후 평일로 복귀', back.selected === 'shuttle-day-tab-weekday', `selected=${String(back.selected)}`);
    check('탭 왕복 후에도 다음 출발 강조 시각 유지', back.nextTime === '16:10', `next=${String(back.nextTime)}`);
    check('탭 왕복 후에도 홈에 `원본` 0회(T14)', back.visibleSourceCount === 0, `원본=${String(back.visibleSourceCount)}`);
    const suspendedPath = await capture('T5-3-평일복귀.png');

    // ── T5c: `ⓘ 이용 안내` 패널 — 운행 중단 노선(천안캠퍼스) 잔여 문구 0 · 기존 안내는 유지 ──
    // 사용자 결정(F2b): 운행 중단 노선은 앱에서 **완전히 제거**. 데이터 계층은 원본을 보존하므로
    // 화면(DOM·스크린리더 텍스트)에서 사라졌는지를 여기서 실제로 확인한다.
    check('ⓘ 이용 안내 열기', await clickByTestId('app-info'));
    const guide = await evaluate(`
      const countOf = (text, needle) => text.split(needle).length - 1;
      const sheet = document.querySelector('[data-testid="guide-sheet"]');
      const panelText = sheet?.innerText ?? '';
      const bodyText = document.body.innerText ?? '';
      return {
        open: sheet !== null && !sheet.hasAttribute('hidden'),
        bodyCount: countOf(bodyText, '천안캠퍼스') + countOf(bodyText, '운행 중단'),
        panelCount: countOf(panelText, '천안캠퍼스') + countOf(panelText, '운행 중단'),
        panelLen: panelText.length,
        hasFreshness: panelText.includes('데이터 갱신'),
        hasUnofficial: panelText.includes('비공식'),
        hasPrivacy: panelText.includes('개인정보처리방침'),
        hasContacts: panelText.includes('041-530-2152') && panelText.includes('041-544-8710'),
        hasNoService: panelText.includes('운행 없는 날 안내') && panelText.includes('운행 없음'),
        hasAlternate: panelText.includes('대체 시간표 안내') && panelText.includes('일요일 시간표로 운행'),
        hasTariff: panelText.includes('요금 결제'),
        hasSafety: panelText.includes('지연될 수 있습니다') && panelText.includes('입석'),
        hasStopArea: panelText.includes('승강장') && panelText.includes('시내버스 참고'),
        noticeItems: document.querySelectorAll('[data-testid="notice-item"]').length,
        sourcePages: document.querySelectorAll('[data-testid="source-line"]').length,
      };
    `);
    check('ⓘ 시트가 열린다', guide.open === true, `open=${String(guide.open)} panelChars=${String(guide.panelLen)}`);
    check('T5c 패널 안 `천안캠퍼스`·`운행 중단` 0건', guide.panelCount === 0, `count=${String(guide.panelCount)}`);
    check('T5c 화면 전체(본문+패널) `천안캠퍼스`·`운행 중단` 0건', guide.bodyCount === 0, `count=${String(guide.bodyCount)}`);
    // 스크린리더 텍스트(접근성 트리 이름·설명)까지 확인 — 눈에 안 보이는 라벨도 포함한다.
    await cdp.send('Accessibility.enable');
    const axTree = await cdp.send('Accessibility.getFullAXTree');
    const axText = (axTree.nodes ?? [])
      .map((node) => `${node.name?.value ?? ''} ${node.description?.value ?? ''}`)
      .join(' ');
    const axCount = axText.split('천안캠퍼스').length - 1 + (axText.split('운행 중단').length - 1);
    check('T5c 스크린리더 텍스트(접근성 트리) `천안캠퍼스`·`운행 중단` 0건', axCount === 0, `count=${String(axCount)} nodes=${String((axTree.nodes ?? []).length)}`);
    check('T5c 유지: 패널에 신선도 문구 `데이터 갱신`', guide.hasFreshness === true);
    check('T5c 유지: 패널에 비공식 고지', guide.hasUnofficial === true);
    check('T5c 유지: 개인정보처리방침·문의처 2건(학교·운수사)', guide.hasPrivacy === true && guide.hasContacts === true, `privacy=${String(guide.hasPrivacy)} contacts=${String(guide.hasContacts)}`);
    check('T5c 유지: 운행 없는 날·대체 시간표 안내', guide.hasNoService === true && guide.hasAlternate === true, `noService=${String(guide.hasNoService)} alternate=${String(guide.hasAlternate)}`);
    check('T5c 유지: 요금·안전 안내·승강장(시내버스 참고)', guide.hasTariff === true && guide.hasSafety === true && guide.hasStopArea === true, `tariff=${String(guide.hasTariff)} safety=${String(guide.hasSafety)} stopArea=${String(guide.hasStopArea)}`);
    notes.push(`  INFO  패널 안내문 ${String(guide.noticeItems)}줄 · 출처 줄 ${String(guide.sourcePages)}개 · 패널 텍스트 ${String(guide.panelLen)}자`);

    // 스크린샷 — 시트를 세로로 넓혀 전체 내용을 한 장에 담는다(이후 오프라인 단계가 페이지를 새로 열므로 영향 없음).
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 3200, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    const sheetShotPath = await capture('T5c-정보패널.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
    await delay(150);
    check('ⓘ 이용 안내 닫기', await clickByTestId('guide-close'));
    check('T5c 콘솔 오류 0(ⓘ 열기·닫기 포함)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    // ── 데이터 로드 실패 시 오류 UI(조용한 실패 금지) — CDP 로 요청을 실제로 실패시켜 확인 ──
    // ⚠️ T6 이후: 캐시(SW·IndexedDB)가 채워져 있으면 실패해도 **마지막 정상 데이터**가 뜨는 게 정상 동작이다
    //    (그 검증은 scripts/offline_smoke.mjs 의 AC-5 단계가 한다). 여기서 확인하는 것은 "캐시가 전혀 없을 때"의
    //    F8 오류 UI 이므로, 먼저 SW 등록을 해제하고 SW 캐시·IndexedDB 를 비우고, 재등록되지 않게 sw.js 를 404 로 내린다.
    const clearedStorage = await evaluate(`
      const unregister = navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())).then(() => registrations.length));
      const dropCaches = caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))).then(() => keys));
      const dropIdb = new Promise((resolve) => {
        const request = indexedDB.deleteDatabase('sunmoon-shuttle');
        request.onsuccess = () => resolve('deleted');
        request.onerror = () => resolve('error');
        request.onblocked = () => resolve('blocked');
      });
      return Promise.all([unregister, dropCaches, dropIdb]).then(([registrations, caches2, idb]) => ({ registrations, caches: caches2, idb }));
    `);
    blockSwScripts = true;
    notes.push(`  INFO  실패 주입 전 캐시 비우기(T6): ${JSON.stringify(clearedStorage)}`);
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
    check('데이터 로드 실패 시 오류 UI + 학교 안내 링크', errorBanner !== null && String(errorBanner.link).startsWith('https://lily.sunmoon.ac.kr'), JSON.stringify(errorBanner));
    check('오류 UI 는 alert 역할 · 재시도 버튼 포함', errorBanner?.role === 'alert' && errorBanner?.hasRetry === true, `role=${String(errorBanner?.role)} retry=${String(errorBanner?.hasRetry)}`);
    check('오류 상태에서도 빈 화면 아님', errorBanner?.notBlank === true, `app=${String(errorBanner?.notBlank)}`);
    await cdp.send('Fetch.disable');

    // ── ① 콘솔 오류 0 (정상 경로) ────────────────────────────────────
    check('콘솔 오류 0(정상 경로)', consoleErrorsBeforeOffline === 0, consoleErrors.slice(0, consoleErrorsBeforeOffline).join(' | '));
    notes.push(`  INFO  콘솔 경고 ${String(consoleWarnings.length)}건${consoleWarnings.length === 0 ? '' : `: ${consoleWarnings.slice(0, 2).join(' | ')}`}`);

    console.log('\n검사 결과:');
    for (const line of notes) console.log(line);
    console.log('\n스크린샷:');
    for (const path of [weekdayPath, saturdayPath, suspendedPath, freshPath, sheetShotPath]) console.log(`  ${path}`);
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
