// Moved from the old generator's packages/shared/src/map/ops.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import type { Terrain, TilesetBody } from '../tileset/types.js';
import {
  MAP_LAYER_TYPES, MAX_MAP_SIZE, ZONE_KINDS, ZONE_SHAPES, splitGid,
  type CellFootprint, type CollisionLayer, type DecorationLayer, type GroundLayer, type MapBody, type MapLayer, type MapLayerType, type MapObject,
  type ObjectLayer, type Properties, type PropertyValue, type Zone, type ZoneKind, type ZoneLayer, type ZoneShape,
} from './types.js';
import { opGenerate, opPath, opScatter, opStamp, terrainSet, zoneDistance, type GenerateOp, type PathOp, type ScatterOp, type StampOp } from './generate.js';
import type { MapStamp } from './stamp.js';
import { isCliffCorners } from '../tileset/raster.js';
import { opResize, opTransform, type ResizeOp, type TransformOp } from './transform.js';
import { opFence, type FenceOp } from './fence.js';
import { facingAngle, nearestFacing } from './stamp.js';
import { describeHit, guardFor, normalizeAvoidRoute, routeGuard, storedGuards, type AvoidRouteArg, type CollisionPolygonOf, type RouteOptions, type RouteResult, type StoredRouteGuard } from './route.js';

/**
 * Map edits as plain JSON ops. `applyOps(doc, ops, ctx)` applies them in order and returns the new body and one
 * error per op that could not apply (that op changes nothing). The CLI, the MCP tools, the server and the web editor
 * all go through here.
 *
 * Brushes (paint, fill, rect, line) write into one layer: `terrain` paints a ground layer, `tile` (a map gid, 0 to
 * erase) a decoration layer, `value` (true/false) a collision layer; `layer` names the layer (default: the first of
 * that type). On ground, mode 'cell' (default) makes whole cells that terrain by setting their four corners, so the
 * neighbours get transition tiles; mode 'corner' sets single corners (x, y are corner coordinates then).
 *
 * Coordinates (the README's "Coordinates" table has them all). Brushes and generator `region.rect` take whole cells
 * (rect inclusive); zone points, path points and object positions are map coordinates in cell units (cell (x, y)
 * spans [x, x+1) × [y, y+1), its centre is (x + 0.5, y + 0.5)). Where that is easy to get wrong, an op takes an
 * explicit `anchor` (see `Anchor`): place / move (default 'centre': x, y is the footprint's centre), addZone /
 * editZone and path (default 'corner': points are grid coordinates as given), stamp (default 'cell': the stamp's
 * top-left cell).
 */

/**
 * What an op's x, y (or points) name:
 * - 'corner': a grid point, as given (map coordinates).
 * - 'cell': a cell index (whole numbers). Zones: a rect's two points are its first and last cell (inclusive), other
 *   points the cell's centre. Place / move: the footprint's top-left cell. Stamp: its top-left cell.
 * - 'centre': a centre. Zones and paths: the centre of the cell each point names. Place / move: the footprint's
 *   centre (the default). Stamp: the stamp's centre.
 */
export type Anchor = 'cell' | 'corner' | 'centre';
export const ANCHORS: readonly Anchor[] = ['cell', 'corner', 'centre'];
const checkAnchor = (a: unknown): Anchor | undefined => (a === undefined || (ANCHORS as readonly unknown[]).includes(a) ? (a as Anchor | undefined) : fail(`anchor must be one of ${ANCHORS.join(', ')}`));

/** Every layer type `clear` empties by default. */
export const CLEAR_LAYERS = ['ground', 'decoration', 'objects', 'collision', 'zones'] as const;

type Brush = {
  layer?: string; terrain?: string; tile?: number; value?: boolean | 0 | 1; mode?: 'cell' | 'corner';
  /**
   * Collision brushes only (FB-069): change only the cells whose four ground corners are all of these terrains (ids,
   * names or kinds), so `rect {value: false, terrains: ["sand"]}` over a ford clears the sand bar and leaves the
   * water beside it blocked.
   */
  terrains?: string[];
};

/**
 * FB-059: a zone's typed properties on addZone / editZone. `vehicle` is a sprite name or id (the server resolves a
 * name to `vehicleId` within the map's project, like place's `sprite`); `speed` is metres per second. null clears
 * either on editZone. `properties.vehicle` / `properties.speed` are read as these when the typed ones are absent.
 */
export interface ZoneTyped {
  vehicle?: string | number | null;
  vehicleId?: number | null;
  speed?: number | null;
}

/**
 * What place (and the generators' objects) take besides the position: FB-079 `on` / `elevation`, FB-095
 * `collision: false`, FB-101 `clear`.
 */
export interface PlaceExtras {
  /**
   * FB-079: stand on this object (its id): the footprint must lie on the support's, x / y default to its centre, and
   * `elevation` defaults to the support's height (its sprite's export height in metres, plus the support's own
   * elevation). It only overlaps other objects on the same support, and moves (and is removed) with it.
   */
  on?: string;
  /** FB-079: metres above the ground (overrides the support's height). */
  elevation?: number;
  /** FB-095: false = a marker (mine, trigger plate): no collision in the export, never blocks or is blocked by solid objects. */
  collision?: boolean;
  /** FB-101: remove scatter-placed objects in the way (reported as `cleared`) instead of refusing the overlap. */
  clear?: boolean;
  /** FB-078: the fence group of a panel (the fence op sets it). */
  group?: string;
  /** FB-101: placed by a scatter (the scatter op sets it). */
  scattered?: boolean;
}

/** FB-101: remove objects in a rectangle of cells (inclusive) or near a zone: scatter-placed ones only unless `all`. */
export interface ClearRectOp { op: 'clearRect'; x0: number; y0: number; x1: number; y1: number; all?: boolean; layer?: string }
export interface ClearZoneOp { op: 'clearZone'; zone: string; margin?: number; all?: boolean; layer?: string }
/**
 * FB-123: check every zone and object that keeps a route guard (placed / added with avoidRoute) against the map as
 * it is now: refused, naming each one and how close it came, when any is within its margin. `ids` checks only those.
 */
export interface CheckRouteOp { op: 'checkRoute'; ids?: string[] }

export type MapOp =
  | ({ op: 'paint'; x: number; y: number; radius?: number } & Brush)
  | ({ op: 'fill'; x: number; y: number } & Brush)
  | ({ op: 'rect'; x0: number; y0: number; x1: number; y1: number; outline?: boolean } & Brush)
  | ({ op: 'line'; x0: number; y0: number; x1: number; y1: number; radius?: number } & Brush)
  | ({
      op: 'place'; layer?: string; id?: string; spriteId?: number; assetRef?: string; name?: string; state?: string; facing?: string;
      /** Where (see anchor); with `on` they default to the support's centre. */
      x?: number; y?: number; anchor?: Anchor; snap?: boolean; footprint?: CellFootprint | null; allowOverlap?: boolean; properties?: Properties;
      /** FB-111: a facing the sprite lacks takes the nearest it has, with a warning (default true); false refuses it. */
      snapFacing?: boolean;
      /**
       * FB-110: refuse a spot whose footprint comes within `margin` metres (default 1) of the walkable route from → to.
       * FB-122: a `via` chain, `legs`, or a list; FB-123: `at: "end"` checks it once the whole batch has applied.
       */
      avoidRoute?: AvoidRouteArg;
    } & PlaceExtras)
  | {
      op: 'move'; id: string; x?: number; y?: number; anchor?: Anchor; dx?: number; dy?: number; facing?: string; state?: string;
      /** Swap the object's sprite (its footprint is re-read; a name that was the old sprite's becomes the new one's). */
      spriteId?: number; snap?: boolean; allowOverlap?: boolean;
      /** FB-111: as for place. */
      snapFacing?: boolean;
    }
  | { op: 'remove'; id: string }
  | { op: 'set'; target?: 'map' | 'object' | 'zone' | 'layer'; id?: string; key: string; value: PropertyValue | null }
  | ({
      op: 'addZone'; layer?: string; id?: string; kind: ZoneKind; name?: string; shape?: ZoneShape; points: [number, number][]; anchor?: Anchor; properties?: Properties;
      /** FB-110: refuse a zone that comes within `margin` metres (default 1) of the walkable route from → to (a hazard). As for place. */
      avoidRoute?: AvoidRouteArg;
    } & ZoneTyped)
  | ({ op: 'editZone'; id: string; kind?: ZoneKind; name?: string; shape?: ZoneShape; points?: [number, number][]; anchor?: Anchor; properties?: Properties } & ZoneTyped)
  | { op: 'removeZone'; id: string }
  | { op: 'addLayer'; type: MapLayerType; name: string; tileset?: number }
  | { op: 'removeLayer'; name: string }
  /** Change a layer's settings: `visible` (false hides it in the editor and the preview, and Tiled gets visible=0). */
  | { op: 'editLayer'; name: string; visible?: boolean }
  | GenerateOp
  | ScatterOp
  | (PathOp & { anchor?: Anchor })
  | (StampOp & { anchor?: Anchor })
  /**
   * Empty layers: ground to `terrain` (default '' = none), decoration and collision to 0, objects and zones to none.
   * `layers` are layer types or names (default: every layer). Size, tilesets, layers and properties stay.
   */
  | { op: 'clear'; layers?: string[]; terrain?: string }
  /**
   * Block the cliffs (B4): every cell of the ground layer (`ground`, default the first) whose corners mix a raised
   * terrain (height 1) and a ground one gets collision `value` (default true) in the collision layer (`layer`).
   */
  | { op: 'cliffs'; ground?: string; layer?: string; value?: boolean }
  /** FB-063: change the map's size, keeping its id and history (transform.ts). */
  | ResizeOp
  /** FB-068: mirror and / or turn the map or a rect of it (transform.ts). */
  | TransformOp
  /** FB-078: panels of a fence or wall laid end to end along a polyline, with gates (fence.ts). */
  | FenceOp
  | ClearRectOp
  | ClearZoneOp
  | CheckRouteOp;

export const MAP_OPS = ['paint', 'fill', 'rect', 'line', 'place', 'move', 'remove', 'set', 'addZone', 'editZone', 'removeZone', 'addLayer', 'removeLayer', 'editLayer', 'generate', 'scatter', 'path', 'stamp', 'clear', 'cliffs', 'resize', 'transform', 'fence', 'clearRect', 'clearZone', 'checkRoute'] as const;

