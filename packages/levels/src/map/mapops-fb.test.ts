// Moved from the old generator's packages/shared/src/map/mapops-fb.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  applyOps, createImage, defaultMapBody, elevationPx, extractStamp, renderMapPreview, toTiledMapJson, validateMap,
  type MapBody, type MapObject, type MapOp, type ObjectLayer, type ObjectPicture, type OpsContext, type ZoneLayer,
} from '../index.js';

const map = (w = 24, h = 16, o: Partial<MapBody> = {}) => defaultMapBody('Base', { width: w, height: h, terrain: 'grass', ...o });
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const zones = (m: MapBody) => (m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones;
const ok = (m: MapBody, ops: MapOp[], ctx?: OpsContext) => {
  const r = applyOps(m, ops, ctx);
  expect(r.errors).toEqual([]);
  return r;
};

/** Sprites: 1 a fence panel 5.12 m long (6×1 cells along SE, 1×6 along SW), 2 a table (2×1, 0.8 m high), 3 a book, 4 a tree, 5 a mine. */
const ctx: OpsContext = {
  sprites: {
    1: { name: 'fence_panel', w: 6, d: 1, directions: { SE: { u: 6, v: 1 }, SW: { u: 1, v: 6 } }, metres: { w: 5.12, d: 0.3 }, height: 1.2 },
    2: { name: 'table', w: 2, d: 1, height: 0.8, metres: { w: 1.6, d: 0.8 } },
    3: { name: 'code_book', w: 1, d: 1, height: 0.05 },
    4: { name: 'tree', w: 1, d: 1, height: 6 },
    5: { name: 'mine', w: 1, d: 1, height: 0.1 },
  },
};

describe('FB-078 fence', () => {
  it('lays panels end to end at their real length along each segment, turned to lie along it', () => {
    const r = ok(map(), [{ op: 'fence', spriteId: 1, points: [[2, 2], [22.48, 2], [22.48, 12.72]] }], ctx);
    const panels = objects(r.doc);
    const rep = r.reports[0] as unknown as { fence: string; panels: number; stretches: { panels: number; slackM: number }[] };
    expect(rep.fence).toBe('f1');
    // 20.48 m = 4 panels exactly; 10.72 m ≈ 2 panels (0.48 m short, split between the ends).
    expect(rep.stretches.map((s) => [s.panels, s.slackM])).toEqual([[4, 0], [2, 0.48]]);
    expect(panels.map((o) => [o.x, o.y, o.facing])).toEqual([
      [4.56, 2, 'SE'], [9.68, 2, 'SE'], [14.8, 2, 'SE'], [19.92, 2, 'SE'],
      [22.48, 4.8, 'SW'], [22.48, 9.92, 'SW'],
    ]);
    expect(panels.every((o) => o.group === 'f1')).toBe(true);
    // 5.12 m panels with 6-cell footprints overlap their neighbours, which is allowed within the fence…
    expect(validateMap(r.doc)).toEqual([]);
    // …but not with anything else.
    const bad = applyOps(r.doc, [{ op: 'place', spriteId: 4, x: 4.5, y: 2.5 }], ctx);
    expect(bad.errors[0].message).toMatch(/would overlap o1 \(fence_panel\)/);
  });

  it('leaves gate openings (by distance or by point), never overhanging into them, and records them as zones', () => {
    const r = ok(map(), [{ op: 'fence', spriteId: 1, id: 'north', points: [[2, 2], [22.48, 2]], gates: [{ at: 10.24, width: 4, name: 'main gate' }] }], ctx);
    const rep = r.reports[0] as unknown as { panels: number; gates: string[]; stretches: { panels: number; slackM: number }[] };
    // 8.24 m either side of a 4 m gate: one panel each (3.12 m left open), none reaching into the gate.
    expect(rep.stretches.map((s) => [s.panels, s.slackM])).toEqual([[1, 3.12], [1, 3.12]]);
    const xs = objects(r.doc).map((o) => [o.x - 3, o.x + 3]);
    for (const [a, b] of xs) expect(b <= 10.24 + 0.01 || a >= 14.24 - 0.01 || (a < 10.24 && b < 14.24)).toBe(true);
    const g = zones(r.doc).find((z) => z.id === rep.gates[0])!;
    expect(g).toMatchObject({ kind: 'custom', name: 'main gate', shape: 'polyline', points: [[10.24, 2], [14.24, 2]], properties: { gate: true, fence: 'north', widthM: 4 } });
    // A gate given as a point near the line.
    const p = ok(map(), [{ op: 'fence', spriteId: 1, points: [[2, 2], [22.48, 2]], gates: [{ x: 12.3, y: 2.6, width: 2 }] }], ctx);
    expect(zones(p.doc)[0].points).toEqual([[11.3, 2], [13.3, 2]]);
  });

  it('needs a length for a sprite without one, and refuses a fence that does not fit', () => {
    const noLen = applyOps(map(), [{ op: 'fence', assetRef: 'Pack/Wall', points: [[1, 1], [10, 1]] }], ctx);
    expect(noLen.errors[0].message).toMatch(/give length in metres/);
    const r = ok(map(), [{ op: 'fence', assetRef: 'Pack/Wall', length: 3, footprint: { w: 3, h: 1 }, points: [[1, 1.5], [10, 1.5]] }], ctx);
    expect(objects(r.doc).map((o) => o.x)).toEqual([2.5, 5.5, 8.5]);
    const off = applyOps(map(10, 10), [{ op: 'fence', spriteId: 1, points: [[0, 2], [20, 2]] }], ctx);
    expect(off.errors[0].message).toMatch(/panel\(s\) of fence f1 do not fit/);
  });
});

describe('FB-079 objects on objects', () => {
  it('places on a support at its height, by default at its centre; exported and drawn raised', () => {
    const r = ok(map(), [
      { op: 'place', spriteId: 2, id: 'table', x: 6, y: 4.5 },
      { op: 'place', spriteId: 3, id: 'book', on: 'table' },
    ], ctx);
    const [, book] = objects(r.doc);
    expect(book).toMatchObject({ x: 6, y: 4.5, on: 'table', elevation: 0.8 });
    // Things on one support block each other; off the table is refused; an explicit elevation wins.
    expect(applyOps(r.doc, [{ op: 'place', spriteId: 3, on: 'table', x: 5.5, y: 4.5 }], ctx).errors[0].message).toMatch(/would overlap book/);
    expect(applyOps(r.doc, [{ op: 'place', spriteId: 3, on: 'table', x: 8.5, y: 4.5 }], ctx).errors[0].message).toMatch(/does not lie on table/);
    const two = ok(map(), [{ op: 'place', spriteId: 2, id: 't', x: 6, y: 4.5 }, { op: 'place', spriteId: 3, on: 't', x: 5.5, y: 4.5, elevation: 0.9 }, { op: 'place', spriteId: 3, on: 't', x: 6.5, y: 4.5 }], ctx);
    expect(objects(two.doc).map((o) => o.elevation)).toEqual([undefined, 0.9, 0.8]);
    // A tree on the floor next to the table may not overlap it; the book never blocks the floor.
    expect(applyOps(r.doc, [{ op: 'place', spriteId: 4, x: 5.5, y: 4.5 }], ctx).errors[0].message).toMatch(/would overlap table/);

    const { map: j } = toTiledMapJson(r.doc, { tilesets: [] });
    const objs = (j.layers.find((l) => l.name === 'objects') as { objects: { properties: { name: string; type: string; value: unknown }[] }[] }).objects;
    const props = Object.fromEntries(objs[1].properties.map((p) => [p.name, [p.type, p.value]]));
    expect(props.onObject).toEqual(['string', 'table']);
    expect(props.elevationM).toEqual(['float', 0.8]);
    expect(props.elevationPx).toEqual(['float', elevationPx(r.doc, 0.8)]);
    expect(elevationPx(r.doc, 0.8)).toBeGreaterThan(0);

    // Preview: the book's picture is drawn elevationPx higher than on the ground.
    const pic = (): ObjectPicture => {
      const page = createImage(4, 4);
      page.data.fill(255);
      return { page, frame: { x: 0, y: 0, w: 4, h: 4 }, trimX: 0, trimY: 0, sourceW: 4, sourceH: 4, flipX: false, anchor: { x: 2, y: 3 }, pixelsPerMetre: null };
    };
    const only = (m: MapBody, id: string) => ({ ...m, layers: m.layers.map((l) => (l.type === 'objects' ? { ...l, objects: l.objects.filter((o) => o.id === id) } : l)) });
    const top = (m: MapBody, id: string) => {
      const img = renderMapPreview(only(m, id), [], (o: MapObject) => (o.id === id ? pic() : null)).image;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3]) return y;
      return -1;
    };
    const flat = structuredClone(r.doc);
    delete objects(flat)[1].elevation;
    expect(top(flat, 'book') - top(r.doc, 'book')).toBeCloseTo(Math.round(elevationPx(r.doc, 0.8)), 0);
  });

  it('what stands on an object moves and goes with it; stamps keep the link', () => {
    const r = ok(map(), [{ op: 'place', spriteId: 2, id: 'table', x: 6, y: 4.5 }, { op: 'place', spriteId: 3, id: 'book', on: 'table' }], ctx);
    const moved = ok(r.doc, [{ op: 'move', id: 'table', dx: 3 }], ctx).doc;
    expect(objects(moved).map((o) => [o.id, o.x, o.y])).toEqual([['table', 9, 4.5], ['book', 9, 4.5]]);
    const s = extractStamp(r.doc, [4, 3, 8, 5], { name: 'desk' });
    expect(s.objects[1].on).toBe('#0');
    const st = ok(map(), [{ op: 'stamp', stamp: s, x: 10, y: 10 }], ctx);
    const [t2, b2] = objects(st.doc);
    expect(b2.on).toBe(t2.id);
    const gone = ok(r.doc, [{ op: 'remove', id: 'table' }], ctx);
    expect(objects(gone.doc)).toEqual([]);
    expect(gone.reports[0]).toMatchObject({ dependents: ['book'] });
  });

  it('a support without a known height needs an elevation', () => {
    const r = applyOps(map(), [{ op: 'place', assetRef: 'Pack/Crate', id: 'crate', x: 3.5, y: 3.5, footprint: { w: 1, h: 1 } }, { op: 'place', spriteId: 3, on: 'crate' }], ctx);
    expect(r.errors[0].message).toMatch(/give elevation in metres/);
  });
});

