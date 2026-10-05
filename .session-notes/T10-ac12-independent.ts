/**
 * T10 총괄 독립 검증 — AC-1(행 수)·AC-2(결정성).
 * 골든 테스트(워커 산출물)와 별개로, 총괄이 직접 실행하는 재현 스크립트.
 * 실행: cd <프로젝트 홈> && ./node_modules/.bin/tsx .session-notes/T10-ac12-independent.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { findRoute, parseSnapshotFileName } from '../tools/scraper/routeMeta.js';
import { parseSnapshot } from '../tools/scraper/parse.js';
import { assembleTimetable } from '../tools/scraper/assemble.js';

const ROOT = process.cwd();
const RAW = join(ROOT, 'data', 'raw');
const files = readdirSync(RAW).filter((f) => f.endsWith('.html')).sort();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function parse(file: string, html?: string) {
  const ref = parseSnapshotFileName(file);
  return parseSnapshot(html ?? readFileSync(join(RAW, file), 'utf8'), findRoute(ref.routeId), ref.dayType);
}

console.log('스냅샷 파일 수:', files.length);
let ac2ok = true;

for (const f of files) {
  const a = parse(f);
  const b = parse(f);
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  const det = ja === jb && sha(ja) === sha(jb);
  if (!det) ac2ok = false;
  console.log(`AC-1/AC-2 ${f} | trips=${a.trips.length} | 결정성=${det ? 'OK' : 'FAIL'} | hash=${sha(ja).slice(0, 16)}`);
}

// AC-2 추가: 동적 토큰(__VIEWSTATE)만 바꿔도 결과 동일(같은 내용 → 같은 JSON)
for (const f of ['2026-2학기-asan-ktx-평일.html', '2026-2학기-cheonan-terminal-토요일.html']) {
  const html = readFileSync(join(RAW, f), 'utf8');
  const mutated = html.replace(/id="__VIEWSTATE" value="[^"]*"/, 'id="__VIEWSTATE" value="MUTATED"');
  const same = JSON.stringify(parse(f, mutated)) === JSON.stringify(parse(f));
  const bytesDiffer = sha(html) !== sha(mutated);
  if (!same) ac2ok = false;
  console.log(`AC-2 토큰변이 ${f} | HTML바이트 상이=${String(bytesDiffer)} | 파싱결과 동일=${same ? 'OK' : 'FAIL'}`);
}

// AC-2 추가: 조립 결과 바이트 동일 · 입력 순서 무관 · 내용 해시 안정
const snaps = files.map((f) => parse(f));
const r1 = JSON.stringify(assembleTimetable(snaps, { fetchedAt: '2026-10-05T12:00:00+09:00' }));
const r2 = JSON.stringify(assembleTimetable(snaps, { fetchedAt: '2026-10-05T12:00:00+09:00' }));
const r4 = JSON.stringify(assembleTimetable([...snaps].reverse(), { fetchedAt: '2026-10-05T12:00:00+09:00' }));
const h1 = assembleTimetable(snaps, { fetchedAt: '2026-10-05T12:00:00+09:00' }).source.contentHash;
const h2 = assembleTimetable(snaps, { fetchedAt: '2026-10-06T09:30:00+09:00' }).source.contentHash;
console.log('AC-2 조립 바이트동일=', r1 === r2, '| 순서무관=', r1 === r4, '| contentHash 안정(fetchedAt만 다름)=', h1 === h2, '| contentHash=', h1);
if (!(r1 === r2 && r1 === r4 && h1 === h2)) ac2ok = false;

console.log(`\n판정: AC-2(결정성) ${ac2ok ? 'OK' : 'FAIL'}`);
process.exit(ac2ok ? 0 : 1);
