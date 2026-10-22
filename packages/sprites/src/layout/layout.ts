// Moved from synty-sprite-generator packages/shared/src/export/layout.ts (P2, ali3b/sloponator#8).
/**
 * Sheet layout: where each rendered frame goes on which page. Pure geometry, no images.
 *
 * Modes:
 *   grid     one row per (clip, rendered direction), one column per frame. Rows overflow onto new pages; a clip
 *            too long for one page width continues on the next row (every frame's rectangle is in the metadata).
 *   strips   one page per (clip, direction): a single row (GameMaker "_stripN" images, Unity animation strips).
 *   atlas    MaxRects bin packing of (optionally trimmed) frames, multi-page.
 */

export type LayoutMode = 'grid' | 'strips' | 'atlas';

export interface LayoutSettings {
  mode: LayoutMode;
  /** One sheet for everything, or a separate sheet (set of pages) per clip. */
  grouping: 'single' | 'per-clip';
  /** Atlas only: cut transparent borders (offsets are kept in the metadata). */
  trim: boolean;
  /** Empty pixels between frames. */
  padding: number;
  /** Atlas only: repeat each frame's edge pixels outward to stop texture bleeding. */
  extrude: number;
  powerOfTwo: boolean;
  /** Maximum page width/height. */
  maxSize: number;
}

export interface FrameInput {
  key: string;
  clip: string;
  /** Rendered direction name (mirrored directions have no frames of their own). */
  direction: string;
  index: number;
  width: number;
  height: number;
  /** Opaque bounding box inside the frame, or null for a fully transparent frame. */
  opaque: { x: number; y: number; w: number; h: number } | null;
}

export interface Placement {
  key: string;
  /** Rectangle on the page. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where that rectangle came from inside the untrimmed frame. */
  trimX: number;
  trimY: number;
  sourceW: number;
  sourceH: number;
  trimmed: boolean;
}

