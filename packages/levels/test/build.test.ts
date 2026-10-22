/**
 * The file-based half of @slop/levels: tileset bodies read back from their `.tsj` (tile ids kept across builds),
 * map documents (ssg-map/1), ops replayed with sprite names looked up in the declared sprites and their built
 * folders, stamps, the Tiled export, and buildLevels on a declaration file. No old-generator data needed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ssgMap } from '@slop/formats';
import {
  bodyFromTsj, buildLevels, collisionPolygons, buildTileset, createMap, declareTileset, decodePng, exportMap, findRoute, mapBodyOfFile, mapFileOf, parseTilesetDecls, readMapFile, replayOps,
  spriteCatalog, stampFromMap, writeMapFile, writeTsj, MapOpsError, LevelsError, type ObjectLayer, type ZoneLayer,
} from '../src/index.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-levels-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const decl = (extra: Record<string, unknown> = {}) =>
  parseTilesetDecls([{ name: 'meadow', tile: '64x32', terrains: ['grass', 'dirt', { name: 'water', blend: 'grass' }], pairs: [['grass', 'dirt']], ...extra }])[0]!;

/** A built prop folder as `slop build` writes it: a meta.json with an object block covering 2×1 tiles. */
function writeProp(out: string, name: string) {
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  const object = {
    footprint: { w: 2, d: 1 }, height: 1.2, tiles: { w: 2, d: 1, metresPerTile: 1 },
    directions: [{ name: 'SE', worldAngle: -45, tiles: { u: 2, v: 1, polygon: [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]] } }],
  };
  fs.writeFileSync(path.join(dir, `${name}.meta.json`), JSON.stringify({ schema: 'ssg-meta/1', object }));
}

