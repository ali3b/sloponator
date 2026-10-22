// Moved from the old generator's packages/shared/src/map/generate.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, applyOps, BIOMES, defaultMapBody, defaultTilesetBody, extractStamp, fbm, hash32, mapOverview, nearestFacing, objectRect, planGeneration,
  mapSeed, rng, rotateFacing, toTiledMapJson, rotateStamp, screenAngle, seedStep,
  type CollisionLayer, type GroundLayer, type MapBody, type MapOp, type MapStamp, type ObjectLayer, type OpsContext, type PlanInput, type TilesetBody, type ZoneLayer,
} from '../index.js';

const tileset = (): TilesetBody => {
  let b = defaultTilesetBody('Temperate');
  for (const name of ['Grass', 'Dirt', 'Sand', 'Water']) b = addTerrain(b, { name }).body;
  return addWangset(b, { pairs: [['grass', 'dirt'], ['grass', 'sand'], ['grass', 'water'], ['dirt', 'water']] }).body;
};
const ctx: OpsContext = { tilesets: [tileset()] };
const map = (w = 8, h = 6, o: Partial<MapBody> = {}) => defaultMapBody('Gen', { width: w, height: h, tilesets: [1], terrain: 'grass', ...o });
const ground = (m: MapBody) => m.layers.find((l) => l.type === 'ground') as GroundLayer;
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const zones = (m: MapBody) => (m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones;
const collision = (m: MapBody) => (m.layers.find((l) => l.type === 'collision') as CollisionLayer).cells;
const run = (m: MapBody, ops: MapOp[], c: OpsContext = ctx) => {
  const r = applyOps(m, ops, c);
  expect(r.errors).toEqual([]);
  return r;
};
const ok = (m: MapBody, ops: MapOp[], c: OpsContext = ctx) => run(m, ops, c).doc;
const errorOf = (m: MapBody, op: MapOp, c: OpsContext = ctx) => applyOps(m, [op], c).errors[0]?.message;
/** Ground corners as rows of one letter per corner (first letter of the terrain id). */
const cornerPic = (m: MapBody) => Array.from({ length: m.height + 1 }, (_, y) => ground(m).corners.slice(y * (m.width + 1), (y + 1) * (m.width + 1)).map((t) => t[0] ?? ' ').join(''));
const terrainKinds = { grass: 'grass', dirt: 'dirt', sand: 'sand', water: 'water' };

describe('seeded noise', () => {
  it('hashes, generators and fractal noise are stable numbers', () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(2, 2, 3));
    const a = rng(42), b = rng(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    for (let i = 0; i < 50; i++) {
      const v = fbm(7, i * 0.37, i * 0.91, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(fbm(7, 3.3, 4.4, 5)).toBe(fbm(7, 3.3, 4.4, 5));
  });
});

describe('generate: terrain from noise per biome', () => {
  it('a seed gives the same small grid every time (golden)', () => {
    const m = ok(map(16, 10), [{ op: 'generate', biome: 'temperate', seed: 3 }]);
    expect(cornerPic(m)).toMatchInlineSnapshot(`
      [
        "dggggggggggssgggs",
        "ddggggggggsssgggs",
        "ddggggggggggggggg",
        "ddggggggggggggggg",
        "ddggggggggggggggg",
        "ggggggggggggggggg",
        "ggggggggggggggggg",
        "ggggggggggggggggg",
        "ggggggggggggggggg",
        "gggggddgggggggggg",
        "gggggdddggggddddd",
      ]
    `);
    expect(cornerPic(ok(map(16, 10), [{ op: 'generate', biome: 'temperate', seed: 3 }]))).toEqual(cornerPic(m));
    expect(cornerPic(ok(map(16, 10), [{ op: 'generate', biome: 'temperate', seed: 4 }]))).not.toEqual(cornerPic(m));
  });

  it('desert and arctic pick the tileset\'s terrains by kind; a missing base is an error, a missing layer is skipped', () => {
    let t = defaultTilesetBody('Arctic');
    t = addTerrain(t, { name: 'Snow', kind: 'snow' }).body;
    t = addTerrain(t, { name: 'Rock', kind: 'custom' }).body;
    const arctic = run(map(12, 12), [{ op: 'generate', biome: 'arctic', seed: 1 }], { tilesets: [t] });
    expect(arctic.reports[0]).toMatchObject({ op: 'generate', base: 'snow', skipped: ['no terrain ice/water in the tileset'] });
    expect(new Set(ground(arctic.doc).corners)).toEqual(new Set(['snow', 'rock']));
    expect(errorOf(map(), { op: 'generate', biome: 'arctic' })).toMatch(/no terrain "snow"/);
    expect(errorOf(map(), { op: 'generate', biome: 'swamp' })).toMatch(/no biome "swamp" \(biomes: temperate, desert, arctic, jungle\)/);
  });

  it('cover is a share of the region; overlays keep a ring of base between them', () => {
    const r = run(map(40, 40), [{ op: 'generate', biome: { base: 'grass', layers: [{ terrain: 'dirt', cover: 0.3 }, { terrain: 'sand', cover: 0.1, scale: 5 }] }, seed: 9 }]);
    const c = ground(r.doc).corners;
    const n = (t: string) => c.filter((x) => x === t).length;
    expect(n('dirt') / c.length).toBeGreaterThan(0.25);
    expect(n('dirt') / c.length).toBeLessThanOrEqual(0.3);
    expect(n('sand')).toBeGreaterThan(0);
    // No dirt corner next to a sand corner: every cell is a pair the corner tiles cover.
    const W = 41;
    for (let i = 0; i < c.length; i++)
      if (c[i] === 'sand')
        for (const d of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) if (Math.abs((i % W) - ((i + d + W) % W)) <= 1) expect(c[i + d]).not.toBe('dirt');
    expect(r.reports[0]).toMatchObject({ base: 'grass', corners: 41 * 41 });
  });

  it('region-limited (rect and polygon) and keep', () => {
    let m = ok(map(10, 10), [{ op: 'rect', terrain: 'water', x0: 0, y0: 0, x1: 9, y1: 9 }]);
    m = ok(m, [{ op: 'generate', biome: { base: 'dirt' }, region: { rect: [2, 2, 4, 3] } }]);
    expect(cornerPic(m).slice(0, 6)).toEqual(['wwwwwwwwwww', 'wwwwwwwwwww', 'wwddddwwwww', 'wwddddwwwww', 'wwddddwwwww', 'wwwwwwwwwww']);
    m = ok(map(10, 10), [{ op: 'generate', biome: { base: 'sand' }, region: { polygon: [[0, 0], [10, 0], [0, 10]] } }]);
    expect(ground(m).corners[0]).toBe('sand');
    expect(ground(m).corners[11 * 11 - 1]).toBe('grass');
    m = ok(map(6, 1), [{ op: 'paint', terrain: 'water', x: 2, y: 0 }, { op: 'generate', biome: { base: 'dirt' }, keep: ['water'] }]);
    expect(cornerPic(m)).toEqual(['ddwwddd', 'ddwwddd']);
  });

  it('is one undoable op: it applies as a single step', () => {
    const r = run(map(), [{ op: 'generate', seed: 5 }, { op: 'paint', terrain: 'water', x: 0, y: 0 }]);
    expect(r.applied).toBe(2);
    expect(r.reports.map((x) => x.op)).toEqual(['generate']);
  });
});

describe('scatter', () => {
  const pairDistances = (m: MapBody) => {
    const o = objects(m);
    const d: number[] = [];
    for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) d.push(Math.hypot(o[i].x - o[j].x, o[i].y - o[j].y));
    return d;
  };

  it('density per 100 m², minimum spacing, deterministic', () => {
    const op: MapOp = { op: 'scatter', assetRef: 'SM_Env_Tree_01', name: 'Tree', footprint: { w: 1, h: 1 }, density: 5, spacing: 2, seed: 11 };
    const r = run(map(20, 20), [op]);
    expect(r.reports[0]).toMatchObject({ op: 'scatter', placed: 20, target: 20, eligibleM2: 400, byObject: { Tree: 20 } });
    expect(Math.min(...pairDistances(r.doc))).toBeGreaterThanOrEqual(2);
    expect(r.created).toHaveLength(20);
    expect(objects(run(map(20, 20), [op]).doc)).toEqual(objects(r.doc));
    expect(objects(run(map(20, 20), [{ ...op, seed: 12 }]).doc)).not.toEqual(objects(r.doc));
    // 2 m per tile: the same metres are fewer cells.
    const big = run(map(10, 10, { metresPerTile: 2 }), [{ ...op, density: 5 }]);
    expect(big.reports[0]).toMatchObject({ target: 20, eligibleM2: 400 });
    expect(Math.min(...pairDistances(big.doc))).toBeGreaterThanOrEqual(1);
  });

  it('allowed terrains, avoided terrains and zones; footprints never overlap', () => {
    let m = ok(map(20, 20), [
      { op: 'rect', terrain: 'dirt', x0: 0, y0: 0, x1: 9, y1: 19 },
      { op: 'line', terrain: 'water', x0: 15, y0: 0, x1: 15, y1: 19 },
      { op: 'addZone', kind: 'spawn', name: 'Drop', points: [[5, 10]] },
    ]);
    const r = run(m, [{ op: 'scatter', assetRef: 'Rock', footprint: { w: 2, h: 2 }, count: 12, spacing: 1, terrains: ['grass', 'dirt'], avoidTerrains: ['water'], avoidZones: ['spawn'], avoidMargin: 3, seed: 2 }]);
    m = r.doc;
    const W = 21;
    for (const o of objects(m)) {
      const [x0, y0, x1, y1] = objectRect(o);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) expect(ground(m).corners[cy * W + cx]).not.toBe('water');
      expect(Math.hypot(o.x - 5, o.y - 10)).toBeGreaterThan(3);
    }
    expect(objects(m).length).toBeGreaterThan(6);
    // Grass only: never on the dirt half.
    const g = run(m, [{ op: 'scatter', assetRef: 'Bush', count: 10, terrains: ['grass'], seed: 3, spacing: 1 }]);
    for (const o of objects(g.doc).filter((x) => x.assetRef === 'Bush')) expect(o.x).toBeGreaterThan(10);
    // Overlap validation: footprints of everything placed are disjoint.
    const rects = objects(m).map(objectRect);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i], rects[j]];
        expect(Math.min(a[2], b[2]) - Math.max(a[0], b[0]) <= 0 || Math.min(a[3], b[3]) - Math.max(a[1], b[1]) <= 0).toBe(true);
      }
  });

  it('weighted objects, random states and facings from the lists; sprite checks', () => {
    const sprites: OpsContext['sprites'] = { 5: { w: 1, d: 1, states: ['intact', 'destroyed'], directions: { NE: { u: 1, v: 1 }, SE: { u: 1, v: 1 } } } };
    const c = { ...ctx, sprites };
    const r = run(map(16, 16), [{ op: 'scatter', objects: [{ spriteId: 5, states: ['intact', 'destroyed'], facings: 'any', weight: 3 }, { assetRef: 'Stump', weight: 1 }], count: 30, spacing: 1.5, seed: 4 }], c);
    const o = objects(r.doc);
    expect(o.length).toBe(30);
    expect(new Set(o.filter((x) => x.spriteId === 5).map((x) => x.state))).toEqual(new Set(['intact', 'destroyed']));
    expect(new Set(o.filter((x) => x.spriteId === 5).map((x) => x.facing))).toEqual(new Set(['NE', 'SE']));
    expect(o.filter((x) => x.spriteId === 5).length).toBeGreaterThan(o.filter((x) => x.assetRef === 'Stump').length);
    expect(errorOf(map(), { op: 'scatter', spriteId: 5, states: ['burning'] }, c)).toMatch(/no state "burning"/);
    expect(errorOf(map(), { op: 'scatter', spriteId: 6 }, c)).toMatch(/no sprite 6/);
    expect(errorOf(map(), { op: 'scatter' })).toMatch(/scatter needs objects/);
  });

  it('FB-067: counts follow the weights with mixed footprint sizes (a big footprint is not crowded out)', () => {
    // A palm 4×4 and a tree 6×6 at weights 1 : 2, dense enough that big footprints fail many darts.
    const sprites: OpsContext['sprites'] = { 1: { name: 'palm', w: 4, d: 4 }, 2: { name: 'tree', w: 6, d: 6 } };
    const c = { ...ctx, sprites };
    for (const seed of [1, 2, 3]) {
      const r = run(map(96, 96), [{ op: 'scatter', objects: [{ spriteId: 1, weight: 1 }, { spriteId: 2, weight: 2 }], density: 1.4, seed }], c);
      const rep = r.reports[0] as unknown as { placed: number; target: number; byObject: Record<string, number>; byObjectAsked: Record<string, number> };
      const { palm, tree } = rep.byObject;
      expect(rep.byObjectAsked).toEqual({ palm: Math.round(rep.target / 3), tree: rep.target - Math.round(rep.target / 3) });
      expect(palm + tree).toBe(rep.placed);
      expect(tree / palm).toBeGreaterThan(1.8);
      expect(tree / palm).toBeLessThan(2.2);
    }
    // Three sizes, weights 1 : 1 : 2 by count: each within a few of its share.
    const s3: OpsContext['sprites'] = { 1: { name: 'bush', w: 1, d: 1 }, 2: { name: 'rock', w: 3, d: 3 }, 3: { name: 'oak', w: 5, d: 5 } };
    const r3 = run(map(64, 64), [{ op: 'scatter', objects: [{ spriteId: 1 }, { spriteId: 2 }, { spriteId: 3, weight: 2 }], count: 120, spacing: 3, seed: 9 }], { ...ctx, sprites: s3 });
    const b3 = (r3.reports[0] as unknown as { byObject: Record<string, number> }).byObject;
    expect(b3).toEqual({ bush: 30, rock: 30, oak: 60 });
    // When the big one can't fit any more, the report says which object fell short.
    const tight = run(map(12, 12), [{ op: 'scatter', objects: [{ spriteId: 1 }, { spriteId: 2 }], count: 20, spacing: 1, seed: 2 }], c).reports[0] as Record<string, unknown>;
    expect(tight.shortBy).toBeDefined();
    expect(String(tight.short)).toMatch(/not placed/);
  });

  it('clusters: the same count lands in fewer, denser clumps', () => {
    const spread = (cluster: number) => {
      const o = objects(run(map(40, 40), [{ op: 'scatter', assetRef: 'Tree', count: 60, spacing: 1, cluster, clusterScale: 12, seed: 8 }]).doc);
      // Average distance to the nearest neighbour.
      return o.reduce((s, a) => s + Math.min(...o.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))), 0) / o.length;
    };
    expect(spread(1)).toBeLessThan(spread(0));
  });
});