/** What an object sprite's export says about its size: footprint in tiles, per-facing spans, states. */
export interface SpriteFootprint {
  name?: string;
  /** object.tiles: whole tiles along the model's own axes. */
  w: number;
  d: number;
  /** Per direction (facing name): tiles along the grid's u (map x) and v (map y). */
  directions?: Record<string, { u: number; v: number }>;
  /** State names the export holds (object.states). */
  states?: string[];
  /** FB-079: the model's height in metres (object.height): what stands `on` it is that high. */
  height?: number;
  /** FB-078: its ground footprint in metres along the model's own axes (object.footprint): a fence panel's length. */
  metres?: { w: number; d: number };
}

/** The parts of an export's `object` block (object/footprint.ts ObjectInfo) a map needs. */
export interface ObjectBlockLike {
  footprint?: { w: number; d: number };
  height?: number;
  tiles?: { w: number; d: number; metresPerTile: number } | null;
  directions?: { name: string; tiles?: { u: number; v: number } }[];
  states?: { name: string }[];
}

/**
 * A sprite's footprint on a map from its export's `object` block: the tile-locked counts when the export was
 * rendered at the map's metres per tile, else the metres rounded up to the map's cells (model axes, unturned).
 */
export function footprintFromObject(o: ObjectBlockLike, metresPerTile: number, name?: string): SpriteFootprint | null {
  const states = o.states?.map((s) => s.name);
  const extra = {
    ...(name ? { name } : {}), ...(states?.length ? { states } : {}),
    ...(typeof o.height === 'number' && o.height > 0 ? { height: o.height } : {}),
    ...(o.footprint && o.footprint.w > 0 && o.footprint.d > 0 ? { metres: { w: o.footprint.w, d: o.footprint.d } } : {}),
  };
  if (o.tiles && Math.abs(o.tiles.metresPerTile - metresPerTile) < 1e-6) {
    const directions = Object.fromEntries((o.directions ?? []).filter((d) => d.tiles).map((d) => [d.name, { u: d.tiles!.u, v: d.tiles!.v }]));
    return { w: o.tiles.w, d: o.tiles.d, ...(Object.keys(directions).length ? { directions } : {}), ...extra };
  }
  if (!o.footprint || !(metresPerTile > 0)) return null;
  const cells = (m: number) => Math.max(1, Math.ceil(m / metresPerTile - 1e-3 / metresPerTile));
  return { w: cells(o.footprint.w), d: cells(o.footprint.d), ...extra };
}

export interface OpsContext {
  /**
   * Object sprites by id: their footprint, or null when the sprite exists but no export with an object block is
   * known. When given, placing a sprite id that is not a key is an error.
   */
  sprites?: Record<number, SpriteFootprint | null>;
  /** Sprite names by id (the placed object's default name). */
  spriteNames?: Record<number, string>;
  /** Tileset bodies by slot (the map's `tilesets` order), to check terrain names and resolve them to ids. */
  tilesets?: (Pick<TilesetBody, 'terrains'> | null | undefined)[];
  /** Saved stamps by lower-case name (the `stamp` op's `stamp` when it is a name). */
  stamps?: Record<string, MapStamp>;
  /**
   * FB-125: a placed object's ground collision polygon (map cells around its anchor), from its sprite's export, for
   * routes with a clearance (avoidRoute.clearance): polygons that spill over their cells keep the route off too.
   */
  collisionPolygon?: CollisionPolygonOf;
}

/** The route options an op's guards take from the context. */
const routeCtx = (ctx: OpsContext): Pick<RouteOptions, 'collisionPolygon'> => (ctx.collisionPolygon ? { collisionPolygon: ctx.collisionPolygon } : {});

export interface OpError {
  index: number;
  op: string;
  message: string;
}

export interface ApplyResult {
  doc: MapBody;
  errors: OpError[];
  /** Ops that applied. */
  applied: number;
  /** Ids of the objects and zones the ops created, in order. */
  created: string[];
  /** What the generator ops did (objects placed, terrains used, what was skipped), one entry per such op. */
  reports: OpReport[];
}

/** A generator op's outcome: `index` of the op in the batch, its name, and what it did. */
export interface OpReport {
  index: number;
  op: string;
  [key: string]: unknown;
}

/** What an op returns: nothing, the id it created, or (generators) the ids and a report. */
export type OpOutcome = string | { created?: string[]; report?: Record<string, unknown> } | undefined;

export class OpFail extends Error {}
export function fail(m: string): never {
  throw new OpFail(m);
}

export const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`));
const EPS = 1e-6;

// ------------------------------------------------------------------------------------------------- layers

export function findLayer<T extends MapLayerType>(doc: Pick<MapBody, 'layers'>, type: T, name?: string): Extract<MapLayer, { type: T }> | undefined {
  return doc.layers.find((l) => l.type === type && (name === undefined || l.name === name)) as Extract<MapLayer, { type: T }> | undefined;
}

export function layerFor<T extends MapLayerType>(doc: MapBody, type: T, name?: string): Extract<MapLayer, { type: T }> {
  if (name !== undefined) {
    const l = doc.layers.find((x) => x.name === name);
    if (!l) fail(`no layer "${name}" (layers: ${doc.layers.map((x) => x.name).join(', ') || 'none'})`);
    if (l!.type !== type) fail(`layer "${name}" is a ${l!.type} layer, not ${type}`);
    return l as Extract<MapLayer, { type: T }>;
  }
  return findLayer(doc, type) ?? fail(`the map has no ${type} layer`);
}

/** Every object (with its layer) and zone, by id. */
function findObject(doc: MapBody, id: string): { layer: ObjectLayer; obj: MapObject } | undefined {
  for (const l of doc.layers) if (l.type === 'objects') for (const o of l.objects) if (o.id === id) return { layer: l, obj: o };
  return undefined;
}
function findZone(doc: MapBody, id: string): { layer: ZoneLayer; zone: Zone } | undefined {
  for (const l of doc.layers) if (l.type === 'zones') for (const z of l.zones) if (z.id === id) return { layer: l, zone: z };
  return undefined;
}

/**
 * The ids of a map's objects and zones with the highest number per prefix, cached per body: a scatter of thousands
 * of objects asks for the next free id and checks it is unused once per object, which was a scan of every id each
 * time. The cache is checked against the number of objects and zones (a removal or clear rebuilds it); place and
 * addZone note the ids they add (`noteId`).
 */
interface IdCache { total: number; ids: Set<string>; max: Map<string, number> }
const idCaches = new WeakMap<MapBody, IdCache>();
const ID_NUMBER = /^(\D*)(\d+)$/;

function idTotal(doc: MapBody): number {
  let n = 0;
  for (const l of doc.layers) n += l.type === 'objects' ? l.objects.length : l.type === 'zones' ? l.zones.length : 0;
  return n;
}

function addId(c: Pick<IdCache, 'ids' | 'max'>, id: string) {
  c.ids.add(id);
  const m = ID_NUMBER.exec(id);
  if (m) c.max.set(m[1], Math.max(c.max.get(m[1]) ?? 0, Number(m[2])));
}

function idCache(doc: MapBody): IdCache {
  const total = idTotal(doc);
  const hit = idCaches.get(doc);
  if (hit && hit.total === total) return hit;
  const c: IdCache = { total, ids: new Set(), max: new Map() };
  for (const l of doc.layers) {
    if (l.type === 'objects') for (const o of l.objects) addId(c, o.id);
    if (l.type === 'zones') for (const z of l.zones) addId(c, z.id);
  }
  idCaches.set(doc, c);
  return c;
}

/** Record an id an op just added to the body, so the cache stays valid without a rescan. */
function noteId(doc: MapBody, id: string) {
  const c = idCaches.get(doc);
  if (!c || c.total + 1 !== idTotal(doc)) return void idCaches.delete(doc);
  addId(c, id);
  c.total++;
}

export const allIds = (doc: MapBody): Set<string> => new Set(idCache(doc).ids);
const idTaken = (doc: MapBody, id: string) => idCache(doc).ids.has(id);

/** The next free id with this prefix ("o3"): one past the highest number used. */
export function nextMapId(doc: MapBody, prefix: string): string {
  return `${prefix}${(idCache(doc).max.get(prefix) ?? 0) + 1}`;
}

// ------------------------------------------------------------------------------------------------ brushes

/** A brush resolved to a layer, the value it writes, and whether it works on corners. */
interface Target {
  get(x: number, y: number): string | number;
  set(x: number, y: number, v: string | number): void;
  cols: number;
  rows: number;
  value: string | number;
  corners: boolean;
}

/** A terrain reference (id or name) → the terrain id of the layer's tileset, when the tileset is known. */
export function terrainId(ctx: OpsContext, layer: GroundLayer, ref: string): string {
  if (ref === '') return '';
  const ts = ctx.tilesets?.[layer.tileset ?? 0];
  if (!ts) return ref;
  const t: Terrain | undefined = ts.terrains.find((x) => x.id === ref) ?? ts.terrains.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!t) fail(`no terrain "${ref}" in the ground tileset (terrains: ${ts.terrains.map((x) => x.id).join(', ') || 'none'})`);
  return t!.id;
}

function brushTarget(doc: MapBody, b: Brush, ctx: OpsContext): Target {
  const given = [b.terrain !== undefined, b.tile !== undefined, b.value !== undefined].filter(Boolean).length;
  let type: MapLayerType;
  if (given > 1) fail('give one of terrain, tile or value');
  if (b.terrain !== undefined) type = 'ground';
  else if (b.tile !== undefined) type = 'decoration';
  else if (b.value !== undefined) type = 'collision';
  else if (b.layer !== undefined) {
    const l = doc.layers.find((x) => x.name === b.layer);
    type = l?.type ?? fail(`no layer "${b.layer}"`);
    fail(`say what to paint into ${type} layer "${b.layer}": ${type === 'ground' ? 'terrain' : type === 'decoration' ? 'tile' : type === 'collision' ? 'value' : 'nothing (brushes paint ground, decoration and collision layers)'}`);
  } else fail('a brush needs terrain, tile or value');
  if (b.terrains !== undefined && type! !== 'collision') fail('terrains only filters collision brushes (value)');
  const W = doc.width, H = doc.height;
  if (type! === 'ground') {
    const l = layerFor(doc, 'ground', b.layer);
    if (typeof b.terrain !== 'string') fail('terrain must be a terrain id or name');
    const corners = b.mode === 'corner';
    if (b.mode !== undefined && b.mode !== 'corner' && b.mode !== 'cell') fail('mode must be cell or corner');
    const value = terrainId(ctx, l, b.terrain!);
    if (!corners)
      return {
        cols: W, rows: H, value, corners,
        get: (x, y) => {
          const c = [l.corners[y * (W + 1) + x], l.corners[y * (W + 1) + x + 1], l.corners[(y + 1) * (W + 1) + x + 1], l.corners[(y + 1) * (W + 1) + x]];
          return c.every((t) => t === c[0]) ? c[0] : '\u0000mixed';
        },
        set: (x, y, v) => {
          for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) l.corners[cy * (W + 1) + cx] = v as string;
        },
      };
    return { cols: W + 1, rows: H + 1, value, corners, get: (x, y) => l.corners[y * (W + 1) + x], set: (x, y, v) => void (l.corners[y * (W + 1) + x] = v as string) };
  }
  if (b.mode === 'corner') fail('mode corner is only for ground layers');
  if (type! === 'decoration') {
    const l = layerFor(doc, 'decoration', b.layer);
    if (!Number.isInteger(b.tile) || b.tile! < 0) fail('tile must be a map gid (whole number ≥ 0; 0 erases)');
    if (b.tile && splitGid(b.tile)!.slot >= doc.tilesets.length) fail(`tile ${b.tile} is not in any of the map's tilesets`);
    return { cols: W, rows: H, value: b.tile!, corners: false, get: (x, y) => l.cells[y * W + x], set: (x, y, v) => void (l.cells[y * W + x] = v as number) };
  }
  const l = layerFor(doc, 'collision', b.layer);
  if (typeof b.value !== 'boolean' && b.value !== 0 && b.value !== 1) fail('value must be true or false');
  let only: ((x: number, y: number) => boolean) | null = null;
  if (b.terrains !== undefined) {
    const g = doc.layers.find((x): x is GroundLayer => x.type === 'ground') ?? fail('terrains needs a ground layer');
    const set = terrainSet(doc, ctx, g, b.terrains, 'terrains')!;
    only = (x, y) => [g.corners[y * (W + 1) + x], g.corners[y * (W + 1) + x + 1], g.corners[(y + 1) * (W + 1) + x + 1], g.corners[(y + 1) * (W + 1) + x]].every((t) => set.has(t));
  }
  return {
    cols: W, rows: H, value: b.value ? 1 : 0, corners: false, get: (x, y) => l.cells[y * W + x],
    set: (x, y, v) => void (only && !only(x, y) ? 0 : (l.cells[y * W + x] = v as 0 | 1)),
  };
}

