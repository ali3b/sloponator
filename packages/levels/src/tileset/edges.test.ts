// Moved from the old generator's packages/shared/src/tileset/edges.test.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, applyOps, atlasLayout, cellOrigin, cellsFromCorners, cliffCells, composeMap, cornerCombos, declareTileset, defaultMapBody, defaultTilesetBody,
  elevationLookup, isCliffCorners, MASK, overlayField, parseTilesetDecls, raisedAtPoint, renderMapPreview, renderTilesetAtlas, SHORE, tileExtraHeight, tileImageHeight,
  tilePixelGround, toTiledJson, toTiledMapJson, validateTileset, writeTsx, type MapBody, type ObjectPicture, type RgbaImage, type TilesetBody,
} from '../index.js';

/** B4 edges: water shores and one-level cliffs. */

const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const diff = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const luma = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

const shoreSet = (variants = 2): TilesetBody => {
  let b = defaultTilesetBody('Lake');
  b = addTerrain(b, { name: 'Grass' }).body;
  b = addTerrain(b, { name: 'Water' }).body;
  return addWangset(b, { pairs: [['grass', 'water']], variants }).body;
};
const cliffSet = (variants = 2, o: Partial<TilesetBody> = {}): TilesetBody => {
  let b = defaultTilesetBody('Highland', o);
  b = addTerrain(b, { name: 'Grass' }).body;
  b = addTerrain(b, { name: 'Plateau', kind: 'rock', height: 1 }).body;
  return addWangset(b, { pairs: [['grass', 'plateau']], variants }).body;
};

/**
 * Compose cells back to front (like composeMap) and remember which cell drew each pixel last, so neighbouring pixels
 * can be told apart as "same tile" or "across a tile edge".
 */
function composeOwned(b: TilesetBody, atlas: RgbaImage, cells: (number | null)[][]) {
  const l = atlasLayout(b);
  const { image, overlaps, top } = composeMap(b, atlas, cells);
  const owner = new Int32Array(image.width * image.height).fill(-1);
  const n = cells.length;
  for (let my = 0; my < n; my++)
    for (let mx = 0; mx < cells[0].length; mx++) {
      const id = cells[my][mx];
      if (id === null) continue;
      const [ox, oy] = cellOrigin(b, mx, my, n);
      const sx = (id % l.columns) * b.tileWidth, sy = Math.floor(id / l.columns) * l.tileheight;
      for (let y = 0; y < l.tileheight; y++)
        for (let x = 0; x < b.tileWidth; x++) if (atlas.data[((sy + y) * atlas.width + sx + x) * 4 + 3]) owner[(oy + y) * image.width + ox + x] = my * 1000 + mx;
    }
  return { image, overlaps, top, owner };
}

/** Neighbouring pixel differences across tile edges vs inside one tile (horizontal and vertical neighbours). */
function seamStats(image: RgbaImage, owner: Int32Array) {
  let within = 0, withinN = 0, across = 0, acrossN = 0, acrossMax = 0, withinMax = 0;
  for (let y = 0; y + 1 < image.height; y++)
    for (let x = 0; x + 1 < image.width; x++)
      for (const [x2, y2] of [[x + 1, y], [x, y + 1]]) {
        const o1 = owner[y * image.width + x], o2 = owner[y2 * image.width + x2];
        if (o1 < 0 || o2 < 0) continue;
        const d = diff(px(image, x, y), px(image, x2, y2));
        if (o1 === o2) (within += d), withinN++, (withinMax = Math.max(withinMax, d));
        else (across += d), acrossN++, (acrossMax = Math.max(acrossMax, d));
      }
  return { across: across / acrossN, within: within / withinN, acrossMax, withinMax, acrossN };
}

const randomVerts = (n: number, seed: number, p: number, a: string, b: string) => Array.from({ length: n + 1 }, (_, y) => Array.from({ length: n + 1 }, (_, x) => (rng(seed * 977 + y * 31 + x)() < p ? b : a)));

