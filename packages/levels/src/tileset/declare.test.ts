// Moved from the old generator's packages/shared/src/tileset/declare.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addTerrainPair, addWangset, cornersKey, declaredShape, declareTileset, defaultTilesetBody, parseTilesetDecls, removeTerrain, resolveWangsets,
  syncTiles, terrainPairs, tileGeometry, tilesetChanges, validateTileset, type TilesetBody,
} from '../index.js';

const keyOf = (t: { terrainCorners?: string[]; variant: number }) => `${t.terrainCorners!.join('|')}#${t.variant}`;
const ids = (b: TilesetBody) => new Map(b.tiles.map((t) => [keyOf(t), t.id]));

describe('FB-023: pure tiles, several pairs, adding a pair later', () => {
  it('a lone terrain has its pure tile (× variants) and is a colour of the Tiled wangset', () => {
    const one = addTerrain(defaultTilesetBody('T'), { name: 'Grass' });
    expect(one.body.tiles).toEqual([{ id: 0, terrainCorners: ['grass', 'grass', 'grass', 'grass'], variant: 0, properties: {} }]);
    const three = addTerrain(defaultTilesetBody('T'), { name: 'Grass', variants: 3 }).body;
    expect(three.tiles.map((t) => t.variant)).toEqual([0, 1, 2]);
    const w = resolveWangsets(one.body);
    expect(w[0].colors.map((c) => c.terrain)).toEqual(['grass']);
    expect(w[0].wangtiles).toEqual([{ tileid: 0, wangid: [0, 1, 0, 1, 0, 1, 0, 1] }]);
    // With a wangset over grass–dirt, a third terrain without pairs is still a colour (its pure tile is placeable).
    let b = addTerrain(addTerrain(defaultTilesetBody('T'), { name: 'Grass' }).body, { name: 'Dirt' }).body;
    b = addWangset(b, { pairs: [['grass', 'dirt']] }).body;
    b = addTerrain(b, { name: 'Snow' }).body;
    expect(resolveWangsets(b)[0].colors.map((c) => c.terrain)).toEqual(['grass', 'dirt', 'snow']);
  });

  it('grass/dirt/sand with all three pairs has dirt↔sand tiles; adding a pair later never renumbers', () => {
    let b: TilesetBody = { ...defaultTilesetBody('Temperate'), mixes: 'pairs' }; // pair tiles only (mixes: see FB-049 tests)
    for (const n of ['Grass', 'Dirt', 'Sand']) b = addTerrain(b, { name: n }).body;
    b = addWangset(b, { pairs: [['grass', 'dirt'], ['grass', 'sand']] }).body;
    expect(b.tiles.length).toBe(3 + 14 * 2);
    const before = ids(b);
    const r = addTerrainPair(b, 'dirt', 'Sand');
    expect(r.existed).toBe(false);
    expect(r.added.length).toBe(14);
    expect(r.added[0].id).toBe(31);
    // Every tile that was there keeps its id.
    for (const [k, id] of before) expect(ids(r.body).get(k)).toBe(id);
    const mixed = r.body.tiles.filter((t) => t.terrainCorners!.includes('dirt') && t.terrainCorners!.includes('sand'));
    expect(mixed.length).toBe(14);
    expect(terrainPairs(r.body)).toEqual([['grass', 'dirt'], ['grass', 'sand'], ['dirt', 'sand']]);
    // The same pair again (either order) adds nothing.
    const again = addTerrainPair(r.body, 'sand', 'dirt');
    expect(again.existed).toBe(true);
    expect(again.added).toEqual([]);
    expect(again.body.wangsets[0].pairs.length).toBe(3);
    expect(() => addTerrainPair(b, 'dirt', 'lava')).toThrow(/no terrain "lava"/);
    // Removing a terrain drops its tiles but keeps everyone else's ids.
    const gone = removeTerrain(r.body, 'sand');
    for (const t of gone.tiles) expect(t.id).toBe(before.get(keyOf(t)) ?? t.id);
    expect(gone.tiles.length).toBe(2 + 14);
  });

  it('per-terrain variants: pure tiles × own, transitions × the larger of the pair', () => {
    let b = defaultTilesetBody('T');
    b = addTerrain(b, { name: 'Grass' }).body;
    b = addTerrain(b, { name: 'Dirt', variants: 2 }).body;
    b = addWangset(b, { pairs: [['grass', 'dirt']] }).body;
    expect(b.tiles.filter((t) => t.terrainCorners!.every((c) => c === 'grass')).length).toBe(1);
    expect(b.tiles.filter((t) => t.terrainCorners!.every((c) => c === 'dirt')).length).toBe(2);
    expect(b.tiles.length).toBe(1 + 2 + 14 * 2);
    // Fewer variants drops the extra tiles and keeps the rest.
    const fewer = syncTiles({ ...b, terrains: b.terrains.map((t) => ({ ...t, variants: 1 })) });
    expect(fewer.removed.length).toBe(15);
    expect(fewer.body.tiles.every((t) => t.variant === 0)).toBe(true);
    expect(validateTileset({ ...b, terrains: [{ ...b.terrains[0], variants: 17 }, b.terrains[1]] })).toContain('terrain "grass": variants must be 1–16');
  });
});

