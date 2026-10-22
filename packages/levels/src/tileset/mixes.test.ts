// Moved from the old generator's packages/shared/src/tileset/mixes.test.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { describe, expect, it } from 'vitest';
import {
  addMixCorners, addPairsAndMixes, addTerrain, addTerrainPair, addWangset, allMixesOn, applyOps, atlasLayout, blendedMixCorners, cellOrigin, cellsFromCorners, composeMap,
  cornersKey, declaredShape, declareTileset, defaultMapBody, defaultTilesetBody, distinctTerrains, layerField, missingMixes, missingMixesMessage, mixCombos,
  overlayField, parseTilesetDecls, raisedAtPoint, removeTerrain, renderTilesetAtlas, resolveGround, tileRenderer, toTiledJson, validateTileset, wantedTiles, writeTsx,
  type Corners, type GroundLayer, type MapBody, type RgbaImage, type TerrainInput, type TilesetBody,
} from '../index.js';

/** FB-049: tiles for cells where three or four terrains meet. */

const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const diff = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

function set(names: (string | TerrainInput)[], pairs: [string, string][] | 'all', o: Partial<TilesetBody> = {}, variants = 1): TilesetBody {
  let b: TilesetBody = { ...defaultTilesetBody('Mixed', o), ...(o.mixes ? { mixes: o.mixes } : {}) };
  for (const n of names) b = addTerrain(b, typeof n === 'string' ? { name: n } : n).body;
  const ids = b.terrains.map((t) => t.id);
  const ps = pairs === 'all' ? ids.flatMap((a, i) => ids.slice(i + 1).map((c) => [a, c] as [string, string])) : pairs;
  return addWangset(b, { pairs: ps, variants }).body;
}

/** Compose cells back to front and remember which cell drew each pixel last (seams = neighbours of different owners). */
function composeOwned(b: TilesetBody, atlas: RgbaImage, cells: (number | null)[][]) {
  const l = atlasLayout(b);
  const { image, overlaps } = composeMap(b, atlas, cells);
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
  return { image, overlaps, owner };
}

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

const randomVerts = (n: number, seed: number, terrains: string[]) => {
  const r = rng(seed);
  return Array.from({ length: n + 1 }, () => Array.from({ length: n + 1 }, () => terrains[Math.floor(r() * terrains.length)]));
};

