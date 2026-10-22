// Pure unit tests on the Synty knowledge, ported with the code from the old generator (the source test file is
// named on each describe) plus a few of this package's own.
import { describe, expect, it } from 'vitest';
import {
  animationFiles, animationInfo, autoCategory, autoScaleFix, baseScaleFix, boneForAttachment, CANONICAL, combatCategory, defaultHand, detect, findStateVariants,
  ingestPriority, isAttachmentName, isBundledAttachment, isFxName, isGroupDoubleScaled, isModelFbx, isPackDoubleScaled, isWeaponName, KNOWN_SCALE_OVERRIDES, knownScaleOverride,
  localName, nameWords, packScaleVerdict, parsePackName, parseStateName, partMetres, plausibleSizeOf, propose, refineKind, ROLES, roleFor, scaleFixFor, scaleGroupOf,
  sizeSuspectFor, slotFor, unitCheckedFix, type VariantCandidate,
} from '../src/synty/index.js';

describe('naming → kind (apps/server/test/kinds.test.ts, packs.test.ts, packages/shared/src/fx.test.ts)', () => {
  it('matches the worker FX rule', () => {
    for (const n of ['FX_Sphere_Puff_01', 'SM_Flame_FX', 'SM_LightRayCube 1', 'SunShafts', 'SM_Particle_Smoke_01', 'SM_Env_GlowingOrb_01', 'FX_Electricity', 'FX_Bubble_Half_01', 'FX_Cone_01', 'FX_Water_Rapids_01', 'SM_Flame_Mesh_01'])
      expect(isFxName(n), n).toBe(true);
    for (const n of ['FX_Healthcube_01', 'FX_Shard_Rock_01', 'FX_SM_Prop_Candle_01', 'FX_Cart_Mesh_01', 'FX_Arrow_01', 'SM_Prop_Candle_Flame_01', 'SM_Prop_Lecturn_01', 'FX_Money_Coin_01', 'SM_FX_Crowd_Group_01'])
      expect(isFxName(n), n).toBe(false);
  });
  it('recognises weapons across packs', () => {
    for (const n of ['SM_Wep_Sword_01', 'SM_Prop_WizardStaff_01', 'SM_Prop_SwordOrnate_01', 'SM_Item_Sword', 'SM_Arrow_01', 'Rigged_CrossBow_Testing']) expect(isWeaponName(n), n).toBe(true);
    for (const n of ['SM_Prop_Arrow_Basket_01', 'SM_Prop_Barrel_01', 'SM_Prop_Table_01', 'SM_Prop_Stafford_Sign', 'SM_Prop_Sword_Altar_01', 'SM_Prop_Sword_Display_01']) expect(isWeaponName(n), n).toBe(false);
  });
  it('attachments and bundled meshes', () => {
    expect(isAttachmentName('SM_Char_Attach_American_Helmet_01')).toBe(true);
    expect(isAttachmentName('SM_Wep_Mod_Attach_Scope_01')).toBe(true);
    expect(isAttachmentName('SM_Prop_Light_Attachment_01')).toBe(false);
    expect(isBundledAttachment('SM_Gen_Chr_Attach_Hair_01')).toBe(true);
    expect(isBundledAttachment('SK_Chr_Biker')).toBe(false);
  });
  it('refineKind: weapons named as props or items, attachments and FX apart from them', () => {
    expect(refineKind('SM_Prop_WizardStaff_01', 'prop')).toBe('weapon');
    expect(refineKind('SM_Prop_Druid_Staff_01', 'prop')).toBe('weapon');
    expect(refineKind('SM_Item_Sword', 'character')).toBe('weapon');
    expect(refineKind('SM_Item_Chr_Shield_01', 'prop')).toBe('weapon');
    expect(refineKind('Rigged_Bow_Testing', 'rigged')).toBe('weapon');
    expect(refineKind('SM_Arrow_01', 'prop')).toBe('weapon');
    expect(refineKind('SM_Chr_Attach_Bow_01', 'attachment')).toBe('weapon');
    expect(refineKind('SM_Wep_Mod_Attach_Scope_01', 'weapon')).toBe('attachment');
    expect(refineKind('SK_Chr_Attach_Hair_01', 'character')).toBe('attachment');
    expect(refineKind('SM_Char_Attach_American_Helmet_01', 'prop')).toBe('attachment');
    expect(refineKind('SM_Wep_American_Rifle_01', 'multipart')).toBe('weapon');
    expect(refineKind('SM_Env_GlowingOrb_01', 'prop')).toBe('fx');
    expect(refineKind('FX_Sphere_Puff_01', 'prop')).toBe('fx');
    expect(refineKind('FX_LightRay_Cube_01', 'rigged')).toBe('fx');
    expect(refineKind('FX_SM_Prop_Candle_01', 'prop')).toBe('prop');
    expect(refineKind('FX_Healthcube_01', 'prop')).toBe('prop');
    expect(refineKind('SM_Prop_Arrow_Basket_01', 'prop')).toBe('prop');
    expect(refineKind('SM_Prop_Light_Attachment_01', 'prop')).toBe('prop');
    expect(refineKind('SM_Veh_Arrow_Launcher_01', 'vehicle')).toBe('vehicle');
    expect(refineKind('SM_Veh_Car_Ambo_01', 'vehicle')).toBe('vehicle');
    expect(refineKind('A_Walk_F', 'animation')).toBe('animation');
  });
});

