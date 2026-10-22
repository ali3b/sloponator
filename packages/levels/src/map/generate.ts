// Moved from the old generator's packages/shared/src/map/generate.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import type { Terrain } from '../tileset/types.js';
import { fbm, noise1, rng, mapSeed } from './noise.js';
import {
  checkProps, checkSprite, fail, footprintFor, layerFor, num, objectRect, opAddZone, OpFail, opPlace, snapAxis,
  type OpOutcome, type OpsContext,
} from './ops.js';
import { routeGuard, type AvoidRouteArg } from './route.js';
import { facingAngle, nearestFacing, rotateStamp, STAMP_LAYERS, stampGroundMask, validateStamp, type MapStamp, type StampLayer } from './stamp.js';
import { splitGid, mapGid, type CellFootprint, type GroundLayer, type MapBody, type ObjectLayer, type Properties, type Zone, type ZoneKind } from './types.js';

/**
 * Generator ops: terrain from noise per biome, scattering objects by rules, paths (roads, rivers, trenches) and
 * stamps. They are ordinary map ops, so a batch is one save and one undo, and they are deterministic: the same op
 * with the same seed on the same map gives the same result everywhere.
 */

// --------------------------------------------------------------------------------------------- regions

/** Where a generator works: cells x0..x1, y0..y1 inclusive, or a polygon in cell coordinates. Default: the map. */
export type Region = { rect: [number, number, number, number] } | { polygon: [number, number][] };

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface RegionTest {
  /** Is the point (cell units) inside? */
  has(x: number, y: number): boolean;
  /** Bounds in cell units [x0, y0, x1, y1]. */
  box: [number, number, number, number];
}

function regionOf(doc: MapBody, r: Region | undefined): RegionTest {
  const W = doc.width, H = doc.height;
  if (r === undefined || r === null) return { has: (x, y) => x >= 0 && y >= 0 && x <= W && y <= H, box: [0, 0, W, H] };
  if (typeof r !== 'object') fail('region must be { rect: [x0, y0, x1, y1] } or { polygon: [[x, y], …] }');
  if ('rect' in r) {
    const v = r.rect;
    if (!Array.isArray(v) || v.length !== 4 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) fail('region.rect must be [x0, y0, x1, y1] (cells, inclusive)');
    const [x0, x1] = [Math.floor(v[0]), Math.floor(v[2])].sort((a, b) => a - b);
    const [y0, y1] = [Math.floor(v[1]), Math.floor(v[3])].sort((a, b) => a - b);
    const b: [number, number, number, number] = [Math.max(0, x0), Math.max(0, y0), Math.min(W, x1 + 1), Math.min(H, y1 + 1)];
    if (b[0] >= b[2] || b[1] >= b[3]) fail('region.rect is outside the map');
    return { has: (x, y) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3], box: b };
  }
  if ('polygon' in r) {
    const p = r.polygon;
    if (!Array.isArray(p) || p.length < 3 || p.some((q) => !Array.isArray(q) || q.length !== 2 || q.some((n) => typeof n !== 'number' || !Number.isFinite(n)))) fail('region.polygon needs at least 3 [x, y] points');
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const b: [number, number, number, number] = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(W, Math.max(...xs)), Math.min(H, Math.max(...ys))];
    if (b[0] >= b[2] || b[1] >= b[3]) fail('region.polygon is outside the map');
    return { has: (x, y) => pointInPolygon(x, y, p), box: b };
  }
  return fail('region must be { rect: [x0, y0, x1, y1] } or { polygon: [[x, y], …] }');
}

/**
 * FB-120: the cells a collision-clearing path opened and that are still open (row-major flags), or null when there are
 * none: scatter and generate keep off them.
 */
export function pathOpenedCells(doc: MapBody): Uint8Array | null {
  const N = doc.width * doc.height;
  let out: Uint8Array | null = null;
  for (const l of doc.layers)
    if (l.type === 'collision' && l.opened?.length === N)
      for (let i = 0; i < N; i++)
        if (l.opened[i] && !l.cells[i]) (out ??= new Uint8Array(N))[i] = 1;
  if (!out) return null;
  // A cell blocked on another collision layer is not open.
  for (const l of doc.layers) if (l.type === 'collision') for (let i = 0; i < N; i++) if (l.cells[i]) out[i] = 0;
  return out.some(Boolean) ? out : null;
}

const checkAvoidPaths = (v: unknown) => (v === undefined || typeof v === 'boolean' ? v !== false : fail('avoidPaths must be true or false'));

// ------------------------------------------------------------------------------------------------ terrain

/** A terrain wish: an id, name or kind, or a list of them (the first the tileset has wins). */
export type TerrainWish = string | string[];

/**
 * The tileset terrain a wish names: by id, then name, then kind, for each candidate in order. Without a known
 * tileset the first candidate is taken as it is. Null when the tileset has none of them.
 */
export function pickTerrain(wish: TerrainWish, terrains: Pick<Terrain, 'id' | 'name' | 'kind'>[] | null | undefined): string | null {
  const list = (Array.isArray(wish) ? wish : [wish]).filter((t) => typeof t === 'string');
  if (!list.length) return null;
  if (!terrains) return list[0];
  for (const w of list) {
    const lw = w.toLowerCase();
    const t = terrains.find((x) => x.id === w) ?? terrains.find((x) => x.name.toLowerCase() === lw) ?? terrains.find((x) => x.kind === lw);
    if (t) return t.id;
  }
  return null;
}

const groundTerrains = (doc: MapBody, ctx: OpsContext, layer: GroundLayer) => ctx.tilesets?.[layer.tileset ?? 0]?.terrains ?? null;

function needTerrain(doc: MapBody, ctx: OpsContext, layer: GroundLayer, wish: TerrainWish, what: string): string {
  const t = pickTerrain(wish, groundTerrains(doc, ctx, layer));
  if (t === null) {
    const all = groundTerrains(doc, ctx, layer) ?? [];
    fail(`${what}: the ground tileset has no terrain ${[wish].flat().map((w) => `"${w}"`).join(' or ')} (terrains: ${all.map((x) => x.id).join(', ') || 'none'})`);
  }
  return t!;
}

/** One layer of a biome: a terrain laid where its own noise field is highest. */
export interface BiomeLayer {
  terrain: TerrainWish;
  /** Share of the region it covers (0–1), exactly: the top `cover` of its noise. */
  cover?: number;
  /** Or a raw noise threshold (0–1; value noise sits mostly between 0.3 and 0.7). */
  threshold?: number;
  /** Feature size in metres (default: the biome's). */
  scale?: number;
  /** Noise octaves (default 3: 1 = smooth blobs, 5 = ragged). */
  octaves?: number;
}

/** A biome: a base terrain everywhere, then layers of other terrains painted over it in order. */
export interface Biome {
  base: TerrainWish;
  layers?: BiomeLayer[];
  /** Default feature size in metres (default 12). */
  scale?: number;
}

/** The built-in biomes (Airborne Ranger's three climates, plus jungle). Terrains are wishes: id, name or kind. */
export const BIOMES: Record<string, Biome> = {
  temperate: { base: ['grass'], scale: 12, layers: [{ terrain: ['dirt', 'mud'], cover: 0.1, scale: 10 }, { terrain: ['sand'], cover: 0.04, scale: 6 }] },
  desert: { base: ['sand'], scale: 14, layers: [{ terrain: ['dirt'], cover: 0.18, scale: 12 }, { terrain: ['rock', 'road', 'mud'], cover: 0.05, scale: 6 }] },
  arctic: { base: ['snow'], scale: 12, layers: [{ terrain: ['rock', 'dirt'], cover: 0.12, scale: 8 }, { terrain: ['ice', 'water'], cover: 0.03, scale: 6, octaves: 1 }] },
  jungle: { base: ['jungle', 'grass'], scale: 10, layers: [{ terrain: ['mud', 'dirt'], cover: 0.15, scale: 9 }, { terrain: ['grass'], cover: 0.2, scale: 14 }] },
};
export const BIOME_NAMES = Object.keys(BIOMES);

export interface GenerateOp {
  op: 'generate';
  /** A built-in biome name (temperate, desert, arctic, jungle) or a biome. */
  biome?: string | Biome;
  seed?: number | string;
  region?: Region;
  /** Feature size in metres (overrides the biome's default). */
  scale?: number;
  /** Corners of these terrains are left as they are (e.g. a road painted before). */
  keep?: string[];
  /**
   * FB-120: leave the corners of cells a collision-clearing path opened (a ford) as they are (default true; reported
   * as `pathCorners`). false generates over them too.
   */
  avoidPaths?: boolean;
  layer?: string;
}

