// Moved from the old generator's packages/shared/src/tileset/ops.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { LIGHT_PRESETS, parseLight } from '@slop/sprites';
import {
  AUTO_MIX_TERRAINS, MAX_VARIANTS, MIX_MODES, TERRAIN_COLORS, TERRAIN_KINDS, type Terrain, type TerrainKind, type TerrainSource, type TilesetBody, type TilesetTile, type Wangset,
} from './types.js';

/** Pure tileset edits: terrains, corner-Wang tile enumeration, tile ids and validation. Every op returns a new body. */

export type Corners = [string, string, string, string];

export const isTerrainKind = (k: unknown): k is TerrainKind => typeof k === 'string' && (TERRAIN_KINDS as readonly string[]).includes(k);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'terrain';

/** A terrain id from a name that no terrain in `taken` uses yet (grass, grass_2…). */
export function terrainIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slug(name);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Find a terrain by id or (case-insensitive) name. */
export function findTerrain(t: Pick<TilesetBody, 'terrains'>, ref: string): Terrain | undefined {
  return t.terrains.find((x) => x.id === ref) ?? t.terrains.find((x) => x.name.toLowerCase() === ref.toLowerCase());
}

export interface TerrainInput {
  name: string;
  kind?: TerrainKind;
  source?: TerrainSource;
  tint?: string;
  id?: string;
  variants?: number;
  /** 1 = a raised terrain (plateau): cliffs where it meets ground terrains. */
  height?: 0 | 1;
  /** Shore treatment (default: on for water). */
  shore?: boolean;
}

/** Add a terrain (and its pure tiles: all four corners this terrain, × its variants). The kind defaults from the name when it is one of the kinds, else 'custom'; the source to the kind's colour. */
export function addTerrain(body: TilesetBody, input: TerrainInput): { body: TilesetBody; terrain: Terrain; added: TilesetTile[] } {
  const name = input.name?.trim();
  if (!name) throw new Error('a terrain needs a name');
  const kind = input.kind ?? (isTerrainKind(name.toLowerCase()) ? (name.toLowerCase() as TerrainKind) : 'custom');
  if (!isTerrainKind(kind)) throw new Error(`unknown terrain kind "${kind}" (${TERRAIN_KINDS.join(', ')})`);
  if (input.id && body.terrains.some((t) => t.id === input.id)) throw new Error(`terrain id "${input.id}" is taken`);
  const terrain: Terrain = {
    id: input.id ?? terrainIdFor(name, body.terrains.map((t) => t.id)),
    name, kind,
    source: input.source ?? { type: 'palette', color: TERRAIN_COLORS[kind] },
    ...(input.tint ? { tint: input.tint } : {}),
    ...(input.variants !== undefined ? { variants: input.variants } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.shore !== undefined ? { shore: input.shore } : {}),
  };
  const next = { ...body, terrains: [...body.terrains, terrain] };
  const errors = validateTileset(next);
  if (errors.length) throw new Error(errors.join('; '));
  const r = syncTiles(next);
  return { body: r.body, terrain, added: r.added };
}

/** Remove a terrain with every tile that uses it and every wangset pair that names it. */
export function removeTerrain(body: TilesetBody, ref: string): TilesetBody {
  const t = findTerrain(body, ref);
  if (!t) throw new Error(`no terrain "${ref}"`);
  return {
    ...body,
    nextId: Math.max(body.nextId ?? 0, nextTileId(body.tiles)),
    terrains: body.terrains.filter((x) => x.id !== t.id),
    tiles: body.tiles.filter((x) => !x.terrainCorners?.includes(t.id)),
    ...(body.mixCorners ? { mixCorners: body.mixCorners.filter((c) => !c.includes(t.id)) } : {}),
    wangsets: body.wangsets.map((w) => ({ ...w, pairs: w.pairs.filter((p) => !p.includes(t.id)) })),
  };
}

/**
 * The 16 corner combinations of terrains a and b, in a fixed order: bit 0 = top-left, 1 = top-right,
 * 2 = bottom-right, 3 = bottom-left; a set bit means terrain b at that corner. Index 0 is all a, 15 all b.
 */
export function cornerCombos(a: string, b: string): Corners[] {
  return Array.from({ length: 16 }, (_, m) => [0, 1, 2, 3].map((bit) => ((m >> bit) & 1 ? b : a)) as Corners);
}

export const cornersKey = (c: Corners) => c.join('|');

