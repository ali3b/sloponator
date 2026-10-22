// Moved from synty-sprite-generator packages/shared/src/object/states.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import {
  checkStates, findStateVariants, orderStates, parseStateName, parseStatesArg, parseTransition, stateClipNames, stateSet, type VariantCandidate,
} from './states.js';
import { objectInfo, objectStates } from './footprint.js';
import type { Direction, Framing } from '../view/camera.js';

/** Real model names from the installed packs (data/library.db), with their kinds. */
const WAR: [string, string][] = [
  ['SM_Veh_American_Tank_01', 'vehicle'], ['SM_Veh_American_Tank_Destroyed_01', 'vehicle'],
  ['SM_Veh_American_Truck_01', 'vehicle'], ['SM_Veh_American_Truck_Destroyed_01', 'prop'], ['SM_Veh_American_Truck_Destroyed_02', 'prop'],
  ['SM_Veh_Car_01', 'vehicle'], ['SM_Veh_Car_Damaged_01', 'prop'], ['SM_Veh_Car_Damaged_02', 'prop'],
  ['SM_Veh_German_Car_01', 'vehicle'], ['SM_Veh_German_Tank_01', 'vehicle'], ['SM_Veh_German_Tank_02', 'vehicle'], ['SM_Veh_German_Tank_Destroyed_01', 'prop'],
  ['SM_Veh_Plane_American_01', 'vehicle'], ['SM_Veh_Plane_Damaged_American_01', 'prop'], ['SM_Veh_Plane_German_01', 'vehicle'], ['SM_Veh_Plane_Damaged_German_01', 'prop'],
  ['SM_Bld_Barn_01', 'multipart'], ['SM_Bld_Barn_Broken_01', 'multipart'],
  ['SM_Bld_Bunker_Gun_01', 'prop'], ['SM_Bld_Bunker_Gun_Damaged_01', 'prop'], ['SM_Bld_Bunker_Large_01', 'prop'], ['SM_Bld_Bunker_Large_Damaged_01', 'prop'],
  ['SM_Bld_Bunker_Large_Cliff_01', 'prop'], ['SM_Bld_Bunker_Large_Cliff_Damaged_01', 'prop'],
  ['SM_Env_Bridge_Middle', 'prop'], ['SM_Env_Bridge_Damaged_Middle', 'multipart'], ['SM_Env_Bridge_Ramp', 'prop'], ['SM_Env_Bridge_Damaged_Ramp', 'prop'],
  ['SM_Env_Tree_01', 'prop'], ['SM_Env_Tree_02', 'prop'], ['SM_Env_Tree_Dead_01', 'prop'], ['SM_Env_Tree_Destroyed_01', 'prop'], ['SM_Env_Tree_Destroyed_02', 'prop'],
  ['SM_Bld_City_Destroyed_01', 'prop'], ['SM_Bld_City_Preset_01', 'multipart'],
  ['SM_Char_Attach_Hair_Sideburns_01', 'attachment'],
];
const REALM: [string, string][] = [
  ['SM_Bld_Ruin_Tower_01', 'prop'], ['SM_Bld_Ruin_Tower_Broken_01', 'prop'], ['SM_Bld_Ruin_Tower_Round_01', 'prop'], ['SM_Bld_Ruin_Tower_Round_Broken_01', 'prop'],
  ['SM_Env_Dwarf_Obelisk_01', 'prop'], ['SM_Env_Dwarf_Obelisk_01_Broken_01', 'prop'], ['SM_Env_Dwarf_Obelisk_01_Broken_02', 'prop'],
  ['SM_Env_Dwarf_Obelisk_02', 'prop'], ['SM_Env_Dwarf_Obelisk_02_Broken_01', 'prop'],
];
const DUNGEON: [string, string][] = [
  ['SM_Prop_Candle_Chandelier_01', 'prop'], ['SM_Prop_Candle_Chandelier_02', 'prop'], ['SM_Prop_Candle_Chandelier_02_Broken', 'prop'],
  ['SM_Prop_Barrel_01', 'prop'], ['SM_Prop_Barrel_02', 'prop'], ['SM_Prop_Barrel_Broken_01', 'prop'], ['SM_Prop_Barrel_Broken_02', 'prop'],
];
const BR: [string, string][] = [
  ['SM_Veh_Car_01', 'vehicle'], ['SM_Veh_Car_Clean_01', 'vehicle'], ['SM_Veh_Car_Destroyed_01', 'prop'],
  ['SM_Veh_Tank_USA_01', 'vehicle'], ['SM_Veh_Tank_USA_Destroyed_01', 'vehicle'], ['SM_Veh_Light_Armored_Car_01', 'vehicle'], ['SM_Veh_Light_Car_Destroyed_01', 'prop'],
];
const PALM: [string, string][] = [
  ['SM_Prop_Surfboard_01', 'prop'], ['SM_Prop_Surfboard_01_Alt_01', 'prop'], ['SM_Prop_Surfboard_01_Damaged_01', 'prop'], ['SM_Prop_Surfboard_01_Damaged_Alt_01', 'prop'],
];
const GANG: [string, string][] = [['SM_Wep_BrokenBottle_01', 'weapon'], ['SM_Wep_Bottle_01', 'weapon']];