describe('B4 shores', () => {
  it('the shore bands sit strictly between the field on all-land and all-water edges, so edges match pure tiles', () => {
    // On an edge whose corners are both water (or both land) the field is 1 (0) plus the world noise, |n| ≤ MASK.world.
    expect(1 - MASK.world).toBeGreaterThanOrEqual(SHORE.deep);
    expect(MASK.world).toBeLessThanOrEqual(SHORE.wet);
    const combos = cornerCombos('grass', 'water');
    let seen = 0;
    for (const c of combos.slice(1, 15))
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        // Top edge (TL–TR) and left edge (TL–BL), every variant.
        for (const [u, v, a, b] of [[t, 0, c[0], c[1]], [0, t, c[0], c[3]]] as [number, number, string, string][])
          if (a === b) {
            const f = overlayField(c, 'water', u, v, 3);
            if (a === 'water') expect(f).toBeGreaterThanOrEqual(SHORE.deep);
            else expect(f === -Infinity || f <= SHORE.wet).toBe(true);
            seen++;
          }
      }
    expect(seen).toBeGreaterThan(200);
  });

  it('a lake: foam on the line, wet sand on the land side, shallows lighter than the deep middle', () => {
    const b = shoreSet(1);
    const { image } = renderTilesetAtlas(b);
    const l = atlasLayout(b);
    const tileAt = (corners: string[]) => b.tiles.find((t) => t.terrainCorners!.join() === corners.join())!;
    const at = (id: number, x: number, y: number) => px(image, (id % l.columns) * 64 + x, Math.floor(id / l.columns) * l.tileheight + y);
    const water = tileAt(['water', 'water', 'water', 'water']), grass = tileAt(['grass', 'grass', 'grass', 'grass']);
    // Water at the top two corners, grass at the bottom two: walk down the tile's middle column (u = v there).
    const half = tileAt(['water', 'water', 'grass', 'grass']);
    const col = Array.from({ length: 30 }, (_, i) => at(half.id, 32, i + 1));
    const bright = Math.max(...col.map(luma));
    expect(bright).toBeGreaterThan(luma(at(water.id, 32, 16)) + 60); // a foam line
    expect(bright).toBeGreaterThan(luma(at(grass.id, 32, 16)) + 25);
    // The deep water of a pure tile is darker than the shallows next to the line.
    const shallow = col.slice(0, 12).filter((p) => p[2] > p[0] + 30).map(luma);
    expect(Math.max(...shallow)).toBeGreaterThan(luma(at(water.id, 32, 16)) + 5);
    // Shore off: no foam.
    const plain = { ...b, terrains: b.terrains.map((t) => (t.id === 'water' ? { ...t, shore: false } : t)) };
    const p = renderTilesetAtlas(plain).image;
    const plainCol = Array.from({ length: 30 }, (_, i) => px(p, (half.id % l.columns) * 64 + 32, Math.floor(half.id / l.columns) * l.tileheight + i + 1));
    expect(Math.max(...plainCol.map(luma))).toBeLessThan(bright - 20);
  });

  it('shore tiles are seamless in any map: tile edges are no sharper than tile interiors', () => {
    const b = shoreSet(2);
    const { image: atlas } = renderTilesetAtlas(b);
    for (const seed of [1, 2, 3]) {
      const cells = cellsFromCorners(b, randomVerts(6, seed, 0.45, 'grass', 'water'), (mx, my, n) => Math.floor(rng(seed + mx * 13 + my * 17)() * n));
      const c = composeOwned(b, atlas, cells);
      expect(c.overlaps).toBe(0);
      const s = seamStats(c.image, c.owner);
      expect(s.acrossN).toBeGreaterThan(300);
      expect(s.across).toBeLessThan(s.within * 1.5 + 1);
      expect(s.acrossMax).toBeLessThanOrEqual(s.withinMax + 4);
    }
  });
});

