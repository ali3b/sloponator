// Moved from the old generator's packages/shared/src/map/resolve.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { cornersKey, type Corners } from '../tileset/ops.js';
import { cornerTilePicker, tilesByCorners } from '../tileset/raster.js';
import type { TilesetBody } from '../tileset/types.js';
import { linePoints, objectRect } from './ops.js';
import { mapGid, type GroundLayer, type MapBody, type Zone } from './types.js';

/**
 * Reading a map: ground corners → tile gids through the tileset's corner (Wang) tiles, and a text overview so a
 * tool without images (an AI over MCP) can see the layout.
 */

/** The (h + 1) rows of (w + 1) corner terrains of a ground layer. */
export function cornerRows(doc: Pick<MapBody, 'width' | 'height'>, layer: Pick<GroundLayer, 'corners'>): string[][] {
  const W = doc.width + 1;
  return Array.from({ length: doc.height + 1 }, (_, y) => layer.corners.slice(y * W, y * W + W));
}

export interface ResolvedGround {
  /** Map gids per cell, row-major (0 = no tile). */
  gids: number[];
  /** Cells whose corner combination has no tile (they got the pure tile of their most common terrain, or 0). */
  missing: number;
  /** Corner combinations with no tile, e.g. "dirt|sand|sand|dirt" (top-left, top-right, bottom-right, bottom-left). */
  missingCombos: string[];
  /** The first few cells with no tile (x, y). */
  missingAt: [number, number][];
}

/**
 * Ground → gids: cell (x, y) takes the tileset tile whose corners are its four vertices' terrains (a random but
 * stable variant per cell, the same pick the map compositor uses). A combination the tileset lacks (e.g. three
 * terrains meeting in one cell) falls back to the pure tile of the cell's most common corner terrain.
 */
export function resolveGround(doc: Pick<MapBody, 'width' | 'height' | 'tilesets'>, layer: GroundLayer, tileset: Pick<TilesetBody, 'tiles'>): ResolvedGround {
  const gidAt = groundResolver(doc, layer, tileset);
  const gids: number[] = [];
  let missing = 0;
  const combos = new Set<string>();
  const missingAt: [number, number][] = [];
  for (let y = 0; y < doc.height; y++)
    for (let x = 0; x < doc.width; x++) {
      const r = gidAt(x, y);
      gids.push(r.gid);
      if (!r.missing) continue;
      missing++;
      combos.add(r.missing);
      if (missingAt.length < 20) missingAt.push([x, y]);
    }
  return { gids, missing, missingCombos: [...combos].slice(0, 20), missingAt };
}

/**
 * One cell of `resolveGround`: its gid, and `missing` (its corner combination) when the tileset has no tile for it.
 * For redrawing a few changed cells of a big map without resolving all of it.
 */
export function groundResolver(doc: Pick<MapBody, 'width' | 'tilesets'>, layer: GroundLayer, tileset: Pick<TilesetBody, 'tiles'>): (x: number, y: number) => { gid: number; missing?: string } {
  const slot = layer.tileset ?? 0;
  const W = doc.width + 1;
  const tileAt = cornerTilePicker(tileset);
  const byCorners = tilesByCorners(tileset);
  return (x, y) => {
    const k = layer.corners;
    const c: Corners = [k[y * W + x], k[y * W + x + 1], k[(y + 1) * W + x + 1], k[(y + 1) * W + x]];
    const id = tileAt(c, x, y);
    if (id !== null) return { gid: mapGid(slot, id) };
    if (c.every((t) => t === '')) return { gid: 0 };
    const counts = new Map<string, number>();
    for (const t of c) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || c.indexOf(a[0]) - c.indexOf(b[0]))[0]?.[0];
    const pure = top ? byCorners.get([top, top, top, top].join('|')) : undefined;
    return { gid: pure?.length ? mapGid(slot, pure[0]) : 0, missing: c.join('|') };
  };
}

