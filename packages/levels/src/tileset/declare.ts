// Moved from the old generator's packages/shared/src/tileset/declare.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { normalizeLight, parseLight, type SpriteLight } from '@slop/sprites';
import { allMixesOn, distinctTerrains, isTerrainKind, mixMode, syncTiles, terrainIdFor, terrainPairs, terrainVariants, validateTileset } from './ops.js';
import {
  AUTO_MIX_TERRAINS, defaultTilesetBody, MIX_MODES, TERRAIN_COLORS, TERRAIN_KINDS, type TilesetMixes, type Terrain, type TerrainKind, type TerrainSource, type TilesetBody, type TilesetOrientation, type Wangset,
} from './types.js';

/**
 * Declared tilesets: the `tilesets` section of an apply file (`ssg sprite apply`, `ssg tileset apply`, MCP
 * `apply_tilesets`). A declaration is the whole truth about a tileset: terrains it doesn't list are removed, and
 * the pairs are exactly the ones listed. Applying the same declaration twice changes nothing, and tiles that stay
 * keep their ids (see syncTiles), so maps made with the tileset stay valid.
 *
 * ```json
 * "tilesets": [{
 *   "name": "temperate", "tile": "64x32", "metresPerTile": 1, "noisePeriod": 4, "variants": 2,
 *   "terrains": [
 *     { "name": "grass", "texture": "POLYGON_Generic_v3/Textures/Generic_Grass.png", "scale": 4 },
 *     { "name": "dirt", "color": "#8a6440", "noise": 0.5, "variants": 3 },
 *     { "name": "sand", "blend": ["grass", "dirt"] },
 *     { "name": "lake", "kind": "water", "blend": "grass" },          // water: shore by default ("shore": false to drop it)
 *     { "name": "rock_plateau", "kind": "rock", "cliff": true, "blend": "grass" }   // raised: cliffs (or "height": 1)
 *   ],
 *   "cliffHeight": 16,                       // optional: face height in pixels (default tileHeight / 2)
 *   "pairs": [["grass", "dirt"]],           // or "all"
 *   "mixes": "auto",                         // tiles where 3–4 terrains meet: auto (default), triples or pairs
 *   "light": "dusk"                          // optional: grade the ground like sprites with the same light (FB-060)
 * }]
 * ```
 */
export interface TerrainDecl {
  name: string;
  kind?: TerrainKind;
  /** Flat palette colour "#rrggbb" (default: the kind's colour). */
  color?: string;
  /** 0–1 noise on the palette colour. */
  noise?: number;
  /** A texture instead of a colour: a texture path inside the packs (see `ssg textures`), or an installed asset id. */
  texture?: string | number;
  /** Metres one repeat of the texture covers (a whole number of tiles; default one tile). */
  scale?: number;
  tint?: string;
  /** Random variants of this terrain's tiles. */
  variants?: number;
  /** Terrains to make transitions with (the same as listing the pairs). */
  blend?: string | string[];
  /** 1 = raised one level: cliffs where it meets ground terrains (`cliff: true` is the same). */
  height?: 0 | 1;
  /** Shore treatment where it meets another terrain (default: on for water). */
  shore?: boolean;
}

export interface TilesetDecl {
  name: string;
  /** "64x32" (2:1 iso diamond, the default) or "32x32" (square, orthogonal). */
  tile?: string;
  metresPerTile?: number;
  /** Period of the large-scale ground noise in tiles (default 4). */
  noisePeriod?: number;
  /** Default random variants per corner combination (a terrain's own `variants` wins; default 1). */
  variants?: number;
  terrains: TerrainDecl[];
  /** Terrain pairs that get transition tiles, or "all" for every pair. */
  pairs?: [string, string][] | 'all';
  /** Cliff face height in pixels for raised terrains (default tileHeight / 2). */
  cliffHeight?: number;
  /** Tiles where three or four terrains meet: 'auto' (default), 'triples' or 'pairs' (see TilesetBody.mixes). */
  mixes?: TilesetMixes;
  /** Lighting preset ("dusk") or { preset, ambient, … }, as a sprite's `light`: grades the ground to match. */
  light?: SpriteLight;
}

const TERRAIN_KEYS = new Set(['name', 'kind', 'color', 'colour', 'noise', 'texture', 'scale', 'tint', 'variants', 'blend', 'height', 'cliff', 'shore']);
const TILESET_KEYS = new Set(['name', 'tile', 'metresPerTile', 'metres-per-tile', 'noisePeriod', 'cliffHeight', 'mixes', 'light', 'variants', 'terrains', 'pairs', 'orientation', 'comment', 'description']);

