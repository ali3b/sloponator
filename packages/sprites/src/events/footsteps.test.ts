// Moved from synty-sprite-generator packages/shared/src/export/footsteps.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { detectFootsteps } from './footsteps.js';
import type { TrackPoint } from './groundSpeed.js';
import { clipAutoEvents, cleanClipEdit } from '../inputs/combat.js';
// Hips and ankles of Character_MercenaryMale_01 (metres, 30 fps) in the Mixamo MartialArts_Idle (a bouncing
// boxing stance) and MartialArts_Walk_Forward clips, as baked in place.
import fixture from './footsteps.fixture.json';

type Tracks = { hips: TrackPoint[]; l: TrackPoint[]; r: TrackPoint[] };
const real = fixture as unknown as { idle: Tracks; walk: Tracks };
const every = (t: Tracks, k: number): Tracks => ({ hips: t.hips.filter((_, i) => i % k === 0), l: t.l.filter((_, i) => i % k === 0), r: t.r.filter((_, i) => i % k === 0) });
const run = (t: Tracks) => detectFootsteps({ hips: t.hips, left: t.l, right: t.r });

/** One foot per sample over a loop: planted for `stance` (sliding back `stride` m in place), then a swing `lift` high. */
function walk(o: { n: number; stride: number; stance: number; lift: number; phase: number; side: number; rootSpeed?: number }) {
  return Array.from({ length: o.n }, (_, i): TrackPoint => {
    const u = (i / o.n + o.phase) % 1;
    const travel = (o.rootSpeed ?? 0) * (i / o.n);
    if (u < o.stance) return [o.side * 0.1, 0.08, o.stride / 2 - (u / o.stance) * o.stride + travel];
    const w = (u - o.stance) / (1 - o.stance);
    return [o.side * 0.1, 0.08 + o.lift * Math.sin(Math.PI * w), -o.stride / 2 + w * o.stride + travel];
  });
}

/** A stance bouncing on the spot: both feet hop a few cm and land where they were, the hips sway a little. */
function bounce(n: number) {
  const hips = Array.from({ length: n }, (_, i): TrackPoint => [0.03 * Math.sin((2 * Math.PI * i) / n), 0.95, 0.02 * Math.cos((2 * Math.PI * i) / n)]);
  const foot = (side: number, phase: number) =>
    Array.from({ length: n }, (_, i): TrackPoint => {
      const u = ((2 * i) / n + phase) % 1; // two hops per loop
      return [side * 0.15 + 0.01 * Math.sin(2 * Math.PI * u), 0.08 + (u > 0.6 ? 0.05 * Math.sin((Math.PI * (u - 0.6)) / 0.4) : 0), side * 0.12];
    });
  return { hips, left: foot(-1, 0), right: foot(1, 0.15) };
}

describe('detectFootsteps', () => {
  it('gives a stance bouncing on the spot no footsteps', () => {
    expect(detectFootsteps(bounce(26))).toEqual([]);
  });

  it('keeps a walk cycle\'s footsteps, one per foot per cycle', () => {
    const n = 24;
    const hips = Array.from({ length: n }, (): TrackPoint => [0, 0.95, 0]);
    const steps = detectFootsteps({ hips, left: walk({ n, stride: 0.6, stance: 0.6, lift: 0.12, phase: 0, side: -1 }), right: walk({ n, stride: 0.6, stance: 0.6, lift: 0.12, phase: 0.5, side: 1 }) });
    expect(steps.map((s) => s.name).sort()).toEqual(['footstep_l', 'footstep_r']);
    // Each lands where its swing ends: the left at the cycle start, the right half a cycle later.
    expect(steps.find((s) => s.name === 'footstep_l')!.frame).toBe(0);
    expect(steps.find((s) => s.name === 'footstep_r')!.frame).toBe(n / 2);
  });

  it('keeps footsteps when the hips carry root motion', () => {
    const n = 24, speed = 1.2;
    const hips = Array.from({ length: n }, (_, i): TrackPoint => [0, 0.95, speed * (i / n)]);
    // With root motion the hips move over the planted foot: relative to them it still slides back and swings on.
    const foot = (phase: number, side: number) => walk({ n, stride: 0.6, stance: 0.6, lift: 0.12, phase, side, rootSpeed: speed });
    expect(detectFootsteps({ hips, left: foot(0, -1), right: foot(0.5, 1) })).toHaveLength(2);
  });

  it('ignores a short shuffle under the threshold but counts it with a lower one', () => {
    const n = 24;
    const hips = Array.from({ length: n }, (): TrackPoint => [0, 0.95, 0]);
    const left = walk({ n, stride: 0.08, stance: 0.6, lift: 0.04, phase: 0, side: -1 });
    expect(detectFootsteps({ hips, left })).toEqual([]);
    expect(detectFootsteps({ hips, left, minTravel: 0.05 })).toHaveLength(1);
  });

  it('works without the hips (feet compared in the world) and without a foot', () => {
    const n = 20;
    expect(detectFootsteps({ left: walk({ n, stride: 0.5, stance: 0.6, lift: 0.1, phase: 0, side: -1 }) })).toHaveLength(1);
    expect(detectFootsteps({ left: null, right: null })).toEqual([]);
    // A foot planted the whole clip never comes down.
    expect(detectFootsteps({ left: Array.from({ length: n }, (): TrackPoint => [0, 0.08, 0]) })).toEqual([]);
  });

  describe('on the real Mixamo clips', () => {
    it('MartialArts_Idle (bouncing boxing stance) gets no footsteps at any frame rate (the old rule gave it 5)', () => {
      for (const k of [1, 2, 3]) expect(run(every(real.idle, k)), `every ${k}`).toEqual([]);
    });
    it('MartialArts_Walk_Forward keeps one footstep per foot', () => {
      for (const k of [1, 2, 3]) expect(run(every(real.walk, k)).map((s) => s.name).sort(), `every ${k}`).toEqual(['footstep_l', 'footstep_r']);
    });
  });
});

describe('clip edits and automatic events', () => {
  it('a cleared clip (autoEvents false) is kept as an edit and turns automatic events off', () => {
    const e = cleanClipEdit({ events: [], autoEvents: false });
    expect(e).toEqual({ start: null, end: null, speed: 1, events: [], autoEvents: false });
    expect(clipAutoEvents(e)).toBe(false);
  });
  it('automatic events stay on by default', () => {
    expect(clipAutoEvents(null)).toBe(true);
    expect(clipAutoEvents(cleanClipEdit({ start: 0.2, events: [] }))).toBe(true);
    expect(cleanClipEdit({ start: 0.2, autoEvents: true })).not.toHaveProperty('autoEvents');
  });
});
