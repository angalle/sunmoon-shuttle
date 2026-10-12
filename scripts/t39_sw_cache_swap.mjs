#!/usr/bin/env node
/**
 * T39 — `SW_VERSION` 자동 주입의 **실측** 스모크 (docs/07 §16-3 · AC-U16-4b).
 *
 * 왜 필요한가
 *   "코드는 고쳤는데 폰에는 옛 화면"의 실체는 **서비스워커 캐시**다. 버전 값이 배포마다 달라지는 것만으로는
 *   부족하고, **실제 브라우저에서 새 SW 가 활성화되어 (a) 옛 캐시 키가 삭제되고 (b) 로드 2회 안에 새 셸이 뜨는지**
 *   를 봐야 한다. 이 스크립트는 그 장면을 로컬에서 **실제 배포 2회**로 재현한다:
 *
 *     ① 옛 배포(= 옛 버전 sw.js + 옛 index.html) 를 같은 URL 로 서빙 → 로드 2회로 **옛 셸이 SW 캐시에 담긴 상태**를 만든다
 *     ② 서빙 디렉터리를 **새 배포(= `dist` 그대로 = 빌드가 자동 주입한 새 버전)** 로 바꾼다
 *     ③ 로드 2회 안에 ㉠ 옛 캐시 키가 사라지고 ㉡ 새 셸(marker=new)이 뜨는지 측정한다
 *
 * 의존성 0: node:http · node:child_process + Node 내장 WebSocket(≥22) 로 CDP 를 직접 말한다.
 * `dist/` 를 **읽기만** 한다(빌드·자산 수정 없음). 서빙용 사본은 OS 임시 디렉터리에 만든다.
 *
 * 사용:
 *   npm run build && node scripts/t39_sw_cache_swap.mjs
 *   node scripts/t39_sw_cache_swap.mjs --shots=none
 * 종료코드: 검사 하나라도 실패하면 1.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SHOT_DIR = join(ROOT, '.session-notes');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const WANT_SHOTS = args.get('shots') !== 'none';
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** 옛 배포를 흉내내는 버전 값(자동 주입 이전의 "손으로 쓴" 값과 같은 모양) */
const OLD_VERSION = '2026-10-05.1';
const MARKER = 't39-shell';

const failures = [];
const notes = [];
const shots = [];
let cdp = null;
let chrome = null;
let server = null;
let stageDir = null;
let profileDir = null;

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
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startStaticServer(port, dir) {
  const instance = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/favicon.ico')) {
      res.writeHead(204).end();
      return;
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end(`not found: ${pathname}`);
      return;
    }
    const headers = { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' };
    // SW 스크립트·문서는 항상 재검증되게 한다(배포 직후 갱신 검사가 HTTP 캐시에 가려지지 않도록).
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

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(`return ${expression};`);
    if (last === true) return true;
    await delay(150);
  }
  info(`대기 시간 초과(${label}) — 마지막 값: ${JSON.stringify(last)}`);
  return false;
}

/**
 * 앱이 로딩을 끝낸 상태(데이터 성공이든 F8 오류 UI 든) — `scripts/offline_smoke.mjs` 와 같은 계약.
 * 로딩 표시가 사라진 것만으로는 부족하다(목록·오류 UI 중 하나가 실제로 그려져야 "끝났다").
 */
const READY =
  'document.querySelector(\'[data-testid="loading"]\') === null && (document.querySelector(\'[data-testid="timetable-section"]\') !== null || document.querySelector(\'[data-testid="data-error"]\') !== null)';

/** 한 화면 상태를 한 번에 읽는다 — 셸 marker(어느 배포인지) · SW 캐시 키 · 제어 여부 · 콘솔 오류. */
const READ_STATE = `
  const caches_ = await caches.keys();
  const reg = await navigator.serviceWorker.getRegistration();
  const marker = document.querySelector('meta[name="${MARKER}"]');
  return {
    shell: marker === null ? null : marker.getAttribute('content'),
    cacheKeys: [...caches_].sort(),
    controller: navigator.serviceWorker.controller === null ? null : navigator.serviceWorker.controller.scriptURL,
    swState: reg?.active?.state ?? null,
    waiting: reg?.waiting === null || reg?.waiting === undefined ? null : 'waiting',
    bodyLen: document.body.innerText.length,
  };
`;

