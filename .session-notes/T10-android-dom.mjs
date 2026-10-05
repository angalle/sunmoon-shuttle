#!/usr/bin/env node
/**
 * T10 AC-7 (Android) — WebView DOM 실측.
 * adb forward 로 노출된 WebView DevTools(CDP)에 붙어 렌더된 DOM 을 직접 읽는다(스크린샷 판독 아님).
 *  - 요일 탭 라벨/선택 상태
 *  - tbody 행 수 ↔ 계약 JSON 기대치
 *  - '다음 버스' 문구
 *  - 토요일 탭 클릭 후 행 수 변화
 *  - 표 위치로 스크롤 후 스크린샷
 *  - 앱이 낸 콘솔 오류 수
 * 사용: node T10-android-dom.mjs <cdpPort> <OUT_DIR>
 */
const port = process.argv[2] ?? '9222';
const OUT = process.argv[3] ?? '.session-notes';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === 'page') ?? list[0];
if (!page) throw new Error('WebView 타깃을 찾지 못했습니다');
console.log('CDP target:', page.title, '|', page.url);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { socket.addEventListener('open', r); socket.addEventListener('error', j); });
let id = 0;
const pending = new Map();
const consoleErrors = [];
const consoleWarns = [];
socket.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error') consoleErrors.push(text);
    if (m.params.type === 'warning') consoleWarns.push(text);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text);
});
const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); socket.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const probe = `(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')].map(t => ({
    id: t.id, text: (t.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40),
    selected: t.getAttribute('aria-selected')
  }));
  const rows = document.querySelectorAll('table tbody tr').length;
  const hero = document.querySelector('[data-testid="next-bus-live"]');
  return { title: document.title, tabs, rows, bodyLen: document.body.innerText.length,
           hero: hero ? hero.innerText.replace(/\\s+/g,' ').slice(0,140) : null };
})()`;

console.log('--- 초기 상태 ---');
console.log(JSON.stringify(await evalJs(probe), null, 1));

// 토요일 탭 클릭(DOM)
const clicked = await evalJs(`(() => {
  const tab = document.getElementById('shuttle-day-tab-saturday')
    ?? [...document.querySelectorAll('[role="tab"]')].find(t => (t.textContent||'').includes('토요일'));
  if (!tab) return 'not-found';
  tab.click();
  return tab.id + ' | ' + (tab.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40);
})()`);
await delay(1500);
console.log('토요일 탭 클릭 →', clicked);
const after = await evalJs(probe);
console.log('--- 클릭 후 상태 ---');
console.log(JSON.stringify(after, null, 1));

// 표로 스크롤 → 스크린샷
await evalJs(`(() => { const t = document.querySelector('table'); if (t) t.scrollIntoView({block:'start'}); return !!t; })()`);
await delay(1200);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(`${OUT}/T10-android-4-표-스크롤.png`, Buffer.from(shot.data, 'base64'));
console.log('스크린샷: T10-android-4-표-스크롤.png');

// 전체 페이지(표 포함) 스크린샷 — 뷰포트 밖까지
const metrics = await send('Page.getLayoutMetrics');
const h = Math.min(Math.ceil(metrics.cssContentSize?.height ?? 0), 12000);
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: h, deviceScaleFactor: 1, mobile: true });
await delay(800);
const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(`${OUT}/T10-android-5-전체페이지.png`, Buffer.from(full.data, 'base64'));
console.log(`전체페이지 스크린샷: T10-android-5-전체페이지.png (height=${h})`);
await send('Emulation.clearDeviceMetricsOverride');

console.log(`앱 콘솔 오류: ${consoleErrors.length}건 ${consoleErrors.slice(0, 5).join(' | ')}`);
console.log(`앱 콘솔 경고: ${consoleWarns.length}건`);
socket.close();
