// Moved from synty-sprite-generator packages/shared/src/object/footprint.ts (P2, ali3b/sloponator#8).
/**
 * Objects and props on a game map: footprint, height, anchor and ground collision polygon, from the model's
 * geometry. Pure maths shared by the exporter (which feeds it the mesh vertices) and its tests.
 *
 * Axes. Model axes are the model's own, metres, with the origin at its pivot: x = model +X, z = model +Z, y up. A
 * single-direction sprite (and the "S" facing of any view) shows the model unrotated, with +Z towards the camera.
 * The renderer turns the model by `yawForAngle(worldAngle)` about +Y and looks from +Z down at `pitch`, so a ground
 * point (x, 0, z) turned by yaw θ lands on screen at right = x', up = -z'·sin(pitch) (see `projectGround`).
 *
 * Tile grids. Square tiles run along the screen axes (u = right, v = down the screen). Diamond (2:1 iso) tiles run
 * along the screen diagonals like Tiled's isometric maps: u = down-right, v = down-left. A tile is
 * `metresPerTile` metres on a side on the ground in both cases.
 */
import { facingAxis, viewGrid, yawForAngle, type Direction, type Framing, type ScaleConfig, type ViewConfig } from '../view/camera.js';
import { autoCategory, nameWords } from '../inputs/categories.js';
import { concaveOutline } from './concave.js';
import type { ObjectSlices } from './slices.js';

export type Vec2 = [number, number];

