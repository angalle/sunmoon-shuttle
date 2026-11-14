#!/usr/bin/env node
/**
 * PWA 아이콘 생성기 (T7) — **런타임 의존성 0** 계약 유지: 외부 라이브러리 없이 PNG 를 직접 인코딩한다.
 *
 * 왜 스크립트인가
 * - 카드 지시②: 아이콘은 **자체 제작**이어야 하고, **생성 스크립트로 재현 가능**해야 한다(유료·불명 자산 금지).
 * - 색은 `tokens.css` 의 `--color-accent` / `--color-on-accent`(라이트)를 **읽어서** 쓴다 →
 *   아이콘과 앱 색이 어긋나지 않는다(하드코딩 색 금지 규율을 아이콘에도 적용).
 *
 * 산출물 (public/icons/)
 *   icon-192.png  icon-512.png             — `purpose: any`  (모서리 둥근 사각형, 바깥은 투명)
 *   maskable-192.png maskable-512.png      — `purpose: maskable` (전면 배경 + 안전영역 80% 안에 글리프)
 *   apple-touch-icon-180.png               — iOS 홈 화면(iOS 가 자체 마스크를 씌우므로 전면 배경)
 *   favicon-32.png                         — 브라우저 탭 폴백
 *
 * 그리기 방식: 도형(둥근사각형·원) 목록을 **픽셀당 4×4 슈퍼샘플링**으로 칠해 가장자리를 부드럽게 만든다
 * (결정적 — 같은 입력 → 같은 바이트).
 *
 * 사용: npm run icons   (node scripts/generate_icons.mjs)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOKENS = join(ROOT, 'src/adapters/in/web/shared/ui/styles/tokens.css');
const OUT_DIR = join(ROOT, 'public/icons');
const PUBLIC_DIR = join(ROOT, 'public');

/**
 * 이 파일은 **모듈이면서 실행 스크립트**다(T25).
 * - `node scripts/generate_icons.mjs` → 아래 main() 이 돌아 PWA 아이콘을 다시 만든다.
 * - `import … from './generate_icons.mjs'` → 도형·래스터라이저·PNG 인코더만 가져다 쓴다.
 *   T25 의 안드로이드 리소스 생성기(`scripts/generate_android_res.mjs`)가 이 프리미티브를
 *   **그대로** 써서 스플래시 로고·런처 아이콘을 만든다(별도 제작 금지 = 같은 소스 증명).
 */
export const IS_DIRECT_RUN =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export { ROOT, TOKENS };


// ───────────────────────── 토큰에서 색 읽기 ─────────────────────────

/** `tokens.css` 의 첫 `:root`(라이트) 에서 색 토큰을 읽는다 — 아이콘 색의 단일출처. */
export function readToken(name) {
  const css = readFileSync(TOKENS, 'utf8');
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error(`tokens.css 에서 --${name} 을 찾지 못했습니다(색 토큰이 단일출처).`);
  }
  return match[1];
}

