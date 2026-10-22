/**
 * File-based maps. The old generator stored a map as a database row (MapBody JSON, a revision, an undo stack) and
 * every client edited it through the server. Here a map is a JSON document a game keeps in its repo,
 * `<name>.map.json` (`ssg-map/1`, schema in @slop/formats), and an edit is a list of the same plain ops replayed
 * onto it (`applyOps`). The repo's history is the undo stack.
 *
 * The document is the MapBody with one difference: `tilesets` names the tilesets (by their declared names) instead
 * of the old database ids; the ground layers' `tileset` is the slot in that list, as before, and decoration gids
 * keep their per-slot ranges (GID_STRIDE).
 */
import fs from 'node:fs';
import { applyOps, validateMap, type ApplyResult, type MapOp, type OpError, type OpsContext } from './ops.js';
import { defaultMapBody, type MapBody } from './types.js';
import type { MapStamp } from './stamp.js';
import { extractStamp, STAMP_LAYERS, validateStamp, type StampLayer } from './stamp.js';
import { mapFileName, tiledMapWarnings, writeTmj, writeTmx, type MapTilesetRef, type MapWriteOptions, type ObjectDataMode } from './tiled.js';
import { missingMixes, missingMixesMessage } from './resolve.js';
import { mapSpriteInfos, opsContext, resolveOpSprites, type SpriteCatalog } from './sprites.js';
import type { TilesetBody } from '../tileset/types.js';
import { tilesetFileName } from '../tileset/tiled.js';

export const MAP_SCHEMA = 'ssg-map/1';

/** A map document as a game keeps it (`<name>.map.json`). */
export interface MapFile extends Omit<MapBody, 'tilesets'> {
  schema: typeof MAP_SCHEMA;
  /** The tilesets by name, in slot order (slot i owns map gids 1 + i·GID_STRIDE …). */
  tilesets: string[];
}

/** The body the ops work on: tilesets become their slot numbers (the ops only count them). */
export function mapBodyOfFile(f: MapFile): MapBody {
  const { schema: _s, tilesets, ...rest } = f;
  return { ...rest, tilesets: tilesets.map((_, i) => i) };
}

/** The document of a body, its tilesets named. Key order is fixed, so an unchanged map writes the same bytes. */
export function mapFileOf(b: MapBody, tilesets: string[]): MapFile {
  return { schema: MAP_SCHEMA, name: b.name, orientation: b.orientation, width: b.width, height: b.height, tileWidth: b.tileWidth, tileHeight: b.tileHeight, metresPerTile: b.metresPerTile, tilesets: [...tilesets], layers: b.layers, properties: b.properties };
}

export class MapFileError extends Error {}

/** Read and check a `.map.json`. */
export function readMapFile(file: string): MapFile {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new MapFileError(`cannot read the map ${file}: ${(e as Error).message}`);
  }
  const f = data as MapFile;
  if (!f || typeof f !== 'object' || f.schema !== MAP_SCHEMA) throw new MapFileError(`${file} is not a map document (it needs "schema": "${MAP_SCHEMA}")`);
  if (!Array.isArray(f.tilesets) || f.tilesets.some((t) => typeof t !== 'string')) throw new MapFileError(`${file}: "tilesets" must name the tilesets (["temperate"])`);
  const errors = validateMap(mapBodyOfFile(f));
  if (errors.length) throw new MapFileError(`${file}: ${errors.slice(0, 10).join('; ')}${errors.length > 10 ? ` (and ${errors.length - 10} more)` : ''}`);
  return f;
}

/** The text of a map document: one JSON value per line for the big per-cell arrays would be unreadable; compact JSON with a trailing newline. */
export const writeMapFile = (f: MapFile): string => JSON.stringify(f) + '\n';

/** "128x256" → [128, 256]. */
export function parseSize(size: string): [number, number] {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(size).trim());
  if (!m) throw new MapFileError(`size "${size}": give it as WxH cells, e.g. "128x256"`);
  return [Number(m[1]), Number(m[2])];
}

/**
 * A new map (the old server's createMap): the size, and the first tileset's orientation, tile size and metres per
 * tile; the ground starts as `terrain` (an id or name; default the first tileset's first terrain).
 */
export function createMap(name: string, o: { width: number; height: number; tilesets: { name: string; body: TilesetBody }[]; terrain?: string; properties?: MapBody['properties'] }): MapFile {
  const first = o.tilesets[0]?.body;
  let terrain = first?.terrains[0]?.id ?? '';
  if (o.terrain !== undefined) {
    const t = first?.terrains.find((x) => x.id === o.terrain) ?? first?.terrains.find((x) => x.name.toLowerCase() === o.terrain!.toLowerCase());
    if (first && !t) throw new MapFileError(`no terrain "${o.terrain}" in tileset ${first.name} (terrains: ${first.terrains.map((x) => x.id).join(', ') || 'none'})`);
    terrain = t?.id ?? o.terrain;
  }
  const body = defaultMapBody(name, {
    width: o.width, height: o.height, orientation: first?.orientation, tileWidth: first?.tileWidth, tileHeight: first?.tileHeight, metresPerTile: first?.metresPerTile,
    tilesets: o.tilesets.map((_, i) => i), terrain, properties: o.properties ?? {},
  });
  const errors = validateMap(body);
  if (errors.length) throw new MapFileError(`map "${name}": ${errors.join('; ')}`);
  return mapFileOf(body, o.tilesets.map((t) => t.name));
}

export class MapOpsError extends Error {
  constructor(readonly map: string, readonly errors: OpError[]) {
    super(`map ${map}: nothing applied, ${errors.length} op${errors.length === 1 ? '' : 's'} failed:\n${errors.slice(0, 20).map((e) => `  op ${e.index + 1} (${e.op}): ${e.message}`).join('\n')}${errors.length > 20 ? `\n  … and ${errors.length - 20} more` : ''}`);
  }
}

