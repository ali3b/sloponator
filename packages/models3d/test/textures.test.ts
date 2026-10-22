/**
 * Texture export and `ssg.textures.json` apply (CS-FB-021, OR-FB-020) over a stand-in library whose pack folder
 * holds PNGs written here; moved from synty-sprite-generator packages/client/src/textureApply.test.ts (the fake
 * API replaced by the real export) with the frame detection cases of the old server. The golden half compares
 * with 4D Stunts' public/textures (made by the old `ssg texture apply`) when that checkout is on this machine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openLibrary, type Library } from '@slop/library';
import { encodePng } from '../src/build/png.js';
import { applyTextures, detectFrames, exportTextureAs, findTexture, framesFromName, guessTextureKind, parseTexturesFile, searchTextures, textureRole, type TextureSheetMeta } from '../src/index.js';
import { stubLibrary } from './helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-textures-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A PNG of `w`×`h` with a pixel function. */
function png(file: string, w: number, h: number, px: (x: number, y: number) => number[]) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng({ width: w, height: h, data }));
}

const packs = path.join(tmp, 'packs');
const lib = stubLibrary({ dataDir: tmp, packs: [{ id: 1, name: 'POLYGON_Test', dir: path.join(packs, 'POLYGON_Test_v1') }, { id: 2, name: 'POLYGON_FX', dir: path.join(packs, 'POLYGON_FX_v2') }] });

beforeAll(() => {
  png(path.join(packs, 'POLYGON_Test_v1/Textures/Ground/Beach_01.png'), 256, 256, (x) => [220, 200, 150 + (x % 4), 255]);
  png(path.join(packs, 'POLYGON_Test_v1/Textures/Ground/Snow_01.png'), 64, 64, () => [240, 240, 250, 255]);
  png(path.join(packs, 'POLYGON_Test_v1/Textures/Ground/Snow_01_Normal.png'), 64, 64, () => [128, 128, 255, 255]);
  // A 4×2 sprite sheet of smoke puffs on transparent, and a flash painted on black with a _2x2 in its name.
  png(path.join(packs, 'POLYGON_FX_v2/Textures/FX_Smoke_01.png'), 128, 64, (x, y) => {
    const cx = (x % 32) - 16, cy = (y % 32) - 16;
    return cx * cx + cy * cy < 100 ? [200, 200, 200, 255] : [0, 0, 0, 0];
  });
  png(path.join(packs, 'POLYGON_FX_v2/Textures/FX_Flash_2x2.png'), 64, 64, (x, y) => ((x % 32) - 16) ** 2 + ((y % 32) - 16) ** 2 < 100 ? [255, 240, 200, 255] : [0, 0, 0, 255]);
});

