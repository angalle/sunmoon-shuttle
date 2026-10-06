#!/usr/bin/env node
/**
 * 간편 홈 스모크 (T12 → **T27 시간표 중심 단순화로 재기준**) — **헤드리스 Chrome CDP**, 의존성 0.
 *
 * 검증하는 것 (docs/07 §9 · 수용 기준 AC-U9 · T14 계약 유지)
 *  ① **본문 = 시간표 하나** — `[data-testid="timetable-section"]` 안에 그 요일 **전체 회차**가
 *     `[data-testid="timetable-row"]` 로 그려지고, 행 수 = 발행물에서 계산한 그 요일 판정 편수.
 *     (T27 §9-1 로 히어로 카드·탭 분리·5편 잘림·"더 보기" 가 사라졌다 — 옛 V1 5편 잘림 검사는 폐기.)
 *  ② **상단 바** — `[data-testid="app-clock"]` 오늘 날짜·현재 시각을 `10월 6일 (화) · 08:00` 형식으로.
 *  ③ **다음 출발 행 강조** — `[data-testid="timetable-row"][data-next="true"]` 가 정확히 1개(§9-3).
 *  ④ **지난 편 dim** — 기준 시각 이전 행은 `data-past="true"`, 강조 행은 첫 non-past 행(§9-3).
 *  ⑤ **노선 통합 정렬** — 출발 시각 오름차순.
 *  ⑥ **요일 조건은 짧은 토큰 1개**(`data-token`, 8자 이하 — 긴 사유 문구 금지).
 *  ⑦ **공지 1줄(조건부)** — `resolveDayService` 결과: 대체 시간표 / 운행 없음 / 오늘 종료(§9-4).
 *  ⑧ 자정 경계(23:59 → 00:01) — 상단 바·시간표·강조 행이 **다음 날로** 넘어간다.
 *  ⑨ 오늘 실측(주입 없이 실제 시각) · 콘솔 오류 0 · 요청 출처 단일(학교 도메인 0건).
 *  ⑩ **원본 노출 0** — `details[data-testid="source-details"]` 0개, `[data-testid="timetable"]` 0개,
 *     `a[href*="lily.sunmoon.ac.kr"]` ≤ 1개, 화면 텍스트에 `원본` 0회.
 *  ⑪ **§9-2/§9-5 이행** — 소개문구·앱 이름이 본문에 없고, `데이터 갱신`·`출처`·미해석 경고는
 *     **정보 시트(ⓘ) 안**에 있다(본문 아님).
 *
 * 왜 재기준했나: T27 이 화면 구조를 바꿨다(사용자 지시). 검증 **의미**(판정 편수·자정 경계·요일 전환·
 * 원본 0회)는 유지하고, 사라진 UI(히어로 카드·앱 탭·5편 잘림·dayOffset)에 묶인 검사만
 * 새 구조의 동등 검사로 바꿨다 — 기대값을 낮춘 곳은 없다(행 수는 발행물과 대조한다).
 *
 * 사용: node scripts/v1_smoke.mjs [--base=/sunmoon-shuttle/]
 * 산출물: .session-notes/T12-*.png · .session-notes/T14-*.png (시나리오별 스크린샷)
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

/** 시나리오별 스크린샷 — 전체 페이지(증거용). */
async function capture(fileName) {
  const layout = await cdp.send('Page.getLayoutMetrics');
  const contentHeight = Math.ceil(layout.cssContentSize?.height ?? 1200);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: Math.min(contentHeight, 9000),
    deviceScaleFactor: 2,
    mobile: true,
  });
  await delay(150);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  shots.push(path);
  return path;
}

/**
 * **첫 화면** 스크린샷(T13) — 뷰포트(390×844)만 찍는다.
 * `captureBeyondViewport` 는 닫힌 `<details>` 내용까지 그려 버려 "심플한 첫 화면" 증거로 부적합하다(실측).
 * 라이트 모드도 함께 고정한다 — 헤드리스 Chrome 은 호스트 OS 의 다크 설정을 물려받는다.
 */
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