const pack = (list: [string, string][], from = 1): VariantCandidate[] => list.map(([name, kind], i) => ({ id: from + i, name, kind }));
const find = (p: VariantCandidate[], name: string) => p.find((a) => a.name === name)!;
const variantsOf = (p: VariantCandidate[], name: string) => findStateVariants(find(p, name), p);
const names = (r: ReturnType<typeof findStateVariants>) => r.variants.map((v) => `${v.state}:${v.name}${v.preferred ? '*' : ''}`);
const stateNames = (p: VariantCandidate[], r: ReturnType<typeof findStateVariants>) =>
  Object.fromEntries(Object.entries(r.states).map(([k, v]) => [k, p.find((a) => a.id === v.asset)!.name]));

describe('parseStateName', () => {
  it('finds the state word as a whole token, wherever it is', () => {
    expect(parseStateName('SM_Veh_Car_Damaged_01')).toEqual({ state: 'damaged', word: 'Damaged', base: 'sm_veh_car', index: '01' });
    expect(parseStateName('SM_Bld_Barn_Broken_01')).toMatchObject({ state: 'damaged', base: 'sm_bld_barn' });
    expect(parseStateName('SM_Veh_German_Tank_Destroyed_01')).toMatchObject({ state: 'destroyed', base: 'sm_veh_german_tank' });
    expect(parseStateName('SM_Veh_Plane_Damaged_American_01')).toMatchObject({ base: 'sm_veh_plane_american', index: '01' });
    expect(parseStateName('SM_Env_Bridge_Damaged_Middle')).toMatchObject({ base: 'sm_env_bridge_middle', index: null });
    expect(parseStateName('SM_Env_Dwarf_Obelisk_01_Broken_02')).toMatchObject({ base: 'sm_env_dwarf_obelisk_01', index: '02' });
    expect(parseStateName('SM_Prop_Candle_Chandelier_02_Broken')).toMatchObject({ base: 'sm_prop_candle_chandelier_02', index: null });
    expect(parseStateName('SM_Bld_Wall_Door_Ruin_01')).toMatchObject({ state: 'destroyed', word: 'Ruin', base: 'sm_bld_wall_door' });
    expect(parseStateName('SM_Prop_Car_Wrecked_01')).toMatchObject({ state: 'destroyed', base: 'sm_prop_car' });
  });
  it('ignores names without one, and words inside other words', () => {
    expect(parseStateName('SM_Veh_Car_01')).toBeNull();
    expect(parseStateName('SM_Wep_BrokenBottle_01')).toBeNull();
    expect(parseStateName('SM_Prop_Barrel_Burn_01')).toBeNull();
    expect(parseStateName('DamageZone')).toBeNull();
  });
});

