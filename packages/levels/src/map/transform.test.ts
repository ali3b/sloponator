// Moved from the old generator's packages/shared/src/map/transform.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, applyOps, boxTransform, defaultMapBody, defaultTilesetBody, MAP_OPS, resizeOffset, transformFacing, validateMap,
  type CollisionLayer, type DecorationLayer, type GroundLayer, type MapBody, type MapOp, type ObjectLayer, type OpsContext, type ZoneLayer,
} from '../index.js';

/** FB-063 (resize with an anchor) and FB-068 (mirror / rotate the map or a region). */
const tileset = () => {
  let b = defaultTilesetBody('Temperate');
  for (const name of ['Grass', 'Dirt', 'Sand']) b = addTerrain(b, { name }).body;
  return addWangset(b, { pairs: [['grass', 'dirt'], ['grass', 'sand']] }).body;
};
const ctx: OpsContext = { tilesets: [tileset()] };
const map = (w = 10, h = 8, orientation: MapBody['orientation'] = 'isometric') => defaultMapBody('T', { width: w, height: h, tilesets: [3], terrain: 'grass', orientation });
const ground = (m: MapBody) => m.layers.find((l) => l.type === 'ground') as GroundLayer;
const deco = (m: MapBody) => m.layers.find((l) => l.type === 'decoration') as DecorationLayer;
const coll = (m: MapBody) => m.layers.find((l) => l.type === 'collision') as CollisionLayer;
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const zones = (m: MapBody) => (m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones;
const run = (m: MapBody, ops: MapOp[], c: OpsContext = ctx) => {
  const r = applyOps(m, ops, c);
  expect(r.errors).toEqual([]);
  return r;
};
const ok = (m: MapBody, ops: MapOp[], c: OpsContext = ctx) => run(m, ops, c).doc;
const errorOf = (m: MapBody, op: MapOp, c: OpsContext = ctx) => applyOps(m, [op], c).errors[0]?.message;
const corner = (m: MapBody, x: number, y: number) => ground(m).corners[y * (m.width + 1) + x];
const cell = (m: MapBody, x: number, y: number) => coll(m).cells[y * m.width + x];

/** A 10×8 map with a dirt block, a blocked cell, decoration, objects (one 2×1) and zones of every shape. */
const built = (orientation: MapBody['orientation'] = 'isometric') =>
  ok(map(10, 8, orientation), [
    { op: 'rect', terrain: 'dirt', x0: 1, y0: 1, x1: 2, y1: 1 },
    { op: 'rect', value: true, x0: 0, y0: 0, x1: 0, y1: 0 },
    { op: 'rect', tile: 5, x0: 9, y0: 7, x1: 9, y1: 7 },
    { op: 'place', id: 'crate', assetRef: 'Crate', x: 1.5, y: 6.5, footprint: { w: 1, h: 1 }, facing: 'SE' },
    { op: 'place', id: 'truck', assetRef: 'Truck', x: 8, y: 2.5, footprint: { w: 2, h: 1 }, facing: 'SE' },
    { op: 'addZone', id: 'drop', kind: 'spawn', points: [[0.5, 0.5]] },
    { op: 'addZone', id: 'obj', kind: 'objective', points: [[6, 4], [10, 8]] },
    { op: 'addZone', id: 'route', kind: 'patrol', points: [[1, 1], [5, 1], [5, 5]] },
    { op: 'addZone', id: 'area', kind: 'trigger', shape: 'polygon', points: [[2, 2], [4, 2], [3, 4]] },
  ]);

describe('resize (FB-063)', () => {
  it('is a map op', () => expect(MAP_OPS).toEqual(expect.arrayContaining(['resize', 'transform'])));

  it('offsets follow the anchor', () => {
    const from = { width: 10, height: 8 }, to = { width: 16, height: 12 };
    expect(resizeOffset('nw', from, to)).toEqual([0, 0]);
    expect(resizeOffset('se', from, to)).toEqual([6, 4]);
    expect(resizeOffset('centre', from, to)).toEqual([3, 2]);
    expect(resizeOffset('n', from, to)).toEqual([3, 0]);
    expect(resizeOffset('w', from, to)).toEqual([0, 2]);
    expect(resizeOffset('se', from, { width: 6, height: 6 })).toEqual([-4, -2]);
  });

  it('grows around the centre: everything shifts, new ground is the fill', () => {
    const m = built();
    const r = run(m, [{ op: 'resize', width: 14, height: 12, anchor: 'centre', fill: 'sand' }]);
    const d = r.doc;
    expect([d.width, d.height]).toEqual([14, 12]);
    expect(ground(d).corners).toHaveLength(15 * 13);
    expect(coll(d).cells).toHaveLength(14 * 12);
    expect(corner(d, 0, 0)).toBe('sand');
    expect(corner(d, 2 + 1, 2 + 1)).toBe('dirt'); // old corner (1, 1)
    expect(cell(d, 2, 2)).toBe(1); // old cell (0, 0)
    expect(deco(d).cells[(7 + 2) * 14 + 9 + 2]).toBe(5);
    expect(objects(d).find((o) => o.id === 'truck')).toMatchObject({ x: 10, y: 4.5 });
    expect(zones(d).find((z) => z.id === 'obj')!.points).toEqual([[8, 6], [12, 10]]);
    expect(r.reports[0]).toMatchObject({ op: 'resize', size: '14x12', from: '10x8', anchor: 'centre', offset: [2, 2], fill: { ground: 'sand' } });
    expect(validateMap(d)).toEqual([]);
  });

  it('accepts aliases and an explicit offset; the default fill is the border terrain', () => {
    const d = ok(built(), [{ op: 'resize', width: 12, height: 8, anchor: 'top-right' }]);
    expect(objects(d).find((o) => o.id === 'crate')).toMatchObject({ x: 3.5, y: 6.5 });
    expect(corner(d, 0, 0)).toBe('grass');
    const e = ok(built(), [{ op: 'resize', width: 12, height: 10, offset: [1, 2] }]);
    expect(cell(e, 1, 2)).toBe(1);
  });

  it('shrinks: drops and reports what falls outside, clips rect zones', () => {
    const r = run(built(), [{ op: 'resize', width: 6, height: 6, anchor: 'se' }]);
    const d = r.doc;
    // offset (-4, -2): the crate at (1.5, 6.5) is cut off, the truck (8, 2.5) → (4, 0.5) stays.
    expect(objects(d).map((o) => o.id)).toEqual(['truck']);
    expect(r.reports[0]).toMatchObject({ droppedObjects: 1, droppedCollisionCells: 1 });
    expect(String((r.reports[0].dropped as string[])[0])).toContain('crate');
    // The objective rect [[6,4],[10,8]] → [[2,2],[6,6]] fits; the spawn (0.5, 0.5) and the route leave.
    expect(zones(d).find((z) => z.id === 'obj')!.points).toEqual([[2, 2], [6, 6]]);
    expect(r.reports[0].droppedZones).toBe(3);
    expect(validateMap(d)).toEqual([]);
    // A rect half outside is clipped.
    const c = run(built(), [{ op: 'resize', width: 8, height: 6 }]);
    expect(zones(c.doc).find((z) => z.id === 'obj')!.points).toEqual([[6, 4], [8, 6]]);
    expect(c.reports[0].clippedZones).toEqual(['obj']);
  });

  it('fill "edge" extends the nearest corner', () => {
    const m = ok(map(4, 4), [{ op: 'rect', terrain: 'dirt', x0: 3, y0: 0, x1: 3, y1: 3 }]);
    const d = ok(m, [{ op: 'resize', width: 8, height: 4, fill: 'edge' }]);
    expect(corner(d, 7, 2)).toBe('dirt');
    expect(corner(d, 8, 0)).toBe('dirt');
  });

  it('respects the large-map caps and refuses bad input', () => {
    expect(errorOf(map(), { op: 'resize', width: 513, height: 10 })).toMatch(/1–512/);
    expect(errorOf(map(), { op: 'resize', width: 10, height: 10, anchor: 'up' })).toMatch(/anchor/);
    expect(errorOf(map(), { op: 'resize', width: 10, height: 10, anchor: 'n', offset: [0, 0] })).toMatch(/not both/);
    expect(errorOf(map(), { op: 'resize', width: 10, height: 10, offset: [20, 0] })).toMatch(/outside/);
    expect(errorOf(map(), { op: 'resize', width: 12, height: 10, fill: 'lava' })).toMatch(/no terrain "lava"/);
    expect(ok(map(4, 4), [{ op: 'resize', width: 512, height: 512 }]).width).toBe(512);
  });
});

describe('transform (FB-068)', () => {
  it('box maps: rotate 90 swaps the box, mirror x flips x', () => {
    const r = boxTransform(10, 8, undefined, 90);
    expect([r.w, r.h]).toEqual([8, 10]);
    expect(r.pt(0, 0)).toEqual([8, 0]);
    expect(r.pt(10, 0)).toEqual([8, 10]);
    expect(boxTransform(10, 8, 'x', 0).pt(1, 2)).toEqual([9, 2]);
    expect(boxTransform(10, 8, undefined, 270).pt(0, 0)).toEqual([0, 10]);
  });

  it('facings: iso and orthogonal mirrors, quarter turns', () => {
    expect(transformFacing('SE', 'isometric', 'x', 0)).toBe('NW'); // +x → −x
    expect(transformFacing('SW', 'isometric', 'x', 0)).toBe('SW'); // +y stays
    expect(transformFacing('N', 'isometric', 'x', 0)).toBe('E');
    expect(transformFacing('SW', 'isometric', 'y', 0)).toBe('NE');
    expect(transformFacing('SE', 'isometric', 'y', 0)).toBe('SE');
    expect(transformFacing('E', 'orthogonal', 'x', 0)).toBe('W');
    expect(transformFacing('N', 'orthogonal', 'x', 0)).toBe('N');
    expect(transformFacing('N', 'orthogonal', 'y', 0)).toBe('S');
    expect(transformFacing('SE', 'isometric', undefined, 90)).toBe('SW');
    expect(transformFacing('se', 'isometric', undefined, 180)).toBe('nw');
    expect(transformFacing('down', 'orthogonal', undefined, 270)).toBe('right');
    expect(transformFacing('a045', 'isometric', 'x', 0)).toBe('a045');
    expect(transformFacing('idle', 'isometric', 'x', 90)).toBe('idle');
  });

  it('rotates the whole map by 90: width and height swap, everything turns', () => {
    const r = run(built(), [{ op: 'transform', rotate: 90 }]);
    const d = r.doc;
    expect([d.width, d.height]).toEqual([8, 10]);
    // Cell (x, y) → (H − 1 − y, x); corner (x, y) → (H − x… ) i.e. (8 − y, x).
    expect(cell(d, 7, 0)).toBe(1);
    expect(corner(d, 8 - 1, 1)).toBe('dirt');
    expect(deco(d).cells[9 * 8 + 0]).toBe(5);
    const truck = objects(d).find((o) => o.id === 'truck')!;
    expect(truck).toMatchObject({ x: 5.5, y: 8, footprint: { w: 1, h: 2 }, facing: 'SW' });
    expect(zones(d).find((z) => z.id === 'obj')!.points).toEqual([[0, 6], [4, 10]]);
    expect(zones(d).find((z) => z.id === 'route')!.points).toEqual([[7, 1], [7, 5], [3, 5]]);
    expect(r.reports[0]).toMatchObject({ op: 'transform', rotate: 90, region: 'map', size: '8x10', objects: 2, zones: 4 });
    expect(validateMap(d)).toEqual([]);
  });

  it('four quarter turns and two mirrors are the identity', () => {
    for (const o of ['isometric', 'orthogonal'] as const) {
      const m = built(o);
      const q = ok(m, [1, 2, 3, 4].map(() => ({ op: 'transform', rotate: 90 }) as MapOp));
      expect(q).toEqual(m);
      expect(ok(m, [{ op: 'transform', mirror: 'x' }, { op: 'transform', mirror: 'x' }])).toEqual(m);
      expect(ok(m, [{ op: 'transform', rotate: 180 }, { op: 'transform', mirror: 'x' }, { op: 'transform', mirror: 'y' }])).toEqual(m);
      // Mirror then rotate in one op equals the two ops.
      expect(ok(m, [{ op: 'transform', mirror: 'y', rotate: 270 }])).toEqual(ok(m, [{ op: 'transform', mirror: 'y' }, { op: 'transform', rotate: 270 }]));
    }
  });

  it('mirrors x: west and east swap, facings reflect', () => {
    const d = ok(built(), [{ op: 'transform', mirror: 'x' }]);
    expect(cell(d, 9, 0)).toBe(1);
    expect(corner(d, 10 - 1, 1)).toBe('dirt');
    expect(corner(d, 10 - 3, 2)).toBe('dirt');
    expect(objects(d).find((o) => o.id === 'truck')).toMatchObject({ x: 2, y: 2.5, footprint: { w: 2, h: 1 }, facing: 'NW' });
    expect(zones(d).find((z) => z.id === 'drop')!.points).toEqual([[9.5, 0.5]]);
    expect(zones(d).find((z) => z.id === 'obj')!.points).toEqual([[0, 4], [4, 8]]);
    expect(zones(d).find((z) => z.id === 'area')!.points).toEqual([[8, 2], [6, 2], [7, 4]]);
  });

  it('a sprite without the turned facing takes the one on the same line (2-facing) or the nearest (4-facing)', () => {
    const c: OpsContext = {
      ...ctx,
      sprites: {
        1: { w: 2, d: 1, directions: { SE: { u: 2, v: 1 }, SW: { u: 1, v: 2 } } }, // a fence: 2 facings
        2: { w: 1, d: 1, directions: { N: { u: 1, v: 1 }, E: { u: 1, v: 1 }, S: { u: 1, v: 1 }, W: { u: 1, v: 1 } } }, // 4 facings
      },
    };
    const m = ok(map(10, 8), [
      { op: 'place', id: 'fence', spriteId: 1, facing: 'SE', x: 3, y: 2.5 },
      { op: 'place', id: 'guard', spriteId: 2, facing: 'N', x: 6.5, y: 5.5 },
    ], c);
    const r = run(m, [{ op: 'transform', mirror: 'x' }], c);
    expect(objects(r.doc).find((o) => o.id === 'fence')).toMatchObject({ facing: 'SE', x: 7, y: 2.5, footprint: { w: 2, h: 1 } });
    expect(objects(r.doc).find((o) => o.id === 'guard')).toMatchObject({ facing: 'E', x: 3.5, y: 5.5 });
    expect(String((r.reports[0].warnings as string[])[0])).toMatch(/fence.*no facing "NW".*used SE/);
    // A turn: the fence goes SW with the SW footprint (1×2).
    const t = run(m, [{ op: 'transform', rotate: 90 }], c).doc;
    expect(objects(t).find((o) => o.id === 'fence')).toMatchObject({ facing: 'SW', footprint: { w: 1, h: 2 }, x: 5.5, y: 3 });
    expect(validateMap(t)).toEqual([]);
  });

  it('transforms a region only, leaves zones that cross its edge, and needs a square for quarter turns', () => {
    const m = built();
    const r = run(m, [{ op: 'transform', rotate: 180, rect: [0, 0, 3, 3] }]);
    const d = r.doc;
    expect([d.width, d.height]).toEqual([10, 8]);
    expect(cell(d, 3, 3)).toBe(1);
    expect(cell(d, 0, 0)).toBe(0);
    expect(corner(d, 4 - 1, 4 - 1)).toBe('dirt'); // corner (1, 1) → (3, 3)
    expect(deco(d).cells[7 * 10 + 9]).toBe(5); // outside: unchanged
    expect(objects(d).find((o) => o.id === 'truck')).toMatchObject({ x: 8, y: 2.5 });
    expect(zones(d).find((z) => z.id === 'drop')!.points).toEqual([[3.5, 3.5]]);
    expect(zones(d).find((z) => z.id === 'area')!.points).toEqual([[2, 2], [0, 2], [1, 0]]);
    expect(zones(d).find((z) => z.id === 'route')!.points).toEqual([[1, 1], [5, 1], [5, 5]]);
    expect(r.reports[0]).toMatchObject({ region: [0, 0, 3, 3], zonesLeft: ['route'] });
    expect(errorOf(m, { op: 'transform', rotate: 90, rect: [0, 0, 3, 2] })).toMatch(/square/);
    expect(errorOf(m, { op: 'transform', mirror: 'x', rect: [0, 0, 10, 2] })).toMatch(/not inside/);
    expect(errorOf(m, { op: 'transform' })).toMatch(/needs mirror/);
    expect(errorOf(m, { op: 'transform', rotate: 45 as 90 })).toMatch(/rotate must be/);
    // Quarter turns of a square region round trip.
    expect(ok(m, [1, 2, 3, 4].map(() => ({ op: 'transform', rotate: 90, rect: [2, 1, 6, 5] }) as MapOp))).toEqual(m);
  });

  it('refuses a region move onto another object unless allowOverlap', () => {
    const t = ok(map(10, 8), [
      { op: 'place', id: 'a', assetRef: 'Truck', x: 2, y: 1.5, footprint: { w: 2, h: 1 } }, // cells 1..2 of row 1, anchor in cell 2 (outside region)
      { op: 'place', id: 'b', assetRef: 'Box', x: 1.5, y: 0.5, footprint: { w: 1, h: 1 } }, // cell (1, 0), in region
    ]);
    // Region cells 0..1 × 0..1 turned 180: b → (0.5, 1.5)? (1.5, 0.5) → (2 − 1.5, 2 − 0.5) = (0.5, 1.5): cell (0, 1), free.
    expect(errorOf(t, { op: 'transform', rotate: 180, rect: [0, 0, 1, 1] })).toBeUndefined();
    // Mirror y of that region: b → (1.5, 1.5) = cell (1, 1), under a (cells 1..2 of row 1).
    expect(errorOf(t, { op: 'transform', mirror: 'y', rect: [0, 0, 1, 1] })).toMatch(/b would overlap a/);
    expect(objects(ok(t, [{ op: 'transform', mirror: 'y', rect: [0, 0, 1, 1], allowOverlap: true }])).find((o) => o.id === 'b')).toMatchObject({ x: 1.5, y: 1.5 });
  });
});
