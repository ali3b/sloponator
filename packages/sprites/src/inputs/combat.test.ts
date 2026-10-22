// Moved from synty-sprite-generator packages/shared/src/combat.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { animRefString, cleanClipEdit, cleanClipWindow, cleanGrip, defaultHand, keyEventName, marksToClipTimes, marksToFrames, parseAnimRef, parseTrim, resolveClipWindow, spriteClipEdit, stillLabel, stillRef } from './combat.js';

describe('yaw-locked clips (SF-FB-023)', () => {
  it('parses @lockyaw / @nolockyaw and keeps it through the window round trip', () => {
    expect(parseAnimRef('Boss_Punch@lockyaw')).toEqual({ name: 'Boss_Punch', window: { lockYaw: true } });
    expect(parseAnimRef('Boss_Punch@0.1:0.9@lock-yaw=punch')).toEqual({ name: 'Boss_Punch', window: { start: 0.1, end: 0.9, lockYaw: true }, label: 'punch' });
    expect(parseAnimRef('Boss_Punch@nolockyaw')).toEqual({ name: 'Boss_Punch', window: { lockYaw: false } });
    expect(animRefString('X', { start: 0.1, lockYaw: true })).toBe('X@0.1:@lockyaw');
    expect(parseAnimRef(animRefString('X', { lockYaw: false }))).toEqual({ name: 'X', window: { lockYaw: false } });
    expect(() => parseAnimRef('X@lockpitch')).toThrow(/lockyaw/);
  });
  it("keeps lockYaw in the shared edit; the sprite's lock wins either way", () => {
    expect(cleanClipEdit({ lockYaw: true })).toEqual({ start: null, end: null, speed: 1, events: [], lockYaw: true });
    expect(cleanClipEdit({ lockYaw: false })).toBeNull();
    expect(spriteClipEdit(null, { lockYaw: true })).toMatchObject({ lockYaw: true });
    expect(spriteClipEdit({ speed: 1, lockYaw: true }, { lockYaw: false })).not.toHaveProperty('lockYaw');
    expect(spriteClipEdit({ speed: 1, lockYaw: true }, { start: 0.2 })).toMatchObject({ start: 0.2, lockYaw: true });
  });
});

describe('clip edits', () => {
  it('drops empty edits and sanitises events', () => {
    expect(cleanClipEdit({})).toBeNull();
    expect(cleanClipEdit({ speed: 1, events: [] })).toBeNull();
    const e = cleanClipEdit({ start: 0.2, end: 0.1, speed: 50, events: [{ t: 0.5, name: 'hit me!' }, { t: 0.1, name: '' }] })!;
    expect(e.end).toBeNull(); // end before start is ignored
    expect(e.speed).toBe(8);
    expect(e.events).toEqual([{ t: 0.5, name: 'hit_me_' }]);
  });

  it('maps source-time marks to frames of the trimmed, sped-up clip', () => {
    // Source clip trimmed to 0.5..1.5 s, played at 2x: 0.5 s long, sampled at 10 fps (one-shot: 0..0.5).
    const times = Array.from({ length: 6 }, (_, i) => i * 0.1);
    const edit = { start: 0.5, end: 1.5, speed: 2 };
    expect(marksToFrames([{ t: 1.1, name: 'release' }], edit, times)).toEqual([{ frame: 3, name: 'release' }]);
    expect(marksToFrames([{ t: 0.2, name: 'early' }, { t: 1.6, name: 'late' }], edit, times)).toEqual([]);
    expect(marksToFrames([{ t: 0.3, name: 'x' }], null, [0, 0.1, 0.2, 0.3])).toEqual([{ frame: 3, name: 'x' }]);
  });
});

