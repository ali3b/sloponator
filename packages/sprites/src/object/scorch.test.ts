// Moved from synty-sprite-generator packages/shared/src/object/scorch.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { STATE_LOOKS, parseLook, scorchPlan } from './scorch.js';
import { checkStates, parseStatesArg, stateSet } from './states.js';

describe('procedural states: --states syntax (FB-028)', () => {
  it('reads name=@look, with parameters and a transition', () => {
    expect(parseStatesArg('auto,destroyed=@scorch,destroyed@collapse')).toEqual({
      auto: true,
      entries: [{ name: 'destroyed', look: 'scorch' }, { name: 'destroyed', transition: 'collapse' }],
    });
    expect(parseStatesArg('destroyed=@scorch:debris=0;dark=0.9@collapse:dust=20').entries).toEqual([
      { name: 'destroyed', look: 'scorch:debris=0;dark=0.9', transition: 'collapse:dust=20' },
    ]);
    expect(parseStatesArg('auto+scorch')).toEqual({ auto: true, autoLook: 'scorch', entries: [] });
  });

  it('still reads models and transitions as before', () => {
    expect(parseStatesArg('intact=SM_Veh_Car_01,destroyed=POLYGON_War/SM_Veh_Car_Damaged_01@destroy:force=6;duration=2').entries).toEqual([
      { name: 'intact', asset: 'SM_Veh_Car_01' },
      { name: 'destroyed', asset: 'POLYGON_War/SM_Veh_Car_Damaged_01', transition: 'destroy:force=6;duration=2' },
    ]);
    expect(parseStatesArg('auto,destroyed@destroy').entries).toEqual([{ name: 'destroyed', transition: 'destroy' }]);
  });

  it('refuses unknown looks, bad parameters and empty entries', () => {
    expect(() => parseStatesArg('destroyed=@melt')).toThrow(/unknown procedural state "@melt"/);
    expect(() => parseStatesArg('destroyed=@scorch:heat=3')).toThrow(/no parameter "heat"/);
    expect(() => parseStatesArg('auto+melt')).toThrow(/unknown procedural state/);
    expect(() => parseStatesArg('destroyed=')).toThrow(/bad state/);
    expect(() => parseStatesArg('destroyed')).toThrow(/bad state/);
    expect(checkStates({ intact: { asset: 1 }, destroyed: { asset: 1, look: 'melt' } })[0]).toMatch(/unknown procedural state/);
  });

  it('a look state renders on its own copy of the model: the set items carry the look', () => {
    const set = stateSet({ intact: { asset: 7 }, destroyed: { asset: 7, look: 'scorch', transition: 'collapse' } });
    expect(set.items.map((i) => (i.type === 'template' ? [i.label, i.model, i.look ?? null, i.layers[0].id] : null))).toEqual([
      ['intact', 7, null, 'still'],
      ['destroyed', 7, 'scorch', 'still'],
      // The transition plays on the intact model (no look) and ends on the scorched one.
      ['intact_to_destroyed', 7, null, 'collapse'],
    ]);
  });
});

describe('scorch: the burnt-out look', () => {
  const box = { min: { x: -5, y: 0, z: -3 }, max: { x: 5, y: 3, z: 3 } };

  it('parses with defaults', () => {
    expect(parseLook('scorch')).toEqual({ id: 'scorch', params: { ...STATE_LOOKS.scorch } });
    expect(parseLook('@scorch:debris=0').params.debris).toBe(0);
  });

  it('darkens, sinks, squashes and tilts a little', () => {
    const p = scorchPlan(box);
    expect(Math.max(...p.tint)).toBeLessThan(0.5);
    expect(p.sink).toBeCloseTo(0.06 * 3);
    expect(p.scaleY).toBeCloseTo(0.92);
    expect(p.tilt).toBeCloseTo((3 * Math.PI) / 180);
    expect(Math.hypot(p.axis.x, p.axis.z)).toBeCloseTo(1);
    expect(scorchPlan(box, { dark: 0 }).tint).toEqual([1, 1, 1]);
  });

  it('lays rubble inside the footprint (it does not widen the collision), deterministic', () => {
    const p = scorchPlan(box);
    expect(p.rubble.length).toBe(8);
    for (const r of p.rubble) {
      expect(Math.abs(r.x) + r.size * 0.5).toBeLessThanOrEqual(5 + 1e-9);
      expect(Math.abs(r.z) + r.size * 0.5).toBeLessThanOrEqual(3 + 1e-9);
    }
    expect(scorchPlan(box)).toEqual(p);
    expect(scorchPlan(box, { debris: 0 }).rubble).toEqual([]);
  });
});
