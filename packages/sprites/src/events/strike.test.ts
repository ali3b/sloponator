// Moved from synty-sprite-generator packages/shared/src/export/strike.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { annotateStrikes, detectStrike, fastestStrike, strikeAt, type StrikeLimb } from './strike.js';
import { bodyBoxes, flipBox } from './bodyBoxes.js';
import { keyEventName } from '../inputs/combat.js';
import type { TrackPoint } from './groundSpeed.js';
// Hands, feet and head of Character_MercenaryMale_01 in the Mixamo MartialArts_* attacks at 12 fps (side view, metres
// from the feet pivot: y up, z forward), read back from a Sidefighter export's per-frame sockets. Crouch_Punch is
// trimmed from 0.85 s and Crouch_Kick from 0.4 s in that export.
import fixture from './strike.fixture.json';

type Tracks = Record<StrikeLimb | 'head', TrackPoint[]>;
const real = fixture as unknown as Record<string, Tracks>;
const run = (t: Tracks) => detectStrike({ limbs: { hand_l: t.hand_l, hand_r: t.hand_r, foot_l: t.foot_l, foot_r: t.foot_r } });
/** The frame the limb is furthest forward (the socket peak a game would read off). */
const forwardPeak = (track: TrackPoint[]) => track.reduce((best, p, i) => (p[2] > track[best][2] ? i : best), 0);

describe('detectStrike (SF-FB-007)', () => {
  it('puts a kick\'s hit on the kicking foot at its furthest reach', () => {
    const heavy = run(real.kick_heavy)!;
    expect(heavy.limb).toBe('foot_r');
    expect(Math.abs(heavy.frame - 9)).toBeLessThanOrEqual(1); // the foot peaks at 9 (the old auto hit said 13)
    expect(Math.abs(heavy.frame - forwardPeak(real.kick_heavy.foot_r))).toBeLessThanOrEqual(1);
    const light = run(real.kick_light)!;
    expect(light.limb).toBe('foot_l');
    expect(light.frame).toBeGreaterThanOrEqual(13);
    expect(light.frame).toBeLessThanOrEqual(15); // peak at 14-15 (old: 12)
    const sweep = run(real.crouch_kick)!; // trimmed from 0.4 s: the sweep's peak (10-11 untrimmed) is frame 6
    expect(sweep.limb).toBe('foot_r');
    expect(Math.abs(sweep.frame - forwardPeak(real.crouch_kick.foot_r))).toBeLessThanOrEqual(1);
  });

  it('finds the punching hand, the uppercut and the special', () => {
    // Without the hips in the fixture the body's dip shows in the hands: within a frame of the fist's peak reach.
    const jab = run(real.punch_light)!;
    expect(jab.limb).toBe('hand_l');
    expect(Math.abs(jab.frame - 5)).toBeLessThanOrEqual(1);
    expect(run(real.punch_heavy)).toMatchObject({ limb: 'hand_r', frame: 8 });
    const upper = run(real.uppercut)!;
    expect(upper.limb).toBe('hand_r');
    expect(Math.abs(upper.frame - 8)).toBeLessThanOrEqual(1);
    const special = run(real.special)!;
    expect(special.limb).toBe('hand_r');
    expect(Math.abs(special.frame - forwardPeak(real.special.hand_r))).toBeLessThanOrEqual(1);
  });

  it('gives every hit a window of at least two frames that ends where the limb pulls back', () => {
    for (const [move, t] of Object.entries(real)) {
      const s = run(t);
      if (!s) continue;
      expect(s.endFrame, move).toBeGreaterThan(s.frame);
      expect(s.endFrame, move).toBeLessThan(t.hand_l.length);
    }
    const heavy = run(real.kick_heavy)!;
    expect(heavy.endFrame).toBeLessThanOrEqual(11); // the foot is back on the floor by 12
  });

  it('counts an arm swinging back half: the kick, not the balancing arm', () => {
    // A foot that kicks 0.9 m forward, a hand that swings 1.2 m backward at the same time.
    const n = 10;
    const still = (p: TrackPoint) => Array.from({ length: n }, () => p);
    const out = (from: TrackPoint, d: TrackPoint, peak: number) => Array.from({ length: n }, (_, i): TrackPoint => {
      const k = Math.max(0, 1 - Math.abs(i - peak) / 3);
      return [from[0] + d[0] * k, from[1] + d[1] * k, from[2] + d[2] * k];
    });
    const s = detectStrike({ limbs: { hand_l: out([0, 1.2, 0.3], [0, -0.3, -1.2], 4), hand_r: still([0, 1.2, 0.2]), foot_l: still([0, 0.05, 0.3]), foot_r: out([0, 0.05, -0.3], [0, 0.4, 0.9], 5) } });
    expect(s).toMatchObject({ limb: 'foot_r', frame: 5 });
  });

  it('measures relative to the hips: a jump or a lunge does not make the feet strike', () => {
    const n = 12;
    const hips = Array.from({ length: n }, (_, i): TrackPoint => [0, 0.95 + 0.5 * Math.sin((Math.PI * i) / (n - 1)), 0.05 * i]);
    const rel = (p: TrackPoint) => hips.map((h): TrackPoint => [h[0] + p[0], h[1] + p[1], h[2] + p[2]]);
    const punch = hips.map((h, i): TrackPoint => [h[0], h[1] + 0.4, h[2] + 0.2 + (i === 7 ? 0.5 : i === 6 || i === 8 ? 0.3 : 0)]);
    const s = detectStrike({ hips, limbs: { hand_l: rel([0.1, 0.4, 0.2]), hand_r: punch, foot_l: rel([0.1, -0.88, 0]), foot_r: rel([-0.1, -0.88, 0]) } });
    expect(s).toMatchObject({ limb: 'hand_r', frame: 7 });
  });

  it('gives a stance with no real strike nothing', () => {
    const n = 8;
    const sway = (p: TrackPoint) => Array.from({ length: n }, (_, i): TrackPoint => [p[0], p[1] + 0.03 * Math.sin(i), p[2] + 0.04 * Math.cos(i)]);
    expect(detectStrike({ limbs: { hand_l: sway([0, 1.2, 0.3]), hand_r: sway([0, 1.2, 0.2]), foot_l: sway([0, 0.05, 0.3]), foot_r: sway([0, 0.05, -0.3]) } })).toBeNull();
  });
});

