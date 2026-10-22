// Moved from synty-sprite-generator packages/shared/src/export/strikeReal.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { detectStrike, headStrike, strikeAt, STRIKE_LIMBS, type StrikeInput, type StrikeLimb } from './strike.js';
import type { TrackPoint } from './groundSpeed.js';
import { keyEventName } from '../inputs/combat.js';
// Character_MercenaryMale_01 in the Mixamo MartialArts clips, untrimmed, baked in place and sampled at 12 fps (the
// Sidefighter export rate): hips, hands and ankles in metres (Y up, the model faces +Z).
import fixture from './strike-real.fixture.json';

type Clip = Record<string, TrackPoint[]> & { hips: TrackPoint[] };
const real = fixture as unknown as Record<string, Clip>;
const inputOf = (t: Clip): StrikeInput => ({ hips: t.hips, limbs: Object.fromEntries(STRIKE_LIMBS.filter((k) => t[k]).map((k) => [k, t[k]])) });
/** What the exporter does: the automatic hit's frame, then its limb and window measured at that frame. */
const exported = (t: Clip) => {
  const s = detectStrike(inputOf(t));
  return s && strikeAt(inputOf(t), s.frame);
};

describe('detectStrike on the real clips (SF-FB-007 follow-up)', () => {
  it('puts Crouch_Punch\'s hit on the punching left hand around frame 11, not the right hand pulling back after it', () => {
    const s = exported(real.crouch_punch)!;
    expect(s.limb).toBe('hand_l');
    expect(Math.abs(s.frame - 11)).toBeLessThanOrEqual(1);
    expect(s.endFrame).toBeLessThanOrEqual(13);
  });

  it('keeps Crouch_Kick\'s window on the strike (11-13, not 11-21)', () => {
    expect(exported(real.crouch_kick)).toMatchObject({ limb: 'foot_r', frame: 11 });
    expect(exported(real.crouch_kick)!.endFrame).toBeLessThanOrEqual(13);
  });

  it('leaves the other attacks where the game measured them', () => {
    const want: Record<string, { limb: StrikeLimb; frame: number }> = {
      kick_heavy: { limb: 'foot_r', frame: 9 }, kick_light: { limb: 'foot_l', frame: 15 }, uppercut: { limb: 'hand_r', frame: 8 },
      special: { limb: 'hand_r', frame: 27 }, punch_heavy: { limb: 'hand_r', frame: 8 }, punch_light: { limb: 'hand_l', frame: 5 },
    };
    for (const [clip, w] of Object.entries(want)) {
      const s = exported(real[clip])!;
      expect(s, clip).toMatchObject(w);
      // Short windows: the strike, not the recovery.
      expect(s.endFrame - s.frame, clip).toBeLessThanOrEqual(4);
      expect(s.endFrame, clip).toBeGreaterThan(s.frame);
    }
  });

  it('gives the crouch stance nothing', () => {
    expect(detectStrike(inputOf(real.crouch_idle))).toBeNull();
  });
});

