#!/usr/bin/env node
/**
 * T25 — 안드로이드 네이티브 리소스 생성기 (스플래시 · 적응형 아이콘 · 색)
 *
 * 왜 스크립트인가
 * - 카드 지시: "스플래시 로고와 [웹] 앱 아이콘은 **동일 소스**, 별도 제작 금지".
 *   그래서 이 스크립트는 웹 아이콘 생성기 `scripts/generate_icons.mjs` 의
 *   **도형·래스터라이저·PNG 인코더를 그대로 import** 해서 안드로이드 리소스를 만든다.
 *   아이콘을 두 번 그리지 않는다(중복 구현 금지).
 * - 색도 하드코딩하지 않는다: `tokens.css` 의 `--color-accent` / `--color-on-accent` / `--color-bg`
 *   (라이트·다크)를 읽어 XML 에 넣는다. 웹·PWA 아이콘·안드로이드 아이콘이 같은 토큰을 쓴다.
 * - 멱등: 같은 입력 → 같은 바이트. (재실행 후 `git status` 가 조용하면 정상)
 *
 * 산출물 (android/app/src/main/res/)
 *   drawable/splash.xml                        ← 실행 테마(@drawable/splash) 배경: 흰 배경 + 중앙 로고
 *   drawable-<dpi>/splash_logo.png             ← 스플래시 로고 = 웹 아이콘과 **같은 그림**(96dp)
 *   mipmap-<dpi>/ic_launcher.png               ← 레거시(API<26) 런처 아이콘 = 둥근 사각 타일
 *   mipmap-<dpi>/ic_launcher_round.png         ← 레거시 원형 런처 아이콘 = 원 타일
 *   mipmap-<dpi>/ic_launcher_foreground.png    ← 적응형 아이콘 전경(투명 배경 · 108dp 안 66dp 안전영역)
 *   values/ic_launcher_background.xml          ← 적응형 아이콘 배경색(= --color-accent)
 *   values/colors.xml · values-night/colors.xml        ← 스플래시·상태바 배경(라이트 #ffffff / 다크)
 *   values/bools.xml · values-night/bools.xml          ← 상태바 아이콘 밝기(라이트=어두운 아이콘)
 *
 * 지우는 것(대체된 것들 — 남겨두면 두 구현이 갈라진다)
 *   drawable/splash.png · drawable-(land|port)-<dpi>/splash.png   (Capacitor 기본 청록 스플래시)
 *   drawable/ic_launcher_background.xml                        (안 쓰이는 기본 배경 벡터 — 적응형 배경은 @color 를 쓴다)
 *   drawable-v24/ic_launcher_foreground.xml                    (안 쓰이는 기본 전경 벡터 — 참조는 @mipmap/ 이다)
 *
 * 사용: node scripts/generate_android_res.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  ROOT,
  TOKENS,
  SS,
  busGlyph,
  roadGlyph,
  inShape,
  encodePng,
  parseHex,
  readToken,
  renderIcon,
} from './generate_icons.mjs';

const RES = join(ROOT, 'android/app/src/main/res');

// ───────────────────────── 토큰 읽기 ─────────────────────────

/** `--name: 96px;` 같은 px 토큰을 읽는다(스플래시 로고 크기의 단일출처). */
function readPxToken(name) {
  const css = readFileSync(TOKENS, 'utf8');
  const match = new RegExp(`--${name}:\\s*(\\d+)px\\s*;`).exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error(`tokens.css 에서 --${name} 을 찾지 못했습니다.`);
  }
  return Number(match[1]);
}

/** `@media (prefers-color-scheme: dark)` 블록의 색 토큰(없으면 throw). */
function readDarkToken(name) {
  const css = readFileSync(TOKENS, 'utf8');
  const darkIndex = css.indexOf('prefers-color-scheme: dark');
  if (darkIndex < 0) throw new Error('tokens.css 에 다크 모드 블록이 없습니다.');
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css.slice(darkIndex));
  if (match === null || match[1] === undefined) {
    throw new Error(`tokens.css 다크 블록에서 --${name} 을 찾지 못했습니다.`);
  }
  return match[1];
}

// ───────────────────────── 래스터라이저 (글리프 단독 · 원형 타일) ─────────────────────────

