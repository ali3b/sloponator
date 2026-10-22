// Moved from the old generator's packages/shared/src/tileset/tiled.ts (ali3b/sloponator#17, #18).
import type { Terrain, TilePropertyValue, TilesetBody, TilesetTile, Wangset } from './types.js';
import { DEFAULT_NOISE_PERIOD, hasShore, isRaised, tileExtraHeight, tileImageHeight, tilesetPpm } from './types.js';

/**
 * Tiled tileset writers (pure): a tileset body → `.tsj` (Tiled JSON) or `.tsx` (Tiled XML), format 1.10.
 *
 * - One atlas image per tileset, tiles laid out by id in rows of `columns` (B2 renders the PNG to match).
 * - Corner wangsets: Tiled's wangid is 8 colour indices clockwise from the top edge,
 *   [top, top-right, right, bottom-right, bottom, bottom-left, left, top-left]. A corner set only uses the odd
 *   indices (1 TR, 3 BR, 5 BL, 7 TL); edges stay 0. Colour indices start at 1 (0 = unset).
 * - Tile properties and collision polygons (an `objectgroup` per tile, points in tile pixels).
 * - Raised terrain (B4): tiles are `tileheight` = grid height + cliffHeight tall with the diamond at the bottom (Tiled
 *   draws a taller tile bottom-aligned on its cell, so no tileoffset); the `grid` keeps the diamond size. Cliff tiles
 *   (raised and ground corners) get `cliff: true` and a collision polygon over their diamond; pure raised tiles get
 *   `elevation: 1`. Phaser 3.80 draws iso tiles top-aligned instead: create the layer cliffHeight higher (the map
 *   export writes `tileOffsetY` on such a layer, see map/tiled.ts).
 */

export const TILED_VERSION = '1.10';
export const TILED_APP_VERSION = '1.10.2';

export interface TiledWriteOptions {
  /** Atlas image file name, relative to the tileset file (default: `<file>.png`). */
  image?: string;
  /** Base file name without extension, used for the default image name (default: a slug of the tileset name). */
  file?: string;
  /** Tiles per atlas row (default: 8, or fewer when there are fewer tiles). */
  columns?: number;
}

type PropType = 'string' | 'int' | 'float' | 'bool';
interface Prop { name: string; type: PropType; value: TilePropertyValue }

const typeOf = (v: TilePropertyValue): PropType => (typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : 'string');
/** Tiled keeps properties sorted by name. */
const propsOf = (o: Record<string, TilePropertyValue>): Prop[] =>
  Object.keys(o).sort().map((name) => ({ name, type: typeOf(o[name]), value: o[name] }));

export const tilesetFileName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tileset';

/** The colours and wang tiles of one corner wangset, resolved to Tiled indices. */
export interface ResolvedWangset {
  name: string;
  colors: { name: string; color: string; terrain: string; kind: string; height?: number; shore?: boolean }[];
  wangtiles: { tileid: number; wangid: number[] }[];
}

/** Corner terrains [tl, tr, br, bl] → Tiled corner wangid (indices 1 TR, 3 BR, 5 BL, 7 TL). */
export function cornerWangId(corners: [number, number, number, number]): number[] {
  const [tl, tr, br, bl] = corners;
  return [0, tr, 0, br, 0, bl, 0, tl];
}

/** The wang colour of a terrain: its palette colour, a texture's tint or average colour (grey when unknown). */
export function terrainColor(t: Terrain): string {
  return (t.source.type === 'palette' ? t.source.color : (t.tint ?? t.source.color ?? '#808080')).toLowerCase();
}

/**
 * The wangsets as Tiled sees them. Colours are the wangset's terrains in tileset order (the first wangset has
 * every terrain, so a terrain without transitions still has its pure tiles in the set); a tile belongs to a set
 * when all four of its corners are colours of that set. With no wangsets but corner tiles, one "terrain" set
 * covers every terrain.
 */
export function resolveWangsets(b: TilesetBody): ResolvedWangset[] {
  const sets: Pick<Wangset, 'name' | 'pairs'>[] = b.wangsets.length
    ? b.wangsets
    : b.tiles.some((t) => t.terrainCorners) ? [{ name: 'terrain', pairs: b.terrains.map((t) => [t.id, t.id] as [string, string]) }] : [];
  return sets.map((w, i) => {
    const used = new Set(i === 0 ? b.terrains.map((t) => t.id) : w.pairs.flat());
    const terrains = b.terrains.filter((t) => used.has(t.id));
    const index = new Map(terrains.map((t, i) => [t.id, i + 1]));
    const wangtiles = b.tiles
      .filter((t) => t.terrainCorners?.every((c) => index.has(c)))
      .sort((x, y) => x.id - y.id)
      .map((t) => ({ tileid: t.id, wangid: cornerWangId(t.terrainCorners!.map((c) => index.get(c)!) as [number, number, number, number]) }));
    return {
      name: w.name,
      colors: terrains.map((t) => ({
        name: t.name, color: terrainColor(t), terrain: t.id, kind: t.kind,
        ...(isRaised(t) ? { height: 1 } : {}), ...(hasShore(t) ? { shore: true } : {}),
      })),
      wangtiles,
    };
  });
}

