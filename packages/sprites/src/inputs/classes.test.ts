// Moved from synty-sprite-generator packages/shared/src/classes.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { BUILTIN_SETS, MARTIAL_ARTS_MOVES, type SetItem } from './batch.js';
import { WEAPON_CLASSES, putAwayDuring, releaseModeOf, releasedBy, classFor, classItems, classSet, isArmedClass, isHeldSlot, isHoldable, moveName, pickClassMoves } from './classes.js';

describe('weapon classes', () => {
  it('classifies weapons by name', () => {
    expect(classFor('SM_Wep_American_Rifle_01')).toBe('rifle');
    expect(classFor('SM_Wep_American_SubMachineGun_01')).toBe('rifle');
    expect(classFor('SM_Wep_American_Pistol_01')).toBe('pistol');
    expect(classFor('SM_Prop_Sword_01')).toBe('sword');
    expect(classFor('SM_Prop_Bow_01')).toBe('bow');
    expect(classFor('SM_Prop_WizardStaff_01')).toBe('staff');
    expect(classFor('SM_Char_Attach_American_Bedroll_01')).toBeNull(); // "bowl"-like names are not bows
    expect(classFor('SM_Char_Attach_Helmet_01')).toBeNull();
  });
  it('tells held items from displays filed as weapons, by size', () => {
    expect(isHoldable([2.075, 2.513, 0.714])).toBe(false); // SM_Item_Sword: a wall crest with a sword
    expect(isHoldable([0.701, 0.701, 0.185])).toBe(true); // a round shield
    expect(isHoldable([0.25, 0.3, 1.9])).toBe(true); // a greatsword or halberd: long but narrow
    expect(isHoldable(null)).toBe(true);
    expect(isHeldSlot('weapon_sword')).toBe(true);
    expect(isHeldSlot('offhand')).toBe(true);
    expect(isHeldSlot('back')).toBe(false);
  });
  it('builds one set with every class, clips prefixed by class', () => {
    const set = classSet(['unarmed', 'sword']);
    expect(set.items.map((i) => i.label)).toEqual(['unarmed_idle', 'unarmed_walk', 'unarmed_run', 'sword_idle', 'sword_walk', 'sword_run', 'sword_attack_1', 'sword_attack_2', 'sword_block', 'sword_hit', 'sword_death']);
    expect(set.items.every((i) => (i as { cls?: string }).cls)).toBe(true);
    expect(classSet(['nope']).items).toEqual([]);
    expect(WEAPON_CLASSES.every((c) => c.setId.startsWith('builtin_'))).toBe(true);
  });
});

describe('style clip rules', () => {
  const byLabel = (cls: string) => Object.fromEntries(classItems(WEAPON_CLASSES.find((c) => c.id === cls)!, BUILTIN_SETS).map((it) => [it.label, it]));
  it('knives, daggers and bayonets are their own style; machetes and swords stay swords', () => {
    expect(classFor('SM_Wep_American_Bayonet_01')).toBe('knife');
    expect(classFor('SM_Wep_Melee_HuntingKnife_01')).toBe('knife');
    expect(classFor('SM_Wep_Dagger_01')).toBe('knife');
    expect(classFor('SM_Wep_Melee_Machete_01')).toBe('sword');
    expect(classFor('SM_Wep_Sword_01')).toBe('sword');
  });
  it('a gun style tries its own clip first and falls back to locomotion with the carry pose', () => {
    const r = byLabel('rifle');
    expect(r.rifle_idle).toMatchObject({ type: 'match', cls: 'rifle', prefer: ['^rifle[_ ]?idle'] });
    const plain = (r.rifle_idle as { orElse?: { type: string; name?: string; overlay?: unknown[] } }).orElse;
    expect(plain).toMatchObject({ type: 'anim', name: 'Idle_Standing', overlay: [{ id: 'rifle_carry', params: {} }] });
    expect((r.rifle_shoot as { prefer?: string[] }).prefer?.[0]).toBe('^rifle[_ ]?(shoot|fir)|^firing[_ ]rifle');
    // A pistol never borrows the rifle's carry.
    expect((byLabel('pistol').pistol_walk as { orElse?: { overlay?: unknown } }).orElse?.overlay).toBeUndefined();
  });
  it('the knife style prefers Mixamo knife clips over the sword pack', () => {
    const k = byLabel('knife');
    expect((k.knife_attack_1 as { prefer?: string[] }).prefer?.[0]).toMatch(/knife/);
    expect((k.knife_attack_2 as { prefer?: string[] }).prefer?.[0]).toMatch(/stab\[_ \]\?fore/);
  });
});