/**
 * 캔버스 한 장을 RGBA 로 그린다.
 * - `background` : 캔버스 전체 배경 `[r,g,b,a]` — `a=0` 이면 투명(샘플을 건너뛴다 → 색 번짐 없음).
 * - `toneColors` : 도형 `tone`('fg'|'bg') → `[r,g,b]`. `busGlyph()` 의 'bg' 는 "차체를 파내는" 색이라
 *                  적응형 아이콘에서는 배경 레이어 색과 같게 칠한다(투명 배경 위에 얹으면 같은 그림).
 * - 좌표 규칙은 `generate_icons.mjs` 의 `renderIcon` 과 동일(단위공간 0..1 · 픽셀당 SS×SS 슈퍼샘플링).
 */
function raster(size, { background, glyphScale, toneColors }) {
  const glyph = [...busGlyph(), ...roadGlyph()];
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          const gx = (u - 0.5) / glyphScale + 0.5;
          const gy = (v - 0.5) / glyphScale + 0.5;
          let color = null;
          if (gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1) {
            for (const shape of glyph) {
              if (inShape(shape, gx, gy)) color = toneColors[shape.tone];
            }
          }
          if (color === null) {
            if (background[3] === 0) continue; // 투명 — 샘플을 더하지 않는다(프리멀티플라이 평균)
            color = background;
          }
          rSum += color[0];
          gSum += color[1];
          bSum += color[2];
          aSum += 255;
        }
      }
      const n = SS * SS;
      const offset = (py * size + px) * 4;
      out[offset] = Math.round(rSum / n);
      out[offset + 1] = Math.round(gSum / n);
      out[offset + 2] = Math.round(bSum / n);
      out[offset + 3] = Math.round(aSum / n);
    }
  }
  return out;
}

// ───────────────────────── 파일 쓰기 (치수·해시 자기검증) ─────────────────────────

const written = [];
const removed = [];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** PNG 를 쓰고 IHDR 치수를 되읽어 증명한다(아이콘 생성기와 같은 규율). */
function writePng(file, size, rgba, label) {
  mkdirSync(join(file, '..'), { recursive: true });
  const png = encodePng(size, rgba);
  writeFileSync(file, png);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== size || height !== size) {
    throw new Error(`${file}: IHDR 치수 불일치 ${width}x${height} (기대 ${size}x${size})`);
  }
  written.push({ file, bytes: png.length, sha256: sha256(png) });
  console.log(`  ${file.slice(ROOT.length)} — ${size}x${size}, ${png.length} bytes, sha256 ${sha256(png).slice(0, 12)}…  (${label})`);
}

function writeText(file, text, label) {
  mkdirSync(join(file, '..'), { recursive: true });
  const body = Buffer.from(text, 'utf8');
  const current = existsSync(file) ? readFileSync(file) : null;
  writeFileSync(file, body);
  const status = current !== null && current.equals(body) ? 'unchanged' : 'written';
  written.push({ file, bytes: body.length, sha256: sha256(body), status });
  console.log(`  ${file.slice(ROOT.length)} — ${body.length} bytes (${status}, ${label})`);
}

function removeFile(file) {
  if (!existsSync(file)) return;
  rmSync(file);
  removed.push(file);
  console.log(`  - ${file.slice(ROOT.length)} (삭제)`);
}

// ───────────────────────── 메인 ─────────────────────────

