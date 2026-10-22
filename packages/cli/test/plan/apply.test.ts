// Ported from synty-sprite-generator packages/client/src/apply.test.ts (P2, ali3b/sloponator#8): the file reader
// (entryOf, parseApplyFile) and the parity suite (a sprite renders what `ssg export` renders), against a fake
// `SpecSources` instead of the old in-memory server. What exercised applySprites (creating, updating, rendering and
// downloading on the server) stayed behind; plan.test.ts covers the planning it did.
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, BUILTIN_SETS, findStateVariants, setItemLabel, type BatchSpec } from '@slop/sprites';
import { APPLY_KEYS, APPLY_KEY_DOCS, applyFileHelp, entryOf, layeringWarning, parseApplyFile, projectDefaultsFrom, resolvedSettings, sameSpec, spriteSpecFor, type SpriteDecl } from '../../src/plan/apply.js';
import { buildSpec, type Animation, type Asset, type SpecSources } from '../../src/plan/buildSpec.js';
import { buildRender, spritePlan } from '../../src/plan/render.js';
import { withTileScale } from '../../src/plan/sprites.js';
import { defaultProjectDefaults, effectiveSpec, planChange, specOf, type ProjectDefaults, type SpriteSpec } from '../../src/plan/spriteSpec.js';
import { initialState } from '../../src/plan/state.js';

const asset = (id: number, name: string, kind: string, pack = 'POLYGON_War'): Asset =>
  ({ id, name, kind, status: 'ready', pack, packId: pack === 'POLYGON_War' ? 1 : 2, error: null, glb: '/x.glb', thumb: null, variant: null, rig: null }) as Asset;
const ASSETS = [
  asset(1, 'Character_American_Soldier_01', 'character'),
  asset(2, 'SM_Wep_American_Rifle_01', 'weapon'),
  asset(3, 'SM_Char_Attach_American_Helmet_01', 'attachment'),
  asset(10, 'SM_Bld_Bunker_01', 'multipart'),
  asset(11, 'SM_Env_Sandbag_Wall_01', 'prop'),
  asset(20, 'SM_Veh_Car_01', 'vehicle'),
  asset(21, 'SM_Veh_Car_Damaged_01', 'prop'),
  asset(30, 'SM_Prop_Crate_02', 'prop'),
  asset(40, 'SM_Wep_Knife_01', 'weapon', 'POLYGON_Palm_City'),
  asset(41, 'SM_Wep_RPG_01', 'weapon', 'POLYGON_BattleRoyale'),
  { ...asset(50, 'SM_Veh_German_Tank_01', 'vehicle'), parts: [
    { name: 'SM_Veh_German_Tank_01_Turret', local: 'Turret', role: 'turret' }, { name: 'SM_Veh_German_Tank_01_Barrel', local: 'Barrel', role: 'barrel' },
    { name: 'SM_Veh_German_Tank_01_Track_l', local: 'Track_l', role: 'track' },
  ] } as Asset,
];

/** The old in-memory server's lookups, as sources: the library above, no user sets, profiles or presets. */
function fakeSources(clips: Partial<Animation>[] = []): SpecSources & { warnings: string[] } {
  const anims = clips.map((c) => ({ pack: '_Uploads', category: null, rootMotion: false, gender: null, status: 'ready', rig: 'mixamo', loop: true, ...c }) as Animation);
  const src: SpecSources & { warnings: string[] } = {
    warnings: [],
    findAssets: async (q, packId) => ASSETS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase().replace(/^(sk_|sm_)/, '')) && (packId === undefined || a.packId === packId)),
    getAsset: async (id) => ASSETS.find((a) => a.id === id)!,
    variants: async (id) => {
      const a = ASSETS.find((x) => x.id === id)!;
      return { asset: a, pack: a.pack, ...findStateVariants(a, ASSETS) };
    },
    findAnimations: async (q) => anims.filter((a) => !q || [a.name, ...(a.previousNames ?? [])].some((n) => n.toLowerCase().includes(q.toLowerCase()))),
    profiles: async () => [],
    sets: async () => [],
    presets: async () => [],
    packs: async () => [{ id: 1, name: 'POLYGON_War', kind: 'models' }],
    warn: (m) => src.warnings.push(m),
  };
  return src;
}

const ctx = { sets: BUILTIN_SETS, profiles: BUILTIN_PROFILES };
/** What `ssg sprite render` would send for this sprite (the shared planner, as the CLI/MCP/web used it). */
const renderSpec = (sprite: { id: number; name: string; assetId: number; spec: SpriteSpec }, project: { defaults: ProjectDefaults }) =>
  buildRender({ ...sprite, current: null, latest: null }, project, ctx, spritePlan({ ...sprite, current: null, latest: null }, project, BUILTIN_SETS)).spec;

/** The export's batch and the sprite's render batch for the same flags (mode export: every setting the sprite's own). */
async function both(decl: SpriteDecl, mode: 'export' | 'project' = 'export', defaults = defaultProjectDefaults(), src = fakeSources()) {
  const entry = entryOf({ name: 'x', ...decl });
  const exp = (await buildSpec(src, entry.input)).spec;
  const r = await spriteSpecFor(src, { defaults }, entry, { mode });
  const spr = renderSpec({ id: 1, name: 'x', assetId: r.asset.id, spec: r.spec }, { defaults });
  return { exp, spr, spec: r.spec, own: r.own, asset: r.asset, kind: r.kind };
}
const labels = (b: BatchSpec) => b.set.items.map(setItemLabel);
const stateSpec = (): SpriteSpec => specOf(initialState());
const windowOf = (b: BatchSpec, label: string) => b.set.items.find((it) => setItemLabel(it) === label)?.window;

