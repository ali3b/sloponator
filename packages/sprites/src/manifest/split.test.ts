// Moved from synty-sprite-generator packages/shared/src/export/split.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { BUILTIN_SETS, type AnimationSet } from '../inputs/batch.js';
import { classSet } from '../inputs/classes.js';
import { eventSheet, halvesOf, parseSplit, splitAnimationName, sheetsOfMove, splitBlock, splitLabel, splitSet, torsoOffset, WAIST_SOCKET } from './split.js';

describe('waist split values (FB-124)', () => {
  it('reads "waist", true and an object with move lists', () => {
    expect(parseSplit('waist')).toEqual({ at: 'waist' });
    expect(parseSplit(true)).toEqual({ at: 'waist' });
    expect(parseSplit('on')).toEqual({ at: 'waist' });
    expect(parseSplit({ at: 'waist', legs: ['idle', 'walk'], torso: 'aim, shoot' })).toEqual({ at: 'waist', legs: ['idle', 'walk'], torso: ['aim', 'shoot'] });
    expect(parseSplit({})).toEqual({ at: 'waist' });
    for (const v of [false, null, undefined, 'off', 'none']) expect(parseSplit(v)).toBeNull();
  });

  it('refuses other cuts and unknown keys', () => {
    expect(() => parseSplit('knees')).toThrow(/split must be "waist"/);
    expect(() => parseSplit({ at: 'neck' })).toThrow(/split.at must be "waist"/);
    expect(() => parseSplit({ legz: ['walk'] })).toThrow(/unknown key legz/);
    expect(() => parseSplit({ legs: [1] })).toThrow(/list of move names/);
    expect(() => parseSplit(3)).toThrow(/split must be/);
  });

  it('labels', () => {
    expect(splitLabel({ at: 'waist' })).toBe('split waist');
    expect(splitLabel({ at: 'waist', torso: ['aim'] })).toBe('split waist (torso aim)');
    expect(splitLabel(null)).toBeNull();
  });
});

describe('which sheet a move goes on', () => {
  const s = { at: 'waist' as const };
  const on = (name: string) => {
    const r = sheetsOfMove(name, s);
    return r.legs && r.torso ? 'both' : r.legs ? 'legs' : r.torso ? 'torso' : 'none';
  };
  it('walks on the legs, upper-body moves on the torso, idles and whole-body moves on both', () => {
    expect(['walk', 'run', 'sprint', 'strafe_left'].map(on)).toEqual(['legs', 'legs', 'legs', 'legs']);
    expect(['aim', 'shoot', 'reload', 'throw', 'aim_shoot'].map(on)).toEqual(['torso', 'torso', 'torso', 'torso', 'torso']);
    expect(['idle', 'crouch_idle', 'crouch_walk', 'death', 'prone_idle', 'crawl', 'hit'].map(on)).toEqual(['both', 'both', 'both', 'both', 'both', 'both', 'both']);
    // A walk that shoots: the legs walk, the torso shoots.
    expect(on('walk_shoot')).toBe('both');
  });

  it('a split\'s own lists replace the rule for that sheet (names or globs, with or without the moveset)', () => {
    const own = { at: 'waist' as const, legs: ['walk', 'run'], torso: ['rifle_*'] };
    expect(sheetsOfMove('idle', own, 'rifle_idle')).toEqual({ legs: false, torso: true });
    expect(sheetsOfMove('walk', own, 'rifle_walk')).toEqual({ legs: true, torso: true });
  });

  it('splits the rifle moveset into a legs set and a torso set', () => {
    const set = classSet(['rifle'], BUILTIN_SETS);
    const names = (x: AnimationSet) => x.items.map((it) => it.label);
    const legs = names(splitSet(set, s, 'legs')), torso = names(splitSet(set, s, 'torso'));
    expect(legs).toContain('rifle_idle');
    expect(legs).toContain('rifle_walk');
    expect(legs).not.toContain('rifle_shoot');
    expect(torso).toContain('rifle_idle');
    expect(torso).toContain('rifle_shoot');
    expect(torso).not.toContain('rifle_walk');
    expect(torso).not.toContain('rifle_run');
  });

  it('footsteps go with the legs, the rest with the torso', () => {
    expect(eventSheet('footstep_l')).toBe('legs');
    expect(['shoot', 'release', 'hit', 'hit_end'].map(eventSheet)).toEqual(['torso', 'torso', 'torso', 'torso']);
  });
});

