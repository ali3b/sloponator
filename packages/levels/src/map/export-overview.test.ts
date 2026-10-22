// Moved from the old generator's packages/shared/src/map/export-overview.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import { computeFraming, resolveDirections, VIEW_PRESETS, type ViewConfig } from '@slop/sprites';
import { objectInfo, type Vec2 } from '@slop/sprites';
import {
  addTerrain, addWangset, applyOps, defaultMapBody, defaultTilesetBody, describeMap, mapOverview, missingMixes, missingMixesMessage, objectCollisionCells,
  objectTilesetJson, resolveSharedObjectProperties, toTiledMapJson, writeObjectTsx, writeTmj, writeTmx,
  type MapBody, type MapOp, type MapSpriteInfo, type SpriteObjectBlock, type TilesetBody,
} from '../index.js';

/**
 * FB-038 (missing corner mixes with positions), FB-039 (self-describing Tiled objects with collision polygons and
 * picture tiles) and FB-040 (the text overview: zone outlines, unique symbols, separate collision, thin features).
 */

const tileset = (pairs: [string, string][] = [['grass', 'dirt']]): TilesetBody => {
  let b = defaultTilesetBody('Temperate');
  for (const n of ['Grass', 'Dirt', 'Water', 'Sand', 'Mud']) b = addTerrain(b, { name: n }).body;
  return addWangset(b, { pairs }).body;
};
const map = (w: number, h: number, o: Partial<MapBody> = {}) => defaultMapBody('Mission', { width: w, height: h, tilesets: [7], terrain: 'grass', ...o });
const ok = (m: MapBody, ops: MapOp[]) => {
  const r = applyOps(m, ops);
  expect(r.errors).toEqual([]);
  return r.doc;
};

describe('missing corner mixes (FB-038)', () => {
  it('lists the cells with their corners, the pairs that would draw them and the three-way mixes', () => {
    const m = ok(map(6, 4), [
      { op: 'paint', terrain: 'water', x: 1, y: 1, mode: 'corner' },
      { op: 'paint', terrain: 'dirt', x: 4, y: 2, mode: 'corner' },
      { op: 'paint', terrain: 'sand', x: 2, y: 1, mode: 'corner' },
    ]);
    const r = missingMixes(m, [tileset()]);
    // Water at corner (1,1) touches cells (0,0) (1,0) (0,1) (1,1); sand at (2,1) touches (1,0) (2,0) (1,1) (2,1).
    expect(r.count).toBe(6);
    expect(r.cells).toEqual([
      { cell: [0, 0], corners: ['grass', 'grass', 'water', 'grass'] },
      { cell: [1, 0], corners: ['grass', 'grass', 'sand', 'water'] },
      { cell: [2, 0], corners: ['grass', 'grass', 'grass', 'sand'] },
      { cell: [0, 1], corners: ['grass', 'water', 'grass', 'grass'] },
      { cell: [1, 1], corners: ['water', 'sand', 'grass', 'grass'] },
      { cell: [2, 1], corners: ['sand', 'grass', 'grass', 'grass'] },
    ]);
    expect(r.pairs).toEqual([{ slot: 0, pair: ['grass', 'water'], cells: 2 }, { slot: 0, pair: ['grass', 'sand'], cells: 2 }]);
    expect(r.threeWay).toBe(2);
    expect(r.combos[0]).toEqual({ corners: ['grass', 'grass', 'water', 'grass'], cells: 1 });
    // The dirt corner draws: grass|dirt is a pair.
    expect(r.cells.some((c) => c.corners.includes('dirt'))).toBe(false);
    const msg = missingMixesMessage(r, ['Temperate']);
    expect(msg).toMatch(/^6 cells have a corner mix the tileset has no tile for .*: \(0,0\) grass\|grass\|water\|grass; \(1,0\) grass\|grass\|sand\|water/);
    expect(msg).toContain('ssg tileset blend Temperate grass water; ssg tileset blend Temperate grass sand');
    expect(msg).toContain('fix "add-pairs"');
    expect(msg).toContain('2 have three or more terrains meeting in one cell');
    // Capped list, full count; with the pairs added only the three-way cells are left.
    expect(missingMixes(m, [tileset()], { cap: 2 }).cells).toHaveLength(2);
    const fixed = missingMixes(m, [tileset([['grass', 'dirt'], ['grass', 'water'], ['grass', 'sand']])]);
    expect([fixed.count, fixed.threeWay, fixed.pairs]).toEqual([2, 2, []]);
    expect(missingMixesMessage(fixed, ['Temperate'])).not.toContain('blend');
    expect(missingMixesMessage(missingMixes(map(2, 2), [tileset()]))).toBe('');
  });

  it('the Tiled export warning gives positions', () => {
    const m = ok(map(6, 4), [{ op: 'paint', terrain: 'water', x: 1, y: 1, mode: 'corner' }]);
    const { warnings } = toTiledMapJson(m, { tilesets: [{ body: tileset(), file: 'temperate' }] });
    expect(warnings[0]).toMatch(/4 cells have a corner mix .* at \(0,0\) \(1,0\) \(0,1\) \(1,1\);/);
  });
});

