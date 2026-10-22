// Moved from the old generator's packages/shared/src/map/elevation.ts (ali3b/sloponator#17, #18).
import { isCliffCorners, raisedAtPoint } from '../tileset/raster.js';
import { tileExtraHeight, tilesetPpm, type TilesetBody } from '../tileset/types.js';
import { cornerRows, resolveGround } from './resolve.js';
import { splitGid, type GroundLayer, type MapBody } from './types.js';

/**
 * Raised terrain on maps (B4): a ground terrain with height 1 is a plateau one level up. Its cells are drawn by
 * taller tiles (tileset `cliffHeight` pixels above the diamond), objects standing on it are drawn that much higher,
 * and the cells where raised and ground terrains meet are cliffs (blocked by the `cliffs` op, and marked `cliff` in
 * the Tiled tileset with a collision polygon).
 */

type Ts = Pick<TilesetBody, 'terrains' | 'tiles' | 'tileHeight'> & { noisePeriod?: number; cliffHeight?: number };

/**
 * A lookup of the height level (0 or 1) at map points (x, y) (cell units) on the first ground layer: whether the
 * cell's tile shows raised ground there. `raisePx` is how many native map pixels higher an object there is drawn
 * (the tileset's cliff height scaled to the map's tiles; 0 on the ground). Resolves the ground once.
 */
export function elevationLookup(doc: Pick<MapBody, 'width' | 'height' | 'tilesets' | 'layers' | 'tileHeight'>, tilesets: (Ts | null | undefined)[]): (x: number, y: number) => { level: 0 | 1; raisePx: number } {
  const flat = () => ({ level: 0 as const, raisePx: 0 });
  const layer = doc.layers.find((l): l is GroundLayer => l.type === 'ground');
  const ts = layer ? tilesets[layer.tileset ?? 0] : null;
  const E = ts ? tileExtraHeight(ts) : 0;
  if (!layer || !ts || !E) return flat;
  const gids = resolveGround(doc, layer, ts).gids;
  const tiles = new Map(ts.tiles.map((t) => [t.id, t]));
  const raisePx = (E * doc.tileHeight) / ts.tileHeight;
  return (x, y) => {
    const mx = Math.floor(x), my = Math.floor(y);
    if (mx < 0 || my < 0 || mx >= doc.width || my >= doc.height) return flat();
    const id = splitGid(gids[my * doc.width + mx])?.id;
    const tile = id !== undefined ? tiles.get(id) : undefined;
    if (!tile) return flat();
    return raisedAtPoint(ts, tile, Math.min(0.9999, x - mx), Math.min(0.9999, y - my)) ? { level: 1, raisePx } : flat();
  };
}

/**
 * FB-079: how many native map pixels higher an object `metres` above the ground is drawn: the map's pixels per metre
 * times the cosine of the view's pitch (an iso map's tile ratio is the sine of it: 2:1 = 30°; a square orthogonal
 * tile is a straight-down view, which still raises by a quarter so a stacked object stays visible).
 */
export function elevationPx(doc: Pick<MapBody, 'orientation' | 'tileWidth' | 'tileHeight' | 'metresPerTile'>, metres: number): number {
  if (!metres || !(doc.metresPerTile > 0)) return 0;
  const ppm = tilesetPpm(doc);
  const sin = Math.min(1, doc.tileHeight / doc.tileWidth);
  const cos = doc.orientation === 'isometric' ? Math.sqrt(1 - sin * sin) : Math.max(0.25, Math.sqrt(1 - sin * sin));
  return Math.round(metres * ppm * cos * 100) / 100;
}

/** The cells of a ground layer whose corners mix raised and ground terrains (the cliffs), as [x, y]. */
export function cliffCells(doc: Pick<MapBody, 'width' | 'height'>, layer: Pick<GroundLayer, 'corners'>, ts: Pick<TilesetBody, 'terrains'>): [number, number][] {
  if (!ts.terrains.some((t) => (t.height ?? 0) > 0)) return [];
  const rows = cornerRows(doc, layer);
  const out: [number, number][] = [];
  for (let y = 0; y < doc.height; y++)
    for (let x = 0; x < doc.width; x++)
      if (isCliffCorners(ts.terrains, [rows[y][x], rows[y][x + 1], rows[y + 1][x + 1], rows[y + 1][x]])) out.push([x, y]);
  return out;
}
