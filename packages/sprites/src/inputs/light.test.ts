// Moved from synty-sprite-generator packages/shared/src/light.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import {
  DAY_AZIMUTH, DAY_ELEVATION, LIGHT_PRESETS, isDayLight, lightGradeTable, lightLabel, lightPresetOf, lightTint, normalizeLight, parseLight, resolveLight,
} from './light.js';


describe('lighting (FB-060)', () => {
  it('unset light is exactly the light sprites always had', () => {
    const r = resolveLight(null);
    expect(r).toMatchObject({ ambient: '#ffffff', ground: '#7a7068', ambientIntensity: 1.9, key: '#ffffff', keyIntensity: 1.6, position: [-4, 8, 6], shadowOpacity: 0.28 });
    expect(resolveLight({ preset: 'day' })).toEqual(r);
    expect(DAY_AZIMUTH).toBeCloseTo(-33.69, 2);
    expect(DAY_ELEVATION).toBeCloseTo(47.97, 2);
    // Giving the day angles explicitly lands on the same spot.
    const p = resolveLight({ azimuth: DAY_AZIMUTH, elevation: DAY_ELEVATION }).position;
    p.forEach((c, i) => expect(c).toBeCloseTo([-4, 8, 6][i], 9));
  });

  it('parses presets and overrides, and stores nothing for plain day', () => {
    expect(parseLight('dusk')).toEqual({ preset: 'dusk' });
    expect(parseLight('Desert noon')).toEqual({ preset: 'desert_noon' });
    expect(lightPresetOf('desert-noon')).toBe('desert_noon');
    expect(parseLight('day')).toBeNull();
    expect(parseLight(undefined)).toBeNull();
    expect(parseLight({ preset: 'day' })).toBeNull();
    expect(parseLight({ preset: 'night', key: '#AABBCC', key_intensity: '0.4', azimuth: 270 })).toEqual({ preset: 'night', key: '#aabbcc', keyIntensity: 0.4, azimuth: -90 });
    // Day with overrides keeps the overrides (no preset key).
    expect(parseLight({ preset: 'day', elevation: 20 })).toEqual({ elevation: 20 });
    expect(() => parseLight('dusky')).toThrow(/unknown light "dusky".*dusk, night/);
    expect(() => parseLight({ ambient: 'blue' })).toThrow(/ambient must be a colour/);
    expect(() => parseLight({ elevation: 0 })).toThrow(/elevation must be 1–90/);
    expect(() => parseLight({ sunset: 1 })).toThrow(/unknown key "sunset"/);
    expect(isDayLight({ preset: 'day' })).toBe(true);
    expect(lightLabel(null)).toBe('day');
    expect(lightLabel({ preset: 'dusk', keyIntensity: 2 })).toBe('dusk (keyIntensity 2)');
    for (const id of LIGHT_PRESETS) expect(() => resolveLight({ preset: id })).not.toThrow();
  });

  it('presets move the sun and colour the light', () => {
    const dusk = resolveLight({ preset: 'dusk' });
    expect(dusk.elevation).toBeLessThan(DAY_ELEVATION); // a lower sun than day (40°, still inside the frame)
    expect(dusk.position[1]).toBeLessThan(8); // lower than day (8)
    expect(dusk.position[0]).toBeLessThan(0); // still from the left
    const night = resolveLight({ preset: 'night' });
    expect(night.keyIntensity).toBeLessThan(1);
    expect(night.shadowOpacity).toBeLessThan(0.28);
    // A light from the right is on the right (the renderer no longer forces the key light to the left).
    expect(resolveLight({ azimuth: 90 }).position[0]).toBeGreaterThan(7);
  });

  it('tints the ground like the light: day is identity, dusk warm and dark, night blue and dark', () => {
    expect(lightTint(null)).toEqual([1, 1, 1]);
    expect(lightGradeTable(null)).toBeNull();
    expect(lightGradeTable({ preset: 'day' })).toBeNull();
    const [r, g, b] = lightTint({ preset: 'dusk' });
    expect(Math.max(r, g, b)).toBeLessThan(1);
    expect(r).toBeGreaterThan(g); // warm
    const n = lightTint({ preset: 'night' });
    expect(n[2]).toBeGreaterThan(n[0]); // blue
    expect(n[0] + n[1] + n[2]).toBeLessThan(r + g + b); // darker than dusk
    const t = lightGradeTable({ preset: 'dusk' })!;
    expect(t[255]).toBeLessThan(255);
    expect(t[0]).toBe(0);
  });

  it('normalises a light with its preset first', () => {
    expect(normalizeLight({ keyIntensity: 1, preset: 'dusk' })).toEqual({ preset: 'dusk', keyIntensity: 1 });
  });
  // The sprite-spec / batch / tileset tests of the old light.test.ts stayed with the Studio state and the tilesets (P4).
});
