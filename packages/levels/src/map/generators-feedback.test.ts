// Moved from the old generator's packages/shared/src/map/generators-feedback.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, applyOps, defaultMapBody, defaultTilesetBody, extractStamp, pathFacing, rotateStamp, stampGroundMask, validateStamp,
  type CellFootprint, type GroundLayer, type MapBody, type MapOp, type MapStamp, type ObjectLayer, type OpsContext, type TilesetBody,
} from '../index.js';

/** FB-035 (path facings), FB-036 (scatter under-delivery and reasons), FB-037 (stamp facings and ground). */

const tileset = (): TilesetBody => {
  let b = defaultTilesetBody('Temperate');
  for (const name of ['Grass', 'Dirt', 'Sand', 'Water', 'Road', 'Mud']) b = addTerrain(b, { name }).body;
  return addWangset(b, { pairs: [['grass', 'dirt'], ['grass', 'sand'], ['sand', 'water'], ['grass', 'road'], ['grass', 'mud']] }).body;
};
const ctx: OpsContext = { tilesets: [tileset()] };
const map = (w = 8, h = 6, o: Partial<MapBody> = {}) => defaultMapBody('Gen', { width: w, height: h, tilesets: [1], terrain: 'grass', ...o });
const ground = (m: MapBody) => m.layers.find((l) => l.type === 'ground') as GroundLayer;
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const run = (m: MapBody, ops: MapOp[], c: OpsContext = ctx) => {
  const r = applyOps(m, ops, c);
  expect(r.errors).toEqual([]);
  return r;
};
const iso = { orientation: 'isometric' as const };
const ortho = { orientation: 'orthogonal' as const };
const FOUR = ['SE', 'SW', 'NW', 'NE'];
const EIGHT = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];

describe('FB-035: path object facings per segment direction', () => {
  const dirs: Record<string, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] };

  it('iso, 4 facings: along points the front down the path, across at right angles, for each grid axis', () => {
    const along = Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, pathFacing(iso, FOUR, d, 'along')]));
    const across = Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, pathFacing(iso, FOUR, d, 'across')]));
    expect(along).toEqual({ '+x': 'SE', '-x': 'NW', '+y': 'SW', '-y': 'NE' });
    // Across = the along of the direction turned a quarter (left of the path seen on the map: +x → +y).
    expect(across).toEqual({ '+x': 'SW', '-x': 'NE', '+y': 'NW', '-y': 'SE' });
  });

  it('iso, 8 facings: diagonals take the in-between facings', () => {
    const d = (x: number, y: number) => [x / Math.SQRT2, y / Math.SQRT2] as [number, number];
    expect([d(1, 1), d(1, -1), d(-1, 1), d(-1, -1)].map((v) => pathFacing(iso, EIGHT, v, 'along'))).toEqual(['S', 'E', 'W', 'N']);
    expect([d(1, 1), d(1, -1), d(-1, 1), d(-1, -1)].map((v) => pathFacing(iso, EIGHT, v, 'across'))).toEqual(['W', 'S', 'N', 'E']);
    // A shallow slope off the x axis stays SE; past 22.5° on the grid it is S.
    expect(pathFacing(iso, EIGHT, [Math.cos(0.3), Math.sin(0.3)], 'along')).toBe('SE');
    expect(pathFacing(iso, EIGHT, [Math.cos(0.5), Math.sin(0.5)], 'along')).toBe('S');
  });

  it('a 2-facing export (SE, SW): across on a y path is SE, not SW (the opposite facing is the same line)', () => {
    const two = ['SE', 'SW'];
    for (const [k, v] of Object.entries(dirs)) {
      const yPath = k.endsWith('y');
      expect([k, pathFacing(iso, two, v, 'along')]).toEqual([k, yPath ? 'SW' : 'SE']);
      expect([k, pathFacing(iso, two, v, 'across')]).toEqual([k, yPath ? 'SE' : 'SW']);
    }
  });

  it('parallel / perpendicular lay the long side (from per-facing footprints) along / across the path', () => {
    // FB-035's wire: SE covers 1×4 cells (long along y), SW 4×1 (long along x).
    const fp: Record<string, CellFootprint> = { SE: { w: 1, h: 4 }, SW: { w: 4, h: 1 } };
    const f = (n: string) => fp[n];
    expect(pathFacing(iso, ['SE', 'SW'], [0, 1], 'parallel', f)).toBe('SE');
    expect(pathFacing(iso, ['SE', 'SW'], [1, 0], 'parallel', f)).toBe('SW');
    expect(pathFacing(iso, ['SE', 'SW'], [0, 1], 'perpendicular', f)).toBe('SW');
    expect(pathFacing(iso, ['SE', 'SW'], [-1, 0], 'perpendicular', f)).toBe('SE');
    // Without footprints: parallel = across, perpendicular = along.
    expect(pathFacing(iso, FOUR, [0, 1], 'parallel')).toBe('NW');
    expect(pathFacing(iso, FOUR, [0, 1], 'perpendicular')).toBe('SW');
  });

  it('orthogonal maps use the screen axes', () => {
    expect(Object.values(dirs).map((d) => pathFacing(ortho, EIGHT, d, 'along'))).toEqual(['E', 'W', 'S', 'N']);
    expect(Object.values(dirs).map((d) => pathFacing(ortho, ['E', 'N', 'W', 'S'], d, 'across'))).toEqual(['S', 'N', 'W', 'E']);
  });

  it('through the path op: wire down y and along x, across and parallel', () => {
    const sprites: OpsContext['sprites'] = { 3: { name: 'wire', w: 4, d: 1, directions: { SE: { u: 1, v: 4 }, SW: { u: 4, v: 1 } } } };
    const c = { ...ctx, sprites };
    const along = (points: [number, number][], facing: string) => objects(run(map(20, 20), [{ op: 'path', points, smooth: false, objects: [{ spriteId: 3, every: 6, offset: 2, side: 'right', facing }] }], c).doc);
    for (const facing of ['across', 'parallel']) {
      const down = along([[10, 0], [10, 20]], facing);
      expect(down.length).toBeGreaterThan(1);
      expect(new Set(down.map((o) => o.facing))).toEqual(new Set(['SE']));
      expect(down.every((o) => o.footprint!.h === 4)).toBe(true);
      const right = along([[0, 10], [20, 10]], facing);
      expect(new Set(right.map((o) => o.facing))).toEqual(new Set(['SW']));
      expect(right.every((o) => o.footprint!.w === 4)).toBe(true);
    }
    const r = run(map(20, 20), [{ op: 'path', points: [[10, 0], [10, 20]], smooth: false, objects: [{ spriteId: 3, every: 6, facing: 'along' }] }], c);
    expect(new Set(objects(r.doc).map((o) => o.facing))).toEqual(new Set(['SW']));
    // Reports name the sprite.
    expect(r.reports[0].placed).toEqual({ wire: objects(r.doc).length });
  });
});