/** The Airborne Ranger asset file as it was (ssg.assets.json). */
const GAME_FILE = {
  tile: '64x32', metresPerTile: 1, view: 'iso8', format: 'phaser3', fps: 10, maxSeconds: 2,
  sprites: [
    { name: 'ranger', asset: 'POLYGON_War/Character_American_Soldier_01', class: 'rifle', anim: ['idle', 'walk', 'run', 'shoot'], with: ['POLYGON_War/SM_Wep_American_Rifle_01', 'POLYGON_War/SM_Char_Attach_American_Helmet_01'], dirs: '8', uniform: true },
    { name: 'bunker', asset: 'POLYGON_War/SM_Bld_Bunker_01', template: 'still', dirs: '4d' },
    { name: 'crate', asset: 'POLYGON_War/SM_Prop_Crate_02', template: 'still', dirs: '4d' },
  ],
  tilesets: [], maps: [],
};

describe('apply file', () => {
  it('reads the game\'s asset file as it is: top-level settings for every sprite, its own keys', () => {
    const f = parseApplyFile({ project: 'Airborne Ranger', ...GAME_FILE });
    expect(f.project).toBe('Airborne Ranger');
    expect(f.entries.map((e) => e.name)).toEqual(['ranger', 'bunker', 'crate']);
    expect(f.entries[0].input).toMatchObject({
      assets: ['POLYGON_War/Character_American_Soldier_01'], classes: ['rifle'], animations: ['idle', 'walk', 'run', 'shoot'], view: 'iso8', format: 'phaser3', maxSeconds: 2, uniformFrame: true,
      with: ['POLYGON_War/SM_Wep_American_Rifle_01', 'POLYGON_War/SM_Char_Attach_American_Helmet_01'],
      overrides: { directions: '8', tile: '64x32', metresPerTile: 1, fps: 10 },
    });
    expect(f.entries[1].input.templates).toEqual(['still']);
    expect(f.entries[1].input.overrides?.directions).toBe('4d');
    // The file's defaults become the project's settings: its view, tile lock and format.
    const d = projectDefaultsFrom(f.defaults);
    expect(d).toMatchObject({ viewCardId: 'iso8', profileId: 'phaser3', sizeId: 'custom' });
    expect(d.view.scale).toEqual({ mode: 'tile', tilePx: 64, shape: 'diamond', metresPerTile: 1 });
    expect(d.view.fps).toBe(10);
    expect(projectDefaultsFrom({ view: 'side2', look: 'pixel', size: 'small', format: 'phaser3' })).toMatchObject({ viewCardId: 'side2', lookId: 'pixel', sizeId: 'small', profileId: 'phaser3' });
    expect(() => projectDefaultsFrom({ view: 'sideways' })).toThrow(/Unknown view "sideways"/);
  });

  it('takes other spellings, keeps template parameters whole, and refuses typos and duplicate names', () => {
    const e = entryOf({ name: 'jeep', model: 'SM_Veh_Car_01', templates: 'drive_turn:steer=25,duration=0.8', anims: 'a,b', layers: 'normal,depth', shadow: false } as SpriteDecl);
    expect(e.input.templates).toEqual(['drive_turn:steer=25,duration=0.8']);
    expect(e.input.animations).toEqual(['a', 'b']);
    expect(e.input.layers).toEqual(['normal', 'depth']);
    expect(e.input.overrides?.shadow).toBe('off');
    expect(() => entryOf({ name: 'a', asset: 'x', anmi: 'idle' } as SpriteDecl)).toThrow(/unknown key "anmi"/);
    expect(entryOf({ name: 'plane', asset: 'x', collision: 'full', collisionHeight: 1.5 }).input.overrides).toMatchObject({ collision: 'full', collisionHeight: 1.5 });
    expect(entryOf({ name: 'plane', asset: 'x', 'collision-height': 2 } as SpriteDecl).input.overrides?.collisionHeight).toBe(2);
    expect(() => entryOf({ name: 'a', asset: 'x', collision: 'hull' as never })).toThrow(/collision must be auto, base, full or concave/);
    expect(() => entryOf({ name: 'a' })).toThrow(/which model/);
    expect(() => entryOf({ name: 'a', asset: 'x', class: 'laser' })).toThrow(/unknown moveset laser/);
    expect(() => parseApplyFile({ sprites: [{ name: 'a', asset: 'x' }, { name: 'A', asset: 'y' }] })).toThrow(/Two sprites are named "A"/);
    expect(() => parseApplyFile({ sprites: [{ asset: 'x' }] })).toThrow(/give it a "name"/);
    expect(() => parseApplyFile({ sprites: {} })).toThrow(/needs "sprites"/);
    // FB-026: "still" next to states is what the states are (accepted, dropped); other templates are refused.
    expect(entryOf({ name: 'a', asset: 'x', states: 'auto', template: 'still' }).input).toMatchObject({ states: 'auto' });
    expect(entryOf({ name: 'a', asset: 'x', states: 'auto', template: 'still' }).input.templates).toBeUndefined();
    // FB-056: any other template next to states is the intact state's loop (checked when the states resolve).
    expect(entryOf({ name: 'a', asset: 'x', states: 'auto', template: 'drive' }).input).toMatchObject({ states: 'auto', templates: ['drive'] });
    expect(() => entryOf({ name: 'a', asset: 'x', states: 'auto', set: 'x' })).toThrow(/states are the sprite's moves.*"template": "drive"/);
    expect(() => entryOf({ name: 'a', asset: 'x', states: 'auto', anim: 'idle' })).toThrow(/states are the sprite's moves/);
  });

  it('documents every key the validator accepts', () => {
    expect(Object.keys(APPLY_KEY_DOCS).sort()).toEqual([...APPLY_KEYS].sort());
    const help = applyFileHelp();
    for (const k of APPLY_KEYS) expect(help).toMatch(new RegExp(`^  ${k} `, 'm'));
    expect(help).toMatch(/"trim": "0\.8:2\.6"/);
  });

  it('FB-086: "set": "none" means only the declared moves; with nothing declared it is refused', () => {
    const e = entryOf({ name: 'a', asset: 'Character_American_Soldier_01', set: 'none', template: ['crawl'] });
    expect(e.input.set).toBeUndefined();
    expect(e.input.templates).toEqual(['crawl']);
    expect(() => entryOf({ name: 'a', asset: 'x', set: 'None' })).toThrow(/"set": "none" leaves the sprite without moves/);
    expect(entryOf({ name: 'a', asset: 'x', set: 'none', class: 'rifle' }).input).toMatchObject({ classes: ['rifle'] });
  });

  it('FB-074: parses anim / template objects with `with` into clipWith', () => {
    const e = entryOf({
      name: 'ranger', asset: 'Character_American_Soldier_01', class: 'rifle', anim: ['idle', 'walk', { clip: 'Knife_Stab_Fore', trim: '0:0.9', with: 'SM_Wep_Knife_01' }],
      template: [{ template: 'shoulder_fire:kneel=1', with: 'SM_Wep_RPG_01', as: 'law' }],
    } as SpriteDecl);
    expect(e.input.animations).toEqual(['idle', 'walk']);
    expect(e.input.templates).toBeUndefined();
    expect(e.input.clipWith).toEqual([
      { anim: 'Knife_Stab_Fore@0:0.9', with: ['SM_Wep_Knife_01'] },
      { template: 'shoulder_fire:kneel=1', with: ['SM_Wep_RPG_01'], as: 'law' },
    ]);
    expect(() => entryOf({ asset: 'x', anim: [{ clip: 'K', with: [] }] } as never)).toThrow(/anim\[0\]: "with" names the items/);
    expect(() => entryOf({ asset: 'x', template: [{ template: 'sit', with: 'A', bogus: 1 }] } as never)).toThrow(/unknown key "bogus"/);
    expect(() => entryOf({ asset: 'x', anim: [{ clip: 'K', with: 'A', as: '9x' }] } as never)).toThrow(/"as" is a group name/);
    expect(entryOf({ asset: 'x', anim: [{ clip: 'Throw', with: 'G', release: 'drop' }], template: [{ template: 'kneel_place', with: 'C4', release: 'keep' }] } as never).input.clipWith)
      .toEqual([{ anim: 'Throw', with: ['G'], release: 'drop' }, { template: 'kneel_place', with: ['C4'], release: 'keep' }]);
    expect(() => entryOf({ asset: 'x', template: [{ template: 'throw', with: 'G', release: 'away' }] } as never)).toThrow(/"release" is hide, drop, keep/);
  });

  it('SF-FB-001/017/022/023: per-clip trims, reverse, events, labels and yaw locks become anim refs', () => {
    const e = entryOf({ name: 'merc', asset: 'x', class: 'martial_arts', anim: [
      'idle', 'crouch_punch@0.8:2.6', { clip: 'uppercut', maxSeconds: 2 }, { clip: 'MartialArts_Dash_Back', reverse: true }, { clip: 'Boss_Punch', lockYaw: true },
      { clip: 'Capoeira_Kicks', trim: '11.6:14.6', label: 'super', events: [{ t: 12.1, name: 'hit' }], autoEvents: false }, 'Boss_Kick@lockyaw@0.2:',
    ] });
    expect(e.input.animations).toEqual(['idle', 'crouch_punch@0.8:2.6', 'uppercut@max=2', 'MartialArts_Dash_Back@reverse', 'Boss_Punch@lockyaw', 'Capoeira_Kicks@11.6:14.6@hit=12.1@noauto=super', 'Boss_Kick@lockyaw@0.2:']);
    expect(() => entryOf({ asset: 'x', anim: [{ clip: 'P', reverse: 'yes' } as never] })).toThrow(/reverse is true or false/);
    expect(() => entryOf({ asset: 'x', anim: [{ clip: 'P', lockYaw: 1 } as never] })).toThrow(/lockYaw is true or false/);
    expect(() => entryOf({ asset: 'x', anim: [{ clip: 'P@1:2' }] })).toThrow(/"clip" is one name/);
  });

  it('FB-098: dirs by name ("E", ["N","S"]) become chosen angles', () => {
    expect(entryOf({ name: 'p', asset: 'x', dirs: 'E' }).input.overrides).toMatchObject({ directions: '1', angles: [0] });
    expect(entryOf({ name: 'p', asset: 'x', dirs: ['N', 'S'] } as never).input.overrides).toMatchObject({ directions: '2', angles: [90, 270] });
    expect(entryOf({ name: 'p', asset: 'x', directions: 8 } as never).input.overrides).toEqual({ directions: '8' });
    expect(() => entryOf({ name: 'p', asset: 'x', dirs: 'Q' })).toThrow(/neither a direction count/);
  });

  it('SF-FB-024: scale 1.3 (or "130%", modelScale) is the model\'s own factor; "fit" is the scale mode', () => {
    expect(entryOf({ name: 'a', asset: 'x', scale: '130%' }).input.modelScale).toBe(1.3);
    expect(entryOf({ name: 'a', asset: 'x', modelScale: '1.25x' } as SpriteDecl).input.modelScale).toBe(1.25);
    expect(entryOf({ name: 'a', asset: 'x', scale: 1 }).input).not.toHaveProperty('modelScale');
    expect(entryOf({ name: 'a', asset: 'x', scale: 'fit' }).input.overrides).toMatchObject({ scale: 'fit' });
    expect(() => entryOf({ name: 'a', asset: 'x', scale: 'huge' })).toThrow(/scale must be "fit" or the model's size factor/);
    expect(() => entryOf({ name: 'a', asset: 'x', scale: 40 })).toThrow(/size factor/);
  });

  it('SF-FB-025: still "Clip@2.4" (or a list, or an anim { clip, still }) is kept as "Clip@still=2.4"', () => {
    expect(entryOf({ name: 'boss', asset: 'x', anim: 'Victory_Pose', still: ['Victory_Pose@2.4', 'Victory_Pose@0.5=intro'] }).input.stills).toEqual(['Victory_Pose@still=2.4', 'Victory_Pose@still=0.5=intro']);
    expect(entryOf({ name: 'boss', asset: 'x', anim: [{ clip: 'Victory_Pose', still: 2.4 }] }).input.animations).toEqual(['Victory_Pose@still=2.4']);
    expect(() => entryOf({ name: 'a', asset: 'x', still: 'Victory_Pose' })).toThrow(/<clip>@<seconds>/);
    expect(() => entryOf({ name: 'a', asset: 'x', still: 'Victory_Pose@-1' })).toThrow(/seconds/);
    expect(() => entryOf({ name: 'a', asset: 'x', anim: [{ clip: 'Victory_Pose', still: 1, trim: '0:2' }] })).toThrow(/a still is one frame/);
  });

  it('FB-070: a sprite\'s own ppm or "tile": null leaves the file\'s tile lock; metresPerTile without one is noted', () => {
    const file = (item: Record<string, unknown>) => parseApplyFile({ ...GAME_FILE, sprites: [{ name: 'item_crate', asset: 'POLYGON_War/SM_Prop_Crate_02', template: 'still', ...item }] }).entries[0];
    expect(file({ ppm: 300 }).input.overrides).toMatchObject({ ppm: 300 });
    expect(file({ ppm: 300 }).input.overrides?.tile).toBeUndefined();
    for (const tile of [null, false, 'none']) expect(file({ tile }).input.overrides).toMatchObject({ scale: 'fit' });
    expect(file({ tile: null }).input.overrides?.tile).toBeUndefined();
    expect(file({ tile: null }).input.overrides?.metresPerTile).toBeUndefined();
    expect(file({ tile: null, metresPerTile: 0.125 }).notes).toEqual([expect.stringMatching(/metresPerTile 0.125 is ignored: the sprite leaves the tile lock/)]);
    expect(file({ tile: '64x32', ppm: 300 }).input.overrides).toMatchObject({ tile: '64x32', ppm: 300 });
    expect(() => entryOf({ name: 'a', asset: 'x', scale: 'free' as never })).toThrow(/scale must be "fit"/);
  });

  it('FB-060: the file\'s top-level light is every sprite\'s default; a typo is refused', () => {
    const file = parseApplyFile({ light: 'night', sprites: [{ name: 'a', asset: 'x' }, { name: 'b', asset: 'y', light: 'dusk' }] });
    expect(file.entries.map((e) => e.input.light)).toEqual([{ preset: 'night' }, { preset: 'dusk' }]);
    expect(() => entryOf({ name: 'a', asset: 'x', light: 'sunset' })).toThrow(/sprite: light: unknown light "sunset"/);
  });
});

describe('parity: a sprite renders what ssg export renders', () => {
  it('--class rifle --anim <moves>: the same moves, as movesets minus the rest (editable in the app)', async () => {
    const { exp, spr, spec } = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: ['idle', 'walk'] });
    expect(labels(spr)).toEqual(labels(exp));
    expect(labels(spr).length).toBe(2);
    expect(spec.classes).toEqual(['rifle']);
    expect(spec.excluded?.length).toBeGreaterThan(0);
  });

  it('-t still and named clips/templates: the same ad-hoc set', async () => {
    const { exp, spr, kind } = await both({ asset: 'SM_Bld_Bunker_01', template: 'still' });
    expect(labels(spr)).toEqual(['still']);
    expect(spr.set.items).toEqual(exp.set.items);
    expect(kind).toBe('object');
  });

  it('--with Pack/Model: the same held items (a layer each when layered)', async () => {
    const { exp, spr } = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', with: ['POLYGON_War/SM_Wep_American_Rifle_01', 'POLYGON_War/SM_Char_Attach_American_Helmet_01'], layered: true });
    expect(spr.loadout).toEqual(exp.loadout);
    expect(spr.loadout?.map((i) => [i.asset, i.cls ?? null])).toEqual([[2, 'rifle'], [3, null]]);
    expect(spr.layered).toEqual(exp.layered);
    const flat = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', with: 'SM_Wep_American_Rifle_01' });
    expect(flat.exp.layered).toBeUndefined();
    expect(flat.spr.layered).toBeUndefined();
  });

  it('--view iso8 --tile 64x32 --metres-per-tile 1 --fps: the same camera and scale', async () => {
    const { exp, spr } = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', view: 'iso8', tile: '64x32', metresPerTile: 1, fps: 10, dirs: 8 } as SpriteDecl);
    for (const k of ['pitch', 'directions', 'projection', 'fps', 'padding'] as const) expect(spr.view[k], k).toEqual(exp.view[k]);
    expect(spr.view.scale).toEqual({ mode: 'tile', tilePx: 64, shape: 'diamond', metresPerTile: 1 });
    expect(spr.view.scale).toEqual(exp.view.scale);
  });

  it('--dirs 4d on a prop: four directions, not the one default facing; --facings and --slice columns', async () => {
    const { exp, spr, spec } = await both({ asset: 'SM_Bld_Bunker_01', template: 'still', view: 'iso8', tile: '64x32', dirs: '4d' });
    expect([exp.view.directions, exp.view.facings, spr.view.directions, spec.view.facings]).toEqual(['4d', undefined, '4d', 0]);
    const one = await both({ asset: 'SM_Bld_Bunker_01', template: 'still', view: 'iso8', tile: '64x32' });
    expect([one.exp.view.facings, one.spr.view.facings]).toEqual([1, 1]);
    const wall = await both({ asset: 'SM_Env_Sandbag_Wall_01', template: 'still', view: 'iso8', tile: '64x32', facings: 2, slice: 'columns' });
    expect([wall.spr.view.facings, wall.spr.view.slice, wall.exp.view.facings, wall.exp.view.slice]).toEqual([2, 'columns', 2, 'columns']);
  });

  it('--max-seconds, --format phaser3, --atlas, --anim-prefix, --uniform and layers: the same settings', async () => {
    const m = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', maxSeconds: 2 });
    expect([m.exp.maxSeconds, m.spr.maxSeconds]).toEqual([2, 2]);
    const { exp, spr } = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', format: 'phaser3', atlas: true, animPrefix: 'ranger/' } as SpriteDecl);
    expect(spr.profile.id).toBe('phaser3');
    expect(spr.profile.animationName).toBe(exp.profile.animationName);
    expect(spr.profile.animationName.startsWith('ranger/')).toBe(true);
    expect(spr.profile.layout).toEqual(exp.profile.layout);
    expect(spr.profile.layout.mode).toBe('atlas');
    const u = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', tile: '64x32', uniform: true, layers: ['normal'] });
    expect([u.spr.uniformFrame, u.exp.uniformFrame, u.spr.layers, u.exp.layers]).toEqual([true, true, ['normal'], ['normal']]);
    const n = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', tile: '64x32', uniform: false });
    expect([n.spr.uniformFrame, n.exp.uniformFrame]).toEqual([false, false]);
  });

  it('pivot, turret, portrait and split as the export flags; refused where they cannot apply', async () => {
    const o = await both({ asset: 'SM_Veh_Car_01', states: 'auto', pivot: 'origin' });
    expect([o.exp.pivot, o.spec.pivot, o.spr.pivot]).toEqual(['origin', 'origin', 'origin']);
    expect(() => entryOf({ name: 'a', asset: 'x', pivot: 'centre' } as unknown as SpriteDecl)).toThrow(/pivot must be "anchor".*or "origin"/);
    const t = await both({ asset: 'POLYGON_War/SM_Veh_German_Tank_01', template: ['drive', 'fire'], dirs: '8', turret: '16' });
    expect([t.exp.turret, t.spec.turret, t.spr.turret]).toEqual([{ dirs: '16' }, { dirs: '16' }, { dirs: '16' }]);
    expect((await both({ asset: 'POLYGON_War/SM_Veh_German_Tank_01', template: 'drive', turretDirs: 32 } as SpriteDecl)).spr.turret).toEqual({ dirs: '32' });
    await expect(both({ asset: 'SM_Veh_Car_01', template: 'drive', turret: true })).rejects.toThrow(/SM_Veh_Car_01 has no turret or barrel part/);
    expect(resolvedSettings(t.spec, BUILTIN_SETS).turret).toBe('turret 16 dirs');
    const p = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', portrait: '192,front,#1a1a24' });
    expect(p.spr.portrait).toEqual({ size: 192, angle: 0, background: '#1a1a24' });
    expect(resolvedSettings(p.spec, BUILTIN_SETS).portrait).toBe('portrait 192×192 front #1a1a24');
    const soldier = { asset: 'POLYGON_War/Character_American_Soldier_01', class: 'rifle', anim: ['idle', 'walk', 'shoot'], with: ['POLYGON_War/SM_Wep_American_Rifle_01'] } as SpriteDecl;
    const s = await both({ ...soldier, split: { at: 'waist', whole: true } });
    expect([s.exp.split, s.spec.split, s.spr.split]).toEqual([{ at: 'waist', whole: true }, { at: 'waist', whole: true }, { at: 'waist', whole: true }]);
    await expect(both({ ...soldier, layered: true, split: 'waist' })).rejects.toThrow(/leave out layered/);
    await expect(both({ ...soldier, anim: ['walk', 'run'], split: 'waist' })).rejects.toThrow(/no move of the set goes on the torso sheet/);
    expect(resolvedSettings(s.spec, BUILTIN_SETS).split).toBe('split waist + whole');
  });

  it('FB-060: light "dusk" or overrides as --light; stored and sent only when not day', async () => {
    const o = await both({ asset: 'SM_Veh_Car_01', template: 'still', light: 'dusk' }, 'project');
    expect([o.exp.light, o.spec.light, o.spr.light]).toEqual([{ preset: 'dusk' }, { preset: 'dusk' }, { preset: 'dusk' }]);
    for (const light of [undefined, 'day']) {
      const d = await both({ asset: 'SM_Veh_Car_01', template: 'still', ...(light ? { light } : {}) });
      expect([d.exp.light, d.spr.light, 'light' in d.spec]).toEqual([undefined, undefined, false]);
    }
    const prev = { spec: o.spec, clips: [] as string[], loadout: [] };
    const plan = planChange(prev, { ...o.spec, light: { preset: 'night' } }, BUILTIN_SETS, { clips: [] });
    expect([plan.reasons, plan.reuse]).toEqual([['lighting changed'], false]);
    expect(resolvedSettings(o.spec, BUILTIN_SETS).light).toBe('dusk');
    expect(resolvedSettings(stateSpec(), BUILTIN_SETS).light).toBe('day');
  });

  it('--states: the states are the moves, on one sheet; a vehicle with states takes one facing in iso (FB-026)', async () => {
    const { exp, spr, spec } = await both({ asset: 'SM_Veh_Car_01', states: 'auto' });
    expect(Object.keys(spec.states ?? {})).toEqual(['intact', 'damaged']);
    expect(labels(spr)).toEqual(labels(exp));
    expect(labels(spr)).toEqual(['intact', 'damaged']);
    const tiled = withTileScale(defaultProjectDefaults(), '64x32', 1);
    const p = await both({ asset: 'SM_Veh_Car_01', template: 'still', states: 'auto' }, 'project', tiled);
    expect(p.spr.view.facings).toBe(1);
    expect((await both({ asset: 'SM_Veh_Car_01', states: 'auto', facings: 2 }, 'project', tiled)).spr.view.facings).toBe(2);
    expect((await both({ asset: 'SM_Veh_Car_01', states: 'auto', dirs: '8' }, 'project', tiled)).spr.view.facings).toBeUndefined();
    expect((await both({ asset: 'SM_Veh_Car_01', template: 'still' }, 'project', tiled)).spr.view.facings).toBeUndefined();
  });

  it('FB-062: dirs 1 on an object in an iso project is one facing of the iso view, not a custom view', async () => {
    const tiled = withTileScale(defaultProjectDefaults(), '64x32', 1);
    const plain = await both({ asset: 'SM_Bld_Bunker_01', template: 'still' }, 'project', tiled);
    expect([plain.spr.view.directions, plain.spr.view.facings]).toEqual(['8', 1]);
    for (const dirs of ['1', 1] as const) {
      const r = await both({ asset: 'SM_Bld_Bunker_01', template: 'still', dirs } as SpriteDecl, 'project', tiled);
      expect(r.spec.viewCardId).toBe(plain.spec.viewCardId);
      expect([r.spr.view.directions, r.spr.view.facings]).toEqual(['8', 1]);
    }
    expect((await both({ asset: 'SM_Bld_Bunker_01', template: 'still', dirs: '4d' }, 'project', tiled)).spr.view).toMatchObject({ directions: '4d', facings: 0 });
    expect((await both({ asset: 'SM_Bld_Bunker_01', template: 'still', view: 'side2', dirs: '1' }, 'project', tiled)).spr.view.directions).toBe('1');
  });

  it('FB-030: declared phaser sprites key their animations by the sprite name; export --project keeps the export\'s', async () => {
    const r = await both({ asset: 'SM_Prop_Crate_02', template: 'still', format: 'phaser3' }, 'project');
    expect(r.spr.profile.animationName).toBe('x/{clip}_{dir}');
    expect(r.exp.profile.animationName).toBe('{base}/{clip}_{dir}');
    expect((await both({ asset: 'SM_Prop_Crate_02', template: 'still', format: 'phaser3' }, 'export')).spr.profile.animationName).toBe('{base}/{clip}_{dir}');
    expect((await both({ asset: 'SM_Prop_Crate_02', template: 'still', format: 'phaser3', animPrefix: 'crate_' }, 'project')).spr.profile.animationName).toBe('crate_{clip}_{dir}');
  });

  it('project mode: named settings are the sprite\'s own, the rest follows the project', async () => {
    const tiled = withTileScale(defaultProjectDefaults(), '64x32', 1);
    const r = await both({ asset: 'SM_Prop_Crate_02', template: 'still', dirs: '4d', format: 'phaser3' }, 'project', tiled);
    expect(r.own).toEqual(['view', 'engine']);
    expect(r.spec.inherit).toEqual(['look', 'size', 'gender']);
    expect(r.spr.view.scale).toEqual({ mode: 'tile', tilePx: 64, shape: 'diamond', metresPerTile: 1 });
    expect(r.spr.profile.id).toBe('phaser3');
    // Nothing to do named: the kind's own moves.
    const plain = await spriteSpecFor(fakeSources(), { defaults: tiled }, entryOf({ name: 'soldier', asset: 'Character_American_Soldier_01' }));
    expect(plain.spec.setId).toBe('builtin_locomotion');
    expect(plain.spec.inherit).toEqual(['view', 'look', 'size', 'engine', 'gender']);
    expect(plain.asset).toMatchObject({ id: 1, pack: 'POLYGON_War' });
  });

  it('FB-021: equipment is baked unless the entry says layered, in both modes; a layered entry does not own the format', async () => {
    const SOLDIER = { asset: 'POLYGON_War/Character_American_Soldier_01', class: 'rifle', anim: ['idle', 'walk'], with: ['POLYGON_War/SM_Wep_American_Rifle_01', 'POLYGON_War/SM_Char_Attach_American_Helmet_01'], view: 'iso8', tile: '64x32', format: 'phaser3' } as SpriteDecl;
    const project = { ...defaultProjectDefaults(), layered: true };
    for (const mode of ['project', 'export'] as const) {
      for (const layered of [undefined, true, 'mask', 'none', false] as const) {
        const { exp, spr, spec } = await both({ ...SOLDIER, ...(layered !== undefined ? { layered } : {}) }, mode, project);
        expect(spr.layered, `${mode} ${layered}`).toEqual(exp.layered);
        expect(spr.loadout).toEqual(exp.loadout);
        expect(spec.layeredOwn).toBe(true);
      }
      const baked = await both(SOLDIER, mode, project);
      expect([baked.spr.layered, baked.spec.layered]).toEqual([undefined, false]);
    }
    const { own, spec } = await both({ asset: 'Character_American_Soldier_01', class: 'rifle', anim: 'idle', with: 'SM_Wep_American_Rifle_01', layered: true }, 'project');
    expect(own).not.toContain('engine');
    expect([spec.layered, spec.layeredOwn]).toEqual([true, true]);
    const item = { asset: 2, target: 'hand_r' } as SpriteSpec['loadout'][number];
    const base = { ...stateSpec(), loadout: [item], inherit: ['engine'] } as SpriteSpec;
    expect(effectiveSpec(project, { ...base, layered: false }).layered).toBe(true);
    expect(effectiveSpec(project, { ...base, layered: false, layeredOwn: true }).layered).toBe(false);
    const plain = entryOf({ name: 'r', asset: 'x', with: 'y' });
    expect(layeringWarning(plain, { layered: true, loadout: [item] })).toMatch(/1 equipment item as separate layers \(mask\).*"layered": false/);
    expect(layeringWarning(plain, { layered: false, loadout: [item] })).toBeNull();
    expect(layeringWarning(entryOf({ name: 'r', asset: 'x', with: 'y', layered: true }), { layered: true, loadout: [item] })).toBeNull();
  });

  it('FB-086 / FB-077 / FB-094: declared moves are all a character gets; procedural stand-ins; templates kept as asked', async () => {
    const src = fakeSources();
    const clips = async (decl: SpriteDecl) => {
      const r = await spriteSpecFor(src, { defaults: defaultProjectDefaults() }, entryOf({ name: 'x', ...decl }));
      return labels(renderSpec({ id: 1, name: 'x', assetId: r.asset.id, spec: r.spec }, { defaults: defaultProjectDefaults() }));
    };
    expect(await clips({ asset: 'Character_American_Soldier_01', anim: [], template: [{ template: 'kneel_shoot:duration=1.5', with: 'SM_Wep_Knife_01', as: 'camera' }, { template: 'kneel_place', with: 'SM_Wep_RPG_01', as: 'plant' }] } as SpriteDecl)).toEqual(['camera_kneel_shoot', 'plant_kneel_place']);
    expect(await clips({ asset: 'Character_American_Soldier_01', template: ['crawl'] })).toEqual(['crawl']);
    expect(await clips({ asset: 'Character_American_Soldier_01' })).toEqual(['idle', 'walk', 'run']);
    expect(await clips({ asset: 'Character_American_Soldier_01', class: 'unarmed', anim: ['idle', 'walk', 'run', 'hit', 'death'] })).toEqual(['unarmed_idle', 'unarmed_walk', 'unarmed_run', 'unarmed_hit', 'unarmed_death']);
    const e = entryOf({ name: 'x', asset: 'Character_American_Soldier_01', class: 'rifle', anim: ['crouch_idle', 'death'], template: ['kneel_shoot:twoHanded=1,kick=6'], with: 'SM_Wep_American_Rifle_01' });
    const exp = (await buildSpec(src, e.input)).spec;
    expect(labels(exp)).toEqual(['rifle_crouch_idle', 'rifle_death', 'rifle_kneel_shoot']);
    expect(exp.set.items[2]).toMatchObject({ type: 'template', label: 'rifle_kneel_shoot', cls: 'rifle', layers: [{ id: 'kneel_shoot', params: { twoHanded: 1, kick: 6 } }] });
    const r = await spriteSpecFor(src, { defaults: defaultProjectDefaults() }, e);
    expect(labels(renderSpec({ id: 1, name: 'x', assetId: r.asset.id, spec: r.spec }, { defaults: defaultProjectDefaults() }))).toEqual(labels(exp));
  });

  it('SF-FB-018/023: with a class, installed clips by name are extra clips with their own windows; yaw locks keep the name', async () => {
    const ma = (id: number, name: string) => ({ id, name, category: 'Mixamo', pack: 'Mixamo', loop: false });
    const src = fakeSources([ma(80, 'MartialArts_Flip_Uppercut'), ma(81, 'MartialArts_Super_Ryker'), ma(82, 'MartialArts_Spin_Kick'), ma(83, 'MartialArts_Dash_Back'), ma(12, 'Boss_Punch'), ma(13, 'Boss_Kick')]);
    const entry = entryOf({ name: 'merc', asset: 'Character_American_Soldier_01', class: 'martial_arts', anim: ['MartialArts_Flip_Uppercut@3.70:4.60', { clip: 'MartialArts_Super_Ryker', trim: '0.2:2.8' }, 'MartialArts_Spin_Kick', { clip: 'MartialArts_Dash_Back', reverse: true }] });
    const r = await spriteSpecFor(src, { defaults: defaultProjectDefaults() }, entry);
    const spr = renderSpec({ id: 1, name: 'merc', assetId: r.asset.id, spec: r.spec }, { defaults: defaultProjectDefaults() });
    expect(labels(spr).slice(-4)).toEqual(['MartialArts_Flip_Uppercut', 'MartialArts_Super_Ryker', 'MartialArts_Spin_Kick', 'MartialArts_Dash_Back_reverse']);
    expect(labels(spr)).toContain('martial_arts_uppercut');
    expect(spr.set.items.filter((it) => it.cls === 'martial_arts').every((it) => !it.window)).toBe(true);
    expect(windowOf(spr, 'MartialArts_Flip_Uppercut')).toEqual({ start: 3.7, end: 4.6 });
    expect(windowOf(spr, 'MartialArts_Dash_Back_reverse')).toEqual({ reverse: true });
    const boss = entryOf({ name: 'boss', asset: 'Character_American_Soldier_01', class: 'martial_arts', anim: [{ clip: 'Boss_Punch', lockYaw: true }, 'Boss_Kick@lockyaw@0.2:'] });
    const b = await spriteSpecFor(src, { defaults: defaultProjectDefaults() }, boss);
    const bs = renderSpec({ id: 1, name: 'boss', assetId: b.asset.id, spec: b.spec }, { defaults: defaultProjectDefaults() });
    expect(labels(bs).slice(-2)).toEqual(['Boss_Punch', 'Boss_Kick']);
    expect(windowOf(bs, 'Boss_Punch')).toEqual({ lockYaw: true });
    expect(windowOf(bs, 'Boss_Kick')).toEqual({ start: 0.2, lockYaw: true });
    expect(src.warnings).toEqual([]);
  });

  it('SF-FB-003: a renamed clip\'s old name still resolves, with a warning, and the spec keeps the clip id', async () => {
    const src = fakeSources([{ id: 7, name: 'MartialArts_Idle', previousNames: ['Fighter_Idle'] }]);
    const r = await spriteSpecFor(src, { defaults: defaultProjectDefaults() }, entryOf({ name: 'merc', asset: 'POLYGON_War/Character_American_Soldier_01', anim: ['Fighter_Idle'] }));
    expect(r.spec.baseSet!.items[0]).toMatchObject({ name: 'Fighter_Idle', clip: 7 });
    expect(src.warnings).toEqual([expect.stringMatching(/^clip Fighter_Idle was renamed to MartialArts_Idle/)]);
    await expect(spriteSpecFor(src, { defaults: defaultProjectDefaults() }, entryOf({ name: 'merc', asset: 'POLYGON_War/Character_American_Soldier_01', anim: ['Fighter_Walk'] }))).rejects.toThrow(/No animation matches "Fighter_Walk"/);
  });

  it('SF-FB-010: movePrefix false gives a single moveset bare move names; SF-FB-024: the model scale is stored and sent', async () => {
    const src = fakeSources();
    const entry = entryOf({ name: 'merc', asset: 'Character_American_Soldier_01', class: 'martial_arts', movePrefix: false, anim: ['idle', 'crouch_punch@0.8:2.6'] });
    const exp = (await buildSpec(src, entry.input)).spec;
    expect(labels(exp)).toEqual(['idle', 'crouch_punch']);
    expect(windowOf(exp, 'crouch_punch')).toEqual({ start: 0.8, end: 2.6 });
    const r = await spriteSpecFor(src, { defaults: defaultProjectDefaults() }, entry);
    expect(r.spec.movePrefix).toBe(false);
    expect(labels(renderSpec({ id: 1, name: 'merc', assetId: r.asset.id, spec: r.spec }, { defaults: defaultProjectDefaults() })).sort()).toEqual(['crouch_punch', 'idle']);
    expect(() => entryOf({ name: 'm', asset: 'x', movePrefix: 'no' as never })).toThrow(/movePrefix must be true or false/);
    const boss = { asset: 'Character_American_Soldier_01', class: 'martial_arts', anim: 'idle', tile: '64x32' } as SpriteDecl;
    const t = await both({ ...boss, scale: 1.3 });
    expect([t.exp.modelScale, t.spec.modelScale, t.spr.modelScale]).toEqual([1.3, 1.3, 1.3]);
    expect(t.exp.view.scale).toMatchObject({ mode: 'tile', tilePx: 64 });
    const plain = await both(boss);
    expect([plain.exp.modelScale, plain.spec.modelScale, plain.spr.modelScale]).toEqual([undefined, undefined, undefined]);
    expect(sameSpec(plain.spec, plain.spec)).toBe(true);
    expect(sameSpec(plain.spec, t.spec)).toBe(false);
  });

  it('SF-FB-025: stills alone are the sprite\'s moves; with a class a move\'s still sits next to the moves', async () => {
    const src = fakeSources([{ id: 9, name: 'Victory_Pose', loop: false }]);
    const alone = entryOf({ name: 'end', asset: 'Character_American_Soldier_01', still: 'Victory_Pose@2.4' });
    const r = await spriteSpecFor(src, { defaults: defaultProjectDefaults() }, alone);
    expect(labels(renderSpec({ id: 1, name: 'end', assetId: r.asset.id, spec: r.spec }, { defaults: defaultProjectDefaults() }))).toEqual(['Victory_Pose_still']);
    const e = entryOf({ name: 'boss', asset: 'Character_American_Soldier_01', class: 'martial_arts', anim: ['idle', 'victory'], still: 'victory@1.5' });
    const exp = (await buildSpec(src, e.input)).spec;
    expect(labels(exp)).toEqual(['martial_arts_idle', 'martial_arts_victory', 'martial_arts_victory_still']);
    expect(exp.set.items[2]).toMatchObject({ cls: 'martial_arts', window: { still: 1.5 } });
  });

  it('FB-070: ppm under the sprite\'s own tile lock warns that the tile wins; scale fit with ppm is refused', async () => {
    const src = fakeSources();
    const r = await buildSpec(src, { assets: ['SM_Prop_Crate_02'], templates: ['still'], overrides: { tile: '64x32', ppm: 300 } });
    expect(r.spec.view.scale.mode).toBe('tile');
    expect(src.warnings).toEqual([expect.stringMatching(/ppm 300 is ignored/)]);
    const fit = await buildSpec(src, { assets: ['SM_Prop_Crate_02'], templates: ['still'], overrides: { scale: 'fit', frameSize: 64 } });
    expect([fit.spec.view.scale, fit.spec.view.frameWidth]).toEqual([{ mode: 'fit' }, 64]);
    await expect(spriteSpecFor(src, { defaults: defaultProjectDefaults() }, entryOf({ name: 'a', asset: 'SM_Prop_Crate_02', scale: 'fit', ppm: 300 }))).rejects.toThrow(/scale "fit" fits the model into the frame: leave out ppm/);
    // In project mode a sprite's own ppm (no tile) is its size; the dry-run settings show it.
    const tiled = withTileScale(defaultProjectDefaults(), '64x32', 1);
    const own = await spriteSpecFor(src, { defaults: tiled }, parseApplyFile({ ...GAME_FILE, sprites: [{ name: 'item_crate', asset: 'POLYGON_War/SM_Prop_Crate_02', template: 'still', ppm: 300 }] }).entries[0]);
    expect(resolvedSettings(effectiveSpec(tiled, own.spec), BUILTIN_SETS)).toMatchObject({ scale: 'ppm', ppm: 300, tile: null });
  });
});

describe('resolvedSettings', () => {
  it('lists every setting the render uses, held items and clip windows (SF-FB-004, SF-FB-012)', async () => {
    const src = fakeSources();
    const file = parseApplyFile({ view: 'side2', fps: 12, ppm: 128, mirror: true, atlas: true, maxSeconds: 3.5, dirs: '2', format: 'phaser3', sprites: [{ name: 'merc', asset: 'Character_American_Soldier_01', class: 'martial_arts', anim: ['idle', { clip: 'crouch_punch', trim: '0.8:2.6' }], with: ['POLYGON_War/SM_Char_Attach_American_Helmet_01'] }] });
    const project = projectDefaultsFrom(file.defaults);
    const r = await spriteSpecFor(src, { defaults: project }, file.entries[0]);
    const s = resolvedSettings(effectiveSpec(project, r.spec), BUILTIN_SETS, (id) => ASSETS.find((a) => a.id === id)?.name);
    expect(s).toMatchObject({ view: 'side2 (custom)', pitch: 0, dirs: '2', mirror: true, fps: 12, scale: 'ppm', ppm: 128, atlas: true, maxSeconds: 3.5, format: 'phaser3', clips: ['martial_arts_idle', 'martial_arts_crouch_punch'], with: ['SM_Char_Attach_American_Helmet_01'] });
    expect(s.clipWindows).toEqual({ martial_arts_crouch_punch: { start: 0.8, end: 2.6 } });
  });
});
