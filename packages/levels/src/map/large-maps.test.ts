// Moved from the old generator's packages/shared/src/map/large-maps.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, applyOps, clampRegion, defaultMapBody, defaultTilesetBody, groundPixel, mapOverview, nextMapId, parseRegion, renderMapPreview, renderMinimap,
  renderTilesetAtlas, validateMap, vehicleStart, ZONE_COLORS, hexToRgba, zoneRoute, PLACEHOLDER_LABELS,
  type MapBody, type MapObject, type MapOp, type ObjectLayer, type PreviewTileset, type RgbaImage, type ZoneLayer,
} from '../index.js';

/** Large-map readiness (G6): big layers stay quick, and pictures of big maps can show a region in detail. */

const tileset = (): PreviewTileset => {
  let b = defaultTilesetBody('T');
  for (const name of ['Grass', 'Dirt', 'Road']) b = addTerrain(b, { name }).body;
  b = addWangset(b, { pairs: [['grass', 'dirt'], ['grass', 'road']], variants: 1 }).body;
  const a = renderTilesetAtlas(b);
  return { body: b, atlas: a.image, columns: a.columns };
};
const ts = tileset();
const ctx = { tilesets: [ts.body], sprites: { 12: null }, spriteNames: { 12: 'truck' } };
const map = (w: number, h: number) => defaultMapBody('Big', { width: w, height: h, tilesets: [1], terrain: 'grass' });
const objects = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
const run = (m: MapBody, ops: MapOp[], atomic = true) => {
  const r = applyOps(m, ops, ctx, { atomic });
  expect(r.errors).toEqual([]);
  return r.doc;
};
const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('big object layers', () => {
  it('scatters thousands of objects quickly, never overlapping', () => {
    const t0 = performance.now();
    const m = run(map(128, 256), [
      { op: 'scatter', assetRef: 'Tree', name: 'tree', footprint: { w: 1, h: 1 }, count: 5000, spacing: 1.5, seed: 3 },
      { op: 'scatter', assetRef: 'Rock', name: 'rock', footprint: { w: 2, h: 2 }, count: 2000, spacing: 3, seed: 4 },
    ]);
    // It took ~30 s before the overlap index and the id cache (every place scanned every object).
    expect(performance.now() - t0).toBeLessThan(8000);
    const list = objects(m);
    expect(list.length).toBeGreaterThan(5000);
    expect(new Set(list.map((o) => o.id)).size).toBe(list.length);
    expect(validateMap(m)).toEqual([]);
  });

  it('overlap checks, ids and moves stay right on a big layer (the index follows removes and moves)', () => {
    let m = map(64, 64);
    const ops: MapOp[] = [];
    for (let i = 0; i < 100; i++) ops.push({ op: 'place', assetRef: 'Crate', x: (i % 10) * 4 + 1.5, y: Math.floor(i / 10) * 4 + 1.5, footprint: { w: 1, h: 1 } });
    m = run(m, ops);
    expect(objects(m).at(-1)!.id).toBe('o100');
    // Onto a crate: refused, naming the one it hits.
    expect(applyOps(m, [{ op: 'place', assetRef: 'X', x: 5.5, y: 5.5, footprint: { w: 1, h: 1 } }], ctx).errors[0].message).toMatch(/would overlap o12\b/);
    // Moved away, its old spot is free and its new spot is taken.
    m = run(m, [{ op: 'move', id: 'o12', x: 50.5, y: 50.5 }, { op: 'place', assetRef: 'X', id: 'free', x: 5.5, y: 5.5, footprint: { w: 1, h: 1 } }]);
    expect(applyOps(m, [{ op: 'place', assetRef: 'X', x: 50.5, y: 50.5, footprint: { w: 1, h: 1 } }], ctx).errors[0].message).toMatch(/would overlap o12\b/);
    // Removing the highest id: the next one is one past the highest left (as before the cache).
    m = run(m, [{ op: 'remove', id: 'o100' }]);
    expect(nextMapId(m, 'o')).toBe('o100');
    m = run(m, [{ op: 'place', assetRef: 'X', x: 60.5, y: 60.5 }, { op: 'place', assetRef: 'X', x: 61.5, y: 60.5 }], false);
    expect(objects(m).slice(-2).map((o) => o.id)).toEqual(['o100', 'o101']);
    // A taken id is refused also when the cache is warm.
    expect(applyOps(m, [{ op: 'place', assetRef: 'X', id: 'o5', x: 62.5, y: 62.5 }], ctx).errors[0].message).toMatch(/id "o5" is taken/);
  });

  it('a road across a 512×512 map is quick', () => {
    const t0 = performance.now();
    const m = run(map(512, 512), [{ op: 'path', points: [[0.5, 256], [170, 170], [340, 340], [511.5, 256]], terrain: 'road', width: 3, jitter: 2, seed: 1, collision: true }]);
    expect(performance.now() - t0).toBeLessThan(4000);
    const road = (m.layers[0] as { corners: string[] }).corners.filter((c) => c === 'road').length;
    expect(road).toBeGreaterThan(1500);
  });
});

