#!/usr/bin/env node
/**
 * V1 간편 홈 스모크 (T12) — **헤드리스 Chrome CDP**, 의존성 0(render_smoke.mjs 와 같은 방식).
 *
 * 검증하는 것 (수용 기준 3·7 · 카드 지시 ①~⑧)
 *  ① V1 구조 4요소가 **실제 DOM 에** 있다
 *       - 상태줄 `[data-testid="app-clock"]`(오늘 날짜·현재 시각 KST)
 *       - 다음 출발 카드 `[data-testid="next-bus-card"]`(상위 3편)
 *       - 방향 필터 `[data-testid="direction-filter"]`(칩 3개 + aria-pressed)
 *       - 접힘 원본표 `details[data-testid="source-details"]`(기본 닫힘, 안에 `[data-testid="timetable"]`)
 *  ② 공지 배너(조건부) — `resolveDayService` 결과: 대체 시간표 / 운행 없음
 *  ③ 노선 통합 상위 3편 정렬(오름차순) + 지난 편 제외(오늘 편은 모두 now 이상)
 *  ④ 방향 칩 즉시 반영(클릭 → 목록이 그 방향만)
 *  ⑤ 목록 잘림 — 목록 12편 + "더 보기"에 나머지, 합계 = 남은 편수
 *  ⑥ 자정 경계(23:59 → 00:01) — 상태줄·목록이 **다음 날로** 넘어간다
 *  ⑦ 오늘 실측(주입 없이 실제 시각) — 오늘 안내문이 있으면 배너, 대체휴일이면 일요일 편수
 *  ⑧ 콘솔 오류 0
 *
 * 사용: node scripts/v1_smoke.mjs [--base=/sunmoon-shuttle/]
 * 산출물: .session-notes/T12-*.png (시나리오별 스크린샷)
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

/** 화면 상태를 한 번에 읽는다(증거·검사 공용). */
const READ = `
  const details = document.querySelector('[data-testid="source-details"]');
  const card = document.querySelector('[data-testid="next-bus-card"]');
  const rows = [...document.querySelectorAll('[data-testid="departure-list"] [data-testid="departure-row"]')];
  const restRows = [...document.querySelectorAll('[data-testid="departure-rest"] [data-testid="departure-row"]')];
  const chips = [...document.querySelectorAll('[data-testid="direction-chip"]')];
  const clock = document.querySelector('[data-testid="app-clock"]');
  const notice = document.querySelector('[data-testid="board-notice"]');
  const counts = document.querySelector('[data-testid="board-counts"]');
  const hero = document.querySelector('[data-testid="next-bus-time"]');
  const clockText = clock === null ? null : (clock.textContent || '').trim();
  return {
    hasApp: document.querySelector('.shuttle-app') !== null,
    clockText,
    clockDatetime: clock === null ? null : clock.getAttribute('datetime'),
    notice: notice === null ? null : { kind: notice.dataset.kind ?? null, text: (notice.textContent || '').trim() },
    cardPresent: card !== null,
    cardStatus: card === null ? null : (card.dataset.status ?? null),
    cardRows: card === null ? -1 : card.querySelectorAll('[data-testid="next-bus-row"]').length,
    heroText: hero === null ? null : (hero.textContent || '').trim(),
    countsText: counts === null ? null : (counts.textContent || '').trim(),
    todayOver: document.querySelector('[data-testid="board-today-over"]') === null ? null : document.querySelector('[data-testid="board-today-over"]').textContent.trim(),
    chips: chips.map((chip) => ({ direction: chip.dataset.direction ?? null, pressed: chip.getAttribute('aria-pressed'), text: (chip.textContent || '').replace(/\\s+/g, ' ').trim() })),
    listRows: rows.length,
    restRows: restRows.length,
    times: [...rows, ...restRows].map((row) => { const t = row.querySelector('.shuttle-departure__time'); return t === null ? null : (t.textContent || '').trim(); }),
    directions: [...rows, ...restRows].map((row) => row.dataset.direction ?? null),
    dayOffsets: [...rows, ...restRows].map((row) => Number(row.dataset.dayOffset ?? '-1')),
    detailsPresent: details !== null,
    detailsOpen: details === null ? null : details.open === true,
    timetableInside: details === null ? false : details.querySelector('[data-testid="timetable"]') !== null,
    timetableRows: Number(document.querySelector('[data-testid="timetable"]')?.dataset.rows ?? -1),
  };
`;