describe('grips and naming', () => {
  it('validates grips', () => {
    expect(cleanGrip({ pos: [0, 0, 0] } as never)).toBeNull();
    const g = cleanGrip({ target: 'hand_r', pos: [0.1, 0, 0], rot: [0, 90, 0], scale: 0, sockets: [{ name: 'tip', pos: [0, 1, 0] }] })!;
    expect(g.scale).toBe(0.01);
    expect(g.sockets).toEqual([{ name: 'tip', pos: [0, 1, 0] }]);
  });

  it('puts bows and shields in the left hand', () => {
    expect(defaultHand('SM_Wep_Bow_01')).toBe('hand_l');
    expect(defaultHand('SM_Wep_Shield_Round_01')).toBe('hand_l');
    expect(defaultHand('SM_Wep_Crossbow_01')).toBe('hand_r');
    expect(defaultHand('SM_Wep_Staff_01')).toBe('hand_r');
    expect(defaultHand('SM_Wep_Elbow_Pad')).toBe('hand_r');
  });

  it('names the key event of a combat clip', () => {
    expect(keyEventName('Standing_1H_Magic_Attack_01')).toBe('cast');
    expect(keyEventName('Standing_Draw_Arrow')).toBe('release');
    // Synty Bow Combat: the shot (even with the reload after it) releases; aiming only draws.
    expect(keyEventName('POLY_BOW_Stand_Shoot_Reload')).toBe('release');
    expect(keyEventName('POLY_BOW_Stand_Aiming_ToDrawn')).toBe('drawn');
    expect(keyEventName('Attack_LightCombo01A_Sword')).toBe('hit');
    expect(keyEventName('MOD_SWD_Hit_F_React')).toBe('hurt');
    expect(keyEventName('Sword_Slash_01')).toBe('hit');
    expect(keyEventName('Rifle_Shoot')).toBe('shoot');
    expect(keyEventName('Walk_F')).toBeNull();
    // Weapon names alone are no shot (the rifle idle used to carry a "shoot" event).
    for (const n of ['Rifle_Idle', 'rifle_idle', 'Rifle Aiming Idle', 'Rifle_Walk_F', 'Pistol_Run', 'Gun_Idle', 'Rifle_Aim']) expect(keyEventName(n)).toBeNull();
    for (const n of ['Rifle_Fire', 'Firing Rifle', 'Pistol_Shoot', 'Rifle_Kneel_Shoot', 'Gun_Recoil']) expect(keyEventName(n)).toBe('shoot');
    expect(keyEventName('Rifle_Butt_Attack')).toBe('hit');
  });
});

describe('per-sprite clip windows (SF-FB-001)', () => {
  it('parses Clip@start:end and caps', () => {
    expect(parseAnimRef('MartialArts_Crouch_Punch')).toEqual({ name: 'MartialArts_Crouch_Punch' });
    expect(parseAnimRef('MartialArts_Crouch_Punch@0.8:2.6')).toEqual({ name: 'MartialArts_Crouch_Punch', window: { start: 0.8, end: 2.6 } });
    expect(parseAnimRef('crouch_punch@:2.6@max=2')).toEqual({ name: 'crouch_punch', window: { end: 2.6, maxSeconds: 2 } });
    expect(parseAnimRef('MartialArts_KO@3s')).toEqual({ name: 'MartialArts_KO', window: { maxSeconds: 3 } });
    expect(parseTrim('0.8:')).toEqual({ start: 0.8, end: null });
    for (const bad of ['X@2.6:0.8', 'X@a:1', 'X@:', 'X@2', 'X@max=0', '@1:2']) expect(() => parseAnimRef(bad), bad).toThrow();
    expect(animRefString('X', { start: 0.8, end: 2.6, maxSeconds: 2 })).toBe('X@0.8:2.6@max=2');
    expect(parseAnimRef(animRefString('X', { end: 2.6 }))).toEqual({ name: 'X', window: { end: 2.6 } });
  });

  it('the sprite trim replaces the shared trim on the sides it sets; speed and events stay', () => {
    const shared = { start: 0.5, end: 4, speed: 2, events: [{ t: 0.6, name: 'early' }, { t: 1.5, name: 'hit' }] };
    expect(spriteClipEdit(shared, undefined)).toBe(shared);
    expect(spriteClipEdit(null, { maxSeconds: 2 })).toBeNull();
    const e = spriteClipEdit(shared, { start: 0.8, end: 2.6 })!;
    expect(e).toMatchObject({ start: 0.8, end: 2.6, speed: 2 });
    // Events stay in source seconds: one before the sprite's start is dropped, the hit moves to (1.5 - 0.8) / 2.
    expect(marksToClipTimes(e.events, e)).toEqual([{ t: 0.35, name: 'hit' }]);
    expect(spriteClipEdit(shared, { end: 3 })).toMatchObject({ start: 0.5, end: 3 });
  });

  it('resolves the rendered window: Crouch_Punch (128 frames at 30 fps) trimmed to 0.8–2.6 s', () => {
    const dur = 128 / 30;
    expect(resolveClipWindow(dur, null, { start: 0.8, end: 2.6 })).toMatchObject({ start: 0.8, end: 2.6, speed: 1, maxSeconds: null });
    expect(resolveClipWindow(dur, null, { start: 0.8, end: 2.6 }).duration).toBeCloseTo(1.8);
    // The clip's own cap wins over the sprite's; with no own cap the sprite's applies.
    expect(resolveClipWindow(dur, null, { start: 0.8, end: 2.6, maxSeconds: 1.5 }, 3.5)).toMatchObject({ maxSeconds: 1.5, duration: 1.5 });
    expect(resolveClipWindow(dur, null, undefined, 3.5)).toMatchObject({ start: 0, maxSeconds: 3.5, duration: 3.5 });
    // A trim end past the clip is clamped; the shared speed shortens the window.
    expect(resolveClipWindow(dur, { speed: 2 }, { start: 1, end: 99 })).toMatchObject({ start: 1, end: dur, speed: 2 });
  });
});