describe('regions', () => {
  it('parseRegion reads x,y,w,h; clampRegion keeps it on the map', () => {
    expect(parseRegion('10,20,30,40')).toEqual([10, 20, 40, 60]);
    expect(parseRegion([1, 2, 3, 4])).toEqual([1, 2, 4, 6]);
    expect(() => parseRegion('1,2,3')).toThrow(/x,y,w,h/);
    expect(() => parseRegion('1,2,0,4')).toThrow(/x,y,w,h/);
    expect(clampRegion({ width: 50, height: 50 }, [40, -5, 90, 10])).toEqual([40, 0, 50, 10]);
  });

  it('the text picture of a window: one character per cell, an x ruler, only what is in it', () => {
    const m = run(map(256, 256), [
      { op: 'rect', x0: 100, y0: 100, x1: 109, y1: 104, terrain: 'road' },
      { op: 'place', assetRef: 'Bunker', name: 'bunker', x: 102.5, y: 102.5, footprint: { w: 1, h: 1 } },
      { op: 'place', assetRef: 'Tower', name: 'tower', x: 10.5, y: 10.5, footprint: { w: 1, h: 1 } },
      { op: 'addZone', kind: 'spawn', name: 'far', points: [[5, 5]] },
      { op: 'addZone', kind: 'patrol', name: 'route', points: [[90, 101], [120, 101]] },
    ]);
    const whole = mapOverview(m);
    expect(whole.scale).toBe(4);
    expect(whole.window).toBeUndefined();
    const ov = mapOverview(m, { region: [96, 96, 136, 112], terrainKinds: { grass: 'grass', road: 'road' } });
    expect(ov.scale).toBe(1);
    expect(ov.window).toEqual([96, 96, 136, 112]);
    expect(ov.lines.length).toBe(16);
    expect(ov.lines[0].length).toBe(40);
    expect(ov.ruler).toBe('96        106       116       126       ');
    // Column c is x 96 + c, row r is y 96 + r: the bunker at cell (102, 102).
    const B = Object.entries(ov.legend).find(([, v]) => v.includes('bunker'))![0];
    expect(ov.lines[6][6]).toBe(B);
    expect(ov.lines[4][4]).toBe('=');
    expect(Object.values(ov.legend).some((v) => v.includes('tower'))).toBe(false);
    expect(Object.values(ov.legend).some((v) => v.includes('"far"'))).toBe(false);
    // The patrol runs in from the left edge of the window along row y 101.
    const P = ov.zoneSymbols[(m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones[1].id];
    expect(ov.lines[5].startsWith(P)).toBe(true);
    expect(ov.note).toMatch(/cells x 96\.\.135, y 96\.\.111/);
    expect(ov.header).toBe('40×16 cells (x 96..135, y 96..111) as 40×16 characters: 1 char = 1 cell; column c = x 96 + c, row r = y 96 + r.');
  });

  it('a downsampled picture says so in its header, with a ruler that maps columns back to cells (FB-065)', () => {
    const m = run(map(128, 256), [{ op: 'place', assetRef: 'Tower', name: 'tower', x: 41.5, y: 9.5, footprint: { w: 1, h: 1 } }]);
    const ov = mapOverview(m);
    expect(ov.scale).toBe(4);
    expect([ov.lines[0].length, ov.lines.length]).toEqual([32, 64]);
    expect(ov.header).toMatch(/^128×256 cells as 32×64 characters: 1 char = 4×4 cells \(downsampled 4×\); column c covers x 4c\.\.4c\+3, row r covers y 4r\.\.4r\+3\./);
    expect(ov.header).toMatch(/region/);
    expect(ov.ruler).toBe('0         40        80          '); // 120 would run past the last column
    // Map the tower's character back: column c, row r → cells x 4c..4c+3, y 4r..4r+3 hold (41.5, 9.5).
    const T = Object.entries(ov.legend).find(([, v]) => v.includes('tower'))![0];
    const r = ov.lines.findIndex((l) => l.includes(T)), c = ov.lines[r].indexOf(T);
    expect([4 * c <= 41 && 41 <= 4 * c + 3, 4 * r <= 9 && 9 <= 4 * r + 3]).toEqual([true, true]);
    // A region of a big map, downsampled because maxSize is small, gives the offset too; an uneven split is flagged.
    const w = mapOverview(m, { region: [10, 20, 40, 30], maxSize: 8 });
    expect(w.scale).toBe(4);
    expect(w.header).toMatch(/^30×10 cells \(x 10\.\.39, y 20\.\.29\) as 8×3 characters: 1 char = 4×4 cells \(downsampled 4×\); column c covers x 10 \+ 4c\.\.10 \+ 4c\+3, row r covers y 20 \+ 4r\.\.20 \+ 4r\+3 \(the last column \/ row covers fewer cells\)/);
    // A small map: one cell per character, no ruler.
    const small = mapOverview(map(20, 10));
    expect(small.header).toBe('20×10 cells as 20×10 characters: 1 char = 1 cell; column c = x c, row r = y r.');
    expect(small.ruler).toBeUndefined();
  });

  it('a preview of a region is that part at native size; the minimap fits maxSize and takes a region', () => {
    const m = run(map(256, 256), [{ op: 'rect', x0: 40, y0: 40, x1: 47, y1: 47, terrain: 'dirt' }]);
    const r = renderMapPreview(m, [ts], () => null, { region: [40, 40, 48, 48] });
    expect(r.region).toEqual([40, 40, 48, 48]);
    expect(r.scale).toBe(1);
    // An 8×8-cell iso window is 8·64 px wide and 8·32 px tall.
    expect([r.image.width, r.image.height]).toEqual([512, 256]);
    const [cx, cy] = groundPixel(m, 44, 44);
    expect(px(r.image, Math.round(cx - r.origin[0]), Math.round(cy - r.origin[1]))[3]).toBe(255);
    expect(px(r.image, 2, 2)[3]).toBe(0); // the diamond's corner: outside the region's cells

    const mm = renderMinimap(m, [ts], { maxSize: 64 });
    expect(mm.cellsPerPixel).toBe(4);
    expect([mm.image.width, mm.image.height]).toEqual([64, 64]);
    const mr = renderMinimap(m, [ts], { region: [40, 40, 72, 56] });
    expect(mr.region).toEqual([40, 40, 72, 56]);
    expect([mr.image.width, mr.image.height]).toEqual([32 * 16, 16 * 16]);
  });

  it('thousands of placeholder objects get one label per name', () => {
    const m = run(map(64, 64), [{ op: 'scatter', assetRef: 'Tree', name: 'tree', footprint: { w: 1, h: 1 }, count: 300, spacing: 1.5, seed: 1 }]);
    const r = renderMapPreview(m, [ts], () => null, { maxSize: 800 });
    expect(objects(m).length).toBeGreaterThan(PLACEHOLDER_LABELS);
    expect(r.labels.filter((l) => l.text === 'tree')).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/one label per name/);
  });
});

