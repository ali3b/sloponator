/**
 * The runner's bake seam (ali3b/sloponator#69): `/slop/bake/:asset/:anim` answers from a @slop/bake store, falling
 * back to importing the old generator's bake, and a clip in neither is a 409 that names it and says the build bakes
 * before the render. The runner never runs Blender (the store here has none). Skipped without the old data dir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openLibrary } from '@slop/library';
import { BakeStore } from '@slop/bake';
import { dataHandler } from '../src/index.js';

const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));
if (!haveData) console.warn(`bakes.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);

describe.skipIf(!haveData)('/slop/bake answers from the bake store', () => {
  const lib = haveData ? openLibrary({ dataDir: DATA_DIR }) : null!;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-runner-bakes-'));
  afterAll(() => {
    lib?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  // No Blender: the runner only looks clips up.
  const store = haveData ? new BakeStore({ lib, dir, blender: path.join(dir, 'no-blender') }) : null!;
  const data = haveData ? dataHandler(lib, { bakes: store }) : null!;
  const json = (p: string) => {
    const r = data(p, new URLSearchParams());
    return { status: r.status, body: JSON.parse(String(r.body)) as Record<string, unknown> };
  };

  it('an old bake is imported into the store and served from there; a clip never baked is a 409 with the fix', () => {
    const joe = lib.asset('POLYGON_War/Character_GentleMan_01')!;
    const anims = lib.animations({ limit: 20000 });
    const baked = anims.find((a) => a.bakePath(joe.id))!;
    const r = json(`/slop/bake/${joe.id}/${baked.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ url: `/slop/bakes/${joe.id}/${baked.id}`, clip: `n${baked.id}`, speed: baked.bakeSpeed(joe.id) });
    const entry = store.find({ asset: joe.id, animation: baked.id })!;
    expect(entry.sidecar.source).toBe('imported');
    expect(entry.glb.startsWith(dir)).toBe(true);
    const glb = data(`/slop/bakes/${joe.id}/${baked.id}`, new URLSearchParams());
    expect(Buffer.compare(Buffer.from(glb.body), fs.readFileSync(baked.bakePath(joe.id)!))).toBe(0);

    const unbaked = anims.find((a) => a.rig && !a.bakePath(joe.id))!;
    const miss = json(`/slop/bake/${joe.id}/${unbaked.id}`);
    expect(miss.status).toBe(409);
    expect(String(miss.body.error)).toContain(unbaked.name);
    expect(String(miss.body.error)).toContain('Character_GentleMan_01');
    expect(String(miss.body.error)).toMatch(/slop build bakes .* with Blender before the render/);
    expect(store.queue.started).toBe(0);
  });
});