/** 화면 상태를 한 번에 읽는다(증거·검사 공용) — T27 구조: 본문 시간표 하나 + 상단 바 + 정보 시트. */
const READ = `
  const listCard = document.querySelector('[data-testid="timetable-section"]');
  const rows = [...document.querySelectorAll('[data-testid="timetable-list"] [data-testid="timetable-row"]')];
  const cellTime = (row) => { const t = row.querySelector('.shuttle-departure__time'); return t === null ? null : (t.textContent || '').trim(); };
  const nextRow = rows.find((row) => row.dataset.next === 'true') ?? null;
  const chips = [...document.querySelectorAll('[data-testid="direction-chip"]')];
  const clock = document.querySelector('[data-testid="app-clock"]');
  const notice = document.querySelector('[data-testid="day-notice"]');
  const sheet = document.querySelector('[data-testid="guide-sheet"]');
  const inSheet = (testid) => (sheet === null ? null : sheet.querySelector('[data-testid="' + testid + '"]'));
  const textOf = (node) => (node === null ? null : (node.textContent || '').trim());
  const warn = inSheet('guide-warnings');
  const refresh = inSheet('data-refresh-line');
  const sourceLine = inSheet('source-line');
  const sourceDetails = [...document.querySelectorAll('[data-testid="source-details"]')];
  const schoolLinks = [...document.querySelectorAll('a[href*="lily.sunmoon.ac.kr"]')];
  const clockText = textOf(clock);
  return {
    hasApp: document.querySelector('.shuttle-app') !== null,
    clockText,
    clockDatetime: clock === null ? null : clock.getAttribute('datetime'),
    notice: notice === null ? null : { kind: notice.dataset.kind ?? null, text: (notice.textContent || '').trim() },
    // ── 본문 시간표(§9-1) ──
    listDay: listCard === null ? null : (listCard.dataset.day ?? null),
    listIsToday: listCard === null ? null : (listCard.dataset.today ?? null),
    listRows: rows.length,
    emptyShown: document.querySelector('[data-testid="timetable-empty"]') !== null,
    times: rows.map(cellTime),
    directions: rows.map((row) => row.dataset.direction ?? null),
    tokens: rows.map((row) => row.dataset.token ?? ''),
    pastFlags: rows.map((row) => row.dataset.past === 'true'),
    nextCount: rows.filter((row) => row.dataset.next === 'true').length,
    nextTime: nextRow === null ? null : cellTime(nextRow),
    nextIndex: nextRow === null ? -1 : rows.indexOf(nextRow),
    // ── 상단 바·요일 탭 ──
    dayTabIds: [...document.querySelectorAll('[data-testid="day-tabs"] [role="tab"]')].map((tab) => tab.id),
    // T27 §9-1 — 앱 셸 [지금]/[전체] 탭은 없다(화면 하나).
    appTabNodes: document.querySelectorAll('#shuttle-tab-now, #shuttle-tab-all, [data-testid="app-tabs"]').length,
    // ── 방향 필터(시간표의 축) ──
    chips: chips.map((chip) => ({ direction: chip.dataset.direction ?? null, pressed: chip.getAttribute('aria-pressed'), text: (chip.textContent || '').replace(/\\s+/g, ' ').trim() })),
    // ── T14 계약: 원본 노출 0 · 출처는 시트 안 1줄 ──
    sourceDetailsCount: sourceDetails.length,
    detailsCount: document.querySelectorAll('details').length,
    timetablePresent: document.querySelector('[data-testid="timetable"]') !== null,
    schoolLinkCount: schoolLinks.length,
    schoolLinks: schoolLinks.map((anchor) => anchor.getAttribute('href')),
    visibleSourceCount: (document.body.innerText.match(/원본/g) ?? []).length,
    domSourceCount: (document.body.textContent.match(/원본/g) ?? []).length,
    // ── §9-2: 소개문구·앱 이름 없음 ──
    subtitleKo: textOf(document.querySelector('.shuttle-header__subtitle:not([lang])')),
    subtitleEn: textOf(document.querySelector('.shuttle-header__subtitle[lang="en"]')),
    // 앱 이름은 낭독기용 제목(h1.shuttle-sr-only)으로만 남는다(§9-2 주석) — 화면에는 없다.
    titleVisibility: (() => {
      const h1 = document.querySelector('.shuttle-app h1');
      if (h1 === null) return null;
      return h1.classList.contains('shuttle-sr-only') ? 'sr-only' : 'visible';
    })(),
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').trim(),
    // ── §9-5: 데이터 갱신·출처·미해석 경고는 정보 시트 안 ──
    refreshLine: textOf(refresh),
    refreshInSheet: refresh !== null,
    sourceLine: textOf(sourceLine),
    sourceInSheet: sourceLine !== null,
    warnSummary: textOf(warn),
    warnSummaryItems: warn === null ? 0 : warn.querySelectorAll('li').length,
    warnInSheet: warn !== null,
    warnInBody: document.querySelector('#shuttle-main [data-testid="guide-warnings"]') !== null,
    listCardText: textOf(listCard),
  };
`;

