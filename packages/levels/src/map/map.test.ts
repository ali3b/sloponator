// Moved from the old generator's packages/shared/src/map/map.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, applyOps, footprintFromObject, cellOrigin, cornerRows, defaultMapBody, defaultTilesetBody, describeMap, footprintFor, GID_STRIDE, linePoints, mapGid,
  mapOverview, resizeMap, resolveGround, snapAxis, splitGid, tileObjectPosition, toTiledMapJson, toTiledPx, validateMap, writeTmj, writeTmx,
  type CollisionLayer, type DecorationLayer, type GroundLayer, type MapBody, type MapOp, type ObjectLayer, type OpsContext, type TilesetBody, type ZoneLayer,
} from '../index.js';

const tileset = (): TilesetBody => {
  let b = defaultTilesetBody('Jungle ground');
  b = addTerrain(b, { name: 'Grass' }).body;
  b = addTerrain(b, { name: 'Dirt' }).body;
  return addWangset(b, { pairs: [['grass', 'dirt']] }).body;
};
const map = (w = 8, h = 6, o: Partial<MapBody> = {}) => defaultMapBody('Drop zone', { width: w, height: h, tilesets: [7], terrain: 'grass', ...o });
const ground = (m: MapBody) => m.layers.find((l) => l.type === 'ground') as GroundLayer;
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const zones = (m: MapBody) => (m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones;
const ok = (m: MapBody, ops: MapOp[], ctx?: OpsContext) => {
  const r = applyOps(m, ops, ctx);
  expect(r.errors).toEqual([]);
  return r.doc;
};
const corner = (m: MapBody, x: number, y: number) => ground(m).corners[y * (m.width + 1) + x];

describe('map model', () => {
  it('default body: corner-based ground, the usual layers, valid', () => {
    const m = map();
    expect(ground(m).corners.length).toBe(9 * 7);
    expect(m.layers.map((l) => l.type)).toEqual(['ground', 'decoration', 'objects', 'collision', 'zones']);
    expect(m.tileHeight).toBe(32);
    expect(validateMap(m)).toEqual([]);
    expect(validateMap({ ...m, width: 0 })[0]).toMatch(/width and height/);
    expect(validateMap({ ...m, layers: [{ ...ground(m), corners: [] }] })[0]).toMatch(/corners must be 63/);
  });

  it('map gids: a fixed range per tileset slot', () => {
    expect(mapGid(0, 0)).toBe(1);
    expect(mapGid(1, 5)).toBe(GID_STRIDE + 6);
    expect(splitGid(GID_STRIDE + 6)).toEqual({ slot: 1, id: 5 });
    expect(splitGid(0)).toBeNull();
  });
});

describe('map ops: brushes', () => {
  it('paint a cell sets its four corners; corner mode one corner; radius paints a disc', () => {
    let m = ok(map(), [{ op: 'paint', terrain: 'dirt', x: 2, y: 3 }]);
    expect([corner(m, 2, 3), corner(m, 3, 3), corner(m, 3, 4), corner(m, 2, 4)]).toEqual(['dirt', 'dirt', 'dirt', 'dirt']);
    expect(ground(m).corners.filter((c) => c === 'dirt').length).toBe(4);
    m = ok(map(), [{ op: 'paint', terrain: 'dirt', x: 4, y: 4, mode: 'corner' }]);
    expect(ground(m).corners.filter((c) => c === 'dirt').length).toBe(1);
    m = ok(map(), [{ op: 'paint', terrain: 'dirt', x: 3, y: 3, radius: 1, mode: 'corner' }]);
    expect(ground(m).corners.filter((c) => c === 'dirt').length).toBe(5);
    // Partly off the map: clipped. Fully off: an error, nothing changes.
    m = ok(map(), [{ op: 'paint', terrain: 'dirt', x: 0, y: 0, radius: 1, mode: 'corner' }]);
    expect(ground(m).corners.filter((c) => c === 'dirt').length).toBe(3);
    const r = applyOps(map(), [{ op: 'paint', terrain: 'dirt', x: 40, y: 40 }]);
    expect(r.errors[0]).toMatchObject({ index: 0, op: 'paint', message: expect.stringMatching(/outside the map/) });
    expect(r.doc).toEqual(map());
  });

  it('terrain names resolve against the ground tileset when it is known', () => {
    const ctx: OpsContext = { tilesets: [tileset()] };
    const m = ok(map(), [{ op: 'paint', terrain: 'Dirt', x: 1, y: 1 }], ctx);
    expect(corner(m, 1, 1)).toBe('dirt');
    expect(applyOps(map(), [{ op: 'paint', terrain: 'lava', x: 1, y: 1 }], ctx).errors[0].message).toMatch(/no terrain "lava".*grass, dirt/);
  });

  it('fill floods connected corners of the same terrain', () => {
    // A dirt ring of corners splits the grid; filling inside stays inside.
    let m = ok(map(8, 8), [{ op: 'rect', terrain: 'dirt', x0: 2, y0: 2, x1: 6, y1: 6, outline: true, mode: 'corner' }]);
    m = ok(m, [{ op: 'fill', terrain: 'sand', x: 4, y: 4 }]);
    expect(ground(m).corners.filter((c) => c === 'sand').length).toBe(9);
    expect(corner(m, 0, 0)).toBe('grass');
    m = ok(m, [{ op: 'fill', terrain: 'water', x: 0, y: 0 }]);
    expect(ground(m).corners.filter((c) => c === 'water').length).toBe(81 - 25);
    expect(applyOps(m, [{ op: 'fill', terrain: 'dirt', x: -1, y: 0 }]).errors[0].message).toMatch(/outside/);
  });

  it('rect fills cells (inclusive) or draws an outline; line is Bresenham with a radius', () => {
    let m = ok(map(), [{ op: 'rect', terrain: 'dirt', x0: 1, y0: 1, x1: 2, y1: 2 }]);
    expect(ground(m).corners.filter((c) => c === 'dirt').length).toBe(9); // 2×2 cells = 3×3 corners
    expect(linePoints(0, 0, 3, 1)).toEqual([[0, 0], [1, 0], [2, 1], [3, 1]]);
    m = ok(map(), [{ op: 'line', value: true, x0: 0, y0: 0, x1: 7, y1: 0 }]);
    expect((m.layers[3] as CollisionLayer).cells.slice(0, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    m = ok(map(), [{ op: 'line', tile: 3, x0: 0, y0: 2, x1: 7, y1: 2, radius: 1 }]);
    expect((m.layers[1] as DecorationLayer).cells.filter((c) => c === 3).length).toBe(24);
  });

  it('brush errors: two values, wrong layer, bad gid, corner mode off ground', () => {
    const e = (op: MapOp) => applyOps(map(), [op]).errors[0]?.message;
    expect(e({ op: 'paint', terrain: 'dirt', value: true, x: 0, y: 0 })).toMatch(/one of terrain, tile or value/);
    expect(e({ op: 'paint', terrain: 'dirt', layer: 'collision', x: 0, y: 0 })).toMatch(/collision layer, not ground/);
    expect(e({ op: 'paint', tile: GID_STRIDE + 1, x: 0, y: 0 })).toMatch(/not in any of the map's tilesets/);
    expect(e({ op: 'paint', value: true, mode: 'corner', x: 0, y: 0 })).toMatch(/only for ground/);
    expect(e({ op: 'paint', layer: 'ground', x: 0, y: 0 })).toMatch(/say what to paint/);
    expect(e({ op: 'nope' } as unknown as MapOp)).toMatch(/unknown op "nope"/);
  });
});

describe('map ops: objects', () => {
  const bunker = { name: 'Bunker', w: 3, d: 2, directions: { SE: { u: 3, v: 2 }, SW: { u: 2, v: 3 } }, states: ['intact', 'destroyed'] };
  const ctx: OpsContext = { sprites: { 5: bunker, 6: null } };

  it('snaps to the footprint: odd spans on a cell centre, even on an edge', () => {
    expect(snapAxis(4.2, 3)).toBe(4.5);
    expect(snapAxis(4.7, 2)).toBe(5);
    expect(footprintFor(bunker, 'SW')).toEqual({ w: 2, h: 3 });
    expect(footprintFor(bunker)).toEqual({ w: 3, h: 2 });
    expect(footprintFor({ w: 2, d: 1 }, 'S')).toEqual({ w: 2, h: 1 });
    const r = applyOps(map(), [{ op: 'place', spriteId: 5, x: 3.2, y: 2.9, state: 'intact', facing: 'SE' }], ctx);
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual(['o1']);
    expect(objects(r.doc)[0]).toEqual({ id: 'o1', spriteId: 5, name: 'Bunker', state: 'intact', facing: 'SE', x: 3.5, y: 3, footprint: { w: 3, h: 2 }, properties: {} });
    // Unknown footprint: a point on a cell centre; snap off keeps the float.
    const d = ok(map(), [{ op: 'place', spriteId: 6, x: 1.2, y: 1.9 }, { op: 'place', assetRef: 'POLYGON_War/SM_Prop_Crate_01', x: 2.25, y: 2.75, snap: false }], ctx);
    expect(objects(d).map((o) => [o.id, o.x, o.y, o.footprint])).toEqual([['o1', 1.5, 1.5, undefined], ['o2', 2.25, 2.75, undefined]]);
  });

  it('footprints from an export\'s object block', () => {
    const block = {
      footprint: { w: 5.96, d: 2.2 }, tiles: { w: 6, d: 3, metresPerTile: 1 },
      directions: [{ name: 'SE', tiles: { u: 6, v: 3 } }, { name: 'SW', tiles: { u: 3, v: 6 } }], states: [{ name: 'intact' }, { name: 'destroyed' }],
    };
    expect(footprintFromObject(block, 1, 'Bunker')).toEqual({ name: 'Bunker', w: 6, d: 3, directions: { SE: { u: 6, v: 3 }, SW: { u: 3, v: 6 } }, states: ['intact', 'destroyed'], metres: { w: 5.96, d: 2.2 } });
    // Rendered at another scale (or without a tile lock): metres rounded up to the map's cells.
    expect(footprintFromObject(block, 2)).toEqual({ w: 3, d: 2, states: ['intact', 'destroyed'], metres: { w: 5.96, d: 2.2 } });
    expect(footprintFromObject({ footprint: { w: 2.0004, d: 0.5 }, tiles: null, height: 0.8 }, 1)).toEqual({ w: 2, d: 1, height: 0.8, metres: { w: 2.0004, d: 0.5 } });
    expect(footprintFromObject({}, 1)).toBeNull();
  });

  it('refuses overlaps and out-of-bounds footprints, unknown sprites, states and facings', () => {
    let m = ok(map(), [{ op: 'place', spriteId: 5, x: 3.5, y: 3 }], ctx);
    const e = (op: MapOp, c = ctx) => applyOps(m, [op], c).errors[0]?.message;
    expect(e({ op: 'place', spriteId: 5, x: 4.5, y: 3 })).toMatch(/o2 would overlap o1 \(Bunker\)/);
    expect(e({ op: 'place', spriteId: 5, x: 6.5, y: 3 })).toBeUndefined(); // touching edges is fine
    expect(e({ op: 'place', spriteId: 5, x: 4.5, y: 3, allowOverlap: true })).toBeUndefined();
    expect(e({ op: 'place', spriteId: 5, x: 7.5, y: 3 })).toMatch(/outside the 8×6 map/);
    expect(e({ op: 'place', spriteId: 9, x: 1, y: 1 })).toMatch(/no sprite 9/);
    expect(e({ op: 'place', spriteId: 5, x: 1, y: 1, state: 'burning' })).toMatch(/no state "burning".*intact, destroyed/);
    expect(e({ op: 'place', spriteId: 5, x: 1, y: 1, facing: 'N', snapFacing: false })).toMatch(/no facing "N"/);
    expect(e({ op: 'place', x: 1, y: 1 } as MapOp)).toMatch(/spriteId or an assetRef/);
    expect(e({ op: 'place', id: 'o1', assetRef: 'x', x: 1, y: 1 })).toMatch(/id "o1" is taken/);
    // An explicit footprint wins (sprites the server knows nothing about).
    m = ok(m, [{ op: 'place', assetRef: 'tree', footprint: { w: 1, h: 1 }, x: 0.2, y: 0.2 }], ctx);
    expect(objects(m)[1]).toMatchObject({ x: 0.5, y: 0.5, footprint: { w: 1, h: 1 } });
  });

  it('move (absolute, relative, turning re-reads the footprint), remove, set properties', () => {
    let m = ok(map(), [{ op: 'place', spriteId: 5, x: 3.5, y: 3 }, { op: 'place', assetRef: 'crate', footprint: { w: 1, h: 1 }, x: 0.5, y: 0.5 }], ctx);
    m = ok(m, [{ op: 'move', id: 'o2', dx: 1, dy: 1 }], ctx);
    expect(objects(m)[1]).toMatchObject({ x: 1.5, y: 1.5 });
    expect(applyOps(m, [{ op: 'move', id: 'o2', x: 3, y: 3 }], ctx).errors[0].message).toMatch(/o2 would overlap o1/);
    m = ok(m, [{ op: 'move', id: 'o1', facing: 'SW', state: 'destroyed' }], ctx);
    expect(objects(m)[0]).toMatchObject({ facing: 'SW', state: 'destroyed', footprint: { w: 2, h: 3 }, x: 4, y: 3.5 });
    m = ok(m, [{ op: 'set', id: 'o1', key: 'hp', value: 200 }, { op: 'set', key: 'climate', value: 'jungle' }, { op: 'set', target: 'layer', id: 'ground', key: 'z', value: 0 }]);
    expect(objects(m)[0].properties).toEqual({ hp: 200 });
    expect(m.properties).toEqual({ climate: 'jungle' });
    expect(m.layers[0].properties).toEqual({ z: 0 });
    m = ok(m, [{ op: 'set', id: 'o1', key: 'hp', value: null }, { op: 'remove', id: 'o2' }]);
    expect(objects(m).map((o) => o.id)).toEqual(['o1']);
    expect(objects(m)[0].properties).toEqual({});
    expect(applyOps(m, [{ op: 'remove', id: 'o9' }]).errors[0].message).toMatch(/no object or zone "o9"/);
    expect(applyOps(m, [{ op: 'set', id: 'o1', key: 'bad', value: { a: 1 } as never }]).errors[0].message).toMatch(/string, number, boolean or null/);
  });
});

describe('map ops: zones, layers, batches', () => {
  it('add, edit and remove zones; shapes default from the points', () => {
    let m = ok(map(), [
      { op: 'addZone', kind: 'spawn', name: 'Drop', points: [[1, 1]] },
      { op: 'addZone', kind: 'extraction', points: [[6, 4], [8, 6]], properties: { timer: 120 } },
      { op: 'addZone', kind: 'patrol', points: [[0, 0], [4, 0], [4, 4]] },
      { op: 'addZone', kind: 'objective', points: [[2, 2], [3, 2], [3, 3]] },
    ]);
    expect(zones(m).map((z) => [z.id, z.kind, z.shape, z.name])).toEqual([
      ['z1', 'spawn', 'point', 'Drop'], ['z2', 'extraction', 'rect', 'z2'], ['z3', 'patrol', 'polyline', 'z3'], ['z4', 'objective', 'polygon', 'z4'],
    ]);
    m = ok(m, [{ op: 'editZone', id: 'z2', name: 'Pickup', properties: { heli: true } }, { op: 'removeZone', id: 'z4' }]);
    expect(zones(m)[1]).toMatchObject({ name: 'Pickup', properties: { timer: 120, heli: true } });
    expect(zones(m).length).toBe(3);
    const e = (op: MapOp) => applyOps(m, [op]).errors[0]?.message;
    expect(e({ op: 'addZone', kind: 'spawn', shape: 'rect', points: [[1, 1]] })).toMatch(/rect zone needs 2 points, got 1/);
    expect(e({ op: 'addZone', kind: 'spawn', points: [[10, 1]] })).toMatch(/outside the 8×6 map/);
    expect(e({ op: 'addZone', kind: 'boss' as never, points: [[1, 1]] })).toMatch(/zone kind must be one of/);
    expect(e({ op: 'removeZone', id: 'o1' })).toMatch(/no zone "o1"/);
  });

  it('add and remove layers', () => {
    let m = ok(map(), [{ op: 'addLayer', type: 'objects', name: 'trees' }, { op: 'addLayer', type: 'decoration', name: 'flowers' }]);
    expect(m.layers.map((l) => l.name)).toContain('trees');
    expect((m.layers.at(-1) as DecorationLayer).cells.length).toBe(48);
    m = ok(m, [{ op: 'place', layer: 'trees', assetRef: 'tree', x: 1, y: 1 }, { op: 'removeLayer', name: 'flowers' }]);
    expect(m.layers.map((l) => l.name)).toEqual(['ground', 'decoration', 'objects', 'collision', 'zones', 'trees']);
    expect(applyOps(m, [{ op: 'addLayer', type: 'zones', name: 'trees' }]).errors[0].message).toMatch(/exists/);
    expect(validateMap(m)).toEqual([]);
  });

  it('editLayer hides and shows a layer (stored only when hidden)', () => {
    let m = ok(map(), [{ op: 'editLayer', name: 'collision', visible: false }]);
    expect(m.layers.find((l) => l.name === 'collision')!.visible).toBe(false);
    m = ok(m, [{ op: 'editLayer', name: 'collision', visible: true }]);
    expect('visible' in m.layers.find((l) => l.name === 'collision')!).toBe(false);
    expect(applyOps(m, [{ op: 'editLayer', name: 'nope', visible: false }]).errors[0].message).toMatch(/no layer "nope"/);
    expect(applyOps(m, [{ op: 'editLayer', name: 'ground' }]).errors[0].message).toMatch(/needs a setting/);
    expect(applyOps(m, [{ op: 'editLayer', name: 'ground', visible: 'no' as never }]).errors[0].message).toMatch(/true or false/);
  });

  it('a batch applies the ops that work and reports the others; atomic keeps nothing', () => {
    const ops: MapOp[] = [{ op: 'paint', terrain: 'dirt', x: 0, y: 0 }, { op: 'remove', id: 'nope' }, { op: 'addZone', kind: 'spawn', points: [[1, 1]] }];
    const r = applyOps(map(), ops);
    expect(r.applied).toBe(2);
    expect(r.errors).toEqual([{ index: 1, op: 'remove', message: 'no object or zone "nope"' }]);
    expect(r.created).toEqual(['z1']);
    const a = applyOps(map(), ops, {}, { atomic: true });
    expect(a.applied).toBe(0);
    expect(a.doc).toEqual(map());
    expect(a.errors).toEqual(r.errors);
    // A half-applied op before the failure (a brush that throws midway) still leaves the result clean.
    const half = applyOps(map(), [{ op: 'paint', terrain: 'dirt', x: 0, y: 0 }, { op: 'line', terrain: 'lava', x0: 0, y0: 0, x1: 3, y1: 0 }, { op: 'remove', id: 'x' }], { tilesets: [tileset()] }, { atomic: true });
    expect(half.errors.map((e) => e.index)).toEqual([1, 2]);
    expect(half.doc).toEqual(map());
    // An atomic batch that applies equals the op-by-op result.
    const good: MapOp[] = [ops[0], ops[2], { op: 'place', assetRef: 'crate', x: 3.5, y: 3.5, footprint: { w: 1, h: 1 } }];
    expect(applyOps(map(), good, {}, { atomic: true })).toEqual(applyOps(map(), good));
    // The input is never mutated.
    const m = map();
    applyOps(m, ops);
    applyOps(m, good, {}, { atomic: true });
    expect(m).toEqual(map());
  });

  it('validation finds overlaps once per pair and zones outside the map', () => {
    const m = map();
    objects(m).push({ id: 'a', assetRef: 'x', x: 1, y: 1, footprint: { w: 2, h: 2 }, properties: {} }, { id: 'b', assetRef: 'x', x: 2, y: 2, footprint: { w: 2, h: 2 }, properties: {} });
    zones(m).push({ id: 'z', kind: 'spawn', name: 'z', shape: 'point', points: [[99, 0]], properties: {} });
    expect(validateMap(m)).toEqual(['a would overlap b at (2, 2)', expect.stringMatching(/^z: zone point \(99, 0\) is outside/)]);
  });

  it('resize keeps what fits', () => {
    const m = ok(map(4, 4), [{ op: 'paint', terrain: 'dirt', x: 0, y: 0 }]);
    const r = resizeMap(m, 6, 3, 'sand');
    expect(ground(r).corners.length).toBe(7 * 4);
    expect(cornerRows(r, ground(r))[0]).toEqual(['dirt', 'dirt', 'grass', 'grass', 'grass', 'sand', 'sand']);
    expect(validateMap(r)).toEqual([]);
  });
});

describe('reading a map', () => {
  it('ground resolves to the corner tiles; unknown mixes fall back to the main terrain', () => {
    const t = tileset();
    let m = ok(map(4, 4), [{ op: 'paint', terrain: 'dirt', x: 1, y: 1 }]);
    const g = resolveGround(m, ground(m), t);
    const tileOf = (gid: number) => t.tiles.find((x) => x.id === splitGid(gid)!.id)!.terrainCorners;
    expect(tileOf(g.gids[1 * 4 + 1])).toEqual(['dirt', 'dirt', 'dirt', 'dirt']);
    expect(tileOf(g.gids[0])).toEqual(['grass', 'grass', 'dirt', 'grass']); // cell (0,0): its bottom-right corner is dirt
    expect(tileOf(g.gids[2])).toEqual(['grass', 'grass', 'grass', 'dirt']);
    expect(g.missing).toBe(0);
    m = ok(m, [{ op: 'paint', terrain: 'sand', x: 4, y: 4, mode: 'corner' }]);
    const h = resolveGround(m, ground(m), t);
    expect(h.missing).toBe(1);
    expect(h.missingCombos).toEqual(['grass|grass|sand|grass']);
    expect(tileOf(h.gids[15])).toEqual(['grass', 'grass', 'grass', 'grass']);
  });

  it('a text overview: terrains, objects, zones, collision', () => {
    let m = ok(map(6, 4), [
      { op: 'rect', terrain: 'dirt', x0: 0, y0: 0, x1: 1, y1: 3 },
      { op: 'place', assetRef: 'SM_Bld_Bunker_01', footprint: { w: 2, h: 1 }, x: 4, y: 1.5 },
      { op: 'paint', value: true, x: 5, y: 3 },
      { op: 'addZone', kind: 'spawn', name: 'Drop', points: [[3.5, 3.5]] },
    ]);
    const o = mapOverview(m);
    expect(o.lines).toEqual(['::....', '::.BB.', '::....', '::.0.#']);
    expect(o.legend).toMatchObject({ ':': 'terrain dirt', '.': 'terrain grass', B: 'object SM_Bld_Bunker_01 (o1)', '#': 'blocked (collision)', 0: 'spawn z1 "Drop" point (3.5, 3.5)' });
    m = defaultMapBody('Big', { width: 200, height: 100, terrain: 'grass' });
    const big = mapOverview(m);
    expect(big.scale).toBe(4);
    expect(big.lines.length).toBe(25);
    expect(big.lines[0].length).toBe(50);
    expect(describeMap(ok(map(), [{ op: 'paint', terrain: 'dirt', x: 0, y: 0 }]))).toMatchObject({ size: '8x6', terrainCells: { grass: 47, dirt: 1 }, objects: 0 });
  });
});

describe('Tiled map export', () => {
  /** Tiled's isometric object → screen pixels (MapRenderer::pixelToScreenCoords) for a map of `rows` rows. */
  const isoScreen = (m: MapBody, ox: number, oy: number) => {
    const tx = ox / m.tileHeight, ty = oy / m.tileHeight;
    return [(tx - ty) * (m.tileWidth / 2) + m.height * (m.tileWidth / 2), (tx + ty) * (m.tileHeight / 2)];
  };

  it('isometric object coordinates: tileHeight units on both axes, landing on the cell the renderer draws', () => {
    const m = map(8, 6);
    expect(toTiledPx(m, 2.5, 3.5)).toEqual([80, 112]);
    // The centre of cell (2, 3) in the composed map picture is its diamond's centre.
    const [cx, cy] = cellOrigin(m, 2, 3, m.height);
    expect(isoScreen(m, 80, 112)).toEqual([cx + 32, cy + 16]);
    expect(toTiledPx({ ...m, orientation: 'orthogonal', tileHeight: 64 }, 2.5, 3.5)).toEqual([160, 224]);
  });

  it('tile objects: the picture\'s anchor lands on the object\'s map point', () => {
    const m = map(8, 6);
    const t = { width: 120, height: 90, anchor: { x: 50, y: 70 } };
    const [qx, qy] = tileObjectPosition(m, 3.5, 2, t);
    // Tiled draws an iso tile object with its bottom-centre at the object's screen point.
    const [bx, by] = isoScreen(m, qx, qy);
    const [ax, ay] = isoScreen(m, ...toTiledPx(m, 3.5, 2));
    expect(bx - t.width / 2 + t.anchor.x).toBeCloseTo(ax, 6);
    expect(by - t.height + t.anchor.y).toBeCloseTo(ay, 6);
    const o = { ...m, orientation: 'orthogonal' as const, tileHeight: 64 };
    const [px, py] = tileObjectPosition(o, 3.5, 2, t);
    expect([px + t.anchor.x, py - t.height + t.anchor.y]).toEqual(toTiledPx(o, 3.5, 2));
  });

  const sample = () => {
    const m = ok(map(4, 3), [
      { op: 'paint', terrain: 'dirt', x: 0, y: 0 },
      { op: 'paint', tile: 3, x: 3, y: 2 },
      { op: 'paint', value: true, x: 1, y: 2 },
      { op: 'paint', value: true, x: 2, y: 2 },
      { op: 'place', spriteId: 5, name: 'Bunker', footprint: { w: 2, h: 1 }, state: 'intact', facing: 'SE', x: 2, y: 0.5, properties: { hp: 100 } },
      { op: 'place', assetRef: 'POLYGON_War/SM_Prop_Crate_01', x: 3.5, y: 1.5 },
      { op: 'addZone', kind: 'spawn', name: 'Drop', points: [[0.5, 2.5]], properties: { squad: 'alpha' } },
      { op: 'addZone', kind: 'extraction', name: 'Pickup', points: [[3, 2], [4, 3]], properties: { timer: 90.5 } },
      { op: 'addZone', kind: 'patrol', name: 'Route', points: [[0, 0], [4, 0], [4, 3]] },
      { op: 'addZone', kind: 'trigger', name: 'Mines', points: [[1, 1], [2, 1], [2, 2]] },
      { op: 'set', key: 'mission', value: 'Rescue' },
    ]);
    return m;
  };
  const refs = () => ({ tilesets: [{ body: tileset(), file: 'jungle_ground' }] });

  it('tmj: external tilesets, resolved ground, decoration, typed properties, object and zone shapes', () => {
    const { map: j, warnings } = toTiledMapJson(sample(), refs());
    expect(warnings).toEqual([]);
    expect(j).toMatchObject({ orientation: 'isometric', renderorder: 'right-down', width: 4, height: 3, tilewidth: 64, tileheight: 32, infinite: false, type: 'map', version: '1.10', nextlayerid: 6, nextobjectid: 8 });
    expect(j.tilesets).toEqual([{ firstgid: 1, source: 'jungle_ground.tsj' }]);
    expect(j.properties).toEqual([
      { name: 'metresPerTile', type: 'float', value: 1 },
      { name: 'mission', type: 'string', value: 'Rescue' },
      { name: 'pixelsPerMetre', type: 'float', value: 45.2548 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [g, deco, objs, coll, zs] = j.layers as unknown as Array<Record<string, any>>;
    expect(g).toMatchObject({ type: 'tilelayer', name: 'ground', width: 4, height: 3 });
    const t = tileset();
    const corners = (gid: number) => t.tiles.find((x) => x.id === gid - 1)!.terrainCorners!.join(',');
    expect(corners(g.data[0])).toBe('dirt,dirt,dirt,dirt');
    expect(corners(g.data[1])).toBe('dirt,grass,grass,dirt');
    expect(corners(g.data[5])).toBe('dirt,grass,grass,grass');
    expect(deco.data).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
    expect(objs).toMatchObject({ type: 'objectgroup', class: 'objects', draworder: 'topdown' });
    expect(objs.objects[0]).toEqual({
      height: 0, id: 1, name: 'Bunker', point: true, rotation: 0, type: 'object', visible: true, width: 0, x: 64, y: 16,
      properties: [
        { name: 'anchor', type: 'string', value: 'footprint-centre' },
        { name: 'exportName', type: 'string', value: 'Bunker' },
        { name: 'facing', type: 'string', value: 'SE' },
        { name: 'footprintH', type: 'int', value: 1 },
        { name: 'footprintW', type: 'int', value: 2 },
        { name: 'hp', type: 'int', value: 100 },
        { name: 'mapId', type: 'string', value: 'o1' },
        { name: 'sprite', type: 'string', value: 'Bunker' },
        { name: 'spriteId', type: 'int', value: 5 },
        { name: 'state', type: 'string', value: 'intact' },
      ],
    });
    expect(objs.objects[1]).toMatchObject({ name: 'POLYGON_War/SM_Prop_Crate_01', x: 112, y: 48, point: true });
    expect(coll.objects).toEqual([{ height: 32, id: 3, name: '', rotation: 0, type: 'collision', visible: true, width: 64, x: 32, y: 64 }]);
    expect(zs.objects.map((o: Record<string, unknown>) => [o.type, o.name, o.x, o.y, o.width, o.height, o.point ?? o.polygon ?? o.polyline])).toEqual([
      ['spawn', 'Drop', 16, 80, 0, 0, true],
      ['extraction', 'Pickup', 96, 64, 32, 32, undefined],
      ['patrol', 'Route', 0, 0, 0, 0, [{ x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 96 }]],
      ['trigger', 'Mines', 32, 32, 0, 0, [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }]],
    ]);
    expect(zs.objects[1].properties).toEqual([{ name: 'mapId', type: 'string', value: 'z2' }, { name: 'timer', type: 'float', value: 90.5 }]);
    const text = writeTmj(sample(), refs());
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(j)));
    expect(text).toContain('   "data": [\n    0, 0, 0, 0,\n    0, 0, 0, 0,\n    0, 0, 0, 3\n   ],');
  });

  it('tile objects with gids from an image-collection tileset', () => {
    const { map: j } = toTiledMapJson(sample(), { ...refs(), objectTilesets: [{ file: 'objects', tiles: { '5|intact|': { id: 2, width: 128, height: 96, anchor: { x: 64, y: 80 } } } }] });
    expect(j.tilesets).toEqual([{ firstgid: 1, source: 'jungle_ground.tsj' }, { firstgid: 1 + GID_STRIDE, source: 'objects.tsj' }]);
    const o = (j.layers[2] as { objects: Record<string, unknown>[] }).objects[0];
    expect(o).toMatchObject({ gid: GID_STRIDE + 3, width: 128, height: 96, x: 80, y: 32 });
    expect(o.point).toBeUndefined();
  });

  it('embedded tilesets (Phaser 3 reads only those)', () => {
    const { map: j } = toTiledMapJson(sample(), { ...refs(), embed: true });
    expect(j.tilesets[0]).toMatchObject({ firstgid: 1, name: 'Jungle ground', image: 'jungle_ground.png', tilewidth: 64, tileheight: 32, tilecount: 16, columns: 8 });
    expect('source' in j.tilesets[0]).toBe(false);
    expect((j.tilesets[0] as { wangsets: unknown[] }).wangsets.length).toBe(1);
    const x = writeTmx(sample(), { ...refs(), embed: true });
    expect(x).toContain(' <tileset firstgid="1" name="Jungle ground" tilewidth="64" tileheight="32" tilecount="16" columns="8">\n  <grid orientation="isometric" width="64" height="32"/>');
    expect(x).toContain('  <image source="jungle_ground.png" width="512" height="64"/>');
    expect(x).toMatch(/ <\/tileset>\n <layer id="1"/);
  });

  it('a missing tileset leaves its ground empty with a warning', () => {
    const r = toTiledMapJson(sample(), { tilesets: [null] });
    expect(r.warnings[0]).toMatch(/tileset slot 0 is missing/);
    expect((r.map.layers[0] as { data: number[] }).data.every((v) => v === 0)).toBe(true);
    expect(r.map.tilesets).toEqual([{ firstgid: 1, source: 'tileset_7.tsj' }]);
  });

  it('tmx golden', () => {
    const head = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.10.2" orientation="isometric" renderorder="right-down" width="4" height="3" tilewidth="64" tileheight="32" infinite="0" nextlayerid="6" nextobjectid="8">
 <properties>
  <property name="metresPerTile" type="float" value="1"/>
  <property name="mission" value="Rescue"/>
  <property name="pixelsPerMetre" type="float" value="45.2548"/>
 </properties>
 <tileset firstgid="1" source="jungle_ground.tsx"/>
 <layer id="1" name="ground" width="4" height="3">
  <data encoding="csv">
`;
    expect(writeTmx(sample(), refs())).toBe(head + groundCsv() + '</data>\n </layer>\n' + TMX_REST);
  });
  const groundCsv = () => {
    const { map: j } = toTiledMapJson(sample(), refs());
    const d = (j.layers[0] as { data: number[] }).data;
    return [0, 1, 2].map((y) => d.slice(y * 4, y * 4 + 4).join(',')).join(',\n') + '\n';
  };
  const TMX_REST = ` <layer id="2" name="decoration" width="4" height="3">
  <data encoding="csv">
0,0,0,0,
0,0,0,0,
0,0,0,3
</data>
 </layer>
 <objectgroup id="3" name="objects" class="objects">
  <object id="1" name="Bunker" type="object" x="64" y="16">
   <properties>
    <property name="anchor" value="footprint-centre"/>
    <property name="exportName" value="Bunker"/>
    <property name="facing" value="SE"/>
    <property name="footprintH" type="int" value="1"/>
    <property name="footprintW" type="int" value="2"/>
    <property name="hp" type="int" value="100"/>
    <property name="mapId" value="o1"/>
    <property name="sprite" value="Bunker"/>
    <property name="spriteId" type="int" value="5"/>
    <property name="state" value="intact"/>
   </properties>
   <point/>
  </object>
  <object id="2" name="POLYGON_War/SM_Prop_Crate_01" type="object" x="112" y="48">
   <properties>
    <property name="anchor" value="footprint-centre"/>
    <property name="asset" value="POLYGON_War/SM_Prop_Crate_01"/>
    <property name="assetRef" value="POLYGON_War/SM_Prop_Crate_01"/>
    <property name="mapId" value="o2"/>
   </properties>
   <point/>
  </object>
 </objectgroup>
 <objectgroup id="4" name="collision" class="collision">
  <object id="3" type="collision" x="32" y="64" width="64" height="32"/>
 </objectgroup>
 <objectgroup id="5" name="zones" class="zones">
  <object id="4" name="Drop" type="spawn" x="16" y="80">
   <properties>
    <property name="mapId" value="z1"/>
    <property name="squad" value="alpha"/>
   </properties>
   <point/>
  </object>
  <object id="5" name="Pickup" type="extraction" x="96" y="64" width="32" height="32">
   <properties>
    <property name="mapId" value="z2"/>
    <property name="timer" type="float" value="90.5"/>
   </properties>
  </object>
  <object id="6" name="Route" type="patrol" x="0" y="0">
   <properties>
    <property name="mapId" value="z3"/>
   </properties>
   <polyline points="0,0 128,0 128,96"/>
  </object>
  <object id="7" name="Mines" type="trigger" x="32" y="32">
   <properties>
    <property name="mapId" value="z4"/>
   </properties>
   <polygon points="0,0 32,0 32,32"/>
  </object>
 </objectgroup>
</map>
`;
});
