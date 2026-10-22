/**
 * The render runner: one Chromium per build, launched here (no server, no Vite), loading the pinned render bundle
 * from a made-up origin that only this browser knows and whose every request this process answers (`page.route`):
 * the bundle's files, and the data the page asks for — assets, GLBs, baked clips, FX textures — straight from
 * @slop/library. Spike 1 (docs/spikes/SPIKE-1-render.md) proved the page needs no server; this is the forwarder it
 * used, replaced by in-process handlers.
 *
 * Around each render it runs the frame cache: the page sends the key inputs of every clip × direction, the runner
 * adds the renderer id (backend + bundle hash), looks the keys up in the store and answers with the cached per-frame
 * data; rendered units come back as PNG strips and are stored for the next build. What comes out is everything
 * @slop/sprites needs to pack a sheet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { assetDto, animationDto, type Library } from '@slop/library';
import { BakeStore, type BakeRequest } from '@slop/bake';
import { frameUnitKey, frameUnitDigests, FRAME_CACHE_VERSION, type CachedFrame, type FrameSource, type FrameUnitKeyInput, type FrameProgress, type RenderBackend, type RendererId } from '@slop/sprites';
import { backendOf, chromiumLaunch, type GpuChoice, type ChromiumLaunch } from './browser.js';
import { defaultCacheDir, ensureBundle, type BundleInfo } from './bundle.js';
import { FrameStore, type FrameEntry } from './frameStore.js';
import { stripFrames } from './strips.js';
import type { RenderJob, RenderOutput, RenderedUnit } from './protocol.js';

/** The page's origin: a name, not a server. */
export const ORIGIN = 'http://slop.render';

export interface RunnerOptions {
  lib: Library;
  /** `auto` (the GPU when a driver is found, else software), `nvidia`, `egl`, `software`. */
  gpu?: GpuChoice;
  /** $SLOP_CACHE_DIR or ~/.cache/slop: holds `bundles/` and `frames/`. */
  cacheDir?: string;
  /** Progress and diagnostics (stderr). */
  log?: (m: string) => void;
  /** Rebuild the bundle even when the cache has it. */
  rebuildBundle?: boolean;
  /**
   * Where `/slop/bake` finds baked clips: the bake store `slop build` filled before starting the runner (default: a
   * @slop/bake store on `<cacheDir>/bakes`). The runner only looks clips up (and imports the old generator's): it
   * never starts Blender, which must not run beside the render.
   */
  bakes?: BakeFinder;
}

/** The bake lookup the runner needs (a @slop/bake BakeStore). */
export interface BakeFinder {
  find(req: BakeRequest): FoundBake | null;
}

/** A baked clip: its GLB, its track name, its ground speed (m/s, null when none). */
export interface FoundBake {
  glb: string;
  clip: string;
  speed: number | null;
}

/** Without a bake store: the old generator's bakes, read in place (the library's bakePath), as before @slop/bake. */
function oldBakes(lib: Library): BakeFinder {
  return {
    find: (req) => {
      const anim = lib.animation(req.animation);
      const inPlace = !req.rootMotion;
      const glb = anim?.bakePath(req.asset, { inPlace });
      if (!anim || !glb) return null;
      const clip = `n${anim.id}${inPlace ? '' : '_rm'}`;
      return { glb, clip, speed: anim.bakeSpeed(req.asset, { inPlace }) };
    },
  };
}

export interface RenderHooks {
  onProgress?: (message: string, frames?: FrameProgress) => void;
}

/** A unit's pixels as the packer needs them: decoded frames per strip name (`body.png`, `body.normal.png`). */
export interface UnitFrames {
  key: string;
  cached: boolean;
  frames: Record<string, FrameSource[]>;
}

export interface RenderResult {
  output: RenderOutput;
  /** By unit id (`${clip}\n${direction}`). */
  units: Map<string, UnitFrames>;
  renderer: RendererId;
  /** Wall time of the page's render call, ms. */
  ms: number;
}

