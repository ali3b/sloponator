/**
 * The bake store with a stubbed Blender (test/fixtures/stub-blender.mjs) and a fake library: the key and what
 * changes it, the sidecar, imports of old bakes, one run per key in one process and across processes (the lock),
 * one Blender at a time (the queue), refusals and failures, stale locks. No real Blender, no Synty data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Library } from '@slop/library';
import { BakeError, BakeStore, BlenderQueue, IMPORTED, WORKER_DIR, bakeKey, parseTagged, tryLock, withLock, workerVersion, type BakeRequest } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(here, 'fixtures/stub-blender.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-bake-test-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A stub binary of its own path: blenderVersion() is remembered per binary, so a "new Blender" is a new path. */
function stubBlender(version: string): string {
  const dir = fs.mkdtempSync(path.join(root, 'bin-'));
  const bin = path.join(dir, 'blender');
  fs.writeFileSync(bin, `#!/bin/sh\nSTUB_BLENDER_VERSION='${version}' exec node '${STUB}' "$@"\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

interface FakeData {
  dir: string;
  lib: Library;
  file(rel: string, content: string): string;
}

/** A library of two characters, a prop and three clips (one fails in Blender, one has no rig), files on disk. */
function fakeLibrary(): FakeData {
  const dir = fs.mkdtempSync(path.join(root, 'data-'));
  const file = (rel: string, content: string) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
    return f;
  };
  const assets = new Map([
    [1, { id: 1, pack: 'P', name: 'Character_Hero', kind: 'character', glb: file('glb/a1.glb', 'hero glb'), fbx: file('packs/hero.fbx', 'hero fbx') }],
    [2, { id: 2, pack: 'P', name: 'Character_Villain', kind: 'character', glb: file('glb/a2.glb', 'villain glb'), fbx: file('packs/villain.fbx', 'villain fbx') }],
    [3, { id: 3, pack: 'P', name: 'SM_Prop_Crate', kind: 'prop', glb: file('glb/a3.glb', 'crate'), fbx: file('packs/crate.fbx', 'crate') }],
  ]);
  const anims = new Map([
    [10, { id: 10, pack: 'A', name: 'Walk_F', rig: 'synty_legacy', gender: 'Masculine', set: 'Polygon', fbx: file('packs/walk.fbx', 'walk') }],
    [11, { id: 11, pack: 'A', name: 'Run_F', rig: 'synty_legacy', gender: null, set: 'Polygon', fbx: file('packs/fail_run.fbx', 'run') }],
    [12, { id: 12, pack: 'A', name: 'Odd', rig: null, gender: null, set: null, fbx: file('packs/odd.fbx', 'odd') }],
  ]);
  const old = (asset: number, anim: number, inPlace: boolean) => path.join(dir, 'bakes', `a${asset}`, `n${anim}${inPlace ? '' : '_rm'}.glb`);
  const lib = {
    dataDir: dir,
    asset: (ref: number) => {
      const a = assets.get(ref);
      return a && { ...a, glbPath: () => a.glb, fbxPath: () => a.fbx };
    },
    animation: (ref: number) => {
      const n = anims.get(ref);
      return n && {
        ...n,
        fbxPath: () => n.fbx,
        bakePath: (asset: number, o: { inPlace?: boolean } = {}) => (fs.existsSync(old(asset, n.id, o.inPlace ?? true)) ? old(asset, n.id, o.inPlace ?? true) : null),
      };
    },
  } as unknown as Library;
  return { dir, lib, file };
}

const LOG = path.join(root, 'blender.log');
process.env.STUB_BLENDER_LOG = LOG;
const runs = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { start: number; end: number; clip: string; inPlace: boolean }) : []);
beforeEach(() => fs.rmSync(LOG, { force: true }));

const HERO_WALK: BakeRequest = { asset: 1, animation: 10 };
const BLENDER_A = stubBlender('Blender 4.0.2');
const BLENDER_B = stubBlender('Blender 4.2.0');

function store(data: FakeData, opts: Partial<ConstructorParameters<typeof BakeStore>[0]> = {}) {
  return new BakeStore({ lib: data.lib, dir: path.join(data.dir, 'store'), blender: BLENDER_A, lock: { pollMs: 20 }, ...opts });
}

describe('the key', () => {
  it('names every input and the versions; the sidecar writes them out', async () => {
    const data = fakeLibrary();
    const s = store(data);
    const e = await s.ensure(HERO_WALK);
    expect(e.sidecar.inputs).toEqual({
      store: 1, assetGlbHash: expect.stringMatching(/^[0-9a-f]{64}$/), assetFbxHash: expect.stringMatching(/^[0-9a-f]{64}$/), animFbxHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      rootMotion: false, worker: s.workerVersion(), blender: 'Blender 4.0.2',
    });
    expect(e.key).toBe(bakeKey(e.sidecar.inputs));
    expect(e.sidecar).toMatchObject({ source: 'blender', clip: 'n10', speedMps: 1.25, asset: { id: 1, name: 'Character_Hero' }, animation: { id: 10, name: 'Walk_F', gender: 'Masculine' } });
    expect(e.glb).toBe(path.join(data.dir, 'store/a1/n10', e.key.slice(0, 16), 'clip.glb'));
    expect(e.speed).toBe(1.25);
    // The worker got the old bake.ts arguments and the old generator's rigs dir.
    const args = JSON.parse(fs.readFileSync(e.glb, 'utf8').slice('glTF stub '.length));
    expect(args).toEqual({ source: path.join(data.dir, 'packs/walk.fbx'), target: path.join(data.dir, 'packs/hero.fbx'), clip_name: 'n10', in_place: true, rigs: path.join(data.dir, 'rigs') });
  });

  it('a new Blender, a worker change, a changed FBX or GLB, or root motion makes a new entry (and a new bake)', async () => {
    const data = fakeLibrary();
    const a = store(data);
    const first = await a.ensure(HERO_WALK);
    expect((await a.ensure(HERO_WALK)).key).toBe(first.key);
    expect(runs()).toHaveLength(1);

    const upgraded = await store(data, { blender: BLENDER_B }).ensure(HERO_WALK);
    expect(upgraded.key).not.toBe(first.key);
    expect(upgraded.sidecar.inputs.blender).toBe('Blender 4.2.0');

    const worker = fs.mkdtempSync(path.join(root, 'worker-'));
    fs.cpSync(WORKER_DIR, worker, { recursive: true });
    expect(workerVersion(worker)).toBe(workerVersion(WORKER_DIR));
    fs.appendFileSync(path.join(worker, 'retarget.py'), '\n# a fix\n');
    expect(workerVersion(worker)).not.toBe(workerVersion(WORKER_DIR));
    const fixed = await store(data, { workerDir: worker }).ensure(HERO_WALK);
    expect(fixed.key).not.toBe(first.key);

    // A user-confirmed rig profile is part of the worker too.
    data.file('rigs/custom.json', '{"name":"custom","map":{}}');
    const withRig = await store(data).ensure(HERO_WALK);
    expect(withRig.key).not.toBe(first.key);

    data.file('packs/walk.fbx', 'walk, re-exported');
    const reFbx = await store(data).ensure(HERO_WALK);
    expect(new Set([first.key, withRig.key, reFbx.key]).size).toBe(3);
    data.file('glb/a1.glb', 'hero glb, re-ingested');
    const reGlb = await store(data).ensure(HERO_WALK);
    expect(reGlb.key).not.toBe(reFbx.key);

    const rm = await store(data).ensure({ ...HERO_WALK, rootMotion: true });
    expect(rm.sidecar).toMatchObject({ clip: 'n10_rm', inputs: { rootMotion: true } });
    expect(rm.glb).toContain(`${path.sep}n10_rm${path.sep}`);
    expect(runs().at(-1)).toMatchObject({ clip: 'n10_rm', inPlace: false });
    expect(runs()).toHaveLength(7);
  });
});

describe('imports from the old data/bakes', () => {
  it('copy the old bake in once, stamped imported, with its speed; Blender never runs', async () => {
    const data = fakeLibrary();
    const old = data.file('bakes/a2/n10.glb', 'old bake');
    data.file('bakes/a2/n10.glb.json', '{"speedMps":2.661}');
    const s = store(data);
    const e = await s.ensure({ asset: 2, animation: 10 });
    expect(runs()).toHaveLength(0);
    expect(e.sidecar).toMatchObject({ source: 'imported', importedFrom: old, speedMps: 2.661, clip: 'n10', inputs: { worker: IMPORTED, blender: IMPORTED } });
    expect(fs.readFileSync(e.glb, 'utf8')).toBe('old bake');
    expect(s.imported).toBe(1);
    // Found in the store the next time, not copied again.
    expect(store(data).find({ asset: 2, animation: 10 })!.key).toBe(e.key);
    expect(s.imported).toBe(1);
    // A pair the old generator never baked is not imported.
    expect(s.find(HERO_WALK)).toBeNull();
  });
  it('a bake of our own for the current Blender wins over the import; import: false bakes', async () => {
    const data = fakeLibrary();
    data.file('bakes/a1/n10.glb', 'old bake');
    const own = await store(data, { import: false }).ensure(HERO_WALK);
    expect(own.sidecar.source).toBe('blender');
    expect(store(data).find(HERO_WALK)!.key).toBe(own.key);
  });
});

describe('one bake per key, one Blender at a time', () => {
  it('concurrent requests in one process share one run', async () => {
    const data = fakeLibrary();
    const s = store(data);
    const all = await Promise.all([s.ensure(HERO_WALK), s.ensure(HERO_WALK), s.ensure(HERO_WALK)]);
    expect(new Set(all.map((e) => e.key)).size).toBe(1);
    expect(runs()).toHaveLength(1);
  });
  it('two stores on one dir (two builds) bake a clip once: the second waits on the lock and finds it', async () => {
    const data = fakeLibrary();
    const waits: string[] = [];
    const a = store(data), b = store(data, { log: (m) => waits.push(m) });
    const [x, y] = await Promise.all([a.ensure(HERO_WALK), b.ensure(HERO_WALK)]);
    expect(x.key).toBe(y.key);
    expect(runs()).toHaveLength(1);
    expect(waits.join('\n')).toMatch(/being baked by another process|waiting for another Blender/);
  });
  it('different clips never overlap: one queue in a process, the .blender.lock across stores', async () => {
    const data = fakeLibrary();
    const s = store(data);
    const other = store(data);
    await Promise.all([s.ensure(HERO_WALK), s.ensure({ asset: 2, animation: 10 }), other.ensure({ ...HERO_WALK, rootMotion: true }), other.ensure({ asset: 2, animation: 10, rootMotion: true })]);
    const r = runs().sort((p, q) => p.start - q.start);
    expect(r).toHaveLength(4);
    for (let i = 1; i < r.length; i++) expect(r[i]!.start).toBeGreaterThanOrEqual(r[i - 1]!.end);
  });
  it('the queue runs jobs in order, one at a time', async () => {
    const q = new BlenderQueue(BLENDER_A, WORKER_DIR);
    const tmp = fs.mkdtempSync(path.join(root, 'q-'));
    const res = await Promise.all([1, 2, 3].map((i) => q.run({ script: 'retarget.py', args: { source: 's', target: 't', out_glb: path.join(tmp, `${i}.glb`), clip_name: `c${i}`, in_place: true } })));
    expect(res.map((x) => x.code)).toEqual([0, 0, 0]);
    expect(q.started).toBe(3);
    const r = runs();
    expect(r.map((x) => x.clip)).toEqual(['c1', 'c2', 'c3']);
    for (let i = 1; i < r.length; i++) expect(r[i]!.start).toBeGreaterThanOrEqual(r[i - 1]!.end);
  });
});

describe('refusals and failures', () => {
  it('only characters, only clips with a rig, unknown ids', async () => {
    const data = fakeLibrary();
    const s = store(data);
    await expect(s.ensure({ asset: 3, animation: 10 })).rejects.toMatchObject({ code: 'not-character', message: expect.stringMatching(/SM_Prop_Crate is a prop/) });
    await expect(s.ensure({ asset: 1, animation: 12 })).rejects.toMatchObject({ code: 'no-rig' });
    await expect(s.ensure({ asset: 99, animation: 10 })).rejects.toBeInstanceOf(BakeError);
    expect(runs()).toHaveLength(0);
  });
  it('a failed bake names the clip, the model and Blender\'s error, and leaves nothing behind', async () => {
    const data = fakeLibrary();
    const s = store(data);
    await expect(s.ensure({ asset: 1, animation: 11 })).rejects.toMatchObject({ code: 'failed', message: expect.stringMatching(/A\/Run_F \(#11\) onto P\/Character_Hero \(#1\) failed: Error: boom/) });
    expect(fs.readdirSync(path.join(data.dir, 'store/a1/n11'))).toEqual([]);
    expect(s.find({ asset: 1, animation: 11 })).toBeNull();
  });
  it('without Blender: imports and earlier bakes are still found, a missing clip is refused with the fix', async () => {
    const data = fakeLibrary();
    const baked = await store(data).ensure(HERO_WALK);
    const none = store(data, { blender: path.join(root, 'no-such-blender') });
    expect(none.blenderVersion()).toBeNull();
    expect(none.find(HERO_WALK)!.key).toBe(baked.key);
    await expect(none.ensure({ asset: 2, animation: 10 })).rejects.toMatchObject({ code: 'no-blender', message: expect.stringMatching(/SLOP_BLENDER/) });
  });
});

describe('locks', () => {
  it('a lock whose owner died is taken over', async () => {
    const dir = path.join(root, 'locks/dead.lock');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), at: Date.now() }));
    expect(tryLock(dir)).toBe(false);
    expect(await withLock(dir, async () => 'mine', { pollMs: 10 })).toBe('mine');
    expect(fs.existsSync(dir)).toBe(false);
  });
  it('a held lock is waited for, then taken', async () => {
    const dir = path.join(root, 'locks/held.lock');
    expect(tryLock(dir)).toBe(true);
    let waited = false;
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 100);
    expect(await withLock(dir, async () => 'after', { pollMs: 10, onWait: () => (waited = true) })).toBe('after');
    expect(waited).toBe(true);
  });
});

it('parseTagged reads the worker\'s result lines', () => {
  expect(parseTagged('RETARGET_OK {"clip":"n1","speed_mps":1.2}')).toEqual({ tag: 'RETARGET_OK', data: { clip: 'n1', speed_mps: 1.2 } });
  expect(parseTagged('INGEST_FAIL {"error":"x"}')?.tag).toBe('INGEST_FAIL');
  expect(parseTagged('Blender 4.0.2 (hash) quit')).toBeNull();
  expect(parseTagged('RETARGET_OK {broken')).toBeNull();
});
