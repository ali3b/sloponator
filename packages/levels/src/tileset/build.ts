/**
 * Building a declared tileset into files, the Node replacement for the old `ssg sprite apply --download` tileset
 * path (packages/client/src/tilesetApply.ts + the server's tilesets.ts / tileRender.ts): declaration → body
 * (declareTileset, tile ids kept from the previous body) → texture terrains resolved and decoded → the atlas drawn
 * by the pure renderer → `<name>.png` + `<name>.tsj` (and `.tsx` on request).
 *
 * Where the previous body comes from. The old generator kept every tileset in its database, so a terrain added
 * later got new tile ids and the old ids stayed: maps made with the tileset stayed valid. Here the previous body is
 * read back from the Tiled file the last build wrote (`bodyFromTsj`): its wangsets list every corner tile's id and
 * corners, its colours the terrain ids, its tiles their variants. That is exactly the file a game's maps were made
 * against, so ids stay put as long as the game keeps that file (commit it, or keep the output folder).
 */
import fs from 'node:fs';
import path from 'node:path';
import { declareTileset, tilesetChanges, type TilesetDecl } from './declare.js';
import { encodePng } from './image.js';
import { cornersKey, distinctTerrains, isTerrainKind, mixCombos, type Corners } from './ops.js';
import { renderTilesetAtlas } from './raster.js';
import { tilesetFileName, writeTsj, writeTsx } from './tiled.js';
import { textureTerrains, type TextureRoots } from './textures.js';
import type { Terrain, TilePropertyValue, TilesetBody, TilesetTile, Wangset } from './types.js';

type TsjProp = { name: string; type?: string; value: TilePropertyValue };
interface Tsj {
  name: string;
  tilewidth: number;
  tileheight: number;
  grid?: { width: number; height: number; orientation: string };
  properties?: TsjProp[];
  tiles?: { id: number; properties?: TsjProp[]; objectgroup?: { objects: { name?: string; polygon?: { x: number; y: number }[] }[] } }[];
  wangsets?: { name: string; type: string; colors: { name: string; color: string; properties?: TsjProp[] }[]; wangtiles: { tileid: number; wangid: number[] }[] }[];
}

const propsOf = (p: TsjProp[] | undefined) => Object.fromEntries((p ?? []).map((x) => [x.name, x.value])) as Record<string, TilePropertyValue>;
/** Tile properties the writer adds itself (tiled.ts tileOut): not the tile's own. */
const DERIVED_TILE_PROPS = ['variant', 'cliff', 'elevation'];

/**
 * A tileset body read back from a `.tsj` this package (or the old generator) wrote: geometry, terrains (ids, names,
 * kinds, colours, height, shore), the corner tiles with their ids and variants, their own properties and collision,
 * the pairs, and the mixes asked for on demand. What the file does not carry (texture paths, tints, noise, light)
 * the declaration supplies again when it is applied on top (declareTileset).
 */
const fromFile = new WeakSet<TilesetBody>();

/**
 * A body read back from a `.tsj` with what the file cannot carry (texture sources, tints, per-terrain variants,
 * shore flags, mixes, light, a default noise period) taken from the next body, so a change report names only what
 * the file shows changed (tiles, terrains, pairs, geometry).
 */
