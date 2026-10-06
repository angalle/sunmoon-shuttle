#!/usr/bin/env node
/**
 * T22 앱 판정·표시 스모크 — **헤드리스 Chrome CDP**, 의존성 0(v1_smoke.mjs 와 같은 방식).
 *
 * 검증하는 것 (태스크 T22 수용 기준 · `docs/06-data-model.md §5`)
 *  ① **금요일 주입**(`?now=` 2026-10-16 08:00): 금요일에 운행하지 않는 편(구조화 조건)이 목록에서 사라진다
 *     — 같은 데이터의 **월요일 주입**(2026-10-19 08:00)과 편수·행을 대조한다(사라짐의 증거).
 *  ② **사유 표시**: 월요일 목록의 아산(KTX)역 08:35 편에 `금요일 운행 없음` 배지가 붙는다
 *     (요일 범위 편은 `월·화만 운행` · `2대 운행`).
 *  ③ 소요시간 `약 N분 소요`가 값이 있는 편에만 붙는다.
 *  ④ `needsReview`·`unknownNote` 같은 내부 플래그 문자가 화면 텍스트에 나오지 않는다.
 *  ⑤ T14 계약 유지 — 화면에 `원본` 0회 · 학교 링크 ≤1 · `source-details` 0개 · 콘솔 오류 0.
 *  ⑥ 월요일·토요일·일요일·한글날(운행 없음)·개교기념일(운행 없음) 주입 화면 — **스크린샷 각 1장**.
 *
 * 사용: node scripts/t22_smoke.mjs [--base=/sunmoon-shuttle/]
 * 산출물: .session-notes/T22-*.png (시나리오별 스크린샷 — 태스크 요구 5~6장)
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

/** 화면 상태를 한 번에 읽는다(증거·검사 공용). */
const READ = `
  const text = (node) => (node === null ? null : (node.textContent || '').replace(/\\\\s+/g, ' ').trim());
  const listCard = document.querySelector('[data-testid="departure-list-card"]');
  const rows = [...document.querySelectorAll('[data-testid="departure-list"] [data-testid="departure-row"]')];
  const restRows = [...document.querySelectorAll('[data-testid="departure-rest"] [data-testid="departure-row"]')];
  const allRows = [...rows, ...restRows];
  const readRow = (row) => ({
    time: text(row.querySelector('.shuttle-departure__time')),
    route: text(row.querySelector('.shuttle-departure__route')),
    detail: text(row.querySelector('.shuttle-departure__dir')),
    badges: [...row.querySelectorAll('.shuttle-badge')].map((badge) => (badge.textContent || '').trim()),
    dayOffset: Number(row.dataset.dayOffset ?? '-1'),
  });
  const schoolLinks = [...document.querySelectorAll('a[href*="lily.sunmoon.ac.kr"]')];
  return {
    clockText: text(document.querySelector('[data-testid="app-clock"]')),
    countsText: text(document.querySelector('[data-testid="board-counts"]')),
    noticeKind: document.querySelector('[data-testid="board-notice"]')?.dataset.kind ?? null,
    noticeText: text(document.querySelector('[data-testid="board-notice"]')),
    headlineKind: document.querySelector('[data-testid="departure-no-service"]') !== null ? 'no-service'
      : document.querySelector('[data-testid="board-today-over"]') !== null ? 'today-over'
      : document.querySelector('[data-testid="departure-empty"]') !== null ? 'empty' : null,
    headlineText: text(document.querySelector('[data-testid="departure-no-service"]') ?? document.querySelector('[data-testid="board-today-over"]')),
    listCardText: text(listCard),
    rows: allRows.map(readRow),
    hero: text(document.querySelector('[data-testid="next-bus-time"]')),
    heroDetail: text(document.querySelector('[data-testid="next-bus-remaining"]')),
    sourceDetailsCount: document.querySelectorAll('[data-testid="source-details"]').length,
    schoolLinkCount: schoolLinks.length,
    visibleSourceCount: (document.body.innerText.match(/원본/g) ?? []).length,
    domSourceCount: (document.body.textContent.match(/원본/g) ?? []).length,
    internalFlagMentions: (document.body.textContent.match(/needsReview|unknownNote/g) ?? []).length,
    canvasCount: document.querySelectorAll('.shuttle-app *').length,
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

/* ── 발행물의 조건 필드로만 만드는 대조 계산(앱 판정의 재구현이 아니라 **증거 대조**) ── */
const hasDepartureTime = (row) => (row['depCampus'] ?? row['depStation'] ?? row['depTerminal'] ?? null) !== null;

/** 그 요일에 그 편이 조건상 빠지는가(`excludedDays` 포함 · `dayScope` 미포함). */
function offOn(row, weekdayCode) {
  const service = row['service'];
  if (service === null || service === undefined) return false;
  const excludedDays = service['excludedDays'] ?? [];
  if (excludedDays.includes(weekdayCode)) return true;
  const dayScope = service['dayScope'] ?? null;
  return dayScope !== null && dayScope.length > 0 && !dayScope.includes(weekdayCode);
}

/** 발행물에서 계산한 기대 편수(안내 시각이 있는 회차만 — 앱의 `총 N편` 과 같은 필터). */
function expectedTripTotal(raw, dayType, weekdayCode) {
  let total = 0;
  for (const route of raw.routes) {
    const table = route.byDay?.[dayType];
    if (table === null || table === undefined) continue;
    for (const row of table.trips) {
      if (!hasDepartureTime(row)) continue;
      if (offOn(row, weekdayCode)) continue;
      total += 1;
    }
  }
  return total;
}

/** 발행물에서 `금(X)` 로 구조화된 (노선명 · 출발시각 · 순번) — 사라짐 대조용. */
function fridayExcludedRefs(raw) {
  const out = [];
  for (const route of raw.routes) {
    const table = route.byDay?.weekday;
    if (table === null || table === undefined) continue;
    for (const row of table.trips) {
      if (!hasDepartureTime(row)) continue;
      if (!offOn(row, 'fri')) continue;
      out.push({ route: route.name, time: row['depCampus'] ?? row['depStation'] ?? row['depTerminal'], seq: row['seq'] });
    }
  }
  return out;
}

const CASE = [
  {
    label: '① 금요일 2026-10-16 08:00 (금요일 주입 — 미운행 편이 사라진다)',
    now: '2026-10-16T08:00:00+09:00',
    clock: '10월 16일 (금) 08:00',
    dayType: 'weekday',
    weekdayCode: 'fri',
    shot: 'T22-1-금요일0800.png',
  },
  {
    label: '② 월요일 2026-10-19 08:00 (평일 대조 — 같은 편이 사유 배지와 함께 보인다)',
    now: '2026-10-19T08:00:00+09:00',
    clock: '10월 19일 (월) 08:00',
    dayType: 'weekday',
    weekdayCode: 'mon',
    shot: 'T22-2-월요일0800.png',
  },
  {
    label: '③ 토요일 2026-10-17 08:00',
    now: '2026-10-17T08:00:00+09:00',
    clock: '10월 17일 (토) 08:00',
    dayType: 'saturday',
    weekdayCode: 'sat',
    shot: 'T22-3-토요일0800.png',
  },
  {
    label: '④ 일요일 2026-10-18 08:00',
    now: '2026-10-18T08:00:00+09:00',
    clock: '10월 18일 (일) 08:00',
    dayType: 'sunday',
    weekdayCode: 'sun',
    shot: 'T22-4-일요일0800.png',
  },
  {
    label: '⑤ 한글날 2026-10-09 08:00 (공휴일 — 전 노선 운행 없음)',
    now: '2026-10-09T08:00:00+09:00',
    clock: '10월 9일 (금) 08:00',
    dayType: 'weekday',
    weekdayCode: 'fri',
    shot: 'T22-5-한글날0800.png',
    noService: true,
  },
  {
    label: '⑥ 개교기념일 2026-10-28 08:00 (공휴일 — 전 노선 운행 없음)',
    now: '2026-10-28T08:00:00+09:00',
    clock: '10월 28일 (수) 08:00',
    dayType: 'weekday',
    weekdayCode: 'wed',
    shot: 'T22-6-개교기념일0800.png',
    noService: true,
  },
];

const countsOf = (text) => {
  const match = /총 (\d+)편(?: · 남은 (\d+)편)?/.exec(String(text ?? ''));
  return match === null ? { total: -1, remaining: -1 } : { total: Number(match[1]), remaining: match[2] === undefined ? -1 : Number(match[2]) };
};

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');

  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const excludedOnFriday = fridayExcludedRefs(raw);

  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));
  mkdirSync(SHOT_DIR, { recursive: true });

  const webPort = await freePort();
  const debugPort = await freePort();
  const server = await startStaticServer(webPort, BASE);
  const profileDir = join(tmpdir(), `t22-smoke-${String(process.pid)}`);
  const urlFor = (now) => `http://127.0.0.1:${webPort}${BASE}?now=${encodeURIComponent(now)}`;

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

    const states = new Map();
    for (const testCase of CASE) {
      check(`${testCase.label}: 페이지 렌더`, await open(urlFor(testCase.now)));
      const state = await evaluate(READ);
      states.set(testCase.label, state);
      check(`${testCase.label}: 상태줄 = ${testCase.clock}`, String(state.clockText).includes(testCase.clock), String(state.clockText));
      check(
        `${testCase.label}: T14 계약 유지(원본 0회 · 원본표 0 · 학교 링크 ≤1 · 내부 플래그 0)`,
        state.visibleSourceCount === 0 && state.domSourceCount === 0 && state.sourceDetailsCount === 0 && state.schoolLinkCount <= 1 && state.internalFlagMentions === 0,
        JSON.stringify({ visible: state.visibleSourceCount, dom: state.domSourceCount, details: state.sourceDetailsCount, links: state.schoolLinkCount, internalFlags: state.internalFlagMentions }),
      );
      if (testCase.noService === true) {
        check(
          `${testCase.label}: 운행 없음 배너 + 목록 행 0`,
          state.noticeKind === 'no-service' && state.headlineKind === 'no-service' && state.rows.length === 0 && state.countsText === null,
          `notice=${String(state.noticeKind)} headline=${String(state.headlineKind)} rows=${String(state.rows.length)} counts=${String(state.countsText)}`,
        );
      } else {
        const expected = expectedTripTotal(raw, testCase.dayType, testCase.weekdayCode);
        const counts = countsOf(state.countsText);
        check(
          `${testCase.label}: 목록·히어로는 그 날 실제 운행하는 편만 — 편수 = 발행물 조건 대조 ${String(expected)}편`,
          counts.total === expected,
          `화면=${String(counts.total)}편 · 발행물 대조=${String(expected)}편 (${String(state.countsText)})`,
        );
        check(`${testCase.label}: 소요시간 보조 문구가 값 있는 편에 붙는다(약 N분 소요)`, state.rows.every((row) => row.detail === null || !/약 \d+분 소요/.test(row.detail) || /· 약 \d+분 소요$/.test(row.detail)), JSON.stringify(state.rows.slice(0, 2).map((row) => row.detail)));
      }
      await captureViewport(testCase.shot);
      info(
        `${testCase.label}: hero=${String(state.hero)} · counts=${String(state.countsText)} · headline=${String(state.headlineText)} · badges=${JSON.stringify(state.rows.flatMap((row) => row.badges).slice(0, 6))}`,
      );
    }

    /* ── ①② 금요일 vs 월요일 — 사라짐과 사유 표시 ───────────────────────────── */
    const friday = states.get(CASE[0].label);
    const monday = states.get(CASE[1].label);
    const fridayCounts = countsOf(friday?.countsText);
    const mondayCounts = countsOf(monday?.countsText);
    const fridayKeys = new Set((friday?.rows ?? []).map((row) => `${row.route}|${row.time}`));
    const mondayKeys = new Set((monday?.rows ?? []).map((row) => `${row.route}|${row.time}`));

    check(
      '① 금요일 편수가 월요일 편수보다 정확히 "금요일 미운행 편수"만큼 적다',
      mondayCounts.total - fridayCounts.total === excludedOnFriday.length && excludedOnFriday.length > 0,
      `월=${String(mondayCounts.total)} 금=${String(fridayCounts.total)} 차이=${String(mondayCounts.total - fridayCounts.total)} · 발행물 금요일 미운행 편수=${String(excludedOnFriday.length)}`,
    );
    check(
      '① 금요일 목록은 월요일 목록의 부분집합이다(다른 편이 새로 생기지 않는다)',
      [...fridayKeys].every((key) => mondayKeys.has(key)),
      `금 전용=${JSON.stringify([...fridayKeys].filter((key) => !mondayKeys.has(key)))}`,
    );
    const asanSeq2 = excludedOnFriday.find((ref) => ref.route === '아산(KTX)역' && ref.time === '08:35');
    check('① 발행물 대조 대상(아산(KTX)역 08:35 · 금(X))이 존재한다', asanSeq2 !== undefined, JSON.stringify(excludedOnFriday.slice(0, 3)));
    check(
      '① 금요일: 그 편(아산(KTX)역 08:35)이 목록에 없다 — 행 대조',
      fridayKeys.has('아산(KTX)역|08:35') === false,
      `금요일 아산(KTX)역 편=${JSON.stringify((friday?.rows ?? []).filter((row) => row.route === '아산(KTX)역').map((row) => row.time))}`,
    );
    check(
      '② 월요일: 같은 편이 목록에 있고 `금요일 운행 없음` 배지로 사유가 표시된다',
      mondayKeys.has('아산(KTX)역|08:35') &&
        (monday?.rows ?? []).some((row) => row.time === '08:35' && row.route === '아산(KTX)역' && row.badges.includes('금요일 운행 없음')),
      JSON.stringify((monday?.rows ?? []).filter((row) => row.badges.length > 0)),
    );
    const scopeBadges = (monday?.rows ?? []).flatMap((row) => row.badges).filter((badge) => /만 운행|대 운행/.test(badge));
    check('② 월요일: 요일 범위·대수 배지(`월·화만 운행` · `2대 운행`)도 표시된다', scopeBadges.includes('월·화만 운행') && scopeBadges.includes('2대 운행'), JSON.stringify(scopeBadges));
    check('③ 소요시간 문구가 실제로 화면에 보인다(약 N분 소요)', (monday?.rows ?? []).some((row) => /약 \d+분 소요/.test(String(row.detail))), JSON.stringify((monday?.rows ?? []).slice(0, 3).map((row) => row.detail)));
    check(
      '④ 내부 플래그(needsReview·unknownNote)는 화면 텍스트에 0회',
      friday?.internalFlagMentions === 0 && monday?.internalFlagMentions === 0,
      `금=${String(friday?.internalFlagMentions)} 월=${String(monday?.internalFlagMentions)}`,
    );

    /* ── ⑤ 공휴일 주입 화면 ─────────────────────────────────────────────── */
    const hangul = states.get(CASE[4].label);
    const anniversary = states.get(CASE[5].label);
    check(
      '⑤ 한글날(공휴일): 운행 없음 배너 + 사유(안내문 원문) 표시',
      hangul?.noticeKind === 'no-service' && String(hangul?.noticeText).includes('한글날'),
      JSON.stringify({ kind: hangul?.noticeKind, text: hangul?.noticeText }),
    );
    check(
      '⑤ 개교기념일(공휴일): 운행 없음 배너 + 사유(안내문 원문) 표시',
      anniversary?.noticeKind === 'no-service' && String(anniversary?.noticeText).includes('개교기념일'),
      JSON.stringify({ kind: anniversary?.noticeKind, text: anniversary?.noticeText }),
    );

    /* ── ⑥ 주말 화면 ────────────────────────────────────────────────────── */
    const saturday = states.get(CASE[2].label);
    const sunday = states.get(CASE[3].label);
    check(
      '⑥ 토·일 주입: 그 요일 표로 목록이 그려진다(빈 화면 아님 · 모두 오늘 편)',
      (saturday?.rows.length ?? 0) > 0 && (sunday?.rows.length ?? 0) > 0 && [...(saturday?.rows ?? []), ...(sunday?.rows ?? [])].every((row) => row.dayOffset === 0),
      `토=${String(saturday?.countsText)} 일=${String(sunday?.countsText)}`,
    );

    /* ── ⑦ 요청 출처·콘솔 ───────────────────────────────────────────────── */
    const appOrigin = `http://127.0.0.1:${String(webPort)}`;
    const requestOrigins = [...new Set(requestUrls.map((requestUrl) => new URL(requestUrl).origin))];
    const schoolRequests = requestUrls.filter((requestUrl) => /lily\.sunmoon\.ac\.kr/.test(requestUrl));
    check('⑦ 모든 리소스 요청이 단일 출처(로컬 서버)다', requestOrigins.length === 1 && requestOrigins[0] === appOrigin, `origins=${JSON.stringify(requestOrigins)}`);
    check('⑦ 학교 도메인 요청 0건(앱은 수집된 JSON 만 읽는다)', schoolRequests.length === 0, JSON.stringify(schoolRequests.slice(0, 3)));
    check('⑦ 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

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
    console.log('\nT22 SMOKE: PASS');
  }
}

main().catch((error) => {
  console.error(`T22 SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  process.exitCode = 1;
});