describe('FB-049 mixes: enumeration and ids', () => {
  it('counts: 36 per three terrains blended pairwise, 24 more per four; diagonals need no pair', () => {
    expect(blendedMixCorners(set(['grass', 'dirt', 'sand'], 'all'))).toHaveLength(36);
    expect(blendedMixCorners(set(['grass', 'dirt', 'sand', 'road'], 'all'))).toHaveLength(4 * 36 + 24);
    expect(blendedMixCorners(set(['grass', 'dirt', 'sand', 'road', 'mud'], 'all'))).toHaveLength(10 * 36 + 5 * 24);
    // dirt and sand don't blend: they may only sit on a diagonal, with grass on the other one (2 diagonals × 2 orders).
    const diag = blendedMixCorners(set(['grass', 'dirt', 'sand'], [['grass', 'dirt'], ['grass', 'sand']]));
    expect(diag.map(cornersKey).sort()).toEqual(['dirt|grass|sand|grass', 'grass|dirt|grass|sand', 'grass|sand|grass|dirt', 'sand|grass|dirt|grass']);
    for (const c of blendedMixCorners(set(['grass', 'dirt', 'sand', 'road'], 'all'))) expect(distinctTerrains(c)).toBeGreaterThanOrEqual(3);
  });

  it('modes: auto = all while ≤ 5 terrains, pairs = none, triples = all; one variant per mix; ids stay', () => {
    const auto = set(['grass', 'dirt', 'sand'], 'all', {}, 2);
    expect(auto.tiles).toHaveLength(3 * 2 + 3 * 14 * 2 + 36);
    expect(auto.tiles.filter((t) => distinctTerrains(t.terrainCorners!) >= 3).every((t) => t.variant === 0)).toBe(true);
    expect(validateTileset(auto)).toEqual([]);
    const pairsOnly = set(['grass', 'dirt', 'sand'], 'all', { mixes: 'pairs' } as Partial<TilesetBody>, 2);
    expect(pairsOnly.tiles).toHaveLength(3 * 2 + 3 * 14 * 2);
    // A sixth terrain turns 'auto' off for new mixes, but the tiles maps may use are kept (ids never change meaning).
    let six = set(['grass', 'dirt', 'sand', 'road', 'mud'], 'all');
    const before = new Map(six.tiles.map((t) => [cornersKey(t.terrainCorners!) + '#' + t.variant, t.id]));
    six = addTerrain(six, { name: 'snow' }).body;
    six = addTerrainPair(six, 'snow', 'grass').body;
    six = addTerrainPair(six, 'snow', 'dirt').body;
    expect(allMixesOn(six)).toBe(false);
    for (const t of six.tiles) if (before.has(cornersKey(t.terrainCorners!) + '#' + t.variant)) expect(t.id).toBe(before.get(cornersKey(t.terrainCorners!) + '#' + t.variant));
    expect(six.tiles.filter((t) => t.terrainCorners!.includes('snow') && distinctTerrains(t.terrainCorners!) >= 3)).toEqual([]);
    expect(six.tiles.filter((t) => distinctTerrains(t.terrainCorners!) >= 3)).toHaveLength(10 * 36 + 5 * 24);
    // triples: every blended mix, snow's included.
    const tri = addTerrainPair({ ...six, mixes: 'triples' }, 'snow', 'sand').body;
    expect(tri.tiles.filter((t) => t.terrainCorners!.includes('snow') && distinctTerrains(t.terrainCorners!) >= 3).length).toBeGreaterThan(36);
    expect(Math.min(...tri.tiles.filter((t) => t.terrainCorners!.includes('snow') && distinctTerrains(t.terrainCorners!) >= 3).map((t) => t.id))).toBeGreaterThanOrEqual(nextIdOf(six));
  });

  it('on demand: addMixCorners appends exactly the asked mixes, skips pairs and pair-only tilesets, survives removal rules', () => {
    let b = set(['grass', 'dirt', 'sand', 'road', 'mud', 'water'], [['grass', 'dirt'], ['grass', 'road'], ['road', 'sand'], ['grass', 'sand']]);
    expect(mixCombos(b)).toEqual([]);
    const n = b.tiles.length;
    const r = addMixCorners(b, [['grass', 'road', 'sand', 'grass'], ['Grass', 'road', 'sand', 'grass'], ['grass', 'dirt', 'dirt', 'grass'], ['grass', 'lava', 'sand', 'road']]);
    expect(r.mixes).toEqual([['grass', 'road', 'sand', 'grass']]);
    expect(r.added.map((t) => [t.id, t.terrainCorners])).toEqual([[n, ['grass', 'road', 'sand', 'grass']]]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['fewer than three terrains: add the pair instead', 'no terrain "lava"']);
    b = r.body;
    expect(b.mixCorners).toEqual([['grass', 'road', 'sand', 'grass']]);
    expect(addMixCorners(b, [['grass', 'road', 'sand', 'grass']]).added).toEqual([]);
    const off = addMixCorners({ ...b, mixes: 'pairs' }, [['grass', 'road', 'sand', 'sand']]);
    expect(off.added).toEqual([]);
    expect(off.skipped[0].reason).toMatch(/mixes "pairs"/);
    // Removing a terrain drops its mixes.
    const gone = removeTerrain(b, 'sand');
    expect(gone.mixCorners).toEqual([]);
    expect(validateTileset(gone)).toEqual([]);
    expect(validateTileset({ ...b, mixCorners: [['grass', 'grass', 'road', 'road']] }).join()).toMatch(/three or four different terrains/);
    expect(validateTileset({ ...b, mixes: 'some' as never }).join()).toMatch(/mixes must be auto, triples, pairs/);
  });

  it('declared tilesets take "mixes" and keep the on-demand mixes across a re-apply', () => {
    const file = { tilesets: [{ name: 't', terrains: ['grass', 'dirt', 'sand', 'road', 'mud', 'snow'], pairs: [['grass', 'dirt'], ['grass', 'road'], ['road', 'dirt']], mixes: 'auto' }] };
    const [d] = parseTilesetDecls(file.tilesets);
    expect(d.mixes).toBe('auto');
    const first = declareTileset(null, d);
    const fixed = addMixCorners(first, [['grass', 'road', 'dirt', 'grass']]).body;
    const again = declareTileset(fixed, d);
    expect(declaredShape(again)).toBe(declaredShape(fixed));
    const [p] = parseTilesetDecls([{ ...file.tilesets[0], mixes: 'pairs' }]);
    const pairs = declareTileset(fixed, p);
    expect(pairs.mixes).toBe('pairs');
    expect(pairs.tiles.some((t) => distinctTerrains(t.terrainCorners!) >= 3)).toBe(false);
    const [tri] = parseTilesetDecls([{ ...file.tilesets[0], mixes: 'triples' }]);
    expect(declareTileset(null, tri).tiles.filter((t) => distinctTerrains(t.terrainCorners!) >= 3)).toHaveLength(36);
    expect(() => parseTilesetDecls([{ ...file.tilesets[0], mixes: 'quads' }])).toThrow(/"mixes" must be "auto", "triples", "pairs"/);
  });
});

