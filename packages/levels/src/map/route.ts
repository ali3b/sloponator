// Moved from the old generator's packages/shared/src/map/route.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { fail, objectRect } from './ops.js';
import { zoneDistance } from './generate.js';
import type { MapBody, MapObject, Zone } from './types.js';

/**
 * FB-110: walkable routes over a map. A route is a chain of cells from one end to the other, 8-connected (a diagonal
 * step only when both cells beside it are open, so it never squeezes between two blocked corners), that steps on no
 * blocked cell: a collision layer's blocked cells and the cells under solid objects' footprints (not markers with
 * `collision: false`, nor objects standing `on` another, nor point objects without a footprint). It is the shortest
 * such chain (A*; a step costs 1 cell, a diagonal √2), measured in cells and metres.
 *
 * An end is a zone (id, or name when no id matches) or a point "x,y" / [x, y] in map coordinates. A zone's cells are
 * those it covers (a point: its cell; a rect or polygon: the cells it overlaps / whose centre is inside; a polyline:
 * the cells it runs through). When every one of them is blocked (an objective inside a bunker's footprint), the
 * open cells around them are used instead and the result says so.
 *
 * FB-125: `clearance` (metres, default 0) keeps the route that far off whatever blocks: a cell is open only when no
 * blocked cell or solid object comes within half a cell plus the clearance of its centre: the walker fills its cell
 * and keeps the clearance beyond it. Any clearance above 0 closes the cells right beside a blocked one (so a one-cell
 * gap between two props is no way through); diagonal neighbours close from about 0.21 cells of clearance, and each
 * further cell of clearance adds a ring. Clearance 0 is the plain grid as before (polygons ignored), for backward
 * compatibility.
 *
 * FB-128: with a clearance, a solid object is measured from its sprite's ground collision polygon when it has one (a
 * tree's trunk, a rock's outline: the cells the polygon overlaps and every cell within half a cell plus the
 * clearance of it), and its footprint cells (a tree's 3×3 or 6×6 canopy) do not block. Objects without a polygon
 * (no sprite, no render, an export without collision) keep their footprint, so a wood of such trees stays closed.
 */

export type RouteEnd = string | [number, number];

export interface RouteOptions {
  /** Diagonal steps (default true); false = 4-connected. */
  diagonal?: boolean;
  /** Ignore object footprints (collision layers only). */
  ignoreObjects?: boolean;
  /** FB-125: metres to keep clear of blocked cells and solid objects (FB-128: their collision polygons, else footprints; default 0). */
  clearance?: number;
  /**
   * FB-125: a solid object's ground collision polygon, map cells around its anchor. FB-128: with clearance > 0 it
   * stands in for the object's footprint (objects without one keep their footprint); ignored at clearance 0.
   */
  collisionPolygon?: CollisionPolygonOf;
}

/** FB-125: an object's ground collision polygon in map cells around its anchor (null / undefined: none known). */
export type CollisionPolygonOf = (obj: MapObject) => [number, number][] | null | undefined;

/** FB-125: the most clearance a route takes, in cells. */
export const MAX_CLEARANCE_CELLS = 16;

export interface RouteEndInfo {
  ref: string;
  /** The zone the end names (its id), when it is one. */
  zone?: string;
  /** Open cells the route may start / end on. */
  cells: number;
  /** Set when the end's own cells are all blocked and the open cells around them were used. */
  note?: string;
}

export interface RouteResult {
  found: boolean;
  from: RouteEndInfo;
  to: RouteEndInfo;
  /** The route's cells in order (whole cell indices), from the first to the last. */
  cells: [number, number][];
  /** Cell centres where the route turns, both ends included: a compact polyline of it (map coordinates). */
  waypoints: [number, number][];
  /** Steps taken (cells − 1). */
  steps: number;
  /** Length in cells (a diagonal step counts √2) and in metres. */
  lengthCells: number;
  metres: number;
  /** No route: why, and the reachable cell that came closest to the far end (and how far it still is, in metres). */
  reason?: string;
  closest?: [number, number];
  closestMetres?: number;
  /** FB-125: the clearance asked for (metres; absent when 0). */
  clearance?: number;
  /** FB-125: with a clearance and no route: whether there is one without it (and its length). */
  withoutClearance?: { found: boolean; metres?: number };
}

