// Moved from synty-sprite-generator packages/shared/src/export/frameCache.test.ts (P2, ali3b/sloponator#8).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS } from '../view/camera.js';
import { Sha256, canonicalJson, sha256 } from '../hash.js';
import { FRAME_CACHE_VERSION, frameCacheSummary, frameUnitKey, stripColumns, type FrameUnitKeyInput } from './frameCache.js';

const input = (): FrameUnitKeyInput => ({
  version: { cache: FRAME_CACHE_VERSION, renderer: 3 },
  model: { asset: { id: 7, name: 'SK_Soldier', glb: '/glb/7.glb', scale: 1 }, gender: 'auto', loadout: [{ asset: 12, layer: 'weapon' }], fx: null, light: { preset: 'day' }, scene: 'abc123' },
  view: structuredClone(VIEW_PRESETS.find((p) => p.id === 'iso8')!.config),
  framing: { viewHalfW: 1, viewHalfH: 2, centreY: 0.9, frameWidth: 128, frameHeight: 160, pivot: { x: 64, y: 150 }, ppm: 64 },
  render: { layers: ['normal'], blend: 'normal', layered: { occlusion: 'mask', parts: [{ name: 'weapon', asset: 'SM_Wep_Rifle', depth: 'auto' }] }, partsOnly: false, sockets: ['hand_r', 'weapon_tip'], bodyBoxes: true },
  clip: {
    name: 'walk', loop: true, times: [0, 0.1, 0.2], data: 'deadbeef', source: { type: 'template', layers: [{ id: 'walk', params: { stride: 1 } }], window: { start: 0.1 } },
    cls: 'rifle', perClip: false, release: null, ownGrip: null, state: null, events: [{ frame: 1, name: 'footstep_l' }], grips: [null, [0, 0, 0, 1]],
  },
  direction: { name: 'S', worldAngle: 0 },
});

/** Every leaf of a value with a path to it (arrays and objects walked). */
function leaves(v: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(v)) return v.length ? v.flatMap((x, i) => leaves(x, [...path, i])) : [path];
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return keys.length ? keys.flatMap((k) => leaves((v as Record<string, unknown>)[k], [...path, k])) : [path];
  }
  return [path];
}

function mutateAt(root: unknown, path: (string | number)[]) {
  let o = root as Record<string | number, unknown>;
  for (const p of path.slice(0, -1)) o = o[p] as Record<string | number, unknown>;
  const k = path[path.length - 1];
  const v = o[k];
  o[k] = typeof v === 'number' ? v + 1 : typeof v === 'string' ? `${v}_x` : typeof v === 'boolean' ? !v : v === null ? 'set' : Array.isArray(v) ? [...v, 1] : { added: 1 };
}

describe('sha256', () => {
  it('matches node crypto, also fed in pieces', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'héllo wörld']) {
      expect(sha256(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
    const bytes = new Float32Array([1, 2.5, -3, 1e-7]);
    expect(new Sha256().update('a').update(bytes).update('b').hex()).toBe(createHash('sha256').update('a').update(Buffer.from(bytes.buffer)).update('b').digest('hex'));
  });
  it('canonical JSON ignores key order and undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(canonicalJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });
});

describe('frame cache key', () => {
  it('is stable for the same input whatever the key order', () => {
    const a = input();
    const rev = (v: unknown): unknown => (Array.isArray(v) ? v.map(rev) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, rev(x)])) : v);
    const b = rev(a) as FrameUnitKeyInput;
    expect(Object.keys(b)[0]).toBe('direction');
    expect(frameUnitKey(b)).toBe(frameUnitKey(a));
  });

  it('covers every input: changing any one of them changes the key', () => {
    const base = frameUnitKey(input());
    const paths = leaves(input());
    // Every top-level group is walked (model, view, framing, render, clip, direction, version).
    expect(new Set(paths.map((p) => p[0]))).toEqual(new Set(['version', 'model', 'view', 'framing', 'render', 'clip', 'direction']));
    expect(paths.length).toBeGreaterThan(40);
    const unchanged: string[] = [];
    for (const p of paths) {
      const x = input();
      mutateAt(x, p);
      if (frameUnitKey(x) === base) unchanged.push(p.join('.'));
    }
    expect(unchanged).toEqual([]);
  });

  it('names the inputs FB-121 lists: model, outfit, view, scale, fps, trim/speed/reverse, template params, lighting, renderer', () => {
    const base = frameUnitKey(input());
    const changed = (f: (x: FrameUnitKeyInput) => void) => {
      const x = input();
      f(x);
      return frameUnitKey(x) !== base;
    };
    expect(changed((x) => ((x.model as { asset: { glb: string } }).asset.glb = '/glb/8.glb'))).toBe(true);
    expect(changed((x) => ((x.model as { loadout: unknown[] }).loadout = []))).toBe(true);
    expect(changed((x) => (x.view.pitch += 1))).toBe(true);
    expect(changed((x) => (x.view.scale = { mode: 'ppm', ppm: 99 } as never))).toBe(true);
    expect(changed((x) => (x.view.fps += 1))).toBe(true);
    expect(changed((x) => ((x.clip.source as { window: { start: number } }).window.start = 0.2))).toBe(true);
    expect(changed((x) => (x.clip.data = 'reversed'))).toBe(true);
    expect(changed((x) => ((x.clip.source as { layers: { params: { stride: number } }[] }).layers[0].params.stride = 2))).toBe(true);
    expect(changed((x) => ((x.model as { light: unknown }).light = { preset: 'night' }))).toBe(true);
    expect(changed((x) => (x.version.renderer += 1))).toBe(true);
    expect(changed((x) => (x.direction.name = 'N'))).toBe(true);
  });
});

describe('frame cache helpers', () => {
  it('strips stay under 8192 px wide', () => {
    expect(stripColumns(60, 128)).toBe(60);
    expect(stripColumns(60, 512)).toBe(16);
    expect(stripColumns(3, 9000)).toBe(1);
  });
  it('summarises reuse', () => {
    expect(frameCacheSummary({ reused: 1440, total: 1520 })).toBe('reused 1440 of 1520 frames');
    expect(frameCacheSummary({ reused: 0, total: 0 })).toBeNull();
  });
});