/** A cell whose corner mix the tileset has no tile for. */
export interface MissingMix {
  cell: [number, number];
  /** Its corners' terrains: top-left, top-right, bottom-right, bottom-left. */
  corners: string[];
  /** The ground layer, when the map has more than one. */
  layer?: string;
}

export interface MissingMixes {
  /** Cells with no tile, over every ground layer. */
  count: number;
  /** The first `cap` of them, row by row. */
  cells: MissingMix[];
  /** Each distinct mix and how many cells have it, most common first. */
  combos: { corners: string[]; cells: number }[];
  /**
   * Two-terrain mixes whose terrain pair the tileset has no transition tiles for: adding the pair (ssg tileset
   * blend, the `add-pairs` fix) draws them. `slot` is the map's tileset slot.
   */
  pairs: { slot: number; pair: [string, string]; cells: number }[];
  /** Cells where three or more terrains meet (FB-049). */
  threeWay: number;
  /**
   * Their corner combinations by tileset slot, most common first: the `add-mixes` fix (tileset mixes 'auto' or
   * 'triples') adds a tile for exactly these.
   */
  mixes: { slot: number; corners: string[]; cells: number }[];
}

/**
 * The cells of a map's ground layers whose four corner terrains have no tile in the layer's tileset (what the
 * Tiled export and the preview draw as the pure tile of the cell's main terrain), with their positions and what
 * would fix them. A layer whose tileset is missing is skipped.
 */
export function missingMixes(doc: Pick<MapBody, 'width' | 'height' | 'layers'>, tilesets: (Pick<TilesetBody, 'tiles'> | null | undefined)[], o: { cap?: number } = {}): MissingMixes {
  const cap = o.cap ?? 50;
  const grounds = doc.layers.filter((l): l is GroundLayer => l.type === 'ground');
  const cells: MissingMix[] = [];
  const combos = new Map<string, { corners: string[]; cells: number }>();
  const pairs = new Map<string, { slot: number; pair: [string, string]; cells: number }>();
  const mixes = new Map<string, { slot: number; corners: string[]; cells: number }>();
  let count = 0, threeWay = 0;
  for (const l of grounds) {
    const slot = l.tileset ?? 0;
    const ts = tilesets[slot];
    if (!ts) continue;
    const byCorners = tilesByCorners(ts);
    const rows = cornerRows(doc, l);
    for (let y = 0; y < doc.height; y++)
      for (let x = 0; x < doc.width; x++) {
        const c = [rows[y][x], rows[y][x + 1], rows[y + 1][x + 1], rows[y + 1][x]];
        if (c.every((t) => t === '') || byCorners.get(cornersKey(c as Corners))?.length) continue;
        count++;
        if (cells.length < cap) cells.push({ cell: [x, y], corners: c, ...(grounds.length > 1 ? { layer: l.name } : {}) });
        const k = c.join('|');
        const e = combos.get(k) ?? { corners: c, cells: 0 };
        e.cells++;
        combos.set(k, e);
        const kinds = [...new Set(c.filter(Boolean))].sort();
        if (kinds.length >= 3) {
          threeWay++;
          if (c.every(Boolean)) {
            const mk = `${slot}|${k}`;
            const x = mixes.get(mk) ?? { slot, corners: c, cells: 0 };
            x.cells++;
            mixes.set(mk, x);
          }
        } else if (kinds.length === 2) {
          const pk = `${slot}|${kinds.join('|')}`;
          const p = pairs.get(pk) ?? { slot, pair: kinds as [string, string], cells: 0 };
          p.cells++;
          pairs.set(pk, p);
        }
      }
  }
  return { count, cells, combos: [...combos.values()].sort((a, b) => b.cells - a.cells), pairs: [...pairs.values()].sort((a, b) => b.cells - a.cells), threeWay, mixes: [...mixes.values()].sort((a, b) => b.cells - a.cells) };
}

/**
 * One line about a map's missing mixes and how to fix them (empty when there are none). `tilesetNames` by slot
 * makes the `ssg tileset blend` hint copy-pasteable.
 */
