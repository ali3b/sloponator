/**
 * The sprites a map can place, file-based: the `sprites` a game declares in its ssg.assets.json, each with an id,
 * its library model and what its built folder (`<out>/<name>/`, written by `slop build`) says about it: the export's
 * `object` block (footprint, facings, states, collision) and frames.
 *
 * The old generator kept these in its database (project sprites with ids, their newest export zip) and resolved the
 * `sprite` names in map ops on the server (apps/server/src/opSprites.ts, FB-032), read each placed sprite's object
 * block for the ops' footprints (maps.ts opsContext, objectBlockOf) and for the Tiled export (mapSprites.ts). This
 * module is those three, moved onto the declaration file and the built folders.
 *
 * Ids. A declared sprite's id is its position in `sprites` (1-based) unless the caller gives ids (`spriteIds`: the
 * old project's ids, so a map exported by the old generator compares equal). Maps keep ids only as a lookup key:
 * the `.map.json` and the Tiled export also carry the sprite's name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { footprintFromObject, type OpError, type OpsContext, type SpriteFootprint } from './ops.js';
import { readSheetFiles, pickFrame, type SheetInfo } from './sheet.js';
import { objectCollisionCells, resolvedObjectView, type MapSpriteInfo, type SpriteObjectBlock } from './tiled.js';
import type { CollisionPolygonOf } from './route.js';
import type { MapBody } from './types.js';

/** The old CLI's folder name for a sprite (`ssg sprite download`, `slop build`). */
export const spriteFolder = (s: string) => s.replace(/[^\w.\- ]+/g, '_').trim() || 'untitled';

export interface CatalogSprite {
  id: number;
  name: string;
  /** "Pack/Model" (the declaration's `asset`, normalised by the library when one is given). */
  asset: string | null;
  /** What its built folder holds (null: not built yet, or no folder). */
  sheet: SheetInfo | null;
}

export interface SpriteCatalog {
  sprites: CatalogSprite[];
  byId(id: number): CatalogSprite | undefined;
  /** A library model "Pack/Model" (or a bare model name) as "Pack/Model", for a free `assetRef`; null when unknown. */
  libraryModel(ref: string): string | null;
  /** The project's name in messages. */
  project: string;
}

export interface CatalogOptions {
  /** Where `slop build` wrote the sprites (`<out>/<name>/`). */
  out: string;
  /** Declared name → id (default: position in the list, 1-based). */
  spriteIds?: Record<string, number>;
  /** Pack/Model lookup in the library (default: the declaration's text as given; free asset refs then need "Pack/Model"). */
  libraryModel?: (ref: string) => string | null;
  project?: string;
}

/** The JSON files of a built sprite folder (frames and object block only need those). */
function sheetOf(dir: string): SheetInfo | null {
  if (!fs.existsSync(dir)) return null;
  const files = new Map<string, Uint8Array>();
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) files.set(f, fs.readFileSync(path.join(dir, f)));
  return files.size ? readSheetFiles(files) : null;
}

export function spriteCatalog(declared: { name: string; asset?: unknown }[], o: CatalogOptions): SpriteCatalog {
  const sprites = declared.map((s, i): CatalogSprite => {
    const id = o.spriteIds?.[s.name] ?? i + 1;
    const raw = typeof s.asset === 'string' ? s.asset : null;
    const asset = raw ? o.libraryModel?.(raw) ?? raw : null;
    return { id, name: s.name, asset, sheet: sheetOf(path.join(o.out, spriteFolder(s.name))) };
  });
  const ids = new Map(sprites.map((s) => [s.id, s]));
  return { sprites, byId: (id) => ids.get(id), libraryModel: o.libraryModel ?? ((r) => (r.includes('/') ? r : null)), project: o.project ?? 'the declaration file' };
}

// ------------------------------------------------------------------------------------------- name lookup