export interface Page {
  index: number;
  /** Clip this page belongs to when grouping per clip, otherwise null. */
  clip: string | null;
  /** Direction for strip pages. */
  direction: string | null;
  width: number;
  height: number;
  placements: Placement[];
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

function finish(page: Omit<Page, 'width' | 'height'> & { width: number; height: number }, s: LayoutSettings): Page {
  return s.powerOfTwo ? { ...page, width: nextPow2(page.width), height: nextPow2(page.height) } : page;
}

function groupBy<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

const full = (f: FrameInput, x: number, y: number): Placement => ({
  key: f.key, x, y, w: f.width, h: f.height, trimX: 0, trimY: 0, sourceW: f.width, sourceH: f.height, trimmed: false,
});

/** Rows of frames -> pages, starting a new page when the next row would exceed maxSize. */
function rowsToPages(rows: FrameInput[][], s: LayoutSettings, clip: string | null, startIndex: number): Page[] {
  const pages: Page[] = [];
  let cur: Placement[] = [];
  let y = 0;
  let width = 0;
  const flush = () => {
    if (!cur.length) return;
    pages.push(finish({ index: startIndex + pages.length, clip, direction: null, width, height: y - s.padding, placements: cur }, s));
    cur = [];
    y = 0;
    width = 0;
  };
  for (const row of rows) {
    const h = Math.max(...row.map((f) => f.height));
    const w = row.reduce((sum, f) => sum + f.width, 0) + s.padding * (row.length - 1);
    if (w > s.maxSize) throw new LayoutError(`this animation is ${row.length} frames long: ${w}px in one strip, over the ${s.maxSize}px image limit — use fewer frames per second, a smaller frame, or a format with a grid or atlas layout`);
    if (y + h > s.maxSize) flush();
    let x = 0;
    for (const f of row) {
      cur.push(full(f, x, y));
      x += f.width + s.padding;
    }
    width = Math.max(width, w);
    y += h + s.padding;
  }
  flush();
  return pages;
}

export class LayoutError extends Error {}

/** Split a row that is wider than a page into rows that fit (same order). */
function wrapRow(row: FrameInput[], s: LayoutSettings): FrameInput[][] {
  const out: FrameInput[][] = [];
  let cur: FrameInput[] = [];
  let w = 0;
  for (const f of row) {
    const add = (cur.length ? s.padding : 0) + f.width;
    if (cur.length && w + add > s.maxSize) {
      out.push(cur);
      cur = [];
      w = 0;
    }
    w += cur.length ? s.padding + f.width : f.width;
    cur.push(f);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * MaxRects bin packer (Best Short Side Fit). Rectangles include padding/extrusion; returns pages of
 * placements. Deterministic for a given input order.
 */
export function packRects(rects: { key: string; w: number; h: number }[], maxSize: number) {
  type Free = { x: number; y: number; w: number; h: number };
  const pages: { placed: { key: string; x: number; y: number; w: number; h: number }[]; free: Free[] }[] = [];
  // Big first packs tighter.
  const order = [...rects].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  for (const r of order) {
    if (r.w > maxSize || r.h > maxSize) throw new LayoutError(`a ${r.w}×${r.h} frame does not fit a ${maxSize}px page`);
    let placed = false;
    for (const page of pages) {
      const spot = bestFit(page.free, r.w, r.h);
      if (spot) {
        place(page, { key: r.key, x: spot.x, y: spot.y, w: r.w, h: r.h });
        placed = true;
        break;
      }
    }
    if (!placed) {
      const page = { placed: [], free: [{ x: 0, y: 0, w: maxSize, h: maxSize }] };
      pages.push(page);
      place(page, { key: r.key, x: 0, y: 0, w: r.w, h: r.h });
    }
  }
  return pages.map((p) => p.placed);

  function bestFit(free: Free[], w: number, h: number) {
    let best: Free | null = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    for (const f of free) {
      if (f.w < w || f.h < h) continue;
      const short = Math.min(f.w - w, f.h - h);
      const long = Math.max(f.w - w, f.h - h);
      if (short < bestShort || (short === bestShort && long < bestLong)) {
        best = f;
        bestShort = short;
        bestLong = long;
      }
    }
    return best;
  }

  function place(page: (typeof pages)[number], r: { key: string; x: number; y: number; w: number; h: number }) {
    page.placed.push(r);
    const next: Free[] = [];
    for (const f of page.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
        next.push(f);
        continue;
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    // Drop free rectangles contained in another (of exact duplicates, keep the first).
    const inside = (a: Free, b: Free) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    const same = (a: Free, b: Free) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    page.free = next.filter((a, i) => !next.some((b, j) => j !== i && inside(a, b) && (!same(a, b) || j < i)));
  }
}

function atlasPages(frames: FrameInput[], s: LayoutSettings, clip: string | null, startIndex: number): Page[] {
  const gap = s.padding + 2 * s.extrude;
  const sized = frames.map((f) => {
    const t = s.trim && f.opaque ? f.opaque : { x: 0, y: 0, w: f.width, h: f.height };
    // Fully transparent frames keep a 1×1 placeholder so every frame still has a rectangle.
    const rect = s.trim && !f.opaque ? { x: 0, y: 0, w: 1, h: 1 } : t;
    return { f, rect };
  });
  const byKey = new Map(sized.map((x) => [x.f.key, x]));
  const packed = packRects(sized.map(({ f, rect }) => ({ key: f.key, w: rect.w + gap, h: rect.h + gap })), s.maxSize);
  return packed.map((placed, i) => {
    const placements = placed.map((p) => {
      const { f, rect } = byKey.get(p.key)!;
      return {
        key: f.key, x: p.x + s.extrude, y: p.y + s.extrude, w: rect.w, h: rect.h,
        trimX: rect.x, trimY: rect.y, sourceW: f.width, sourceH: f.height,
        trimmed: rect.w !== f.width || rect.h !== f.height,
      };
    });
    const width = Math.max(...placed.map((p) => p.x + p.w)) - s.padding;
    const height = Math.max(...placed.map((p) => p.y + p.h)) - s.padding;
    return finish({ index: startIndex + i, clip, direction: null, width, height, placements }, s);
  });
}

/** Lay out frames into pages. Frames must arrive in clip -> direction -> frame order. */
export function layoutFrames(frames: FrameInput[], s: LayoutSettings): Page[] {
  const groups = s.grouping === 'per-clip' ? [...groupBy(frames, (f) => f.clip).entries()] : [[null, frames] as const];
  const pages: Page[] = [];
  for (const [clip, list] of groups) {
    if (s.mode === 'atlas') pages.push(...atlasPages([...list], s, clip, pages.length));
    else if (s.mode === 'strips') {
      for (const [k, row] of groupBy([...list], (f) => `${f.clip}\u0000${f.direction}`)) {
        const [c, d] = k.split('\u0000');
        for (const p of rowsToPages([row], s, c, pages.length)) pages.push({ ...p, clip: c, direction: d });
      }
    } else {
      const rows = [...groupBy([...list], (f) => `${f.clip}\u0000${f.direction}`).values()].flatMap((r) => wrapRow(r, s));
      pages.push(...rowsToPages(rows, s, clip, pages.length));
    }
  }
  return pages;
}
