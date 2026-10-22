// Moved from the old generator's packages/shared/src/map/transform.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { facingAngle, mirrorFacing, rotateFacing } from './stamp.js';
import { MAX_MAP_SIZE, type CellFootprint, type GroundLayer, type MapBody, type MapLayer, type MapObject, type Zone } from './types.js';
import { fail, footprintFor, layerFor, objectProblems, objectRect, snapAxis, terrainId, type OpOutcome, type OpsContext } from './ops.js';

/**
 * Whole-map and region edits that move everything at once (FB-063, FB-068):
 *
 * - `resize` changes the map's size and keeps its id and history: the old map is put at `anchor` (or `offset`) in
 *   the new one, ground corners, decoration, collision, objects and zones move with it, what falls outside is
 *   dropped (and reported), and new ground gets `fill`.
 * - `transform` mirrors (x or y) and / or turns (90, 180, 270 clockwise as seen on the map overview and on screen)
 *   the whole map or a rect of cells: ground corners, decoration, collision, objects (positions, facings and
 *   footprints) and zones. Turning the whole map by 90 or 270 swaps its width and height.
 */

// -------------------------------------------------------------------------------------------------- resize

/** Where the old map sits in the resized one, by the overview's sides (n = the top row, y = 0; w = x = 0). */
export const RESIZE_ANCHORS = ['nw', 'n', 'ne', 'w', 'centre', 'e', 'sw', 's', 'se'] as const;
export type ResizeAnchor = (typeof RESIZE_ANCHORS)[number];

const ANCHOR_ALIASES: Record<string, ResizeAnchor> = {
  'top-left': 'nw', topleft: 'nw', top: 'n', 'top-right': 'ne', topright: 'ne', left: 'w', center: 'centre', middle: 'centre', c: 'centre',
  right: 'e', 'bottom-left': 'sw', bottomleft: 'sw', bottom: 's', 'bottom-right': 'se', bottomright: 'se',
};

/** An anchor name (nw, n, …, centre, or top-left, top, …, bottom-right) → its canonical form. */
export function resizeAnchor(a: unknown): ResizeAnchor {
  if (typeof a !== 'string') return fail(`anchor must be one of ${RESIZE_ANCHORS.join(', ')} (or top-left, top, …, bottom-right)`);
  const k = a.trim().toLowerCase().replace(/[_ ]/g, '-');
  if ((RESIZE_ANCHORS as readonly string[]).includes(k)) return k as ResizeAnchor;
  return ANCHOR_ALIASES[k] ?? ANCHOR_ALIASES[k.replace(/-/g, '')] ?? fail(`anchor "${a}" must be one of ${RESIZE_ANCHORS.join(', ')} (or top-left, top, …, bottom-right)`);
}

/** Where the old map's cell (0, 0) lands in the new map for an anchor (centre rounds towards the top-left). */
export function resizeOffset(anchor: ResizeAnchor, from: { width: number; height: number }, to: { width: number; height: number }): [number, number] {
  const dw = to.width - from.width, dh = to.height - from.height;
  const [v, h] = anchor === 'centre' ? ['', ''] : [anchor.replace(/[we]/g, ''), anchor.replace(/[ns]/g, '')];
  const dx = h === 'w' ? 0 : h === 'e' ? dw : Math.floor(dw / 2);
  const dy = v === 'n' ? 0 : v === 's' ? dh : Math.floor(dh / 2);
  return [dx, dy];
}

/**
 * Resize a map. `anchor` (default nw: grow or cut on the east and south) or `offset` [dx, dy] (where the old cell
 * (0, 0) goes; negative cuts the west / north) places the old map in the new one. `fill` is the terrain new ground
 * corners get on the ground layer `layer` (default the first): a terrain id or name, or "edge" to extend the nearest
 * old corner; other ground layers and a missing fill take the commonest terrain on the old map's border.
 */
export interface ResizeOp {
  op: 'resize';
  width: number;
  height: number;
  anchor?: string;
  offset?: [number, number];
  fill?: string;
  layer?: string;
}

/** At most this many dropped objects / zones are listed one by one (the counts are always exact). */
const LIST_CAP = 50;

const int = (v: unknown, what: string): number => (typeof v === 'number' && Number.isInteger(v) ? v : fail(`${what} must be a whole number`));