describe('FB-095 collision-free markers', () => {
  it('a marker never blocks solid objects (nor they it), keeps off other markers, and exports collides: false', () => {
    const r = ok(map(), [
      { op: 'place', spriteId: 4, id: 'tree', x: 3.5, y: 3.5 },
      { op: 'place', spriteId: 5, id: 'mine', x: 3.5, y: 3.5, collision: false },
      { op: 'place', spriteId: 4, id: 'tree2', x: 5.5, y: 5.5 },
    ], ctx);
    expect(applyOps(r.doc, [{ op: 'place', spriteId: 5, x: 3.5, y: 3.5, collision: false }], ctx).errors[0].message).toMatch(/would overlap mine/);
    // Scattered mines go under / beside trees regardless of them.
    const s = ok(r.doc, [{ op: 'scatter', spriteId: 5, collision: false, count: 30, spacing: 1, seed: 3 }], ctx);
    const mines = objects(s.doc).filter((o) => o.spriteId === 5);
    expect(mines.length).toBe(31);
    expect(mines.every((o) => o.collision === false)).toBe(true);
    const sprites = { 4: { name: 'tree', object: { tiles: { metresPerTile: 1 }, directions: [{ name: 'S', tiles: { polygon: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]] as [number, number][] } }] } }, 5: { name: 'mine', object: { tiles: { metresPerTile: 1 }, directions: [{ name: 'S', tiles: { polygon: [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2]] as [number, number][] } }] } } };
    const { map: j } = toTiledMapJson(r.doc, { tilesets: [], sprites, collisionShapes: true });
    const objs = (j.layers.find((l) => l.name === 'objects') as { objects: { properties: { name: string; value: unknown }[] }[] }).objects;
    const p = (i: number) => Object.fromEntries(objs[i].properties.map((x) => [x.name, x.value]));
    expect(p(0).collision).toBeDefined();
    expect(p(1).collision).toBeUndefined();
    expect(p(1).collides).toBe(false);
    const shapes = (j.layers.find((l) => l.name === 'collision_shapes') as { objects: { properties: { name: string; value: unknown }[] }[] }).objects;
    expect(shapes.map((o) => o.properties[0].value)).toEqual(['tree', 'tree2']);
  });
});