function biomeOf(b: GenerateOp['biome']): Biome {
  if (b === undefined) return BIOMES.temperate;
  if (typeof b === 'string') return BIOMES[b.toLowerCase()] ?? fail(`no biome "${b}" (biomes: ${BIOME_NAMES.join(', ')})`);
  if (!b || typeof b !== 'object' || (typeof b.base !== 'string' && !Array.isArray(b.base))) fail('biome must be a name or { base, layers: [{ terrain, cover }] }');
  if (b.layers !== undefined && !Array.isArray(b.layers)) fail('biome.layers must be a list');
  return b;
}

/**
 * Terrain from noise. The region's corners become the base terrain; then each layer takes the corners where its
 * own noise field (seeded from the op's seed and the layer's index, sampled in metres so a region generated next
 * to another with the same seed joins up) is in the top `cover` of the region. A layer never touches a corner
 * next to a different non-base terrain, so every cell is a pair of terrains the tileset's corner tiles cover.
 */
export function opGenerate(doc: MapBody, op: GenerateOp, ctx: OpsContext): OpOutcome {
  const layer = layerFor(doc, 'ground', op.layer);
  const biome = biomeOf(op.biome);
  const seed = mapSeed(op.seed ?? 0);
  const region = regionOf(doc, op.region);
  const W = doc.width, H = doc.height, mpt = doc.metresPerTile;
  const base = needTerrain(doc, ctx, layer, biome.base, 'biome base');
  const keep = new Set((op.keep ?? []).map((k) => pickTerrain(k, groundTerrains(doc, ctx, layer)) ?? k));
  const defScale = op.scale !== undefined ? num(op.scale, 'scale') : biome.scale ?? 12;
  if (!(defScale > 0)) fail('scale must be a positive number of metres');
  // FB-120: the corners of cells a ford or bridge path opened stay.
  const opened = checkAvoidPaths(op.avoidPaths) ? pathOpenedCells(doc) : null;
  const pathCorner = opened ? new Uint8Array((W + 1) * (H + 1)) : null;
  if (opened && pathCorner)
    for (let i = 0; i < W * H; i++)
      if (opened[i]) {
        const x = i % W, y = Math.floor(i / W);
        pathCorner[y * (W + 1) + x] = pathCorner[y * (W + 1) + x + 1] = pathCorner[(y + 1) * (W + 1) + x] = pathCorner[(y + 1) * (W + 1) + x + 1] = 1;
      }
  let pathCorners = 0;
  const idx: number[] = [];
  for (let y = 0; y <= H; y++)
    for (let x = 0; x <= W; x++) {
      if (!region.has(x, y) || keep.has(layer.corners[y * (W + 1) + x])) continue;
      if (pathCorner?.[y * (W + 1) + x]) {
        pathCorners++;
        continue;
      }
      idx.push(y * (W + 1) + x);
    }
  if (!idx.length) fail('the region has no corners to generate');
  for (const i of idx) layer.corners[i] = base;
  const used: Record<string, number> = {};
  const skipped: string[] = [];
  (biome.layers ?? []).forEach((bl, li) => {
    const t = pickTerrain(bl.terrain, groundTerrains(doc, ctx, layer));
    if (t === null) return void skipped.push([bl.terrain].flat().join('/'));
    if (t === base) return;
    const scale = bl.scale !== undefined ? num(bl.scale, 'layer scale') : defScale;
    const oct = bl.octaves !== undefined ? Math.max(1, Math.min(6, Math.round(num(bl.octaves, 'octaves')))) : 3;
    const s = seed + (li + 1) * 7919;
    const values = idx.map((i) => fbm(s, (i % (W + 1)) * mpt, Math.floor(i / (W + 1)) * mpt, scale, oct));
    let cut: number;
    if (bl.cover !== undefined) {
      const c = num(bl.cover, 'cover');
      if (c < 0 || c > 1) fail('cover must be 0–1');
      if (c === 0) return;
      const sorted = values.slice().sort((a, b) => b - a);
      cut = sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(c * sorted.length) - 1))];
    } else cut = bl.threshold !== undefined ? num(bl.threshold, 'threshold') : 0.6;
    let n = 0;
    idx.forEach((i, k) => {
      if (values[k] < cut) return;
      const x = i % (W + 1), y = Math.floor(i / (W + 1));
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx > W || ny > H) continue;
          const c = layer.corners[ny * (W + 1) + nx];
          if (c !== base && c !== t && c !== '') return;
        }
      layer.corners[i] = t;
      n++;
    });
    used[t] = (used[t] ?? 0) + n;
  });
  return { report: { base, corners: idx.length, terrains: used, ...(pathCorners ? { pathCorners } : {}), ...(skipped.length ? { skipped: skipped.map((s) => `no terrain ${s} in the tileset`) } : {}) } };
}

// --------------------------------------------------------------------------------------------- geometry

type Pt = [number, number];

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function polylineDist(px: number, py: number, line: Pt[]): number {
  if (line.length === 1) return Math.hypot(px - line[0][0], py - line[0][1]);
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(px, py, line[i - 1], line[i]));
  return d;
}

/**
 * polylineDist for every point (x + off, y + off) of a cols × rows grid, but only where it is at most `reach`
 * (Infinity elsewhere): each segment visits the grid points around it, so a road across a 512×512 map costs its
 * length times its width instead of every corner times every segment.
 */
function gridDistances(line: Pt[], cols: number, rows: number, reach: number, off: number): Float64Array {
  const d = new Float64Array(cols * rows).fill(Infinity);
  const segs = line.length === 1 ? [[line[0], line[0]] as const] : line.slice(1).map((b, i) => [line[i], b] as const);
  for (const [a, b] of segs) {
    const x0 = Math.max(0, Math.ceil(Math.min(a[0], b[0]) - reach - off)), x1 = Math.min(cols - 1, Math.floor(Math.max(a[0], b[0]) + reach - off));
    const y0 = Math.max(0, Math.ceil(Math.min(a[1], b[1]) - reach - off)), y1 = Math.min(rows - 1, Math.floor(Math.max(a[1], b[1]) + reach - off));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const v = segDist(x + off, y + off, a, b);
        if (v < d[y * cols + x]) d[y * cols + x] = v;
      }
  }
  return d;
}

/** Distance from a point to a zone (0 inside a rect or polygon). */
export function zoneDistance(z: Pick<Zone, 'shape' | 'points'>, x: number, y: number): number {
  const p = z.points;
  if (z.shape === 'point' || p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]);
  if (z.shape === 'rect') {
    const [x0, x1] = [p[0][0], p[1][0]].sort((a, b) => a - b), [y0, y1] = [p[0][1], p[1][1]].sort((a, b) => a - b);
    return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  }
  if (z.shape === 'polygon') return pointInPolygon(x, y, p) ? 0 : polylineDist(x, y, [...p, p[0]]);
  return polylineDist(x, y, p);
}

/** Catmull-Rom through the points, `per` samples per segment (the points themselves included). */
function smoothLine(pts: Pt[], per = 8): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Resample a polyline every `step` along its length; returns points with their arc length. */
function resample(line: Pt[], step: number): { p: Pt; s: number; dir: Pt }[] {
  const out: { p: Pt; s: number; dir: Pt }[] = [];
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    if (!out.length) out.push({ p: a, s: 0, dir });
    let next = (Math.floor(s / step) + 1) * step;
    while (next <= s + len + 1e-9) {
      const t = (next - s) / len;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], s: next, dir });
      next += step;
    }
    s += len;
    const last = out[out.length - 1];
    if (i === line.length - 1 && s - last.s > 1e-6) out.push({ p: b, s, dir });
  }
  if (!out.length && line.length) out.push({ p: line[0], s: 0, dir: [1, 0] });
  return out;
}

/** The on-screen angle (degrees counter-clockwise from screen right) of a direction in map coordinates. */
export function screenAngle(doc: Pick<MapBody, 'orientation'>, dx: number, dy: number): number {
  const sx = doc.orientation === 'isometric' ? dx - dy : dx;
  const sy = doc.orientation === 'isometric' ? (dx + dy) / 2 : dy;
  return (Math.atan2(-sy, sx) * 180) / Math.PI;
}

/**
 * The angle of a facing name (degrees counter-clockwise from screen right) that points along the map direction
 * (dx, dy). On an isometric map the facings are the grid's: SE = +x, SW = +y, S = the +x+y diagonal, E = +x−y; on
 * an orthogonal map screen and map axes are the same.
 */