export function missingMixesMessage(m: MissingMixes, tilesetNames: (string | null | undefined)[] = []): string {
  if (!m.count) return '';
  const at = m.cells.slice(0, 6).map((c) => `(${c.cell[0]},${c.cell[1]}) ${c.corners.map((t) => t || '-').join('|')}`).join('; ');
  const parts = [`${m.count} cell${m.count === 1 ? ' has' : 's have'} a corner mix the tileset has no tile for (drawn as the pure tile of their main terrain): ${at}${m.count > 6 ? ' …' : ''}`];
  if (m.pairs.length) {
    const q = (s: string) => (/^[\w.-]+$/.test(s) ? s : JSON.stringify(s));
    const blends = m.pairs.slice(0, 4).map((p) => `ssg tileset blend ${q(tilesetNames[p.slot] ?? `<tileset ${p.slot}>`)} ${p.pair[0]} ${p.pair[1]}`);
    parts.push(`${m.pairs.reduce((n, p) => n + p.cells, 0)} are two-terrain mixes: add the pair${m.pairs.length > 1 ? 's' : ''} (${blends.join('; ')}${m.pairs.length > 4 ? ' …' : ''}), or fix "add-pairs" (CLI --fix add-pairs) to add them all${m.threeWay ? ' ("add-mixes" does both)' : ''}`);
  }
  if (m.threeWay)
    parts.push(`${m.threeWay} ha${m.threeWay === 1 ? 's' : 've'} three or more terrains meeting in one cell (${m.mixes.length} mix${m.mixes.length === 1 ? '' : 'es'}): fix "add-mixes" (CLI --fix add-mixes) adds a tile for exactly those, and the pairs too; a T-junction can't be repainted away`);
  return parts.join('. ');
}

/**
 * The terrain a cell shows most of: its most common corner, '' when none. A tie (two and two) goes to `base` when
 * it is one of them (pass the map's most common terrain, so a painted block of cells reads as exactly those cells),
 * else to the top-left corner's.
 */
export function cellTerrain(doc: Pick<MapBody, 'width'>, layer: Pick<GroundLayer, 'corners'>, x: number, y: number, base?: string): string {
  const W = doc.width + 1;
  const c = [layer.corners[y * W + x], layer.corners[y * W + x + 1], layer.corners[(y + 1) * W + x + 1], layer.corners[(y + 1) * W + x]];
  let best = '', n = 0;
  for (const t of c) {
    const k = c.filter((u) => u === t).length;
    if (k > n || (k === n && t === base)) (best = t), (n = k);
  }
  return best;
}

