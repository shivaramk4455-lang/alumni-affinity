/**
 * Generates public/og.png — the 1200x630 social card used by og:image and
 * twitter:image.
 *
 * Why a generated PNG instead of the SVG the site already ships: Twitter,
 * Facebook, LinkedIn and WhatsApp all refuse to render an SVG in a link
 * preview, and pointing og:image at a missing file is worse than having none
 * at all. This script has no dependencies — it rasterises the same brand mark
 * as public/icon.svg (forest field, brass frame, linen ring, brass M) and
 * writes a real PNG with zlib.
 *
 * Usage:  node scripts/generate-og-image.mjs
 *
 * A designed card for a launch campaign should replace this file; the mark,
 * colours and proportions here are deliberately the ones already in use.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WIDTH = 1200;
const HEIGHT = 630;
// Render at 2x and box-downsample: gives antialiasing for circles, rounded
// rectangles and the M polygon without a rasteriser library.
const SS = 2;

const LINEN = [0xfb, 0xf9, 0xf5];
const FOREST = [0x14, 0x28, 0x1d];
const BRASS = [0xb8, 0x95, 0x63];

const w = WIDTH * SS;
const h = HEIGHT * SS;
const px = Buffer.alloc(w * h * 3);

function setPixel(x, y, rgb) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 3;
  px[i] = rgb[0];
  px[i + 1] = rgb[1];
  px[i + 2] = rgb[2];
}

function fillAll(rgb) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(x, y, rgb);
}

/** Is (x,y) inside a rounded rectangle? */
function inRoundedRect(x, y, rx0, ry0, rw, rh, radius) {
  if (x < rx0 || y < ry0 || x >= rx0 + rw || y >= ry0 + rh) return false;
  const r = Math.min(radius, rw / 2, rh / 2);
  const cx = Math.min(Math.max(x, rx0 + r), rx0 + rw - r);
  const cy = Math.min(Math.max(y, ry0 + r), ry0 + rh - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundedRect(rx0, ry0, rw, rh, radius, rgb) {
  for (let y = Math.floor(ry0); y < Math.ceil(ry0 + rh); y++)
    for (let x = Math.floor(rx0); x < Math.ceil(rx0 + rw); x++)
      if (inRoundedRect(x + 0.5, y + 0.5, rx0, ry0, rw, rh, radius)) setPixel(x, y, rgb);
}

function fillRing(cx, cy, outer, inner, rgb) {
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= outer * outer && d2 >= inner * inner) setPixel(x, y, rgb);
    }
  }
}

/** Ray-casting fill, used for the serif M outline. */
function fillPolygon(points, rgb) {
  const ys = points.map((p) => p[1]);
  const xs = points.map((p) => p[0]);
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tx = x + 0.5;
      const ty = y + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i][0];
        const yi = points[i][1];
        const xj = points[j][0];
        const yj = points[j][1];
        if (yi > ty !== yj > ty && tx < ((xj - xi) * (ty - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) setPixel(x, y, rgb);
    }
  }
}
// --- Canvas -----------------------------------------------------------------
fillAll(LINEN);

// Inset hairline frame, echoing the icon's brass border.
fillRoundedRect(24, 24, w - 48, h - 48, 36, BRASS);
fillRoundedRect(28, 28, w - 56, h - 56, 32, LINEN);

// Brand mark, centred. Proportions are icon.svg's, scaled up to 640px.
const size = 640;
const cx = w / 2;
const cy = h / 2;
const left = cx - size / 2;
const top = cy - size / 2;
fillRoundedRect(left, top, size, size, 140, FOREST);
fillRoundedRect(left + 42, top + 42, size - 85, size - 85, 115, BRASS);
fillRoundedRect(left + 54, top + 54, size - 109, size - 109, 105, FOREST);
fillRing(cx, cy, 148, 148 - 15, LINEN);

// The M: one filled contour whose top edge dips into the mid-V.
const mw = 132;
const mh = 134;
const mt = 25;
const mx = cx - mw / 2;
const my = cy - mh / 2;
const apexOuter = my + mh * 0.6;
const apexInner = my + mh * 0.84;
fillPolygon(
  [
    [mx, my],
    [mx + mt, my],
    [mx + mw / 2, apexOuter],
    [mx + mw - mt, my],
    [mx + mw, my],
    [mx + mw, my + mh],
    [mx + mw - mt, my + mh],
    [mx + mw / 2, apexInner],
    [mx + mt, my + mh],
    [mx, my + mh],
  ],
  BRASS,
);
// --- Downsample -------------------------------------------------------------
const out = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * w + (x * SS + sx)) * 3;
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
      }
    }
    const n = SS * SS;
    const o = (y * WIDTH + x) * 3;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
  }
}

// --- PNG encoding -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolour RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Each scanline carries a leading filter byte (0 = None).
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
for (let y = 0; y < HEIGHT; y++) {
  const rowStart = y * (1 + WIDTH * 3);
  raw[rowStart] = 0;
  out.copy(raw, rowStart + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "public", "og.png");
writeFileSync(target, png);
console.log(`Wrote ${target} (${WIDTH}x${HEIGHT}, ${png.length} bytes)`);
