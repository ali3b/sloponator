// Moved from synty-sprite-generator packages/shared/src/export/strikeCombo.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { annotateStrikes, detectStrike, detectStrikes, maxWindowFrames, strikeAt, STRIKE_LIMBS, type StrikeInput, type StrikeLimb } from './strike.js';
import type { TrackPoint } from './groundSpeed.js';
// Every socket of Character_MercenaryMale_01 in Capoeira_Kicks (whole, 17.7 s), its first 3 s (`kicks_a`, the
// ginga: swaying steps, no kick) and 11.6-14.6 s (`super`: the two handstand kicks) in a side2 export at 12 fps,
// metres from the feet pivot (y up, z forward). The whole clip's kicks are the handstand kicks at frames 151 and 167
// (12 and 29 of `super`, which throws the right arm up into the second at 22); the ginga steps the left foot
// 0.7-0.9 m forward on the floor at 29, 113 and 199.
import combo from './strike-combo.fixture.json';
import real from './strike-real.fixture.json';
import heads from './strike-head.fixture.json';

type Clip = Partial<Record<StrikeLimb | 'hips', TrackPoint[]>>;
const clips = combo as unknown as Record<string, Clip>;
const inputOf = (t: Clip): StrikeInput => ({ hips: t.hips ?? null, limbs: Object.fromEntries(STRIKE_LIMBS.filter((k) => t[k]).map((k) => [k, t[k]])) });
const CAP = maxWindowFrames(1 / 12);

describe('maxWindowFrames', () => {
  it('is 0.25 s in frames, at least one', () => {
    expect(CAP).toBe(3);
    expect(maxWindowFrames(1 / 30)).toBe(8);
    expect(maxWindowFrames(1)).toBe(1);
    expect(maxWindowFrames(0)).toBe(Infinity);
  });
});

describe('detectStrikes: one hit per strike of a combo (wave-13 follow-up)', () => {
  it('finds both handstand kicks of Capoeira_Kicks and not the ginga steps', () => {
    const s = detectStrikes(inputOf(clips.Capoeira_Kicks), CAP);
    expect(s.map((x) => [x.limb, x.frame])).toEqual([['foot_l', 151], ['foot_l', 167]]);
    for (const x of s) {
      expect(x.endFrame).toBeGreaterThan(x.frame);
      expect(x.endFrame - x.frame).toBeLessThanOrEqual(CAP);
    }
    // Trimmed to the two kicks: both, not the arm thrown up into the second handstand (frame 22).
    expect(detectStrikes(inputOf(clips.super), CAP).map((x) => [x.limb, x.frame])).toEqual([['foot_l', 12], ['foot_l', 29]]);
    // The single strike before: only the biggest.
    expect(detectStrike(inputOf(clips.Capoeira_Kicks))).toMatchObject({ limb: 'foot_l', frame: 151 });
  });

  it('ends a window before the next strike, and caps it', () => {
    // Two punches, left then right, the left still out (85 %) when the right lands.
    const n = 16;
    const bump = (at: number, w: number) => (i: number) => 0.5 * Math.max(0, 1 - Math.abs(i - at) / w);
    const arm = (x: number, f: (i: number) => number) => Array.from({ length: n }, (_, i): TrackPoint => [x, 1.3, 0.1 + f(i)]);
    const still = (p: TrackPoint) => Array.from({ length: n }, (): TrackPoint => p);
    const input: StrikeInput = {
      hips: still([0, 0.95, 0]),
      limbs: { hand_l: arm(0.15, (i) => (i >= 3 && i <= 9 ? 0.5 : bump(3, 3)(i))), hand_r: arm(-0.15, bump(8, 3)), foot_l: still([0.1, 0, 0.2]), foot_r: still([-0.1, 0, -0.2]) },
    };
    const s = detectStrikes(input);
    expect(s.map((x) => [x.limb, x.frame])).toEqual([['hand_l', 3], ['hand_r', 8]]);
    expect(s[0].endFrame).toBe(7);
    expect(detectStrikes(input, 2)[0].endFrame).toBe(5);
  });

  it('keeps every single-strike clip to one hit, at the same frame as before', () => {
    const all = { ...(real as unknown as Record<string, Clip>), ...(heads as unknown as Record<string, Clip>) };
    for (const [name, t] of Object.entries(all)) {
      if (!Array.isArray(t.hand_l)) continue;
      const input = { ...inputOf(t), head: /headbutt/i.test(name) };
      const one = detectStrike(input);
      const many = detectStrikes(input, CAP);
      expect(many.length, name).toBe(one ? 1 : 0);
      if (one) expect(many[0], name).toMatchObject({ limb: one.limb, frame: one.frame });
    }
  });
});

describe('automatic windows are capped (kicks_a 18-36)', () => {
  it('a hit set by hand at 1.5 s in Capoeira_Kicks@0:3 no longer holds to the clip\'s end', () => {
    const input = inputOf(clips.kicks_a);
    // Uncapped, the knee stays out to the trim's end: the 18-36 window of the review.
    expect(strikeAt(input, 18)!.endFrame).toBeGreaterThanOrEqual(30);
    const out = annotateStrikes([{ frame: 18, name: 'hit' }], (f) => strikeAt(input, f), true, CAP);
    expect(out).toEqual([{ frame: 18, name: 'hit', limb: 'knee_l', endFrame: 21 }, { frame: 21, name: 'hit_end' }]);
  });

  it('a hit_end set by hand keeps its length', () => {
    const input = inputOf(clips.kicks_a);
    const out = annotateStrikes([{ frame: 18, name: 'hit' }, { frame: 30, name: 'hit_end' }], (f) => strikeAt(input, f), true, CAP);
    expect(out.find((e) => e.name === 'hit')!.endFrame).toBe(30);
  });

  it('several automatic hits each get their own window and hit_end', () => {
    const input = inputOf(clips.Capoeira_Kicks);
    const hits = detectStrikes(input, CAP).map((s) => ({ frame: s.frame, name: 'hit' }));
    const out = annotateStrikes(hits, (f) => strikeAt(input, f), true, CAP);
    expect(out.map((e) => `${e.name}@${e.frame}`)).toEqual(['hit@151', 'hit_end@152', 'hit@167', 'hit_end@168']);
    expect(out.filter((e) => e.name === 'hit').every((e) => e.limb === 'foot_l')).toBe(true);
  });
});