/** The most common corner terrain of a ground layer. */
export function baseTerrain(layer: Pick<GroundLayer, 'corners'>): string {
  const counts = new Map<string, number>();
  for (const c of layer.corners) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

export type OverviewZones = 'outline' | 'marker' | 'off';
export type OverviewCollision = 'overlay' | 'separate' | 'off';
export type OverviewTerrain = 'features' | 'majority';
export const OVERVIEW_ZONES: OverviewZones[] = ['outline', 'marker', 'off'];
export const OVERVIEW_COLLISION: OverviewCollision[] = ['overlay', 'separate', 'off'];
export const OVERVIEW_TERRAIN: OverviewTerrain[] = ['features', 'majority'];

export interface MapOverviewOptions {
  /** At most this many characters per side (default 64; bigger maps are shown in blocks of cells). */
  maxSize?: number;
  /** Terrain kinds by terrain id (grass, water…), for the usual symbols. */
  terrainKinds?: Record<string, string>;
  /**
   * outline (default): rects and polygons as their edges, paths as their lines, points as one cell, each zone with
   * its own symbol; marker: the symbol on the zone's first point only; off: no zones.
   */
  zones?: OverviewZones;
  /** overlay (default): '#' over the terrain; separate: a second picture (`collision`); off: none. */
  collision?: OverviewCollision;
  /**
   * features (default): a cell shows its main terrain, unless one of its corners is a terrain no cell nearby shows
   * (a thin trench, a 1-cell road edge), which then shows instead, so thin features stay visible; majority: the
   * main terrain only.
   */
  terrain?: OverviewTerrain;
  /**
   * Only this window of the map: cells [x0, y0, x1, y1) (x1, y1 exclusive), at up to `maxSize` characters per side,
   * so a part of a big map reads one character per cell. Adds `window` and an x `ruler` to the result.
   */
  region?: [number, number, number, number];
}

export interface MapOverview {
  /** One line per row of cells (or of blocks of cells on a big map), top row first; x runs left to right. */
  lines: string[];
  legend: Record<string, string>;
  /** Cells per character (1 unless the map is wider or taller than the limit). */
  scale: number;
  /**
   * One line to print above the picture (FB-065): the cells shown, the picture's size in characters and the scale,
   * e.g. "128×256 cells as 32×64 characters: 1 char = 4×4 cells (downsampled) …", with how to map a character back
   * to cells and how to get one character per cell.
   */
  header: string;
  note: string;
  /** With collision 'separate' and blocked cells: the collision as its own picture ('#' blocked, '+' partly, '.' open). */
  collision?: string[];
  /** Each zone's symbol by zone id (none with zones 'off'). */
  zoneSymbols: Record<string, string>;
  /** With a region: the cells shown, [x0, y0, x1, y1) (clamped to the map). */
  window?: [number, number, number, number];
  /**
   * With a region, or a downsampled picture: a line as wide as the picture with the x of every 10th column (its first
   * cell) written where it starts.
   */
  ruler?: string;
}

const SYMBOLS: Record<string, string> = { grass: '.', dirt: ':', sand: '~', mud: '%', road: '=', water: 'w', snow: '*', jungle: 'j', rock: '^' };
/** Zone symbols, in the order they are handed out (what terrains and objects took is skipped). */
const ZONE_SYMBOLS = [...'0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!$&+/<>?@^|{}()[];,\'"`-_=~%:*'];

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The cells a rect zone covers, inclusive: [x0, y0, x1, y1]. */
function rectCells(points: [number, number][]): [number, number, number, number] {
  const [a, b] = points;
  const lo = (u: number, v: number) => Math.floor(Math.min(u, v));
  const hi = (u: number, v: number, l: number) => Math.max(l, Math.ceil(Math.max(u, v)) - 1);
  const x0 = lo(a[0], b[0]), y0 = lo(a[1], b[1]);
  return [x0, y0, hi(a[0], b[0], x0), hi(a[1], b[1], y0)];
}

/** Where a zone is, in words: "rect cells 3..10 × 4..10", "path of 5 points, 42.5 cells long (a loop)"… */
export function zoneExtent(z: Pick<Zone, 'shape' | 'points'>): string {
  const p = z.points;
  if (z.shape === 'point' || p.length < 2) return `point (${p[0]?.[0] ?? 0}, ${p[0]?.[1] ?? 0})`;
  if (z.shape === 'rect') {
    const [x0, y0, x1, y1] = rectCells(p);
    return `rect cells ${x0}..${x1} × ${y0}..${y1}`;
  }
  if (z.shape === 'polygon') return `polygon of ${p.length} points`;
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  const loop = p.length > 2 && Math.hypot(p[0][0] - p.at(-1)![0], p[0][1] - p.at(-1)![1]) < 0.01;
  return `path of ${p.length} points, ${r1(len)} cells long${loop ? ' (a loop)' : ''}`;
}

/**
 * A text picture of a map in map coordinates (not iso-projected: row y, column x): ground terrains as characters,
 * objects as their initials (uppercase), zones with one symbol each (outlines by default; drawn under objects, so they
 * show only on cells without one), collision as '#' (or a picture of its own).
 */
export function mapOverview(doc: MapBody, o: MapOverviewOptions = {}): MapOverview {
  const max = o.maxSize ?? 64;
  const zonesMode = o.zones ?? 'outline', collisionMode = o.collision ?? 'overlay', terrainMode = o.terrain ?? 'features';
  const win = o.region ? clampWindow(doc, o.region) : null;
  const [wx0, wy0, wx1, wy1] = win ?? [0, 0, doc.width, doc.height];
  const scale = Math.max(1, Math.ceil(Math.max(wx1 - wx0, wy1 - wy0) / max));
  const cols = Math.ceil((wx1 - wx0) / scale), rows = Math.ceil((wy1 - wy0) / scale);
  /** The block (column, row) a cell falls in, or null outside the window. */
  const blockAt = (x: number, y: number): [number, number] | null =>
    x < wx0 || y < wy0 || x >= wx1 || y >= wy1 ? null : [Math.floor((x - wx0) / scale), Math.floor((y - wy0) / scale)];
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
  const legend: Record<string, string> = {};
  const used = new Set<string>(['#', ' ']);
  const symbolFor = (terrain: string): string => {
    if (!terrain) return ' ';
    const found = Object.entries(legend).find(([, v]) => v === `terrain ${terrain}`);
    if (found) return found[0];
    const kind = o.terrainKinds?.[terrain] ?? terrain;
    let s = SYMBOLS[kind] ?? SYMBOLS[terrain];
    if (!s || used.has(s)) s = [...'abcdefghijklmnopqrstuvxyz'].find((ch) => !used.has(ch) && ch === terrain[0]?.toLowerCase()) ?? [...',;^\'"`-_+<>!?abcdefghiklmnopqrstuvxyz'].find((ch) => !used.has(ch)) ?? '?';
    used.add(s);
    legend[s] = `terrain ${terrain}`;
    return s;
  };
  /** f over the cells of block (bx, by). */
  const inBlock = <T>(bx: number, by: number, f: (x: number, y: number) => T): T[] => {
    const out: T[] = [];
    for (let y = wy0 + by * scale; y < Math.min(wy1, wy0 + (by + 1) * scale); y++) for (let x = wx0 + bx * scale; x < Math.min(wx1, wx0 + (bx + 1) * scale); x++) out.push(f(x, y));
    return out;
  };
  const ground = doc.layers.find((l) => l.type === 'ground') as GroundLayer | undefined;
  let thin = false;
  if (ground) {
    const base = baseTerrain(ground);
    const W = doc.width + 1;
    const total = new Map<string, number>();
    for (const c of ground.corners) total.set(c, (total.get(c) ?? 0) + 1);
    // Each block's main terrain (the most common of its cells').
    const main: string[][] = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const counts = new Map<string, number>();
        for (const t of inBlock(c, r, (x, y) => cellTerrain(doc, ground, x, y, base))) counts.set(t, (counts.get(t) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }),
    );
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let t = main[r][c];
        if (terrainMode === 'features') {
          // A corner terrain that neither this block nor any block around it shows is drawn here (the rarest first).
          const present = new Set(inBlock(c, r, (x, y) => [ground.corners[y * W + x], ground.corners[y * W + x + 1], ground.corners[(y + 1) * W + x + 1], ground.corners[(y + 1) * W + x]]).flat());
          let pick = '';
          for (const p of present) {
            if (!p || p === t) continue;
            let shown = false;
            for (let dr = -1; dr <= 1 && !shown; dr++) for (let dc = -1; dc <= 1 && !shown; dc++) shown = main[r + dr]?.[c + dc] === p;
            if (!shown && (!pick || (total.get(p) ?? 0) < (total.get(pick) ?? 0))) pick = p;
          }
          if (pick) (t = pick), (thin = true);
        }
        grid[r][c] = symbolFor(t);
      }
  }
  const blocked = doc.layers.some((l) => l.type === 'collision' && (win ? inBlockAny(l.cells) : l.cells.some(Boolean)));
  let collision: string[] | undefined;
  if (blocked && collisionMode === 'overlay') {
    for (const l of doc.layers)
      if (l.type === 'collision')
        l.cells.forEach((v, i) => {
          if (!v) return;
          const b = blockAt(i % doc.width, Math.floor(i / doc.width));
          if (b) grid[b[1]][b[0]] = '#';
        });
    legend['#'] = 'blocked (collision)';
  } else if (blocked && collisionMode === 'separate') {
    const layers = doc.layers.filter((l) => l.type === 'collision');
    collision = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const cells = inBlock(c, r, (x, y) => layers.some((l) => l.cells[y * doc.width + x]));
        const n = cells.filter(Boolean).length;
        return n === 0 ? '.' : n === cells.length ? '#' : '+';
      }).join(''),
    );
  }
  // One letter per kind of object (its name, else its reference); the legend says what it is, how many there are
  // and, for a single one, its id.
  const objectLetters = new Map<string, { ch: string; ids: string[]; ref: string }>();
  /** The blocks an object covers: zones draw under objects (FB-054), so a zone mark never hides an object. */
  const objectCells = new Set<number>();
  for (const l of doc.layers)
    if (l.type === 'objects')
      for (const ob of l.objects) {
        const [ox0, oy0, ox1, oy1] = objectRect(ob);
        if (win && (ox1 < wx0 || oy1 < wy0 || ox0 >= wx1 || oy0 >= wy1)) continue;
        const label = ob.name ?? ob.assetRef ?? (ob.spriteId !== undefined ? `sprite ${ob.spriteId}` : ob.id);
        let entry = objectLetters.get(label);
        if (!entry) {
          // SM_Env_Tree_01 → T (the Synty category prefix skipped when a word follows it).
          const letters = (re: RegExp) => label.replace(re, '').replace(/[^A-Za-z]/g, '');
          const initial = (letters(/^SM_[A-Za-z]{2,5}_(?=[A-Za-z])/i) || letters(/^(SM_|sprite )/i))[0]?.toUpperCase() ?? 'O';
          const ch = [initial, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((x) => !used.has(x)) ?? '@';
          used.add(ch);
          const ref = ob.spriteId !== undefined && ob.name ? ` [sprite ${ob.spriteId}]` : ob.assetRef && ob.name && ob.name !== ob.assetRef ? ` [${ob.assetRef}]` : '';
          entry = { ch, ids: [], ref };
          objectLetters.set(label, entry);
        }
        entry.ids.push(ob.id);
        const ch = entry.ch;
        legend[ch] = `object ${label}${entry.ref} ${entry.ids.length === 1 ? `(${entry.ids[0]})` : `×${entry.ids.length}`}`;
        for (let y = Math.floor(oy0); y < Math.max(Math.ceil(oy1), Math.floor(oy0) + 1); y++)
          for (let x = Math.floor(ox0); x < Math.max(Math.ceil(ox1), Math.floor(ox0) + 1); x++) {
            const b = blockAt(x, y);
            if (!b) continue;
            grid[b[1]][b[0]] = ch;
            objectCells.add(b[1] * cols + b[0]);
          }
      }
  // Zones: one symbol each (digits, then the letters and signs nothing else took).
  const zoneSymbols: Record<string, string> = {};
  let hidden = false;
  if (zonesMode !== 'off') {
    const pool = ZONE_SYMBOLS.filter((ch) => !used.has(ch));
    let zi = 0;
    /** Cells of the current zone drawn, and those an object hides. */
    let drawn = 0, under = 0;
    const put = (bx: number, by: number, ch: string) => {
      if (bx < 0 || by < 0 || bx >= cols || by >= rows) return;
      if (objectCells.has(by * cols + bx)) under++;
      else (grid[by][bx] = ch), drawn++;
    };
    // On the whole map a point on its far edge goes in the last block; in a window, points outside stay outside
    // (lines to them are drawn up to the window's edge).
    const blockOf = (v: number, n: number, o0: number) => (win ? Math.max(-1, Math.min(n, Math.floor((v - o0) / scale))) : Math.min(n - 1, Math.max(0, Math.floor(v / scale))));
    const cell = (p: [number, number]): [number, number] => [blockOf(p[0], cols, wx0), blockOf(p[1], rows, wy0)];
    for (const l of doc.layers)
      if (l.type === 'zones')
        for (const z of l.zones) {
          const ch = pool[zi++] ?? '?';
          zoneSymbols[z.id] = ch;
          drawn = 0;
          under = 0;
          const pts = z.points.length ? z.points : [[0, 0] as [number, number]];
          if (zonesMode === 'marker' || z.shape === 'point' || pts.length < 2) put(...cell(pts[0]), ch);
          else if (z.shape === 'rect') {
            const [x0, y0, x1, y1] = rectCells(pts);
            const bx0 = blockOf(x0, cols, wx0), by0 = blockOf(y0, rows, wy0), bx1 = blockOf(x1, cols, wx0), by1 = blockOf(y1, rows, wy0);
            for (let x = bx0; x <= bx1; x++) put(x, by0, ch), put(x, by1, ch);
            for (let y = by0; y <= by1; y++) put(bx0, y, ch), put(bx1, y, ch);
          } else {
            const ring = z.shape === 'polygon' ? [...pts, pts[0]] : pts;
            for (let i = 1; i < ring.length; i++) for (const [x, y] of linePoints(...cell(ring[i - 1]), ...cell(ring[i]))) put(x, y, ch);
          }
          if (under) hidden = true;
          if (win && !drawn && !under) continue;
          const desc = `${z.kind} ${z.id} "${z.name}" ${zoneExtent(z)}${zoneDrive(z)}${under && !drawn ? ' (hidden under objects)' : ''}`;
          legend[ch] = legend[ch] ? `${legend[ch]}; ${desc}` : desc;
        }
  }
  let ruler: string | undefined;
  if (win || scale > 1) {
    const r = new Array(cols).fill(' ');
    for (let c = 0; c < cols; c += 10) {
      const label = String(wx0 + c * scale);
      if (c + label.length <= cols) for (let k = 0; k < label.length; k++) r[c + k] = label[k];
    }
    ruler = r.join('');
  }
  const ww = wx1 - wx0, wh = wy1 - wy0;
  const span = (v0: number, k: string) => (scale > 1 ? `${v0 ? `${v0} + ` : ''}${scale}${k}..${v0 ? `${v0} + ` : ''}${scale}${k}+${scale - 1}` : `${v0 ? `${v0} + ` : ''}${k}`);
  const header =
    `${ww}×${wh} cells${win ? ` (x ${wx0}..${wx1 - 1}, y ${wy0}..${wy1 - 1})` : ''} as ${cols}×${rows} characters: ` +
    (scale > 1
      ? `1 char = ${scale}×${scale} cells (downsampled ${scale}×); column c covers x ${span(wx0, 'c')}, row r covers y ${span(wy0, 'r')}` +
        `${(ww % scale) || (wh % scale) ? ' (the last column / row covers fewer cells)' : ''}. A character shows the block's main terrain, an object standing on any of its cells, '#' if any of its cells is blocked, or a zone's mark. ` +
        `For one char per cell show a region, or allow more characters per side (up to 256).`
      : `1 char = 1 cell; column c = x ${span(wx0, 'c')}, row r = y ${span(wy0, 'r')}.`);
  const iso = doc.orientation === 'isometric' ? ' On screen x runs down-right and y down-left, so the top-left character is the top corner of the diamond.' : '';
  return {
    lines: grid.map((r) => r.join('')),
    legend,
    scale,
    header,
    note:
      (win
        ? `Map coordinates, not the iso picture: cells x ${wx0}..${wx1 - 1}, y ${wy0}..${wy1 - 1} only; column c = x ${wx0}${scale > 1 ? ` + ${scale}c` : ' + c'}, row r = y ${wy0}${scale > 1 ? ` + ${scale}r` : ' + r'} (ruler: the x of every 10th column)${scale > 1 ? `, one character per ${scale}×${scale} cells` : ''}.`
        : `Map coordinates, not the iso picture: row = y (0 at the top), column = x${scale > 1 ? `, one character per ${scale}×${scale} cells` : ''}.`) + iso +
      (zonesMode === 'outline' && Object.keys(zoneSymbols).length ? ' Zones are drawn as their outline (rects, polygons) or line (paths), one symbol each.' : '') +
      (hidden ? ' Objects are drawn over zones: a zone shows only on cells without an object.' : '') +
      (thin ? ' A terrain only some corners have (a thin trench or road edge) shows on the cells it touches.' : '') +
      (collision ? " Collision is its own picture (collision): '#' blocked, '+' partly blocked, '.' open." : ''),
    ...(collision ? { collision } : {}),
    zoneSymbols,
    ...(win ? { window: win } : {}),
    ...(ruler !== undefined ? { ruler } : {}),
  };

  /** Whether any cell of the window is set. */
  function inBlockAny(cells: number[]) {
    for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) if (cells[y * doc.width + x]) return true;
    return false;
  }
}

