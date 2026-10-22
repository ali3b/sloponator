// Moved from synty-sprite-generator packages/shared/src/export/groundSpeed.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { estimateGroundSpeed, isLocomotionClip, resolveClipSpeed, type GroundSpeedInput, type TrackPoint } from './groundSpeed.js';

/**
 * A synthetic gait: each contact point is planted for `stance` of the cycle, sliding backwards at `speed` (in place),
 * then swings forward through the air. `phase` offsets the point in the cycle (0.5 for the other foot).
 */
function gait(o: { speed: number; cycle: number; stance: number; fps: number; lift: number; rest?: number; rootMotion?: boolean; dir?: [number, number]; scale?: number }) {
  const n = Math.round(o.cycle * o.fps);
  const times = Array.from({ length: n }, (_, i) => (i / n) * o.cycle);
  const [dx, dz] = o.dir ?? [0, 1];
  const L = o.speed * o.stance * o.cycle; // distance a planted foot slides
  const s = o.scale ?? 1;
  const rest = o.rest ?? 0.08;
  const point = (t: number, phase: number, side: number): TrackPoint => {
    const u = (t / o.cycle + phase) % 1;
    let along: number, y: number;
    if (u < o.stance) {
      along = L / 2 - (u / o.stance) * L;
      y = rest;
    } else {
      const w = (u - o.stance) / (1 - o.stance);
      along = -L / 2 + w * L;
      y = rest + o.lift * Math.sin(Math.PI * w);
    }
    const travel = o.rootMotion ? o.speed * t : 0;
    return [s * (dx * (along + travel) + side * 0.1 * dz), s * y, s * (dz * (along + travel) - side * 0.1 * dx)];
  };
  const hips = times.map((t): TrackPoint => {
    const travel = o.rootMotion ? o.speed * t : 0;
    return [s * dx * travel, s * (0.95 + 0.02 * Math.sin((4 * Math.PI * t) / o.cycle)), s * dz * travel];
  });
  const feet = [0, 0.5].map((phase, k) => times.map((t) => point(t, phase, k ? 1 : -1)));
  return { times, duration: o.cycle, loop: true, hips, contacts: feet } satisfies GroundSpeedInput;
}

describe('estimateGroundSpeed', () => {
  it('measures an in-place walk from the planted feet', () => {
    const v = estimateGroundSpeed(gait({ speed: 1.4, cycle: 1.1, stance: 0.6, fps: 60, lift: 0.15 }))!;
    expect(v).toBeGreaterThan(1.3);
    expect(v).toBeLessThan(1.5);
  });

  it('measures an in-place run (short stance, long flight)', () => {
    const v = estimateGroundSpeed(gait({ speed: 4.2, cycle: 0.7, stance: 0.35, fps: 60, lift: 0.35 }))!;
    expect(v).toBeGreaterThan(3.9);
    expect(v).toBeLessThan(4.5);
  });

  it('still lands close at sprite frame rates', () => {
    const v = estimateGroundSpeed(gait({ speed: 1.5, cycle: 1, stance: 0.6, fps: 12, lift: 0.15 }))!;
    expect(v).toBeGreaterThan(1.2);
    expect(v).toBeLessThan(1.8);
  });

  it('is the same whichever way the clip travels (a strafe along X)', () => {
    const v = estimateGroundSpeed(gait({ speed: 2, cycle: 0.9, stance: 0.55, fps: 60, lift: 0.15, dir: [Math.SQRT1_2, -Math.SQRT1_2] }))!;
    expect(v).toBeCloseTo(2, 1);
  });

  it('uses the hips travel when the clip has root motion', () => {
    const v = estimateGroundSpeed(gait({ speed: 1.6, cycle: 1, stance: 0.6, fps: 30, lift: 0.15, rootMotion: true }))!;
    expect(v).toBeCloseTo(1.6, 2);
  });

  it('measures in the units it is given: a centimetre rig reads 100× (the caller passes metres)', () => {
    const v = estimateGroundSpeed(gait({ speed: 1.4, cycle: 1, stance: 0.6, fps: 60, lift: 0.15, scale: 100 }))!;
    expect(v / 100).toBeCloseTo(1.4, 1);
  });

  it('crawl: ignores feet dragged the whole time and measures the planted hands', () => {
    const g = gait({ speed: 0.5, cycle: 1.2, stance: 0.5, fps: 60, lift: 0.08, rest: 0.05 });
    // Feet lie on the ground all along (no stance phases to read), moving with the body.
    const feet = g.times.map((): TrackPoint => [0, 0.1, -0.9]);
    const v = estimateGroundSpeed({ ...g, contacts: [feet, feet.map((p): TrackPoint => [0.2, p[1], p[2]]), ...g.contacts] })!;
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.55);
  });

  it('skips points that never reach the floor (hands swinging in a walk)', () => {
    const g = gait({ speed: 1.4, cycle: 1, stance: 0.6, fps: 60, lift: 0.15 });
    const hand = g.times.map((t): TrackPoint => [0.3, 0.9, 2 * Math.sin(2 * Math.PI * t)]); // fast, but in the air
    const v = estimateGroundSpeed({ ...g, contacts: [...g.contacts, hand] })!;
    expect(v).toBeCloseTo(1.4, 1);
  });

  it('gives nothing for an idle (feet planted throughout)', () => {
    const times = Array.from({ length: 30 }, (_, i) => i / 30);
    const hips = times.map((t): TrackPoint => [0, 0.95 + 0.01 * Math.sin(t * 6), 0]);
    const feet = [-0.1, 0.1].map((x) => times.map((): TrackPoint => [x, 0.08, 0]));
    expect(estimateGroundSpeed({ times, duration: 1, loop: true, hips, contacts: feet })).toBeNull();
  });

  it('gives nothing for too few samples', () => {
    expect(estimateGroundSpeed({ times: [0, 0.1], duration: 0.2, loop: true, hips: [[0, 1, 0], [0, 1, 0]], contacts: [] })).toBeNull();
  });
});

