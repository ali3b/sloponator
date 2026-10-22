/**
 * The bake store: retargeted clips (a character's skeleton + one baked action, as GLB) owned by the Sloponator,
 * under `$SLOP_CACHE_DIR/bakes` (default `~/.cache/slop/bakes`). Ported from synty-sprite-generator
 * apps/server/src/bake.ts `ensureBake` (P2, ali3b/sloponator#69): the same worker arguments, the same clip name in
 * the GLB (`n<anim>` / `n<anim>_rm`), the same speed sidecar value, the same refusals (only characters, only clips
 * with a rig), concurrent requests for one clip sharing one Blender run (`inflight`). Changed here:
 *
 *   - **the key**: the old store was keyed by `a<asset>/n<anim>[_rm]` only, so a re-ingested model, a changed FBX, a
 *     worker fix or a new Blender kept the old bake forever. Here an entry is keyed by the hashes of everything the
 *     bake reads and the versions of what makes it: `{ store, assetGlbHash, assetFbxHash, animFbxHash, rootMotion,
 *     worker, blender }`, written out in the sidecar so the key is never a mystery;
 *   - **imports**: a bake the old generator already made (`data/bakes/a<asset>/n<anim>[_rm].glb` + `.glb.json`) is
 *     copied in once, stamped `source: 'imported'`, and used instead of baking again;
 *   - **locks**: a per-key lock directory other processes see (two builds never bake the same clip twice), and one
 *     Blender at a time on the machine (the `.blender.lock`, on top of this process's queue).
 *
 * Layout: `<dir>/a<asset>/n<anim>[_rm]/<key16>/clip.glb` + `clip.glb.json` (the sidecar). Entries are written to a
 * temp folder beside them and renamed into place, so a reader sees a whole entry or none.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AnimationEntry, AssetEntry, Library } from '@slop/library';
import { BlenderQueue, WORKER_DIR, blenderVersion, defaultBlender, parseTagged } from './blender.js';
import { withLock, type LockOptions } from './lock.js';

/** Bump when the entry format changes: every older entry stops matching. */
export const BAKE_STORE_VERSION = 1;

/** What `worker` and `blender` say in the key of an imported bake: the old generator made it, with whatever it ran. */
export const IMPORTED = 'old-generator';

export interface BakeRequest {
  asset: number;
  animation: number;
  /** Keep the hips' horizontal travel (`n<anim>_rm`); default false: in place, as sprites use. */
  rootMotion?: boolean;
}

/** Everything an entry's key hashes. Any change makes a different entry. */
export interface BakeKeyInputs {
  /** BAKE_STORE_VERSION. */
  store: number;
  /** SHA-256 of the character's ingested GLB (the model the clip plays on; its bone names must match). */
  assetGlbHash: string;
  /** SHA-256 of the character's FBX (what Blender reads as the target skeleton). */
  assetFbxHash: string;
  /** SHA-256 of the animation's FBX (what Blender reads as the source motion). */
  animFbxHash: string;
  rootMotion: boolean;
  /** workerVersion(): hash of retarget.py, its helpers, the rig profiles (built-in and user-confirmed); IMPORTED for imports. */
  worker: string;
  /** `Blender 4.0.2`; IMPORTED for imports. */
  blender: string;
}

/** clip.glb.json. */
export interface BakeSidecar {
  v: number;
  /** The full key (hex SHA-256 of the canonical inputs); the folder is named by its first 16 characters. */
  key: string;
  inputs: BakeKeyInputs;
  source: 'blender' | 'imported';
  asset: { id: number; pack: string; name: string };
  animation: { id: number; pack: string; name: string; gender: string | null; set: string | null };
  /** The action's name inside the GLB: `n<anim>` or `n<anim>_rm`. */
  clip: string;
  /** Ground speed of the original motion (m/s, target scale), as the worker reported it; null when unknown. */
  speedMps: number | null;
  /** When the entry was made (a bake) or copied in (an import). */
  at: string;
  /** Blender wall time (bakes). */
  ms?: number;
  /** The worker's RETARGET_OK data (rigs, frames, fps, hip scale). */
  result?: Record<string, unknown>;
  /** The old bake that was copied (imports). */
  importedFrom?: string;
}

