// Moved from the old generator's packages/shared/src/tileset/raster.test.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, bandWindow, cellsFromCorners, composeMap, cornerCombos, createImage, defaultTilesetBody, MASK, overlayAlpha, periodicFbm, periodOffset,
  renderTilesetAtlas, tilePixelGround, tileRenderer, validateTileset, type RgbaImage, type TilesetBody,
} from '../index.js';

const ground = (variants = 2, o: Partial<TilesetBody> = {}): TilesetBody => {
  let b = defaultTilesetBody('Ground', o);
  b = addTerrain(b, { name: 'Grass' }).body;
  b = addTerrain(b, { name: 'Dirt' }).body;
  b = addTerrain(b, { name: 'Sand' }).body;
  return addWangset(b, { pairs: [['grass', 'dirt'], ['grass', 'sand']], variants }).body;
};

/** A small deterministic PRNG for picking test maps. */
const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

/** A (n+1)² vertex grid of terrains where no cell mixes dirt and sand (every cell is a grass–x pair). */
function vertexGrid(n: number, seed: number): string[][] {
  const r = rng(seed);
  const v = Array.from({ length: n + 1 }, () => Array.from({ length: n + 1 }, () => ['grass', 'dirt', 'sand'][Math.floor(r() * 3)]));
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = [v[y][x], v[y][x + 1], v[y + 1][x + 1], v[y + 1][x]];
        if (c.includes('dirt') && c.includes('sand')) {
          const at = [[y, x], [y, x + 1], [y + 1, x + 1], [y + 1, x]].find(([yy, xx]) => v[yy][xx] === 'sand')!;
          v[at[0]][at[1]] = 'grass';
          changed = true;
        }
      }
  }
  return v;
}

const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const diff = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

describe('ground tile renderer: geometry', () => {
  it('a 64×32 iso tile covers exactly the diamond: 1024 pixels, symmetric, rows 2…62…2 wide', () => {
    const g = { orientation: 'isometric' as const, tileWidth: 64, tileHeight: 32 };
    let n = 0;
    const widths: number[] = [];
    for (let y = 0; y < 32; y++) {
      let w = 0;
      for (let x = 0; x < 64; x++) {
        const in1 = !!tilePixelGround(g, x, y);
        expect(in1).toBe(!!tilePixelGround(g, 63 - x, y)); // left–right symmetric
        if (in1) n++, w++;
      }
      widths.push(w);
    }
    expect(n).toBe((64 * 32) / 2);
    // Pixel centres strictly inside a half-open diamond: rows 2, 6, … 62, 62, … 6, 2 (the neighbours fill the rest).
    expect(widths).toEqual([...Array.from({ length: 16 }, (_, i) => 2 + 4 * i), ...Array.from({ length: 16 }, (_, i) => 62 - 4 * i)]);
    // Corners of the picture are outside, the centre inside, and its ground point is the tile centre.
    expect(tilePixelGround(g, 0, 0)).toBeNull();
    expect(tilePixelGround(g, 63, 31)).toBeNull();
    const c = tilePixelGround(g, 31, 15)!;
    expect(c[0]).toBeCloseTo(15.5 / 32 - 0.5 / 64, 9);
    expect(c[1]).toBeCloseTo(15.5 / 32 + 0.5 / 64, 9);
  });

  it('orthogonal tiles are full squares', () => {
    const g = { orientation: 'orthogonal' as const, tileWidth: 32, tileHeight: 32 };
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) expect(tilePixelGround(g, x, y)).not.toBeNull();
  });

  it('a composed map covers every pixel of its cells exactly once (no gaps, no double-drawn seams)', () => {
    const b = ground(1);
    const { image: atlas } = renderTilesetAtlas(b);
    const n = 5;
    const cells = cellsFromCorners(b, Array.from({ length: n + 1 }, () => Array(n + 1).fill('grass')));
    const { image, overlaps } = composeMap(b, atlas, cells);
    expect(overlaps).toBe(0);
    // Every pixel whose centre lies inside the map's ground rectangle [0, n)² is opaque, every other transparent.
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const X = x + 0.5 - ((n - 1) * 64) / 2 - 32, Y = y + 0.5;
        const u = Y / 32 + X / 64, v = Y / 32 - X / 64;
        expect(px(image, x, y)[3] > 0).toBe(u >= 0 && u < n && v >= 0 && v < n);
      }
  });
});