export function gridFacingAngle(doc: Pick<MapBody, 'orientation'>, dx: number, dy: number): number {
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
  return doc.orientation === 'isometric' ? -theta - 45 : -theta;
}

export const PATH_FACING_MODES = ['along', 'across', 'parallel', 'perpendicular'] as const;
export type PathFacingMode = (typeof PATH_FACING_MODES)[number];

/** Of `names`, the facing nearest `angle` or, when that is closer, nearest its opposite (the same line). */
function lineFacing(names: string[], angle: number): string | undefined {
  const d = (n: string | undefined) => (n === undefined ? Infinity : Math.abs(((angle - facingAngle(n)! + 540) % 360) - 180));
  const direct = nearestFacing(names, angle), back = nearestFacing(names, angle + 180);
  return d(direct) <= 180 - d(back) + 1e-9 ? direct : back;
}

/**
 * The facing for an object on a path going `dir` (map units). "along"/"across" point its front along/across the
 * path; "parallel"/"perpendicular" lay its long side (from `footprint(facing)`) along/across it, falling back to
 * "across"/"along" when no facing has a long side on the right axis.
 */
export function pathFacing(
  doc: Pick<MapBody, 'orientation'>, names: string[], dir: [number, number], mode: PathFacingMode, footprint?: (facing: string) => CellFootprint | null | undefined,
): string | undefined {
  const [dx, dy] = dir;
  const alongA = gridFacingAngle(doc, dx, dy), acrossA = gridFacingAngle(doc, -dy, dx);
  if (mode === 'along') return lineFacing(names, alongA);
  if (mode === 'across') return lineFacing(names, acrossA);
  // The grid axis the long side must lie on: the path's main axis (parallel) or the other one.
  const pathAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  const wantAxis = mode === 'parallel' ? pathAxis : pathAxis === 'x' ? 'y' : 'x';
  const fits = names.filter((n) => {
    const f = footprint?.(n);
    return f && f.w !== f.h && (f.w > f.h ? 'x' : 'y') === wantAxis;
  });
  return lineFacing(fits.length ? fits : names, mode === 'parallel' ? acrossA : alongA);
}

// ------------------------------------------------------------------------------------------------ objects

/** An object a scatter or path places: a project sprite or a free reference, with its choices. */
export interface GenObject {
  spriteId?: number;
  assetRef?: string;
  name?: string;
  /** Relative weight when a scatter has several objects (default 1). */
  weight?: number;
  /** One of these states at random (default: none set). */
  states?: string[];
  /** One of these facings at random; "any" = any facing the sprite's export has. */
  facings?: string[] | 'any';
  /** Cells covered when the sprite has no export with an object block (or for an assetRef). */
  footprint?: CellFootprint;
  properties?: Properties;
  /** FB-095: false = markers (mines): no collision in the export, never blocked by (or blocking) solid objects. */
  collision?: boolean;
}

function checkGenObject(ctx: OpsContext, o: GenObject, what: string) {
  if (!o || typeof o !== 'object') fail(`${what} must be an object`);
  if (o.spriteId === undefined && !o.assetRef) fail(`${what} needs a spriteId or an assetRef`);
  if (o.spriteId !== undefined && !Number.isInteger(o.spriteId)) fail(`${what}: spriteId must be a whole number`);
  if (o.weight !== undefined && !(num(o.weight, `${what}.weight`) >= 0)) fail(`${what}: weight must be ≥ 0`);
  if (o.states !== undefined && (!Array.isArray(o.states) || o.states.some((s) => typeof s !== 'string'))) fail(`${what}: states must be a list of names`);
  if (o.facings !== undefined && o.facings !== 'any' && (!Array.isArray(o.facings) || o.facings.some((s) => typeof s !== 'string'))) fail(`${what}: facings must be a list of names or "any"`);
  if (o.spriteId !== undefined) {
    checkSprite(ctx, o.spriteId);
    for (const s of o.states ?? []) checkSprite(ctx, o.spriteId, s);
    if (Array.isArray(o.facings)) for (const f of o.facings) checkSprite(ctx, o.spriteId, undefined, f);
  }
  if (o.properties !== undefined) checkProps(o.properties, `${what}.properties`);
  if (o.collision !== undefined && typeof o.collision !== 'boolean') fail(`${what}: collision must be true or false`);
}

/** The facings an object may take: its list, or with "any" its sprite's export's facings. */
function facingChoices(ctx: OpsContext, o: GenObject): string[] {
  if (Array.isArray(o.facings)) return o.facings;
  if (o.facings === 'any') {
    const f = o.spriteId !== undefined ? ctx.sprites?.[o.spriteId] : undefined;
    return Object.keys(f?.directions ?? {});
  }
  return [];
}

const placeOrNull = (doc: MapBody, ctx: OpsContext, op: Parameters<typeof opPlace>[1]): string | null => {
  try {
    return opPlace(doc, op, ctx);
  } catch (e) {
    if (e instanceof OpFail) return null;
    throw e;
  }
};

/** Why a path object was not placed (FB-051). */
export type PathRejection = 'bounds' | 'overlap' | 'facing' | 'state' | 'other';

/** Place, or say why not: the refusal's cause and, for an overlap, what is in the way. */
const placeOrWhy = (doc: MapBody, ctx: OpsContext, op: Parameters<typeof opPlace>[1]): { id: string } | { cause: PathRejection; with?: string; message: string } => {
  try {
    return { id: opPlace(doc, op, ctx) };
  } catch (e) {
    if (!(e instanceof OpFail)) throw e;
    const m = e.message;
    // Bounds first: an object both off the map and over another is mostly off the map.
    if (/ is outside the /.test(m)) return { cause: 'bounds', message: m };
    const ov = / would overlap (\S+)(?: \(([^)]*)\))?/.exec(m);
    if (ov) return { cause: 'overlap', with: ov[2] ? `${ov[1]} (${ov[2]})` : ov[1], message: m };
    if (/ has no facing /.test(m)) return { cause: 'facing', message: m };
    if (/ has no state /.test(m)) return { cause: 'state', message: m };
    return { cause: 'other', message: m };
  }
};

// ------------------------------------------------------------------------------------------------ scatter

export interface ScatterOp {
  op: 'scatter';
  /** What to place (one is picked per spot by weight). A single object can be given inline instead. */
  objects?: GenObject[];
  spriteId?: number;
  assetRef?: string;
  name?: string;
  states?: string[];
  facings?: string[] | 'any';
  footprint?: CellFootprint;
  properties?: Properties;
  /** FB-095: false = markers (for every object without its own `collision`). */
  collision?: boolean;
  seed?: number | string;
  /** Objects per 100 m² of the ground they may stand on (default 1). */
  density?: number;
  /** Or exactly this many (as many as fit). */
  count?: number;
  /**
   * Minimum distance between object anchors of this group, in metres (default 2). The group is every object on the
   * layer of the same sprites (or asset references) as this scatter's, so a second pass keeps its distance too.
   */
  spacing?: number;
  /** Minimum distance to every other object on the layer, in metres (default 0: only footprints may not overlap). */
  spacingOther?: number;
  /**
   * Extra rounds when the target is not met (default 2): more darts, then a sweep over every free spot of the region.
   * 0 = one round of darts only.
   */
  retries?: number;
  /**
   * Relax the spacing round by round down to this floor when the target is not met: true = half the spacing, a
   * number = the floor in metres (default: no relaxing).
   */
  relax?: boolean | number;
  /** The target includes this group's objects already in the region: a repeated scatter only adds what is missing. */
  topUp?: boolean;
  /** Only on cells whose four corners are all one of these terrains. */
  terrains?: string[];
  /** Never on a cell with a corner of these terrains (roads, rivers…). */
  avoidTerrains?: string[];
  /** Keep away from these zones (ids or kinds; "all" = every zone)… */
  avoidZones?: string[];
  /** …by this many metres (default 1). */
  avoidMargin?: number;
  region?: Region;
  /** 0 = evenly spread, 1 = only in clumps (cluster noise; default 0). */
  cluster?: number;
  /** Clump size in metres (default 10). */
  clusterScale?: number;
  layer?: string;
  allowOverlap?: boolean;
  /**
   * FB-120: keep off cells a collision-clearing path opened (a ford, a bridge; default true), counted in
   * `rejected.path`. false scatters over them too.
   */
  avoidPaths?: boolean;
  /** FB-110: keep `margin` metres (default 1) off the walkable route from → to (zones, or x,y), counted in `rejected.route`. */
  avoidRoute?: AvoidRouteArg;
}