const inside = (t: Target, x: number, y: number) => x >= 0 && y >= 0 && x < t.cols && y < t.rows;

/** Points within `radius` of (x, y) (Euclidean, the centre point always). */
function disc(x: number, y: number, radius: number): [number, number][] {
  const r = Math.max(0, radius);
  const out: [number, number][] = [];
  for (let dy = -Math.floor(r); dy <= Math.floor(r); dy++) for (let dx = -Math.floor(r); dx <= Math.floor(r); dx++) if (dx * dx + dy * dy <= r * r + EPS) out.push([x + dx, y + dy]);
  return out;
}

/** Grid points of a line (Bresenham), both ends included. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) (err += dy), (x += sx);
    if (e2 <= dx) (err += dx), (y += sy);
  }
  return out;
}

function paintPoints(t: Target, pts: [number, number][]): number {
  const seen = new Set<number>();
  const keep = pts.filter(([x, y]) => inside(t, x, y) && !seen.has(y * t.cols + x) && seen.add(y * t.cols + x));
  if (!keep.length) fail('nothing to paint: the brush is outside the map');
  for (const [x, y] of keep) t.set(x, y, t.value);
  return keep.length;
}

const int = (v: unknown, what: string) => {
  const n = num(v, what);
  if (!Number.isInteger(n)) fail(`${what} must be a whole number`);
  return n;
};

function opPaint(doc: MapBody, op: Extract<MapOp, { op: 'paint' }>, ctx: OpsContext) {
  const t = brushTarget(doc, op, ctx);
  const x = Math.floor(num(op.x, 'x')), y = Math.floor(num(op.y, 'y'));
  const r = op.radius === undefined ? 0 : num(op.radius, 'radius');
  if (r < 0 || r > 64) fail('radius must be 0–64');
  paintPoints(t, disc(x, y, r));
}

function opRect(doc: MapBody, op: Extract<MapOp, { op: 'rect' }>, ctx: OpsContext) {
  const t = brushTarget(doc, op, ctx);
  const [x0, x1] = [int(op.x0, 'x0'), int(op.x1, 'x1')].sort((a, b) => a - b);
  const [y0, y1] = [int(op.y0, 'y0'), int(op.y1, 'y1')].sort((a, b) => a - b);
  const pts: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!op.outline || x === x0 || x === x1 || y === y0 || y === y1) pts.push([x, y]);
  paintPoints(t, pts);
}

function opLine(doc: MapBody, op: Extract<MapOp, { op: 'line' }>, ctx: OpsContext) {
  const t = brushTarget(doc, op, ctx);
  const r = op.radius === undefined ? 0 : num(op.radius, 'radius');
  if (r < 0 || r > 64) fail('radius must be 0–64');
  const pts = linePoints(int(op.x0, 'x0'), int(op.y0, 'y0'), int(op.x1, 'x1'), int(op.y1, 'y1')).flatMap(([x, y]) => disc(x, y, r));
  paintPoints(t, pts);
}

/** Flood fill: every point 4-connected to (x, y) with the same value as it gets the brush value. */
function opFill(doc: MapBody, op: Extract<MapOp, { op: 'fill' }>, ctx: OpsContext) {
  // On ground, fill floods corners (a cell-mode fill starts at the cell's top-left corner).
  const t = brushTarget(doc, op.terrain !== undefined ? { ...op, mode: 'corner' } : op, ctx);
  const x = Math.floor(num(op.x, 'x')), y = Math.floor(num(op.y, 'y'));
  if (!inside(t, x, y)) fail(`(${x}, ${y}) is outside the map`);
  const from = t.get(x, y);
  if (from === t.value) return;
  const stack: [number, number][] = [[x, y]];
  const seen = new Uint8Array(t.cols * t.rows);
  const hits: [number, number][] = [];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (!inside(t, cx, cy) || seen[cy * t.cols + cx] || t.get(cx, cy) !== from) continue;
    seen[cy * t.cols + cx] = 1;
    hits.push([cx, cy]);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  for (const [cx, cy] of hits) t.set(cx, cy, t.value);
}

// ------------------------------------------------------------------------------------------------ objects

/** Cells an object covers for a facing, from its sprite's export (null when unknown). */
export function footprintFor(f: SpriteFootprint | null | undefined, facing?: string): CellFootprint | null {
  if (!f) return null;
  const dirs = f.directions ?? {};
  const d = (facing !== undefined ? dirs[facing] : undefined) ?? (facing === undefined ? Object.values(dirs)[0] : undefined);
  if (d) return { w: Math.max(1, d.u), h: Math.max(1, d.v) };
  return { w: Math.max(1, f.w), h: Math.max(1, f.d) };
}

/**
 * An object position given with an anchor → its footprint centre: 'cell' names the footprint's top-left cell (a
 * point object: that cell's centre), 'corner' its top-left grid corner, 'centre' (default) the centre itself.
 */
export function anchorToCentre(x: number, y: number, anchor: Anchor | undefined, footprint: CellFootprint | null | undefined): [number, number] {
  if (anchor === undefined || anchor === 'centre') return [x, y];
  const w = footprint?.w ?? (anchor === 'cell' ? 1 : 0), h = footprint?.h ?? (anchor === 'cell' ? 1 : 0);
  if (anchor === 'cell') return [Math.floor(x) + w / 2, Math.floor(y) + h / 2];
  return [x + w / 2, y + h / 2];
}

/**
 * Zone or path points given with an anchor → map coordinates. 'corner' (default) keeps them; 'centre' moves each to
 * the centre of the cell it names; 'cell' does that too, except a rect's two points name its first and last cells.
 */
export function anchorPoints(points: [number, number][], anchor: Anchor | undefined, shape?: ZoneShape): [number, number][] {
  if (anchor === undefined || anchor === 'corner' || !Array.isArray(points)) return points;
  const ok = points.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
  if (!ok) return points; // checkZone / the path say what is wrong
  if (anchor === 'cell' && shape === 'rect' && points.length === 2) {
    const [[ax, ay], [bx, by]] = points.map(([x, y]) => [Math.floor(x), Math.floor(y)]);
    return [[Math.min(ax, bx), Math.min(ay, by)], [Math.max(ax, bx) + 1, Math.max(ay, by) + 1]];
  }
  return points.map(([x, y]) => [Math.floor(x) + 0.5, Math.floor(y) + 0.5]);
}

/** Snap an anchor coordinate to a footprint span: odd spans on a cell centre, even ones on a cell edge. */
export const snapAxis = (v: number, span: number) => (span % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v));

/** The [x0, y0, x1, y1] rectangle an object covers (a point when it has no footprint). */
export function objectRect(o: Pick<MapObject, 'x' | 'y' | 'footprint'>): [number, number, number, number] {
  const w = o.footprint?.w ?? 0, h = o.footprint?.h ?? 0;
  return [o.x - w / 2, o.y - h / 2, o.x + w / 2, o.y + h / 2];
}

const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) =>
  Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > EPS && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > EPS;

/**
 * Whether two objects' footprints may block each other: not panels of one fence (FB-078), not a marker and a solid
 * object (FB-095), not objects on different supports (FB-079: a book on a table and the table, or the floor).
 */
export function canBlock(a: Pick<MapObject, 'group' | 'collision' | 'on'>, b: Pick<MapObject, 'group' | 'collision' | 'on'>): boolean {
  if (a.group !== undefined && a.group === b.group) return false;
  if ((a.collision === false) !== (b.collision === false)) return false;
  return (a.on ?? '') === (b.on ?? '');
}

/** The objects of a layer whose footprints `o` would overlap (and that may block it). */
export function blockingObjects(layer: ObjectLayer, o: MapObject): MapObject[] {
  if (!o.footprint) return [];
  const r = objectRect(o);
  return overlapCandidates(layer.objects, r).filter((other) => other.id !== o.id && other.footprint && canBlock(o, other) && overlaps(r, objectRect(other)));
}