describe('FB-024: declared tilesets', () => {
  const file = {
    tile: '64x32', metresPerTile: 1,
    tilesets: [{
      name: 'temperate',
      terrains: [{ name: 'grass' }, { name: 'dirt', blend: 'grass', variants: 2 }, { name: 'sand', blend: ['grass', 'dirt'], variants: 2 }],
    }],
  };

  it('parses the game\'s format (per-terrain blend) and the pairs form, with file defaults and readable errors', () => {
    const [d] = parseTilesetDecls(file.tilesets, file);
    expect(d).toMatchObject({ name: 'temperate', tile: '64x32', metresPerTile: 1 });
    expect(d.terrains[2].blend).toEqual(['grass', 'dirt']);
    expect(parseTilesetDecls([{ name: 'a', terrains: ['grass', 'dirt'], pairs: [['grass', 'dirt']] }])[0].terrains).toEqual([{ name: 'grass' }, { name: 'dirt' }]);
    expect(() => parseTilesetDecls({})).toThrow(/must be a list/);
    expect(() => parseTilesetDecls([{ terrains: [] }])).toThrow(/give it a "name"/);
    expect(() => parseTilesetDecls([{ name: 'a', terrains: [{ name: 'grass', colr: '#fff' }] }])).toThrow(/unknown key "colr"/);
    expect(() => parseTilesetDecls([{ name: 'a', terrains: ['grass'], pairs: [['grass', 'mud']] }])).toThrow(/terrain "mud", which the tileset doesn't declare/);
    expect(() => parseTilesetDecls([{ name: 'a', terrains: [] }, { name: 'A', terrains: [] }])).toThrow(/Two tilesets are named "A"/);
    expect(() => parseTilesetDecls([{ name: 'a', terrains: [{ name: 'g', color: '#ffffff', texture: 'x.png' }] }])).toThrow(/not both/);
    expect(tileGeometry('32x32')).toEqual({ orientation: 'orthogonal', tileWidth: 32, tileHeight: 32 });
    expect(() => tileGeometry('64x20')).toThrow(/2:1 diamond/);
  });

  it('creates, is idempotent, keeps tile ids on changes, follows removals', () => {
    const [d] = parseTilesetDecls(file.tilesets, file);
    const first = declareTileset(null, d);
    expect(first.terrains.map((t) => t.id)).toEqual(['grass', 'dirt', 'sand']);
    expect(terrainPairs(first)).toEqual([['grass', 'dirt'], ['grass', 'sand'], ['dirt', 'sand']]);
    expect(first.tiles.length).toBe(1 + 2 + 2 + 3 * 14 * 2 + 36); // + the 36 three-terrain mixes (mixes auto, FB-049)
    expect(first.tiles.map((t) => t.id)).toEqual(first.tiles.map((_, i) => i));
    const stored = { ...first }; // what the server keeps
    expect(declaredShape(declareTileset(stored, d))).toBe(declaredShape(stored));

    // A changed colour and a new terrain: old tiles keep their ids; the new ones are appended.
    const [d2] = parseTilesetDecls([{ ...file.tilesets[0], noisePeriod: 2, terrains: [...file.tilesets[0].terrains.map((t) => (t.name === 'dirt' ? { ...t, color: '#7a5030' } : t)), { name: 'snow', blend: 'grass' }] }], file);
    const second = declareTileset(stored, d2);
    expect(second.noisePeriod).toBe(2);
    expect(second.terrains.find((t) => t.id === 'dirt')!.source).toEqual({ type: 'palette', color: '#7a5030' });
    const old = ids(stored);
    for (const t of second.tiles) if (old.has(keyOf(t))) expect(t.id).toBe(old.get(keyOf(t)));
    expect(Math.min(...second.tiles.filter((t) => t.terrainCorners!.includes('snow')).map((t) => t.id))).toBe(stored.tiles.length);

    // Dropping sand from the file removes it with its tiles; grass and dirt keep theirs.
    const [d3] = parseTilesetDecls([{ name: 'temperate', terrains: [{ name: 'grass' }, { name: 'dirt', blend: 'grass', variants: 2 }] }], file);
    const third = declareTileset(second, d3);
    expect(third.terrains.map((t) => t.id)).toEqual(['grass', 'dirt']);
    expect(third.noisePeriod).toBeUndefined();
    for (const t of third.tiles) expect(t.id).toBe(old.get(keyOf(t)));
    // A sand added back later gets a fresh id range (never a recycled id that a map could still point at).
    const back = declareTileset(third, d);
    expect(Math.min(...back.tiles.filter((t) => t.terrainCorners!.includes('sand')).map((t) => t.id))).toBeGreaterThanOrEqual(stored.tiles.length - 1);
    expect(new Set(back.tiles.map((t) => cornersKey(t.terrainCorners! as [string, string, string, string]) + t.variant)).size).toBe(back.tiles.length);
  });

  it('pairs "all", textures with scale, and invalid values', () => {
    const [d] = parseTilesetDecls([{ name: 'x', pairs: 'all', terrains: [{ name: 'grass', texture: 'POLYGON_Generic_v3/Textures/Generic_Grass.png', scale: 4 }, 'dirt', 'sand', 'snow'] }]);
    const b = declareTileset(null, d);
    expect(terrainPairs(b).length).toBe(6);
    expect(b.terrains[0].source).toEqual({ type: 'texture', path: 'POLYGON_Generic_v3/Textures/Generic_Grass.png', scale: 4 });
    // The average colour the server filled in is kept while the texture stays the same.
    const stored = { ...b, terrains: b.terrains.map((t, i) => (i === 0 ? { ...t, source: { ...t.source, color: '#557733' } } : t)) } as TilesetBody;
    expect(declaredShape(declareTileset(stored, d))).toBe(declaredShape(stored));
    const [bad] = parseTilesetDecls([{ name: 'x', terrains: [{ name: 'grass', texture: 'a.png', scale: 2.5 }] }]);
    expect(() => declareTileset(null, bad)).toThrow(/scale must be a whole number of tiles/);
    const [bad2] = parseTilesetDecls([{ name: 'x', terrains: [{ name: 'grass', scale: 2 }] }]);
    expect(() => declareTileset(null, bad2)).toThrow(/scale is for textures/);
  });
});

describe('FB-061: tilesetChanges says why every tile is added or removed', () => {
  const decl = (o: Record<string, unknown> = {}) => parseTilesetDecls([{ name: 'd', variants: 2, terrains: ['grass', 'dirt', 'sand'], pairs: 'all', ...o }])[0];
  const base = declareTileset(null, decl());
  const why = (o: Record<string, unknown>) => {
    const d = decl(o);
    return tilesetChanges(base, declareTileset(base, d), d);
  };
  it('nothing for the same declaration', () => expect(why({})).toEqual([]));
  it('removed pair and terrain, variants, mixes, settings', () => {
    expect(why({ pairs: [['grass', 'dirt'], ['grass', 'sand']] })).toEqual(['removes 60 tiles (28 pair, 32 mix): removed pair dirt↔sand']);
    expect(why({ terrains: ['grass', 'dirt'] })).toEqual(['removes 94 tiles (2 pure, 56 pair, 36 mix): removed terrain sand']);
    expect(why({ variants: 3 })).toEqual(['adds 45 tiles (3 pure, 42 pair): variants: grass 2 → 3, dirt 2 → 3, sand 2 → 3']);
    expect(why({ mixes: 'pairs' })).toEqual(['mixes: auto (the default) → pairs', 'removes 36 mix tiles: mixes "pairs" draws none']);
    expect(why({ noisePeriod: 6 })).toEqual(['noise period: default → 6']);
  });
});
