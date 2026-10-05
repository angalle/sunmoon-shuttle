/**
 * T7 — PWA 매니페스트 · 아이콘 · index.html 결선 검증 (AC-7 · docs/01 §6 · docs/00 §4/S5)
 *
 * 검증하는 것
 *  ① `public/manifest.webmanifest` 파싱 성공 + 필수 필드(이름·짧은 이름 한/영, start_url, display: standalone, 색)
 *  ② 아이콘 192/512 (any + maskable) **파일 실존** + PNG 헤더 치수 일치(치수·바이트 증거)
 *  ③ 아이콘 품질을 **픽셀로** 검사: 좌우 대칭(좌표 미러 최대 채널차), maskable 안전영역(중심 40% 반경)
 *  ④ `index.html` 이 매니페스트·아이콘·viewport-fit=cover 를 실제로 연결하는지
 *  ⑤ 색 단일출처: 매니페스트 색 == tokens.css 토큰 값(라이트)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_TEXT } from '../../src/adapters/in/web/features/schedule/types/texts';
import { decodePng, isGlyphPixel, pixelAt } from './png';
import { readTokensFromDisk } from './tokens';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const TOKENS_PATH = join(ROOT, 'src/adapters/in/web/shared/ui/styles/tokens.css');

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly lang: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly theme_color: string;
  readonly background_color: string;
  readonly icons: readonly ManifestIcon[];
}

const manifestRaw = readFileSync(join(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8');
const manifest = JSON.parse(manifestRaw) as Manifest;
const tokens = readTokensFromDisk(TOKENS_PATH);
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('manifest.webmanifest — 필수 계약', () => {
  it('파싱 성공 + 표준 필드가 채워져 있다', () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.lang).toBe('ko');
  });

  it('이름·짧은 이름이 한/영 병기다(카드 지시①)', () => {
    expect(manifest.name).toContain('선문대 셔틀버스 시간표');
    expect(manifest.name).toContain('Sunmoon Shuttle Bus');
    expect(manifest.short_name).toContain('셔틀버스');
    expect(manifest.short_name).toContain('Shuttle');
  });

  it('앱 제목(코드)과 매니페스트 이름이 어긋나지 않는다(문구 정합)', () => {
    expect(manifest.name.startsWith(UI_TEXT.appTitle)).toBe(true);
  });

  it('색이 tokens.css 토큰과 일치한다(색 단일출처 — 하드코딩 금지)', () => {
    expect(manifest.theme_color).toBe(tokens.light['color-accent']);
    expect(manifest.background_color).toBe(tokens.light['color-bg']);
  });
});

describe('아이콘 — 실존·치수·품질', () => {
  it('192/512 × any/maskable 4종을 모두 선언한다', () => {
    const declared = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose ?? ''}`);
    expect(declared).toContain('192x192:any');
    expect(declared).toContain('512x512:any');
    expect(declared).toContain('192x192:maskable');
    expect(declared).toContain('512x512:maskable');
  });

  it('선언한 아이콘 파일이 실존하고 PNG 치수가 선언과 같다', () => {
    for (const icon of manifest.icons) {
      const file = join(PUBLIC_DIR, icon.src.replace(/^\.\//, ''));
      expect(existsSync(file), `${icon.src} 파일 없음`).toBe(true);
      const bytes = statSync(file).size;
      expect(bytes, `${icon.src} 크기 0`).toBeGreaterThan(0);
      const image = decodePng(readFileSync(file));
      const [declaredWidth, declaredHeight] = icon.sizes.split('x').map(Number);
      expect(`${String(image.width)}x${String(image.height)}`).toBe(icon.sizes);
      expect(declaredWidth).toBe(declaredHeight);
      // eslint 없음: 증거용 로그(테스트 출력에 치수·바이트가 남는다)
      console.log(`  [icon] ${icon.src} ${icon.sizes} ${String(bytes)}B purpose=${icon.purpose ?? ''}`);
    }
  });

  it('아이콘 그리기가 좌우 대칭이다(픽셀 미러 최대 채널차 ≤ 2)', () => {
    for (const icon of manifest.icons) {
      const image = decodePng(readFileSync(join(PUBLIC_DIR, icon.src.replace(/^\.\//, ''))));
      let worst = 0;
      let worstAt = '';
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < Math.floor(image.width / 2); x += 1) {
          const a = pixelAt(image, x, y);
          const b = pixelAt(image, image.width - 1 - x, y);
          const diff = Math.max(
            Math.abs((a[0] ?? 0) - (b[0] ?? 0)),
            Math.abs((a[1] ?? 0) - (b[1] ?? 0)),
            Math.abs((a[2] ?? 0) - (b[2] ?? 0)),
            Math.abs((a[3] ?? 0) - (b[3] ?? 0)),
          );
          if (diff > worst) {
            worst = diff;
            worstAt = `(${String(x)},${String(y)})`;
          }
        }
      }
      expect(worst, `${icon.src} 좌우 비대칭 worst=${String(worst)} at ${worstAt}`).toBeLessThanOrEqual(2);
    }
  });

  it('maskable 아이콘의 글리프가 안전영역(중심 40% 반경) 안에 있다', () => {
    for (const icon of manifest.icons.filter((entry) => entry.purpose === 'maskable')) {
      const image = decodePng(readFileSync(join(PUBLIC_DIR, icon.src.replace(/^\.\//, ''))));
      const safeRadius = image.width * 0.4;
      let maxRadius = 0;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          if (!isGlyphPixel(pixelAt(image, x, y))) continue;
          maxRadius = Math.max(
            maxRadius,
            Math.hypot(x - image.width / 2, y - image.height / 2),
          );
        }
      }
      console.log(
        `  [safe-zone] ${icon.src} 글리프 최대반경 ${maxRadius.toFixed(1)}px / 안전반경 ${safeRadius.toFixed(1)}px`,
      );
      expect(maxRadius, `${icon.src} 안전영역 초과`).toBeLessThanOrEqual(safeRadius);
    }
  });
});

describe('index.html 결선', () => {
  it('lang=ko · viewport-fit=cover · manifest/아이콘 링크가 있다', () => {
    expect(indexHtml).toContain('<html lang="ko">');
    expect(indexHtml).toContain('viewport-fit=cover');
    expect(indexHtml).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest"/);
    expect(indexHtml).toMatch(/<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png"/);
    expect(indexHtml).toMatch(/<link rel="icon" href="\.\/favicon\.svg"/);
  });

  it('테마색 메타가 있고(iOS 전체화면) 상단 상태바가 불투명이다', () => {
    expect(indexHtml).toContain('name="theme-color"');
    expect(indexHtml).toMatch(/name="apple-mobile-web-app-capable" content="yes"/);
    expect(indexHtml).toMatch(/name="apple-mobile-web-app-status-bar-style" content="default"/);
  });

  it('favicon.svg 가 실존하고 색이 토큰과 같다', () => {
    expect(existsSync(join(PUBLIC_DIR, 'favicon.svg'))).toBe(true);
    const svg = readFileSync(join(PUBLIC_DIR, 'favicon.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain(String(tokens.light['color-accent']));
    expect(existsSync(join(PUBLIC_DIR, 'apple-touch-icon.png'))).toBe(true);
  });
});