describe('placement fix helpers', () => {
  it('the sprite\'s own fix wins, then the moveset\'s, then the any-moveset fix', async () => {
    const { placementFor } = await import('./combat.js');
    const saved = { rifle: { pos: [0, 0.01, 0] as [number, number, number], rev: 3, source: 'human' as const }, '': { depth: 'back' as const, rev: 1, source: 'human' as const } };
    expect(placementFor(saved, 'rifle')).toMatchObject({ rev: 3 });
    expect(placementFor(saved, 'pistol')).toMatchObject({ depth: 'back' });
    expect(placementFor(saved, null)).toMatchObject({ depth: 'back' });
    expect(placementFor(saved, 'rifle', { rot: [0, 5, 0] })).toEqual({ rot: [0, 5, 0] });
    expect(placementFor(null, 'rifle')).toBeNull();
  });
  it('fixes are clamped and empty parts dropped', async () => {
    const { cleanPlacement } = await import('./combat.js');
    expect(cleanPlacement({ pos: [0, 0, 2], rot: [0, 0, 0], scale: 1, depth: 'auto', target: ' ' })).toEqual({ pos: [0, 0, 0.5] });
    expect(cleanPlacement({ rot: [0, -500, 10], scale: 9, depth: 'front', target: 'hand_l' })).toEqual({ rot: [0, -180, 10], scale: 4, depth: 'front', target: 'hand_l' });
    expect(cleanPlacement({ pos: [NaN, 0, 0] as [number, number, number] })).toEqual({});
  });
});