/** Bounds and overlap errors for an object at its position (other objects of the layer, except itself and `ignore`). */
export function objectProblems(doc: Pick<MapBody, 'width' | 'height'>, layer: ObjectLayer, o: MapObject, allowOverlap = false, ignore?: Set<string>): string[] {
  const out: string[] = [];
  const r = objectRect(o);
  if (r[0] < -EPS || r[1] < -EPS || r[2] > doc.width + EPS || r[3] > doc.height + EPS)
    out.push(`${o.id} at (${o.x}, ${o.y})${o.footprint ? ` covering ${o.footprint.w}×${o.footprint.h} cells` : ''} is outside the ${doc.width}×${doc.height} map`);
  if (!allowOverlap)
    for (const other of blockingObjects(layer, o))
      if (!ignore?.has(other.id)) out.push(`${o.id} would overlap ${other.id}${other.name ? ` (${other.name})` : ''} at (${other.x}, ${other.y})`);
  return out;
}

/**
 * Overlap checks on a big layer look only at the objects in the blocks of cells a rectangle touches: an index of
 * the footprinted objects by block, kept per objects array. Objects appended since it was built are added; any other
 * change of the array (a removal, a cleared layer, or a move, which calls `forgetOverlapIndex`) rebuilds it.
 */
const OVERLAP_BLOCK = 8;
const OVERLAP_INDEX_MIN = 48;
interface OverlapIndex { n: number; last: MapObject | undefined; blocks: Map<number, number[]> }
const overlapIndexes = new WeakMap<MapObject[], OverlapIndex>();
const blockKey = (bx: number, by: number) => (bx + 4096) * 16384 + (by + 4096);

function indexObject(ix: OverlapIndex, arr: MapObject[], k: number) {
  const o = arr[k];
  if (!o?.footprint) return;
  const [x0, y0, x1, y1] = objectRect(o);
  for (let by = Math.floor(y0 / OVERLAP_BLOCK); by <= Math.floor(y1 / OVERLAP_BLOCK); by++)
    for (let bx = Math.floor(x0 / OVERLAP_BLOCK); bx <= Math.floor(x1 / OVERLAP_BLOCK); bx++) {
      const key = blockKey(bx, by);
      const list = ix.blocks.get(key);
      if (list) list.push(k);
      else ix.blocks.set(key, [k]);
    }
}

function overlapIndex(arr: MapObject[]): OverlapIndex {
  let ix = overlapIndexes.get(arr);
  if (!ix || ix.n > arr.length || (ix.n > 0 && arr[ix.n - 1] !== ix.last)) {
    ix = { n: 0, last: undefined, blocks: new Map() };
    overlapIndexes.set(arr, ix);
  }
  for (let k = ix.n; k < arr.length; k++) indexObject(ix, arr, k);
  ix.n = arr.length;
  ix.last = arr[arr.length - 1];
  return ix;
}

/** Drop the overlap index of an objects array changed in place (an object replaced at the same index). */
export const forgetOverlapIndex = (arr: MapObject[]) => void overlapIndexes.delete(arr);

/** The objects of a layer that may overlap rectangle r, in layer order (all of them on a small layer). */
function overlapCandidates(arr: MapObject[], r: [number, number, number, number]): MapObject[] {
  if (arr.length < OVERLAP_INDEX_MIN) return arr;
  const ix = overlapIndex(arr);
  const ks = new Set<number>();
  for (let by = Math.floor(r[1] / OVERLAP_BLOCK); by <= Math.floor(r[3] / OVERLAP_BLOCK); by++)
    for (let bx = Math.floor(r[0] / OVERLAP_BLOCK); bx <= Math.floor(r[2] / OVERLAP_BLOCK); bx++) for (const k of ix.blocks.get(blockKey(bx, by)) ?? []) ks.add(k);
  return [...ks].sort((a, b) => a - b).map((k) => arr[k]);
}

/** FB-111: a sprite as errors name it: "mg_nest (121)" when its name is known, else "sprite 121". */
export function spriteLabel(ctx: Pick<OpsContext, 'sprites' | 'spriteNames'>, spriteId: number): string {
  const name = ctx.sprites?.[spriteId]?.name ?? ctx.spriteNames?.[spriteId];
  return name ? `${name} (${spriteId})` : `sprite ${spriteId}`;
}

export function checkSprite(ctx: OpsContext, spriteId: number, state?: string, facing?: string): SpriteFootprint | null | undefined {
  if (!ctx.sprites) return undefined;
  if (!(spriteId in ctx.sprites)) fail(`no sprite ${spriteId}`);
  const f = ctx.sprites[spriteId];
  if (f && state !== undefined && f.states?.length && !f.states.includes(state)) fail(`${spriteLabel(ctx, spriteId)} has no state "${state}" (states: ${f.states.join(', ')})`);
  if (f && facing !== undefined && f.directions && Object.keys(f.directions).length && !(facing in f.directions))
    fail(`${spriteLabel(ctx, spriteId)} has no facing "${facing}" (facings: ${Object.keys(f.directions).join(', ')})`);
  return f;
}

/**
 * FB-111: a facing the sprite's export lacks → the nearest one it has (by compass angle; a tie goes to the one
 * listed first), with a warning, unless `snapFacing` is false (then checkSprite refuses it). Facings that are not
 * compass names (or a sprite without per-facing data) are returned as they are.
 */
export function snapFacingFor(ctx: OpsContext, spriteId: number | undefined, facing: string | undefined, snapFacing: unknown, warnings?: string[]): string | undefined {
  if (snapFacing !== undefined && typeof snapFacing !== 'boolean') fail('snapFacing must be true or false');
  if (spriteId === undefined || facing === undefined || snapFacing === false || !ctx.sprites) return facing;
  const have = Object.keys(ctx.sprites[spriteId]?.directions ?? {});
  if (!have.length || have.includes(facing)) return facing;
  const a = typeof facing === 'string' ? facingAngle(facing) : null;
  const to = a !== null ? nearestFacing(have, a) : undefined;
  if (to === undefined) return facing;
  warnings?.push(`${spriteLabel(ctx, spriteId)} has no facing "${facing}" (facings: ${have.join(', ')}); used ${to} (snapFacing: false refuses instead)`);
  return to;
}