/** Every distinct corner combination of a wangset (pure tiles shared between pairs appear once). */
export function wangCorners(w: Pick<Wangset, 'pairs'>): Corners[] {
  const seen = new Set<string>();
  const out: Corners[] = [];
  for (const [a, b] of w.pairs)
    for (const c of cornerCombos(a, b)) {
      const k = cornersKey(c);
      if (!seen.has(k)) seen.add(k), out.push(c);
    }
  return out;
}

/** The next free tile id (one past the highest; ids are never reused while the tileset lives). */
export function nextTileId(tiles: Pick<TilesetTile, 'id'>[]): number {
  return tiles.reduce((m, t) => Math.max(m, t.id + 1), 0);
}

/** Random variants of a terrain's tiles: its own, else the first wangset's, else 1. */
export function terrainVariants(body: Pick<TilesetBody, 'terrains' | 'wangsets'>, id: string): number {
  return body.terrains.find((t) => t.id === id)?.variants ?? body.wangsets[0]?.variants ?? 1;
}

/** Every terrain pair with transition tiles, unordered and once each (in the order the wangsets list them). */
export function terrainPairs(body: Pick<TilesetBody, 'wangsets'>): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const w of body.wangsets)
    for (const [a, b] of w.pairs) {
      const k = [a, b].sort().join('|');
      if (!seen.has(k)) seen.add(k), out.push([a, b]);
    }
  return out;
}

/** How a tileset draws cells where three or four terrains meet (its `mixes`, default 'auto'). */
export const mixMode = (b: Partial<Pick<TilesetBody, 'mixes'>>) => b.mixes ?? 'auto';

/** Whether every blended 3–4-terrain mix gets tiles: mixes 'triples', or 'auto' with at most AUTO_MIX_TERRAINS terrains. */
export function allMixesOn(b: Pick<TilesetBody, 'terrains'> & Partial<Pick<TilesetBody, 'mixes'>>): boolean {
  const m = mixMode(b);
  return m === 'triples' || (m === 'auto' && b.terrains.length <= AUTO_MIX_TERRAINS);
}

/** How many different terrains a corner combination has. */
export const distinctTerrains = (c: readonly string[]) => new Set(c).size;

/**
 * Every corner combination of three or four different terrains whose four edges are each one terrain or a blended
 * pair (FB-049): those are the mixes a map can need next to pair tiles, since a neighbour across an edge shares that
 * edge's two corners. Diagonal corners need no pair (they only meet inside the tile). In a fixed order (terrain
 * indices, lexicographic), so a terrain or pair added later only appends. 3 terrains blended pairwise give 36
 * combinations; each set of 4 blended pairwise adds 24 more.
 */
export function blendedMixCorners(body: Pick<TilesetBody, 'terrains' | 'wangsets'>): Corners[] {
  const ids = body.terrains.map((t) => t.id);
  const pairs = new Set(terrainPairs(body).map((p) => [...p].sort().join('|')));
  const ok = (a: string, b: string) => a === b || pairs.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  const out: Corners[] = [];
  for (const tl of ids)
    for (const tr of ids) {
      if (!ok(tl, tr)) continue;
      for (const br of ids) {
        if (!ok(tr, br)) continue;
        for (const bl of ids) {
          if (!ok(br, bl) || !ok(bl, tl)) continue;
          const c: Corners = [tl, tr, br, bl];
          if (distinctTerrains(c) >= 3) out.push(c);
        }
      }
    }
  return out;
}

/**
 * The 3–4-terrain combinations a tileset draws: every blended one when allMixesOn, plus the ones added on demand
 * (`mixCorners`); none with mixes 'pairs'.
 */
export function mixCombos(body: Pick<TilesetBody, 'terrains' | 'wangsets'> & Partial<Pick<TilesetBody, 'mixes' | 'mixCorners'>>): Corners[] {
  if (mixMode(body) === 'pairs') return [];
  const out = allMixesOn(body) ? blendedMixCorners(body) : [];
  const ids = new Set(body.terrains.map((t) => t.id));
  for (const c of body.mixCorners ?? []) if (c.length === 4 && c.every((x) => ids.has(x)) && distinctTerrains(c) >= 3) out.push([...c] as Corners);
  return out;
}

/**
 * Add tiles for 3–4-terrain corner combinations (the `add-mixes` fix, FB-049): each one the tileset doesn't draw
 * yet goes into `mixCorners` and gets its tile (appended, a new id). Combinations of fewer than three terrains, with
 * unknown terrains, or on a tileset whose mixes is 'pairs' are skipped with the reason.
 */