const EPS = 1e-6;

const solid = (obj: MapObject) => !!obj.footprint && obj.collision !== false && obj.on === undefined;

/** FB-125: a route's clearance in cells (0 when none), checked. */
export function clearanceCells(doc: Pick<MapBody, 'metresPerTile'>, clearance: unknown): number {
  if (clearance === undefined || clearance === null) return 0;
  if (typeof clearance !== 'number' || !Number.isFinite(clearance) || clearance < 0) fail('clearance must be metres ≥ 0');
  const c = (clearance as number) / doc.metresPerTile;
  if (c > MAX_CLEARANCE_CELLS + EPS) fail(`clearance must be at most ${MAX_CLEARANCE_CELLS * doc.metresPerTile} m (${MAX_CLEARANCE_CELLS} cells on this map)`);
  return c;
}

/**
 * Cells (row-major, 1 = blocked) a walker may not step on: collision layers and solid object footprints, and with a
 * clearance every cell within half a cell plus the clearance of them. FB-128: with a clearance, a solid object with
 * a ground collision polygon blocks by that polygon (the cells it overlaps, and those within half a cell plus the
 * clearance of it) instead of its footprint; objects without one block by their footprint.
 */
export function blockedGrid(doc: MapBody, o: RouteOptions = {}): Uint8Array {
  const W = doc.width, H = doc.height;
  const c = clearanceCells(doc, o.clearance);
  const b = new Uint8Array(W * H);
  const boxes: [number, number, number, number][] = [];
  const polygons: [number, number][][] = [];
  for (const l of doc.layers) {
    if (l.type === 'collision') for (let i = 0; i < W * H; i++) if (l.cells[i]) b[i] = 1;
    if (l.type === 'objects' && !o.ignoreObjects)
      for (const obj of l.objects) {
        if (!solid(obj)) continue;
        // FB-128: with a clearance, the collision polygon stands in for the footprint.
        const poly = c > EPS ? o.collisionPolygon?.(obj) : null;
        if (poly && poly.length >= 3) {
          polygons.push(poly.map(([u, v]): [number, number] => [obj.x + u, obj.y + v]));
          continue;
        }
        const r = objectRect(obj);
        boxes.push(r);
        for (let y = Math.max(0, Math.floor(r[1] + EPS)); y < Math.min(H, Math.ceil(r[3] - EPS)); y++)
          for (let x = Math.max(0, Math.floor(r[0] + EPS)); x < Math.min(W, Math.ceil(r[2] - EPS)); x++) b[y * W + x] = 1;
      }
  }
  return c > EPS ? inflate(doc, b, boxes, polygons, c) : b;
}

/** Whether segment a→b crosses the inside of the square [x, x + 1] × [y, y + 1] (Liang–Barsky; its edges excluded). */
function segmentInCell(ax: number, ay: number, bx: number, by: number, x: number, y: number): boolean {
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  const dx = bx - ax, dy = by - ay;
  return clip(-dx, ax - (x + EPS)) && clip(dx, x + 1 - EPS - ax) && clip(-dy, ay - (y + EPS)) && clip(dy, y + 1 - EPS - ay) && t1 - t0 > 1e-9;
}

/** FB-128: whether a polygon (map cells) overlaps cell (x, y). */
function polygonInCell(points: [number, number][], x: number, y: number): boolean {
  if (zoneDistance({ shape: 'polygon', points }, x + 0.5, y + 0.5) === 0) return true;
  for (let k = 0, j = points.length - 1; k < points.length; j = k++)
    if (segmentInCell(points[j][0], points[j][1], points[k][0], points[k][1], x, y)) return true;
  return false;
}

/**
 * FB-125: close every cell whose centre lies within half a cell plus `c` cells of something that blocks: the raw
 * blocked cells, the footprints (`boxes`, which need not be cell aligned) and the collision polygons (FB-128: which
 * also close every cell they overlap, however small).
 */
