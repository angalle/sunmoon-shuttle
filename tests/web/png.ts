/**
 * 테스트 헬퍼: PNG 디코더 (tests/web)
 *
 * 아이콘은 **직접 만든 PNG** 라(scripts/generate_icons.mjs — 필터 0, 비인터레이스, RGBA8) 검사도 직접 한다.
 * 외부 이미지 라이브러리를 테스트 의존성으로 들이지 않는다(런타임 의존성 0 계약 유지).
 */
import { inflateSync } from 'node:zlib';

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** 원본 순서대로 행 단위 RGBA (width*height*4) */
  readonly pixels: Uint8Array;
}

export function decodePng(buffer: Buffer): RgbaImage {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 시그니처가 아닙니다');
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('8bit RGBA PNG 만 지원합니다');
    }
    if (type === 'IDAT') chunks.push(Buffer.from(data));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  const out = Buffer.from(pixels.buffer);
  const line = Buffer.alloc(stride + 1);
  for (let y = 0; y < height; y += 1) {
    raw.copy(line, 0, y * (stride + 1), (y + 1) * (stride + 1));
    if (line[0] !== 0) throw new Error(`필터 ${String(line[0])} 는 지원하지 않습니다`);
    line.copy(out, y * stride, 1, stride + 1);
  }
  return { width, height, pixels };
}

/** 픽셀 하나의 RGBA. */
export function pixelAt(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const offset = (y * image.width + x) * 4;
  return [
    image.pixels[offset] ?? 0,
    image.pixels[offset + 1] ?? 0,
    image.pixels[offset + 2] ?? 0,
    image.pixels[offset + 3] ?? 0,
  ];
}

/** 밝은(흰색 계열) 픽셀인가 — 글리프 판정용. */
export function isGlyphPixel(pixel: readonly number[]): boolean {
  return (pixel[0] ?? 0) > 200 && (pixel[1] ?? 0) > 200 && (pixel[2] ?? 0) > 200 && (pixel[3] ?? 0) > 200;
}
