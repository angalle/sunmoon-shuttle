#!/usr/bin/env node
/**
 * T10 총괄 독립 검증 — AC-8 (개인정보 0: 네트워크 요청 목록 점검).
 * 빌드본(dist/)을 헤드리스 Chrome 으로 열어 **앱이 실제로 내보내는 모든 네트워크 요청**을 수집한다.
 * 판정: 요청 호스트가 로컬 정적 서버(127.0.0.1) 뿐이고, 추적/광고/제3자 도메인 0건.
 * 의존성 0: node:http + node:child_process + Node 내장 WebSocket.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = '/Users/leeheesun/Documents/github/sunmoon-shuttle';
const DIST = join(ROOT, 'dist');
const BASE = '/sunmoon-shuttle/';
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 계약 데이터 동봉(배포 워크플로와 동일)
mkdirSync(join(DIST, 'data'), { recursive: true });
copyFileSync(join(ROOT, 'data', 'timetable.json'), join(DIST, 'data', 'timetable.json'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/favicon.ico')) return res.writeHead(204).end();
  if (!pathname.startsWith(BASE)) return res.writeHead(404).end('outside base');
  const rel = pathname.slice(BASE.length);
  const file = rel === '' ? join(DIST, 'index.html') : join(DIST, rel);
  if (!file.startsWith(DIST) || !existsSync(file)) return res.writeHead(404).end('nf');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const debugPort = 9223;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${debugPort}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--user-data-dir=/tmp/t10-ac8-profile', 'about:blank',
], { stdio: 'ignore' });

async function ws() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up */ }
    await delay(200);
  }
  throw new Error('chrome 디버거 응답 없음');
}

const socket = new WebSocket(await ws());
await new Promise((r, j) => { socket.addEventListener('open', r); socket.addEventListener('error', j); });
let id = 0;
const pending = new Map();
const requests = [];
const consoleErrors = [];
socket.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
  if (msg.method === 'Network.requestWillBeSent') {
    requests.push({ url: msg.params.request.url, type: msg.params.type, method: msg.params.request.method });
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(JSON.stringify(msg.params.args));
  }
});
const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); socket.send(JSON.stringify({ id, method, params })); });

await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${origin}${BASE}?now=2026-10-05T14:40:00%2B09:00` });
await delay(4000);
const state = await send('Runtime.evaluate', { expression: 'document.title + "|" + document.querySelectorAll("tbody tr").length', returnByValue: true });

// 호스트별 집계
const hosts = {};
for (const r of requests) {
  let h = '(상대/기타)';
  try { h = new URL(r.url).hostname; } catch { /* relative */ }
  hosts[h] = (hosts[h] ?? 0) + 1;
}
const thirdParty = Object.keys(hosts).filter((h) => !['127.0.0.1', 'localhost', '(상대/기타)'].includes(h));
const nonLocalUrls = requests.filter((r) => /^https?:/i.test(r.url) && !r.url.startsWith(origin));

console.log('=== AC-8 네트워크 요청 감사 (헤드리스 Chrome, dist/ 빌드본) ===');
console.log(`페이지: ${origin}${BASE}  |  ${state.result?.value ?? '?'}`);
console.log(`총 요청 ${requests.length}건 · 호스트별: ${JSON.stringify(hosts)}`);
console.log('\n요청 목록(method type url):');
for (const r of requests) console.log(`  ${r.method.padEnd(4)} ${String(r.type).padEnd(12)} ${r.url}`);
console.log(`\n제3자(비로컬) 호스트: ${thirdParty.length === 0 ? '0건' : JSON.stringify(thirdParty)}`);
console.log(`비로컬 요청 URL: ${nonLocalUrls.length === 0 ? '0건' : JSON.stringify(nonLocalUrls)}`);
console.log(`앱 콘솔 오류: ${consoleErrors.length}건`);
console.log(`\nAC-8(개인정보·제3자 요청 0) 판정: ${thirdParty.length === 0 && nonLocalUrls.length === 0 && consoleErrors.length === 0 ? 'PASS' : 'FAIL'}`);

socket.close();
chrome.kill('SIGTERM');
server.close();
process.exit(thirdParty.length === 0 && nonLocalUrls.length === 0 ? 0 : 1);