/** A window [x0, y0, x1, y1) clamped to the map (at least one cell). */
export function clampWindow(doc: Pick<MapBody, 'width' | 'height'>, r: [number, number, number, number]): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(doc.width - 1, Math.floor(Math.min(r[0], r[2])))), y0 = Math.max(0, Math.min(doc.height - 1, Math.floor(Math.min(r[1], r[3]))));
  return [x0, y0, Math.max(x0 + 1, Math.min(doc.width, Math.ceil(Math.max(r[0], r[2])))), Math.max(y0 + 1, Math.min(doc.height, Math.ceil(Math.max(r[1], r[3]))))];
}

/** FB-059: " · vehicle truck_drive (sprite 12) at 3 m/s" for a zone with a vehicle and / or a speed ('' without). */
export function zoneDrive(z: Pick<Zone, 'vehicle' | 'speed'>): string {
  const v = z.vehicle ? `vehicle ${z.vehicle.name ? `${z.vehicle.name} (sprite ${z.vehicle.spriteId})` : `sprite ${z.vehicle.spriteId}`}` : '';
  const sp = z.speed !== undefined ? `${v ? 'at ' : 'speed '}${z.speed} m/s` : '';
  return v || sp ? ` · ${[v, sp].filter(Boolean).join(' ')}` : '';
}