type Resolved = { spriteId: number } | { assetRef: string };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const stripVersion = (p: string) => p.toLowerCase().replace(/[_ ]?v?\d+$/, '');

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return prev[b.length];
}

/** Up to `n` names close to `query`: a typo or two, same start, containing it, shared words. */
export function closeNames(names: string[], query: string, n = 6): string[] {
  const q = norm(query);
  const qWords = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
  return [...new Set(names)]
    .map((name) => {
      const k = norm(name);
      const shared = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && qWords.has(w)).length;
      const d = distance(q, k);
      const score = Math.min(
        d <= Math.max(2, Math.floor(q.length / 3)) ? d * 0.3 : Infinity,
        q && (k.startsWith(q) || q.startsWith(k)) ? 0.7 : Infinity,
        q && (k.includes(q) || (k.length > 2 && q.includes(k))) ? 1 : Infinity,
        shared ? 4 - shared / 10 : Infinity,
      );
      return { name, score, d };
    })
    .filter((x) => x.score < Infinity)
    .sort((a, b) => a.score - b.score || a.d - b.d || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((x) => x.name);
}

/** Looks `sprite` references up in a catalogue: an id, a declared name, a model a declared sprite is made from, else (where allowed) a library model. */
export function resolveSprite(cat: SpriteCatalog, ref: unknown, allowAsset: boolean): Resolved {
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref)) throw new Error(`sprite ${ref} is not a sprite id or name`);
    return { spriteId: ref };
  }
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('sprite must be a sprite name (or id)');
  const want = ref.trim();
  if (/^\d+$/.test(want)) return { spriteId: Number(want) };
  const rows = cat.sprites;
  const byName = rows.find((s) => s.name.toLowerCase() === want.toLowerCase()) ?? rows.find((s) => norm(s.name) === norm(want));
  if (byName) return { spriteId: byName.id };
  const i = want.lastIndexOf('/');
  const pack = i > 0 ? want.slice(0, i).trim().toLowerCase() : null, model = (i > 0 ? want.slice(i + 1) : want).trim().toLowerCase();
  const byModel = rows.find((s) => {
    if (!s.asset) return false;
    const j = s.asset.lastIndexOf('/');
    const sp = j > 0 ? s.asset.slice(0, j).toLowerCase() : null, sm = (j > 0 ? s.asset.slice(j + 1) : s.asset).toLowerCase();
    return sm === model && (!pack || (sp !== null && (sp === pack || stripVersion(sp) === stripVersion(pack))));
  });
  if (byModel) return { spriteId: byModel.id };
  if (allowAsset) {
    const lib = cat.libraryModel(want);
    if (lib) return { assetRef: lib };
  }
  const names = closeNames([...rows.map((s) => s.name), ...(want.includes('/') ? rows.flatMap((s) => (s.asset ? [s.asset] : [])) : [])], want);
  throw new Error(
    `no sprite named "${want}" in ${cat.project}` +
      (want.includes('/') ? ` (and no ${allowAsset ? 'library model' : 'declared sprite of the model'} "${want}")` : '') +
      (names.length ? `; did you mean: ${names.join(', ')}?` : rows.length ? `; its sprites: ${rows.slice(0, 12).map((s) => s.name).join(', ')}${rows.length > 12 ? ', …' : ''}` : '; it declares no sprites'),
  );
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o: Obj) => o.sprite !== undefined && o.sprite !== null && o.sprite !== '';

function resolveOn(cat: SpriteCatalog, o: Obj, allowAsset: boolean, where = ''): Obj {
  if (!has(o)) return o;
  const { sprite, ...rest } = o;
  let got: Resolved;
  try {
    got = resolveSprite(cat, sprite, allowAsset);
  } catch (e) {
    throw new Error(`${where}${(e as Error).message}`);
  }
  if ('spriteId' in got) {
    if (rest.spriteId !== undefined && rest.spriteId !== got.spriteId) throw new Error(`${where}sprite "${String(sprite)}" is sprite ${got.spriteId} but spriteId says ${String(rest.spriteId)}; give one of them`);
    const { assetRef: _a, ...noRef } = rest;
    return { ...noRef, spriteId: got.spriteId };
  }
  if (rest.spriteId !== undefined) throw new Error(`${where}sprite "${String(sprite)}" is a library model, not sprite ${String(rest.spriteId)}; give one of them`);
  return { ...rest, assetRef: got.assetRef };
}

