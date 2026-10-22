/**
 * `slop build` without a browser: the arguments, the declaration file's validation, where the shared settings come
 * from (the file, the old project, the built-ins), the sprite folder writer, and the packer on a tiny fake render.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openLibrary, type Library } from '@slop/library';
import { BUILTIN_PROFILES, frameOf, frameKey, type BatchSpec } from '@slop/sprites';
import type { RenderResult } from '@slop/render';
import { BuildError, pack, parseArgs, readAssetsFile, resolveProject, writeSpriteDir } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../../schema/test/fixtures/monty.assets.json');
const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));

describe('slop build arguments', () => {
  it('parses the file, --out and the options', () => {
    const a = parseArgs(['build', 'ssg.assets.json', '--out', 'public/assets', '--gpu', 'software', '--only', 'joe,skull', '--only', 'door', '--force', '--json']);
    expect(a).toMatchObject({ command: 'build', file: 'ssg.assets.json', out: 'public/assets', gpu: 'software', only: ['joe', 'skull', 'door'], force: true, json: true });
  });
  it('refuses unknown options and GPU modes', () => {
    expect(() => parseArgs(['build', '--gpu', 'fast'])).toThrow(/--gpu must be one of auto, nvidia, egl, software/);
    expect(() => parseArgs(['build', '--wat'])).toThrow(/unknown option --wat/);
    expect(() => parseArgs(['build', '--out'])).toThrow(/needs a value/);
  });
});

describe('the declaration file', () => {
  it('is validated by @slop/schema with its teaching errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-build-'));
    const f = path.join(dir, 'ssg.assets.json');
    fs.writeFileSync(f, JSON.stringify({ project: 'x', sprites: [{ name: 'a', asset: 'P/M', kinds: 'prop' }] }));
    expect(() => readAssetsFile(f)).toThrow(/kinds/);
    fs.writeFileSync(f, '{');
    expect(() => readAssetsFile(f)).toThrow(/not JSON/);
    expect(() => readAssetsFile(path.join(dir, 'missing.json'))).toThrow(BuildError);
    expect(readAssetsFile(FIXTURE).sprites.map((s) => s.name)).toContain('joe');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('writeSpriteDir', () => {
  it('replaces the folder with the pack\'s files and never writes outside it', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-out-'));
    fs.mkdirSync(path.join(out, 'hero'));
    fs.writeFileSync(path.join(out, 'hero', 'stale.png'), 'x');
    const w = writeSpriteDir(out, 'hero', { 'Hero_0.png': new Uint8Array([1]), 'Hero.json': new Uint8Array([2]), '../escape.txt': new Uint8Array([3]) });
    expect(w.dir).toBe(path.join(out, 'hero'));
    expect(fs.readdirSync(w.dir).sort()).toEqual(['Hero.json', 'Hero_0.png']);
    expect(fs.existsSync(path.join(out, 'escape.txt'))).toBe(false);
    fs.rmSync(out, { recursive: true, force: true });
  });
});

describe('pack', () => {
  it('lays out, composes and writes the profile\'s files from a fake render (generic profile, 2 frames)', async () => {
    const profile = BUILTIN_PROFILES.find((p) => p.id === 'generic')!;
    const view = { projection: 'ortho', pitch: 0, fov: 30, directions: '1', basis: 'world', mirror: false, order: 'ccw-e', naming: 'compass', scale: { mode: 'fit' }, frameWidth: 4, frameHeight: 4, fps: 10, padding: 0, quality: { supersample: 1, textureFilter: 'nearest', shadow: 'off', style: 'clean' } } as unknown as BatchSpec['view'];
    const spec = { name: 't', assetIds: [1], set: { id: 's', name: 's', items: [] }, view, profile, layers: [], gender: 'auto', uniformFrame: false } as BatchSpec;
    const framing = { frameWidth: 4, frameHeight: 4, viewHalfW: 1, viewHalfH: 1, pivot: { x: 2, y: 4 }, ppm: null, centre: [0, 0, 0] } as unknown as RenderResult['output']['framing'];
    const px = (v: number) => frameOf(4, 4, new Uint8Array(64).map((_, i) => (i % 4 === 3 ? (i < 32 ? 255 : 0) : v)));
    const r: RenderResult = {
      renderer: { backend: 'software', bundle: 'x' }, ms: 1,
      output: {
        asset: { name: 'SM_Thing', pack: 'P', kind: 'prop', category: null }, view, framing, directions: [{ name: 'E', worldAngle: 0, screenAngle: 0, mirrorOf: null }] as never,
        plans: [{ name: 'idle', loop: true, times: [0, 0.1], dirs: ['E'] }], clips: [{ name: 'idle', loop: true, frameCount: 2, speedMps: null }], events: {}, object: null, sockets: {}, boxes: {},
        inputs: [0, 1].map((i) => ({ key: frameKey('idle', 'E', i), clip: 'idle', direction: 'E', index: i, width: 4, height: 4, opaque: { x: 0, y: 0, w: 4, h: 2 } })),
        validation: [], modelScale: 1, blend: 'normal', layers: [], units: [{ id: 'idle\nE', clip: 'idle', direction: 'E', n: 2, input: {} as never, cached: false }], cache: { reused: 0, total: 2 }, special: undefined,
      },
      units: new Map([['idle\nE', { key: 'k', cached: false, frames: { 'body.png': [px(10), px(20)] } }]]),
    };
    const p = await pack(spec, r, { generator: { name: 'test', version: '1', generatedAt: '2026-01-01T00:00:00.000Z' } });
    expect(p.base).toBe('Thing');
    expect(Object.keys(p.files).sort()).toEqual(['Thing.json', 'Thing_0.png']);
    const meta = JSON.parse(Buffer.from(p.files['Thing.json']!).toString('utf8'));
    expect(meta.generator).toEqual({ name: 'test', version: '1', generatedAt: '2026-01-01T00:00:00.000Z' });
    expect(meta.animations).toHaveLength(1);
    expect(meta.animations[0].frames).toHaveLength(2);
    expect(p.validation).toEqual([]);
    // The same input packs to the same bytes.
    const again = await pack(spec, r, { generator: { name: 'test', version: '1', generatedAt: '2026-01-01T00:00:00.000Z' } });
    expect(Buffer.compare(again.files['Thing_0.png']!, p.files['Thing_0.png']!)).toBe(0);
  });
});

describe.skipIf(!haveData)('the shared settings of a file', () => {
  const lib: Library = haveData ? openLibrary({ dataDir: DATA_DIR }) : null!;
  it('come from the old project when the file (Monty\'s) sets none, and say so', () => {
    const file = readAssetsFile(FIXTURE);
    const notes: string[] = [];
    const p = resolveProject(file, lib, (m) => notes.push(m));
    expect(p.source).toBe('old project');
    expect(p.defaults).toMatchObject({ viewCardId: 'side2', lookId: 'pixel', sizeId: 'small', profileId: 'phaser3' });
    expect(notes[0]).toMatch(/taken from the old generator's project/);
  });
  it('come from the file when it names them', () => {
    const file = { ...readAssetsFile(FIXTURE), view: 'iso8', format: 'generic' } as ReturnType<typeof readAssetsFile>;
    const p = resolveProject(file, lib, () => undefined);
    expect(p.source).toBe('file');
    expect(p.defaults.profileId).toBe('generic');
    expect(p.defaults.viewCardId).toBe('iso8');
  });
  it('are the built-ins for a project nobody has heard of', () => {
    const file = { ...readAssetsFile(FIXTURE), project: 'no such game' };
    expect(resolveProject(file, lib, () => undefined).source).toBe('built-in');
    lib.close();
  });
});