function inflate(doc: MapBody, raw: Uint8Array, boxes: [number, number, number, number][], polygons: [number, number][][], c: number): Uint8Array {
  const W = doc.width, H = doc.height;
  const R = 0.5 + c;
  const out = raw.slice();
  // Blocked cells: every cell whose centre is within R of the blocked cell's square (offsets precomputed).
  const K = Math.ceil(R + 0.5);
  const offsets: [number, number][] = [];
  for (let dy = -K; dy <= K; dy++)
    for (let dx = -K; dx <= K; dx++)
      if ((dx || dy) && Math.hypot(Math.max(Math.abs(dx) - 0.5, 0), Math.max(Math.abs(dy) - 0.5, 0)) < R - EPS) offsets.push([dx, dy]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!raw[y * W + x]) continue;
      // Only blocked cells beside an open one: an inner cell's reach is covered by the edge's.
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++)
        for (let dx = -1; dx <= 1 && !edge; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !raw[ny * W + nx]) edge = true;
        }
      if (!edge) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1;
      }
    }
  // Footprints that are not cell aligned, and collision polygons.
  const near = (bx0: number, by0: number, bx1: number, by1: number, dist: (px: number, py: number) => number, overlaps?: (x: number, y: number) => boolean) => {
    for (let y = Math.max(0, Math.floor(by0 - R)); y <= Math.min(H - 1, Math.floor(by1 + R)); y++)
      for (let x = Math.max(0, Math.floor(bx0 - R)); x <= Math.min(W - 1, Math.floor(bx1 + R)); x++)
        if (!out[y * W + x] && (dist(x + 0.5, y + 0.5) < R - EPS || !!overlaps?.(x, y))) out[y * W + x] = 1;
  };
  for (const [x0, y0, x1, y1] of boxes) near(x0, y0, x1, y1, (px, py) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1)));
  for (const points of polygons) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    near(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (px, py) => zoneDistance({ shape: 'polygon', points }, px, py), (x, y) => polygonInCell(points, x, y));
  }
  return out;
}

/** The zone an end names: by id, else by name (case-insensitive; refused when two zones share it). */
export function findZoneRef(doc: MapBody, ref: string): Zone | undefined {
  const all = doc.layers.flatMap((l) => (l.type === 'zones' ? l.zones : []));
  const byId = all.find((z) => z.id === ref);
  if (byId) return byId;
  const named = all.filter((z) => z.name.toLowerCase() === ref.toLowerCase());
  if (named.length > 1) fail(`zone name "${ref}" is used by ${named.map((z) => z.id).join(', ')}: give the id`);
  return named[0];
}

/** The cells a zone covers. */
export function zoneCells(doc: Pick<MapBody, 'width' | 'height'>, z: Pick<Zone, 'shape' | 'points'>): number[] {
  const W = doc.width, H = doc.height;
  const out: number[] = [];
  const xs = z.points.map((p) => p[0]), ys = z.points.map((p) => p[1]);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), by0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const bx1 = Math.min(W - 1, Math.ceil(Math.max(...xs)) + 1), by1 = Math.min(H - 1, Math.ceil(Math.max(...ys)) + 1);
  if (z.shape === 'point' || z.points.length === 1) {
    const [x, y] = z.points[0];
    return [Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)))];
  }
  if (z.shape === 'rect') {
    const [x0, x1] = [xs[0], xs[1]].sort((a, b) => a - b), [y0, y1] = [ys[0], ys[1]].sort((a, b) => a - b);
    // Cells it overlaps; a degenerate (zero-width) rect: the cells it touches.
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const ox = Math.min(x + 1, x1) - Math.max(x, x0), oy = Math.min(y + 1, y1) - Math.max(y, y0);
        if ((ox > EPS || (x1 - x0 < EPS && ox > -EPS && x0 < x + 1)) && (oy > EPS || (y1 - y0 < EPS && oy > -EPS && y0 < y + 1))) out.push(y * W + x);
      }
    return out;
  }
  // Polygon: cells whose centre is inside; polyline: cells it runs through (centre within half a cell's diagonal).
  const reach = z.shape === 'polygon' ? EPS : Math.SQRT1_2 + EPS;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (zoneDistance(z, x + 0.5, y + 0.5) <= reach) out.push(y * W + x);
  if (!out.length) {
    // A polygon thinner than a cell: the cell under its first point.
    const [x, y] = z.points[0];
    out.push(Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x))));
  }
  return out;
}