describe('categories (packages/shared/src/categories.test.ts)', () => {
  it('splits Synty names into singular words', () => {
    expect(nameWords('SM_Prop_CardboardBox_01')).toEqual(['sm', 'prop', 'cardboard', 'box']);
    expect(nameWords('SM_Env_Rocks_Small_02')).toEqual(['sm', 'env', 'rock', 'small']);
    expect(nameWords('SM_Prop_Glass_01')).toEqual(['sm', 'prop', 'glass']);
  });
  const TABLE: [string, string, string | null, boolean?][] = [
    ['SM_Bld_Villa_01', 'multipart', 'building'],
    ['SM_Bld_Wall_L_Gate_03', 'prop', 'wall_fence'],
    ['SM_Bld_Barn_Broken_01', 'multipart', 'building', true],
    ['SM_Bld_Ruin_Tower_Broken_01', 'prop', 'building', true],
    ['SM_Prop_Warehouse_Light_01', 'prop', 'misc'],
    ['SM_Env_Tree_Palm_03', 'prop', 'vegetation'],
    ['SM_Env_Tree_Destroyed_01', 'prop', 'vegetation', true],
    ['SM_Env_Rock_Medium_03', 'prop', 'rock'],
    ['SM_Env_Wall_04', 'prop', 'wall_fence'],
    ['SM_Prop_WireFence_02', 'prop', 'wall_fence'],
    ['SM_Prop_Light_Wall_03', 'prop', 'misc'],
    ['SM_Prop_Barrier_Concrete_01', 'prop', 'barrier'],
    ['SM_Prop_Crate_Wood_03', 'prop', 'crate_container'],
    ['SM_Prop_Barrel_Broken_01', 'prop', 'crate_container', true],
    ['SM_Prop_Chair_02', 'prop', 'furniture'],
    ['SM_Veh_German_Tank_Destroyed_01', 'prop', 'wreck', true],
    ['SM_Veh_Car_Damaged_01', 'prop', 'wreck', true],
    ['SM_Prop_Car_Wrecked_Van_01', 'prop', 'wreck', true],
    ['SM_Env_Sandbag_Wall_01', 'prop', 'military'],
    ['SM_Prop_TankTrap_01', 'prop', 'military'],
    ['SM_Bld_Bunker_Large_Damaged_01', 'prop', 'military', true],
    ['SM_Env_Road_Straight_Damaged_01', 'multipart', 'ground', true],
    ['SM_Prop_Puddle_03', 'prop', 'decal'],
    ['SM_Prop_Generator_01', 'prop', 'misc'],
    ['SM_Veh_German_Tank_01', 'vehicle', 'vehicle'],
    ['Character_American_Soldier_01', 'character', null],
    ['SK_Wep_Rifle_01', 'weapon', null],
    ['SM_Chr_Attach_Helmet_01', 'attachment', null],
  ];
  it.each(TABLE)('%s (%s) → %s', (name, kind, category, damaged = false) => {
    const r = autoCategory(name, kind);
    expect(r?.category ?? null).toBe(category);
    if (r) expect(r.damaged).toBe(damaged);
  });
});

describe('attachment bones and slots (packages/shared/src/export/layers.test.ts)', () => {
  it('boneForAttachment', () => {
    expect(boneForAttachment('SM_Char_Attach_American_Helmet_01')).toBe('head');
    expect(boneForAttachment('SM_Chr_Attach_Cap_01')).toBe('head');
    expect(boneForAttachment('SM_Chr_Attach_Cape_01')).toBe('spine3');
    expect(boneForAttachment('SM_Chr_Attach_Backpack_01')).toBe('spine3');
    expect(boneForAttachment('SM_Chr_Attach_Canteen_01')).toBe('hips');
    expect(boneForAttachment('SM_Chr_Attach_Watch_01')).toBe('hand_r');
    expect(boneForAttachment('SM_Gen_Chr_Attach_Ponytail_01')).toBe('head');
    expect(boneForAttachment('SM_Chr_Attach_Thing_01', 'hair')).toBe('head');
    expect(boneForAttachment('SM_Chr_Attach_Thing_01')).toBeNull();
  });
  it('slotFor', () => {
    expect(slotFor('SM_Wep_American_Rifle_01', 'weapon')).toBe('weapon');
    expect(slotFor('SM_Prop_Shield_01', 'weapon')).toBe('offhand');
    expect(slotFor('SM_Char_Attach_American_Helmet_01', 'attachment')).toBe('head');
    expect(slotFor('SM_Char_Attach_Hair_02', 'attachment')).toBe('hair');
    expect(slotFor('SM_Gen_Chr_Attach_Ponytail_01', 'attachment')).toBe('hair');
    expect(slotFor('SM_Chr_Attach_Backpack_01', 'attachment')).toBe('back');
    expect(slotFor('SM_Chr_Attach_Armour_01', 'attachment')).toBe('body');
    expect(slotFor('SM_Chr_Attach_Watch_01', 'attachment')).toBe('accessory');
    expect(slotFor('FX_Cone_01', 'fx')).toBe('fx');
  });
  it('defaultHand', () => {
    expect(defaultHand('SM_Wep_Longbow_01')).toBe('hand_l');
    expect(defaultHand('SM_Prop_Shield_01')).toBe('hand_l');
    expect(defaultHand('SM_Wep_American_Rifle_01')).toBe('hand_r');
  });
});