describe('path', () => {
  it('width in metres along the centre line (corners within half of it)', () => {
    const line = (width: number) => cornerPic(ok(map(8, 6), [{ op: 'path', points: [[0, 3], [8, 3]], terrain: 'dirt', width }]));
    expect(line(1)).toEqual(['ggggggggg', 'ggggggggg', 'ggggggggg', 'ddddddddd', 'ggggggggg', 'ggggggggg', 'ggggggggg']);
    expect(line(3).filter((r) => r === 'ddddddddd')).toHaveLength(3);
    // A path through cell centres, 1 m wide on a 1 m grid, makes that row of cells pure.
    const m = ok(map(8, 6), [{ op: 'path', points: [[0, 2.5], [8, 2.5]], terrain: 'dirt', width: 1 }]);
    expect(mapOverview(m, { terrainKinds }).lines[2]).toBe('::::::::');
    expect(mapOverview(m, { terrainKinds }).lines[1]).toBe('........');
  });

  it('FB-069: a ford path with collision false clears exactly its cells, not the water beside it', () => {
    const river: MapOp = { op: 'path', points: [[-1, 8], [12, 7], [25, 9]], terrain: 'water', width: 4, jitter: 1.5, seed: 5, collision: true, edge: 'sand', edgeWidth: 2 };
    const before = run(map(24, 16), [river]).doc;
    const ford: MapOp = { op: 'path', points: [[12.5, 0], [12.5, 16]], terrain: 'sand', width: 3, collision: false };
    const r = run(before, [ford]);
    const was = collision(before), now = collision(r.doc);
    const under = (x: number) => Math.abs(x + 0.5 - 12.5) <= 1.5;
    let cleared = 0;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 24; x++) {
        if (under(x)) {
          expect(now[y * 24 + x]).toBe(0);
          if (was[y * 24 + x]) cleared++;
        } else expect(now[y * 24 + x]).toBe(was[y * 24 + x]);
      }
    expect(cleared).toBeGreaterThan(6);
    expect(r.reports[0]).toMatchObject({ terrain: 'sand', cleared });
    expect(r.reports[0].blocked).toBeUndefined();
    // The water right beside the ford stays blocked: the text picture shows the gap exactly 3 cells wide.
    const pic = mapOverview(r.doc, { terrainKinds, collision: 'separate' }).collision!;
    const row = pic.findIndex((l, y) => was[y * 24 + 10] && was[y * 24 + 14]);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(pic[row].slice(10, 15)).toBe('#...#');
    // The Tiled export's collision rectangles cover just the blocked cells (one per run).
    const tl = toTiledMapJson(r.doc, { tilesets: [{ body: tileset(), file: 't' }] }).map.layers as { name: string; objects?: { type: string; width: number; height: number }[] }[];
    const rects = tl.find((l) => l.name === 'collision')!.objects!.filter((o) => o.type === 'collision');
    const th = r.doc.tileHeight;
    expect(rects.reduce((a, o) => a + (o.width * o.height) / (th * th), 0)).toBeCloseTo(now.filter(Boolean).length, 6);
    // A collision path with neither terrain nor objects is a ford/bridge brush on its own; collision must be a boolean.
    expect(run(before, [{ ...ford, terrain: undefined }]).reports[0]).toMatchObject({ cleared });
    expect(errorOf(before, { ...ford, collision: 'no' as unknown as boolean })).toMatch(/collision must be true/);
  });

  it('FB-069: collision brushes take a terrains filter (only cells all of those terrains)', () => {
    const river: MapOp = { op: 'path', points: [[-1, 8], [12, 7], [25, 9]], terrain: 'water', width: 4, jitter: 1.5, seed: 5, collision: true };
    const m = ok(map(24, 16), [river, { op: 'path', points: [[12.5, 0], [12.5, 16]], terrain: 'sand', width: 3 }]);
    const was = collision(m);
    const after = ok(m, [{ op: 'rect', value: false, x0: 8, y0: 0, x1: 16, y1: 15, terrains: ['sand'] }]);
    const now = collision(after), g = ground(m);
    let cleared = 0;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 24; x++) {
        const c = [g.corners[y * 25 + x], g.corners[y * 25 + x + 1], g.corners[(y + 1) * 25 + x], g.corners[(y + 1) * 25 + x + 1]];
        const sandCell = x >= 8 && x <= 16 && c.every((t) => t === 'sand');
        expect(now[y * 24 + x]).toBe(sandCell ? 0 : was[y * 24 + x]);
        if (sandCell && was[y * 24 + x]) cleared++;
      }
    expect(cleared).toBeGreaterThan(3);
    // Water cells inside the rect stay blocked.
    expect(now.some((v, i) => v && i % 24 >= 8 && i % 24 <= 16)).toBe(true);
    expect(errorOf(m, { op: 'rect', terrain: 'dirt', x0: 0, y0: 0, x1: 1, y1: 1, terrains: ['sand'] })).toMatch(/terrains only filters collision/);
  });

  it('jitter is seeded; collision and an edge band', () => {
    const op: MapOp = { op: 'path', points: [[-1, 6], [8, 3], [17, 7]], terrain: 'water', width: 2, jitter: 1.5, seed: 21, collision: true, edge: 'sand' };
    const r = run(map(16, 12), [op]);
    expect(cornerPic(r.doc)).toMatchInlineSnapshot(`
      [
        "ggggggggggggggggg",
        "ggggggggggggggggg",
        "ggggsssssssgggggg",
        "sssswwwwwwwssgggg",
        "wwwwwwwwwwwwwssgg",
        "wwwwssssssswwwwss",
        "wsssggggggsswwwww",
        "sgggggggggggsswww",
        "ggggggggggggggsss",
        "ggggggggggggggggg",
        "ggggggggggggggggg",
        "ggggggggggggggggg",
        "ggggggggggggggggg",
      ]
    `);
    expect(cornerPic(run(map(16, 12), [op]).doc)).toEqual(cornerPic(r.doc));
    expect(cornerPic(run(map(16, 12), [{ ...op, seed: 22 }]).doc)).not.toEqual(cornerPic(r.doc));
    expect(r.reports[0]).toMatchObject({ terrain: 'water' });
    expect(r.reports[0].blocked).toBeGreaterThan(10);
    expect(collision(r.doc).filter(Boolean).length).toBe(r.reports[0].blocked);
    expect(errorOf(map(), { op: 'path', points: [[0, 0]], terrain: 'dirt' })).toMatch(/at least 2 points/);
    expect(errorOf(map(), { op: 'path', points: [[0, 0], [3, 3]] })).toMatch(/needs a terrain, objects, collision or zone/);
  });

  it('objects along it: every n metres, offset to both sides, facing along the path on screen', () => {
    const r = run(map(10, 6), [{
      op: 'path', points: [[0, 3], [10, 3]], smooth: false, terrain: 'dirt', width: 1,
      objects: [{ assetRef: 'Wire', every: 2, offset: 1.5, footprint: { w: 1, h: 1 }, facing: 'along' }],
    }]);
    const o = objects(r.doc);
    expect(o.map((x) => [x.x, x.y])).toEqual([[1.5, 1.5], [1.5, 4.5], [3.5, 1.5], [3.5, 4.5], [5.5, 1.5], [5.5, 4.5], [7.5, 1.5], [7.5, 4.5], [9.5, 1.5], [9.5, 4.5]]);
    // Map x runs down-right on an iso screen: along a path down the x axis is SE.
    expect(new Set(o.map((x) => x.facing))).toEqual(new Set(['SE']));
    expect(r.reports[0].placed).toEqual({ Wire: 10 });
  });

  it('says why path objects were skipped: by cause, the spots, what was in the way, and a short hint (FB-051)', () => {
    const m = ok(map(10, 6), [{ op: 'place', assetRef: 'Sandbags', name: 'sandbag', footprint: { w: 2, h: 1 }, x: 4, y: 2.5 }]);
    const r = run(m, [{
      op: 'path', points: [[0, 2.5], [10, 2.5]], smooth: false,
      objects: [{ assetRef: 'Wire', every: 2, footprint: { w: 1, h: 1 } }, { assetRef: 'Post', every: 5, offset: 3, side: 'left', footprint: { w: 1, h: 1 } }],
    }]);
    const rep = r.reports[0] as Record<string, unknown>;
    expect(rep.placed).toEqual({ Wire: 4 });
    // One wire lands on the sandbags; the posts 3 m to the left are off the map.
    expect(rep.skipped).toBe(3);
    expect(rep.rejected).toEqual({ overlap: 1, bounds: 2 });
    expect(rep.rejectedSpots).toEqual(expect.arrayContaining([expect.objectContaining({ object: 'Wire', cause: 'overlap', with: 'o1 (sandbag)', x: 3.5, y: 2.5 }), expect.objectContaining({ object: 'Post', cause: 'bounds' })]));
    expect(rep.short).toMatch(/^3 of 7 not placed: mostly bounds \(2\) — the path runs off the map/);
    // Nothing skipped: no reasons.
    const clean = run(map(10, 6), [{ op: 'path', points: [[0, 2.5], [10, 2.5]], smooth: false, objects: [{ assetRef: 'Wire', every: 2, footprint: { w: 1, h: 1 } }] }]).reports[0];
    expect(clean).not.toHaveProperty('rejected');
    expect(clean).not.toHaveProperty('short');
  });
});