// ------------------------------------------------------------------------------------------------- FB-039

const iso = VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
const tileView = (over: Partial<ViewConfig> = {}): ViewConfig => ({ ...iso, scale: { mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' }, padding: 2, frameWidth: 16, frameHeight: 16, ...over });

/** A real object block: an L-ish 2 × 1 m model rendered in 8 directions (4 mirrored). */
function realBlock(): SpriteObjectBlock {
  const view = tileView({ directions: '8', mirror: true });
  const dirs = resolveDirections(view);
  const pts: Vec2[] = [[0, 0], [2, 0], [2, 1], [0.5, 1]];
  const framing = computeFraming({ minY: 0, maxY: 1, radius: Math.hypot(2, 1) }, view);
  return objectInfo({ points: pts, minY: 0, maxY: 1, view, framing, directions: dirs }) as unknown as SpriteObjectBlock;
}

describe('object collision polygons (FB-039)', () => {
  it('the tile polygon of the facing; the metres polygon turned the same way when there is none', () => {
    const block = realBlock();
    expect(block.directions!.some((d) => d.mirrorOf)).toBe(true);
    for (const d of block.directions!) {
      const fromTiles = objectCollisionCells(block, 1, { facing: d.name })!;
      expect(fromTiles).toEqual(d.tiles!.polygon);
      const noTiles: SpriteObjectBlock = { ...block, tiles: null, directions: block.directions!.map(({ tiles: _t, ...rest }) => rest) };
      const fromMetres = objectCollisionCells(noTiles, 1, { facing: d.name })!;
      fromMetres.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(fromTiles[i][0], 2);
        expect(p[1]).toBeCloseTo(fromTiles[i][1], 2);
      });
    }
    // Rendered at 1 m per tile, placed on a 2 m map: half the cells.
    const se = block.directions!.find((d) => d.name === 'SE')!.tiles!.polygon!;
    expect(objectCollisionCells(block, 2, { facing: 'SE' })).toEqual(se.map(([u, v]) => [Math.round(u * 500) / 1000 || 0, Math.round(v * 500) / 1000 || 0]));
    // Unknown facing: the first direction; no block: null.
    expect(objectCollisionCells(block, 1, { facing: 'nope' })).toEqual(block.directions![0].tiles!.polygon);
    expect(objectCollisionCells(null, 1, {})).toBeNull();
  });
});

/** A bunker with states (its destroyed state is smaller) and four facings, and a one-facing tent. */
const BUNKER: SpriteObjectBlock = {
  centre: { x: 0, z: 0 }, tiles: { metresPerTile: 1, shape: 'diamond' }, pixelsPerMetre: 45.25,
  collision: { points: [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]] },
  directions: [
    { name: 'SE', worldAngle: 315, mirrorOf: null, tiles: { polygon: [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]] } },
    { name: 'SW', worldAngle: 225, mirrorOf: null, tiles: { polygon: [[-0.5, -1], [0.5, -1], [0.5, 1], [-0.5, 1]] } },
  ],
  states: [
    { name: 'intact', directions: [{ name: 'SE', tiles: { polygon: [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]] } }, { name: 'SW', tiles: { polygon: [[-0.5, -1], [0.5, -1], [0.5, 1], [-0.5, 1]] } }] },
    { name: 'destroyed', directions: [{ name: 'SE', tiles: { polygon: [[-0.75, -0.25], [0.75, -0.25], [0.75, 0.25], [-0.75, 0.25]] } }] },
  ],
};
const TENT: SpriteObjectBlock = {
  centre: { x: 0, z: 0 }, tiles: { metresPerTile: 1, shape: 'diamond' },
  directions: [{ name: 'S', worldAngle: 270, mirrorOf: null, tiles: { polygon: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]] } }],
};
const SPRITES: Record<number, MapSpriteInfo> = {
  5: { name: 'Bunker', exportName: 'Bunker', asset: 'POLYGON_War/SM_Bld_Bunker_01', object: BUNKER },
  6: { name: 'Tent: big', asset: 'POLYGON_War/SM_Prop_Tent_01', object: TENT },
};