/** 페이지를 열고 본문(시간표 또는 빈 안내)이 그려질 때까지 기다린다. */
async function open(url) {
  await cdp.send('Page.navigate', { url });
  const deadline = Date.now() + 25_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    ready =
      (await evaluate(
        `const loading = document.querySelector('[data-testid="loading"]') === null;
         const body = document.querySelector('[data-testid="timetable-list"]') !== null || document.querySelector('[data-testid="timetable-empty"]') !== null;
         return loading && body;`,
      )) === true;
    if (!ready) await delay(250);
  }
  return ready;
}

/** 시간 문자열(`HH:MM`) 비교용 분 환산 — 스크립트 검증 전용(앱 계산이 아니다). */
const minuteOf = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** 요일 코드 — 주입 날짜(`YYYY-MM-DD`)로만 계산한다(호스트 TZ 무관). */
const WEEKDAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekdayCodeOf = (isoDate) => {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  return WEEKDAY_CODES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
};

/** 발행물에서 계산한 **그 요일 기대 행 수**(출발 시각이 있고 그 요일에 운행하는 편만 — 앱과 같은 필터). */
function expectedRowsOf(raw, dayType, weekdayCode) {
  const hasDeparture = (row) => (row['depCampus'] ?? row['depStation'] ?? row['depTerminal'] ?? null) !== null;
  const offOn = (row) => {
    const service = row['service'];
    if (service === null || service === undefined) return false;
    const excludedDays = service['excludedDays'] ?? [];
    if (excludedDays.includes(weekdayCode)) return true;
    const dayScope = service['dayScope'] ?? null;
    return dayScope !== null && dayScope.length > 0 && !dayScope.includes(weekdayCode);
  };
  return raw.routes.reduce((sum, route) => {
    if (route.status === 'suspended') return sum;
    const table = route.byDay?.[dayType];
    if (table === null || table === undefined) return sum;
    return sum + table.trips.filter((row) => hasDeparture(row) && !offOn(row)).length;
  }, 0);
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');

  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));

  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));
  mkdirSync(SHOT_DIR, { recursive: true });

  const webPort = await freePort();
  const debugPort = await freePort();
  const server = await startStaticServer(webPort, BASE);
  const profileDir = join(tmpdir(), `t12-v1-${String(process.pid)}`);
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
  /** 앱이 낸 리소스 요청 URL — 전부 같은 출처인지, 학교 도메인 요청이 0건인지 검사한다(T14 ⑨). */
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
    // 스크린샷·검사는 **라이트 모드 고정** — 헤드리스 Chrome 이 호스트 OS 의 다크 설정을 물려받아
    // 같은 빌드에서도 그림이 달라진다(실측). 다크 대응은 a11y_smoke 가 두 테마 모두로 검증한다.
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    // ── 시나리오 ①: 평일 08:00 (2026-10-06 화) ──────────────────────────────
    const s1Now = '2026-10-06T08:00:00+09:00';
    const s1Expected = expectedRowsOf(raw, 'weekday', weekdayCodeOf('2026-10-06'));
    check('① 평일 08:00: 페이지 렌더(시간표 본문)', await open(urlFor(s1Now)));
    const s1 = await evaluate(READ);
    check('① 상단 바: 오늘 날짜·현재 시각(KST, `·` 구분)', String(s1.clockText).includes('10월 6일 (화) · 08:00'), `clock=${String(s1.clockText)} datetime=${String(s1.clockDatetime)}`);
    check('① 오늘 안내줄 없음(안내문 없는 평일)', s1.notice === null, JSON.stringify(s1.notice));
    check('① 방향 필터 칩 3개(전체 기본 선택)', s1.chips.length === 3 && s1.chips[0]?.direction === 'all' && s1.chips[0]?.pressed === 'true', JSON.stringify(s1.chips));
    check(
      '① 본문 = 그 요일 전체 회차 시간표(행 수 = 발행물 판정 편수)',
      s1.listDay === 'weekday' && s1.listRows === s1Expected && s1.listRows > 0,
      `day=${String(s1.listDay)} 화면=${String(s1.listRows)}행 · 발행물=${String(s1Expected)}편`,
    );
    check('① 방향 칩 편수도 발행물과 일치(전체 N편)', String(s1.chips[0]?.text ?? '').includes(`전체 ${String(s1Expected)}편`), String(s1.chips[0]?.text));
    check('① 다음 출발 행이 정확히 하나 강조된다(§9-3)', s1.nextCount === 1, `count=${String(s1.nextCount)} next=${String(s1.nextTime)}`);
    check('① 강조 행 = 08:00 이후 첫 편(08:05)', s1.nextTime === '08:05', String(s1.nextTime));
    check(
      '① 지난 편은 dim(data-past) — 강조 행이 첫 non-past 행이다',
      s1.pastFlags.some((flag) => flag === true) === false || s1.pastFlags.indexOf(false) === s1.nextIndex,
      `past=${JSON.stringify(s1.pastFlags.slice(0, 4))} nextIndex=${String(s1.nextIndex)}`,
    );
    check('① 기준 시각 이전 행은 모두 data-past=true 이고 그 뒤 행은 아니다', s1.pastFlags.every((flag, index) => flag === (minuteOf(s1.times[index] ?? '00:00') < 8 * 60)), JSON.stringify(s1.times.slice(0, 5)));
    check('① 노선 통합 정렬: 출발 시각 오름차순', ascending(s1.times), JSON.stringify(s1.times.slice(0, 5)));
    check(
      '① 요일 조건은 짧은 토큰 1개 이하(긴 사유 문구 금지, §9-3)',
      s1.tokens.every((token) => token.length <= 8),
      `가장 긴 토큰=${JSON.stringify(s1.tokens.reduce((longest, token) => (token.length > longest.length ? token : longest), ''))}`,
    );
    // ── T14: 앱 UI 에서 "원본" 노출 제거 ───────────────────────────────────────
    check(
      '⑩ 원본표가 없다 — details[data-testid="source-details"] 0개 + TimetableTable 0개',
      s1.sourceDetailsCount === 0 && s1.timetablePresent === false,
      JSON.stringify({ sourceDetails: s1.sourceDetailsCount, timetable: s1.timetablePresent, detailsTotal: s1.detailsCount }),
    );
    check('⑩ 학교 링크는 대표 출처 1줄뿐(≤1개)', s1.schoolLinkCount <= 1, `${String(s1.schoolLinkCount)}개 ${JSON.stringify(s1.schoolLinks)}`);
    check(
      '⑩ 화면 텍스트에 `원본` 0회(사용자 노출 기준)',
      s1.visibleSourceCount === 0 && s1.domSourceCount === 0,
      `innerText=${String(s1.visibleSourceCount)}회 textContent=${String(s1.domSourceCount)}회`,
    );
    // ── T27 §9-2: 소개문구·앱 이름을 본문에서 걷어냈다 ─────────────────────────
    check(
      '⑪ 본문에 소개문구가 없고 앱 이름은 낭독기 전용(sr-only)만 남는다(§9-2)',
      s1.subtitleKo === null &&
        s1.subtitleEn === null &&
        s1.titleVisibility === 'sr-only' &&
        !String(s1.bodyText).includes('지금 탈 수 있는 셔틀버스를 바로 보여줍니다'),
      JSON.stringify({ ko: s1.subtitleKo, en: s1.subtitleEn, title: s1.titleVisibility }),
    );
    // ── T27 §9-5: 데이터 갱신·출처는 정보 시트(ⓘ) 안이다 ──────────────────────
    check('⑪ 데이터 갱신 1줄이 정보 시트 안에 있다(§9-5)', s1.refreshInSheet === true && /^데이터 갱신: \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(KST\) \(.+\)$/.test(String(s1.refreshLine)), `inSheet=${String(s1.refreshInSheet)} ${String(s1.refreshLine)}`);
    check('⑪ 출처 1줄이 정보 시트 안에 있다(§9-5)', s1.sourceInSheet === true && /^출처: 선문대학교 셔틀버스 안내 페이지 — /.test(String(s1.sourceLine)), `inSheet=${String(s1.sourceInSheet)} ${String(s1.sourceLine)}`);
    // ── T27 §9-1: 앱 셸 탭([지금]/[전체]) 없음 = 화면 하나 ────────────────────
    check('④ 앱 셸 탭([지금]/[전체])이 없다 — 화면 하나(§9-1)', s1.appTabNodes === 0, `nodes=${String(s1.appTabNodes)} tabs=${JSON.stringify(s1.dayTabIds)}`);
    const s1Shot = await captureViewport('T14-1-아침0800.png');
    // ④ 방향 칩 즉시 반영(시간표 목록이 그 방향만 남는다) — 라벨은 T29 §11-1 의 새 문구(`학교 도착`/`터미널 도착`)
    const s1OutExpected = s1.chips.find((chip) => chip.direction === 'out')?.text ?? '';
    const s1InExpected = s1.chips.find((chip) => chip.direction === 'in')?.text ?? '';
    check(
      '④ 방향 칩 라벨이 `전체`·`학교 도착`·`터미널 도착`(T29 §11-1 표시 순서)',
      s1.chips.map((chip) => String(chip.text).replace(/ \d+편$/, '')).join('|') === '전체|학교 도착|터미널 도착',
      JSON.stringify(s1.chips.map((chip) => chip.text)),
    );
    const s1Out = await clickChip('out');
    check('④ 방향 칩(터미널 도착) 즉시 반영', s1Out.ok, s1Out.detail);
    check('④ 방향 칩 편수 문구(터미널 도착 N편)', /^터미널 도착 \d+편$/.test(s1OutExpected), s1OutExpected);
    check('④ 방향 칩 편수 문구(학교 도착 N편)', /^학교 도착 \d+편$/.test(s1InExpected), s1InExpected);
    const s1In = await clickChip('in');
    check('④ 방향 칩(학교 도착) 즉시 반영', s1In.ok, s1In.detail);
    const s1Back = await clickChip('all');
    check(
      '④ 방향 칩(전체) 복귀 — 전체 회차로 돌아온다',
      s1Back.chips?.[0]?.pressed === 'true' && s1Back.listRows === s1Expected,
      `pressed=${String(s1Back.chips?.[0]?.pressed)} rows=${String(s1Back.listRows)} 기대=${String(s1Expected)}`,
    );

    // ── 시나리오 ②: 개천절 대체휴일 10:00 (2026-10-05 월 · 일요일 시간표) ────────
    const s2Now = '2026-10-05T10:00:00+09:00';
    const s2Expected = expectedRowsOf(raw, 'sunday', weekdayCodeOf('2026-10-05'));
    check('② 대체휴일 10:00: 페이지 렌더', await open(urlFor(s2Now)));
    const s2 = await evaluate(READ);
    check('② 상단 바: 10월 5일 (월) · 10:00', String(s2.clockText).includes('10월 5일 (월) · 10:00'), String(s2.clockText));
    check(
      '② 안내줄: "일요일 시간표로 운행" + 근거 안내문',
      s2.notice !== null && s2.notice.kind === 'alternate' && String(s2.notice.text).includes('일요일 시간표로 운행합니다') && String(s2.notice.text).includes('개천절대체휴일'),
      JSON.stringify(s2.notice),
    );
    check(
      '② 적용 시간표(일요일) 행 수 = 발행물 일요일 판정 편수',
      s2.listDay === 'sunday' && s2.listRows === s2Expected,
      `day=${String(s2.listDay)} 화면=${String(s2.listRows)}행 · 발행물=${String(s2Expected)}편`,
    );
    check('② 다음 출발: 일요일 첫 남은 편 = 12:00', s2.nextTime === '12:00', String(s2.nextTime));
    check(
      '② 10:00 이전 편은 dim(data-past)·10:00 이후 편은 아니다',
      s2.pastFlags.every((flag, index) => flag === (minuteOf(s2.times[index] ?? '00:00') < 10 * 60)),
      JSON.stringify(s2.times.slice(0, 6)),
    );
    const s2Shot = await capture('T12-2-대체휴일1000.png');

    // ── 시나리오 ③: 자정 경계 23:59 → 00:01 ─────────────────────────────────
    const s3aNow = '2026-10-05T23:59:00+09:00';
    check('③ 자정 경계 23:59: 페이지 렌더', await open(urlFor(s3aNow)));
    const s3a = await evaluate(READ);
    check('③ 23:59 상단 바 = 10월 5일 (월) · 23:59', String(s3a.clockText).includes('10월 5일 (월) · 23:59'), String(s3a.clockText));
    // 23:59 에는 남은 편이 없다. 이 날은 대체 시간표라 얇은 1줄은 **대체 안내**(§9-4 우선순위: 운행없음 > 대체)이고,
    //   "오늘 종료 + 다음 운행" 문구는 안내문이 없는 평일에 나온다(아래 ③c 에서 실측).
    check(
      '③ 23:59 남은 편 0 — 안내줄은 그 날의 우선순위(대체 시간표) 1줄',
      s3a.notice !== null && s3a.notice.kind === 'alternate' && String(s3a.notice.text).includes('일요일 시간표로 운행합니다'),
      JSON.stringify(s3a.notice),
    );
    check(
      '③ 23:59 오늘 남은 편이 없다 — 강조 행 0개 · 모든 행이 지난 편(dim)',
      s3a.nextCount === 0 && s3a.pastFlags.length > 0 && s3a.pastFlags.every((flag) => flag === true),
      `next=${String(s3a.nextCount)} past=${JSON.stringify(s3a.pastFlags.slice(-3))} rows=${String(s3a.listRows)}`,
    );
    const s3aShot = await capture('T12-3-자정경계-2359.png');

    const s3bNow = '2026-10-06T00:01:00+09:00';
    const s3bExpected = expectedRowsOf(raw, 'weekday', weekdayCodeOf('2026-10-06'));
    check('③ 자정 경계 00:01: 페이지 렌더', await open(urlFor(s3bNow)));
    const s3b = await evaluate(READ);
    check('③ 00:01 상단 바 = 10월 6일 (화) · 00:01 (다음 날로 바뀜)', String(s3b.clockText).includes('10월 6일 (화) · 00:01'), String(s3b.clockText));
    check('③ 00:01 안내줄 없음(대체휴일 종료)', s3b.notice === null, JSON.stringify(s3b.notice));
    check(
      '③ 00:01 시간표가 다음 날(평일)로 넘어간다 — 행 수 = 발행물 평일 판정 편수',
      s3b.listDay === 'weekday' && s3b.listRows === s3bExpected,
      `day=${String(s3b.listDay)} 화면=${String(s3b.listRows)}행 · 발행물=${String(s3bExpected)}편`,
    );
    check('③ 00:01 첫 남은 편(07:30)이 강조되고 지난 편이 없다', s3b.nextCount === 1 && s3b.nextTime === '07:30' && s3b.pastFlags.every((flag) => flag === false), `next=${String(s3b.nextTime)} past=${JSON.stringify(s3b.pastFlags.slice(0, 3))}`);
    const s3bShot = await capture('T12-4-자정경계-0001.png');

    // ── ③c: 안내문 없는 평일 23:59 — 오늘 종료 안내 + 다음 운행(내일) ─────────────
    check('③c 평일 23:59: 페이지 렌더', await open(urlFor('2026-10-06T23:59:00+09:00')));
    const s3c = await evaluate(READ);
    check(
      '③c 23:59 오늘 운행 종료 안내 + 다음 운행 내일(§9-4)',
      s3c.notice !== null && s3c.notice.kind === 'today-over' && String(s3c.notice.text).includes('다음 운행') && String(s3c.notice.text).includes('내일'),
      JSON.stringify(s3c.notice),
    );
    check(
      '③c 23:59 오늘 남은 편 0 — 강조 행 0개 · 모든 행이 지난 편(dim)',
      s3c.nextCount === 0 && s3c.pastFlags.length > 0 && s3c.pastFlags.every((flag) => flag === true),
      `next=${String(s3c.nextCount)} rows=${String(s3c.listRows)}`,
    );

    // ── 시나리오 ④: 오늘 실측(주입 없이 실제 시각) ───────────────────────────
    check('④ 오늘 실측: 페이지 렌더(주입 없음)', await open(urlFor(null)));
    const s4 = await evaluate(READ);
    const nowKst = kstNow();
    const todayKey = `${nowKst.year}-${pad2(nowKst.month)}-${pad2(nowKst.day)}`;
    const todayCode = weekdayCodeOf(todayKey);
    const noticeToday = raw.notices.find((notice) => notice.date === todayKey) ?? null;
    check(`④ 오늘(${todayKey}) 상단 바가 실제 KST 날짜`, String(s4.clockText).includes(`${String(nowKst.month)}월 ${String(nowKst.day)}일 (`), String(s4.clockText));
    if (noticeToday === null) {
      check('④ 오늘은 안내문이 없어 안내줄도 없다', s4.notice === null, JSON.stringify(s4.notice));
    } else {
      const expectKind = noticeToday.kind === 'no-service' ? 'no-service' : 'alternate';
      check(
        `④ 오늘 안내문(${String(noticeToday.kind)})이 얇은 1줄로 나온다`,
        s4.notice !== null && s4.notice.kind === expectKind,
        JSON.stringify(s4.notice),
      );
      if (expectKind === 'alternate') {
        const expected = expectedRowsOf(raw, 'sunday', todayCode);
        check(
          '④ 대체 시간표 → 1줄 문구 + 일요일 판정 편수',
          String(s4.notice?.text ?? '').includes('일요일 시간표로 운행합니다') && s4.listDay === 'sunday' && s4.listRows === expected,
          `${JSON.stringify(s4.notice)} · day=${String(s4.listDay)} rows=${String(s4.listRows)} 기대=${String(expected)}`,
        );
      }
    }
    const s4Shot = await captureViewport('T14-2-오늘-실측.png');

    // ── 시나리오 ⑤~⑧: 평일/토/일/운행없는날 09:00 (T13 계약 + T27 재기준) ──────
    const t13Cases = [
      { label: '⑤ 평일 09:00', now: '2026-10-06T09:00:00+09:00', clock: '10월 6일 (화) · 09:00', dayType: 'weekday', shot: 'T14-3-평일0900.png' },
      { label: '⑥ 토요일 09:00', now: '2026-10-10T09:00:00+09:00', clock: '10월 10일 (토) · 09:00', dayType: 'saturday', shot: 'T14-4-토0900.png' },
      { label: '⑦ 일요일 09:00', now: '2026-10-11T09:00:00+09:00', clock: '10월 11일 (일) · 09:00', dayType: 'sunday', shot: 'T14-5-일0900.png' },
      { label: '⑧ 한글날 09:00(운행 없음)', now: '2026-10-09T09:00:00+09:00', clock: '10월 9일 (금) · 09:00', shot: 'T14-6-한글날0900.png', noService: true },
    ];
    const t13Shots = [];
    for (const testCase of t13Cases) {
      check(`${testCase.label}: 페이지 렌더`, await open(urlFor(testCase.now)));
      const state = await evaluate(READ);
      check(`${testCase.label}: 상단 바 = ${testCase.clock}`, String(state.clockText).includes(testCase.clock), String(state.clockText));
      // T14: 원본 노출 0 — 원본표·원본 문구·학교 링크 목록이 화면에 없다.
      check(
        `${testCase.label}: 원본 노출 0(표 0 · 원본 문구 0회 · 학교 링크 ≤1)`,
        state.sourceDetailsCount === 0 && state.visibleSourceCount === 0 && state.schoolLinkCount <= 1,
        JSON.stringify({ sourceDetails: state.sourceDetailsCount, visible: state.visibleSourceCount, links: state.schoolLinkCount }),
      );
      // 미해석 표기 안내는 **정보 시트 안**이다(§9-5) — 본문에 올라오지 않는다.
      check(
        `${testCase.label}: 미해석 안내가 본문에 없다(정보 시트 안, §9-5)`,
        state.warnInBody === false && (state.warnInSheet === false || /^시각을 해석하지 못한 회차 \d+건은 목록에서 빠져 있을 수 있습니다/.test(String(state.warnSummary))),
        `inSheet=${String(state.warnInSheet)} inBody=${String(state.warnInBody)} summary=${String(state.warnSummary)} items=${String(state.warnSummaryItems)}`,
      );
      check(`${testCase.label}: 데이터 갱신 1줄(정보 시트)`, state.refreshInSheet === true && /^데이터 갱신: /.test(String(state.refreshLine)), String(state.refreshLine));
      check(`${testCase.label}: "오늘 운행이 끝났습니다" 문구 없음(모순 0)`, String(state.listCardText).includes('끝났습니다') === false, String(state.listCardText).slice(0, 90));
      if (testCase.noService === true) {
        check(
          `${testCase.label}: 운행 없음 1줄 + 시간표 빈 안내 + 행 0`,
          state.notice?.kind === 'no-service' && String(state.notice?.text ?? '').includes('운행이 없습니다') && state.emptyShown === true && state.listRows === 0,
          `notice=${JSON.stringify(state.notice)} empty=${String(state.emptyShown)} rows=${String(state.listRows)}`,
        );
      } else {
        const expected = expectedRowsOf(raw, String(testCase.dayType), weekdayCodeOf(String(testCase.now).slice(0, 10)));
        check(
          `${testCase.label}: 시간표 행 수 = 발행물 판정 편수 + 방향 칩 3개`,
          state.listDay === testCase.dayType && state.listRows === expected && state.chips.length === 3,
          `day=${String(state.listDay)} 화면=${String(state.listRows)}행 · 발행물=${String(expected)}편 chips=${String(state.chips.length)}`,
        );
        check(`${testCase.label}: 안내줄 없음(안내문 없는 날)`, state.notice === null, JSON.stringify(state.notice));
      }
      t13Shots.push(await captureViewport(testCase.shot));
      info(`${testCase.label}: clock=${String(state.clockText)} · notice=${JSON.stringify(state.notice)} · warn=${String(state.warnSummary)} · rows=${String(state.listRows)} day=${String(state.listDay)}`);
    }

    // ── ⑨ 요청 출처 검사(T14) — 앱이 낸 요청은 전부 자기 오리진(로컬 서버)이고 학교 도메인은 0건 ──
    const appOrigin = `http://127.0.0.1:${String(webPort)}`;
    const requestOrigins = [...new Set(requestUrls.map((requestUrl) => new URL(requestUrl).origin))];
    const schoolRequests = requestUrls.filter((requestUrl) => /lily\.sunmoon\.ac\.kr/.test(requestUrl));
    check(
      '⑨ 모든 리소스 요청이 단일 출처(로컬 서버)다 — 앱은 자기 오리진만 요청한다',
      requestOrigins.length === 1 && requestOrigins[0] === appOrigin,
      `origins=${JSON.stringify(requestOrigins)} requests=${String(requestUrls.length)}`,
    );
    check(
      '⑨ 학교 도메인(lily.sunmoon.ac.kr) 요청 0건 — 앱은 학교 사이트를 읽지 않는다',
      schoolRequests.length === 0,
      `school=${JSON.stringify(schoolRequests.slice(0, 3))}`,
    );
    check('⑧ 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    info(`요청 출처: ${JSON.stringify(requestOrigins)} · 총 ${String(requestUrls.length)}건(중복 포함) · 학교 도메인 ${String(schoolRequests.length)}건`);

    info(`시나리오 스크린샷: ${[s1Shot, s2Shot, s3aShot, s3bShot, s4Shot].map((path) => path.slice(ROOT.length)).join(' · ')}`);
    info(`T13 스크린샷: ${t13Shots.map((path) => path.slice(ROOT.length)).join(' · ')}`);
    info(`평일 08:00 시간표: ${JSON.stringify({ day: s1.listDay, rows: s1.listRows, 기대: s1Expected, next: s1.nextTime, chips: s1.chips.map((chip) => chip.text) })}`);
    info(`대체휴일 10:00 시간표: ${JSON.stringify({ day: s2.listDay, rows: s2.listRows, 기대: s2Expected, next: s2.nextTime, notice: s2.notice?.text })}`);
    info(`자정 경계: 23:59=${JSON.stringify({ clock: s3a.clockText, next: s3a.nextTime, notice: s3a.notice?.kind })} / 00:01=${JSON.stringify({ clock: s3b.clockText, next: s3b.nextTime, day: s3b.listDay, rows: s3b.listRows })}`);
    info(`오늘 실측: ${JSON.stringify({ clock: s4.clockText, notice: s4.notice?.text, day: s4.listDay, rows: s4.listRows })}`);

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
    console.log('\nV1 SMOKE: PASS');
  }
}