export interface ReplayContext {
  /** The declared sprites (names → ids, footprints, object blocks). */
  sprites: SpriteCatalog;
  /** The map's tilesets' bodies by slot. */
  tilesets: TilesetBody[];
  /** Stamps saved so far, by lower-case name (the `stamp` op's names). */
  stamps?: Record<string, MapStamp>;
}

export interface ReplayResult extends Omit<ApplyResult, 'doc'> {
  map: MapFile;
  /** Ground cells the tilesets have no tile for, the fix in words (as the old map edit warned, FB-038), and the ops' own warnings. */
  warnings: string[];
}

/**
 * Apply ops to a map document, atomically: every op applies or nothing does (MapOpsError lists each failure). The
 * ops may name sprites (`sprite: "tree"`); they are looked up in the declared sprites first (FB-032).
 */
export function replayOps(map: MapFile, ops: unknown[], ctx: ReplayContext): ReplayResult {
  if (!Array.isArray(ops)) throw new MapFileError(`map ${map.name}: ops must be a list of { op, … }`);
  const named = resolveOpSprites(ctx.sprites, ops);
  if (named.errors.length) throw new MapOpsError(map.name, named.errors);
  const doc = mapBodyOfFile(map);
  const octx: OpsContext = opsContext(ctx.sprites, doc, { tilesets: ctx.tilesets, stamps: ctx.stamps });
  const res = applyOps(doc, named.ops as MapOp[], octx, { atomic: true });
  if (res.errors.length || (!res.applied && ops.length)) throw new MapOpsError(map.name, res.errors);
  const opWarnings = res.reports.flatMap((x) => (Array.isArray(x.warnings) ? (x.warnings as unknown[]).map((w) => `op ${x.index + 1} (${x.op}): ${String(w)}`) : []));
  const mix = missingMixes(res.doc, ctx.tilesets, { cap: 30 });
  const warnings = [...opWarnings, ...(mix.count ? [missingMixesMessage(mix, ctx.tilesets.map((t) => t.name))] : [])];
  const { doc: _d, ...rest } = res;
  return { ...rest, map: mapFileOf(res.doc, map.tilesets), warnings };
}

/** A stamp cut from a map (`rect` [x0, y0, x1, y1] cells inclusive; optional layers), checked. */
export function stampFromMap(map: MapFile, name: string, rect: [number, number, number, number], layers?: StampLayer[]): MapStamp {
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new MapFileError(`stamp ${name}: rect must be [x0, y0, x1, y1] (cells, inclusive)`);
  if (layers && (!Array.isArray(layers) || layers.some((l) => !STAMP_LAYERS.includes(l)))) throw new MapFileError(`stamp ${name}: layers must be some of ${STAMP_LAYERS.join(', ')}`);
  const s = extractStamp(mapBodyOfFile(map), rect, { name, layers });
  const errors = validateStamp(s);
  if (errors.length) throw new MapFileError(`stamp ${name}: ${errors.join('; ')}`);
  return s;
}

export type MapFormat = 'tmj' | 'tmx';

export interface MapExportOptions {
  /** The map's tilesets, by slot, with the file base name their Tiled file / atlas has. */
  tilesets: ({ body: TilesetBody; file?: string } | null)[];
  sprites: SpriteCatalog;
  formats?: MapFormat[];
  /** Embed the tilesets in the map (Phaser 3 reads only those). */
  embed?: boolean;
  /** Also write each object's collision polygon into an object layer "collision_shapes". */
  collisionShapes?: boolean;
  /** FB-066: 'shared' writes each sprite's data once in the map property spriteData. */
  objectData?: ObjectDataMode;
}

/** Unique file names for the tilesets (a slug of the name; a second one with the same slug gets its slot). */
function tilesetRefs(ts: MapExportOptions['tilesets']): (MapTilesetRef | null)[] {
  const used = new Set<string>();
  return ts.map((t, i) => {
    if (!t) return null;
    let file = t.file ?? tilesetFileName(t.body.name);
    if (used.has(file)) file = `${file}_${i}`;
    used.add(file);
    return { body: t.body, file };
  });
}

/**
 * The Tiled map file(s) of a document (the old `ssg map export`, without the image-collection `--tile-objects`):
 * `<map>.tmj` / `.tmx`, the tilesets external (`<tileset>.tsj` / `.tsx`, written by the tileset build) or embedded.
 * The names of the tileset files the map refers to come back in `tilesets` so the caller can put each tileset's
 * atlas (and, not embedded, its Tiled file) next to the map, as the old export did.
 */
export function exportMap(map: MapFile, o: MapExportOptions): { files: Record<string, string>; tilesets: (MapTilesetRef | null)[]; warnings: string[] } {
  const refs = tilesetRefs(o.tilesets);
  const body = mapBodyOfFile(map);
  const info = mapSpriteInfos(o.sprites, body);
  const opts: MapWriteOptions = { tilesets: refs, embed: o.embed, sprites: info.sprites, collisionShapes: o.collisionShapes, objectData: o.objectData };
  const base = mapFileName(map.name);
  const files: Record<string, string> = {};
  for (const f of o.formats ?? ['tmj']) files[`${base}.${f}`] = f === 'tmj' ? writeTmj(body, opts) : writeTmx(body, opts);
  const warnings = [...tiledMapWarnings(body, opts), ...info.warnings];
  o.tilesets.forEach((t, i) => {
    if (!t) warnings.push(`tileset ${map.tilesets[i]} (slot ${i}) is not declared`);
  });
  return { files, tilesets: refs, warnings };
}
