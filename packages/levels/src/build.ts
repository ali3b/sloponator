/**
 * `buildLevels(file, { out })`: the `tilesets` and `maps` sections of a game's ssg.assets.json → files, the level
 * half of `slop build` (ali3b/sloponator#17). It writes what the old pipeline wrote for the same file:
 *
 * - every tileset to `<out>/tilesets/<name>/<name>.png` + `.tsj` (the old `ssg sprite apply --download`);
 * - every map entry replayed from scratch from its op list and, with `export`, written as the old
 *   `ssg map export <map> -f tmj --embed -o <export>` did (Solitary Strike's scripts/build-maps.mjs): the folder
 *   emptied, `<map>.tmj` with the tilesets embedded and each tileset's atlas `<tileset>.png` next to it;
 * - `stamps` cut from a map after its ops, for the maps after it (`stamp` ops name them);
 * - with `map`, the map document (`ssg-map/1`) written to that path, the file a game keeps; an entry with `map` and
 *   no `ops` is read from it instead (edit it by hand or with the ops API, export it here).
 *
 * Paths in the file (ops, map, export) are relative to the file's folder, as the old scripts read them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z, validate, formatErrors, type AssetsFile, assetsFile } from '@slop/schema';
import { openLibrary, type Library } from '@slop/library';
import { parseTilesetDecls, declareTileset, type TilesetDecl } from './tileset/declare.js';
import { buildTileset, previousTileset, type BuiltTileset } from './tileset/build.js';
import { textureTerrains, type TextureRoots } from './tileset/textures.js';
import { tilesetFileName } from './tileset/tiled.js';
import type { TilesetBody } from './tileset/types.js';
import { createMap, exportMap, parseSize, readMapFile, replayOps, stampFromMap, writeMapFile, type MapFile, type MapFormat } from './map/file.js';
import { spriteCatalog, spriteFolder, type SpriteCatalog } from './map/sprites.js';
import { STAMP_LAYERS, type MapStamp } from './map/stamp.js';
import { OBJECT_DATA_MODES } from './map/tiled.js';

export const OLD_DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? path.join(process.env.HOME ?? '.', 'projects/synty-sprite-generator/data');

/** One entry of `maps` (what Solitary Strike's ssg.assets.json declares, plus the file-based `map`). */
export const mapEntry = z.strictObject({
  name: z.string().min(1),
  /** "WxH" cells (a new map; default: the `map` document's). */
  size: z.string().regex(/^\d+\s*[x×]\s*\d+$/i, 'is WxH cells: "128x256"').optional(),
  /** The ground tileset (a declared tileset's name), or several in slot order. */
  tileset: z.string().min(1).optional(),
  tilesets: z.array(z.string().min(1)).min(1).optional(),
  /** The ground of a new map before the ops (a terrain id or name; default the first terrain). */
  terrain: z.string().optional(),
  /** The op list: a JSON file (relative to ssg.assets.json) or the ops inline. Replayed onto a new, cleared map. */
  ops: z.union([z.string().min(1), z.array(z.unknown())]).optional(),
  /** The map document (`ssg-map/1`): written after the ops, or the map itself when there are none. */
  map: z.string().min(1).optional(),
  /** Stamps cut from the map after its ops, for later maps: rect [x0, y0, x1, y1] cells inclusive. */
  stamps: z.array(z.strictObject({ name: z.string().min(1), rect: z.tuple([z.number(), z.number(), z.number(), z.number()]), layers: z.array(z.enum(STAMP_LAYERS)).optional() })).optional(),
  /** The folder the Tiled map goes to (relative to ssg.assets.json), emptied first. */
  export: z.string().min(1).optional(),
  formats: z.array(z.enum(['tmj', 'tmx'])).min(1).optional(),
  /** Embed the tilesets in the map (default true: Phaser 3 reads only those); false writes `<tileset>.tsj` next to it. */
  embed: z.boolean().optional(),
  collisionShapes: z.boolean().optional(),
  objectData: z.enum(OBJECT_DATA_MODES as unknown as ['inline', 'shared']).optional(),
  comment: z.unknown().optional(),
  description: z.unknown().optional(),
});
export type MapEntry = z.infer<typeof mapEntry>;