/** Parse "64x32" → geometry. A 2:1 size is an iso diamond, a square is orthogonal. */
export function tileGeometry(tile: string): { orientation: TilesetOrientation; tileWidth: number; tileHeight: number } {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(tile).trim());
  if (!m) throw new Error(`tile "${tile}": use WxH, e.g. 64x32 (iso) or 32x32 (orthogonal)`);
  const w = Number(m[1]), h = Number(m[2]);
  if (w === 2 * h) return { orientation: 'isometric', tileWidth: w, tileHeight: h };
  if (w === h) return { orientation: 'orthogonal', tileWidth: w, tileHeight: h };
  throw new Error(`tile "${tile}": a 2:1 diamond (64x32) or a square (32x32)`);
}

/** Check a declaration's shape (keys, names, pairs) and give it in canonical spelling. File defaults (tile, metresPerTile) fill in. */
export function parseTilesetDecls(raw: unknown, defaults: { tile?: unknown; metresPerTile?: unknown; light?: unknown } = {}): TilesetDecl[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('"tilesets" must be a list of { name, terrains, pairs }.');
  const seen = new Set<string>();
  return raw.map((r, i) => {
    const where = `tilesets[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`${where} must be an object.`);
    const o = r as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!TILESET_KEYS.has(k)) throw new Error(`${where}: unknown key "${k}". Keys: ${[...TILESET_KEYS].filter((x) => !x.includes('-')).join(', ')}.`);
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) throw new Error(`${where}: give it a "name" (that is what the next run matches).`);
    if (seen.has(name.toLowerCase())) throw new Error(`Two tilesets are named "${name}".`);
    seen.add(name.toLowerCase());
    const at = `${where} (${name})`;
    if (!Array.isArray(o.terrains)) throw new Error(`${at}: needs "terrains": [ { "name": "grass" }, … ].`);
    const terrains = o.terrains.map((t, j) => {
      const tw = `${at} terrains[${j}]`;
      const x = typeof t === 'string' ? { name: t } : (t as Record<string, unknown>);
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`${tw} must be an object or a name.`);
      for (const k of Object.keys(x)) if (!TERRAIN_KEYS.has(k)) throw new Error(`${tw}: unknown key "${k}". Keys: ${[...TERRAIN_KEYS].filter((y) => y !== 'colour').join(', ')}.`);
      const tn = typeof x.name === 'string' ? x.name.trim() : '';
      if (!tn) throw new Error(`${tw}: a terrain needs a "name".`);
      if (x.kind !== undefined && !isTerrainKind(x.kind)) throw new Error(`${tw}: unknown kind "${x.kind}" (${TERRAIN_KINDS.join(', ')}).`);
      const color = (x.color ?? x.colour) as string | undefined;
      if (color !== undefined && x.texture !== undefined) throw new Error(`${tw}: a colour or a texture, not both.`);
      if (x.height !== undefined && x.height !== 0 && x.height !== 1) throw new Error(`${tw}: height must be 0 (ground) or 1 (raised).`);
      if (x.cliff !== undefined && typeof x.cliff !== 'boolean') throw new Error(`${tw}: cliff must be true or false.`);
      if (x.cliff !== undefined && x.height !== undefined && (x.cliff ? 1 : 0) !== x.height) throw new Error(`${tw}: cliff and height disagree.`);
      if (x.shore !== undefined && typeof x.shore !== 'boolean') throw new Error(`${tw}: shore must be true or false.`);
      const height = x.height ?? (x.cliff === undefined ? undefined : x.cliff ? 1 : 0);
      const blend = x.blend === undefined ? undefined : (Array.isArray(x.blend) ? x.blend : String(x.blend).split(',')).map((s) => String(s).trim()).filter(Boolean);
      const d: TerrainDecl = {
        name: tn,
        ...(x.kind !== undefined ? { kind: x.kind as TerrainKind } : {}),
        ...(color !== undefined ? { color: String(color) } : {}),
        ...(x.noise !== undefined ? { noise: Number(x.noise) } : {}),
        ...(x.texture !== undefined ? { texture: typeof x.texture === 'number' ? x.texture : String(x.texture) } : {}),
        ...(x.scale !== undefined ? { scale: Number(x.scale) } : {}),
        ...(x.tint !== undefined ? { tint: String(x.tint) } : {}),
        ...(x.variants !== undefined ? { variants: Number(x.variants) } : {}),
        ...(blend?.length ? { blend } : {}),
        ...(height ? { height: 1 as const } : {}),
        ...(x.shore !== undefined ? { shore: x.shore as boolean } : {}),
      };
      return d;
    });
    const names = new Set<string>();
    for (const t of terrains) {
      if (names.has(t.name.toLowerCase())) throw new Error(`${at}: two terrains are named "${t.name}".`);
      names.add(t.name.toLowerCase());
    }
    const known = (n: string, w: string) => {
      if (!names.has(n.toLowerCase())) throw new Error(`${at}: ${w} names terrain "${n}", which the tileset doesn't declare (${terrains.map((t) => t.name).join(', ')}).`);
    };
    let pairs: TilesetDecl['pairs'];
    if (o.pairs === 'all') pairs = 'all';
    else if (o.pairs !== undefined) {
      if (!Array.isArray(o.pairs)) throw new Error(`${at}: "pairs" must be [["grass", "dirt"], …] or "all".`);
      pairs = o.pairs.map((p, k) => {
        const pr = typeof p === 'string' ? p.split(/[,+]/) : p;
        if (!Array.isArray(pr) || pr.length !== 2) throw new Error(`${at}: pairs[${k}] must name two terrains.`);
        const [a, b] = pr.map((s) => String(s).trim());
        known(a, `pairs[${k}]`), known(b, `pairs[${k}]`);
        if (a.toLowerCase() === b.toLowerCase()) throw new Error(`${at}: pairs[${k}] needs two different terrains.`);
        return [a, b] as [string, string];
      });
    }
    for (const t of terrains) for (const b of t.blend ?? []) known(b, `terrain "${t.name}" blend`);
    if (o.mixes !== undefined && !(MIX_MODES as readonly unknown[]).includes(o.mixes)) throw new Error(`${at}: "mixes" must be ${MIX_MODES.map((m) => `"${m}"`).join(', ')}.`);
    const tile = o.tile ?? defaults.tile;
    let light: SpriteLight | null;
    try {
      light = parseLight(o.light ?? defaults.light, `${at}: light`);
    } catch (e) {
      throw new Error((e as Error).message);
    }
    const mpt = o.metresPerTile ?? o['metres-per-tile'] ?? defaults.metresPerTile;
    return {
      name,
      ...(tile !== undefined ? { tile: String(tile) } : {}),
      ...(mpt !== undefined ? { metresPerTile: Number(mpt) } : {}),
      ...(o.noisePeriod !== undefined ? { noisePeriod: Number(o.noisePeriod) } : {}),
      ...(o.cliffHeight !== undefined ? { cliffHeight: Number(o.cliffHeight) } : {}),
      ...(o.mixes !== undefined ? { mixes: o.mixes as TilesetMixes } : {}),
      ...(o.variants !== undefined ? { variants: Number(o.variants) } : {}),
      ...(light ? { light } : {}),
      terrains,
      ...(pairs !== undefined ? { pairs } : {}),
    };
  });
}