export function addMixCorners(body: TilesetBody, combos: readonly (readonly string[])[]): { body: TilesetBody; added: TilesetTile[]; mixes: Corners[]; skipped: { corners: string[]; reason: string }[] } {
  const skipped: { corners: string[]; reason: string }[] = [];
  const have = new Set(mixCombos(body).map(cornersKey));
  const fresh: Corners[] = [];
  for (const raw of combos) {
    if (raw.length !== 4) {
      skipped.push({ corners: [...raw], reason: 'a mix names four corner terrains' });
      continue;
    }
    const ids = raw.map((r) => findTerrain(body, r)?.id);
    const unknown = raw.filter((_, i) => !ids[i]);
    if (unknown.length) {
      skipped.push({ corners: [...raw], reason: `no terrain ${unknown.map((u) => `"${u}"`).join(', ')}` });
      continue;
    }
    const c = ids as Corners;
    if (distinctTerrains(c) < 3) {
      skipped.push({ corners: c, reason: 'fewer than three terrains: add the pair instead' });
      continue;
    }
    if (mixMode(body) === 'pairs') {
      skipped.push({ corners: c, reason: `tileset "${body.name}" has mixes "pairs" (set it to "auto" to draw cells where three terrains meet)` });
      continue;
    }
    const k = cornersKey(c);
    if (have.has(k)) continue;
    have.add(k);
    fresh.push(c);
  }
  const next = fresh.length ? { ...body, mixCorners: [...(body.mixCorners ?? []), ...fresh] } : body;
  const errors = validateTileset(next);
  if (errors.length) throw new Error(errors.join('; '));
  // Syncing also adds the tiles of mixes the tileset already draws but a body saved before them lacks.
  const r = syncTiles(next);
  return { body: r.body, added: r.added, mixes: fresh, skipped };
}

/**
 * The `add-mixes` fix on one tileset: add the terrain pairs (two-terrain cells) and then the 3–4-terrain mixes a
 * map's cells need. Returns the new body, what was added and what was skipped (with why).
 */
export function addPairsAndMixes(body: TilesetBody, pairs: readonly (readonly [string, string])[], mixes: readonly (readonly string[])[]) {
  let b = body;
  const addedPairs: { pair: [string, string]; tiles: number }[] = [];
  for (const [x, y] of pairs) {
    const r = addTerrainPair(b, x, y);
    b = r.body;
    if (r.added.length) addedPairs.push({ pair: [x, y], tiles: r.added.length });
  }
  const m = addMixCorners(b, mixes);
  const tilesAdded = addedPairs.reduce((n, p) => n + p.tiles, 0) + m.added.length;
  return { body: m.body, pairs: addedPairs, mixes: m.mixes, mixTiles: m.added.length, tilesAdded, skipped: m.skipped };
}

/**
 * The tiles a tileset should have, in a fixed order: every terrain's pure tile (all four corners that terrain) ×
 * its variants, then the 14 mixed corner combinations of every pair × the larger variant count of the two, then the
 * 3–4-terrain mixes (mixCombos), one variant each.
 */
export function wantedTiles(body: Pick<TilesetBody, 'terrains' | 'wangsets'> & Partial<Pick<TilesetBody, 'mixes' | 'mixCorners'>>): { corners: Corners; variant: number }[] {
  const out: { corners: Corners; variant: number }[] = [];
  const seen = new Set<string>();
  const push = (c: Corners, n: number) => {
    for (let v = 0; v < n; v++) {
      const k = `${cornersKey(c)}#${v}`;
      if (!seen.has(k)) seen.add(k), out.push({ corners: [...c] as Corners, variant: v });
    }
  };
  for (const t of body.terrains) push([t.id, t.id, t.id, t.id], terrainVariants(body, t.id));
  for (const [a, b] of terrainPairs(body)) {
    const n = Math.max(terrainVariants(body, a), terrainVariants(body, b));
    for (const c of cornerCombos(a, b).slice(1, 15)) push(c, n);
  }
  for (const c of mixCombos(body)) push(c, 1);
  return out;
}

/**
 * Make the tiles match the terrains and pairs: tiles that are still wanted keep their ids (and properties,
 * collision); tiles no longer wanted (a removed terrain or pair, fewer variants) are dropped; missing ones are
 * appended with new ids past the highest. Existing tiles are never renumbered, so maps that use them stay valid.
 */
