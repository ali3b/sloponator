// Moved from the old generator's packages/shared/src/map/route-clearance.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import { applyOps, blockedGrid, defaultMapBody, findRoute, type CollisionLayer, type MapBody, type MapOp, type OpsContext, type ZoneLayer } from '../index.js';

/** FB-125: routes with a clearance round what blocks. */

const collision = (m: MapBody) => m.layers.find((l) => l.type === 'collision') as CollisionLayer;
const zones = (m: MapBody) => (m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones;
const ok = (m: MapBody, ops: MapOp[], c?: OpsContext) => {
  const r = applyOps(m, ops, c, { atomic: true });
  expect(r.errors).toEqual([]);
  return r;
};
const wall = (m: MapBody, x: number, ys: number[]) => {
  for (const y of ys) collision(m).cells[y * m.width + x] = 1;
};
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** 30×15 (1 m cells): a wall down column 15 with a one-cell gap at row 7; `wide` also opens rows 11..13. */
function gapMap(wide: boolean): MapBody {
  const m = ok(defaultMapBody('Gap', { width: 30, height: 15, terrain: 'grass' }), [
    { op: 'addZone', id: 'drop', kind: 'spawn', points: [[2, 7]], anchor: 'cell' },
    { op: 'addZone', id: 'airfield', kind: 'objective', name: 'Airfield', points: [[27, 7]], anchor: 'cell' },
  ]).doc;
  wall(m, 15, wide ? [...range(0, 6), ...range(8, 10), 14] : [...range(0, 6), ...range(8, 14)]);
  return m;
}

/**
 * Mission 3's squeeze, with props: a wire (4×1), sandbags and a rock leave a one-cell gap at column 15, row 7,
 * between them (the rest of the column is collision).
 */
function propMap(): MapBody {
  const m = ok(defaultMapBody('Props', { width: 30, height: 15, terrain: 'grass' }), [
    { op: 'addZone', id: 'drop', kind: 'spawn', points: [[2, 7]], anchor: 'cell' },
    { op: 'addZone', id: 'airfield', kind: 'objective', name: 'Airfield', points: [[27, 7]], anchor: 'cell' },
    { op: 'place', id: 'wire', assetRef: 'wire', x: 15.5, y: 5, footprint: { w: 1, h: 4 } },
    { op: 'place', id: 'sandbags', assetRef: 'sandbags', x: 15.5, y: 8.5, footprint: { w: 1, h: 1 } },
    { op: 'place', id: 'rock', assetRef: 'rock', x: 15.5, y: 9.5, footprint: { w: 1, h: 1 } },
  ]).doc;
  wall(m, 15, [0, 1, 2, ...range(10, 14)]);
  return m;
}

describe('FB-125 map route clearance', () => {
  it('clearance 0 squeezes through a one-cell gap; 0.5 m goes round it by the wide gap', () => {
    const m = gapMap(true);
    const bare = findRoute(m, 'drop', 'airfield');
    expect(bare.found).toBe(true);
    expect(bare.cells).toContainEqual([15, 7]);
    expect(bare.clearance).toBeUndefined();
    expect(findRoute(m, 'drop', 'airfield', { clearance: 0 })).toEqual(bare);
    const wide = findRoute(m, 'drop', 'airfield', { clearance: 0.5 });
    expect(wide.found).toBe(true);
    expect(wide.clearance).toBe(0.5);
    expect(wide.cells).not.toContainEqual([15, 7]);
    expect(wide.cells).toContainEqual([15, 12]);
    expect(wide.metres).toBeGreaterThan(bare.metres);
    // No route cell lies beside a blocked one.
    const b = blockedGrid(m);
    for (const [x, y] of wide.cells)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(b[(y + dy) * m.width + x + dx]).toBe(0);
  });

  it('says when there is no route with the clearance, and whether there is one without it', () => {
    const m = gapMap(false);
    const r = findRoute(m, 'drop', 'airfield', { clearance: 0.5 });
    expect(r.found).toBe(false);
    expect(r.withoutClearance).toEqual({ found: true, metres: findRoute(m, 'drop', 'airfield').metres });
    expect(r.reason).toMatch(/^with 0\.5 m clearance: no walkable route: .*; without the clearance there is a route \(25 m\)/);
    // Cut off completely: none without it either.
    wall(m, 15, [7]);
    const none = findRoute(m, 'drop', 'airfield', { clearance: 0.5 });
    expect(none.withoutClearance).toEqual({ found: false });
    expect(none.reason).toMatch(/there is none without the clearance either$/);
  });

  it('inflates object footprints: the prop gap of mission 3 is no way through', () => {
    const m = propMap();
    expect(findRoute(m, 'drop', 'airfield').cells).toContainEqual([15, 7]);
    const r = findRoute(m, 'drop', 'airfield', { clearance: 0.5 });
    expect(r.found).toBe(false);
    expect(r.withoutClearance?.found).toBe(true);
    // Ignoring objects, the column is open at rows 3..9 and the route walks the middle of it.
    expect(findRoute(m, 'drop', 'airfield', { clearance: 0.5, ignoreObjects: true }).found).toBe(true);
  });

  it('counts collision polygons that spill over their cells (with a clearance)', () => {
    // A three-cell gap (rows 7..9) stays open at 0.3 m; a rock at (15, 6) whose polygon reaches y 7.9 closes it.
    const m = ok(defaultMapBody('Poly', { width: 30, height: 15, terrain: 'grass' }), [
      { op: 'addZone', id: 'drop', kind: 'spawn', points: [[2, 8]], anchor: 'cell' },
      { op: 'addZone', id: 'airfield', kind: 'objective', points: [[27, 8]], anchor: 'cell' },
      { op: 'place', id: 'rock', spriteId: 3, x: 15.5, y: 6.5, footprint: { w: 1, h: 1 } },
    ], { sprites: { 3: { name: 'rock', w: 1, d: 1 } } }).doc;
    wall(m, 15, [...range(0, 5), ...range(10, 14)]);
    const polygon = (o: { id: string }): [number, number][] | null => (o.id === 'rock' ? [[-0.5, -0.5], [0.5, -0.5], [0.5, 1.4], [-0.5, 1.4]] : null);
    expect(findRoute(m, 'drop', 'airfield', { clearance: 0.3 }).cells).toContainEqual([15, 8]);
    expect(findRoute(m, 'drop', 'airfield', { clearance: 0.3, collisionPolygon: polygon }).found).toBe(false);
    // Clearance 0 keeps the plain grid (polygons are not counted).
    expect(findRoute(m, 'drop', 'airfield', { collisionPolygon: polygon }).found).toBe(true);
  });

  it('starts beside an end inside the clearance, and refuses bad clearances', () => {
    const m = gapMap(true);
    // Cell (14, 3) is beside the wall: closed by the clearance, so the route starts from the cells round it.
    const r = findRoute(m, '14,3', 'airfield', { clearance: 0.5 });
    expect(r.found).toBe(true);
    expect(r.from.note).toBe('every cell of 14,3 is blocked or inside the clearance; the route starts beside it');
    expect(() => findRoute(m, 'drop', 'airfield', { clearance: -1 })).toThrow(/clearance must be metres ≥ 0/);
    expect(() => findRoute(m, 'drop', 'airfield', { clearance: 100 })).toThrow(/clearance must be at most 16 m/);
  });
});

describe('FB-125 avoidRoute clearance', () => {
  const near: MapOp = { op: 'addZone', id: 'mf', kind: 'trigger', points: [[17.5, 12.5]], avoidRoute: { from: 'drop', to: 'airfield', margin: 1 } };
  const withClearance = (op: MapOp, extra: Record<string, unknown>): MapOp => ({ ...op, avoidRoute: { ...(op as { avoidRoute: object }).avoidRoute, ...extra } } as MapOp);

  it('guards the route a walker with room takes, and says so in the refusal', () => {
    const m = gapMap(true);
    // The bare route runs along row 7: a minefield at (17.5, 12.5) is clear of it ...
    ok(m, [near]);
    // ... but the 0.5 m route goes round by rows 11..13, right past it.
    const r = applyOps(m, [withClearance(near, { clearance: 0.5 })]);
    expect(r.errors[0].message).toMatch(/^zone mf would be .*the route drop→Airfield \(0\.5 m clearance\) at \(\d+, \d+\), inside its 1 m margin/);
  });

  it('works with via chains, legs, at: "end", stored guards and checkRoute', () => {
    const m = ok(gapMap(true), [{ op: 'addZone', id: 'mid', kind: 'custom', points: [[20, 7]], anchor: 'cell' }]).doc;
    // Both legs run round by the wide gap with the clearance; the minefield is on the first.
    ok(m, [{ ...near, avoidRoute: { from: 'drop', via: ['mid'], to: 'airfield', margin: 1 } } as MapOp]);
    expect(applyOps(m, [{ ...near, avoidRoute: { from: 'drop', via: ['mid'], to: 'airfield', margin: 1, clearance: 0.5 } } as MapOp]).errors[0].message).toMatch(/route drop→mid \(0\.5 m clearance\)/);
    expect(applyOps(m, [{ ...near, avoidRoute: { legs: [{ from: 'mid', to: 'airfield' }, { from: 'drop', to: 'mid' }], margin: 1, clearance: 0.5 } } as MapOp]).errors[0].message).toMatch(/route drop→mid \(0\.5 m clearance\)/);
    // at: "end": the wide gap opens later in the batch, so only the finished map's route passes the minefield.
    const late = applyOps(gapMap(false), [
      { ...near, avoidRoute: { from: 'drop', to: 'airfield', margin: 1, clearance: 0.5, at: 'end' } } as MapOp,
      { op: 'rect', layer: 'collision', x0: 15, y0: 11, x1: 15, y1: 13, value: 0 },
    ], undefined, { atomic: true });
    expect(late.errors[0]?.message).toMatch(/at: "end".*route drop→Airfield \(0\.5 m clearance\)/);
    // Stored with its clearance (absent at 0); checkRoute re-checks with it: closing the wide gap leaves no route.
    const placed = ok(gapMap(true), [
      { op: 'addZone', id: 'far', kind: 'trigger', points: [[25.5, 1.5]], avoidRoute: { from: 'drop', to: 'airfield', margin: 1, clearance: 0.5 } },
      { op: 'addZone', id: 'bare', kind: 'trigger', points: [[25.5, 1.5]], avoidRoute: { from: 'drop', to: 'airfield', margin: 1, clearance: 0 } },
      { op: 'checkRoute' },
    ]).doc;
    expect(zones(placed).find((z) => z.id === 'far')!.avoidRoute).toEqual([{ from: 'drop', to: 'airfield', margin: 1, clearance: 0.5 }]);
    expect(zones(placed).find((z) => z.id === 'bare')!.avoidRoute).toEqual([{ from: 'drop', to: 'airfield', margin: 1 }]);
    const check = applyOps(placed, [{ op: 'rect', layer: 'collision', x0: 15, y0: 11, x1: 15, y1: 13, value: 1 }, { op: 'checkRoute' }], undefined, { atomic: true });
    expect(check.errors[0]?.message).toMatch(/^checkRoute: 1 of 2 guarded .*zone far: avoidRoute: with 0\.5 m clearance: no walkable route/);
  });

  it('refuses a guard whose route has no way through at that clearance', () => {
    const m = gapMap(false);
    const r = applyOps(m, [withClearance(near, { clearance: 0.5 })]);
    expect(r.errors[0].message).toMatch(/^avoidRoute: with 0\.5 m clearance: no walkable route: .*without the clearance there is a route \(25 m\)/);
    expect(applyOps(m, [withClearance(near, { clearance: -1 })]).errors[0].message).toMatch(/avoidRoute.clearance must be metres ≥ 0/);
  });
});

/**
 * FB-128: a wood across a 30×15 map, as `scatter` leaves one: 3×3-footprint trees 4 cells apart (x 12.5 / 16.5, y
 * 1.5 / 5.5 / 9.5 / 13.5), so one-cell gaps run between their canopies (columns 11..17), each tree with a 0.5×0.5
 * trunk polygon in its middle.
 */
function woodMap(): MapBody {
  const trees: MapOp[] = [];
  for (const x of [12.5, 16.5]) for (const y of [1.5, 5.5, 9.5, 13.5]) trees.push({ op: 'place', id: `tree_${x}_${y}`, assetRef: 'tree', x, y, footprint: { w: 3, h: 3 } });
  return ok(defaultMapBody('Wood', { width: 30, height: 15, terrain: 'grass' }), [
    { op: 'addZone', id: 'drop', kind: 'spawn', points: [[2, 7]], anchor: 'cell' },
    { op: 'addZone', id: 'airfield', kind: 'objective', name: 'Airfield', points: [[27, 7]], anchor: 'cell' },
    ...trees,
  ]).doc;
}
const trunk = (o: { id: string }): [number, number][] | null => (o.id.startsWith('tree') ? [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]] : null);
const trunkCells = [12, 16].flatMap((x) => [1, 5, 9, 13].map((y) => [x, y]));