describe('findStateVariants on real Synty names', () => {
  const war = pack(WAR);
  it('pairs vehicles with their damaged and destroyed versions', () => {
    const car = variantsOf(war, 'SM_Veh_Car_01');
    expect(names(car)).toEqual(['damaged:SM_Veh_Car_Damaged_01*', 'damaged:SM_Veh_Car_Damaged_02']);
    expect(stateNames(war, car)).toEqual({ intact: 'SM_Veh_Car_01', damaged: 'SM_Veh_Car_Damaged_01' });
    // The German car is a different model (no variant of SM_Veh_Car).
    expect(variantsOf(war, 'SM_Veh_German_Car_01').variants).toEqual([]);
    expect(stateNames(war, variantsOf(war, 'SM_Veh_German_Tank_01'))).toEqual({ intact: 'SM_Veh_German_Tank_01', destroyed: 'SM_Veh_German_Tank_Destroyed_01' });
    // Every German tank shares the one wreck.
    expect(names(variantsOf(war, 'SM_Veh_German_Tank_02'))).toEqual(['destroyed:SM_Veh_German_Tank_Destroyed_01*']);
    expect(names(variantsOf(war, 'SM_Veh_American_Truck_01'))).toEqual(['destroyed:SM_Veh_American_Truck_Destroyed_01*', 'destroyed:SM_Veh_American_Truck_Destroyed_02']);
    expect(names(variantsOf(war, 'SM_Veh_Plane_American_01'))).toEqual(['damaged:SM_Veh_Plane_Damaged_American_01*']);
    expect(names(variantsOf(war, 'SM_Veh_Plane_German_01'))).toEqual(['damaged:SM_Veh_Plane_Damaged_German_01*']);
  });
  it('pairs buildings, bunkers, bridges and trees', () => {
    expect(names(variantsOf(war, 'SM_Bld_Barn_01'))).toEqual(['damaged:SM_Bld_Barn_Broken_01*']);
    expect(names(variantsOf(war, 'SM_Bld_Bunker_Large_01'))).toEqual(['damaged:SM_Bld_Bunker_Large_Damaged_01*']);
    expect(names(variantsOf(war, 'SM_Bld_Bunker_Large_Cliff_01'))).toEqual(['damaged:SM_Bld_Bunker_Large_Cliff_Damaged_01*']);
    expect(names(variantsOf(war, 'SM_Env_Bridge_Middle'))).toEqual(['damaged:SM_Env_Bridge_Damaged_Middle*']);
    expect(names(variantsOf(war, 'SM_Env_Bridge_Ramp'))).toEqual(['damaged:SM_Env_Bridge_Damaged_Ramp*']);
    // The same number is preferred: tree 02 → Destroyed_02.
    expect(names(variantsOf(war, 'SM_Env_Tree_01'))).toEqual(['destroyed:SM_Env_Tree_Destroyed_01*', 'destroyed:SM_Env_Tree_Destroyed_02']);
    expect(names(variantsOf(war, 'SM_Env_Tree_02'))).toEqual(['destroyed:SM_Env_Tree_Destroyed_02*', 'destroyed:SM_Env_Tree_Destroyed_01']);
    expect(variantsOf(war, 'SM_Env_Tree_Dead_01').variants).toEqual([]);
    // Nothing to pair with: a destroyed city block whose intact block has another name.
    expect(variantsOf(war, 'SM_Bld_City_Preset_01').variants).toEqual([]);
  });
  it('finds the intact model of a damaged one, with its siblings', () => {
    const r = variantsOf(war, 'SM_Veh_Car_Damaged_02');
    expect(r.intact.name).toBe('SM_Veh_Car_01');
    expect(r.asked).toEqual({ id: find(war, 'SM_Veh_Car_Damaged_02').id, state: 'damaged' });
    expect(names(r)).toEqual(['damaged:SM_Veh_Car_Damaged_01*', 'damaged:SM_Veh_Car_Damaged_02']);
    // Same-number preference when several intact models share the stem.
    expect(variantsOf(war, 'SM_Veh_German_Tank_Destroyed_01').intact.name).toBe('SM_Veh_German_Tank_01');
    // A damaged model without an intact one stays on its own.
    const city = variantsOf(war, 'SM_Bld_City_Destroyed_01');
    expect(city.intact.name).toBe('SM_Bld_City_Destroyed_01');
    expect(city.asked).toBeUndefined();
  });
  it('keeps numbered models apart and handles numbers before the state word', () => {
    const realm = pack(REALM);
    expect(names(variantsOf(realm, 'SM_Env_Dwarf_Obelisk_01'))).toEqual(['damaged:SM_Env_Dwarf_Obelisk_01_Broken_01*', 'damaged:SM_Env_Dwarf_Obelisk_01_Broken_02']);
    expect(names(variantsOf(realm, 'SM_Env_Dwarf_Obelisk_02'))).toEqual(['damaged:SM_Env_Dwarf_Obelisk_02_Broken_01*']);
    const dungeon = pack(DUNGEON);
    expect(names(variantsOf(dungeon, 'SM_Prop_Candle_Chandelier_02'))).toEqual(['damaged:SM_Prop_Candle_Chandelier_02_Broken*']);
    expect(variantsOf(dungeon, 'SM_Prop_Candle_Chandelier_01').variants).toEqual([]);
    expect(names(variantsOf(dungeon, 'SM_Prop_Barrel_02'))).toEqual(['damaged:SM_Prop_Barrel_Broken_02*', 'damaged:SM_Prop_Barrel_Broken_01']);
  });
  it('treats "Ruin" families as intact models with their own broken versions', () => {
    const realm = pack(REALM);
    expect(names(variantsOf(realm, 'SM_Bld_Ruin_Tower_01'))).toEqual(['damaged:SM_Bld_Ruin_Tower_Broken_01*']);
    expect(names(variantsOf(realm, 'SM_Bld_Ruin_Tower_Round_01'))).toEqual(['damaged:SM_Bld_Ruin_Tower_Round_Broken_01*']);
    expect(variantsOf(realm, 'SM_Bld_Ruin_Tower_Broken_01').intact.name).toBe('SM_Bld_Ruin_Tower_01');
  });
  it('other packs: Battle Royale, Palm City; never weapons', () => {
    const br = pack(BR);
    expect(names(variantsOf(br, 'SM_Veh_Car_01'))).toEqual(['destroyed:SM_Veh_Car_Destroyed_01*']);
    expect(variantsOf(br, 'SM_Veh_Car_Clean_01').variants).toEqual([]);
    expect(names(variantsOf(br, 'SM_Veh_Tank_USA_01'))).toEqual(['destroyed:SM_Veh_Tank_USA_Destroyed_01*']);
    expect(variantsOf(br, 'SM_Veh_Light_Armored_Car_01').variants).toEqual([]);
    const palm = pack(PALM);
    expect(names(variantsOf(palm, 'SM_Prop_Surfboard_01'))).toEqual(['damaged:SM_Prop_Surfboard_01_Damaged_01*']);
    expect(names(variantsOf(palm, 'SM_Prop_Surfboard_01_Alt_01'))).toEqual(['damaged:SM_Prop_Surfboard_01_Damaged_Alt_01*']);
    expect(variantsOf(pack(GANG), 'SM_Wep_Bottle_01').variants).toEqual([]);
  });
});

