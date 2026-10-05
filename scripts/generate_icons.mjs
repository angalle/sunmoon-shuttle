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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOKENS = join(ROOT, 'src/adapters/in/web/shared/ui/styles/tokens.css');
const OUT_DIR = join(ROOT, 'public/icons');
const PUBLIC_DIR = join(ROOT, 'public');

// ───────────────────────── 토큰에서 색 읽기 ─────────────────────────

/** `tokens.css` 의 첫 `:root`(라이트) 에서 색 토큰을 읽는다 — 아이콘 색의 단일출처. */
function readToken(name) {
  const css = readFileSync(TOKENS, 'utf8');
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error(`tokens.css 에서 --${name} 을 찾지 못했습니다(색 토큰이 단일출처).`);
  }
  return match[1];
}

function parseHex(hex) {
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
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 버스 글리프 — 단위공간(0..1) 안의 도형 목록. 뒤에 있는 도형이 위에 그려진다. */
function busGlyph() {
  const c = 0.5;
  // 창문 띠: 3칸이 **정확히 같은 폭**이 되도록 구분선 위치를 계산한다(좌우 대칭).
  const stripHalf = 0.3;
  const dividerWidth = 0.028;
  const windowWidth = (stripHalf * 2 - 2 * dividerWidth) / 3;
  const divider1 = c - stripHalf + windowWidth + dividerWidth / 2;
  const divider2 = c + stripHalf - windowWidth - dividerWidth / 2;
  return [
    // 차체(측면 실루엣)
    { kind: 'rr', cx: c, cy: c, hw: 0.36, hh: 0.225, r: 0.10, tone: 'fg' },
    // 창문 띠(차체 상단) — 하나의 띠를 칠한 뒤 흰 구분선으로 3칸으로 나눈다
    { kind: 'rr', cx: c, cy: c - 0.105, hw: stripHalf, hh: 0.072, r: 0.035, tone: 'bg' },
    { kind: 'rr', cx: divider1, cy: c - 0.105, hw: dividerWidth / 2, hh: 0.072, r: 0.007, tone: 'fg' },
    { kind: 'rr', cx: divider2, cy: c - 0.105, hw: dividerWidth / 2, hh: 0.072, r: 0.007, tone: 'fg' },
    // 바퀴 2개 — 차체 안쪽의 음각(차체 밖으로 나가지 않아 잘림·융합이 없다)
    { kind: 'circle', cx: c - 0.19, cy: c + 0.14, r: 0.06, tone: 'bg' },
    { kind: 'circle', cx: c + 0.19, cy: c + 0.14, r: 0.06, tone: 'bg' },
  ];
}

/** 노면 표시 — 글리프 아래 **길이가 같은** 점선 2개(차량이 도로 위에 있음을 나타낸다). */
function roadGlyph() {
  const c = 0.5;
  return [
    { kind: 'rr', cx: c - 0.16, cy: c + 0.335, hw: 0.13, hh: 0.028, r: 0.028, tone: 'fg' },
    { kind: 'rr', cx: c + 0.16, cy: c + 0.335, hw: 0.13, hh: 0.028, r: 0.028, tone: 'fg' },
  ];
}

function inShape(shape, x, y) {
  if (shape.kind === 'rr') return sdRoundRect(x, y, shape.cx, shape.cy, shape.hw, shape.hh, shape.r) <= 0;
  return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
}

// ───────────────────────── 래스터라이저 ─────────────────────────

const SS = 4; // 축당 슈퍼샘플 수 → 16 샘플/픽셀

/**
 * 아이콘 한 장을 RGBA 버퍼로 그린다.
 * - `full` = true  → 캔버스 전체를 배경색으로 채운다(maskable · apple-touch: 전면 배경)
 * - `full` = false → 모서리가 둥근 사각형 배경, 바깥은 투명
 * - `glyphScale`   → 글리프를 캔버스 중앙에 이 비율로 축소(안전영역 확보)
 */
function renderIcon(size, { full, glyphScale, radiusRatio, bg, fg }) {
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

          // 배경 (0..1 전체 공간)
          const bgInside = full
            ? true
            : sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, radiusRatio) <= 0;
          if (!bgInside) continue; // 투명

          // 글리프 공간으로 좌표 변환
          const gx = (u - 0.5) / glyphScale + 0.5;
          const gy = (v - 0.5) / glyphScale + 0.5;
          let color = bg;
          if (gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1) {
            for (const shape of glyph) {
              if (inShape(shape, gx, gy)) color = shape.tone === 'fg' ? fg : bg;
            }
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

function encodePng(size, rgba) {
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

function main() {
  const bg = parseHex(readToken('color-accent'));
  const fg = parseHex(readToken('color-on-accent'));
  console.log(`아이콘 생성 (색 단일출처: tokens.css) — accent=${readToken('color-accent')} onAccent=${readToken('color-on-accent')}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const written = [];
  const variants = [
    { name: 'icon-192.png', size: 192, full: false, glyphScale: 0.74, radiusRatio: 0.22 },
    { name: 'icon-512.png', size: 512, full: false, glyphScale: 0.74, radiusRatio: 0.22 },
    { name: 'maskable-192.png', size: 192, full: true, glyphScale: 0.66, radiusRatio: 0 },
    { name: 'maskable-512.png', size: 512, full: true, glyphScale: 0.66, radiusRatio: 0 },
    { name: 'apple-touch-icon-180.png', size: 180, full: true, glyphScale: 0.68, radiusRatio: 0 },
    { name: 'favicon-32.png', size: 32, full: false, glyphScale: 0.78, radiusRatio: 0.22 },
  ];
  for (const variant of variants) {
    const rgba = renderIcon(variant.size, { ...variant, bg, fg });
    written.push(writeIcon(join(OUT_DIR, variant.name), variant.size, rgba));
  }

  // apple-touch-icon 을 웹 루트에도 둔다(iOS 는 /apple-touch-icon.png 를 관례적으로 요청한다).
  const appleRoot = join(PUBLIC_DIR, 'apple-touch-icon.png');
  const appleRgba = renderIcon(180, { full: true, glyphScale: 0.68, radiusRatio: 0, bg, fg });
  written.push(writeIcon(appleRoot, 180, appleRgba));

  const total = written.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`합계 ${written.length}개 · ${total} bytes`);
}

main();