describe('B4 cliffs', () => {
  it('a raised terrain makes every tile picture taller: atlas, layout and Tiled tileset agree', () => {
    const flat = shoreSet(1);
    expect(tileExtraHeight(flat)).toBe(0);
    expect(atlasLayout(flat).tileheight).toBe(32);
    const b = cliffSet(1);
    expect(tileExtraHeight(b)).toBe(16);
    expect(tileImageHeight(b)).toBe(48);
    expect(tileImageHeight({ ...b, cliffHeight: 24 })).toBe(56);
    const l = atlasLayout(b);
    const a = renderTilesetAtlas(b);
    expect(a.image.height).toBe(Math.ceil(b.tiles.length / l.columns) * 48);
    expect(l.imageheight).toBe(a.image.height);
    const j = toTiledJson(b);
    expect(j.tileheight).toBe(48);
    expect(j.grid).toEqual({ height: 32, orientation: 'isometric', width: 64 });
    expect(j.properties.find((p) => p.name === 'cliffHeight')).toEqual({ name: 'cliffHeight', type: 'int', value: 16 });
    // Cliff tiles: the cliff flag and a collision polygon over their diamond (the bottom 32 rows); pure plateau: elevation.
    const cliffs = b.tiles.filter((t) => isCliffCorners(b.terrains, t.terrainCorners!));
    expect(cliffs.length).toBe(14);
    for (const t of cliffs) {
      const jt = j.tiles!.find((x) => x.id === t.id)!;
      expect(jt.properties).toContainEqual({ name: 'cliff', type: 'bool', value: true });
      expect(jt.objectgroup!.objects[0].polygon).toEqual([{ x: 32, y: 16 }, { x: 64, y: 32 }, { x: 32, y: 48 }, { x: 0, y: 32 }]);
    }
    const top = b.tiles.find((t) => t.terrainCorners!.every((c) => c === 'plateau'))!;
    expect(j.tiles!.find((x) => x.id === top.id)!.properties).toContainEqual({ name: 'elevation', type: 'int', value: 1 });
    expect(j.wangsets![0].colors[1].properties).toContainEqual({ name: 'height', type: 'int', value: 1 });
    expect(writeTsx(b)).toMatch(/<tileset [^>]*tileheight="48"/);
    expect(writeTsx(b)).toMatch(/<grid orientation="isometric" width="64" height="32"\/>/);
    expect(validateTileset({ ...b, cliffHeight: 0 })).toEqual(['cliffHeight must be a whole number of pixels (1–64)']);
    expect(validateTileset({ ...b, terrains: b.terrains.map((t) => ({ ...t, height: 2 as 1 })) })[0]).toMatch(/height must be 0/);
  });

  it('tile pictures: ground in the bottom rows, the raised top in the top rows, the face hanging below the rim', () => {
    const b = cliffSet(1);
    const { image } = renderTilesetAtlas(b);
    const l = atlasLayout(b);
    const tileAt = (corners: string[]) => b.tiles.find((t) => t.terrainCorners!.join() === corners.join())!;
    const slot = (id: number) => [(id % l.columns) * 64, Math.floor(id / l.columns) * 48];
    const shape = (id: number) => {
      const [sx, sy] = slot(id);
      return Array.from({ length: 48 }, (_, y) => Array.from({ length: 64 }, (_, x) => image.data[((sy + y) * image.width + sx + x) * 4 + 3] > 0));
    };
    const inDiamond = (x: number, y: number) => !!tilePixelGround(b, x, y);
    // Pure ground: exactly the diamond, in the bottom 32 rows.
    const g = shape(tileAt(['grass', 'grass', 'grass', 'grass']).id);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) expect(g[y][x]).toBe(y >= 16 && inDiamond(x, y - 16));
    // Pure plateau: the diamond raised 16 px (top rows) plus its prism's sides: the union of the diamond swept down 16 px.
    const p = shape(tileAt(['plateau', 'plateau', 'plateau', 'plateau']).id);
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 64; x++) {
        let swept = false;
        for (let d = 0; d <= 16 && !swept; d++) swept = y - d >= 0 && y - d < 32 && inDiamond(x, y - d);
        expect(p[y][x]).toBe(swept);
      }
    // Every pixel of the ground diamond is opaque in every tile (each ground pixel is drawn exactly once on a map).
    for (const t of b.tiles) {
      const s = shape(t.id);
      for (let y = 16; y < 48; y++) for (let x = 0; x < 64; x++) if (inDiamond(x, y - 16)) expect(s[y][x]).toBe(true);
    }
  });

  it('the raised mask agrees along shared edges for every combination and variant (cliff tops and feet meet)', () => {
    const b = cliffSet(4, { noisePeriod: 2 } as Partial<TilesetBody>);
    const combos = cornerCombos('grass', 'plateau');
    let checked = 0;
    for (const A of combos)
      for (const B of combos) {
        if (A[1] === B[0] && A[2] === B[3])
          for (let i = 0; i <= 40; i++) {
            const v = i / 40 * 0.9999;
            expect(raisedAtPoint(b, { terrainCorners: A, variant: 1 }, 0.99999999, v)).toBe(raisedAtPoint(b, { terrainCorners: B, variant: 3 }, 0, v));
            checked++;
          }
        if (A[3] === B[0] && A[2] === B[1])
          for (let i = 0; i <= 40; i++) {
            const u = i / 40 * 0.9999;
            expect(raisedAtPoint(b, { terrainCorners: A, variant: 0 }, u, 0.99999999)).toBe(raisedAtPoint(b, { terrainCorners: B, variant: 2 }, u, 0));
            checked++;
          }
      }
    expect(checked).toBeGreaterThan(5000);
  });

  it('a plateau map is drawn back to front: every ground pixel exactly once, seams no sharper than tile interiors', () => {
    const b = cliffSet(2);
    const { image: atlas } = renderTilesetAtlas(b);
    for (const seed of [4, 5, 6]) {
      const cells = cellsFromCorners(b, randomVerts(6, seed, 0.4, 'grass', 'plateau'), (mx, my, n) => Math.floor(rng(seed + mx * 7 + my * 3)() * n));
      const c = composeOwned(b, atlas, cells);
      expect(c.overlaps).toBe(0);
      expect(c.top).toBe(16);
      const s = seamStats(c.image, c.owner);
      expect(s.acrossN).toBeGreaterThan(300);
      expect(s.across).toBeLessThan(s.within * 1.5 + 1);
      expect(s.acrossMax).toBeLessThanOrEqual(s.withinMax + 4);
    }
  });

  it('only camera-facing sides show a face: under the front rim rock, behind the back rim grass', () => {
    const b = cliffSet(1);
    const { image: atlas } = renderTilesetAtlas(b);
    const n = 8;
    // A 3×3-cell plateau (corners 3..5 raised) in an 8×8 map.
    const verts = Array.from({ length: n + 1 }, (_, y) => Array.from({ length: n + 1 }, (_, x) => (x >= 3 && x <= 5 && y >= 3 && y <= 5 ? 'plateau' : 'grass')));
    const { image, top } = composeMap(b, atlas, cellsFromCorners(b, verts));
    const grassish = (p: number[]) => p[1] > p[0] + 20 && p[1] > p[2] + 20;
    // The plateau's front (bottom) corner is vertex (5, 5); its back (top) corner vertex (3, 3). Native pixel of vertex (x, y):
    const vx = (x: number, y: number): [number, number] => [((x - y + n) * 64) / 2, ((x + y) * 32) / 2 + top];
    const [fx, fy] = vx(5, 5), [bx, by] = vx(3, 3);
    // Straight below the front corner, 6–14 px under the raised rim (rim ≈ 8 px inside the corner, raised by 16): the face.
    for (let d = 0; d <= 6; d++) expect(grassish(px(image, fx, fy - 16 - 8 + 6 + d))).toBe(false);
    // Below the plateau's foot it is grass again.
    expect(grassish(px(image, fx, fy + 14))).toBe(true);
    // Above the back corner: grass (the back face is hidden under the raised top, which starts above the vertex).
    expect(grassish(px(image, bx, by - 30))).toBe(true);
  });
});