function main() {
  const accentHex = readToken('color-accent');
  const onAccentHex = readToken('color-on-accent');
  const lightBgHex = readToken('color-bg');
  const darkBgHex = readDarkToken('color-bg');
  const logoDp = readPxToken('splash-logo-size');

  const accent = parseHex(accentHex);
  const onAccent = parseHex(onAccentHex);
  const accentLuma = 0.299 * accent[0] + 0.587 * accent[1] + 0.114 * accent[2];

  console.log('T25 안드로이드 네이티브 리소스 생성');
  console.log(
    `  토큰 단일출처: accent=${accentHex} onAccent=${onAccentHex} bg(light)=${lightBgHex} bg(dark)=${darkBgHex} splashLogo=${logoDp}dp`,
  );

  // ── 0) 같은 소스 증명: 웹 아이콘을 이 프리미티브로 다시 그려 바이트 동일 확인 ──────────
  const webIcon = readFileSync(join(ROOT, 'public/icons/icon-192.png'));
  const regen = encodePng(192, renderIcon(192, { full: false, glyphScale: 0.74, radiusRatio: 0.22, bg: accent, fg: onAccent }));
  if (!regen.equals(webIcon)) {
    throw new Error(
      'public/icons/icon-192.png 과 생성기 출력이 다릅니다 — 아이콘과 안드로이드 로고가 같은 소스가 아닙니다. ' +
        '먼저 `node scripts/generate_icons.mjs` 로 웹 아이콘을 맞추세요.',
    );
  }
  console.log(`  ✓ 같은 소스 확인: icon-192.png 재생성 바이트 동일 (sha256 ${sha256(webIcon).slice(0, 12)}…)`);

  // ── 1) 적응형 아이콘 배경색 = --color-accent ─────────────────────────────────────────
  writeText(
    join(RES, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<!-- 생성물: scripts/generate_android_res.mjs (T25) — 색은 tokens.css 의 color-accent 토큰 -->\n` +
      `<resources>\n    <color name="ic_launcher_background">${accentHex.toUpperCase()}</color>\n</resources>\n`,
    '적응형 아이콘 배경 = --color-accent',
  );

  // ── 2) 스플래시·상태바 색 (라이트/다크) ──────────────────────────────────────────────
  const colorsXml = (bgHex, comment) =>
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<!-- 생성물: scripts/generate_android_res.mjs (T25) — ${comment} -->\n` +
    `<resources>\n` +
    `    <color name="splash_background">${bgHex.toUpperCase()}</color>\n` +
    `    <color name="status_bar_background">${bgHex.toUpperCase()}</color>\n` +
    `</resources>\n`;
  writeText(join(RES, 'values/colors.xml'), colorsXml(lightBgHex, '= tokens.css 의 color-bg 토큰 (라이트) · 웹 스플래시 배경'), '라이트 배경');
  writeText(join(RES, 'values-night/colors.xml'), colorsXml(darkBgHex, '= tokens.css 의 color-bg 토큰 (다크)'), '다크 배경');

  // ── 3) 상태바 아이콘 밝기 (라이트 톤 → 어두운 아이콘) ────────────────────────────────
  const boolsXml = (value, comment) =>
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<!-- 생성물: scripts/generate_android_res.mjs (T25) — ${comment} -->\n` +
    `<resources>\n    <bool name="light_status_bar_icons">${value}</bool>\n</resources>\n`;
  writeText(join(RES, 'values/bools.xml'), boolsXml('true', '라이트 톤(#ffffff) → 상태바 아이콘은 어둡게'), '라이트 상태바');
  writeText(join(RES, 'values-night/bools.xml'), boolsXml('false', '다크 톤 → 상태바 아이콘은 밝게'), '다크 상태바');

  // ── 4) 스플래시 (실행 테마 배경) = 흰 배경 + 중앙 로고 ───────────────────────────────
  // layer-list 로 그린다: 배경은 꽉 채우고, 로고는 **gravity=center 로 원래 크기**로 그린다.
  // (PNG 한 장을 windowBackground 로 쓰면 화면비가 다를 때 로고가 늘어난다 — 실측 회피)
  writeText(
    join(RES, 'drawable/splash.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<!--\n` +
      `  생성물: scripts/generate_android_res.mjs (T25) — Capacitor 실행 테마(AppTheme.NoActionBarLaunch)의 배경.\n` +
      `  웹 스플래시(organisms/SplashScreen.ts: 배경 = color-bg 토큰 + ./icons/icon-192.png 96px)와 색·로고가 같다.\n` +
      `  background = @color/splash_background(라이트 #ffffff / 다크는 values-night), 로고 = @drawable/splash_logo(${logoDp}dp).\n` +
      `  로고를 늘리지 않으려고 bitmap 을 gravity=center 로 얹는다(전체화면 PNG 를 windowBackground 로 쓰면 화면비에서 늘어난다).\n` +
      `-->\n` +
      `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n` +
      `    <item android:drawable="@color/splash_background" />\n` +
      `    <item android:drawable="@drawable/splash_logo" android:gravity="center" />\n` +
      `</layer-list>\n`,
    '실행 테마 배경',
  );

  // ── 5) 밀도별 아이콘·로고 ───────────────────────────────────────────────────────────
  // 밀도 버킷 배율(mdpi=1) — 레거시 런처 48dp, 적응형 전경 108dp, 스플래시 로고는 토큰의 96dp.
  const densities = [
    { name: 'mdpi', scale: 1 },
    { name: 'hdpi', scale: 1.5 },
    { name: 'xhdpi', scale: 2 },
    { name: 'xxhdpi', scale: 3 },
    { name: 'xxxhdpi', scale: 4 },
  ];
  const LAUNCHER_DP = 48;
  const ADAPTIVE_LAYER_DP = 108;
  const ADAPTIVE_SAFE_DP = 68; // 108dp 레이어 안에서 글리프를 담는 상자(≤66dp 안전원 안에 들어가도록)

  for (const { name, scale } of densities) {
    const label = `${name}(x${scale})`;
    // 레거시 런처 아이콘 — 웹 icon-192.png 와 **같은 조리법**(둥근 사각 타일 + 흰 버스)
    writePng(
      join(RES, `mipmap-${name}/ic_launcher.png`),
      Math.round(LAUNCHER_DP * scale),
      renderIcon(Math.round(LAUNCHER_DP * scale), { full: false, glyphScale: 0.74, radiusRatio: 0.22, bg: accent, fg: onAccent }),
      `${label} 레거시 런처`,
    );
    // 원형 런처 아이콘 — 같은 그림, 마스크 모양만 원(radiusRatio 0.5 = 반지름)
    writePng(
      join(RES, `mipmap-${name}/ic_launcher_round.png`),
      Math.round(LAUNCHER_DP * scale),
      renderIcon(Math.round(LAUNCHER_DP * scale), { full: false, glyphScale: 0.74, radiusRatio: 0.5, bg: accent, fg: onAccent }),
      `${label} 원형 런처`,
    );
    // 적응형 전경 — 투명 배경 + 글리프만. 배경 레이어(@color/ic_launcher_background)와 겹쳐 같은 그림이 된다.
    const fgPx = Math.round(ADAPTIVE_LAYER_DP * scale);
    writePng(
      join(RES, `mipmap-${name}/ic_launcher_foreground.png`),
      fgPx,
      raster(fgPx, {
        background: [0, 0, 0, 0],
        glyphScale: ADAPTIVE_SAFE_DP / ADAPTIVE_LAYER_DP,
        toneColors: { fg: onAccent, bg: accent },
      }),
      `${label} 적응형 전경(${ADAPTIVE_LAYER_DP}dp·안전 ${ADAPTIVE_SAFE_DP}dp)`,
    );
    // 스플래시 로고 — 웹 스플래시가 쓰는 그림과 같은 조리법(96dp)
    const logoPx = Math.round(logoDp * scale);
    writePng(
      join(RES, `drawable-${name}/splash_logo.png`),
      logoPx,
      renderIcon(logoPx, { full: false, glyphScale: 0.74, radiusRatio: 0.22, bg: accent, fg: onAccent }),
      `${label} 스플래시 로고 ${logoDp}dp`,
    );
  }

  // ── 6) 대체된 기본 파일 정리 ───────────────────────────────────────────────────────
  for (const dir of ['drawable', 'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi', 'drawable-land-xxhdpi', 'drawable-land-xxxhdpi', 'drawable-port-mdpi', 'drawable-port-hdpi', 'drawable-port-xhdpi', 'drawable-port-xxhdpi', 'drawable-port-xxxhdpi']) {
    removeFile(join(RES, dir, 'splash.png'));
  }
  removeFile(join(RES, 'drawable/ic_launcher_background.xml')); // 적응형 배경은 @color/ic_launcher_background 를 쓴다
  removeFile(join(RES, 'drawable-v24/ic_launcher_foreground.xml')); // 참조는 @mipmap/ic_launcher_foreground (PNG) 다

  console.log(`\n쓰기 ${written.length}개 · 삭제 ${removed.length}개`);
  console.log(`accent 휘도 ${accentLuma.toFixed(1)} → 적응형 전경 대비는 흰 글리프(#FFFFFF)로 확보`);
  console.log('완료. 다음: bash android/build-release.sh   (웹 빌드 → cap sync → AAB)');
}

main();
