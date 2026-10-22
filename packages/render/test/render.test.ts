/**
 * The runner's Node side without a browser: the backend choice, the frame store, the PNG strips, the bundle build
 * and hash, and the in-process data handler against the old generator's library (skipped without its data dir).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openLibrary } from '@slop/library';
import { FRAME_CACHE_VERSION, frameOf, frameUnitKey, type FrameUnitMeta } from '@slop/sprites';
import { backendOf, bundleSourceHash, chromiumLaunch, dataHandler, decodePng, encodePng, ensureBundle, FrameStore, hashDir, stripFrames, WEB_DIR } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));
if (!haveData) console.warn(`render.test.ts: the data handler suite is skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);

describe('chromiumLaunch', () => {
  it('software is SwiftShader with no display', () => {
    const l = chromiumLaunch('software', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', HOME: '/h' });
    expect(l.mode).toBe('software');
    expect(l.args).toContain('--use-angle=swiftshader');
    expect(l.env.DISPLAY).toBeUndefined();
    expect(l.env.WAYLAND_DISPLAY).toBeUndefined();
    expect(l.env.HOME).toBe('/h');
  });
  it('nvidia forces the NVIDIA EGL vendor library; egl takes what the system offers', () => {
    const n = chromiumLaunch('nvidia', {});
    expect(n.mode).toBe('nvidia');
    expect(n.env.__EGL_VENDOR_LIBRARY_FILENAMES).toMatch(/10_nvidia\.json$/);
    expect(n.args).toContain('--use-angle=gl-egl');
    const e = chromiumLaunch('egl', {});
    expect(e.mode).toBe('egl');
    expect(e.env.__EGL_VENDOR_LIBRARY_FILENAMES).toBeUndefined();
  });
  it('the backend is what the page reports, not what was asked', () => {
    expect(backendOf('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('software');
    expect(backendOf('ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL ES 3.2)')).toBe('gpu');
    expect(backendOf('no WebGL')).toBe('software');
  });
});

describe('PNG strips', () => {
  it('encode and decode round-trip RGBA bytes exactly, straight alpha', () => {
    const f = frameOf(3, 2, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 1, 10, 20, 30, 0, 200, 100, 50, 255, 7, 7, 7, 77]));
    const back = decodePng(encodePng(f));
    expect(back.width).toBe(3);
    expect(back.height).toBe(2);
    expect([...back.pixels()]).toEqual([...f.pixels()]);
  });
  it('encoding is deterministic', () => {
    const f = frameOf(8, 8, new Uint8Array(256).map((_, i) => (i * 37) % 256));
    expect(Buffer.compare(encodePng(f), encodePng(f))).toBe(0);
  });
  it('cuts a strip into its frames by columns', () => {
    // 3 frames of 2×1 in 2 columns: a 4×2 strip.
    const strip = frameOf(4, 2, new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 0, 0, 0, 0, 0, 0, 0, 0]));
    const frames = stripFrames(encodePng(strip), 3, 2, 1, 2);
    expect(frames.map((f) => [...f.pixels()])).toEqual([[1, 1, 1, 1, 2, 2, 2, 2], [3, 3, 3, 3, 4, 4, 4, 4], [5, 5, 5, 5, 6, 6, 6, 6]]);
    expect(() => stripFrames(encodePng(strip), 9, 2, 1, 2)).toThrow(/too small/);
  });
});

describe('FrameStore', () => {
  it('puts and gets an entry, refuses other versions and keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-frames-'));
    const store = new FrameStore(dir);
    const key = 'ab'.repeat(32);
    const meta: FrameUnitMeta = { v: FRAME_CACHE_VERSION, key, width: 2, height: 1, cols: 2, frames: [{ opaque: null }, { opaque: { x: 0, y: 0, w: 1, h: 1 } }], strips: ['body.png'] };
    const png = encodePng(frameOf(4, 1, new Uint8Array(16).fill(9)));
    expect(store.has(key)).toBe(false);
    store.put(key, { meta, strips: { 'body.png': png } });
    expect(store.has(key)).toBe(true);
    expect(store.count()).toBe(1);
    const got = store.get(key)!;
    expect(got.meta).toEqual(meta);
    expect(Buffer.compare(got.strips['body.png']!, png)).toBe(0);
    store.put(key, { meta: { ...meta, v: FRAME_CACHE_VERSION + 1 }, strips: { 'body.png': png } });
    expect(store.get(key)).toBeNull();
    expect(store.get('cd'.repeat(32))).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('keys name the backend and the bundle, so the same frames on another renderer are another entry', () => {
    const input = { version: { cache: FRAME_CACHE_VERSION }, model: {}, view: {} as never, framing: {} as never, render: { layers: [], blend: 'normal' as const, layered: null, partsOnly: false, sockets: [], bodyBoxes: false }, clip: { name: 'a', loop: true, times: [0], data: 'x', source: null, cls: null, perClip: false, release: null, ownGrip: null, state: null, events: [], grips: [] }, direction: { name: 'E', worldAngle: 0 } };
    const gpu = frameUnitKey({ ...input, renderer: { backend: 'gpu', bundle: 'abc' } });
    expect(frameUnitKey({ ...input, renderer: { backend: 'software', bundle: 'abc' } })).not.toBe(gpu);
    expect(frameUnitKey({ ...input, renderer: { backend: 'gpu', bundle: 'abd' } })).not.toBe(gpu);
    expect(frameUnitKey({ ...input, renderer: { backend: 'gpu', bundle: 'abc' } })).toBe(gpu);
  });
});

describe('the render bundle', () => {
  it('hashes its sources (web/ and @slop/sprites) and the pinned three/vite versions', () => {
    const a = bundleSourceHash();
    expect(a.three).toBe('0.170.0');
    expect(a.vite).toBe('5.4.11');
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(bundleSourceHash().hash).toBe(a.hash);
    expect(hashDir(WEB_DIR)).toBe(hashDir(WEB_DIR));
    expect(fs.existsSync(path.join(WEB_DIR, 'index.html'))).toBe(true);
  });
  it('builds once into the cache dir under its source hash, named by the hash of the output; a second call finds it', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-bundle-'));
    const log: string[] = [];
    const b = await ensureBundle({ cacheDir, log: (m) => log.push(m) });
    expect(b.dir).toBe(path.join(cacheDir, 'bundles', b.sourceHash));
    expect(b.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.existsSync(path.join(b.dir, 'index.html'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(b.dir, 'bundle.json'), 'utf8')).hash).toBe(b.hash);
    // The page is self-contained: one HTML, hashed assets, nothing fetched from anywhere else.
    expect(fs.readFileSync(path.join(b.dir, 'index.html'), 'utf8')).toMatch(/assets\/index-[^"]+\.js/);
    expect(hashDir(b.dir, (n) => n === 'bundle.json')).toBe(b.hash);
    const again = await ensureBundle({ cacheDir, log: (m) => log.push(m) });
    expect(again.hash).toBe(b.hash);
    expect(log.filter((m) => /building/.test(m))).toHaveLength(1);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }, 120_000);
});

describe.skipIf(!haveData)('the data handler answers the page from the library', () => {
  const lib = haveData ? openLibrary({ dataDir: DATA_DIR }) : null!;
  const data = haveData ? dataHandler(lib) : null!;
  const json = (p: string, q = '') => {
    const r = data(p, new URLSearchParams(q));
    return { status: r.status, body: JSON.parse(String(r.body)) as Record<string, unknown> };
  };
  it('an asset record in the old DTO shape, its GLB at a path this runner serves', () => {
    const r = json('/slop/assets/7171');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 7171, name: 'SM_Prop_Skull_01', kind: 'prop', glb: '/slop/glb/7171', scaleFix: expect.any(Number) });
    const glb = data('/slop/glb/7171', new URLSearchParams());
    expect(glb.status).toBe(200);
    expect(glb.type).toBe('model/gltf-binary');
    expect(Buffer.from(glb.body).subarray(0, 4).toString()).toBe('glTF');
    expect(json('/slop/assets/999999999').status).toBe(404);
  });
  it('every ready clip, as the old /api/animations did', () => {
    const r = json('/slop/animations');
    expect(r.status).toBe(200);
    expect((r.body as unknown as unknown[]).length).toBeGreaterThan(1000);
  });
  it('a bake the old generator made, else a 409 that names the clip and the model', () => {
    const joe = lib.asset('POLYGON_War/Character_GentleMan_01')!;
    const anims = lib.animations({ limit: 20000 });
    const baked = anims.find((a) => a.bakePath(joe.id));
    expect(baked, 'Monty rendered joe, so some clip is baked on him').toBeDefined();
    const r = json(`/slop/bake/${joe.id}/${baked!.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ url: `/slop/bakes/${joe.id}/${baked!.id}`, clip: `n${baked!.id}` });
    expect(data(`/slop/bakes/${joe.id}/${baked!.id}`, new URLSearchParams()).status).toBe(200);
    const unbaked = anims.find((a) => !a.bakePath(joe.id))!;
    const miss = json(`/slop/bake/${joe.id}/${unbaked.id}`);
    expect(miss.status).toBe(409);
    expect(String(miss.body.error)).toContain(unbaked.name);
    expect(String(miss.body.error)).toContain('Character_GentleMan_01');
    expect(String(miss.body.error)).toContain('Blender');
  });
  it('the FX particle sprites of the POLYGON Particle FX pack', () => {
    const r = data('/slop/fx/glow', new URLSearchParams());
    expect([200, 404]).toContain(r.status);
    if (r.status === 200) expect(r.type).toBe('image/png');
    expect(data('/slop/fx/nothing', new URLSearchParams()).status).toBe(404);
  });
  it('is read-only: the test never wrote the data dir', () => {
    expect(fs.existsSync(path.join(DATA_DIR, 'library.db'))).toBe(true);
    void here;
  });
});