/** The terrain ids a list of wishes names (each wish by id, name or kind). */
export const terrainSet = (doc: MapBody, ctx: OpsContext, layer: GroundLayer, list: string[] | undefined, what: string): Set<string> | null => {
  if (list === undefined) return null;
  if (!Array.isArray(list) || list.some((t) => typeof t !== 'string')) fail(`${what} must be a list of terrains`);
  const terrains = groundTerrains(doc, ctx, layer);
  const out = new Set<string>();
  for (const w of list) {
    if (!terrains) out.add(w);
    // By kind every terrain of that kind counts.
    else for (const t of terrains) if (t.id === w || t.name.toLowerCase() === w.toLowerCase() || t.kind === w.toLowerCase()) out.add(t.id);
  }
  return out;
};

/** What a generated object is called in reports: its name, its sprite's name, or "sprite N" / the asset reference. */
const objectLabel = (ctx: OpsContext, o: GenObject) =>
  o.name ?? o.assetRef ?? (o.spriteId !== undefined ? ctx.sprites?.[o.spriteId]?.name ?? ctx.spriteNames?.[o.spriteId] ?? `sprite ${o.spriteId}` : '?');

/** The scatter group key of an object (same sprite or asset reference = same group). */
const groupKey = (o: { spriteId?: number; assetRef?: string }) => (o.spriteId !== undefined ? `s${o.spriteId}` : `a${o.assetRef ?? ''}`);

/** `total` split by `weights` into whole numbers (largest remainder; ties to the earlier one). */
export function shares(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(sum > 0) || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * Math.max(0, w)) / sum);
  const out = exact.map((x) => Math.floor(x + 1e-9));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - out[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i]++;
    rest--;
  }
  return out;
}

/** Why darts were turned down, by cause. */
export interface ScatterRejections {
  /** Outside the region or the map (a footprint hanging over the edge). */
  bounds: number;
  /** Thinned out by the cluster noise. */
  cluster: number;
  /** Too close to an object of the same group. */
  spacing: number;
  /** Too close to another object (`spacingOther`). */
  spacingOther: number;
  /** A covered cell on a terrain it may not stand on. */
  terrain: number;
  /** Too close to an avoided zone. */
  zone: number;
  /** The footprint would overlap another object's. */
  overlap: number;
  /** FB-120: a covered cell is one a collision-clearing path opened (a ford). */
  path: number;
  /** FB-110: too close to the walkable route of `avoidRoute`. */
  route: number;
}

/**
 * Scatter objects: Poisson-disc dart throwing (seeded) in the region, a minimum spacing between anchors of the same
 * group (and `spacingOther` to everything else), the ground rules (terrains to stand on, terrains and zones to
 * avoid) checked on every cell an object covers, and cluster noise thinning the darts to clumps. Each spot goes
 * through `place`, so footprints snap, stay inside the map and never overlap. When the darts fall short it retries
 * (relaxing the spacing towards a floor with `relax`) and finally sweeps every spot of the region in a seeded order
 * (densest cluster noise first). Reports how many it placed against the target and why the rest were turned down.
 */
