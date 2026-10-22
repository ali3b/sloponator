// Moved from the old generator's packages/shared/src/map/types.ts (ali3b/sloponator#17, #18).
import type { TilePropertyValue } from '../tileset/types.js';
import type { StoredRouteGuard } from './route.js';

/**
 * A map: a grid of cells over one or more tilesets, with layers of ground terrain, decoration tiles, placed object
 * sprites, collision and gameplay zones. The body is one JSON document the server stores per map; every edit is a
 * plain JSON op applied by `applyOps` (ops.ts), so the CLI, the MCP tools and the web editor share one path.
 *
 * Coordinates. Cell (x, y) covers [x, x+1) × [y, y+1) in map coordinates; x runs along the map's columns and y
 * along its rows. On an isometric map x runs down-right and y down-left on screen (Tiled's isometric axes, the u and
 * v of an object export's `tiles`). Corner (x, y) is the vertex at the top-left of cell (x, y); a map of w × h cells
 * has (w + 1) × (h + 1) corners. Object positions and zone points are in cell units (floats), so (2.5, 3.5) is the
 * centre of cell (2, 3).
 */

export type MapOrientation = 'isometric' | 'orthogonal';
export type PropertyValue = TilePropertyValue;
export type Properties = Record<string, PropertyValue>;

/**
 * Ground: one terrain id per grid corner, row-major ((width + 1) × (height + 1); '' = no terrain). Corner-based so
 * the tileset's corner (Wang) tiles resolve by themselves: cell (x, y) takes the tile whose corners are the terrains
 * of its four vertices (resolve.ts).
 */
export interface GroundLayer {
  type: 'ground';
  name: string;
  /** Index into the map's `tilesets` whose terrains and tiles this layer uses (default 0). */
  tileset?: number;
  corners: string[];
  visible?: boolean;
  properties?: Properties;
}

/**
 * Decoration: one map gid per cell, row-major (0 = empty). Map gids are Tiled gids with a fixed range per tileset
 * slot: tile `id` of the map's tileset `i` is `1 + i·GID_STRIDE + id` (mapGid), so adding tiles to one tileset never
 * shifts another's gids. The Tiled export writes the same firstgids.
 */
export interface DecorationLayer {
  type: 'decoration';
  name: string;
  cells: number[];
  visible?: boolean;
  properties?: Properties;
}

/** Cells along the map's x and y an object covers (its footprint for its facing). */
export interface CellFootprint {
  w: number;
  h: number;
}

/** A placed object sprite (tree, crate, bunker…). */
export interface MapObject {
  /** Stable id within the map ("o1", "o2"…). */
  id: string;
  /** A project sprite (its export carries the object block: footprint, tiles, anchor, states). */
  spriteId?: number;
  /** Or a free reference (a library model name, "Pack/Model", or anything the game understands). */
  assetRef?: string;
  name?: string;
  state?: string;
  facing?: string;
  /**
   * Where the object's anchor (the ground centre of its footprint) stands, in cell units. With a footprint of
   * w × h cells, an odd count puts the anchor on a cell centre (n + 0.5), an even one on a cell edge.
   */
  x: number;
  y: number;
  /** Cells covered along x and y; absent when unknown (then the object is a point and never overlaps). */
  footprint?: CellFootprint;
  properties: Properties;
  /**
   * FB-079: metres above the ground the object stands at (a code book on a table): taken from its support's height
   * when placed `on` one, or given. Exported as `elevationM` / `elevationPx`; previews draw it that much higher.
   */
  elevation?: number;
  /** FB-079: the object it stands on (its id). It overlaps only objects on the same support and moves with it. */
  on?: string;
  /**
   * FB-095: false = a marker (a mine): no collision polygon in the export (`collides: false`) and it never blocks or
   * is blocked by solid objects (markers still keep off each other).
   */
  collision?: false;
  /** FB-078: the fence (or wall) it is a panel of: panels of one group may overlap each other. */
  group?: string;
  /** FB-101: placed by a scatter, so `clear: true` / `clearRect` / `clearZone` may remove it. */
  scattered?: true;
  /** FB-123: the routes it was placed to keep off (place's avoidRoute); the checkRoute op re-checks them. */
  avoidRoute?: StoredRouteGuard[];
}

export interface ObjectLayer {
  type: 'objects';
  name: string;
  objects: MapObject[];
  visible?: boolean;
  properties?: Properties;
}

/** Collision: one flag per cell, row-major (1 = blocked). */
export interface CollisionLayer {
  type: 'collision';
  name: string;
  cells: (0 | 1)[];
  /**
   * FB-120: the cells a collision-clearing path (`path {collision: false}`: a ford, a bridge) opened, one flag per cell
   * like `cells`; absent until a path opens one. Scatter and generate keep off those that are still open.
   */
  opened?: (0 | 1)[];
  visible?: boolean;
  properties?: Properties;
}

