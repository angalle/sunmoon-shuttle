#!/usr/bin/env node
/**
 * T7 감사 스모크 — **헤드리스 Chrome CDP** 로 PWA·접근성·다크모드를 실측한다.
 *
 * 의존성 0(런타임·도구 모두): node:http · node:child_process · Node 내장 WebSocket 으로 CDP 를 직접 말한다
 * (scripts/render_smoke.mjs 와 같은 방식 — 추가 라이브러리 설치 없음).
 *
 * 검증 항목(카드 수용기준 2·3·4 + 지시 ①③④⑤)
 *   ① `Page.getAppManifest` 로 **매니페스트가 실제로 파싱**되는지(오류 0) + 아이콘 URL 이 200 인지
 *   ② 라이트/다크 **실제 대비 실측** — 화면의 모든 텍스트 노드를 돌며 WCAG 대비 계산(본문 4.5 / 큰 글씨 3.0)
 *   ③ **터치 타깃 실측** — 포커스 가능한 요소의 폭·높이(기본 ≥48×48 · 상단 3줄의 요일 탭 44·방향 칩 40 은
 *      docs/07 §12-5(AC-U12-4)가 낮춰 규정한 값 — **가로 ≥48px 유지**)
 *   ④ `prefers-color-scheme` 반영 실측(토큰 값과 계산값 일치) + 라이트/다크 **스크린샷 각 1장**
 *   ⑤ 전체화면(standalone) 실측 — `--app=` 모드에서 matchMedia(display-mode) 확인 + 스크린샷
 *   ⑥ 안전영역(safe-area) 대응 — `Emulation.setSafeAreaInsets` 로 노치·홈 인디케이터를 주입해 여백 확인
 *   ⑦ 설치 안내 **문구 0건**(T31 · docs/07 §13-2 — 옛 "설치 안내 1회 표시" 검사를 뒤집었다) +
 *      **본문 텍스트 노드 전수 목록**(문자열·위치·크기 덤프, §13-1 의 값·상태·라벨 5종 밖 0건)
 *   ⑧ 개인정보처리방침 정적 페이지(T11) — 푸터 링크(./privacy.html) → HTTP 200 · 필수 문구 5종 ·
 *      실제 렌더 대비 실측(같은 WCAG 4.5/3.0) · 가로 스크롤 없음 · 스크린샷
 *
 * 산출물
 *   .session-notes/T7-light.png / T7-dark.png / T7-standalone.png / T11-privacy.png
 *   .session-notes/T7-a11y-report.md  (원출력 표 — 증거 문서에 그대로 인용한다)
 *   .session-notes/T31-본문텍스트노드.md (T31 §13-3 — 본문 텍스트 노드 전수 목록)
 *
 * 사용: node scripts/a11y_smoke.mjs  [--base=/sunmoon-shuttle/] [--now=<ISO8601>]
 * 종료코드: 검사 하나라도 실패하면 1.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const DATA_FILE = join(ROOT, 'data', 'timetable.json');
const SHOT_DIR = join(ROOT, '.session-notes');
const REPORT = join(SHOT_DIR, 'T7-a11y-report.md');
/** T31 §13-3 — 본문 텍스트 노드 전수 목록(문자열·위치·크기). 증거 문서에 그대로 인용한다. */
const TEXT_NODES_REPORT = join(SHOT_DIR, 'T31-본문텍스트노드.md');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const BASE = normalizeBase(args.get('base') ?? '/sunmoon-shuttle/');
const NOW = args.get('now') ?? '2026-10-05T14:40:00+09:00';
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const checks = []; // { ok, label, detail }
const info = [];
let failures = 0;