export function opScatter(doc: MapBody, op: ScatterOp, ctx: OpsContext): OpOutcome {
  const objLayer: ObjectLayer = layerFor(doc, 'objects', op.layer);
  const ground = doc.layers.find((l) => l.type === 'ground') as GroundLayer | undefined;
  const given: GenObject[] = op.objects ?? (op.spriteId !== undefined || op.assetRef
    ? [{ spriteId: op.spriteId, assetRef: op.assetRef, name: op.name, states: op.states, facings: op.facings, footprint: op.footprint, properties: op.properties }]
    : []);
  if (!Array.isArray(given) || !given.length) fail('scatter needs objects: [{ spriteId | assetRef, … }] (or a spriteId / assetRef)');
  if (op.collision !== undefined && typeof op.collision !== 'boolean') fail('collision must be true or false (false: markers without collision)');
  const list = op.collision === undefined ? given : given.map((o) => (o && typeof o === 'object' && o.collision === undefined ? { ...o, collision: op.collision } : o));
  list.forEach((o, i) => checkGenObject(ctx, o, `objects[${i}]`));
  const weights = list.map((o) => o.weight ?? 1);
  const totalW = weights.reduce((a, b) => a + b, 0);
  if (!(totalW > 0)) fail('the objects\' weights add up to 0');
  const mpt = doc.metresPerTile, W = doc.width, H = doc.height;
  const spacing = (op.spacing !== undefined ? num(op.spacing, 'spacing') : 2) / mpt;
  if (spacing < 0) fail('spacing must be ≥ 0');
  const spacingOther = (op.spacingOther !== undefined ? num(op.spacingOther, 'spacingOther') : 0) / mpt;
  if (spacingOther < 0) fail('spacingOther must be ≥ 0');
  let floor = spacing;
  if (op.relax !== undefined && op.relax !== false) {
    floor = op.relax === true ? spacing / 2 : num(op.relax, 'relax') / mpt;
    if (floor < 0) fail('relax must be true or a spacing floor in metres ≥ 0');
    floor = Math.min(floor, spacing);
  }
  const retries = op.retries !== undefined ? num(op.retries, 'retries') : floor < spacing ? 3 : 2;
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) fail('retries must be a whole number 0–10');
  const cluster = op.cluster !== undefined ? num(op.cluster, 'cluster') : 0;
  if (cluster < 0 || cluster > 1) fail('cluster must be 0–1');
  const clusterScale = op.clusterScale !== undefined ? num(op.clusterScale, 'clusterScale') : 10;
  if (!(clusterScale > 0)) fail('clusterScale must be positive');
  const margin = (op.avoidMargin !== undefined ? num(op.avoidMargin, 'avoidMargin') : 1) / mpt;
  const region = regionOf(doc, op.region);
  const allow = ground ? terrainSet(doc, ctx, ground, op.terrains, 'terrains') : null;
  const avoid = ground ? terrainSet(doc, ctx, ground, op.avoidTerrains, 'avoidTerrains') : null;
  if ((op.terrains || op.avoidTerrains) && !ground) fail('terrain rules need a ground layer');
  if (op.avoidZones !== undefined && (!Array.isArray(op.avoidZones) || op.avoidZones.some((z) => typeof z !== 'string'))) fail('avoidZones must be a list of zone ids or kinds');
  const zones = (op.avoidZones ?? []).length
    ? doc.layers.flatMap((l) => (l.type === 'zones' ? l.zones : [])).filter((z) => op.avoidZones!.includes('all') || op.avoidZones!.includes(z.id) || op.avoidZones!.includes(z.kind))
    : [];
  const opened = checkAvoidPaths(op.avoidPaths) ? pathOpenedCells(doc) : null;
  const guard = routeGuard(doc, op.avoidRoute, 'op', ctx.collisionPolygon ? { collisionPolygon: ctx.collisionPolygon } : {});
  const terrainOk = (x: number, y: number): boolean => {
    if (!ground || (!allow && !avoid)) return true;
    const c = [ground.corners[y * (W + 1) + x], ground.corners[y * (W + 1) + x + 1], ground.corners[(y + 1) * (W + 1) + x + 1], ground.corners[(y + 1) * (W + 1) + x]];
    if (allow && !c.every((t) => allow.has(t))) return false;
    if (avoid && c.some((t) => avoid.has(t))) return false;
    return true;
  };
  // The target: density × the ground the objects may stand on, inside the region.
  let eligible = 0;
  for (let y = Math.floor(region.box[1]); y < Math.ceil(region.box[3]); y++)
    for (let x = Math.floor(region.box[0]); x < Math.ceil(region.box[2]); x++) if (x < W && y < H && region.has(x + 0.5, y + 0.5) && terrainOk(x, y) && !opened?.[y * W + x]) eligible++;
  const area = eligible * mpt * mpt;
  let target: number;
  if (op.count !== undefined) {
    target = num(op.count, 'count');
    if (!Number.isInteger(target) || target < 0) fail('count must be a whole number ≥ 0');
  } else {
    const density = op.density !== undefined ? num(op.density, 'density') : 1;
    if (density < 0) fail('density must be ≥ 0');
    target = Math.round((density * area) / 100);
  }
  target = Math.min(target, 5000);
  const group = new Set(list.map(groupKey));
  const mine = op.topUp ? objLayer.objects.filter((o) => group.has(groupKey(o)) && region.has(o.x, o.y)) : [];
  const existing = mine.length;
  const want = Math.max(0, target - existing);
  // FB-067: each object's share of the target by weight, less what it already has (topUp), capped to `want` in
  // total. Picks are then weighted by what each still lacks, so an object whose footprint fails more darts (a big
  // tree among small palms) gets picked more often until its share is met, rather than the small ones filling in.
  const asked = shares(target, weights);
  const left = new Map<string, number>();
  for (const o of mine) left.set(groupKey(o), (left.get(groupKey(o)) ?? 0) + 1);
  let need = asked.map((n, i) => {
    const k = groupKey(list[i]), have = Math.min(n, left.get(k) ?? 0);
    left.set(k, (left.get(k) ?? 0) - have);
    return n - have;
  });
  if (need.reduce((a, b) => a + b, 0) > want) need = shares(want, need);
  const wantAll = need.reduce((a, b) => a + b, 0);
  const labelSums = (ns: number[]) => {
    const out: Record<string, number> = {};
    ns.forEach((n, i) => (out[objectLabel(ctx, list[i])] = (out[objectLabel(ctx, list[i])] ?? 0) + n));
    return out;
  };
  const got = list.map(() => 0);
  const seed = mapSeed(op.seed ?? 0);
  const rand = rng(seed);
  // Spacing grids: anchors of this group (already on the layer and placed here), and everything else.
  const makeGrid = (cs: number) => {
    const cells = new Map<string, Pt[]>();
    return {
      add(x: number, y: number) {
        const k = `${Math.floor(x / cs)},${Math.floor(y / cs)}`;
        (cells.get(k) ?? cells.set(k, []).get(k)!).push([x, y]);
      },
      near(x: number, y: number, d: number) {
        if (!(d > 0)) return false;
        const gx = Math.floor(x / cs), gy = Math.floor(y / cs), r = Math.ceil(d / cs);
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            for (const [px, py] of cells.get(`${gx + dx},${gy + dy}`) ?? []) if ((px - x) ** 2 + (py - y) ** 2 < d * d - 1e-9) return true;
        return false;
      },
    };
  };
  const same = makeGrid(Math.max(spacing, 0.5)), other = makeGrid(Math.max(spacingOther, 0.5));
  for (const o of objLayer.objects) (group.has(groupKey(o)) ? same : other).add(o.x, o.y);
  const created: string[] = [];
  const counts: Record<string, number> = {};
  const rejected: ScatterRejections = { bounds: 0, cluster: 0, spacing: 0, spacingOther: 0, terrain: 0, zone: 0, overlap: 0, path: 0, route: 0 };
  const clusterKeep = (x: number, y: number) => {
    const n = fbm(seed ^ 0x2c1b3c6d, x * mpt, y * mpt, clusterScale, 2);
    const t = Math.max(0, Math.min(1, (n - 0.5) * 5 + 0.5));
    return 1 - cluster + cluster * t * t;
  };
  const no = (k: keyof ScatterRejections) => {
    rejected[k]++;
    return false;
  };
  /** Try one spot (rx, ry) with the random picks; true when an object went down. */
  const attempt = (rx: number, ry: number, oi: number, choice: number, turn: number, sp: number): boolean => {
    const o = list[oi];
    const facings = facingChoices(ctx, o);
    const facing = facings.length ? facings[Math.floor(turn * facings.length) % facings.length] : undefined;
    const state = o.states?.length ? o.states[Math.floor(choice * o.states.length) % o.states.length] : undefined;
    // Snap first (as place would) so the rules see the cells the object will cover.
    const known = o.spriteId !== undefined ? ctx.sprites?.[o.spriteId] : undefined;
    const fp = o.footprint ?? footprintFor(known, facing);
    const x = snapAxis(rx, fp?.w ?? 1), y = snapAxis(ry, fp?.h ?? 1);
    const [x0, y0, x1, y1] = objectRect({ x, y, footprint: fp ?? undefined });
    if (!region.has(x, y) || x0 < -1e-6 || y0 < -1e-6 || x1 > W + 1e-6 || y1 > H + 1e-6) return no('bounds');
    if (same.near(x, y, sp)) return no('spacing');
    if (other.near(x, y, spacingOther)) return no('spacingOther');
    let ok = true;
    for (let cy = Math.floor(y0); ok && cy < Math.max(Math.ceil(y1), Math.floor(y0) + 1); cy++)
      for (let cx = Math.floor(x0); ok && cx < Math.max(Math.ceil(x1), Math.floor(x0) + 1); cx++) ok = cx >= 0 && cy >= 0 && cx < W && cy < H && terrainOk(cx, cy);
    if (!ok) return no('terrain');
    if (opened) {
      for (let cy = Math.floor(y0); ok && cy < Math.max(Math.ceil(y1), Math.floor(y0) + 1); cy++)
        for (let cx = Math.floor(x0); ok && cx < Math.max(Math.ceil(x1), Math.floor(x0) + 1); cx++) ok = !opened[cy * W + cx];
      if (!ok) return no('path');
    }
    if (zones.some((z) => zoneDistance(z, x, y) <= margin + Math.max(fp?.w ?? 0, fp?.h ?? 0) / 2)) return no('zone');
    if (guard?.hits([x0, y0, x1, y1])) return no('route');
    const id = placeOrNull(doc, ctx, {
      op: 'place', x, y, snap: false,
      ...(o.spriteId !== undefined ? { spriteId: o.spriteId } : {}), ...(o.assetRef ? { assetRef: o.assetRef } : {}), ...(o.name ? { name: o.name } : {}),
      ...(state !== undefined ? { state } : {}), ...(facing !== undefined ? { facing } : {}), ...(fp ? { footprint: fp } : {}),
      ...(o.properties ? { properties: o.properties } : {}), ...(op.layer ? { layer: op.layer } : {}), ...(op.allowOverlap ? { allowOverlap: true } : {}),
      ...(o.collision === false ? { collision: false } : {}), scattered: true,
    });
    if (!id) return no('overlap');
    created.push(id);
    got[oi]++;
    same.add(x, y);
    const label = objectLabel(ctx, o);
    counts[label] = (counts[label] ?? 0) + 1;
    return true;
  };
  /** An object that still lacks some of its share, picked with r ∈ [0, 1) weighted by how many it lacks (-1: none). */
  const bulk = list.map((o) => {
    const fp = o.footprint ?? footprintFor(o.spriteId !== undefined ? ctx.sprites?.[o.spriteId] : undefined, facingChoices(ctx, o)[0]);
    return Math.max(1, (fp?.w ?? 1) * (fp?.h ?? 1));
  });
  const pickNeeded = (r: number, skip?: Set<number>): number => {
    let total = 0;
    for (let i = 0; i < list.length; i++) if (!skip?.has(i)) total += Math.max(0, need[i] - got[i]) * bulk[i];
    if (total <= 0) return -1;
    let acc = 0, last = -1;
    for (let i = 0; i < list.length; i++) {
      const n = skip?.has(i) ? 0 : Math.max(0, need[i] - got[i]) * bulk[i];
      if (n <= 0) continue;
      last = i;
      if (r * total < (acc += n)) return i;
    }
    return last;
  };
  // A pick that is turned down is kept for the next darts (up to STICKY of them) before a new one is drawn, so
  // the objects that are hard to fit get their turns too.
  const STICKY = 8;
  let pending = -1, pendingTries = 0;
  const [bx0, by0, bx1, by1] = region.box;
  let darts = 0, swept = 0, spacingUsed = spacing;
  // Round 0 throws as many darts as it always did; each retry throws a fresh budget, with the spacing relaxed
  // evenly towards the floor; the last retry is a sweep of every cell of the region.
  for (let round = 0; round <= retries && created.length < wantAll; round++) {
    const sp = retries > 0 ? spacing - ((spacing - floor) * round) / retries : spacing;
    spacingUsed = sp;
    if (round > 0 && round === retries) {
      const spots: { x: number; y: number; k: number }[] = [];
      for (let y = Math.floor(by0); y < Math.min(H, Math.ceil(by1)); y++)
        for (let x = Math.floor(bx0); x < Math.min(W, Math.ceil(bx1)); x++)
          if (region.has(x + 0.5, y + 0.5)) spots.push({ x: x + 0.5, y: y + 0.5, k: rand() * (cluster > 0 ? 0.05 : 1) + (cluster > 0 ? 1 - clusterKeep(x + 0.5, y + 0.5) : 0) });
      spots.sort((a, b) => a.k - b.k);
      for (const s of spots) {
        if (created.length >= wantAll) break;
        swept++;
        // Every object still short of its share gets a go at the spot, in a weighted random order.
        const choice = rand(), turn = rand(), tried = new Set<number>();
        for (let oi = pickNeeded(rand()); oi >= 0; oi = pickNeeded(rand(), tried)) {
          if (attempt(s.x, s.y, oi, choice, turn, sp)) break;
          tried.add(oi);
        }
      }
      break;
    }
    const budget = Math.min(200000, (round === 0 ? wantAll : wantAll - created.length) * 60 + 200);
    for (let a = 0; a < budget && created.length < wantAll; a++) {
      const rx = bx0 + rand() * (bx1 - bx0), ry = by0 + rand() * (by1 - by0);
      const pick = rand(), choice = rand(), turn = rand(), keep = rand();
      darts++;
      if (!region.has(rx, ry)) {
        rejected.bounds++;
        continue;
      }
      if (cluster > 0 && keep > clusterKeep(rx, ry)) {
        rejected.cluster++;
        continue;
      }
      if (pending < 0 || pendingTries >= STICKY || got[pending] >= need[pending]) (pending = pickNeeded(pick)), (pendingTries = 0);
      if (pending < 0) break;
      if (attempt(rx, ry, pending, choice, turn, sp)) pending = -1;
      else pendingTries++;
    }
  }
  const report: Record<string, unknown> = {
    placed: created.length, target, ...(op.topUp ? { existing } : {}), eligibleM2: Math.round(area * 100) / 100, byObject: counts,
    ...(list.length > 1 ? { byObjectAsked: labelSums(asked) } : {}),
    rejected: Object.fromEntries(Object.entries(rejected).filter(([, v]) => v > 0)), darts, ...(swept ? { swept } : {}),
    ...(Math.abs(spacingUsed - spacing) > 1e-9 ? { spacingUsed: Math.round(spacingUsed * mpt * 100) / 100 } : {}),
  };
  if (created.length < wantAll) {
    const short = need.map((n, i) => n - got[i]);
    if (list.length > 1 && short.some((n) => n > 0)) report.shortBy = Object.fromEntries(Object.entries(labelSums(short)).filter(([, n]) => n > 0));
    const top = (Object.entries(rejected) as [keyof ScatterRejections, number][]).filter(([k]) => k !== 'cluster' && k !== 'bounds').sort((a, b) => b[1] - a[1])[0];
    const hint: Record<keyof ScatterRejections, string> = {
      bounds: 'the region is mostly off the map',
      cluster: 'lower cluster',
      spacing: 'lower spacing or set relax',
      spacingOther: 'lower spacingOther',
      terrain: 'the allowed ground is full or too broken up for the footprint',
      zone: 'lower avoidMargin or avoid fewer zones',
      overlap: 'the free ground is taken by other objects\' footprints',
      path: 'a ford or bridge path keeps the ground clear (avoidPaths: false scatters over it)',
      route: 'lower avoidRoute.margin or scatter away from the route',
    };
    report.short = `${wantAll - created.length} not placed${retries === 0 ? ' (retries 0)' : ', every spot of the region tried'}`
      + (eligible === 0 ? ': no allowed ground in the region' : top && top[1] > 0 ? `: mostly ${top[0]} (${top[1]}) — ${hint[top[0]]}` : '');
  }
  return { created, report };
}