const pointRef = (ref: string): [number, number] | null => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(ref);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** An end → its info and the open cells a route may use there. */
function resolveEnd(doc: MapBody, end: RouteEnd, blocked: Uint8Array, what: string, clearance = 0): { info: RouteEndInfo; cells: number[] } {
  const W = doc.width, H = doc.height;
  let cells: number[];
  let info: RouteEndInfo;
  const asPoint = (p: [number, number], ref: string) => {
    if (!p.every((v) => typeof v === 'number' && Number.isFinite(v))) fail(`${what} must be a zone id or name, or x,y`);
    if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) fail(`${what} (${p[0]}, ${p[1]}) is outside the ${W}×${H} map`);
    cells = zoneCells(doc, { shape: 'point', points: [p] });
    info = { ref, cells: 0 };
  };
  if (Array.isArray(end)) asPoint([end[0], end[1]], `${end[0]},${end[1]}`);
  else if (typeof end === 'string' && end.trim()) {
    const z = findZoneRef(doc, end.trim());
    if (z) {
      cells = zoneCells(doc, z);
      info = { ref: end.trim(), zone: z.id, cells: 0 };
    } else {
      const p = pointRef(end);
      if (!p) {
        const ids = doc.layers.flatMap((l) => (l.type === 'zones' ? l.zones.map((x) => x.id) : []));
        fail(`${what}: no zone "${end}" (zones: ${ids.join(', ') || 'none'}; or give x,y)`);
      }
      asPoint(p!, end.trim());
    }
  } else fail(`${what} must be a zone id or name, or x,y`);
  let open = cells!.filter((i) => !blocked[i]);
  if (!open.length) {
    // The open cells around it: the nearest ring that has any (with a clearance, out to the clearance's reach).
    const rings = clearance > EPS ? Math.ceil(clearance + 0.5) + 1 : 1;
    const near = new Set<number>();
    let ring = 0;
    while (ring < rings && !near.size) {
      ring++;
      for (const i of cells!) {
        const x = i % W, y = Math.floor(i / W);
        for (let dy = -ring; dy <= ring; dy++)
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && !blocked[ny * W + nx]) near.add(ny * W + nx);
          }
      }
    }
    open = [...near];
    const why = clearance > EPS ? 'is blocked or inside the clearance' : 'is blocked';
    const verb = what === 'from' ? 'starts' : 'ends';
    info!.note = !open.length
      ? `every cell of ${info!.ref} and around it ${why}`
      : ring === 1
        ? `every cell of ${info!.ref} ${why}; the route ${verb} beside it`
        : `every cell of ${info!.ref} ${why}; the route ${verb} ${ring} cells from it`;
  }
  info!.cells = open.length;
  return { info: info!, cells: open };
}

/** A binary min-heap of cell indices by priority. */
class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number) {
    const k = this.k, p = this.p;
    let i = k.length;
    k.push(key);
    p.push(pri);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pri) break;
      k[i] = k[j];
      p[i] = p[j];
      i = j;
    }
    k[i] = key;
    p[i] = pri;
  }
  pop(): number {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop()!, lp = p.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i, mp = lp;
        if (a < k.length && p[a] < mp) (m = a), (mp = p[a]);
        if (b < k.length && p[b] < mp) (m = b), (mp = p[b]);
        if (m === i) break;
        k[i] = k[m];
        p[i] = p[m];
        i = m;
      }
      k[i] = lk;
      p[i] = lp;
    }
    return top;
  }
}

