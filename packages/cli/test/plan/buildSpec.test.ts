// Ported from synty-sprite-generator packages/client/src/spec.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { applyOverrides, buildSpec, findPack, groupFromName, parseClipWith, parseTemplate, parseWith, resolveAsset, SpecError, splitPackRef, type SpecSources } from '../../src/plan/buildSpec.js';
import { SECONDARY_PRESETS, VIEW_PRESETS, findStateVariants, type AnimationSet } from '@slop/sprites';
import type { Animation, Asset } from '../../src/plan/buildSpec.js';

const asset = (id: number, name: string, kind = 'character'): Asset =>
  ({ id, name, kind, status: 'ready', pack: 'P', packId: 1, error: null, glb: '/x.glb', thumb: null, variant: null, rig: null }) as Asset;
const anim = (id: number, name: string, category: string, extra: Partial<Animation> = {}): Animation =>
  ({ id, name, category, pack: 'ANIMATION_Base_Locomotion', rig: 'synty_ue', frames: 32, fps: 30, loop: true, set: 'Sidekick', gender: 'Masculine', rootMotion: false, status: 'ready', needsMapping: false, ...extra }) as Animation;

const ASSETS = [asset(1, 'SK_Character_Biker'), asset(2, 'Character_Biker'), asset(39, 'SM_Veh_Car_Ambo_01', 'vehicle'), asset(50, 'SM_Wep_Pistol_01', 'weapon'), asset(51, 'SM_Wep_Bow_01', 'weapon'), asset(60, 'SM_Bld_Bunker_01', 'prop'),
  asset(70, 'SM_Wep_Knife_01', 'weapon'), asset(71, 'SM_Wep_RPG_01', 'weapon'), asset(72, 'SM_Wep_American_Rifle_01', 'weapon'), asset(73, 'SM_Char_Attach_American_Helmet_01', 'attachment'), asset(74, 'SM_Prop_TimeBomb_01', 'prop')];
const ANIMS = [anim(10, 'Walk_F', 'Locomotion/Walk'), anim(11, 'Walk_F_RM', 'Locomotion/Walk', { rootMotion: true }), anim(12, 'Idle_Standing', 'Idle'), anim(13, 'Knife_Stab_Fore', 'Mixamo', { loop: false })];

const src: SpecSources = {
  findAssets: async (q) => ASSETS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase().replace(/^(sk_|sm_)/, ''))),
  getAsset: async (id) => ASSETS.find((a) => a.id === id)!,
  findAnimations: async (q) => ANIMS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())),
  profiles: async () => [],
  sets: async () => [],
  presets: async () => [],
};

describe('buildSpec', () => {
  it('resolves names, clips and defaults', async () => {
    const { spec, assets } = await buildSpec(src, { assets: ['SK_Character_Biker', 39], animations: ['walk_f', 'Idle_Standing'] });
    expect(assets.map((a) => a.id)).toEqual([1, 39]);
    expect(spec.set.items).toEqual([
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', name: 'Walk_F', category: 'Locomotion/Walk', rootMotion: false, gender: null, label: 'Walk_F', clip: 10 },
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', name: 'Idle_Standing', category: 'Idle', rootMotion: false, gender: null, label: 'Idle_Standing', clip: 12 },
    ]);
    expect(spec.profile.id).toBe('generic');
    expect(spec.view.directions).toBe('8');
    expect(spec.gender).toBe('auto');
  });

  it('prefers the exact model name over a prefix-less match', async () => {
    expect((await buildSpec(src, { assets: ['Character_Biker'], templates: ['sit'] })).assets[0].id).toBe(2);
    expect((await buildSpec(src, { assets: ['Biker'.replace('Biker', 'SK_Character_Biker')], templates: ['sit'] })).assets[0].id).toBe(1);
  });

  it('explains unknown names with suggestions', async () => {
    await expect(buildSpec(src, { assets: ['Bike'], animations: ['Walk_F'] })).rejects.toThrow(/Did you mean: Character_Biker, SK_Character_Biker/);
    await expect(buildSpec(src, { assets: [1], animations: ['Walk'] })).rejects.toThrow(/Did you mean: Walk_F/);
    await expect(buildSpec(src, { assets: [1] })).rejects.toBeInstanceOf(SpecError);
    await expect(buildSpec(src, { assets: [1], set: 'nope' })).rejects.toThrow(/No animation set/);
    await expect(buildSpec(src, { assets: [1], animations: ['Walk_F'], format: 'blender' })).rejects.toThrow(/Unknown format/);
  });

  it('uses built-in sets, formats and views by id or name', async () => {
    const { spec } = await buildSpec(src, { assets: [39], set: 'Vehicle basics (idle engine, drive, turn)', format: 'godot4', view: 'vehicle16' });
    expect(spec.set.id).toBe('builtin_vehicle');
    expect(spec.profile.id).toBe('godot4');
    expect(spec.view.directions).toBe('16');
  });
});