// --------------------------------------------------------------------------------------------------- path

/** Objects along a path: every `every` metres, `offset` metres to the side(s), facing along it or across. */
export interface PathObject extends GenObject {
  every: number;
  /** Metres from the centre line (default 0). */
  offset?: number;
  /** Which side(s) with an offset (default both); left is left looking along the path. */
  side?: 'left' | 'right' | 'both';
  /** Metres along the path to the first one (default every / 2). */
  start?: number;
  /**
   * Which way it turns, per spot from the path's direction there:
   * - "along" (default when the sprite has facings): its front points along the path (a soldier walking it);
   * - "across": its front points across the path;
   * - "parallel": its long side runs along the path (wire, walls, sandbags: from the export's per-facing footprints;
   *   without them, the same as "across");
   * - "perpendicular": its long side runs across the path (without footprints, the same as "along");
   * - or a fixed facing name.
   * A sprite rendered with fewer facings takes the opposite one when that lies closer (SE and NW are one line).
   */
  facing?: string;
  allowOverlap?: boolean;
}

export interface PathOp {
  op: 'path';
  /** Control points in cell units (a cell's centre is n + 0.5). */
  points: [number, number][];
  /** Ground terrain to lay (id, name or kind); omit to only place objects or block. */
  terrain?: string;
  /** Width in metres (default 2). Corners within half of it of the centre line take the terrain. */
  width?: number;
  /** Smooth curves through the points (default true with 3 or more). */
  smooth?: boolean;
  /** Wander sideways by up to this many metres (seeded noise; default 0). */
  jitter?: number;
  /** Length in metres of one wander (default 8). */
  jitterScale?: number;
  seed?: number | string;
  /**
   * true: also mark the cells under the path blocked (a river); false: clear them (a ford or a bridge across a
   * blocked river: exactly the cells under this path, not the water beside it). Omitted: collision is left alone.
   * The cells are those whose centre lies within half the width of the centre line.
   */
  collision?: boolean;
  /** Terrain of a band along both edges (a river's bank) and its width in metres (default 1). */
  edge?: string;
  edgeWidth?: number;
  objects?: PathObject[];
  layer?: string;
  /**
   * FB-100: also record the path as a polyline zone (a trench the game can find): its final, jittered centre line
   * (one point per cell of length) with `widthM` (and `terrain`, `edgeWidthM`) as properties. true = kind custom,
   * named "path"; or give the zone's kind, name, id and properties.
   */
  zone?: boolean | { kind?: ZoneKind; name?: string; id?: string; properties?: Properties };
}

/**
 * A path: the control points (smoothed, then jittered with seeded noise) become a centre line; ground corners within
 * half the width take the terrain, an optional edge band takes another, cells under it can be blocked, and objects
 * are placed at intervals along it (wire along a trench, sandbags every few metres) through `place`.
 */