export interface BakeEntry {
  key: string;
  dir: string;
  glb: string;
  sidecar: BakeSidecar;
  /** The clip's track name in the GLB. */
  clip: string;
  /** speedMps when it is a real ground speed (> 0.05 m/s), else null: what the page gets. */
  speed: number | null;
}

export type BakeErrorCode = 'not-found' | 'not-character' | 'no-rig' | 'no-file' | 'no-blender' | 'failed';

export class BakeError extends Error {
  constructor(message: string, readonly code: BakeErrorCode) {
    super(message);
  }
}

export interface BakeStoreOptions {
  lib: Library;
  /** Default: defaultBakeDir(). */
  dir?: string;
  /** The Blender binary (default $SLOP_BLENDER, $SSG_BLENDER or `blender`). */
  blender?: string;
  /** The worker scripts (default packages/bake/worker). */
  workerDir?: string;
  /** Copy the old generator's bakes in (default true; SLOP_BAKE_NO_IMPORT=1 turns it off). */
  import?: boolean;
  /** One Blender at a time: share a queue between stores in one process (default: one per store). */
  queue?: BlenderQueue;
  lock?: LockOptions;
  log?: (m: string) => void;
}

/** `$SLOP_CACHE_DIR/bakes`, else `~/.cache/slop/bakes`. */
export function defaultBakeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.SLOP_CACHE_DIR || path.join(os.homedir(), '.cache/slop'), 'bakes');
}

/** The clip name a bake carries: `n<anim>` in place, `n<anim>_rm` with root motion (the old clipName). */
export const clipName = (animId: number, rootMotion: boolean) => `n${animId}${rootMotion ? '_rm' : ''}`;

/** Canonical JSON (sorted keys) → hex SHA-256: the entry key. */
export function bakeKey(inputs: BakeKeyInputs): string {
  const sorted = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

const hashes = new Map<string, { sig: string; hash: string }>();

/** SHA-256 of a file, remembered per (path, size, mtime) for the life of the process; 'missing' when absent. */
export function fileHash(file: string | null): string {
  if (!file) return 'missing';
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return 'missing';
  }
  const sig = `${st.size}:${st.mtimeMs}`;
  const hit = hashes.get(file);
  if (hit?.sig === sig) return hit.hash;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  hashes.set(file, { sig, hash });
  return hash;
}

/**
 * The worker's identity: a hash over the files a retarget runs (retarget.py, synty/__init__.py, synty/rigs.py,
 * rigs/*.json) and the user-confirmed rig profiles it loads (`SSG_EXTRA_RIGS`, the old data dir's rigs/). Any edit
 * to them re-bakes; ingest.py, textures.py and roles.json are not read by a retarget and change nothing.
 */
export function workerVersion(workerDir: string = WORKER_DIR, extraRigs: string | null = null): string {
  const h = crypto.createHash('sha256');
  const add = (label: string, file: string) => h.update(`${label}\0`).update(fs.readFileSync(file)).update('\0');
  for (const f of ['retarget.py', 'synty/__init__.py', 'synty/rigs.py']) add(f, path.join(workerDir, f));
  const jsons = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort() : []);
  for (const f of jsons(path.join(workerDir, 'rigs'))) add(`rigs/${f}`, path.join(workerDir, 'rigs', f));
  if (extraRigs) for (const f of jsons(extraRigs)) add(`extra/${f}`, path.join(extraRigs, f));
  return h.digest('hex').slice(0, 16);
}

const realSpeed = (v: unknown) => (typeof v === 'number' && v > 0.05 ? v : null);