export function syncTiles(body: TilesetBody): { body: TilesetBody; added: TilesetTile[]; removed: TilesetTile[] } {
  const want = wantedTiles(body);
  const wantKeys = new Set(want.map((w) => `${cornersKey(w.corners)}#${w.variant}`));
  const key = (t: TilesetTile) => `${cornersKey(t.terrainCorners!)}#${t.variant}`;
  const kept: TilesetTile[] = [], removed: TilesetTile[] = [];
  const have = new Set<string>();
  // With mixes 'auto', a sixth terrain turns the all-mixes rule off; the blended mixes that already have tiles keep
  // them (maps may use them). Removing a terrain or one of a mix's edge pairs still drops it.
  const keepBlended = mixMode(body) === 'auto' && !allMixesOn(body) && body.tiles.some((t) => t.terrainCorners && distinctTerrains(t.terrainCorners) >= 3)
    ? new Set(blendedMixCorners(body).map(cornersKey)) : null;
  const autoKeep = (t: TilesetTile) => !!keepBlended?.has(cornersKey(t.terrainCorners!));
  for (const t of body.tiles) {
    if (!t.terrainCorners) kept.push(t);
    else if ((wantKeys.has(key(t)) || autoKeep(t)) && !have.has(key(t))) kept.push(t), have.add(key(t));
    else removed.push(t);
  }
  let id = Math.max(body.nextId ?? 0, nextTileId(body.tiles));
  const added: TilesetTile[] = [];
  for (const w of want) if (!have.has(`${cornersKey(w.corners)}#${w.variant}`)) added.push({ id: id++, terrainCorners: w.corners, variant: w.variant, properties: {} });
  if (!added.length && !removed.length) return { body, added, removed };
  // Remember the high-water mark once tiles were dropped, so their ids are never handed out again.
  const nextId = removed.length || body.nextId !== undefined ? { nextId: id } : {};
  return { body: { ...body, ...nextId, tiles: [...kept, ...added] }, added, removed };
}

/** Add the tiles a wangset needs (see syncTiles: existing tiles and their pictures are kept). */
export function expandWangTiles(body: TilesetBody, wangsetId: string): { body: TilesetBody; added: TilesetTile[] } {
  if (!body.wangsets.some((x) => x.id === wangsetId)) throw new Error(`no wangset "${wangsetId}"`);
  const r = syncTiles(body);
  return { body: r.body, added: r.added };
}

/** Add (or extend) a corner wangset over terrain pairs and add their tiles. A pair is unordered: [a, b] = [b, a]. */
export function addWangset(body: TilesetBody, w: { id?: string; name?: string; pairs: [string, string][]; variants?: number }): { body: TilesetBody; wangset: Wangset; added: TilesetTile[] } {
  const pairs = w.pairs.map(([a, b]) => {
    const ta = findTerrain(body, a), tb = findTerrain(body, b);
    if (!ta) throw new Error(`no terrain "${a}"`);
    if (!tb) throw new Error(`no terrain "${b}"`);
    if (ta.id === tb.id) throw new Error(`a pair needs two different terrains ("${a}")`);
    return [ta.id, tb.id] as [string, string];
  });
  const id = w.id ?? body.wangsets[0]?.id ?? 'ground';
  const old = body.wangsets.find((x) => x.id === id);
  const same = (p: [string, string], o: [string, string]) => (o[0] === p[0] && o[1] === p[1]) || (o[0] === p[1] && o[1] === p[0]);
  const fresh: [string, string][] = [];
  for (const p of pairs) if (!(old?.pairs ?? []).some((o) => same(p, o)) && !fresh.some((o) => same(p, o))) fresh.push(p);
  const merged: Wangset = old
    ? { ...old, pairs: [...old.pairs, ...fresh], variants: w.variants ?? old.variants, ...(w.name ? { name: w.name } : {}) }
    : { id, name: w.name ?? id, type: 'corner', pairs: fresh, variants: w.variants ?? 1 };
  const next = { ...body, wangsets: old ? body.wangsets.map((x) => (x.id === id ? merged : x)) : [...body.wangsets, merged] };
  const errors = validateTileset(next);
  if (errors.length) throw new Error(errors.join('; '));
  const r = syncTiles(next);
  return { body: r.body, wangset: merged, added: r.added };
}