describe('scale fixes (apps/server/test/scale.test.ts)', () => {
  it('fixes double-scaled packs (POLYGON City)', () => {
    expect(autoScaleFix('SM_Prop_Hydrant_01', 'prop', 0.011, true)).toBe(100);
    expect(autoScaleFix('SM_Prop_LightPole_Base_02', 'prop', 0.0495, true)).toBe(100);
    expect(autoScaleFix('SM_Bld_OfficeRound_01', 'prop', 0.4, true)).toBe(100);
    expect(autoScaleFix('SM_Bld_Shop_01', 'prop', 0.055, false)).toBe(100);
    expect(autoScaleFix('SM_Bld_Bunker_01', 'prop', 0.0762, false)).toBe(100);
  });
  it('leaves real small things alone', () => {
    expect(autoScaleFix('FX_Money_Coin_01', 'prop', 0.056, false)).toBe(1);
    expect(autoScaleFix('SM_Char_Attach_American_Helmet_01', 'attachment', 0.36, true)).toBe(1);
    expect(autoScaleFix('SM_Veh_Car_Ambo_01', 'vehicle', 5.09, true)).toBe(1);
    expect(autoScaleFix('SK_Character_Biker', 'character', 2.0, true)).toBe(1);
    expect(autoScaleFix('SM_Prop_Barrel_01', 'prop', null, true)).toBe(1);
    expect(autoScaleFix('FX_SM_Prop_Candle_01', 'prop', 0, false)).toBe(1);
    expect(autoScaleFix('SM_Wep_Minigun_Clean_01_Button_01', 'weapon', 0.018, false)).toBe(1);
    expect(autoScaleFix('SM_Wep_Straightsword_01', 'weapon', 0.012, true)).toBe(100);
  });
  it('detects double-scaled packs and groups from the typical size', () => {
    expect(isPackDoubleScaled([0.011, 0.04, 0.05, 0.03, 0.2, 1.2])).toBe(true);
    expect(isPackDoubleScaled([0.05, 0.5, 1.3, 0.4, 0.7, 0.12])).toBe(false);
    expect(isPackDoubleScaled([0.01, 0.02])).toBe(false);
    expect(isGroupDoubleScaled([0.03, 0.05, 0.08, 0.2, 0.09, 0.6, 30])).toBe(true);
    expect(isGroupDoubleScaled([0.4, 1.5, 3, 6, 8, 2.2, 40])).toBe(false);
    expect(isGroupDoubleScaled([0.03, 0.05])).toBeNull();
    expect(scaleGroupOf('SM_Gen_Env_Bush_Part_01')).toBe('Env');
    expect(scaleGroupOf('SM_Bld_Barn_01')).toBe('Bld');
    expect(scaleGroupOf('SM_Prop_Crate_01')).toBeNull();
  });
  it('shrinks hand blades that import metres long (POLYGON War bayonets)', () => {
    expect(autoScaleFix('SM_Wep_American_Bayonet_01', 'weapon', 4.0)).toBe(0.1);
    expect(autoScaleFix('SM_Wep_Russian_Bayonet_01', 'weapon', 4.8, true)).toBe(0.1);
    expect(autoScaleFix('SM_Wep_Knife_01', 'weapon', 0.3)).toBe(1);
    expect(autoScaleFix('SM_Wep_Sword_01', 'weapon', 1.1)).toBe(1);
  });
  it('buildings and environment pieces by their group (FB-048)', () => {
    expect(autoScaleFix('SM_Env_Bush_01', 'prop', 1.617, false, false)).toBe(1);
    expect(autoScaleFix('SM_Env_Tree_Palm_Sappling_01', 'prop', 1.594, false, false)).toBe(1);
    expect(autoScaleFix('SM_Bld_Wall_Trim_03_Pillar_02', 'prop', 0.139, false, false)).toBe(1);
    expect(autoScaleFix('SM_Env_Pebble_03', 'prop', 0.052, false, false)).toBe(1);
    expect(autoScaleFix('SM_Env_Rubble_Stone_01', 'prop', 0.0076, false, false)).toBe(100);
    expect(autoScaleFix('SM_Bld_Shop_01', 'prop', 0.055, false, false)).toBe(100);
    expect(autoScaleFix('SM_Env_Tree_01', 'prop', 0.09, false, true)).toBe(100);
    expect(autoScaleFix('SM_Env_Runway_01', 'prop', 0.877, false, true)).toBe(100);
    expect(autoScaleFix('SM_Bld_State_Building_01', 'multipart', 15.97, false, true)).toBe(1);
    expect(autoScaleFix('SM_Env_Tree_01', 'prop', 0.3, true)).toBe(100);
    expect(autoScaleFix('SM_Env_Bush_01', 'prop', 1.6)).toBe(1);
  });
  // POLYGON War as measured (largest side, model units): its props are centimetres, so the pack is double-scaled.
  const WAR: [string, string, number][] = [
    ['SM_Wep_American_Grenade_01', 'weapon', 0.1658], ['SM_Wep_German_Grenade_01', 'weapon', 0.4168], ['SM_Wep_American_Rifle_01', 'weapon', 0.0111],
    ['SM_Wep_American_Pistol_01', 'weapon', 0.0018], ['SM_Wep_German_Pistol_01', 'weapon', 0.023], ['SM_Wep_Ammo_BulletLarge_01', 'weapon', 0.0574],
    ['SM_Wep_German_Scope_Long_01', 'weapon', 0.0546], ['SM_Wep_American_Bayonet_01', 'weapon', 4.0],
    ['SM_Prop_Crate_01', 'prop', 0.012], ['SM_Prop_Barrel_01', 'prop', 0.011], ['SM_Prop_Sandbag_01', 'prop', 0.009], ['SM_Prop_Radio_01', 'prop', 0.004], ['SM_Prop_Box_01', 'prop', 0.006],
  ];
  it('FB-071: the American grenade keeps its 17 cm instead of 16.6 m; the pack\'s other weapons still get ×100', () => {
    const verdict = packScaleVerdict(WAR.map(([name, , extent]) => ({ name, extent })));
    expect(verdict.double).toBe(true);
    const s = Object.fromEntries(WAR.map(([name, kind, e]) => [name, +(e * scaleFixFor({ name, kind }, e, verdict)).toFixed(3)]));
    expect(s.SM_Wep_American_Grenade_01).toBe(0.166);
    expect(s.SM_Wep_German_Grenade_01).toBe(0.417);
    expect(s.SM_Wep_Ammo_BulletLarge_01).toBe(0.057);
    expect(s.SM_Wep_American_Rifle_01).toBe(1.11);
    expect(s.SM_Wep_American_Pistol_01).toBe(0.18);
    expect(s.SM_Prop_Crate_01).toBe(1.2);
    // Off by some other factor (the luger, 10×; a scope): not guessed, left for the size flag and an override.
    expect(s.SM_Wep_German_Pistol_01).toBe(2.3);
    expect(s.SM_Wep_German_Scope_Long_01).toBe(5.46);
    expect(s.SM_Wep_American_Bayonet_01).toBe(0.4);
  });
  it('the base verdicts are unchanged where the name says nothing about the size', () => {
    expect(autoScaleFix('SM_Wep_American_Grenade_01', 'weapon', 0.1658, true)).toBe(1);
    expect(baseScaleFix('SM_Wep_American_Grenade_01', 'weapon', 0.1658, true)).toBe(100);
    expect(autoScaleFix('SM_Prop_Thing_01', 'prop', 0.1658, true)).toBe(100);
    expect(autoScaleFix('SM_Wep_Grenade_01', 'weapon', 0.0017, false)).toBe(100);
    expect(autoScaleFix('SM_Prop_Giant_Sword_01', 'weapon', 46.3, false)).toBe(1);
    expect(autoScaleFix('SM_Veh_Grenade_Truck_01', 'vehicle', 0.05, true)).toBe(1);
  });
});

