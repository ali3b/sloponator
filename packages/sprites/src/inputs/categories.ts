// Moved from synty-sprite-generator packages/shared/src/categories.ts (P2, ali3b/sloponator#8).
/**
 * Object categories: what a prop is in a game world (a building, a tree, a sandbag wall…). A label field
 * (`category`, apps/server/src/labels.ts): a person's value is locked, the AI's applies while nobody set one,
 * and without either the name rules below decide. The rules run at read time, so improving them needs no re-import.
 *
 * Rules (first match wins):
 * - Only props, multipart models and vehicles get a category; characters, weapons, attachments and fx have none
 *   (null). An intact vehicle (kind vehicle) is `vehicle`.
 * - `wreck` is only for vehicle wrecks (SM_Veh_*_Destroyed, SM_Prop_Car_Wrecked_*, a vehicle-kind model named
 *   Damaged/Wreck…). Other damaged things keep their own category and set `damaged` (a broken barn is a building,
 *   a broken barrel a crate_container), so the states work (A4) can pair them with the intact model.
 * - Decals (flat on the ground) come first: decals, puddles, cracks, stains, graffiti, blood splats.
 * - Military fortifications win over barrier, wall and building: bunkers (SM_Bld_Bunker_* too), pillboxes,
 *   sandbags (also sandbag walls), tank traps, hedgehogs, mortars, trenches.
 * - `barrier` is for road and civil blockers: barriers, barricades, roadblocks, bollards, cones.
 * - Fences, gates, wire and railings are wall_fence. A wall is wall_fence unless it is a building piece
 *   (SM_Bld_*) or a thing mounted on one (a wall light, a wall flag).
 * - `building` is SM_Bld_* plus structures named so outside props (houses, towers, ruins, pillars, stairs,
 *   bridges); SM_Prop_Warehouse_Light is not a building.
 * - Then ground (roads, floors, paths, dirt), vegetation, furniture, crate_container, rock; anything else is misc.
 */

export const CATEGORIES = ['building', 'vegetation', 'rock', 'wall_fence', 'barrier', 'crate_container', 'furniture', 'wreck', 'vehicle', 'military', 'ground', 'decal', 'misc'] as const;
export type Category = (typeof CATEGORIES)[number];

export const isCategory = (v: unknown): v is Category => (CATEGORIES as readonly string[]).includes(v as string);

/** Kinds that get a category from the rules (a vehicle is `vehicle`, or `wreck` when it is one). */
export const CATEGORY_KINDS = ['prop', 'multipart', 'vehicle'] as const;

/** Words of a Synty name, lower case and singular: SM_Prop_CardboardBox_01 → sm, prop, cardboard, box. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
const DAMAGED = set('damaged damage destroyed destroy wreck wrecked wreckage broken ruin ruined burnt burned collapsed');
const WRECK = set('wreck wrecked wreckage');
const DECAL = set('decal puddle crack stain graffiti splat splatter bloodsplat skidmark');
const MILITARY = set('bunker pillbox sandbag hedgehog mortar trench foxhole');
const BARRIER = set('barrier barricade roadblock bollard cone');
const WALL_FENCE = set('fence gate wire barbedwire railing rail balustrade palisade hedgerow');
const BUILDING = set('building house roof tower shop barn hut cabin shack villa apartment highrise warehouse church chapel castle tent garage motel diner skyscraper ruin pillar column stair staircase arch archway ceiling bridge');
/** Wall-mounted things: a wall light is not a wall. */
const ON_WALL = set('light lamp flag fan switch sign poster clock banner shelf socket painting frame');
/** Vehicle nouns: a wrecked car prop (SM_Prop_Car_Wrecked_01) is a wreck too. */
const VEHICLE = set('car van truck bus plane boat bike motorbike buggy jeep halftrack helicopter heli tank tractor wagon');
const GROUND = set('ground road floor terrain path sidewalk footpath pavement tile motorway dirt sand mud beach crossing kerb curb');
const VEGETATION = set('tree treedead treestump bramble root bush plant grass palm flower fern shrub hedge vine ivy leaf leave foliage overgrowth stump mushroom cactus reed weed seaweed kelp crop wheat corn sapling pine oak birch willow');
const FURNITURE = set('workbench pew chair table bed shelf bookshelf bookcase sofa couch desk bench stool cabinet cupboard drawer wardrobe dresser throne armchair counter toilet bath bathtub sink fridge oven stove rug');
const CRATE = set('crate box barrel container pallet chest sack bag keg bin dumpster cask drum jerrycan basket trunk locker');
const ROCK = set('rock cliff stone boulder pebble rubble debris stalactite stalagmite mountain');

export interface CategoryGuess {
  category: Category;
  /** Damaged / destroyed / broken / ruined: a state of some intact model (A4), kept apart from the category. */
  damaged: boolean;
}

/**
 * The rules' category for a model from its name and kind; null for kinds without one (characters, weapons,
 * attachments, fx).
 */
export function autoCategory(name: string, kind: string): CategoryGuess | null {
  if (!(CATEGORY_KINDS as readonly string[]).includes(kind)) return null;
  const words = nameWords(name);
  const has = (s: Set<string>) => words.some((w) => s.has(w));
  const joined = `_${words.join('_')}_`;
  const damaged = has(DAMAGED);
  // SM_Veh_* (and SK_Veh_*) are vehicles even when imported as props.
  const vehicle = kind === 'vehicle' || words.slice(0, 2).includes('veh');
  const building = words.slice(0, 3).includes('bld');
  // Props named after a building (SM_Prop_Warehouse_Light, SM_Prop_ShopFridge) are not buildings.
  const propName = words.slice(1, 3).some((w) => w === 'prop' || w === 'item');
  const out = (category: Category) => ({ category, damaged });
  if ((vehicle || has(VEHICLE)) && (damaged || has(WRECK))) return out('wreck');
  if (kind === 'vehicle') return out('vehicle');
  if (has(DECAL)) return out('decal');
  if (has(MILITARY) || joined.includes('_tank_trap_') || joined.includes('_anti_tank_')) return out('military');
  if (!building && has(BARRIER)) return out('barrier');
  if (has(WALL_FENCE) || (!building && words.includes('wall') && !has(ON_WALL))) return out('wall_fence');
  if (building || (!propName && has(BUILDING))) return out('building');
  if (has(GROUND)) return out('ground');
  if (has(VEGETATION)) return out('vegetation');
  if (has(FURNITURE)) return out('furniture');
  if (has(CRATE)) return out('crate_container');
  if (has(ROCK)) return out('rock');
  return out('misc');
}
