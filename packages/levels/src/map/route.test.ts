// Moved from the old generator's packages/shared/src/map/route.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  applyOps, defaultMapBody, findRoute, resizeMap, validateMap,
  type CollisionLayer, type MapBody, type MapOp, type ObjectLayer, type OpsContext,
} from '../index.js';

const map = (w = 20, h = 12, o: Partial<MapBody> = {}) => defaultMapBody('Route', { width: w, height: h, terrain: 'grass', ...o });
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const collision = (m: MapBody) => m.layers.find((l) => l.type === 'collision') as CollisionLayer;
const ok = (m: MapBody, ops: MapOp[], ctx?: OpsContext) => {
  const r = applyOps(m, ops, ctx);
  expect(r.errors).toEqual([]);
  return r;
};

/** 121 mg_nest rendered NE/NW/SW/SE; 7 a 1×1 bush; 8 a 2×2 rock. */
const ctx: OpsContext = {
  sprites: {
    121: { name: 'mg_nest', w: 2, d: 1, directions: { NE: { u: 1, v: 2 }, NW: { u: 2, v: 1 }, SW: { u: 1, v: 2 }, SE: { u: 2, v: 1 } } },
    7: { name: 'bush', w: 1, d: 1 },
    8: { name: 'rock', w: 2, d: 2 },
  },
};

/** A map with a wall down column 10 (rows 0..9), a gap at rows 10–11, and two zones either side. */
function walled(): MapBody {
  return ok(map(), [
    { op: 'rect', value: true, x0: 10, y0: 0, x1: 10, y1: 9 },
    { op: 'addZone', id: 'spawn', kind: 'spawn', name: 'Landing', points: [[2, 2]], anchor: 'cell' },
    { op: 'addZone', id: 'obj', kind: 'objective', name: 'Radar', points: [[16, 2], [18, 4]] },
  ]).doc;
}