describe('plausible sizes by name (packages/shared/src/plausibleSize.test.ts)', () => {
  it('knows held items and small props, specific before general', () => {
    expect(plausibleSizeOf('SM_Wep_American_Grenade_01')?.what).toBe('grenade');
    expect(plausibleSizeOf('SM_Wep_Grenade_Launcher_01')?.what).toBe('launcher');
    expect(plausibleSizeOf('SM_Wep_American_Rifle_Clip_01')?.what).toBe('magazine');
    expect(plausibleSizeOf('SM_Wep_German_Pistol_01')?.what).toBe('pistol');
    expect(plausibleSizeOf('SM_Wep_Russian_SubMachineGun_01')?.what).toBe('rifle');
    expect(plausibleSizeOf('SM_Gen_Prop_Medkit_01')?.what).toBe('first-aid kit');
  });
  it('says nothing for parts, holders, effects, icons and giants', () => {
    for (const n of ['SM_Prop_Grenade_Box_01', 'SM_Prop_Rifle_Rack_01', 'SM_Wep_Rifle_01_Slide_01', 'SM_Wep_Pistol_Ammo_01', 'FX_Grenade_01', 'SM_Icon_Sword_02', 'SM_Prop_Giant_Sword_01', 'SM_Prop_Telescope_01', 'SM_Prop_Crate_01'])
      expect(plausibleSizeOf(n), n).toBeNull();
  });
  it('flips the centimetre question only when that makes the size plausible', () => {
    expect(unitCheckedFix('SM_Wep_American_Grenade_01', 0.1658, 100)).toBe(1);
    expect(unitCheckedFix('SM_Wep_Grenade_01', 0.0017, 1)).toBe(100);
    expect(unitCheckedFix('SM_Wep_American_Rifle_01', 0.0111, 100)).toBe(100);
    expect(unitCheckedFix('SM_Wep_German_Pistol_01', 0.023, 100)).toBe(100);
    expect(unitCheckedFix('SM_Wep_Sword_01', 46.3, 1)).toBe(1);
  });
  it('flags what is still out of range with the factor that would fix it', () => {
    expect(sizeSuspectFor('SM_Wep_American_Grenade_01', 16.58)).toMatchObject({ what: 'grenade', factor: 0.01 });
    expect(sizeSuspectFor('SM_Wep_American_Grenade_01', 16.58)!.reason).toMatch(/16.6 m is far too big for a grenade \(5 cm–50 cm\); ×0.01 would make it 16.6 cm/);
    expect(sizeSuspectFor('SM_Wep_German_Pistol_01', 2.3)).toMatchObject({ factor: 0.1 });
    expect(sizeSuspectFor('SM_Wep_American_Grenade_01', 0.166)).toBeNull();
    expect(sizeSuspectFor('SM_Prop_Thing_01', 99)).toBeNull();
  });
});