describe('tileset bodies from .tsj', () => {
  it('reads back what writeTsj wrote: ids, corners, variants, terrains, pairs', () => {
    const body = declareTileset(null, decl({ variants: 2 }));
    const back = bodyFromTsj(JSON.parse(writeTsj(body)));
    const key = (b: typeof body) => b.tiles.map((t) => `${t.id}:${t.terrainCorners!.join('|')}#${t.variant}`).sort();
    expect(key(back)).toEqual(key(body));
    expect(back.terrains.map((t) => [t.id, t.kind])).toEqual(body.terrains.map((t) => [t.id, t.kind]));
    expect(back.terrains.find((t) => t.id === 'water')!.shore).toBe(true);
    expect(new Set(back.wangsets[0]!.pairs.map((p) => [...p].sort().join('|')))).toEqual(new Set(body.wangsets[0]!.pairs.map((p) => [...p].sort().join('|'))));
  });

  it('a terrain added later keeps every old tile id (maps made with the old file stay valid)', () => {
    const first = declareTileset(null, decl());
    const previous = bodyFromTsj(JSON.parse(writeTsj(first)));
    const grown = parseTilesetDecls([{ name: 'meadow', tile: '64x32', terrains: ['sand', 'grass', 'dirt', { name: 'water', blend: 'grass' }], pairs: [['grass', 'dirt'], ['sand', 'grass']] }])[0]!;
    const next = buildTileset(grown, { previous });
    const fresh = declareTileset(null, grown);
    for (const t of first.tiles) expect(next.body.tiles.find((x) => x.id === t.id)?.terrainCorners).toEqual(t.terrainCorners);
    // A fresh declaration would hand id 0 to sand (listed first now); the kept body still has grass there.
    expect(fresh.tiles.find((t) => t.id === 0)!.terrainCorners).toEqual(['sand', 'sand', 'sand', 'sand']);
    expect(next.body.tiles.find((t) => t.id === 0)!.terrainCorners).toEqual(['grass', 'grass', 'grass', 'grass']);
    expect(next.changes.some((c) => c.includes('new terrain sand'))).toBe(true);
  });

  it('an unchanged declaration reports no changes against its own .tsj and draws the same atlas', () => {
    const a = buildTileset(decl());
    const b = buildTileset(decl(), { previous: bodyFromTsj(JSON.parse(Buffer.from(a.files['meadow.tsj']!).toString())) });
    expect(b.changes).toEqual([]);
    expect(Buffer.from(b.files['meadow.png']!).equals(Buffer.from(a.files['meadow.png']!))).toBe(true);
    const png = decodePng(a.files['meadow.png']!);
    expect(png.width).toBe(8 * 64);
  });

  it('a texture terrain without the packs is an error that names it', () => {
    const d = parseTilesetDecls([{ name: 't', terrains: [{ name: 'grass', texture: 'X/Grass.png' }] }])[0]!;
    expect(() => buildTileset(d)).toThrow(/texture terrains need the installed packs \(grass\)/);
    expect(() => buildTileset(d, { textures: { packsDir: tmp } })).toThrow(/texture X\/Grass\.png isn't in the installed packs/);
  });
});

describe('map documents', () => {
  const ts = declareTileset(null, decl());
  const out = path.join(tmp, 'pack');
  writeProp(out, 'crate');
  const cat = spriteCatalog([{ name: 'hero', asset: 'POLYGON_War/Character_A' }, { name: 'crate', asset: 'POLYGON_War/SM_Prop_Crate_02' }], { out });

  it('createMap takes the tileset geometry and its first terrain; the document validates against ssg-map/1', () => {
    const m = createMap('field', { width: 6, height: 4, tilesets: [{ name: 'meadow', body: ts }] });
    expect([m.orientation, m.tileWidth, m.tileHeight, m.metresPerTile, m.tilesets]).toEqual(['isometric', 64, 32, 1, ['meadow']]);
    expect((m.layers[0] as { corners: string[] }).corners.every((c) => c === 'grass')).toBe(true);
    expect(ssgMap.safeParse(m).success).toBe(true);
    const f = path.join(tmp, 'field.map.json');
    fs.writeFileSync(f, writeMapFile(m));
    expect(readMapFile(f)).toEqual(m);
    expect(mapFileOf(mapBodyOfFile(m), m.tilesets)).toEqual(m);
  });

  it('replays ops with sprite names: footprints from the built folder, ids from the declaration order', () => {
    const m = createMap('field', { width: 8, height: 8, tilesets: [{ name: 'meadow', body: ts }] });
    const r = replayOps(m, [
      { op: 'rect', x0: 0, y0: 0, x1: 3, y1: 7, terrain: 'dirt' },
      { op: 'place', sprite: 'crate', x: 4, y: 2.5, facing: 'SE', id: 'c1' },
      { op: 'place', sprite: 'POLYGON_War/SM_Prop_Crate_02', x: 4, y: 5.5, facing: 'SE' },
      { op: 'addZone', kind: 'spawn', points: [[1.5, 1.5]], name: 'start' },
    ], { sprites: cat, tilesets: [ts] });
    const objs = (r.map.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;
    expect(objs.map((o) => [o.id, o.spriteId, o.name, o.footprint])).toEqual([['c1', 2, 'crate', { w: 2, h: 1 }], ['o1', 2, 'crate', { w: 2, h: 1 }]]);
    expect((r.map.layers.find((l) => l.type === 'zones') as ZoneLayer).zones[0]!.name).toBe('start');
    expect(ssgMap.safeParse(r.map).success).toBe(true);
  });

  it('a sprite name that is not declared fails the batch and names the closest', () => {
    const m = createMap('field', { width: 4, height: 4, tilesets: [{ name: 'meadow', body: ts }] });
    expect(() => replayOps(m, [{ op: 'place', sprite: 'crat', x: 1, y: 1 }], { sprites: cat, tilesets: [ts] })).toThrow(/no sprite named "crat".*did you mean: crate/);
    try {
      replayOps(m, [{ op: 'place', sprite: 'crate', x: 1, y: 1 }, { op: 'place', sprite: 'crate', x: 1, y: 1 }], { sprites: cat, tilesets: [ts] });
      expect.fail('the overlap should fail');
    } catch (e) {
      expect(e).toBeInstanceOf(MapOpsError);
      expect((e as MapOpsError).errors[0]!.index).toBe(1);
    }
  });

  it('routes keep clear of collision polygons from the built folder (FB-125) on a file map', () => {
    const m = createMap('field', { width: 10, height: 5, tilesets: [{ name: 'meadow', body: ts }] });
    const r = replayOps(m, [{ op: 'place', sprite: 'crate', x: 5, y: 2.5, facing: 'SE' }], { sprites: cat, tilesets: [ts] });
    const body = mapBodyOfFile(r.map);
    const plain = findRoute(body, '0.5,2.5', '9.5,2.5');
    expect(plain.found).toBe(true);
    const wide = findRoute(body, '0.5,2.5', '9.5,2.5', { clearance: 1, collisionPolygon: collisionPolygons(cat, body) });
    expect(wide.found).toBe(true);
    expect(wide.metres).toBeGreaterThan(plain.metres);
  });

  it('stamps cut from one map place into another, sprites and all', () => {
    const src = replayOps(createMap('src', { width: 4, height: 4, tilesets: [{ name: 'meadow', body: ts }] }), [{ op: 'place', sprite: 'crate', x: 2, y: 1.5, facing: 'SE' }], { sprites: cat, tilesets: [ts] }).map;
    const stamp = stampFromMap(src, 'nest', [0, 0, 3, 3]);
    const dst = replayOps(createMap('dst', { width: 12, height: 12, tilesets: [{ name: 'meadow', body: ts }] }), [{ op: 'stamp', stamp: 'nest', x: 6, y: 6 }], { sprites: cat, tilesets: [ts], stamps: { nest: stamp } }).map;
    expect((dst.layers.find((l) => l.type === 'objects') as ObjectLayer).objects.map((o) => [o.name, o.x, o.y])).toEqual([['crate', 8, 7.5]]);
  });

  it('exports Tiled with the sprite data the old export carried (name, folder, asset, facing, collision)', () => {
    const m = replayOps(createMap('field', { width: 6, height: 6, tilesets: [{ name: 'meadow', body: ts }] }), [{ op: 'place', sprite: 'crate', x: 3, y: 2.5, facing: 'SE' }], { sprites: cat, tilesets: [ts] }).map;
    const e = exportMap(m, { tilesets: [{ body: ts }], sprites: cat, embed: true, formats: ['tmj', 'tmx'] });
    expect(Object.keys(e.files)).toEqual(['field.tmj', 'field.tmx']);
    const tmj = JSON.parse(e.files['field.tmj']!);
    expect(tmj.tilesets[0]).toMatchObject({ firstgid: 1, name: 'meadow', image: 'meadow.png' });
    const props = Object.fromEntries(tmj.layers.find((l: { name: string }) => l.name === 'objects').objects[0].properties.map((p: { name: string; value: unknown }) => [p.name, p.value]));
    expect(props).toMatchObject({ sprite: 'crate', spriteId: 2, exportName: 'crate', asset: 'POLYGON_War/SM_Prop_Crate_02', facing: 'SE', footprintW: 2, footprintH: 1 });
    expect(JSON.parse(props.collision as string)).toHaveLength(4);
  });
});

describe('buildLevels', () => {
  const game = path.join(tmp, 'game');
  const out = path.join(game, 'public/assets');
  fs.mkdirSync(path.join(game, 'maps'), { recursive: true });
  writeProp(out, 'crate');
  fs.writeFileSync(path.join(game, 'maps/yard.ops.json'), JSON.stringify([{ op: 'rect', x0: 0, y0: 0, x1: 2, y1: 2, terrain: 'dirt' }, { op: 'place', sprite: 'crate', x: 4, y: 4.5, facing: 'SE' }]));
  const file = path.join(game, 'ssg.assets.json');
  const spec = {
    project: 'Test', tile: '64x32', metresPerTile: 1,
    sprites: [{ name: 'crate', asset: 'POLYGON_War/SM_Prop_Crate_02' }],
    tilesets: [{ name: 'meadow', terrains: ['grass', 'dirt'], pairs: 'all' }],
    maps: [
      { name: 'yard', size: '8x8', tileset: 'meadow', ops: 'maps/yard.ops.json', export: 'public/assets/maps/yard', map: 'maps/yard.map.json' },
      { name: 'inline', size: '4x4', tileset: 'meadow', ops: [{ op: 'addZone', kind: 'objective', points: [[1, 1], [3, 3]] }] },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(spec));

  it('writes the tilesets, the map documents and the Tiled exports, and builds byte-identical again', async () => {
    const r = await buildLevels(file, { out });
    expect(r.tilesets.map((t) => [t.name, t.changes, t.files.map((f) => path.relative(out, f))])).toEqual([['meadow', null, ['tilesets/meadow/meadow.png', 'tilesets/meadow/meadow.tsj']]]);
    expect(r.maps.map((m) => [m.name, m.ops, m.objects, m.zones])).toEqual([['yard', 3, 1, 0], ['inline', 2, 0, 1]]);
    expect(r.maps[0]!.files.map((f) => path.relative(game, f))).toEqual(['public/assets/maps/yard/yard.tmj', 'public/assets/maps/yard/meadow.png']);
    expect(fs.readFileSync(path.join(out, 'maps/yard/meadow.png')).equals(fs.readFileSync(path.join(out, 'tilesets/meadow/meadow.png')))).toBe(true);
    expect(ssgMap.safeParse(readMapFile(path.join(game, 'maps/yard.map.json'))).success).toBe(true);
    const before = new Map([...r.tilesets.flatMap((t) => t.files), ...r.maps.flatMap((m) => m.files), r.maps[0]!.document!].map((f) => [f, fs.readFileSync(f)]));
    const again = await buildLevels(file, { out });
    expect(again.tilesets[0]!.changes).toEqual([]);
    for (const [f, bytes] of before) expect(fs.readFileSync(f).equals(bytes)).toBe(true);
  });

  it('a map document without ops is the map: read, exported', async () => {
    const f2 = path.join(game, 'doc.assets.json');
    fs.writeFileSync(f2, JSON.stringify({ ...spec, maps: [{ name: 'yard', map: 'maps/yard.map.json', export: 'public/assets/maps/yard2' }] }));
    const r = await buildLevels(f2, { out });
    expect(r.maps[0]!.objects).toBe(1);
    expect(fs.readFileSync(path.join(out, 'maps/yard2/yard.tmj'), 'utf8')).toBe(fs.readFileSync(path.join(out, 'maps/yard/yard.tmj'), 'utf8'));
  });

  it('only: builds the named ones; entries are checked strictly with teaching errors', async () => {
    const r = await buildLevels(file, { out, only: ['inline'] });
    expect([r.tilesets.length, r.maps.map((m) => m.name)]).toEqual([0, ['inline']]);
    const bad = path.join(game, 'bad.assets.json');
    fs.writeFileSync(bad, JSON.stringify({ ...spec, maps: [{ name: 'x', size: '4x4', tileset: 'nope', ops: [] }] }));
    await expect(buildLevels(bad, { out })).rejects.toThrow(/no tileset "nope" in the file \(tilesets: meadow\)/);
    fs.writeFileSync(bad, JSON.stringify({ ...spec, maps: [{ name: 'x', size: '4x4', tileset: 'meadow', ops: [], exprot: 'a' }] }));
    await expect(buildLevels(bad, { out })).rejects.toThrow(LevelsError);
    fs.writeFileSync(bad, JSON.stringify({ ...spec, maps: [{ name: 'x', tileset: 'meadow', ops: [] }] }));
    await expect(buildLevels(bad, { out })).rejects.toThrow(/needs "size" and "tileset"/);
  });
});
