// Moved from the old generator's packages/shared/src/map/lifecycle.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, anchorPoints, anchorToCentre, applyOps, defaultMapBody, defaultTilesetBody, extractStamp, MAP_OPS, nameSprites, toTiledMapJson,
  type CollisionLayer, type DecorationLayer, type GroundLayer, type MapBody, type MapOp, type ObjectLayer, type OpsContext, type ZoneLayer,
} from '../index.js';

/** FB-034 (the clear op), FB-032 (sprite names in reports, move swaps a sprite) and FB-041 (explicit anchors). */
const tileset = () => {
  let b = defaultTilesetBody('Temperate');
  for (const name of ['Grass', 'Dirt']) b = addTerrain(b, { name }).body;
  return addWangset(b, { pairs: [['grass', 'dirt']] }).body;
};
const ctx: OpsContext = { tilesets: [tileset()] };
const map = (w = 10, h = 8) => defaultMapBody('Lifecycle', { width: w, height: h, tilesets: [3], terrain: 'grass', properties: { climate: 'jungle' } });
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

const built = () =>
  ok(map(), [
    { op: 'rect', terrain: 'dirt', x0: 1, y0: 1, x1: 4, y1: 3 },
    { op: 'paint', tile: 5, x: 2, y: 2 },
    { op: 'paint', value: true, x: 3, y: 3 },
    { op: 'place', assetRef: 'Crate', footprint: { w: 1, h: 1 }, x: 6.5, y: 6.5 },
    { op: 'addZone', kind: 'spawn', points: [[1, 1]] },
  ]);

describe('clear op (FB-034)', () => {
  it('is a map op', () => expect(MAP_OPS).toContain('clear'));

  it('empties every layer, keeps size, tilesets, layers and properties; ground to a terrain (by name) or none', () => {
    const m = built();
    const r = run(m, [{ op: 'clear', terrain: 'Grass' }]);
    const c = r.doc;
    expect([c.width, c.height, c.tilesets, c.properties, c.layers.map((l) => l.name)]).toEqual([m.width, m.height, m.tilesets, m.properties, m.layers.map((l) => l.name)]);
    expect(ground(c).corners.every((t) => t === 'grass')).toBe(true);
    expect(deco(c).cells.every((v) => v === 0)).toBe(true);
    expect(coll(c).cells.every((v) => v === 0)).toBe(true);
    expect(objects(c)).toEqual([]);
    expect(zones(c)).toEqual([]);
    expect(r.reports).toEqual([{ index: 0, op: 'clear', cleared: ['ground', 'decoration', 'objects', 'collision', 'zones'], removedObjects: 1, removedZones: 1, terrain: 'Grass' }]);
    expect(ground(ok(m, [{ op: 'clear' }])).corners.every((t) => t === '')).toBe(true);
  });

  it('only the layers named (types or names); a seeded op list after it fully defines the map', () => {
    const m = built();
    const c = ok(m, [{ op: 'clear', layers: ['objects', 'zones'] }]);
    expect(objects(c)).toEqual([]);
    expect(zones(c)).toEqual([]);
    expect(ground(c).corners).toEqual(ground(m).corners);
    expect(coll(c).cells).toEqual(coll(m).cells);
    expect(deco(ok(m, [{ op: 'clear', layers: ['decoration'] }])).cells.every((v) => v === 0)).toBe(true);
    // Rebuilding from the same list twice gives the same map (ids start again at o1).
    const rebuild: MapOp[] = [{ op: 'clear', terrain: 'grass' }, { op: 'place', assetRef: 'Crate', footprint: { w: 1, h: 1 }, x: 2.5, y: 2.5 }];
    const once = ok(m, rebuild);
    expect(ok(once, rebuild)).toEqual(once);
    expect(objects(once).map((o) => o.id)).toEqual(['o1']);
  });

  it('refuses unknown layers and terrains (nothing changes)', () => {
    expect(errorOf(built(), { op: 'clear', layers: ['trees'] })).toMatch(/no layer "trees"/);
    expect(errorOf(built(), { op: 'clear', terrain: 'lava' })).toMatch(/no terrain "lava"/);
  });
});

describe('sprite names (FB-032)', () => {
  it('reports name "sprite N" labels and keep the ids beside them', () => {
    const r = nameSprites({ placed: 3, byObject: { 'sprite 30': 2, 'sprite 31': 1, Crate: 4 }, skipped: ['sprite 99'] }, { spriteNames: { 30: 'tree_small', 31: 'rock' } });
    expect(r).toEqual({ placed: 3, byObject: { tree_small: 2, rock: 1, Crate: 4 }, skipped: ['sprite 99'], sprites: { tree_small: 30, rock: 31 } });
    expect(nameSprites({ placed: 1 }, {})).toEqual({ placed: 1 });
  });

  it('a scatter of a project sprite reports it by name', () => {
    const c: OpsContext = { ...ctx, sprites: { 30: { w: 1, d: 1 } }, spriteNames: { 30: 'tree_small' } };
    const r = run(map(), [{ op: 'scatter', spriteId: 30, count: 2, spacing: 1, seed: 1 }], c);
    const text = JSON.stringify(r.reports[0]);
    expect(text).toContain('tree_small');
    expect(text).not.toMatch(/"sprite 30"/);
    expect(r.reports[0].sprites).toEqual({ tree_small: 30 });
  });

  it('move swaps the sprite: new footprint, the default name follows, the asset reference goes', () => {
    const c: OpsContext = { ...ctx, sprites: { 1: { w: 1, d: 1, name: 'tree' }, 2: { w: 2, d: 2, name: 'stump' } }, spriteNames: { 1: 'tree', 2: 'stump' } };
    let m = ok(map(), [{ op: 'place', spriteId: 1, x: 3.5, y: 3.5 }, { op: 'place', spriteId: 1, name: 'Old oak', x: 7.5, y: 2.5 }], c);
    m = ok(m, [{ op: 'move', id: 'o1', spriteId: 2 }, { op: 'move', id: 'o2', spriteId: 2, x: 7, y: 3 }], c);
    expect(objects(m)[0]).toMatchObject({ spriteId: 2, name: 'stump', footprint: { w: 2, h: 2 }, x: 4, y: 4 });
    expect(objects(m)[1]).toMatchObject({ spriteId: 2, name: 'Old oak', footprint: { w: 2, h: 2 }, x: 7, y: 3 });
    expect(errorOf(m, { op: 'move', id: 'o1', spriteId: 77 }, c)).toBe('no sprite 77');
  });
});