/** A short summary of a map for listings and tool results. */
export function describeMap(doc: MapBody & { id?: number; projectId?: number; revision?: number }) {
  const count = (t: string) => doc.layers.filter((l) => l.type === t);
  const objects = count('objects').flatMap((l) => (l.type === 'objects' ? l.objects : []));
  const zones = count('zones').flatMap((l) => (l.type === 'zones' ? l.zones : []));
  const terrains = new Map<string, number>();
  for (const l of doc.layers) if (l.type === 'ground') for (let y = 0, base = baseTerrain(l); y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
    const t = cellTerrain(doc, l, x, y, base);
    if (t) terrains.set(t, (terrains.get(t) ?? 0) + 1);
  }
  return {
    ...(doc.id !== undefined ? { id: doc.id } : {}),
    ...(doc.projectId !== undefined ? { projectId: doc.projectId } : {}),
    name: doc.name, orientation: doc.orientation, size: `${doc.width}x${doc.height}`, tile: `${doc.tileWidth}x${doc.tileHeight}`, metresPerTile: doc.metresPerTile,
    tilesets: doc.tilesets,
    ...(doc.revision !== undefined ? { revision: doc.revision } : {}),
    layers: doc.layers.map((l) => `${l.name} (${l.type})`),
    terrainCells: Object.fromEntries(terrains),
    objects: objects.length,
    zones: zones.map((z) => ({
      id: z.id, kind: z.kind, name: z.name, shape: z.shape, points: z.points,
      ...(z.vehicle ? { vehicle: z.vehicle } : {}), ...(z.speed !== undefined ? { speed: z.speed } : {}),
      ...(Object.keys(z.properties ?? {}).length ? { properties: z.properties } : {}),
    })),
    properties: doc.properties,
  };
}