describe('composing the sheets', () => {
  it('puts the torso\'s waist on the legs\' waist, mirrored frames flipped', () => {
    const legsWaist = { x: 60, y: 70 }, torsoWaist = { x: 58, y: 66 };
    expect(torsoOffset({ legsAt: { x: 100, y: 200 }, legsWaist, torsoWaist, frameWidth: 128 })).toEqual({ x: 102, y: 204 });
    // The torso drawn flipped: its waist is at 128 - 58 = 70 in the drawn frame.
    expect(torsoOffset({ legsAt: { x: 100, y: 200 }, legsWaist, torsoWaist, frameWidth: 128, torsoFlip: true })).toEqual({ x: 90, y: 204 });
  });

  it('keeps the two sheets\' animation keys apart', () => {
    expect(splitAnimationName('{base}/{clip}_{dir}', 'torso')).toBe('{base}/{clip}_{dir}');
    expect(splitAnimationName('ranger/{clip}_{dir}', 'legs')).toBe('ranger/legs/{clip}_{dir}');
    expect(splitAnimationName('{clip}_{dir}', 'torso')).toBe('torso_{clip}_{dir}');
    expect(splitAnimationName('hero_{clip}_{dir}', 'legs')).toBe('hero_legs_{clip}_{dir}');
  });

  it('builds the block both sheets carry', () => {
    const b = splitBlock({ sheet: 'torso', bones: { hips: 'Hips', spine: 'Spine_01' }, legs: { base: 'X_legs', files: ['X_legs.json'], clips: ['walk'] }, torso: { base: 'X_torso', files: ['X_torso.json'], clips: ['aim'] } });
    expect(b).toMatchObject({ schema: 'ssg-split/1', at: 'waist', sheet: 'torso', pivot: WAIST_SOCKET, draw: ['legs', 'torso'] });
    expect(b.note).toMatch(/waist socket/);
    expect(b.whole).toBeUndefined();
  });

  it('FB-126: names the whole-body sheet in every sheet\'s block when there is one', () => {
    const sheets = { bones: { hips: 'Hips', spine: 'Spine_01' }, legs: { base: 'X_legs', files: [], clips: ['walk'] }, torso: { base: 'X_torso', files: [], clips: ['aim'] }, whole: { base: 'X', files: ['X.json'], clips: ['walk', 'aim', 'death'] } };
    const b = splitBlock({ sheet: 'whole', ...sheets });
    expect(b).toMatchObject({ schema: 'ssg-split/1', sheet: 'whole', whole: { base: 'X', clips: ['walk', 'aim', 'death'] }, legs: { base: 'X_legs' }, torso: { base: 'X_torso' } });
    expect(b.whole?.note).toMatch(/same framing/);
    expect(splitBlock({ sheet: 'legs', ...sheets }).whole?.base).toBe('X');
  });
});

describe('the whole-body sheet with a split (FB-126)', () => {
  it('reads whole: true from an object, "waist+whole" and "whole"; refuses a non-boolean', () => {
    expect(parseSplit({ at: 'waist', whole: true })).toEqual({ at: 'waist', whole: true });
    expect(parseSplit({ whole: true, torso: ['idle', 'shoot'] })).toEqual({ at: 'waist', torso: ['idle', 'shoot'], whole: true });
    expect(parseSplit({ whole: false })).toEqual({ at: 'waist' });
    expect(parseSplit('waist+whole')).toEqual({ at: 'waist', whole: true });
    expect(parseSplit('whole')).toEqual({ at: 'waist', whole: true });
    expect(() => parseSplit({ whole: 'yes' })).toThrow(/split.whole must be true or false/);
    expect(splitLabel({ at: 'waist', whole: true })).toBe('split waist + whole');
    expect(splitLabel({ at: 'waist', whole: true, legs: ['walk'] })).toBe('split waist + whole (legs walk)');
  });

  it('keeps whole-body moves that are not walks or idles off the halves; the rest as without it', () => {
    const w = { at: 'waist' as const, whole: true };
    const on = (name: string, s: { at: 'waist'; whole?: boolean } = w) => {
      const r = sheetsOfMove(name, s);
      return r.legs && r.torso ? 'both' : r.legs ? 'legs' : r.torso ? 'torso' : 'whole';
    };
    expect(['death', 'hit', 'crawl', 'prone_shoot', 'kneel'].map((n) => on(n))).toEqual(['whole', 'whole', 'whole', 'whole', 'whole']);
    expect(['idle', 'crouch_idle', 'crouch_walk', 'walk', 'run', 'shoot', 'reload', 'walk_shoot'].map((n) => on(n))).toEqual(['both', 'both', 'both', 'legs', 'legs', 'torso', 'torso', 'both']);
    // Without whole nothing changes.
    expect(['death', 'hit', 'crawl'].map((n) => on(n, { at: 'waist' }))).toEqual(['both', 'both', 'both']);
    // A list still puts a whole-body move on a half.
    expect(sheetsOfMove('death', { ...w, torso: ['death', 'shoot'] })).toEqual({ legs: false, torso: true });
  });

  it('the halves render from the split without whole (their frame-cache units stay)', () => {
    expect(halvesOf({ at: 'waist', whole: true, torso: ['aim'] })).toEqual({ at: 'waist', torso: ['aim'] });
    expect(halvesOf({ at: 'waist' })).toEqual({ at: 'waist' });
  });
});
