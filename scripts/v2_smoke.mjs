#!/usr/bin/env node
/**
 * T17 스키마 v2 표시 스모크 — **헤드리스 Chrome CDP**, 의존성 0(v1_smoke.mjs 와 같은 방식).
 *
 * 검증하는 것 (태스크 T17 수용 기준 3·4·6)
 *  ① `dateRules[]` 기반 **다가오는 운행 변동**이 실제 DOM 에 뜬다 — 값·날짜·표기가 데이터에서 온다
 *       · 평일 2026-10-06 → `10월 9일 (금) 한글날 — 운행 없음` 1줄
 *       · 규칙이 창(14일) 안에 없는 날(토·일·한글날·개교기념일) → 배너 자체가 없다(빈 배너 금지)
 *  ② 오늘이 규칙 날이면(한글날 10-09 · 개교기념일 10-28) **상단 배너**(resolveDayService)가 말하고
 *     다가오는 목록에는 그 날짜가 없다(중복 금지 — 지시 ②)
 *  ③ `routes[].stopWindows[]` → 접힘 1개(`[data-testid="stop-window-details"]`)에 원문 표기 그대로
 *  ④ `routes[].tripNotes[]` → 다음 출발 목록의 도착 옆 보조 문구(`약 15분 소요` / `약 20분 소요`)
 *  ⑤ `terms[]` 방학 배너는 실제 데이터에서 뜨지 않는다(기간 미상 + needsReview)
 *  ⑥ T14 계약 유지 — 화면 `원본` 0회 · 학교 링크 ≤1 · 학교 도메인 요청 0건 · 콘솔 오류 0
 *  ⑦ 실제 오늘(주입 없음) 상태줄이 실제 KST 날짜와 일치
 *
 * 사용: node scripts/v2_smoke.mjs [--base=/sunmoon-shuttle/]
 * 산출물: .session-notes/T17-*.png (시나리오별 스크린샷)
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

const failures = [];
const notes = [];
const shots = [];
let cdp = null;
let chrome = null;

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
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
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

/** 첫 화면(뷰포트 390×844, 라이트 고정) 스크린샷 — 헤드리스는 호스트 다크 설정을 물려받는다. */
async function captureViewport(fileName) {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await delay(150);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  shots.push(path);
  return path;
}

/** 화면 상태를 한 번에 읽는다(증거·검사 공용) — T17 이 추가한 요소가 중심이다. */
const READ = `
  const text = (node) => (node === null ? null : (node.textContent || '').replace(/\\s+/g, ' ').trim());
  const clock = document.querySelector('[data-testid="app-clock"]');
  const upcoming = document.querySelector('[data-testid="upcoming-change"]');
  const upcomingLines = [...document.querySelectorAll('[data-testid="upcoming-change-line"]')];
  const stopDetails = document.querySelector('[data-testid="stop-window-details"]');
  const stopLines = [...document.querySelectorAll('[data-testid="stop-window-list"] li')];
  const dirCells = [...document.querySelectorAll('[data-testid="departure-row"] .shuttle-departure__dir')];
  const hero = document.querySelector('[data-testid="next-bus-remaining"]');
  const schoolLinks = [...document.querySelectorAll('a[href*="lily.sunmoon.ac.kr"]')];
  return {
    clockText: text(clock),
    notice: text(document.querySelector('[data-testid="board-notice"]')),
    noticeKind: document.querySelector('[data-testid="board-notice"]')?.dataset.kind ?? null,
    upcomingPresent: upcoming !== null,
    upcomingCount: upcoming === null ? null : upcoming.dataset.count ?? null,
    upcomingTotal: upcoming === null ? null : upcoming.dataset.total ?? null,
    upcomingLines: upcomingLines.map((li) => text(li)),
    upcomingKinds: upcomingLines.map((li) => li.dataset.kind ?? null),
    vacationPresent: document.querySelector('[data-testid="vacation-notice"]') !== null,
    stopDetailsPresent: stopDetails !== null,
    stopLines: stopLines.map((li) => text(li)),
    durationCells: dirCells.map((cell) => text(cell)),
    heroRemaining: text(hero),
    listRows: document.querySelectorAll('[data-testid="departure-list"] [data-testid="departure-row"]').length,
    schoolLinkCount: schoolLinks.length,
    visibleSourceCount: (document.body.innerText.match(/원본/g) ?? []).length,
    domSourceCount: (document.body.textContent.match(/원본/g) ?? []).length,
    listCardText: text(document.querySelector('[data-testid="departure-list-card"]')),
  };
`;