describe('ground tile renderer: transitions', () => {
  it('noise fields are periodic with a period of one tile (world-seamless)', () => {
    for (const [u, v] of [[0, 0.3], [0.7, 0], [0, 0]]) {
      expect(periodicFbm(u, v, 3, 3, 42)).toBeCloseTo(periodicFbm(u === 0 ? 1 : u, v === 0 ? 1 : v, 3, 3, 42), 12);
    }
  });

  it('the masks of two neighbouring tiles agree all along their shared edge, for every corner combination and variant', () => {
    const combos = cornerCombos('grass', 'dirt');
    let checked = 0;
    for (const A of combos)
      for (const B of combos) {
        // B to the right of A (map x + 1): A's TR/BR are B's TL/BL.
        if (A[1] === B[0] && A[2] === B[3])
          for (let i = 0; i <= 20; i++) {
            const v = i / 20;
            expect(overlayAlpha(A, 'dirt', 1, v, 0)).toBeCloseTo(overlayAlpha(B, 'dirt', 0, v, 1), 12);
            checked++;
          }
        // B below A (map y + 1): A's BL/BR are B's TL/TR.
        if (A[3] === B[0] && A[2] === B[1])
          for (let i = 0; i <= 20; i++) {
            const u = i / 20;
            expect(overlayAlpha(A, 'dirt', u, 1, 1)).toBeCloseTo(overlayAlpha(B, 'dirt', u, 0, 0), 12);
            checked++;
          }
      }
    expect(checked).toBeGreaterThan(1000);
  });

  it('pure tiles are pure and an edge whose corners lack a terrain never shows it', () => {
    expect(MASK.world + MASK.long + MASK.variant).toBeLessThan(0.5 - MASK.soft);
    const allGrass: [string, string, string, string] = ['grass', 'grass', 'grass', 'grass'];
    const oneDirt: [string, string, string, string] = ['grass', 'dirt', 'grass', 'grass']; // dirt at the right vertex
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      expect(overlayAlpha(allGrass, 'dirt', t, 0.5, 0)).toBe(0);
      expect(overlayAlpha(oneDirt, 'dirt', 0, t, 1)).toBe(0); // left edge (TL–BL): grass only
      expect(overlayAlpha(oneDirt, 'dirt', t, 1, 1)).toBe(0); // bottom edge (BL–BR): grass only
    }
    expect(overlayAlpha(oneDirt, 'dirt', 0.999, 0.001, 0)).toBe(1);
  });

  it('a 4×4 patch of mixed wang tiles is opaque inside and continuous across tile edges', () => {
    const b = ground(2);
    const { image: atlas, warnings } = renderTilesetAtlas(b);
    expect(warnings).toEqual([]);
    for (const seed of [1, 2, 3]) {
      const verts = vertexGrid(4, seed);
      const cells = cellsFromCorners(b, verts, (mx, my, n) => (mx * 3 + my * 5 + seed) % n);
      expect(cells.flat().every((c) => c !== null)).toBe(true);
      const { image, overlaps } = composeMap(b, atlas, cells);
      expect(overlaps).toBe(0);
      // Which cell each pixel came from, to tell tile edges from tile interiors.
      const owner = (x: number, y: number) => {
        const X = x + 0.5 - (3 * 64) / 2 - 32, Y = y + 0.5;
        const u = Y / 32 + X / 64, v = Y / 32 - X / 64;
        return u >= 0 && u < 4 && v >= 0 && v < 4 ? Math.floor(u) * 4 + Math.floor(v) : -1;
      };
      let within = 0, withinN = 0, across = 0, acrossN = 0, acrossMax = 0, withinMax = 0;
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x + 1 < image.width; x++) {
          const o1 = owner(x, y), o2 = owner(x + 1, y);
          if (o1 >= 0) expect(px(image, x, y)[3]).toBe(255);
          if (o1 < 0 || o2 < 0) continue;
          const d = diff(px(image, x, y), px(image, x + 1, y));
          if (o1 === o2) (within += d), withinN++, (withinMax = Math.max(withinMax, d));
          else (across += d), acrossN++, (acrossMax = Math.max(acrossMax, d));
        }
      expect(acrossN).toBeGreaterThan(100);
      // Neighbouring pixels in different tiles differ no more than neighbouring pixels inside one tile.
      expect(across / acrossN).toBeLessThan((within / withinN) * 1.5 + 1);
      expect(acrossMax).toBeLessThanOrEqual(withinMax + 4);
    }
  });

  it('variants differ inside but share their edges', () => {
    const b = ground(2);
    const r = tileRenderer(b);
    const pure = b.tiles.filter((t) => t.terrainCorners!.every((c) => c === 'grass'));
    expect(pure.map((t) => t.variant)).toEqual([0, 1]);
    const a = createImage(64, 32), c = createImage(64, 32);
    r.drawTile(pure[0], a, 0, 0);
    r.drawTile(pure[1], c, 0, 0);
    expect(px(a, 32, 16)).not.toEqual(px(c, 32, 16));
    // Edge pixels (the diamond's outline rows) are within a couple of levels.
    expect(diff(px(a, 31, 0), px(c, 31, 0))).toBeLessThanOrEqual(3);
    expect(diff(px(a, 0, 15), px(c, 0, 15))).toBeLessThanOrEqual(3);
  });

  it('textures are sampled per tile with wrap, tinted, and a missing texture falls back with a warning', () => {
    let b = defaultTilesetBody('T');
    b = addTerrain(b, { name: 'Snow', source: { type: 'texture', path: 'Textures/Grass.png' }, tint: '#eef4ff' }).body;
    b = addTerrain(b, { name: 'Dirt' }).body;
    b = addWangset(b, { pairs: [['snow', 'dirt']] }).body;
    // A 4×4 green checker texture: tinted to snow it must come out bluish white, not green.
    const tex = createImage(4, 4);
    for (let i = 0; i < 16; i++) tex.data.set((i + (i >> 2)) % 2 ? [40, 120, 40, 255] : [60, 160, 60, 255], i * 4);
    const ok = renderTilesetAtlas(b, { textures: { snow: tex } });
    expect(ok.warnings).toEqual([]);
    const p = px(ok.image, 32, 16);
    expect(p[2]).toBeGreaterThan(p[1] - 30);
    expect(p[0]).toBeGreaterThan(150);
    const missing = renderTilesetAtlas(b);
    expect(missing.warnings[0]).toMatch(/snow.*not loaded/);
    expect(px(missing.image, 32, 16)[3]).toBe(255);
  });

  it('is deterministic', () => {
    const b = ground(2);
    expect(Buffer.from(renderTilesetAtlas(b).image.data).equals(Buffer.from(renderTilesetAtlas(b).image.data))).toBe(true);
  });
});

