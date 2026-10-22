// Moved from synty-sprite-generator packages/shared/src/model3d/terrain.ts (P3, ali3b/sloponator#14).
/**
 * Terrain on the track grid (CS-FB-003): one tile (flat, slope, outer / inner corner, plateau, water, coast) or a
 * whole grid of corner heights, as flat-shaded Synty-coloured triangles in chunks, a water surface, a welded collider
 * and seeded scatter spots for small Synty props. Pure maths (no gltf, no database): the server's terrainBuild.ts turns
 * the result into a GLB. docs/MODELS.md "Terrain" is the contract.
 *
 * Frame: metres, +Y up, the same grid as track pieces: tile (i, j) covers x ∈ [(i − ½)·cell, (i + ½)·cell] and
 * z ∈ [j·cell, (j + 1)·cell], so the origin is on the ground in the middle of tile (0, 0)'s −Z edge, where a 1×1
 * track piece in that tile has its entry. Corner (i, j) is at x = (i − ½)·cell, z = j·cell. Compass names index
 * the grid: N is +Z (rows, j), E is +X (columns, i); so corner SW is (i, j), SE (i+1, j), NW (i, j+1), NE (i+1, j+1).
 *
 * Edges match exactly: every vertex on a tile's edge is computed from that edge's two corner heights alone (the same
 * expression whichever tile asks), so two tiles exported apart, or chunks of one grid, share bit-identical edge
 * vertices.
 */
import { rng } from './noise.js';
import { TRACK_DEFAULT_CELL, slopeArcs } from './trackpiece.js';

export type TerrainVec3 = [number, number, number];

export const TERRAIN_TILES = ['flat', 'slope', 'corner-outer', 'corner-inner', 'plateau', 'water', 'coast'] as const;
export type TerrainTile = (typeof TERRAIN_TILES)[number];
export const TERRAIN_DIRS = ['N', 'E', 'S', 'W', 'NE', 'NW', 'SE', 'SW'] as const;
export type TerrainDir = (typeof TERRAIN_DIRS)[number];
/** Material slots of a terrain (each a Synty swatch picked by reference, like a track piece's). */
export const TERRAIN_SLOTS = ['ground', 'slope', 'shore', 'seabed', 'water', 'skirt'] as const;
export type TerrainSlot = (typeof TERRAIN_SLOTS)[number];
export const TERRAIN_SHAPES = ['planar', 'track'] as const;
export const TERRAIN_BIOMES = ['meadow', 'desert', 'alpine', 'tropical', 'swamp'] as const;
export type TerrainBiome = (typeof TERRAIN_BIOMES)[number];
/** Water codes of a tile: none, the whole tile, or the triangle at one corner (a coast; the diagonal is the shore). */
export const TERRAIN_WATER_CODES = ['', '.', 'w', 'NE', 'NW', 'SE', 'SW'] as const;

/** Bump when the mesh or the scatter changes for the same spec: cached terrains are rebuilt. */
export const TERRAIN_VERSION = 2;

export interface TerrainScatter {
  /** A Synty prop by reference ("Pack/Asset" or a name), exported in metres and instanced (EXT_mesh_gpu_instancing). */
  asset: string;
  /** Props per tile on average (default 4; 0–200). */
  density?: number;
  /** Uniform scale range [min, max] (default [0.8, 1.2]). */
  scale?: [number, number];
  /** Steepest ground it stands on, degrees (default 25). */
  maxSlope?: number;
  /** Where: `land` (default, dry ground off the shore), `shore` (the shore only), `any` dry ground. */
  on?: 'land' | 'shore' | 'any';
  /** Tilt with the ground (default false: upright). */
  align?: boolean;
}

/** ModelSpec.terrain: one tile (`tile`) or a grid (`heights`). */
export interface TerrainSpec {
  /** The grid's cell in metres (default 30, as track pieces; Car Smash: 62.42). */
  cell?: number;
  /** One height step in metres (default 0.44 cell; Car Smash: 27.43, a hill). Heights count steps. */
  height?: number;
  /** One tile: its kind and the way it faces (slope: the uphill side N|E|S|W; corners: the uphill corner NE|NW|SE|SW; coast: the water's corner). */
  tile?: TerrainTile;
  dir?: TerrainDir;
  /** A grid: corner heights in steps, rows along +Z (j), columns along +X (i): (rows + 1) × (cols + 1) numbers. */
  heights?: number[][];
  /** Water per tile (rows × cols): '' or '.' land, 'w' water, 'NE' | 'NW' | 'SE' | 'SW' a coast (water in that corner's triangle). Strings of one char a tile also work ('.', 'w'). */
  water?: (string | number)[][] | string[];
  /** The water surface's height in metres (default 0.02, a hair over flat ground so it hides the shore line's z-fight). */
  level?: number;
  /** How far the bed under open water sinks below the surface, metres (default 1.5; needs subdiv ≥ 2 to show inside one tile). */
  depth?: number;
  /** Slope faces: `planar` (default; straight faces, two triangles a tile) or `track` (the slope-up piece's curve: level at both ends, so a road slope fits). */
  shape?: (typeof TERRAIN_SHAPES)[number];
  /** track shape: the share of the run each curved end takes (default 0.25, as slope-up; 0: a constant grade, as slope-up with transition 0). */
  transition?: number;
  /** Subdivisions per tile side (default 1 planar, 8 track; 1–32). */
  subdiv?: number;
  /** Vertical walls this many metres down from the outer edges (default 0: none). Hides the underside of a lone tile. */
  skirt?: number;
  /** Tiles per chunk side: a grid is cut into chunk × chunk meshes (default 10). */
  chunk?: number;
  /** A swatch set: meadow (default), desert, alpine, tropical, swamp (each slot's default reference). */
  biome?: TerrainBiome;
  materials?: Partial<Record<TerrainSlot, string>>;
  /** Faces steeper than this (degrees) take the `slope` material (default 45: the hills of a track-shape grid stay grass, cliffs are rock). */
  slopeAngle?: number;
  /** Brightness variation between faces, 0–0.3 (default 0.06: three shades a slot). */
  shade?: number;
  /** Seed of the shading and the scatter (default 1). */
  seed?: number;
  scatter?: TerrainScatter[];
  /** Tiles [i, j] kept free of scatter (where track pieces go). */
  clear?: [number, number][];
}

