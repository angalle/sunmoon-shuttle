#!/usr/bin/env node
/**
 * T33 — Android 자산 재동기화:  dist/  →  android/app/src/main/assets/public/
 * 소유: InfraProjectCreator · 계약: docs/07-mobile-ux.md §14-2 ("수동 복사 금지 — 스크립트로")
 *
 *   node scripts/sync-android-assets.mjs            # 실제 복사
 *   node scripts/sync-android-assets.mjs --check     # 복사 없이 현재 상태만 검사(드리프트 탐지)
 *
 * 왜 필요한가 (실측된 사고, §14-1)
 *   웹 빌드를 바꿔도 android/app/src/main/assets/public/ 은 **자동으로 갱신되지 않는다**
 *   (Capacitor 의 copy 는 `cap copy|sync` 를 명시적으로 돌릴 때만 일어난다).
 *   T25 빌드에서 멈춘 자산이 그대로 남아 **Android 앱이 삭제된 설치 안내 카드(T30/T31)를 계속**
 *   보여 줬고, 옛 해시 번들(`assets/index-qWPrV94-.js`)이 새 번들과 함께 앱에 들어갔다.
 *
 * 이 스크립트가 Capacitor 와 다른 점 하나
 *   `cap copy/sync android` 는 대상을 `remove` 후 통째로 복사하므로 옛 번들이 남지 않는다(소스 확인:
 *   @capacitor/cli/dist/tasks/copy.js `copyWebDir` → `fs.remove(nativeAbsDir)` + `fs.copy`).
 *   대신 그 뒤 Capacitor 가 웹 디렉터리에 **빈 자리표시자**(`cordova.js`·`cordova_plugins.js`)를 쓴다.
 *   이 스크립트는 (1) 같은 remove+copy 를 직접 수행하고 — 그래서 **무엇이 지워지는지 로그에 남는다** —
 *   (2) 지우기 직전 대상에만 있던 파일 중 **해시 번들 모양(`-<hash>.js|.css`)이 아닌 것**만 보존하며,
 *   해시 번들 모양이면 **낡은 웹 자산으로 판정해 버린다**(그게 이 스크립트의 존재 이유다).
 *
 * 멱등성
 *   파일 목록·내용의 sha256 manifest 를 복사 **전/후**로 만들어 CHANGED 를 보고한다.
 *   2회차 실행이면 CHANGED=0 이어야 한다(수용 기준 AC-U14-3b).
 *
 * 종료 코드: 0 성공 · 1 검사 실패(드리프트·낡은 번들·금지어·자산 누락) · 2 사용법 오류
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = join(ROOT, 'dist');
const DEST = join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');

/** 금지어 — docs/07-mobile-ux.md §14-3 AC-U14-3 (삭제된 설치 안내 문구) */
const FORBIDDEN = ['홈 화면', '전체화면', '한 번만'];
/** 낡은 웹 자산(해시 번들) 판정: index-403hrULs.js · index-BX2z0Mh1.css · xxx-<hash>.map */
const HASHED_BUNDLE = /-[A-Za-z0-9_-]{8,}\.(js|css|map)$/;
/** Capacitor 가 웹 디렉터리에 쓰는 자리표시자(우리 dist 에는 없는 파일) */
const CAP_PLACEHOLDERS = ['cordova.js', 'cordova_plugins.js'];

const checkOnly = process.argv.includes('--check');
const argv = process.argv.slice(2).filter((a) => a !== '--check');
if (argv.length > 0) {
    console.error(`usage: node scripts/sync-android-assets.mjs [--check]   (알 수 없는 인자: ${argv.join(' ')})`);
    process.exit(2);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const kb = (n) => (n / 1024).toFixed(1).padEnd(9);

/** 디렉터리 아래 모든 파일의 상대경로(정렬). 없으면 빈 배열. */
function walk(absDir) {
    if (!existsSync(absDir)) return [];
    const out = [];
    const rec = (dir) => {
        for (const name of readdirSync(dir).sort()) {
            if (name === '.DS_Store') continue;
            const p = join(dir, name);
            const st = statSync(p);
            if (st.isDirectory()) rec(p);
            else out.push(relative(absDir, p).split(sep).join('/'));
        }
    };
    rec(absDir);
    return out;
}

/** { relpath: sha256 } + 목록 전체의 manifest sha256 */
function manifest(absDir) {
    const map = new Map();
    for (const r of walk(absDir)) map.set(r, sha256(readFileSync(join(absDir, r))));
    const lines = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([r, h]) => `${h}  ${r}`);
    return { map, digest: sha256(lines.join('\n') + '\n'), lines };
}