/** Where the atlas puts each tile: by id, `columns` per row, image `<file>.png` (the ground renderer draws to match). */
export function atlasLayout(b: Pick<TilesetBody, 'name' | 'tiles' | 'tileWidth' | 'tileHeight'> & Partial<Pick<TilesetBody, 'terrains' | 'cliffHeight'>>, o: TiledWriteOptions = {}) {
  const tilecount = b.tiles.reduce((m, t) => Math.max(m, t.id + 1), 0);
  const columns = Math.max(1, Math.min(o.columns ?? 8, Math.max(1, tilecount)));
  const rows = Math.max(1, Math.ceil(tilecount / columns));
  const file = o.file ?? tilesetFileName(b.name);
  // Tile pictures are taller than the grid when a terrain is raised (cliffs; tileImageHeight).
  const tileheight = tileImageHeight(b);
  return { tilecount, columns, image: o.image ?? `${file}.png`, imagewidth: columns * b.tileWidth, imageheight: rows * tileheight, tileheight };
}

function tilesetProps(b: TilesetBody): Prop[] {
  const p: Prop[] = [
    { name: 'metresPerTile', type: 'float', value: b.metresPerTile },
    // Variant v of a corner combination is drawn for period cell (v mod P, ⌊v / P⌋ mod P): pick it for map cell
    // (x mod P, y mod P) to get the large-scale ground noise continuous (any pick is seamless).
    { name: 'noisePeriod', type: 'int', value: b.noisePeriod ?? DEFAULT_NOISE_PERIOD },
    { name: 'pixelsPerMetre', type: 'float', value: Math.round(tilesetPpm(b) * 1e4) / 1e4 },
  ];
  const cliff = tileExtraHeight(b);
  if (cliff) p.unshift({ name: 'cliffHeight', type: 'int', value: cliff });
  if (b.objects.length) p.unshift({ name: 'objects', type: 'string', value: JSON.stringify(b.objects) });
  return p;
}

/** What raised terrain adds to a tile: cliff tiles get `cliff` and a collision polygon over their diamond, pure raised tiles `elevation`. */
function raisedExtras(b: TilesetBody, t: TilesetTile): { props: Record<string, TilePropertyValue>; collision?: { name?: string; points: [number, number][] } } {
  const E = tileExtraHeight(b);
  if (!E || !t.terrainCorners) return { props: {} };
  const raised = t.terrainCorners.map((c) => isRaised(b.terrains.find((x) => x.id === c)));
  if (raised.every(Boolean)) return { props: { elevation: 1 } };
  if (!raised.some(Boolean)) return { props: {} };
  const W = b.tileWidth, H = b.tileHeight;
  const points: [number, number][] = b.orientation === 'isometric' ? [[W / 2, E], [W, E + H / 2], [W / 2, E + H], [0, E + H / 2]] : [[0, E], [W, E], [W, E + H], [0, E + H]];
  return { props: { cliff: true }, collision: { name: 'cliff', points } };
}

/**
 * A tile as written: its own properties plus `variant` (≥ 1) so a game can pick variants by map position, and what
 * raised terrain adds (raisedExtras); its own collision plus a cliff's.
 */
function tileOut(b: TilesetBody, t: TilesetTile) {
  const r = raisedExtras(b, t);
  const props: Record<string, TilePropertyValue> = { ...(t.terrainCorners && t.variant ? { variant: t.variant } : {}), ...r.props, ...(t.properties ?? {}) };
  const collision = [...(t.collision ?? []), ...(r.collision ? [r.collision] : [])];
  return { props, collision };
}
const tileHasData = (b: TilesetBody, t: TilesetTile) => {
  const o = tileOut(b, t);
  return Object.keys(o.props).length > 0 || o.collision.length > 0;
};

// ---------------------------------------------------------------------------------------------- JSON (.tsj)

/** A wang colour's properties: kind and terrain id, plus height and shore when set. */
const colorProps = (c: ResolvedWangset['colors'][number]): Record<string, TilePropertyValue> => ({
  kind: c.kind, terrain: c.terrain, ...(c.height ? { height: c.height } : {}), ...(c.shore ? { shore: true } : {}),
});

const jsonProps = (p: Prop[]) => p.map((x) => ({ name: x.name, type: x.type, value: x.value }));