/** The commonest terrain on the border corners of a ground layer ('' when there is none). */
function borderTerrain(corners: string[], w: number, h: number): string {
  const n = new Map<string, number>();
  const add = (x: number, y: number) => {
    const t = corners[y * (w + 1) + x] ?? '';
    n.set(t, (n.get(t) ?? 0) + 1);
  };
  for (let x = 0; x <= w; x++) add(x, 0), add(x, h);
  for (let y = 1; y < h; y++) add(0, y), add(w, y);
  let best = '', bn = -1;
  for (const [t, c] of n) if (c > bn || (c === bn && t && !best)) (best = t), (bn = c);
  return best;
}

const objectLabel = (o: MapObject) => `${o.id}${o.name ? ` (${o.name})` : ''} at (${o.x}, ${o.y})`;

export function opResize(doc: MapBody, op: ResizeOp, ctx: OpsContext): OpOutcome {
  const width = int(op.width, 'width'), height = int(op.height, 'height');
  if (width < 1 || height < 1 || width > MAX_MAP_SIZE || height > MAX_MAP_SIZE) fail(`width and height must be whole cells, 1–${MAX_MAP_SIZE}`);
  if (op.anchor !== undefined && op.offset !== undefined) fail('give anchor or offset, not both');
  let offset: [number, number];
  let anchor: ResizeAnchor | undefined;
  if (op.offset !== undefined) {
    if (!Array.isArray(op.offset) || op.offset.length !== 2) fail('offset must be [dx, dy] (whole cells: where the old cell (0, 0) goes)');
    offset = [int(op.offset[0], 'offset dx'), int(op.offset[1], 'offset dy')];
  } else {
    anchor = resizeAnchor(op.anchor ?? 'nw');
    offset = resizeOffset(anchor, doc, { width, height });
  }
  const [dx, dy] = offset;
  const W = doc.width, H = doc.height;
  if (dx >= width || dy >= height || dx + W <= 0 || dy + H <= 0) fail(`offset [${dx}, ${dy}] puts the whole ${W}×${H} map outside the new ${width}×${height} one`);
  if (op.fill !== undefined && typeof op.fill !== 'string') fail('fill must be a terrain id or name, or "edge"');
  const fillLayer = op.fill !== undefined || op.layer !== undefined ? layerFor(doc, 'ground', op.layer) : doc.layers.find((l): l is GroundLayer => l.type === 'ground');
  const fills: Record<string, string> = {};

  const grid = <T>(src: T[], sw: number, sh: number, nw: number, nh: number, def: (x: number, y: number) => T): T[] =>
    Array.from({ length: nw * nh }, (_, i) => {
      const x = i % nw, y = Math.floor(i / nw), ox = x - dx, oy = y - dy;
      return ox >= 0 && oy >= 0 && ox < sw && oy < sh ? src[oy * sw + ox] : def(x, y);
    });
  let cutDecoration = 0, cutCollision = 0;
  const cutCells = (cells: number[]) => {
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cells[y * W + x] && (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height)) n++;
    return n;
  };
  const droppedObjects: MapObject[] = [], droppedZones: Zone[] = [], clippedZones: string[] = [];
  const inMap = (x: number, y: number) => x >= -1e-6 && y >= -1e-6 && x <= width + 1e-6 && y <= height + 1e-6;

  const layers = doc.layers.map((l): MapLayer => {
    if (l.type === 'ground') {
      let fill: string;
      if (l === fillLayer && op.fill !== undefined) fill = op.fill === 'edge' ? 'edge' : terrainId(ctx, l, op.fill);
      else fill = borderTerrain(l.corners, W, H);
      fills[l.name] = fill;
      const def = fill === 'edge'
        ? (x: number, y: number) => l.corners[Math.min(H, Math.max(0, y - dy)) * (W + 1) + Math.min(W, Math.max(0, x - dx))]
        : () => fill;
      return { ...l, corners: grid(l.corners, W + 1, H + 1, width + 1, height + 1, def) };
    }
    if (l.type === 'decoration') {
      cutDecoration += cutCells(l.cells);
      return { ...l, cells: grid(l.cells, W, H, width, height, () => 0) };
    }
    if (l.type === 'collision') {
      cutCollision += cutCells(l.cells);
      return { ...l, cells: grid<0 | 1>(l.cells, W, H, width, height, () => 0), ...(l.opened ? { opened: grid<0 | 1>(l.opened, W, H, width, height, () => 0) } : {}) };
    }
    if (l.type === 'objects') {
      const objects: MapObject[] = [];
      for (const o of l.objects) {
        const moved = { ...o, x: o.x + dx, y: o.y + dy };
        const r = objectRect(moved);
        if (inMap(r[0], r[1]) && inMap(r[2], r[3])) objects.push(moved);
        else droppedObjects.push(o);
      }
      return { ...l, objects };
    }
    if (l.type === 'zones') {
      const zones: Zone[] = [];
      for (const z of l.zones) {
        const points = z.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
        if (points.every(([x, y]) => inMap(x, y))) zones.push({ ...z, points });
        else if (z.shape === 'rect' && points.length === 2) {
          // A rect keeps the part that is still on the map.
          const x0 = Math.max(0, Math.min(points[0][0], points[1][0])), x1 = Math.min(width, Math.max(points[0][0], points[1][0]));
          const y0 = Math.max(0, Math.min(points[0][1], points[1][1])), y1 = Math.min(height, Math.max(points[0][1], points[1][1]));
          if (x1 - x0 > 1e-6 && y1 - y0 > 1e-6) {
            zones.push({ ...z, points: [[x0, y0], [x1, y1]] });
            clippedZones.push(z.id);
          } else droppedZones.push(z);
        } else droppedZones.push(z);
      }
      return { ...l, zones };
    }
    return l;
  });
  const from = [W, H];
  Object.assign(doc, { width, height, layers });
  const list = <T>(xs: T[], f: (x: T) => string) => xs.slice(0, LIST_CAP).map(f).concat(xs.length > LIST_CAP ? [`… ${xs.length - LIST_CAP} more`] : []);
  return {
    report: {
      size: `${width}x${height}`, from: `${from[0]}x${from[1]}`, ...(anchor ? { anchor } : {}), offset: [dx, dy], fill: fills,
      ...(droppedObjects.length ? { droppedObjects: droppedObjects.length, dropped: list(droppedObjects, objectLabel) } : {}),
      ...(droppedZones.length ? { droppedZones: droppedZones.length, droppedZoneIds: list(droppedZones, (z) => `${z.id} (${z.kind} "${z.name}")`) } : {}),
      ...(clippedZones.length ? { clippedZones } : {}),
      ...(cutDecoration ? { droppedDecorationCells: cutDecoration } : {}),
      ...(cutCollision ? { droppedCollisionCells: cutCollision } : {}),
    },
  };
}