export const checkProps = (p: unknown, what: string): Properties => {
  if (p === undefined) return {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail(`${what} must be an object`);
  for (const [k, v] of Object.entries(p as object)) if (!['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) fail(`${what}.${k} must be a string, number or boolean`);
  return { ...(p as Properties) };
};

/** FB-045: what a refused place / move tried (its footprint and facing), so the next try can be planned. */
const triedNote = (o: MapObject) =>
  o.footprint ? ` (${o.id} covers ${o.footprint.w}×${o.footprint.h} cells${o.facing ? ` facing ${o.facing}` : ''} centred at (${o.x}, ${o.y}))` : '';

/** FB-079: an object's support and the height (metres) something placed on it stands at. */
function supportOf(doc: MapBody, ctx: OpsContext, id: unknown): { obj: MapObject; layer: ObjectLayer; height: number | null } {
  if (typeof id !== 'string' || !id) fail('on must be the id of a placed object');
  const f = findObject(doc, id as string) ?? fail(`on: no object "${String(id)}"`);
  const s = f!.obj;
  const known = s.spriteId !== undefined ? ctx.sprites?.[s.spriteId] : undefined;
  const h = typeof known?.height === 'number' ? known.height : null;
  return { obj: s, layer: f!.layer, height: h === null ? null : Math.round((h + (s.elevation ?? 0)) * 1000) / 1000 };
}

/** Does footprint rect a lie on b (within a hair)? */
const within = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] >= b[0] - EPS && a[1] >= b[1] - EPS && a[2] <= b[2] + EPS && a[3] <= b[3] + EPS;

export function opPlace(doc: MapBody, op: Extract<MapOp, { op: 'place' }>, ctx: OpsContext, cleared?: string[], warnings?: string[]): string {
  const layer = layerFor(doc, 'objects', op.layer);
  if (op.spriteId !== undefined && op.facing !== undefined) {
    const facing = snapFacingFor(ctx, op.spriteId, op.facing, op.snapFacing, warnings);
    if (facing !== op.facing) op = { ...op, facing };
  }
  if (op.spriteId === undefined && !op.assetRef) fail('place needs a sprite (name or id), a spriteId or an assetRef');
  if (op.spriteId !== undefined && !Number.isInteger(op.spriteId)) fail('spriteId must be a whole number');
  const id = op.id ?? nextMapId(doc, 'o');
  if (typeof id !== 'string' || !id) fail('id must be a string');
  if (idTaken(doc, id)) fail(`id "${id}" is taken`);
  const known = op.spriteId !== undefined ? checkSprite(ctx, op.spriteId, op.state, op.facing) : undefined;
  const footprint = op.footprint !== undefined ? op.footprint : footprintFor(known, op.facing);
  if (footprint && (!Number.isInteger(footprint.w) || !Number.isInteger(footprint.h) || footprint.w < 1 || footprint.h < 1)) fail('footprint must be whole cells ≥ 1 ({ w, h })');
  const support = op.on !== undefined ? supportOf(doc, ctx, op.on) : null;
  if (support && support.layer !== layer) fail(`on: "${support.obj.id}" is on layer "${support.layer.name}", not "${layer.name}"`);
  let elevation: number | undefined;
  if (op.elevation !== undefined) {
    elevation = num(op.elevation, 'elevation');
    if (elevation < 0 || elevation > 1000) fail('elevation must be 0–1000 metres');
  } else if (support) {
    if (support.height === null) fail(`on: the height of "${support.obj.id}" is not known (its sprite has no export with an object block); give elevation in metres`);
    elevation = support.height!;
  }
  if (op.collision !== undefined && typeof op.collision !== 'boolean') fail('collision must be true or false (false: a marker without collision)');
  let x: number, y: number;
  if (support && op.x === undefined && op.y === undefined) [x, y] = [support.obj.x, support.obj.y];
  else {
    [x, y] = anchorToCentre(num(op.x, 'x'), num(op.y, 'y'), checkAnchor(op.anchor), footprint);
    if (op.snap !== false) (x = snapAxis(x, footprint?.w ?? 1)), (y = snapAxis(y, footprint?.h ?? 1));
  }
  const obj: MapObject = {
    id,
    ...(op.spriteId !== undefined ? { spriteId: op.spriteId } : {}),
    ...(op.assetRef ? { assetRef: op.assetRef } : {}),
    ...((op.name ?? known?.name ?? (op.spriteId !== undefined ? ctx.spriteNames?.[op.spriteId] : undefined)) !== undefined
      ? { name: op.name ?? known?.name ?? ctx.spriteNames![op.spriteId!] }
      : {}),
    ...(op.state !== undefined ? { state: op.state } : {}),
    ...(op.facing !== undefined ? { facing: op.facing } : {}),
    x, y,
    ...(footprint ? { footprint: { w: footprint.w, h: footprint.h } } : {}),
    properties: checkProps(op.properties, 'properties'),
    ...(elevation ? { elevation } : {}),
    ...(support ? { on: support.obj.id } : {}),
    ...(op.collision === false ? { collision: false as const } : {}),
    ...(op.group !== undefined ? { group: String(op.group) } : {}),
    ...(op.scattered ? { scattered: true as const } : {}),
  };
  const guards = storedGuards(op.avoidRoute);
  const hit = routeGuard(doc, op.avoidRoute, 'op', routeCtx(ctx))?.hit(objectRect(obj));
  if (hit) fail(`${id} at (${x}, ${y})${footprint ? ` covering ${footprint.w}×${footprint.h} cells` : ''} would be ${describeHit(hit)}`);
  if (guards.length) obj.avoidRoute = guards;
  if (support && !within(objectRect(obj), objectRect(support.obj)))
    fail(`${id} at (${x}, ${y})${footprint ? ` covering ${footprint.w}×${footprint.h} cells` : ''} does not lie on ${support.obj.id}${support.obj.name ? ` (${support.obj.name})` : ''}, which covers ${objectRect(support.obj).join(', ')}`);
  // FB-101: scatter-placed objects in the way go when `clear` is set.
  const clearIds = op.clear && !op.allowOverlap ? new Set(blockingObjects(layer, obj).filter((b) => b.scattered).map((b) => b.id)) : undefined;
  const p = objectProblems(doc, layer, obj, op.allowOverlap, clearIds);
  if (p.length) {
    const scattered = blockingObjects(layer, obj).filter((b) => b.scattered && !clearIds?.has(b.id)).length;
    fail(p.join('; ') + triedNote(obj) + (scattered ? `; ${scattered} of them ${scattered === 1 ? 'was' : 'were'} scattered: clear: true removes ${scattered === 1 ? 'it' : 'them'}` : ''));
  }
  if (clearIds?.size) {
    layer.objects = layer.objects.filter((o) => !clearIds.has(o.id));
    removeDependents(doc, clearIds, cleared);
    cleared?.push(...clearIds);
  }
  layer.objects.push(obj);
  noteId(doc, id);
  return id;
}

/** FB-079: remove what stands on removed objects (and on those, …); their ids go to `out`. */
function removeDependents(doc: MapBody, gone: Set<string>, out?: string[]) {
  for (let more = true; more; ) {
    more = false;
    for (const l of doc.layers)
      if (l.type === 'objects' && l.objects.some((o) => o.on !== undefined && gone.has(o.on) && !gone.has(o.id))) {
        l.objects = l.objects.filter((o) => {
          if (o.on === undefined || !gone.has(o.on) || gone.has(o.id)) return true;
          gone.add(o.id);
          out?.push(o.id);
          more = true;
          return false;
        });
      }
  }
}

/** FB-101: remove the objects whose footprint (or point) touches a test area; scatter-placed only unless `all`. */
function clearObjects(doc: MapBody, layerName: string | undefined, all: boolean | undefined, hit: (r: [number, number, number, number]) => boolean): OpOutcome {
  if (all !== undefined && typeof all !== 'boolean') fail('all must be true or false');
  const layers = layerName !== undefined ? [layerFor(doc, 'objects', layerName)] : doc.layers.filter((l): l is ObjectLayer => l.type === 'objects');
  const gone = new Set<string>();
  const byObject: Record<string, number> = {};
  let kept = 0;
  for (const l of layers)
    l.objects = l.objects.filter((o) => {
      if (!hit(objectRect(o))) return true;
      if (!all && !o.scattered) return void kept++, true;
      gone.add(o.id);
      const label = o.name ?? o.assetRef ?? `sprite ${o.spriteId}`;
      byObject[label] = (byObject[label] ?? 0) + 1;
      return false;
    });
  const ids = [...gone];
  const dependents: string[] = [];
  removeDependents(doc, gone, dependents);
  return { report: { removed: ids.length, ids: ids.slice(0, 100), byObject, ...(dependents.length ? { dependents } : {}), ...(kept ? { kept, keptNote: `${kept} object(s) there were not placed by a scatter (all: true removes them too)` } : {}) } };
}

function opClearRect(doc: MapBody, op: ClearRectOp): OpOutcome {
  const [x0, x1] = [int(op.x0, 'x0'), int(op.x1, 'x1')].sort((a, b) => a - b);
  const [y0, y1] = [int(op.y0, 'y0'), int(op.y1, 'y1')].sort((a, b) => a - b);
  const box: [number, number, number, number] = [x0, y0, x1 + 1, y1 + 1];
  // A footprint touching the cells (not just their edge); a point object inside them.
  return clearObjects(doc, op.layer, op.all, (r) => (r[0] === r[2] ? r[0] >= box[0] && r[0] <= box[2] && r[1] >= box[1] && r[1] <= box[3] : overlaps(r, box)));
}

function opClearZone(doc: MapBody, op: ClearZoneOp): OpOutcome {
  const z = findZone(doc, op.zone)?.zone ?? fail(`no zone "${op.zone}"`);
  const margin = (op.margin !== undefined ? num(op.margin, 'margin') : 0) / doc.metresPerTile;
  if (margin < 0) fail('margin must be ≥ 0 metres');
  // The footprint's centre and corners against the zone (inside a rect or polygon, or within the margin of it).
  return clearObjects(doc, op.layer, op.all, (r) => {
    const pts: [number, number][] = [[(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], [r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    return pts.some(([x, y]) => zoneDistance(z!, x, y) <= margin + EPS);
  });
}

function opMove(doc: MapBody, op: Extract<MapOp, { op: 'move' }>, ctx: OpsContext, warnings?: string[]) {
  const f = findObject(doc, op.id) ?? fail(`no object "${op.id}"`);
  const { layer, obj } = f!;
  const anchor = checkAnchor(op.anchor);
  if (op.spriteId !== undefined && !Number.isInteger(op.spriteId)) fail('spriteId must be a whole number');
  const swap = op.spriteId !== undefined && op.spriteId !== obj.spriteId;
  const spriteId = op.spriteId ?? obj.spriteId;
  if (op.facing !== undefined) {
    const facing = snapFacingFor(ctx, spriteId, op.facing, op.snapFacing, warnings);
    if (facing !== op.facing) op = { ...op, facing };
  }
  const known = spriteId !== undefined && (swap || op.facing !== undefined || op.state !== undefined)
    ? checkSprite(ctx, spriteId, op.state ?? (swap ? obj.state : undefined), op.facing ?? (swap ? obj.facing : undefined))
    : undefined;
  const footprint = (op.facing !== undefined || swap) && known ? footprintFor(known, op.facing ?? obj.facing) : obj.footprint ?? null;
  let x = obj.x, y = obj.y;
  if (op.x !== undefined || op.y !== undefined) {
    const [ax, ay] = anchorToCentre(op.x !== undefined ? num(op.x, 'x') : 0, op.y !== undefined ? num(op.y, 'y') : 0, anchor, footprint);
    if (op.x !== undefined) x = ax;
    if (op.y !== undefined) y = ay;
  }
  if (op.x === undefined && op.dx !== undefined) x += num(op.dx, 'dx');
  if (op.y === undefined && op.dy !== undefined) y += num(op.dy, 'dy');
  if (op.snap !== false) (x = snapAxis(x, footprint?.w ?? 1)), (y = snapAxis(y, footprint?.h ?? 1));
  // A swapped sprite: the default name (the old sprite's) follows; a name of the object's own stays.
  const oldName = obj.spriteId !== undefined ? ctx.spriteNames?.[obj.spriteId] ?? ctx.sprites?.[obj.spriteId]?.name : undefined;
  const newName = swap ? known?.name ?? ctx.spriteNames?.[spriteId!] : undefined;
  const renamed = swap && (obj.name === undefined || obj.name === oldName) ? newName : undefined;
  const { assetRef: _ref, ...kept } = obj;
  const next: MapObject = {
    ...(swap ? kept : obj), ...(swap ? { spriteId } : {}), ...(renamed !== undefined ? { name: renamed } : {}),
    x, y, ...(footprint ? { footprint } : {}), ...(op.facing !== undefined ? { facing: op.facing } : {}), ...(op.state !== undefined ? { state: op.state } : {}),
  };
  const p = objectProblems(doc, layer, next, op.allowOverlap);
  if (p.length) fail(p.join('; ') + triedNote(next));
  // FB-079: an object on a support stays on it; what stands on this object moves with it.
  const sup = next.on !== undefined ? findObject(doc, next.on)?.obj : undefined;
  if (sup && !within(objectRect(next), objectRect(sup))) fail(`${next.id} would no longer lie on ${sup.id}${sup.name ? ` (${sup.name})` : ''}${triedNote(next)}`);
  layer.objects[layer.objects.indexOf(obj)] = next;
  forgetOverlapIndex(layer.objects);
  const dx = next.x - obj.x, dy = next.y - obj.y;
  if (dx || dy) {
    const moved = new Set([obj.id]);
    for (let more = true; more; ) {
      more = false;
      for (const l of doc.layers)
        if (l.type === 'objects')
          l.objects.forEach((o, i) => {
            if (o.on === undefined || !moved.has(o.on) || moved.has(o.id)) return;
            l.objects[i] = { ...o, x: o.x + dx, y: o.y + dy };
            moved.add(o.id);
            more = true;
            forgetOverlapIndex(l.objects);
          });
    }
  }
}

// -------------------------------------------------------------------------------------------------- zones

export function checkZone(doc: MapBody, z: Zone) {
  if (!(ZONE_KINDS as readonly string[]).includes(z.kind)) fail(`zone kind must be one of ${ZONE_KINDS.join(', ')}`);
  if (!(ZONE_SHAPES as readonly string[]).includes(z.shape)) fail(`zone shape must be one of ${ZONE_SHAPES.join(', ')}`);
  if (!Array.isArray(z.points) || z.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))))
    fail('points must be a list of [x, y] numbers');
  const need = { point: [1, 1], rect: [2, 2], polygon: [3, 1e4], polyline: [2, 1e4] }[z.shape];
  if (z.points.length < need[0] || z.points.length > need[1])
    fail(`a ${z.shape} zone needs ${need[0] === need[1] ? need[0] : `at least ${need[0]}`} point${need[0] === 1 ? '' : 's'}, got ${z.points.length}`);
  for (const [x, y] of z.points) if (x < -EPS || y < -EPS || x > doc.width + EPS || y > doc.height + EPS) fail(`zone point (${x}, ${y}) is outside the ${doc.width}×${doc.height} map`);
}

/** The shape a zone gets when none is given: one point, two a rect, else a polygon (a patrol: a polyline). */
const defaultShape = (kind: ZoneKind, n: number): ZoneShape => (n === 1 ? 'point' : kind === 'patrol' ? 'polyline' : n === 2 ? 'rect' : 'polygon');

export function opAddZone(doc: MapBody, op: Extract<MapOp, { op: 'addZone' }>, ctx: OpsContext = {}): string {
  const layer = layerFor(doc, 'zones', op.layer);
  const id = op.id ?? nextMapId(doc, 'z');
  if (typeof id !== 'string' || !id) fail('id must be a string');
  if (idTaken(doc, id)) fail(`id "${id}" is taken`);
  const given = Array.isArray(op.points) ? op.points.map((p) => (Array.isArray(p) ? ([p[0], p[1]] as [number, number]) : p)) : op.points;
  const shape = op.shape ?? defaultShape(op.kind, Array.isArray(given) ? given.length : 0);
  const points = anchorPoints(given, checkAnchor(op.anchor), shape);
  const z: Zone = withZoneTyped({ id, kind: op.kind, name: op.name ?? id, shape, points, properties: checkProps(op.properties, 'properties') }, op, ctx);
  checkZone(doc, z);
  const guards = storedGuards(op.avoidRoute);
  const hit = routeGuard(doc, op.avoidRoute, 'op', routeCtx(ctx))?.hitZone(z);
  if (hit) fail(`${guardedLabel({ kind: 'zone', zone: z })} would be ${describeHit(hit)}`);
  if (guards.length) z.avoidRoute = guards;
  layer.zones.push(z);
  noteId(doc, id);
  return id;
}

/**
 * FB-059: an op's vehicle / speed (typed, or `properties.vehicle` / `properties.speed` when not given) onto a zone.
 * The vehicle must be a sprite the context knows; null clears.
 */
function withZoneTyped(z: Zone, op: ZoneTyped & { properties?: Properties }, ctx: OpsContext): Zone {
  const props = { ...z.properties };
  let vehicle: unknown = op.vehicleId !== undefined ? op.vehicleId : op.vehicle;
  if (vehicle === undefined && op.properties?.vehicle !== undefined) vehicle = op.properties.vehicle;
  let speed: unknown = op.speed;
  if (speed === undefined && typeof op.properties?.speed === 'number') speed = op.properties.speed;
  if (vehicle !== undefined) delete props.vehicle;
  if (speed !== undefined) delete props.speed;
  const out: Zone = { ...z, properties: props };
  if (vehicle === null) delete out.vehicle;
  else if (vehicle !== undefined) {
    const id = typeof vehicle === 'number' ? vehicle : typeof vehicle === 'string' && /^\d+$/.test(vehicle.trim()) ? Number(vehicle) : null;
    if (id === null) fail(`vehicle "${String(vehicle)}" is not a sprite id (sprite names are looked up by the server)`);
    if (!Number.isInteger(id)) fail('vehicle must be a sprite name or id');
    checkSprite(ctx, id!);
    const name = ctx.spriteNames?.[id!];
    out.vehicle = { spriteId: id!, ...(name ? { name } : {}) };
  }
  if (speed === null) delete out.speed;
  else if (speed !== undefined) {
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) fail('speed must be a number of metres per second, 0 or more');
    out.speed = speed as number;
  }
  return out;
}

function opEditZone(doc: MapBody, op: Extract<MapOp, { op: 'editZone' }>, ctx: OpsContext) {
  const f = findZone(doc, op.id) ?? fail(`no zone "${op.id}"`);
  const { layer, zone } = f!;
  const z: Zone = {
    ...zone,
    ...(op.kind !== undefined ? { kind: op.kind } : {}),
    ...(op.name !== undefined ? { name: op.name } : {}),
    ...(op.shape !== undefined ? { shape: op.shape } : {}),
    ...(op.points !== undefined ? { points: anchorPoints(op.points, checkAnchor(op.anchor), op.shape ?? zone.shape) } : {}),
    ...(op.properties !== undefined ? { properties: { ...zone.properties, ...checkProps(op.properties, 'properties') } } : {}),
  };
  const typed = withZoneTyped(z, op, ctx);
  checkZone(doc, typed);
  layer.zones[layer.zones.indexOf(zone)] = typed;
}

// ------------------------------------------------------------------------------------------- the rest

function opRemove(doc: MapBody, id: string, only?: 'zone'): OpOutcome {
  const z = findZone(doc, id);
  if (z) return void z.layer.zones.splice(z.layer.zones.indexOf(z.zone), 1);
  const o = only ? undefined : findObject(doc, id);
  if (o) {
    o.layer.objects.splice(o.layer.objects.indexOf(o.obj), 1);
    // FB-079: what stood on it goes with it.
    const dependents: string[] = [];
    removeDependents(doc, new Set([id]), dependents);
    return dependents.length ? { report: { removed: [id, ...dependents], dependents } } : undefined;
  }
  return fail(only ? `no zone "${id}"` : `no object or zone "${id}"`);
}

function opSet(doc: MapBody, op: Extract<MapOp, { op: 'set' }>) {
  if (typeof op.key !== 'string' || !op.key) fail('set needs a key');
  if (op.value !== null && !['string', 'number', 'boolean'].includes(typeof op.value)) fail('value must be a string, number, boolean or null (to remove)');
  const target = op.target ?? (op.id === undefined ? 'map' : findZone(doc, op.id) ? 'zone' : findObject(doc, op.id) ? 'object' : doc.layers.some((l) => l.name === op.id) ? 'layer' : fail(`no object, zone or layer "${op.id}"`));
  let props: Properties;
  if (target === 'map') props = doc.properties;
  else if (target === 'object') props = (findObject(doc, op.id ?? '') ?? fail(`no object "${op.id}"`))!.obj.properties;
  else if (target === 'zone') props = (findZone(doc, op.id ?? '') ?? fail(`no zone "${op.id}"`))!.zone.properties;
  else if (target === 'layer') {
    const l = doc.layers.find((x) => x.name === op.id) ?? fail(`no layer "${op.id}"`);
    props = l!.properties ??= {};
  } else return fail('target must be map, object, zone or layer');
  if (op.value === null) delete props[op.key];
  else props[op.key] = op.value;
}

function opAddLayer(doc: MapBody, op: Extract<MapOp, { op: 'addLayer' }>) {
  if (!MAP_LAYER_TYPES.includes(op.type)) fail(`layer type must be one of ${MAP_LAYER_TYPES.join(', ')}`);
  if (typeof op.name !== 'string' || !op.name.trim()) fail('a layer needs a name');
  if (doc.layers.some((l) => l.name === op.name)) fail(`layer "${op.name}" exists`);
  const W = doc.width, H = doc.height;
  const name = op.name.trim();
  const layer: MapLayer =
    op.type === 'ground' ? { type: 'ground', name, ...(op.tileset ? { tileset: op.tileset } : {}), corners: new Array((W + 1) * (H + 1)).fill('') }
    : op.type === 'decoration' ? { type: 'decoration', name, cells: new Array(W * H).fill(0) }
    : op.type === 'collision' ? { type: 'collision', name, cells: new Array(W * H).fill(0) }
    : op.type === 'objects' ? { type: 'objects', name, objects: [] }
    : { type: 'zones', name, zones: [] };
  if (op.tileset !== undefined && (op.type !== 'ground' || !Number.isInteger(op.tileset) || op.tileset < 0 || op.tileset >= Math.max(1, doc.tilesets.length))) fail('tileset must be the slot of one of the map\'s tilesets (ground layers)');
  doc.layers.push(layer);
}

/** Empty layers (types or names; default all), ground to `terrain`. Reports what it cleared. */
function opClear(doc: MapBody, op: Extract<MapOp, { op: 'clear' }>, ctx: OpsContext): OpOutcome {
  if (op.layers !== undefined && (!Array.isArray(op.layers) || op.layers.some((l) => typeof l !== 'string'))) fail('layers must be a list of layer types or names');
  const want: string[] = op.layers?.length ? op.layers : [...CLEAR_LAYERS];
  for (const w of want)
    if (!(CLEAR_LAYERS as readonly string[]).includes(w) && !doc.layers.some((l) => l.name === w))
      fail(`no layer "${w}" (give layer types ${CLEAR_LAYERS.join(', ')} or names: ${doc.layers.map((l) => l.name).join(', ') || 'none'})`);
  if (op.terrain !== undefined && typeof op.terrain !== 'string') fail('terrain must be a terrain id or name');
  const cleared: string[] = [];
  let objects = 0, zones = 0, ground = false;
  for (const l of doc.layers) {
    if (!want.includes(l.type) && !want.includes(l.name)) continue;
    cleared.push(l.name);
    if (l.type === 'ground') l.corners.fill(terrainId(ctx, l, op.terrain ?? '')), (ground = true);
    else if (l.type === 'decoration') l.cells.fill(0);
    else if (l.type === 'collision') l.cells.fill(0), delete l.opened;
    else if (l.type === 'objects') (objects += l.objects.length), (l.objects = []);
    else if (l.type === 'zones') (zones += l.zones.length), (l.zones = []);
  }
  return { report: { cleared, removedObjects: objects, removedZones: zones, ...(ground ? { terrain: op.terrain ?? '' } : {}) } };
}

/** Collision on every cell where raised and ground terrains meet. Reports how many cells are cliffs. */
function opCliffs(doc: MapBody, op: Extract<MapOp, { op: 'cliffs' }>, ctx: OpsContext): OpOutcome {
  if (op.value !== undefined && typeof op.value !== 'boolean') fail('value must be true or false');
  const g = layerFor(doc, 'ground', op.ground);
  const c = layerFor(doc, 'collision', op.layer);
  const ts = ctx.tilesets?.[g.tileset ?? 0];
  if (!ts) fail('the ground tileset is not known, so its raised terrains are not either');
  if (!ts!.terrains.some((t) => (t.height ?? 0) > 0)) fail(`the ground tileset has no raised terrain (give a terrain height 1, e.g. ssg tileset terrain add <tileset> rock_plateau --kind rock --cliff)`);
  const W = doc.width + 1;
  let cells = 0;
  for (let y = 0; y < doc.height; y++)
    for (let x = 0; x < doc.width; x++)
      if (isCliffCorners(ts!.terrains, [g.corners[y * W + x], g.corners[y * W + x + 1], g.corners[(y + 1) * W + x + 1], g.corners[(y + 1) * W + x]])) {
        c.cells[y * doc.width + x] = op.value === false ? 0 : 1;
        cells++;
      }
  return { report: { cliffCells: cells, value: op.value !== false, layer: c.name } };
}

/** Path and stamp ops with an `anchor` → the plain op the generators take. */
function pathAnchor(op: PathOp & { anchor?: Anchor }): PathOp {
  const { anchor, ...rest } = op;
  const a = checkAnchor(anchor);
  return a === undefined ? rest : { ...rest, points: anchorPoints(op.points, a) };
}
function stampAnchor(op: StampOp & { anchor?: Anchor }): StampOp {
  const { anchor, ...rest } = op;
  const a = checkAnchor(anchor);
  if (a === undefined) return rest;
  if (op.centre !== undefined && op.centre !== (a === 'centre')) fail(`anchor "${a}" and centre: ${op.centre} disagree`);
  return { ...rest, centre: a === 'centre' };
}

// ------------------------------------------------------------------------------------------- route checks

/** FB-123: what a guarded zone / object is, for messages ("zone z3", "o4 (mine) at (3.5, 4.5)"). */
const guardedLabel = (t: { kind: 'zone'; zone: Zone } | { kind: 'object'; obj: MapObject }) =>
  t.kind === 'zone' ? `zone ${t.zone.id}${t.zone.name !== t.zone.id ? ` (${t.zone.name})` : ''}` : `${t.obj.id}${t.obj.name ? ` (${t.obj.name})` : ''} at (${t.obj.x}, ${t.obj.y})`;

/** FB-123: a zone / object's distance from its guarded routes on this map: a message when too close (or no route), else null. */
function guardProblem(doc: MapBody, id: string, guards: StoredRouteGuard[], verb: string, cache: Map<string, RouteResult>, ctx: OpsContext = {}): string | null {
  const z = findZone(doc, id);
  const o = z ? undefined : findObject(doc, id);
  if (!z && !o) return null;
  const what = z ? guardedLabel({ kind: 'zone', zone: z.zone }) : guardedLabel({ kind: 'object', obj: o!.obj });
  try {
    const g = guardFor(doc, guards, cache, routeCtx(ctx));
    const hit = z ? g?.hitZone(z.zone) : g?.hit(objectRect(o!.obj));
    return hit ? `${what} ${verb} ${describeHit(hit)}` : null;
  } catch (e) {
    if (e instanceof OpFail) return `${what}: ${e.message}`;
    throw e;
  }
}

const listProblems = (p: string[], max = 8) => p.slice(0, max).join('; ') + (p.length > max ? `; and ${p.length - max} more` : '');

function opCheckRoute(doc: MapBody, op: CheckRouteOp, ctx: OpsContext = {}): OpOutcome {
  if (op.ids !== undefined && (!Array.isArray(op.ids) || op.ids.some((i) => typeof i !== 'string'))) fail('ids must be a list of zone / object ids');
  const want = op.ids ? new Set(op.ids) : null;
  const missing = op.ids?.filter((i) => !findZone(doc, i) && !findObject(doc, i)) ?? [];
  if (missing.length) fail(`no object or zone ${missing.map((i) => `"${i}"`).join(', ')}`);
  const cache = new Map<string, RouteResult>();
  const problems: string[] = [];
  const checked: string[] = [], unguarded: string[] = [];
  for (const l of doc.layers) {
    const things: { id: string; avoidRoute?: StoredRouteGuard[] }[] = l.type === 'zones' ? l.zones : l.type === 'objects' ? l.objects : [];
    for (const t of things) {
      if (want && !want.has(t.id)) continue;
      if (!t.avoidRoute?.length) {
        if (want) unguarded.push(t.id);
        continue;
      }
      checked.push(t.id);
      const p = guardProblem(doc, t.id, t.avoidRoute, 'is', cache, ctx);
      if (p) problems.push(p);
    }
  }
  if (problems.length) fail(`checkRoute: ${problems.length} of ${checked.length} guarded zones / objects too close to their routes: ${listProblems(problems)}`);
  return { report: { checked: checked.length, ids: checked, ...(unguarded.length ? { unguarded } : {}) } };
}

/** FB-123: an op's `avoidRoute` legs with `at: "end"`, to check what it created once the batch has applied. */
interface EndCheck {
  index: number;
  op: string;
  ids: string[];
  guards: StoredRouteGuard[];
}

const outcomeIds = (out: OpOutcome): string[] => (typeof out === 'string' ? [out] : (out?.created ?? []));

function endCheckFor(op: MapOp, index: number, out: OpOutcome): EndCheck | null {
  if (op.op !== 'place' && op.op !== 'addZone' && op.op !== 'scatter') return null;
  const guards = normalizeAvoidRoute(op.avoidRoute).filter((g) => g.at === 'end').map(({ at: _, ...g }) => g);
  const ids = outcomeIds(out);
  return guards.length && ids.length ? { index, op: op.op, ids, guards } : null;
}

/** FB-123: the end-of-batch checks on the finished map: one error per op whose result came too close, and the ids that did. */
function runEndChecks(doc: MapBody, checks: EndCheck[], ctx: OpsContext = {}): { errors: OpError[]; bad: string[] } {
  const errors: OpError[] = [];
  const bad: string[] = [];
  const cache = new Map<string, RouteResult>();
  for (const c of checks) {
    const problems: string[] = [];
    for (const id of c.ids) {
      const p = guardProblem(doc, id, c.guards, 'would be', cache, ctx);
      if (p) problems.push(p), bad.push(id);
    }
    if (problems.length) errors.push({ index: c.index, op: c.op, message: `avoidRoute (at: "end", checked once every op of the batch had applied): ${listProblems(problems)}` });
  }
  return { errors, bad };
}

function applyOne(doc: MapBody, op: MapOp, ctx: OpsContext): OpOutcome {
  switch (op.op) {
    case 'paint': return void opPaint(doc, op, ctx);
    case 'fill': return void opFill(doc, op, ctx);
    case 'rect': return void opRect(doc, op, ctx);
    case 'line': return void opLine(doc, op, ctx);
    case 'place': {
      const cleared: string[] = [], warnings: string[] = [];
      const id = opPlace(doc, op, ctx, cleared, warnings);
      return op.clear || warnings.length ? { created: [id], report: { id, ...(op.clear ? { cleared } : {}), ...(warnings.length ? { warnings } : {}) } } : id;
    }
    case 'move': {
      const warnings: string[] = [];
      opMove(doc, op, ctx, warnings);
      return warnings.length ? { report: { id: op.id, warnings } } : undefined;
    }
    case 'remove': return opRemove(doc, op.id);
    case 'set': return void opSet(doc, op);
    case 'addZone': return opAddZone(doc, op, ctx);
    case 'editZone': return void opEditZone(doc, op, ctx);
    case 'removeZone': return void opRemove(doc, op.id, 'zone');
    case 'addLayer': return void opAddLayer(doc, op);
    case 'removeLayer': {
      const i = doc.layers.findIndex((l) => l.name === op.name);
      if (i < 0) fail(`no layer "${op.name}"`);
      return void doc.layers.splice(i, 1);
    }
    case 'editLayer': {
      const l = doc.layers.find((x) => x.name === op.name) ?? fail(`no layer "${op.name}" (layers: ${doc.layers.map((x) => x.name).join(', ') || 'none'})`);
      if (op.visible === undefined) fail('editLayer needs a setting to change (visible)');
      if (typeof op.visible !== 'boolean') fail('visible must be true or false');
      // Visible is the default, so it is stored only when false.
      if (op.visible) delete l!.visible;
      else l!.visible = false;
      return;
    }
    case 'generate': return opGenerate(doc, op, ctx);
    case 'scatter': return opScatter(doc, op, ctx);
    case 'path': return opPath(doc, pathAnchor(op), ctx);
    case 'stamp': return opStamp(doc, stampAnchor(op), ctx);
    case 'clear': return opClear(doc, op, ctx);
    case 'cliffs': return opCliffs(doc, op, ctx);
    case 'resize': return opResize(doc, op, ctx);
    case 'transform': return opTransform(doc, op, ctx);
    case 'fence': return opFence(doc, op, ctx);
    case 'clearRect': return opClearRect(doc, op);
    case 'clearZone': return opClearZone(doc, op);
    case 'checkRoute': return opCheckRoute(doc, op, ctx);
    default:
      return fail(`unknown op "${(op as { op?: unknown }).op}" (ops: ${MAP_OPS.join(', ')})`);
  }
}

const SPRITE_LABEL = /^sprite (\d+)$/;

/**
 * A report with the "sprite 30" labels the generators use for unnamed objects swapped for the sprites' names
 * ("tree_small"), keys and values alike, plus `sprites` ({ name: id }) so the ids stay beside the names.
 */
export function nameSprites(report: Record<string, unknown>, ctx: Pick<OpsContext, 'spriteNames' | 'sprites'>): Record<string, unknown> {
  const used: Record<string, number> = {};
  // Reports that already name a sprite (the generators do) still get the name → id map.
  const byName = new Map<string, number>();
  for (const [id, n] of Object.entries(ctx.spriteNames ?? {})) byName.set(n, Number(id));
  for (const [id, s] of Object.entries(ctx.sprites ?? {})) if (s?.name && !byName.has(s.name)) byName.set(s.name, Number(id));
  const name = (v: string): string => {
    const m = SPRITE_LABEL.exec(v);
    if (!m) {
      const known = byName.get(v);
      if (known !== undefined) used[v] = known;
      return v;
    }
    const id = Number(m[1]);
    const n = ctx.spriteNames?.[id] ?? ctx.sprites?.[id]?.name;
    if (n === undefined) return v;
    used[n] = id;
    return n;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return name(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [name(k), walk(x)]));
    return v;
  };
  const out = walk(report) as Record<string, unknown>;
  return Object.keys(used).length && out.sprites === undefined ? { ...out, sprites: used } : out;
}