describe('strikeAt / fastestStrike', () => {
  it('names the limb out furthest at a hand-set hit and measures its window', () => {
    const t = real.kick_heavy;
    const s = strikeAt({ limbs: { hand_l: t.hand_l, hand_r: t.hand_r, foot_l: t.foot_l, foot_r: t.foot_r } }, 8)!;
    expect(s.limb).toBe('foot_r');
    expect(s.frame).toBe(8);
    expect(s.endFrame).toBeGreaterThan(8);
  });

  it('a weapon strikes where its tip moves fastest, active while it keeps half that speed', () => {
    const tip: TrackPoint[] = [0, 0, 0.05, 0.3, 0.8, 1.2, 1.3, 1.32, 1.33].map((z): TrackPoint => [0, 1, z]);
    expect(fastestStrike(tip, 'hand_r')).toMatchObject({ frame: 4, endFrame: 5, limb: 'hand_r' });
  });
});

describe('annotateStrikes (SF-FB-008)', () => {
  const strike = (frame: number) => ({ frame, endFrame: frame + 2, limb: 'foot_r' as const, reach: 1 });
  it('adds the limb and a hit_end window to an automatic hit', () => {
    expect(annotateStrikes([{ frame: 9, name: 'hit' }, { frame: 2, name: 'footstep_l' }], strike, true)).toEqual([
      { frame: 2, name: 'footstep_l' }, { frame: 9, name: 'hit', limb: 'foot_r', endFrame: 11 }, { frame: 11, name: 'hit_end' },
    ]);
  });
  it('keeps a hit_end set by hand as the window\'s end', () => {
    expect(annotateStrikes([{ frame: 9, name: 'hit' }, { frame: 10, name: 'hit_end' }], strike, true)).toEqual([
      { frame: 9, name: 'hit', limb: 'foot_r', endFrame: 10 }, { frame: 10, name: 'hit_end' },
    ]);
  });
  it('cleared events (no automatic ones): the limb, but no made-up hit_end', () => {
    expect(annotateStrikes([{ frame: 9, name: 'hit' }], strike, false)).toEqual([{ frame: 9, name: 'hit', limb: 'foot_r' }]);
  });
  it('a combo: each hit ends before the next one starts', () => {
    const out = annotateStrikes([{ frame: 3, name: 'hit' }, { frame: 4, name: 'hit' }], strike, true);
    expect(out.filter((e) => e.name === 'hit').map((e) => e.endFrame)).toEqual([3, 6]);
  });
});