describe('FB-100 path zone', () => {
  it('records the jittered centre line and width as a polyline zone', () => {
    const r = ok(map(), [{ op: 'path', points: [[1, 8], [23, 8]], width: 1.5, jitter: 1, seed: 4, zone: { kind: 'custom', name: 'trench', properties: { trench: true } } }], ctx);
    const z = zones(r.doc)[0];
    expect(r.created).toEqual([z.id]);
    expect(z).toMatchObject({ name: 'trench', shape: 'polyline', properties: { trench: true, widthM: 1.5 } });
    expect(z.points.length).toBeGreaterThan(15);
    expect(z.points.some(([, y]) => Math.abs(y - 8) > 0.2)).toBe(true);
    const { map: j } = toTiledMapJson(r.doc, { tilesets: [] });
    const zl = j.layers.find((l) => l.name === 'zones') as { objects: { polyline?: unknown[]; properties: { name: string; type: string; value: unknown }[] }[] };
    expect(zl.objects[0].polyline!.length).toBe(z.points.length);
    expect(zl.objects[0].properties.find((p) => p.name === 'widthM')).toEqual({ name: 'widthM', type: 'float', value: 1.5 });
    // A zone alone is a path too.
    expect(ok(map(), [{ op: 'path', points: [[1, 1], [5, 1]], zone: true }]).doc.layers.length).toBe(5);
  });
});