/** The pairs a declaration asks for (unordered, once each, by terrain name). */
export function declaredPairs(d: TilesetDecl): [string, string][] {
  const out: [string, string][] = [];
  const has = (a: string, b: string) => out.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (d.pairs === 'all') {
    for (let i = 0; i < d.terrains.length; i++) for (let j = i + 1; j < d.terrains.length; j++) out.push([d.terrains[i].name.toLowerCase(), d.terrains[j].name.toLowerCase()]);
    return out;
  }
  for (const t of d.terrains) for (const b of t.blend ?? []) if (!has(b.toLowerCase(), t.name.toLowerCase())) out.push([b.toLowerCase(), t.name.toLowerCase()]);
  for (const [a, b] of d.pairs ?? []) if (!has(a.toLowerCase(), b.toLowerCase())) out.push([a.toLowerCase(), b.toLowerCase()]);
  return out;
}

const sameSource = (a: TerrainSource, b: TerrainSource) =>
  a.type === 'texture' && b.type === 'texture' ? a.path === b.path && a.assetId === b.assetId : false;

/**
 * The body a declaration asks for, built on the existing tileset (null = a new one): terrains matched by name keep
 * their ids, tiles that stay keep their ids, everything else follows the declaration. Throws on an invalid result.
 */
export function declareTileset(existing: TilesetBody | null, d: TilesetDecl): TilesetBody {
  const base = existing ?? defaultTilesetBody(d.name);
  const geo = d.tile ? tileGeometry(d.tile) : {};
  const body: TilesetBody = { ...base, ...geo, name: d.name, ...(d.metresPerTile !== undefined ? { metresPerTile: d.metresPerTile } : {}) };
  if (d.noisePeriod !== undefined) body.noisePeriod = d.noisePeriod;
  else delete body.noisePeriod;
  if (d.cliffHeight !== undefined) body.cliffHeight = d.cliffHeight;
  else delete body.cliffHeight;
  if (d.mixes !== undefined) body.mixes = d.mixes;
  else delete body.mixes;
  const light = normalizeLight(d.light);
  if (light) body.light = light;
  else delete body.light;

  const terrains: Terrain[] = [];
  // Ids of terrains that exist (or existed) are not handed to new terrains, so no old tile changes meaning.
  const reserved = existing?.terrains.map((x) => x.id) ?? [];
  for (const t of d.terrains) {
    const old = existing?.terrains.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    const kind = t.kind ?? (isTerrainKind(t.name.toLowerCase()) ? (t.name.toLowerCase() as TerrainKind) : 'custom');
    let source: TerrainSource;
    if (t.texture !== undefined) {
      source = { type: 'texture', ...(typeof t.texture === 'number' ? { assetId: t.texture } : { path: t.texture }), ...(t.scale !== undefined ? { scale: t.scale } : {}) };
      // The server fills in the average colour when it finds the texture; keep it while the texture is the same.
      if (old && sameSource(old.source, source) && old.source.type === 'texture' && old.source.color) source.color = old.source.color;
    } else {
      if (t.scale !== undefined) throw new Error(`terrain "${t.name}": scale is for textures`);
      source = { type: 'palette', color: (t.color ?? TERRAIN_COLORS[kind]).toLowerCase(), ...(t.noise !== undefined ? { noise: t.noise } : {}) };
    }
    terrains.push({
      id: old?.id ?? terrainIdFor(t.name, [...reserved, ...terrains.map((x) => x.id)]),
      name: t.name, kind, source,
      ...(t.tint ? { tint: t.tint.toLowerCase() } : {}),
      ...(t.variants !== undefined ? { variants: t.variants } : {}),
      ...(t.height ? { height: t.height } : {}),
      ...(t.shore !== undefined ? { shore: t.shore } : {}),
    });
  }
  const idOf = (name: string) => terrains.find((x) => x.name.toLowerCase() === name.toLowerCase())!.id;
  const pairs = declaredPairs(d).map(([a, b]) => [idOf(a), idOf(b)] as [string, string]);
  const old = existing?.wangsets[0];
  const wangsets: Wangset[] = pairs.length || d.variants !== undefined || old
    ? [{ id: old?.id ?? 'ground', name: old?.name ?? 'ground', type: 'corner', pairs, variants: d.variants ?? 1 }]
    : [];
  // Mixes added on demand (the add-mixes fix) are the maps' business, not the declaration's: they stay while their
  // terrains do (and are not drawn with mixes "pairs").
  const ids = new Set(terrains.map((t) => t.id));
  const mixCorners = (base.mixCorners ?? []).filter((c) => c.every((x) => ids.has(x)));
  if (mixCorners.length) body.mixCorners = mixCorners;
  else delete body.mixCorners;
  // syncTiles drops the tiles of removed terrains and pairs (remembering their ids) and adds the missing ones.
  const next = syncTiles({ ...body, terrains, wangsets, tiles: base.tiles }).body;
  const errors = validateTileset(next);
  if (errors.length) throw new Error(`tileset "${d.name}": ${errors.join('; ')}`);
  return next;
}

