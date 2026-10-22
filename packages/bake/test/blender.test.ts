/**
 * One real Blender bake (about 1–2 s): Walk_F (the Feminine POLYGON copy, the clip the page picks for her) onto
 * POLYGON_War/Character_FactoryGirl_01, a character the old generator never baked anything onto. The GLB must load
 * in three's GLTFLoader with the clip under its old name (`n<anim>`), keyed on her skeleton's bones; asking again
 * finds it without Blender. Skipped with a message without Blender or the old generator's data dir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openLibrary } from '@slop/library';
import { BakeStore, bakeClip, blenderVersion, defaultBlender } from '../src/index.js';

const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));
const blender = blenderVersion(defaultBlender());
if (!haveData) console.warn(`blender.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);
else if (!blender) console.warn(`blender.test.ts: skipped, Blender is not installed ("${defaultBlender()}"; set SLOP_BLENDER)`);

interface Gltf {
  animations: { name: string; duration: number; tracks: { name: string; times: Float32Array }[] }[];
  scene: { traverse(f: (o: { name: string; type: string }) => void): void };
}

describe.skipIf(!haveData || !blender)('a real bake with Blender', () => {
  const lib = haveData ? openLibrary({ dataDir: DATA_DIR }) : null!;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-bake-real-'));
  afterAll(() => {
    lib?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it(`bakes Walk_F onto Character_FactoryGirl_01 with ${blender}; three loads the clip; the second ask needs no Blender`, async () => {
    const girl = lib.asset('POLYGON_War/Character_FactoryGirl_01')!;
    const walk = lib.animations({ query: 'Walk_F', pack: 'ANIMATION_Base_Locomotion', rigKind: 'synty_legacy', gender: 'Feminine', rootMotion: false }).find((a) => a.name === 'Walk_F')!;
    expect(girl.kind).toBe('character');
    expect(walk.bakePath(girl.id), 'the old generator never baked this pair').toBeNull();
    expect(fs.existsSync(path.join(DATA_DIR, 'bakes', `a${girl.id}`)), 'nothing at all is baked on her').toBe(false);

    const store = new BakeStore({ lib, dir });
    const t0 = performance.now();
    const e = await bakeClip({ asset: girl.id, animation: walk.id, lib, store });
    const seconds = (performance.now() - t0) / 1000;
    console.log(`blender.test.ts: ${walk.name} on ${girl.name} baked in ${seconds.toFixed(1)} s with ${blender}`);
    expect(store.queue.started).toBe(1);
    expect(e.sidecar).toMatchObject({ source: 'blender', clip: `n${walk.id}`, inputs: { blender, rootMotion: false }, result: { source_rig: 'synty_legacy', target_rig: 'synty_legacy', frames: walk.frames } });

    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const bytes = fs.readFileSync(e.glb);
    const gltf = await new Promise<Gltf>((res, rej) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', res as never, rej));
    expect(gltf.animations.map((a) => a.name)).toEqual([`n${walk.id}`]);
    const clip = gltf.animations[0]!;
    expect(clip.duration).toBeCloseTo((walk.frames! - 1) / walk.fps!, 2);
    const nodes = new Set<string>();
    gltf.scene.traverse((o) => nodes.add(o.name));
    const rig = girl.rig()!.map;
    for (const bone of [rig.hips, rig.thigh_l, rig.upperarm_r]) expect(nodes.has(bone!), `${bone} is in the GLB`).toBe(true);
    const animated = new Set(clip.tracks.map((t) => t.name.split('.')[0]));
    expect(animated.has(rig.hips!)).toBe(true);
    expect(animated.size).toBeGreaterThanOrEqual(15);

    // Found again, by a new store on the same dir: no second Blender run.
    const again = new BakeStore({ lib, dir });
    expect((await again.ensure({ asset: girl.id, animation: walk.id })).key).toBe(e.key);
    expect(again.queue.started).toBe(0);
  });
});