/** Asset kinds that stand on the map as objects and get an `object` block in their export manifest. */
export const OBJECT_ASSET_KINDS = ['prop', 'multipart', 'vehicle'];
export const isObjectAssetKind = (kind: string) => OBJECT_ASSET_KINDS.includes(kind);

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * Convex hull (Andrew's monotone chain), counter-clockwise in (x, z) maths orientation, no repeated or collinear
 * points. Fewer than three distinct points come back as they are (deduplicated).
 */
export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (pts.length < 3) return pts;
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Signed area of a polygon (positive = counter-clockwise in (x, z) maths orientation). */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Turn a model-axes ground point by a yaw (radians about +Y, as three.js `rotation.y` does). */
export function rotateYaw([x, z]: Vec2, yaw: number): Vec2 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/** The pitch the renderer actually uses (a straight-down view is rendered at 89.9°). */
const renderPitch = (pitch: number) => (Math.min(Math.max(pitch, 0), 89.9) * Math.PI) / 180;

/**
 * Where a model-axes point at height y lands on screen, in metres from the model origin's screen position:
 * right (+ = screen right) and up (+ = screen up), for a sprite rendered at `worldAngle` and `pitch`.
 */
export function projectGround(p: Vec2, y: number, worldAngle: number, pitch: number): { right: number; up: number } {
  const [x, z] = rotateYaw(p, yawForAngle(worldAngle));
  const pr = renderPitch(pitch);
  return { right: x, up: y * Math.cos(pr) - z * Math.sin(pr) };
}

/** Screen pixels per metre of a framing (fit mode: whatever fitting chose). */
export const framingPpm = (f: Framing) => f.ppm ?? f.frameWidth / (2 * f.viewHalfW);

/** A model-axes point at height y as a pixel in the untrimmed frame (from its top-left), for an ortho render. */
export function toFramePx(p: Vec2, y: number, worldAngle: number, pitch: number, f: Framing): Vec2 {
  const s = projectGround(p, y, worldAngle, pitch);
  const k = framingPpm(f);
  return [f.pivot.x + s.right * k, f.pivot.y - s.up * k];
}

export type TileScale = Extract<ScaleConfig, { mode: 'tile' }>;

/** Unit ground vectors of the tile grid's u and v axes in the camera's frame (x right, z towards the camera). */
export function gridAxes(shape: TileScale['shape']): [Vec2, Vec2] {
  const h = Math.SQRT1_2;
  return shape === 'diamond' ? [[h, h], [-h, h]] : [[1, 0], [0, 1]];
}

/** Metres along a footprint side → whole tiles it covers (ceil, with a millimetre of slack) and the exact count. */
export function metresToTiles(m: number, metresPerTile: number) {
  const exact = m / metresPerTile;
  return { tiles: Math.max(1, Math.ceil(exact - 1e-3 / metresPerTile)), exact: round(exact, 3) };
}

const round = (v: number, d: number) => {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return Object.is(r, -0) ? 0 : r;
};
const roundPt = (p: Vec2, d: number): Vec2 => [round(p[0], d), round(p[1], d)];

export interface ObjectDirection {
  name: string;
  worldAngle: number;
  /** This direction shows another one flipped horizontally (its pixels are already flipped here). */
  mirrorOf: string | null;
  /** Pixel in the untrimmed frame (from its top-left) where the footprint's ground centre is drawn. */
  anchor: { x: number; y: number };
  /** The ground collision polygon in frame pixels (same points and order as `collision.points`). */
  polygon: Vec2[];
  /** With a `base` collision: the whole model's hull (`canopy.points`) in frame pixels. */
  canopyPolygon?: Vec2[];
  /** With a tile scale: the footprint along the grid's u and v axes, and the polygon in tiles around the anchor. */
  tiles?: { u: number; v: number; uExact: number; vExact: number; polygon: Vec2[] };
  /** The grid axis the model's front (+Z) points along ('+u' = down-right on a diamond grid), or null when not grid-aligned. */
  facing?: '+u' | '+v' | '-u' | '-v' | null;
}

export interface ObjectInfo {
  /** Model-axes footprint in metres: w along x, d along z, and its bounds around the model origin. */
  footprint: { w: number; d: number; minX: number; maxX: number; minZ: number; maxZ: number };
  /** Top of the model above the ground plane (y = 0 at the model origin), metres. */
  height: number;
  /** Lowest point (0 for a model standing on its origin; negative when it reaches below the ground). */
  bottom: number;
  /** Ground centre of the footprint relative to the model origin, metres (model axes). The anchor is drawn here. */
  centre: { x: number; z: number };
  /** Footprint in whole tiles (ceil) and exact, model axes lined up with the grid. Null without a tile scale. */
  tiles: { w: number; d: number; wExact: number; dExact: number; tilePx: number; metresPerTile: number; shape: 'square' | 'diamond' } | null;
  /**
   * Ground collision polygon in metres, model axes, counter-clockwise in (x, z) (positive signed area). `base` = the
   * hull of the vertices below `cut` metres above the model's bottom (what stands on the ground: a tree's trunk),
   * used when it is meaningfully smaller than the whole model's hull (then kept as `canopy`).
   */
  collision: { source: CollisionSource; points: Vec2[]; cut?: number; rule?: CollisionRule };
  /** With a `base` collision: the hull of the whole model seen from above (a tree's canopy), metres, model axes. */
  canopy?: { source: 'hull' | 'bounds'; points: Vec2[] };
  /** Pixels per metre the screen coordinates use (the locked scale, or what fitting chose). Null for perspective. */
  pixelsPerMetre: number | null;
  /** The first direction's anchor (single-direction props need nothing else); per direction in `directions`. */
  anchor: { x: number; y: number } | null;
  /** Screen data per direction (empty for perspective views, which have no single pixel scale). */
  directions: ObjectDirection[];
  /** With `slice: 'columns'` on a diamond tile lock: per-tile-column strips of every frame (see `objectSlices`). */
  slices?: ObjectSlices;
  note: string;
  /**
   * Object states (object/states.ts): each state's own model measured the same way. Every state is drawn with
   * the same framing, so the object's `anchor` above (the base state's) places all of them.
   */
  states?: ObjectStateInfo[];
  /** Object states: the transition animations (e.g. intact_to_destroyed) and the states they join. */
  transitions?: ObjectTransitionInfo[];
}

/** One state of an object export: its animation, model, and its own footprint and collision. */
export interface ObjectStateInfo {
  name: string;
  /** The clip holding this state (one still frame per direction, or a loop: see `loop`). */
  animation: string;
  /** The library model drawn for it. */
  asset: string;
  /** A procedural look of that model (e.g. "scorch": the intact model burnt out, when there is no destroyed model). */
  look?: string;
  /**
   * The looping template this state plays (FB-056, e.g. "drive"): `animation` then loops instead of holding one
   * frame. Footprint and collision are measured at its first frame.
   */
  loop?: string;
  footprint: ObjectInfo['footprint'];
  height: number;
  bottom: number;
  centre: ObjectInfo['centre'];
  tiles: ObjectInfo['tiles'];
  collision: ObjectInfo['collision'];
  /** Footprint, tiles and collision equal the base state's (within a centimetre). */
  sameAsBase: boolean;
  /** This state's collision polygon in frame pixels, per direction (and in tiles around the object's anchor). */
  directions: { name: string; polygon: Vec2[]; tiles?: { u: number; v: number; polygon: Vec2[] } }[];
}

export interface ObjectTransitionInfo {
  /** The animation name: `<from>_to_<to>`. */
  animation: string;
  from: string;
  to: string;
  /** The model the transition is rendered on (the `from` state's). */
  asset: string;
}

/**
 * The states block of an object export: per state, its own measurements (`info`, measured with the shared
 * framing), and whether they match the base state's. Tile polygons are re-centred on the base state's anchor so
 * one placement holds for every state.
 */
export function objectStates(base: ObjectInfo, states: { name: string; animation: string; asset: string; look?: string; loop?: string; info: ObjectInfo | null }[], transitions: ObjectTransitionInfo[] = []): ObjectInfo {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  const list: ObjectStateInfo[] = states.flatMap(({ name, animation, asset, look, loop, info }) => {
    if (!info) return [];
    const f = info.footprint, b = base.footprint;
    const sameAsBase = near(f.minX, b.minX) && near(f.maxX, b.maxX) && near(f.minZ, b.minZ) && near(f.maxZ, b.maxZ) &&
      (info.tiles?.w ?? 0) === (base.tiles?.w ?? 0) && (info.tiles?.d ?? 0) === (base.tiles?.d ?? 0);
    // Tile polygons around the base state's anchor: shift by this state's footprint centre minus the base's,
    // turned like the direction (a mirrored direction uses its source's shift, flipped like flipTiles).
    const delta: Vec2 = [info.centre.x - base.centre.x, info.centre.z - base.centre.z];
    const shiftFor = (worldAngle: number): Vec2 => {
      if (!info.tiles) return [0, 0];
      const [u, v] = gridAxes(info.tiles.shape);
      const q = rotateYaw(delta, yawForAngle(worldAngle));
      return [(q[0] * u[0] + q[1] * u[1]) / info.tiles.metresPerTile, (q[0] * v[0] + q[1] * v[1]) / info.tiles.metresPerTile];
    };
    const directions = info.directions.map((d) => {
      const out: ObjectStateInfo['directions'][number] = { name: d.name, polygon: d.polygon };
      if (d.tiles && info.tiles) {
        const src = d.mirrorOf ? info.directions.find((x) => x.name === d.mirrorOf) : d;
        let [du, dv] = shiftFor(src?.worldAngle ?? d.worldAngle);
        if (d.mirrorOf) [du, dv] = info.tiles.shape === 'diamond' ? [dv, du] : [-du, dv];
        out.tiles = { u: d.tiles.u, v: d.tiles.v, polygon: d.tiles.polygon.map(([a, c]) => roundPt([a + du, c + dv], 3)) };
      }
      return out;
    });
    return [{ name, animation, asset, ...(look ? { look } : {}), ...(loop ? { loop } : {}), footprint: info.footprint, height: info.height, bottom: info.bottom, centre: info.centre, tiles: info.tiles, collision: info.collision, sameAsBase, directions }];
  });
  return { ...base, states: list, ...(transitions.length ? { transitions } : {}) };
}

export const OBJECT_NOTE =
  'Metres are in the model\'s own axes (x right, z towards the camera in the S / single-direction sprite, y up; origin = ' +
  'the model pivot). anchor = the pixel (untrimmed frame, from top-left) where the footprint\'s ground centre is drawn: ' +
  'put it on the centre of the tiles the object covers (an even tile count puts it on a tile corner). Diamond tiles: u ' +
  'runs down-right, v down-left (Tiled isometric); square tiles: u right, v down. polygon = the ground collision ' +
  'polygon in frame pixels; tiles.polygon = the same polygon in tile units around the anchor. collision.source "base" = ' +
  'the hull of what stands on the ground (vertices below collision.cut metres above the bottom, e.g. a tree trunk); the ' +
  'whole model\'s hull is then canopy (canopyPolygon per direction), and footprint/tiles still cover the whole model. ' +
  'collision.rule says why: vehicle/building = always the whole hull; thin (trees, poles, lamps, signs) = the slice ' +
  'when it is at most half the hull; shape = the slice only under 15 % of the hull and near the middle; height = ' +
  'collisionHeight was given; asked = collision "base" or "full" was given.';

/**
 * Tiles of a horizontally flipped sprite: a diamond grid's u (down-right) and v (down-left) swap places; a square
 * grid's u (right) turns round.
 */
function flipTiles(t: NonNullable<ObjectDirection['tiles']>, shape: TileScale['shape']): NonNullable<ObjectDirection['tiles']> {
  if (shape === 'diamond') return { u: t.v, v: t.u, uExact: t.vExact, vExact: t.uExact, polygon: t.polygon.map(([a, b]) => [b, a]) };
  return { ...t, polygon: t.polygon.map(([a, b]) => [round(-a, 3), b]) };
}

export interface ObjectInput {
  /** Ground projection of the mesh (x, z pairs in model axes, metres). */
  points: Vec2[];
  minY: number;
  maxY: number;
  /** Lowest height (y, metres) of the mesh at each of `points` (same order): enables the ground-slice collision. */
  heights?: number[];
  /** Height of the ground slice above the model's bottom, metres (default `defaultCollisionCut`). */
  collisionHeight?: number;
  /**
   * 'full' = always the whole hull; 'base' = the ground slice whenever it has an area; 'concave' = the concave
   * outline of the slice (FB-099; the whole height unless `collisionHeight`); 'none' = no collision (an object
   * state such as a blown gate, FB-085); 'auto' (default) = `collisionRule`.
   */
  collision?: StateCollision;
  /**
   * Triangles of the mesh, 9 numbers each (x, y, z of three corners, model axes, metres): what `concave` outlines
   * (without them it outlines `points`).
   */
  tris?: ArrayLike<number>;
  /** What the model is (name, library kind, category): decides the automatic rule. */
  subject?: CollisionSubject;
  view: Pick<ViewConfig, 'pitch' | 'projection' | 'scale'>;
  framing: Framing;
  directions: Direction[];
}

/** The default ground slice: 0.5 m above the model's bottom, or the lowest 15 % of its height, whichever is smaller. */
export const defaultCollisionCut = (height: number) => Math.min(0.5, 0.15 * Math.max(0, height));

/** The base collision is used when its area is at most this share of the whole hull's. */
export const BASE_AREA_RATIO = 0.5;

/** The base collision of an unclassified model needs a slice at most this share of the whole hull's area (FB-050). */
export const THIN_BASE_RATIO = 0.15;

/**
 * How the collision polygon is chosen: `auto` by what the model is and its shape; `base` / `full` asked for;
 * `concave` = the outline of the ground slice following a curved wall or fence (FB-099).
 */
export type CollisionMode = 'auto' | 'base' | 'full' | 'concave';
export const COLLISION_MODES: CollisionMode[] = ['auto', 'base', 'full', 'concave'];
/** An object state's collision (FB-085): any mode, or `none` (a blown gate, a flattened fence: nothing to collide with). */
export type StateCollision = CollisionMode | 'none';
export const STATE_COLLISIONS: StateCollision[] = [...COLLISION_MODES, 'none'];
/** Where a collision polygon came from: the hull, the bounds, the ground slice's hull, its concave outline, or nothing. */
export type CollisionSource = 'hull' | 'bounds' | 'base' | 'concave' | 'none';
export interface CollisionSubject { name?: string; kind?: string; category?: string | null }
/**
 * Why the collision is what it is: `asked` (collision base/full), `height` (collisionHeight given: the slice when
 * it is at most half the hull), `vehicle` / `building` (always the whole hull), `thin` (vegetation, poles, lamps,
 * signs: the slice when it is at most half the hull), `shape` (anything else: the slice only when it is under
 * 15 % of the hull and sits near the middle, like a trunk under a canopy).
 */
export type CollisionRule = 'asked' | 'height' | 'vehicle' | 'building' | 'thin' | 'shape';

const wordSet = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
/** Vehicles and aircraft: whatever touches the ground (wheels, skids, a tail wheel), they collide with their whole body. */
const VEHICLE_WORDS = wordSet('veh vehicle car van truck lorry bus tank halftrack jeep buggy tractor wagon cart bike motorbike motorcycle boat ship plane airplane aeroplane aircraft heli helicopter chopper jet bomber fighter glider blimp zeppelin train locomotive tram apc');
const BUILDING_WORDS = wordSet('bld building house hut cabin barn shack bunker tower warehouse garage');
/** Thin at the bottom, wide at the top: trees, poles, lamps, signs, flags, masts, umbrellas. */
const THIN_WORDS = wordSet('tree palm pine oak birch willow sapling pole post lamp lamppost streetlight light sign signpost flag flagpole banner mast antenna aerial pylon umbrella parasol windmill totem');

/**
 * The automatic collision rule for a model (FB-050): vehicles, aircraft and buildings always use the whole hull;
 * vegetation and pole-like things (by category or name) use the ground slice when it is much smaller; anything
 * else is decided by its shape.
 */
export function collisionRule(subject: CollisionSubject | undefined): 'vehicle' | 'building' | 'thin' | 'shape' {
  if (!subject) return 'shape';
  const words = subject.name ? nameWords(subject.name) : [];
  const category = subject.category ?? (subject.name && subject.kind ? autoCategory(subject.name, subject.kind)?.category : undefined) ?? null;
  if (subject.kind === 'vehicle' || category === 'vehicle' || category === 'wreck' || words.some((w) => VEHICLE_WORDS.has(w))) return 'vehicle';
  if (category === 'building' || words.slice(0, 3).some((w) => BUILDING_WORDS.has(w))) return 'building';
  if (category === 'vegetation' || words.some((w) => THIN_WORDS.has(w))) return 'thin';
  return 'shape';
}

/** The base slice sits near the middle of the whole hull (a trunk, not a tail wheel): its centre within 35 % of the half-extents. */
function nearCentre(base: Vec2[], full: Vec2[]): boolean {
  const box = (pts: Vec2[]) => {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  };
  const b = box(base), f = box(full);
  const off = (lo: number, hi: number, flo: number, fhi: number) => Math.abs((lo + hi) / 2 - (flo + fhi) / 2) / Math.max((fhi - flo) / 2, 1e-6);
  return off(b.minX, b.maxX, f.minX, f.maxX) <= 0.35 && off(b.minZ, b.maxZ, f.minZ, f.maxZ) <= 0.35;
}

/**
 * The ground-slice hull: the convex hull of the points whose lowest height is within `cut` metres of `minY`.
 * When that slice is too thin to give an area (one or two points, or a line), the cut doubles until it does or
 * reaches the top. Null when no slice below the top has an area (the caller keeps the whole hull).
 */
export function baseHull(points: Vec2[], heights: number[], minY: number, maxY: number, cut: number): { points: Vec2[]; cut: number } | null {
  let h = Math.max(cut, 1e-3);
  for (;;) {
    const below = points.filter((_, i) => heights[i] <= minY + h + 1e-6).map((p) => roundPt(p, 3));
    const hull = convexHull(below);
    if (hull.length >= 3 && Math.abs(polygonArea(hull)) > 1e-4) return { points: hull, cut: round(h, 3) };
    if (minY + h >= maxY) return null;
    h = Math.min(h * 2, maxY - minY);
  }
}

/**
 * The concave outline (FB-099) of what stands within `collisionHeight` of the model's bottom (default: all of it):
 * its triangles when given, else its vertices. Null when it has no area (the caller keeps the whole hull).
 */
export function concaveSlice(o: Pick<ObjectInput, 'points' | 'heights' | 'minY' | 'maxY' | 'collisionHeight' | 'tris'>): { points: Vec2[]; cut: number } | null {
  const cut = o.collisionHeight ?? Math.max(0, o.maxY - o.minY);
  const top = o.minY + cut + 1e-6;
  const tris: number[][] = [];
  if (o.tris) {
    const t = o.tris;
    for (let k = 0; k + 8 < t.length; k += 9) {
      if (Math.min(t[k + 1], t[k + 4], t[k + 7]) > top) continue;
      tris.push([t[k], t[k + 2], t[k + 3], t[k + 5], t[k + 6], t[k + 8]]);
    }
  }
  const points = tris.length ? [] : o.points.filter((_, i) => !o.heights || o.heights[i] <= top);
  const outline = concaveOutline({ tris, points });
  return outline ? { points: outline, cut: round(cut, 3) } : null;
}

/**
 * The `object` block of an export manifest: footprint, height, tiles, anchor and collision polygon (convex hull of the
 * top-down projection, or the bounds rectangle when the hull is degenerate). Null when there is no geometry.
 */
export function objectInfo(o: ObjectInput): ObjectInfo | null {
  if (!o.points.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of o.points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const hull = convexHull(o.points.map((p) => roundPt(p, 3)));
  // Counter-clockwise in (x, z) maths orientation, like the hull.
  const rect: Vec2[] = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  const useHull = hull.length >= 3 && Math.abs(polygonArea(hull)) > 1e-6;
  const full: Vec2[] = (useHull ? hull : rect).map((p) => roundPt(p, 3));
  // Ground slice: what stands on the ground, when it is much smaller than the whole model from above (a tree).
  const base = o.heights && o.heights.length === o.points.length
    ? baseHull(o.points, o.heights, o.minY, o.maxY, o.collisionHeight ?? defaultCollisionCut(o.maxY - o.minY))
    : null;
  const mode = o.collision ?? 'auto';
  const rule: CollisionRule = mode !== 'auto' ? 'asked' : o.collisionHeight !== undefined ? 'height' : collisionRule(o.subject);
  const ratio = base ? Math.abs(polygonArea(base.points)) / Math.max(Math.abs(polygonArea(full)), 1e-9) : Infinity;
  const useBase = !!base && mode !== 'none' && mode !== 'concave' && (
    rule === 'asked' ? mode === 'base'
      : rule === 'height' || rule === 'thin' ? ratio <= BASE_AREA_RATIO
        : rule === 'shape' ? ratio < THIN_BASE_RATIO && nearCentre(base.points, full)
          : false);
  // Concave (FB-099): the outline of the slice up to collisionHeight (default: the whole model), not its hull.
  const concave = mode === 'concave' ? concaveSlice(o) : null;
  const collision: Vec2[] = mode === 'none' ? [] : concave ? concave.points : useBase ? base!.points : full;
  const centre: Vec2 = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const w = maxX - minX, d = maxZ - minZ;
  const tileScale = o.view.scale.mode === 'tile' ? o.view.scale : null;
  const tiles = tileScale
    ? (() => {
        const tw = metresToTiles(w, tileScale.metresPerTile), td = metresToTiles(d, tileScale.metresPerTile);
        return { w: tw.tiles, d: td.tiles, wExact: tw.exact, dExact: td.exact, tilePx: tileScale.tilePx, metresPerTile: tileScale.metresPerTile, shape: tileScale.shape };
      })()
    : null;

  const ortho = o.view.projection !== 'persp';
  const grid = viewGrid(o.view);
  const byIndex = new Map<number, ObjectDirection>();
  const directions: ObjectDirection[] = [];
  if (ortho) {
    const rendered = (d: Direction): ObjectDirection => {
      const anchor = toFramePx(centre, 0, d.worldAngle, o.view.pitch, o.framing);
      const out: ObjectDirection = {
        name: d.name, worldAngle: d.worldAngle, mirrorOf: null,
        anchor: { x: round(anchor[0], 2), y: round(anchor[1], 2) },
        facing: facingAxis(d.worldAngle, grid),
        polygon: collision.map((p) => roundPt(toFramePx(p, 0, d.worldAngle, o.view.pitch, o.framing), 2)),
        ...(useBase ? { canopyPolygon: full.map((p) => roundPt(toFramePx(p, 0, d.worldAngle, o.view.pitch, o.framing), 2)) } : {}),
      };
      if (tileScale) {
        const [u, v] = gridAxes(tileScale.shape);
        const yaw = yawForAngle(d.worldAngle);
        const c = rotateYaw(centre, yaw);
        const toGrid = (p: Vec2): Vec2 => {
          const q = rotateYaw(p, yaw);
          const dx = q[0] - c[0], dz = q[1] - c[1];
          return [(dx * u[0] + dz * u[1]) / tileScale.metresPerTile, (dx * v[0] + dz * v[1]) / tileScale.metresPerTile];
        };
        const inGrid = collision.map(toGrid);
        // The tile span is the whole model's (a tree covers its canopy's tiles), whatever it collides with.
        const spanOf = full.map(toGrid);
        const span = (i: 0 | 1) => Math.max(...spanOf.map((p) => p[i])) - Math.min(...spanOf.map((p) => p[i]));
        const su = metresToTiles(span(0) * tileScale.metresPerTile, tileScale.metresPerTile);
        const sv = metresToTiles(span(1) * tileScale.metresPerTile, tileScale.metresPerTile);
        out.tiles = { u: su.tiles, v: sv.tiles, uExact: su.exact, vExact: sv.exact, polygon: inGrid.map((p) => roundPt(p, 3)) };
      }
      return out;
    };
    o.directions.forEach((d, i) => {
      if (d.mirrorOf === null) byIndex.set(i, rendered(d));
    });
    o.directions.forEach((d, i) => {
      if (d.mirrorOf === null) return directions.push(byIndex.get(i)!);
      // A mirrored direction is its source drawn flipped: the same pixels, x' = frameWidth - x.
      const src = byIndex.get(d.mirrorOf)!;
      const fw = o.framing.frameWidth;
      directions.push({
        ...src, name: d.name, worldAngle: d.worldAngle, mirrorOf: src.name, facing: facingAxis(d.worldAngle, grid),
        anchor: { x: round(fw - src.anchor.x, 2), y: src.anchor.y },
        polygon: src.polygon.map(([x, y]) => [round(fw - x, 2), y]),
        ...(src.canopyPolygon ? { canopyPolygon: src.canopyPolygon.map(([x, y]): Vec2 => [round(fw - x, 2), y]) } : {}),
        ...(src.tiles ? { tiles: flipTiles(src.tiles, tileScale!.shape) } : {}),
      });
    });
  }
  return {
    footprint: { w: round(w, 3), d: round(d, 3), minX: round(minX, 3), maxX: round(maxX, 3), minZ: round(minZ, 3), maxZ: round(maxZ, 3) },
    height: round(o.maxY, 3),
    bottom: round(Math.min(0, o.minY), 3),
    centre: { x: round(centre[0], 3), z: round(centre[1], 3) },
    tiles,
    collision: mode === 'none' ? { source: 'none', points: [], rule }
      : concave ? { source: 'concave', points: collision, cut: concave.cut, rule }
        : useBase ? { source: 'base', points: collision, cut: base!.cut, rule } : { source: useHull ? 'hull' : 'bounds', points: collision, ...(o.heights ? { rule } : {}) },
    ...(useBase ? { canopy: { source: useHull ? 'hull' as const : 'bounds' as const, points: full } } : {}),
    pixelsPerMetre: ortho ? round(framingPpm(o.framing), 4) : null,
    anchor: directions[0]?.anchor ?? null,
    directions,
    note: OBJECT_NOTE,
  };
}
