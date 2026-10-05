/**
 * 스냅샷 파서 진입점(CLI).
 *
 *   npm run scrape -- --local data/raw/*.html        # 스냅샷 → data/timetable.json
 *   npm run scrape -- --local data/raw/*.html --now 2026-10-05T12:00:00+09:00   # 수집 시각 고정(결정성 확인)
 *
 * 이 파일은 **조립 지점(composition root)** 이다 — 파일 IO·시계를 실제 구현으로 주입하고,
 * 로직은 전부 `cli.ts`(순수) 에 있다.
 *
 * 구현하지 않는 것: **원격 fetch(자동 크롤)**. 원본 `robots.txt` 가 `Disallow: /Page`
 * (= `/Page2/…` 포함)로 차단하므로 코드에 네트워크 경로를 남기지 않는다(`docs/01 §8`).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { runScrape } from './cli.js';
import type { CliDeps } from './cli.js';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 현재 시각을 KST(+09:00) ISO8601 로 — `docs/01 §4` 의 `fetchedAt` 예시와 같은 형식 */
export function formatKstIso(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const mo = pad2(kst.getUTCMonth() + 1);
  const d = pad2(kst.getUTCDate());
  const h = pad2(kst.getUTCHours());
  const mi = pad2(kst.getUTCMinutes());
  const s = pad2(kst.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

const deps: CliDeps = {
  readTextFile: (path) => readFileSync(path, 'utf8'),
  writeTextFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  },
  nowIso: () => formatKstIso(new Date()),
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
};

process.exitCode = runScrape(process.argv.slice(2), deps);