describe('combat inputs', () => {
  it('builds a loadout from names, bone suffixes and placement objects', async () => {
    const { spec } = await buildSpec(src, {
      assets: [1], set: 'builtin_gunner',
      with: ['SM_Wep_Pistol_01', 'SM_Wep_Bow_01@hand_l', { asset: 50, pos: [0, 0.1, 0], template: 'weapon_fire:recoil=4' }],
      fx: true,
    });
    expect(spec.loadout).toEqual([
      { asset: 50, target: undefined },
      { asset: 51, target: 'hand_l' },
      { asset: 50, target: undefined, pos: [0, 0.1, 0], rot: undefined, scale: undefined, layers: [{ id: 'weapon_fire', params: { recoil: 4 } }] },
    ]);
    expect(spec.fx).toEqual({ enabled: true });
    expect(spec.set.items.map((i) => i.label)).toEqual(['idle', 'walk', 'run', 'shoot', 'reload', 'crouch_idle', 'crouch_walk', 'crouch_shoot', 'prone_idle', 'crawl', 'prone_shoot', 'throw', 'hit', 'death']);
  });

  it('weapon classes: one set with every class, weapons filed by class', async () => {
    const { spec } = await buildSpec(src, { assets: [1], classes: ['unarmed', 'pistol', 'bow'], with: ['SM_Wep_Pistol_01', 'SM_Wep_Bow_01@hand_l', 'SM_Wep_Pistol_01=sidearm~bow'], layered: true });
    const labels = spec.set.items.map((i) => i.label);
    expect(labels.slice(0, 3)).toEqual(['unarmed_idle', 'unarmed_walk', 'unarmed_run']);
    expect(labels).toContain('pistol_shoot');
    expect(labels).toContain('bow_shoot');
    expect(spec.set.items.find((i) => i.label === 'bow_shoot')?.cls).toBe('bow');
    expect(spec.loadout?.map((it) => it.cls)).toEqual(['pistol', 'bow', 'bow']);
    expect(parseWith('SM_Wep_Knife_01=knife~sword')).toEqual({ asset: 'SM_Wep_Knife_01', layer: 'knife', cls: 'sword' });
    await expect(buildSpec(src, { assets: [1], classes: ['laser'] })).rejects.toThrow(/Unknown weapon classes/);
  });

  it('FB-004: animations/templates pick some moves of a moveset; other clips are added; a set is refused', async () => {
    const labels = async (input: Parameters<typeof buildSpec>[1]) => (await buildSpec(src, input)).spec.set.items.map((i) => i.label);
    expect(await labels({ assets: [1], classes: ['rifle'], animations: ['idle', 'walk'] })).toEqual(['rifle_idle', 'rifle_walk']);
    expect(await labels({ assets: [1], classes: ['rifle'], animations: ['Idle_Standing', 'Rifle_Shoot', 'death'], templates: ['crawl', 'throw:underhand=1'] }))
      .toEqual(['rifle_idle', 'rifle_shoot', 'rifle_crawl', 'rifle_throw', 'rifle_death']);
    // Not a move: resolved as a clip and added after the moves.
    expect(await labels({ assets: [1], classes: ['rifle'], animations: ['idle', 'Walk_F_RM'] })).toEqual(['rifle_idle', 'Walk_F_RM']);
    expect(await labels({ assets: [1], classes: ['rifle'], animations: ['idle'], templates: ['sit'] })).toEqual(['rifle_idle', 'sit']);
    await expect(buildSpec(src, { assets: [1], classes: ['rifle'], animations: ['jmup'] })).rejects.toThrow(/no move of the moveset \(idle, walk, run, shoot/);
    await expect(buildSpec(src, { assets: [1], classes: ['rifle'], set: 'builtin_locomotion' })).rejects.toThrow(/can't be combined/);
    expect((await labels({ assets: [1], classes: ['rifle'] })).length).toBeGreaterThanOrEqual(14);
  });

  it('SF-FB-018: with a class, installed clips by name are exported under their own names with their own trims', async () => {
    const ma = (id: number, name: string) => anim(id, name, 'Mixamo', { pack: 'Mixamo', loop: false });
    const clips = [ma(80, 'MartialArts_Flip_Uppercut'), ma(81, 'MartialArts_Hurricane_Kick'), ma(82, 'MartialArts_Super_Ryker'), ma(83, 'MartialArts_Spin_Kick'), ma(84, 'MartialArts_Dash_Back')];
    const warnings: string[] = [];
    const s2: SpecSources = { ...src, findAnimations: async (q) => [...ANIMS, ...clips].filter((a) => a.name.toLowerCase().includes(q.toLowerCase())), warn: (m) => warnings.push(m) };
    const items = async (animations: (string)[]) => (await buildSpec(s2, { assets: [1], classes: ['martial_arts'], movePrefix: false, animations })).spec.set.items;
    const r = await items(['idle', 'uppercut', 'special', 'MartialArts_Flip_Uppercut@3.70:4.60', 'MartialArts_Super_Ryker@0.2:2.8', 'MartialArts_Hurricane_Kick', 'MartialArts_Spin_Kick']);
    expect(r.map((i) => i.label)).toEqual(['idle', 'uppercut', 'special', 'MartialArts_Flip_Uppercut', 'MartialArts_Super_Ryker', 'MartialArts_Hurricane_Kick', 'MartialArts_Spin_Kick']);
    expect(r.find((i) => i.label === 'uppercut')).not.toHaveProperty('window');
    expect(r.find((i) => i.label === 'MartialArts_Flip_Uppercut')).toMatchObject({ type: 'anim', clip: 80, window: { start: 3.7, end: 4.6 } });
    expect(warnings).toEqual([]);
    // Only extra clips named: the whole moveset plus them.
    const all = await items(['MartialArts_Hurricane_Kick']);
    expect(all.length).toBe(27);
    expect(all.at(-1)?.label).toBe('MartialArts_Hurricane_Kick');
    // A reversed clip is a clip of its own, next to the move that plays it forwards (SF-FB-017).
    expect((await items(['dash_back', 'MartialArts_Dash_Back@reverse'])).map((i) => [i.label, i.window ?? null])).toEqual([['dash_back', null], ['MartialArts_Dash_Back_reverse', { reverse: true }]]);
    // A name that is neither a move nor a clip is still matched onto a move, with a warning.
    expect((await items(['MartialArts_Tornado_Kick'])).map((i) => i.label)).toEqual(['kick_light']);
    expect(warnings.join('\n')).toMatch(/MartialArts_Tornado_Kick.*kick_light/);
  });

  it('FB-073: place is a move of the rifle and unarmed movesets only when picked (kneel_place stand-in, release event)', async () => {
    const items = async (input: Parameters<typeof buildSpec>[1]) => (await buildSpec(src, input)).spec.set.items;
    const all = await items({ assets: [1], classes: ['rifle'] });
    expect(all.map((i) => i.label)).not.toContain('rifle_place');
    const picked = await items({ assets: [1], classes: ['rifle'], animations: ['idle', 'place'] });
    expect(picked.map((i) => i.label)).toEqual(['rifle_idle', 'rifle_place']);
    expect(picked[1]).toMatchObject({ type: 'match', cls: 'rifle', fallback: [{ id: 'kneel_place', params: {} }] });
    // A glob over the regular moves does not take it. The template id is kept as that template (FB-094), in the moveset.
    expect((await items({ assets: [1], classes: ['rifle'], animations: ['rifle_*'] })).map((i) => i.label)).not.toContain('rifle_place');
    expect((await items({ assets: [1], classes: ['unarmed'], templates: ['kneel_place:hand=1'] })).map((i) => [i.label, i.type === 'template' && i.layers, i.cls])).toEqual([['unarmed_kneel_place', [{ id: 'kneel_place', params: { hand: 1 } }], 'unarmed']]);
    expect((await items({ assets: [1], classes: ['unarmed', 'rifle'], animations: ['place'] })).map((i) => i.label)).toEqual(['unarmed_place', 'rifle_place']);
  });

  it('FB-074: clips with their own held items: <group>_<clip>, items only in their clips, one set', async () => {
    const { spec } = await buildSpec(src, {
      assets: [1], animations: ['Idle_Standing', 'Walk_F'], with: ['SM_Wep_American_Rifle_01', 'SM_Char_Attach_American_Helmet_01'],
      clipWith: [
        { anim: 'Knife_Stab_Fore@0:0.9', with: 'SM_Wep_Knife_01' },
        { template: 'shoulder_fire:kneel=1', with: ['SM_Wep_RPG_01'], as: 'law' },
        { template: 'kneel_place', with: 'SM_Prop_TimeBomb_01' },
        { anim: 'Knife_Stab_Fore', with: 'SM_Wep_Knife_01', as: 'knife' },
      ],
    });
    expect(spec.set.items.map((i) => [i.label, i.cls ?? null, !!i.perClip])).toEqual([
      ['Idle_Standing', null, false], ['Walk_F', null, false],
      ['knife_Knife_Stab_Fore', 'knife', true], ['law_shoulder_fire', 'law', true], ['timebomb_kneel_place', 'timebomb', true], ['knife_Knife_Stab_Fore', 'knife', true],
    ]);
    expect(spec.set.items[2]).toMatchObject({ type: 'anim', name: 'Knife_Stab_Fore', window: { start: 0, end: 0.9 } });
    expect(spec.set.items[3]).toMatchObject({ type: 'template', layers: [{ id: 'shoulder_fire', params: { kneel: 1 } }] });
    // The sprite's own items stay as they were (no class, no perClip); the knife is listed once.
    expect(spec.loadout).toEqual([
      { asset: 72 }, { asset: 73 },
      { asset: 70, cls: 'knife', perClip: true }, { asset: 71, cls: 'law', perClip: true }, { asset: 74, cls: 'timebomb', perClip: true },
    ].map((x) => expect.objectContaining(x)));
    expect(spec.loadout?.[0].cls).toBeUndefined();
    // With movesets the sprite's weapons keep their class; a per-clip item of the moveset's kind is its own group.
    const m = (await buildSpec(src, { assets: [1], classes: ['rifle'], animations: ['idle'], with: ['SM_Wep_American_Rifle_01'], clipWith: [{ template: 'shoulder_fire', with: 'SM_Wep_RPG_01' }] })).spec;
    expect(m.set.items.map((i) => i.label)).toEqual(['rifle_idle', 'launcher_shoulder_fire']);
    expect(m.loadout?.map((i) => [i.cls, !!i.perClip])).toEqual([['rifle', false], ['launcher', true]]);
    // Only clip-with clips: allowed; nonsense refused.
    expect((await buildSpec(src, { assets: [1], clipWith: [{ anim: 'Knife_Stab_Fore', with: 'SM_Wep_Knife_01' }] })).spec.set.items.map((i) => i.label)).toEqual(['knife_Knife_Stab_Fore']);
    await expect(buildSpec(src, { assets: [1], clipWith: [{ anim: 'Knife_Stab_Fore', with: [] }] })).rejects.toThrow(/what the clip holds/);
    await expect(buildSpec(src, { assets: [1], clipWith: [{ anim: 'Nope', with: 'SM_Wep_Knife_01' }] })).rejects.toThrow(/clipWith\[0\]: No animation/);
    // FB-103: release goes on the clip.
    const r = (await buildSpec(src, { assets: [1], clipWith: [{ template: 'kneel_place', with: 'SM_Prop_TimeBomb_01', release: 'drop' }, { template: 'kneel_place', with: 'SM_Prop_TimeBomb_01', as: 'bomb' }] })).spec.set.items;
    expect(r.map((i) => i.release)).toEqual(['drop', undefined]);
    await expect(buildSpec(src, { assets: [1], clipWith: [{ template: 'kneel_place', with: 'SM_Prop_TimeBomb_01', release: 'nope' as never }] })).rejects.toThrow(/release is hide, drop, keep/);
  });

  it('FB-074: --clip-with text and group names', () => {
    expect(parseClipWith('Knife_Stab_Fore@0:0.9 with POLYGON_Palm_City/SM_Wep_Knife_01')).toEqual({ anim: 'Knife_Stab_Fore@0:0.9', with: ['POLYGON_Palm_City/SM_Wep_Knife_01'] });
    expect(parseClipWith('template:shoulder_fire:kneel=1 with SM_Wep_RPG_01, SM_Prop_X as law')).toEqual({ template: 'shoulder_fire:kneel=1', with: ['SM_Wep_RPG_01', 'SM_Prop_X'], as: 'law' });
    expect(() => parseClipWith('Knife_Stab_Fore')).toThrow(/with <item>/);
    // FB-103: what the items do at the release.
    expect(parseClipWith('template:throw:hand=1 with SM_Wep_Grenade_01 as grenade release drop')).toEqual({ template: 'throw:hand=1', with: ['SM_Wep_Grenade_01'], as: 'grenade', release: 'drop' });
    expect(parseClipWith('template:kneel_place with SM_Prop_TimeBomb_01 release keep')).toMatchObject({ release: 'keep' });
    expect(() => parseClipWith('template:throw with X release fly')).toThrow(/release is hide, drop, keep/);
    expect(groupFromName('SM_Prop_TimeBomb_01')).toBe('timebomb');
    expect(groupFromName('SM_Item_First_Aid_02')).toBe('first_aid');
  });

  it('FB-011: maxSeconds goes into the batch spec', async () => {
    expect((await buildSpec(src, { assets: [1], set: 'builtin_locomotion', maxSeconds: 2 })).spec.maxSeconds).toBe(2);
    expect((await buildSpec(src, { assets: [1], set: 'builtin_locomotion' })).spec).not.toHaveProperty('maxSeconds');
    await expect(buildSpec(src, { assets: [1], set: 'builtin_locomotion', maxSeconds: 0 })).rejects.toThrow(/maxSeconds/);
  });

  it('FB-007: phaser3 anim keys are prefixed by the base; animPrefix changes or clears it', async () => {
    const name = async (animPrefix?: string) => (await buildSpec(src, { assets: [1], set: 'builtin_locomotion', format: 'phaser3', animPrefix })).spec.profile.animationName;
    expect(await name()).toBe('{base}/{clip}_{dir}');
    expect(await name('')).toBe('{clip}_{dir}');
    expect(await name('{asset}:')).toBe('{asset}:{clip}_{dir}');
    expect((await buildSpec(src, { assets: [1], set: 'builtin_locomotion', format: 'generic' })).spec.profile.animationName).toBe('{clip}_{dir}');
  });

  it('--atlas packs trimmed frames whatever the format', async () => {
    const { spec } = await buildSpec(src, { assets: [1], set: 'builtin_locomotion', atlas: true });
    expect(spec.profile.id).toBe('generic');
    expect(spec.profile.layout).toMatchObject({ mode: 'atlas', trim: true });
    expect((await buildSpec(src, { assets: [1], set: 'builtin_locomotion' })).spec.profile.layout.mode).toBe('grid');
  });

  it('an inline set is used as given', async () => {
    const inlineSet: AnimationSet = { id: 'adhoc', name: 'x', items: [{ type: 'anim', pack: 'p', category: null, rootMotion: false, gender: null, name: 'Idle_Standing', label: 'Idle_Standing' }] };
    const { spec } = await buildSpec(src, { assets: [1], inlineSet });
    expect(spec.set).toBe(inlineSet);
  });

  it('layered exports: modes, layer names and depth rules on with-items', async () => {
    const { spec } = await buildSpec(src, { assets: [1], set: 'builtin_gunner', with: ['SM_Wep_Pistol_01:front', 'SM_Wep_Bow_01@hand_l=longbow', { asset: 50, layer: 'sidearm', depth: { N: 'back' } }], layered: true });
    expect(spec.layered).toEqual({ occlusion: 'mask' });
    expect(spec.loadout).toEqual([
      { asset: 50, target: undefined, depth: 'front' },
      { asset: 51, target: 'hand_l', layer: 'longbow' },
      { asset: 50, target: undefined, pos: undefined, rot: undefined, scale: undefined, layer: 'sidearm', depth: { N: 'back' } },
    ]);
    const none = await buildSpec(src, { assets: [1], set: 'builtin_gunner', with: ['SM_Wep_Pistol_01'], layered: 'none' });
    expect(none.spec.layered).toEqual({ occlusion: 'none' });
    expect(parseWith('SM_Wep_Bow_01@hand_l:back=bow')).toEqual({ asset: 'SM_Wep_Bow_01', target: 'hand_l', depth: 'back', layer: 'bow' });
    expect(parseWith('SM_Chr_Attach_Cape_01:sway-soft!hit')).toEqual({ asset: 'SM_Chr_Attach_Cape_01', secondary: 'soft', trigger: 'hit' });
    const sway = await buildSpec(src, { assets: [1], set: 'builtin_gunner', with: ['SM_Wep_Pistol_01:sway', { asset: 51, secondary: 'stiff', trigger: 'shoot' }] });
    expect(sway.spec.loadout?.[0].secondary).toEqual(SECONDARY_PRESETS.medium);
    expect(sway.spec.loadout?.[1]).toMatchObject({ secondary: SECONDARY_PRESETS.stiff, trigger: 'shoot' });
    await expect(buildSpec(src, { assets: [1], set: 'builtin_gunner', with: ['SM_Wep_Pistol_01:sideways'] })).rejects.toThrow(/:front, :back, :sway/);
    await expect(buildSpec(src, { assets: [1], set: 'builtin_gunner', partsOnly: true })).rejects.toThrow(/alignTo/);
  });

  it('leaves plain exports without loadout or fx', async () => {
    const { spec } = await buildSpec(src, { assets: [1], animations: ['Walk_F'] });
    expect(spec.loadout).toBeUndefined();
    expect(spec.fx).toBeUndefined();
    expect(spec.layered).toBeUndefined();
  });
});

describe('templates and overrides', () => {
  it('parses template layers and parameters', () => {
    expect(parseTemplate('drive_turn:steer=-25,duration=0.8+doors')).toEqual({
      type: 'template',
      layers: [{ id: 'drive_turn', params: { steer: -25, duration: 0.8 } }, { id: 'doors', params: {} }],
      label: 'drive_turn+doors',
    });
    expect(() => parseTemplate('drive:steer=left')).toThrow(SpecError);
  });

  it('FB-076: an arm pose over a locomotion clip (hands_up_walk, rifle_carry_run): the clip with the pose on its arms', () => {
    expect(parseTemplate('hands_up_walk:onHead=1,stride=25')).toEqual({
      type: 'match', label: 'hands_up_walk', pattern: '^Walk_F$',
      overlay: [{ id: 'hands_up', params: { onHead: 1 } }],
      fallback: [{ id: 'hands_up_walk', params: { onHead: 1, stride: 25 } }],
    });
    // No template of that name: walk_cycle legs under the pose stand in.
    expect(parseTemplate('hands_up_run')).toMatchObject({ pattern: '^Run_F$', overlay: [{ id: 'hands_up', params: {} }], fallback: [{ id: 'walk_cycle', params: { duration: 0.65, stride: 34 } }, { id: 'hands_up', params: {} }] });
    expect(parseTemplate('hands_up_idle')).toMatchObject({ pattern: '^Idle_Standing$', fallback: [{ id: 'hands_up', params: {} }] });
    // The plain pose and non-arm templates stay templates.
    expect(parseTemplate('hands_up')).toMatchObject({ type: 'template' });
    expect(parseTemplate('kneel_shoot_walk')).toMatchObject({ type: 'template' });
  });

  it('pixel art, ppm, directions and mirroring', () => {
    const base = VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
    const px = applyOverrides(base, { pixelArt: true });
    expect([px.quality?.style, px.quality?.textureFilter, px.frameWidth]).toEqual(['pixel', 'nearest', 64]);
    expect(px.quality!.supersample).toBeGreaterThanOrEqual(3);
    const ppm = applyOverrides(base, { ppm: 32, directions: '16', mirror: true });
    expect([ppm.scale, ppm.directions, ppm.mirror, ppm.frameWidth]).toEqual([{ mode: 'ppm', ppm: 32 }, '16', true, 16]);
    expect(base.directions).toBe('8'); // presets are not mutated
  });

  it('objects need no set: a bunker under a tile lock stands still at real scale', async () => {
    const { spec } = await buildSpec(src, { assets: ['SM_Bld_Bunker_01'], overrides: { tile: '64x32' } });
    expect(spec.set.id).toBe('builtin_object');
    expect(spec.view.scale).toMatchObject({ mode: 'tile', tilePx: 64, shape: 'diamond' });
    await expect(buildSpec(src, { assets: ['SK_Character_Biker'] })).rejects.toThrow(/Say what to animate/);
  });

  it('objects in an iso view default to one grid-aligned facing; --dirs and --facings take control (FB-013)', async () => {
    const bunker = async (overrides?: Parameters<typeof applyOverrides>[1]) => (await buildSpec(src, { assets: ['SM_Bld_Bunker_01'], view: 'iso8', overrides })).spec.view;
    expect((await bunker()).facings).toBe(1);
    expect((await bunker({ ppm: 32 })).facings).toBe(1);
    const dirs = await bunker({ directions: '1' });
    expect([dirs.facings, dirs.directions]).toEqual([undefined, '1']);
    expect((await bunker({ facings: 2 })).facings).toBe(2);
    expect((await bunker({ facings: 0, directions: '4d' })).facings).toBe(0);
    expect((await bunker({ tile: '64x32', slice: 'columns' })).slice).toBe('columns');
    // Top-down views and characters/vehicles keep their directions.
    expect((await buildSpec(src, { assets: ['SM_Bld_Bunker_01'], view: 'topdown8' })).spec.view.facings).toBeUndefined();
    expect((await buildSpec(src, { assets: [39], view: 'iso8', templates: ['drive'] })).spec.view.facings).toBeUndefined();
    expect(() => applyOverrides(VIEW_PRESETS[0].config, { facings: 3 as never })).toThrow(SpecError);
  });

  it('tile lock: a 64x32 diamond or a square tile sets the shared real-world scale', () => {
    const base = VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
    const iso = applyOverrides(base, { tile: '64x32', metresPerTile: 2 });
    expect(iso.scale).toEqual({ mode: 'tile', tilePx: 64, shape: 'diamond', metresPerTile: 2 });
    expect([iso.padding, iso.frameWidth]).toEqual([2, 16]);
    expect(applyOverrides(base, { tile: '32x32' }).scale).toEqual({ mode: 'tile', tilePx: 32, shape: 'square', metresPerTile: 1 });
    // Tile wins over ppm.
    expect(applyOverrides(base, { ppm: 40, tile: '64x32' }).scale.mode).toBe('tile');
    expect(() => applyOverrides(base, { tile: '64x40' })).toThrow(SpecError);
    expect(() => applyOverrides(base, { tile: 'big' })).toThrow(SpecError);
  });
});

describe('pack-qualified model names', () => {
  const TREES = [
    { ...asset(189, 'SM_Env_Tree_01', 'prop'), pack: 'POLYGON_City', packId: 4 },
    { ...asset(790, 'SM_Env_Tree_01', 'prop'), pack: 'POLYGON_War', packId: 7 },
    { ...asset(791, 'SM_Env_Tree_02', 'prop'), pack: 'POLYGON_War', packId: 7 },
  ] as Asset[];
  const PACKS = [{ id: 4, name: 'POLYGON_City', kind: 'models' }, { id: 7, name: 'POLYGON_War', kind: 'models' }, { id: 1, name: 'ANIMATION_Idles', kind: 'animations' }];
  const make = () => {
    const warnings: string[] = [];
    const s: SpecSources = {
      ...src,
      findAssets: async (q, packId) => TREES.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()) && (packId === undefined || a.packId === packId)),
      getAsset: async (id) => TREES.find((a) => a.id === id)!,
      packs: async () => PACKS,
      warn: (m) => warnings.push(m),
    };
    return { s, warnings };
  };

  it('splits Pack/Name', () => {
    expect(splitPackRef('POLYGON_War/SM_Env_Tree_01')).toEqual({ pack: 'POLYGON_War', name: 'SM_Env_Tree_01' });
    expect(splitPackRef('SM_Env_Tree_01')).toEqual({ name: 'SM_Env_Tree_01' });
  });

  it('picks the model in the named pack, without warnings', async () => {
    const { s, warnings } = make();
    expect((await resolveAsset(s, 'POLYGON_War/SM_Env_Tree_01')).id).toBe(790);
    expect((await resolveAsset(s, 'polygon_city/sm_env_tree_01')).id).toBe(189);
    expect((await resolveAsset(s, '7/SM_Env_Tree_01')).id).toBe(790);
    expect(warnings).toEqual([]);
  });

  it('keeps the old pick for an ambiguous bare name, but warns with the candidates', async () => {
    const { s, warnings } = make();
    expect((await resolveAsset(s, 'SM_Env_Tree_01')).id).toBe(189);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/in 2 packs \(POLYGON_City\/SM_Env_Tree_01 #189, POLYGON_War\/SM_Env_Tree_01 #790\); using POLYGON_City/);
    expect(warnings[0]).toMatch(/e\.g\. POLYGON_War\/SM_Env_Tree_01/);
    expect((await resolveAsset(s, 'SM_Env_Tree_02')).id).toBe(791);
    expect(warnings).toHaveLength(1);
  });

  it('works in exports and --with items', async () => {
    const { s } = make();
    const { spec } = await buildSpec(s, { assets: ['POLYGON_War/SM_Env_Tree_01'], templates: ['still'], with: ['POLYGON_War/SM_Env_Tree_02@hand_r'] });
    expect(spec.assetIds).toEqual([790]);
    expect(spec.loadout?.[0]).toMatchObject({ asset: 791, target: 'hand_r' });
  });

  it('explains an unknown pack or a name missing from the pack', async () => {
    const { s } = make();
    await expect(resolveAsset(s, 'POLYGON_Nope/SM_Env_Tree_01')).rejects.toThrow(/No pack "POLYGON_Nope"\. Packs: POLYGON_City, POLYGON_War$/);
    await expect(resolveAsset(s, 'POLYGON_City/SM_Env_Tree_02')).rejects.toThrow(/No model matches "SM_Env_Tree_02" in POLYGON_City/);
  });

  it('finds packs by id, name or versioned name', () => {
    expect(findPack(PACKS, 7).name).toBe('POLYGON_War');
    expect(findPack(PACKS, 'polygon_war').id).toBe(7);
    expect(findPack(PACKS, 'POLYGON_War_v2').id).toBe(7);
    expect(() => findPack(PACKS, 'x')).toThrow(SpecError);
  });
});

describe('object states', () => {
  const WAR = [asset(100, 'SM_Veh_Car_01', 'vehicle'), asset(101, 'SM_Veh_Car_Damaged_01', 'prop'), asset(102, 'SM_Veh_Car_Damaged_02', 'prop'), asset(103, 'SM_Veh_German_Tank_01', 'vehicle'), asset(104, 'SM_Veh_German_Tank_Destroyed_01', 'prop'), asset(105, 'SM_Prop_Crate_01', 'prop'), asset(1, 'SK_Character_Biker')];
  const warnings: string[] = [];
  const s: SpecSources = {
    ...src,
    findAssets: async (q) => WAR.filter((a) => a.name.toLowerCase().includes(q.toLowerCase().replace(/^(sk_|sm_)/, ''))),
    getAsset: async (id) => WAR.find((a) => a.id === id)!,
    variants: async (id) => {
      const a = WAR.find((x) => x.id === id)!;
      return { asset: { id: a.id, name: a.name, kind: a.kind }, pack: 'POLYGON_War', ...findStateVariants(a, WAR) };
    },
    warn: (m) => warnings.push(m),
  };
  const labels = (spec: { set: AnimationSet }) => spec.set.items.map((i) => `${i.label}@${i.type === 'template' ? i.model : '-'}`);

  it('auto: the damaged/destroyed versions found by name, as stills on their own models', async () => {
    const { spec, assets } = await buildSpec(s, { assets: ['SM_Veh_German_Tank_01'], states: 'auto' });
    expect(assets.map((a) => a.id)).toEqual([103]);
    expect(spec.assetIds).toEqual([103]);
    expect(labels(spec)).toEqual(['intact@103', 'destroyed@104']);
    expect(spec.set.items[1]).toMatchObject({ layers: [{ id: 'still' }], state: { name: 'destroyed' } });
  });

  it('auto plus a transition, and named states by model name or id', async () => {
    const auto = await buildSpec(s, { assets: [100], states: 'auto,damaged@destroy:force=6;duration=2' });
    expect(labels(auto.spec)).toEqual(['intact@100', 'damaged@101', 'intact_to_damaged@100']);
    expect(auto.spec.set.items[2]).toMatchObject({ layers: [{ id: 'destroy', params: { force: 6, duration: 2 } }], state: { name: 'damaged', from: 'intact' } });
    const named = await buildSpec(s, { assets: [100], states: 'destroyed=SM_Veh_Car_Damaged_02@destroy' });
    expect(labels(named.spec)).toEqual(['intact@100', 'destroyed@102', 'intact_to_destroyed@100']);
    const obj = await buildSpec(s, { assets: [100], states: { intact: 100, wreck: { asset: 'SM_Veh_Car_Damaged_01', transition: 'destroy' } } });
    expect(labels(obj.spec)).toEqual(['intact@100', 'wreck@101', 'intact_to_wreck@100']);
  });

  it('per-state collision (FB-085): in the text form, the object form, and on an automatic state', async () => {
    const st = (spec: { set: AnimationSet }) => spec.set.items.map((i) => (i.type === 'template' ? i.state : undefined));
    const text = await buildSpec(s, { assets: [105], states: 'destroyed=@scorch:dark=0.9@collapse:blast=1;collision=none' });
    expect(st(text.spec)).toEqual([{ name: 'intact' }, { name: 'destroyed', collision: 'none' }, { name: 'destroyed', from: 'intact' }]);
    const obj = await buildSpec(s, { assets: [105], states: { intact: { asset: 105, collision: 'concave' }, destroyed: { look: 'scorch', collision: 'none' } } });
    expect(st(obj.spec).slice(0, 2)).toEqual([{ name: 'intact', collision: 'concave' }, { name: 'destroyed', collision: 'none' }]);
    const auto = await buildSpec(s, { assets: [103], states: 'auto,destroyed;collision=base' });
    expect(labels(auto.spec)).toEqual(['intact@103', 'destroyed@104']);
    expect(st(auto.spec)[1]).toEqual({ name: 'destroyed', collision: 'base' });
    await expect(buildSpec(s, { assets: [105], states: { destroyed: { look: 'scorch', collision: 'gone' as never } } })).rejects.toThrow(/collision must be/);
  });

  it('a damaged model given with auto uses its intact model as intact', async () => {
    warnings.length = 0;
    const { spec } = await buildSpec(s, { assets: ['SM_Veh_Car_Damaged_02'], states: 'auto' });
    expect(labels(spec)).toEqual(['intact@100', 'damaged@101']);
    expect(warnings[0]).toMatch(/SM_Veh_Car_Damaged_02 is the damaged version of SM_Veh_Car_01/);
  });

  it('no destroyed model: a scorched copy of the model with a collapse (FB-028)', async () => {
    const looks = (spec: { set: AnimationSet }) => spec.set.items.map((i) => (i.type === 'template' ? `${i.label}@${i.model}${i.look ? `@${i.look}` : ''}:${i.layers.map((l) => l.id).join('+')}` : '-'));
    const named = await buildSpec(s, { assets: [105], states: 'auto,destroyed=@scorch,destroyed@collapse' });
    expect(looks(named.spec)).toEqual(['intact@105:still', 'destroyed@105@scorch:still', 'intact_to_destroyed@105:collapse']);
    const auto = await buildSpec(s, { assets: [105], states: 'auto+scorch' });
    expect(looks(auto.spec)).toEqual(looks(named.spec));
    // A model with a destroyed version keeps it with auto+scorch.
    expect(labels((await buildSpec(s, { assets: [103], states: 'auto+scorch' })).spec)).toEqual(['intact@103', 'destroyed@104']);
    const params = await buildSpec(s, { assets: [105], states: { destroyed: { look: 'scorch:debris=0', transition: 'collapse:blast=1' } } });
    expect(looks(params.spec)).toEqual(['intact@105:still', 'destroyed@105@scorch:debris=0:still', 'intact_to_destroyed@105:collapse']);
    await expect(buildSpec(s, { assets: [105], states: 'destroyed=@melt' })).rejects.toThrow(/unknown procedural state/);
  });

  it('FB-056: a state can loop a template (string, object, or a template next to states)', async () => {
    const looks = (spec: { set: AnimationSet }) => spec.set.items.map((i) => (i.type === 'template' ? `${i.label}@${i.model}:${i.layers.map((l) => l.id).join('+')}${i.state?.loop ? `~${i.state.loop}` : ''}` : '-'));
    const want = ['intact@103:drive~drive', 'destroyed@104:still', 'intact_to_destroyed@103:destroy'];
    expect(looks((await buildSpec(s, { assets: [103], states: 'auto,intact:drive,destroyed@destroy' })).spec)).toEqual(want);
    expect(looks((await buildSpec(s, { assets: [103], states: 'auto,destroyed@destroy', templates: ['drive'] })).spec)).toEqual(want);
    expect(looks((await buildSpec(s, { assets: [103], states: 'auto,destroyed@destroy', templates: ['still'] })).spec)).toEqual(['intact@103:still', 'destroyed@104:still', 'intact_to_destroyed@103:destroy']);
    const obj = await buildSpec(s, { assets: [103], states: { intact: { template: 'drive:duration=1' }, destroyed: { asset: 104, transition: 'destroy' } } });
    expect(looks(obj.spec)).toEqual(['intact@103:drive~drive:duration=1', ...want.slice(1)]);
    expect(obj.spec.set.items[0]).toMatchObject({ layers: [{ id: 'drive', params: { duration: 1 } }], state: { name: 'intact', loop: 'drive:duration=1' } });
    // `anim` is another name; a list makes layers; the state's own loop wins over a template next to states.
    const anim = await buildSpec(s, { assets: [103], states: { intact: { anim: ['drive', 'turret_sweep'] }, destroyed: 104 }, templates: ['spin'] });
    expect(looks(anim.spec)).toEqual(['intact@103:drive+turret_sweep~drive+turret_sweep', 'destroyed@104:still']);
    // Without auto, a loop on intact keeps the model itself as intact.
    expect(looks((await buildSpec(s, { assets: [103], states: 'intact:spin,destroyed=104' })).spec)).toEqual(['intact@103:spin~spin', 'destroyed@104:still']);
    await expect(buildSpec(s, { assets: [103], states: 'auto,intact:warp' })).rejects.toThrow(/unknown loop template warp/);
    await expect(buildSpec(s, { assets: [103], states: 'auto,intact:destroy' })).rejects.toThrow(/one-shot/);
    await expect(buildSpec(s, { assets: [103], states: { intact: { template: 'spin', anim: 'drive' } } })).rejects.toThrow(/template or anim, not both/);
  });

  it('explains what is wrong', async () => {
    await expect(buildSpec(s, { assets: [105], states: 'auto' })).rejects.toThrow(/No damaged or destroyed versions of SM_Prop_Crate_01 found in POLYGON_War.*auto\+scorch/);
    await expect(buildSpec(s, { assets: [100, 103], states: 'auto' })).rejects.toThrow(/one model at a time/);
    await expect(buildSpec(s, { assets: [100], states: 'auto', animations: ['Idle_Standing'] })).rejects.toThrow(/leave out animations/);
    await expect(buildSpec(s, { assets: [1], states: 'auto' })).rejects.toThrow(/not characters/);
    await expect(buildSpec(s, { assets: [100], states: 'destroyed=SM_Veh_Car_Damaged_01@explode' })).rejects.toThrow(/unknown template explode/);
    await expect(buildSpec(s, { assets: [100], states: 'auto,destroyed@destroy' })).rejects.toThrow(/state "destroyed" has no model \(none was found for it\)/);
    await expect(buildSpec(s, { assets: [100], states: 'Destroyed' })).rejects.toThrow(/bad state/);
    await expect(buildSpec(s, { assets: [100], states: 'destroyed=Nope_01' })).rejects.toThrow(/No model/);
  });
});

describe('turret split (FB-096)', () => {
  const tank = { ...asset(80, 'SM_Veh_Tank_01', 'vehicle'), parts: [{ name: 'SM_Veh_Tank_01_Turret', local: 'Turret', role: 'turret' }] } as Asset;
  const all = [...ASSETS, tank];
  const tsrc: SpecSources = { ...src, findAssets: async (q) => all.filter((a) => a.name.toLowerCase().includes(q.toLowerCase().replace(/^(sk_|sm_)/, ''))), getAsset: async (id) => all.find((a) => a.id === id)! };
  it('puts the turret split on the batch: true, a count or { dirs }', async () => {
    expect((await buildSpec(tsrc, { assets: [80], templates: ['drive'], turret: true })).spec.turret).toEqual({});
    expect((await buildSpec(tsrc, { assets: [80], templates: ['drive'], turret: '16' })).spec.turret).toEqual({ dirs: '16' });
    expect((await buildSpec(tsrc, { assets: [80], templates: ['drive'], turret: { dirs: 32 } })).spec.turret).toEqual({ dirs: '32' });
    expect((await buildSpec(tsrc, { assets: [80], templates: ['drive'], turret: false })).spec.turret).toBeUndefined();
  });
  it('refuses what cannot be split', async () => {
    await expect(buildSpec(tsrc, { assets: [39], templates: ['drive'], turret: true })).rejects.toThrow(/no turret or barrel part/);
    await expect(buildSpec(tsrc, { assets: [80], templates: ['drive'], turret: true, overrides: { projection: 'persp' } })).rejects.toThrow(/orthographic/);
    await expect(buildSpec(tsrc, { assets: [80], templates: ['drive'], turret: true, layered: true })).rejects.toThrow(/leave out layered/);
    await expect(buildSpec(tsrc, { assets: [80], templates: ['drive'], turret: '5' })).rejects.toBeInstanceOf(SpecError);
  });
});
