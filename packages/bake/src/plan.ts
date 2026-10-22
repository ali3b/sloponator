/**
 * Bakes before the render: every skeletal clip a build's sprites will play — their own sets and their uniform-frame
 * siblings' (the page measures those too, and quietly skips a clip it cannot load, which would change the frame) —
 * resolved the way the render page resolves it (clips.ts), looked up in the store (imports included), and the
 * missing ones baked one at a time before Chromium starts. Blender is CPU work and the render needs the shared GPU;
 * the two never run together.
 */
import path from 'node:path';
import { animationDto, assetDto, type AnimationDto, type Library } from '@slop/library';
import type { BatchSpec, SetItem } from '@slop/sprites';
import { resolveSetItem } from './clips.js';
import { BakeStore, type BakeEntry, type BakeRequest, type BakeStoreOptions } from './store.js';

/** One sprite render as the build plans it: the asset and its batch. */
export interface BakeJob {
  asset: number;
  spec: BatchSpec;
  /** For messages (the sprite's name). */
  name?: string;
}

export interface NeededClip {
  req: BakeRequest;
  asset: { id: number; pack: string; name: string };
  animation: { id: number; pack: string; name: string };
  /** Sprites that play it. */
  sprites: string[];
}

const urls = { glb: () => null, thumb: () => null };

/** Every (character, clip) pair the jobs' pages will ask `/slop/bake` for, once each, in plan order. */
export function neededClips(jobs: BakeJob[], lib: Library, anims?: AnimationDto[]): NeededClip[] {
  const list = anims ?? lib.animations({ limit: 20000 }).map(animationDto);
  const out = new Map<string, NeededClip>();
  for (const job of jobs) {
    const entry = lib.asset(job.asset);
    if (!entry || entry.kind !== 'character') continue; // the page plays skeletal clips on characters only
    const asset = assetDto(entry, urls);
    const items: SetItem[] = [job.spec.set, ...(job.spec.uniformWith ?? []).map((u) => u.set)].flatMap((s) => s.items);
    for (const item of items) {
      const anim = resolveSetItem(item, list, asset, job.spec.gender);
      if (!anim) continue;
      // The page asks for the in-place bake (api.bake's default).
      const k = `${asset.id}/${anim.id}`;
      const have = out.get(k);
      const sprite = job.name ?? `#${job.asset}`;
      if (have) {
        if (!have.sprites.includes(sprite)) have.sprites.push(sprite);
        continue;
      }
      out.set(k, { req: { asset: asset.id, animation: anim.id, rootMotion: false }, asset: { id: asset.id, pack: asset.pack, name: asset.name }, animation: { id: anim.id, pack: anim.pack, name: anim.name }, sprites: [sprite] });
    }
  }
  return [...out.values()];
}

export interface BakeSummary {
  store: BakeStore;
  /** `Blender 4.0.2`, null when not installed. */
  blender: string | null;
  needed: number;
  /** Already in the store (own bakes and earlier imports). */
  present: number;
  /** Copied in from the old generator's data/bakes during this call. */
  imported: number;
  baked: { clip: NeededClip; entry: BakeEntry; ms: number }[];
  failed: { clip: NeededClip; error: string }[];
  ms: number;
}

export interface BakeForBuildOptions extends Partial<Omit<BakeStoreOptions, 'lib'>> {
  lib: Library;
  /** A store already open; else one on `dir` (default $SLOP_CACHE_DIR/bakes). */
  store?: BakeStore;
  /** The build's cache dir: the store goes in `<cacheDir>/bakes` unless `dir` says otherwise. */
  cacheDir?: string;
  log?: (m: string) => void;
}

/** Bake everything the jobs need that the store does not have yet; never throws for one clip (see `failed`). */
export async function bakeForBuild(jobs: BakeJob[], opts: BakeForBuildOptions): Promise<BakeSummary> {
  const t0 = performance.now();
  const log = opts.log ?? (() => undefined);
  const store = opts.store ?? new BakeStore({ ...opts, dir: opts.dir ?? (opts.cacheDir ? path.join(opts.cacheDir, 'bakes') : undefined), log });
  const importedBefore = store.imported;
  const clips = neededClips(jobs, opts.lib);
  const missing: NeededClip[] = [];
  const failed: BakeSummary['failed'] = [];
  let found = 0;
  for (const c of clips) {
    try {
      if (store.find(c.req)) found++;
      else missing.push(c);
    } catch (e) {
      failed.push({ clip: c, error: (e as Error).message });
    }
  }
  const imported = store.imported - importedBefore;
  if (imported) log(`bakes: ${imported} clip${imported === 1 ? '' : 's'} imported from the old generator's data/bakes into ${store.dir}`);
  const blender = store.blenderVersion();
  const baked: BakeSummary['baked'] = [];
  if (missing.length && !blender) {
    log(`bakes: ${missing.length} clip${missing.length === 1 ? '' : 's'} not baked yet and Blender is not installed ("${store.blender}"; set SLOP_BLENDER): ${missing.map((c) => `${c.animation.name} on ${c.asset.name}`).join(', ')}`);
    for (const c of missing) failed.push({ clip: c, error: `not baked, and Blender is not installed` });
  } else if (missing.length) {
    let i = 0;
    for (const c of missing) {
      i++;
      log(`baking ${missing.length} clip${missing.length === 1 ? '' : 's'} with ${blender}: ${i}/${missing.length} ${c.animation.name} on ${c.asset.name} (${c.sprites.join(', ')}) …`);
      const t = performance.now();
      try {
        const entry = await store.ensure(c.req);
        const ms = Math.round(performance.now() - t);
        baked.push({ clip: c, entry, ms });
        log(`  baked ${c.animation.name} on ${c.asset.name} in ${(ms / 1000).toFixed(1)} s`);
      } catch (e) {
        failed.push({ clip: c, error: (e as Error).message });
        log(`  bake failed: ${(e as Error).message}`);
      }
    }
  }
  return { store, blender, needed: clips.length, present: found - imported, imported, baked, failed, ms: Math.round(performance.now() - t0) };
}
