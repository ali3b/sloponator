// Errors that teach: the key, the nearest valid key, the allowed values, what the key is for, and where it is documented.
import { describe, expect, it } from 'vitest';
import { DeclarationError, assertValid, assetsFile, formatErrors, modelsFile, nearest, texturesFile, validate } from '../src/index.js';

const sprite = (extra: Record<string, unknown>) => ({ sprites: [{ name: 'hero', asset: 'POLYGON_War/Character_American_Soldier_01', ...extra }] });
const fail = (schema: Parameters<typeof validate>[0], data: unknown) => {
  const r = validate(schema, data);
  expect(r.ok).toBe(false);
  return r.ok ? '' : formatErrors(r.errors);
};

describe('unknown keys', () => {
  it('a typo names the nearest key, lists the keys and links the docs', () => {
    const text = fail(assetsFile, sprite({ ppmm: 64 }));
    expect(text).toContain('sprites[0] (hero): unknown key "ppmm". Did you mean "ppm"?');
    expect(text).toContain('Keys: name, asset, kind, class, anim');
    expect(text).toContain('See docs/api/declarations.md#sprite.');
  });
  it('an old spelling says which key to use', () => {
    expect(fail(assetsFile, sprite({ model: 'x' }))).toContain('unknown key "model": it is the old spelling of "asset", use "asset".');
    expect(fail(assetsFile, { sprites: [], tilesets: [{ name: 't', terrains: [{ name: 'g', colour: '#ffffff' }] }] })).toContain('tilesets[0] (t).terrains[0] (g): unknown key "colour": it is the old spelling of "color", use "color".');
  });
  it('a key the old generator ignored is reported as not needed', () => {
    expect(fail(assetsFile, { sprites: [], tilesets: [{ name: 't', orientation: 'isometric', terrains: ['grass'] }] })).toContain('unknown key "orientation": it is not needed here, remove it.');
  });
  it('an unknown key inside an anim object (a union branch) is reported on that object, not as a union failure', () => {
    const text = fail(assetsFile, sprite({ anim: [{ clip: 'Idle', trimm: '0:1' }] }));
    expect(text).toContain('sprites[0] (hero).anim[0]: unknown key "trimm". Did you mean "trim"? Keys: clip, trim, maxSeconds');
    expect(text).not.toContain('template');
    expect(text).toContain('#anim.');
    expect(fail(assetsFile, sprite({ template: { template: 'still', with: 'x', az: 'k' } }))).toContain('anim: unknown key "az". Did you mean "as"? Keys: template, with, as, release. See docs/api/declarations.md#template.'.replace('anim:', 'template:'));
  });
  it('models: an unknown spec field', () => {
    const text = fail(modelsFile, { models: [{ name: 'truck', asset: 'SM_Veh_Pickup_01', texsize: 512 }] });
    expect(text).toContain('models[0] (truck): unknown key "texsize". Did you mean "texSize"?');
    expect(text).toContain('#model.');
  });
  it('textures: an unknown top-level field', () => {
    expect(fail(texturesFile, { texture: [] })).toContain('unknown key "texture". Did you mean "textures"?');
  });
});

describe('wrong types and values', () => {
  it('a wrong type says what was expected, what came, and what the key is for', () => {
    const text = fail(assetsFile, sprite({ fps: 'twelve' }));
    expect(text).toContain('sprites[0] (hero).fps: fps must be number (got "twelve"). fps: Frames per second sampled from the clips. See docs/api/declarations.md#sprite.');
  });
  it('a wrong enum value lists the values and guesses the nearest', () => {
    const text = fail(assetsFile, sprite({ kind: 'vehicel' }));
    expect(text).toContain('kind must be one of "character", "vehicle", "object", "prop", "weapon" (got "vehicel"). Did you mean "vehicle"? kind: What the model is');
  });
  it('a missing required key', () => {
    expect(fail(assetsFile, { sprites: [{ name: 'x' }] })).toContain('sprites[0] (x): asset is required (text | whole number). asset: The model: id, name or Pack/Name.');
    expect(fail(assetsFile, {})).toContain('sprites is required');
  });
  it('a value out of range', () => {
    expect(fail(modelsFile, { models: [{ asset: 'a', simplify: 2 }] })).toContain('simplify must be at most 1 (got 2)');
    expect(fail(texturesFile, { textures: [{ texture: 'x', size: 4 }] })).toContain('size must be at least 8 (got 4)');
  });
  it('a union whose every branch fails at the top says the union type', () => {
    const text = fail(assetsFile, sprite({ anim: 12 }));
    expect(text).toContain('anim must be text | Anim entry | Template entry | [text | Anim entry | Template entry, …] (got 12). anim: Clip names');
  });
});