function diff(before, after) {
    const added = [...after.keys()].filter((k) => !before.has(k));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    const modified = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));
    return { added, removed, modified, total: added.length + removed.length + modified.length };
}

// ── 0) 사전조건: dist 가 "앱에 넣을 수 있는" 상태인가 ────────────────────────────
const problems = [];
if (!existsSync(SRC)) problems.push(`dist/ 가 없다 — 먼저 \`npm run build\` (${rel(SRC)})`);
else {
    if (!existsSync(join(SRC, 'index.html'))) problems.push('dist/index.html 이 없다');
    const bundles = walk(join(SRC, 'assets')).filter((f) => /\.js$/.test(f));
    if (bundles.length === 0) problems.push('dist/assets/*.js 가 없다(번들 누락)');
    if (bundles.length > 1) problems.push(`dist/assets 에 js 번들이 ${bundles.length}개 — 옛 번들이 dist 에 남아 있다: ${bundles.join(', ')}`);
    if (!existsSync(join(SRC, 'sw.js'))) problems.push('dist/sw.js 가 없다(오프라인 셸 누락)');
    // 이 단계를 빼면 앱이 "./data/timetable.json: HTTP 404" 오류 화면을 띄운다(build-release.sh 와 같은 이유).
    if (!existsSync(join(SRC, 'data', 'timetable.json'))) problems.push('dist/data/timetable.json 이 없다 — 앱이 오류 화면(F8)을 띄운다');
}