/**
 * Apply ops in order. An op that fails changes nothing and is reported in `errors`; the others apply. With
 * `atomic`, any error returns the input body unchanged (applied = 0).
 */
export function applyOps(doc: MapBody, ops: MapOp[], ctx: OpsContext = {}, o: { atomic?: boolean } = {}): ApplyResult {
  // Atomic batches usually all apply: run them on one copy (a copy per op costs ~30 ms each on a 256×256 map). The
  // first failure drops that copy and the careful pass below reports every op's error exactly as before.
  if (o.atomic && Array.isArray(ops)) {
    const fast = applyAll(doc, ops, ctx);
    if (fast) return fast;
  }
  let cur: MapBody = structuredClone(doc);
  const errors: OpError[] = [];
  const created: string[] = [];
  const reports: OpReport[] = [];
  const checks: EndCheck[] = [];
  let applied = 0;
  if (!Array.isArray(ops)) return { doc, errors: [{ index: -1, op: '', message: 'ops must be a list' }], applied: 0, created, reports };
  ops.forEach((op, index) => {
    // Each op runs on a copy so a failure halfway through (a brush) leaves nothing behind.
    const work = structuredClone(cur);
    try {
      if (!op || typeof op !== 'object') fail('an op must be an object');
      const out = applyOne(work, op, ctx);
      if (typeof out === 'string') created.push(out);
      else if (out) {
        created.push(...(out.created ?? []));
        if (out.report) reports.push({ index, op: op.op, ...nameSprites(out.report, ctx) });
      }
      const check = endCheckFor(op, index, out);
      if (check) checks.push(check);
      cur = work;
      applied++;
    } catch (e) {
      if (!(e instanceof OpFail)) throw e;
      errors.push({ index, op: String((op as { op?: unknown })?.op ?? ''), message: e.message });
    }
  });
  if (o.atomic && errors.length) return { doc, errors, applied: 0, created: [], reports: [] };
  if (checks.length) {
    const end = runEndChecks(cur, checks, ctx);
    if (end.errors.length) {
      if (o.atomic) return { doc, errors: end.errors, applied: 0, created: [], reports: [] };
      // Partial: what came too close goes again (with what stood on it); its op counts as not applied.
      for (const id of end.bad) if (findZone(cur, id) || findObject(cur, id)) opRemove(cur, id);
      errors.push(...end.errors);
      errors.sort((a, b) => a.index - b.index);
      return { doc: cur, errors, applied: applied - end.errors.length, created: created.filter((id) => findZone(cur, id) || findObject(cur, id)), reports };
    }
  }
  return { doc: cur, errors, applied, created, reports };
}