describe('FB-110 walkable route', () => {
  it('goes round collision through the gap, shortest, in cells and metres', () => {
    const m = walled();
    const r = findRoute(m, 'spawn', 'obj');
    expect(r.found).toBe(true);
    expect(r.cells[0]).toEqual([2, 2]);
    const last = r.cells.at(-1)!;
    expect(last[0] >= 16 && last[0] <= 17 && last[1] >= 2 && last[1] <= 3).toBe(true);
    // Never on a blocked cell; it crosses column 10 in the gap only.
    for (const [x, y] of r.cells) expect(collision(m).cells[y * m.width + x]).toBe(0);
    expect(r.cells.filter(([x]) => x === 10).every(([, y]) => y >= 10)).toBe(true);
    expect(r.steps).toBe(r.cells.length - 1);
    expect(r.metres).toBeCloseTo(r.lengthCells * m.metresPerTile, 1);
    expect(r.waypoints[0]).toEqual([2.5, 2.5]);
    // By zone name, and with the scale: metres follow metresPerTile.
    const r2 = findRoute({ ...m, metresPerTile: 2 }, 'landing', 'Radar');
    expect(r2.lengthCells).toBe(r.lengthCells);
    expect(r2.metres).toBeCloseTo(r.lengthCells * 2, 1);
    // Without diagonals the route is longer (Manhattan).
    expect(findRoute(m, 'spawn', 'obj', { diagonal: false }).lengthCells).toBeGreaterThan(r.lengthCells);
  });

  it('honours object footprints (not markers), and reports when the far end is cut off', () => {
    let m = walled();
    // Close the gap with a 1×2 block of rocks: no route; a marker in the gap does not block.
    const closed = ok(m, [{ op: 'place', spriteId: 8, x: 10, y: 11 }], ctx).doc;
    const r = findRoute(closed, 'spawn', 'obj');
    expect(r.found).toBe(false);
    expect(r.reason).toMatch(/no walkable route: obj is cut off from spawn/);
    expect(r.closest).toBeDefined();
    expect(findRoute(closed, 'spawn', 'obj', { ignoreObjects: true }).found).toBe(true);
    m = ok(m, [{ op: 'place', spriteId: 8, x: 10, y: 11, collision: false }], ctx).doc;
    expect(findRoute(m, 'spawn', 'obj').found).toBe(true);
  });

  it('takes x,y points, starts beside a blocked zone, and refuses unknown ends', () => {
    const m = ok(walled(), [{ op: 'place', spriteId: 8, x: 3, y: 3 }], ctx).doc; // covers cells 2..3 × 2..3, so the spawn cell
    const r = findRoute(m, 'spawn', '15.5,10.5');
    expect(r.found).toBe(true);
    expect(r.from.note).toMatch(/every cell of spawn is blocked; the route starts beside it/);
    expect(r.cells.at(-1)).toEqual([15, 10]);
    expect(() => findRoute(m, 'nowhere', 'obj')).toThrow(/from: no zone "nowhere" \(zones: spawn, obj; or give x,y\)/);
    expect(() => findRoute(m, [99, 1], 'obj')).toThrow(/outside the 20×12 map/);
  });

  it('avoidRoute keeps place, scatter and addZone off the route', () => {
    const m = walled();
    const route = findRoute(m, 'spawn', 'obj');
    const [cx, cy] = route.cells[Math.floor(route.cells.length / 2)];
    const avoid = { from: 'spawn', to: 'obj', margin: 1 };
    // A mine on the route is refused (and names the route); away from it, fine.
    const bad = applyOps(m, [{ op: 'place', spriteId: 7, x: cx + 0.5, y: cy + 0.5, avoidRoute: avoid }], ctx);
    expect(bad.errors[0].message).toMatch(/^o1 at \(.*\) covering 1×1 cells would be on the route Landing→Radar at \(\d+, \d+\), inside its 1 m margin/);
    const far = route.cells.some(([x, y]) => Math.abs(x - 2) <= 2 && Math.abs(y - 10) <= 2) ? [17, 9] : [2, 10];
    ok(m, [{ op: 'place', spriteId: 7, x: far[0] + 0.5, y: far[1] + 0.5, avoidRoute: avoid }], ctx);
    // A hazard zone over the route is refused.
    expect(applyOps(m, [{ op: 'addZone', kind: 'trigger', points: [[cx, cy], [cx + 1, cy + 1]], avoidRoute: avoid }]).errors[0].message).toMatch(/^zone z1 would be on the route Landing→Radar at \(\d+, \d+\), inside its 1 m margin/);
    // Scatter: nothing within the margin of the route's cells; counted in rejected.route.
    const s = ok(m, [{ op: 'scatter', spriteId: 7, count: 60, spacing: 0, seed: 3, avoidRoute: avoid }], ctx);
    expect((s.reports[0] as unknown as { rejected: Record<string, number> }).rejected.route).toBeGreaterThan(0);
    const cells = new Set(route.cells.map(([x, y]) => `${x},${y}`));
    for (const o of objects(s.doc)) {
      const x = Math.floor(o.x), y = Math.floor(o.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy) <= 1) expect(cells.has(`${x + dx},${y + dy}`)).toBe(false);
    }
    // The route still exists after the scatter.
    expect(findRoute(s.doc, 'spawn', 'obj').found).toBe(true);
    // No route at all: the op says so.
    const shut = ok(m, [{ op: 'rect', value: true, x0: 10, y0: 10, x1: 10, y1: 11 }]).doc;
    expect(applyOps(shut, [{ op: 'place', spriteId: 7, x: 1.5, y: 1.5, avoidRoute: avoid }], ctx).errors[0].message).toMatch(/avoidRoute: no walkable route/);
  });
});

describe('FB-111 place with a facing the sprite lacks', () => {
  it('snaps to the nearest facing it has with a warning naming the sprite', () => {
    const r = ok(map(), [{ op: 'place', spriteId: 121, x: 5, y: 5, facing: 'W' }], ctx);
    expect(objects(r.doc)[0].facing).toMatch(/^(NW|SW)$/);
    expect(r.reports[0]).toMatchObject({ op: 'place', id: 'o1', warnings: [expect.stringMatching(/^mg_nest \(121\) has no facing "W" \(facings: NE, NW, SW, SE\); used (NW|SW)/)] });
    // N → NE or NW; the footprint is the snapped facing's.
    const n = ok(map(), [{ op: 'place', spriteId: 121, x: 5, y: 5, facing: 'E' }], ctx);
    expect(['NE', 'SE']).toContain(objects(n.doc)[0].facing);
    const f = objects(n.doc)[0];
    expect(f.footprint).toEqual(ctx.sprites![121]!.directions![f.facing!] && { w: Math.max(1, ctx.sprites![121]!.directions![f.facing!].u), h: Math.max(1, ctx.sprites![121]!.directions![f.facing!].v) });
    // An atomic batch no longer fails over it.
    const batch = applyOps(map(), [{ op: 'place', spriteId: 121, x: 5, y: 5, facing: 'W' }, { op: 'place', spriteId: 7, x: 1.5, y: 1.5 }], ctx, { atomic: true });
    expect(batch.applied).toBe(2);
    // Moves snap too.
    const mv = ok(r.doc, [{ op: 'move', id: 'o1', facing: 'S' }], ctx);
    expect(['SW', 'SE']).toContain(objects(mv.doc)[0].facing);
    expect(mv.reports[0]).toMatchObject({ op: 'move', warnings: [expect.stringMatching(/mg_nest \(121\) has no facing "S"/)] });
  });

  it('snapFacing: false refuses, naming the sprite by name and id', () => {
    const r = applyOps(map(), [{ op: 'place', spriteId: 121, x: 5, y: 5, facing: 'W', snapFacing: false }], ctx);
    expect(r.errors[0].message).toBe('mg_nest (121) has no facing "W" (facings: NE, NW, SW, SE)');
    // A name the compass doesn't know cannot snap.
    expect(applyOps(map(), [{ op: 'place', spriteId: 121, x: 5, y: 5, facing: 'front' }], ctx).errors[0].message).toMatch(/^mg_nest \(121\) has no facing "front"/);
    expect(applyOps(map(), [{ op: 'place', spriteId: 121, x: 5, y: 5, state: 'wrecked' }], { sprites: { 121: { ...ctx.sprites![121]!, states: ['intact'] } } }).errors[0].message).toMatch(/^mg_nest \(121\) has no state "wrecked"/);
  });
});

