#!/usr/bin/env node
/**
 * T33 — 안드로이드 앱(WebView)의 **DOM 을 직접 읽는다**. 화면 캡처만으로는 "설치 안내 0건"을
 * 증명할 수 없어서, Capacitor debug APK 의 WebView 원격 디버깅 소켓(CDP)에 붙어 DOM 을 평가한다.
 *
 *   사용:  adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *          node scripts/t33_webview_dom.mjs 9222
 *          node scripts/t33_webview_dom.mjs 9222 --nav "https://localhost/?now=2026-10-19"
 *              ↑ 먼저 그 URL 로 이동한 뒤 측정한다. 오늘이 휴일이라 목록이 빈 날에도 **운행일** 시간표가
 *                실제로 렌더되는지 보려면 날짜를 주입해야 한다(앱의 `?now=` 계약 — SchedulePage·T32 실측).
 *
 * 셀렉터 주의: 현재 셸(T27+)은 `timetable-section`·`timetable-row`·`day-tabs` 를 쓰고,
 *   옛 셸(T25 빌드)은 `app-tabs`·`departure-row`·`install-hint` 를 쓴다. 둘 다 읽어 어느 셸인지 판별한다.
 *
 * 출력: 한 줄 JSON. 실패하면 exit 1 + stderr 사유.
 */
const port = process.argv[2] ?? '9222';
const navIdx = process.argv.indexOf('--nav');
const navUrl = navIdx > -1 ? process.argv[navIdx + 1] : null;

const PROBE = `(async () => {
    const q = (s) => document.querySelector(s);
    const n = (s) => document.querySelectorAll(s).length;
    const txt = (s) => { const e = q(s); return e === null ? null : (e.textContent || '').replace(/\\s+/g, ' ').trim(); };
    const body = document.body ? document.body.innerText : '';
    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const words = ['\\ud648 \\ud654\\uba74', '\\uc804\\uccb4\\ud654\\uba74', '\\ud55c \\ubc88\\ub9cc'];
    const count = (hay, w) => hay.split(w).length - 1;
    // "설치 안내" 흔적 — 옛 셸은 data-testid="install-hint" · class="shuttle-install" 로 그렸다.
    const installNodes = Array.from(document.querySelectorAll('*')).filter((e) => {
        const t = e.getAttribute('data-testid') || '';
        const c = typeof e.className === 'string' ? e.className : '';
        const i = e.getAttribute('id') || '';
        return /install/i.test(t) || /install/i.test(c) || /install/i.test(i);
    });
    const tabs = Array.from(document.querySelectorAll('[data-testid="day-tabs"] [role="tab"]'));
    let cacheKeys = [];
    try { cacheKeys = (await caches.keys()).slice().sort(); } catch (e) { cacheKeys = ['<caches 실패: ' + e.message + '>']; }
    let swReg = [];
    try {
        const rs = await navigator.serviceWorker.getRegistrations();
        swReg = rs.map((r) => (r.active ? r.active.scriptURL : '') + '#' + (r.active ? r.active.state : 'none'));
    } catch (e) { swReg = ['<sw 조회 실패: ' + e.message + '>']; }
    const sec = q('[data-testid="timetable-section"]');
    return {
        href: location.href,
        readyState: document.readyState,
        title: document.title,
        bundleSrcs: Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')),
        testids: Array.from(new Set(Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')))).sort(),
        appbar: !!q('[data-testid="appbar"]'),
        dayTabsHost: !!q('[data-testid="day-tabs"]'),
        oldUiTabbar: !!q('[data-testid="app-tabs"]'),
        splashVisible: !!q('[data-testid="splash"]'),
        clock: txt('[data-testid="app-clock"]'),
        sourceLine: txt('[data-testid="source-line"]'),
        dayType: sec ? sec.getAttribute('data-day') : null,
        isToday: sec ? sec.getAttribute('data-today') : null,
        rowCount: n('[data-testid="timetable-row"]'),
        emptyShown: !!q('[data-testid="timetable-empty"]'),
        emptyText: txt('[data-testid="timetable-empty"]'),
        rowSample: Array.from(document.querySelectorAll('[data-testid="timetable-row"]')).slice(0, 3).map((li) => (li.textContent || '').replace(/\\s+/g, ' ').trim()),
        dayTabLabels: tabs.map((t) => (t.textContent || '').replace(/\\s+/g, ' ').trim()),
        oldUiRows: n('[data-testid="departure-row"]') + n('[data-testid="full-row"]'),
        installNodes: installNodes.length,
        installNodeSample: installNodes.slice(0, 3).map((e) => e.tagName + '[' + (e.getAttribute('data-testid') || e.className || e.id) + ']'),
        installHintTestidCount: n('[data-testid="install-hint"]'),
        forbiddenCounts: Object.fromEntries(words.map((w) => [w, count(body, w)])),
        forbiddenTotal: words.reduce((a, w) => a + count(body, w), 0),
        forbiddenOuterTotal: words.reduce((a, w) => a + count(html, w), 0),
        innerTextLength: body.length,
        bodyText: body.slice(0, 300),
        dataError: txt('[data-testid="data-error"]'),
        offlineNotice: txt('[data-testid="offline-notice"]'),
        blockNotice: txt('[data-testid="day-notice"]'),
        swController: !!navigator.serviceWorker && !!navigator.serviceWorker.controller,
        cacheKeys,
        swReg,
    };
})()`;