export class BakeStore {
  readonly dir: string;
  readonly lib: Library;
  readonly blender: string;
  readonly workerDir: string;
  readonly importOld: boolean;
  readonly queue: BlenderQueue;
  /** Old bakes copied in by this store (for the build's summary). */
  imported = 0;
  private readonly log: (m: string) => void;
  private readonly lockOpts: LockOptions;
  private readonly inflight = new Map<string, Promise<BakeEntry>>();
  private worker: string | undefined;

  constructor(opts: BakeStoreOptions) {
    this.lib = opts.lib;
    this.dir = path.resolve(opts.dir ?? defaultBakeDir());
    this.blender = opts.blender ?? defaultBlender();
    this.workerDir = opts.workerDir ?? WORKER_DIR;
    this.importOld = opts.import ?? process.env.SLOP_BAKE_NO_IMPORT !== '1';
    this.queue = opts.queue ?? new BlenderQueue(this.blender, this.workerDir);
    this.lockOpts = opts.lock ?? {};
    this.log = opts.log ?? (() => undefined);
  }

  /** `Blender 4.0.2`, or null when it is not installed. */
  blenderVersion(): string | null {
    return blenderVersion(this.blender);
  }

  /** The user-confirmed rig profiles of the old generator (passed to Blender as SSG_EXTRA_RIGS, as the old server did). */
  get extraRigs(): string {
    return path.join(this.lib.dataDir, 'rigs');
  }

  workerVersion(): string {
    return (this.worker ??= workerVersion(this.workerDir, this.extraRigs));
  }

  pairDir(req: BakeRequest): string {
    return path.join(this.dir, `a${req.asset}`, clipName(req.animation, !!req.rootMotion));
  }