export interface BuildLevelsOptions {
  /** Where the content pack goes (`<out>/tilesets/<name>/`), and where `slop build` wrote the sprites the maps place (`<out>/<sprite>/`). */
  out: string;
  /** Where `slop build` wrote the sprites the maps place (`<dir>/<sprite>/`); default `out`. */
  sprites?: string;
  /** Build only these tilesets and maps (by name). Maps that cut stamps are replayed anyway when a later one is built. */
  only?: string[];
  /** The old generator's data dir, for texture terrains (its packs) and library model names; default $SLOP_OLD_DATA_DIR. */
  dataDir?: string;
  /** A library already open (tests). */
  lib?: Library;
  /** Declared sprite name → id in the maps (default: position in `sprites`, 1-based). */
  spriteIds?: Record<string, number>;
  /** Progress lines (stderr). */
  log?: (m: string) => void;
}

export interface BuiltTilesetResult {
  name: string;
  dir: string;
  files: string[];
  tiles: number;
  /** What changed against the previous `.tsj` there (empty: unchanged; null: there was none). */
  changes: string[] | null;
  warnings: string[];
  ms: number;
}

export interface BuiltMapResult {
  name: string;
  size: string;
  tilesets: string[];
  ops: number;
  objects: number;
  zones: number;
  /** What the generator ops did (placed counts, skips), as the old `map edit` reported. */
  reports: Record<string, unknown>[];
  stamps: string[];
  /** The map document written (`map`), and the export's files. */
  document: string | null;
  files: string[];
  warnings: string[];
  ms: number;
}

export interface BuildLevelsResult {
  file: string;
  out: string;
  tilesets: BuiltTilesetResult[];
  maps: BuiltMapResult[];
  seconds: number;
}

export class LevelsError extends Error {}

/** The file's tilesets in the old canonical form, with the file's tile, metresPerTile and light as defaults. */
export function tilesetDeclsOf(raw: Record<string, unknown>): TilesetDecl[] {
  const defaults = (raw.defaults as Record<string, unknown> | undefined) ?? {};
  try {
    return parseTilesetDecls(raw.tilesets, { tile: raw.tile ?? defaults.tile, metresPerTile: raw.metresPerTile ?? raw['metres-per-tile'] ?? defaults.metresPerTile, light: raw.light ?? defaults.light });
  } catch (e) {
    throw new LevelsError((e as Error).message);
  }
}

/** The `maps` entries, checked (unknown keys, sizes, a tileset each, names unique). */
export function mapEntriesOf(raw: Record<string, unknown>, file: string, tilesets: string[]): MapEntry[] {
  if (raw.maps === undefined) return [];
  const r = validate(z.array(mapEntry), raw.maps);
  if (!r.ok) throw new LevelsError(formatErrors(r.errors, `${file} maps`));
  const seen = new Set<string>();
  for (const [i, m] of r.value.entries()) {
    const at = `maps[${i}] (${m.name})`;
    if (seen.has(m.name.toLowerCase())) throw new LevelsError(`${at}: two maps are named "${m.name}"`);
    seen.add(m.name.toLowerCase());
    if (m.tileset && m.tilesets) throw new LevelsError(`${at}: give tileset or tilesets, not both`);
    for (const t of m.tilesets ?? (m.tileset ? [m.tileset] : [])) if (!tilesets.some((x) => x.toLowerCase() === t.toLowerCase())) throw new LevelsError(`${at}: no tileset "${t}" in the file (tilesets: ${tilesets.join(', ') || 'none'})`);
    if (m.ops === undefined && m.map === undefined) throw new LevelsError(`${at}: give "ops" (an op list to replay) or "map" (a map document)`);
    if (m.ops !== undefined && !m.map && (!m.size || !(m.tileset || m.tilesets))) throw new LevelsError(`${at}: a map made from ops needs "size" and "tileset"`);
  }
  return r.value;
}