function check(label, ok, detail = '') {
  checks.push({ ok, label, detail });
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

function note(text) {
  info.push(text);
  console.log(`  INFO  ${text}`);
}

function normalizeBase(value) {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

let cdp = null;
let appModeChild = null;

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

/**
 * 스크린샷 저장 — 모바일 뷰포트(390×844 @2x, 실제 홈 화면 설치 화면과 같은 크기) 그대로 찍는다.
 * `captureBeyondViewport`/초장축 뷰포트 확장은 헤드리스에서 화면 밖 영역이 **투명(알파 0)** 으로 나와
 * 검은 띠가 생긴다(실측: 알파 0 픽셀 다수) — 그래서 뷰포트 캡처만 쓴다.
 */
async function capture(fileName) {
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  // 헤드리스 모바일 에뮬레이션에서 **전부 투명한 스크린샷**이 나오는 경우가 있다(실측).
  // 빈 PNG 는 압축률이 비정상적으로 높다(수 KB) → 이때는 에뮬레이션을 끄고 다시 찍는다.
  if (shot.data.length < 20_000) {
    note(`스크린샷이 비어 있음(base64 ${String(shot.data.length)}자) → 기기 에뮬레이션 해제 후 재시도`);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await delay(300);
    shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  }
  const path = join(SHOT_DIR, fileName);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  return path;
}

// ───────── 페이지 안에서 실행되는 감사 코드 (문자열로 주입) ─────────

/** 화면의 모든 텍스트 노드에 대해 WCAG 대비를 계산한다. 루트 선택자를 바꿔 방침 페이지(T11)에도 쓴다. */
const contrastProbe = (rootSelector) => `
  const parseColor = (value) => {
    const match = value.match(/rgba?\\(([^)]+)\\)/);
    if (match === null) return null;
    const parts = match[1].split(',').map((piece) => parseFloat(piece.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const channel = (value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luminance = (color) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  const ratio = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const backgroundOf = (node) => {
    let cursor = node;
    while (cursor !== null) {
      const background = parseColor(getComputedStyle(cursor).backgroundColor);
      if (background !== null && background.a >= 0.999) return background;
      cursor = cursor.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const rows = [];
  for (const node of document.querySelectorAll('${rootSelector} *')) {
    const own = [...node.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent.trim())
      .join(' ')
      .trim();
    if (own === '') continue;
    if (node.closest('.shuttle-sr-only') !== null) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue;
    const fg = parseColor(style.color);
    if (fg === null) continue;
    const bg = backgroundOf(node);
    const size = parseFloat(style.fontSize);
    const weight = parseInt(style.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const value = Number(ratio(fg, bg).toFixed(2));
    const className = typeof node.className === 'string' && node.className !== '' ? '.' + node.className.split(' ').join('.') : '';
    rows.push({
      label: node.tagName.toLowerCase() + className,
      text: own.slice(0, 30),
      foreground: style.color,
      background: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
      fontSize: size,
      bold: weight >= 700,
      large: large,
      ratio: value,
      threshold: large ? 3 : 4.5,
    });
  }
  return rows;
`;

/** 앱 화면(.shuttle-app) 대비 실측 — T7. */
const CONTRAST_PROBE = contrastProbe('.shuttle-app');
/** 개인정보처리방침 페이지(.privacy-page) 대비 실측 — T11. 같은 WCAG·같은 임계값(4.5/3.0)을 쓴다. */
const PRIVACY_CONTRAST_PROBE = contrastProbe('.privacy-page');

/**
 * 본문 텍스트 노드 **전수 목록**(T31 · docs/07 §13-3, AC-U13-2) — 문자열 + 위치 + 폰트 크기.
 *
 * 같이 재는 것:
 *  · `forbiddenHits` — §13-4 AC-U13-1 의 금지 문자열 5종(설치 안내·메타 문구의 흔적) 실측 카운트
 *  · `allowed` — 이 노드가 §13-1 의 **값·상태·컨트롤 라벨**이 사는 구역(허용 클래스) 안에 있는지.
 *    `false` 는 "값도 상태도 아닌 설명문이 본문에 섞였다"는 뜻이라 0건이어야 한다.
 *  정보 시트(ⓘ)·상단 1줄 상태 안내(§9-4 예외)·오류/오프라인 얇은 줄은 문서가 예외로 둔 구역이다.
 */
const TEXT_NODES_PROBE = `
  const forbidden = ['홈 화면', '전체화면', '한 번만', '하세요', '합니다'];
  const ALLOWED = [
    '.shuttle-appbar__clock',
    '.shuttle-button',
    '.shuttle-tab',
    '.shuttle-chip',
    '.shuttle-departure__time',
    '.shuttle-departure__route',
    '.shuttle-departure__dir',
    '.shuttle-departure__token',
    '.shuttle-strip__line',
    '.shuttle-banner',
    '.shuttle-toast',
    '.shuttle-sheet',
    '.shuttle-skip-link',
    '.shuttle-table-scroll',
  ];
  /**
   * §9-4 예외 구역 — 상단 1줄 상태 안내(운행 없음·대체 시간표)와 오류·오프라인 얇은 줄.
   * 이 줄들은 T27 §9-4 가 "반드시 남긴다"고 정한 **상태** 표시라 문구가 고정 계약이다
   * (v1·render·offline 스모크가 그 문구를 그대로 검사한다). 금지 문자열 판정에서 분리해 **별도 집계**한다.
   */
  const EXCEPTION = '.shuttle-strip__line,.shuttle-banner';
  const allowedSelector = ALLOWED.join(',');
  const rows = [];
  for (const node of document.querySelectorAll('.shuttle-app *')) {
    const own = [...node.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent.trim())
      .join(' ')
      .trim();
    if (own === '') continue;
    if (node.closest('.shuttle-sr-only') !== null) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue;
    const className = typeof node.className === 'string' && node.className !== '' ? '.' + node.className.split(' ').join('.') : '';
    const zone = node.closest(EXCEPTION) !== null ? 'exception' : node.closest(allowedSelector) !== null ? 'value' : 'outside';
    rows.push({
      label: node.tagName.toLowerCase() + className,
      text: own,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      fontSize: parseFloat(style.fontSize),
      zone,
    });
  }
  /** 어떤 구역의 문자열에서 금지 문자열이 나왔는지 구역별로 따로 센다. */
  const hitsIn = (zone) => {
    const baggage = rows.filter((row) => row.zone === zone).map((row) => row.text);
    return forbidden.filter((phrase) => baggage.some((text) => text.includes(phrase)));
  };
  const violations = (() => {
    const baggage = rows.filter((row) => row.zone !== 'exception').map((row) => row.text);
    return forbidden.filter((phrase) => baggage.some((text) => text.includes(phrase)));
  })();
  return {
    rows,
    /** §13-4 AC-U13-1 실측 — 값·상태·라벨 구역(§9-4 예외 제외)에서 0건이어야 한다. */
    forbiddenViolations: violations,
    /** §9-4 예외 구역(상태 1줄)에서 나온 금지 문자열 — 문서가 남긴 예외라 위반이 아니다(별도 표기). */
    forbiddenExceptions: hitsIn('exception'),
    installHintNode: document.querySelector('[data-testid="install-hint"]') !== null,
  };
`;

/** 포커스 가능한 요소의 터치 타깃 크기 측정. */
const TARGET_PROBE = `
  const selector = '.shuttle-app a[href], .shuttle-app button, .shuttle-app summary, .shuttle-app [role="tab"], .shuttle-app [tabindex]:not([tabindex="-1"])';
  /**
   * 요소별 **문서가 정한 최소 크기**. 기본은 48×48(docs/00 §4)이지만,
   * docs/07 §12-5(AC-U12-4)가 상단 3줄의 두 컨트롤 높이를 낮춰 규정했다 —
   * 요일 세그먼트 탭 44px · 방향 칩 40px(둘 다 **가로 ≥48px 유지**).
   */
  const minSizeOf = (node) => {
    // T37 §15-3 — 요일 탭 40px · 방향 칩 **터치 44px**(보이는 알약은 34px 이고, 터치 영역은 알약 밖 투명 여백으로 확보).
    if (node.classList.contains('shuttle-tab')) return { width: 48, height: 40 };
    if (node.classList.contains('shuttle-chip')) return { width: 48, height: 44 };
    return { width: 48, height: 48 };
  };
  /**
   * T37 §15-3 — **실제 터치 영역**을 잰다. 칩은 알약(34px) 밖으로 ::after 히트 확장(inset 음수)을 두므로
   * 요소 사각형에 그 여백을 더해 판정한다(보이는 알약 크기와 터치 크기를 함께 남긴다).
   */
  const hitBoxOf = (node, box) => {
    const after = getComputedStyle(node, '::after');
    if (after.content === 'none' || after.position !== 'absolute') return box;
    const top = parseFloat(after.top);
    const bottom = parseFloat(after.bottom);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return box;
    return { width: box.width, height: box.height - top - bottom };
  };
  const rows = [];
  for (const node of document.querySelectorAll(selector)) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = node.getBoundingClientRect();
    // T24 — 앱 셸은 화면이 나뉘어 있어 숨은 화면([전체] 탭·이용 안내 시트)의 컨트롤은 0×0 으로 잡힌다.
    // 렌더되지 않는 요소는 터치 타깃이 아니므로 여기서 빼고, 그 화면들은 auditTargets 가 실제로 열어 측정한다.
    if (rect.width === 0 && rect.height === 0) continue;
    const className = typeof node.className === 'string' && node.className !== '' ? '.' + node.className.split(' ').join('.') : '';
    const min = minSizeOf(node);
    const hit = hitBoxOf(node, rect);
    rows.push({
      label: node.tagName.toLowerCase() + className,
      text: (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 28),
      width: Math.round(hit.width),
      height: Math.round(hit.height),
      paintedWidth: Math.round(rect.width),
      paintedHeight: Math.round(rect.height),
      minWidth: min.width,
      minHeight: min.height,
    });
  }
  return rows;
`;

/**
 * T24 — 터치 타깃은 화면별로 측정한다. 앱 셸이 [지금]/[전체]/이용 안내 시트로 나뉘어 있어 한 화면만 보면
 * 나머지 컨트롤(요일 탭·방향 칩·시트 버튼)은 렌더되지 않아 측정에서 빠진다(= 검증 대상이 줄어든다).
 * 세 화면을 실제로 열어 합집합으로 판정하고, 끝나면 기본 상태([지금])로 되돌린다.
 */
async function auditTargets() {
  const click = async (selector) => {
    await evaluate(`const node = document.querySelector(${JSON.stringify(selector)}); if (node !== null) node.click(); return true;`);
    await delay(250);
  };
  const rows = [...(await evaluate(TARGET_PROBE))]; // [지금](기본 탭)
  await click('[data-testid="app-info"]'); // 이용 안내 시트 열기(숨은 화면)
  rows.push(...(await evaluate(TARGET_PROBE)));
  await click('[data-testid="guide-close"]');
  await click('#shuttle-day-tab-saturday'); // [전체] — 요일 탭·방향 칩·전체 목록
  rows.push(...(await evaluate(TARGET_PROBE)));
  await click('#shuttle-day-tab-weekday'); // 기본 상태 복원
  // 앞선 클릭이 남긴 포커스를 지운다 — 뒤따르는 포커스 검사(첫 Tab → 스킵 링크)가 오염되지 않게.
  await evaluate(`if (document.activeElement !== null && document.activeElement !== document.body) document.activeElement.blur(); return true;`);
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.label}|${row.text}|${String(row.width)}x${String(row.height)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const TOKEN_PROBE = `
  const root = getComputedStyle(document.documentElement);
  const meta = document.querySelector('meta[name="theme-color"]');
  return {
    colorBg: root.getPropertyValue('--color-bg').trim(),
    colorSurface: root.getPropertyValue('--color-surface').trim(),
    colorText: root.getPropertyValue('--color-text').trim(),
    touchTargetMin: root.getPropertyValue('--touch-target-min').trim(),
    safeAreaTop: root.getPropertyValue('--safe-area-top').trim(),
    themeColorMeta: meta === null ? null : meta.getAttribute('content'),
    darkScheme: window.matchMedia('(prefers-color-scheme: dark)').matches,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    appPaddingTop: getComputedStyle(document.querySelector('.shuttle-app')).paddingTop,
    appPaddingBottom: getComputedStyle(document.querySelector('.shuttle-app')).paddingBottom,
  };
`;

// ───────── 본체 ─────────

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome 실행 파일을 찾지 못했습니다: ${CHROME}`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html 이 없습니다 — 먼저 npm run build 를 실행하세요.');
  for (const required of ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'apple-touch-icon.png', 'favicon.svg', 'privacy.html', 'privacy.css']) {
    if (!existsSync(join(DIST, required))) throw new Error(`dist/${required} 이 없습니다 — npm run build 후 다시 실행하세요.`);
  }
  mkdirSync(SHOT_DIR, { recursive: true });
  // 계약 데이터 동봉(배포 산출물과 같은 조건) — dist/data/timetable.json
  if (!existsSync(DATA_FILE)) throw new Error('data/timetable.json 이 없습니다.');
  mkdirSync(join(DIST, 'data'), { recursive: true });
  copyFileSync(DATA_FILE, join(DIST, 'data', 'timetable.json'));

  const webPort = await freePort();
  const debugPort = await freePort();
  const server = await startStaticServer(webPort, BASE);
  const profileDir = join(tmpdir(), `t7-a11y-${String(process.pid)}`);
  const origin = `http://127.0.0.1:${String(webPort)}`;
  const url = `${origin}${BASE}?now=${encodeURIComponent(NOW)}`;
  console.log(`a11y_smoke: ${url} (base=${BASE}, now=${NOW})\n`);

  const chrome = spawn(
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

  let standaloneChrome = null;
  const consoleErrors = [];
  const report = [];
  /** T11 — 방침 페이지 스크린샷 경로(블록 밖 보고서 헤더에서도 참조). */
  let privacyShot = null;
  try {
    cdp = await connectCdp(await waitForDebugger(debugPort));
    cdp.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(`exception: ${message.params?.exceptionDetails?.text ?? 'unknown'}`);
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        consoleErrors.push(`console.error: ${(message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        consoleErrors.push(`log: ${message.params.entry.text} (${message.params.entry.url ?? ''})`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    // 모바일 뷰포트(PWA 설치 화면과 같은 조건) + 터치
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await cdp.send('Page.navigate', { url });

    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      ready = (await evaluate(`return document.querySelector('[data-testid="timetable-list"]') !== null;`)) === true;
      if (!ready) await delay(250);
    }
    check('앱 렌더(다음 버스 카드)', ready);

    // ── ① 매니페스트 파싱(브라우저가 실제로 읽은 결과) ────────────────
    const manifest = await cdp.send('Page.getAppManifest');
    const manifestErrors = manifest.errors ?? [];
    check('매니페스트 파싱 성공(브라우저 오류 0)', manifestErrors.length === 0, JSON.stringify(manifestErrors));
    const manifestData = typeof manifest.data === 'string' ? JSON.parse(manifest.data) : (manifest.data ?? {});
    check('매니페스트 display=standalone', manifestData.display === 'standalone', `display=${String(manifestData.display)}`);
    check('start_url/scope 가 하위 경로 상대값', manifestData.start_url === './' && manifestData.scope === './', `start_url=${String(manifestData.start_url)} scope=${String(manifestData.scope)}`);
    report.push(`### ① 매니페스트 (Page.getAppManifest)\n`);
    report.push(`- url: ${manifest.url}\n- errors: ${JSON.stringify(manifestErrors)}\n- name: ${String(manifestData.name)}\n- short_name: ${String(manifestData.short_name)}\n- display: ${String(manifestData.display)} · start_url: ${String(manifestData.start_url)} · scope: ${String(manifestData.scope)}\n- theme_color: ${String(manifestData.theme_color)} · background_color: ${String(manifestData.background_color)}\n`);

    // 아이콘 4종 + apple-touch 아이콘이 실제로 200 으로 내려오는지(치수도 IHDR 로 확인)
    const iconLines = [];
    for (const icon of manifestData.icons ?? []) {
      const response = await fetch(`${origin}${BASE}${String(icon.src).replace(/^\.\//, '')}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      const expected = String(icon.sizes);
      const ok = response.status === 200 && `${String(width)}x${String(height)}` === expected;
      iconLines.push(`| ${String(icon.src)} | ${expected} | ${String(icon.purpose ?? 'any')} | ${String(response.status)} | ${String(width)}x${String(height)} | ${String(bytes.length)}B |`);
      check(`아이콘 응답 ${String(icon.src)} (${expected}, ${String(icon.purpose ?? 'any')})`, ok, `status=${String(response.status)} 실제=${String(width)}x${String(height)} ${String(bytes.length)}B`);
    }
    const appleTouch = await fetch(`${origin}${BASE}apple-touch-icon.png`);
    check('apple-touch-icon 응답 200', appleTouch.status === 200, `status=${String(appleTouch.status)}`);
    report.push(`\n### ② 아이콘 실측(HTTP 200 · IHDR 치수 · 바이트)\n\n| src | sizes | purpose | status | 실제 치수 | 바이트 |\n|---|---|---|---|---|---|\n${iconLines.join('\n')}\n`);

    // ── ②③ 라이트 모드: 대비·터치 타깃 실측 ────────────────────────
    const auditTheme = async (theme) => {
      const tokens = await evaluate(TOKEN_PROBE);
      const contrast = await evaluate(CONTRAST_PROBE);
      const targets = await auditTargets();
      const layout = await evaluate(`
        const root = document.documentElement;
        const offenders = [];
        for (const node of document.querySelectorAll('.shuttle-app *')) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.right > window.innerWidth + 1 || rect.left < -1) {
            // 표는 의도적으로 내부 가로 스크롤(.shuttle-table-scroll)을 쓴다 — 문서 오버플로가 아니다.
            if (node.closest('.shuttle-table-scroll') !== null) continue;
            const className = typeof node.className === 'string' && node.className !== '' ? '.' + node.className.split(' ').join('.') : '';
            offenders.push({
              label: node.tagName.toLowerCase() + className,
              text: (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            });
          }
        }
        const scroller = document.scrollingElement ?? document.documentElement;
        const before = scroller.scrollLeft;
        scroller.scrollLeft = 99999;
        const after = scroller.scrollLeft;
        scroller.scrollLeft = before;
        return {
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          innerWidth: window.innerWidth,
          canScrollHorizontally: after > 0,
          scrollLeftAfter: after,
          elements: document.querySelectorAll('.shuttle-app *').length,
          installHintNode: document.querySelector('[data-testid="install-hint"]') !== null,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          bodyColor: getComputedStyle(document.body).color,
          offenders: offenders.slice(0, 8),
        };
      `);
      const contrastBad = contrast.filter((row) => row.ratio < row.threshold);
      // 기준은 행마다 다르다 — 기본 48×48, §12-5 예외(요일 탭 44 · 방향 칩 40, 가로 ≥48).
      const targetBad = targets.filter((row) => row.width < row.minWidth || row.height < row.minHeight);
      check(`[${theme}] 대비 미달 0건 (텍스트 ${String(contrast.length)}개 실측)`, contrastBad.length === 0, contrastBad.map((row) => `${row.label} "${row.text}" ${String(row.ratio)}<${String(row.threshold)}`).join(' | '));
      check(
        `[${theme}] 터치 타깃 규격(기본 48×48 · §12-5 탭 44·칩 40 가로 ≥48) (요소 ${String(targets.length)}개 실측)`,
        targetBad.length === 0,
        targetBad.map((row) => `${row.label} "${row.text}" ${String(row.width)}x${String(row.height)} < ${String(row.minWidth)}x${String(row.minHeight)}`).join(' | '),
      );
      check(`[${theme}] theme-color 메타 = --color-bg(${tokens.colorBg})`, tokens.themeColorMeta === tokens.colorBg, `meta=${String(tokens.themeColorMeta)}`);
      check(`[${theme}] prefers-color-scheme 반영`, tokens.darkScheme === (theme === 'dark'), `matches=${String(tokens.darkScheme)}`);
      check(`[${theme}] 수평 스크롤 없음(본문 폭 ${String(layout.innerWidth)}px · scrollWidth=${String(layout.scrollWidth)})`, layout.canScrollHorizontally === false, `scrollLeft→${String(layout.scrollLeftAfter)} offenders=${JSON.stringify(layout.offenders)}`);
      check(`[${theme}] 빈 화면 아님(화면 요소 ${String(layout.elements)}개 · body bg=${String(layout.bodyBackground)})`, layout.elements > 200, `elements=${String(layout.elements)}`);
      report.push(`\n### ${theme === 'light' ? '③' : '④'} ${theme} — 대비 실측(전체 ${String(contrast.length)}개 텍스트 노드)\n\n| 요소 | 문구 | 전경 | 배경 | 크기 | 대비 | 기준 |\n|---|---|---|---|---|---|---|\n${contrast
        .map(
          (row) =>
            `| ${row.label} | ${row.text.replace(/\|/g, '\\|')} | ${row.foreground} | ${row.background} | ${String(row.fontSize)}px${row.bold ? ' bold' : ''}${row.large ? ' (큰글씨)' : ''} | ${String(row.ratio)}:1 | ≥${String(row.threshold)} |`,
        )
        .join('\n')}\n\n미달: ${contrastBad.length === 0 ? '0건' : `${String(contrastBad.length)}건`}\n`);
      report.push(`\n#### ${theme} — 터치 타깃 실측(${String(targets.length)}개)\n\n| 요소 | 문구 | 폭 | 높이 | 최소(문서) |\n|---|---|---|---|---|\n${targets
        .map((row) => `| ${row.label} | ${row.text.replace(/\|/g, '\\|')} | ${String(row.width)}px | ${String(row.height)}px | ${String(row.minWidth)}×${String(row.minHeight)} |`)
        .join('\n')}\n\n규격 미달: ${targetBad.length === 0 ? '0건' : `${String(targetBad.length)}건`}\n\n레이아웃: 요소 ${String(layout.elements)}개 · body bg=${String(layout.bodyBackground)} · body color=${String(layout.bodyColor)} · scrollWidth=${String(layout.scrollWidth)} ≤ clientWidth=${String(layout.clientWidth)}\n`);
      return tokens;
    };

    const lightTokens = await auditTheme('light');
    note(`light 토큰: bg=${lightTokens.colorBg} surface=${lightTokens.colorSurface} text=${lightTokens.colorText} touch-min=${lightTokens.touchTargetMin} safe-top=${String(lightTokens.safeAreaTop)}`);
    const lightShot = await capture('T7-light.png');

    // ── 키보드 포커스 가시성(스킵 링크) ──────────────────────────────
    // T24 — 앞선 검사(터치 타깃 실측이 이용 안내 시트·[전체] 탭을 실제로 연다)가 포커스와 함께
    // **순차 포커스 시작점**을 남긴다. blur() 만으로는 시작점이 그대로라 Tab 이 그 다음 요소로 간다.
    // body 를 포커스 대상(tabIndex=-1)으로 만들어 시작점을 문서 처음으로 되돌린 뒤 첫 Tab 을 누른다
    // — "키보드로 앱에 처음 진입한 상태" 와 같은 조건을 만든다.
    await evaluate(`
      document.body.tabIndex = -1;
      document.body.style.outline = 'none';
      document.body.focus();
      return document.activeElement === document.body;
    `);
    await delay(80);
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await delay(150);
    const focusState = await evaluate(`
      const active = document.activeElement;
      const style = active === null ? null : getComputedStyle(active);
      return {
        tag: active === null ? null : active.tagName.toLowerCase(),
        className: active === null ? null : String(active.className),
        outlineStyle: style === null ? null : style.outlineStyle,
        outlineWidth: style === null ? null : style.outlineWidth,
        outlineColor: style === null ? null : style.outlineColor,
      };
    `);
    check('Tab 키로 첫 포커스(스킵 링크) 도달', focusState.className === 'shuttle-skip-link', JSON.stringify(focusState));
    check('포커스 링이 실제로 그려진다(:focus-visible, outline ≥3px·none 아님)', focusState.outlineStyle === 'solid' && parseFloat(focusState.outlineWidth) >= 3, `outline=${String(focusState.outlineStyle)} ${String(focusState.outlineWidth)} ${String(focusState.outlineColor)}`);
    const focusShot = await capture('T7-focus-skip-link.png');
    report.push(`\n#### 키보드 포커스(실측)\n- activeElement: ${focusState.tag}${focusState.className === null ? '' : `.${focusState.className}`}\n- outline: ${String(focusState.outlineStyle)} ${String(focusState.outlineWidth)} ${String(focusState.outlineColor)}\n`);

    // ── ⑦ 설치 안내 문구 0건 + 본문 텍스트 노드 전수 목록 (T31 · docs/07 §13) ─────
    // 옛 검사는 "설치 안내가 1회 뜨고, 닫으면 다시 안 뜬다"였다. §13-2(사용자 지시)로 안내를 **삭제**했으므로
    // 검사 방향을 뒤집는다 — **0건이어야 통과**(AC-U13-4 와 같은 반전).
    const textDump = await evaluate(TEXT_NODES_PROBE);
    const zoneLabel = (zone) => (zone === 'value' ? '값·상태·라벨' : zone === 'exception' ? '§9-4 예외(상태 1줄)' : '**허용 구역 밖**');
    check(
      '설치 안내 노드 0건(§13-2 — 컴포넌트·판정 API 삭제)',
      textDump.installHintNode === false,
      `install-hint=${String(textDump.installHintNode)}`,
    );
    check(
      '본문 금지 문자열 0건(홈 화면·전체화면·한 번만·하세요·합니다) — AC-U13-1 실측',
      textDump.forbiddenViolations.length === 0,
      textDump.forbiddenViolations.join(' | '),
    );
    const outside = textDump.rows.filter((row) => row.zone === 'outside');
    check(
      `본문 텍스트 노드 허용 구역(값·상태·컨트롤 라벨) 밖 0건 (노드 ${String(textDump.rows.length)}개 실측)`,
      outside.length === 0,
      outside.map((row) => `${row.label} "${row.text}" @${String(row.x)},${String(row.y)}`).join(' | '),
    );
    // §9-4 예외 구역(상태 1줄)은 문서가 남긴 고정 문구다 — 위반이 아니라 **별도 집계**로 보고한다.
    note(
      `§9-4 예외 구역(상단 상태 1줄·오류/오프라인 배너)의 금지 문자열: ${textDump.forbiddenExceptions.length === 0 ? '0건' : textDump.forbiddenExceptions.join(', ')}`,
    );
    // §13-3 — 전수 목록을 **문서로 제출**한다(문자열 + 위치 + 폰트 크기).
    const dumpLines = [
      '# T31 본문 텍스트 노드 전수 목록 (docs/07 §13-3 · AC-U13-2)',
      '',
      `- 일시: ${new Date().toISOString()}`,
      `- URL: ${url}`,
      '- 뷰포트: 390×844 @2x (mobile, touch) · 라이트 모드 · 미설치 상태(설치 안내 없음)',
      `- 노드 수: ${String(textDump.rows.length)}개 · 금지 문자열 실측: ${textDump.forbiddenViolations.length === 0 ? '0건' : textDump.forbiddenViolations.join(', ')}`,
      `- §9-4 예외 구역(상단 상태 1줄·오류/오프라인 배너)에서 나온 금지 문자열: ${textDump.forbiddenExceptions.length === 0 ? '0건' : textDump.forbiddenExceptions.join(', ')} (문서가 남긴 고정 문구 — v1·render·offline 스모크가 그대로 검사한다)`,
      `- 허용 구역 밖(설명문 의심): ${outside.length === 0 ? '0건' : `${String(outside.length)}건`}`,
      '',
      '| # | 요소 | 문자열 | 위치(x,y) | 크기(w×h) | 폰트(px) | 구분 |',
      '|---|---|---|---|---|---|---|',
      ...textDump.rows.map(
        (row, index) =>
          `| ${String(index + 1)} | ${row.label} | ${row.text.replace(/\|/g, '\\|')} | ${String(row.x)},${String(row.y)} | ${String(row.width)}×${String(row.height)} | ${String(row.fontSize)} | ${zoneLabel(row.zone)} |`,
      ),
      '',
      '## 구분 기준 (§13-1 — 본문 텍스트는 다음 5종만)',
      '① 시각 ② 노선·도착지 ③ 편수 ④ 조건 토큰 ⑤ 컨트롤 라벨(아이콘 라벨)',
      '',
      '허용 구역 클래스',
      '- `.shuttle-appbar__clock` — 날짜·시각(①)',
      '- `.shuttle-departure__time`/`__route`/`__dir`/`__token` — 시각·노선·도착지·조건 토큰(①②③④)',
      '- `.shuttle-tab`/`.shuttle-chip`/`.shuttle-button` — 컨트롤 라벨·편수(③⑤)',
      '- `.shuttle-strip__line`/`.shuttle-banner` — §9-4 예외: 상단 1줄 상태 안내(운행 없음·대체 시간표·오프라인·오류)',
      '- `.shuttle-toast` — 하단 안내(§11-2, 사용자가 `현재 시간으로` 를 눌렀을 때만)',
      '- `.shuttle-sheet` — 정보 시트(ⓘ). §13-1 이 예외로 둔 구역(출처·요금·정차창·갱신 시각)',
      '- `.shuttle-table-scroll` — 표 계약(T14 이후 미사용)',
      '',
      '제외: `shuttle-sr-only`(낭독기 전용) · 표시되지 않는 노드(display:none/visibility:hidden/opacity:0) · 2px 이하',
    ];
    writeFileSync(TEXT_NODES_REPORT, dumpLines.join('\n'));
    report.push(
      `\n### 설치 안내 삭제 + 본문 텍스트 노드 전수 목록(T31 · docs/07 §13)\n- 설치 안내 노드: ${String(textDump.installHintNode)} · 금지 문자열 실측(값·상태·라벨 구역): ${textDump.forbiddenViolations.length === 0 ? '0건' : textDump.forbiddenViolations.join(', ')}\n- §9-4 예외 구역(상태 1줄): ${textDump.forbiddenExceptions.length === 0 ? '0건' : textDump.forbiddenExceptions.join(', ')}\n- 본문 텍스트 노드 ${String(textDump.rows.length)}개 · 허용 구역 밖 ${String(outside.length)}건\n- 전수 목록(문자열·위치·크기): ${TEXT_NODES_REPORT.slice(ROOT.length)}\n\n| 요소 | 문자열 | 위치(x,y) | 크기(w×h) | 폰트(px) | 구분 |\n|---|---|---|---|---|---|\n${textDump.rows
        .map(
          (row) =>
            `| ${row.label} | ${row.text.replace(/\|/g, '\\|')} | ${String(row.x)},${String(row.y)} | ${String(row.width)}×${String(row.height)} | ${String(row.fontSize)} | ${zoneLabel(row.zone)} |`,
        )
        .join('\n')}\n`,
    );

    // ── ④ 다크 모드 실측(새로고침 후) ───────────────────────────────
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await cdp.send('Page.reload', { ignoreCache: false });
    const darkDeadline = Date.now() + 20_000;
    let darkReady = false;
    while (Date.now() < darkDeadline && !darkReady) {
      darkReady = (await evaluate(`return document.querySelector('[data-testid="timetable-list"]') !== null;`)) === true;
      if (!darkReady) await delay(250);
    }
    check('다크 모드에서도 앱 렌더', darkReady);
    const darkTokens = await auditTheme('dark');
    check('다크 토큰이 라이트와 실제로 다르다', darkTokens.colorBg !== lightTokens.colorBg && darkTokens.colorText !== lightTokens.colorText, `light bg=${lightTokens.colorBg} text=${lightTokens.colorText} / dark bg=${darkTokens.colorBg} text=${darkTokens.colorText}`);
    const darkDump = await evaluate(TEXT_NODES_PROBE);
    check(
      '새로고침 후에도 설치 안내 문구 0건(§13-2) — 다크 모드 재실측',
      darkDump.installHintNode === false && darkDump.forbiddenViolations.length === 0,
      `hint=${String(darkDump.installHintNode)} 위반=${JSON.stringify(darkDump.forbiddenViolations)} §9-4 예외=${JSON.stringify(darkDump.forbiddenExceptions)}`,
    );
    const darkShot = await capture('T7-dark.png');

    // ── ⑥ 안전영역(노치·홈 인디케이터) 주입 ──────────────────────────
    let safeAreaSupported = true;
    try {
      await cdp.send('Emulation.setSafeAreaInsets', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
    } catch (error) {
      safeAreaSupported = false;
      note(`Emulation.setSafeAreaInsets 미지원 → env() 폴백(0px)으로 확인: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (safeAreaSupported) {
      await delay(150);
      const safeState = await evaluate(TOKEN_PROBE);
      if (String(safeState.safeAreaTop).startsWith('47')) {
        check('안전영역 inset 주입 시 --safe-area-top 이 47px 로 반영', true, `--safe-area-top=${String(safeState.safeAreaTop)} padding-top=${String(safeState.appPaddingTop)} padding-bottom=${String(safeState.appPaddingBottom)}`);
        check('본문 패딩이 안전영역만큼 확보된다(top ≥47px)', parseFloat(safeState.appPaddingTop) >= 47, `padding-top=${String(safeState.appPaddingTop)}`);
      } else {
        note(`safe-area inset 이 CSS env() 로 전달되지 않음(--safe-area-top=${String(safeState.safeAreaTop)}) — 헤드리스 한계, 테스트(tokens)에서 env() 참조로 검증`);
      }
      const safeShot = await capture('T7-safe-area.png');
      report.push(`\n### ⑥ 안전영역(노치 47px · 홈 인디케이터 34px 주입)\n- --safe-area-top=${String(safeState.safeAreaTop)} · padding-top=${String(safeState.appPaddingTop)} · padding-bottom=${String(safeState.appPaddingBottom)}\n- 스크린샷: ${safeShot}\n`);
    }

    // 안전영역 토큰을 강제로 주입해 **레이아웃이 그 값을 실제로 소비하는지** 확인한다.
    // (헤드리스에서는 노치가 없어 env() 가 0px 이므로, iOS 가 넘겨주는 상황을 흉내 낸다.)
    const injected = await evaluate(`
      const root = document.documentElement;
      root.style.setProperty('--safe-area-top', '59px');
      root.style.setProperty('--safe-area-bottom', '34px');
      const app = document.querySelector('.shuttle-app');
      const style = getComputedStyle(app);
      return { paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
    `);
    check('안전영역 토큰 주입 시 본문 패딩이 커진다(전체화면 대응 실측)', parseFloat(injected.paddingTop) >= 59 && parseFloat(injected.paddingBottom) >= 34, `padding-top=${injected.paddingTop} padding-bottom=${injected.paddingBottom}`);
    await evaluate(`
      const root = document.documentElement;
      root.style.removeProperty('--safe-area-top');
      root.style.removeProperty('--safe-area-bottom');
      return true;
    `);
    report.push(`\n#### 안전영역 토큰 주입 실측\n- --safe-area-top=59px · --safe-area-bottom=34px 주입 → padding-top=${injected.paddingTop} · padding-bottom=${injected.paddingBottom}\n`);

    // ── ⑤ 전체화면(standalone) 모드 ─────────────────────────────────
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    let emulatedStandalone = false;
    try {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }, { name: 'prefers-color-scheme', value: 'light' }] });
      emulatedStandalone = (await evaluate(`return window.matchMedia('(display-mode: standalone)').matches;`)) === true;
    } catch {
      emulatedStandalone = false;
    }
    if (!emulatedStandalone) {
      note('CDP display-mode 에뮬레이션 미지원 → --app= 모드로 실제 standalone 확인');
      try { await cdp.send('Browser.close'); } catch { /* 무시 */ }
      const wsStandalone = await launchAppMode(url, debugPort + 1, profileDir);
      if (wsStandalone === null) {
        check('전체화면(standalone) 모드 확인', false, '--app= 모드 기동 실패');
      } else {
        cdp = wsStandalone;
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        const appDeadline = Date.now() + 20_000;
        let appReady = false;
        while (Date.now() < appDeadline && !appReady) {
          appReady = (await evaluate(`return document.querySelector('[data-testid="timetable-list"]') !== null;`)) === true;
          if (!appReady) await delay(250);
        }
        const standaloneState = await evaluate(TOKEN_PROBE);
        check('--app= 모드에서 앱 렌더', appReady);
        check('display-mode: standalone 실측', standaloneState.standalone === true, `standalone=${String(standaloneState.standalone)}`);
        const standaloneDump = await evaluate(TEXT_NODES_PROBE);
        check(
          'standalone 에서도 설치 안내 문구 0건(§13-2)',
          standaloneDump.installHintNode === false && standaloneDump.forbiddenViolations.length === 0,
          `hint=${String(standaloneDump.installHintNode)} 위반=${JSON.stringify(standaloneDump.forbiddenViolations)}`,
        );
        const standaloneShot = await capture('T7-standalone.png');
        report.push(`\n### ⑦ 전체화면(standalone, --app= 모드)\n- matchMedia('(display-mode: standalone)') = ${String(standaloneState.standalone)}\n- 설치 안내 문구 0건(§13-2 로 삭제 — 옛 "이미 설치 상태라 미표시" 조건이 아니다)\n- 스크린샷: ${standaloneShot}\n`);
      }
    } else {
      const standaloneShot = await capture('T7-standalone.png');
      check('display-mode: standalone 실측(에뮬레이션)', true);
      report.push(`\n### ⑦ 전체화면(standalone 에뮬레이션)\n- 스크린샷: ${standaloneShot}\n`);
    }

    // ── ⑧ 개인정보처리방침 정적 페이지(privacy.html · T11) ─────────────
    {
      // 앱 푸터의 방침 링크(내부 상대경로)부터 확인한다 — 지금 페이지는 앱 화면이다.
      const privacyLink = await evaluate(`
        const node = document.querySelector('[data-testid="privacy-link"]');
        return node === null ? null : { href: node.getAttribute('href'), text: (node.textContent || '').trim(), resolved: node.href };
      `);
      check(
        '푸터에 개인정보처리방침 링크가 있다(href=./privacy.html)',
        privacyLink !== null && privacyLink.href === './privacy.html' && privacyLink.text.includes('개인정보처리방침'),
        JSON.stringify(privacyLink),
      );

      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      const privacyUrl = `${origin}${BASE}privacy.html`;
      const privacyResponse = await fetch(privacyUrl);
      const privacyBody = await privacyResponse.text();
      check('privacy.html 응답 200', privacyResponse.status === 200, `status=${String(privacyResponse.status)} ${String(Buffer.byteLength(privacyBody, 'utf8'))}B`);

      await cdp.send('Page.navigate', { url: privacyUrl });
      const privacyDeadline = Date.now() + 20_000;
      let privacyReady = false;
      while (Date.now() < privacyDeadline && !privacyReady) {
        privacyReady = (await evaluate(`return document.querySelector('.privacy-page h1') !== null && document.readyState === 'complete';`)) === true;
        if (!privacyReady) await delay(200);
      }
      const privacyState = await evaluate(`
        const h1 = document.querySelector('.privacy-page h1');
        const text = document.body.textContent || '';
        const scroller = document.scrollingElement ?? document.documentElement;
        const before = scroller.scrollLeft;
        scroller.scrollLeft = 99999;
        const after = scroller.scrollLeft;
        scroller.scrollLeft = before;
        const required = ['수집하지 않습니다', '제3자에게 제공하지 않습니다', '광고를 게재하지 않으며', '비공식', '시행일'];
        return {
          h1: h1 === null ? null : h1.textContent.trim(),
          title: document.title,
          missing: required.filter((phrase) => !text.includes(phrase)),
          backHref: document.querySelector('.privacy-back')?.getAttribute('href') ?? null,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          bodyColor: getComputedStyle(document.body).color,
          canScrollHorizontally: after > 0,
          scrollWidth: scroller.scrollWidth,
        };
      `);
      check('privacy.html 렌더(h1 = 개인정보처리방침)', privacyReady && privacyState.h1 === '개인정보처리방침', JSON.stringify({ h1: privacyState.h1, title: privacyState.title }));
      check('필수 문구 5종이 화면에 있다(수집·제3자·광고·비공식·시행일)', privacyState.missing.length === 0, privacyState.missing.join(' | '));
      check('privacy.css 적용 실측(body 배경 = 토큰 색)', /^rgb/.test(String(privacyState.bodyBackground)), `bg=${String(privacyState.bodyBackground)} color=${String(privacyState.bodyColor)}`);
      check('앱으로 돌아가는 링크(href=./)', privacyState.backHref === './', `href=${String(privacyState.backHref)}`);
      check('privacy.html 가로 스크롤 없음', privacyState.canScrollHorizontally === false, `scrollWidth=${String(privacyState.scrollWidth)}`);

      const privacyContrast = await evaluate(PRIVACY_CONTRAST_PROBE);
      const privacyContrastBad = privacyContrast.filter((row) => row.ratio < row.threshold);
      check(
        `[privacy] 대비 미달 0건 (텍스트 ${String(privacyContrast.length)}개 실측)`,
        privacyContrastBad.length === 0,
        privacyContrastBad.map((row) => `${row.label} "${row.text}" ${String(row.ratio)}<${String(row.threshold)}`).join(' | '),
      );
      check('privacy.html 콘솔 오류 0(지금까지 누적 기준)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
      const privacyShotPath = await capture('T11-privacy.png');
      privacyShot = privacyShotPath;
      report.push(
        `\n### ⑧ 개인정보처리방침(privacy.html · T11)\n- URL: ${privacyUrl} (HTTP ${String(privacyResponse.status)}, ${String(Buffer.byteLength(privacyBody, 'utf8'))}B)\n- h1: ${String(privacyState.h1)} · 필수 문구 누락: ${privacyState.missing.length === 0 ? '0건' : privacyState.missing.join(', ')}\n- body bg=${String(privacyState.bodyBackground)} · color=${String(privacyState.bodyColor)} · 가로 스크롤 ${privacyState.canScrollHorizontally ? '있음' : '없음'}(scrollWidth=${String(privacyState.scrollWidth)})\n- 푸터 링크: ${JSON.stringify(privacyLink)}\n- 스크린샷: ${privacyShot}\n\n| 요소 | 문구 | 전경 | 배경 | 크기 | 대비 | 기준 |\n|---|---|---|---|---|---|---|\n${privacyContrast
          .map(
            (row) =>
              `| ${row.label} | ${row.text.replace(/\|/g, '\\|')} | ${row.foreground} | ${row.background} | ${String(row.fontSize)}px${row.bold ? ' bold' : ''}${row.large ? ' (큰글씨)' : ''} | ${String(row.ratio)}:1 | ≥${String(row.threshold)} |`,
          )
          .join('\n')}\n\n미달: ${privacyContrastBad.length === 0 ? '0건' : `${String(privacyContrastBad.length)}건`}\n`,
      );

      // 앱 화면으로 복귀(뒤따르는 검사·보고가 앱 상태를 전제로 한다).
      await cdp.send('Page.navigate', { url });
      const backDeadline = Date.now() + 20_000;
      let backReady = false;
      while (Date.now() < backDeadline && !backReady) {
        backReady = (await evaluate(`return document.querySelector('[data-testid="timetable-list"]') !== null;`)) === true;
        if (!backReady) await delay(250);
      }
      check('방침 페이지 → 앱 복귀 렌더', backReady);
    }

    check('콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    report.unshift(`# T7·T11 감사 원출력 (a11y_smoke.mjs)\n\n- 일시: ${new Date().toISOString()}\n- URL: ${url}\n- 뷰포트: 390×844 @2x (mobile, touch)\n- 스크린샷: ${[lightShot, darkShot, focusShot, privacyShot].filter((path) => typeof path === 'string').map((path) => path.slice(ROOT.length)).join(' · ')}\n`);
    writeFileSync(REPORT, report.join('\n'));
  } finally {
    try {
      if (cdp !== null) await cdp.send('Browser.close');
    } catch {
      /* 무시 */
    }
    chrome.kill('SIGTERM');
    standaloneChrome?.kill('SIGTERM');
    appModeChild?.kill('SIGTERM');
    server.close();
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* 무시 */
    }
  }

  console.log(`\n검사 ${String(checks.length)}건 · 실패 ${String(failures)}건`);
  console.log(`리포트: ${REPORT}`);
  if (failures > 0) {
    console.log('\nA11Y SMOKE: FAIL');
    process.exitCode = 1;
  } else {
    console.log('\nA11Y SMOKE: PASS');
  }
}

/** `--app=` 모드로 Chrome 을 띄워 standalone(전체화면) 상태를 확인한다. */
async function launchAppMode(url, port, profileDir) {
  appModeChild = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}-app`,
      `--remote-debugging-port=${String(port)}`,
      '--window-size=390,844',
      `--app=${url}`,
    ],
    { stdio: 'ignore' },
  );
  try {
    return await connectCdp(await waitForDebugger(port));
  } catch (error) {
    note(`--app= 모드 연결 실패: ${error instanceof Error ? error.message : String(error)}`);
    appModeChild.kill('SIGTERM');
    appModeChild = null;
    return null;
  }
}

main().catch((error) => {
  console.error(`A11Y SMOKE: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  for (const entry of checks) console.log(`  ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.label}${entry.detail === '' ? '' : ` — ${entry.detail}`}`);
  process.exitCode = 1;
});