export interface Runner {
  readonly bundle: BundleInfo;
  readonly renderer: RendererId;
  readonly backend: RenderBackend;
  /** The WebGL renderer string the page reports (SwiftShader, or the GPU). */
  readonly glRenderer: string;
  readonly launch: ChromiumLaunch;
  readonly store: FrameStore;
  render(job: RenderJob, hooks?: RenderHooks): Promise<RenderResult>;
  close(): Promise<void>;
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };

/** FX particle sprites of the POLYGON Particle FX pack (apps/server/src/main.ts FX_SPRITES). */
const FX_SPRITES: Record<string, string> = { glow: 'Soft_Spot', puff: 'Smoke_01', spark: 'Sparkle', ring: 'Ring_02', flame: 'Fumes_02', disc: 'Circle_01', streak: 'BulletTrail' };

function findFile(dir: string, lowerName: string): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, lowerName);
      if (r) return r;
    } else if (e.name.toLowerCase() === lowerName) return p;
  }
  return null;
}

/**
 * The data the page asks for, answered from the library (and baked clips from `bakes`; default: the old generator's
 * bakes in place). Exported for tests (no browser needed).
 */
export function dataHandler(lib: Library, opts: { bakes?: BakeFinder } = {}): (pathname: string, search: URLSearchParams) => { status: number; type: string; body: Buffer | string } {
  const bakes = opts.bakes ?? oldBakes(lib);
  const urls = { glb: (e: { id: number; glb: string | null }) => (e.glb ? `/slop/glb/${e.id}` : null), thumb: () => null };
  const json = (v: unknown) => ({ status: 200, type: 'application/json', body: JSON.stringify(v) });
  const missing = (m: string) => ({ status: 404, type: 'application/json', body: JSON.stringify({ error: m }) });
  let fxDir: string | null | undefined;
  return (pathname, search) => {
    let m: RegExpMatchArray | null;
    if (pathname === '/slop/animations') return json(lib.animations({ limit: 20000 }).map(animationDto));
    if ((m = pathname.match(/^\/slop\/assets\/(\d+)$/))) {
      const a = lib.asset(Number(m[1]));
      return a ? json(assetDto(a, urls)) : missing(`no asset #${m[1]} in the library`);
    }
    if ((m = pathname.match(/^\/slop\/glb\/(\d+)$/))) {
      const f = lib.asset(Number(m[1]))?.glbPath();
      return f ? { status: 200, type: MIME['.glb']!, body: fs.readFileSync(f) } : missing(`asset #${m[1]} has no GLB on disk`);
    }
    if ((m = pathname.match(/^\/slop\/bake\/(\d+)\/(\d+)$/))) {
      const assetId = Number(m[1]), animId = Number(m[2]);
      const inPlace = search.get('rm') !== '1';
      const anim = lib.animation(animId);
      const asset = lib.asset(assetId);
      if (!anim || !asset) return missing(`no clip #${animId} or asset #${assetId}`);
      let found: FoundBake | null;
      try {
        found = bakes.find({ asset: assetId, animation: animId, rootMotion: !inPlace });
      } catch (e) {
        return { status: 500, type: 'application/json', body: JSON.stringify({ error: `bake store: ${(e as Error).message}` }) };
      }
      if (!found) return { status: 409, type: 'application/json', body: JSON.stringify({ error: `no bake of ${anim.pack}/${anim.name} (#${animId}) on ${asset.pack}/${asset.name} (#${assetId}) in the bake store: slop build bakes every clip it plans with Blender before the render starts (see the "bakes" lines it printed)` }) };
      return json({ url: `/slop/bakes/${assetId}/${animId}${inPlace ? '' : '?rm=1'}`, clip: found.clip, speed: found.speed });
    }
    if ((m = pathname.match(/^\/slop\/bakes\/(\d+)\/(\d+)$/))) {
      const f = bakes.find({ asset: Number(m[1]), animation: Number(m[2]), rootMotion: search.get('rm') === '1' })?.glb;
      return f ? { status: 200, type: MIME['.glb']!, body: fs.readFileSync(f) } : missing('no such bake');
    }
    if ((m = pathname.match(/^\/slop\/fx\/(\w+)$/))) {
      const file = FX_SPRITES[m[1]!];
      if (fxDir === undefined) {
        const pack = lib.pack('POLYGON_Particle_FX');
        fxDir = pack && pack.status === 'ready' && fs.existsSync(pack.dir) ? pack.dir : null;
      }
      const found = file && fxDir ? findFile(fxDir, `polygonparticles_${file}.png`.toLowerCase()) : null;
      return found ? { status: 200, type: 'image/png', body: fs.readFileSync(found) } : missing('not available');
    }
    return missing(`no such data: ${pathname}`);
  };
}