describe('picking moves of a moveset (FB-004)', () => {
  const rifle = classSet(['rifle']).items;
  const labels = (items: { label?: string }[]) => items.map((i) => i.label);

  it('FB-072: shoulder-fired launchers are their own moveset; a grenade launcher stays a rifle', () => {
    for (const n of ['SM_Wep_RPG_01', 'SM_Wep_American_RocketLauncher_01', 'SM_Wep_Bazooka_01', 'SM_Wep_LAW_01', 'SM_Wep_RocketLauncher_01']) expect(classFor(n), n).toBe('launcher');
    for (const n of ['SM_Wep_Grenade_Launcher_01', 'SM_Wep_American_Rifle_01']) expect(classFor(n), n).toBe('rifle');
    expect(classFor('SM_Prop_Lawnmower_01')).toBeNull();
    const set = classSet(['launcher']);
    const shoot = set.items.find((it) => it.label === 'launcher_shoot');
    const kneel = set.items.find((it) => it.label === 'launcher_crouch_shoot');
    expect(shoot?.type === 'match' && shoot.fallback).toEqual([{ id: 'shoulder_fire', params: {} }]);
    expect(kneel?.type === 'match' && kneel.fallback).toEqual([{ id: 'shoulder_fire', params: { kneel: 1 } }]);
  });

  it('FB-103: a clip lets go of its own items at release (hide by default), never of the sprite\'s', () => {
    const grenade = { cls: 'grenade', perClip: true }, rifle = { cls: undefined, perClip: false };
    const toss = { cls: 'grenade', perClip: true }, plain = { cls: 'rifle', perClip: false };
    expect(releaseModeOf(toss)).toBe('hide');
    expect(releaseModeOf({ ...toss, release: 'drop' as const })).toBe('drop');
    expect(releaseModeOf(plain)).toBe('keep');
    expect([releasedBy(toss, grenade), releasedBy(toss, rifle), releasedBy(plain, grenade), releasedBy({ cls: 'knife', perClip: true }, grenade)]).toEqual([true, false, false, false]);
  });

  it('FB-074: per-clip items show only in their clips; a clip with its own items puts the other hand-held ones away', () => {
    const knife = { cls: 'knife', perClip: true, handHeld: true };
    const rifle = { cls: undefined, perClip: false, handHeld: true };
    const helmet = { cls: undefined, perClip: false, handHeld: false };
    const stab = { cls: 'knife', perClip: true }, idle = {}, rifleIdle = { cls: 'rifle' };
    expect([stab, idle, rifleIdle].map((c) => putAwayDuring(c, knife))).toEqual([false, true, true]);
    expect([stab, idle, rifleIdle].map((c) => putAwayDuring(c, rifle))).toEqual([true, false, false]);
    expect([stab, idle, rifleIdle].map((c) => putAwayDuring(c, helmet))).toEqual([false, false, false]);
    // A moveset weapon outside per-clip clips: unchanged (baked exports show it everywhere, as before).
    expect(putAwayDuring({ cls: 'pistol' }, { cls: 'rifle', handHeld: true })).toBe(false);
    expect(putAwayDuring(stab, { cls: 'rifle', handHeld: true })).toBe(true);
  });

  it('the gunner moveset has a throw (procedural stand-in thrown with the free hand)', () => {
    const t = rifle.find((i) => i.label === 'rifle_throw')!;
    expect(t.type).toBe('match');
    expect(t.type === 'match' && t.fallback).toEqual([{ id: 'throw', params: { hand: 1 } }]);
    expect(t.type === 'match' && t.prefer?.[0]).toMatch(/rifle/);
  });

  it('picks by move name, with or without the moveset prefix, and by glob, keeping the set order', () => {
    expect(labels(pickClassMoves(rifle, { animations: ['walk', 'idle'] }).items)).toEqual(['rifle_idle', 'rifle_walk']);
    expect(labels(pickClassMoves(rifle, { animations: ['rifle_death', 'crouch_*'] }).items)).toEqual(['rifle_crouch_idle', 'rifle_crouch_walk', 'rifle_crouch_shoot', 'rifle_death']);
    expect(moveName(rifle[0])).toBe('idle');
  });

  it('picks by the clip a move plays (the plain clip, the moveset\'s own clip) and by template id', () => {
    // The Airborne Ranger command: plain clip names plus procedural moves.
    const r = pickClassMoves(rifle, { animations: ['Idle_Standing', 'Walk_F', 'Run_F', 'Rifle_Shoot', 'Rifle_Death'], templates: ['prone_idle', 'crawl'] });
    expect(labels(r.items)).toEqual(['rifle_idle', 'rifle_walk', 'rifle_run', 'rifle_shoot', 'rifle_prone_idle', 'rifle_crawl', 'rifle_death']);
    expect(r.unmatched).toEqual({ animations: [], templates: [] });
  });

  it('passes template parameters to the move\'s stand-in', () => {
    const [t] = pickClassMoves(rifle, { templates: ['throw:underhand=1'] }).items;
    expect(t.type === 'match' && t.fallback).toEqual([{ id: 'throw', params: { hand: 1, underhand: 1 } }]);
  });

  it('FB-094: a template that is only a move\'s stand-in is kept as asked, named after itself, with its parameters', () => {
    const r = pickClassMoves(rifle, { animations: ['crouch_idle', 'death'], templates: ['kneel_shoot:twoHanded=1,kick=6'] });
    expect(labels(r.items)).toEqual(['rifle_crouch_idle', 'rifle_death', 'rifle_kneel_shoot']);
    const t = r.items[2];
    expect(t).toEqual({ type: 'template', layers: [{ id: 'kneel_shoot', params: { twoHanded: 1, kick: 6 } }], label: 'rifle_kneel_shoot', cls: 'rifle' });
    expect(r.unmatched).toEqual({ animations: [], templates: [] });
    // The moveset's own parameters stay under the asked ones; bare move names keep the bare template name.
    const bare = pickClassMoves(classSet(['rifle'], [], { movePrefix: false }).items, { templates: ['kneel_shoot'] }).items;
    expect(bare).toEqual([{ type: 'template', layers: [{ id: 'kneel_shoot', params: { twoHanded: 1 } }], label: 'kneel_shoot', cls: 'rifle' }]);
    // A template that is a move's own name still picks that move (throw → rifle_throw, its stand-in tuned).
    expect(labels(pickClassMoves(rifle, { templates: ['throw:underhand=1'] }).items)).toEqual(['rifle_throw']);
    // One template per moveset, even when it stands in for several moves (shoulder_fire: shoot and crouch_shoot).
    const law = pickClassMoves(classSet(['launcher']).items, { templates: ['shoulder_fire:kneel=1'] }).items;
    expect(law).toEqual([{ type: 'template', layers: [{ id: 'shoulder_fire', params: { kneel: 1 } }], label: 'launcher_shoulder_fire', cls: 'launcher' }]);
  });

  it('FB-077: the unarmed moveset has hit and death when picked (procedural stand-ins, no weapon clips)', () => {
    const all = classSet(['unarmed'], [], { optional: true }).items;
    const r = pickClassMoves(all, { animations: ['idle', 'walk', 'run', 'hit', 'death'] });
    expect(labels(r.items)).toEqual(['unarmed_idle', 'unarmed_walk', 'unarmed_run', 'unarmed_hit', 'unarmed_death']);
    const [hit, death] = r.items.slice(3);
    expect(hit.type === 'match' && hit.fallback).toEqual([{ id: 'hit_react', params: {} }]);
    expect(death.type === 'match' && death.fallback).toEqual([{ id: 'death_fall', params: {} }]);
    expect(hit.type === 'match' && new RegExp(hit.pattern, 'i').test('Hit_F_React_Sword')).toBe(false);
    expect(hit.type === 'match' && new RegExp(hit.pattern, 'i').test('Hit_Reaction')).toBe(true);
    expect(death.type === 'match' && new RegExp(death.pattern, 'i').test('Rifle_Death')).toBe(false);
    // Not part of the whole moveset: sprites that take every move stay as they are.
    expect(labels(classSet(['unarmed']).items)).toEqual(['unarmed_idle', 'unarmed_walk', 'unarmed_run']);
  });

  it('returns what picks nothing, and keeps every move when nothing is picked', () => {
    const r = pickClassMoves(rifle, { animations: ['idle', 'Jump'], templates: ['spin', 'drive+doors'] });
    expect(labels(r.items)).toEqual(['rifle_idle']);
    expect(r.unmatched).toEqual({ animations: ['Jump'], templates: ['spin', 'drive+doors'] });
    expect(pickClassMoves(rifle, {}).items).toBe(rifle);
  });

  it('a move name picks it in every chosen moveset', () => {
    expect(labels(pickClassMoves(classSet(['unarmed', 'rifle']).items, { animations: ['idle'] }).items)).toEqual(['unarmed_idle', 'rifle_idle']);
  });
});

