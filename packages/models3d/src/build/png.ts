// Moved from synty-sprite-generator apps/server/src/png.ts (P3, ali3b/sloponator#14).
import zlib from 'node:zlib';
/** An RGBA image in memory (the old generator's packages/shared/src/tileset/raster.ts RgbaImage). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * A small PNG encoder/decoder and TGA decoder on node:zlib, for the ground tile renderer: it writes the tileset
 * atlas and reads Synty ground textures (8/16-bit grey, RGB, palette, grey+alpha and RGBA PNGs, non-interlaced;
 * uncompressed or RLE true-colour TGAs).
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode RGBA8 pixels as a PNG (colour type 6, filter: per-row best of none/sub/up/paeth by sum of residuals). */
export function encodePng(img: RgbaImage): Buffer {
  const { width: w, height: h, data } = img;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestScore = Infinity;
    const filters = [0, 1, 2, 4];
    filters.forEach((f, k) => {
      const out = cand[k];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0, b = up ? up[i] : 0, c = up && i >= 4 ? up[i - 4] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : paeth(a, b, c);
        const r = (row[i] - pred) & 0xff;
        out[i] = r;
        score += r < 128 ? r : 256 - r;
      }
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    });
    raw[y * (stride + 1)] = filters[best];
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode a PNG to RGBA8. */
export function decodePng(buf: Uint8Array): RgbaImage {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 8 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= b.length; ) {
    const len = b.readUInt32BE(p), kind = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  if (!w || !h) throw new Error('PNG without a header');
  if (interlace) throw new Error('interlaced PNGs are not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`unsupported PNG colour type ${type}`);
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const stride = Math.ceil((w * bitsPP) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint8Array(w * h * 4);
  const sample = (row: Uint8Array, i: number): number => {
    // Sample i of a row, scaled to 8 bits.
    if (depth === 8) return row[i];
    if (depth === 16) return row[i * 2];
    const bit = i * depth, byte = row[bit >> 3], shift = 8 - depth - (bit & 7);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const trnsGrey = trns && type === 0 ? trns.readUInt16BE(0) : -1;
  for (let y = 0; y < h; y++) {
    const off = y * (stride + 1), f = raw[off];
    for (let i = 0; i < stride; i++) {
      const x = raw[off + 1 + i], a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + up : f === 3 ? x + ((a + up) >> 1) : x + paeth(a, up, c)) & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 3) {
        const idx = sample(cur, x);
        out[o] = palette?.[idx * 3] ?? 0;
        out[o + 1] = palette?.[idx * 3 + 1] ?? 0;
        out[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(cur, x * channels);
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = type === 4 ? sample(cur, x * channels + 1) : trnsGrey >= 0 && g === Math.round((trnsGrey * 255) / ((1 << depth) - 1)) ? 0 : 255;
      } else {
        out[o] = sample(cur, x * channels);
        out[o + 1] = sample(cur, x * channels + 1);
        out[o + 2] = sample(cur, x * channels + 2);
        out[o + 3] = type === 6 ? sample(cur, x * channels + 3) : 255;
      }
    }
    prev.set(cur);
  }
  return { width: w, height: h, data: out };
}

/** Decode a true-colour (24/32-bit) or grey TGA, uncompressed (types 2, 3) or RLE (10, 11), to RGBA8. */
export function decodeTga(buf: Uint8Array): RgbaImage {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const idLen = b[0], cmapType = b[1], type = b[2];
  const cmapLen = b.readUInt16LE(5), cmapDepth = b[7];
  const w = b.readUInt16LE(12), h = b.readUInt16LE(14), depth = b[16], desc = b[17];
  if (![2, 3, 10, 11].includes(type)) throw new Error(`unsupported TGA type ${type}`);
  const px = depth >> 3;
  if (!(px === 1 || px === 3 || px === 4)) throw new Error(`unsupported TGA depth ${depth}`);
  let p = 18 + idLen + (cmapType ? cmapLen * Math.ceil(cmapDepth / 8) : 0);
  const n = w * h;
  const pixels = new Uint8Array(n * 4);
  const put = (i: number, at: number) => {
    const o = i * 4;
    if (px === 1) {
      pixels[o] = pixels[o + 1] = pixels[o + 2] = b[at];
      pixels[o + 3] = 255;
    } else {
      pixels[o] = b[at + 2];
      pixels[o + 1] = b[at + 1];
      pixels[o + 2] = b[at];
      pixels[o + 3] = px === 4 ? b[at + 3] : 255;
    }
  };
  if (type === 2 || type === 3) for (let i = 0; i < n; i++, p += px) put(i, p);
  else
    for (let i = 0; i < n; ) {
      const head = b[p++], count = (head & 0x7f) + 1;
      if (head & 0x80) {
        for (let k = 0; k < count && i < n; k++) put(i++, p);
        p += px;
      } else for (let k = 0; k < count && i < n; k++, p += px) put(i++, p);
    }
  // Origin: bit 5 set = top-left, else bottom-left (flip); bit 4 = right-to-left (flip x).
  const out = new Uint8Array(n * 4);
  const top = !!(desc & 0x20), right = !!(desc & 0x10);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sy = top ? y : h - 1 - y, sx = right ? w - 1 - x : x;
      out.set(pixels.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
    }
  // Many 32-bit TGAs carry an all-zero alpha channel: treat that as opaque.
  if (px === 4 && !out.some((v, i) => i % 4 === 3 && v !== 0)) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { width: w, height: h, data: out };
}

/** Decode a texture file by its extension (.png, .tga). */
export function decodeImage(file: string, buf: Uint8Array): RgbaImage {
  if (/\.png$/i.test(file)) return decodePng(buf);
  if (/\.tga$/i.test(file)) return decodeTga(buf);
  throw new Error(`can't read ${file.split('.').pop()} textures (PNG and TGA only)`);
}