describe('known scale overrides (scale-overrides.json)', () => {
  it('keeps the German pistol at 10 so a DB rebuild cannot lose it', () => {
    expect(knownScaleOverride('POLYGON_War', 'Source Files/FBX/SM_Wep_German_Pistol_01.fbx')).toMatchObject({ name: 'SM_Wep_German_Pistol_01', scale: 10 });
    expect(knownScaleOverride('POLYGON_War', 'Source Files/FBX/SM_Wep_German_Pistol_01.fbx', 'body')).toBeUndefined();
    for (const o of KNOWN_SCALE_OVERRIDES) {
      expect(o.scale).toBeGreaterThan(0);
      expect(o.why.length).toBeGreaterThan(10);
    }
  });
});

describe('part roles (apps/server/test/roles.test.ts, worker/tests/test_synty.py)', () => {
  it.each([
    ['SM_Veh_Car_Ambo_01', 'Wheel_fl', 'wheel'],
    ['SM_Veh_Car_Ambo_01', 'SM_Veh_Car_Ambo_Door_l', 'door'],
    ['SM_Veh_Car_Ambo_01', 'SteeringW', 'steering'],
    ['SM_Veh_Car_Ambo_01', 'SM_Veh_Car_Ambo_Glass', 'static'],
    ['SM_Veh_Plane_01', 'SM_Veh_Plane_Prop_01', 'propeller'],
    ['SM_Veh_Plane_01', 'SM_Veh_Plane_Wheel_Door_F', 'wheel_door'],
    ['SM_Veh_Plane_01', 'SM_Veh_Plane_Flap_fl_01', 'control_surface'],
    ['SM_Veh_Plane_01', 'SM_Veh_Plane_Canopy_01', 'canopy'],
    ['SM_Veh_American_Tank_01', 'SM_Veh_American_Tank_01_Track_l', 'track'],
    ['SM_Veh_American_Tank_01', 'SM_Veh_American_Tank_01_Barrel', 'barrel'],
    ['SM_Veh_American_Tank_01', 'SM_Veh_American_Tank_01_Hatch_f', 'lid'],
    ['SM_Wep_American_Rifle_01', 'SM_Wep_American_Rifle_01_Trigger', 'trigger'],
    ['SM_Wep_American_Rifle_01', 'SM_Wep_American_Rifle_01_Bolt', 'bolt'],
    ['SM_Wep_AssultRifle_01', 'SM_Wep_AssultRifle_01_Mag', 'magazine'],
    ['SM_Veh_Heli_01', 'SM_Veh_Heli_01_Missile_01', 'projectile'],
    ['SM_Veh_Stock_Car_01', 'SM_Veh_Stock_Car_01_Steering_Wheel_01', 'steering'],
    ['SM_Veh_Dirtbike_01', 'SK_Veh_Dirtbike_01_Handlebars', 'steering'],
    ['SM_Veh_Stock_Car_01', 'SM_Veh_Stock_Car_01_Wheel_FL', 'wheel'],
    ['SM_Veh_Stock_Car_01', 'SM_Veh_Stock_Car_01_Gear_Stick_01', 'lever'],
    ['SM_Veh_Rally_01', 'SM_Veh_Rally_01_EBrake_01', 'lever'],
    ['SM_Veh_Rally_01', 'SM_Veh_Rally_01_Mudflaps_01', 'static'],
    ['SK_Veh_Forklift_01', 'SK_Veh_Forklift_Beams_01', 'lift'],
    ['SM_Veh_Delivery_Bot_01', 'SM_Veh_Delivery_Bot_01_Lid_01', 'lid'],
    ['SK_Veh_Preset_Sports_01', 'SK_Veh_Sports_01_Speedometer_02', 'gauge'],
    ['SK_Veh_Preset_Sports_01', 'SK_Veh_Sports_01_Speedometer_Needle_01', 'needle'],
    ['SM_Veh_Catapult_01', 'SM_Veh_Catapult_01_Arm_01', 'arm'],
    ['SM_Prop_Lever_01', 'SM_Prop_Lever_01_Handle_01', 'lever'],
  ])('%s / %s -> %s', (asset, part, role) => expect(roleFor(part, asset)).toBe(role));
  it('strips the asset prefix even without SM_ on the part', () => {
    expect(localName('Prop_Lecturn_01_Fabric_01', 'SM_Prop_Lecturn_01')).toBe('Fabric_01');
    expect(localName('SM_Veh_Car_Ambo_Door_l', 'SM_Veh_Car_Ambo_01')).toBe('Door_l');
    expect(roleFor('Prop_Lecturn_01_Fabric_01', 'SM_Prop_Lecturn_01')).not.toBe('propeller');
    expect(ROLES).toContain('wheel');
    expect(ROLES.indexOf('steering')).toBeLessThan(ROLES.indexOf('wheel'));
  });
  it('gives boxes and pivots in metres with the scale fix', () => {
    const head = { name: 'SM_Prop_Searchlight_Head_01', pivot: [0, 0.0061, -0.0087], bbox_min: [-0.0045, 0.0039, -0.0048], bbox_max: [0.0045, 0.0146, 0.0048] };
    expect(partMetres(head, 100)).toEqual({ minM: [-0.45, 0.39, -0.48], maxM: [0.45, 1.46, 0.48], sizeM: [0.9, 1.07, 0.96], pivotM: [0, 0.61, -0.87] });
    expect(partMetres({ name: 'SM_Prop_Searchlight_Lens_01' }, 100)).toEqual({});
  });
});

