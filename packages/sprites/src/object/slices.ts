// Moved from synty-sprite-generator packages/shared/src/object/slices.ts (P2, ali3b/sloponator#8).
/**
 * Column slicing for large objects on a diamond (2:1 iso) tile grid. A building bigger than one tile can't be
 * depth-sorted as one sprite: a character standing beside its left wall is in front of that wall but behind its right
 * one. Cutting each frame into vertical strips half a tile wide (one per tile column of the diamond grid) lets an
 * engine sort every strip by its own front ground position, like the tiles of an iso map.
 *
 * Pure maths: the strips are rects into the existing (untrimmed) frame, so no extra images are written.
 *
 * Geometry. The footprint is a block of U × V tiles (the direction's `tiles.u` × `tiles.v`) centred on the anchor.
 * In footprint-local tile coordinates (a along u, b along v, origin at the block's top corner) a ground point is drawn
 * at x = anchor.x + (a − b − (U − V)/2)·W/2, y = anchor.y + (a + b − (U + V)/2)·H/2, with W the tile width in pixels
 * and H = W·sin(pitch) its height (W/2 at the 30° pixel-iso pitch). The block is (U + V)·W/2 wide: U + V strips. The
 * first U strips are the left halves of the front-left row of tiles (b = V − 1), the rest the right halves of the
 * front-right row (a = U − 1), so each strip's front edge is one tile edge of the footprint's front outline.
 */
import type { ObjectSlice, ObjectSlices } from '@slop/formats';
import type { ObjectInfo, Vec2 } from './footprint.js';
// These types are the game-facing contract: defined once in @slop/formats, used and re-exported here.
export type { ObjectSlice, ObjectSlices };

export const SLICES_NOTE =
  'Strips are rects into the untrimmed frame (subtract the trim offset for trimmed atlases), one per tile column of the ' +
  'diamond grid. Draw each strip as its own sprite at the object\'s position and sort it by ground.y (sortY) like ' +
  'a character standing there: map y of the frame top + sortY. tile = the footprint tile (from the block\'s top ' +
  'corner) whose front edge the strip shows.';

const r2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Strips for one direction: a U × V tile block centred on `anchor` in a `frameWidth` × `frameHeight` frame. Strip
 * boundaries are rounded to whole pixels; strips falling outside the frame are dropped.
 */
export function columnStrips(o: {
  anchor: { x: number; y: number };
  u: number;
  v: number;
  tilePx: number;
  /** Camera pitch in degrees (the tile's height is tilePx·sin(pitch)). */
  pitch: number;
  frameWidth: number;
  frameHeight: number;
}): ObjectSlice[] {
  const U = Math.max(1, Math.round(o.u)), V = Math.max(1, Math.round(o.v));
  const hw = o.tilePx / 2, hh = (o.tilePx * Math.sin((Math.min(Math.max(o.pitch, 0), 89.9) * Math.PI) / 180)) / 2;
  const at = (a: number, b: number): Vec2 => [r2(o.anchor.x + (a - b - (U - V) / 2) * hw), r2(o.anchor.y + (a + b - (U + V) / 2) * hh)];
  const n = U + V;
  const left = o.anchor.x - (n / 2) * hw;
  const bound = (k: number) => (k <= 0 ? 0 : k >= n ? o.frameWidth : Math.min(o.frameWidth, Math.max(0, Math.round(left + k * hw))));
  const out: ObjectSlice[] = [];
  for (let k = 0; k < n; k++) {
    const x0 = bound(k), x1 = bound(k + 1);
    if (x1 <= x0) continue;
    const front = k < U
      ? { tile: { u: k, v: V - 1 }, edge: [at(k, V), at(k + 1, V)] as [Vec2, Vec2] }
      : { tile: { u: U - 1, v: V - 1 - (k - U) }, edge: [at(U, V - (k - U)), at(U, V - (k - U) - 1)] as [Vec2, Vec2] };
    const ground = { x: r2((front.edge[0][0] + front.edge[1][0]) / 2), y: r2((front.edge[0][1] + front.edge[1][1]) / 2) };
    out.push({ index: out.length, x: x0, y: 0, w: x1 - x0, h: o.frameHeight, ...front, ground, sortY: ground.y });
  }
  return out;
}

/**
 * The `object.slices` block: column strips for every direction of an object rendered on a diamond tile lock. Null
 * without one (square grids sort fine by the anchor; fit/ppm views have no tile size), or for perspective views.
 */
export function objectSlices(
  info: Pick<ObjectInfo, 'tiles' | 'directions'>,
  view: { pitch: number },
  frame: { frameWidth: number; frameHeight: number },
): ObjectSlices | null {
  const t = info.tiles;
  if (!t || t.shape !== 'diamond' || !info.directions.length) return null;
  const directions = info.directions.map((d) => ({
    name: d.name,
    strips: columnStrips({
      anchor: d.anchor, u: d.tiles?.u ?? t.w, v: d.tiles?.v ?? t.d, tilePx: t.tilePx, pitch: view.pitch,
      frameWidth: frame.frameWidth, frameHeight: frame.frameHeight,
    }),
  }));
  const tileHeightPx = r2(t.tilePx * Math.sin((Math.min(Math.max(view.pitch, 0), 89.9) * Math.PI) / 180));
  return { mode: 'columns', stripPx: t.tilePx / 2, tilePx: t.tilePx, tileHeightPx, directions, note: SLICES_NOTE };
}