const resolveList = (cat: SpriteCatalog, list: unknown, what: string): unknown =>
  Array.isArray(list) ? list.map((o, i) => (isObj(o) ? resolveOn(cat, o, true, `${what}[${i}]: `) : o)) : list;

/** FB-059: a zone's vehicle (`vehicle`, else `properties.vehicle`) given by name → `vehicleId`. */
function zoneVehicle(cat: SpriteCatalog, op: Obj): Obj {
  const props = isObj(op.properties) ? op.properties : undefined;
  const fromProps = op.vehicle === undefined && op.vehicleId === undefined && props?.vehicle !== undefined;
  const ref = fromProps ? props!.vehicle : op.vehicle;
  if (ref === undefined || ref === null) return op;
  let got: Resolved;
  try {
    got = resolveSprite(cat, ref, false);
  } catch (e) {
    throw new Error(`vehicle: ${(e as Error).message}`);
  }
  if (!('spriteId' in got)) throw new Error(`vehicle "${String(ref)}" is not a declared sprite`);
  if (op.vehicleId !== undefined && op.vehicleId !== null && op.vehicleId !== got.spriteId) throw new Error(`vehicle "${String(ref)}" is sprite ${got.spriteId} but vehicleId says ${String(op.vehicleId)}; give one of them`);
  const { vehicle: _v, ...rest } = op;
  if (fromProps) {
    const { vehicle: _pv, ...p } = props!;
    return { ...rest, properties: p, vehicleId: got.spriteId };
  }
  return { ...rest, vehicleId: got.spriteId };
}

function namesSprite(op: Obj): boolean {
  if ((op.op === 'addZone' || op.op === 'editZone') && ((op.vehicle !== undefined && op.vehicle !== null) || (isObj(op.properties) && op.properties.vehicle !== undefined && op.vehicleId === undefined))) return true;
  if (has(op)) return true;
  return [op.objects, isObj(op.stamp) ? (op.stamp as Obj).objects : undefined].some((l) => Array.isArray(l) && l.some((o) => isObj(o) && has(o)));
}

/**
 * The `sprite` references in a list of ops → spriteId / assetRef (FB-032): place, fence and move (`sprite`), scatter
 * (`sprite`, `objects[].sprite`), path (`objects[].sprite`), an inline stamp (`stamp.objects[].sprite`), a zone's
 * vehicle. One error per op whose reference names nothing; that op is returned as given.
 */
export function resolveOpSprites(cat: SpriteCatalog, ops: unknown[]): { ops: unknown[]; errors: OpError[] } {
  const errors: OpError[] = [];
  const out = ops.map((op, index) => {
    if (!isObj(op) || !namesSprite(op)) return op;
    try {
      switch (op.op) {
        case 'place':
        case 'fence':
          return resolveOn(cat, op, true);
        case 'move':
          return resolveOn(cat, op, false);
        case 'scatter': {
          const top = resolveOn(cat, op, true);
          return Array.isArray(top.objects) ? { ...top, objects: resolveList(cat, top.objects, 'objects') } : top;
        }
        case 'path':
          return { ...op, objects: resolveList(cat, op.objects, 'objects') };
        case 'addZone':
        case 'editZone':
          return zoneVehicle(cat, op);
        case 'stamp':
          return isObj(op.stamp) ? { ...op, stamp: { ...op.stamp, objects: resolveList(cat, op.stamp.objects, 'stamp.objects') } } : op;
        default:
          return op;
      }
    } catch (e) {
      errors.push({ index, op: typeof op.op === 'string' ? op.op : '?', message: (e as Error).message });
      return op;
    }
  });
  return { ops: out, errors };
}