export class TerrainSpecError extends Error {}

/**
 * Default references per biome (each falls back to its colour when the pack is not installed). Synty's nature packs
 * colour much of their ground with vertex colours over a white atlas, so these name the assets whose atlas swatches
 * read as grass, sand, rock or snow; water has no atlas swatch anywhere, so it is a plain colour.
 */
export const TERRAIN_BIOME_MATERIALS: Record<TerrainBiome, Record<TerrainSlot, { ref: string; fallback: string }>> = {
  meadow: {
    ground: { ref: 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Grass_Large_01#6f9a3a', fallback: '#5c7432' },
    slope: { ref: 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Rock_01', fallback: '#96826c' },
    shore: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_DirtRoad_Straight_01#e0c08a', fallback: '#ac9a82' },
    seabed: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Crater_01', fallback: '#96826c' },
    water: { ref: '#3f86b5', fallback: '#3f86b5' },
    skirt: { ref: 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Rock_01', fallback: '#96826c' },
  },
  desert: {
    ground: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_DirtRoad_Straight_01#e0c08a', fallback: '#ac9a82' },
    slope: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Rock_Cliff_01', fallback: '#83563d' },
    shore: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Crater_01', fallback: '#96826c' },
    seabed: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Crater_01', fallback: '#96826c' },
    water: { ref: '#3b9cb0', fallback: '#3b9cb0' },
    skirt: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Rock_Cliff_01', fallback: '#83563d' },
  },
  alpine: {
    ground: { ref: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Snow_Mound_01#f2f6fa', fallback: '#9da2a8' },
    slope: { ref: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Rock_Cliff_01', fallback: '#56544f' },
    shore: { ref: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Rock_Pebbles_01', fallback: '#5c5b57' },
    seabed: { ref: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Rock_Pebbles_01', fallback: '#5c5b57' },
    water: { ref: '#4a7fa8', fallback: '#4a7fa8' },
    skirt: { ref: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Rock_Cliff_01', fallback: '#56544f' },
  },
  tropical: {
    ground: { ref: 'POLYGON_NatureBiomes_TropicalJungle/SM_Env_Grass_Short_Clump_01#4f9a3a', fallback: '#556b2d' },
    slope: { ref: 'POLYGON_NatureBiomes_TropicalJungle/SM_Env_Rock_Cliff_01', fallback: '#96826c' },
    shore: { ref: 'POLYGON_NatureBiomes_AridDesert/SM_Env_DirtRoad_Straight_01#e0c08a', fallback: '#ac9a82' },
    seabed: { ref: 'POLYGON_NatureBiomes_TropicalJungle/SM_Env_Rock_Flat_01', fallback: '#96826c' },
    water: { ref: '#2fa7b8', fallback: '#2fa7b8' },
    skirt: { ref: 'POLYGON_NatureBiomes_TropicalJungle/SM_Env_Rock_Cliff_01', fallback: '#96826c' },
  },
  swamp: {
    ground: { ref: 'POLYGON_NatureBiomes_SwampMarshland/SM_Env_Swamp_Scum_01#4c5b3a', fallback: '#495b2c' },
    slope: { ref: 'POLYGON_NatureBiomes_SwampMarshland/SM_Env_Rock_Swamp_01', fallback: '#96826c' },
    shore: { ref: 'POLYGON_NatureBiomes_SwampMarshland/SM_Env_Swamp_Log_01', fallback: '#4f453b' },
    seabed: { ref: 'POLYGON_NatureBiomes_SwampMarshland/SM_Env_Swamp_Log_01', fallback: '#4f453b' },
    water: { ref: '#4c5b3a', fallback: '#4c5b3a' },
    skirt: { ref: 'POLYGON_NatureBiomes_SwampMarshland/SM_Env_Rock_Swamp_01', fallback: '#96826c' },
  },
};

// ---- validation ----------------------------------------------------------------------------------------------
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
function num(v: unknown, what: string, lo: number, hi: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new TerrainSpecError(`${what} must be a number ${lo}–${hi}`);
  return r4(n);
}
function int(v: unknown, what: string, lo: number, hi: number): number {
  const n = num(v, what, lo, hi);
  if (!Number.isInteger(n)) throw new TerrainSpecError(`${what} must be a whole number ${lo}–${hi}`);
  return n;
}
function oneOf<T extends string>(v: unknown, what: string, list: readonly T[]): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new TerrainSpecError(`${what} must be one of ${list.filter(Boolean).join(', ')}`);
  return v as T;
}
function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TerrainSpecError(`${what} must be an object`);
  return v as Record<string, unknown>;
}
function onlyKeys(o: Record<string, unknown>, what: string, keys: readonly string[]) {
  const bad = Object.keys(o).filter((k) => !keys.includes(k));
  if (bad.length) throw new TerrainSpecError(`${what}: unknown field${bad.length > 1 ? 's' : ''} ${bad.map((k) => `"${k}"`).join(', ')} (allowed: ${keys.join(', ')})`);
}

const SPEC_KEYS = [
  'cell', 'height', 'tile', 'dir', 'heights', 'water', 'level', 'depth', 'shape', 'transition', 'subdiv', 'skirt', 'chunk', 'biome', 'materials', 'slopeAngle', 'shade', 'seed',
  'scatter', 'clear',
] as const;
const MAX_TILES = 128;
const TILE_DIRS: Partial<Record<TerrainTile, readonly TerrainDir[]>> = {
  slope: ['N', 'E', 'S', 'W'],
  'corner-outer': ['NE', 'NW', 'SE', 'SW'],
  'corner-inner': ['NE', 'NW', 'SE', 'SW'],
  coast: ['NE', 'NW', 'SE', 'SW'],
};

/** Normalise a water code ('' for land). */
function waterCode(v: unknown, what: string): string {
  if (v === 0 || v === null || v === undefined) return '';
  if (v === 1) return 'w';
  const s = typeof v === 'string' ? v.trim() : '';
  const c = s === '.' ? '' : s === 'W' ? 'w' : s.toUpperCase() === s && s.length === 2 ? s : s.toLowerCase();
  if (!(TERRAIN_WATER_CODES as readonly string[]).includes(c)) throw new TerrainSpecError(`${what} must be '' or '.' (land), 'w' (water) or a coast corner NE, NW, SE, SW`);
  return c === '.' ? '' : c;
}

/**
 * Check a terrain spec and drop what is default, so equal terrains hash the same. A TerrainSpecError names the bad
 * field.
 */
export function normaliseTerrain(raw: unknown): TerrainSpec {
  const o = obj(raw, 'terrain');
  onlyKeys(o, 'terrain', SPEC_KEYS);
  const t: TerrainSpec = {};
  if (o.tile !== undefined && o.heights !== undefined) throw new TerrainSpecError('terrain: give a tile or heights (a grid), not both');
  if (o.tile === undefined && o.heights === undefined) throw new TerrainSpecError(`terrain needs a tile (${TERRAIN_TILES.join(', ')}) or heights (a grid of corner heights in steps)`);
  if (o.cell !== undefined) t.cell = num(o.cell, 'terrain.cell', 2, 500);
  if (o.height !== undefined) t.height = num(o.height, 'terrain.height', 0.1, 500);
  if (o.tile !== undefined) {
    t.tile = oneOf(o.tile, 'terrain.tile', TERRAIN_TILES);
    const dirs = TILE_DIRS[t.tile];
    if (o.dir !== undefined) {
      if (!dirs) throw new TerrainSpecError(`terrain: a ${t.tile} tile does not take dir`);
      const d = oneOf(o.dir, 'terrain.dir', dirs);
      if (d !== dirs[0]) t.dir = d;
    }
    if (o.water !== undefined) throw new TerrainSpecError('terrain: water goes with heights (a tile says water or coast itself)');
  } else {
    if (o.dir !== undefined) throw new TerrainSpecError('terrain: dir goes with a tile');
    const h = o.heights;
    if (!Array.isArray(h) || h.length < 2 || !h.every((r) => Array.isArray(r))) throw new TerrainSpecError('terrain.heights must be rows of corner heights (at least 2 rows of 2: one tile)');
    const cols = (h[0] as unknown[]).length;
    if (cols < 2 || !h.every((r) => (r as unknown[]).length === cols)) throw new TerrainSpecError('terrain.heights: every row needs the same number of corners (at least 2)');
    if (h.length - 1 > MAX_TILES || cols - 1 > MAX_TILES) throw new TerrainSpecError(`terrain.heights: at most ${MAX_TILES}×${MAX_TILES} tiles`);
    t.heights = (h as unknown[][]).map((r, j) => r.map((v, i) => num(v, `terrain.heights[${j}][${i}]`, -64, 64)));
    if (o.water !== undefined) {
      const w = o.water;
      const rows = h.length - 1;
      if (!Array.isArray(w) || w.length !== rows) throw new TerrainSpecError(`terrain.water must have a row per tile row (${rows}), each with a code per tile`);
      const codes = (w as unknown[]).map((r, j) => {
        const cells = typeof r === 'string' ? [...r] : Array.isArray(r) ? r : null;
        if (!cells || cells.length !== cols - 1) throw new TerrainSpecError(`terrain.water[${j}] needs ${cols - 1} codes (a string of one char a tile, or a list)`);
        return cells.map((v, i) => waterCode(v, `terrain.water[${j}][${i}]`));
      });
      if (codes.some((r) => r.some(Boolean))) t.water = codes;
    }
  }
  if (o.level !== undefined) t.level = num(o.level, 'terrain.level', -1000, 1000);
  if (o.depth !== undefined) t.depth = num(o.depth, 'terrain.depth', 0, 100);
  if (o.shape !== undefined) {
    const s = oneOf(o.shape, 'terrain.shape', TERRAIN_SHAPES);
    if (s !== 'planar') t.shape = s;
  }
  if (o.transition !== undefined) t.transition = num(o.transition, 'terrain.transition', 0, 0.5);
  if (o.subdiv !== undefined) t.subdiv = int(o.subdiv, 'terrain.subdiv', 1, 32);
  if (o.skirt !== undefined && o.skirt !== 0) t.skirt = num(o.skirt, 'terrain.skirt', 0, 1000);
  if (o.chunk !== undefined) t.chunk = int(o.chunk, 'terrain.chunk', 1, MAX_TILES);
  if (o.biome !== undefined) {
    const b = oneOf(o.biome, 'terrain.biome', TERRAIN_BIOMES);
    if (b !== 'meadow') t.biome = b;
  }
  if (o.materials !== undefined) {
    const mo = obj(o.materials, 'terrain.materials');
    onlyKeys(mo, 'terrain.materials', TERRAIN_SLOTS);
    const m: Partial<Record<TerrainSlot, string>> = {};
    for (const k of TERRAIN_SLOTS) {
      if (mo[k] === undefined) continue;
      if (typeof mo[k] !== 'string' || !String(mo[k]).trim()) throw new TerrainSpecError(`terrain.materials.${k} must be "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb"`);
      const ref = String(mo[k]).trim();
      if (ref.startsWith('#') && !/^#[0-9a-f]{6}$/i.test(ref)) throw new TerrainSpecError(`terrain.materials.${k}: a colour must be #rrggbb`);
      m[k] = ref.startsWith('#') ? ref.toLowerCase() : ref;
    }
    if (Object.keys(m).length) t.materials = m;
  }
  if (o.slopeAngle !== undefined) t.slopeAngle = num(o.slopeAngle, 'terrain.slopeAngle', 0, 90);
  if (o.shade !== undefined) t.shade = num(o.shade, 'terrain.shade', 0, 0.3);
  if (o.seed !== undefined) t.seed = int(o.seed, 'terrain.seed', 0, 2 ** 31);
  if (o.scatter !== undefined) {
    if (!Array.isArray(o.scatter) || o.scatter.length > 8) throw new TerrainSpecError('terrain.scatter must be a list of at most 8 { asset, density?, scale?, maxSlope?, on?, align? }');
    t.scatter = o.scatter.map((raw, k) => {
      const w = `terrain.scatter[${k}]`;
      const so = obj(raw, w);
      onlyKeys(so, w, ['asset', 'density', 'scale', 'maxSlope', 'on', 'align']);
      if (typeof so.asset !== 'string' || !so.asset.trim()) throw new TerrainSpecError(`${w}.asset must be a prop's name or "Pack/Asset"`);
      const s: TerrainScatter = { asset: so.asset.trim() };
      if (so.density !== undefined) s.density = num(so.density, `${w}.density`, 0, 200);
      if (so.scale !== undefined) {
        if (!Array.isArray(so.scale) || so.scale.length !== 2) throw new TerrainSpecError(`${w}.scale must be [min, max]`);
        const sc = so.scale.map((v, i) => num(v, `${w}.scale[${i}]`, 0.01, 100)) as [number, number];
        if (sc[0] > sc[1]) throw new TerrainSpecError(`${w}.scale must be [min, max] with min ≤ max`);
        s.scale = sc;
      }
      if (so.maxSlope !== undefined) s.maxSlope = num(so.maxSlope, `${w}.maxSlope`, 0, 90);
      if (so.on !== undefined) {
        const on = oneOf(so.on, `${w}.on`, ['land', 'shore', 'any'] as const);
        if (on !== 'land') s.on = on;
      }
      if (so.align !== undefined) {
        if (typeof so.align !== 'boolean') throw new TerrainSpecError(`${w}.align must be true or false`);
        if (so.align) s.align = true;
      }
      return s;
    });
    if (!t.scatter.length) delete t.scatter;
  }
  if (o.clear !== undefined) {
    if (!Array.isArray(o.clear) || !o.clear.every((c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n))))
      throw new TerrainSpecError('terrain.clear must be a list of tiles [i, j] (whole numbers)');
    const seen = new Set<string>();
    t.clear = (o.clear as [number, number][]).filter((c) => !seen.has(c.join(',')) && seen.add(c.join(','))).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    if (!t.clear.length) delete t.clear;
  }
  expandTerrain(t); // a slope too steep for the track shape fails here
  return t;
}

/** The terrain's default name (ModelSpec.name when left out). */
export const terrainName = (t: TerrainSpec) => (t.tile ? `terrain_${t.tile}${t.dir ? `_${t.dir.toLowerCase()}` : ''}` : 'terrain').replace(/-/g, '_');

// ---- expansion -----------------------------------------------------------------------------------------------
export interface ExpandedTerrain {
  cell: number;
  step: number;
  cols: number;
  rows: number;
  /** Corner heights in steps, [j][i]. */
  heights: number[][];
  /** Water codes per tile, [j][i] ('' land). */
  water: string[][];
  level: number;
  depth: number;
  shape: 'planar' | 'track';
  transition: number;
  subdiv: number;
  skirt: number;
  chunk: number;
  slopeAngle: number;
  shade: number;
  seed: number;
  scatter: Required<TerrainScatter>[];
  clear: Set<string>;
}

/** One tile's corner heights [SW, SE, NW, NE] and water code. */
function tileCorners(tile: TerrainTile, dir: TerrainDir | undefined): { h: [number, number, number, number]; water: string } {
  const d = dir ?? TILE_DIRS[tile]?.[0];
  const up = (c: 'SW' | 'SE' | 'NW' | 'NE') => (d === c || (d?.length === 1 && c.includes(d)) ? 1 : 0);
  const four = (f: (c: 'SW' | 'SE' | 'NW' | 'NE') => number) => (['SW', 'SE', 'NW', 'NE'] as const).map(f) as [number, number, number, number];
  switch (tile) {
    case 'slope':
    case 'corner-outer':
      return { h: four(up), water: '' };
    case 'corner-inner': {
      const opp = { NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' }[d as 'NE'];
      return { h: four((c) => (c === opp ? 0 : 1)), water: '' };
    }
    case 'plateau':
      return { h: [1, 1, 1, 1], water: '' };
    case 'water':
      return { h: [0, 0, 0, 0], water: 'w' };
    case 'coast':
      return { h: [0, 0, 0, 0], water: d! };
    default:
      return { h: [0, 0, 0, 0], water: '' };
  }
}

export function expandTerrain(t: TerrainSpec): ExpandedTerrain {
  const cell = t.cell ?? TRACK_DEFAULT_CELL;
  const step = t.height ?? r4(0.44 * cell);
  let heights: number[][], water: string[][];
  if (t.tile) {
    const { h, water: w } = tileCorners(t.tile, t.dir);
    heights = [[h[0], h[1]], [h[2], h[3]]];
    water = [[w]];
  } else {
    heights = t.heights!;
    const rows = heights.length - 1, cols = heights[0].length - 1;
    water = (t.water as string[][] | undefined) ?? Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
  }
  const shape = t.shape ?? 'planar';
  const transition = t.transition ?? 0.25;
  if (shape === 'track') {
    let maxStep = 0;
    for (let j = 0; j < heights.length; j++)
      for (let i = 0; i < heights[0].length; i++) {
        if (i + 1 < heights[0].length) maxStep = Math.max(maxStep, Math.abs(heights[j][i + 1] - heights[j][i]));
        if (j + 1 < heights.length) maxStep = Math.max(maxStep, Math.abs(heights[j + 1][i] - heights[j][i]));
      }
    try {
      slopeArcs(cell, Math.max(1, maxStep) * step, transition);
    } catch {
      throw new TerrainSpecError(`terrain: a rise of ${r4(Math.max(1, maxStep) * step)} m over a ${cell} m tile is too steep for shape track (use planar)`);
    }
  }
  return {
    cell, step, cols: heights[0].length - 1, rows: heights.length - 1, heights, water,
    level: t.level ?? 0.02,
    depth: t.depth ?? 1.5,
    shape, transition,
    subdiv: t.subdiv ?? (shape === 'track' ? 8 : 1),
    skirt: t.skirt ?? 0,
    chunk: t.chunk ?? 10,
    slopeAngle: t.slopeAngle ?? 45,
    shade: t.shade ?? 0.06,
    seed: t.seed ?? 1,
    scatter: (t.scatter ?? []).map((s) => ({ asset: s.asset, density: s.density ?? 4, scale: s.scale ?? [0.8, 1.2], maxSlope: s.maxSlope ?? 25, on: s.on ?? 'land', align: !!s.align })),
    clear: new Set((t.clear ?? []).map((c) => c.join(','))),
  };
}

// ---- heights -------------------------------------------------------------------------------------------------
/**
 * The shape of a rise between two corners along one tile side, 0 → 1 over t ∈ [0, 1]. Planar: linear. Track: the
 * slope-up piece's profile (a level arc, a straight at its grade, the mirror arc), point-symmetric about ½.
 */
export function riseShape(ex: Pick<ExpandedTerrain, 'shape' | 'cell' | 'step' | 'transition'>): (t: number) => number {
  if (ex.shape !== 'track') return (t) => t;
  const run = ex.cell, h = ex.step;
  const { theta, r } = slopeArcs(run, h, ex.transition);
  const a = ex.transition * run, y1 = r * (1 - Math.cos(theta)), g = Math.tan(theta);
  const y = (x: number) => (x <= a ? r - Math.sqrt(Math.max(0, r * r - x * x)) : y1 + (x - a) * g);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Mirror the second half so the shape is exactly point-symmetric (S(1 − t) = 1 − S(t)).
    return t <= 0.5 ? y(t * run) / h : 1 - y((1 - t) * run) / h;
  };
}

/** Which diagonal splits a tile: 'a' joins SW–NE, 'b' joins SE–NW. The odd corner (or the coast's) is kept alone. */
export function tileDiagonal(h: [number, number, number, number], water: string): 'a' | 'b' {
  if (water === 'SW' || water === 'NE') return 'b';
  if (water === 'SE' || water === 'NW') return 'a';
  const [sw, se, nw, ne] = h;
  const da = Math.abs(sw - ne), db = Math.abs(se - nw);
  // The diagonal whose ends are level (an odd corner then sits alone in its triangle); else the flatter one.
  if (db === 0 && da !== 0) return 'b';
  if (da === 0 && db !== 0) return 'a';
  return da < db ? 'a' : 'b';
}

export interface TerrainChunk {
  /** Node name: terrain_<ci>_<cj>; the tiles it covers [i0, j0, i1, j1) (end exclusive). */
  name: string;
  tiles: [number, number, number, number];
  /** Flat-shaded triangles per slot: xyz per vertex, three a triangle, and each triangle's shade (0, 1 or 2). */
  slots: Record<Exclude<TerrainSlot, 'water'>, { pos: number[]; nrm: number[]; shade: number[] }>;
  water: { pos: number[]; nrm: number[] };
}

export interface TerrainSpot {
  /** Index into the spec's scatter list. */
  item: number;
  pos: TerrainVec3;
  /** Yaw (radians about +Y), uniform scale, and the ground normal when aligned (else up). */
  yaw: number;
  scale: number;
  up: TerrainVec3;
}

export interface TerrainMesh {
  chunks: TerrainChunk[];
  collider: { pos: number[]; idx: number[] };
  spots: TerrainSpot[];
  bounds: { min: TerrainVec3; max: TerrainVec3 };
  /** Grid lines: the lowest tile's corner [x, z]. */
  gridMin: [number, number];
  /** The global vertex grid (for tests): heights [gj][gi] in metres and the steps a tile side is cut in. */
  vertexHeights: Float64Array;
  vertexCols: number;
  waterTiles: number;
}

const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A deterministic hash of integers → [0, 1). */
function hash01(...n: number[]) {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Build the terrain: a global vertex grid (n vertices a tile side), each vertex's height from the corners of the
 * edge or tile it lies on; triangles per tile on its diagonal; water; skirt; scatter spots.
 */
export function buildTerrainMesh(ex: ExpandedTerrain): TerrainMesh {
  const { cell: c, step, cols, rows, subdiv: n } = ex;
  const S = riseShape(ex);
  const VC = cols * n + 1, VR = rows * n + 1;
  const H = (i: number, j: number) => ex.heights[j][i] * step;
  const edgeH = (h0: number, h1: number, t: number) => (h0 === h1 ? h0 : h0 + (h1 - h0) * S(t));
  const tileH = (i: number, j: number): [number, number, number, number] => [ex.heights[j][i], ex.heights[j][i + 1], ex.heights[j + 1][i], ex.heights[j + 1][i + 1]];
  const diag: ('a' | 'b')[][] = Array.from({ length: rows }, (_, j) => Array.from({ length: cols }, (_, i) => tileDiagonal(tileH(i, j), ex.water[j][i])));

  /** Height inside a tile at (u, v) ∈ [0, 1]², on its diagonal's two planes, with the rise shape. */
  const insideH = (i: number, j: number, u: number, v: number) => {
    const [sw, se, nw, ne] = tileH(i, j).map((x) => x * step);
    const su = S(u), sv = S(v);
    if (diag[j][i] === 'a') {
      // SW–NE diagonal (u = v): below it SW, SE, NE; above it SW, NW, NE.
      return u >= v ? sw + (se - sw) * su + (ne - se) * sv : sw + (nw - sw) * sv + (ne - nw) * su;
    }
    // SE–NW diagonal (u + v = 1): below SW, SE, NW; above SE, NE, NW.
    return u + v <= 1 ? sw + (se - sw) * su + (nw - sw) * sv : ne + (nw - ne) * (1 - su) + (se - ne) * (1 - sv);
  };

  // Global vertex heights: corners exact, edges from their two corners, insides from the tile.
  const vh = new Float64Array(VC * VR);
  for (let gj = 0; gj < VR; gj++)
    for (let gi = 0; gi < VC; gi++) {
      const i = Math.floor(gi / n), j = Math.floor(gj / n), ku = gi % n, kv = gj % n;
      let h: number;
      if (ku === 0 && kv === 0) h = H(i, j);
      else if (ku === 0) h = edgeH(H(i, j), H(i, j + 1), kv / n);
      else if (kv === 0) h = edgeH(H(i, j), H(i + 1, j), ku / n);
      else h = insideH(i, j, ku / n, kv / n);
      vh[gj * VC + gi] = h;
    }

  // Wet sub-triangles: per tile, by its code; each sub-square split on the tile's diagonal.
  const wetTri = (i: number, j: number, ku: number, kv: number, upper: boolean) => {
    const code = ex.water[j][i];
    if (!code) return false;
    if (code === 'w') return true;
    // The sub-triangle's centroid in tile coordinates, and the side of the tile diagonal it is on.
    const d = diag[j][i];
    const cu = (ku + (d === 'a' ? (upper ? 1 / 3 : 2 / 3) : upper ? 2 / 3 : 1 / 3)) / n, cv = (kv + (upper ? 2 / 3 : 1 / 3)) / n;
    if (code === 'SW') return cu + cv < 1;
    if (code === 'NE') return cu + cv > 1;
    if (code === 'SE') return cu > cv;
    return cv > cu; // NW
  };
  // A vertex sinks to the bed when every sub-triangle around it is wet and it is not on the grid's outer edge.
  const wetCount = new Uint8Array(VC * VR), triCount = new Uint8Array(VC * VR);
  const subTris = (i: number, j: number, ku: number, kv: number) => {
    const gi = i * n + ku, gj = j * n + kv;
    const v00 = gj * VC + gi, v10 = v00 + 1, v01 = v00 + VC, v11 = v01 + 1;
    // 'a' (SW–NE): lower (v00, v10, v11), upper (v00, v11, v01). 'b' (SE–NW): lower (v00, v10, v01), upper (v10, v11, v01).
    return diag[j][i] === 'a'
      ? ([[v00, v10, v11, false], [v00, v11, v01, true]] as const)
      : ([[v00, v10, v01, false], [v10, v11, v01, true]] as const);
  };
  let waterTiles = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (ex.water[j][i]) waterTiles++;
      for (let kv = 0; kv < n; kv++)
        for (let ku = 0; ku < n; ku++)
          for (const [a, b, d, up] of subTris(i, j, ku, kv)) {
            const wet = wetTri(i, j, ku, kv, up);
            for (const v of [a, b, d]) {
              triCount[v]++;
              if (wet) wetCount[v]++;
            }
          }
    }
  const bed = ex.level - ex.depth;
  for (let gj = 1; gj < VR - 1; gj++)
    for (let gi = 1; gi < VC - 1; gi++) {
      const v = gj * VC + gi;
      if (triCount[v] && wetCount[v] === triCount[v]) vh[v] = Math.min(vh[v], bed);
    }

  const X = (gi: number) => (gi / n - 0.5) * c;
  const Z = (gj: number) => (gj / n) * c;
  const P = (v: number) => [X(v % VC), vh[v], Z(Math.floor(v / VC))];
  const cosSlope = Math.cos((ex.slopeAngle * Math.PI) / 180);

  // Chunks.
  const chunks: TerrainChunk[] = [];
  const colIdx: number[] = [];
  const lo: TerrainVec3 = [Infinity, Infinity, Infinity], hi: TerrainVec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: number[]) => {
    for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
  };
  // Shore: land triangles with a vertex on a wet triangle.
  const touchesWater = (v: number) => wetCount[v] > 0;
  const nCh = Math.ceil(cols / ex.chunk), mCh = Math.ceil(rows / ex.chunk);
  for (let cj = 0; cj < mCh; cj++)
    for (let ci = 0; ci < nCh; ci++) {
      const i0 = ci * ex.chunk, j0 = cj * ex.chunk, i1 = Math.min(cols, i0 + ex.chunk), j1 = Math.min(rows, j0 + ex.chunk);
      const ch: TerrainChunk = {
        name: nCh * mCh === 1 ? 'terrain' : `terrain_${ci}_${cj}`,
        tiles: [i0, j0, i1, j1],
        slots: { ground: { pos: [], nrm: [], shade: [] }, slope: { pos: [], nrm: [], shade: [] }, shore: { pos: [], nrm: [], shade: [] }, seabed: { pos: [], nrm: [], shade: [] }, skirt: { pos: [], nrm: [], shade: [] } },
        water: { pos: [], nrm: [] },
      };
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          for (let kv = 0; kv < n; kv++)
            for (let ku = 0; ku < n; ku++)
              for (const [a, b, d, up] of subTris(i, j, ku, kv)) {
                const pa = P(a), pb = P(b), pd = P(d);
                // Counter-clockwise seen from above: (a, d, b) for both splits as listed (they run clockwise).
                const nr = cross3(sub3(pd, pa), sub3(pb, pa));
                const l = Math.hypot(nr[0], nr[1], nr[2]) || 1;
                const nn = [nr[0] / l, nr[1] / l, nr[2] / l];
                const wet = wetTri(i, j, ku, kv, up);
                const slot: Exclude<TerrainSlot, 'water'> = wet ? 'seabed' : touchesWater(a) || touchesWater(b) || touchesWater(d) ? 'shore' : nn[1] < cosSlope ? 'slope' : 'ground';
                const s = ch.slots[slot];
                s.pos.push(...pa, ...pd, ...pb);
                s.nrm.push(...nn, ...nn, ...nn);
                const sh = hash01(ex.seed, i * n + ku, j * n + kv, up ? 1 : 0);
                s.shade.push(sh < 0.3 ? 0 : sh < 0.75 ? 1 : 2);
                colIdx.push(a, d, b);
                grow(pa);
        grow(pb);
        grow(pd);
                if (wet) {
                  const L = ex.level;
                  ch.water.pos.push(pa[0], L, pa[2], pd[0], L, pd[2], pb[0], L, pb[2]);
                  ch.water.nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
                  grow([pa[0], L, pa[2]]);
                }
              }
        }
      chunks.push(ch);
    }

  // Skirt: walls from the outer edge down to -skirt, facing out (in the chunk that owns the edge tile).
  if (ex.skirt > 0) {
    const bottom = -ex.skirt;
    const chunkOf = (i: number, j: number) => chunks[Math.floor(j / ex.chunk) * nCh + Math.floor(i / ex.chunk)];
    const wall = (va: number, vb: number, out: number[], i: number, j: number) => {
      const a = P(va), b = P(vb);
      const a2 = [a[0], Math.min(bottom, a[1]), a[2]], b2 = [b[0], Math.min(bottom, b[1]), b[2]];
      const s = chunkOf(i, j).slots.skirt;
      for (const [p, q, r] of [[a, a2, b2], [a, b2, b]]) {
        const nr = cross3(sub3(q, p), sub3(r, p));
        const flip = nr[0] * out[0] + nr[2] * out[2] < 0;
        const tri = flip ? [p, r, q] : [p, q, r];
        if (Math.hypot(nr[0], nr[1], nr[2]) < 1e-9) continue;
        s.pos.push(...tri[0], ...tri[1], ...tri[2]);
        s.nrm.push(...out, ...out, ...out);
        s.shade.push(1);
      }
      grow(a2);
      grow(b2);
    };
    for (let gi = 0; gi + 1 < VC; gi++) {
      wall(gi, gi + 1, [0, 0, -1], Math.floor(gi / n), 0);
      wall((VR - 1) * VC + gi, (VR - 1) * VC + gi + 1, [0, 0, 1], Math.floor(gi / n), rows - 1);
    }
    for (let gj = 0; gj + 1 < VR; gj++) {
      wall(gj * VC, (gj + 1) * VC, [-1, 0, 0], 0, Math.floor(gj / n));
      wall(gj * VC + VC - 1, (gj + 1) * VC + VC - 1, [1, 0, 0], cols - 1, Math.floor(gj / n));
    }
  }

  // The collider: every ground triangle, welded on the vertex grid (the water surface is not in it).
  const used = new Int32Array(VC * VR).fill(-1);
  const cpos: number[] = [], cidx: number[] = [];
  for (const v of colIdx) {
    if (used[v] < 0) {
      used[v] = cpos.length / 3;
      cpos.push(...P(v));
    }
    cidx.push(used[v]);
  }

  // Scatter: per item and tile, a seeded count of spots; each on a dry triangle, not too steep, not on a cleared tile.
  const spots: TerrainSpot[] = [];
  const surface = (x: number, z: number) => {
    const fu = (x / c + 0.5) * n, fv = (z / c) * n;
    const gi = Math.min(VC - 2, Math.max(0, Math.floor(fu))), gj = Math.min(VR - 2, Math.max(0, Math.floor(fv)));
    const i = Math.floor(gi / n), j = Math.floor(gj / n), ku = gi % n, kv = gj % n;
    const lu = fu - gi, lv = fv - gj;
    const upper = diag[j][i] === 'a' ? lv > lu : lu + lv > 1;
    const [a, b, d] = subTris(i, j, ku, kv)[upper ? 1 : 0];
    const pa = P(a), pb = P(b), pd = P(d);
    const nr = cross3(sub3(pd, pa), sub3(pb, pa));
    const l = Math.hypot(nr[0], nr[1], nr[2]) || 1;
    const nn = [nr[0] / l, nr[1] / l, nr[2] / l] as TerrainVec3;
    // The plane through the triangle at (x, z).
    const y = pa[1] - (nn[0] * (x - pa[0]) + nn[2] * (z - pa[2])) / nn[1];
    const wet = wetTri(i, j, ku, kv, upper);
    const shore = !wet && (touchesWater(a) || touchesWater(b) || touchesWater(d));
    return { y, n: nn, wet, shore };
  };
  ex.scatter.forEach((it, k) => {
    const cos = Math.cos((it.maxSlope * Math.PI) / 180);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        if (ex.clear.has(`${i},${j}`)) continue;
        const r = rng(Math.floor(hash01(ex.seed, k, i, j) * 4294967296));
        const count = Math.floor(it.density + r());
        for (let q = 0; q < count; q++) {
          const x = (i - 0.5 + r()) * c, z = (j + r()) * c;
          const yaw = r() * Math.PI * 2, sc = it.scale[0] + (it.scale[1] - it.scale[0]) * r();
          const s = surface(x, z);
          if (s.wet || s.n[1] < cos) continue;
          if (it.on === 'land' && s.shore) continue;
          if (it.on === 'shore' && !s.shore) continue;
          spots.push({ item: k, pos: [r4(x), r4(s.y), r4(z)], yaw: r4(yaw), scale: r4(sc), up: it.align ? (s.n.map(r4) as TerrainVec3) : [0, 1, 0] });
        }
      }
  });

  return { chunks, collider: { pos: cpos, idx: cidx }, spots, bounds: { min: lo, max: hi }, gridMin: [r4(-c / 2), 0], vertexHeights: vh, vertexCols: VC, waterTiles };
}
