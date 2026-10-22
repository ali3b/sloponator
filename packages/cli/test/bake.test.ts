/**
 * `slop build` bakes the clips it plans before the browser starts (@slop/bake, ali3b/sloponator#69): a tiny
 * ssg.assets.json playing Walk_F on POLYGON_War/Character_FactoryGirl_01 — a character the old generator never baked
 * anything onto, so the clip exists only once Blender has run. No golden exists for it; the test checks the bake line,
 * the store entry, the sheet's frame count and size, and that a forced second build (every frame rendered again) is
 * byte-identical. One Blender run (about 1–2 s) and two SwiftShader renders. Skipped with a message without the old
 * data dir or Blender.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { openLibrary } from '@slop/library';
import { blenderVersion, defaultBlender, type BakeSidecar } from '@slop/bake';
import { build } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));
const blender = blenderVersion(defaultBlender());
if (!haveData) console.warn(`bake.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);
else if (!blender) console.warn(`bake.test.ts: skipped, Blender is not installed ("${defaultBlender()}"; set SLOP_BLENDER)`);

/** Under test-results (git-ignored); a fresh cache each run, so the bake really runs. */
const WORK = path.join(ROOT, 'test-results/bake-build');

const files = (dir: string) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f))]));

describe.skipIf(!haveData || !blender)('slop build with a clip that needs a bake', () => {
  const lib = haveData ? openLibrary({ dataDir: DATA_DIR }) : null!;
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const file = path.join(WORK, 'ssg.assets.json');
  fs.writeFileSync(file, JSON.stringify({
    project: 'bake test',
    defaults: { view: 'side2', look: 'clean', size: 'small', format: 'generic', fps: 8 },
    sprites: [{ name: 'factory_girl', asset: 'POLYGON_War/Character_FactoryGirl_01', anim: ['Walk_F'] }],
  }, null, 2));
  const cacheDir = path.join(WORK, 'cache');
  afterAll(() => lib?.close());

  it(`bakes Walk_F with ${blender} before the render, then builds the same bytes twice`, async () => {
    const girl = lib.asset('POLYGON_War/Character_FactoryGirl_01')!;
    expect(fs.existsSync(path.join(DATA_DIR, 'bakes', `a${girl.id}`)), 'the old generator baked nothing on her').toBe(false);

    const log: string[] = [];
    const first = await build({ file, out: path.join(WORK, 'out1'), gpu: 'software', cacheDir, lib, log: (m) => log.push(m) });
    expect(first.ok, first.sprites.map((s) => s.error).join('; ')).toBe(true);
    // The bake ran, said so, and before the browser started.
    const bakeLine = log.findIndex((m) => m.startsWith(`baking 1 clip with ${blender}: 1/1 Walk_F on Character_FactoryGirl_01 (factory_girl)`));
    expect(bakeLine, log.join('\n')).toBeGreaterThanOrEqual(0);
    expect(log.findIndex((m) => m.startsWith('render runner:'))).toBeGreaterThan(bakeLine);
    // The store entry, its key written out.
    const pair = fs.readdirSync(path.join(cacheDir, 'bakes', `a${girl.id}`));
    expect(pair).toHaveLength(1);
    const keys = fs.readdirSync(path.join(cacheDir, 'bakes', `a${girl.id}`, pair[0]!)).filter((k) => !k.startsWith('.'));
    expect(keys).toHaveLength(1);
    const sidecar = JSON.parse(fs.readFileSync(path.join(cacheDir, 'bakes', `a${girl.id}`, pair[0]!, keys[0]!, 'clip.glb.json'), 'utf8')) as BakeSidecar;
    expect(sidecar).toMatchObject({ source: 'blender', animation: { name: 'Walk_F', gender: 'Feminine' }, inputs: { blender } });

    // The sheet: 1 clip × 2 directions (E, W) × 8 frames (Walk_F's 31/30 s at 8 fps), one page of 64-px-wide frames.
    const s = first.sprites[0]!;
    expect(s).toMatchObject({ clips: 1, directions: 2, frames: 16, cached: 0 });
    const meta = JSON.parse(fs.readFileSync(path.join(s.dir, 'Character_FactoryGirl_01.json'), 'utf8'));
    expect(meta.clips).toEqual([expect.objectContaining({ name: 'Walk_F', loop: true, frameCount: 8 })]);
    expect(meta.animations.map((a: { name: string; frames: unknown[] }) => [a.name, a.frames.length])).toEqual([['Walk_F_E', 8], ['Walk_F_W', 8]]);
    const png = PNG.sync.read(fs.readFileSync(path.join(s.dir, 'Character_FactoryGirl_01_0.png')));
    expect([png.width, png.height]).toEqual([meta.pages[0].width, meta.pages[0].height]);
    expect(png.width).toBeGreaterThanOrEqual(meta.frameWidth * 8);
    let opaque = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i]! > 0) opaque++;
    expect(opaque, 'the sheet shows her').toBeGreaterThan(1000);

    // Again, every frame rendered anew (--force), the bake from the store: the same bytes.
    const log2: string[] = [];
    const second = await build({ file, out: path.join(WORK, 'out2'), gpu: 'software', cacheDir, lib, force: true, log: (m) => log2.push(m) });
    expect(second.ok).toBe(true);
    expect(second.sprites[0]).toMatchObject({ frames: 16, cached: 0 });
    expect(log2.some((m) => m.startsWith('baking'))).toBe(false);
    expect(files(second.sprites[0]!.dir)).toEqual(files(s.dir));
  });
});
