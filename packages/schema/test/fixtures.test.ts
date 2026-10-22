// The real games' declaration files validate unchanged: that is what lets them switch to the Sloponator with no rewrite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assetsFile, formatErrors, modelsFile, texturesFile, validate } from '../src/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as unknown;

const ok = (schema: Parameters<typeof validate>[0], name: string) => {
  const r = validate(schema, read(name));
  expect(r.ok, r.ok ? '' : formatErrors(r.errors, name)).toBe(true);
  return r;
};

describe('ssg.assets.json fixtures', () => {
  it('Solitary Strike (airborne-ranger): 71 sprites with states, splits, loadouts, tilesets and maps', () => {
    const r = ok(assetsFile, 'airborne-ranger.assets.json');
    if (r.ok) {
      const f = r.value as { sprites: unknown[]; tilesets: unknown[]; maps: unknown[] };
      expect(f.sprites).toHaveLength(71);
      expect(f.tilesets).toHaveLength(4);
      expect(f.maps.length).toBeGreaterThan(0);
    }
  });
  it('Sidefighter: side view, portraits, stills, fx and per-sprite events', () => ok(assetsFile, 'sidefighter.assets.json'));
  it('Monty: a 32x32 tileset and prop sprites', () => ok(assetsFile, 'monty.assets.json'));
  it('keeps the data as given (no normalisation that would change what a game reads)', () => {
    const data = read('monty.assets.json');
    const r = validate(assetsFile, data);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(data);
  });
});

describe('ssg.models.json fixtures', () => {
  it('Off Road: assets with attachments, variants, poses and clips', () => ok(modelsFile, 'offroad.models.json'));
  it('4D Stunts: track pieces, terrains, skydomes, a composite and lods', () => {
    const r = ok(modelsFile, '4dstunts.models.json');
    if (r.ok) expect((r.value as { models: unknown[] }).models).toHaveLength(119);
  });
});

describe('ssg.textures.json fixtures', () => {
  it('4D Stunts: six ground textures with defaults', () => ok(texturesFile, '4dstunts.textures.json'));
});
