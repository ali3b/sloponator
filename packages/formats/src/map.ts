/**
 * `ssg-map/1`: `<name>.map.json`, a level map as a game keeps it in its repo (ali3b/sloponator#17). A grid of cells
 * over one or more tilesets with layers of ground terrain (one terrain id per grid corner), decoration tiles, placed
 * objects, collision and gameplay zones. @slop/levels edits it by replaying plain ops (`applyOps`) and exports it to
 * Tiled (.tmj / .tmx); it mirrors MapBody of @slop/levels (map/types.ts), with the tilesets named.
 *
 * Coordinates: cell (x, y) covers [x, x+1) × [y, y+1); object positions and zone points are in cell units (floats),
 * so (2.5, 3.5) is the centre of cell (2, 3). Corners are (width + 1) × (height + 1), row-major.
 */
import { z } from 'zod';

const propertyValue = z.union([z.string(), z.number(), z.boolean()]);
export const mapProperties = z.record(z.string(), propertyValue);
const point = z.tuple([z.number(), z.number()]);
/** FB-110/122/123: a stored route guard (what `avoidRoute` checked when the zone or object was added). */
const routeEnd = z.union([z.string().min(1), point]);
const routeGuard = z.strictObject({ from: routeEnd, to: routeEnd, via: z.array(routeEnd).optional(), margin: z.number(), clearance: z.number().optional() });

const layerBase = { name: z.string().min(1), visible: z.literal(false).optional(), properties: mapProperties.optional() };

export const mapGroundLayer = z.strictObject({
  type: z.literal('ground'),
  ...layerBase,
  /** Slot in `tilesets` (default 0). */
  tileset: z.number().int().min(0).optional(),
  /** One terrain id per grid corner ('' = none). */
  corners: z.array(z.string()),
});
export const mapDecorationLayer = z.strictObject({ type: z.literal('decoration'), ...layerBase, /** Map gids per cell (0 = empty): tile id t of slot i is 1 + i·65536 + t. */ cells: z.array(z.number().int().min(0)) });
export const mapCollisionLayer = z.strictObject({
  type: z.literal('collision'),
  ...layerBase,
  cells: z.array(z.union([z.literal(0), z.literal(1)])),
  /** FB-120: cells a collision-clearing path (a ford, a bridge) opened. */
  opened: z.array(z.union([z.literal(0), z.literal(1)])).optional(),
});

export const mapObject = z.strictObject({
  id: z.string().min(1),
  /** A declared sprite (its id in the build; `name` is its name). */
  spriteId: z.number().int().optional(),
  /** Or a free reference (a library model "Pack/Model", or anything the game understands). */
  assetRef: z.string().optional(),
  name: z.string().optional(),
  state: z.string().optional(),
  facing: z.string().optional(),
  /** The anchor: the ground centre of the footprint, cell units. */
  x: z.number(),
  y: z.number(),
  footprint: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }).optional(),
  properties: mapProperties,
  /** FB-079: metres above the ground, and the object it stands on. */
  elevation: z.number().optional(),
  on: z.string().optional(),
  /** FB-095: a game-only marker (a mine): no collision, never blocks solid objects. */
  collision: z.literal(false).optional(),
  /** FB-078: the fence it is a panel of. */
  group: z.string().optional(),
  /** FB-101: placed by a scatter. */
  scattered: z.literal(true).optional(),
  /** FB-123: the routes it was placed to keep off. */
  avoidRoute: z.array(routeGuard).optional(),
});
export const mapObjectLayer = z.strictObject({ type: z.literal('objects'), ...layerBase, objects: z.array(mapObject) });

export const ZONE_KINDS = ['spawn', 'patrol', 'objective', 'extraction', 'trigger', 'custom'] as const;
export const ZONE_SHAPES = ['point', 'rect', 'polygon', 'polyline'] as const;
export const mapZone = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(ZONE_KINDS),
  name: z.string(),
  shape: z.enum(ZONE_SHAPES),
  /** A point has 1, a rect 2 (opposite corners), a polygon ≥ 3, a polyline ≥ 2. */
  points: z.array(point),
  properties: mapProperties,
  /** FB-059: the sprite that drives it (a vehicle on a patrol route) and its speed in m/s. */
  vehicle: z.object({ spriteId: z.number().int(), name: z.string().optional() }).optional(),
  speed: z.number().min(0).optional(),
  avoidRoute: z.array(routeGuard).optional(),
});
export const mapZoneLayer = z.strictObject({ type: z.literal('zones'), ...layerBase, zones: z.array(mapZone) });

export const mapLayer = z.discriminatedUnion('type', [mapGroundLayer, mapDecorationLayer, mapObjectLayer, mapCollisionLayer, mapZoneLayer]);

export const ssgMap = z.strictObject({
  schema: z.literal('ssg-map/1'),
  name: z.string().min(1),
  orientation: z.enum(['isometric', 'orthogonal']),
  width: z.number().int().min(1).max(512),
  height: z.number().int().min(1).max(512),
  tileWidth: z.number().int().min(1),
  tileHeight: z.number().int().min(1),
  metresPerTile: z.number().positive(),
  /** The tilesets by their declared names, in slot order. */
  tilesets: z.array(z.string().min(1)),
  layers: z.array(mapLayer),
  properties: mapProperties,
});
export type SsgMap = z.infer<typeof ssgMap>;