  private records(req: BakeRequest): { asset: AssetEntry; anim: AnimationEntry } {
    const asset = this.lib.asset(req.asset);
    const anim = this.lib.animation(req.animation);
    if (!asset || !anim) throw new BakeError(`no ${!asset ? `asset #${req.asset}` : `clip #${req.animation}`} in the library`, 'not-found');
    return { asset, anim };
  }

  /** The key inputs of a request as Blender `blender` (or IMPORTED) would bake it. */
  inputs(req: BakeRequest, blender: string): BakeKeyInputs {
    const { asset, anim } = this.records(req);
    return {
      store: BAKE_STORE_VERSION,
      assetGlbHash: fileHash(asset.glbPath()),
      assetFbxHash: fileHash(asset.fbxPath()),
      animFbxHash: fileHash(anim.fbxPath()),
      rootMotion: !!req.rootMotion,
      worker: blender === IMPORTED ? IMPORTED : this.workerVersion(),
      blender,
    };
  }

  /** The entry of a key in a pair's folder, when it is whole. */
  private read(req: BakeRequest, key: string): BakeEntry | null {
    const dir = path.join(this.pairDir(req), key.slice(0, 16));
    const glb = path.join(dir, 'clip.glb');
    let sidecar: BakeSidecar;
    try {
      sidecar = JSON.parse(fs.readFileSync(`${glb}.json`, 'utf8')) as BakeSidecar;
    } catch {
      return null;
    }
    if (sidecar.key !== key || sidecar.v !== BAKE_STORE_VERSION || !fs.existsSync(glb)) return null;
    return { key, dir, glb, sidecar, clip: sidecar.clip, speed: realSpeed(sidecar.speedMps) };
  }

  /** Move a finished temp folder into place; when another process got there first, theirs is kept. */
  private commit(req: BakeRequest, tmp: string, key: string): BakeEntry {
    const dest = path.join(this.pairDir(req), key.slice(0, 16));
    try {
      fs.renameSync(tmp, dest);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (!['EEXIST', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
    }
    const entry = this.read(req, key);
    if (!entry) throw new BakeError(`the bake store entry ${dest} is not whole after writing it`, 'failed');
    return entry;
  }

  private tempDir(req: BakeRequest, key: string): string {
    fs.mkdirSync(this.pairDir(req), { recursive: true });
    return fs.mkdtempSync(path.join(this.pairDir(req), `.${key.slice(0, 16)}.tmp-${process.pid}-`));
  }

  /** Copy the old generator's bake of this pair in (once), stamped `source: 'imported'`. */
  private importOldBake(req: BakeRequest): BakeEntry | null {
    const { asset, anim } = this.records(req);
    const old = anim.bakePath(req.asset, { inPlace: !req.rootMotion });
    if (!old) return null;
    const inputs = this.inputs(req, IMPORTED);
    const key = bakeKey(inputs);
    let speedMps: number | null = null;
    try {
      const v = (JSON.parse(fs.readFileSync(`${old}.json`, 'utf8')) as { speedMps?: unknown }).speedMps;
      speedMps = typeof v === 'number' ? v : null;
    } catch {
      speedMps = null;
    }
    const tmp = this.tempDir(req, key);
    fs.copyFileSync(old, path.join(tmp, 'clip.glb'));
    const sidecar: BakeSidecar = {
      v: BAKE_STORE_VERSION, key, inputs, source: 'imported',
      asset: { id: asset.id, pack: asset.pack, name: asset.name },
      animation: { id: anim.id, pack: anim.pack, name: anim.name, gender: anim.gender, set: anim.set },
      clip: clipName(anim.id, !!req.rootMotion), speedMps, at: new Date().toISOString(), importedFrom: old,
    };
    fs.writeFileSync(path.join(tmp, 'clip.glb.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
    const entry = this.commit(req, tmp, key);
    this.imported++;
    return entry;
  }

  /**
   * The bake of a pair, without running Blender:
   *   1. this store's bake for the current inputs and the installed Blender;
   *   2. the old generator's bake, imported earlier or copied in now;
   *   3. with no Blender installed, this store's newest bake for the same inputs by any Blender.
   * Null when none: `ensure` bakes it.
   */
  find(req: BakeRequest): BakeEntry | null {
    const blender = this.blenderVersion();
    if (blender) {
      const own = this.read(req, bakeKey(this.inputs(req, blender)));
      if (own) return own;
    }
    if (this.importOld) {
      const imp = this.read(req, bakeKey(this.inputs(req, IMPORTED))) ?? this.importOldBake(req);
      if (imp) return imp;
    }
    if (!blender) return this.anyBlender(req);
    return null;
  }

  private anyBlender(req: BakeRequest): BakeEntry | null {
    const dir = this.pairDir(req);
    if (!fs.existsSync(dir)) return null;
    const want = this.inputs(req, 'any');
    const hits: BakeEntry[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      let sc: BakeSidecar;
      try {
        sc = JSON.parse(fs.readFileSync(path.join(dir, name, 'clip.glb.json'), 'utf8')) as BakeSidecar;
      } catch {
        continue;
      }
      const same = sc.source === 'blender' && (['assetGlbHash', 'assetFbxHash', 'animFbxHash', 'rootMotion', 'worker', 'store'] as const).every((k) => sc.inputs?.[k] === want[k]);
      const e = same ? this.read(req, sc.key) : null;
      if (e) hits.push(e);
    }
    return hits.sort((a, b) => b.sidecar.at.localeCompare(a.sidecar.at))[0] ?? null;
  }

  /** The bake of a pair: found (or imported), else baked with Blender now. Concurrent calls share one run. */
  ensure(req: BakeRequest): Promise<BakeEntry> {
    try {
      const hit = this.find(req);
      if (hit) return Promise.resolve(hit);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.bake(req);
  }

  /** Bake with Blender, whatever the store has (the same entry if a concurrent bake of this key finished first). */
  bake(req: BakeRequest): Promise<BakeEntry> {
    let key: string, inputs: BakeKeyInputs, asset: AssetEntry, anim: AnimationEntry;
    try {
      ({ asset, anim } = this.records(req));
      if (asset.kind !== 'character') throw new BakeError(`${asset.pack}/${asset.name} is a ${asset.kind}: only characters take skeletal clips`, 'not-character');
      if (!anim.rig) throw new BakeError(`${anim.pack}/${anim.name} (#${anim.id}) has no recognised rig: it needs a bone mapping first`, 'no-rig');
      for (const [what, f] of [['the character', asset.fbxPath()], ['the clip', anim.fbxPath()]] as const) {
        if (!fs.existsSync(f)) throw new BakeError(`the FBX of ${what} is not on disk (${f}): its pack folder was moved or removed`, 'no-file');
      }
      const blender = this.blenderVersion();
      if (!blender) throw new BakeError(`${anim.name} on ${asset.name} is not baked and Blender is not installed ("${this.blender}" does not run; install Blender or set SLOP_BLENDER)`, 'no-blender');
      inputs = this.inputs(req, blender);
      key = bakeKey(inputs);
    } catch (e) {
      return Promise.reject(e);
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const p = withLock(path.join(this.pairDir(req), `.${key.slice(0, 16)}.lock`), async () => {
      // Another process may have baked it while we waited for the lock.
      const done = this.read(req, key);
      if (done) return done;
      return withLock(path.join(this.dir, '.blender.lock'), () => this.runBake(req, asset, anim, inputs, key), { ...this.lockOpts, onWait: () => this.log('bake: waiting for another Blender on this machine to finish') });
    }, { ...this.lockOpts, onWait: () => this.log(`bake: ${anim.name} on ${asset.name} is being baked by another process; waiting for it`) }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async runBake(req: BakeRequest, asset: AssetEntry, anim: AnimationEntry, inputs: BakeKeyInputs, key: string): Promise<BakeEntry> {
    const tmp = this.tempDir(req, key);
    const out = path.join(tmp, 'clip.glb');
    const clip = clipName(anim.id, !!req.rootMotion);
    const res = await this.queue.run({
      script: 'retarget.py',
      args: { source: anim.fbxPath(), target: asset.fbxPath(), out_glb: out, clip_name: clip, in_place: !req.rootMotion },
      env: { SSG_EXTRA_RIGS: this.extraRigs },
    });
    const ok = res.lines.map(parseTagged).find((t) => t?.tag === 'RETARGET_OK');
    if (!ok || !fs.existsSync(out)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      const why = res.stderr.split('\n').filter((l) => /Error|error:/.test(l)).slice(-3).join(' ') || `Blender exited with code ${res.code}`;
      throw new BakeError(`baking ${anim.pack}/${anim.name} (#${anim.id}) onto ${asset.pack}/${asset.name} (#${asset.id}) failed: ${why}`, 'failed');
    }
    const sidecar: BakeSidecar = {
      v: BAKE_STORE_VERSION, key, inputs, source: 'blender',
      asset: { id: asset.id, pack: asset.pack, name: asset.name },
      animation: { id: anim.id, pack: anim.pack, name: anim.name, gender: anim.gender, set: anim.set },
      clip, speedMps: typeof ok.data.speed_mps === 'number' ? ok.data.speed_mps : null, at: new Date().toISOString(), ms: res.ms, result: ok.data,
    };
    fs.writeFileSync(`${out}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
    return this.commit(req, tmp, key);
  }
}

export interface BakeClipOptions {
  /** Asset id or `Pack/Name`. */
  asset: number | string;
  /** Clip id or name (the library's `animation(ref)`). */
  animation: number | string;
  rootMotion?: boolean;
  lib: Library;
  /** Default: a store on defaultBakeDir(). */
  store?: BakeStore;
}

/** Bake one clip onto one character (or find it in the store): the entry with its GLB path. */
export async function bakeClip(opts: BakeClipOptions): Promise<BakeEntry> {
  const asset = opts.lib.asset(opts.asset);
  const anim = opts.lib.animation(opts.animation);
  if (!asset || !anim) throw new BakeError(`no ${!asset ? `asset ${opts.asset}` : `clip ${opts.animation}`} in the library`, 'not-found');
  const store = opts.store ?? new BakeStore({ lib: opts.lib });
  return store.ensure({ asset: asset.id, animation: anim.id, rootMotion: !!opts.rootMotion });
}
