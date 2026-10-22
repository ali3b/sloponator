// Moved from the old generator's packages/shared/src/tileset/tileset.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import { pixelsPerMetre } from '@slop/sprites';
import {
  addTerrain, addWangset, cornerCombos, cornerWangId, defaultTilesetBody, expandWangTiles, nextTileId, removeTerrain, resolveWangsets, terrainIdFor,
  tilesetPpm, toTiledJson, validateTileset, wangCorners, writeTsj, writeTsx, type TilesetBody,
} from '../index.js';

const grassDirt = (variants = 1): TilesetBody => {
  let b = defaultTilesetBody('Ground');
  b = addTerrain(b, { name: 'Grass' }).body;
  b = addTerrain(b, { name: 'Dirt' }).body;
  return addWangset(b, { pairs: [['grass', 'dirt']], variants }).body;
};

describe('tileset model', () => {
  it('defaults to a 64×32 iso diamond at 1 m per tile, the same scale the sprite tile lock uses', () => {
    const b = defaultTilesetBody('Ground');
    expect(b).toMatchObject({ orientation: 'isometric', tileWidth: 64, tileHeight: 32, metresPerTile: 1 });
    expect(tilesetPpm(b)).toBeCloseTo(64 / Math.SQRT2, 6);
    expect(tilesetPpm(b)).toBe(pixelsPerMetre({ mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' }));
    expect(tilesetPpm({ orientation: 'orthogonal', tileWidth: 32, metresPerTile: 1 })).toBe(32);
    expect(validateTileset(b)).toEqual([]);
  });

  it('terrains: ids from names, kind from the name, colour from the kind; remove drops their tiles', () => {
    let b = defaultTilesetBody('T');
    const r = addTerrain(b, { name: 'Grass' });
    expect(r.terrain).toEqual({ id: 'grass', name: 'Grass', kind: 'grass', source: { type: 'palette', color: '#5a8f3a' } });
    b = r.body;
    const r2 = addTerrain(b, { name: 'grass', kind: 'jungle' });
    expect(r2.terrain.id).toBe('grass_2');
    expect(addTerrain(b, { name: 'Lava rock' }).terrain).toMatchObject({ id: 'lava_rock', kind: 'custom' });
    expect(terrainIdFor('Grass', ['grass', 'grass_2'])).toBe('grass_3');
    expect(() => addTerrain(b, { name: 'x', kind: 'lava' as never })).toThrow(/unknown terrain kind/);
    expect(() => addTerrain(b, { name: 'x', source: { type: 'palette', color: 'red' } })).toThrow(/#rrggbb/);
    const g = grassDirt();
    expect(g.tiles.length).toBe(16);
    const after = removeTerrain(g, 'Dirt');
    expect(after.terrains.map((t) => t.id)).toEqual(['grass']);
    expect(after.tiles.length).toBe(1); // only the all-grass tile is left
    expect(after.wangsets[0].pairs).toEqual([]);
    expect(() => removeTerrain(g, 'snow')).toThrow(/no terrain/);
  });

  it('corner combos: 16 per pair, bit order tl,tr,br,bl, pure tiles shared between pairs', () => {
    const c = cornerCombos('a', 'b');
    expect(c.length).toBe(16);
    expect(c[0]).toEqual(['a', 'a', 'a', 'a']);
    expect(c[1]).toEqual(['b', 'a', 'a', 'a']);
    expect(c[2]).toEqual(['a', 'b', 'a', 'a']);
    expect(c[4]).toEqual(['a', 'a', 'b', 'a']);
    expect(c[8]).toEqual(['a', 'a', 'a', 'b']);
    expect(c[15]).toEqual(['b', 'b', 'b', 'b']);
    expect(new Set(c.map((x) => x.join())).size).toBe(16);
    // grass–dirt and grass–sand share the all-grass tile: 16 + 15.
    expect(wangCorners({ pairs: [['g', 'd'], ['g', 's']] }).length).toBe(31);
  });

  it('variants and tile ids: each combo × variants, re-expanding adds only what is missing', () => {
    const b = grassDirt(3);
    expect(b.tiles.length).toBe(48);
    expect(b.tiles.map((t) => t.id)).toEqual(Array.from({ length: 48 }, (_, i) => i));
    expect(b.tiles.filter((t) => t.terrainCorners!.every((c) => c === 'grass')).map((t) => t.variant)).toEqual([0, 1, 2]);
    expect(expandWangTiles(b, 'ground').added).toEqual([]);
    expect(nextTileId([{ id: 0 }, { id: 7 }])).toBe(8);
    const sand = addTerrain(b, { name: 'Sand' });
    expect(sand.added.map((t) => [t.id, t.variant])).toEqual([[48, 0], [49, 1], [50, 2]]); // its pure tiles × the set's variants
    let s = sand.body;
    const r = addWangset(s, { pairs: [['grass', 'sand']] });
    expect(r.wangset.pairs).toEqual([['grass', 'dirt'], ['grass', 'sand']]);
    expect(r.added.length).toBe(14 * 3 + 4); // + the 4 three-terrain mixes with dirt and sand on a diagonal (FB-049, mixes auto)
    expect(r.added[0].id).toBe(51);
    s = r.body;
    expect(validateTileset(s)).toEqual([]);
    expect(() => addWangset(s, { pairs: [['grass', 'grass']] })).toThrow(/two different/);
  });

  it('validation names every problem', () => {
    const b = grassDirt();
    const bad: TilesetBody = {
      ...b, tileWidth: 0, metresPerTile: -1,
      tiles: [...b.tiles, { id: 3, variant: 0, properties: {}, terrainCorners: ['grass', 'grass', 'lava', 'grass'] }],
    };
    const e = validateTileset(bad);
    expect(e).toContain('tileWidth must be a whole number of pixels (1–4096)');
    expect(e).toContain('metresPerTile must be a positive number');
    const e2 = validateTileset({ ...b, tiles: [...b.tiles, { id: 3, variant: 0, properties: {}, terrainCorners: ['grass', 'grass', 'lava', 'grass'] }] });
    expect(e2).toEqual(['tile id 3 is used twice', 'tile 3: unknown terrain "lava"']);
    expect(validateTileset({ ...b, tiles: [{ id: 0, variant: 0, properties: {}, collision: [{ points: [[0, 0], [1, 1]] }] }] })).toEqual(['tile 0: a collision polygon needs at least 3 [x, y] points']);
  });
});

describe('Tiled writer', () => {
  it('corner wangid: indices 1 TR, 3 BR, 5 BL, 7 TL; edges 0', () => {
    // [tl, tr, br, bl]
    expect(cornerWangId([1, 2, 3, 4])).toEqual([0, 2, 0, 3, 0, 4, 0, 1]);
    const w = resolveWangsets(grassDirt())[0];
    expect(w.colors.map((c) => c.name)).toEqual(['Grass', 'Dirt']);
    // Pure tiles come first (each terrain gets its own when added), then the pair's 14 mixed combinations.
    expect(w.wangtiles[0]).toEqual({ tileid: 0, wangid: [0, 1, 0, 1, 0, 1, 0, 1] });
    expect(w.wangtiles[1]).toEqual({ tileid: 1, wangid: [0, 2, 0, 2, 0, 2, 0, 2] });
    // combo 1 = dirt at top-left only
    expect(w.wangtiles[2]).toEqual({ tileid: 2, wangid: [0, 1, 0, 1, 0, 1, 0, 2] });
    // combo 2 = dirt at top-right only
    expect(w.wangtiles[3]).toEqual({ tileid: 3, wangid: [0, 2, 0, 1, 0, 1, 0, 1] });
  });

  it('.tsj: a Tiled 1.10 tileset with an atlas, grid, wangsets, tile properties and collision', () => {
    const b = grassDirt();
    b.tiles[15] = { ...b.tiles[15], properties: { walkable: false, cost: 2, speed: 0.5, sound: 'mud' }, collision: [{ points: [[0, 16], [32, 0], [64, 16], [32, 32]] }] };
    const j = toTiledJson(b);
    expect(j).toMatchObject({
      type: 'tileset', version: '1.10', name: 'Ground', tilewidth: 64, tileheight: 32, tilecount: 16, columns: 8, margin: 0, spacing: 0,
      image: 'ground.png', imagewidth: 512, imageheight: 64, grid: { orientation: 'isometric', width: 64, height: 32 },
    });
    expect(j.properties).toEqual([
      { name: 'metresPerTile', type: 'float', value: 1 },
      { name: 'noisePeriod', type: 'int', value: 4 },
      { name: 'pixelsPerMetre', type: 'float', value: 45.2548 },
    ]);
    expect(j.tiles).toEqual([
      {
        id: 15,
        objectgroup: {
          draworder: 'index', id: 2, name: '', opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0,
          objects: [{ height: 0, id: 1, name: '', polygon: [{ x: 0, y: 16 }, { x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }], rotation: 0, type: '', visible: true, width: 0, x: 0, y: 0 }],
        },
        properties: [
          { name: 'cost', type: 'int', value: 2 },
          { name: 'sound', type: 'string', value: 'mud' },
          { name: 'speed', type: 'float', value: 0.5 },
          { name: 'walkable', type: 'bool', value: false },
        ],
      },
    ]);
    expect(j.wangsets![0]).toMatchObject({ name: 'ground', type: 'corner', tile: -1 });
    expect(j.wangsets![0].colors[0]).toEqual({
      color: '#5a8f3a', name: 'Grass', probability: 1, tile: -1,
      properties: [{ name: 'kind', type: 'string', value: 'grass' }, { name: 'terrain', type: 'string', value: 'grass' }],
    });
    expect(j.wangsets![0].wangtiles.length).toBe(16);
    expect(JSON.parse(writeTsj(b, { image: 'atlas/ground.png', columns: 4 }))).toMatchObject({ image: 'atlas/ground.png', columns: 4, imagewidth: 256, imageheight: 128 });
    // Orthogonal tilesets have no grid element.
    expect('grid' in toTiledJson({ ...b, orientation: 'orthogonal' })).toBe(false);
  });

  it('.tsx: the XML equivalent', () => {
    let b = defaultTilesetBody('Shore & "beach"');
    b = addTerrain(b, { name: 'Sand' }).body;
    b = addTerrain(b, { name: 'Water' }).body;
    b = addWangset(b, { pairs: [['sand', 'water']] }).body;
    b.tiles[1] = { ...b.tiles[1], properties: { walkable: true, sound: 'splash' }, collision: [{ name: 'water', points: [[0, 16], [32, 0], [32, 16]] }] };
    b.objects = [{ spriteId: 4, name: 'Palm' }];
    const x = writeTsx(b, { columns: 4 });
    const lines = x.split('\n');
    expect(lines.slice(0, 12)).toEqual([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tileset version="1.10" tiledversion="1.10.2" name="Shore &amp; &quot;beach&quot;" tilewidth="64" tileheight="32" tilecount="16" columns="4">',
      ' <grid orientation="isometric" width="64" height="32"/>',
      ' <properties>',
      '  <property name="objects" value="[{&quot;spriteId&quot;:4,&quot;name&quot;:&quot;Palm&quot;}]"/>',
      '  <property name="metresPerTile" type="float" value="1"/>',
      '  <property name="noisePeriod" type="int" value="4"/>',
      '  <property name="pixelsPerMetre" type="float" value="45.2548"/>',
      ' </properties>',
      ' <image source="shore_beach.png" width="256" height="128"/>',
      ' <tile id="1">',
      '  <properties>',
    ]);
    expect(x).toContain([
      '   <property name="sound" value="splash"/>',
      '   <property name="walkable" type="bool" value="true"/>',
      '  </properties>',
      '  <objectgroup draworder="index" id="2">',
      '   <object id="1" name="water" x="0" y="0">',
      '    <polygon points="0,16 32,0 32,16"/>',
      '   </object>',
      '  </objectgroup>',
      ' </tile>',
      ' <wangsets>',
      '  <wangset name="ground" type="corner" tile="-1">',
      '   <wangcolor name="Sand" color="#d8c38a" tile="-1" probability="1">',
      '    <properties>',
      '     <property name="kind" value="sand"/>',
      '     <property name="terrain" value="sand"/>',
      '    </properties>',
      '   </wangcolor>',
    ].join('\n'));
    expect(x).toContain('   <wangtile tileid="0" wangid="0,1,0,1,0,1,0,1"/>');
    expect(x).toContain('   <wangtile tileid="2" wangid="0,1,0,1,0,1,0,2"/>');
    expect(x).toContain('   <wangtile tileid="1" wangid="0,2,0,2,0,2,0,2"/>');
    expect(x.endsWith(' </wangsets>\n</tileset>\n')).toBe(true);
    // Same wang tiles in both formats.
    const j = toTiledJson(b);
    expect((x.match(/<wangtile /g) ?? []).length).toBe(j.wangsets![0].wangtiles.length);
  });

  it('an empty tileset still writes a loadable shell', () => {
    const j = toTiledJson(defaultTilesetBody('Empty'));
    expect(j).toMatchObject({ tilecount: 0, columns: 1, imagewidth: 64, imageheight: 32 });
    expect('wangsets' in j).toBe(false);
    expect(writeTsx(defaultTilesetBody('Empty'))).not.toContain('<wangsets>');
  });
});
