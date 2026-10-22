// Moved from the old generator's packages/shared/src/map/draw.ts (ali3b/sloponator#17, #18).
import type { RgbaImage } from '../tileset/raster.js';

/**
 * Small raster helpers for the map preview (pure TS, deterministic): alpha blending, lines, polygon fills and a
 * 3×5 bitmap font for labels. Colours are [r, g, b, a] with a in 0–1.
 */

export type Rgba = [number, number, number, number];

/** Blend colour c over pixel (x, y) (source-over, straight alpha). Outside the image is ignored. */
export function blendPixel(img: RgbaImage, x: number, y: number, c: Rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const a = c[3];
  if (a <= 0) return;
  const d = img.data;
  const da = d[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) d[i + k] = Math.round((c[k] * a + d[i + k] * da * (1 - a)) / oa);
  d[i + 3] = Math.round(oa * 255);
}

/** A line from (x0, y0) to (x1, y1) in pixels, `width` pixels thick (square brush), each pixel blended once. */
export function drawLine(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, c: Rgba, width = 1) {
  const seen = new Set<number>();
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  const r0 = -Math.floor((width - 1) / 2), r1 = r0 + width - 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.floor(x0 + (x1 - x0) * t), cy = Math.floor(y0 + (y1 - y0) * t);
    for (let dy = r0; dy <= r1; dy++)
      for (let dx = r0; dx <= r1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const k = y * img.width + x;
        if (seen.has(k)) continue;
        seen.add(k);
        blendPixel(img, x, y, c);
      }
  }
}

/** A closed (or open) path through `pts`. */
export function strokePath(img: RgbaImage, pts: [number, number][], c: Rgba, width = 1, closed = true) {
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    drawLine(img, a[0], a[1], b[0], b[1], c, width);
  }
}

/** Fill a polygon (even-odd, pixel centres inside). */
export function fillPolygon(img: RgbaImage, pts: [number, number][], c: Rgba) {
  if (pts.length < 3) return;
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(img.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(img.width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) blendPixel(img, x, y, c);
    }
  }
}

export function fillRect(img: RgbaImage, x: number, y: number, w: number, h: number, c: Rgba) {
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(img.height, Math.floor(y + h)); yy++)
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(img.width, Math.floor(x + w)); xx++) blendPixel(img, xx, yy, c);
}

// 3×5 glyphs, rows top to bottom, 3 bits each (left = high bit).
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110', '4': '101101111001001',
  '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', '-': '000000111000000',
  _: '000000000000111', '(': '001010010010001', ')': '100010010010100', '/': '001001010100100', '#': '101111101111101',
  "'": '010010000000000', '!': '010010010000010', '?': '110001010000010', '+': '000010111010000', '=': '000111000111000',
  '"': '101101000000000', '<': '001010100010001', '>': '100010001010100', '*': '000101010101000', '%': '101001010100101',
  '&': '010101010101011', '[': '011010010010011', ']': '110010010010110',
};

export const FONT_W = 3, FONT_H = 5;

/** Width in pixels of `text` at font scale `s` (1 px gap between glyphs). */
export const textWidth = (text: string, s = 1) => (text.length ? text.length * (FONT_W + 1) * s - s : 0);

/** Draw text (upper-cased; unknown characters as '?') with its top-left at (x, y). */
export function drawText(img: RgbaImage, text: string, x: number, y: number, c: Rgba, s = 1) {
  let cx = Math.round(x);
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS['?'];
    for (let r = 0; r < FONT_H; r++)
      for (let k = 0; k < FONT_W; k++) if (g[r * FONT_W + k] === '1') fillRect(img, cx + k * s, Math.round(y) + r * s, s, s, c);
    cx += (FONT_W + 1) * s;
  }
}

/** A label: text on a dark box, centred on (x, y) horizontally, its top at y. Returns the box. */
export function drawLabel(img: RgbaImage, text: string, x: number, y: number, c: Rgba, s = 1, bg: Rgba = [16, 18, 22, 0.72]) {
  const w = textWidth(text, s) + 4 * s, h = FONT_H * s + 4 * s;
  const left = Math.round(x - w / 2), top = Math.round(y);
  fillRect(img, left, top, w, h, bg);
  drawText(img, text, left + 2 * s, top + 2 * s, c, s);
  return { x: left, y: top, w, h };
}

