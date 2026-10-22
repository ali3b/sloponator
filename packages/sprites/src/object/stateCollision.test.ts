// Moved from synty-sprite-generator packages/shared/src/object/stateCollision.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { checkStates, parseStatesArg, parseTransition, stateSet } from './states.js';
import { objectInfo, objectStates } from './footprint.js';
import type { Direction, Framing } from '../view/camera.js';

describe('per-state collision (FB-085)', () => {
  it('parses ;collision=<mode> on any entry, inside or after a transition', () => {
    expect(parseStatesArg('destroyed=@scorch:dark=0.9@collapse:blast=1;collision=none').entries).toEqual([
      { name: 'destroyed', look: 'scorch:dark=0.9', transition: 'collapse:blast=1', collision: 'none' },
    ]);
    expect(parseStatesArg('auto,destroyed@destroy;collision=none').entries).toEqual([{ name: 'destroyed', transition: 'destroy', collision: 'none' }]);
    // Only the collision of an automatic state.
    expect(parseStatesArg('auto,destroyed;collision=base').entries).toEqual([{ name: 'destroyed', collision: 'base' }]);
    // As the first transition parameter, the others stay.
    expect(parseStatesArg('open=12@doors:collision=none;angle=90').entries).toEqual([{ name: 'open', asset: '12', transition: 'doors:;angle=90', collision: 'none' }]);
    expect(parseTransition('doors:;angle=90')).toEqual([{ id: 'doors', params: { angle: 90 } }]);
    expect(parseStatesArg('intact=SM_Wall_01;collision=concave').entries).toEqual([{ name: 'intact', asset: 'SM_Wall_01', collision: 'concave' }]);
    expect(parseStatesArg('intact:spin;collision=full').entries).toEqual([{ name: 'intact', template: 'spin', collision: 'full' }]);
    expect(() => parseStatesArg('destroyed@destroy;collision=maybe')).toThrow(/collision must be/);
  });

  it('checks the mode and carries it onto the state still (not the transition)', () => {
    expect(checkStates({ intact: { asset: 1 }, destroyed: { asset: 2, collision: 'nope' as never } })).toEqual([expect.stringMatching(/collision must be/)]);
    const set = stateSet({ intact: { asset: 1, collision: 'concave' }, destroyed: { asset: 2, transition: 'destroy', collision: 'none' } });
    const st = set.items.map((i) => (i.type === 'template' ? i.state : undefined));
    expect(st).toEqual([{ name: 'intact', collision: 'concave' }, { name: 'destroyed', collision: 'none' }, { name: 'destroyed', from: 'intact' }]);
  });

  it('a state measured with collision none has empty polygons in the states block', () => {
    const framing = { frameWidth: 128, frameHeight: 128, pivot: { x: 64, y: 100 }, viewHalfW: 4, viewHalfH: 4, centreY: 0, ppm: 16 } as Framing;
    const dirs = [{ name: 'S', worldAngle: 270, screenAngle: 270, mirrorOf: null } as Direction];
    const view = { pitch: 30, projection: 'ortho' as const, scale: { mode: 'tile' as const, tilePx: 64, shape: 'diamond' as const, metresPerTile: 1 } };
    const points: [number, number][] = [[-2.5, -0.1], [2.5, -0.1], [2.5, 0.1], [-2.5, 0.1]];
    const intact = objectInfo({ points, minY: 0, maxY: 2, view, framing, directions: dirs })!;
    const gone = objectInfo({ points, minY: 0, maxY: 2, view, framing, directions: dirs, collision: 'none' })!;
    const out = objectStates(intact, [
      { name: 'intact', animation: 'intact', asset: 'SM_Prop_Fence_High_02', info: intact },
      { name: 'destroyed', animation: 'destroyed', asset: 'SM_Prop_Fence_High_02', look: 'scorch', info: gone },
    ]);
    const d = out.states![1];
    expect(d.collision).toEqual({ source: 'none', points: [], rule: 'asked' });
    expect(d.directions[0].polygon).toEqual([]);
    expect(d.directions[0].tiles!.polygon).toEqual([]);
    expect(out.states![0].directions[0].polygon.length).toBe(4);
  });
});
