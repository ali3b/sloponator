// Moved from synty-sprite-generator packages/shared/src/categories.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { CATEGORIES, autoCategory, isCategory, nameWords } from './categories.js';

/** Real Synty names (from an installed library) and the category the rules give them. */
const TABLE: [string, string, string | null, boolean?][] = [
  // [name, kind, category, damaged]
  ['SM_Bld_Villa_01', 'multipart', 'building'],
  ['SM_Bld_Wall_L_Gate_03', 'prop', 'wall_fence'],
  ['SM_Bld_Roof_Flat_01', 'prop', 'building'],
  ['SM_Bld_Barn_Broken_01', 'multipart', 'building', true],
  ['SM_Bld_City_Destroyed_01', 'prop', 'building', true],
  ['SM_Bld_Ruin_Tower_Broken_01', 'prop', 'building', true],
  ['SM_Env_Ruin_04', 'prop', 'building', true],
  ['SM_Bld_Shop_Medium_02_Barricades_01', 'prop', 'building'],
  ['SM_Prop_Warehouse_Light_01', 'prop', 'misc'],
  ['SM_Env_Tree_Palm_03', 'prop', 'vegetation'],
  ['SM_Env_TreeDead_01', 'prop', 'vegetation'],
  ['SM_Env_Tree_Destroyed_01', 'prop', 'vegetation', true],
  ['SM_Gen_Env_Grass_Tall_02', 'prop', 'vegetation'],
  ['SM_Env_Bush_01', 'prop', 'vegetation'],
  ['SM_Gen_Env_Ivy_Draped_03', 'prop', 'vegetation'],
  ['SM_Env_Rock_Medium_03', 'prop', 'rock'],
  ['SM_Env_Cliff_Basalt_03', 'prop', 'rock'],
  ['SM_Env_Rubble_Stone_02', 'prop', 'rock'],
  ['SM_Env_Stalagmite_04', 'prop', 'rock'],
  ['SM_Env_Wall_04', 'prop', 'wall_fence'],
  ['SM_Prop_BaseWall_Broken_01', 'prop', 'wall_fence', true],
  ['SM_Bld_Fence_02', 'prop', 'wall_fence'],
  ['SM_Prop_Fence_Gate_01', 'prop', 'wall_fence'],
  ['SM_Prop_WireFence_02', 'prop', 'wall_fence'],
  ['SM_Env_Railing_Broken_01', 'prop', 'wall_fence', true],
  ['SM_Prop_Light_Wall_03', 'prop', 'misc'],
  ['SM_Prop_Barrier_Concrete_01', 'prop', 'barrier'],
  ['SM_Prop_Barricade_Wired_02', 'prop', 'barrier'],
  ['SM_Prop_Bollard_01', 'prop', 'barrier'],
  ['SM_Prop_Roadblock_01', 'prop', 'barrier'],
  ['SM_Prop_Crate_Wood_03', 'prop', 'crate_container'],
  ['SM_Gen_Prop_Cardboard_Box_05', 'prop', 'crate_container'],
  ['SM_Prop_Barrel_Broken_01', 'prop', 'crate_container', true],
  ['SM_Prop_Pallet_01', 'prop', 'crate_container'],
  ['SM_Prop_Chair_02', 'prop', 'furniture'],
  ['SM_Prop_Table_Round_Broken_01', 'prop', 'furniture', true],
  ['SM_Prop_Bookcase_01', 'prop', 'furniture'],
  ['SM_Prop_BunkBed_01', 'prop', 'furniture'],
  ['SM_Veh_German_Tank_Destroyed_01', 'prop', 'wreck', true],
  ['SM_Veh_Car_Damaged_01', 'prop', 'wreck', true],
  ['SM_Veh_Tank_USA_Destroyed_01', 'vehicle', 'wreck', true],
  ['SM_Prop_Car_Wrecked_Van_01', 'prop', 'wreck', true],
  ['SM_Env_Sandbag_Wall_01', 'prop', 'military'],
  ['SM_Env_Sandbag_Pile_01', 'prop', 'military'],
  ['SM_Prop_TankTrap_01', 'prop', 'military'],
  ['SM_Bld_Bunker_Large_Damaged_01', 'prop', 'military', true],
  ['SM_Env_Trench_Straight_01', 'prop', 'military'],
  ['SM_Env_Road_Straight_Damaged_01', 'multipart', 'ground', true],
  ['SM_Gen_Env_Ground_Dirt_01', 'prop', 'ground'],
  ['SM_Env_Sidewalk_Straight_01', 'prop', 'ground'],
  ['SM_Env_Dwarf_Floor_21', 'prop', 'ground'],
  ['SM_Env_Path_Tiles_05', 'prop', 'ground'],
  ['SM_Prop_Puddle_03', 'prop', 'decal'],
  ['SM_Prop_Grass_Cracks_01', 'prop', 'decal'],
  ['SM_Env_Dwarf_Floor_Crack_01', 'prop', 'decal'],
  ['SM_Prop_BloodSplat_01', 'prop', 'decal'],
  ['SM_Prop_Generator_01', 'prop', 'misc'],
  ['SM_Prop_Food_IceCream_01', 'prop', 'misc'],
  ['SM_Veh_German_Tank_01', 'vehicle', 'vehicle'],
  ['SM_Veh_Jeep_01', 'vehicle', 'vehicle'],
  // No category: non-prop kinds.
  ['Character_American_Soldier_01', 'character', null],
  ['SK_Wep_Rifle_01', 'weapon', null],
  ['SM_Chr_Attach_Helmet_01', 'attachment', null],
];

describe('object categories', () => {
  it('splits Synty names into singular words', () => {
    expect(nameWords('SM_Prop_CardboardBox_01')).toEqual(['sm', 'prop', 'cardboard', 'box']);
    expect(nameWords('SM_Env_Rocks_Small_02')).toEqual(['sm', 'env', 'rock', 'small']);
    expect(nameWords('SM_Prop_Glass_01')).toEqual(['sm', 'prop', 'glass']);
  });

  it.each(TABLE)('%s (%s) → %s', (name, kind, category, damaged = false) => {
    const g = autoCategory(name, kind);
    expect(g ? g.category : null).toBe(category);
    if (g) expect(g.damaged).toBe(damaged);
  });

  it('every answer is a known category', () => {
    for (const [name, kind] of TABLE) {
      const g = autoCategory(name, kind);
      if (g) expect(isCategory(g.category)).toBe(true);
    }
    expect(CATEGORIES).toHaveLength(13);
    expect(isCategory('building')).toBe(true);
    expect(isCategory('house')).toBe(false);
  });
});
