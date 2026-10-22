// Against the old generator's real data dir (read-only). Skipped, with a message, when it is not on this machine.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ftsQuery, openLibrary, type AssetEntry, type Library } from '../src/index.js';
import { KNOWN_SCALE_OVERRIDES } from '../src/synty/index.js';

const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const have = fs.existsSync(path.join(DATA_DIR, 'library.db'));
if (!have) console.warn(`library.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);

describe('ftsQuery', () => {
  it('quotes every word and makes the last a prefix', () => {
    expect(ftsQuery('soldier amer')).toBe('"soldier" AND "amer"*');
    expect(ftsQuery('  "quoted"  ')).toBe('"quoted"*');
    expect(ftsQuery('   ')).toBeNull();
  });
});

describe.skipIf(!have)('the old generator library, read-only', () => {
  const lib: Library = have ? openLibrary({ dataDir: DATA_DIR }) : (null as unknown as Library);
  const mtimes = () => ['library.db', 'library.db-wal'].map((f) => (fs.existsSync(path.join(DATA_DIR, f)) ? fs.statSync(path.join(DATA_DIR, f)).mtimeMs : null));
  const before = have ? mtimes() : [];

  it('opens the database read-only and lists the packs', () => {
    expect(lib.dbPath).toBe(path.join(DATA_DIR, 'library.db'));
    expect(lib.hasFts).toBe(true);
    const packs = lib.packs();
    expect(packs.length).toBeGreaterThan(10);
    const war = packs.find((p) => p.name === 'POLYGON_War')!;
    expect(war).toMatchObject({ kind: 'models', status: 'ready', version: 4 });
    expect(war.assets).toBeGreaterThan(100);
    expect(fs.existsSync(war.dir)).toBe(true);
    expect(lib.pack('polygon_war_v4')?.id).toBe(war.id);
    expect(lib.pack(war.id)?.name).toBe('POLYGON_War');
    expect(lib.pack('ANIMATION_Base_Locomotion')).toMatchObject({ kind: 'animations' });
    expect(lib.pack('no such pack')).toBeUndefined();
  });

  it('asset 378 is Character_American_Soldier_01 of POLYGON_War with a GLB on disk', () => {
    const a = lib.asset(378)!;
    expect(a).toMatchObject({ id: 378, pack: 'POLYGON_War', name: 'Character_American_Soldier_01', kind: 'character', status: 'ready', glb: 'glb/p7/a378.glb' });
    expect(a.glbPath()).toBe(path.join(DATA_DIR, 'glb', 'p7', 'a378.glb'));
    expect(fs.existsSync(a.glbPath()!)).toBe(true);
    expect(a.thumbPath()).toBe(path.join(DATA_DIR, 'thumbs', 'p7', 'a378.png'));
    expect(a.metaPath()).toBe(path.join(DATA_DIR, 'meta', 'p7', 'a378.json'));
    expect(a.meta()?.kind).toBe('character');
    expect(a.fbxPath()).toMatch(/POLYGON_War_v4\/Source Files\/Characters\/Character_American_Soldier_01\.fbx$/);
    expect(a.size?.[1]).toBeCloseTo(1.79, 1);
    // Characters are never rescaled.
    expect(a.scale()).toMatchObject({ scale: 1, source: 'auto', auto: 1 });
    expect(a.rig()).toMatchObject({ profile: 'synty_legacy', map: { hips: 'Hips', upperarm_l: 'Shoulder_L' } });
    expect(a.rig()!.bones).toContain('Hand_R');
    expect(a.roles()).toEqual([]);
    expect(a.category).toBeNull();
    expect(a.variants().variants).toEqual([]);
    // The DTO is plain: the methods are not enumerable.
    expect(Object.keys(a)).not.toContain('glbPath');
    expect(JSON.parse(JSON.stringify(a))).toMatchObject({ id: 378, name: 'Character_American_Soldier_01' });
    expect(lib.asset('378')?.id).toBe(378);
    expect(lib.asset(99999999)).toBeUndefined();
  });

  it('resolves pack-qualified names as the games write them, and bare names', () => {
    const knight = lib.asset('POLYGON_Dungeon_Pack/Character_Skeleton_Knight')!;
    expect(knight).toMatchObject({ pack: 'POLYGON_Dungeon_Pack', name: 'Character_Skeleton_Knight', kind: 'character' });
    expect(knight.rig()?.profile).toBe('synty_ue');
    expect(lib.asset('POLYGON_War/Character_American_Soldier_01')?.id).toBe(378);
    expect(lib.asset('polygon_war_v4/character_american_soldier_01')?.id).toBe(378);
    expect(lib.asset('Character_American_Soldier_01')?.id).toBe(378);
    expect(lib.asset('POLYGON_War/No_Such_Model')).toBeUndefined();
    expect(lib.asset('No_Such_Pack/Character_American_Soldier_01')).toBeUndefined();
    // Battle Royale ships some characters twice (FBX/Characters and FBX/Characters/Unreal_Characters): the lowest id wins,
    // assetsNamed lists them all.
    const dupes = lib.assetsNamed('SK_Chr_70sFemale_01', 'POLYGON_BattleRoyale');
    expect(dupes.length).toBe(2);
    expect(lib.asset('POLYGON_BattleRoyale/SK_Chr_70sFemale_01')?.id).toBe(Math.min(...dupes.map((d) => d.id)));
  });

  it("the luger's scale override is 10 (DB row) and agrees with scale-overrides.json", () => {
    const luger = lib.asset('POLYGON_War/SM_Wep_German_Pistol_01')!;
    expect(luger.kind).toBe('weapon');
    expect(luger.scale()).toMatchObject({ scale: 10, source: 'override', auto: 100, suspect: null });
    expect(luger.size?.[2]).toBeCloseTo(0.23, 2);
    // Every override in the DB is in the JSON with the same value (run `npm run scale-overrides -w @slop/library` after adding one).
    const rows = lib.scaleOverrides();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(KNOWN_SCALE_OVERRIDES.find((o) => o.pack === r.pack && o.fbx === r.fbx && o.variant === r.variant)?.scale, `${r.pack}/${r.fbx}`).toBe(r.scale);
    // The American grenade: metres in a centimetre pack, kept at 17 cm by the unit check (FB-071).
    const grenade = lib.asset('POLYGON_War/SM_Wep_American_Grenade_01')!;
    expect(grenade.scale()).toMatchObject({ scale: 1, source: 'auto' });
    expect(grenade.size?.[2] ?? 0).toBeLessThan(0.5);
    // A double-scaled prop: ×100.
    expect(lib.asset('POLYGON_City/SM_Prop_Hydrant_01')?.scale().scale).toBe(100);
  });

  it('part roles with the searchlight override, categories, slots, bundled attachments', () => {
    const ambo = lib.asset('POLYGON_City/SM_Veh_Car_Ambo_01')!;
    const roles = ambo.roles();
    expect(roles.find((p) => p.local === 'Door_l')).toMatchObject({ role: 'door', ruleRole: 'door', overridden: false });
    expect(roles.some((p) => p.role === 'wheel')).toBe(true);
    expect(roles[0]?.sizeM?.length).toBe(3);
    expect(ambo.category).toBe('vehicle');
    const searchlight = lib.asset('POLYGON_War/SM_Prop_Searchlight_Base_01')!;
    expect(searchlight.roles().find((p) => p.name === 'SM_Prop_Searchlight_Head_01')).toMatchObject({ role: 'turret', ruleRole: null, overridden: true });
    expect(searchlight.roles().find((p) => p.name === 'SM_Prop_Searchlight_Head_01')?.sizeM).toEqual([0.9, 1.07, 0.96]);
    expect(lib.asset('POLYGON_War/SM_Bld_Bunker_01')).toMatchObject({ category: 'military', damaged: false });
    expect(lib.asset('POLYGON_War/SM_Veh_American_Tank_Destroyed_01')).toMatchObject({ category: 'wreck', damaged: true });
    expect(lib.asset('POLYGON_War/SM_Char_Attach_American_Helmet_01')).toMatchObject({ kind: 'attachment', slot: 'head', category: null });
    const bundled = lib.assets({ query: 'armor', kind: 'attachment', limit: 100 }).find((a) => a.bundled)!;
    expect(bundled.bundled).toMatchObject({ skinned: true });
    expect(bundled.scale()).toMatchObject({ scale: 1, source: 'bundled' });
    expect(bundled.modular).toBe(true);
  });

  it('variants: damaged and destroyed versions of a model in its pack', () => {
    const tank = lib.asset('POLYGON_War/SM_Veh_German_Tank_01')!;
    const v = tank.variants();
    expect(v.intact.id).toBe(tank.id);
    expect(v.variants.map((x) => `${x.state}:${x.name}`)).toContain('destroyed:SM_Veh_German_Tank_Destroyed_01');
    expect(v.states.destroyed?.asset).toBe(lib.asset('POLYGON_War/SM_Veh_German_Tank_Destroyed_01')!.id);
    const wreck = lib.asset('POLYGON_War/SM_Veh_German_Tank_Destroyed_01')!;
    expect(wreck.variants().intact.name).toBe('SM_Veh_German_Tank_01');
  });

  it('searches assets by words (FTS), kind, pack and category', () => {
    const soldiers = lib.assets({ query: 'american soldier', limit: 10 });
    expect(soldiers.map((a) => a.name)).toContain('Character_American_Soldier_01');
    expect(soldiers.every((a) => a.status === 'ready')).toBe(true);
    const vehicles = lib.assets({ kind: 'vehicle', pack: 'POLYGON_War' });
    expect(vehicles.length).toBeGreaterThan(5);
    expect(vehicles.every((a) => a.kind === 'vehicle' && a.pack === 'POLYGON_War')).toBe(true);
    const wrecks = lib.assets({ pack: 'POLYGON_War', category: 'wreck', limit: 50 });
    expect(wrecks.map((a) => a.name)).toContain('SM_Veh_American_Tank_Destroyed_01');
    expect(wrecks.every((a) => a.category === 'wreck')).toBe(true);
    expect(lib.assets({ kind: ['character', 'vehicle'], limit: 5 }).every((a) => a.kind === 'character' || a.kind === 'vehicle')).toBe(true);
    expect(lib.assets({ query: 'zzzz_no_such_model_zzzz' })).toEqual([]);
    expect(lib.assets({ pack: 'no such pack' })).toEqual([]);
    expect(() => lib.assets({ category: 'spaceship' as never })).toThrow(/unknown category/);
    const page1 = lib.assets({ pack: 'POLYGON_War', limit: 3 });
    const page2 = lib.assets({ pack: 'POLYGON_War', limit: 3, offset: 3 });
    expect(page1.map((a) => a.id)).not.toEqual(page2.map((a) => a.id));
    // Errors are hidden unless asked for.
    expect(lib.assets({ status: 'error', limit: 5 }).every((a) => a.status === 'error')).toBe(true);
  });

  it('animations({ query: "Walk_F" }) finds the ANIMATION_Base_Locomotion clips', () => {
    const walks = lib.animations({ query: 'Walk_F' });
    const base = walks.filter((n) => n.pack === 'ANIMATION_Base_Locomotion' && n.name === 'Walk_F');
    // One copy per rig family and gender.
    expect(base.length).toBe(4);
    expect(new Set(base.map((n) => n.rig))).toEqual(new Set(['synty_legacy', 'synty_ue']));
    expect(new Set(base.map((n) => n.set))).toEqual(new Set(['Polygon', 'Sidekick']));
    expect(base[0]).toMatchObject({ category: 'Locomotion/Walk', loop: true, rootMotion: false, status: 'ready', needsMapping: false, frames: 32, fps: 30 });
    expect(walks.some((n) => n.name === 'Walk_F_RM' && n.rootMotion)).toBe(true);
    expect(lib.animations({ query: 'Walk_F', pack: 'ANIMATION_Base_Locomotion', rigKind: 'synty_ue', gender: 'Masculine', rootMotion: false }).map((n) => n.name)).toContain('Walk_F');
    expect(lib.animations({ rigKind: 'mixamo' }).map((n) => n.name)).toEqual(['Angry', 'Walking']);
    expect(lib.animations({ category: 'Locomotion/Run', limit: 20 }).every((n) => n.category?.startsWith('Locomotion/Run'))).toBe(true);
    // Clips without a rig: prop clips (a bow's limbs) need no mapping, humanoid ones do.
    const unmapped = lib.animations({ rigKind: null });
    expect(unmapped.length).toBeGreaterThan(0);
    expect(unmapped.every((n) => n.rig === null)).toBe(true);
  });

  it('animation(ref) by id or name, bones and bakes without ever baking', () => {
    const walk = lib.animation('Walk_F')!;
    expect(walk).toMatchObject({ name: 'Walk_F', rootMotion: false });
    expect(walk.rig).not.toBeNull();
    expect(walk.bones()).toContain('Hips');
    expect(lib.animation(walk.id)?.name).toBe('Walk_F');
    expect(lib.animation(String(walk.id))?.name).toBe('Walk_F');
    expect(walk.metaPath()).toBe(path.join(DATA_DIR, 'meta', `p${walk.packId}`, `n${walk.id}.json`));
    expect(walk.fbxPath()).toMatch(/\.fbx$/);
    // A bake exists only where the old server made one: never a Blender run here.
    const bakes = path.join(DATA_DIR, 'bakes');
    const existing = fs.readdirSync(bakes).flatMap((d) => fs.readdirSync(path.join(bakes, d)).filter((f) => /^n\d+\.glb$/.test(f)).map((f) => ({ asset: Number(d.slice(1)), anim: Number(f.slice(1, -4)) })));
    expect(existing.length).toBeGreaterThan(0);
    const one = existing[0]!;
    expect(lib.animation(one.anim)!.bakePath(one.asset)).toBe(path.join(bakes, `a${one.asset}`, `n${one.anim}.glb`));
    expect(lib.animation(one.anim)!.bakePath(999999999)).toBeNull();
    expect(walk.bakePath(999999999, { inPlace: false })).toBeNull();
    expect(fs.existsSync(path.join(bakes, 'a999999999'))).toBe(false);
    expect(lib.animation('no such clip')).toBeUndefined();
  });

  it('never wrote to the database', () => {
    lib.close();
    expect(mtimes()).toEqual(before);
    expect(fs.existsSync(path.join(DATA_DIR, 'library.db-journal'))).toBe(false);
  });
});

// Keeps the type in use for readers of this file: an entry is the plain Asset plus lookups.
export type { AssetEntry };
