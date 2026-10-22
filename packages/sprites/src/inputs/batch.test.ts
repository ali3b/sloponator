// Moved from synty-sprite-generator packages/shared/src/batch.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { BUILTIN_SETS, framesEta, framesProgress, fxLookFor, guessGender, setItemLabel, type SetItem } from './batch.js';

describe('batch helpers', () => {
  it('guesses clip gender from Synty character names', () => {
    expect(guessGender('SK_Character_BusinessWoman')).toBe('Feminine');
    expect(guessGender('Character_AmericanOfficer_Female_01')).toBe('Feminine');
    expect(guessGender('SK_Character_GamerGirl')).toBe('Feminine');
    expect(guessGender('SK_Character_Grandma')).toBe('Feminine');
    expect(guessGender('SK_Character_Biker')).toBe('Masculine');
    expect(guessGender('Character_Commando_01')).toBe('Masculine');
  });

  it('labels set items', () => {
    expect(BUILTIN_SETS[0].items.map(setItemLabel)).toEqual(['idle', 'walk', 'run']);
    expect(setItemLabel({ type: 'template', layers: [{ id: 'drive', params: {} }, { id: 'doors', params: {} }] })).toBe('drive+doors');
  });
});

describe('frame progress (FB-016)', () => {
  it('estimates the time left at the rate so far', () => {
    expect(framesEta({ done: 100, total: 400, elapsedMs: 10_000 })).toBe(30);
    expect(framesEta({ done: 400, total: 400, elapsedMs: 40_000 })).toBe(0);
    expect(framesEta({ done: 0, total: 400, elapsedMs: 500 })).toBeNull();
    expect(framesEta({ done: 3, total: 0, elapsedMs: 500 })).toBeNull();
  });
  it('maps frames onto the model progress between loading and writing', () => {
    expect(framesProgress({ done: 0, total: 100 })).toBeCloseTo(0.05);
    expect(framesProgress({ done: 50, total: 100 })).toBeCloseTo(0.5);
    expect(framesProgress({ done: 100, total: 100 })).toBeCloseTo(0.95);
    expect(framesProgress({ done: 120, total: 100 })).toBeCloseTo(0.95);
  });
});

describe('fxLookFor (FB-031)', () => {
  const t = (...ids: string[]): SetItem => ({ type: 'template', layers: ids.map((id) => ({ id, params: {} })) });
  it('smoke-only sets blend normally; fire, mixed sets and an explicit blend are left alone', () => {
    expect(fxLookFor({ set: { items: [t('smoke_loop')] } }, 'fx')).toEqual({ enabled: true, blend: 'normal', intensity: 1 });
    expect(fxLookFor({ set: { items: [t('smoke_puffs'), t('smoke_loop')] } }, 'fx')?.blend).toBe('normal');
    expect(fxLookFor({ set: { items: [t('fire_loop')] } }, 'fx')).toEqual({ enabled: true });
    expect(fxLookFor({ set: { items: [t('smoke_loop'), t('fire_loop')] } }, 'fx')?.blend).toBeUndefined();
    expect(fxLookFor({ fx: { enabled: true, blend: 'add' }, set: { items: [t('smoke_loop')] } }, 'fx')?.blend).toBe('add');
    expect(fxLookFor({ fx: { enabled: true, intensity: 2 }, set: { items: [t('smoke_loop')] } }, 'prop')).toEqual({ enabled: true, intensity: 2, blend: 'normal' });
    expect(fxLookFor({ set: { items: [t('smoke_loop')] } }, 'prop')).toBeUndefined();
  });
});