describe('B4 maps with raised terrain', () => {
  const setup = () => {
    const b = cliffSet(1);
    let m: MapBody = defaultMapBody('Hill', { width: 8, height: 8, tilesets: [1], terrain: 'grass' });
    const r = applyOps(m, [{ op: 'rect', terrain: 'plateau', x0: 2, y0: 2, x1: 4, y1: 4 }], { tilesets: [b] });
    expect(r.errors).toEqual([]);
    m = r.doc;
    return { b, m };
  };

  it('the preview draws tall tiles exactly like the compositor (and Tiled), back to front, with room above the map', () => {
    const { b, m } = setup();
    const { image: atlas, columns } = renderTilesetAtlas(b);
    const ref = composeMap(b, atlas, cellsFromCorners(b, Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) => m.layers[0].type === 'ground' ? m.layers[0].corners[y * 9 + x] : ''))));
    const p = renderMapPreview(m, [{ body: b, atlas, columns }], () => null, { layers: ['ground'], zones: false, labels: false });
    expect(p.origin).toEqual([0, -16]);
    expect([p.image.width, p.image.height]).toEqual([ref.image.width, ref.image.height]);
    let bad = 0;
    for (let i = 0; i < ref.image.data.length; i++) if (ref.image.data[i] !== p.image.data[i]) bad++;
    expect(bad).toBe(0);
  });

  it('objects on the plateau are drawn the cliff height higher, and exported with elevation 1', () => {
    const { b, m } = setup();
    const look = elevationLookup(m, [b]);
    expect(look(3.5, 3.5)).toEqual({ level: 1, raisePx: 16 });
    expect(look(0.5, 0.5)).toEqual({ level: 0, raisePx: 0 });
    const r = applyOps(m, [
      { op: 'place', assetRef: 'Hut', x: 3.5, y: 3.5, footprint: null },
      { op: 'place', assetRef: 'Tree', x: 0.5, y: 6.5, footprint: null },
    ], { tilesets: [b] });
    const doc = r.doc;
    // A 1×1 red frame anchored at its own pixel: it lands on the anchor (raised by 16 on the plateau).
    const page = { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) };
    const pic: ObjectPicture = { page, frame: { x: 0, y: 0, w: 1, h: 1 }, trimX: 0, trimY: 0, sourceW: 1, sourceH: 1, flipX: false, anchor: { x: 0, y: 0 }, pixelsPerMetre: null };
    const { image: atlas, columns } = renderTilesetAtlas(b);
    const p = renderMapPreview(doc, [{ body: b, atlas, columns }], () => pic, { zones: false, labels: false });
    const at = (x: number, y: number) => px(p.image, x - p.origin[0], y - p.origin[1]);
    const g = (x: number, y: number) => [((x - y + 8) * 64) / 2, ((x + y) * 32) / 2];
    const [hx, hy] = g(3.5, 3.5), [tx, ty] = g(0.5, 6.5);
    expect(at(hx, hy - 16)).toEqual([255, 0, 0, 255]);
    expect(at(tx, ty)).toEqual([255, 0, 0, 255]);
    const tmj = toTiledMapJson(doc, { tilesets: [{ body: b, file: 'highland' }], embed: true });
    type Obj = { name: string; properties?: { name: string; value: unknown }[] };
    const objs = (tmj.map.layers.find((l) => l.name === 'objects') as unknown as { objects: Obj[] }).objects;
    const elev = (name: string) => objs.find((o) => o.name === name)!.properties!.find((pp) => pp.name === 'elevation')?.value;
    expect(elev('Hut')).toBe(1);
    expect(elev('Tree')).toBeUndefined();
    const groundLayer = tmj.map.layers.find((l) => l.name === 'ground')!;
    expect(groundLayer.properties).toContainEqual({ name: 'tileOffsetY', type: 'int', value: -16 });
    expect(tmj.map.tilesets[0]).toMatchObject({ tileheight: 48, grid: { height: 32 } });
  });

  it('the cliffs op blocks exactly the cells where plateau and ground meet', () => {
    const { b, m } = setup();
    const g = m.layers.find((l) => l.type === 'ground')!;
    const want = cliffCells(m, g as never, b);
    expect(want.length).toBe(5 * 5 - 3 * 3); // the ring of cells around the 3×3 raised cells
    const r = applyOps(m, [{ op: 'cliffs' }], { tilesets: [b] });
    expect(r.errors).toEqual([]);
    expect(r.reports[0]).toMatchObject({ op: 'cliffs', cliffCells: want.length });
    const c = r.doc.layers.find((l) => l.type === 'collision')!;
    if (c.type !== 'collision') throw new Error();
    expect(c.cells.reduce<number>((n, v) => n + v, 0)).toBe(want.length);
    for (const [x, y] of want) expect(c.cells[y * 8 + x]).toBe(1);
    const off = applyOps(r.doc, [{ op: 'cliffs', value: false }], { tilesets: [b] }).doc.layers.find((l) => l.type === 'collision')!;
    if (off.type === 'collision') expect(off.cells.every((v) => v === 0)).toBe(true);
    expect(applyOps(m, [{ op: 'cliffs' }], { tilesets: [shoreSet()] }).errors[0].message).toMatch(/no raised terrain/);
  });
});

