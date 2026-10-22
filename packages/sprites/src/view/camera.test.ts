// Moved from synty-sprite-generator packages/shared/src/camera.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import {
  VIEW_PRESETS, computeFraming, directionName, dirsText, parseDirs, pixelsPerMetre, projectAngle, resolveDirections, setAngles,
  unprojectAngle, yawForAngle, type ViewConfig,
} from './camera.js';

const cfg = (over: Partial<ViewConfig> = {}): ViewConfig => ({ ...VIEW_PRESETS.find((p) => p.id === 'topdown8')!.config, ...over });

describe('direction sets', () => {
  it('produce the documented angles', () => {
    expect(setAngles('1')).toEqual([270]);
    expect(setAngles('2')).toEqual([0, 180]);
    expect(setAngles('4d')).toEqual([45, 135, 225, 315]);
    expect(setAngles('6f')).toEqual([30, 90, 150, 210, 270, 330]);
    expect(setAngles('6p')).toEqual([0, 60, 120, 180, 240, 300]);
    expect(setAngles('8')).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(setAngles('32')).toHaveLength(32);
    expect(setAngles('32')[1]).toBeCloseTo(11.25);
  });
});

describe('chosen directions (FB-098)', () => {
  it('reads a direction set or direction names', () => {
    expect(parseDirs('1')).toEqual({ directions: '1' });
    expect(parseDirs(8)).toEqual({ directions: '8' });
    expect(parseDirs('4D')).toEqual({ directions: '4d' });
    expect(parseDirs('E')).toEqual({ directions: '1', angles: [0] });
    expect(parseDirs(['N', 'S'])).toEqual({ directions: '2', angles: [90, 270] });
    expect(parseDirs('n, s')).toEqual({ directions: '2', angles: [90, 270] });
    expect(parseDirs(['up_left', 'a045', 'NNE', 'NE'])).toEqual({ directions: '1', angles: [135, 45, 67.5] });
    expect(parseDirs(['N', 'E', 'S'])).toEqual({ directions: '1', angles: [90, 0, 270] });
    expect(() => parseDirs('X')).toThrow(/neither a direction count .* nor a direction name/);
    expect(() => parseDirs('7')).toThrow(/"7"/);
    expect(() => parseDirs([])).toThrow(/give a direction count/);
  });

  it('renders only the chosen directions, named as usual', () => {
    expect(resolveDirections(cfg({ directions: '1', angles: [0] })).map((d) => d.name)).toEqual(['E']);
    expect(resolveDirections(cfg({ directions: '2', angles: [270, 90] })).map((d) => d.name)).toEqual(['N', 'S']);
    // Without angles the set is used as before.
    expect(resolveDirections(cfg({ directions: '1' })).map((d) => d.name)).toEqual(['S']);
    expect(dirsText({ directions: '2', angles: [90, 270], naming: 'compass' })).toBe('N,S');
    expect(dirsText({ directions: '8', naming: 'compass' })).toBe('8');
  });
});