describe('isLocomotionClip', () => {
  it('knows travel cycles', () => {
    for (const n of ['rifle_walk', 'rifle_run', 'rifle_crawl', 'crouch_walk', 'Walk_F', 'A_Run_F_Masc', 'Sprint', 'Strafe_L', 'rifle_walk_shoot', 'Jog_Fwd']) {
      expect(isLocomotionClip(n, true), n).toBe(true);
    }
  });
  it('rejects one-shots and standing clips', () => {
    for (const n of ['rifle_idle', 'rifle_shoot', 'rifle_death', 'rifle_reload', 'walk_to_idle', 'Turn_L']) expect(isLocomotionClip(n, true), n).toBe(false);
    expect(isLocomotionClip('run_stop', false)).toBe(false);
    expect(isLocomotionClip('rifle_run', false)).toBe(false);
  });
});

describe('resolveClipSpeed', () => {
  it('writes the measured speed for locomotion, rounded to cm/s', () => {
    expect(resolveClipSpeed({ name: 'rifle_walk', loop: true, measured: 1.4271 })).toBe(1.43);
  });
  it('never writes one for non-locomotion (FB-008: death had 24.9)', () => {
    expect(resolveClipSpeed({ name: 'rifle_death', loop: false, measured: 1.8 })).toBeUndefined();
    expect(resolveClipSpeed({ name: 'rifle_idle', loop: true, measured: 0.2 })).toBeUndefined();
  });
  it('leaves it out when nothing could be measured', () => {
    expect(resolveClipSpeed({ name: 'rifle_run', loop: true, measured: null })).toBeUndefined();
  });
  it('a template-declared speed wins over measuring, and needs no locomotion name', () => {
    expect(resolveClipSpeed({ name: 'crawl', loop: true, declared: 0.6, measured: 2 })).toBe(0.6);
    expect(resolveClipSpeed({ name: 'Crawl (procedural)', loop: true, declared: 0.6 })).toBe(0.6);
  });
  it('rejects speeds outside believable on-foot range', () => {
    expect(resolveClipSpeed({ name: 'rifle_run', loop: true, measured: 40 })).toBeUndefined();
    expect(resolveClipSpeed({ name: 'rifle_walk', loop: true, measured: 0.02 })).toBeUndefined();
  });
});