describe('B4 declared tilesets', () => {
  it('cliff / height / shore / cliffHeight are declared, applied and validated', () => {
    const [d] = parseTilesetDecls([{
      name: 'Edges', cliffHeight: 20,
      terrains: ['grass', { name: 'lake', kind: 'water', blend: 'grass', shore: true }, { name: 'rock', cliff: true, blend: 'grass' }, { name: 'mesa', kind: 'dirt', height: 1 }],
      pairs: [['grass', 'mesa']],
    }]);
    expect(d.cliffHeight).toBe(20);
    expect(d.terrains[1]).toMatchObject({ shore: true });
    expect(d.terrains[2]).toMatchObject({ height: 1 });
    expect(d.terrains[3]).toMatchObject({ height: 1 });
    const body = declareTileset(null, d);
    expect(body.cliffHeight).toBe(20);
    expect(body.terrains.find((t) => t.id === 'rock')!.height).toBe(1);
    expect(tileImageHeight(body)).toBe(52);
    expect(() => parseTilesetDecls([{ name: 'X', terrains: [{ name: 'a', height: 2 }] }])).toThrow(/height must be 0/);
    expect(() => parseTilesetDecls([{ name: 'X', terrains: [{ name: 'a', cliff: true, height: 0 }] }])).toThrow(/disagree/);
    expect(() => declareTileset(null, { ...d, cliffHeight: 100 })).toThrow(/cliffHeight/);
  });
});
