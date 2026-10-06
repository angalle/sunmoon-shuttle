/**
 * `tools/extract` 진입점(조립 지점 / composition root).
 *
 *   npm run extract                                   # data/raw/*.html → 규칙 + AI 보강(--ai=api) → data/timetable.json
 *   npm run extract -- --ai=api                       # 외부 OpenAI 호환 API(AI_BASE_URL·AI_MODEL·AI_API_KEY)
 *   npm run extract -- --ai=ollama                    # 로컬 Ollama(대안 경로)
 *   npm run extract -- --ai=off                       # AI 없이 규칙만(--no-ai 와 동일)
 *   npm run extract -- --dry-run                      # 발행 없이 검증만
 *   npm run extract -- --model=<이름>                  # 모델명 교체(api 는 AI_MODEL 보다 우선)
 *
 * 파일 IO·시계·환경변수·HTTP 만 여기서 실제 구현으로 주입한다 — 로직은 전부 `cli.ts`(순수).
 * 외부로 나가는 네트워크는 **AI 엔드포인트 하나**다: `AI_BASE_URL`(OpenAI 호환) 또는 로컬
 * Ollama(127.0.0.1). 원본 사이트 자동 수집은 구현하지 않는다(`robots.txt` `Disallow: /Page` —
 * `docs/01 §8`). HTTP 클라이언트는 Node 내장 `fetch`(런타임 의존성 0).
 *
 * 시크릿: `AI_API_KEY` 는 **환경에서만** 읽고 로그·산출물에 절대 쓰지 않는다(존재 여부도 값 없이 판단).
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { runExtract } from './cli.js';
import type { ExtractDeps } from './cli.js';
import { createStructurerFor } from './structurer.js';
import type { StructurerEnv } from './structurer.js';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 환경변수 읽기 — 공백 제거, 미설정은 빈 문자열(값은 로그에 남기지 않는다) */
export function readEnv(name: string): string {
  const raw = process.env[name];
  return raw === undefined ? '' : raw.trim();
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
  createStructurer: ({ model, noAi, provider }) => {
    const env: StructurerEnv = {
      AI_BASE_URL: readEnv('AI_BASE_URL'),
      AI_MODEL: readEnv('AI_MODEL'),
      AI_API_KEY: readEnv('AI_API_KEY'),
    };
    return createStructurerFor(noAi ? 'off' : provider, {
      model,
      env,
      log: (line) => {
        console.log(line);
      },
    });
  },
};

try {
  process.exitCode = await runExtract(process.argv.slice(2), deps);
} catch (error) {
  console.error(`[extract] 예기치 못한 오류: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
