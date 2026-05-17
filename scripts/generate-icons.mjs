/**
 * Generate pixel-art dog face extension icons (16, 48, 128) using only Node built-ins.
 * No external image libraries needed — writes raw PNG from scratch.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

// ---------------------------------------------------------------------------
// Minimal PNG encoder
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crc]);
}

function createPNG(w, h, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const rowLen = 1 + w * 4; // filter byte + RGBA
  const raw = Buffer.alloc(h * rowLen);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0; // no filter
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = y * rowLen + 1 + x * 4;
      raw[di] = pixels[si]; raw[di+1] = pixels[si+1];
      raw[di+2] = pixels[si+2]; raw[di+3] = pixels[si+3];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG header
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Dog face pixel art (designed at 16x16, scaled up for larger sizes)
// ---------------------------------------------------------------------------

// Color palette
const _  = [0, 0, 0, 0];         // transparent
const BR = [165, 113, 65, 255];   // brown (face)
const DB = [120, 80, 45, 255];    // dark brown (ears, nose)
const BK = [40, 30, 25, 255];     // black (eyes, nose dot)
const WH = [240, 230, 215, 255];  // white (muzzle)
const PK = [200, 130, 120, 255];  // pink (tongue)

// 16x16 dog face template
const DOG_16 = [
  _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
  _, _, _, DB,DB, _, _, _, _, _, _, DB,DB, _, _, _,
  _, _, DB,DB,DB,DB, _, _, _, _, DB,DB,DB,DB, _, _,
  _, _, DB,BR,BR,BR,BR,BR,BR,BR,BR,BR,BR,DB, _, _,
  _, _, _, BR,BR,BR,BR,BR,BR,BR,BR,BR,BR, _, _, _,
  _, _, _, BR,BK,BK,BR,BR,BR,BR,BK,BK,BR, _, _, _,
  _, _, _, BR,BK,BK,BR,BR,BR,BR,BK,BK,BR, _, _, _,
  _, _, _, BR,BR,BR,BR,BR,BR,BR,BR,BR,BR, _, _, _,
  _, _, _, BR,BR,BR,WH,WH,WH,WH,BR,BR,BR, _, _, _,
  _, _, _, BR,BR,WH,WH,BK,BK,WH,WH,BR,BR, _, _, _,
  _, _, _, BR,BR,WH,WH,BK,BK,WH,WH,BR,BR, _, _, _,
  _, _, _, _, BR,WH,WH,WH,WH,WH,WH,BR, _, _, _, _,
  _, _, _, _, BR,BR,WH,PK,PK,WH,BR,BR, _, _, _, _,
  _, _, _, _, _, BR,BR,BR,BR,BR,BR, _, _, _, _, _,
  _, _, _, _, _, _, BR,BR,BR,BR, _, _, _, _, _, _,
  _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
];

function renderIcon(size) {
  const scale = size / 16;
  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const color = DOG_16[sy * 16 + sx] || _;
      const i = (y * size + x) * 4;
      pixels[i] = color[0]; pixels[i+1] = color[1];
      pixels[i+2] = color[2]; pixels[i+3] = color[3];
    }
  }

  return createPNG(size, size, pixels);
}

// ---------------------------------------------------------------------------
// Write icons
// ---------------------------------------------------------------------------

mkdirSync('assets/icons', { recursive: true });

for (const size of [16, 48, 128]) {
  const png = renderIcon(size);
  writeFileSync(`assets/icons/icon-${size}.png`, png);
  console.log(`  icon-${size}.png (${png.length} bytes)`);
}

console.log('Done — dog face icons generated.');