function comparable(prev: TilesetBody, next: TilesetBody): TilesetBody {
  if (!fromFile.has(prev)) return prev;
  const byId = new Map(next.terrains.map((t) => [t.id, t]));
  const terrains = prev.terrains.map((t) => {
    const n = byId.get(t.id);
    if (!n) return t;
    const { tint: _t, variants: _v, shore: _s, ...rest } = t;
    return { ...rest, source: n.source, ...(n.tint ? { tint: n.tint } : {}), ...(n.variants !== undefined ? { variants: n.variants } : {}), ...(n.shore !== undefined ? { shore: n.shore } : {}) };
  });
  const out: TilesetBody = { ...prev, terrains, wangsets: prev.wangsets.map((w, i) => ({ ...w, variants: next.wangsets[i]?.variants ?? w.variants })) };
  for (const k of ['mixes', 'light'] as const) {
    if (next[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = next[k];
    else delete out[k];
  }
  if (next.noisePeriod === undefined && prev.noisePeriod === 4) delete out.noisePeriod;
  return out;
}

export function bodyFromTsj(tsj: Tsj): TilesetBody {
  const iso = tsj.grid?.orientation === 'isometric';
  const tileHeight = tsj.grid?.height ?? tsj.tileheight;
  const set = tsj.wangsets?.[0];
  const index = new Map<number, string>();
  const terrains: Terrain[] = (set?.colors ?? []).map((c, i) => {
    const p = propsOf(c.properties);
    const id = String(p.terrain ?? c.name);
    index.set(i + 1, id);
    const kind = isTerrainKind(p.kind) ? p.kind : 'custom';
    return { id, name: c.name, kind, source: { type: 'palette', color: c.color.toLowerCase() }, ...(p.height === 1 ? { height: 1 as const } : {}), ...(p.shore === true ? { shore: true } : {}) };
  });
  const extra = new Map((tsj.tiles ?? []).map((t) => [t.id, t]));
  const tiles: TilesetTile[] = (set?.wangtiles ?? []).map((w) => {
    const [, tr, , br, , bl, , tl] = w.wangid;
    const corners = [tl, tr, br, bl].map((k) => index.get(k) ?? '') as Corners;
    const x = extra.get(w.tileid);
    const p = propsOf(x?.properties);
    const own = Object.fromEntries(Object.entries(p).filter(([k]) => !DERIVED_TILE_PROPS.includes(k)));
    const collision = (x?.objectgroup?.objects ?? []).filter((o) => o.name !== 'cliff' && o.polygon?.length).map((o) => ({ ...(o.name ? { name: o.name } : {}), points: o.polygon!.map((q) => [q.x, q.y] as [number, number]) }));
    return { id: w.tileid, terrainCorners: corners, variant: typeof p.variant === 'number' ? p.variant : 0, properties: own, ...(collision.length ? { collision } : {}) };
  });
  tiles.sort((a, b) => a.id - b.id);
  const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairs = new Map<string, [string, string]>();
  for (const t of tiles) {
    const ids = [...new Set(t.terrainCorners!)];
    if (ids.length === 2) pairs.set(pk(ids[0], ids[1]), [ids[0], ids[1]]);
  }
  const variants = Math.max(1, ...tiles.map((t) => t.variant + 1));
  const wangsets: Wangset[] = pairs.size ? [{ id: 'ground', name: set?.name ?? 'ground', type: 'corner', pairs: [...pairs.values()], variants: Math.min(variants, 16) }] : [];
  const props = propsOf(tsj.properties);
  const body: TilesetBody = {
    name: tsj.name,
    orientation: iso ? 'isometric' : 'orthogonal',
    tileWidth: tsj.tilewidth,
    tileHeight,
    metresPerTile: typeof props.metresPerTile === 'number' ? props.metresPerTile : 1,
    ...(typeof props.noisePeriod === 'number' ? { noisePeriod: props.noisePeriod } : {}),
    ...(typeof props.cliffHeight === 'number' ? { cliffHeight: props.cliffHeight } : {}),
    terrains, wangsets, tiles,
    objects: typeof props.objects === 'string' ? JSON.parse(props.objects) : [],
  };
  // 3–4-terrain tiles the rules would not draw by themselves were asked for (the add-mixes fix): keep asking.
  const drawn = new Set(mixCombos({ ...body, mixes: 'triples' }).map(cornersKey));
  const asked = tiles.filter((t) => distinctTerrains(t.terrainCorners!) >= 3 && !drawn.has(cornersKey(t.terrainCorners!))).map((t) => t.terrainCorners!);
  if (asked.length) body.mixCorners = asked;
  fromFile.add(body);
  return body;
}

export type TiledTilesetFormat = 'tsj' | 'tsx';

export interface TilesetBuildOptions {
  /** Where the texture terrains' files are (the installed packs). Without it a texture terrain is an error. */
  textures?: TextureRoots;
  /** The body the tile ids are kept from (null: a new tileset). Default: none. See `bodyFromTsj`. */
  previous?: TilesetBody | null;
  /** Tiled files to write (default tsj). */
  formats?: TiledTilesetFormat[];
}

export interface BuiltTileset {
  name: string;
  body: TilesetBody;
  /** File name → bytes: `<file>.png` and `<file>.tsj` / `.tsx`. */
  files: Record<string, Uint8Array>;
  /** Base file name (tilesetFileName). */
  file: string;
  /** Why the tileset changed against the previous body (empty: unchanged), as the old apply reported it. */
  changes: string[];
  warnings: string[];
}

export class TilesetBuildError extends Error {}

/** One declared tileset → its files (nothing written). */
export function buildTileset(decl: TilesetDecl, o: TilesetBuildOptions = {}): BuiltTileset {
  let body: TilesetBody;
  try {
    body = declareTileset(o.previous ?? null, decl);
  } catch (e) {
    throw new TilesetBuildError((e as Error).message);
  }
  let textures = {};
  if (body.terrains.some((t) => t.source.type === 'texture')) {
    if (!o.textures) throw new TilesetBuildError(`tileset "${decl.name}": texture terrains need the installed packs (${body.terrains.filter((t) => t.source.type === 'texture').map((t) => t.name).join(', ')})`);
    const r = textureTerrains(o.textures, body);
    if (r.errors.length) throw new TilesetBuildError(`tileset "${decl.name}": ${r.errors.join('; ')}`);
    body = { ...body, terrains: r.terrains };
    textures = r.textures;
  }
  const atlas = renderTilesetAtlas(body, { textures });
  const file = tilesetFileName(body.name);
  const files: Record<string, Uint8Array> = { [`${file}.png`]: encodePng(atlas.image) };
  for (const f of o.formats ?? ['tsj']) files[`${file}.${f}`] = Buffer.from(f === 'tsj' ? writeTsj(body, { file }) : writeTsx(body, { file }));
  return { name: decl.name, body, files, file, changes: tilesetChanges(o.previous ? comparable(o.previous, body) : null, body, decl), warnings: atlas.warnings };
}

/** The previous body of a tileset from `<dir>/<file>.tsj`, when that file is there and reads. */
export function previousTileset(dir: string, name: string): TilesetBody | null {
  const f = path.join(dir, `${tilesetFileName(name)}.tsj`);
  if (!fs.existsSync(f)) return null;
  try {
    return bodyFromTsj(JSON.parse(fs.readFileSync(f, 'utf8')) as Tsj);
  } catch {
    return null;
  }
}