/** Write files into a folder (made if missing); returns the paths. */
function writeFiles(dir: string, files: Record<string, Uint8Array | string>): string[] {
  fs.mkdirSync(dir, { recursive: true });
  return Object.entries(files).map(([n, bytes]) => {
    const f = path.join(dir, n);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, bytes);
    return f;
  });
}

export async function buildLevels(file: string, opts: BuildLevelsOptions): Promise<BuildLevelsResult> {
  const t0 = performance.now();
  const log = opts.log ?? (() => undefined);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new LevelsError(`cannot read ${file}: ${(e as Error).message}`);
  }
  const checked = validate(assetsFile, raw);
  if (!checked.ok) throw new LevelsError(formatErrors(checked.errors, file));
  const declared: AssetsFile = checked.value;
  const root = path.dirname(path.resolve(file));
  const out = path.resolve(opts.out);
  const decls = tilesetDeclsOf(raw);
  const entries = mapEntriesOf(raw, file, decls.map((d) => d.name));
  const wanted = (n: string) => !opts.only?.length || opts.only.some((x) => x.toLowerCase() === n.toLowerCase());
  const unknown = (opts.only ?? []).filter((n) => !decls.some((d) => d.name.toLowerCase() === n.toLowerCase()) && !entries.some((m) => m.name.toLowerCase() === n.toLowerCase()));
  if (unknown.length && !(declared.sprites ?? []).some((s) => unknown.includes(s.name))) log(`levels: no tileset or map named ${unknown.join(', ')}`);

  // The library: only when a texture terrain or a map needs it (packs, model names).
  const dataDir = opts.dataDir ?? OLD_DATA_DIR;
  let lib: Library | null = opts.lib ?? null;
  let opened = false;
  const library = (): Library | null => {
    if (lib || opened) return lib;
    opened = true;
    if (fs.existsSync(path.join(dataDir, 'library.db'))) lib = openLibrary({ dataDir });
    return lib;
  };
  const roots = (): TextureRoots => {
    const l = library();
    return { packsDir: path.join(l?.dataDir ?? dataDir, 'packs'), packDirs: l ? l.packs().filter((p) => p.kind === 'models').map((p) => p.dir) : [] };
  };

  try {
    // ---- tilesets
    const bodies = new Map<string, TilesetBody>();
    const tilesets: BuiltTilesetResult[] = [];
    const tilesetDir = (name: string) => path.join(out, 'tilesets', spriteFolder(name));
    const needsTextures = (d: TilesetDecl) => d.terrains.some((t) => t.texture !== undefined);
    for (const d of decls) {
      if (!wanted(d.name)) continue;
      const t1 = performance.now();
      const dir = tilesetDir(d.name);
      const previous = previousTileset(dir, d.name);
      let b: BuiltTileset;
      try {
        b = buildTileset(d, { previous, ...(needsTextures(d) ? { textures: roots() } : {}) });
      } catch (e) {
        throw new LevelsError(`tileset ${d.name}: ${(e as Error).message}`);
      }
      bodies.set(d.name.toLowerCase(), b.body);
      const files = writeFiles(dir, b.files);
      const r: BuiltTilesetResult = { name: d.name, dir, files, tiles: b.body.tiles.length, changes: previous ? b.changes : null, warnings: b.warnings, ms: Math.round(performance.now() - t1) };
      tilesets.push(r);
      log(`tileset ${d.name}: ${r.tiles} tiles${previous ? (b.changes.length ? `, ${b.changes.join('; ')}` : ', unchanged') : ', new'} → ${path.relative(process.cwd(), dir) || '.'} (${(r.ms / 1000).toFixed(1)} s)${b.warnings.length ? ` warnings: ${b.warnings.join('; ')}` : ''}`);
    }
    /** A tileset's body for a map (declared on its previous ids, textures resolved) without writing it when it was not built. */
    const bodyOf = (name: string): TilesetBody => {
      const hit = bodies.get(name.toLowerCase());
      if (hit) return hit;
      const d = decls.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!d) throw new LevelsError(`no tileset "${name}" in the file`);
      let b = declareTileset(previousTileset(tilesetDir(d.name), d.name), d);
      if (needsTextures(d)) b = { ...b, terrains: textureTerrains(roots(), b).terrains };
      bodies.set(name.toLowerCase(), b);
      return b;
    };

    // ---- maps
    const maps: BuiltMapResult[] = [];
    if (entries.length) {
      const l = library();
      const catalog: SpriteCatalog = spriteCatalog(declared.sprites ?? [], {
        out: opts.sprites ? path.resolve(opts.sprites) : out, spriteIds: opts.spriteIds, project: declared.project !== undefined ? `project ${String(declared.project)}` : file,
        ...(l ? { libraryModel: (ref: string) => { const a = l.asset(ref); return a ? `${a.pack}/${a.name}` : null; } } : {}),
      });
      const stamps: Record<string, MapStamp> = {};
      // With `only`, the maps that cut stamps a wanted map comes after are replayed too (their stamps), not exported.
      const lastWanted = Math.max(-1, ...entries.map((m, i) => (wanted(m.name) ? i : -1)));
      for (const [i, m] of entries.entries()) {
        const want = wanted(m.name);
        if (!want && !(m.stamps?.length && i < lastWanted)) continue;
        const t1 = performance.now();
        const docPath = m.map ? path.resolve(root, m.map) : null;
        let map: MapFile;
        let ops: unknown[] = [];
        if (m.ops !== undefined) {
          if (typeof m.ops === 'string') {
            const f = path.resolve(root, m.ops);
            try {
              ops = JSON.parse(fs.readFileSync(f, 'utf8')) as unknown[];
            } catch (e) {
              throw new LevelsError(`map ${m.name}: cannot read its ops ${m.ops}: ${(e as Error).message}`);
            }
            if (!Array.isArray(ops)) throw new LevelsError(`map ${m.name}: ${m.ops} must hold a list of ops`);
          } else ops = m.ops;
          const names = m.tilesets ?? [m.tileset!];
          const [w, h] = parseSize(m.size!);
          map = createMap(m.name, { width: w, height: h, tilesets: names.map((n) => ({ name: decls.find((d) => d.name.toLowerCase() === n.toLowerCase())!.name, body: bodyOf(n) })), terrain: m.terrain });
          // A `clear` first, as the old build scripts did, so the result depends only on the op list and its seeds.
          if ((ops[0] as { op?: unknown } | undefined)?.op !== 'clear') ops = [{ op: 'clear' }, ...ops];
        } else {
          map = readMapFile(docPath!);
          if (map.name !== m.name) map = { ...map, name: m.name };
        }
        const ts = map.tilesets.map((n) => bodyOf(n));
        let reports: Record<string, unknown>[] = [];
        const warnings: string[] = [];
        if (ops.length) {
          const r = (() => {
            try {
              return replayOps(map, ops, { sprites: catalog, tilesets: ts, stamps });
            } catch (e) {
              throw new LevelsError((e as Error).message);
            }
          })();
          map = r.map;
          reports = r.reports.filter((x) => ['generate', 'path', 'scatter', 'stamp', 'fence'].includes(x.op));
          warnings.push(...r.warnings);
        }
        const cut: string[] = [];
        for (const s of m.stamps ?? []) {
          stamps[s.name.toLowerCase()] = stampFromMap(map, s.name, s.rect, s.layers);
          cut.push(s.name);
        }
        if (!want) {
          log(`map ${m.name}: replayed for its stamps (${cut.join(', ')})`);
          continue;
        }
        let document: string | null = null;
        if (docPath && ops.length) {
          fs.mkdirSync(path.dirname(docPath), { recursive: true });
          fs.writeFileSync(docPath, writeMapFile(map));
          document = docPath;
        }
        const files: string[] = [];
        if (m.export) {
          const dir = path.resolve(root, m.export);
          const embed = m.embed !== false;
          const e = exportMap(map, { tilesets: ts.map((body) => ({ body, file: tilesetFileName(body.name) })), sprites: catalog, formats: m.formats as MapFormat[] | undefined, embed, collisionShapes: m.collisionShapes, objectData: m.objectData });
          warnings.push(...e.warnings);
          // Empty the folder rather than delete it: a dev server watching it keeps track (build-maps.mjs).
          fs.mkdirSync(dir, { recursive: true });
          for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
          files.push(...writeFiles(dir, e.files));
          // Each tileset's atlas (and its Tiled file when not embedded) next to the map, from the tileset build's files.
          for (const [slot, ref] of e.tilesets.entries()) {
            if (!ref) continue;
            const built = buildTilesetFiles(ref.body, map.tilesets[slot], tilesetDir(map.tilesets[slot]), embed ? [] : (m.formats ?? ['tmj']).map((f) => (f === 'tmj' ? 'tsj' : 'tsx')), decls, roots);
            files.push(...writeFiles(dir, Object.fromEntries(Object.entries(built).map(([n, b]) => [n.replace(/^[^.]+/, ref.file), b]))));
          }
        }
        const layers = map.layers;
        const r: BuiltMapResult = {
          name: m.name, size: `${map.width}x${map.height}`, tilesets: map.tilesets, ops: ops.length,
          objects: layers.reduce((n, l) => n + (l.type === 'objects' ? l.objects.length : 0), 0), zones: layers.reduce((n, l) => n + (l.type === 'zones' ? l.zones.length : 0), 0),
          reports, stamps: cut, document, files, warnings, ms: Math.round(performance.now() - t1),
        };
        maps.push(r);
        log(`map ${m.name}: ${r.size}, ${r.ops} ops, ${r.objects} objects, ${r.zones} zones${cut.length ? `, stamps ${cut.join(', ')}` : ''}${files.length ? ` → ${path.relative(process.cwd(), path.dirname(files[0])) || '.'}` : ''} (${(r.ms / 1000).toFixed(1)} s)`);
        for (const x of reports) {
          const { index, op, ...rest } = x as { index: number; op: string };
          log(`  op ${index + 1} ${op}: ${JSON.stringify(rest).slice(0, 300)}`);
        }
        for (const w of warnings) log(`  warning: ${w}`);
      }
    }
    return { file, out, tilesets, maps, seconds: +((performance.now() - t0) / 1000).toFixed(1) };
  } finally {
    if (!opts.lib && lib) (lib as Library).close();
  }
}

/** A tileset's files for a map's folder: the ones this run wrote (or an earlier run left), else drawn now. */
function buildTilesetFiles(body: TilesetBody, name: string, dir: string, formats: ('tsj' | 'tsx')[], decls: TilesetDecl[], roots: () => TextureRoots): Record<string, Uint8Array> {
  const base = tilesetFileName(body.name);
  const want = [`${base}.png`, ...formats.map((f) => `${base}.${f}`)];
  if (want.every((f) => fs.existsSync(path.join(dir, f)))) {
    // Only when the tileset folder holds this very body (a build of this run, or one that is unchanged since).
    const prev = previousTileset(dir, name);
    if (prev && JSON.stringify(prev.tiles.map((t) => [t.id, t.terrainCorners, t.variant])) === JSON.stringify(body.tiles.map((t) => [t.id, t.terrainCorners, t.variant])))
      return Object.fromEntries(want.map((f) => [f, fs.readFileSync(path.join(dir, f))]));
  }
  const d = decls.find((x) => x.name.toLowerCase() === name.toLowerCase())!;
  return buildTileset(d, { previous: body, formats, ...(d.terrains.some((t) => t.texture !== undefined) ? { textures: roots() } : {}) }).files;
}