describe('reversed clips (SF-FB-017)', () => {
  it('parses @reverse and keeps it through the window round trip', () => {
    expect(parseAnimRef('MartialArts_Dash_Back@reverse')).toEqual({ name: 'MartialArts_Dash_Back', window: { reverse: true } });
    expect(parseAnimRef('MartialArts_Dash_Back@0.1:0.9@rev')).toEqual({ name: 'MartialArts_Dash_Back', window: { start: 0.1, end: 0.9, reverse: true } });
    expect(animRefString('X', { start: 0.1, reverse: true })).toBe('X@0.1:@reverse');
    expect(parseAnimRef(animRefString('X', { maxSeconds: 1, reverse: true }))).toEqual({ name: 'X', window: { maxSeconds: 1, reverse: true } });
    expect(() => parseAnimRef('X@backwards')).toThrow(/reverse/);
  });
  it('keeps reverse in the shared clip edit, and the sprite reverse turns the shared clip round', () => {
    expect(cleanClipEdit({ reverse: true })).toEqual({ start: null, end: null, speed: 1, events: [], reverse: true });
    expect(cleanClipEdit({ reverse: false })).toBeNull();
    expect(spriteClipEdit(null, { reverse: true })).toMatchObject({ reverse: true });
    expect(spriteClipEdit({ speed: 2, reverse: true }, { reverse: true })).not.toHaveProperty('reverse');
    expect(spriteClipEdit({ speed: 2, reverse: true }, { start: 0.2 })).toMatchObject({ start: 0.2, speed: 2, reverse: true });
  });
  it('events keep their pose: a reversed clip mirrors their times in the window', () => {
    const marks = [{ t: 0.5, name: 'push' }, { t: 1.5, name: 'land' }];
    expect(marksToClipTimes(marks, { reverse: true }, 2)).toEqual([{ t: 0.5, name: 'land' }, { t: 1.5, name: 'push' }]);
    const trimmed = marksToClipTimes(marks, { start: 0.4, end: 1.6, speed: 2, reverse: true }, 2);
    expect(trimmed.map((m) => m.name)).toEqual(['land', 'push']);
    expect(trimmed[0].t).toBeCloseTo(0.05);
    expect(trimmed[1].t).toBeCloseTo(0.55);
  });
});