describe('head strikes (SF-FB-022)', () => {
  // A headbutt: the head lunges 0.35 m forward at frame 5 while the hands stay on guard and the feet planted.
  const n = 12;
  const still = (p: TrackPoint) => Array.from({ length: n }, (): TrackPoint => p);
  const head = Array.from({ length: n }, (_, i): TrackPoint => [0, 1.6, 0.05 + 0.35 * Math.max(0, 1 - Math.abs(i - 5) / 3)]);
  const input: StrikeInput = {
    head: true,
    hips: still([0, 0.95, 0]),
    limbs: { head, hand_l: still([0.15, 1.3, 0.3]), hand_r: still([-0.15, 1.3, 0.2]), foot_l: still([0.1, 0.05, 0.25]), foot_r: still([-0.1, 0.05, -0.3]) },
  };
  it('times an automatic hit on the head and names it', () => {
    expect(detectStrike(input)).toMatchObject({ limb: 'head', frame: 5 });
    expect(strikeAt(input, 4)!.limb).toBe('head');
    expect(headStrike('Brawler_Headbutt')).toBe(true);
  });
  it('only in head attacks: elsewhere the head is left out', () => {
    expect(detectStrike({ ...input, head: false })).toBeNull();
    expect(strikeAt({ ...input, head: false }, 4)!.limb).not.toBe('head');
    expect(headStrike('MartialArts_Crouch_Punch')).toBe(false);
  });
  it('a punch is still the fist when the head leans in a little', () => {
    // A headbutt with the guard up in front of the face: still the head.
    const guard = { ...input, limbs: { ...input.limbs, hand_l: still([0.15, 1.5, 0.5]), hand_r: still([-0.15, 1.5, 0.45]) } };
    expect(strikeAt(guard, 5)!.limb).toBe('head');
    expect(detectStrike(guard)).toMatchObject({ limb: 'head', frame: 5 });
    const fist = Array.from({ length: n }, (_, i): TrackPoint => [-0.15, 1.3, 0.2 + 0.5 * Math.max(0, 1 - Math.abs(i - 5) / 3)]);
    const punch: StrikeInput = { ...input, head: false, limbs: { ...input.limbs, head: head.map((p): TrackPoint => [p[0], p[1], p[2] * 0.3]), hand_r: fist } };
    expect(detectStrike(punch)).toMatchObject({ limb: 'hand_r', frame: 5 });
    expect(strikeAt(punch, 5)!.limb).toBe('hand_r');
  });
});

// Every socket (hands, feet, knees, elbows, head) of Character_MercenaryMale_01 in a side2 export at 12 fps (wave 13),
// in metres from the feet pivot (y up, z forward): the render's own view of the strike, head included.
import sockets from './strike-head.fixture.json';
const rendered = sockets as unknown as Record<string, Record<StrikeLimb, TrackPoint[]>>;

describe('the head does not take a punch (rendered sockets)', () => {
  // As the exporter: the head only counts in head attacks.
  const at = (clip: string) => {
    const input = { limbs: rendered[clip], head: headStrike(clip) };
    const s = detectStrike(input)!;
    return strikeAt(input, s.frame)!;
  };
  it('Crouch_Punch dives the head forward, but the left fist in front of it hits, around frame 11', () => {
    const s = at('MartialArts_Crouch_Punch');
    expect(s.limb).toBe('hand_l');
    expect(Math.abs(s.frame - 11)).toBeLessThanOrEqual(1);
    expect(s.endFrame).toBeLessThanOrEqual(13);
  });
  it('a crouch punch trimmed to its crouched part (1.2-2.4 s, hit set per sprite at 1.62 s = frame 5): the right fist, not a knee', () => {
    // The knee steps back as the body rises at the trim's end, so past the stance it looks out in front all along.
    expect(strikeAt({ limbs: rendered.crouch_punch_low }, 5)!.limb).toBe('hand_r');
  });
  it('Brawler_Headbutt: the head, though the guard holds the fists in front of the face', () => {
    expect(strikeAt({ limbs: rendered.Brawler_Headbutt, head: true }, 8)!.limb).toBe('head');
    expect(detectStrike({ limbs: rendered.Brawler_Headbutt, head: true })!.limb).toBe('head');
  });
  it('the uppercuts and the crouch kick keep their limbs and frames', () => {
    expect(at('MartialArts_Uppercut')).toMatchObject({ limb: 'hand_r', frame: 8 });
    expect(at('Boxer_Uppercut_Lead').limb).toBe('hand_l');
    const kick = at('MartialArts_Crouch_Kick');
    expect(kick.limb).toBe('foot_r');
    expect(kick.endFrame).toBeLessThanOrEqual(13);
  });
});

describe('keyEventName: the Combat/Attack category and head/elbow names', () => {
  it('gives a hit to a clip categorised as an attack by hand, and to headbutts and elbows', () => {
    expect(keyEventName('Some_Move', 'Combat/Attack')).toBe('hit');
    expect(keyEventName('Some_Move', null)).toBeNull();
    expect(keyEventName('Headbutt')).toBe('hit');
    expect(keyEventName('MartialArts_Elbow')).toBe('hit');
  });
});