/** Add the transition between two existing terrains (ssg tileset blend): 14 mixed corner tiles × variants. */
export function addTerrainPair(body: TilesetBody, a: string, b: string): { body: TilesetBody; added: TilesetTile[]; existed: boolean } {
  const ta = findTerrain(body, a), tb = findTerrain(body, b);
  if (!ta) throw new Error(`no terrain "${a}"`);
  if (!tb) throw new Error(`no terrain "${b}"`);
  const existed = terrainPairs(body).some(([x, y]) => (x === ta.id && y === tb.id) || (x === tb.id && y === ta.id));
  const r = addWangset(body, { pairs: [[ta.id, tb.id]] });
  return { body: r.body, added: r.added, existed };
}

const HEX = /^#[0-9a-f]{6}$/i;
const posInt = (n: unknown, max = 4096) => Number.isInteger(n) && (n as number) > 0 && (n as number) <= max;

/** Everything wrong with a tileset body, as readable messages (empty = valid). */
export function validateTileset(b: TilesetBody): string[] {
  const e: string[] = [];
  if (typeof b.name !== 'string' || !b.name.trim()) e.push('a name is required');
  if (b.orientation !== 'isometric' && b.orientation !== 'orthogonal') e.push('orientation must be isometric or orthogonal');
  if (!posInt(b.tileWidth)) e.push('tileWidth must be a whole number of pixels (1–4096)');
  if (!posInt(b.tileHeight)) e.push('tileHeight must be a whole number of pixels (1–4096)');
  if (typeof b.metresPerTile !== 'number' || !(b.metresPerTile > 0) || b.metresPerTile > 1000) e.push('metresPerTile must be a positive number');
  if (b.noisePeriod !== undefined && (!Number.isInteger(b.noisePeriod) || b.noisePeriod < 1 || b.noisePeriod > 16)) e.push('noisePeriod must be a whole number of tiles (1–16)');
  if (b.cliffHeight !== undefined && (!Number.isInteger(b.cliffHeight) || b.cliffHeight < 1 || b.cliffHeight > 2 * b.tileHeight)) e.push(`cliffHeight must be a whole number of pixels (1–${2 * b.tileHeight})`);
  if (b.mixes !== undefined && !(MIX_MODES as readonly string[]).includes(b.mixes)) e.push(`mixes must be ${MIX_MODES.join(', ')}`);
  if (b.mixCorners !== undefined && !Array.isArray(b.mixCorners)) e.push('mixCorners must be a list');
  if (b.light !== undefined) {
    try {
      parseLight(b.light);
      if (!b.light || typeof b.light !== 'object' || Array.isArray(b.light)) e.push(`light must be stored as an object such as { "preset": "dusk" } (presets: ${LIGHT_PRESETS.join(', ')})`);
    } catch (err) {
      e.push((err as Error).message);
    }
  }
  if (b.nextId !== undefined && (!Number.isInteger(b.nextId) || b.nextId < 0)) e.push('nextId must be a whole number ≥ 0');
  for (const k of ['terrains', 'wangsets', 'tiles', 'objects'] as const) if (!Array.isArray(b[k])) e.push(`${k} must be a list`);
  if (e.length) return e;

  const terrainIds = new Set<string>();
  for (const t of b.terrains) {
    if (!t || typeof t.id !== 'string' || !t.id) { e.push('a terrain has no id'); continue; }
    if (terrainIds.has(t.id)) e.push(`terrain id "${t.id}" is used twice`);
    terrainIds.add(t.id);
    if (typeof t.name !== 'string' || !t.name.trim()) e.push(`terrain "${t.id}" needs a name`);
    if (!isTerrainKind(t.kind)) e.push(`terrain "${t.id}": unknown kind "${t.kind}"`);
    const s = t.source as TerrainSource | undefined;
    if (!s || (s.type !== 'palette' && s.type !== 'texture')) e.push(`terrain "${t.id}": source must be a palette colour or a texture`);
    else if (s.type === 'palette' && !HEX.test(s.color)) e.push(`terrain "${t.id}": colour must be #rrggbb`);
    else if (s.type === 'palette' && s.noise !== undefined && !(s.noise >= 0 && s.noise <= 1)) e.push(`terrain "${t.id}": noise must be 0–1`);
    else if (s.type === 'texture' && s.assetId === undefined && !s.path) e.push(`terrain "${t.id}": a texture source needs an assetId or a path`);
    else if (s.type === 'texture' && s.color !== undefined && !HEX.test(s.color)) e.push(`terrain "${t.id}": texture colour must be #rrggbb`);
    else if (s.type === 'texture' && s.scale !== undefined) {
      const k = typeof s.scale === 'number' ? s.scale / b.metresPerTile : NaN;
      if (!(k >= 1) || Math.abs(k - Math.round(k)) > 1e-6 || k > 16) e.push(`terrain "${t.id}": texture scale must be a whole number of tiles (1–16 × ${b.metresPerTile} m)`);
    }
    if (t.tint !== undefined && !HEX.test(t.tint)) e.push(`terrain "${t.id}": tint must be #rrggbb`);
    if (t.variants !== undefined && (!Number.isInteger(t.variants) || t.variants < 1 || t.variants > MAX_VARIANTS)) e.push(`terrain "${t.id}": variants must be 1–${MAX_VARIANTS}`);
    if (t.height !== undefined && t.height !== 0 && t.height !== 1) e.push(`terrain "${t.id}": height must be 0 (ground) or 1 (raised)`);
    if (t.shore !== undefined && typeof t.shore !== 'boolean') e.push(`terrain "${t.id}": shore must be true or false`);
  }
  if (b.terrains.length > 254) e.push('at most 254 terrains (Tiled wang colour limit)');

  for (const c of Array.isArray(b.mixCorners) ? b.mixCorners : []) {
    if (!Array.isArray(c) || c.length !== 4) {
      e.push('a mix (mixCorners) must list 4 corner terrains');
      continue;
    }
    for (const id of c) if (!terrainIds.has(id)) e.push(`mix ${c.join('|')}: unknown terrain "${id}"`);
    if (distinctTerrains(c) < 3) e.push(`mix ${c.join('|')}: needs three or four different terrains (two are a pair)`);
  }

  const wangIds = new Set<string>();
  for (const w of b.wangsets) {
    if (!w || typeof w.id !== 'string' || !w.id) { e.push('a wangset has no id'); continue; }
    if (wangIds.has(w.id)) e.push(`wangset id "${w.id}" is used twice`);
    wangIds.add(w.id);
    if (w.type !== 'corner') e.push(`wangset "${w.id}": only corner wangsets are supported`);
    if (!Number.isInteger(w.variants) || w.variants < 1 || w.variants > MAX_VARIANTS) e.push(`wangset "${w.id}": variants must be 1–${MAX_VARIANTS}`);
    for (const p of w.pairs ?? []) {
      if (!Array.isArray(p) || p.length !== 2) { e.push(`wangset "${w.id}": a pair must name two terrains`); continue; }
      for (const id of p) if (!terrainIds.has(id)) e.push(`wangset "${w.id}": unknown terrain "${id}"`);
      if (p[0] === p[1]) e.push(`wangset "${w.id}": a pair needs two different terrains`);
    }
  }

  const tileIds = new Set<number>();
  for (const t of b.tiles) {
    if (!t || !Number.isInteger(t.id) || t.id < 0) { e.push('tile ids must be whole numbers ≥ 0'); continue; }
    if (tileIds.has(t.id)) e.push(`tile id ${t.id} is used twice`);
    tileIds.add(t.id);
    if (t.terrainCorners !== undefined) {
      if (!Array.isArray(t.terrainCorners) || t.terrainCorners.length !== 4) e.push(`tile ${t.id}: terrainCorners must list 4 terrains`);
      else for (const c of t.terrainCorners) if (!terrainIds.has(c)) e.push(`tile ${t.id}: unknown terrain "${c}"`);
    }
    if (!Number.isInteger(t.variant) || t.variant < 0) e.push(`tile ${t.id}: variant must be a whole number ≥ 0`);
    if (!t.properties || typeof t.properties !== 'object' || Array.isArray(t.properties)) e.push(`tile ${t.id}: properties must be an object`);
    else for (const [k, v] of Object.entries(t.properties)) if (!['string', 'number', 'boolean'].includes(typeof v)) e.push(`tile ${t.id}: property "${k}" must be a string, number or boolean`);
    for (const c of t.collision ?? [])
      if (!Array.isArray(c.points) || c.points.length < 3 || c.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
        e.push(`tile ${t.id}: a collision polygon needs at least 3 [x, y] points`);
  }

  for (const o of b.objects) if (!o || !Number.isInteger(o.spriteId) || typeof o.name !== 'string') e.push('an object needs a spriteId and a name');
  return e;
}