describe('stamps', () => {
  const bunkerMap = () =>
    ok(map(10, 8), [
      { op: 'rect', terrain: 'dirt', x0: 2, y0: 1, x1: 5, y1: 3 },
      { op: 'place', assetRef: 'SM_Bld_Bunker_01', name: 'Bunker', footprint: { w: 2, h: 1 }, x: 4, y: 2.5, facing: 'SE', state: 'intact' },
      { op: 'place', assetRef: 'Sandbags', footprint: { w: 1, h: 1 }, x: 2.5, y: 1.5 },
      { op: 'paint', value: true, x: 3, y: 2 },
      { op: 'addZone', kind: 'objective', name: 'Destroy', points: [[2, 1], [6, 4]] },
    ]);

  it('extract → place round trip: same ground, objects, collision and zones at the new spot', () => {
    const s = extractStamp(bunkerMap(), [2, 1, 5, 3], { name: 'Bunker' });
    expect(s).toMatchObject({ width: 4, height: 3, metresPerTile: 1, objects: [{ name: 'Bunker', x: 2, y: 1.5 }, { assetRef: 'Sandbags', x: 0.5, y: 0.5 }], zones: [{ kind: 'objective', points: [[0, 0], [4, 3]] }] });
    expect(s.collision!.filter(Boolean)).toHaveLength(1);
    // Placed at the same spot on a fresh map, it reproduces the original cells.
    const back = run(map(10, 8), [{ op: 'stamp', stamp: s, x: 2, y: 1 }]);
    const orig = bunkerMap();
    expect(ground(back.doc).corners).toEqual(ground(orig).corners);
    expect(collision(back.doc)).toEqual(collision(orig));
    expect(objects(back.doc).map(({ id: _, ...o }) => o)).toEqual(objects(orig).map(({ id: _, ...o }) => o));
    expect(zones(back.doc).map(({ id: _, ...z }) => z)).toEqual(zones(orig).map(({ id: _, ...z }) => z));
    expect(back.created).toEqual(['o1', 'o2', 'z1']);
    expect(back.reports[0]).toMatchObject({ stamp: 'Bunker', at: [2, 1], size: [4, 3], objects: 2, zones: 1 });
  });

  it('rotation: 90° clockwise turns cells, positions, footprints and facings; four turns are the identity', () => {
    const s = extractStamp(bunkerMap(), [2, 1, 5, 3], { name: 'Bunker' });
    const r = rotateStamp(s, 1);
    expect([r.width, r.height]).toEqual([3, 4]);
    expect(r.objects[0]).toMatchObject({ x: 1.5, y: 2, footprint: { w: 1, h: 2 }, facing: 'SW' });
    expect(r.zones[0].points).toEqual([[0, 0], [3, 4]]);
    expect(rotateStamp(s, 4)).toEqual(s);
    expect(rotateStamp(rotateStamp(s, 3), 1)).toEqual(s);
    expect(rotateStamp(s, 2).objects[0]).toMatchObject({ x: 2, y: 1.5, facing: 'NW' });
    const placed = ok(map(10, 8), [{ op: 'stamp', stamp: s, x: 0, y: 0, rotate: 90 }]);
    expect(objects(placed)[0]).toMatchObject({ x: 1.5, y: 2, footprint: { w: 1, h: 2 }, facing: 'SW' });
    // A sprite with per-facing footprints gets the one for its turned facing.
    const sprites: OpsContext['sprites'] = { 9: { w: 2, d: 1, directions: { SE: { u: 2, v: 1 }, SW: { u: 1, v: 2 }, NW: { u: 2, v: 1 }, NE: { u: 1, v: 2 } } } };
    const withSprite: MapStamp = { ...s, objects: [{ spriteId: 9, x: 2, y: 1.5, facing: 'SE', footprint: { w: 2, h: 1 }, properties: {} }] };
    expect(objects(ok(map(10, 8), [{ op: 'stamp', stamp: withSprite, x: 0, y: 0, rotate: 270 }], { ...ctx, sprites }))[0]).toMatchObject({ facing: 'NE', footprint: { w: 1, h: 2 } });
  });

  it('by name from the context; refuses what does not fit, overlaps and another scale', () => {
    const s = extractStamp(bunkerMap(), [2, 1, 5, 3], { name: 'Bunker' });
    const c = { ...ctx, stamps: { bunker: s } };
    expect(objects(ok(map(10, 8), [{ op: 'stamp', stamp: 'BUNKER', x: 5, y: 4, centre: true }], c)).map((o) => [o.x, o.y])).toEqual([[5, 4.5], [3.5, 3.5]]);
    expect(errorOf(map(10, 8), { op: 'stamp', stamp: 'Hut', x: 0, y: 0 }, c)).toMatch(/no stamp "Hut" \(stamps: Bunker\)/);
    expect(errorOf(map(10, 8), { op: 'stamp', stamp: 'bunker', x: 8, y: 0 }, c)).toMatch(/does not fit the 10×8 map/);
    expect(errorOf(bunkerMap(), { op: 'stamp', stamp: 'bunker', x: 2, y: 1 }, c)).toMatch(/would overlap/);
    expect(errorOf(map(10, 8, { metresPerTile: 2 }), { op: 'stamp', stamp: 'bunker', x: 0, y: 0 }, c)).toMatch(/cut at 1 m per tile/);
    expect(errorOf(map(10, 8), { op: 'stamp', stamp: 'bunker', x: 0, y: 0, rotate: 45 as 90 }, c)).toMatch(/rotate must be/);
    expect(objects(ok(map(10, 8), [{ op: 'stamp', stamp: 'bunker', x: 0, y: 0, layers: ['ground'] }], c))).toEqual([]);
  });

  it('decoration gids follow the tileset to its slot in the target map', () => {
    const src = ok(map(4, 4, { tilesets: [1, 7] }), [{ op: 'paint', tile: 65536 + 1 + 3, x: 1, y: 1 }]);
    const s = extractStamp(src, [0, 0, 3, 3], { name: 'Deco', layers: ['decoration'] });
    expect(s.tilesets).toEqual([1, 7]);
    const dst = ok(map(4, 4, { tilesets: [7] }), [{ op: 'stamp', stamp: s, x: 0, y: 0 }]);
    expect((dst.layers.find((l) => l.type === 'decoration') as { cells: number[] }).cells[5]).toBe(1 + 3);
    expect(errorOf(map(4, 4, { tilesets: [1] }), { op: 'stamp', stamp: s, x: 0, y: 0 })).toMatch(/uses tileset 7/);
  });

  it('facing names turn in their own style', () => {
    expect(['N', 'NE', 'E', 'SSW', 'ne', 'up', 'down_left', 'a090', 'idle'].map((f) => rotateFacing(f, 1))).toEqual(['E', 'SE', 'S', 'WNW', 'se', 'right', 'up_left', 'a000', 'idle']);
    expect(nearestFacing(['NE', 'SE', 'SW', 'NW'], screenAngle({ orientation: 'isometric' }, 0, 1))).toBe('SW');
  });
});