/** The shortest walkable route between two ends (see the module comment). */
export function findRoute(doc: MapBody, from: RouteEnd, to: RouteEnd, o: RouteOptions = {}): RouteResult {
  if (o.diagonal !== undefined && typeof o.diagonal !== 'boolean') fail('diagonal must be true or false');
  const c = clearanceCells(doc, o.clearance);
  if (c <= EPS) return routeOn(doc, from, to, o, blockedGrid(doc, { ...o, clearance: 0 }), 0);
  // FB-125: with a clearance; no route → say whether there is one without it.
  const r = routeOn(doc, from, to, o, blockedGrid(doc, o), c);
  const out: RouteResult = { ...r, clearance: o.clearance };
  if (r.found) return out;
  const bare = routeOn(doc, from, to, o, blockedGrid(doc, { ...o, clearance: 0 }), 0);
  out.withoutClearance = bare.found ? { found: true, metres: bare.metres } : { found: false };
  out.reason =
    `with ${o.clearance} m clearance: ${r.reason}; ` +
    (bare.found ? `without the clearance there is a route (${bare.metres} m), through gaps narrower than the clearance` : 'there is none without the clearance either');
  return out;
}

/** A* over a blocked grid (see findRoute); `clearance` (cells) widens the search for open cells round a blocked end. */
function routeOn(doc: MapBody, from: RouteEnd, to: RouteEnd, o: RouteOptions, blocked: Uint8Array, clearance: number): RouteResult {
  const W = doc.width, H = doc.height, mpt = doc.metresPerTile;
  const a = resolveEnd(doc, from, blocked, 'from', clearance), b = resolveEnd(doc, to, blocked, 'to', clearance);
  const empty = { cells: [] as [number, number][], waypoints: [] as [number, number][], steps: 0, lengthCells: 0, metres: 0 };
  if (!a.cells.length || !b.cells.length) return { found: false, from: a.info, to: b.info, ...empty, reason: (!a.cells.length ? a.info.note : b.info.note) ?? 'no open cell' };
  const goal = new Uint8Array(W * H);
  let gx0 = W, gy0 = H, gx1 = 0, gy1 = 0;
  for (const i of b.cells) {
    goal[i] = 1;
    const x = i % W, y = Math.floor(i / W);
    (gx0 = Math.min(gx0, x)), (gy0 = Math.min(gy0, y)), (gx1 = Math.max(gx1, x)), (gy1 = Math.max(gy1, y));
  }
  const diag = o.diagonal !== false;
  // Octile (or Manhattan) distance to the goal's bounding box: never more than the true cost.
  const h = (x: number, y: number) => {
    const dx = Math.max(gx0 - x, 0, x - gx1), dy = Math.max(gy0 - y, 0, y - gy1);
    return diag ? Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) : dx + dy;
  };
  const g = new Float64Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const done = new Uint8Array(W * H);
  const heap = new Heap();
  for (const i of a.cells) {
    g[i] = 0;
    heap.push(i, h(i % W, Math.floor(i / W)));
  }
  const steps: [number, number, number][] = diag
    ? [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]
    : [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  let end = -1, best = a.cells[0], bestH = Infinity;
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    const x = i % W, y = Math.floor(i / W);
    if (goal[i]) {
      end = i;
      break;
    }
    const hi = h(x, y);
    if (hi < bestH) (bestH = hi), (best = i);
    for (const [dx, dy, c] of steps) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (blocked[j] || done[j]) continue;
      // No squeezing diagonally between two blocked cells (or past one blocked corner).
      if (dx && dy && (blocked[y * W + nx] || blocked[ny * W + x])) continue;
      const ng = g[i] + c;
      if (ng < g[j] - 1e-9) {
        g[j] = ng;
        prev[j] = i;
        heap.push(j, ng + h(nx, ny));
      }
    }
  }
  if (end < 0) {
    const bx = best % W, by = Math.floor(best / W);
    return {
      found: false, from: a.info, to: b.info, ...empty,
      reason: `no walkable route: ${b.info.ref} is cut off from ${a.info.ref} by blocked cells${o.ignoreObjects ? '' : ' or object footprints'}${clearance > EPS ? ' (and the clearance round them)' : ''}`,
      closest: [bx, by], closestMetres: Math.round(bestH * mpt * 100) / 100,
    };
  }
  const chain: number[] = [];
  for (let i = end; i >= 0; i = prev[i]) chain.push(i);
  chain.reverse();
  const cells = chain.map((i) => [i % W, Math.floor(i / W)] as [number, number]);
  const waypoints: [number, number][] = [];
  cells.forEach((c, k) => {
    if (k === 0 || k === cells.length - 1) return void waypoints.push([c[0] + 0.5, c[1] + 0.5]);
    const p = cells[k - 1], n = cells[k + 1];
    if (c[0] - p[0] !== n[0] - c[0] || c[1] - p[1] !== n[1] - c[1]) waypoints.push([c[0] + 0.5, c[1] + 0.5]);
  });
  const len = g[end];
  return {
    found: true, from: a.info, to: b.info, cells, waypoints, steps: cells.length - 1,
    lengthCells: Math.round(len * 1000) / 1000, metres: Math.round(len * mpt * 100) / 100,
  };
}

