// Moved from the old generator's packages/shared/src/tileset/types.ts (ali3b/sloponator#17, #18).
import { pixelsPerMetre } from '@slop/sprites';
import type { SpriteLight } from '@slop/sprites';

/**
 * A tileset: ground tiles for one project, built from terrains (grass, dirt, road…) and the corner-based Wang
 * transitions between them, plus references to object sprites that maps can place on top.
 *
 * Scale follows the sprite tile lock (camera.ts, ScaleConfig mode 'tile'): `metresPerTile` is the edge length of
 * one tile on the ground, in metres. For a 64×32 iso diamond and 1 m per tile, pixels per metre = 64 / (1 · √2)
 * ≈ 45.25, the same value a sprite rendered with `--tile 64x32` gets, so props and characters line up with tiles.
 */

export type TilesetOrientation = 'isometric' | 'orthogonal';

export const TERRAIN_KINDS = ['grass', 'dirt', 'sand', 'mud', 'road', 'water', 'snow', 'jungle', 'rock', 'custom'] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** A flat colour per kind, used when a terrain has no colour of its own (and as the Tiled wang colour). */
export const TERRAIN_COLORS: Record<TerrainKind, string> = {
  grass: '#5a8f3a', dirt: '#8a6440', sand: '#d8c38a', mud: '#5b4630', road: '#6d6a66', water: '#3a6ea5', snow: '#e8eef2', jungle: '#2f6b2a', rock: '#8a8174', custom: '#a0a0a0',
};

export type TerrainSource =
  /** A flat palette colour, optionally broken up with noise (0 = flat … 1 = strong). */
  | { type: 'palette'; color: string; noise?: number }
  /**
   * A Synty texture or material: an installed asset id, or a texture path inside a pack. `scale` is the metres one
   * repeat of the texture covers on the ground (a whole number of tiles; default one tile). `color` is the
   * texture's average colour, filled in by the server when it finds the file (the Tiled wang colour).
   */
  | { type: 'texture'; assetId?: number; path?: string; scale?: number; color?: string };

export interface Terrain {
  /** Stable id within the tileset (a slug of the name), referenced by tile corners and wangsets. */
  id: string;
  name: string;
  kind: TerrainKind;
  source: TerrainSource;
  /** Recolour a texture (snow and desert from temperate Synty textures), "#rrggbb". */
  tint?: string;
  /** Random variants of this terrain's tiles (its pure tiles, and its transitions: the larger of the pair's). Default: the wangset's. */
  variants?: number;
  /**
   * Height level (B4): 0 = ground (default), 1 = raised one level (a plateau). Where a raised terrain meets a
   * ground one the transition tiles draw a cliff face toward the camera, and the tiles grow taller by the tileset's
   * `cliffHeight` (see raster.ts "Cliffs").
   */
  height?: 0 | 1;
  /**
   * Shore treatment where this terrain meets another (B4): wet sand and foam on the land side, shallow water near
   * the line and darker deep water inside. Default: on for kind water, off for the rest.
   */
  shore?: boolean;
}

export const MIX_MODES = ['auto', 'triples', 'pairs'] as const;
export type TilesetMixes = (typeof MIX_MODES)[number];
/** With mixes 'auto', a tileset with at most this many terrains gets every 3–4-terrain mix (above: only those asked for). */
export const AUTO_MIX_TERRAINS = 5;

/** A corner-based Wang set: every terrain pair gets the 16 corner combinations, each in `variants` copies. */
export interface Wangset {
  id: string;
  name: string;
  type: 'corner';
  /** Terrain id pairs [a, b]: a is the base, b the overlay. */
  pairs: [string, string][];
  /** Random variants per corner combination (1–16), unless a terrain sets its own. */
  variants: number;
}

export type TilePropertyValue = string | number | boolean;

/** One tile in the atlas. Its picture is drawn by the ground tile renderer (raster.ts) at its id's atlas slot. */
export interface TilesetTile {
  /** Local tile id (Tiled's `id`), 0-based, unique. */
  id: number;
  /**
   * Terrain id at each corner of the map cell: [top-left, top-right, bottom-right, bottom-left] (Tiled's corner
   * order). On an isometric diamond those are the top, right, bottom and left vertices of the picture.
   */
  terrainCorners?: [string, string, string, string];
  /** Which random variant of this corner combination (0-based). */
  variant: number;
  /** Where the rendered picture lives: atlas page and pixel rectangle. */
  image?: { page: number; x: number; y: number; w: number; h: number };
  properties: Record<string, TilePropertyValue>;
  /** Collision polygons in tile pixel coordinates (0,0 = the tile image's top-left). */
  collision?: { name?: string; points: [number, number][] }[];
}

/** A reference to an object sprite (tree, crate, wall…) that maps can place on this tileset. */
export interface TilesetObject {
  spriteId: number;
  name: string;
  state?: string;
  facing?: string;
}