describe('textures in the packs', () => {
  it('lists, classifies and finds them; a path, a tail, a bare name, or a name with a pack', () => {
    const all = searchTextures(lib, { all: true, limit: 100 }).textures.map((t) => [t.path, t.pack, t.kind, t.role]);
    // Ground kinds first, then the biggest.
    expect(all).toEqual([
      ['POLYGON_Test_v1/Textures/Ground/Beach_01.png', 'POLYGON_Test', 'sand', 'color'],
      ['POLYGON_Test_v1/Textures/Ground/Snow_01.png', 'POLYGON_Test', 'snow', 'color'],
      ['POLYGON_Test_v1/Textures/Ground/Snow_01_Normal.png', 'POLYGON_Test', 'snow', 'normal'],
      ['POLYGON_FX_v2/Textures/FX_Smoke_01.png', 'POLYGON_FX', null, 'fx'],
      ['POLYGON_FX_v2/Textures/FX_Flash_2x2.png', 'POLYGON_FX', null, 'fx'],
    ]);
    expect(searchTextures(lib, { search: 'sand' }).textures.map((t) => t.file)).toEqual(['Beach_01.png']);
    expect(searchTextures(lib, { search: 'snow' }).textures.map((t) => t.file)).toEqual(['Snow_01.png']);
    expect(guessTextureKind('Textures/Dirt_Texture_Arid_01.png')).toBe('dirt');
    expect(textureRole('Rock_01_N.png')).toBe('normal');
    expect(findTexture(lib, 'Ground/Beach_01.png').file).toBe(path.join(packs, 'POLYGON_Test_v1/Textures/Ground/Beach_01.png'));
    expect(findTexture(lib, 'beach_01').info?.pack).toBe('POLYGON_Test');
    expect(findTexture(lib, 'FX_Smoke_01', 'FX').info?.path).toBe('POLYGON_FX_v2/Textures/FX_Smoke_01.png');
    expect(() => findTexture(lib, 'Beach_02')).toThrow(/no texture "Beach_02"/);
    expect(() => findTexture(lib, 'Beach')).toThrow(/no texture "Beach". Closest: POLYGON_Test_v1\/Textures\/Ground\/Beach_01.png/);
    expect(() => findTexture(lib, 'Beach_01', 'POLYGON_FX')).toThrow(/no texture/);
    expect(() => findTexture(lib, '7')).toThrow(/asset 7 has no texture/);
  });

  it('frame grids: from the name (_2x2) or from the gaps; the background from the alpha or the black', async () => {
    expect(framesFromName('FX_Flash_2x2')).toEqual([2, 2]);
    expect(framesFromName('Beach_01')).toBeNull();
    const smoke = await exportTextureAs(lib, 'FX_Smoke_01', undefined);
    expect(smoke.meta).toMatchObject({ name: 'FX_Smoke_01', width: 128, height: 64, background: 'transparent', frames: { cols: 4, rows: 2, count: 8, width: 32, height: 32, from: 'alpha' }, format: 'png' });
    const flash = await exportTextureAs(lib, 'FX_Flash_2x2', undefined);
    expect(flash.meta).toMatchObject({ background: 'black', frames: { cols: 2, rows: 2, count: 4, from: 'name' } });
    const beach = await exportTextureAs(lib, 'Beach_01', undefined);
    expect(beach.meta).toMatchObject({ background: 'opaque', frames: null, source: { pack: 'POLYGON_Test', path: 'POLYGON_Test_v1/Textures/Ground/Beach_01.png' } });
    expect(detectFrames({ width: 8, height: 8, data: new Uint8Array(256).fill(255) }, 'solid')).toBeNull();
  });

  it('scales down (never up) and writes webp; the frames follow; the revision changes with the options and the file', async () => {
    const small = await exportTextureAs(lib, 'Beach_01', undefined, { size: 64, format: 'webp' });
    expect(small.meta).toMatchObject({ width: 64, height: 64, format: 'webp', sourceSize: [256, 256] });
    expect(small.mime).toBe('image/webp');
    expect(small.image.subarray(0, 4).toString()).toBe('RIFF');
    const same = await exportTextureAs(lib, 'Beach_01', undefined, { size: 1024 });
    expect(same.meta.sourceSize).toBeUndefined();
    expect(same.meta.width).toBe(256);
    const sheet = await exportTextureAs(lib, 'FX_Smoke_01', undefined, { size: 64 });
    expect(sheet.meta.frames).toMatchObject({ cols: 4, rows: 2, width: 16, height: 16 });
    expect(new Set([small.rev, same.rev, sheet.rev, (await exportTextureAs(lib, 'Beach_01', undefined)).rev]).size).toBe(4);
    expect(small.rev).toBe((await exportTextureAs(lib, 'Beach_01', undefined, { size: 64, format: 'webp' })).rev);
  });
});

