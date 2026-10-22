// Moved from synty-sprite-generator packages/shared/src/export/strikeLimb.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { detectStrike, strikeAt, type StrikeInput, type StrikeLimb } from './strike.js';
import type { TrackPoint } from './groundSpeed.js';
// Hands, feet, knees and elbows of Character_MercenaryFemale_01 in MartialArts_Jump_Kick and MartialArts_Knee_Strike
// (trimmed 0.25–1.4 s) at 12 fps, read back from a side2 export's per-frame sockets (metres from the feet pivot:
// y up, z forward). The Sidefighter puts their hits at frames 3 and 4 (SF-FB-020).
import fixture from './strike-sf020.fixture.json';

const real = fixture as unknown as Record<string, Record<StrikeLimb, TrackPoint[]>>;
const only = (t: Record<StrikeLimb, TrackPoint[]>, limbs: StrikeLimb[]): StrikeInput => ({ limbs: Object.fromEntries(limbs.map((l) => [l, t[l]])) });

describe('strikeAt names the leading limb (SF-FB-020)', () => {
  it('a jump kick hit set as the arm leads, a frame before the kick lands: the foot', () => {
    expect(strikeAt({ limbs: real.jump_kick }, 3)!.limb).toMatch(/^foot_/);
    // Hands and feet only (no knee/elbow sockets on the model): still the foot.
    expect(strikeAt(only(real.jump_kick, ['hand_l', 'hand_r', 'foot_l', 'foot_r']), 3)!.limb).toMatch(/^foot_/);
  });

  it('a knee strike: the knee, not the foot hanging under it', () => {
    expect(strikeAt({ limbs: real.knee_strike }, 4)!.limb).toBe('knee_r');
    // Without knee sockets the leg's end stands in for it.
    expect(strikeAt(only(real.knee_strike, ['hand_l', 'hand_r', 'foot_l', 'foot_r']), 4)!.limb).toBe('foot_r');
  });

  it('an elbow strike: the elbow out in front of the fist', () => {
    const n = 8;
    const at = (p: TrackPoint, dz: (i: number) => number) => Array.from({ length: n }, (_, i): TrackPoint => [p[0], p[1], p[2] + dz(i)]);
    const swing = (i: number) => (i >= 3 && i <= 5 ? 0.35 : 0);
    const s = strikeAt({
      limbs: {
        elbow_r: at([0.2, 1.25, 0.0], swing), hand_r: at([0.2, 1.35, 0.05], (i) => swing(i) * 0.6),
        hand_l: at([-0.2, 1.3, 0.25], () => 0), elbow_l: at([-0.2, 1.1, 0.05], () => 0),
        foot_l: at([-0.1, 0.05, 0.2], () => 0), foot_r: at([0.1, 0.05, -0.2], () => 0),
      },
    }, 4)!;
    expect(s.limb).toBe('elbow_r');
  });

  it('a hand-given limb wins, and automatic hits are still timed on the hands and feet', () => {
    expect(strikeAt({ limbs: real.knee_strike }, 4, 'foot_r')!.limb).toBe('foot_r');
    const auto = detectStrike({ limbs: real.knee_strike })!;
    expect(['foot_r', 'foot_l', 'hand_l', 'hand_r']).toContain(auto.limb);
  });
});