/** The editable body of a tileset (what the server stores as JSON). */
export interface TilesetBody {
  name: string;
  orientation: TilesetOrientation;
  tileWidth: number;
  tileHeight: number;
  /** Tile edge length on the ground in metres (the tile lock's metresPerTile; default 1). */
  metresPerTile: number;
  /**
   * Period of the large-scale ground noise in tiles (1–16, default 4; see raster.ts "Periods"). Variant v of a
   * corner combination is drawn for period cell (v mod P, ⌊v / P⌋ mod P); edges stay seamless whatever is placed.
   */
  noisePeriod?: number;
  /**
   * Screen height in pixels of a one-level cliff face (B4; default tileHeight / 2). Only used when a terrain has
   * height 1: then every tile picture is tileHeight + cliffHeight tall (the diamond at the bottom, raised ground
   * drawn cliffHeight higher), which Tiled draws bottom-aligned on the grid.
   */
  cliffHeight?: number;
  /**
   * Tiles for cells where three or four terrains meet (FB-049): 'pairs' = none (only pure and two-terrain tiles);
   * 'triples' = every 3- and 4-terrain corner combination whose edges are all blended pairs (see blendedMixCorners);
   * 'auto' (default) = the same as 'triples' while the tileset has at most AUTO_MIX_TERRAINS terrains, else only
   * the combinations maps asked for (`mixCorners`, added by the `add-mixes` fix). Mixed tiles have one variant.
   */
  mixes?: TilesetMixes;
  /**
   * Three- and four-terrain corner combinations added on demand ([tl, tr, br, bl]; the `add-mixes` fix adds the
   * ones a map's cells need). Drawn unless `mixes` is 'pairs'.
   */
  mixCorners?: [string, string, string, string][];
  /**
   * Lighting (FB-060): the same presets and overrides as a sprite's light (dusk, night…). The rendered ground is
   * graded by what that light does to a flat, up-facing surface compared with day (light.ts lightTint), so tiles
   * and sprites given the same light share one palette. Unset (or day): tiles as they always were.
   */
  light?: SpriteLight;
  terrains: Terrain[];
  wangsets: Wangset[];
  /** One past the highest tile id ever used, kept once tiles were removed, so a removed tile's id is never reused. */
  nextId?: number;
  tiles: TilesetTile[];
  objects: TilesetObject[];
}

export interface Tileset extends TilesetBody {
  id: number;
  projectId: number;
  /** Bumped on every save; a PATCH may pass the revision it read to refuse overwriting newer edits. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_TILE_WIDTH = 64;
export const DEFAULT_TILE_HEIGHT = 32;
export const DEFAULT_METRES_PER_TILE = 1;
export const DEFAULT_NOISE_PERIOD = 4;
export const MAX_VARIANTS = 16;

export function defaultTilesetBody(name: string, o: Partial<Omit<TilesetBody, 'name'>> = {}): TilesetBody {
  return {
    name,
    orientation: o.orientation ?? 'isometric',
    tileWidth: o.tileWidth ?? DEFAULT_TILE_WIDTH,
    tileHeight: o.tileHeight ?? DEFAULT_TILE_HEIGHT,
    metresPerTile: o.metresPerTile ?? DEFAULT_METRES_PER_TILE,
    terrains: o.terrains ?? [],
    wangsets: o.wangsets ?? [],
    tiles: o.tiles ?? [],
    objects: o.objects ?? [],
  };
}

/** Whether a terrain is raised (height 1). */
export const isRaised = (t: Pick<Terrain, 'height'> | undefined) => (t?.height ?? 0) > 0;

/** Whether a terrain gets the shore treatment (its own flag, else on for water). */
export const hasShore = (t: Pick<Terrain, 'shore' | 'kind'> | undefined) => !!t && (t.shore ?? t.kind === 'water');

/**
 * Extra pixels above the diamond in every tile picture: the cliff height when any terrain is raised, else 0.
 * Tile pictures are tileWidth × (tileHeight + this), the ground diamond in their bottom tileHeight rows.
 */
export function tileExtraHeight(b: Pick<TilesetBody, 'tileHeight'> & { terrains?: Pick<Terrain, 'height'>[]; cliffHeight?: number }): number {
  if (!b.terrains?.some(isRaised)) return 0;
  return b.cliffHeight ?? Math.max(1, Math.round(b.tileHeight / 2));
}

/** Height of one tile picture in the atlas (tileHeight, plus the cliff height when a terrain is raised). */
export const tileImageHeight = (b: Pick<TilesetBody, 'tileHeight'> & { terrains?: Pick<Terrain, 'height'>[]; cliffHeight?: number }) => b.tileHeight + tileExtraHeight(b);

/** Pixels per metre on the ground: the same number a sprite gets from the tile lock (camera.ts pixelsPerMetre). */
export function tilesetPpm(t: Pick<TilesetBody, 'orientation' | 'tileWidth' | 'metresPerTile'>): number {
  return pixelsPerMetre({ mode: 'tile', tilePx: t.tileWidth, metresPerTile: t.metresPerTile, shape: t.orientation === 'isometric' ? 'diamond' : 'square' })!;
}