describe('FB-101 clearing scattered objects', () => {
  const scattered = () => ok(map(), [{ op: 'scatter', spriteId: 4, count: 60, spacing: 1, seed: 2 }, { op: 'place', spriteId: 2, id: 'keep', x: 20, y: 14.5, allowOverlap: true }], ctx).doc;

  it('place / stamp with clear: true removes the scattered objects in the way and reports them', () => {
    const doc = scattered();
    const spot = objects(doc).find((o) => o.scattered)!;
    const refused = applyOps(doc, [{ op: 'place', spriteId: 2, x: spot.x + 0.5, y: spot.y }], ctx);
    expect(refused.errors[0].message).toMatch(/scattered: clear: true removes/);
    const r = ok(doc, [{ op: 'place', spriteId: 2, id: 'hq', x: spot.x + 0.5, y: spot.y, clear: true }], ctx);
    const rep = r.reports[0] as unknown as { cleared: string[] };
    expect(rep.cleared).toContain(spot.id);
    expect(objects(r.doc).some((o) => o.id === spot.id)).toBe(false);
    expect(validateMap(r.doc).filter((e) => /hq/.test(e))).toEqual([]);
    // Not scattered: still refused.
    expect(applyOps(r.doc, [{ op: 'place', spriteId: 4, x: 20.5, y: 14.5, clear: true }], ctx).errors[0].message).toMatch(/would overlap keep/);
    const st = ok(doc, [{ op: 'stamp', stamp: { name: 's', width: 2, height: 1, metresPerTile: 1, tilesets: [], ground: null, decoration: null, collision: null, objects: [{ spriteId: 2, x: 1, y: 0.5, footprint: { w: 2, h: 1 }, properties: {} }], zones: [] }, x: Math.round(spot.x - 1), y: Math.floor(spot.y), clear: true }], ctx);
    expect((st.reports[0] as unknown as { cleared: string[] }).cleared.length).toBeGreaterThan(0);
  });

  it('clearRect and clearZone remove scattered objects only (all: true removes everything)', () => {
    const doc = ok(scattered(), [{ op: 'addZone', id: 'lz', kind: 'objective', points: [[2, 2], [8, 8]] }], ctx).doc;
    const inRect = (o: MapObject) => o.x > 10 && o.x < 14 && o.y > 10 && o.y < 14;
    const r = ok(doc, [{ op: 'clearRect', x0: 10, y0: 10, x1: 13, y1: 13 }], ctx);
    expect(objects(r.doc).filter(inRect)).toEqual([]);
    expect((r.reports[0] as unknown as { removed: number }).removed).toBe(objects(doc).filter(inRect).length);
    const z = ok(doc, [{ op: 'clearZone', zone: 'lz', margin: 1 }], ctx);
    expect(objects(z.doc).filter((o) => o.x >= 1.5 && o.x <= 8.5 && o.y >= 1.5 && o.y <= 8.5)).toEqual([]);
    const kept = ok(doc, [{ op: 'clearRect', x0: 19, y0: 13, x1: 21, y1: 15 }], ctx);
    expect(objects(kept.doc).some((o) => o.id === 'keep')).toBe(true);
    expect(kept.reports[0]).toMatchObject({ kept: 1 });
    const all = ok(doc, [{ op: 'clearRect', x0: 19, y0: 13, x1: 21, y1: 15, all: true }], ctx);
    expect(objects(all.doc).some((o) => o.id === 'keep')).toBe(false);
  });
});
