// planSprites against the old generator's real library (read-only); skipped, with a message, when it is not here.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetsFile } from '@slop/schema';
import { openLibrary, type Library } from '@slop/library';
import { BUILTIN_SETS, setItemLabel } from '@slop/sprites';
import { planSprites, projectDefaultsFrom, defaultSetFor, type ProjectDefaults } from '../../src/plan/index.js';

const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const have = fs.existsSync(path.join(DATA_DIR, 'library.db'));
if (!have) console.warn(`plan.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);

const FIXTURES = path.resolve(__dirname, '../../../schema/test/fixtures');
const monty = () => assetsFile.parse(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'monty.assets.json'), 'utf8')));
/** The project defaults the old generator had for "Montezuma's Revenge". */
const MONTY_PROJECT = JSON.parse(fs.readFileSync(path.join(__dirname, 'monty.project.json'), 'utf8')) as ProjectDefaults;

describe('projectDefaultsFrom', () => {
  it('a file without defaults gives the stock project (top-down 8, clean, medium, generic)', () => {
    expect(projectDefaultsFrom({})).toMatchObject({ viewCardId: 'topdown8', lookId: 'clean', sizeId: 'medium', profileId: 'generic', uniformFrame: true, layered: true, gender: 'auto' });
  });
});

describe.skipIf(!have)('planSprites on the old library', () => {
  const lib: Library = have ? openLibrary({ dataDir: DATA_DIR }) : (null as unknown as Library);
  const labels = (p: { batch: { set: { items: Parameters<typeof setItemLabel>[0][] } } }) => p.batch.set.items.map(setItemLabel);

  it("plans Montezuma's Revenge as the old `ssg sprite apply` + render would have", async () => {
    const warnings: string[] = [];
    const file = monty();
    const planned = await planSprites(file, { lib, project: MONTY_PROJECT, warn: (m) => warnings.push(m) });
    expect(planned.map((p) => p.name)).toEqual(file.sprites.map((s) => s.name));
    const byName = Object.fromEntries(planned.map((p) => [p.name, p]));

    const joe = byName.joe;
    expect(joe.asset).toMatchObject({ pack: 'POLYGON_War', name: 'Character_GentleMan_01', kind: 'character' });
    expect(joe.kind).toBe('character');
    expect(labels(joe)).toEqual(['martial_arts_idle', 'martial_arts_walk_forward', 'martial_arts_walk_back', 'martial_arts_jump', 'martial_arts_crouch_idle', 'martial_arts_hit_head', 'martial_arts_get_up', 'martial_arts_ko']);
    expect(joe.spec.classes).toEqual(['martial_arts']);
    const hat = lib.asset('POLYGON_Palm_City/SM_Chr_Attach_Hat_03')!;
    expect(joe.batch.loadout?.map((it) => it.asset)).toEqual([hat.id]);
    expect(joe.batch.assetIds).toEqual([joe.asset.id]);
    expect(joe.batch.profile.id).toBe('phaser3');
    expect(joe.batch.profile.animationName).toBe('joe/{clip}_{dir}');
    expect(joe.batch.view).toMatchObject({ directions: '2', fps: 12, scale: { mode: 'ppm', ppm: 32 }, pitch: 0, projection: 'ortho' });
    expect(joe.batch.view.quality?.style).toBe('pixel');
    expect(joe.batch.uniformFrame).toBe(true);
    // Equipment is baked: declared sprites keep their own layering although the project says layered.
    expect(joe.batch.layered).toBeUndefined();
    expect(joe.spec).toMatchObject({ layered: false, layeredOwn: true, inherit: ['view', 'look', 'size', 'engine', 'gender'] });
    expect(joe.effective.profileId).toBe('phaser3');
    expect(joe.batch.previews).toBe(true);
    expect(joe.batch.noCache).toBeUndefined();
    expect(joe.batch.name).toBe('joe v1: First render');
    expect(joe.batch.uniformWith).toBeUndefined();
    expect(joe.plan).toMatchObject({ mode: 'full', label: 'First render' });
    expect(joe.own).toEqual([]);
    expect(joe.warnings).toEqual([]);
    expect(joe.settings).toMatchObject({ view: 'side2', dirs: '2', fps: 12, scale: 'ppm', ppm: 32, format: 'phaser3', uniform: true, layered: 'baked', clips: labels(joe) });

    const skeleton = byName.skeleton;
    expect(skeleton.kind).toBe('character');
    expect(labels(skeleton)).toEqual(['Idle_Standing', 'Walk_F', 'Run_F', 'hit_react', 'death_fall']);
    expect(skeleton.spec.setId).toBe('builtin_locomotion');

    const skull = byName.skull;
    expect(skull.kind).toBe('prop');
    expect(skull.batch.set.items).toEqual([{ type: 'template', layers: [{ id: 'bounce', params: {} }], label: 'bounce' }]);
    expect(skull.batch.view.scale).toEqual({ mode: 'fit' });
    expect(skull.batch.uniformFrame).toBe(false);

    const flame = byName.flame;
    expect(flame.kind).toBe('prop');
    expect(flame.batch.fx).toEqual({ enabled: true, tint: '#ff7a20', intensity: 1.2 });
    expect(labels(flame)).toEqual(['still']);

    // No kind, no template: the model's kind and its default set.
    const ladder = byName.ladder;
    expect(['object', 'prop']).toContain(ladder.kind);
    expect(ladder.spec.setId).toBe(defaultSetFor(ladder.kind));
    expect(ladder.batch.set.id).toBe(defaultSetFor(ladder.kind));
    expect(labels(ladder)).toEqual(BUILTIN_SETS.find((s) => s.id === defaultSetFor(ladder.kind))!.items.map(setItemLabel));

    expect(warnings).toEqual([]);
  });

  it('force sets noCache; only restricts the sprites planned but still checks the whole file', async () => {
    const planned = await planSprites(monty(), { lib, project: MONTY_PROJECT, force: true, only: ['Joe'] });
    expect(planned.map((p) => p.name)).toEqual(['joe']);
    expect(planned[0].batch.noCache).toBe(true);
    expect(planned[0].batch.incremental).toBeUndefined();
    expect(planned[0].plan.forced).toBe(true);
    await expect(planSprites(monty(), { lib, project: MONTY_PROJECT, only: ['nobody'] })).rejects.toThrow(/"only" names sprites the file does not declare: nobody/);
  });

  it('uniform siblings: two sprites of one model at the same view share a frame (uniformWith)', async () => {
    const file = monty();
    const twice = { ...file, sprites: [file.sprites[0], { ...file.sprites[0], name: 'joe_hatless', with: undefined }] };
    const planned = await planSprites(twice, { lib, project: MONTY_PROJECT });
    expect(planned[0].batch.uniformWith?.length).toBe(1);
    expect(planned[0].batch.uniformWith?.[0].loadout).toBeUndefined();
    expect(planned[1].batch.uniformWith?.[0].loadout?.length).toBe(1);
    // Fitted props share nothing.
    const props = { ...file, sprites: [file.sprites[2], { ...file.sprites[2], name: 'skull2' }] };
    expect((await planSprites(props, { lib, project: MONTY_PROJECT })).every((p) => !p.batch.uniformWith)).toBe(true);
  });

  it('reports every bad entry before anything is planned', async () => {
    const file = monty();
    const bad = { ...file, sprites: [file.sprites[2], { ...file.sprites[2], name: 'ghost', asset: 'POLYGON_Dark_Fantasy/SM_Prop_Nope_99' }, { ...file.sprites[2], name: 'ghost2', template: 'drive:steer=left' }] };
    await expect(planSprites(bad, { lib, project: MONTY_PROJECT })).rejects.toThrow(/Nothing was planned:\n {2}ghost: No model .*\n {2}ghost2: Bad template parameter/);
  });
});