describe('cross-field rules', () => {
  it('states next to anim', () => expect(fail(assetsFile, sprite({ states: 'auto', anim: ['idle'] }))).toContain('states are the sprite\'s moves: leave out anim, set and class'));
  it('an unknown moveset', () => expect(fail(assetsFile, sprite({ class: 'rifle,lazer' }))).toContain('unknown moveset "lazer" (movesets: unarmed, sword'));
  it('two sprites of one name', () => expect(fail(assetsFile, { sprites: [sprite({}).sprites[0], { name: 'Hero', asset: 'x' }] })).toContain('two sprites are named "Hero" (sprites[0] and sprites[1])'));
  it('a tileset pair naming an undeclared terrain', () => {
    expect(fail(assetsFile, { sprites: [], tilesets: [{ name: 't', terrains: ['grass'], pairs: [['grass', 'mud']] }] })).toContain('pairs[0] names terrain "mud", which the tileset doesn\'t declare (grass)');
  });
  it('models: a built kind with asset fields', () => {
    expect(fail(modelsFile, { models: [{ name: 's', skydome: { preset: 'desert' }, clips: ['Idle'] }] })).toContain('a skydome is built, not loaded: it takes skydome, collider, name, texSize, texFormat, compress, not clips');
  });
  it('models: a preset that does not take a parameter', () => {
    expect(fail(modelsFile, { models: [{ name: 's', trackpiece: { preset: 'straight', radius: 3 } }] })).toContain('preset straight does not take "radius" (it takes length)');
  });
  it('models: lods must fall, tint not with variants', () => {
    expect(fail(modelsFile, { models: [{ asset: 'a', lods: [0.2, 0.5] }] })).toContain('lods: must fall');
    expect(fail(modelsFile, { models: [{ asset: 'a', tint: '#ff0000', variants: [{ name: 'red', tint: '#ff0000' }] }] })).toContain('give each variant its tint, not tint as well');
  });
  it('models: a name is needed when the asset is an id', () => expect(fail(modelsFile, { models: [{ asset: 12 }] })).toContain('name is missing (needed when asset is an id)'));
  it('textures: two of one name', () => expect(fail(texturesFile, { textures: [{ name: 'a', texture: 'x' }, { name: 'A', texture: 'y' }] })).toContain('the name "A" is used twice'));
});

describe('assertValid', () => {
  it('throws a DeclarationError whose message lists every error with the file name', () => {
    expect(() => assertValid(assetsFile, sprite({ ppmm: 1, fps: 'x' }), 'ssg.assets.json')).toThrow(DeclarationError);
    try {
      assertValid(assetsFile, sprite({ ppmm: 1, fps: 'x' }), 'ssg.assets.json');
    } catch (e) {
      const err = e as DeclarationError;
      expect(err.errors).toHaveLength(2);
      expect(err.message.split('\n')).toHaveLength(2);
      expect(err.message).toMatch(/^ssg\.assets\.json: sprites\[0\] \(hero\)/);
    }
  });
  it('returns the value when valid', () => expect(assertValid(texturesFile, { textures: [{ texture: 'x' }] })).toEqual({ textures: [{ texture: 'x' }] }));
});

describe('nearest', () => {
  it('finds close keys only', () => {
    expect(nearest('ppmm', ['ppm', 'fps', 'frame'])).toBe('ppm');
    expect(nearest('texsize', ['texSize', 'texFormat'])).toBe('texSize');
    expect(nearest('zzzzzz', ['ppm', 'fps'])).toBeUndefined();
  });
});
