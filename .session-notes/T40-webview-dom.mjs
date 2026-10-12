#!/usr/bin/env node
/**
 * T40 — 안드로이드 앱(WebView)의 **DOM 을 직접 읽는다** (T33 `t33_webview_dom.mjs` 의 T40 판).
 * 소유: InfraProjectCreator · 계약: docs/07-mobile-ux.md §16-2 (방향 택1) · §13 (설치 안내 삭제)
 *
 * T33 과 다른 점 — 이 태스크의 수용 기준(AC-U16-6c)을 **DOM 에서 직접** 잰다.
 *   · 방향 칩: 개수(2) · 라벨(`학교 도착`/`터미널 도착`) · `aria-pressed=true` 가 **정확히 1개**
 *   · `전체` 문자열: 본문 innerText · HTML outerHTML **각각** 카운트(§16-2 로 삭제된 개념) — 0 이어야 한다
 *   · 목록 섞임: 행의 `data-direction` 을 세어 **선택 방향 외 0건**인지 본다
 *   · 설치 안내 흔적(옛 셸의 `install-hint`/`shuttle-install` 클래스·id) 0건
 *
 *   사용:  adb forward tcp:9222 localabstract:webview_devtools_remote_<앱 pid>
 *          node .session-notes/T40-webview-dom.mjs 9222
 *          node .session-notes/T40-webview-dom.mjs 9222 --nav "https://localhost/?now=2026-10-19"
 *          node .session-notes/T40-webview-dom.mjs 9222 --click-chip in     ← 칩을 실제로 눌러 놓고 측정
 *
 * 출력: 한 줄 JSON. 실패하면 exit 1 + stderr 사유.
 */
const port = process.argv[2] ?? '9222';
const argOf = (name) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : null;
};
const navUrl = argOf('--nav');
const clickChip = argOf('--click-chip');