describe('anchors (FB-041)', () => {
  it('addZone: corner (default) keeps grid points; cell makes a rect inclusive cells like the rect op; centre uses cell centres', () => {
    const m = ok(map(), [
      { op: 'addZone', kind: 'objective', points: [[3, 4], [10, 8]] },
      { op: 'addZone', kind: 'objective', points: [[3, 4], [9, 7]], anchor: 'cell' },
      { op: 'addZone', kind: 'objective', points: [[9, 7], [3, 4]], anchor: 'cell' },
      { op: 'addZone', kind: 'spawn', points: [[2, 3]], anchor: 'cell' },
      { op: 'addZone', kind: 'patrol', points: [[0, 0], [4, 0], [4, 4]], anchor: 'centre' },
    ]);
    expect(zones(m).map((z) => z.points)).toEqual([
      [[3, 4], [10, 8]],
      [[3, 4], [10, 8]],
      [[3, 4], [10, 8]],
      [[2.5, 3.5]],
      [[0.5, 0.5], [4.5, 0.5], [4.5, 4.5]],
    ]);
    // The rect zone over cells 3..9 × 4..7 and the rect op over the same cells cover the same ground (Tiled px too).
    const t = toTiledMapJson(m, { tilesets: [] }).map as { layers: { name: string; objects?: { x: number; y: number; width: number; height: number }[] }[] };
    const zl = t.layers.find((l) => l.name === 'zones')!.objects!;
    expect(zl[1]).toMatchObject({ x: 3 * 32, y: 4 * 32, width: 7 * 32, height: 4 * 32 });
    // editZone takes the anchor too.
    const e = ok(m, [{ op: 'editZone', id: 'z1', points: [[0, 0], [1, 1]], anchor: 'cell' }]);
    expect(zones(e)[0].points).toEqual([[0, 0], [2, 2]]);
  });

  it('place / move: centre (default) is the footprint centre; cell and corner its top-left', () => {
    const fp = { w: 2, h: 1 };
    const m = ok(map(), [
      { op: 'place', assetRef: 'A', footprint: fp, x: 4, y: 2.5 },
      { op: 'place', assetRef: 'B', footprint: fp, x: 0, y: 0, anchor: 'cell' },
      { op: 'place', assetRef: 'C', footprint: fp, x: 6, y: 6, anchor: 'corner' },
      { op: 'place', assetRef: 'D', x: 8, y: 1, anchor: 'cell' },
    ]);
    expect(objects(m).map((o) => [o.x, o.y])).toEqual([[4, 2.5], [1, 0.5], [7, 6.5], [8.5, 1.5]]);
    expect(objects(ok(m, [{ op: 'move', id: 'o1', x: 2, y: 4, anchor: 'cell' }]))[0]).toMatchObject({ x: 3, y: 4.5 });
    expect(anchorToCentre(2.7, 3.2, 'cell', { w: 3, h: 3 })).toEqual([3.5, 4.5]);
    expect(errorOf(map(), { op: 'place', assetRef: 'A', x: 1, y: 1, anchor: 'middle' as 'cell' })).toMatch(/anchor must be one of cell, corner, centre/);
  });

  it('stamp: cell (default) = top-left cell, centre = centre: true; path: centre runs through cell centres', () => {
    const src = ok(map(), [{ op: 'place', assetRef: 'Hut', footprint: { w: 1, h: 1 }, x: 1.5, y: 1.5 }]);
    const s = extractStamp(src, [1, 1, 2, 2], { name: 'Hut' });
    const at = (op: Partial<Extract<MapOp, { op: 'stamp' }>>) => objects(ok(map(), [{ op: 'stamp', stamp: s, x: 4, y: 4, ...op }])).map((o) => [o.x, o.y]);
    expect(at({ anchor: 'cell' })).toEqual(at({}));
    expect(at({ anchor: 'centre' })).toEqual(at({ centre: true }));
    expect(errorOf(map(), { op: 'stamp', stamp: s, x: 4, y: 4, anchor: 'cell', centre: true })).toMatch(/disagree/);
    expect(anchorPoints([[2, 0], [2, 7]], 'centre')).toEqual([[2.5, 0.5], [2.5, 7.5]]);
    const a = ok(map(), [{ op: 'path', points: [[2.5, 0.5], [2.5, 7.5]], terrain: 'dirt', width: 1, smooth: false }]);
    const b = ok(map(), [{ op: 'path', points: [[2, 0], [2, 7]], terrain: 'dirt', width: 1, smooth: false, anchor: 'centre' }]);
    expect(ground(b).corners).toEqual(ground(a).corners);
  });
});