const MIXAMO = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandIndex1', 'RightShoulder', 'RightArm',
  'RightForeArm', 'RightHand', 'RightHandIndex1', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End'];
const BIKER = ['Pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'eyes', 'eyebrows', 'clavicle_l', 'UpperArm_L', 'lowerarm_l', 'Hand_L', 'clavicle_r', 'UpperArm_R', 'lowerarm_r',
  'Hand_R', 'Thigh_R', 'calf_r', 'Foot_R', 'ball_r', 'toes_r', 'Thigh_L', 'calf_l', 'Foot_L', 'ball_l', 'toes_l', '_ik_foot_root', '_ik_hand_root'];
const COMMANDO = ['Root', 'Hips', 'Spine_01', 'Spine_02', 'Spine_03', 'Neck', 'Head', 'Eyes', 'Clavicle_L', 'Shoulder_L', 'Elbow_L', 'Hand_L', 'Clavicle_R', 'Shoulder_R', 'Elbow_R', 'Hand_R',
  'UpperLeg_R', 'LowerLeg_R', 'Ankle_R', 'Ball_R', 'Toes_R', 'UpperLeg_L', 'LowerLeg_L', 'Ankle_L', 'Ball_L', 'Toes_L'];

describe('rig profiles (apps/server/test/rigs.test.ts, worker/tests/test_synty.py)', () => {
  it('finds the built-in profiles', () => {
    expect(detect(MIXAMO.map((b) => `mixamorig:${b}`))).toMatchObject({ profile: 'mixamo', map: { hips: 'mixamorig:Hips' } });
    expect(detect(BIKER)).toMatchObject({ profile: 'synty_ue', score: 1 });
    expect(detect(COMMANDO)).toMatchObject({ profile: 'synty_legacy', score: 1, map: { upperarm_l: 'Shoulder_L' } });
    expect(detect(['Bone', 'Bone.001'])).toBeNull();
    expect(CANONICAL).toHaveLength(22);
  });
  it('proposes a mapping for an unknown rig', () => {
    const { map, missing } = propose(MIXAMO.map((b) => `Character1:${b}`));
    expect(missing).toEqual([]);
    expect(map.clavicle_l).toBe('Character1:LeftShoulder');
    expect(map.upperarm_l).toBe('Character1:LeftArm');
    expect(map.toe_r).toBe('Character1:RightToeBase');
    expect(Object.keys(map).sort()).toEqual([...CANONICAL].sort());
    const blender = propose(['pelvis', 'spine', 'spine.001', 'chest', 'neck', 'head', 'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L', 'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R',
      'thigh.L', 'shin.L', 'foot.L', 'toe.L', 'thigh.R', 'shin.R', 'foot.R', 'toe.R']);
    expect(blender.missing).toEqual([]);
    expect(blender.map).toMatchObject({ hips: 'pelvis', clavicle_l: 'shoulder.L', upperarm_l: 'upper_arm.L', calf_r: 'shin.R', spine3: 'chest' });
  });
});