function ascending(times) {
  for (let index = 1; index < times.length; index += 1) {
    if (minuteOf(times[index]) < minuteOf(times[index - 1])) return false;
  }
  return times.length > 0;
}

/**
 * 방향 칩을 누르고 그 방향만 남는지 확인한다(즉시 반영 검증 — §9-1 로 칩은 시간표의 축이 됐다).
 * 칩 상태(pressed)와 **시간표 목록의 방향**을 함께 실측한다.
 */
async function clickChip(direction) {
  const clicked = await evaluate(`
    const chip = document.querySelector('[data-testid="direction-chip"][data-direction="${direction}"]');
    if (chip === null) return false;
    chip.click();
    return true;
  `);
  if (clicked !== true) return { ok: false, detail: `칩 없음(${direction})` };
  await delay(200);
  const state = await evaluate(READ);
  const chip = state.chips.find((entry) => entry.direction === direction);
  const directions = state.directions;
  const rows = state.listRows;
  const allSame = direction === 'all' ? rows > 0 : rows > 0 && directions.every((value) => value === direction);
  return {
    ...state,
    ok: chip?.pressed === 'true' && allSame,
    detail: `pressed=${String(chip?.pressed)} 시간표=${String(rows)}행 방향=${JSON.stringify([...new Set(directions)].slice(0, 3))}`,
  };
}

function kstNow() {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function pad2(value) {
  return value < 10 ? `0${String(value)}` : String(value);
}

main().catch((error) => {
  console.error(`V1 SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  console.log('\n여기까지의 검사 결과:');
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  process.exitCode = 1;
});