async function open(url) {
  await cdp.send('Page.navigate', { url });
  const deadline = Date.now() + 25_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    ready =
      (await evaluate(
        `return document.querySelector('[data-testid="loading"]') === null && document.querySelector('[data-testid="next-bus-card"]') !== null;`,
      )) === true;
    if (!ready) await delay(250);
  }
  return ready;
}

/** 실제 KST(호스트 TZ 무관) — 주입 없이 연 화면의 상태줄과 맞춰 본다. */
function kstNow() {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/* ── 시나리오: 주입 시각 → 기대값(발행된 v2 데이터에서 나온 문구를 그대로 고정한다) ── */
const CASES = [
  {
    label: '① 평일 2026-10-06 09:00 — 14일 창 안에 규칙 1건',
    now: '2026-10-06T09:00:00+09:00',
    shot: 'T17-1-평일-다가오는변동.png',
    upcoming: ['10월 9일 (금) 한글날 — 운행 없음'],
    noticeKind: null,
  },
  {
    label: '② 토요일 2026-10-10 09:00 — 창 안 규칙 없음(배너 없음)',
    now: '2026-10-10T09:00:00+09:00',
    shot: 'T17-2-토요일.png',
    upcoming: [],
    noticeKind: null,
  },
  {
    label: '③ 일요일 2026-10-11 09:00 — 창 안 규칙 없음(배너 없음)',
    now: '2026-10-11T09:00:00+09:00',
    shot: 'T17-3-일요일.png',
    upcoming: [],
    noticeKind: null,
  },
  {
    label: '④ 한글날 2026-10-09 09:00 — 오늘 규칙은 상단 배너가 담당(중복 없음)',
    now: '2026-10-09T09:00:00+09:00',
    shot: 'T17-4-한글날-오늘규칙.png',
    upcoming: [],
    noticeKind: 'no-service',
  },
  {
    label: '⑤ 개교기념일 2026-10-28 09:00 — 규칙 안내가 있는 날',
    now: '2026-10-28T09:00:00+09:00',
    shot: 'T17-5-개교기념일-오늘규칙.png',
    upcoming: [],
    noticeKind: 'no-service',
  },
];

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
  const profileDir = join(tmpdir(), `t17-v2-${String(process.pid)}`);
  const urlFor = (now) => `http://127.0.0.1:${webPort}${BASE}${now === null ? '' : `?now=${encodeURIComponent(now)}`}`;

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
      '--window-size=390,1600',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const consoleErrors = [];
  const requestUrls = [];
  try {
    cdp = await connectCdp(await waitForDebugger(debugPort));
    cdp.on((message) => {
      if (message.method === 'Network.requestWillBeSent') {
        const url = message.params?.request?.url ?? '';
        if (typeof url === 'string' && url.startsWith('http')) requestUrls.push(url);
      }
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
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1600, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    for (const testCase of CASES) {
      check(`${testCase.label}: 페이지 렌더`, await open(urlFor(testCase.now)));
      const state = await evaluate(READ);
      check(
        `${testCase.label}: 다가오는 운행 변동 줄 = ${JSON.stringify(testCase.upcoming)}`,
        JSON.stringify(state.upcomingLines) === JSON.stringify(testCase.upcoming),
        `lines=${JSON.stringify(state.upcomingLines)} total=${String(state.upcomingTotal)}`,
      );
      check(
        `${testCase.label}: 배너 표시 여부(줄 0건이면 배너 없음)`,
        state.upcomingPresent === (testCase.upcoming.length > 0),
        `present=${String(state.upcomingPresent)}`,
      );
      if (testCase.noticeKind === null) {
        check(`${testCase.label}: 오늘 공지 배너 없음`, state.noticeKind === null, JSON.stringify(state.notice));
      } else {
        check(
          `${testCase.label}: 오늘 규칙은 상단 배너(resolveDayService)가 담당`,
          state.noticeKind === testCase.noticeKind,
          `kind=${String(state.noticeKind)} text=${String(state.notice)}`,
        );
      }
      // ③ 정차 창 접힘 1개 · ④ 소요시간 보조 문구 · ⑤ 방학 배너 없음
      check(
        `${testCase.label}: 정차 창 접힘 1개(원문 표기)`,
        state.stopDetailsPresent === true &&
          state.stopLines.length === 1 &&
          state.stopLines[0] === '학생회관 승강장 (학기 중): 13:30~15:30 · 19:30~막차까지',
        JSON.stringify(state.stopLines),
      );
      check(
        `${testCase.label}: 목록 행에 소요시간 보조 문구(약 N분 소요)`,
        state.listRows === 0 || state.durationCells.some((cell) => /· 약 \d+분 소요$/.test(String(cell))),
        JSON.stringify(state.durationCells.slice(0, 2)),
      );
      check(`${testCase.label}: 방학 배너 없음(기간 미상·needsReview)`, state.vacationPresent === false);
      check(
        `${testCase.label}: T14 계약 유지(원본 0회 · 학교 링크 ≤1)`,
        state.visibleSourceCount === 0 && state.domSourceCount === 0 && state.schoolLinkCount <= 1,
        `innerText=${String(state.visibleSourceCount)} textContent=${String(state.domSourceCount)} links=${String(state.schoolLinkCount)}`,
      );
      await captureViewport(testCase.shot);
      info(
        `${testCase.label}: clock=${String(state.clockText)} · upcoming=${JSON.stringify(state.upcomingLines)} · stop=${JSON.stringify(state.stopLines)} · duration=${JSON.stringify(state.durationCells.slice(0, 2))}`,
      );
    }

    // ── ⑦ 실제 오늘(주입 없음) ─────────────────────────────────────────────
    check('⑦ 실제 오늘(주입 없음): 페이지 렌더', await open(urlFor(null)));
    const today = await evaluate(READ);
    const nowKst = kstNow();
    check(
      `⑦ 실제 오늘 상태줄이 실제 KST 날짜와 일치(${String(nowKst.month)}월 ${String(nowKst.day)}일)`,
      String(today.clockText).includes(`${String(nowKst.month)}월 ${String(nowKst.day)}일 (`),
      String(today.clockText),
    );
    check(
      '⑦ 실제 오늘: 다가오는 변동은 배너가 있으면 1~2줄, 없으면 줄 0개(빈 배너 금지)',
      today.upcomingPresent === (today.upcomingLines.length > 0) && today.upcomingLines.length <= 2,
      `present=${String(today.upcomingPresent)} lines=${JSON.stringify(today.upcomingLines)}`,
    );
    todayShot = await captureViewport('T17-6-오늘-실측.png');
    info(
      `⑦ 실제 오늘: clock=${String(today.clockText)} · upcoming=${JSON.stringify(today.upcomingLines)} · notice=${String(today.notice)} · shot=${String(todayShot)}`,
    );
    // ── ⑥ 요청 출처·콘솔 ───────────────────────────────────────────────────
    const appOrigin = `http://127.0.0.1:${String(webPort)}`;
    const requestOrigins = [...new Set(requestUrls.map((requestUrl) => new URL(requestUrl).origin))];
    const schoolRequests = requestUrls.filter((requestUrl) => /lily\.sunmoon\.ac\.kr/.test(requestUrl));
    check(
      '⑥ 모든 리소스 요청이 단일 출처(로컬 서버)다',
      requestOrigins.length === 1 && requestOrigins[0] === appOrigin,
      `origins=${JSON.stringify(requestOrigins)} requests=${String(requestUrls.length)}`,
    );
    check('⑥ 학교 도메인 요청 0건', schoolRequests.length === 0, JSON.stringify(schoolRequests.slice(0, 3)));
    check('⑥ 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

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
    console.log('\nV2 SMOKE: PASS');
  }
}

let todayShot = null;

main().catch((error) => {
  console.error(`V2 SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  process.exitCode = 1;
});