// ------------------------------------------------------------------------------------------- avoidRoute

/** FB-122: one leg of a guarded route (and the chain form's stops between). */
export interface RouteLeg {
  from: RouteEnd;
  to: RouteEnd;
  /** Stops in between: from → via[0] → … → to, each step a leg. */
  via?: RouteEnd[];
}

/**
 * FB-110: keep what an op adds off a route: `margin` metres (default 1) clear of its cells. FB-122: the route may be
 * a chain (`via`: from → via… → to) or a list of `legs` (each { from, to, via? }), and avoidRoute may be a list of
 * these (each with its own margin). FB-123: `at: "end"` checks it against the map as the whole batch left it.
 */
export interface AvoidRoute {
  from?: RouteEnd;
  to?: RouteEnd;
  via?: RouteEnd[];
  legs?: RouteLeg[];
  margin?: number;
  /** FB-125: the route keeps this many metres clear of what blocks (default 0), as map_route's clearance. */
  clearance?: number;
  /** When it is checked: "op" (default) as the op applies, "end" once every op of the batch has applied. */
  at?: 'op' | 'end';
}
export type AvoidRouteArg = AvoidRoute | AvoidRoute[];

/** FB-123: a guard as stored on the zone / object it keeps off the route (checkRoute re-checks it). */
export interface StoredRouteGuard {
  from: RouteEnd;
  to: RouteEnd;
  via?: RouteEnd[];
  margin: number;
  /** FB-125: the route's clearance in metres (absent when 0). */
  clearance?: number;
}

const endOk = (e: unknown): e is RouteEnd =>
  (typeof e === 'string' && !!e.trim()) || (Array.isArray(e) && e.length === 2 && e.every((v) => typeof v === 'number'));

const AVOID_SHAPE = 'avoidRoute must be { from, to, via?, margin?, clearance?, at? } or { legs: [{ from, to, via? }], margin?, clearance?, at? } (zones, or x,y points), or a list of them';

/** An op's avoidRoute → its guards, one chain each with its margin and when it is checked. Fails when malformed. */
export function normalizeAvoidRoute(v: unknown): (StoredRouteGuard & { at: 'op' | 'end' })[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : [v];
  if (!list.length) fail(AVOID_SHAPE);
  const out: (StoredRouteGuard & { at: 'op' | 'end' })[] = [];
  for (const r of list as AvoidRoute[]) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail(AVOID_SHAPE);
    const margin = r.margin === undefined ? 1 : r.margin;
    if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0) fail('avoidRoute.margin must be metres ≥ 0');
    const clearance = r.clearance ?? 0;
    if (typeof clearance !== 'number' || !Number.isFinite(clearance) || clearance < 0) fail('avoidRoute.clearance must be metres ≥ 0');
    const at = r.at ?? 'op';
    if (at !== 'op' && at !== 'end') fail('avoidRoute.at must be "op" or "end"');
    if (r.legs !== undefined && (r.from !== undefined || r.to !== undefined || r.via !== undefined)) fail('avoidRoute: give legs or from / via / to, not both');
    const legs: RouteLeg[] = r.legs !== undefined ? r.legs : [{ from: r.from as RouteEnd, to: r.to as RouteEnd, ...(r.via !== undefined ? { via: r.via } : {}) }];
    if (!Array.isArray(legs) || !legs.length) fail('avoidRoute.legs must be a list of { from, to, via? }');
    for (const l of legs) {
      if (!l || typeof l !== 'object' || l.from === undefined || l.to === undefined) fail(AVOID_SHAPE);
      if (l.via !== undefined && (!Array.isArray(l.via) || !l.via.every(endOk))) fail('avoidRoute.via must be a list of zones (ids or names) or x,y points');
      out.push({ from: l.from, to: l.to, ...(l.via?.length ? { via: l.via } : {}), margin, ...(clearance > 0 ? { clearance } : {}), at });
    }
  }
  return out;
}

