/**
 * `tools/extract` 진입점(조립 지점 / composition root).
 *
 *   npm run extract                          # data/raw/*.html → 규칙 + AI 보강 → data/timetable.json
 *   npm run extract -- --no-ai               # AI 없이 규칙만(폴백)
 *   npm run extract -- --dry-run             # 발행 없이 검증만
 *   npm run extract -- --model=qwen3-vl:4b   # 로컬 Ollama 모델 교체
 *
 * 파일 IO·시계·HTTP(Ollama)만 여기서 실제 구현으로 주입한다 — 로직은 전부 `cli.ts`(순수).
 * 네트워크는 **로컬 Ollama(127.0.0.1)** 뿐이다: 원본 사이트 자동 수집은 구현하지 않는다
 * (`robots.txt` `Disallow: /Page` 차단 — `docs/01 §8`). HTTP 클라이언트는 Node 내장 `fetch`(런타임 의존성 0).
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { createDisabledStructurer, createOllamaStructurer } from './ai.js';
import { runExtract } from './cli.js';
import type { ExtractDeps } from './cli.js';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** KST(+09:00) ISO8601 — `tools/scraper/index.ts` 와 같은 형식(`source.fetchedAt` 계약) */
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

const deps: ExtractDeps = {
  listFiles: (dir) => readdirSync(dir),
  readTextFile: (path) => readFileSync(path, 'utf8'),
  writeTextFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  },
  nowIso: () => formatKstIso(new Date()),
  nowMs: () => Date.now(),
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
  createStructurer: ({ model, noAi, baseUrl, timeoutMs }) =>
    noAi
      ? createDisabledStructurer(model)
      : createOllamaStructurer({ model, baseUrl, timeoutMs, log: (line) => console.log(line) }),
};

try {
  process.exitCode = await runExtract(process.argv.slice(2), deps);
} catch (error) {
  console.error(`[extract] 예기치 못한 오류: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