// ----------------------------------------------------------------------------------------------- transform

/**
 * Mirror and / or turn the map or the cells `rect` [x0, y0, x1, y1] (inclusive, like the rect brush). The mirror is
 * applied first, then the turn. mirror "x" flips along x (x → width − x, the west and east swap), "y" along y. rotate
 * is clockwise as seen on the overview (and on screen: on an iso map a SE facing becomes SW). A region turned by 90 or
 * 270 must be square; the whole map swaps its width and height. Objects whose anchor is in the region move (their
 * facing turns or mirrors with them, their footprint swaps), zones whose points all are in it move (the others stay
 * and are reported). Moved objects that would overlap others or leave the map are refused unless `allowOverlap`.
 */
export interface TransformOp {
  op: 'transform';
  mirror?: 'x' | 'y';
  rotate?: 0 | 90 | 180 | 270;
  rect?: [number, number, number, number];
  allowOverlap?: boolean;
}

/** A point map of a w × h box (local coordinates) and the box's size afterwards. */
interface BoxMap {
  pt: (x: number, y: number) => [number, number];
  w: number;
  h: number;
}

/** The box map of a mirror then a clockwise turn. */
export function boxTransform(w: number, h: number, mirror: 'x' | 'y' | undefined, rotate: number): BoxMap {
  const m = (x: number, y: number): [number, number] => (mirror === 'x' ? [w - x, y] : mirror === 'y' ? [x, h - y] : [x, y]);
  const q = ((rotate / 90) % 4 + 4) % 4;
  if (q === 0) return { pt: m, w, h };
  if (q === 1) return { pt: (x, y) => { const [a, b] = m(x, y); return [h - b, a]; }, w: h, h: w };
  if (q === 2) return { pt: (x, y) => { const [a, b] = m(x, y); return [w - a, h - b]; }, w, h };
  return { pt: (x, y) => { const [a, b] = m(x, y); return [b, w - a]; }, w: h, h: w };
}

/**
 * A facing after a mirror then a clockwise turn. Facings are screen directions: on an iso map +x is SE and +y SW, so
 * mirroring x reflects across the NE–SW line (SE ↔ NW, N ↔ E) and mirroring y across NW–SE; on an orthogonal map
 * across N–S and E–W. Names that are not directions stay as they are.
 */