describe('zone vehicles in the preview (FB-059)', () => {
  it('the vehicle stands on the route start facing along it, with arrows the way it drives', () => {
    expect(zoneRoute({ shape: 'rect', points: [[1, 1], [4, 3]] })).toEqual([[1, 1], [4, 1], [4, 3], [1, 3], [1, 1]]);
    expect(zoneRoute({ shape: 'point', points: [[1, 1]] })).toBeNull();
    expect(vehicleStart({ orientation: 'isometric' }, { shape: 'polyline', points: [[2, 2], [10, 2]] })).toEqual({ x: 2, y: 2, facing: 'SE' });
    expect(vehicleStart({ orientation: 'isometric' }, { shape: 'polyline', points: [[2, 9], [2, 2]] })!.facing).toBe('NE');

    const m = run(map(16, 16), [{ op: 'addZone', kind: 'patrol', id: 'r1', name: 'route', points: [[2.5, 2.5], [12.5, 2.5], [12.5, 12.5]], vehicle: 12 }]);
    const asked: MapObject[] = [];
    const r = renderMapPreview(m, [ts], (o) => (asked.push(o), null), { labels: 'zones' });
    expect(asked).toMatchObject([{ id: 'r1:vehicle', spriteId: 12, name: 'truck', facing: 'SE', x: 2.5, y: 2.5 }]);
    expect(r.placeholders).toEqual(['r1:vehicle']);
    expect(r.labels.map((l) => l.text)).toEqual(['patrol: route (truck)']);
    // An arrowhead in the zone colour along the first leg.
    const col = hexToRgba(ZONE_COLORS.patrol);
    const [ax, ay] = groundPixel(m, 7.5, 2.5).map((v, i) => Math.round(v - r.origin[i]));
    let hit = false;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -40; dx <= 40; dx++) {
      const p = px(r.image, ax + dx, ay + dy);
      if (Math.abs(p[0] - col[0]) < 8 && Math.abs(p[1] - col[1]) < 8 && Math.abs(p[2] - col[2]) < 8) hit = true;
    }
    expect(hit).toBe(true);
    // Without a vehicle nothing extra is asked for or drawn.
    const plain = run(map(16, 16), [{ op: 'addZone', kind: 'patrol', points: [[2.5, 2.5], [12.5, 2.5]] }]);
    const asked2: MapObject[] = [];
    expect(renderMapPreview(plain, [ts], (o) => (asked2.push(o), null)).placeholders).toEqual([]);
    expect(asked2).toEqual([]);
    // The minimap marks it too.
    const mm = renderMinimap(m, [ts], { cellPx: 8 });
    expect(px(mm.image, 2 * 8 + 4, 2 * 8 + 4).slice(0, 3)).toEqual(col.slice(0, 3).map(Math.round));
  });
});