describe('self-describing Tiled objects (FB-039)', () => {
  const sample = () =>
    ok(map(6, 4), [
      { op: 'place', spriteId: 5, name: 'Bunker', footprint: { w: 2, h: 1 }, x: 2, y: 0.5, properties: { hp: 100 } },
      { op: 'place', spriteId: 5, name: 'Bunker', footprint: { w: 1, h: 2 }, state: 'destroyed', facing: 'SW', x: 4.5, y: 2 },
      { op: 'place', spriteId: 6, name: 'Tent: big', footprint: { w: 1, h: 1 }, x: 0.5, y: 3.5 },
      { op: 'place', assetRef: 'POLYGON_War/SM_Prop_Crate_01', x: 2.5, y: 2.5 },
    ]);
  const refs = { tilesets: [{ body: tileset(), file: 'temperate' }] };

  it('tmj golden: sprite, exportName, asset, resolved state and facing, collision property and collision_shapes', () => {
    const text = writeTmj(sample(), { ...refs, sprites: SPRITES, collisionShapes: true });
    const j = JSON.parse(text) as { layers: { name: string; class?: string; objects?: unknown[] }[]; nextlayerid: number; nextobjectid: number };
    expect([j.nextlayerid, j.nextobjectid]).toEqual([7, 8]);
    expect(j.layers.map((l) => l.name)).toEqual(['ground', 'decoration', 'objects', 'collision', 'zones', 'collision_shapes']);
    expect(j.layers[2].objects).toMatchInlineSnapshot(`
      [
        {
          "height": 0,
          "id": 1,
          "name": "Bunker",
          "point": true,
          "properties": [
            {
              "name": "anchor",
              "type": "string",
              "value": "footprint-centre",
            },
            {
              "name": "asset",
              "type": "string",
              "value": "POLYGON_War/SM_Bld_Bunker_01",
            },
            {
              "name": "collision",
              "type": "string",
              "value": "[[-32,-16],[32,-16],[32,16],[-32,16]]",
            },
            {
              "name": "exportName",
              "type": "string",
              "value": "Bunker",
            },
            {
              "name": "facing",
              "type": "string",
              "value": "SE",
            },
            {
              "name": "footprintH",
              "type": "int",
              "value": 1,
            },
            {
              "name": "footprintW",
              "type": "int",
              "value": 2,
            },
            {
              "name": "hp",
              "type": "int",
              "value": 100,
            },
            {
              "name": "mapId",
              "type": "string",
              "value": "o1",
            },
            {
              "name": "sprite",
              "type": "string",
              "value": "Bunker",
            },
            {
              "name": "spriteId",
              "type": "int",
              "value": 5,
            },
            {
              "name": "state",
              "type": "string",
              "value": "intact",
            },
          ],
          "rotation": 0,
          "type": "object",
          "visible": true,
          "width": 0,
          "x": 64,
          "y": 16,
        },
        {
          "height": 0,
          "id": 2,
          "name": "Bunker",
          "point": true,
          "properties": [
            {
              "name": "anchor",
              "type": "string",
              "value": "footprint-centre",
            },
            {
              "name": "asset",
              "type": "string",
              "value": "POLYGON_War/SM_Bld_Bunker_01",
            },
            {
              "name": "collision",
              "type": "string",
              "value": "[[-16,-32],[16,-32],[16,32],[-16,32]]",
            },
            {
              "name": "exportName",
              "type": "string",
              "value": "Bunker",
            },
            {
              "name": "facing",
              "type": "string",
              "value": "SW",
            },
            {
              "name": "footprintH",
              "type": "int",
              "value": 2,
            },
            {
              "name": "footprintW",
              "type": "int",
              "value": 1,
            },
            {
              "name": "mapId",
              "type": "string",
              "value": "o2",
            },
            {
              "name": "sprite",
              "type": "string",
              "value": "Bunker",
            },
            {
              "name": "spriteId",
              "type": "int",
              "value": 5,
            },
            {
              "name": "state",
              "type": "string",
              "value": "destroyed",
            },
          ],
          "rotation": 0,
          "type": "object",
          "visible": true,
          "width": 0,
          "x": 144,
          "y": 64,
        },
        {
          "height": 0,
          "id": 3,
          "name": "Tent: big",
          "point": true,
          "properties": [
            {
              "name": "anchor",
              "type": "string",
              "value": "footprint-centre",
            },
            {
              "name": "asset",
              "type": "string",
              "value": "POLYGON_War/SM_Prop_Tent_01",
            },
            {
              "name": "collision",
              "type": "string",
              "value": "[[-16,-16],[16,-16],[16,16]]",
            },
            {
              "name": "exportName",
              "type": "string",
              "value": "Tent_ big",
            },
            {
              "name": "facing",
              "type": "string",
              "value": "S",
            },
            {
              "name": "footprintH",
              "type": "int",
              "value": 1,
            },
            {
              "name": "footprintW",
              "type": "int",
              "value": 1,
            },
            {
              "name": "mapId",
              "type": "string",
              "value": "o3",
            },
            {
              "name": "sprite",
              "type": "string",
              "value": "Tent: big",
            },
            {
              "name": "spriteId",
              "type": "int",
              "value": 6,
            },
            {
              "name": "state",
              "type": "string",
              "value": "still",
            },
          ],
          "rotation": 0,
          "type": "object",
          "visible": true,
          "width": 0,
          "x": 16,
          "y": 112,
        },
        {
          "height": 0,
          "id": 4,
          "name": "POLYGON_War/SM_Prop_Crate_01",
          "point": true,
          "properties": [
            {
              "name": "anchor",
              "type": "string",
              "value": "footprint-centre",
            },
            {
              "name": "asset",
              "type": "string",
              "value": "POLYGON_War/SM_Prop_Crate_01",
            },
            {
              "name": "assetRef",
              "type": "string",
              "value": "POLYGON_War/SM_Prop_Crate_01",
            },
            {
              "name": "mapId",
              "type": "string",
              "value": "o4",
            },
          ],
          "rotation": 0,
          "type": "object",
          "visible": true,
          "width": 0,
          "x": 80,
          "y": 80,
        },
      ]
    `);
    expect(j.layers[5]).toMatchInlineSnapshot(`
      {
        "class": "collision_shapes",
        "draworder": "topdown",
        "id": 6,
        "name": "collision_shapes",
        "objects": [
          {
            "height": 0,
            "id": 5,
            "name": "Bunker",
            "polygon": [
              {
                "x": -32,
                "y": -16,
              },
              {
                "x": 32,
                "y": -16,
              },
              {
                "x": 32,
                "y": 16,
              },
              {
                "x": -32,
                "y": 16,
              },
            ],
            "properties": [
              {
                "name": "mapId",
                "type": "string",
                "value": "o1",
              },
            ],
            "rotation": 0,
            "type": "collision_shape",
            "visible": true,
            "width": 0,
            "x": 64,
            "y": 16,
          },
          {
            "height": 0,
            "id": 6,
            "name": "Bunker",
            "polygon": [
              {
                "x": -16,
                "y": -32,
              },
              {
                "x": 16,
                "y": -32,
              },
              {
                "x": 16,
                "y": 32,
              },
              {
                "x": -16,
                "y": 32,
              },
            ],
            "properties": [
              {
                "name": "mapId",
                "type": "string",
                "value": "o2",
              },
            ],
            "rotation": 0,
            "type": "collision_shape",
            "visible": true,
            "width": 0,
            "x": 144,
            "y": 64,
          },
          {
            "height": 0,
            "id": 7,
            "name": "Tent: big",
            "polygon": [
              {
                "x": -16,
                "y": -16,
              },
              {
                "x": 16,
                "y": -16,
              },
              {
                "x": 16,
                "y": 16,
              },
            ],
            "properties": [
              {
                "name": "mapId",
                "type": "string",
                "value": "o3",
              },
            ],
            "rotation": 0,
            "type": "collision_shape",
            "visible": true,
            "width": 0,
            "x": 16,
            "y": 112,
          },
        ],
        "opacity": 1,
        "type": "objectgroup",
        "visible": true,
        "x": 0,
        "y": 0,
      }
    `);
    // Without collisionShapes no extra layer; the tmx carries the same properties and layer.
    expect(toTiledMapJson(sample(), { ...refs, sprites: SPRITES }).map.layers).toHaveLength(5);
    const x = writeTmx(sample(), { ...refs, sprites: SPRITES, collisionShapes: true });
    expect(x).toContain('<property name="collision" value="[[-32,-16],[32,-16],[32,16],[-32,16]]"/>');
    expect(x).toContain(' <objectgroup id="6" name="collision_shapes" class="collision_shapes">\n  <object id="5" name="Bunker" type="collision_shape" x="64" y="16">');
    expect(x).toContain('   <polygon points="-16,-16 16,-16 16,16"/>');
  });

  it('the destroyed state uses its own polygon', () => {
    const m = ok(map(6, 4), [{ op: 'place', spriteId: 5, name: 'Bunker', footprint: { w: 2, h: 1 }, state: 'destroyed', facing: 'SE', x: 2, y: 0.5 }]);
    const o = (toTiledMapJson(m, { ...refs, sprites: SPRITES }).map.layers[2] as { objects: { properties: { name: string; value: unknown }[] }[] }).objects[0];
    expect(o.properties.find((p) => p.name === 'collision')!.value).toBe('[[-24,-8],[24,-8],[24,8],[-24,8]]');
  });

  it('tile objects from an image collection: gid, cell position, embedded or as .tsj/.tsx', () => {
    const set = {
      file: 'mission_objects', name: 'Mission objects',
      tiles: { '6|still|S': { id: 0, width: 50, height: 40, anchor: { x: 25, y: 30 } } },
      images: [{ id: 0, image: 'mission_objects/tent_still_S.png', width: 100, height: 80 }],
    };
    const { map: j } = toTiledMapJson(sample(), { ...refs, sprites: SPRITES, objectTilesets: [set] });
    const tent = (j.layers[2] as { objects: Record<string, unknown>[] }).objects[2];
    expect(tent).toMatchObject({ gid: 65537, width: 50, height: 40 });
    expect((tent.properties as { name: string; value: unknown }[]).filter((p) => p.name === 'cellX' || p.name === 'cellY').map((p) => p.value)).toEqual([0.5, 3.5]);
    expect(j.tilesets[1]).toEqual({ firstgid: 65537, source: 'mission_objects.tsj' });
    expect(objectTilesetJson(set)).toMatchObject({ columns: 0, name: 'Mission objects', tilecount: 1, tilewidth: 100, tileheight: 80, tiles: [{ id: 0, image: 'mission_objects/tent_still_S.png', imagewidth: 100, imageheight: 80 }] });
    const embedded = toTiledMapJson(sample(), { ...refs, sprites: SPRITES, objectTilesets: [set], embed: true }).map.tilesets[1] as Record<string, unknown>;
    expect(embedded).toMatchObject({ firstgid: 65537, name: 'Mission objects', columns: 0 });
    expect(embedded.source).toBeUndefined();
    expect(writeObjectTsx(set)).toContain(' <tile id="0">\n  <image source="mission_objects/tent_still_S.png" width="100" height="80"/>\n </tile>');
    expect(writeTmx(sample(), { ...refs, sprites: SPRITES, objectTilesets: [set], embed: true })).toContain(' <tileset firstgid="65537" name="Mission objects" tilewidth="100" tileheight="80" tilecount="1" columns="0">');
  });

  type JObject = { properties?: { name: string; type: string; value: string | number | boolean }[]; [k: string]: unknown };
  type JMap = { properties?: { name: string; type: string; value: string | number | boolean }[]; layers: { name: string; objects?: JObject[]; data?: number[] }[] };
  const objectsOf = (j: JMap) => j.layers.find((l) => l.name === 'objects')!.objects!;

  it('objectData shared (FB-066): per-sprite data once in spriteData, objects keep what differs, and it resolves back', () => {
    const m = ok(map(30, 10), [
      { op: 'place', spriteId: 5, name: 'Bunker', footprint: { w: 2, h: 1 }, x: 2, y: 0.5, properties: { hp: 100 } },
      { op: 'place', spriteId: 5, name: 'Bunker', footprint: { w: 1, h: 2 }, state: 'destroyed', facing: 'SW', x: 4.5, y: 2 },
      { op: 'place', spriteId: 6, name: 'Tent: big', footprint: { w: 1, h: 1 }, x: 0.5, y: 3.5 },
      { op: 'place', assetRef: 'POLYGON_War/SM_Prop_Crate_01', x: 2.5, y: 2.5 },
      // A camp of one sprite and facing: one spriteData entry however many there are.
      ...Array.from({ length: 20 }, (_, i): MapOp => ({ op: 'place', spriteId: 6, name: 'Tent: big', footprint: { w: 1, h: 1 }, x: 10.5 + (i % 10), y: 5.5 + Math.floor(i / 10) })),
      // An own property named like a shared one the export doesn't set itself: an entry of its own.
      { op: 'place', spriteId: 5, name: 'Bunker', footprint: { w: 2, h: 1 }, x: 4, y: 8.5, properties: { assetRef: 'bunker_b' } },
    ]);
    const o = { ...refs, sprites: SPRITES, collisionShapes: true };
    const inline = toTiledMapJson(m, o).map as unknown as JMap;
    const sharedMap = toTiledMapJson(m, { ...o, objectData: 'shared' }).map as unknown as JMap;
    const mp = Object.fromEntries(sharedMap.properties!.map((p) => [p.name, p.value]));
    expect(mp.objectData).toBe('shared');
    const table = JSON.parse(String(mp.spriteData)) as Record<string, Record<string, unknown>>;
    expect(Object.keys(table)).toEqual([
      'Bunker|destroyed|SW', 'Bunker|intact|SE', 'Bunker|intact|SE#2', 'POLYGON_War/SM_Prop_Crate_01||', 'Tent: big|still|S',
    ]);
    expect(table['Tent: big|still|S']).toEqual({
      anchor: 'footprint-centre', asset: 'POLYGON_War/SM_Prop_Tent_01', collision: '[[-16,-16],[16,-16],[16,16]]', exportName: 'Tent_ big',
      facing: 'S', footprintH: 1, footprintW: 1, sprite: 'Tent: big', spriteId: 6, state: 'still',
    });
    // Objects keep mapId, spriteKey and their own properties (the first bunker's hp); nothing per sprite.
    const so = objectsOf(sharedMap);
    expect(so[0].properties!.map((p) => p.name)).toEqual(['hp', 'mapId', 'spriteKey']);
    expect(so.at(-1)!.properties!.map((p) => [p.name, p.value])).toEqual([['mapId', 'o25'], ['spriteKey', 'Bunker|intact|SE#2']]);
    // Round trip: every object's resolved properties equal the inline export's, types included; the rest is untouched.
    const io = objectsOf(inline);
    expect(so).toHaveLength(io.length);
    so.forEach((ob, i) => {
      expect(resolveSharedObjectProperties(sharedMap, ob)).toEqual(io[i].properties);
      const { properties: _a, ...restS } = ob, { properties: _b, ...restI } = io[i];
      expect(restS).toEqual(restI);
    });
    // An inline map resolves to the object's own properties.
    expect(resolveSharedObjectProperties(inline, io[0])).toEqual(io[0].properties);
    expect(sharedMap.layers.filter((l) => l.name !== 'objects')).toEqual(inline.layers.filter((l) => l.name !== 'objects'));
    // The snippet a game uses without @ssg/shared.
    const sd = JSON.parse(String(mp.spriteData));
    const props = (ob: JObject) => {
      const p: Record<string, unknown> = Object.fromEntries((ob.properties ?? []).map((q) => [q.name, q.value]));
      return { ...sd[p.spriteKey as string], ...p };
    };
    expect(props(so[2])).toMatchObject({ sprite: 'Tent: big', state: 'still', facing: 'S', collision: '[[-16,-16],[16,-16],[16,16]]', mapId: io[2].properties!.find((p) => p.name === 'mapId')!.value });
    // Smaller, and the tmx carries the same map property.
    expect(writeTmj(m, { ...o, objectData: 'shared' }).length).toBeLessThan(writeTmj(m, o).length * 0.75);
    expect(writeTmx(m, { ...o, objectData: 'shared' })).toMatch(/<property name="spriteData" value="\{&quot;Bunker\|destroyed\|SW&quot;:/);
    // Inline stays the default and has no spriteData.
    expect(inline.properties!.some((p) => p.name === 'spriteData' || p.name === 'objectData')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- FB-040

describe('text overview (FB-040)', () => {
  it('zones as outlines with unique symbols, a legend with extents, and points in the JSON', () => {
    const m = ok(map(12, 8), [
      { op: 'addZone', kind: 'spawn', name: 'Drop', shape: 'rect', points: [[1, 1], [5, 4]] },
      { op: 'addZone', kind: 'patrol', name: 'Loop', shape: 'polyline', points: [[7.5, 1.5], [10.5, 1.5], [10.5, 6.5], [7.5, 6.5], [7.5, 1.5]] },
      { op: 'addZone', kind: 'trigger', name: 'Mines', shape: 'polygon', points: [[1.5, 6.5], [4.5, 6.5], [1.5, 5.5]] },
      { op: 'addZone', kind: 'objective', name: 'Radio', points: [[6.5, 3.5]] },
    ]);
    const o = mapOverview(m);
    expect(o.lines).toMatchInlineSnapshot(`
      [
        "............",
        ".0000..1111.",
        ".0..0..1..1.",
        ".0000.31..1.",
        ".......1..1.",
        ".22....1..1.",
        ".2222..1111.",
        "............",
      ]
    `);
    expect(o.legend).toEqual({
      '.': 'terrain grass',
      0: 'spawn z1 "Drop" rect cells 1..4 × 1..3',
      1: 'patrol z2 "Loop" path of 5 points, 16 cells long (a loop)',
      2: 'trigger z3 "Mines" polygon of 3 points',
      3: 'objective z4 "Radio" point (6.5, 3.5)',
    });
    expect(o.zoneSymbols).toEqual({ z1: '0', z2: '1', z3: '2', z4: '3' });
    expect(mapOverview(m, { zones: 'marker' }).lines[1]).toBe('.0.....1....');
    expect(mapOverview(m, { zones: 'off' }).lines.join('')).toBe('.'.repeat(96));
    expect(describeMap(m).zones[1]).toEqual({ id: 'z2', kind: 'patrol', name: 'Loop', shape: 'polyline', points: [[7.5, 1.5], [10.5, 1.5], [10.5, 6.5], [7.5, 6.5], [7.5, 1.5]] });
  });

  it('objects are drawn over zones: a zone shows only on cells without an object, and the legend says when one is hidden (FB-054)', () => {
    const m = ok(map(12, 6), [
      { op: 'place', assetRef: 'SM_Veh_Plane_01', name: 'plane', footprint: { w: 4, h: 2 }, x: 4, y: 3 },
      { op: 'addZone', kind: 'spawn', name: 'Drop', shape: 'rect', points: [[1, 1], [6, 5]] },
      { op: 'addZone', kind: 'patrol', name: 'Line', shape: 'polyline', points: [[0.5, 2.5], [10.5, 2.5]] },
      { op: 'addZone', kind: 'objective', name: 'Under', points: [[3.5, 3.5]] },
    ]);
    const o = mapOverview(m);
    expect(o.lines).toMatchInlineSnapshot(`
      [
        "............",
        ".00000......",
        "11PPPP11111.",
        ".0PPPP......",
        ".00000......",
        "............",
      ]
    `);
    expect(o.legend).toMatchObject({
      P: 'object plane [SM_Veh_Plane_01] (o1)',
      0: 'spawn z1 "Drop" rect cells 1..5 × 1..4',
      1: 'patrol z2 "Line" path of 2 points, 10 cells long',
      2: 'objective z3 "Under" point (3.5, 3.5) (hidden under objects)',
    });
    expect(o.note).toContain('Objects are drawn over zones');
    // No object under a zone: no note.
    expect(mapOverview(ok(map(4, 4), [{ op: 'addZone', kind: 'spawn', name: 'S', points: [[1.5, 1.5]] }])).note).not.toContain('Objects are drawn over zones');
  });

  it('more than ten zones: digits, then letters and signs nothing else uses', () => {
    const ops: MapOp[] = Array.from({ length: 64 }, (_, i) => ({ op: 'addZone', kind: 'spawn', name: `s${i}`, points: [[(i % 16) + 0.5, Math.floor(i / 16) + 0.5]] }) as MapOp);
    const m = ok(map(16, 5), [{ op: 'place', assetRef: 'SM_Prop_Barrel_01', footprint: { w: 1, h: 1 }, x: 0.5, y: 4.5 }, ...ops]);
    const o = mapOverview(m);
    const symbols = Object.values(o.zoneSymbols);
    expect(symbols).toHaveLength(64);
    expect(new Set(symbols).size).toBe(64);
    // Not the terrain's '.', the barrel's 'B', nor '#'.
    for (const s of ['.', 'B', '#', ' ']) expect(symbols).not.toContain(s);
    expect(symbols.slice(0, 12)).toEqual([...'0123456789ab']);
    expect(o.lines[0]).toBe('0123456789abcdef');
  });

  it('collision as a separate picture keeps the terrain under it visible', () => {
    const m = ok(map(6, 3), [
      { op: 'rect', terrain: 'water', x0: 2, y0: 0, x1: 3, y1: 2 },
      { op: 'rect', value: true, x0: 2, y0: 0, x1: 3, y1: 1 },
    ]);
    const kinds = { water: 'water' };
    expect(mapOverview(m, { terrainKinds: kinds }).lines).toEqual(['..##..', '..##..', '..ww..']);
    const s = mapOverview(m, { terrainKinds: kinds, collision: 'separate' });
    expect(s.lines).toEqual(['..ww..', '..ww..', '..ww..']);
    expect(s.collision).toEqual(['..##..', '..##..', '......']);
    expect(s.legend['#']).toBeUndefined();
    expect(s.note).toContain("'#' blocked");
    expect(mapOverview(m, { collision: 'off' }).collision).toBeUndefined();
    // Blocks of cells: partly blocked blocks are '+'.
    const big = ok(map(80, 4), [{ op: 'rect', value: true, x0: 0, y0: 0, x1: 0, y1: 0 }]);
    expect(mapOverview(big, { collision: 'separate', maxSize: 40 }).collision![0].slice(0, 3)).toBe('+..');
  });

  it('thin features: a terrain only some corners have shows on the cells it touches', () => {
    // A 1.5 m trench of mud corners along y = 3 (no cell has a majority of mud), and a 2-cell road of whole cells.
    const m = ok(map(10, 7), [
      ...Array.from({ length: 9 }, (_, i): MapOp => ({ op: 'paint', terrain: 'mud', x: i + 1, y: 3, mode: 'corner' })),
      { op: 'rect', terrain: 'dirt', x0: 0, y0: 5, x1: 9, y1: 6 },
    ]);
    const kinds = { mud: 'mud', dirt: 'dirt' };
    expect(mapOverview(m, { terrainKinds: kinds, terrain: 'majority' }).lines).toMatchInlineSnapshot(`
      [
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "::::::::::",
        "::::::::::",
      ]
    `);
    const f = mapOverview(m, { terrainKinds: kinds });
    expect(f.lines).toMatchInlineSnapshot(`
      [
        "..........",
        "..........",
        "%%%%%%%%%%",
        "%%%%%%%%%%",
        "..........",
        "::::::::::",
        "::::::::::",
      ]
    `);
    expect(f.legend['%']).toBe('terrain mud');
    expect(f.note).toContain('thin');
  });
});

// ------------------------------------------------------------------------------------------------- FB-059

describe('zone vehicle and speed (FB-059)', () => {
  const ctx = { sprites: { 12: null, 13: null }, spriteNames: { 12: 'truck_drive', 13: 'jeep' } };
  const build = () => {
    const r = applyOps(map(12, 8), [
      { op: 'addZone', kind: 'patrol', id: 'r1', name: 'Truck route', points: [[1, 1], [10, 1], [10, 6]], vehicleId: 12, speed: 3 },
      { op: 'addZone', kind: 'patrol', id: 'r2', points: [[1, 3], [6, 3]], properties: { vehicle: 13, speed: 2.5, wreck: 'jeep_wreck' } },
    ], ctx);
    expect(r.errors).toEqual([]);
    return r.doc;
  };

  it('typed on the zone (also from properties.vehicle / speed), checked against the sprites, cleared with null', () => {
    const m = build();
    const zs = m.layers.flatMap((l) => (l.type === 'zones' ? l.zones : []));
    expect(zs[0]).toMatchObject({ vehicle: { spriteId: 12, name: 'truck_drive' }, speed: 3, properties: {} });
    expect(zs[1]).toMatchObject({ vehicle: { spriteId: 13, name: 'jeep' }, speed: 2.5, properties: { wreck: 'jeep_wreck' } });
    expect(applyOps(m, [{ op: 'editZone', id: 'r1', vehicleId: 99 }], ctx).errors[0].message).toBe('no sprite 99');
    expect(applyOps(m, [{ op: 'editZone', id: 'r1', speed: -2 }], ctx).errors[0].message).toMatch(/speed must be/);
    expect(applyOps(m, [{ op: 'editZone', id: 'r1', vehicle: 'truck' }], ctx).errors[0].message).toMatch(/not a sprite id/);
    const cleared = applyOps(m, [{ op: 'editZone', id: 'r1', vehicleId: null, speed: null }], ctx).doc;
    const z = cleared.layers.flatMap((l) => (l.type === 'zones' ? l.zones : []))[0];
    expect(z.vehicle).toBeUndefined();
    expect(z.speed).toBeUndefined();
  });

  it('in the summary and the legend, compactly', () => {
    const m = build();
    expect(describeMap(m).zones[0]).toMatchObject({ id: 'r1', vehicle: { spriteId: 12, name: 'truck_drive' }, speed: 3 });
    expect(mapOverview(m).legend[0]).toBe('patrol r1 "Truck route" path of 3 points, 14 cells long · vehicle truck_drive (sprite 12) at 3 m/s');
  });

  it('exported to Tiled as typed properties: vehicle (current name), vehicleId, vehicleExport, speed float', () => {
    const m = build();
    const sprites: Record<number, MapSpriteInfo> = { 12: { name: 'Truck Drive' } };
    const j = JSON.parse(writeTmj(m, { tilesets: [{ body: tileset(), file: 'temperate' }], sprites }));
    const zl = j.layers.find((l: { name: string }) => l.name === 'zones');
    expect(zl.objects[0].properties).toEqual([
      { name: 'mapId', type: 'string', value: 'r1' },
      { name: 'speed', type: 'float', value: 3 },
      { name: 'vehicle', type: 'string', value: 'Truck Drive' },
      { name: 'vehicleExport', type: 'string', value: 'Truck Drive' },
      { name: 'vehicleId', type: 'int', value: 12 },
    ]);
    // No sprite info: the name it had when it was set.
    expect(zl.objects[1].properties.find((p: { name: string }) => p.name === 'vehicle').value).toBe('jeep');
    const x = writeTmx(m, { tilesets: [{ body: tileset(), file: 'temperate' }], sprites });
    expect(x).toContain('<property name="speed" type="float" value="3"/>');
    expect(x).toContain('<property name="vehicleId" type="int" value="12"/>');
    expect(x).toContain('<property name="vehicle" value="Truck Drive"/>');
  });
});