describe('martial_arts moveset (Street Fighter style, unarmed)', () => {
  const moves = classSet(['martial_arts']).items;
  const byLabel = Object.fromEntries(moves.map((it) => [it.label, it]));
  /** The clip a move would take from these names: its prefer patterns in order (as the runner tries them). */
  const first = (label: string, clips: string[]) => {
    for (const p of (byLabel[label] as { prefer?: string[] }).prefer ?? []) for (const c of clips) if (new RegExp(p, 'i').test(c)) return c;
    return null;
  };
  const title = (m: string) => (m === 'ko' ? 'KO' : m.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('_'));
  const uploads = MARTIAL_ARTS_MOVES.map((m) => `MartialArts_${title(m)}`);
  const labels = (items: { label?: string }[]) => items.map((i) => i.label);

  it('movePrefix false: bare move names for one moveset, still tagged with it; several movesets keep the prefix', () => {
    const bare = classSet(['martial_arts'], [], { movePrefix: false }).items;
    expect(labels(bare)).toEqual([...MARTIAL_ARTS_MOVES]);
    expect(bare.every((it) => it.cls === 'martial_arts')).toBe(true);
    expect(bare.map(moveName)).toEqual([...MARTIAL_ARTS_MOVES]);
    expect(labels(classSet(['unarmed', 'martial_arts'], [], { movePrefix: false }).items).every((l) => /^(unarmed|martial_arts)_/.test(l!))).toBe(true);
  });

  it('has every move, prefixed, and is fought without a weapon', () => {
    expect(moves.map(moveName)).toEqual([...MARTIAL_ARTS_MOVES]);
    expect(moves.every((it) => it.label?.startsWith('martial_arts_') && it.cls === 'martial_arts')).toBe(true);
    expect(classFor('SM_Wep_American_Rifle_01')).toBe('rifle');
    expect(classFor('MartialArts_Gloves')).toBeNull();
    expect(isArmedClass('martial_arts')).toBe(false);
    expect(isArmedClass('unarmed')).toBe(false);
    expect(isArmedClass('rifle')).toBe(true);
  });
  it('each move takes its own MartialArts_<Move> clip, not a longer move that starts the same', () => {
    expect(first('martial_arts_punch_light', uploads)).toBe('MartialArts_Punch_Light');
    expect(first('martial_arts_jump', uploads)).toBe('MartialArts_Jump');
    expect(first('martial_arts_idle', uploads)).toBe('MartialArts_Idle');
    expect(first('martial_arts_block', uploads)).toBe('MartialArts_Block');
    expect(first('martial_arts_ko', uploads)).toBe('MartialArts_KO');
    MARTIAL_ARTS_MOVES.forEach((m, i) => expect(first(`martial_arts_${m}`, uploads), m).toBe(uploads[i]));
    // The class's own clip rule is not listed twice.
    const prefer = (byLabel.martial_arts_punch_light as { prefer?: string[] }).prefer!;
    expect(new Set(prefer).size).toBe(prefer.length);
  });
  it('falls back to installed clips or procedural stand-ins without the uploads', () => {
    expect(byLabel.martial_arts_idle).toMatchObject({ type: 'match', pattern: '^Idle_Standing$' });
    expect((byLabel.martial_arts_walk_back as { pattern: string }).pattern).toContain('Walk_BckStrafeB');
    expect((byLabel.martial_arts_hit_head as { fallback?: { id: string }[] }).fallback?.[0].id).toBe('hit_react');
    expect((byLabel.martial_arts_ko as { fallback?: { id: string }[] }).fallback?.[0].id).toBe('death_fall');
    // A general pattern never borrows a weapon pack's pose.
    const block = new RegExp((byLabel.martial_arts_block as { pattern: string }).pattern, 'i');
    expect(block.test('POLY_BOW_Blocking')).toBe(false);
    expect(block.test('Boxing_Block')).toBe(true);
    expect(new RegExp((byLabel.martial_arts_victory as { pattern: string }).pattern, 'i').test('Attack_Swing_01')).toBe(false);
  });
  it('picks moves by glob and by clip name', () => {
    expect(labels(pickClassMoves(moves, { animations: ['punch_*'] }).items)).toEqual(['martial_arts_punch_light', 'martial_arts_punch_heavy']);
    expect(labels(pickClassMoves(moves, { animations: ['*kick*'] }).items)).toEqual(['martial_arts_kick_light', 'martial_arts_kick_heavy', 'martial_arts_crouch_kick', 'martial_arts_jump_kick']);
    expect(labels(pickClassMoves(moves, { animations: ['MartialArts_Uppercut'] }).items)).toEqual(['martial_arts_uppercut']);
  });
  it('SF-FB-018: installed clips are not folded onto moves by the moves\' clip patterns', () => {
    const extras = ['MartialArts_Flip_Uppercut@3.70:4.60', 'MartialArts_Hurricane_Kick', 'MartialArts_Dash_Punch@0.1:1.3', 'MartialArts_Super_Ryker@0.2:2.8', 'MartialArts_Spin_Kick'];
    // Without knowing the clips, the patterns take them (and say so in `folded`).
    const blind = pickClassMoves(moves, { animations: ['idle', ...extras] });
    expect(labels(blind.items)).toContain('martial_arts_uppercut');
    expect(blind.folded.map((f) => f.ref)).toEqual(extras);
    expect(blind.folded.find((f) => f.ref === 'MartialArts_Spin_Kick')?.moves).toEqual(['martial_arts_kick_light', 'martial_arts_kick_heavy']);
    // Knowing they are installed clips, they stay clips of their own (the caller adds them by name, with their trims).
    const clips = new Set(extras.map((e) => e.split('@')[0].toLowerCase()));
    const r = pickClassMoves(moves, { animations: ['idle', 'uppercut', ...extras] }, { clips });
    expect(labels(r.items)).toEqual(['martial_arts_idle', 'martial_arts_uppercut']);
    expect(r.items.every((it) => !it.window)).toBe(true);
    expect(r.unmatched.animations).toEqual(extras);
    expect(r.folded).toEqual([]);
    // A move's own clip still picks its move, installed or not.
    expect(labels(pickClassMoves(moves, { animations: ['MartialArts_Uppercut@0.2:1'] }, { clips: new Set(['martialarts_uppercut']) }).items)).toEqual(['martial_arts_uppercut']);
  });
  it('SF-FB-017: dash_forward plays a forward dash clip, else dash_back backwards', () => {
    expect(first('martial_arts_dash_forward', ['MartialArts_Dash_Back', 'MartialArts_Dash_Forward'])).toBe('MartialArts_Dash_Forward');
    const fwd = byLabel.martial_arts_dash_forward as Extract<SetItem, { type: 'match' }>;
    expect(new RegExp(fwd.pattern, 'i').test('Boxing_Step_Forward')).toBe(true);
    expect(new RegExp(fwd.pattern, 'i').test('MartialArts_Dash_Back')).toBe(false);
    expect(fwd.orElse).toMatchObject({ type: 'match', window: { reverse: true } });
    expect((fwd.orElse as { prefer: string[] }).prefer.some((p) => new RegExp(p, 'i').test('MartialArts_Dash_Back'))).toBe(true);
    // Naming the dash_back clip picks dash_back, not the move that plays it backwards; a reversed clip is a clip of its own.
    expect(labels(pickClassMoves(moves, { animations: ['MartialArts_Dash_Back'] }).items)).toEqual(['martial_arts_dash_back']);
    const rev = pickClassMoves(moves, { animations: ['MartialArts_Dash_Back@reverse'] });
    expect(rev.items).toEqual([]);
    expect(rev.unmatched.animations).toEqual(['MartialArts_Dash_Back@reverse']);
    // A move asked for backwards is that move, reversed.
    expect(pickClassMoves(moves, { animations: ['dash_back@reverse'] }).items).toMatchObject([{ label: 'martial_arts_dash_back', window: { reverse: true } }]);
  });
});