/** JSON with object keys sorted, so two equal bodies compare equal whatever order their keys were written in. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v);

/** The parts of a body a declaration controls, for "unchanged" checks. */
export function declaredShape(b: TilesetBody) {
  return stable({
    orientation: b.orientation, tileWidth: b.tileWidth, tileHeight: b.tileHeight, metresPerTile: b.metresPerTile, noisePeriod: b.noisePeriod ?? null, cliffHeight: b.cliffHeight ?? null,
    mixes: b.mixes ?? null, mixCorners: b.mixCorners ?? null, light: normalizeLight(b.light), terrains: b.terrains, wangsets: b.wangsets, tiles: b.tiles,
  });
}

/**
 * FB-061: why applying a declaration changes a tileset, one line per cause, so a dry run never says "would update"
 * without a reason: settings that change, terrains and pairs added / removed / changed, and every tile added or
 * removed attributed to its cause (a new terrain or pair, variants, the mixes rule, mixes maps asked for, or tiles
 * that were missing). Empty when nothing a declaration controls changes. `d` (the declaration) lets it say whether
 * mixes was declared and that pairs is "all".
 */
export function tilesetChanges(existing: TilesetBody | null, next: TilesetBody, d?: Pick<TilesetDecl, 'mixes' | 'pairs'>): string[] {
  const nameOf = (id: string) => next.terrains.find((t) => t.id === id)?.name ?? existing?.terrains.find((t) => t.id === id)?.name ?? id;
  const n = (k: number, what: string) => `${k} ${what}${k === 1 ? '' : 's'}`;
  if (!existing) {
    const c = [0, 0, 0];
    for (const t of next.tiles) if (t.terrainCorners) c[Math.min(distinctTerrains(t.terrainCorners), 3) - 1]++;
    return [`new tileset: ${n(next.terrains.length, 'terrain')}, ${n(terrainPairs(next).length, 'pair')}; ${n(c[0], 'pure tile')}, ${n(c[1], 'pair tile')}, ${n(c[2], 'mix tile')}${c[2] ? ` (${mixRule(next, d)})` : ''}`];
  }
  const out: string[] = [];
  // Settings.
  const fmt = (v: unknown) => (v === undefined || v === null ? 'default' : String(v));
  for (const [k, label] of [['tileWidth', 'tile width'], ['tileHeight', 'tile height'], ['metresPerTile', 'metres per tile'], ['noisePeriod', 'noise period'], ['cliffHeight', 'cliff height']] as const)
    if ((existing[k] ?? null) !== (next[k] ?? null)) out.push(`${label}: ${fmt(existing[k])} → ${fmt(next[k])}`);
  if ((existing.mixes ?? null) !== (next.mixes ?? null))
    out.push(`mixes: ${existing.mixes ?? 'auto (the default)'} → ${next.mixes ?? `auto (the default${d?.mixes !== undefined ? ')' : ', not declared)'}`}`);
  const lightText = (l: unknown) => { const v = normalizeLight(l as SpriteLight | undefined); return !v ? 'day' : v.preset && Object.keys(v).length === 1 ? v.preset : stable(v); };
  if (lightText(existing.light) !== lightText(next.light)) out.push(`light: ${lightText(existing.light)} → ${lightText(next.light)} (every tile is regraded)`);
  // Terrains.
  const oldT = new Map(existing.terrains.map((t) => [t.id, t]));
  const newT = new Map(next.terrains.map((t) => [t.id, t]));
  for (const t of next.terrains) {
    const o = oldT.get(t.id);
    if (!o) continue;
    const changed = (['name', 'kind', 'source', 'tint', 'variants', 'height', 'shore'] as const).filter((k) => stable(o[k]) !== stable(t[k]));
    if (changed.length) out.push(`terrain ${t.name}: ${changed.map((k) => (k === 'source' ? (t.source.type === 'texture' ? 'texture' : 'colour') : k)).join(', ')} changed${changed.some((k) => k !== 'variants' && k !== 'name') ? ' (its tiles are redrawn, ids kept)' : ''}`);
  }
  // Tiles, by cause.
  const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const oldPairs = new Set(terrainPairs(existing).map(([a, b]) => pk(a, b)));
  const newPairs = new Set(terrainPairs(next).map(([a, b]) => pk(a, b)));
  const pairName = (key: string) => key.split('|').map(nameOf).join('↔');
  const oldMixAsked = new Set((existing.mixCorners ?? []).map((c) => c.join('|')));
  const newMixAsked = new Set((next.mixCorners ?? []).map((c) => c.join('|')));
  const edges = (c: readonly string[]) => [0, 1, 2, 3].map((i) => [c[i], c[(i + 1) % 4]]).filter(([a, b]) => a !== b).map(([a, b]) => pk(a, b));
  const varied = next.terrains.filter((t) => oldT.has(t.id) && terrainVariants(existing, t.id) !== terrainVariants(next, t.id)).map((t) => t.id);
  const cause = (c: readonly string[], adding: boolean): string => {
    const [from, to] = adding ? [oldT, newT] : [newT, oldT];
    const [pFrom, pTo] = adding ? [oldPairs, newPairs] : [newPairs, oldPairs];
    const ids = [...new Set(c)];
    const t = ids.find((id) => !from.has(id) && to.has(id));
    if (t) return `${adding ? 'new' : 'removed'} terrain ${nameOf(t)}`;
    const pair = edges(c).find((e) => !pFrom.has(e) && pTo.has(e));
    if (pair) return `${adding ? 'new' : 'removed'} pair ${pairName(pair)}`;
    if (ids.length <= 2 && ids.some((id) => varied.includes(id))) return `variants: ${varied.map((id) => `${nameOf(id)} ${terrainVariants(existing, id)} → ${terrainVariants(next, id)}`).join(', ')}`;
    if (ids.length >= 3) {
      const key = c.join('|');
      if (adding && newMixAsked.has(key) && !oldMixAsked.has(key)) return 'mixes maps asked for (add-mixes)';
      return `mix:${adding ? 'add' : 'remove'}`;
    }
    return adding ? 'missing' : 'no longer wanted';
  };
  const oldIds = new Set(existing.tiles.map((t) => t.id));
  const newIds = new Set(next.tiles.map((t) => t.id));
  // Per cause: how many tiles, and of them pure / pair / mix.
  const tally = (tiles: TilesetBody['tiles'], adding: boolean) => {
    const m = new Map<string, number[]>();
    for (const t of tiles) {
      if (!t.terrainCorners) continue;
      const why = cause(t.terrainCorners, adding);
      const c = m.get(why) ?? [0, 0, 0];
      c[Math.min(distinctTerrains(t.terrainCorners), 3) - 1]++;
      m.set(why, c);
    }
    return [...m].map(([why, c]) => {
      const k = c[0] + c[1] + c[2];
      const kinds = c.filter(Boolean).length > 1 ? ` (${[[c[0], 'pure'], [c[1], 'pair'], [c[2], 'mix']].filter(([x]) => x).map(([x, w]) => `${x} ${w}`).join(', ')})` : '';
      return [why, k, kinds] as const;
    });
  };
  const hadMixes = existing.tiles.some((t) => t.terrainCorners && distinctTerrains(t.terrainCorners) >= 3);
  for (const [why, k, kinds] of tally(next.tiles.filter((t) => !oldIds.has(t.id)), true)) {
    if (why === 'mix:add') out.push(`adds ${n(k, 'mix tile')} (corners where 3–4 terrains meet): ${mixRule(next, d)}${hadMixes || mixMode(next) !== 'auto' || d?.mixes !== undefined ? '' : '; the tileset had none yet (made before mixes "auto" became the default?)'}`);
    else if (why === 'missing') out.push(`adds ${n(k, 'tile')} the tileset was missing`);
    else out.push(`adds ${n(k, 'tile')}${kinds}: ${why}`);
  }
  for (const [why, k, kinds] of tally(existing.tiles.filter((t) => !newIds.has(t.id)), false)) {
    if (why === 'mix:remove') out.push(`removes ${n(k, 'mix tile')}: ${mixMode(next) === 'pairs' ? 'mixes "pairs" draws none' : 'mixes no longer draws them'}`);
    else out.push(`removes ${n(k, 'tile')}${kinds}: ${why}`);
  }
  return out;
}

/** What draws a tileset's 3–4-terrain mixes, in words. */
function mixRule(b: TilesetBody, d?: Pick<TilesetDecl, 'mixes' | 'pairs'>): string {
  const m = mixMode(b);
  const declared = d?.mixes !== undefined || b.mixes !== undefined;
  const all = d?.pairs === 'all' ? ', and pairs "all" blends every pair' : '';
  if (m === 'auto')
    return allMixesOn(b)
      ? `mixes "auto"${declared ? '' : ' (the default)'} draws every blended 3–4-terrain mix while a tileset has ${AUTO_MIX_TERRAINS} terrains or fewer (this one has ${b.terrains.length})${all}`
      : `mixes "auto"${declared ? '' : ' (the default)'} draws only the mixes maps asked for above ${AUTO_MIX_TERRAINS} terrains`;
  if (m === 'triples') return `mixes "triples" draws every blended 3–4-terrain mix${all}`;
  return 'mixes "pairs"';
}