/** Seam statistics of a composed n×n patch: neighbouring pixels across tile edges vs inside one tile. */
function seamStats(b: TilesetBody, atlas: RgbaImage, cells: (number | null)[][]) {
  const n = cells.length;
  const { image, overlaps } = composeMap(b, atlas, cells);
  expect(overlaps).toBe(0);
  const owner = (x: number, y: number) => {
    const X = x + 0.5 - ((n - 1) * b.tileWidth) / 2 - b.tileWidth / 2, Y = y + 0.5;
    const u = Y / b.tileHeight + X / b.tileWidth, v = Y / b.tileHeight - X / b.tileWidth;
    return u >= 0 && u < n && v >= 0 && v < n ? Math.floor(u) * n + Math.floor(v) : -1;
  };
  let within = 0, withinN = 0, across = 0, acrossN = 0, acrossMax = 0, withinMax = 0;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x + 1 < image.width; x++) {
      const o1 = owner(x, y), o2 = owner(x + 1, y);
      if (o1 < 0 || o2 < 0) continue;
      const d = diff(px(image, x, y), px(image, x + 1, y));
      if (o1 === o2) (within += d), withinN++, (withinMax = Math.max(withinMax, d));
      else (across += d), acrossN++, (acrossMax = Math.max(acrossMax, d));
    }
  return { across: across / acrossN, within: within / withinN, acrossMax, withinMax, acrossN };
}

/** A non-periodic test texture: smooth blobs plus fine speckle (a stand-in for a 2048 px Synty ground texture). */
function groundTexture(size: number): RgbaImage {
  const t = createImage(size, size);
  const r = rng(9);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const k = 0.5 + 0.15 * Math.sin(x * 0.03) * Math.cos(y * 0.02 + x * 0.01) + 0.6 * (r() - 0.5);
      t.data.set([60 + 80 * k, 110 + 90 * k, 40 + 50 * k, 255].map(Math.round), (y * size + x) * 4);
    }
  return t;
}