describe('ssg.textures.json apply (CS-FB-021)', () => {
  it('parses: defaults under entries, comments allowed, typos refused', () => {
    const d = parseTexturesFile({
      comment: 'ground textures',
      defaults: { size: 512, format: 'webp' },
      textures: [{ name: 'ground-sand', texture: 'Pack/Ground/Beach_01.png' }, { name: 'snow', texture: 'Snow_01', size: 256, format: 'png', comment: 'x' }, { texture: 'Grass_01.png' }],
    });
    expect(d).toEqual([
      { name: 'ground-sand', texture: 'Pack/Ground/Beach_01.png', size: 512, format: 'webp' },
      { name: 'snow', texture: 'Snow_01', size: 256, format: 'png' },
      { name: 'Grass_01', texture: 'Grass_01.png', size: 512, format: 'webp' },
    ]);
    expect(() => parseTexturesFile({ textures: [{ name: 'a', texture: 'x', sise: 4 }] })).toThrow(/unknown key "sise"/);
    expect(() => parseTexturesFile({ textures: [{ name: 'a', texture: 'x' }, { name: 'A', texture: 'y' }] })).toThrow(/used twice/);
    expect(() => parseTexturesFile({ textures: [{ name: 'a', texture: 'x', format: 'jpg' }] })).toThrow(/png.*webp/);
    expect(() => parseTexturesFile({ texture: [] })).toThrow(/texture/);
  });

  it('writes changed textures only, removes ones no longer declared, and indexes them', async () => {
    const dir = path.join(tmp, 'out');
    const decls = parseTexturesFile({ defaults: { format: 'webp', size: 32 }, textures: [{ name: 'sand', texture: 'Beach_01' }, { name: 'snow', texture: 'Snow_01' }] });
    const r1 = await applyTextures(decls, dir, { lib });
    expect(r1.textures.map((t) => [t.name, t.action, t.image])).toEqual([['sand', 'written', 'sand.webp'], ['snow', 'written', 'snow.webp']]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'sand.json'), 'utf8'))).toMatchObject({ width: 32, format: 'webp', image: 'sand.webp', sourceSize: [256, 256] });
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'textures.json'), 'utf8'));
    expect(Object.keys(index.textures)).toEqual(['sand', 'snow']);
    expect(index.textures.sand).toMatchObject({ rev: r1.textures[0].rev, texture: 'Beach_01', image: 'sand.webp', meta: 'sand.json', data: { width: 32 } });
    // Again, unchanged: nothing is written.
    const stamp = fs.statSync(path.join(dir, 'sand.webp')).mtimeMs;
    const r2 = await applyTextures(decls, dir, { lib });
    expect(r2.textures.map((t) => t.action)).toEqual(['unchanged', 'unchanged']);
    expect(fs.statSync(path.join(dir, 'sand.webp')).mtimeMs).toBe(stamp);
    // A new size updates one; a format change replaces its file; a texture dropped from the file goes.
    const next = parseTexturesFile({ textures: [{ name: 'sand', texture: 'Beach_01', size: 16, format: 'png' }] });
    const r3 = await applyTextures(next, dir, { lib });
    expect(r3.textures.map((t) => [t.name, t.action, t.image])).toEqual([['sand', 'updated', 'sand.png']]);
    expect(r3.removed.sort()).toEqual(['sand.webp', 'snow.json', 'snow.webp']);
    expect(fs.readdirSync(dir).sort()).toEqual(['sand.json', 'sand.png', 'textures.json']);
    // A deleted file is written again; a missing texture stops the run before the folder changes.
    fs.rmSync(path.join(dir, 'sand.png'));
    expect((await applyTextures(next, dir, { lib })).textures[0].action).toBe('updated');
    await expect(applyTextures(parseTexturesFile({ textures: [{ name: 'x', texture: 'Nope_01' }] }), dir, { lib })).rejects.toThrow(/texture x: no texture "Nope_01"/);
    expect(fs.existsSync(path.join(dir, 'sand.png'))).toBe(true);
  });
});

// ---- golden: 4D Stunts' public/textures, made by the old generator's `ssg texture apply` ----

const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const GOLD = '/home/andrew/projects/4dstunts';
const have = fs.existsSync(path.join(DATA_DIR, 'library.db')) && fs.existsSync(path.join(GOLD, 'public/textures/textures.json'));
if (!have) console.warn(`textures.test.ts: golden half skipped, needs ${DATA_DIR} and ${GOLD}/public/textures`);

describe.skipIf(!have)('golden: 4D Stunts textures (old ssg texture apply, TEXTURE_EXPORT_VERSION 1)', () => {
  let real: Library;
  beforeAll(() => {
    real = openLibrary({ dataDir: DATA_DIR });
  });
  afterAll(() => real?.close());

  it('ground-sand and ground-snow: the same meta and the same PNG bytes', async () => {
    const decls = parseTexturesFile(JSON.parse(fs.readFileSync(path.join(GOLD, 'ssg.textures.json'), 'utf8')));
    for (const name of ['ground-sand', 'ground-snow']) {
      const d = decls.find((x) => x.name === name)!;
      const r = await exportTextureAs(real, d.texture, d.pack, { size: d.size, format: d.format });
      const oldMeta = JSON.parse(fs.readFileSync(path.join(GOLD, 'public/textures', `${name}.json`), 'utf8')) as TextureSheetMeta & { image: string };
      const { image: _image, ...oldRest } = oldMeta;
      expect(r.meta).toEqual(oldRest);
      expect(r.image.equals(fs.readFileSync(path.join(GOLD, 'public/textures', `${name}.png`)))).toBe(true);
    }
  }, 60000);
});