describe('keyEventName: every martial-arts attack gets a hit', () => {
  it.each(['MartialArts_Punch_Light', 'MartialArts_Kick_Heavy', 'MartialArts_Crouch_Kick', 'MartialArts_Jump_Kick', 'MartialArts_Uppercut', 'MartialArts_Special'])('%s', (clip) => {
    expect(keyEventName(clip)).toBe('hit');
  });
  it('but not the reactions and stances', () => {
    expect(keyEventName('MartialArts_Hit_Head')).toBe('hurt');
    expect(keyEventName('MartialArts_Swept')).toBeNull();
    expect(keyEventName('MartialArts_Idle')).toBeNull();
    expect(keyEventName('MartialArts_Taunt')).toBeNull();
  });
});

describe('bodyBoxes (SF-FB-009)', () => {
  // A standing figure at 100 px/m, feet at y = 200 (y down).
  const joints = {
    hips: { x: 100, y: 105 }, spine1: { x: 100, y: 95 }, spine2: { x: 100, y: 80 }, spine3: { x: 100, y: 65 }, neck: { x: 100, y: 50 },
    head: { x: 100, y: 42 }, head_top: { x: 100, y: 25 }, upperarm_l: { x: 82, y: 58 }, upperarm_r: { x: 118, y: 58 },
    thigh_l: { x: 90, y: 108 }, thigh_r: { x: 110, y: 108 }, calf_l: { x: 90, y: 150 }, calf_r: { x: 110, y: 150 },
    foot_l: { x: 90, y: 192 }, foot_r: { x: 110, y: 192 }, toe_l: { x: 100, y: 198 }, toe_r: { x: 120, y: 198 },
    hand_r: { x: 190, y: 60 }, // a punch: not part of any box
  };
  it('bounds the head, torso and legs, padded at the body\'s scale, and leaves the arms out', () => {
    const b = bodyBoxes(joints, 100);
    expect(b.head).toEqual({ x: 90, y: 15, w: 20, h: 37 });
    expect(b.torso).toEqual({ x: 74, y: 42, w: 52, h: 74 });
    expect(b.legs).toEqual({ x: 83, y: 101, w: 44, h: 104 });
    expect(b.torso!.x + b.torso!.w).toBeLessThan(joints.hand_r.x);
  });
  it('leaves out boxes without joints', () => {
    expect(bodyBoxes({ head: { x: 1, y: 1 } }, 100)).toEqual({ head: { x: -9, y: -9, w: 20, h: 20 } });
    expect(bodyBoxes({}, 100)).toEqual({});
  });
  it('flips a box for a mirrored animation', () => {
    expect(flipBox({ x: 10, y: 5, w: 20, h: 30 }, 100)).toEqual({ x: 70, y: 5, w: 20, h: 30 });
  });
});