export async function startRunner(opts: RunnerOptions): Promise<Runner> {
  const log = opts.log ?? (() => undefined);
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const bundle = await ensureBundle({ cacheDir, force: opts.rebuildBundle, log });
  const store = new FrameStore(path.join(cacheDir, 'frames'));
  const launch = chromiumLaunch(opts.gpu ?? 'auto');
  const browser: Browser = await chromium.launch({ env: launch.env, args: launch.args });
  const data = dataHandler(opts.lib, { bakes: opts.bakes ?? new BakeStore({ lib: opts.lib, dir: path.join(cacheDir, 'bakes'), log }) });
  let page: Page;
  const pageErrors: string[] = [];
  // What the page's bridge functions dispatch to for the render in progress.
  let current: { emit(u: RenderedUnit): Promise<void>; lookup(units: { id: string; input: Omit<FrameUnitKeyInput, 'renderer'>; n: number }[]): Promise<(CachedFrame[] | null)[]>; progress(m: string, f?: FrameProgress): void } | null = null;
  try {
    page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    page.on('pageerror', (e) => {
      pageErrors.push(e.message);
      log(`page error: ${e.message}`);
    });
    if (process.env.SLOP_RENDER_DEBUG) page.on('response', (r) => void (r.status() >= 400 && log(`response ${r.status()} for ${r.url()}`)));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') log(`page ${msg.type()}: ${msg.text()}`);
    });
    await page.route(`${ORIGIN}/**`, async (route: Route) => {
      const u = new URL(route.request().url());
      try {
        if (u.pathname.startsWith('/slop/')) {
          const r = data(u.pathname, u.searchParams);
          if (r.status >= 400) log(`data request failed: ${u.pathname} → ${r.status} ${typeof r.body === 'string' ? r.body.slice(0, 200) : ''}`);
          return await route.fulfill({ status: r.status, contentType: r.type, body: r.body });
        }
        const file = path.join(bundle.dir, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
        if (!file.startsWith(bundle.dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          log(`request for a file not in the bundle: ${u.pathname}`);
          return await route.fulfill({ status: 404, body: 'not in bundle' });
        }
        return await route.fulfill({ status: 200, contentType: MIME[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
      } catch (e) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: (e as Error).message }) });
      }
    });
    await page.exposeFunction('__slopEmit', (u: RenderedUnit) => current!.emit(u));
    await page.exposeFunction('__slopCacheLookup', (units: { id: string; input: Omit<FrameUnitKeyInput, 'renderer'>; n: number }[]) => current!.lookup(units));
    await page.exposeFunction('__slopProgress', (m: string, f?: FrameProgress) => current?.progress(m, f));
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => !!(globalThis as unknown as { __slop?: unknown }).__slop, undefined, { timeout: 60_000 });
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw new Error(`the render page did not start: ${(e as Error).message}${pageErrors.length ? ` (page errors: ${pageErrors.join('; ')})` : ''}`);
  }
  const glRenderer = String(await page.evaluate(() => (globalThis as unknown as { __slop: { glRenderer(): string } }).__slop.glRenderer()));
  const backend = backendOf(glRenderer);
  const renderer: RendererId = { backend, bundle: bundle.hash };
  if (launch.mode !== 'software' && backend === 'software') log(`the GPU was not picked up (${launch.mode} asked, ${glRenderer} answered): rendering in software`);
  log(`render runner: bundle ${bundle.hash}, ${launch.mode} → ${backend} (${glRenderer})`);

  const render = async (job: RenderJob, hooks: RenderHooks = {}): Promise<RenderResult> => {
    if (current) throw new Error('the runner renders one job at a time');
    const units = new Map<string, UnitFrames>();
    const keys = new Map<string, { key: string; input: FrameUnitKeyInput; n: number }>();
    const pending: Promise<void>[] = [];
    current = {
      lookup: async (list) => {
        return list.map((u) => {
          const input: FrameUnitKeyInput = { ...u.input, renderer };
          const key = frameUnitKey(input);
          keys.set(u.id, { key, input, n: u.n });
          const entry = job.spec.noCache ? null : store.get(key);
          if (!entry || entry.meta.frames.length !== u.n) return null;
          units.set(u.id, { key, cached: true, frames: Object.fromEntries(Object.entries(entry.strips).map(([name, bytes]) => [name, stripFrames(bytes, u.n, entry.meta.width, entry.meta.height, entry.meta.cols)])) });
          return entry.meta.frames;
        });
      },
      emit: async (u) => {
        const k = keys.get(u.id);
        if (!k) throw new Error(`the page emitted a unit it never looked up: ${u.id.replace('\n', ' ')}`);
        const strips: Record<string, Uint8Array> = {};
        for (const [name, b64] of Object.entries(u.strips)) strips[name] = new Uint8Array(Buffer.from(b64, 'base64'));
        const width = u.frames.length && k.input.framing.frameWidth, height = u.frames.length && k.input.framing.frameHeight;
        const meta: FrameEntry['meta'] = { v: FRAME_CACHE_VERSION, key: k.key, width, height, cols: u.cols, frames: u.frames, strips: Object.keys(strips), inputs: frameUnitDigests(k.input), renderer };
        units.set(u.id, { key: k.key, cached: false, frames: Object.fromEntries(Object.entries(strips).map(([name, bytes]) => [name, stripFrames(bytes, u.frames.length, width, height, u.cols)])) });
        pending.push(Promise.resolve().then(() => store.put(k.key, { meta, strips })).catch((e) => log(`frame cache: an entry was not stored: ${(e as Error).message}`)));
      },
      progress: (m, f) => hooks.onProgress?.(m, f),
    };
    const t0 = performance.now();
    try {
      pageErrors.length = 0;
      const output = (await page.evaluate((j) => (globalThis as unknown as { __slop: { render(j: unknown): Promise<unknown> } }).__slop.render(j), job)) as RenderOutput;
      await Promise.all(pending);
      // Every unit the page listed must have pixels: rendered now, or from the cache.
      for (const u of output.units) {
        const have = units.get(u.id);
        if (!have) throw new Error(`no frames for ${u.clip} ${u.direction} (${u.n} frames): the page neither rendered nor found them in the cache`);
        u.cached = have.cached;
      }
      return { output, units, renderer, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      const err = e as Error;
      const msg = err.message.replace(/^page\.evaluate: /, '').replace(/\n\s+at .*$/gs, '');
      throw Object.assign(new Error(`${msg}${pageErrors.length ? ` [page errors: ${pageErrors.join('; ')}]` : ''}`), { cause: err });
    } finally {
      current = null;
    }
  };

  return {
    bundle, renderer, backend, glRenderer, launch, store, render,
    close: () => browser.close().catch(() => undefined),
  };
}