describe('ground tile renderer: noise period and texture scale (B3/B2 polish)', () => {
  const big = (variants: number, period = 4) => ({ ...ground(variants), noisePeriod: period });

  it('mask edges agree between any two variants (any period cell), so seams hold whatever a map picks', () => {
    const combos = cornerCombos('grass', 'dirt');
    for (const P of [1, 4, 8])
      for (const A of combos)
        for (const B of combos) {
          if (A[1] !== B[0] || A[2] !== B[3]) continue;
          for (let i = 0; i <= 10; i++) {
            const v = i / 10;
            expect(overlayAlpha(A, 'dirt', 1, v, 5, P)).toBeCloseTo(overlayAlpha(B, 'dirt', 0, v, 11, P), 12);
          }
        }
    expect(bandWindow(0, 0.5)).toBe(0);
    expect(bandWindow(0.5, 1)).toBe(0);
    expect(bandWindow(0.5, 0.5)).toBe(1);
    expect(periodOffset(6, 4)).toEqual([2, 1]);
    expect(periodOffset(17, 4)).toEqual([1, 0]);
  });

  it('a long straight border no longer repeats every tile: it repeats every period', () => {
    const border: [string, string, string, string] = ['grass', 'grass', 'dirt', 'dirt'];
    // Where along v the border crosses, sampled across the middle of a tile, for the variant drawn at period cell x.
    const profile = (variant: number) => Array.from({ length: 9 }, (_, i) => {
      const u = 0.1 + 0.1 * i;
      let v = 0;
      while (v < 1 && overlayAlpha(border, 'dirt', u, v, variant, 4) < 0.5) v += 0.005;
      return v;
    });
    const p0 = profile(0), p1 = profile(1);
    expect(Math.max(...p0.map((x, i) => Math.abs(x - p1[i])))).toBeGreaterThan(0.02); // neighbours differ
  });

  it('with P² variants the map picks by position: tiles P apart are the same tile; seams stay perfect', () => {
    const b = big(16);
    expect(b.tiles.length).toBe(3 * 16 + 2 * 14 * 16 + 4); // + 4 diagonal three-terrain mixes (mixes auto)
    const { image: atlas } = renderTilesetAtlas(b);
    const verts = vertexGrid(8, 4);
    const cells = cellsFromCorners(b, verts);
    const tile = new Map(b.tiles.map((t) => [t.id, t]));
    for (let my = 0; my < 8; my++)
      for (let mx = 0; mx < 8; mx++) expect(tile.get(cells[my][mx]!)!.variant).toBe((mx % 4) + 4 * (my % 4));
    const s = seamStats(b, atlas, cells);
    expect(s.acrossN).toBeGreaterThan(300);
    expect(s.across).toBeLessThan(s.within * 1.5 + 1);
    expect(s.acrossMax).toBeLessThanOrEqual(s.withinMax + 4);
    // Random picks among the same variants are just as seamless.
    const random = cellsFromCorners(b, verts, (mx, my, n) => Math.floor(rng(mx * 31 + my * 7 + 1)() * n));
    const r = seamStats(b, atlas, random);
    expect(r.across).toBeLessThan(r.within * 1.5 + 1);
    expect(r.acrossMax).toBeLessThanOrEqual(r.withinMax + 4);
  });

  it('a texture at scale 2 (two tiles per repeat) keeps its detail and stays seamless with any variant pick', () => {
    let b: TilesetBody = { ...defaultTilesetBody('T'), noisePeriod: 4 };
    b = addTerrain(b, { name: 'Grass', source: { type: 'texture', path: 'g.png', scale: 2 } }).body;
    b = addTerrain(b, { name: 'Dirt' }).body;
    b = addWangset(b, { pairs: [['grass', 'dirt']], variants: 4 }).body;
    const tex = groundTexture(256);
    const { image: atlas, warnings } = renderTilesetAtlas(b, { textures: { grass: tex } });
    expect(warnings).toEqual([]);
    for (const seed of [1, 2]) {
      const verts = Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => (rng(seed * 100 + y * 7 + x)() < 0.75 ? 'grass' : 'dirt')));
      const cells = cellsFromCorners(b, verts, (mx, my, n) => Math.floor(rng(seed + mx * 13 + my * 17)() * n));
      const s = seamStats(b, atlas, cells);
      expect(s.across).toBeLessThan(s.within * 1.5 + 1);
      expect(s.acrossMax).toBeLessThanOrEqual(s.withinMax + 4);
    }
    // Scale 2 shows finer detail than scale 1 (more contrast between neighbouring pixels of a pure tile).
    const one = renderTilesetAtlas({ ...b, terrains: b.terrains.map((t) => (t.id === 'grass' ? { ...t, source: { type: 'texture' as const, path: 'g.png' } } : t)) }, { textures: { grass: tex } }).image;
    const grain = (img: RgbaImage) => {
      let d = 0;
      for (let x = 16; x < 47; x++) d += diff(px(img, x, 16), px(img, x + 1, 16));
      return d;
    };
    expect(grain(atlas)).toBeGreaterThan(grain(one));
    // Validation: a texture scale must be a whole number of tiles.
    expect(validateTileset({ ...b, terrains: b.terrains.map((t) => (t.id === 'grass' ? { ...t, source: { type: 'texture' as const, path: 'g.png', scale: 1.5 } } : t)) }))
      .toEqual(['terrain "grass": texture scale must be a whole number of tiles (1–16 × 1 m)']);
  });
});