/** Where something came closest to a guarded route. */
export interface RouteHit {
  /** The leg ("drop→Radar array") and its margin. */
  label: string;
  margin: number;
  /** Its distance from the nearest route cell within the margin, metres (0 = on it), and that cell. */
  metres: number;
  cell: [number, number];
  /** Route cells within the margin. */
  cells: number;
}

/** A route to keep off: every leg's cells, the margins, and the checks. */
export interface RouteGuard {
  label: string;
  margin: number;
  /** Too close: does rectangle r (a footprint, or a point when x0 = x1 and y0 = y1) come within the margin? */
  hits(r: [number, number, number, number]): boolean;
  /** Too close: does the zone come within the margin of the route's cells? */
  hitsZone(z: Pick<Zone, 'shape' | 'points'>): boolean;
  /** The closest offending leg for a rect / zone (null when clear). */
  hit(r: [number, number, number, number]): RouteHit | null;
  hitZone(z: Pick<Zone, 'shape' | 'points'>): RouteHit | null;
}

/** An end as a person reads it: the zone's name, else the ref. */
const endName = (doc: MapBody, e: RouteEnd, ref: string): string => {
  if (Array.isArray(e)) return `${e[0]},${e[1]}`;
  try {
    return findZoneRef(doc, e.trim())?.name ?? ref;
  } catch {
    return ref;
  }
};

const m1 = (v: number) => Math.round(v * 10) / 10;

interface Leg {
  label: string;
  /** Margin in cells, and in metres. */
  m: number;
  margin: number;
  list: [number, number][];
  cells: Set<number>;
}

/** Distance (cells) between a rect / point and cell (x, y)'s square. */
const rectCellDist = (r: [number, number, number, number], x: number, y: number) =>
  Math.hypot(Math.max(x - r[2], 0, r[0] - (x + 1)), Math.max(y - r[3], 0, r[1] - (y + 1)));

/** Margin 0: only covering the cell counts (a footprint overlapping it, or a point inside it). */
const rectCovers = (r: [number, number, number, number], x: number, y: number) =>
  r[0] === r[2] && r[1] === r[3]
    ? r[0] >= x && r[0] < x + 1 && r[1] >= y && r[1] < y + 1
    : Math.min(r[2], x + 1) - Math.max(r[0], x) > EPS && Math.min(r[3], y + 1) - Math.max(r[1], y) > EPS;

const rectNear = (leg: Leg, r: [number, number, number, number], x: number, y: number) => (leg.m > EPS ? rectCellDist(r, x, y) < leg.m - EPS : rectCovers(r, x, y));
/** The zone's distance from a route cell: from its centre, less half a cell (the cell itself). */
const zoneCellDist = (z: Pick<Zone, 'shape' | 'points'>, x: number, y: number) => zoneDistance(z, x + 0.5, y + 0.5) - 0.5;
const zoneNear = (leg: Leg, z: Pick<Zone, 'shape' | 'points'>, x: number, y: number) => zoneCellDist(z, x, y) < Math.max(leg.m, EPS) - EPS;

/**
 * Guards (from normalizeAvoidRoute, or stored on a zone / object) → one guard over every leg, on the map as it is
 * (null when there are none). Fails when an end is unknown or a leg has no walkable route.
 */