describe('FB-128 clearance from collision polygons', () => {
  it('a wood of 3×3-footprint trees with trunk polygons is passable at 0.5 m, kept off the trunks', () => {
    const m = woodMap();
    // Clearance 0 is the footprint grid as before, polygons or not: through the one-cell gaps between canopies.
    const bare = findRoute(m, 'drop', 'airfield');
    expect(bare.found).toBe(true);
    expect(findRoute(m, 'drop', 'airfield', { collisionPolygon: trunk })).toEqual(bare);
    expect(blockedGrid(m, { collisionPolygon: trunk })).toEqual(blockedGrid(m));
    // Footprints only (no polygons known): 0.5 m shuts every gap, the wood is a wall (FB-128's bug, still the
    // behaviour for objects without a polygon).
    const walled = findRoute(m, 'drop', 'airfield', { clearance: 0.5 });
    expect(walled.found).toBe(false);
    expect(walled.withoutClearance).toEqual({ found: true, metres: bare.metres });
    // With the trunks: straight through the wood, never on or beside a trunk.
    const r = findRoute(m, 'drop', 'airfield', { clearance: 0.5, collisionPolygon: trunk });
    expect(r.found).toBe(true);
    expect(r.metres).toBe(25);
    for (const [x, y] of r.cells) for (const [tx, ty] of trunkCells) expect(Math.abs(x - tx) + Math.abs(y - ty)).toBeGreaterThan(1);
    // A footprint cell away from the trunk is open; the trunk's cell and those beside it are not.
    const b = blockedGrid(m, { clearance: 0.5, collisionPolygon: trunk });
    expect(b[0 * 30 + 11]).toBe(0);
    expect([b[1 * 30 + 12], b[1 * 30 + 11], b[1 * 30 + 13], b[0 * 30 + 12], b[2 * 30 + 12]]).toEqual([1, 1, 1, 1, 1]);
  });

  it('objects without a polygon keep their footprint: a one-cell gap between them stays shut', () => {
    // Two wall objects (no polygon) across column 22 leave a one-cell gap at row 7, beyond the wood.
    const m = ok(woodMap(), [
      { op: 'place', id: 'wall_n', assetRef: 'wall', x: 22.5, y: 3.5, footprint: { w: 1, h: 7 } },
      { op: 'place', id: 'wall_s', assetRef: 'wall', x: 22.5, y: 11.5, footprint: { w: 1, h: 7 } },
    ]).doc;
    expect(findRoute(m, 'drop', 'airfield').cells).toContainEqual([22, 7]);
    const r = findRoute(m, 'drop', 'airfield', { clearance: 0.5, collisionPolygon: trunk });
    expect(r.found).toBe(false);
    expect(r.withoutClearance?.found).toBe(true);
    // The prop squeeze of mission 3 (wire, sandbags, rock: no polygons) is still no way through at 0.5 m.
    const props = propMap();
    expect(findRoute(props, 'drop', 'airfield', { clearance: 0.5, collisionPolygon: () => null }).found).toBe(false);
    expect(findRoute(props, 'drop', 'airfield', { collisionPolygon: () => null }).cells).toContainEqual([15, 7]);
  });

  it('a polygon closes the cells it overlaps, however small the clearance', () => {
    const m = ok(defaultMapBody('Tiny', { width: 10, height: 5, terrain: 'grass' }), [{ op: 'place', id: 'twig', assetRef: 'twig', x: 4.5, y: 2.5, footprint: { w: 1, h: 1 } }]).doc;
    // A sliver in the cell's corner, ~0.6 cells from its centre: further than 0.5 + 0.05, but inside the cell.
    const corner = (): [number, number][] => [[0.4, 0.4], [0.48, 0.4], [0.48, 0.48], [0.4, 0.48]];
    const b = blockedGrid(m, { clearance: 0.05, collisionPolygon: corner });
    expect(b[2 * 10 + 4]).toBe(1);
    expect([...b].filter(Boolean).length).toBe(1);
  });

  it('avoidRoute guards and checkRoute measure from the polygons in the context', () => {
    const m = woodMap();
    const guard: MapOp = { op: 'addZone', id: 'mf', kind: 'trigger', points: [[25.5, 1.5]], avoidRoute: { from: 'drop', to: 'airfield', margin: 1, clearance: 0.5 } };
    // Without polygons the guard finds no route at 0.5 m; with the trunks it does, and checkRoute re-checks it.
    expect(applyOps(m, [guard]).errors[0].message).toMatch(/^avoidRoute: with 0\.5 m clearance: no walkable route/);
    const ctx: OpsContext = { collisionPolygon: trunk };
    const placed = ok(m, [guard, { op: 'checkRoute' }], ctx).doc;
    expect(zones(placed).find((z) => z.id === 'mf')!.avoidRoute).toEqual([{ from: 'drop', to: 'airfield', margin: 1, clearance: 0.5 }]);
    expect(applyOps(placed, [{ op: 'checkRoute' }], ctx).errors).toEqual([]);
    expect(applyOps(placed, [{ op: 'checkRoute' }]).errors[0]?.message).toMatch(/^checkRoute: 1 of 1 guarded .*no walkable route/);
  });
});