describe('planGeneration', () => {
  const terrains = tileset().terrains;
  it('a text seed stays text in the ops ("m2", "m2+32") and gives the same map as its numbers (FB-046)', () => {
    expect(mapSeed('m2+31')).toBe((mapSeed('m2') + 31) | 0);
    expect(seedStep('m2', 31)).toBe('m2+31');
    expect(seedStep(7, 31)).toBe(38);
    const features: PlanInput['features'] = ['road', 'river', { type: 'scatter', assetRef: 'Tree', footprint: { w: 1, h: 1 }, density: 3 }];
    const text = planGeneration({ width: 24, height: 16, seed: 'm2', terrains, features });
    expect(text.ops.map((o) => (o as { seed?: unknown }).seed)).toEqual(['m2', 'm2+32', 'm2+33', 'm2+104']);
    // The same plan with the seeds as the whole numbers they stand for (what a plan carried before).
    const numeric = text.ops.map((o) => ((o as { seed?: unknown }).seed !== undefined ? { ...o, seed: mapSeed((o as { seed: string }).seed) } : o)) as MapOp[];
    const a = ok(map(24, 16), text.ops), b = ok(map(24, 16), numeric);
    expect(cornerPic(a)).toEqual(cornerPic(b));
    expect(objects(a)).toEqual(objects(b));
    expect(objects(a).length).toBeGreaterThan(2);
    // A number stays a number.
    expect(planGeneration({ width: 24, height: 16, seed: 7, terrains, features }).ops.map((o) => (o as { seed?: unknown }).seed)).toEqual([7, 39, 40, 111]);
  });

  it('a biome, a seed and features → ordered ops; the same input gives the same plan', () => {
    const input: PlanInput = { width: 32, height: 24, seed: 7, biome: 'temperate', terrains, features: ['road', { type: 'scatter' as const, assetRef: 'Tree', density: 3 }, 'river', { type: 'stamp' as const, stamp: 'Bunker', width: 4, height: 3 }] };
    const p = planGeneration(input);
    expect(p.ops.map((o) => o.op)).toEqual(['generate', 'path', 'path', 'stamp', 'scatter']);
    expect(p.ops[1]).toMatchObject({ op: 'path', terrain: 'water' });
    expect(p.ops[2]).toMatchObject({ op: 'path', terrain: 'dirt', width: 3 });
    expect(p.ops[4]).toMatchObject({ op: 'scatter', avoidTerrains: ['water', 'dirt'] });
    expect(planGeneration(input)).toEqual(p);
    expect(p.notes[0]).toMatch(/^river along y/);
    expect(p.notes[1]).toMatch(/^road along x/);
    expect(() => planGeneration({ ...input, features: ['volcano' as 'road'] })).toThrow(/unknown feature "volcano"/);
    expect(planGeneration({ ...input, terrains: [terrains[0]], features: ['river'] }).notes).toEqual(['river: the tileset has no water terrain; skipped']);
    expect(Object.keys(BIOMES)).toEqual(['temperate', 'desert', 'arctic', 'jungle']);
  });

  it('a 32×24 temperate mission area: a road, a river, trees and a bunker stamp (golden overview)', () => {
    const bunker = ok(defaultMapBody('s', { width: 4, height: 4, terrain: 'dirt', tilesets: [1] }), [
      { op: 'place', assetRef: 'SM_Bld_Bunker_01', name: 'Bunker', x: 2, y: 2, footprint: { w: 2, h: 2 }, facing: 'SE' },
      { op: 'place', assetRef: 'SM_Prop_Sandbags_01', name: 'Sandbags', x: 0.5, y: 3.5, footprint: { w: 1, h: 1 } },
      { op: 'place', assetRef: 'SM_Prop_Wire_01', name: 'Wire', x: 3.5, y: 0.5, footprint: { w: 1, h: 1 } },
    ]);
    const stamp = extractStamp(bunker, [0, 0, 3, 3], { name: 'Bunker' });
    const plan = planGeneration({
      width: 32, height: 24, seed: 7, biome: 'temperate', terrains,
      features: ['river', { type: 'road', terrain: 'dirt' }, { type: 'stamp', stamp: 'Bunker', width: 4, height: 4 }, { type: 'scatter', assetRef: 'SM_Env_Tree_01', name: 'Tree', footprint: { w: 1, h: 1 }, density: 4, spacing: 2.5, cluster: 0.6 }],
    });
    const r = run(map(32, 24), plan.ops, { ...ctx, stamps: { bunker: stamp } });
    const ov = mapOverview(r.doc, { terrainKinds });
    expect(ov.lines).toMatchInlineSnapshot(`
      [
        "......:::::..www......T~.....:::",
        "......:::::..www......~~........",
        "......::::::wwww......~~........",
        "T......:::::www.....T...........",
        "...T...::::wwww.......:::W......",
        ".........::wwww.T.....:BB:.T....",
        "~~.~..~T~.wwww........:BB:......",
        "~..~T.~~~..www........S:::......",
        ":..........wwww.................",
        ":::....T...wwww.................",
        "::::::.....wwww.................",
        ":.:::::::.wwww....~T~...........",
        ".....::::::www..T.~~~...........",
        ".......::::::::.................",
        "..........::::::................",
        "...:.......:::::::::............",
        "...:.......ww::::::::::.........",
        "...:.......www.....::::::.......",
        "...::......www.......::::::.....",
        "...::...::wwww.........:::::::..",
        "...::..:::wwww...:::......::::::",
        "~~..:...:..www...:::........::::",
        "~~...T.....www..................",
        "~~.....~T..www......T..........T",
      ]
    `);
    expect(ov.legend).toMatchInlineSnapshot(`
      {
        ".": "terrain grass",
        ":": "terrain dirt",
        "B": "object Bunker [SM_Bld_Bunker_01] (o1)",
        "S": "object Sandbags [SM_Prop_Sandbags_01] (o2)",
        "T": "object Tree [SM_Env_Tree_01] ×15",
        "W": "object Wire [SM_Prop_Wire_01] (o3)",
        "w": "terrain water",
        "~": "terrain sand",
      }
    `);
  });
});
