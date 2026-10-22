// Ported from synty-sprite-generator packages/client/src/sprites.test.ts (P2, ali3b/sloponator#8): the pure helpers.
import { describe, expect, it } from 'vitest';
import { describeDefaults, profileFor, templateDefaults, withTileScale, wizKindOf } from '../../src/plan/sprites.js';
import { defaultProjectDefaults } from '../../src/plan/spriteSpec.js';

describe('templateDefaults', () => {
  it('mirrors the New project dialog', () => {
    const d = templateDefaults('tpl_phaser_pixel_platformer');
    expect(d).toMatchObject({ viewCardId: 'side2', lookId: 'pixel', sizeId: 'small', profileId: 'phaser3' });
    expect(d.view.directions).toBe('2');
    expect(d.view.quality?.style).toBe('pixel');
    expect(d.view.frameWidth).toBe(64);
    expect(templateDefaults('tpl_godot_topdown')).toMatchObject({ viewCardId: 'topdown8', lookId: 'clean', sizeId: 'medium', profileId: 'godot4' });
    expect(() => templateDefaults('tpl_nope')).toThrow(/Unknown project template "tpl_nope"\. Templates: tpl_godot_topdown/);
  });

  it('accepts the template name too', () => {
    expect(templateDefaults('Unity isometric game').profileId).toBe('unity');
  });
});

describe('describe helpers', () => {
  it('describeDefaults names the view, look, size and engine in plain words', () => {
    expect(describeDefaults(defaultProjectDefaults())).toBe('Top-down, 8 directions · Clean · Medium · Any engine (PNG + JSON)');
    expect(describeDefaults(templateDefaults('tpl_phaser_pixel_platformer'))).toBe('Side-scroller · Pixel art · Small · Phaser 3');
    expect(describeDefaults(withTileScale(defaultProjectDefaults(), '64x32'))).toBe('Top-down, 8 directions · Clean · tile lock 64×32 (1 m) · Any engine (PNG + JSON)');
  });

  it('wizKindOf maps library kinds onto the Wizard kinds', () => {
    expect(['character', 'vehicle', 'attachment', 'weapon', 'prop', 'fx', 'multipart', 'rigged', 'other'].map((k) => wizKindOf(k))).toEqual(['character', 'vehicle', 'weapon', 'weapon', 'object', 'prop', 'object', 'character', 'prop']);
    // Scenery is an object (real scale); pickups and effects stay props (fitted to the frame).
    expect(wizKindOf('prop', 'SM_Bld_Bunker_01')).toBe('object');
    expect(wizKindOf('prop', 'SM_Prop_Coin_01')).toBe('prop');
    expect(wizKindOf('prop', 'FX_Healthcube_01')).toBe('prop');
    expect(wizKindOf('prop', 'SM_Item_Key_01')).toBe('prop');
    expect(wizKindOf('prop', 'SM_Prop_Keyboard_01')).toBe('object');
  });

  it('profileFor finds built-in formats by id, name or engine word', () => {
    expect(profileFor('phaser3').id).toBe('phaser3');
    expect(profileFor('Godot 4').id).toBe('godot4');
    expect(() => profileFor('blender')).toThrow(/Unknown format "blender"/);
  });
});