export const ZONE_KINDS = ['spawn', 'patrol', 'objective', 'extraction', 'trigger', 'custom'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];
export const ZONE_SHAPES = ['point', 'rect', 'polygon', 'polyline'] as const;
export type ZoneShape = (typeof ZONE_SHAPES)[number];

/**
 * A gameplay zone. Points are in cell units: a point has 1, a rect 2 (opposite corners), a polygon ≥ 3 (closed), a
 * polyline ≥ 2 (a path, e.g. a patrol route).
 */
export interface Zone {
  id: string;
  kind: ZoneKind;
  name: string;
  shape: ZoneShape;
  points: [number, number][];
  properties: Properties;
  /**
   * FB-059: the project sprite that drives this zone (a vehicle on a patrol route), checked when it is set. `name`
   * is the sprite's name then (the export writes the sprite's current name).
   */
  vehicle?: { spriteId: number; name?: string };
  /** FB-059: speed along the route, metres per second. */
  speed?: number;
  /** FB-123: the routes it was added to keep off (addZone's avoidRoute); the checkRoute op re-checks them. */
  avoidRoute?: StoredRouteGuard[];
}

export interface ZoneLayer {
  type: 'zones';
  name: string;
  zones: Zone[];
  visible?: boolean;
  properties?: Properties;
}

export type MapLayer = GroundLayer | DecorationLayer | ObjectLayer | CollisionLayer | ZoneLayer;
export type MapLayerType = MapLayer['type'];
export const MAP_LAYER_TYPES: MapLayerType[] = ['ground', 'decoration', 'objects', 'collision', 'zones'];

/** The editable body of a map (what the server stores as JSON). */
export interface MapBody {
  name: string;
  orientation: MapOrientation;
  /** Size in cells. */
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  /** Tile edge length on the ground in metres (the tile lock's metresPerTile). */
  metresPerTile: number;
  /** Tileset ids, in slot order (slot i owns map gids 1 + i·GID_STRIDE …). */
  tilesets: number[];
  layers: MapLayer[];
  properties: Properties;
}

export interface MapDoc extends MapBody {
  id: number;
  projectId: number;
  /** Bumped on every save; ops and PATCH may pass the revision they read to refuse overwriting newer edits. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export const MAX_MAP_SIZE = 512;
/** Map gids per tileset slot (see DecorationLayer). */
export const GID_STRIDE = 65536;

export const mapGid = (slot: number, tileId: number) => 1 + slot * GID_STRIDE + tileId;
/** A map gid → its tileset slot and local tile id (null for 0). */
export const splitGid = (gid: number): { slot: number; id: number } | null => (gid > 0 ? { slot: Math.floor((gid - 1) / GID_STRIDE), id: (gid - 1) % GID_STRIDE } : null);

export function defaultMapBody(name: string, o: Partial<Omit<MapBody, 'name'>> & { terrain?: string } = {}): MapBody {
  const width = o.width ?? 32, height = o.height ?? 32;
  return {
    name,
    orientation: o.orientation ?? 'isometric',
    width, height,
    tileWidth: o.tileWidth ?? 64,
    tileHeight: o.tileHeight ?? (o.orientation === 'orthogonal' ? o.tileWidth ?? 64 : (o.tileWidth ?? 64) / 2),
    metresPerTile: o.metresPerTile ?? 1,
    tilesets: o.tilesets ?? [],
    layers: o.layers ?? defaultLayers(width, height, o.terrain ?? ''),
    properties: o.properties ?? {},
  };
}

/** Ground, decoration, objects, collision and zones: the usual stack, ground filled with `terrain`. */
export function defaultLayers(width: number, height: number, terrain = ''): MapLayer[] {
  return [
    { type: 'ground', name: 'ground', corners: new Array((width + 1) * (height + 1)).fill(terrain) },
    { type: 'decoration', name: 'decoration', cells: new Array(width * height).fill(0) },
    { type: 'objects', name: 'objects', objects: [] },
    { type: 'collision', name: 'collision', cells: new Array(width * height).fill(0) },
    { type: 'zones', name: 'zones', zones: [] },
  ];
}

/** The body of a map document (drops the server's id, project, revision and timestamps). */
export function mapBodyOf(d: MapBody): MapBody {
  return { name: d.name, orientation: d.orientation, width: d.width, height: d.height, tileWidth: d.tileWidth, tileHeight: d.tileHeight, metresPerTile: d.metresPerTile, tilesets: d.tilesets, layers: d.layers, properties: d.properties };
}