describe('FB-036: scatter fills its target, reports why not, and is per group', () => {
  // A 48×40 mission like the game's: a river with sand banks, a road, zones, then trees, rocks and big trees.
  const sprites: OpsContext['sprites'] = {
    1: { name: 'tree_small', w: 2, d: 2 },
    2: { name: 'rock', w: 2, d: 2 },
    3: { name: 'tree', w: 6, d: 6 },
  };
  const c = { ...ctx, sprites };
  const avoid = { avoidTerrains: ['water', 'sand', 'road', 'mud'], avoidZones: ['spawn', 'objective', 'extraction', 'patrol', 'custom'], avoidMargin: 1 };
  const base: MapOp[] = [
    { op: 'path', points: [[19, -1], [17.5, 10], [19.5, 20], [18, 30], [19, 41]], terrain: 'water', width: 3, jitter: 1.5, seed: 'river', edge: 'sand', edgeWidth: 2 },
    { op: 'path', points: [[-1, 23], [12, 24], [24, 23.5], [36, 22.5], [49, 23]], terrain: 'road', width: 3, jitter: 0.8, seed: 'road' },
    { op: 'path', points: [[35, -1], [34.5, 8], [35, 19]], terrain: 'mud', width: 1.5, jitter: 0.5, seed: 'trench1' },
    { op: 'path', points: [[37, 31], [42, 30.5], [49, 31]], terrain: 'mud', width: 1.5, jitter: 0.5, seed: 'trench2' },
    // The depot and the three bunker pads.
    { op: 'rect', x0: 37, y0: 3, x1: 46, y1: 17, terrain: 'dirt' },
    { op: 'rect', x0: 23, y0: 8, x1: 32, y1: 19, terrain: 'dirt' },
    { op: 'rect', x0: 25, y0: 27, x1: 34, y1: 38, terrain: 'dirt' },
    { op: 'rect', x0: 3, y0: 27, x1: 14, y1: 36, terrain: 'dirt' },
    { op: 'addZone', kind: 'spawn', points: [[3, 4], [10, 10]] },
    { op: 'addZone', kind: 'objective', points: [[37, 3], [47, 18]] },
    { op: 'addZone', kind: 'extraction', points: [[40, 33], [47, 39]] },
    { op: 'addZone', kind: 'patrol', shape: 'polyline', points: [[36.3, 2], [36.3, 18.8], [47, 18.8], [47, 2], [36.3, 2]] },
    { op: 'addZone', kind: 'patrol', shape: 'polyline', points: [[24, 21], [31, 21], [47, 20.5]] },
    { op: 'addZone', kind: 'patrol', shape: 'polyline', points: [[13, 3], [14, 13], [12, 20], [6, 20]] },
    { op: 'addZone', kind: 'custom', points: [[8.5, 14.5]] },
    { op: 'addZone', kind: 'custom', points: [[27.5, 25.5]] },
    { op: 'addZone', kind: 'custom', points: [[44.5, 26.5]] },
  ];
  const trees: MapOp = { op: 'scatter', seed: 'trees', objects: [{ spriteId: 1 }], density: 3, spacing: 3, cluster: 0.6, clusterScale: 12, ...avoid };
  const rocks: MapOp = { op: 'scatter', seed: 'rocks', objects: [{ spriteId: 2 }], count: 10, spacing: 4, ...avoid };
  const bigTrees: MapOp = { op: 'scatter', seed: 'big-trees', objects: [{ spriteId: 3 }], count: 6, spacing: 6, ...avoid };

  it('trees then rocks: the rocks reach ≥ 90 % of their count; what cannot fit says why', () => {
    const r = run(map(48, 40), [...base, trees, rocks, bigTrees], c);
    const [t, k, b] = r.reports.slice(-3);
    expect(t.placed as number).toBeGreaterThanOrEqual(0.9 * (t.target as number));
    expect(k.placed as number).toBeGreaterThanOrEqual(9);
    // 6×6 trees after everything else: no 6×6 patch of allowed ground is left, and the report says so.
    if ((b.placed as number) < 6) expect(b.short).toMatch(/every spot of the region tried: mostly (terrain|overlap|zone)/);
    // Big trees first (the game's workaround), they all fit, and so does everything after them.
    const first = run(map(48, 40), [...base, bigTrees, rocks, trees], c).reports.slice(-3);
    expect(first.map((x) => x.placed)).toEqual([6, 10, first[2].target]);
    expect(k.byObject).toEqual({ rock: k.placed });
    // Rocks never closer than their spacing to each other, but they may stand next to trees.
    const rk = objects(r.doc).filter((o) => o.spriteId === 2);
    for (let i = 0; i < rk.length; i++) for (let j = i + 1; j < rk.length; j++) expect(Math.hypot(rk[i].x - rk[j].x, rk[i].y - rk[j].y)).toBeGreaterThanOrEqual(4);
    // Either order gives the full rock count.
    const other = run(map(48, 40), [...base, rocks, trees, bigTrees], c).reports.slice(-3);
    expect(other[0].placed).toBe(10);
    // The old rules (spacing to every object, one round of darts) reproduce the shortfall, and now say why.
    const old = run(map(48, 40), [...base, { ...trees, retries: 0 }, { ...rocks, spacingOther: 4, retries: 0 }], c).reports.at(-1)!;
    expect(old.placed as number).toBeLessThan(9);
    expect(old.short).toMatch(/mostly spacingOther/);
  });

  it('reports rejections by cause and says why it fell short', () => {
    // A 10×10 map that is all water but a 3×3 island: 20 rocks cannot fit.
    const m = run(map(10, 10), [{ op: 'rect', x0: 0, y0: 0, x1: 9, y1: 9, terrain: 'water' }, { op: 'rect', x0: 3, y0: 3, x1: 5, y1: 5, terrain: 'grass' }]).doc;
    const r = run(m, [{ op: 'scatter', objects: [{ spriteId: 2 }], count: 20, spacing: 1, avoidTerrains: ['water'], seed: 1 }], c);
    const rep = r.reports[0] as unknown as Record<string, unknown> & { rejected: Record<string, number> };
    expect(rep.placed).toBeLessThan(20);
    expect(rep.rejected.terrain).toBeGreaterThan(0);
    expect(rep.short).toMatch(/not placed, every spot of the region tried: mostly terrain/);
    expect(rep.swept).toBeGreaterThan(0);
    // Zones and spacing are counted too.
    const z = run(map(12, 12), [{ op: 'addZone', kind: 'spawn', points: [[0, 0], [12, 12]] }, { op: 'scatter', assetRef: 'Bush', count: 5, avoidZones: ['spawn'], seed: 2 }]).reports[0] as unknown as { rejected: Record<string, number>; short: string };
    expect(z.rejected.zone).toBeGreaterThan(0);
    expect(z.short).toMatch(/mostly zone/);
  });

  it('spacing is per group; spacingOther keeps a distance to everything else', () => {
    const m = run(map(20, 20), [{ op: 'scatter', assetRef: 'Tree', footprint: { w: 1, h: 1 }, count: 60, spacing: 2, seed: 5 }]).doc;
    const near = (doc: MapBody) => {
      const os = objects(doc), rocks = os.filter((o) => o.assetRef === 'Rock');
      return Math.min(...rocks.flatMap((a) => os.filter((b) => b.assetRef === 'Tree').map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    };
    const a = run(m, [{ op: 'scatter', assetRef: 'Rock', footprint: { w: 1, h: 1 }, count: 10, spacing: 4, seed: 6 }]);
    expect(a.reports[0].placed).toBe(10);
    expect(near(a.doc)).toBeLessThan(4);
    const b = run(m, [{ op: 'scatter', assetRef: 'Rock', footprint: { w: 1, h: 1 }, count: 5, spacing: 4, spacingOther: 1.5, seed: 6 }]);
    expect(near(b.doc)).toBeGreaterThanOrEqual(1.5);
  });

  it('a repeated scatter adds more; topUp counts what is there; retries 0 is one round of darts', () => {
    const op: MapOp = { op: 'scatter', assetRef: 'Tree', footprint: { w: 1, h: 1 }, count: 10, spacing: 3, seed: 1 };
    const one = run(map(20, 20), [op]);
    // Second pass, other seed: its own count again, keeping its spacing to the first pass's trees.
    const two = run(one.doc, [{ ...op, seed: 2 }]);
    expect(two.reports[0].placed).toBe(10);
    const ts = objects(two.doc);
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) expect(Math.hypot(ts[i].x - ts[j].x, ts[i].y - ts[j].y)).toBeGreaterThanOrEqual(3);
    const same = run(one.doc, [{ ...op, seed: 2, topUp: true }]).reports[0];
    expect(same).toMatchObject({ placed: 0, target: 10, existing: 10 });
    expect(run(one.doc, [{ ...op, seed: 2, count: 14, topUp: true }]).reports[0]).toMatchObject({ placed: 4, existing: 10 });
    // Deterministic.
    expect(objects(run(map(20, 20), [op]).doc)).toEqual(objects(one.doc));
  });

  it('retries and relax: more darts, a sweep, then spacing relaxed down to the floor', () => {
    // 30 trees 4 m apart do not fit in 12×12 m; relaxing to 2 m does.
    const op: MapOp = { op: 'scatter', assetRef: 'Tree', footprint: { w: 1, h: 1 }, count: 30, spacing: 4, seed: 3 };
    const strict = run(map(12, 12), [op]).reports[0];
    expect(strict.placed).toBeLessThan(30);
    expect(strict.short).toMatch(/mostly spacing .* lower spacing or set relax/);
    const relaxed = run(map(12, 12), [{ ...op, relax: 2 }]).reports[0];
    expect(relaxed.placed).toBe(30);
    expect(relaxed.spacingUsed).toBeLessThan(4);
    expect(relaxed.spacingUsed).toBeGreaterThanOrEqual(2);
    const once = run(map(12, 12), [{ ...op, retries: 0 }]).reports[0];
    expect(once.placed).toBeLessThanOrEqual(strict.placed as number);
    expect(once.short).toMatch(/retries 0/);
    expect(applyOps(map(), [{ ...op, retries: 20 }]).errors[0].message).toMatch(/retries must be/);
  });
});

describe('FB-037: stamps turn to the facings a sprite has and only paint their own ground', () => {
  // Grass with a 3×2 dirt pad in the middle of a 7×6 cut, a one-facing bunker on it.
  const source = () => run(map(12, 10), [
    { op: 'rect', terrain: 'dirt', x0: 4, y0: 4, x1: 6, y1: 5 },
    { op: 'place', spriteId: 16, x: 5.5, y: 5, facing: 'SE' },
  ], { ...ctx, sprites: { 16: { name: 'bunker', w: 1, d: 2, directions: { SE: { u: 1, v: 2 } } } } }).doc;
  const sprites: OpsContext['sprites'] = { 16: { name: 'bunker', w: 1, d: 2, directions: { SE: { u: 1, v: 2 } } } };
  const c = { ...ctx, sprites };
  const cut = () => extractStamp(source(), [2, 2, 8, 7], { name: 'nest' });
  /** A target map: grass with a water column at x = 3 (corners), where the stamp's grass border will lie. */
  const target = () => run(map(14, 12), [{ op: 'rect', terrain: 'water', x0: 0, y0: 0, x1: 2, y1: 11 }]).doc;
  const corner = (m: MapBody, x: number, y: number) => ground(m).corners[y * (m.width + 1) + x];

  it('a saved stamp records a mask of the corners that differ from its border terrain', () => {
    const s = cut();
    expect(s.groundBase).toBe('grass');
    expect(s.groundMask!.filter(Boolean).length).toBe(s.ground!.filter((t) => t === 'dirt').length);
    expect(validateStamp(s)).toEqual([]);
    expect(validateStamp({ ...s, groundMask: [1, 0] })).toEqual([expect.stringMatching(/groundMask must be 56 flags/)]);
    // All one terrain: the whole ground is the content.
    const pad = extractStamp(source(), [4, 4, 5, 4], { name: 'pad' });
    expect(pad.groundMask!.every((v) => v === 1)).toBe(true);
  });

  it('ground mask (default) leaves the map around the pad alone; rect overwrites; none keeps the ground', () => {
    const s = cut();
    const placeAt = (ground?: 'mask' | 'rect' | 'none') => run(target(), [{ op: 'stamp', stamp: s, x: 2, y: 2, ...(ground ? { ground } : {}) }], c);
    const m = placeAt();
    expect(corner(m.doc, 3, 4)).toBe('water');
    expect(corner(m.doc, 5, 4)).toBe('dirt');
    expect(m.reports[0].ground).toEqual({ mode: 'mask', corners: s.groundMask!.filter(Boolean).length });
    expect(corner(placeAt('rect').doc, 3, 4)).toBe('grass');
    const none = placeAt('none').doc;
    expect(corner(none, 5, 4)).toBe('grass');
    expect(applyOps(target(), [{ op: 'stamp', stamp: s, x: 2, y: 2, ground: 'all' as 'rect' }], c).errors[0].message).toMatch(/ground must be/);
  });

  it('stamps saved before masks derive one from their border', () => {
    const { groundMask: _m, groundBase: _b, ...old } = cut();
    expect(stampGroundMask(old as MapStamp)).toEqual(cut().groundMask);
    const r = run(target(), [{ op: 'stamp', stamp: old as MapStamp, x: 2, y: 2 }], c);
    expect(corner(r.doc, 3, 4)).toBe('water');
    expect(r.reports[0].ground).toMatchObject({ mode: 'mask', mask: 'derived from the border' });
  });

  it('the mask turns with the stamp', () => {
    const s = cut();
    const t = rotateStamp(s, 1);
    t.ground!.forEach((g, i) => expect(t.groundMask![i]).toBe(g === 'dirt' ? 1 : 0));
    expect(rotateStamp(s, 4)).toEqual(s);
  });

  it('a turned facing the export lacks falls back to the nearest one, with a warning in the report', () => {
    const s = cut();
    for (const rotate of [90, 180, 270] as const) {
      const r = run(target(), [{ op: 'stamp', stamp: s, x: 2, y: 2, rotate }], c);
      const o = objects(r.doc)[0];
      expect(o).toMatchObject({ spriteId: 16, facing: 'SE', footprint: { w: 1, h: 2 } });
      expect(r.reports[0].warnings).toEqual([expect.stringMatching(/bunker: sprite 16 has no facing "(SW|NW|NE)" \(facings: SE\); used SE — render it with more facings/)]);
    }
    expect(run(target(), [{ op: 'stamp', stamp: s, x: 2, y: 2 }], c).reports[0].warnings).toBeUndefined();
  });
});
