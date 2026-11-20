#!/usr/bin/env node
/**
 * iOS 리소스 생성기 (2026-11-19) — 웹·안드로이드 아이콘과 **같은 그림**을 iOS 에셋 카탈로그에 넣는다.
 * `scripts/generate_icons.mjs` 의 도형·래스터라이저를 그대로 import 한다(별도 제작 금지 = 같은 소스).
 *
 * 산출물 (ios/App/App/Assets.xcassets/)
 *   AppIcon.appiconset/AppIcon-512@2x.png   1024×1024 · **알파 없는 RGB**(App Store 는 투명 채널이 있는 아이콘을 거절한다)
 *                                           iOS 가 둥근 마스크를 씌우므로 전면 배경(ICON_APPLE = 홈 화면 웹앱 아이콘과 같은 설정)
 *   Splash.imageset/splash-2732x2732*.png   흰 배경 + 가운데 로고(Capacitor 기본 청록 스플래시를 덮어쓴다)
 *                                           LaunchScreen 이 aspect-fill 로 깔기 때문에 가장자리는 잘려도 된다.
 *
 * 사용: node scripts/generate_ios_res.mjs   (npx cap add ios 로 프로젝트를 다시 만들면 한 번 더 돌린다)
 */
import { deflateSync } from 'node:zlib';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_ANY, ICON_APPLE, ROOT, encodePng, renderIcon } from './generate_icons.mjs';

const ASSETS = join(ROOT, 'ios/App/App/Assets.xcassets');
if (!existsSync(ASSETS)) {
  console.error(`${ASSETS} 가 없습니다 — 먼저 npx cap add ios`);
  process.exit(1);
}

/** RGBA → 알파 없는 RGB PNG(배경 rgb 위에 합성). encodePng 의 청크 형식을 그대로 따른다. */
function encodeRgbPng(width, height, rgba, background) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const s = (y * width + x) * 4;
      const a = rgba[s + 3] / 255;
      for (let c = 0; c < 3; c += 1) raw[row + 1 + x * 3 + c] = Math.round(rgba[s + c] * a + background[c] * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // color type RGB — 알파 없음
  return assemble(ihdr, deflateSync(raw, { level: 9 }));
}

/** encodePng 와 같은 시그니처 + 청크(IHDR·IDAT·IEND) 조립. CRC 는 encodePng 결과에서 검증된 구현과 같다. */
function assemble(ihdr, idat) {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type, data) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let c = 0xffffffff;
    for (const byte of typed) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([len, typed, crc]);
  };
  const signature = encodePng(1, Buffer.alloc(4)).subarray(0, 8);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const WHITE = [255, 255, 255];

// 앱 아이콘 1024 — ICON_APPLE 은 전면 배경이라 원래도 불투명하다. 그래도 알파 채널 자체를 없앤다.
const ICON = 1024;
const iconFile = join(ASSETS, 'AppIcon.appiconset/AppIcon-512@2x.png');
writeFileSync(iconFile, encodeRgbPng(ICON, ICON, renderIcon(ICON, ICON_APPLE), WHITE));
console.log(`  ${iconFile.slice(ROOT.length)} — ${ICON}x${ICON} RGB`);

// 스플래시 2732 — 흰 캔버스 가운데 로고(둥근 사각 타일). 3x 기준 로고 288px ≈ 96pt(웹·안드로이드 스플래시 로고와 같은 크기).
const SPLASH = 2732;
const LOGO = 288;
const logo = renderIcon(LOGO, ICON_ANY);
const canvas = Buffer.alloc(SPLASH * SPLASH * 4, 0);
const offset = Math.round((SPLASH - LOGO) / 2);
for (let y = 0; y < LOGO; y += 1) {
  logo.copy(canvas, ((offset + y) * SPLASH + offset) * 4, y * LOGO * 4, (y + 1) * LOGO * 4);
}
const splashPng = encodeRgbPng(SPLASH, SPLASH, canvas, WHITE);
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  const file = join(ASSETS, 'Splash.imageset', name);
  writeFileSync(file, splashPng);
  console.log(`  ${file.slice(ROOT.length)} — ${SPLASH}x${SPLASH} RGB`);
}