describe('states spec', () => {
  it('parses the --states argument', () => {
    expect(parseStatesArg('auto')).toEqual({ auto: true, entries: [] });
    expect(parseStatesArg('auto, destroyed@destroy')).toEqual({ auto: true, entries: [{ name: 'destroyed', transition: 'destroy' }] });
    expect(parseStatesArg('intact=SM_Veh_Car_01,destroyed=POLYGON_War/SM_Veh_Car_Damaged_01@destroy:force=6;duration=2')).toEqual({
      auto: false,
      entries: [{ name: 'intact', asset: 'SM_Veh_Car_01' }, { name: 'destroyed', asset: 'POLYGON_War/SM_Veh_Car_Damaged_01', transition: 'destroy:force=6;duration=2' }],
    });
    expect(parseStatesArg('open=12')).toEqual({ auto: false, entries: [{ name: 'open', asset: '12' }] });
    expect(() => parseStatesArg('destroyed')).toThrow(/name=model/);
    // FB-056: a looping state, with or without a model, before a transition.
    expect(parseStatesArg('auto,intact:drive,destroyed@destroy')).toEqual({ auto: true, entries: [{ name: 'intact', template: 'drive' }, { name: 'destroyed', transition: 'destroy' }] });
    expect(parseStatesArg('intact=POLYGON_War/SM_Radar_01:spin:duration=2;turns=1@collapse')).toEqual({
      auto: false, entries: [{ name: 'intact', asset: 'POLYGON_War/SM_Radar_01', template: 'spin:duration=2;turns=1', transition: 'collapse' }],
    });
    expect(() => parseStatesArg('intact:')).toThrow(/bad state/);
    expect(() => parseStatesArg('intact:spin:speed')).toThrow(/bad transition parameter/);
    expect(() => parseStatesArg('')).toThrow(/auto/);
  });
  it('parses transitions', () => {
    expect(parseTransition('destroy')).toEqual([{ id: 'destroy', params: {} }]);
    expect(parseTransition('destroy:force=6;duration=2+lids:angle=40')).toEqual([{ id: 'destroy', params: { force: 6, duration: 2 } }, { id: 'lids', params: { angle: 40 } }]);
    expect(() => parseTransition('destroy:force=lots')).toThrow(/key=number/);
  });
  it('checks states', () => {
    expect(checkStates({ intact: { asset: 1 }, destroyed: { asset: 2, transition: 'destroy' } })).toEqual([]);
    expect(checkStates({})).toEqual(['give at least one state']);
    expect(checkStates({ Intact: { asset: 1 } })[0]).toMatch(/lower case/);
    expect(checkStates({ intact: { asset: 0 } })[0]).toMatch(/needs a model/);
    expect(checkStates({ intact: { asset: 1, transition: 'destroy' } })[0]).toMatch(/another state/);
    expect(checkStates({ intact: { asset: 1 }, d: { asset: 2, transition: 'destroy', from: 'open' } })[0]).toMatch(/unknown state "open"/);
    expect(checkStates({ intact: { asset: 1 }, d: { asset: 2, from: 'intact' } })[0]).toMatch(/no transition/);
  });
  it('puts intact first', () => {
    expect(Object.keys(orderStates({ destroyed: { asset: 2 }, intact: { asset: 1 } }))).toEqual(['intact', 'destroyed']);
  });
  it('becomes a set: one still per state on its model, then transitions on the from model', () => {
    const states = { intact: { asset: 1 }, damaged: { asset: 2 }, destroyed: { asset: 3, transition: 'destroy:force=8' } };
    expect(stateClipNames(states)).toEqual(['intact', 'damaged', 'destroyed', 'intact_to_destroyed']);
    expect(stateSet(states).items).toEqual([
      { type: 'template', layers: [{ id: 'still', params: {} }], label: 'intact', model: 1, state: { name: 'intact' } },
      { type: 'template', layers: [{ id: 'still', params: {} }], label: 'damaged', model: 2, state: { name: 'damaged' } },
      { type: 'template', layers: [{ id: 'still', params: {} }], label: 'destroyed', model: 3, state: { name: 'destroyed' } },
      { type: 'template', layers: [{ id: 'destroy', params: { force: 8 } }], label: 'intact_to_destroyed', model: 1, state: { name: 'destroyed', from: 'intact' } },
    ]);
    // FB-056: a state's loop replaces its still; the transition still starts on that state's model.
    expect(stateSet({ intact: { asset: 1, template: 'drive+turret_sweep:angle=40' }, destroyed: { asset: 3, transition: 'destroy' } }).items.slice(0, 1)).toEqual([
      { type: 'template', layers: [{ id: 'drive', params: {} }, { id: 'turret_sweep', params: { angle: 40 } }], label: 'intact', model: 1, state: { name: 'intact', loop: 'drive+turret_sweep:angle=40' } },
    ]);
    expect(checkStates({ intact: { asset: 1, template: 'spin:x' } })[0]).toMatch(/state "intact" template: bad template parameter/);
    // A transition from another state renders on that state's model.
    expect(stateSet({ intact: { asset: 1 }, damaged: { asset: 2 }, destroyed: { asset: 3, transition: 'destroy', from: 'damaged' } }).items[3]).toMatchObject({ label: 'damaged_to_destroyed', model: 2 });
  });
  // 'a sprite with states renders them instead of its set' tests the Studio's sprite spec: stayed in the old generator.
});