const srcManifest = existsSync(SRC) ? manifest(SRC) : { map: new Map(), digest: '', lines: [] };
const srcFiles = [...srcManifest.map.keys()];
console.log(`[preflight] dist  파일 ${srcFiles.length}개 · manifest ${srcManifest.map.size ? srcManifest.digest.slice(0, 16) : '-'}`);
for (const f of srcFiles.filter((f) => /^(index\.html|sw\.js|manifest\.webmanifest)$/.test(f) || /^assets\//.test(f) || /^data\//.test(f))) {
    console.log(`            ${kb(statSync(join(SRC, f)).size)} ${f}`);
}
if (problems.length > 0) {
    for (const p of problems) console.error(`[preflight] FAIL  ${p}`);
    process.exit(1);
}

// ── 1) 대상의 현재 상태: 무엇이 dist 에 없고, 그게 낡은 번들인가 ──────────────────
const destBefore = manifest(DEST);
const carried = [];
const stale = [];
for (const r of destBefore.map.keys()) {
    if (srcFiles.includes(r)) continue;
    if (HASHED_BUNDLE.test(r)) stale.push(r);
    else carried.push(r);
}

console.log(`\n[status] 대상 ${rel(DEST)}  기존 파일 ${destBefore.map.size}개`);
console.log(`[status] dist 에 없는 파일 ${stale.length + carried.length}개`);
for (const r of stale) console.log(`         STALE-BUNDLE  ${kb(statSync(join(DEST, r)).size)} ${r}   ← 낡은 웹 자산(버린다)`);
for (const r of carried) console.log(`         KEEP          ${kb(statSync(join(DEST, r)).size)} ${r}   ← Capacitor 자리표시자(보존)`);

if (checkOnly) {
    // dist 가 관리하는 파일만 비교한다 — Capacitor 자리표시자(cordova.js 등)는 dist 에 없는 게 정상이다.
    const destManaged = new Map([...destBefore.map].filter(([r]) => srcFiles.includes(r)));
    const drift = diff(destManaged, srcManifest.map);
    console.log(`\n[check] 드리프트(dist 관리 파일): 추가 ${drift.added.length} · 삭제 ${drift.removed.length} · 변경 ${drift.modified.length} · 낡은 번들 ${stale.length}`);
    for (const r of [...drift.removed, ...drift.added, ...drift.modified].slice(0, 40)) console.log(`         ${r}`);
    console.log(`[check] 대상 manifest ${destBefore.digest.slice(0, 16)} · dist manifest ${srcManifest.digest.slice(0, 16)}`);
    console.log(`\nSYNC-CHECK ${drift.total === 0 && stale.length === 0 ? 'IN-SYNC' : 'OUT-OF-SYNC'}`);
    process.exit(drift.total === 0 && stale.length === 0 ? 0 : 1);
}

// ── 2) 복사: 대상을 지우고 dist 를 통째로 넣는다 (Capacitor copyWebDir 와 같은 의미) ──
const carryBytes = new Map(carried.map((r) => [r, readFileSync(join(DEST, r))]));
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
for (const [r, buf] of carryBytes) {
    const p = join(DEST, r);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
}

// ── 3) 검증: 대상 = dist ∪ 보존목록, 그리고 금지어 0 ────────────────────────────
const destAfter = manifest(DEST);
const changed = diff(destBefore.map, destAfter.map);
const unexpected = [...destAfter.map.keys()].filter((r) => !srcFiles.includes(r) && !carried.includes(r));
const leftoverBundles = [...destAfter.map.keys()].filter((r) => HASHED_BUNDLE.test(r) && !srcFiles.includes(r));

const sw = existsSync(join(DEST, 'sw.js')) ? /SW_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(DEST, 'sw.js'), 'utf8')) : null;
const forbiddenHits = [];
for (const r of destAfter.map.keys()) {
    if (!/\.(html|js|css|json|webmanifest|txt|svg)$/.test(r)) continue;
    const text = readFileSync(join(DEST, r), 'utf8');
    for (const w of FORBIDDEN) {
        const n = text.split(w).length - 1;
        if (n > 0) forbiddenHits.push(`${r}: ${w} × ${n}`);
    }
}

console.log(`\n[copy] dist → ${rel(DEST)}`);
console.log(`       파일 ${destAfter.map.size}개 (dist ${srcFiles.length} + 보존 ${carried.length})  manifest ${destAfter.digest.slice(0, 16)}`);
console.log(`[copy] 변경: 추가 ${changed.added.length} · 삭제 ${changed.removed.length} · 내용변경 ${changed.modified.length}  → CHANGED=${changed.total}`);
for (const r of changed.removed.slice(0, 20)) console.log(`       - ${r}`);
for (const r of changed.added.slice(0, 20)) console.log(`       + ${r}`);
for (const r of changed.modified.slice(0, 20)) console.log(`       ~ ${r}`);
console.log(`[copy] SW_VERSION(대상 sw.js) = ${sw ? sw[1] : '<없음>'}`);
console.log(`[copy] 금지어 검사(${FORBIDDEN.join(' · ')}): ${forbiddenHits.length}건`);
for (const h of forbiddenHits) console.log(`       HIT  ${h}`);

let fail = 0;
for (const r of unexpected) { console.error(`[verify] FAIL  dist 에도 보존목록에도 없는 파일: ${r}`); fail = 1; }
for (const r of leftoverBundles) { console.error(`[verify] FAIL  낡은 해시 번들이 남았다: ${r}`); fail = 1; }
for (const h of forbiddenHits) { console.error(`[verify] FAIL  금지어 남음: ${h}`); fail = 1; }
if (carried.some((r) => !CAP_PLACEHOLDERS.includes(r))) {
    console.warn(`[verify] 주의  보존한 파일 중 Capacitor 자리표시자가 아닌 것: ${carried.filter((r) => !CAP_PLACEHOLDERS.includes(r)).join(', ')}`);
}

console.log(`\nMANIFEST ${destAfter.digest}`);
console.log(`SYNC-ANDROID-ASSETS ${fail === 0 ? 'PASS' : 'FAIL'}`);
process.exit(fail);
