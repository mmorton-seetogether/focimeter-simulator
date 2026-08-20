/**
 * Draws the PWA icons.
 *
 * A raster encoder rather than a dependency: the icon is a few circles and
 * lines, and a build that pulls in a whole image toolchain to draw them is a
 * build with one more thing to break. Node's own zlib does the compression, so
 * this runs anywhere Node does.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// SEE Together brand: Royal Blue ground, Mustard mires.
const BACKGROUND = [59, 85, 165]; // Royal Blue #3B55A5
const GRATICULE = [255, 199, 14]; // Mustard Yellow #FFC70E
const MIRE = [255, 199, 14]; // Mustard Yellow #FFC70E

/** A tiny RGBA canvas with just the primitives the mark needs. */
function createCanvas(size) {
  const pixels = new Uint8Array(size * size * 4);
  return {
    size,
    pixels,

    fill([r, g, b]) {
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
      }
    },

    /** Blend one pixel, `alpha` in 0-1, for cheap antialiasing. */
    blend(x, y, [r, g, b], alpha) {
      if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
      const i = (y * size + x) * 4;
      const a = Math.min(alpha, 1);
      pixels[i] = Math.round(pixels[i] * (1 - a) + r * a);
      pixels[i + 1] = Math.round(pixels[i + 1] * (1 - a) + g * a);
      pixels[i + 2] = Math.round(pixels[i + 2] * (1 - a) + b * a);
      pixels[i + 3] = 255;
    },

    /** Filled disc, antialiased by distance from the edge. */
    disc(cx, cy, radius, colour) {
      for (let y = Math.floor(cy - radius - 1); y <= cy + radius + 1; y += 1) {
        for (let x = Math.floor(cx - radius - 1); x <= cx + radius + 1; x += 1) {
          const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          this.blend(x, y, colour, radius + 0.5 - distance);
        }
      }
    },

    /** Circle outline of a given stroke width. */
    ring(cx, cy, radius, width, colour) {
      const outer = radius + width / 2;
      const inner = radius - width / 2;
      for (let y = Math.floor(cy - outer - 1); y <= cy + outer + 1; y += 1) {
        for (let x = Math.floor(cx - outer - 1); x <= cx + outer + 1; x += 1) {
          const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const alpha = Math.min(outer + 0.5 - distance, distance - inner + 0.5);
          this.blend(x, y, colour, alpha);
        }
      }
    },

    /** Axis-aligned bar, used for the mire lines. */
    bar(x0, y0, x1, y1, colour) {
      for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
        for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
          const coverage =
            Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0)) *
            Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
          this.blend(x, y, colour, coverage);
        }
      }
    },
  };
}

/** Encode a square RGBA buffer as a PNG. */
function encodePng(size, pixels) {
  return encodePngRect(size, size, pixels);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

/**
 * The mark: the eyepiece view in miniature - a dark field, the graticule
 * rings, and the two crossed sets of mires.
 *
 * `inset` shrinks the artwork inside the canvas so a maskable icon survives
 * being cropped to a circle by the launcher.
 */
function drawMark(size, inset) {
  const canvas = createCanvas(size);
  canvas.fill(BACKGROUND);

  const centre = size / 2;
  const radius = (size / 2) * inset;
  const unit = radius / 10;

  canvas.disc(centre, centre, radius, [26, 26, 26]);
  canvas.ring(centre, centre, radius * 0.94, unit * 0.5, GRATICULE);
  canvas.ring(centre, centre, radius * 0.55, unit * 0.35, [167, 158, 140]);
  canvas.ring(centre, centre, radius * 0.28, unit * 0.35, [167, 158, 140]);

  const half = unit * 0.55;
  const reach = radius * 0.86;
  canvas.bar(centre - reach, centre - half, centre + reach, centre + half, MIRE);
  canvas.bar(centre - half, centre - reach, centre + half, centre + reach, MIRE);

  return encodePng(size, canvas.pixels);
}

/**
 * The social card. Deliberately wordless: the platforms that show these will
 * not render SVG, and nothing here can rasterise a typeface, so the card
 * carries the eyepiece view itself rather than a title it cannot draw.
 */
function drawSocialCard(width, height) {
  // Drawn on a square canvas the full card width, then cropped to the card
  // height - the primitives only know about square buffers.
  const canvas = createCanvas(width);
  canvas.fill(BACKGROUND);

  const centre = { x: width / 2, y: height / 2 };
  const radius = height * 0.42;
  const unit = radius / 10;

  canvas.disc(centre.x, centre.y, radius, [26, 26, 26]);
  canvas.ring(centre.x, centre.y, radius * 0.96, unit * 0.4, GRATICULE);
  canvas.ring(centre.x, centre.y, radius * 0.62, unit * 0.25, [167, 158, 140]);
  canvas.ring(centre.x, centre.y, radius * 0.4, unit * 0.25, [167, 158, 140]);
  canvas.ring(centre.x, centre.y, radius * 0.2, unit * 0.25, [167, 158, 140]);

  // One set of mires sharp, the other spread into a soft band: the whole task
  // of the app in a single picture.
  const reach = radius * 0.92;
  const sharp = unit * 0.42;
  canvas.bar(centre.x - reach, centre.y - sharp, centre.x + reach, centre.y + sharp, MIRE);
  for (const offset of [-unit * 2.4, unit * 2.4]) {
    canvas.bar(
      centre.x - reach,
      centre.y + offset - sharp,
      centre.x + reach,
      centre.y + offset + sharp,
      MIRE,
    );
  }
  // The crossing set is left out of focus - one sharp, one spread - which is
  // exactly the moment the student is being asked to resolve.
  const spread = unit * 1.5;
  for (const offset of [-unit * 2.4, 0, unit * 2.4]) {
    for (let step = -spread; step <= spread; step += 0.5) {
      const x = centre.x + offset + step;
      const alpha = 0.12 * (1 - Math.abs(step) / (spread + 0.5));
      for (let y = Math.round(centre.y - reach); y < centre.y + reach; y += 1) {
        canvas.blend(Math.round(x), y, MIRE, alpha);
      }
    }
  }

  // Crop the square canvas down to the card aspect ratio.
  const out = new Uint8Array(width * height * 4);
  out.set(canvas.pixels.subarray(0, width * height * 4));
  return encodePngRect(width, height, out);
}

/** PNG encoder for a non-square image. */
function encodePngRect(width, height, pixels) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

const icons = [
  ['icon-192.png', 192, 0.92],
  ['icon-512.png', 512, 0.92],
  // Maskable icons are cropped to as little as 80% of the canvas.
  ['icon-maskable-512.png', 512, 0.66],
  ['apple-touch-icon.png', 180, 0.92],
];

for (const [name, size, inset] of icons) {
  writeFileSync(join(OUT_DIR, name), drawMark(size, inset));
  console.log(`wrote icons/${name} (${size}x${size})`);
}

writeFileSync(join(OUT_DIR, '..', 'og-image.png'), drawSocialCard(1200, 630));
console.log('wrote og-image.png (1200x630)');
