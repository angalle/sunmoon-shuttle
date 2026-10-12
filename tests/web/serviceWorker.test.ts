/**
 * Service Worker 계약 검사 (tests/web) — T6 ②·④.
 *
 * SW 는 브라우저에서만 돌아 실행 단위 테스트가 어렵다(그 부분은 `scripts/offline_smoke.mjs` 가 헤드리스로 실제 검증한다).
 * 여기서는 **정적으로 확인 가능한 계약**을 고정한다:
 *  ① 파일이 파싱되는 유효한 JS 이고 **버전 자리표시자**를 갖는다(빌드가 실제 값으로 치환 — 버전 무효화의 전제)
 *  ② 미리 담는 셸 자산이 **실제로 존재**한다(없는 자산을 캐시하면 설치가 깨진다)
 *  ③ 앱 셸 SWR · data 캐시 우선 · activate 에서 이전 버전 캐시 삭제 · skipWaiting/claim
 *  ④ 교차 출처(학교 원본 서버)로 요청하지 않는다 — robots.txt `/Page` 차단 준수(자동 크롤 금지)
 *  ⑤ SW 등록은 `src/` 안에서 **한 곳뿐**이고 도메인 계층에는 없다
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const SW_PATH = join(PUBLIC_DIR, 'sw.js');
const SW_SOURCE = readFileSync(SW_PATH, 'utf8');

/** `const NAME = [ ... ]` 목록에서 문자열 리터럴만 뽑는다. */
function stringList(source: string, name: string): readonly string[] {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(source)?.[1];
  if (block === undefined) return [];
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

const shellAssets = stringList(SW_SOURCE, 'SHELL_ASSETS');

describe('public/sw.js — 정적 계약', () => {
  it('파일이 존재하고 JS 로 파싱된다', () => {
    expect(existsSync(SW_PATH)).toBe(true);
    expect(() => new Function(SW_SOURCE)).not.toThrow();
  });

  it('버전 상수는 **빌드가 치환하는 자리표시자**다 — 손으로 올리는 상수 금지(docs/07 §16-3)', () => {
    const version = /const SW_VERSION = '([^']+)'/.exec(SW_SOURCE)?.[1] ?? '';
    expect(version).toBe('__SW_VERSION__');
    // 치환 지점은 정확히 1개 — vite 플러그인이 이 계약을 강제한다(0개/2개면 빌드 실패)
    expect(SW_SOURCE.split('__SW_VERSION__').length - 1).toBe(1);
    // 주입 주체(빌드 설정)가 저장소에 있어야 한다 — 없으면 값이 영원히 자리표시자로 배포된다
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).toContain('__SW_VERSION__');
  });

  it('빌드 산출물(dist/sw.js)에는 실제 버전이 주입돼 있다(빌드 전이면 건너뛴다)', () => {
    const distPath = join(ROOT, 'dist', 'sw.js');
    if (!existsSync(distPath)) return;
    const version = /const SW_VERSION = '([^']+)'/.exec(readFileSync(distPath, 'utf8'))?.[1] ?? '';
    expect(version).not.toBe('');
    expect(version).not.toBe('__SW_VERSION__');
    expect(version).toMatch(/^\d{8}-\d{6}-\d{3}(-[0-9a-f]{7,40}|-nogit)$/);
  });

  it('앱 셸은 stale-while-revalidate, data/timetable.json 은 캐시 우선이다', () => {
    expect(SW_SOURCE).toContain('staleWhileRevalidate');
    expect(SW_SOURCE).toContain("${SCOPE_PATH}data/timetable.json");
    expect(SW_SOURCE).toMatch(/DATA_PATH \? DATA_CACHE : SHELL_CACHE/);
    // 캐시 우선: 캐시에 있으면 즉시 반환하고 갱신은 waitUntil(백그라운드)로 넘긴다
    expect(SW_SOURCE).toMatch(/if \(cached !== undefined\) \{\s*event\.waitUntil\(revalidate/);
  });

  it('활성화 시 이전 버전 캐시를 지우고 즉시 제어를 가져온다(배포 직후 이전 버전 방지)', () => {
    expect(SW_SOURCE).toContain('caches.delete');
    expect(SW_SOURCE).toContain('key.endsWith(SW_VERSION)');
    expect(SW_SOURCE).toContain('self.skipWaiting()');
    expect(SW_SOURCE).toContain('self.clients.claim()');
  });

  it('미리 담는 셸 자산이 모두 실제로 있다(없는 자산을 캐시하지 않는다)', () => {
    expect(shellAssets.length).toBeGreaterThan(0);
    const missing = shellAssets.filter((asset) => {
      if (asset === './' || asset === './index.html') return !existsSync(join(ROOT, 'index.html'));
      return !existsSync(join(PUBLIC_DIR, asset.replace(/^\.\//, '')));
    });
    expect(missing, `셸 자산 없음: ${missing.join(', ')}`).toEqual([]);
  });

  it('교차 출처 요청은 건드리지 않는다(학교 원본 서버로 자동 요청 금지 · robots.txt 준수)', () => {
    expect(SW_SOURCE).toContain('url.origin !== self.location.origin');
    expect(SW_SOURCE).not.toContain('lily.sunmoon.ac.kr');
    // 상대경로 해석은 등록 scope 기준 — 하위 경로 배포에도 그대로 동작한다
    expect(SW_SOURCE).toContain('new URL(self.registration.scope).pathname');
  });
});

describe('SW 등록 경로 — 앱 엔트리 한 곳뿐 (T6 ④)', () => {
  const registrationSources = [
    join(ROOT, 'src/adapters/in/web/app/serviceWorker.ts'),
    join(ROOT, 'src/main.ts'),
    join(ROOT, 'src/adapters/in/web/app/mount.ts'),
  ].filter((path) => existsSync(path));

  it('serviceWorker.register 호출이 src/ 전체에서 정확히 1건', () => {
    const pattern = /serviceWorker\s*\.\s*register\s*\(/;
    const hits = registrationSources.filter((path) => pattern.test(readFileSync(path, 'utf8')));
    // 경로 표기 흔들림(대소문자·심볼릭) 을 피하려고 src/ 이하만 비교한다.
    expect(hits.map((path) => path.replace(/^.*\/(src\/)/, '$1'))).toEqual(['src/adapters/in/web/app/serviceWorker.ts']);
  });

  it('mount(조립 지점)가 그 등록 함수를 부른다', () => {
    const mount = readFileSync(join(ROOT, 'src/adapters/in/web/app/mount.ts'), 'utf8');
    expect(mount).toContain('registerServiceWorker(');
  });

  it('도메인 계층에는 브라우저/저장소 API 가 없다(경계 검사와 같은 취지)', () => {
    const domain = readFileSync(join(ROOT, 'src/domain/rules/dayType.ts'), 'utf8');
    expect(domain).not.toContain('serviceWorker');
    expect(domain).not.toContain('indexedDB');
  });
});

describe('앱 코드는 원본 서버로 요청하지 않는다(표시용 링크만)', () => {
  it('src/ 안에 절대 URL fetch 호출이 없다', () => {
    const files = [
      'src/adapters/in/web/features/schedule/api/timetableApi.ts',
      'src/adapters/in/web/features/schedule/api/uiPrefsApi.ts',
      'src/adapters/in/web/shared/lib/storage.ts',
      'src/adapters/in/web/app/mount.ts',
    ].filter((relative) => existsSync(join(ROOT, relative)));
    const offenders = files.filter((relative) =>
      /fetch\(\s*['"`]https?:/.test(readFileSync(join(ROOT, relative), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