export function opPath(doc: MapBody, op: PathOp, ctx: OpsContext): OpOutcome {
  if (!Array.isArray(op.points) || op.points.length < 2 || op.points.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== 'number' || !Number.isFinite(n))))
    fail('a path needs at least 2 points [x, y]');
  if (op.collision !== undefined && typeof op.collision !== 'boolean') fail('collision must be true (block) or false (clear)');
  if (op.terrain === undefined && !op.objects?.length && op.collision === undefined && !op.zone) fail('a path needs a terrain, objects, collision or zone');
  if (op.zone !== undefined && typeof op.zone !== 'boolean' && (!op.zone || typeof op.zone !== 'object' || Array.isArray(op.zone))) fail('zone must be true or { kind?, name?, id?, properties? }');
  const mpt = doc.metresPerTile, W = doc.width, H = doc.height;
  const width = (op.width !== undefined ? num(op.width, 'width') : 2) / mpt;
  if (width <= 0 || width > 64) fail('width must be more than 0 and at most 64 cells');
  const jitter = (op.jitter !== undefined ? num(op.jitter, 'jitter') : 0) / mpt;
  const jitterScale = op.jitterScale !== undefined ? num(op.jitterScale, 'jitterScale') : 8;
  if (jitter < 0 || !(jitterScale > 0)) fail('jitter must be ≥ 0 and jitterScale positive');
  const seed = mapSeed(op.seed ?? 0);
  let line: Pt[] = op.points.map((p) => [p[0], p[1]]);
  if (op.smooth !== false) line = smoothLine(line);
  // Resample at a quarter cell, then push each sample sideways by the wander noise.
  const samples = resample(line, 0.25);
  if (jitter > 0) line = samples.map(({ p, s, dir }) => {
    const d = noise1(seed, s * mpt, jitterScale) * jitter;
    return [p[0] - dir[1] * d, p[1] + dir[0] * d];
  });
  else line = samples.map((x) => x.p);
  const half = width / 2;
  const report: Record<string, unknown> = { length: Math.round((samples[samples.length - 1]?.s ?? 0) * mpt * 100) / 100 };
  const box = [Math.min(...line.map((p) => p[0])), Math.min(...line.map((p) => p[1])), Math.max(...line.map((p) => p[0])), Math.max(...line.map((p) => p[1]))];
  const edgeW = op.edge !== undefined ? (op.edgeWidth !== undefined ? num(op.edgeWidth, 'edgeWidth') : 1) / mpt : 0;
  const reach = half + edgeW + 1;
  const near = (x: number, y: number) => x >= box[0] - reach && x <= box[2] + reach && y >= box[1] - reach && y <= box[3] + reach;
  if (op.terrain !== undefined) {
    const g = layerFor(doc, 'ground', op.layer);
    const t = needTerrain(doc, ctx, g, op.terrain, 'path terrain');
    const e = op.edge !== undefined ? needTerrain(doc, ctx, g, op.edge, 'path edge') : null;
    let n = 0, ne = 0;
    const dist = gridDistances(line, W + 1, H + 1, reach, 0);
    for (let y = 0; y <= H; y++)
      for (let x = 0; x <= W; x++) {
        if (!near(x, y)) continue;
        const d = dist[y * (W + 1) + x];
        if (d <= half + 1e-6) {
          g.corners[y * (W + 1) + x] = t;
          n++;
        } else if (e && d <= half + edgeW + 1e-6 && g.corners[y * (W + 1) + x] !== t) {
          g.corners[y * (W + 1) + x] = e;
          ne++;
        }
      }
    report.terrain = t;
    report.corners = n;
    if (e) report.edgeCorners = ne;
  }
  if (op.collision !== undefined) {
    const c = doc.layers.find((l) => l.type === 'collision');
    if (!c || c.type !== 'collision') fail('the map has no collision layer');
    // FB-069: block (true) or clear (false) exactly the cells under the path.
    const v: 0 | 1 = op.collision ? 1 : 0;
    let n = 0, opened = 0;
    const dist = gridDistances(line, W, H, reach, 0.5);
    // FB-120: a clearing path records the cells it opened (scatter and generate keep off them); a blocking one unmarks them.
    const cl = c as { cells: (0 | 1)[]; opened?: (0 | 1)[] };
    if (!v && cl.opened?.length !== W * H) cl.opened = new Array(W * H).fill(0);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!near(x + 0.5, y + 0.5) || dist[y * W + x] > half + 1e-6) continue;
        if (cl.cells[y * W + x] !== v) (cl.cells[y * W + x] = v), n++;
        if (!v && !cl.opened![y * W + x]) (cl.opened![y * W + x] = 1), opened++;
        else if (v && cl.opened?.[y * W + x]) cl.opened[y * W + x] = 0;
      }
    if (cl.opened && !cl.opened.some(Boolean)) delete cl.opened;
    report[v ? 'blocked' : 'cleared'] = n;
    if (!v) report.opened = opened;
  }
  const created: string[] = [];
  if (op.zone) {
    // FB-100: the centre line as the game will see it, a point per cell of length (plus the last), kept on the map.
    const z = typeof op.zone === 'object' ? op.zone : {};
    const clamp = (v: number, hi: number) => Math.round(Math.max(0, Math.min(hi, v)) * 1000) / 1000;
    const pts: [number, number][] = [];
    line.forEach((p, i) => {
      if (i % 4 !== 0 && i !== line.length - 1) return;
      const q: [number, number] = [clamp(p[0], W), clamp(p[1], H)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
    });
    if (pts.length < 2) fail('zone: the path has less than 2 points on the map');
    const props: Properties = {
      ...checkProps(z.properties, 'zone.properties'), widthM: Math.round(width * mpt * 1000) / 1000,
      ...(op.terrain !== undefined && typeof report.terrain === 'string' ? { terrain: report.terrain } : {}),
      ...(op.edge !== undefined ? { edgeWidthM: Math.round(edgeW * mpt * 1000) / 1000 } : {}),
    };
    const id = opAddZone(doc, { op: 'addZone', kind: z.kind ?? 'custom', name: z.name ?? 'path', shape: 'polyline', points: pts, properties: props, ...(z.id !== undefined ? { id: z.id } : {}) });
    created.push(id);
    report.zone = id;
    report.zonePoints = pts.length;
  }
  if (op.objects?.length) {
    if (!Array.isArray(op.objects)) fail('objects must be a list');
    const placed: Record<string, number> = {};
    let skipped = 0, tried = 0;
    const rejected: Partial<Record<PathRejection, number>> = {};
    const spots: { object: string; x: number; y: number; cause: PathRejection; with?: string; message?: string }[] = [];
    const blockers: Record<string, number> = {};
    // The final line's arc-length samples, for positions and directions.
    const along = resample(line, 0.05);
    const total = along[along.length - 1]?.s ?? 0;
    op.objects.forEach((o, i) => {
      checkGenObject(ctx, o, `objects[${i}]`);
      const every = num(o.every, `objects[${i}].every`) / mpt;
      if (!(every > 0)) fail(`objects[${i}].every must be a positive number of metres`);
      const offset = (o.offset !== undefined ? num(o.offset, `objects[${i}].offset`) : 0) / mpt;
      const sides = offset === 0 ? [0] : o.side === 'left' ? [-1] : o.side === 'right' ? [1] : [-1, 1];
      const start = o.start !== undefined ? num(o.start, `objects[${i}].start`) / mpt : every / 2;
      const known = o.spriteId !== undefined ? ctx.sprites?.[o.spriteId] : undefined;
      const names = Array.isArray(o.facings) && o.facings.length ? o.facings : Object.keys(known?.directions ?? {}).length ? Object.keys(known!.directions!) : ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
      const mode = o.facing ?? (o.spriteId !== undefined && Object.keys(known?.directions ?? {}).length ? 'along' : undefined);
      const label = objectLabel(ctx, o);
      for (let s = start; s <= total + 1e-6; s += every) {
        let k = 0;
        while (k < along.length - 1 && along[k + 1].s < s) k++;
        const { p, dir } = along[Math.min(k + 1, along.length - 1)];
        for (const side of sides) {
          const x = p[0] - dir[1] * offset * side, y = p[1] + dir[0] * offset * side;
          const facing = mode !== undefined && (PATH_FACING_MODES as readonly string[]).includes(mode)
            ? pathFacing(doc, names, dir, mode as PathFacingMode, (f) => o.footprint ?? footprintFor(known, f))
            : mode;
          const fp = o.footprint ?? footprintFor(known, facing);
          tried++;
          const r = placeOrWhy(doc, ctx, {
            op: 'place', x, y,
            ...(o.spriteId !== undefined ? { spriteId: o.spriteId } : {}), ...(o.assetRef ? { assetRef: o.assetRef } : {}), ...(o.name ? { name: o.name } : {}),
            ...(o.states?.length ? { state: o.states[0] } : {}), ...(facing !== undefined ? { facing } : {}), ...(fp ? { footprint: fp } : {}),
            ...(o.properties ? { properties: o.properties } : {}), ...(o.allowOverlap ? { allowOverlap: true } : {}),
            ...(o.collision === false ? { collision: false } : {}),
          });
          if ('id' in r) {
            created.push(r.id);
            placed[label] = (placed[label] ?? 0) + 1;
          } else {
            skipped++;
            rejected[r.cause] = (rejected[r.cause] ?? 0) + 1;
            if (r.with) blockers[r.with] = (blockers[r.with] ?? 0) + 1;
            // The first few spots (snapped as place snaps them), in cells, so the next try can be planned.
            const sx = snapAxis(x, fp?.w ?? 1), sy = snapAxis(y, fp?.h ?? 1);
            if (spots.length < 20) spots.push({ object: label, x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100, cause: r.cause, ...(r.with ? { with: r.with } : {}), ...(r.cause === 'other' || r.cause === 'facing' || r.cause === 'state' ? { message: r.message } : {}) });
          }
        }
      }
    });
    report.placed = placed;
    if (skipped) {
      report.skipped = skipped;
      report.rejected = rejected;
      report.rejectedSpots = spots;
      const hint: Record<PathRejection, string> = {
        bounds: 'the path runs off the map or too close to its edge for the footprint (move the points in or lower offset)',
        overlap: `other objects' footprints are in the way${Object.keys(blockers).length ? ` (${Object.entries(blockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ×${n}`).join(', ')})` : ''}: raise every, change offset or start, or allowOverlap: true`,
        facing: 'the sprite has no such facing: check facings against its export',
        state: 'the sprite has no such state',
        other: spots.find((x) => x.cause === 'other')?.message ?? 'see rejectedSpots',
      };
      const top = (Object.entries(rejected) as [PathRejection, number][]).sort((a, b) => b[1] - a[1])[0];
      report.short = `${skipped} of ${tried} not placed: mostly ${top[0]} (${top[1]}) — ${hint[top[0]]}`;
    }
  }
  return { created, report };
}

// -------------------------------------------------------------------------------------------------- stamp

export interface StampOp {
  op: 'stamp';
  /** A saved stamp's name, or a stamp body. */
  stamp: string | MapStamp;
  /** Where the stamp's top-left cell corner goes (with `centre`, its centre), in cells. */
  x: number;
  y: number;
  centre?: boolean;
  /** Clockwise quarter turns in degrees: 0, 90, 180 or 270. */
  rotate?: 0 | 90 | 180 | 270;
  /** Only these parts (default all). */
  layers?: StampLayer[];
  /**
   * Which ground corners it writes: "mask" (default) only those the stamp painted differently from the ground it was
   * cut from (its recorded mask, or for older stamps one derived from its border), "rect" its whole rectangle,
   * "none" no ground.
   */
  ground?: 'mask' | 'rect' | 'none';
  allowOverlap?: boolean;
  /** FB-101: remove scatter-placed objects under the stamp's objects (reported as `cleared`) instead of refusing. */
  clear?: boolean;
}

/**
 * Place a stamp: its ground corners ('' leaves the map's), decoration (remapped to the map's tileset slots),
 * blocked cells, objects (new ids, through `place`: footprints checked, per-facing footprints after a turn) and zones
 * (new ids). Anything that does not fit fails the whole op.
 */
export function opStamp(doc: MapBody, op: StampOp, ctx: OpsContext): OpOutcome {
  let s: MapStamp;
  if (typeof op.stamp === 'string') {
    s = ctx.stamps?.[op.stamp.toLowerCase()] ?? fail(`no stamp "${op.stamp}"${ctx.stamps ? ` (stamps: ${Object.values(ctx.stamps).map((x) => x.name).join(', ') || 'none'})` : ''}`);
  } else {
    s = op.stamp;
    const e = validateStamp(s);
    if (e.length) fail(`stamp: ${e.join('; ')}`);
  }
  const rot = op.rotate ?? 0;
  if (![0, 90, 180, 270].includes(rot)) fail('rotate must be 0, 90, 180 or 270');
  if (s.metresPerTile && Math.abs(s.metresPerTile - doc.metresPerTile) > 1e-6) fail(`stamp "${s.name}" was cut at ${s.metresPerTile} m per tile; this map is ${doc.metresPerTile}`);
  const r = rotateStamp(s, rot / 90);
  const want = new Set<StampLayer>(op.layers?.length ? op.layers : STAMP_LAYERS);
  for (const l of want) if (!STAMP_LAYERS.includes(l)) fail(`layers must be some of ${STAMP_LAYERS.join(', ')}`);
  let ox = num(op.x, 'x'), oy = num(op.y, 'y');
  if (op.centre) (ox -= r.width / 2), (oy -= r.height / 2);
  ox = Math.round(ox);
  oy = Math.round(oy);
  const W = doc.width, H = doc.height;
  if (ox < 0 || oy < 0 || ox + r.width > W || oy + r.height > H) fail(`stamp "${s.name}" (${r.width}×${r.height}) at (${ox}, ${oy}) does not fit the ${W}×${H} map`);
  const report: Record<string, unknown> = { stamp: s.name, at: [ox, oy], size: [r.width, r.height], rotate: rot };
  const warnings: string[] = [];
  const groundMode = op.ground ?? 'mask';
  if (!['mask', 'rect', 'none'].includes(groundMode)) fail('ground must be "mask", "rect" or "none"');
  if (want.has('ground') && r.ground && groundMode !== 'none') {
    const g = layerFor(doc, 'ground');
    const mask = groundMode === 'mask' ? stampGroundMask(r) : null;
    const cache = new Map<string, string>();
    let n = 0;
    r.ground.forEach((t, i) => {
      if (!t || (mask && !mask[i])) return;
      if (!cache.has(t)) cache.set(t, needTerrain(doc, ctx, g, t, `stamp "${s.name}"`));
      g.corners[(oy + Math.floor(i / (r.width + 1))) * (W + 1) + ox + (i % (r.width + 1))] = cache.get(t)!;
      n++;
    });
    report.ground = { mode: groundMode, corners: n, ...(mask && !s.groundMask ? { mask: 'derived from the border' } : {}) };
  }
  if (want.has('decoration') && r.decoration) {
    const d = layerFor(doc, 'decoration');
    r.decoration.forEach((gid, i) => {
      if (!gid) return;
      const sp = splitGid(gid)!;
      const tsId = r.tilesets[sp.slot];
      const slot = tsId === undefined ? sp.slot : doc.tilesets.indexOf(tsId);
      if (slot < 0 || slot >= doc.tilesets.length) fail(`stamp "${s.name}" uses tileset ${tsId ?? sp.slot}, which this map does not have`);
      d.cells[(oy + Math.floor(i / r.width)) * W + ox + (i % r.width)] = mapGid(slot, sp.id);
    });
  }
  if (want.has('collision') && r.collision) {
    const c = layerFor(doc, 'collision');
    r.collision.forEach((v, i) => {
      if (v) c.cells[(oy + Math.floor(i / r.width)) * W + ox + (i % r.width)] = 1;
    });
  }
  const created: string[] = [];
  const cleared: string[] = [];
  if (want.has('objects'))
    for (const o of r.objects) {
      // A turned facing the sprite's export doesn't have falls back to the nearest one it has (a warning).
      let facing = o.facing;
      let known = o.spriteId !== undefined ? checkSprite(ctx, o.spriteId, o.state) : undefined;
      const have = Object.keys(known?.directions ?? {});
      let fellBack = false;
      if (facing !== undefined && have.length && !have.includes(facing)) {
        const near = facingAngle(facing) !== null ? nearestFacing(have, facingAngle(facing)!) : undefined;
        const to = near ?? have[0];
        warnings.push(`${objectLabel(ctx, o)}: sprite ${o.spriteId} has no facing "${facing}" (facings: ${have.join(', ')}); used ${to} — render it with more facings (e.g. --facings 4) to turn it`);
        facing = to;
        fellBack = true;
      }
      if (o.spriteId !== undefined) known = checkSprite(ctx, o.spriteId, o.state, facing);
      // A sprite whose export has per-facing footprints takes the one for its (turned) facing; one that fell back
      // keeps the footprint of the facing it is drawn with.
      const fp = (known?.directions && facing !== undefined && known.directions[facing] ? footprintFor(known, facing) : null)
        ?? (fellBack && known ? footprintFor(known, facing) : null) ?? o.footprint ?? null;
      created.push(opPlace(doc, {
        op: 'place', x: o.x + ox, y: o.y + oy, snap: false,
        ...(o.spriteId !== undefined ? { spriteId: o.spriteId } : {}), ...(o.assetRef ? { assetRef: o.assetRef } : {}), ...(o.name ? { name: o.name } : {}),
        ...(o.state !== undefined ? { state: o.state } : {}), ...(facing !== undefined ? { facing } : {}),
        footprint: fp, properties: o.properties, ...(op.allowOverlap ? { allowOverlap: true } : {}),
        ...(o.on !== undefined && /^#\d+$/.test(o.on) && created[Number(o.on.slice(1))] !== undefined ? { on: created[Number(o.on.slice(1))] } : {}),
        ...(o.elevation ? { elevation: o.elevation } : {}), ...(o.collision === false ? { collision: false } : {}), ...(o.group !== undefined ? { group: o.group } : {}),
        ...(op.clear ? { clear: true } : {}),
      }, ctx, cleared));
    }
  if (want.has('zones'))
    for (const z of r.zones)
      created.push(opAddZone(doc, {
        op: 'addZone', kind: z.kind, name: z.name, shape: z.shape, points: z.points.map(([x, y]) => [x + ox, y + oy] as [number, number]), properties: z.properties,
        // FB-059: the zone's vehicle and speed come along (the vehicle as it was checked when the stamp was saved).
        ...(z.vehicle ? { vehicleId: z.vehicle.spriteId } : {}), ...(z.speed !== undefined ? { speed: z.speed } : {}),
      }, z.vehicle?.name ? { spriteNames: { [z.vehicle.spriteId]: z.vehicle.name } } : {}));
  report.objects = r.objects.length && want.has('objects') ? r.objects.length : 0;
  report.zones = want.has('zones') ? r.zones.length : 0;
  if (warnings.length) report.warnings = warnings;
  if (op.clear) report.cleared = cleared;
  return { created, report };
}