function snapshot(source, target, version, marker) {
  cpSync(source, target, { recursive: true });
  const swPath = join(target, 'sw.js');
  const swSource = readFileSync(swPath, 'utf8');
  const replaced = version === null ? swSource : swSource.replace(/const SW_VERSION = '[^']*';/, `const SW_VERSION = '${version}';`);
  writeFileSync(swPath, replaced);
  const indexPath = join(target, 'index.html');
  const indexSource = readFileSync(indexPath, 'utf8');
  writeFileSync(indexPath, indexSource.replace('</head>', `  <meta name="${MARKER}" content="${marker}">\n</head>`));
  return { swVersion: /const SW_VERSION = '([^']*)';/.exec(readFileSync(swPath, 'utf8'))?.[1] ?? null };
}

async function capture(fileName) {
  if (!WANT_SHOTS) return null;
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  shots.push(path);
  return path;
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'sw.js'))) throw new Error('dist/sw.js 가 없습니다 — 먼저 npm run build 를 실행하세요.');
  // 계약 데이터 동봉(데모 스크립트 ② 단계와 같은 일) — `vite build` 는 dist 를 비우므로 매번 확인한다.
  const dataSource = join(ROOT, 'data', 'timetable.json');
  if (!existsSync(dataSource)) throw new Error('data/timetable.json 이 없습니다 — 먼저 npm run scrape 로 발행물을 만드세요.');
  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(dataSource, join(DIST, 'data', 'timetable.json'));

  mkdirSync(SHOT_DIR, { recursive: true });
  stageDir = mkdtempSync(join(tmpdir(), 't39-swap-'));
  const stageOld = join(stageDir, 'old');
  const stageNew = join(stageDir, 'new');
  const served = join(stageDir, 'served');
  mkdirSync(served, { recursive: true });

  const oldInfo = snapshot(DIST, stageOld, OLD_VERSION, 'old');
  const newInfo = snapshot(DIST, stageNew, null, 'new');
  info(`옛 배포(시뮬레이션) SW_VERSION=${String(oldInfo.swVersion)} · 새 배포(dist 그대로) SW_VERSION=${String(newInfo.swVersion)}`);

  cpSync(stageOld, served, { recursive: true }); // ① 옛 배포를 서빙
  const webPort = await freePort();
  const debugPort = await freePort();
  server = await startStaticServer(webPort, served);
  profileDir = mkdtempSync(join(tmpdir(), 't39-profile-'));
  const url = `http://127.0.0.1:${webPort}/`;

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
      '--window-size=390,844',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const appErrors = [];
  try {
    cdp = await connectCdp(await waitForDebugger(debugPort));
    cdp.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        appErrors.push(`exception: ${message.params?.exceptionDetails?.text ?? 'unknown'}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        appErrors.push(`console.error: ${(message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    // HTTP 캐시는 끄지 않는다 — 실제 배포 상황(SW 캐시가 정본)을 재현해야 하기 때문이다.
    // (sw.js·index.html 은 서버가 no-store 로 내려 갱신 검사가 HTTP 캐시에 가려지지 않는다.)

    // ── ① 옛 배포 로드 2회: 옛 셸이 SW 캐시에 담긴 상태 만들기 ──────────────────────────
    await cdp.send('Page.navigate', { url });
    check('옛 배포: 1차 로드 완료(앱 렌더)', await waitFor(READY, 20_000, 'old-load1'));
    check('옛 배포: SW 등록', await waitFor('(await navigator.serviceWorker.getRegistration()) !== undefined', 20_000, 'old-register'));
    check('옛 배포: SW 제어(claim) — 다음 로드부터 캐시가 응답', await waitFor('navigator.serviceWorker.controller !== null', 20_000, 'old-claim'));
    await cdp.send('Page.reload', { ignoreCache: false });
    check('옛 배포: 2차 로드(SW 제어 하) 완료', await waitFor(READY, 20_000, 'old-load2'));
    const before = await evaluate(READ_STATE);
    info(`배포 전 상태: ${JSON.stringify(before)}`);
    check(
      '배포 전: 옛 버전 캐시 키가 실제로 생겼다(교체 실측의 출발점)',
      before.cacheKeys.some((key) => key.endsWith(OLD_VERSION)) && before.shell === 'old',
      JSON.stringify(before.cacheKeys),
    );
    await capture('T39-2-SW교체전-옛셸.png');

    // ── ② 새 배포로 교체(같은 URL · 서버 재기동 없음) ──────────────────────────────────
    rmSync(served, { recursive: true, force: true });
    cpSync(stageNew, served, { recursive: true });
    info(`② 새 배포로 서빙 디렉터리 교체(URL·서버 그대로) — 새 배포 SW_VERSION=${String(newInfo.swVersion)}`);

    // ── ③ 로드 1 (배포 후 1회차) ────────────────────────────────────────────────────
    await cdp.send('Page.reload', { ignoreCache: false });
    check('배포 후 1차 로드 완료', await waitFor(READY, 20_000, 'new-load1'));
    const load1 = await evaluate(READ_STATE);
    info(`배포 후 1차 로드: ${JSON.stringify(load1)}`);
    const swapped = await waitFor(
      `(await caches.keys()).every((key) => !key.endsWith(${JSON.stringify(OLD_VERSION)}))`,
      20_000,
      'old-cache-purged',
    );
    const afterLoad1 = await evaluate(READ_STATE);
    info(`배포 후 1차 로드(캐시 교체 대기 후): ${JSON.stringify(afterLoad1)}`);
    check(
      'AC-U16-4b(캐시): 새 SW 활성 후 **옛 버전 캐시 키 삭제** — caches.keys() 에 옛 키 0개',
      swapped && afterLoad1.cacheKeys.every((key) => !key.endsWith(OLD_VERSION)),
      `배포 전=${JSON.stringify(before.cacheKeys)} → 배포 후=${JSON.stringify(afterLoad1.cacheKeys)}`,
    );

    // ── ④ 로드 2 (배포 후 2회차) — 새 셸이 떠야 한다 ──────────────────────────────────
    await cdp.send('Page.reload', { ignoreCache: false });
    check('배포 후 2차 로드 완료', await waitFor(READY, 20_000, 'new-load2'));
    const load2 = await evaluate(READ_STATE);
    info(`배포 후 2차 로드: ${JSON.stringify(load2)}`);
    check(
      'AC-U16-4b(셸): **로드 2회 안에 새 셸**로 교체(marker=new)',
      load1.shell === 'new' || load2.shell === 'new',
      `1차=${String(load1.shell)} · 2차=${String(load2.shell)}`,
    );
    check(
      'AC-U16-4b(정리): 최종 캐시 키에 옛 버전 0개 · 새 버전만 남음',
      load2.cacheKeys.length > 0 &&
        load2.cacheKeys.every((key) => key.includes(String(newInfo.swVersion))),
      JSON.stringify(load2.cacheKeys),
    );
    check('앱 콘솔 오류 0(교체 과정 포함)', appErrors.length === 0, appErrors.join(' | '));
    await capture('T39-3-SW교체후-새셸.png');

    const summary = {
      old_version: OLD_VERSION,
      new_version: newInfo.swVersion,
      caches_before_deploy: before.cacheKeys,
      caches_after_deploy_load1: afterLoad1.cacheKeys,
      caches_after_deploy_load2: load2.cacheKeys,
      shell_marker: { before: before.shell, load1: load1.shell, load2: load2.shell },
      controller: { before: before.controller, load2: load2.controller },
    };
    writeFileSync(join(SHOT_DIR, 'T39-3-SW교체실측.json'), `${JSON.stringify(summary, null, 2)}\n`);

    console.log('\n검사 결과:');
    for (const line of notes) console.log(line);
    if (shots.length > 0) {
      console.log('\n스크린샷:');
      for (const path of shots) console.log(`  ${path}`);
    }
    console.log(`\n요약: ${JSON.stringify(summary)}`);
  } finally {
    try {
      await cdp?.send('Browser.close');
    } catch {
      /* 무시 */
    }
    chrome?.kill('SIGTERM');
    server?.close();
    for (const dir of [profileDir, stageDir]) {
      if (typeof dir === 'string') {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* 무시 */
        }
      }
    }
  }

  if (failures.length > 0) {
    console.log('\n실패:');
    for (const line of failures) console.log(line);
    process.exitCode = 1;
  } else {
    console.log('\nT39 SW CACHE SWAP: PASS');
  }
}

main().catch((error) => {
  console.error(`T39 SW CACHE SWAP: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(line);
  chrome?.kill('SIGTERM');
  server?.close();
  process.exitCode = 1;
});
