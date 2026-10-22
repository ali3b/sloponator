import type { StyleConfig } from '@slop/sprites';

/**
 * 2D stylization of a rendered frame: colour grading, a tiled texture over the sprite, and an outline drawn
 * around the silhouette. Works on straight (non-premultiplied) RGBA pixels and keeps alpha, so layered
 * sheets still compose. The same code styles the Studio preview and the export.
 */

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Grade pixels in place (brightness/contrast/saturation/hue/posterize), alpha untouched. */
export function gradePixels(data: Uint8ClampedArray, g: NonNullable<StyleConfig['grade']>) {
  const b = (g.brightness ?? 0) * 255, c = 1 + (g.contrast ?? 0), sat = 1 + (g.saturation ?? 0), hue = ((g.hue ?? 0) * Math.PI) / 180;
  const levels = g.posterize && g.posterize > 1 ? g.posterize : 0;
  const cosH = Math.cos(hue), sinH = Math.sin(hue);
  // Hue rotation in YIQ space (cheap and good enough for sprites).
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i], gg = data[i + 1], bl = data[i + 2];
    if (hue) {
      const y = 0.299 * r + 0.587 * gg + 0.114 * bl, iq = 0.596 * r - 0.274 * gg - 0.322 * bl, q = 0.211 * r - 0.523 * gg + 0.312 * bl;
      const i2 = iq * cosH - q * sinH, q2 = iq * sinH + q * cosH;
      r = y + 0.956 * i2 + 0.621 * q2;
      gg = y - 0.272 * i2 - 0.647 * q2;
      bl = y - 1.106 * i2 + 1.703 * q2;
    }
    if (sat !== 1) {
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * bl;
      r = l + (r - l) * sat;
      gg = l + (gg - l) * sat;
      bl = l + (bl - l) * sat;
    }
    if (c !== 1 || b) {
      r = (r - 128) * c + 128 + b;
      gg = (gg - 128) * c + 128 + b;
      bl = (bl - 128) * c + 128 + b;
    }
    if (levels) {
      const q = 255 / (levels - 1);
      r = Math.round(r / q) * q;
      gg = Math.round(gg / q) * q;
      bl = Math.round(bl / q) * q;
    }
    data[i] = clamp(r);
    data[i + 1] = clamp(gg);
    data[i + 2] = clamp(bl);
  }
}

/** A grey texture tile (0..255 per pixel), deterministic. */
export function overlayTile(texture: 'paper' | 'canvas' | 'noise', size = 64): Uint8Array {
  const out = new Uint8Array(size * size);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // Value noise at two scales, tileable by wrapping the lattice.
  const lattice = (n: number) => Array.from({ length: n * n }, () => rnd());
  const l1 = lattice(8), l2 = lattice(16);
  const sample = (l: number[], n: number, x: number, y: number) => {
    const fx = (x / size) * n, fy = (y / size) * n;
    const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sm = (t: number) => t * t * (3 - 2 * t);
    const a = l[y0 * n + x0] + (l[y0 * n + x1] - l[y0 * n + x0]) * sm(tx);
    const b = l[y1 * n + x0] + (l[y1 * n + x1] - l[y1 * n + x0]) * sm(tx);
    return a + (b - a) * sm(ty);
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v: number;
      if (texture === 'noise') v = rnd();
      else if (texture === 'canvas') v = 0.5 + 0.25 * Math.sin((x / size) * Math.PI * 16) * Math.sin((y / size) * Math.PI * 16) + 0.15 * (sample(l2, 16, x, y) - 0.5);
      else v = 0.5 + 0.3 * (sample(l1, 8, x, y) - 0.5) + 0.2 * (sample(l2, 16, x, y) - 0.5);
      out[y * size + x] = clamp(Math.round(v * 255));
    }
  return out;
}

const tiles = new Map<string, Uint8Array>();
const tile = (t: 'paper' | 'canvas' | 'noise') => tiles.get(t) ?? (tiles.set(t, overlayTile(t)), tiles.get(t)!);

/** Multiply or overlay a texture tile onto the opaque pixels. */
export function overlayPixels(data: Uint8ClampedArray, w: number, h: number, o: NonNullable<StyleConfig['overlay']>) {
  if (o.texture === 'none' || o.opacity <= 0) return;
  const t = tile(o.texture), n = 64, k = Math.max(0, Math.min(1, o.opacity));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;
      const g = t[(y % n) * n + (x % n)] / 255;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c] / 255;
        const mixed = o.blend === 'multiply' ? v * (0.5 + g) : v < 0.5 ? 2 * v * g : 1 - 2 * (1 - v) * (1 - g);
        data[i + c] = clamp(Math.round((v + (mixed - v) * k) * 255));
      }
    }
}

/** Alpha-dilation outline: returns a new buffer with the outline colour under the sprite. */
export function outlinePixels(data: Uint8ClampedArray, w: number, h: number, o: NonNullable<StyleConfig['outline']>) {
  if (!o.width) return data;
  const out = new Uint8ClampedArray(data);
  const m = o.color.replace('#', '');
  const cr = parseInt(m.slice(0, 2), 16) || 0, cg = parseInt(m.slice(2, 4), 16) || 0, cb = parseInt(m.slice(4, 6), 16) || 0;
  const r = o.width;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] >= 128) continue;
      // Strongest neighbour alpha within the radius (circle-ish).
      let best = 0;
      for (let dy = -r; dy <= r && best < 255; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 0.5) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const a = data[(yy * w + xx) * 4 + 3];
          if (a > best) best = a;
        }
      // Only the sprite's own silhouette gets an outline, not the soft ground shadow or faint glow.
      if (best < 128) continue;
      const a = o.soft ? best : 255;
      // Outline under the (semi-transparent) pixel: source-over of the pixel on the outline colour.
      const pa = data[i + 3] / 255, oa = a / 255;
      const outA = pa + oa * (1 - pa);
      for (let c = 0; c < 3; c++) {
        const pc = data[i + c], oc = [cr, cg, cb][c];
        out[i + c] = outA > 0 ? clamp(Math.round((pc * pa + oc * oa * (1 - pa)) / outA)) : oc;
      }
      out[i + 3] = clamp(Math.round(outA * 255));
    }
  return out;
}

/** Everything in order: grade, texture, then the outline (so the outline is not graded). */
export function stylePixels(data: Uint8ClampedArray, w: number, h: number, style: StyleConfig): Uint8ClampedArray {
  if (style.grade) gradePixels(data, style.grade);
  if (style.overlay) overlayPixels(data, w, h, style.overlay);
  return style.outline ? outlinePixels(data, w, h, style.outline) : data;
}

export const hasStyle = (s: StyleConfig | undefined | null) =>
  !!s && (!!s.outline?.width || !!s.grade || (!!s.overlay && s.overlay.texture !== 'none' && s.overlay.opacity > 0));

/** Style a canvas in place. */
export function applyStyle(canvas: HTMLCanvasElement, style: StyleConfig | undefined | null) {
  if (!hasStyle(style)) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = stylePixels(img.data, canvas.width, canvas.height, style!);
  ctx.putImageData(out === img.data ? img : new ImageData(out, canvas.width, canvas.height), 0, 0);
}
