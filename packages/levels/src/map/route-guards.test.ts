// Moved from the old generator's packages/shared/src/map/route-guards.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import { applyOps, defaultMapBody, findRoute, type MapBody, type MapOp, type ObjectLayer, type OpsContext, type ZoneLayer } from '../index.js';

const map = (w: number, h: number) => defaultMapBody('Guards', { width: w, height: h, terrain: 'grass' });
const zones = (m: MapBody) => (m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones;
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const ok = (m: MapBody, ops: MapOp[], c?: OpsContext) => {
  const r = applyOps(m, ops, c, { atomic: true });
  expect(r.errors).toEqual([]);
  return r;
};
const ctx: OpsContext = { sprites: { 7: { name: 'bush', w: 1, d: 1 } } };

/** 40×20, open: drop at cell (2, 2), the radar array over cells 18..19 × 2..3, extraction at cell (38, 17). */
function mission(): MapBody {
  return ok(map(40, 20), [
    { op: 'addZone', id: 'drop', kind: 'spawn', points: [[2, 2]], anchor: 'cell' },
    { op: 'addZone', id: 'objective', kind: 'objective', name: 'Radar array', points: [[18, 2], [20, 4]] },
    { op: 'addZone', id: 'extraction', kind: 'extraction', points: [[38, 17]], anchor: 'cell' },
  ]).doc;
}

describe('FB-122 avoidRoute over several legs, with the distance in the refusal', () => {
  it('a via chain guards every leg and names the leg, the metres and the route cell', () => {
    const m = mission();
    // drop → Radar array runs along row 2; a point 3 cells below cell (10, 2)'s centre is 2.5 m off it.
    const near = applyOps(m, [{ op: 'addZone', id: 'mf', kind: 'trigger', points: [[10.5, 5.5]], avoidRoute: { from: 'drop', via: ['objective'], to: 'extraction', margin: 3 } }]);
    expect(near.errors[0].message).toBe('zone mf would be 2.5 m from the route drop→Radar array at (10, 2), inside its 3 m margin (3 route cells within it)');
    ok(m, [{ op: 'addZone', kind: 'trigger', points: [[10.5, 5.5]], avoidRoute: { from: 'drop', via: ['objective'], to: 'extraction', margin: 2 } }]);
    // A hazard on the second leg only: the one-leg (wave-13) form misses it, the chain refuses it.
    const leg2 = findRoute(m, 'objective', 'extraction');
    const [x, y] = leg2.cells[Math.floor(leg2.cells.length / 2)];
    const hazard: MapOp = { op: 'place', spriteId: 7, x: x + 0.5, y: y + 0.5 };
    ok(m, [{ ...hazard, avoidRoute: { from: 'drop', to: 'objective', margin: 1 } } as MapOp], ctx);
    const chained = applyOps(m, [{ ...hazard, avoidRoute: { from: 'drop', via: ['objective'], to: 'extraction', margin: 1 } } as MapOp], ctx);
    expect(chained.errors[0].message).toMatch(new RegExp(`^o1 at \\(${x + 0.5}, ${y + 0.5}\\) covering 1×1 cells would be on the route Radar array→extraction at \\(${x}, ${y}\\), inside its 1 m margin`));
  });

  it('takes legs, or a list of guards with their own margins; the stored guard is kept on what it added', () => {
    const m = mission();
    const legs = applyOps(m, [{ op: 'addZone', kind: 'trigger', points: [[10.5, 5.5]], avoidRoute: { legs: [{ from: 'objective', to: 'extraction' }, { from: 'drop', to: 'objective' }], margin: 3 } }]);
    expect(legs.errors[0].message).toMatch(/2\.5 m from the route drop→Radar array at \(10, 2\)/);
    const list = applyOps(m, [{ op: 'addZone', kind: 'trigger', points: [[10.5, 5.5]], avoidRoute: [{ from: 'objective', to: 'extraction', margin: 1 }, { from: 'drop', to: 'objective', margin: 4 }] }]);
    expect(list.errors[0].message).toMatch(/inside its 4 m margin/);
    // Points work as ends and in via.
    const pts = applyOps(m, [{ op: 'addZone', kind: 'trigger', points: [[10.5, 5.5]], avoidRoute: { from: [2.5, 2.5], via: ['19,3'], to: 'extraction', margin: 3 } }]);
    expect(pts.errors[0].message).toMatch(/2\.5 m from the route 2\.5,2\.5→19,3 at \(10, 2\)/);
    const r = ok(m, [{ op: 'addZone', id: 'mf', kind: 'trigger', points: [[10.5, 9.5]], avoidRoute: { from: 'drop', via: ['objective'], to: 'extraction', margin: 2 } }]);
    expect(zones(r.doc).find((z) => z.id === 'mf')!.avoidRoute).toEqual([{ from: 'drop', via: ['objective'], to: 'extraction', margin: 2 }]);
  });

  it('refuses malformed guards', () => {
    const m = mission();
    const err = (avoidRoute: unknown) => applyOps(m, [{ op: 'addZone', kind: 'trigger', points: [[10.5, 9.5]], avoidRoute } as MapOp]).errors[0]?.message;
    expect(err({ from: 'drop' })).toMatch(/avoidRoute must be/);
    expect(err({ from: 'drop', to: 'extraction', via: 'objective' })).toMatch(/avoidRoute.via must be a list/);
    expect(err({ legs: [], margin: 1 })).toMatch(/avoidRoute.legs must be a list/);
    expect(err({ legs: [{ from: 'drop', to: 'objective' }], from: 'drop' })).toMatch(/give legs or from/);
    expect(err({ from: 'drop', to: 'extraction', at: 'later' })).toMatch(/avoidRoute.at must be "op" or "end"/);
    expect(err([])).toMatch(/avoidRoute must be/);
    expect(err({ from: 'drop', via: ['nowhere'], to: 'extraction' })).toMatch(/no zone "nowhere"/);
  });
});

/**
 * 60×40: drop at cell (5, 35), extraction at (55, 35). The batch walls in cells 10..50 × 12..39 (an outline), so the
 * finished route runs round it (down column 9, along row 11); a minefield over 22..38 × 25..30 is then 12 m off it (5 m off the
 * straight route the map had before the wall).
 */
function compound(): MapBody {
  return ok(map(60, 40), [
    { op: 'addZone', id: 'drop', kind: 'spawn', points: [[5, 35]], anchor: 'cell' },
    { op: 'addZone', id: 'extraction', kind: 'extraction', points: [[55, 35]], anchor: 'cell' },
  ]).doc;
}
const minefield = (avoidRoute: unknown): MapOp => ({ op: 'addZone', id: 'mf', kind: 'trigger', name: 'Minefield', points: [[22, 25], [38, 30]], avoidRoute } as MapOp);
const wall: MapOp = { op: 'rect', value: true, outline: true, x0: 10, y0: 12, x1: 50, y1: 39 };
const scatter: MapOp = { op: 'scatter', spriteId: 7, count: 30, spacing: 2, seed: 5, avoidRoute: { from: 'drop', to: 'extraction', margin: 1 } };

describe('FB-123 route guards checked against the finished map', () => {
  it('at: "end" accepts a minefield placed before the walls and scatters that ends up 12–30 m off the final route', () => {
    const m = compound();
    // At the op it is 5 m off the route as it then runs: refused.
    const early = applyOps(m, [minefield({ from: 'drop', to: 'extraction', margin: 10 }), wall, scatter], ctx, { atomic: true });
    expect(early.applied).toBe(0);
    expect(early.errors[0].message).toMatch(/^zone mf \(Minefield\) would be 5 m from the route drop→extraction at \(\d+, 35\), inside its 10 m margin/);
    // Checked at the end, against the walled route, it is 12 m off: accepted.
    const r = ok(m, [minefield({ from: 'drop', to: 'extraction', margin: 10, at: 'end' }), wall, scatter], ctx);
    expect(r.applied).toBe(3);
    expect(findRoute(r.doc, 'drop', 'extraction').cells.some(([, y]) => y === 11)).toBe(true);
    expect(zones(r.doc).find((z) => z.id === 'mf')!.avoidRoute).toEqual([{ from: 'drop', to: 'extraction', margin: 10 }]);
    expect(objects(r.doc).length).toBe(30);
    // A wider margin still refuses the whole batch, with the distance on the finished map.
    const wide = applyOps(m, [minefield({ from: 'drop', to: 'extraction', margin: 20, at: 'end' }), wall, scatter], ctx, { atomic: true });
    expect(wide.applied).toBe(0);
    expect(wide.doc).toBe(m);
    expect(wide.errors).toEqual([{ index: 0, op: 'addZone', message: expect.stringMatching(/^avoidRoute \(at: "end", checked once every op of the batch had applied\): zone mf \(Minefield\) would be 12 m from the route drop→extraction at \(9, \d+\), inside its 20 m margin/) }]);
  });

  it('at: "end" on place, and partial batches drop only what came too close', () => {
    const m = compound();
    const mine: MapOp = { op: 'place', id: 'm1', spriteId: 7, x: 30.5, y: 30.5, avoidRoute: { from: 'drop', to: 'extraction', margin: 10, at: 'end' } };
    ok(m, [mine, wall], ctx);
    const refused = applyOps(m, [mine], ctx, { atomic: true });
    expect(refused.errors[0].message).toMatch(/m1 \(bush\) at \(30\.5, 30\.5\) would be 4 m from the route drop→extraction at \(30, 35\)/);
    const partial = applyOps(m, [mine, { op: 'place', id: 'b2', spriteId: 7, x: 2.5, y: 2.5 }], ctx, { atomic: false });
    expect(partial.applied).toBe(1);
    expect(partial.errors.map((e) => e.index)).toEqual([0]);
    expect(partial.created).toEqual(['b2']);
    expect(objects(partial.doc).map((o) => o.id)).toEqual(['b2']);
  });

  it('checkRoute re-checks every guarded zone and object against the map as it is', () => {
    const r = ok(compound(), [minefield({ from: 'drop', to: 'extraction', margin: 10, at: 'end' }), wall], ctx);
    const fine = ok(r.doc, [{ op: 'checkRoute' }]);
    expect(fine.reports[0]).toMatchObject({ op: 'checkRoute', checked: 1, ids: ['mf'] });
    expect(ok(r.doc, [{ op: 'checkRoute', ids: ['drop'] }]).reports[0]).toMatchObject({ checked: 0, unguarded: ['drop'] });
    expect(applyOps(r.doc, [{ op: 'checkRoute', ids: ['nope'] }]).errors[0].message).toBe('no object or zone "nope"');
    // Gates in the wall bring the route through the minefield: a later batch that ends with checkRoute is refused.
    const gates: MapOp[] = [{ op: 'rect', value: false, x0: 10, y0: 26, x1: 10, y1: 28 }, { op: 'rect', value: false, x0: 50, y0: 26, x1: 50, y1: 28 }];
    const bad = applyOps(r.doc, [...gates, { op: 'checkRoute' }], {}, { atomic: true });
    expect(bad.applied).toBe(0);
    expect(bad.errors[0]).toMatchObject({ index: 2, op: 'checkRoute' });
    expect(bad.errors[0].message).toMatch(/^checkRoute: 1 of 1 guarded zones \/ objects too close to their routes: zone mf \(Minefield\) is on the route drop→extraction at \(\d+, \d+\), inside its 10 m margin/);
  });
});