describe('projection', () => {
  it('a world 45° facing lands on the 2:1 iso tile diagonal (26.565°) at 30° pitch', () => {
    expect(projectAngle(45, 30)).toBeCloseTo(26.565, 3);
  });

  it('unproject inverts project at any pitch', () => {
    for (const pitch of [15, 30, 35.264, 45, 60, 80])
      for (const a of [0, 10, 45, 100, 200, 300]) expect(projectAngle(unprojectAngle(a, pitch), pitch)).toBeCloseTo(a, 4);
  });

  it('screen basis spaces directions evenly on screen; world basis does not at oblique pitch', () => {
    const screen = resolveDirections(cfg({ pitch: 30, basis: 'screen' })).map((d) => d.screenAngle);
    expect(screen).toEqual([0, 45, 90, 135, 180, 225, 270, 315].map((a) => expect.closeTo(a, 6)));
    const world = resolveDirections(cfg({ pitch: 30, basis: 'world' }));
    expect(world.map((d) => d.worldAngle)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(world[1].screenAngle).toBeCloseTo(26.565, 3);
  });

  it('yaw turns a +Z-forward asset to face the world angle', () => {
    const facing = (a: number) => [Math.round(Math.sin(yawForAngle(a))) + 0, Math.round(Math.cos(yawForAngle(a))) + 0];
    expect(facing(0)).toEqual([1, 0]); // East: +X
    expect(facing(90)).toEqual([0, -1]); // North: away from camera
    expect(facing(270)).toEqual([0, 1]); // South: faces the camera
  });
});

describe('order and naming presets', () => {
  const names = (over: Partial<ViewConfig>) => resolveDirections(cfg({ directions: '4', ...over })).map((d) => d.name);
  it('permute rows correctly', () => {
    expect(names({ order: 'ccw-e' })).toEqual(['E', 'N', 'W', 'S']);
    expect(names({ order: 'cw-n' })).toEqual(['N', 'E', 'S', 'W']);
    expect(names({ order: 'cw-s' })).toEqual(['S', 'W', 'N', 'E']);
    expect(names({ order: 'rpgmaker', naming: 'words' })).toEqual(['down', 'left', 'right', 'up']);
    expect(names({ order: 'ccw-n', naming: 'words' })).toEqual(['up', 'left', 'down', 'right']); // LPC
  });

  it('names off the compass rose fall back to degrees', () => {
    expect(directionName(30, 'compass')).toBe('a030');
    expect(directionName(22.5, 'compass')).toBe('ENE');
    expect(directionName(315, 'words')).toBe('down_right');
  });
});

describe('mirroring', () => {
  it('8 directions render 5 and mirror 3 (W-side flips of E-side)', () => {
    const d = resolveDirections(cfg({ mirror: true }));
    const byName = Object.fromEntries(d.map((x) => [x.name, x]));
    expect(d.filter((x) => x.mirrorOf === null).map((x) => x.name)).toEqual(['E', 'NE', 'N', 'S', 'SE']);
    expect(d[byName.W.mirrorOf!].name).toBe('E');
    expect(d[byName.NW.mirrorOf!].name).toBe('NE');
    expect(d[byName.SW.mirrorOf!].name).toBe('SE');
  });

  it('32 directions render 17 (the StarCraft count)', () => {
    expect(resolveDirections(cfg({ directions: '32', mirror: true })).filter((x) => x.mirrorOf === null)).toHaveLength(17);
  });

  it('works in screen basis at oblique pitch', () => {
    const d = resolveDirections(cfg({ pitch: 30, basis: 'screen', mirror: true }));
    expect(d.filter((x) => x.mirrorOf === null)).toHaveLength(5);
  });
});

describe('framing', () => {
  it('fit: side view of a 2 m character centres it and puts the pivot at the feet', () => {
    const f = computeFraming({ minY: 0, maxY: 2, radius: 0.5 }, { ...cfg({ pitch: 0, padding: 0 }), frameWidth: 100, frameHeight: 100 });
    expect(f.viewHalfH).toBeCloseTo(1);
    expect(f.pivot.y).toBeCloseTo(100);
    expect(f.ppm).toBeNull();
  });

  it('fit: bounds a few ulps apart (another page load) frame exactly the same, on a 0.1 mm grid that never cuts (G17)', () => {
    const c = { ...cfg({ pitch: 30, padding: 0.05 }), frameWidth: 128, frameHeight: 128 };
    const a = computeFraming({ minY: 0, maxY: 1.8123456789, radius: 0.4567891234 }, c);
    const b = computeFraming({ minY: 0, maxY: 1.8123456789 + 3e-8, radius: 0.4567891234 - 2e-8 }, c);
    expect(b).toEqual(a);
    expect(Math.round(a.viewHalfH * 1e4) / 1e4).toBe(a.viewHalfH);
    // Rounded up: the frame holds at least what the unrounded one did.
    const p = (30 * Math.PI) / 180;
    const top = 1.8123456789 * Math.cos(p) + 0.4567891234 * Math.sin(p), bottom = -0.4567891234 * Math.sin(p);
    expect(a.viewHalfH).toBeGreaterThanOrEqual((top - bottom) / 2 / 0.9);
  });

  it('ppm: assets of different heights share scale and pivot height above the frame bottom', () => {
    const c = cfg({ pitch: 30, scale: { mode: 'ppm', ppm: 32 }, frameWidth: 64, frameHeight: 64, padding: 2 });
    const tall = computeFraming({ minY: 0, maxY: 1.9, radius: 0.5 }, c);
    const short = computeFraming({ minY: 0, maxY: 1.5, radius: 0.5 }, c);
    expect(tall.ppm).toBe(32);
    expect(tall.frameHeight - tall.pivot.y).toBe(short.frameHeight - short.pivot.y);
    expect(Number.isInteger(tall.pivot.y)).toBe(true);
    // 1 m on screen is 32 px horizontally.
    expect(tall.frameWidth / (2 * tall.viewHalfW)).toBeCloseTo(32);
  });

  it('ppm with a fixed frame and pivot gives different assets an identical layout', () => {
    const c = cfg({ pitch: 30, scale: { mode: 'ppm', ppm: 32 }, frameWidth: 64, frameHeight: 96, padding: 2, pivotBottom: 16 });
    const a = computeFraming({ minY: 0, maxY: 1.8, radius: 0.45 }, c);
    const b = computeFraming({ minY: 0, maxY: 1.7, radius: 0.6 }, c);
    expect([a.frameWidth, a.frameHeight, a.pivot]).toEqual([b.frameWidth, b.frameHeight, b.pivot]);
    expect(a.pivot).toEqual({ x: 32, y: 80 });
  });

  it('tile: diamond tiles convert tile width to pixels per metre', () => {
    expect(pixelsPerMetre({ mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'square' })).toBe(64);
    expect(pixelsPerMetre({ mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' })).toBeCloseTo(64 / Math.SQRT2);
  });
});