let targets;
try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
    targets = await res.json();
} catch (e) {
    console.error(`CDP 실패: http://127.0.0.1:${port}/json/list 를 읽지 못했다 — ${e.message}`);
    console.error('확인: adb forward tcp:' + port + ' localabstract:webview_devtools_remote_<앱 pid> · debug APK(webContentsDebugging)');
    process.exit(1);
}
const pages = (Array.isArray(targets) ? targets : []).filter((t) => typeof t?.webSocketDebuggerUrl === 'string');
const page = pages.find((t) => /^(https?|file):/.test(t.url ?? '')) ?? pages[0];
if (!page) {
    console.error(`CDP 실패: 페이지 타깃이 없다. 받은 타깃: ${JSON.stringify((targets ?? []).map((t) => [t.type, t.url]))}`);
    process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('CDP WebSocket 접속 시간 초과')), 5000);
    ws.addEventListener('open', () => { clearTimeout(t); ok(); }, { once: true });
    ws.addEventListener('error', (e) => { clearTimeout(t); no(new Error('CDP WebSocket 오류: ' + (e.message ?? 'unknown'))); }, { once: true });
});

let seq = 0;
const send = (method, params) =>
    new Promise((resolve, reject) => {
        const id = ++seq;
        const t = setTimeout(() => reject(new Error(`${method} 응답 시간 초과`)), 20000);
        const onMsg = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id !== id) return;
            clearTimeout(t);
            ws.removeEventListener('message', onMsg);
            m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
    });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('평가 예외: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
};

try {
    if (navUrl !== null) {
        await send('Page.enable');
        await send('Page.navigate', { url: navUrl });
        const READY =
            `document.readyState + '|' + (!!document.querySelector('[data-testid="timetable-section"]') || !!document.querySelector('[data-testid="timetable-empty"]') || !!document.querySelector('[data-testid="data-error"]')) + '|' + (document.querySelector('[data-testid="splash"]') === null)`;
        for (let i = 0; i < 40; i += 1) {
            if (String(await evaluate(READY)) === 'complete|true|true') break;
            await sleep(400);
        }
        await sleep(700);
    }
    console.log(JSON.stringify(await evaluate(PROBE)));
} catch (e) {
    console.error(`CDP 평가 실패: ${e.message}`);
    process.exit(1);
} finally {
    ws.close();
}
