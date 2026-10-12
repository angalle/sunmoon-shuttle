import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * 앱 번들 설정 (docs/01-architecture.md §2 · docs/07-mobile-ux.md §16-3)
 * - vanilla TS (프레임워크 없음) · 런타임 의존성 0 → 초기 전송 ≤ 300KB gzip 목표
 * - base './' : GitHub Pages 하위 경로에서도 자산 경로가 깨지지 않게 상대 경로로 출력
 * - **SW_VERSION 자동 주입**: `public/sw.js` 의 자리표시자를 빌드 시각(+git short SHA)으로 치환한다.
 *   사람이 손으로 버전을 올리는 방식을 폐기해, **어떤 배포든 서비스워커 캐시가 자동 무효화**되게 한다.
 *   (올리지 않으면 SWR 이 옛 셸을 먼저 응답해 "코드는 고쳤는데 폰에는 옛 화면" 이 재발한다.)
 */

/** `public/sw.js` 안의 자리표시자 — 빌드가 실제 버전으로 치환한다(정확히 1개여야 한다). */
const SW_VERSION_PLACEHOLDER = '__SW_VERSION__';
const SW_FILE_NAME = 'sw.js';

/** git short SHA(7자). git 이 없거나 저장소가 아니면 `nogit`(빌드를 막지 않는다). */
function gitShortSha(): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    return out === '' ? 'nogit' : out;
  } catch {
    return 'nogit';
  }
}

/**
 * 빌드마다 **반드시 달라지는** 버전 값: `YYYYMMDD-HHmmss-mmm-<git short SHA>` (예: `20261012-143012-812-3f9c1ab`).
 * 시각을 **밀리초까지** 넣는 이유: 같은 커밋으로 연속 빌드해도(빌드가 매우 빨라 같은 초에 끝나도) 값이 달라져
 * **어떤 배포든 캐시가 무효화**되게 한다 — docs/07 §16-3 · AC-U16-4a.
 */
function buildSwVersion(now: Date = new Date()): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const date = `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}-${pad(now.getMilliseconds(), 3)}-${gitShortSha()}`;
}

/** 자리표시자를 정확히 1개 치환한다 — 0개/2개는 계약 위반이므로 조용히 넘어가지 않고 빌드를 실패시킨다. */
function renderServiceWorker(sourcePath: string, version: string): string {
  const source = readFileSync(sourcePath, 'utf8');
  const count = source.split(SW_VERSION_PLACEHOLDER).length - 1;
  if (count !== 1) {
    throw new Error(
      `public/sw.js 에 ${SW_VERSION_PLACEHOLDER} 가 ${String(count)}개 있습니다 — 정확히 1개여야 버전 자동 주입이 성립합니다.`,
    );
  }
  return source.replace(SW_VERSION_PLACEHOLDER, version);
}

/** 개발 서버·빌드·vitest 어디서 실행돼도 결정적으로 동작하는 버전 주입 플러그인. */
function serviceWorkerAutoVersion(): Plugin {
  let version = '';
  let swSourcePath = '';
  let swDistPath = '';

  return {
    name: 'sunmoon-shuttle:sw-auto-version',
    enforce: 'post',
    configResolved(config) {
      version = buildSwVersion();
      const publicDir =
        typeof config.publicDir === 'string' && config.publicDir !== ''
          ? config.publicDir
          : resolve(config.root, 'public');
      swSourcePath = resolve(publicDir, SW_FILE_NAME);
      swDistPath = resolve(config.root, config.build.outDir, SW_FILE_NAME);
      if (config.command === 'build') {
        config.logger.info(`  sw.js SW_VERSION 자동 주입: ${version}`);
      }
    },
    /** `vite dev` — public 원본을 그대로 주면 자리표시자가 나가므로, 같은 규칙으로 치환해 서빙한다. */
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (!pathname.endsWith(`/${SW_FILE_NAME}`) && pathname !== `/${SW_FILE_NAME}`) {
          next();
          return;
        }
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(renderServiceWorker(swSourcePath, version));
      });
    },
    /** 빌드 — public 복사본을 치환하고, 실제로 파일에 들어갔는지 되읽어 확인한다(자기보고 금지). */
    writeBundle() {
      writeFileSync(swDistPath, renderServiceWorker(swSourcePath, version), 'utf8');
      const written = readFileSync(swDistPath, 'utf8');
      if (!written.includes(`const SW_VERSION = '${version}';`)) {
        throw new Error(`dist/sw.js 에 버전(${version})이 주입되지 않았습니다.`);
      }
      if (written.includes(SW_VERSION_PLACEHOLDER)) {
        throw new Error('dist/sw.js 에 자리표시자가 남았습니다 — 자동 주입 실패.');
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorkerAutoVersion()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    sourcemap: false,
  },
});