/** The Tiled JSON tileset object (serialise with JSON.stringify, or use writeTsj). */
export function toTiledJson(b: TilesetBody, o: TiledWriteOptions = {}) {
  const l = atlasLayout(b, o);
  const tiles = b.tiles.filter((t) => tileHasData(b, t)).sort((x, y) => x.id - y.id).map((t) => {
    const o = tileOut(b, t);
    return {
      id: t.id,
      ...(o.collision.length
        ? {
            objectgroup: {
              draworder: 'index', id: 2, name: '', opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0,
              objects: o.collision.map((c, i) => ({
                height: 0, id: i + 1, name: c.name ?? '', polygon: c.points.map(([x, y]) => ({ x, y })), rotation: 0, type: '', visible: true, width: 0, x: 0, y: 0,
              })),
            },
          }
        : {}),
      ...(Object.keys(o.props).length ? { properties: jsonProps(propsOf(o.props)) } : {}),
    };
  });
  const wangsets = resolveWangsets(b).map((w) => ({
    colors: w.colors.map((c) => ({ color: c.color, name: c.name, probability: 1, properties: jsonProps(propsOf(colorProps(c))), tile: -1 })),
    name: w.name,
    tile: -1,
    type: 'corner',
    wangtiles: w.wangtiles,
  }));
  return {
    columns: l.columns,
    ...(b.orientation === 'isometric' ? { grid: { height: b.tileHeight, orientation: 'isometric', width: b.tileWidth } } : {}),
    image: l.image,
    imageheight: l.imageheight,
    imagewidth: l.imagewidth,
    margin: 0,
    name: b.name,
    properties: jsonProps(tilesetProps(b)),
    spacing: 0,
    tilecount: l.tilecount,
    tiledversion: TILED_APP_VERSION,
    tileheight: l.tileheight,
    ...(tiles.length ? { tiles } : {}),
    tilewidth: b.tileWidth,
    type: 'tileset',
    version: TILED_VERSION,
    ...(wangsets.length ? { wangsets } : {}),
  };
}

export function writeTsj(b: TilesetBody, o: TiledWriteOptions = {}): string {
  return JSON.stringify(toTiledJson(b, o), null, 1) + '\n';
}

// ----------------------------------------------------------------------------------------------- XML (.tsx)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');

function xmlProps(p: Prop[], pad: string): string[] {
  if (!p.length) return [];
  // Tiled leaves type out for strings.
  return [`${pad}<properties>`, ...p.map((x) => `${pad} <property${attrs({ name: x.name, type: x.type === 'string' ? undefined : x.type, value: String(x.value) })}/>`), `${pad}</properties>`];
}

export function writeTsx(b: TilesetBody, o: TiledWriteOptions = {}): string {
  const l = atlasLayout(b, o);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset${attrs({ version: TILED_VERSION, tiledversion: TILED_APP_VERSION, name: b.name, tilewidth: b.tileWidth, tileheight: l.tileheight, tilecount: l.tilecount, columns: l.columns })}>`,
  ];
  if (b.orientation === 'isometric') out.push(` <grid${attrs({ orientation: 'isometric', width: b.tileWidth, height: b.tileHeight })}/>`);
  out.push(...xmlProps(tilesetProps(b), ' '));
  out.push(` <image${attrs({ source: l.image, width: l.imagewidth, height: l.imageheight })}/>`);
  for (const t of b.tiles.filter((x) => tileHasData(b, x)).sort((x, y) => x.id - y.id)) {
    const o = tileOut(b, t);
    out.push(` <tile id="${t.id}">`);
    out.push(...xmlProps(propsOf(o.props), '  '));
    if (o.collision.length) {
      out.push('  <objectgroup draworder="index" id="2">');
      o.collision.forEach((c, i) => {
        out.push(`   <object${attrs({ id: i + 1, name: c.name || undefined, x: 0, y: 0 })}>`);
        out.push(`    <polygon points="${c.points.map(([x, y]) => `${x},${y}`).join(' ')}"/>`);
        out.push('   </object>');
      });
      out.push('  </objectgroup>');
    }
    out.push(' </tile>');
  }
  const wangsets = resolveWangsets(b);
  if (wangsets.length) {
    out.push(' <wangsets>');
    for (const w of wangsets) {
      out.push(`  <wangset${attrs({ name: w.name, type: 'corner', tile: -1 })}>`);
      for (const c of w.colors) {
        out.push(`   <wangcolor${attrs({ name: c.name, color: c.color, tile: -1, probability: 1 })}>`);
        out.push(...xmlProps(propsOf(colorProps(c)), '    '));
        out.push('   </wangcolor>');
      }
      for (const t of w.wangtiles) out.push(`   <wangtile${attrs({ tileid: t.tileid, wangid: t.wangid.join(',') })}/>`);
      out.push('  </wangset>');
    }
    out.push(' </wangsets>');
  }
  out.push('</tileset>');
  return out.join('\n') + '\n';
}