// ----------------------------------------------------------------------------------------- ops context

/** The object block a map uses (the export's, without its per-column slices and its note). */
const blockOf = (s: CatalogSprite | undefined): SpriteObjectBlock | null => {
  const o = s?.sheet?.object as (Record<string, unknown> & SpriteObjectBlock) | null | undefined;
  if (!o) return null;
  const { slices: _s, note: _n, ...rest } = o;
  return rest as SpriteObjectBlock;
};

/** FB-125: placed objects' ground collision polygons (map cells around their anchors), as the Tiled export writes them. */
export function collisionPolygons(cat: SpriteCatalog, doc: Pick<MapBody, 'metresPerTile' | 'orientation'>): CollisionPolygonOf {
  return (obj) => {
    if (obj.spriteId === undefined || obj.collision === false) return null;
    const s = cat.byId(obj.spriteId);
    const block = blockOf(s);
    if (!block) return null;
    return objectCollisionCells(block, doc.metresPerTile, resolvedObjectView(obj, spriteInfo(s!)), doc.orientation);
  };
}

/**
 * The ops' context (the old server's opsContext): every declared sprite's footprint on this map (null when it has
 * no object block: it places as a point), their names, the map's tilesets' terrains, the stamps saved so far and the
 * collision polygons for route clearances.
 */
export function opsContext(cat: SpriteCatalog, doc: MapBody, o: { tilesets: OpsContext['tilesets']; stamps?: OpsContext['stamps'] }): OpsContext {
  const sprites: Record<number, SpriteFootprint | null> = {};
  const spriteNames: Record<number, string> = {};
  for (const s of cat.sprites) {
    const block = s.sheet?.object;
    sprites[s.id] = block ? footprintFromObject(block, doc.metresPerTile, s.name) : null;
    spriteNames[s.id] = s.name;
  }
  return { sprites, spriteNames, tilesets: o.tilesets, ...(o.stamps ? { stamps: o.stamps } : {}), collisionPolygon: collisionPolygons(cat, doc) };
}

/** What the Tiled export says about a placed sprite (mapSprites.ts): name, folder, model, object block, still clip. */
export function spriteInfo(s: CatalogSprite): MapSpriteInfo {
  const block = blockOf(s);
  const states = (s.sheet?.object?.states ?? []).map((x) => x.name);
  const still = states[0] ?? (s.sheet ? pickFrame(s.sheet)?.clip : undefined);
  return { name: s.name, exportName: spriteFolder(s.name), ...(s.asset ? { asset: s.asset } : {}), object: block, ...(still ? { stillClip: still } : {}) };
}

/** The placed (and zone vehicle) sprites of a map, for the writer, and a warning per sprite that has no built folder. */
export function mapSpriteInfos(cat: SpriteCatalog, doc: MapBody): { sprites: Record<number, MapSpriteInfo>; warnings: string[] } {
  const ids = new Set<number>();
  for (const l of doc.layers) {
    if (l.type === 'objects') for (const ob of l.objects) if (ob.spriteId !== undefined) ids.add(ob.spriteId);
    if (l.type === 'zones') for (const z of l.zones) if (z.vehicle) ids.add(z.vehicle.spriteId);
  }
  const sprites: Record<number, MapSpriteInfo> = {};
  const warnings: string[] = [];
  for (const id of ids) {
    const s = cat.byId(id);
    if (!s) {
      warnings.push(`sprite ${id} is not declared`);
      continue;
    }
    if (!s.sheet) warnings.push(`${s.name} has no built folder: its objects get no facing, state or collision`);
    sprites[id] = spriteInfo(s);
  }
  return { sprites, warnings };
}

