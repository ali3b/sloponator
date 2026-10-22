// Moved from synty-sprite-generator packages/client/src/models.test.ts parseModelsFile (P3, ali3b/sloponator#16);
// the applyModels-with-a-fake-API tests are replaced by export.test.ts. The messages are @slop/schema's teaching errors.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexAssetOf, modelFileNames, parseModelsFile, parsePose, parsePoses, parseVariants } from '../src/index.js';

const fixture = (name: string) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../schema/test/fixtures/${name}`, import.meta.url)), 'utf8'));

describe('parseModelsFile', () => {
  it('merges defaults under each model and names files by name', () => {
    const d = parseModelsFile({
      models: [{ name: 'truck_red', asset: 'SM_Veh_Pickup_Lift_01', tint: '#C0392B', origin: 'axle-centre' }, { name: 'driver', asset: 'Character_MercenaryMale_01', clips: ['Idle', 'Wave_01'] }],
      defaults: { texSize: 1024 },
    });
    expect(d.map((x) => x.name)).toEqual(['truck_red', 'driver']);
    expect(d[0].spec).toEqual({ texSize: 1024, name: 'truck_red', asset: 'SM_Veh_Pickup_Lift_01', tint: '#c0392b', origin: 'axle-centre' });
    expect(d[1].spec.clips).toEqual(['Idle', 'Wave_01']);
    expect(modelFileNames('truck red')).toEqual({ glb: 'truck_red.glb', manifest: 'truck_red.model.json' });
  });

  it('mixes assets and track pieces (CS-FB-001): asset-only defaults skip the pieces', () => {
    const d = parseModelsFile({
      models: [
        { name: 'truck', asset: 'SM_Veh_Pickup_01', tint: '#c62828' },
        { trackpiece: { preset: 'loop', cell: 62.42, width: 14.63, radius: 29.7 } },
        { name: 'ramp', trackpiece: { preset: 'slope-up', height: 27.43 }, collider: 'trimesh', compress: 'meshopt' },
      ],
      defaults: { texSize: 1024, origin: 'axle-centre', compress: 'meshopt', trackpiece: { cell: 50, materials: { wall: '#808080' } } },
    });
    expect(d.map((x) => x.name)).toEqual(['truck', 'track_loop', 'ramp']);
    expect(d[0].spec).toMatchObject({ origin: 'axle-centre', texSize: 1024 });
    expect(d[1].spec).toEqual({ texSize: 1024, compress: 'meshopt', name: 'track_loop', trackpiece: { preset: 'loop', cell: 62.42, radius: 29.7, width: 14.63, materials: { wall: '#808080' } } });
    expect(d[2].spec.trackpiece).toMatchObject({ cell: 50, height: 27.43 });
    expect(d[0].spec.trackpiece).toBeUndefined();
    expect(d[2].spec.collider).toBe('trimesh');
    expect(indexAssetOf(d[1].spec)).toBe('trackpiece:loop');
    expect(indexAssetOf(d[0].spec)).toBe('SM_Veh_Pickup_01');
    expect(() => parseModelsFile({ models: [{ name: 'x', trackpiece: { preset: 'loop' }, tint: '#ff0000' }] })).toThrow(/a trackpiece is built, not loaded/);
    expect(() => parseModelsFile({ models: [{ name: 'x', trackpiece: { preset: 'loop' }, asset: 'Y' }] })).toThrow(/asset or trackpiece/);
    expect(() => parseModelsFile({ models: [{ name: 'x', trackpiece: { preset: 'wiggle' } }] })).toThrow(/preset must be one of/);
  });

  it('refuses typos, bad values and duplicate names, with the schema\'s teaching errors', () => {
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', orign: 'pivot' }] })).toThrow(/unknown key "orign". Did you mean "origin"/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', origin: 'middle' }] })).toThrow(/origin must be one of/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X' }, { name: 'A', asset: 'Y' }] })).toThrow(/used twice/);
    expect(() => parseModelsFile({ models: [{ asset: 12 }] })).toThrow(/name is missing/);
    expect(() => parseModelsFile({ models: [] })).toThrow(/at least 1/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', simplify: 2 }] })).toThrow(/simplify/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', fit: { depth: 1 } }] })).toThrow(/unknown key "depth"/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', variants: [{ name: 'a', colour: '#fff' }] }] })).toThrow(/unknown key "colour"/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', variants: [{ name: 'a' }, { name: 'A' }] }] })).toThrow(/used twice/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', pose: 'Idle', clips: ['Idle'] }] })).toThrow(/leave clips out/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', tint: '#fff', variants: [{ name: 'a' }] }] })).toThrow(/give each variant its tint/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', poses: 'a=Idle,a=Wave' }] })).toThrow(/used twice/);
    expect(() => parseModelsFile({ models: [{ name: 'a', asset: 'X', poses: [{ clip: 'Idle' }] }] })).toThrow(/poses/);
  });

  it('takes the CLI string forms: clips, variants, a pose, poses', () => {
    const [d, e] = parseModelsFile([{ name: 'a', asset: '42', variants: 'red=#C62828,plain', pose: 'Wave_01@Feminine:0.25' }, { name: 'b', asset: 'X', clips: 'Idle, Run', attach: 'Hat' }]);
    expect(d.spec).toMatchObject({ asset: '42', variants: [{ name: 'red', tint: '#c62828' }, { name: 'plain' }], pose: { clip: 'Wave_01@Feminine', time: 0.25 } });
    expect(e.spec).toMatchObject({ clips: ['Idle', 'Run'], attach: ['Hat'] });
    expect(parsePose({ clip: 'Wave_01' })).toEqual({ clip: 'Wave_01' });
    expect(parsePoses('idle=Idle:0, wave_a=Wave:0.2')).toEqual([{ name: 'idle', clip: 'Idle', time: 0 }, { name: 'wave_a', clip: 'Wave', time: 0.2 }]);
    expect(() => parsePoses([{ clip: 'Idle' }])).toThrow(/needs a name/);
    expect(() => parseVariants({ name: 'a' })).toThrow(/list of/);
  });

  it('accepts the games\' real ssg.models.json unchanged (Off Road, 4D Stunts), file defaults under every model', () => {
    const offroad = parseModelsFile(fixture('offroad.models.json'));
    expect(offroad).toHaveLength(49);
    expect(offroad[0]).toMatchObject({ name: 'truck', spec: { asset: 'POLYGON_Palm_City/SM_Veh_Pickup_01', texSize: 1024, texFormat: 'webp', compress: 'meshopt', attach: ['SM_Veh_Pickup_Lift_01'] } });
    expect(offroad.find((d) => d.name === 'barrel')!.spec).toEqual({ texSize: 256, texFormat: 'webp', name: 'barrel', asset: 'POLYGON_Apocalypse/SM_Prop_Barrel_01', origin: 'bottom-centre' });
    const stunts = parseModelsFile(fixture('4dstunts.models.json'));
    const kinds = new Set(stunts.map((d) => (d.spec.trackpiece ? 'trackpiece' : d.spec.terrain ? 'terrain' : d.spec.skydome ? 'skydome' : d.spec.composite ? 'composite' : 'asset')));
    expect([...kinds].sort()).toEqual(['asset', 'composite', 'skydome', 'terrain', 'trackpiece']);
    // defaults.trackpiece (cell, width) goes under every piece; width becomes profile.width only when the piece has a profile.
    const piece = stunts.find((d) => d.spec.trackpiece)!;
    expect(piece.spec.trackpiece).toMatchObject({ cell: 62.42 });
    expect(piece.spec.texSize).toBe(512);
  });
});