const PROBE = `(async () => {
    const q = (s) => document.querySelector(s);
    const n = (s) => document.querySelectorAll(s).length;
    const txt = (s) => { const e = q(s); return e === null ? null : (e.textContent || '').replace(/\\s+/g, ' ').trim(); };
    const body = document.body ? document.body.innerText : '';
    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const words = ['\\uc804\\uccb4', '\\ud648 \\ud654\\uba74', '\\uc804\\uccb4\\ud654\\uba74', '\\ud55c \\ubc88\\ub9cc'];
    const count = (hay, w) => hay.split(w).length - 1;

    // 설치 안내 흔적 — 옛 셸은 data-testid="install-hint" · class="shuttle-install" 로 그렸다(T30 이전).
    const installNodes = Array.from(document.querySelectorAll('*')).filter((e) => {
        const t = e.getAttribute('data-testid') || '';
        const c = typeof e.className === 'string' ? e.className : '';
        const i = e.getAttribute('id') || '';
        return /install/i.test(t) || /install/i.test(c) || /install/i.test(i);
    });

    // 방향 칩(§16-2 택1) — T38 계약: [data-testid="direction-chip"][data-direction=in|out]
    const chips = Array.from(document.querySelectorAll('[data-testid="direction-chip"]'));
    const pressed = chips.filter((c) => c.getAttribute('aria-pressed') === 'true');

    // '전체' 잔존 판정 — ① 방향 필터 행 안 ② 텍스트가 정확히 '전체' 인 노드(칩이었다면 여기 걸린다)
    const chipRow = q('[data-testid="direction-filter"]');
    const chipRowAllCount = chipRow ? (chipRow.textContent || '').split(words[0]).length - 1 : 0;
    const exactAllNodes = Array.from(document.querySelectorAll('button,span,li,div,a')).filter((e) => (e.textContent || '').trim() === words[0]);
    // 계약 데이터의 공지 문장("... 전체 차량 모두 ...")은 화면 UI 가 아니라 데이터 텍스트이므로 따로 센다.
    const dataAllNodes = Array.from(document.querySelectorAll('*')).filter((e) => {
        const t = (e.textContent || '').trim();
        return t !== words[0] && t.includes(words[0]) && e.children.length === 0;
    });

    // 목록 행 — 각 행은 data-direction(in|out) 을 갖는다(DailyTimetable 계약).
    const rows = Array.from(document.querySelectorAll('[data-testid="timetable-row"]'));
    const byDirection = { in: 0, out: 0, none: 0, other: 0 };
    for (const r of rows) {
        const d = r.getAttribute('data-direction');
        if (d === 'in' || d === 'out') byDirection[d] += 1;
        else if (d === null) byDirection.none += 1;
        else byDirection.other += 1;
    }
    // 행에 붙는 문구로 교차 확인: 학교에서 출발(out) · 학교로 도착(in)
    const rowTextIn = rows.filter((r) => (r.textContent || '').includes('\\ud559\\uad50\\ub85c \\ub3c4\\ucc29')).length;
    const rowTextOut = rows.filter((r) => (r.textContent || '').includes('\\ud559\\uad50\\uc5d0\\uc11c \\ucd9c\\ubc1c')).length;

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
        appbar: !!q('[data-testid="appbar"]'),
        dayTabsHost: !!q('[data-testid="day-tabs"]'),
        oldUiTabbar: !!q('[data-testid="app-tabs"]'),
        clock: txt('[data-testid="app-clock"]'),
        dayType: sec ? sec.getAttribute('data-day') : null,
        isToday: sec ? sec.getAttribute('data-today') : null,
        // ── 방향 칩(§16-2) ──
        chipCount: chips.length,
        chips: chips.map((c) => ({
            direction: c.getAttribute('data-direction'),
            label: (c.querySelector('.shuttle-chip__label') || c).textContent.replace(/\\s+/g, ' ').trim(),
            text: (c.textContent || '').replace(/\\s+/g, ' ').trim(),
            pressed: c.getAttribute('aria-pressed'),
        })),
        chipPressedCount: pressed.length,
        chipPressedDirections: pressed.map((c) => c.getAttribute('data-direction')),
        chipRowText: txt('[data-testid="direction-filter"]'),
        chipRowAllCount,
        exactAllNodes: exactAllNodes.length,
        exactAllNodeSample: exactAllNodes.slice(0, 3).map((e) => e.tagName + ':' + (e.textContent || '').trim()),
        dataAllNodes: dataAllNodes.length,
        dataAllNodeSample: dataAllNodes.slice(0, 3).map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80)),
        // ── 목록(방향 택1 → 섞임 0) ──
        rowCount: rows.length,
        rowDirections: byDirection,
        rowTextIn,
        rowTextOut,
        mixedCount: byDirection.none + byDirection.other,
        rowSample: rows.slice(0, 3).map((li) => (li.textContent || '').replace(/\\s+/g, ' ').trim()),
        emptyShown: !!q('[data-testid="timetable-empty"]'),
        emptyFilterShown: !!q('[data-testid="timetable-filter-empty"]'),
        emptyText: txt('[data-testid="timetable-empty"]') ?? txt('[data-testid="timetable-filter-empty"]'),
        dayTabLabels: tabs.map((t) => (t.textContent || '').replace(/\\s+/g, ' ').trim()),
        // ── 설치 안내(§13) ──
        installNodes: installNodes.length,
        installNodeSample: installNodes.slice(0, 3).map((e) => e.tagName + '[' + (e.getAttribute('data-testid') || e.className || e.id) + ']'),
        installHintTestidCount: n('[data-testid="install-hint"]'),
        // ── 금지어(전체 포함) ──
        forbiddenCounts: Object.fromEntries(words.map((w) => [w, count(body, w)])),
        forbiddenTotal: words.reduce((a, w) => a + count(body, w), 0),
        forbiddenOuterCounts: Object.fromEntries(words.map((w) => [w, count(html, w)])),
        forbiddenOuterTotal: words.reduce((a, w) => a + count(html, w), 0),
        allWordCount: count(body, words[0]),
        allWordOuterCount: count(html, words[0]),
        innerTextLength: body.length,
        bodyText: body.slice(0, 300),
        // ── 오류·셸 ──
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
            `document.readyState + '|' + (!!document.querySelector('[data-testid="timetable-section"]') || !!document.querySelector('[data-testid="timetable-empty"]') || !!document.querySelector('[data-testid="timetable-filter-empty"]') || !!document.querySelector('[data-testid="data-error"]')) + '|' + (document.querySelector('[data-testid="splash"]') === null)`;
        for (let i = 0; i < 40; i += 1) {
            if (String(await evaluate(READY)) === 'complete|true|true') break;
            await sleep(400);
        }
        await sleep(700);
    }
    if (clickChip !== null) {
        const clicked = await evaluate(
            `(() => { const c = document.querySelector('[data-testid="direction-chip"][data-direction="${clickChip}"]'); if (!c) return false; c.click(); return true; })()`,
        );
        if (clicked !== true) throw new Error(`방향 칩을 찾지 못했다: data-direction="${clickChip}"`);
        await sleep(600);
    }
    console.log(JSON.stringify(await evaluate(PROBE)));
} catch (e) {
    console.error(`CDP 평가 실패: ${e.message}`);
    process.exit(1);
} finally {
    ws.close();
}