describe('objectStates (the manifest block)', () => {
  const framing: Framing = { frameWidth: 128, frameHeight: 128, pivot: { x: 64, y: 100 }, viewHalfW: 4, viewHalfH: 4, centreY: 0, ppm: 16 } as Framing;
  const dirs: Direction[] = [{ name: 'S', worldAngle: 270, screenAngle: 270, mirrorOf: null } as Direction, { name: 'E', worldAngle: 0, screenAngle: 0, mirrorOf: null } as Direction];
  const view = { pitch: 30, projection: 'ortho' as const, scale: { mode: 'tile' as const, tilePx: 64, shape: 'diamond' as const, metresPerTile: 1 } };
  const box = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  it('lists each state with its own footprint; tile polygons sit around the base anchor', () => {
    const intact = objectInfo({ points: box(-1, 1, -2, 2), minY: 0, maxY: 2, view, framing, directions: dirs })!;
    const same = objectInfo({ points: box(-1, 1, -2, 2), minY: 0, maxY: 0.8, view, framing, directions: dirs })!;
    // A wreck that slid 1 m along +x.
    const moved = objectInfo({ points: box(0, 2, -2, 2), minY: 0, maxY: 1, view, framing, directions: dirs })!;
    const out = objectStates(intact, [
      { name: 'intact', animation: 'intact', asset: 'SM_Veh_Car_01', loop: 'drive', info: intact },
      { name: 'damaged', animation: 'damaged', asset: 'SM_Veh_Car_Damaged_01', info: same },
      { name: 'destroyed', animation: 'destroyed', asset: 'SM_Veh_Car_Destroyed_01', info: moved },
    ], [{ animation: 'intact_to_destroyed', from: 'intact', to: 'destroyed', asset: 'SM_Veh_Car_01' }]);
    expect(out.anchor).toEqual(intact.anchor);
    expect(out.footprint).toEqual(intact.footprint);
    expect(out.states!.map((s) => [s.name, s.sameAsBase, s.height])).toEqual([['intact', true, 2], ['damaged', true, 0.8], ['destroyed', false, 1]]);
    // FB-056: a looping state says which loop it plays; stills have none.
    expect(out.states!.map((s) => s.loop)).toEqual(['drive', undefined, undefined]);
    expect(out.transitions).toEqual([{ animation: 'intact_to_destroyed', from: 'intact', to: 'destroyed', asset: 'SM_Veh_Car_01' }]);
    // Around the base anchor, the moved wreck's tile polygon is the intact one shifted by 1 m along x, turned like
    // the direction: tiles along the grid's u and v axes (iso diamond: x maps to u and v by ±√½).
    const s0 = out.states![0].directions.find((d) => d.name === 'S')!.tiles!.polygon;
    const s2 = out.states![2].directions.find((d) => d.name === 'S')!.tiles!.polygon;
    const centre = (p: [number, number][]) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
    const [u0, v0] = centre(s0), [u2, v2] = centre(s2);
    expect(Math.hypot(u2 - u0, v2 - v0)).toBeCloseTo(1, 2);
  });
});