describe('packs and clips (apps/server/test/packs.test.ts)', () => {
  it.each([
    ['POLYGON_City_SourceFiles_v6.zip', 'POLYGON_City', 6, 'models'],
    ['POLYGON_BattleRoyale_Source_Files_v5.zip', 'POLYGON_BattleRoyale', 5, 'models'],
    ['ANIMATION_Idles_SourceFiles_v3.zip', 'ANIMATION_Idles', 3, 'animations'],
    ['POLYGON_City_Characters_SourceFiles_v3.zip', 'POLYGON_City_Characters', 3, 'models'],
    ['my_mixamo_clips.zip', 'my_mixamo_clips', 1, null],
  ])('parsePackName %s', (file, name, version, kind) => expect(parsePackName(file)).toEqual({ name, version, kind }));
  it('reads Synty ANIMATION pack paths', () => {
    expect(animationInfo('SourceFiles/Animations/Polygon/Masculine/Locomotion/Walk/A_Walk_F_Masc.fbx')).toEqual({
      name: 'Walk_F', set: 'Polygon', gender: 'Masculine', category: 'Locomotion/Walk', rootMotion: false, loop: true,
    });
    expect(animationInfo('SourceFiles/Animations/Sidekick/Masculine/Locomotion/Walk/A_MOD_BL_Walk_F_Masc.fbx')).toMatchObject({ name: 'Walk_F', set: 'Sidekick', category: 'Locomotion/Walk' });
    expect(animationInfo('SourceFiles/Animations/Sidekick/Feminine/Idles/A_MOD_BL_Idle_Standing_Femn.fbx')).toMatchObject({ name: 'Idle_Standing', category: 'Idle', gender: 'Feminine' });
    expect(animationInfo('x/Walk/A_MOD_BL_Walk_F_RM_Femn.fbx').rootMotion).toBe(true);
    expect(animationInfo('x/Walk/A_Walk_F_RootMotion_Femn.fbx').name).toBe(animationInfo('x/Walk/A_MOD_BL_Walk_F_RM_Femn.fbx').name);
    expect(animationInfo('SourceFiles/Animations/Polygon/Feminine/Transitions/Idle_ToWalk/A_Idle_ToWalk_F_Femn.fbx').loop).toBe(false);
  });
  it('reads Mixamo file names and combat clips', () => {
    expect(animationInfo('Walking.fbx')).toMatchObject({ name: 'Walking', loop: true, gender: null, set: null });
    expect(animationInfo('Angry.fbx').loop).toBe(false);
    expect(animationInfo('Uploads/Standing_Melee_Attack_Horizontal.fbx')).toMatchObject({ category: 'Combat/Attack', loop: false });
    expect(animationInfo('Uploads/Standing_1H_Magic_Attack_01.fbx')).toMatchObject({ category: 'Combat/Cast', loop: false });
    expect(animationInfo('Uploads/Standing_Draw_Arrow.fbx')).toMatchObject({ category: 'Combat/Bow', loop: false });
    expect(animationInfo('Uploads/Dying_Backwards.fbx')).toMatchObject({ category: 'Combat/Death', loop: false });
    expect(animationInfo('Uploads/Rifle_Aiming_Idle.fbx')).toMatchObject({ loop: true });
    expect(animationInfo('SourceFiles/Animations/Polygon/Masculine/Idles/Bored/A_POLY_IDL_Bored_KickGround_Masc.fbx')).toMatchObject({ category: 'Idle/Bored' });
    expect(animationInfo('SourceFiles/Animations/Polygon/Masculine/Combat/Sword/A_Sword_Attack_01_Masc.fbx')).toMatchObject({ category: 'Combat/Sword', loop: false });
    expect(combatCategory('Shoot_Reload_Bow')).toBe('Combat/Bow');
  });
  it('picks clips under Animations/ when present, else all FBX; skips collision proxies', () => {
    expect(animationFiles(['SourceFiles/Animations/A.fbx', 'SourceFiles/Demo_Models/SM_X.fbx', 'T.png'])).toEqual(['SourceFiles/Animations/A.fbx']);
    expect(animationFiles(['Walking.fbx', 'Angry.fbx'])).toEqual(['Walking.fbx', 'Angry.fbx']);
    expect(isModelFbx('FBX/Collision/SM_Bld_Door_03_Collision_01.fbx')).toBe(false);
    expect(isModelFbx('Models/SM_Bld_Wall_Collision_02.fbx')).toBe(false);
    expect(isModelFbx('FBX/Props/SM_Prop_Collision_Bumper_01.fbx')).toBe(true);
    expect(ingestPriority('FBX/Characters/SK_Chr_Biker.fbx')).toBe(0);
    expect(ingestPriority('FBX/SM_Veh_Car_01.fbx')).toBe(1);
    expect(ingestPriority('FBX/SM_Prop_Crate_01.fbx')).toBe(3);
  });
});