const nextIdOf = (b: TilesetBody) => Math.max(b.nextId ?? 0, ...b.tiles.map((t) => t.id + 1));

describe('FB-049 mixes: rendering and seams', () => {
  /** Every mix tile's four edges against the pair (or pure) tile across each edge, exactly on the edge. */
  function edgesMatchPairs(b: TilesetBody) {
    const r = tileRenderer(b);
    let checked = 0, worst = 0;
    for (const t of b.tiles) {
      const A = t.terrainCorners!;
      if (distinctTerrains(A) < 3) continue;
      const [tl, tr, br, bl] = A;
      for (let i = 0; i <= 24; i++) {
        const s = i / 24;
        // Right edge (u = 1) = the left edge of the tile to the right, whose TL/BL are A's TR/BR; bottom (v = 1) =
        // the top edge of the tile below (its TL/TR are A's BL/BR). That neighbour is a pair or pure tile.
        const pairs: [Corners, number, number, Corners, number, number][] = [
          [A, 1, s, [tr, tr, br, br], 0, s],
          [A, s, 1, [bl, br, br, bl], s, 0],
          [[tl, tl, bl, bl], 1, s, A, 0, s],
          [[tl, tr, tr, tl], s, 1, A, s, 0],
        ];
        for (const [a, ua, va, c, uc, vc] of pairs) {
          const x = r.groundColor(a, ua, va, 3), y = r.groundColor(c, uc, vc, 1);
          worst = Math.max(worst, ...x.map((v, k) => Math.abs(v - y[k])));
          checked++;
        }
      }
    }
    return { checked, worst };
  }

  it('on every edge a mixed tile is exactly the pair tile across it (land, shore and two-water stacks)', () => {
    const land = edgesMatchPairs(set(['grass', 'road', 'sand', 'dirt'], 'all'));
    expect(land.checked).toBeGreaterThan(10000);
    expect(land.worst).toBeLessThan(1e-6);
    const shore = edgesMatchPairs(set(['grass', { name: 'river', kind: 'water' }, 'sand', 'road'], 'all'));
    expect(shore.worst).toBeLessThan(1e-6);
    const twoWater = edgesMatchPairs(set([{ name: 'shallows', kind: 'water' }, 'grass', { name: 'deep', kind: 'water' }], 'all'));
    expect(twoWater.worst).toBeLessThan(1e-6);
  });

  it('relative layer weights: a terrain absent from an edge leaves the other two exactly as in their pair tile', () => {
    const A: Corners = ['grass', 'road', 'sand', 'grass'];
    for (let i = 0; i <= 20; i++) {
      const s = i / 20;
      // Right edge: road–sand only. road's field relative to grass + road is 1 there (it is the base of the pair).
      expect(layerField(A, ['grass', 'road', 'sand'], 1, true, 1, s, 0)).toBe(s === 1 ? -Infinity : Infinity);
      expect(layerField(A, ['grass', 'road', 'sand'], 2, true, 1, s, 0)).toBeCloseTo(overlayField(['road', 'road', 'sand', 'sand'], 'sand', 0, s, 2), 9);
    }
  });

  it('random three- and four-terrain maps: every cell has a tile, every pixel drawn once, seams no sharper than interiors', () => {
    for (const [names, seed] of [[['grass', 'road', 'sand'], 3], [['grass', { name: 'river', kind: 'water' }, 'sand', 'road'], 7]] as [(string | TerrainInput)[], number][]) {
      const b = set(names, 'all', { noisePeriod: 2 } as Partial<TilesetBody>, 2);
      const atlas = renderTilesetAtlas(b).image;
      const verts = randomVerts(8, seed, b.terrains.map((t) => t.id));
      const cells = cellsFromCorners(b, verts);
      expect(cells.flat().filter((c) => c === null)).toEqual([]);
      expect(cells.flat().filter((c) => distinctTerrains(b.tiles.find((t) => t.id === c)!.terrainCorners!) >= 3).length).toBeGreaterThan(10);
      const { image, overlaps, owner } = composeOwned(b, atlas, cells);
      expect(overlaps).toBe(0);
      const s = seamStats(image, owner);
      expect(s.acrossN).toBeGreaterThan(300);
      expect(s.across).toBeLessThan(s.within * 1.5 + 1);
      expect(s.acrossMax).toBeLessThanOrEqual(s.withinMax + 4);
    }
  });

  it('cliffs: a raised terrain in a mix has the same rim on every edge as the pair across it, and maps stay seamless', () => {
    const b = set(['grass', { name: 'plateau', kind: 'rock', height: 1 }, 'dirt', { name: 'mesa', kind: 'rock', height: 1, color: '#a07050' } as TerrainInput], 'all', {}, 1);
    let checked = 0;
    for (const t of b.tiles) {
      const A = t.terrainCorners!;
      if (distinctTerrains(A) < 3) continue;
      const [, tr, br] = A;
      for (let i = 0; i <= 30; i++) {
        const s = (i / 30) * 0.9999;
        expect(raisedAtPoint(b, { terrainCorners: A, variant: 0 }, 0.99999999, s)).toBe(raisedAtPoint(b, { terrainCorners: [tr, tr, br, br], variant: 0 }, 0, s));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
    // Dense random cliffs have sharp rims on tile edges by nature (the faces start there), so compare with the same
    // map made of the plateau–grass pair alone: the mixes add no seams of their own.
    const statsOf = (ts: TilesetBody, terrains: string[], seed: number) => {
      const cells = cellsFromCorners(ts, randomVerts(7, seed, terrains));
      expect(cells.flat().filter((c) => c === null)).toEqual([]);
      const { image, overlaps, owner } = composeOwned(ts, renderTilesetAtlas(ts).image, cells);
      expect(overlaps).toBe(0);
      return seamStats(image, owner);
    };
    const pair = set(['grass', { name: 'plateau', kind: 'rock', height: 1 }], 'all');
    for (const seed of [11]) {
      const base = statsOf(pair, ['grass', 'plateau'], seed);
      const s = statsOf(b, ['grass', 'plateau', 'dirt'], seed);
      const two = statsOf(b, ['grass', 'plateau', 'mesa', 'dirt'], seed);
      for (const x of [s, two]) {
        expect(x.across).toBeLessThan(base.across * 1.15 + 0.5);
        expect(x.acrossMax).toBeLessThanOrEqual(base.acrossMax + 4);
      }
    }
  });
});

describe('FB-049 mixes: Tiled export', () => {
  it('one corner wangset holds all terrains, so a wangid carries three colours (golden)', () => {
    const b = set(['grass', 'road', 'sand'], 'all');
    const j = toTiledJson(b);
    expect(j.wangsets).toHaveLength(1);
    const w = j.wangsets![0];
    expect(w.colors.map((c) => c.name)).toEqual(['grass', 'road', 'sand']);
    expect(w.wangtiles).toHaveLength(3 + 3 * 14 + 36);
    expect(j.tilecount).toBe(81);
    const mixed = w.wangtiles.filter((t) => new Set(t.wangid.filter((_, i) => i % 2)).size === 3);
    expect(mixed).toHaveLength(36);
    expect(mixed.map((t) => t.tileid)).toEqual(Array.from({ length: 36 }, (_, i) => 45 + i));
    expect(mixed.slice(0, 6)).toMatchInlineSnapshot(`
      [
        {
          "tileid": 45,
          "wangid": [
            0,
            1,
            0,
            2,
            0,
            3,
            0,
            1,
          ],
        },
        {
          "tileid": 46,
          "wangid": [
            0,
            1,
            0,
            3,
            0,
            2,
            0,
            1,
          ],
        },
        {
          "tileid": 47,
          "wangid": [
            0,
            2,
            0,
            1,
            0,
            3,
            0,
            1,
          ],
        },
        {
          "tileid": 48,
          "wangid": [
            0,
            2,
            0,
            2,
            0,
            3,
            0,
            1,
          ],
        },
        {
          "tileid": 49,
          "wangid": [
            0,
            2,
            0,
            3,
            0,
            1,
            0,
            1,
          ],
        },
        {
          "tileid": 50,
          "wangid": [
            0,
            2,
            0,
            3,
            0,
            2,
            0,
            1,
          ],
        },
      ]
    `);
    expect(writeTsx(b)).toContain('<wangtile tileid="46" wangid="0,1,0,3,0,2,0,1"/>');
  });
});

describe('FB-049 mixes: maps', () => {
  /** A road (dirt edge) crossing a sand-banked river on grass: T-junctions where road, bank and grass meet. */
  function crossing(b: TilesetBody): MapBody {
    const m = defaultMapBody('ford', { width: 16, height: 16, tilesets: [1], terrain: 'grass' });
    const r = applyOps(m, [
      { op: 'rect', terrain: 'sand', x0: 6, y0: 0, x1: 9, y1: 15 },
      { op: 'rect', terrain: 'water', x0: 7, y0: 0, x1: 8, y1: 15 },
      { op: 'rect', terrain: 'sand', x0: 7, y0: 7, x1: 8, y1: 8 },
      { op: 'rect', terrain: 'road', x0: 0, y0: 7, x1: 15, y1: 8 },
    ] as never, { tilesets: [b] });
    expect(r.errors).toEqual([]);
    return r.doc;
  }

  it('missingMixes lists the three-terrain combos; the add-mixes fix draws them all (0 fallback cells)', () => {
    let b = set(['grass', 'dirt', 'sand', 'water', 'mud', 'road'], [['grass', 'sand'], ['sand', 'water'], ['grass', 'road'], ['grass', 'dirt']]);
    const m = crossing(b);
    const before = missingMixes(m, [b]);
    expect(before.count).toBeGreaterThan(0);
    expect(before.threeWay).toBeGreaterThan(0);
    expect(before.mixes.length).toBeGreaterThan(0);
    expect(missingMixesMessage(before)).toMatch(/fix "add-mixes"/);
    const fix = addPairsAndMixes(b, before.pairs.map((p) => p.pair), before.mixes.map((x) => x.corners));
    expect(fix.pairs.map((p) => p.pair).sort()).toEqual(before.pairs.map((p) => p.pair).sort());
    b = fix.body;
    const after = missingMixes(m, [b]);
    // The new pairs' cells were the only other gaps; the mixes they create are added by a second pass.
    const fix2 = addPairsAndMixes(b, after.pairs.map((p) => p.pair), after.mixes.map((x) => x.corners));
    b = fix2.body;
    const ground = m.layers.find((l) => l.type === 'ground') as GroundLayer;
    expect(resolveGround(m, ground, b).missing).toBe(0);
    expect(validateTileset(b)).toEqual([]);
  });

  it('a tileset with ≤ 5 terrains (auto) draws the crossing without any fix', () => {
    const b = set(['grass', 'sand', 'water', 'road'], [['grass', 'sand'], ['sand', 'water'], ['grass', 'road'], ['road', 'sand'], ['road', 'water']]);
    const m = crossing(b);
    expect(missingMixes(m, [b]).count).toBe(0);
    expect(wantedTiles(b).length).toBe(b.tiles.length);
  });
});
