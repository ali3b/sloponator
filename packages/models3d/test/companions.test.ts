// Moved from synty-sprite-generator apps/server/test/companions.test.ts (P3, ali3b/sloponator#14).
import { describe, expect, it } from 'vitest';
import { companionSlot, companionsAmong, isCompanionName, missingBodyWarning } from '../src/build/companions.js';

// Pro Racer names (CS-FB-008).
describe('companions by name', () => {
  it.each([
    ['SM_Veh_Stock_Car_01', 'SM_Veh_Stock_Car_01_Body_01', true],
    ['SM_Veh_Kart_01', 'SM_Veh_Kart_01_Side_Skirts_03', true],
    ['SM_Veh_Kart_01', 'SM_Veh_Kart_Wheel_F_01', true],
    ['SM_Veh_Truck_01', 'SM_Veh_Truck_01_TrailerAxle_01', true],
    ['SM_Veh_Stock_Car_01', 'SM_Veh_Stock_Car_02_Body_01', false],
    ['SM_Veh_Stock_Car_01', 'SM_Veh_Stock_Car_01', false],
    ['SM_Veh_Car_01', 'SM_Veh_Car_Police_01', false],
    ['SM_Veh_Stock_Car_01_Body_01', 'SM_Veh_Stock_Car_01_Body_02', false],
    ['SM_Veh_Pace_Car_01', 'SM_Veh_Attach_Pace_Car_Siren_01', true],
  ])('%s / %s -> %s', (v, c, want) => expect(isCompanionName(v, c)).toBe(want));

  it('slots, body first; the missing-body warning', () => {
    expect(companionSlot('SM_Veh_Rally_01', 'SM_Veh_Rally_01_Front_Bumper_01')).toBe('bumper');
    expect(companionSlot('SM_Veh_Rally_01', 'SM_Veh_Rally_01_Bonnet_01')).toBe('part');
    const c = companionsAmong('SM_Veh_Stock_Car_01', [
      { id: 3, name: 'SM_Veh_Stock_Car_01_Spoiler_01', kind: 'prop' },
      { id: 2, name: 'SM_Veh_Stock_Car_01_Body_02', kind: 'vehicle' },
      { id: 1, name: 'SM_Veh_Stock_Car_01_Body_01', kind: 'vehicle' },
      { id: 4, name: 'SM_Prop_Cone_01', kind: 'prop' },
    ]);
    expect(c.map((x) => [x.name, x.slot])).toEqual([['SM_Veh_Stock_Car_01_Body_01', 'body'], ['SM_Veh_Stock_Car_01_Body_02', 'body'], ['SM_Veh_Stock_Car_01_Spoiler_01', 'spoiler']]);
    expect(missingBodyWarning('SM_Veh_Stock_Car_01', c, [], true)).toMatch(/attach one of SM_Veh_Stock_Car_01_Body_01, SM_Veh_Stock_Car_01_Body_02/);
    expect(missingBodyWarning('SM_Veh_Stock_Car_01', c, ['POLYGON_Pro_Racer/sm_veh_stock_car_01_body_02'], true)).toBeNull();
    expect(missingBodyWarning('SM_Veh_Stock_Car_01', c, [], false)).toBeNull();
  });
});