export function parseHex(hex) {
  const body = hex.slice(1);
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body;
  if (full.length !== 6) throw new Error(`6자리 hex 만 지원합니다: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

// ───────────────────────── 도형 (단위공간 0..1) ─────────────────────────

/** 둥근 사각형 SDF — 중심(cx,cy)·반폭(hw,hh)·모서리 반지름 r. 음수면 내부. */
export function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * 아이콘 장면 "새벽 길 위로 오는 셔틀"(2026-11-14 사용자 결정 H3) — 단위공간(0..1) 도형 목록.
 * 뒤에 있는 도형이 위에 그려진다. 하늘·언덕·길은 캔버스 밖으로도 이어지므로(전면 장면)
 * 글리프를 축소해도(maskable·적응형) 빈 테두리가 생기지 않는다.
 *
 *   하늘(accent) · 초승달과 별(icon-moon) · 해(brand-red) · 언덕(brand-deep) · 길(icon-road)
 *   · 정면 셔틀(on-accent 차체 · brand-red 행선판 · brand-deep 앞유리 · accent 전조등 · icon-tire 바퀴)
 */
export function sceneShapes() {
  // 길: 지평선(0.42)의 좁은 끝에서 아래로 벌어진다 — 아래 끝은 캔버스 밖(1.6)까지 같은 기울기로 연장
  const slope = (0.475 - 0.14) / (0.42 - 1);
  const roadLeftAt = (y) => 0.475 + slope * (y - 0.42);
  return [
    { kind: 'circle', cx: 0.78, cy: 0.16, r: 0.016, tone: 'moon' },
    { kind: 'circle', cx: 0.87, cy: 0.25, r: 0.012, tone: 'moon' },
    { kind: 'circle', cx: 0.25, cy: 0.22, r: 0.11, tone: 'moon' },
    { kind: 'circle', cx: 0.31, cy: 0.18, r: 0.09, tone: 'sky' }, // 초승달로 깎기
    { kind: 'circle', cx: 0.5, cy: 0.4, r: 0.14, tone: 'sun' },
    { kind: 'hill', tone: 'ground' },
    {
      kind: 'poly',
      points: [
        [roadLeftAt(1.6), 1.6],
        [0.475, 0.42],
        [0.525, 0.42],
        [1 - roadLeftAt(1.6), 1.6],
      ],
      tone: 'road',
    },
    // 정면 셔틀 — 좌우 대칭(중심 0.5)
    { kind: 'rr', cx: 0.385, cy: 0.935, hw: 0.045, hh: 0.045, r: 0.025, tone: 'tire' },
    { kind: 'rr', cx: 0.615, cy: 0.935, hw: 0.045, hh: 0.045, r: 0.025, tone: 'tire' },
    { kind: 'rr', cx: 0.28, cy: 0.65, hw: 0.025, hh: 0.05, r: 0.025, tone: 'bus' }, // 사이드미러
    { kind: 'rr', cx: 0.72, cy: 0.65, hw: 0.025, hh: 0.05, r: 0.025, tone: 'bus' },
    { kind: 'rr', cx: 0.5, cy: 0.72, hw: 0.2, hh: 0.2, r: 0.09, tone: 'bus' }, // 차체
    { kind: 'rr', cx: 0.5, cy: 0.585, hw: 0.145, hh: 0.025, r: 0.025, tone: 'sun' }, // 행선판
    { kind: 'rr', cx: 0.5, cy: 0.71, hw: 0.16, hh: 0.07, r: 0.035, tone: 'ground' }, // 앞유리
    { kind: 'circle', cx: 0.375, cy: 0.85, r: 0.03, tone: 'sky' }, // 전조등
    { kind: 'circle', cx: 0.625, cy: 0.85, r: 0.03, tone: 'sky' },
    { kind: 'rr', cx: 0.5, cy: 0.851, hw: 0.06, hh: 0.013, r: 0.013, tone: 'road' }, // 범퍼
  ];
}

/** 언덕 능선 — SVG `M0 44 Q25 37 50 42 T100 40` 과 같은 두 2차 베지어(x 에 대해 선형 매개변수). */
export function hillY(x) {
  if (x < 0.5) {
    const t = Math.min(Math.max(x / 0.5, 0), 1);
    return (1 - t) ** 2 * 0.44 + 2 * (1 - t) * t * 0.37 + t ** 2 * 0.42;
  }
  const t = Math.min(Math.max((x - 0.5) / 0.5, 0), 1);
  return (1 - t) ** 2 * 0.42 + 2 * (1 - t) * t * 0.47 + t ** 2 * 0.4;
}

function inPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inShape(shape, x, y) {
  if (shape.kind === 'rr') return sdRoundRect(x, y, shape.cx, shape.cy, shape.hw, shape.hh, shape.r) <= 0;
  if (shape.kind === 'hill') return y >= hillY(x);
  if (shape.kind === 'poly') return inPolygon(shape.points, x, y);
  return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
}

/** 장면 톤 → 토큰(색의 단일출처는 tokens.css). */
export function scenePalette() {
  return {
    sky: parseHex(readToken('color-accent')),
    bus: parseHex(readToken('color-on-accent')),
    ground: parseHex(readToken('color-brand-deep')),
    sun: parseHex(readToken('color-brand-red')),
    moon: parseHex(readToken('color-icon-moon')),
    road: parseHex(readToken('color-icon-road')),
    tire: parseHex(readToken('color-icon-tire')),
  };
}

// ───────────────────────── 래스터라이저 ─────────────────────────

export const SS = 4; // 축당 슈퍼샘플 수 → 16 샘플/픽셀

/**
 * 아이콘 한 장을 RGBA 버퍼로 그린다.
 * - `full` = true  → 캔버스 전체에 장면(maskable · apple-touch · 적응형 전경)
 * - `full` = false → 모서리가 둥근 사각형(또는 원) 안에만 장면, 바깥은 투명
 * - `glyphScale`   → 장면을 캔버스 중앙 기준으로 이 비율로 축소(안전영역 확보 · 바깥은 장면이 이어진다)
 */
export function renderIcon(size, { full, glyphScale, radiusRatio, palette = scenePalette() }) {
  const shapes = sceneShapes();
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
          const inside = full ? true : sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, radiusRatio) <= 0;
          if (!inside) continue; // 투명
          const gx = (u - 0.5) / glyphScale + 0.5;
          const gy = (v - 0.5) / glyphScale + 0.5;
          let color = palette.sky;
          for (const shape of shapes) {
            if (inShape(shape, gx, gy)) color = palette[shape.tone];
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

// ───────────────────────── PNG 인코더 (외부 의존성 0) ─────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

export function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 파일을 쓰고 IHDR 을 되읽어 치수를 증명한다. */
function writeIcon(file, size, rgba) {
  const png = encodePng(size, rgba);
  writeFileSync(file, png);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== size || height !== size) {
    throw new Error(`${file}: IHDR 치수 불일치 ${width}x${height} (기대 ${size}x${size})`);
  }
  console.log(`  ${file.slice(ROOT.length)} — ${size}x${size}, ${png.length} bytes`);
  return { file, size, bytes: png.length };
}

// ───────────────────────── 아이콘 세트 ─────────────────────────

/** 변형별 그리기 설정 — 안드로이드 생성기도 이 값을 그대로 쓴다(같은 소스). */
export const ICON_ANY = { full: false, glyphScale: 1, radiusRatio: 0.22 };
/** maskable: 핵심(셔틀·해·달·별)이 중심 40% 반경 안전원 안에 들도록 축소 — 달 끝 ≈ 0.485 × 0.78 = 0.378 */
export const ICON_MASKABLE = { full: true, glyphScale: 0.78, radiusRatio: 0 };
/** iOS 는 자체 둥근 마스크를 씌운다 — 모서리는 하늘·언덕이라 잘려도 무방 */
export const ICON_APPLE = { full: true, glyphScale: 1, radiusRatio: 0 };

function main() {
  console.log('아이콘 생성 (장면: 새벽 길 위로 오는 셔틀 · 색 단일출처: tokens.css)');
  mkdirSync(OUT_DIR, { recursive: true });

  const written = [];
  const variants = [
    { name: 'icon-192.png', size: 192, ...ICON_ANY },
    { name: 'icon-512.png', size: 512, ...ICON_ANY },
    { name: 'maskable-192.png', size: 192, ...ICON_MASKABLE },
    { name: 'maskable-512.png', size: 512, ...ICON_MASKABLE },
    { name: 'apple-touch-icon-180.png', size: 180, ...ICON_APPLE },
    { name: 'favicon-32.png', size: 32, ...ICON_ANY },
  ];
  for (const variant of variants) {
    const rgba = renderIcon(variant.size, variant);
    written.push(writeIcon(join(OUT_DIR, variant.name), variant.size, rgba));
  }

  // apple-touch-icon 을 웹 루트에도 둔다(iOS 는 /apple-touch-icon.png 를 관례적으로 요청한다).
  const appleRoot = join(PUBLIC_DIR, 'apple-touch-icon.png');
  const appleRgba = renderIcon(180, ICON_APPLE);
  written.push(writeIcon(appleRoot, 180, appleRgba));

  const total = written.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`합계 ${written.length}개 · ${total} bytes`);
}

if (IS_DIRECT_RUN) main();