describe('damaged / destroyed variants (packages/shared/src/object/states.test.ts)', () => {
  const WAR: [string, string][] = [
    ['SM_Veh_American_Tank_01', 'vehicle'], ['SM_Veh_American_Tank_Destroyed_01', 'vehicle'],
    ['SM_Veh_Car_01', 'vehicle'], ['SM_Veh_Car_Damaged_01', 'prop'], ['SM_Veh_Car_Damaged_02', 'prop'],
    ['SM_Veh_German_Car_01', 'vehicle'], ['SM_Veh_German_Tank_01', 'vehicle'], ['SM_Veh_German_Tank_02', 'vehicle'], ['SM_Veh_German_Tank_Destroyed_01', 'prop'],
    ['SM_Veh_Plane_American_01', 'vehicle'], ['SM_Veh_Plane_Damaged_American_01', 'prop'],
    ['SM_Bld_Barn_01', 'multipart'], ['SM_Bld_Barn_Broken_01', 'multipart'],
    ['SM_Env_Bridge_Middle', 'prop'], ['SM_Env_Bridge_Damaged_Middle', 'multipart'],
    ['SM_Env_Tree_01', 'prop'], ['SM_Env_Tree_02', 'prop'], ['SM_Env_Tree_Dead_01', 'prop'], ['SM_Env_Tree_Destroyed_01', 'prop'], ['SM_Env_Tree_Destroyed_02', 'prop'],
    ['SM_Bld_City_Destroyed_01', 'prop'], ['SM_Bld_City_Preset_01', 'multipart'],
    ['SM_Wep_BrokenBottle_01', 'weapon'], ['SM_Wep_Bottle_01', 'weapon'],
  ];
  const pack = (list: [string, string][]): VariantCandidate[] => list.map(([name, kind], i) => ({ id: 1 + i, name, kind }));
  const war = pack(WAR);
  const find = (name: string) => war.find((a) => a.name === name)!;
  const names = (name: string) => findStateVariants(find(name), war).variants.map((v) => `${v.state}:${v.name}${v.preferred ? '*' : ''}`);

  it('parseStateName finds the state word as a whole token, wherever it is', () => {
    expect(parseStateName('SM_Veh_Car_Damaged_01')).toEqual({ state: 'damaged', word: 'Damaged', base: 'sm_veh_car', index: '01' });
    expect(parseStateName('SM_Veh_Plane_Damaged_American_01')).toMatchObject({ base: 'sm_veh_plane_american', index: '01' });
    expect(parseStateName('SM_Env_Dwarf_Obelisk_01_Broken_02')).toMatchObject({ base: 'sm_env_dwarf_obelisk_01', index: '02' });
    expect(parseStateName('SM_Prop_Candle_Chandelier_02_Broken')).toMatchObject({ base: 'sm_prop_candle_chandelier_02', index: null });
    expect(parseStateName('SM_Bld_Wall_Door_Ruin_01')).toMatchObject({ state: 'destroyed', word: 'Ruin' });
    expect(parseStateName('SM_Veh_Car_01')).toBeNull();
    expect(parseStateName('SM_Wep_BrokenBottle_01')).toBeNull();
    expect(parseStateName('DamageZone')).toBeNull();
  });
  it('pairs models with their damaged and destroyed versions', () => {
    expect(names('SM_Veh_Car_01')).toEqual(['damaged:SM_Veh_Car_Damaged_01*', 'damaged:SM_Veh_Car_Damaged_02']);
    expect(names('SM_Veh_German_Car_01')).toEqual([]);
    expect(names('SM_Veh_German_Tank_02')).toEqual(['destroyed:SM_Veh_German_Tank_Destroyed_01*']);
    expect(names('SM_Veh_Plane_American_01')).toEqual(['damaged:SM_Veh_Plane_Damaged_American_01*']);
    expect(names('SM_Bld_Barn_01')).toEqual(['damaged:SM_Bld_Barn_Broken_01*']);
    expect(names('SM_Env_Bridge_Middle')).toEqual(['damaged:SM_Env_Bridge_Damaged_Middle*']);
    expect(names('SM_Env_Tree_02')).toEqual(['destroyed:SM_Env_Tree_Destroyed_02*', 'destroyed:SM_Env_Tree_Destroyed_01']);
    expect(names('SM_Env_Tree_Dead_01')).toEqual([]);
    expect(names('SM_Bld_City_Preset_01')).toEqual([]);
    expect(names('SM_Wep_Bottle_01')).toEqual([]);
    const car = findStateVariants(find('SM_Veh_Car_01'), war);
    expect(car.states).toEqual({ intact: { asset: find('SM_Veh_Car_01').id }, damaged: { asset: find('SM_Veh_Car_Damaged_01').id } });
  });
  it('finds the intact model of a damaged one', () => {
    const r = findStateVariants(find('SM_Veh_Car_Damaged_02'), war);
    expect(r.intact.name).toBe('SM_Veh_Car_01');
    expect(r.asked).toEqual({ id: find('SM_Veh_Car_Damaged_02').id, state: 'damaged' });
    expect(findStateVariants(find('SM_Veh_German_Tank_Destroyed_01'), war).intact.name).toBe('SM_Veh_German_Tank_01');
    const city = findStateVariants(find('SM_Bld_City_Destroyed_01'), war);
    expect(city.intact.name).toBe('SM_Bld_City_Destroyed_01');
    expect(city.asked).toBeUndefined();
  });
});