export function transformFacing(name: string, orientation: MapBody['orientation'], mirror: 'x' | 'y' | undefined, rotate: number): string {
  let f = name;
  if (mirror) f = mirrorFacing(f, orientation === 'isometric' ? (mirror === 'x' ? 45 : 135) : mirror === 'x' ? 90 : 0);
  const q = ((rotate / 90) % 4 + 4) % 4;
  return q ? rotateFacing(f, q) : f;
}

/**
 * Of a sprite's facings, the one for `want`: itself, else the one on the same line nearest it (a 2-facing fence
 * mirrored to NW uses its SE picture), else the nearest.
 */
function availableFacing(have: string[], want: string): string | undefined {
  if (have.includes(want)) return want;
  const a = facingAngle(want);
  if (a === null) return undefined;
  let best: string | undefined, bd = Infinity;
  for (const n of have) {
    const b = facingAngle(n);
    if (b === null) continue;
    const d = Math.abs(((a - b + 540) % 360) - 180);
    const line = Math.min(d, 180 - d);
    // Same line first (a mirrored or turned symmetric sprite), then the nearest direction.
    const score = line * 1000 + d;
    if (score < bd - 1e-9) (bd = score), (best = n);
  }
  return best;
}

export function opTransform(doc: MapBody, op: TransformOp, ctx: OpsContext): OpOutcome {
  if (op.mirror !== undefined && op.mirror !== 'x' && op.mirror !== 'y') fail('mirror must be "x" or "y"');
  const rotate = op.rotate ?? 0;
  if (![0, 90, 180, 270].includes(rotate)) fail('rotate must be 0, 90, 180 or 270');
  if (!op.mirror && !rotate) fail('transform needs mirror ("x" or "y") and / or rotate (90, 180, 270)');
  const W = doc.width, H = doc.height;
  let bx = 0, by = 0, bw = W, bh = H;
  const whole = op.rect === undefined;
  if (!whole) {
    const r = op.rect!;
    if (!Array.isArray(r) || r.length !== 4 || r.some((v) => typeof v !== 'number' || !Number.isInteger(v))) fail('rect must be [x0, y0, x1, y1] (whole cells, inclusive)');
    const [x0, x1] = [r[0], r[2]].sort((a, b) => a - b), [y0, y1] = [r[1], r[3]].sort((a, b) => a - b);
    if (x0 < 0 || y0 < 0 || x1 >= W || y1 >= H) fail(`rect ${r.join(',')} is not inside the ${W}×${H} map (cells 0..${W - 1}, 0..${H - 1})`);
    (bx = x0), (by = y0), (bw = x1 - x0 + 1), (bh = y1 - y0 + 1);
    if ((rotate === 90 || rotate === 270) && bw !== bh) fail(`a region turned by ${rotate} must be square (rect is ${bw}×${bh} cells); turn the whole map, or use 180 / a mirror`);
  }
  const t = boxTransform(bw, bh, op.mirror, rotate);
  const nW = whole ? t.w : W, nH = whole ? t.h : H;
  /** A map point → its new map point. */
  const pt = (x: number, y: number): [number, number] => {
    const [a, b] = t.pt(x - bx, y - by);
    return [a + bx, b + by];
  };
  const inBox = (x: number, y: number, edge: boolean) =>
    edge ? x >= bx - 1e-6 && y >= by - 1e-6 && x <= bx + bw + 1e-6 && y <= by + bh + 1e-6 : x >= bx && y >= by && x < bx + bw && y < by + bh;

  /** Move a row-major grid of (bw + extra) × (bh + extra) points of the box (cells: extra 0, corners: extra 1). */
  const moveGrid = <T>(src: T[], extra: 0 | 1): T[] => {
    const sw = W + extra, nw = nW + extra;
    const out = whole ? new Array<T>((nW + extra) * (nH + extra)) : src.slice();
    const half = extra ? 0 : 0.5;
    for (let y = by; y < by + bh + extra; y++)
      for (let x = bx; x < bx + bw + extra; x++) {
        const [px, py] = pt(x + half, y + half);
        const nx = Math.round(px - half), ny = Math.round(py - half);
        out[ny * nw + nx] = src[y * sw + x];
      }
    return out;
  };

  const turnsFootprint = rotate === 90 || rotate === 270;
  const warnings: string[] = [];
  const moved: { layer: number; obj: MapObject }[] = [];
  let zonesMoved = 0, objectsMoved = 0;
  const zonesLeft: string[] = [];
  const layers = doc.layers.map((l, li): MapLayer => {
    if (l.type === 'ground') return { ...l, corners: moveGrid(l.corners, 1) };
    if (l.type === 'decoration') return { ...l, cells: moveGrid(l.cells, 0) };
    if (l.type === 'collision') return { ...l, cells: moveGrid(l.cells, 0), ...(l.opened ? { opened: moveGrid(l.opened, 0) } : {}) };
    if (l.type === 'objects')
      return {
        ...l,
        objects: l.objects.map((o) => {
          if (!whole && !inBox(o.x, o.y, false)) return o;
          const [x, y] = pt(o.x, o.y);
          let facing = o.facing !== undefined ? transformFacing(o.facing, doc.orientation, op.mirror, rotate) : undefined;
          let footprint: CellFootprint | undefined = o.footprint && turnsFootprint ? { w: o.footprint.h, h: o.footprint.w } : o.footprint;
          const known = o.spriteId !== undefined && ctx.sprites ? ctx.sprites[o.spriteId] : undefined;
          const have = Object.keys(known?.directions ?? {});
          if (facing !== undefined && have.length && !have.includes(facing)) {
            const to = availableFacing(have, facing);
            if (to !== undefined) {
              warnings.push(`${o.id}${o.name ? ` (${o.name})` : ''}: sprite ${o.spriteId} has no facing "${facing}" (facings: ${have.join(', ')}); used ${to}`);
              facing = to;
            }
          }
          if (known && facing !== undefined && known.directions?.[facing] && o.footprint) {
            footprint = footprintFor(known, facing) ?? footprint;
          }
          let nx = x, ny = y;
          // A footprint that is not the turned one (per-facing spans) re-snaps like a placed object.
          const geo = o.footprint && turnsFootprint ? { w: o.footprint.h, h: o.footprint.w } : o.footprint;
          if (footprint && geo && (footprint.w !== geo.w || footprint.h !== geo.h)) (nx = snapAxis(nx, footprint.w)), (ny = snapAxis(ny, footprint.h));
          const next: MapObject = { ...o, x: nx, y: ny, ...(footprint ? { footprint } : {}), ...(facing !== undefined ? { facing } : {}) };
          moved.push({ layer: li, obj: next });
          objectsMoved++;
          return next;
        }),
      };
    if (l.type === 'zones')
      return {
        ...l,
        zones: l.zones.map((z) => {
          if (!whole && !z.points.every(([x, y]) => inBox(x, y, true))) {
            if (z.points.some(([x, y]) => inBox(x, y, true))) zonesLeft.push(z.id);
            return z;
          }
          zonesMoved++;
          let points = z.points.map(([x, y]) => pt(x, y));
          if (z.shape === 'rect' && points.length === 2) {
            const [[ax, ay], [cx, cy]] = points;
            points = [[Math.min(ax, cx), Math.min(ay, cy)], [Math.max(ax, cx), Math.max(ay, cy)]];
          }
          return { ...z, points };
        }),
      };
    return l;
  });
  const next: MapBody = { ...doc, width: nW, height: nH, layers };
  if (!op.allowOverlap) {
    const problems: string[] = [];
    for (const m of moved) problems.push(...objectProblems(next, next.layers[m.layer] as Extract<MapLayer, { type: 'objects' }>, m.obj));
    if (problems.length) fail(`${[...new Set(problems)].slice(0, 8).join('; ')}${problems.length > 8 ? ` (… ${problems.length - 8} more)` : ''}; allowOverlap: true moves them anyway`);
  }
  Object.assign(doc, { width: nW, height: nH, layers });
  return {
    report: {
      ...(op.mirror ? { mirror: op.mirror } : {}), ...(rotate ? { rotate } : {}),
      region: whole ? 'map' : [bx, by, bx + bw - 1, by + bh - 1],
      ...(whole && (nW !== W || nH !== H) ? { size: `${nW}x${nH}`, from: `${W}x${H}` } : {}),
      objects: objectsMoved, zones: zonesMoved,
      ...(zonesLeft.length ? { zonesLeft, note: 'zones partly outside the rect were left where they are' } : {}),
      ...(warnings.length ? { warnings: warnings.slice(0, 30) } : {}),
    },
  };
}