describe('FB-120 scatter keeps off a ford', () => {
  /** A river (blocked) down column 9–10, a ford across it at rows 5–6 cleared by a path. */
  function forded() {
    return ok(map(), [
      { op: 'rect', value: true, x0: 9, y0: 0, x1: 10, y1: 11 },
      { op: 'path', points: [[0, 6], [20, 6]], width: 2, collision: false },
    ]).doc;
  }

  it('records the cells a clearing path opened, and scatter rejects them as path', () => {
    const m = forded();
    const c = collision(m);
    expect(c.opened).toBeDefined();
    expect(c.opened!.filter(Boolean).length).toBe(40); // rows 5 and 6 across the map
    expect(validateMap(m)).toEqual([]);
    const s = ok(m, [{ op: 'scatter', spriteId: 7, count: 150, spacing: 0, seed: 1 }], ctx);
    const rep = s.reports[0] as unknown as { rejected: Record<string, number>; placed: number };
    expect(rep.rejected.path).toBeGreaterThan(0);
    for (const o of objects(s.doc)) expect(Math.floor(o.y) === 5 || Math.floor(o.y) === 6).toBe(false);
    // avoidPaths: false scatters over it again.
    const any = ok(m, [{ op: 'scatter', spriteId: 7, count: 150, spacing: 0, seed: 1, avoidPaths: false }], ctx);
    expect(objects(any.doc).some((o) => Math.floor(o.y) === 5 || Math.floor(o.y) === 6)).toBe(true);
    // A 2×2 rock never covers a ford cell either.
    const rocks = ok(m, [{ op: 'scatter', spriteId: 8, count: 30, spacing: 0, seed: 2 }], ctx);
    for (const o of objects(rocks.doc)) expect(o.y - 1 >= 7 || o.y + 1 <= 5).toBe(true);
  });

  it('a later blocking path, a clear and a resize keep the record right; generate leaves the ford alone', () => {
    const m = forded();
    const blocked = ok(m, [{ op: 'path', points: [[0, 6], [20, 6]], width: 2, collision: true }]).doc;
    expect(collision(blocked).opened).toBeUndefined();
    expect(collision(ok(m, [{ op: 'clear', layers: ['collision'] }]).doc).opened).toBeUndefined();
    const bigger = resizeMap(m, 24, 14);
    expect(collision(bigger).opened!.length).toBe(24 * 14);
    expect(validateMap(bigger)).toEqual([]);
    const grown = ok(m, [{ op: 'resize', width: 24, height: 14 }]).doc;
    expect(collision(grown).opened!.filter(Boolean).length).toBe(40);
    // Generate keeps the corners of the opened cells (a sand ford stays sand).
    const sand = ok(m, [{ op: 'rect', terrain: 'sand', x0: 0, y0: 5, x1: 19, y1: 6 }]).doc;
    const g = ok(sand, [{ op: 'generate', biome: { base: 'dirt' }, seed: 1 }]);
    expect(g.reports[0]).toMatchObject({ pathCorners: 21 * 3 });
    const ground = g.doc.layers.find((l) => l.type === 'ground')!;
    expect((ground as { corners: string[] }).corners[6 * 21 + 3]).toBe('sand');
    expect((ground as { corners: string[] }).corners[1 * 21 + 3]).toBe('dirt');
    const all = ok(sand, [{ op: 'generate', biome: { base: 'dirt' }, seed: 1, avoidPaths: false }]);
    expect((all.doc.layers.find((l) => l.type === 'ground') as { corners: string[] }).corners[6 * 21 + 3]).toBe('dirt');
  });
});