export function guardFor(doc: MapBody, guards: StoredRouteGuard[], cache = new Map<string, RouteResult>(), ro: Pick<RouteOptions, 'collisionPolygon'> = {}): RouteGuard | null {
  if (!guards.length) return null;
  const W = doc.width, mpt = doc.metresPerTile;
  const legs: Leg[] = [];
  for (const g of guards) {
    const stops = [g.from, ...(g.via ?? []), g.to];
    for (let k = 0; k + 1 < stops.length; k++) {
      const clearance = g.clearance ?? 0;
      const key = JSON.stringify([stops[k], stops[k + 1], clearance]);
      const route = cache.get(key) ?? findRoute(doc, stops[k], stops[k + 1], { ...(clearance > 0 ? { clearance } : {}), ...ro });
      cache.set(key, route);
      if (!route.found) fail(`avoidRoute: ${route.reason ?? `no walkable route from ${route.from.ref} to ${route.to.ref}`}`);
      const label = `${endName(doc, stops[k], route.from.ref)}→${endName(doc, stops[k + 1], route.to.ref)}${clearance > 0 ? ` (${clearance} m clearance)` : ''}`;
      legs.push({ label, m: g.margin / mpt, margin: g.margin, list: route.cells, cells: new Set(route.cells.map(([x, y]) => y * W + x)) });
    }
  }
  const closest = (leg: Leg, dist: (x: number, y: number) => number, near: (x: number, y: number) => boolean): RouteHit | null => {
    let best = Infinity, cell: [number, number] = leg.list[0], n = 0;
    for (const [x, y] of leg.list) {
      if (!near(x, y)) continue;
      n++;
      // Raw distances (below 0 = over the cell) so the cell it covers most wins a tie at 0.
      const d = dist(x, y);
      if (d < best - EPS) (best = d), (cell = [x, y]);
    }
    return n ? { label: leg.label, margin: leg.margin, metres: m1(Math.max(0, best) * mpt), cell, cells: n } : null;
  };
  const pick = (hits: (RouteHit | null)[]): RouteHit | null => hits.reduce<RouteHit | null>((a, h) => (h && (!a || h.metres < a.metres) ? h : a), null);
  return {
    label: `the route ${[...new Set(legs.map((l) => l.label))].join(', ')}`,
    margin: Math.max(...legs.map((l) => l.margin)),
    hits(rect) {
      return legs.some((leg) => {
        const reach = Math.ceil(leg.m) + 1;
        for (let y = Math.floor(rect[1]) - reach; y <= Math.floor(rect[3]) + reach; y++)
          for (let x = Math.floor(rect[0]) - reach; x <= Math.floor(rect[2]) + reach; x++)
            if (x >= 0 && x < W && leg.cells.has(y * W + x) && rectNear(leg, rect, x, y)) return true;
        return false;
      });
    },
    hitsZone(z) {
      return legs.some((leg) => leg.list.some(([x, y]) => zoneNear(leg, z, x, y)));
    },
    hit(rect) {
      // Ties (a footprint's edge level with several cells) go to the cell nearest its centre.
      const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
      const dist = (x: number, y: number) => (rectCovers(rect, x, y) ? -1 : rectCellDist(rect, x, y)) + 1e-4 * Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      return pick(legs.map((leg) => closest(leg, dist, (x, y) => rectNear(leg, rect, x, y))));
    },
    hitZone(z) {
      return pick(legs.map((leg) => closest(leg, (x, y) => zoneCellDist(z, x, y), (x, y) => zoneNear(leg, z, x, y))));
    },
  };
}

/** "2.1 m from the route drop→Radar array at (41, 88), inside its 5 m margin (3 route cells within it)" ("on the route …" at 0). */
export function describeHit(h: RouteHit): string {
  return `${h.metres ? `${h.metres} m from` : 'on'} the route ${h.label} at (${h.cell[0]}, ${h.cell[1]}), inside its ${h.margin} m margin${h.cells > 1 ? ` (${h.cells} route cells within it)` : ''}`;
}

/**
 * An op's `avoidRoute` → a guard over its legs checked `at` that time (default "op"; null when there are none).
 * Fails when it is malformed or a leg has no route.
 */
export function routeGuard(doc: MapBody, v: unknown, at: 'op' | 'end' = 'op', ro: Pick<RouteOptions, 'collisionPolygon'> = {}): RouteGuard | null {
  return guardFor(doc, normalizeAvoidRoute(v).filter((g) => g.at === at), undefined, ro);
}

/** FB-123: the guards an op's avoidRoute leaves on what it adds (for checkRoute), without `at`. */
export function storedGuards(v: unknown): StoredRouteGuard[] {
  return normalizeAvoidRoute(v).map(({ at: _, ...g }) => g);
}