/** Every op on one copy of the body; null as soon as one fails (the copy is then half-edited and dropped). */
function applyAll(doc: MapBody, ops: MapOp[], ctx: OpsContext): ApplyResult | null {
  const cur: MapBody = structuredClone(doc);
  const created: string[] = [];
  const reports: OpReport[] = [];
  const checks: EndCheck[] = [];
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    try {
      if (!op || typeof op !== 'object') return null;
      const out = applyOne(cur, op, ctx);
      if (typeof out === 'string') created.push(out);
      else if (out) {
        created.push(...(out.created ?? []));
        if (out.report) reports.push({ index, op: op.op, ...nameSprites(out.report, ctx) });
      }
      const check = endCheckFor(op, index, out);
      if (check) checks.push(check);
    } catch (e) {
      if (!(e instanceof OpFail)) throw e;
      return null;
    }
  }
  // FB-123: avoidRoute at: "end" against the finished map; any failure refuses the whole (atomic) batch.
  const end = checks.length ? runEndChecks(cur, checks, ctx) : null;
  if (end?.errors.length) return { doc, errors: end.errors, applied: 0, created: [], reports: [] };
  return { doc: cur, errors: [], applied: ops.length, created, reports };
}

// --------------------------------------------------------------------------------------------- validation

/** Everything wrong with a map body, as readable messages (empty = valid). */
export function validateMap(b: MapBody): string[] {
  const e: string[] = [];
  const size = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_MAP_SIZE;
  if (typeof b.name !== 'string' || !b.name.trim()) e.push('a name is required');
  if (b.orientation !== 'isometric' && b.orientation !== 'orthogonal') e.push('orientation must be isometric or orthogonal');
  if (!size(b.width) || !size(b.height)) e.push(`width and height must be whole cells, 1–${MAX_MAP_SIZE}`);
  if (!Number.isInteger(b.tileWidth) || b.tileWidth < 1 || !Number.isInteger(b.tileHeight) || b.tileHeight < 1) e.push('tileWidth and tileHeight must be whole pixels');
  if (typeof b.metresPerTile !== 'number' || !(b.metresPerTile > 0)) e.push('metresPerTile must be a positive number');
  if (!Array.isArray(b.tilesets) || b.tilesets.some((t) => !Number.isInteger(t))) e.push('tilesets must be a list of tileset ids');
  if (!b.properties || typeof b.properties !== 'object' || Array.isArray(b.properties)) e.push('properties must be an object');
  if (!Array.isArray(b.layers)) e.push('layers must be a list');
  if (e.length) return e;
  const names = new Set<string>();
  const ids = new Set<string>();
  const W = b.width, H = b.height;
  for (const l of b.layers) {
    if (!l || !MAP_LAYER_TYPES.includes(l.type)) { e.push(`unknown layer type "${(l as { type?: unknown })?.type}"`); continue; }
    if (typeof l.name !== 'string' || !l.name) e.push(`a ${l.type} layer has no name`);
    else if (names.has(l.name)) e.push(`layer name "${l.name}" is used twice`);
    names.add(l.name);
    if (l.type === 'ground') {
      if (!Array.isArray(l.corners) || l.corners.length !== (W + 1) * (H + 1) || l.corners.some((c) => typeof c !== 'string')) e.push(`ground layer "${l.name}": corners must be ${(W + 1) * (H + 1)} terrain ids ((width+1)×(height+1))`);
      if (l.tileset !== undefined && (!Number.isInteger(l.tileset) || l.tileset < 0 || (b.tilesets.length > 0 && l.tileset >= b.tilesets.length))) e.push(`ground layer "${l.name}": tileset must be a slot of the map's tilesets`);
    } else if (l.type === 'decoration' || l.type === 'collision') {
      if (!Array.isArray(l.cells) || l.cells.length !== W * H || l.cells.some((c) => !Number.isInteger(c) || c < 0 || (l.type === 'collision' && c > 1))) e.push(`${l.type} layer "${l.name}": cells must be ${W * H} ${l.type === 'collision' ? '0/1 flags' : 'gids'}`);
      if (l.type === 'collision' && l.opened !== undefined && (!Array.isArray(l.opened) || l.opened.length !== W * H || l.opened.some((c) => c !== 0 && c !== 1))) e.push(`collision layer "${l.name}": opened must be ${W * H} 0/1 flags`);
    } else if (l.type === 'objects') {
      if (!Array.isArray(l.objects)) { e.push(`objects layer "${l.name}": objects must be a list`); continue; }
      for (const o of l.objects) {
        if (!o || typeof o.id !== 'string' || !o.id) { e.push(`objects layer "${l.name}": an object has no id`); continue; }
        if (ids.has(o.id)) e.push(`id "${o.id}" is used twice`);
        ids.add(o.id);
        if (o.spriteId === undefined && !o.assetRef) e.push(`${o.id}: needs a spriteId or an assetRef`);
        if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) e.push(`${o.id}: x and y must be numbers`);
        else e.push(...objectProblems(b, l, o));
      }
    } else if (l.type === 'zones') {
      if (!Array.isArray(l.zones)) { e.push(`zones layer "${l.name}": zones must be a list`); continue; }
      for (const z of l.zones) {
        if (!z || typeof z.id !== 'string' || !z.id) { e.push(`zones layer "${l.name}": a zone has no id`); continue; }
        if (ids.has(z.id)) e.push(`id "${z.id}" is used twice`);
        ids.add(z.id);
        try {
          checkZone(b, z);
        } catch (err) {
          e.push(`${z.id}: ${(err as Error).message}`);
        }
        if (z.vehicle !== undefined && (!z.vehicle || !Number.isInteger(z.vehicle.spriteId))) e.push(`${z.id}: vehicle must be { spriteId }`);
        if (z.speed !== undefined && !(typeof z.speed === 'number' && Number.isFinite(z.speed) && z.speed >= 0)) e.push(`${z.id}: speed must be a number ≥ 0`);
      }
    }
  }
  // Overlaps are reported once per pair.
  const pairs = new Set<string>();
  return [...new Set(e)].filter((m) => {
    const pair = /^(\S+) would overlap (\S+)/.exec(m);
    if (!pair) return true;
    pairs.add(`${pair[1]} ${pair[2]}`);
    return !pairs.has(`${pair[2]} ${pair[1]}`);
  });
}