// ------------------------------------------------------------------------------------------- label placement

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A label to place: `text` that belongs to the point (x, y); its preferred box is centred on x with its top at y + dy. */
export interface LabelRequest {
  text: string;
  x: number;
  y: number;
  /** Preferred top of the box relative to y (default 0). */
  dy?: number;
  color: Rgba;
  /**
   * The box's measured size (another renderer's font, e.g. the web editor's canvas text, in its own pixels); without
   * it the box is the 3×5 font's at the scale given to placeLabels.
   */
  w?: number;
  h?: number;
}

export interface PlacedLabel extends LabelRequest {
  box: Box;
  /** Moved away from its point: drawn with a line back to it. */
  leader: boolean;
}

/** The box drawLabel draws for `text` at font scale s. */
export const labelSize = (text: string, s = 1) => ({ w: textWidth(text, s) + 4 * s, h: FONT_H * s + 4 * s });

export const boxesOverlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place labels so their boxes do not overlap each other or the `avoid` boxes (markers), in order (earlier labels
 * keep their spot): each tries its preferred spot, then spots around it nearest first (above before below, right
 * before left), within the image. One that had to move further than its own size gets a leader line. When nothing
 * is free within `rings` steps it keeps its preferred spot (overlapping).
 */
export function placeLabels<R extends LabelRequest>(reqs: R[], size: { width: number; height: number }, s = 1, o: { avoid?: Box[]; rings?: number; gap?: number } = {}): (R & PlacedLabel)[] {
  const gap = o.gap ?? 2 * s;
  const rings = o.rings ?? 8;
  const taken: Box[] = [];
  const avoid = o.avoid ?? [];
  const out: (R & PlacedLabel)[] = [];
  const inside = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= size.width && b.y + b.h <= size.height;
  for (const r of reqs) {
    const fallback = labelSize(r.text, s);
    const w = r.w ?? fallback.w, h = r.h ?? fallback.h;
    const px = Math.round(r.x - w / 2), py = Math.round(r.y + (r.dy ?? 0));
    const sx = Math.ceil(w / 2) + gap, sy = h + gap;
    const cands: { i: number; j: number; d: number }[] = [];
    for (let j = -rings; j <= rings; j++) for (let i = -rings; i <= rings; i++) cands.push({ i, j, d: Math.hypot(i * sx, j * sy) + (j > 0 ? 0.5 : 0) + (i < 0 ? 0.25 : 0) });
    cands.sort((a, b) => a.d - b.d);
    let best: Box | null = null;
    for (const c of cands) {
      const b = { x: px + c.i * sx, y: py + c.j * sy, w, h };
      if (!inside(b) && (c.i || c.j)) continue;
      if (taken.some((t) => boxesOverlap(t, b)) || avoid.some((t) => boxesOverlap(t, b))) continue;
      best = b;
      break;
    }
    const box = best ?? { x: Math.max(0, Math.min(size.width - w, px)), y: Math.max(0, Math.min(size.height - h, py)), w, h };
    taken.push(box);
    // A box further from its point than the preferred spot is (plus a little) needs a line back to it.
    const away = (b: Box) => Math.hypot(Math.max(b.x - r.x, 0, r.x - (b.x + b.w)), Math.max(b.y - r.y, 0, r.y - (b.y + b.h)));
    const pref = { x: px, y: py, w, h };
    out.push({ ...r, box, leader: away(box) > away(pref) + gap + 1 });
  }
  return out;
}

/** Draw placed labels: leader lines first, then the boxes with their text. */
export function drawPlacedLabels(img: RgbaImage, labels: PlacedLabel[], s = 1) {
  for (const l of labels)
    if (l.leader) {
      // From the point to the nearest point of the box.
      const tx = Math.max(l.box.x, Math.min(l.x, l.box.x + l.box.w - 1)), ty = Math.max(l.box.y, Math.min(l.y, l.box.y + l.box.h - 1));
      drawLine(img, Math.round(l.x), Math.round(l.y), tx, ty, [l.color[0], l.color[1], l.color[2], 0.85], s);
    }
  for (const l of labels) drawLabel(img, l.text, l.box.x + l.box.w / 2, l.box.y, l.color, s);
}

export const hexToRgba =(hex: string, a = 1): Rgba => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};
