// Generates PWA icons (192x192 and 512x512) as PNGs without external deps.
// Draws a sky-blue rounded square with a white "Q" representing QueueFlow.
// Run with: node scripts/gen-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
      raw[o + 3] = rgba[i + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // corner radius
  const cx = size / 2;
  const cy = size / 2;
  // brand color #0ea5e9
  const br = 14, bg = 165, bb = 233;
  // ring (Q) color white
  const wr = 255, wg = 255, wb = 255;
  const ringOuter = size * 0.30;
  const ringInner = size * 0.20;
  const tailW = size * 0.07;
  // tail goes from center down-right
  const tailAngle = Math.PI / 4; // 45 deg
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded square
      let inside = true;
      if (x < r && y < r) inside = (r - x) * (r - x) + (r - y) * (r - y) <= r * r;
      else if (x > size - r && y < r) inside = (x - (size - r - 1)) * (x - (size - r - 1)) + (r - y) * (r - y) <= r * r;
      else if (x < r && y > size - r) inside = (r - x) * (r - x) + (y - (size - r - 1)) * (y - (size - r - 1)) <= r * r;
      else if (x > size - r && y > size - r) inside = (x - (size - r - 1)) * (x - (size - r - 1)) + (y - (size - r - 1)) * (y - (size - r - 1)) <= r * r;
      if (!inside) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }
      // Q ring: outer disk minus inner disk
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let inRing = dist <= ringOuter && dist >= ringInner;
      // tail: a small rectangle from center outward at 45deg
      // rotate point (dx,dy) by -45deg and check band
      const cos = Math.cos(-tailAngle);
      const sin = Math.sin(-tailAngle);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      const inTail = rx >= 0 && rx <= ringOuter * 1.15 && Math.abs(ry) <= tailW / 2;
      if (inRing || inTail) {
        rgba[i] = wr; rgba[i + 1] = wg; rgba[i + 2] = wb; rgba[i + 3] = 255;
      } else {
        rgba[i] = br; rgba[i + 1] = bg; rgba[i + 2] = bb; rgba[i + 3] = 255;
      }
    }
  }
  return rgba;
}

const outDir = path.resolve(__dirname, '..', 'public');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const png = makePNG(size, size, drawIcon(size));
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log('wrote', file, png.length, 'bytes');
}
// Also a maskable icon (same image, full-bleed) at 512
{
  const size = 512;
  const rgba = Buffer.alloc(size * size * 4);
  const br = 14, bg = 165, bb = 233;
  const wr = 255, wg = 255, wb = 255;
  const cx = size / 2, cy = size / 2;
  const ringOuter = size * 0.26, ringInner = size * 0.17;
  const tailW = size * 0.06;
  const tailAngle = Math.PI / 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cos = Math.cos(-tailAngle), sin = Math.sin(-tailAngle);
      const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
      const inRing = dist <= ringOuter && dist >= ringInner;
      const inTail = rx >= 0 && rx <= ringOuter * 1.15 && Math.abs(ry) <= tailW / 2;
      if (inRing || inTail) {
        rgba[i] = wr; rgba[i + 1] = wg; rgba[i + 2] = wb; rgba[i + 3] = 255;
      } else {
        rgba[i] = br; rgba[i + 1] = bg; rgba[i + 2] = bb; rgba[i + 3] = 255;
      }
    }
  }
  const png = makePNG(size, size, rgba);
  const file = path.join(outDir, 'icon-maskable-512.png');
  fs.writeFileSync(file, png);
  console.log('wrote', file, png.length, 'bytes');
}
