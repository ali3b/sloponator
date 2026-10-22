/**
 * exportModel, the cache and applyModels over a stand-in library (replaces the DB + Fastify half of the old
 * apps/server/test/models.test.ts): the cache hit and rebuild rules, errors that name the problem, clip lookup by
 * qualifier against existing bakes only, the models.json index, stale file removal and `only`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ssgModel, ssgModelsIndex } from '@slop/formats';
import { MODEL_EXPORTER_VERSION, applyModels, exportModel, parseModelsFile, pickClip, readModelsIndex, specHash, ModelError } from '../src/index.js';
import { propGlb, stubLibrary } from './helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-models-export-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const crate = path.join(tmp, 'glb/a1.glb');
const barrel = path.join(tmp, 'glb/a2.glb');
const cacheDir = path.join(tmp, 'cache');

const lib = stubLibrary({
  packs: [{ id: 1, name: 'POLYGON_Test' }, { id: 2, name: 'POLYGON_Other' }, { id: 3, name: 'ANIMATION_Test', kind: 'animations' }],
  assets: [
    { id: 1, name: 'SM_Prop_Crate_01', pack: 'POLYGON_Test', glbFile: crate, meta: { name: 'SM_Prop_Crate_01', source: 'x', kind: 'prop', bounds: { min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5] } } },
    { id: 2, name: 'SM_Prop_Barrel_01', pack: 'POLYGON_Test', glbFile: barrel, scaleFix: 2 },
    { id: 3, name: 'SM_Prop_Barrel_01', pack: 'POLYGON_Other', glbFile: barrel },
    { id: 4, name: 'SM_Prop_Broken_01', pack: 'POLYGON_Test', glbFile: path.join(tmp, 'glb/missing.glb') },
    { id: 5, name: 'Character_Test_01', pack: 'POLYGON_Test', kind: 'character', glbFile: crate, meta: { name: 'Character_Test_01', source: 'x', kind: 'character', rig: { profile: 'synty_legacy', score: 1, map: { hips: 'Hips' } } } },
  ],
  animations: [
    { id: 10, name: 'Idle', pack: 'ANIMATION_Test', gender: 'Masculine', loop: true },
    { id: 11, name: 'Idle', pack: 'ANIMATION_Test', gender: 'Feminine', loop: true, set: 'Sidekick' },
    { id: 12, name: 'Punch', pack: 'ANIMATION_Test', previousNames: ['Hit_01'] },
    { id: 13, name: 'Prop_Spin', pack: 'ANIMATION_Test', rig: null },
  ],
});

beforeAll(async () => {
  await propGlb(crate);
  await propGlb(barrel, 'SM_Prop_Barrel_01', [60, 100, 60], [180, 60, 60]);
});

describe('exportModel through the cache', () => {
  it('builds a prop once; the same spec by name, Pack/Name or id is a cache hit under the same id', async () => {
    const a = await exportModel({ asset: 'SM_Prop_Crate_01', origin: 'bottom-centre' }, { lib, cacheDir });
    expect(a.cached).toBe(false);
    expect(a.id).toBe(specHash({ asset: 1, name: 'SM_Prop_Crate_01', origin: 'bottom-centre' }));
    expect(a.dir).toBe(path.join(cacheDir, a.id));
    expect(fs.readdirSync(a.dir).sort()).toEqual(['SM_Prop_Crate_01.glb', 'SM_Prop_Crate_01.model.json', 'source.key', 'spec.json']);
    // The manifest is the formats' ssg-model, with the crate's metre size and the bottom-centre origin.
    expect(ssgModel.safeParse(a.manifest).success).toBe(true);
    expect(a.manifest.bounds.size).toEqual([1, 2, 1]);
    expect(a.manifest.bounds.min[1]).toBe(0);
    expect(a.manifest.source).toEqual({ pack: 'POLYGON_Test', asset: 'SM_Prop_Crate_01', assetId: 1 });
    const b = await exportModel({ asset: 'POLYGON_Test/SM_Prop_Crate_01' }, { lib, cacheDir });
    const c = await exportModel({ asset: 1, name: 'SM_Prop_Crate_01', texFormat: 'webp', compress: 'none' }, { lib, cacheDir });
    expect([b.id, c.id]).toEqual([a.id, a.id]);
    expect([b.cached, c.cached, b.rev === a.rev]).toEqual([true, true, true]);
  });

  it('is deterministic: a forced rebuild gives the same bytes and revision', async () => {
    const a = await exportModel({ asset: 'SM_Prop_Crate_01' }, { lib, cacheDir });
    const bytes = fs.readFileSync(a.glb);
    const b = await exportModel({ asset: 'SM_Prop_Crate_01' }, { lib, cacheDir, force: true });
    expect(b.cached).toBe(false);
    expect(b.rev).toBe(a.rev);
    expect(fs.readFileSync(b.glb).equals(bytes)).toBe(true);
    expect(JSON.parse(fs.readFileSync(b.manifestFile, 'utf8'))).toEqual(a.manifest);
  });

  it('a changed source GLB rebuilds under the same id with a new revision; the key names the exporter version', async () => {
    const before = await exportModel({ asset: 'SM_Prop_Barrel_01' }, { lib, cacheDir });
    expect(before.manifest.bounds.size).toEqual([1.2, 2, 1.2]); // scaleFix 2
    await propGlb(barrel, 'SM_Prop_Barrel_01', [60, 150, 60], [180, 60, 60]);
    const after = await exportModel({ asset: 'SM_Prop_Barrel_01' }, { lib, cacheDir });
    expect(after.id).toBe(before.id);
    expect(after.cached).toBe(false);
    expect(after.rev).not.toBe(before.rev);
    expect(after.manifest.bounds.size).toEqual([1.2, 3, 1.2]);
    // The key is a hash of the spec's inputs and MODEL_EXPORTER_VERSION: the same bytes anywhere.
    expect(fs.readFileSync(path.join(after.dir, 'source.key'), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(MODEL_EXPORTER_VERSION).toBe(9);
    // A pack-qualified name picks the other pack's copy: another id.
    const other = await exportModel({ asset: 'POLYGON_Other/SM_Prop_Barrel_01' }, { lib, cacheDir });
    expect(other.id).not.toBe(before.id);
    expect(other.manifest.source).toMatchObject({ pack: 'POLYGON_Other', assetId: 3 });
  });

  it('errors name the problem: a missing asset (with close names), a pack, a missing GLB, clips on a prop', async () => {
    await expect(exportModel({ asset: 'SM_Prop_Crate_1' }, { lib, cacheDir })).rejects.toThrow(/no model named "SM_Prop_Crate_1" \(did you mean SM_Prop_Crate_01/);
    await expect(exportModel({ asset: 'POLYGON_Tset/SM_Prop_Crate_01' }, { lib, cacheDir })).rejects.toThrow(/no pack named "POLYGON_Tset" \(did you mean POLYGON_Test/);
    await expect(exportModel({ asset: 99 }, { lib, cacheDir })).rejects.toThrow(/no model with id 99/);
    await expect(exportModel({ asset: 'SM_Prop_Broken_01' }, { lib, cacheDir })).rejects.toThrow(/its GLB is missing/);
    await expect(exportModel({ asset: 'SM_Prop_Crate_01', clips: ['Idle'] }, { lib, cacheDir })).rejects.toThrow(/is a prop: only characters take clips/);
    await expect(exportModel({ asset: 'SM_Prop_Crate_01', origin: 'sideways' as never }, { lib, cacheDir })).rejects.toThrow(/origin must be one of/);
    const err = await exportModel({ asset: 'SM_Prop_Nope_01' }, { lib, cacheDir }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.status).toBe(404);
  });

  it('clips come from existing bakes only: a character whose clip was never baked is refused with a code', async () => {
    const err = await exportModel({ asset: 'Character_Test_01', clips: ['Idle'] }, { lib, cacheDir }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.code).toBe('not-baked');
    expect(err.message).toMatch(/clip Idle \(#10\) is not baked onto Character_Test_01/);
  });
});

describe('pickClip (OR-FB-010 qualifiers, over the library)', () => {
  it('by name picks the character\'s gender first and warns; qualifiers narrow it; old names and ids work; rig-less clips do not', () => {
    const m = pickClip(lib, 'Idle', 'Character_Test_01');
    expect([m.row.id, m.outName]).toEqual([10, 'Idle']);
    expect(m.warning).toMatch(/2 clips match; used Idle@Masculine \(#10, ANIMATION_Test\)/);
    const f = pickClip(lib, 'Idle', 'Character_Female_01');
    expect(f.row.id).toBe(11);
    const fem = pickClip(lib, 'Idle@Feminine', 'Character_Test_01');
    expect([fem.row.id, fem.outName, fem.warning]).toEqual([11, 'Idle@Feminine', undefined]);
    expect(pickClip(lib, 'Idle@Sidekick', 'Character_Test_01').row.id).toBe(11);
    expect(pickClip(lib, 'idle@#10', 'Character_Test_01').row.id).toBe(10);
    expect(pickClip(lib, 'Hit_01', 'Character_Test_01').row.name).toBe('Punch');
    expect(pickClip(lib, '12', 'Character_Test_01').outName).toBe('Punch');
    expect(() => pickClip(lib, 'Idle@Neutral', 'Character_Test_01')).toThrow(/no Idle clip is Neutral \(Idle clips: Idle@Masculine, Idle@Feminine\)/);
    expect(() => pickClip(lib, 'Punsh', 'Character_Test_01')).toThrow(/no clip named "Punsh" \(did you mean Punch/);
    expect(() => pickClip(lib, 'Prop_Spin', 'Character_Test_01')).toThrow(/no clip named "Prop_Spin"/);
    expect(() => pickClip(lib, '@Feminine', 'Character_Test_01')).toThrow(/give a clip name before the @/);
  });
});

describe('applyModels: the folder and models.json', () => {
  const out = path.join(tmp, 'public/models');
  const file = (models: unknown[], defaults?: unknown) => parseModelsFile({ models, ...(defaults ? { defaults } : {}) });

  it('writes new models, skips unchanged ones, rewrites changed ones and removes stale files', async () => {
    const lines: string[] = [];
    const r1 = await applyModels(file([{ name: 'crate', asset: 'SM_Prop_Crate_01' }, { name: 'barrel', asset: 'POLYGON_Test/SM_Prop_Barrel_01', fit: { height: 1 } }], { texFormat: 'png' }), out, { lib, cacheDir, onLine: (l) => lines.push(l) });
    expect(r1.models.map((m) => [m.name, m.action, m.glb, m.manifest])).toEqual([['crate', 'written', 'crate.glb', 'crate.model.json'], ['barrel', 'written', 'barrel.glb', 'barrel.model.json']]);
    expect(fs.readdirSync(out).sort()).toEqual(['barrel.glb', 'barrel.model.json', 'crate.glb', 'crate.model.json', 'models.json']);
    const index = readModelsIndex(path.join(out, 'models.json'))!;
    expect(ssgModelsIndex.safeParse(index).success).toBe(true);
    expect(Object.keys(index.models)).toEqual(['crate', 'barrel']);
    expect(index.models.crate).toMatchObject({ id: r1.models[0].id, rev: r1.models[0].rev, asset: 'SM_Prop_Crate_01', glb: 'crate.glb', manifest: 'crate.model.json' });
    expect(index.models.barrel.data).toEqual(JSON.parse(fs.readFileSync(path.join(out, 'barrel.model.json'), 'utf8')));
    // The output name is the declaration's, not the asset's; the manifest inside carries it too.
    expect(index.models.crate.data.name).toBe('crate');
    expect(index.models.barrel.data.scale).toEqual({ modelScale: expect.any(Number), fit: { height: 1 } });
    expect(lines.filter((l) => /written/.test(l))).toHaveLength(2);

    // Again: nothing changes.
    const r2 = await applyModels(file([{ name: 'crate', asset: 'SM_Prop_Crate_01' }, { name: 'barrel', asset: 'POLYGON_Test/SM_Prop_Barrel_01', fit: { height: 1 } }], { texFormat: 'png' }), out, { lib, cacheDir });
    expect(r2.models.map((m) => [m.action, m.cached])).toEqual([['unchanged', true], ['unchanged', true]]);

    // A changed spec rewrites that model; a dropped one's files go; a deleted file is written again.
    fs.rmSync(path.join(out, 'crate.glb'));
    const r3 = await applyModels(file([{ name: 'crate', asset: 'SM_Prop_Crate_01' }, { name: 'drum', asset: 'POLYGON_Test/SM_Prop_Barrel_01' }], { texFormat: 'png' }), out, { lib, cacheDir });
    expect(r3.models.map((m) => [m.name, m.action])).toEqual([['crate', 'updated'], ['drum', 'written']]);
    expect(r3.removed.sort()).toEqual(['barrel.glb', 'barrel.model.json']);
    expect(fs.readdirSync(out).sort()).toEqual(['crate.glb', 'crate.model.json', 'drum.glb', 'drum.model.json', 'models.json']);
  });

  it('an export error leaves the folder untouched; `only` builds some and keeps the others\' entries', async () => {
    const before = fs.readFileSync(path.join(out, 'models.json'), 'utf8');
    await expect(applyModels(file([{ name: 'crate', asset: 'SM_Prop_Crate_01' }, { name: 'nope', asset: 'SM_Prop_Nope_01' }]), out, { lib, cacheDir })).rejects.toThrow(/model nope: no model named "SM_Prop_Nope_01"/);
    expect(fs.readFileSync(path.join(out, 'models.json'), 'utf8')).toBe(before);
    const r = await applyModels(file([{ name: 'crate', asset: 'SM_Prop_Crate_01', texSize: 32 }, { name: 'drum', asset: 'POLYGON_Test/SM_Prop_Barrel_01' }], { texFormat: 'png' }), out, { lib, cacheDir, only: ['crate'] });
    expect(r.models.map((m) => [m.name, m.action])).toEqual([['crate', 'updated']]);
    const index = readModelsIndex(path.join(out, 'models.json'))!;
    expect(Object.keys(index.models).sort()).toEqual(['crate', 'drum']);
    expect(fs.existsSync(path.join(out, 'drum.glb'))).toBe(true);
    await expect(applyModels(file([{ name: 'crate', asset: 'SM_Prop_Crate_01' }]), out, { lib, cacheDir, only: ['nope'] })).rejects.toThrow(/no model named "nope" in the file/);
  });

  it('an index naming paths outside the folder removes nothing', async () => {
    const dir = path.join(tmp, 'public/other');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'public/victim.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify({ version: 1, models: { old: { id: 'x', asset: 'y', glb: '../victim.txt', manifest: '/etc/passwd' } } }));
    const r = await applyModels(file([{ name: 'crate', asset: 'SM_Prop_Crate_01' }]), dir, { lib, cacheDir });
    expect(r.removed).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'public/victim.txt'))).toBe(true);
  });
});