/** Change the size of a map, keeping what is inside (new cells/corners get `fill`). */
export function resizeMap(b: MapBody, width: number, height: number, fill = ''): MapBody {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_MAP_SIZE || height > MAX_MAP_SIZE) throw new Error(`width and height must be whole cells, 1–${MAX_MAP_SIZE}`);
  const W = b.width, H = b.height;
  const grid = <T>(src: T[], sw: number, sh: number, dw: number, dh: number, def: T): T[] =>
    Array.from({ length: dw * dh }, (_, i) => {
      const x = i % dw, y = Math.floor(i / dw);
      return x < sw && y < sh ? src[y * sw + x] : def;
    });
  const layers = b.layers.map((l): MapLayer => {
    if (l.type === 'ground') return { ...l, corners: grid(l.corners, W + 1, H + 1, width + 1, height + 1, fill) };
    if (l.type === 'decoration') return { ...l, cells: grid(l.cells, W, H, width, height, 0) } as DecorationLayer;
    if (l.type === 'collision') return { ...l, cells: grid(l.cells, W, H, width, height, 0 as 0 | 1), ...(l.opened ? { opened: grid(l.opened, W, H, width, height, 0 as 0 | 1) } : {}) } as CollisionLayer;
    return l;
  });
  return { ...b, width, height, layers };
}