describe('per-sprite events and export names (SF-FB-022)', () => {
  it('parses =name, @event=seconds and @noauto, and round-trips them', () => {
    expect(parseAnimRef('Capoeira_Kicks@0:3=kicks_a')).toEqual({ name: 'Capoeira_Kicks', window: { start: 0, end: 3 }, label: 'kicks_a' });
    expect(parseAnimRef('Capoeira_Kicks@11.6:14.6=super')).toEqual({ name: 'Capoeira_Kicks', window: { start: 11.6, end: 14.6 }, label: 'super' });
    expect(parseAnimRef('Capoeira_Kicks=kicks')).toEqual({ name: 'Capoeira_Kicks', label: 'kicks' });
    expect(parseAnimRef('X@max=2')).toEqual({ name: 'X', window: { maxSeconds: 2 } });
    expect(parseAnimRef('X@max=2=x_short')).toEqual({ name: 'X', window: { maxSeconds: 2 }, label: 'x_short' });
    expect(parseAnimRef('X@hit_end=12.4@hit=12.1@noauto')).toEqual({ name: 'X', window: { events: [{ t: 12.1, name: 'hit' }, { t: 12.4, name: 'hit_end' }], autoEvents: false } });
    const w = { start: 11.6, end: 14.6, events: [{ t: 12.1, name: 'hit' }], autoEvents: false as const };
    expect(animRefString('X', w, 'super')).toBe('X@11.6:14.6@hit=12.1@noauto=super');
    expect(parseAnimRef(animRefString('X', w, 'super'))).toEqual({ name: 'X', window: w, label: 'super' });
    for (const bad of ['X@hit=abc', 'X@hit=-1', 'X=1abc@0:1', 'X=a b']) expect(() => parseAnimRef(bad), bad).toThrow();
  });

  it('the sprite\'s events replace the shared ones (an empty list: none); autoEvents false turns the automatic ones off', () => {
    const shared = { start: 0.5, end: 4, speed: 1, events: [{ t: 1.5, name: 'hit' }, { t: 2, name: 'footstep_l' }] };
    const e = spriteClipEdit(shared, { events: [{ t: 1.2, name: 'hit' }] })!;
    expect(e).toMatchObject({ start: 0.5, end: 4, events: [{ t: 1.2, name: 'hit' }] });
    expect(marksToClipTimes(e.events, e)).toEqual([{ t: expect.closeTo(0.7), name: 'hit' }]);
    expect(spriteClipEdit(shared, { events: [] })!.events).toEqual([]);
    expect(spriteClipEdit(null, { autoEvents: false })).toMatchObject({ autoEvents: false });
    expect(shared.events).toHaveLength(2); // the shared edit is not touched
    // A clip cleared for every sprite (autoEvents false with its hand-set hit): the sprite's own events bring the
    // automatic limb/window back, unless it says autoEvents false too.
    const cleared = { speed: 1, events: [{ t: 0.55, name: 'hit' }], autoEvents: false };
    expect(spriteClipEdit(cleared, { events: [{ t: 0.75, name: 'hit' }] })).not.toHaveProperty('autoEvents');
    expect(spriteClipEdit(cleared, { events: [{ t: 0.75, name: 'hit' }], autoEvents: false })).toMatchObject({ autoEvents: false });
    expect(spriteClipEdit(cleared, { start: 0.2 })).toMatchObject({ autoEvents: false });
  });
});

describe('SF-FB-025: stills', () => {
  it('"Clip@still=2.4" is one frame at 2.4 source seconds, named Clip_still unless =name', () => {
    expect(parseAnimRef('Victory_Pose@still=2.4')).toEqual({ name: 'Victory_Pose', window: { still: 2.4 }, label: 'Victory_Pose_still' });
    expect(parseAnimRef('Victory_Pose@still=0=ending')).toEqual({ name: 'Victory_Pose', window: { still: 0 }, label: 'ending' });
    expect(parseAnimRef('Victory Pose@still=1').label).toBe('Victory_Pose_still');
    expect(stillLabel('idle')).toBe('idle_still');
    // The inverse round-trips.
    const p = parseAnimRef('Victory_Pose@still=2.4=ending');
    expect(animRefString(p.name, p.window, p.label)).toBe('Victory_Pose@still=2.4=ending');
    expect(parseAnimRef(animRefString(p.name, p.window))).toEqual({ name: 'Victory_Pose', window: { still: 2.4 }, label: 'Victory_Pose_still' });
  });
  it('a still takes no trim, cap, reverse or events; its time is seconds', () => {
    expect(() => parseAnimRef('Clip@still=2@0:3')).toThrow(/a still is one frame.*the trim/);
    expect(() => parseAnimRef('Clip@still=2@max=1')).toThrow(/maxSeconds/);
    expect(() => parseAnimRef('Clip@still=-1')).toThrow(/seconds/);
    expect(() => cleanClipWindow({ still: Number.NaN })).toThrow(/still must be source seconds/);
    // noauto is what a still is anyway: accepted and dropped.
    expect(cleanClipWindow({ still: 1, autoEvents: false })).toEqual({ still: 1 });
  });
  it('--still <clip>@<seconds> as an anim ref', () => {
    expect(stillRef('Victory_Pose@2.4')).toBe('Victory_Pose@still=2.4');
    expect(stillRef(' Victory_Pose @ 2.4 = ending ')).toBe('Victory_Pose@still=2.4=ending');
    expect(stillRef('Victory_Pose@still=2')).toBe('Victory_Pose@still=2');
    expect(() => stillRef('Victory_Pose')).toThrow(/<clip>@<seconds>/);
    expect(() => stillRef('Victory_Pose@0:2')).toThrow(/seconds/);
    expect(() => stillRef('A@B@2')).toThrow(/<clip>@<seconds>/);
  });
});