/** 페이지를 열고 보드가 그려질 때까지 기다린다. */
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

/** 시간 문자열(`HH:MM`) 비교용 분 환산 — 스크립트 검증 전용(앱 계산이 아니다). */
const minuteOf = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');

  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const activeRoutes = raw.routes.filter((route) => route.status === 'active');
  const sundayTrips = activeRoutes.reduce((sum, route) => sum + (route.byDay?.sunday?.trips?.length ?? 0), 0);

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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1600, deviceScaleFactor: 2, mobile: true });

    // ── 시나리오 ①: 평일 08:00 (2026-10-06 화) ──────────────────────────────
    const s1Now = '2026-10-06T08:00:00+09:00';
    check('① 평일 08:00: 페이지 렌더(보드 카드)', await open(urlFor(s1Now)));
    const s1 = await evaluate(READ);
    check('① 상태줄: 오늘 날짜·현재 시각(KST)', String(s1.clockText).includes('10월 6일 (화) 08:00'), `clock=${String(s1.clockText)} datetime=${String(s1.clockDatetime)}`);
    check('① 공지 배너 없음(안내문 없는 평일)', s1.notice === null, JSON.stringify(s1.notice));
    check('① 방향 필터 칩 3개(전체 기본 선택)', s1.chips.length === 3 && s1.chips[0]?.direction === 'all' && s1.chips[0]?.pressed === 'true', JSON.stringify(s1.chips));
    check('① 다음 출발 카드: 상위 3편 = 히어로 1 + 목록 2', s1.heroText !== null && s1.cardRows === 2, JSON.stringify({ hero: s1.heroText, cardRows: s1.cardRows }));
    check('① 다음 출발 카드: 오늘 첫 출발 = 오늘 08:05 출발', s1.heroText === '오늘 08:05 출발', String(s1.heroText));
    check('① 지난 편 제외: 오늘 편은 모두 기준 시각 이상', s1.dayOffsets.every((offset) => offset !== 0) || s1.times.every((time) => minuteOf(time) >= 8 * 60), `times=${JSON.stringify(s1.times.slice(0, 3))}`);
    check('① 노선 통합 정렬: 출발 시각 오름차순', ascending(s1.times), JSON.stringify(s1.times.slice(0, 5)));
    const s1Counts = countsOf(s1.countsText);
    check('① 목록 잘림: 목록 12편 + 더 보기 = 남은 편수', s1.listRows === 12 && s1.restRows > 0 && s1.listRows + s1.restRows === s1Counts.remaining, `list=${String(s1.listRows)} rest=${String(s1.restRows)} ${String(s1.countsText)}`);
    check('① 접힘 원본표: details 닫힘 + 안에 TimetableTable', s1.detailsPresent === true && s1.detailsOpen === false && s1.timetableInside === true, JSON.stringify({ node: s1.detailsPresent, open: s1.detailsOpen, table: s1.timetableInside, rows: s1.timetableRows }));
    // ④ 방향 칩 즉시 반영
    const s1Out = await clickChip('out', s1OutExpected(s1Counts));
    check('④ 방향 칩(학교에서 출발) 즉시 반영', s1Out.ok, s1Out.detail);
    const s1In = await clickChip('in', s1InExpected(s1Counts));
    check('④ 방향 칩(학교로 도착) 즉시 반영', s1In.ok, s1In.detail);
    await clickChip('all', '전체');
    const s1Back = await evaluate(READ);
    check('④ 방향 칩(전체) 복귀', s1Back.chips[0]?.pressed === 'true' && s1Back.listRows === 12, JSON.stringify(s1Back.chips[0]));
    const s1Shot = await capture('T12-1-평일0800.png');

    // ── 시나리오 ②: 개천절 대체휴일 10:00 (2026-10-05 월 · 일요일 시간표) ────────
    const s2Now = '2026-10-05T10:00:00+09:00';
    check('② 대체휴일 10:00: 페이지 렌더', await open(urlFor(s2Now)));
    const s2 = await evaluate(READ);
    check('② 상태줄: 10월 5일 (월) 10:00', String(s2.clockText).includes('10월 5일 (월) 10:00'), String(s2.clockText));
    check(
      '② 공지 배너: "일요일 시간표로 운행" + 근거 안내문',
      s2.notice !== null && s2.notice.kind === 'alternate' && String(s2.notice.text).includes('일요일 시간표로 운행합니다') && String(s2.notice.text).includes('개천절대체휴일'),
      JSON.stringify(s2.notice),
    );
    check('② 적용 시간표(일요일) 편수 = JSON 일요일 합계', String(s2.countsText).includes(`총 ${String(sundayTrips)}편`), `${String(s2.countsText)} (JSON 일요일 합계=${String(sundayTrips)})`);
    check('② 다음 출발: 일요일 첫 남은 편 = 오늘 12:00 출발', s2.heroText === '오늘 12:00 출발', String(s2.heroText));
    check('② 지난 편 제외(09:00 편 없음)', s2.times.every((time) => minuteOf(time) >= 10 * 60), JSON.stringify(s2.times.slice(0, 3)));
    const s2Shot = await capture('T12-2-대체휴일1000.png');

    // ── 시나리오 ③: 자정 경계 23:59 → 00:01 ─────────────────────────────────
    const s3aNow = '2026-10-05T23:59:00+09:00';
    check('③ 자정 경계 23:59: 페이지 렌더', await open(urlFor(s3aNow)));
    const s3a = await evaluate(READ);
    check('③ 23:59 상태줄 = 10월 5일 (월)', String(s3a.clockText).includes('10월 5일 (월) 23:59'), String(s3a.clockText));
    check('③ 23:59 오늘 운행 종료 안내 + 다음 운행 내일', s3a.todayOver !== null && String(s3a.todayOver).includes('내일'), String(s3a.todayOver));
    check('③ 23:59 목록이 다음 날(내일) 편으로 넘어간다', s3a.dayOffsets.length > 0 && s3a.dayOffsets.every((offset) => offset === 1), JSON.stringify(s3a.dayOffsets.slice(0, 5)));
    check('③ 23:59 카드 라벨 = 내일', String(s3a.heroText).includes('내일 '), String(s3a.heroText));
    const s3aShot = await capture('T12-3-자정경계-2359.png');

    const s3bNow = '2026-10-06T00:01:00+09:00';
    check('③ 자정 경계 00:01: 페이지 렌더', await open(urlFor(s3bNow)));
    const s3b = await evaluate(READ);
    check('③ 00:01 상태줄 = 10월 6일 (화) (다음 날로 바뀜)', String(s3b.clockText).includes('10월 6일 (화) 00:01'), String(s3b.clockText));
    check('③ 00:01 공지 배너 없음(대체휴일 종료)', s3b.notice === null, JSON.stringify(s3b.notice));
    check('③ 00:01 카드 라벨 = 오늘 (다음 날 목록으로 전환)', String(s3b.heroText).startsWith('오늘 '), String(s3b.heroText));
    check('③ 00:01 목록이 모두 오늘(dayOffset 0)', s3b.dayOffsets.length > 0 && s3b.dayOffsets.every((offset) => offset === 0), JSON.stringify(s3b.dayOffsets.slice(0, 5)));
    check('③ 00:01 지난 편 제외(00:01 이후만)', s3b.times.every((time) => minuteOf(time) >= 1), JSON.stringify(s3b.times.slice(0, 3)));
    const s3bShot = await capture('T12-4-자정경계-0001.png');

    // ── 시나리오 ④: 오늘 실측(주입 없이 실제 시각) ───────────────────────────
    check('④ 오늘 실측: 페이지 렌더(주입 없음)', await open(urlFor(null)));
    const s4 = await evaluate(READ);
    const nowKst = kstNow();
    const todayKey = `${nowKst.year}-${pad2(nowKst.month)}-${pad2(nowKst.day)}`;
    const noticeToday = raw.notices.find((notice) => notice.date === todayKey) ?? null;
    check(`④ 오늘(${todayKey}) 상태줄이 실제 KST 날짜`, String(s4.clockText).includes(`${String(nowKst.month)}월 ${String(nowKst.day)}일 (`), String(s4.clockText));
    if (noticeToday === null) {
      check('④ 오늘은 안내문이 없어 배너도 없다', s4.notice === null, JSON.stringify(s4.notice));
    } else {
      const expectKind = noticeToday.kind === 'no-service' ? 'no-service' : 'alternate';
      check(
        `④ 오늘 안내문(${String(noticeToday.kind)})이 배너로 나온다`,
        s4.notice !== null && s4.notice.kind === expectKind,
        JSON.stringify(s4.notice),
      );
      if (expectKind === 'alternate') {
        check(
          '④ 대체 시간표 → 배너 문구 + 일요일 편수',
          String(s4.notice?.text ?? '').includes('일요일 시간표로 운행합니다') && String(s4.countsText).includes(`총 ${String(sundayTrips)}편`),
          `${JSON.stringify(s4.notice)} · ${String(s4.countsText)}`,
        );
      }
    }
    const s4Shot = await capture('T12-5-오늘-실측.png');

    check('⑧ 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    info(`시나리오 스크린샷: ${[s1Shot, s2Shot, s3aShot, s3bShot, s4Shot].map((path) => path.slice(ROOT.length)).join(' · ')}`);
    info(`평일 08:00 보드: ${JSON.stringify({ hero: s1.heroText, counts: s1.countsText, chips: s1.chips.map((chip) => chip.text) })}`);
    info(`대체휴일 10:00 보드: ${JSON.stringify({ hero: s2.heroText, counts: s2.countsText, notice: s2.notice?.text })}`);
    info(`자정 경계: 23:59=${JSON.stringify({ clock: s3a.clockText, hero: s3a.heroText, over: s3a.todayOver })} / 00:01=${JSON.stringify({ clock: s3b.clockText, hero: s3b.heroText })}`);
    info(`오늘 실측: ${JSON.stringify({ clock: s4.clockText, notice: s4.notice?.text, counts: s4.countsText })}`);

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

function countsOf(text) {
  const match = /총 (\d+)편 · 남은 (\d+)편/.exec(String(text));
  return match === null ? { total: -1, remaining: -1 } : { total: Number(match[1]), remaining: Number(match[2]) };
}

function s1OutExpected(counts) {
  return `out 필터: 남은 ${String(counts.remaining)}편 중 상위 3편`;
}

function s1InExpected(counts) {
  return `in 필터: 남은 ${String(counts.remaining)}편 중 상위 3편`;
}

/** 방향 칩을 누르고 그 방향만 남는지 확인한다(즉시 반영 검증). */
async function clickChip(direction, label) {
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
  const rows = [...state.directions];
  const allSame = rows.length === 0 || rows.every((value) => value === direction);
  const ok = chip?.pressed === 'true' && allSame && state.listRows <= 12;
  return { ok, detail: `${label} — pressed=${String(chip?.pressed)} rows=${String(state.listRows)}+${String(state.restRows)} 방향=${JSON.stringify(rows.slice(0, 4))}` };
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
