// Moved from synty-sprite-generator packages/shared/src/export/portrait.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { BUST_BELOW_NECK, BUST_HEADROOM, bustFraming, parsePortrait, portraitLabel, portraitWorldAngle, resolvePortrait } from './portrait.js';

describe('portrait spec (SF-FB-021)', () => {
  it('parses true, sizes, token strings and objects', () => {
    expect(parsePortrait(true)).toEqual({});
    expect(parsePortrait(undefined)).toBeNull();
    expect(parsePortrait(false)).toBeNull();
    expect(parsePortrait('off')).toBeNull();
    expect(parsePortrait(128)).toEqual({ size: 128 });
    expect(parsePortrait('320x400,front,#203040')).toEqual({ width: 320, height: 400, angle: 0, background: '#203040' });
    expect(parsePortrait('256 3/4 transparent pitch=10 clip=Idle')).toEqual({ size: 256, angle: 35, background: null, pitch: 10, clip: 'Idle' });
    expect(parsePortrait('-20deg')).toEqual({ angle: -20 });
    expect(parsePortrait('angle=three_quarter_left,bg=#fff')).toEqual({ angle: -35, background: '#fff' });
    expect(parsePortrait({ size: 192, angle: 'side', background: 'transparent' })).toEqual({ size: 192, angle: 90, background: null });
  });

  it('refuses what it cannot use, with the way to say it', () => {
    expect(() => parsePortrait(8)).toThrow(/whole number of pixels from 16 to 2048/);
    expect(() => parsePortrait('sideways')).toThrow(/portrait angle is degrees/);
    expect(() => parsePortrait({ colour: 'red' })).toThrow(/unknown portrait key colour/);
    expect(() => parsePortrait({ background: 'red' })).toThrow(/hex colour/);
    expect(() => parsePortrait({ pitch: 80 })).toThrow(/0\.\.60/);
  });

  it('fills defaults: 256 square, three-quarter, level, transparent', () => {
    expect(resolvePortrait({})).toEqual({ width: 256, height: 256, angle: 35, pitch: 0, background: null, clip: null });
    expect(resolvePortrait({ width: 200 })).toMatchObject({ width: 200, height: 200 });
    expect(portraitLabel({})).toBe('portrait 256×256 3/4 transparent');
    expect(portraitLabel({ size: 128, angle: 0, background: '#000' })).toBe('portrait 128×128 front #000');
    expect(portraitLabel(null)).toBeNull();
  });

  it('turns front towards the camera (south) and three-quarter towards screen right', () => {
    expect(portraitWorldAngle(0)).toBe(270);
    expect(portraitWorldAngle(35)).toBe(305);
    expect(portraitWorldAngle(-35)).toBe(235);
    expect(portraitWorldAngle(90)).toBe(0);
  });
});

describe('bust framing (SF-FB-021)', () => {
  // A 1.8 m character: neck joint 1.50 m, head joint 1.58 m, crown 1.78 m, shoulders 1.45 m at ±0.18 m.
  const bust = { head: { x: 0.02, y: 1.58 }, neck: { x: 0, y: 1.5 }, crown: 1.78, shoulders: [{ x: -0.18, y: 1.45 }, { x: 0.18, y: 1.45 }] };

  it('frames from just above the crown down to the upper chest', () => {
    const f = bustFraming(bust, 256, 256);
    const hh = 1.78 - 1.5;
    const top = f.centreY + f.viewHalfH, bottom = f.centreY - f.viewHalfH;
    expect(top).toBeCloseTo(1.78 + BUST_HEADROOM * hh, 6);
    // Down to the lower of the neck's line (1.5 − 0.95·hh) and the shoulders' (1.45 − 0.55·hh).
    expect(bottom).toBeCloseTo(Math.min(1.5 - BUST_BELOW_NECK * hh, 1.45 - 0.55 * hh), 6);
    // The whole head and both shoulder joints are in view; the feet and hips are not.
    expect(top).toBeGreaterThan(1.78);
    expect(bottom).toBeLessThan(1.45);
    expect(bottom).toBeGreaterThan(1.0);
    expect(f.viewHalfW).toBeCloseTo(f.viewHalfH, 9);
    expect(Math.abs(f.centreX)).toBeLessThan(0.05);
    expect(f.ppm).toBeCloseTo(256 / (top - bottom), 6);
  });

  it("keeps the head's share of the image whatever the character's size, and follows its aspect", () => {
    const scaled = { head: { x: 0.01, y: 0.79 }, neck: { x: 0, y: 0.75 }, crown: 0.89, shoulders: [{ x: -0.09, y: 0.725 }, { x: 0.09, y: 0.725 }] };
    const a = bustFraming(bust, 256, 256), b = bustFraming(scaled, 256, 256);
    expect(b.viewHalfH * 2).toBeCloseTo(a.viewHalfH, 6);
    const wide = bustFraming(bust, 400, 200);
    expect(wide.viewHalfW / wide.viewHalfH).toBeCloseTo(2, 9);
  });

  it('centres on the face when the head leans to one side', () => {
    const lean = { ...bust, head: { x: 0.12, y: 1.57 }, neck: { x: 0.06, y: 1.5 } };
    const f = bustFraming(lean, 256, 256);
    expect(f.centreX).toBeGreaterThan(0.05);
    expect(f.centreX).toBeLessThan(0.12);
  });

  it('works without shoulder joints', () => {
    const f = bustFraming({ ...bust, shoulders: [] }, 128, 160);
    expect(f.centreY - f.viewHalfH).toBeCloseTo(1.5 - BUST_BELOW_NECK * (1.78 - 1.5), 6);
  });
});
