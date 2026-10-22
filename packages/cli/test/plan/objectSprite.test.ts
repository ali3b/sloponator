// Ported from synty-sprite-generator packages/shared/src/sprite/objectSprite.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { BUILTIN_SETS, resolveDirections } from '@slop/sprites';
import { applyViewCard, effectiveSet, initialState, reducer, viewForKind } from '../../src/plan/state.js';
import { specOf } from '../../src/plan/spriteSpec.js';

describe('object sprites', () => {
  it('render one facing in iso and their own facings when chosen; other kinds keep the view', () => {
    const iso = applyViewCard({ ...initialState(), kind: 'object' }, 'iso8');
    expect(resolveDirections(iso.view)).toHaveLength(8);
    expect(resolveDirections(viewForKind('object', iso.view))).toHaveLength(1);
    expect(resolveDirections(viewForKind('object', { ...iso.view, facings: 2 }))).toHaveLength(2);
    expect(resolveDirections(viewForKind('object', { ...iso.view, facings: 4 }))).toHaveLength(4);
    expect(resolveDirections(viewForKind('object', { ...iso.view, facings: 0 }))).toHaveLength(8);
    expect(resolveDirections(viewForKind('character', iso.view))).toHaveLength(8);
    const top = applyViewCard({ ...initialState(), kind: 'object' }, 'topdown8');
    expect(resolveDirections(viewForKind('object', top.view))).toHaveLength(8);
  });

  it('states replace the moves and can be cleared', () => {
    const s = { ...initialState(), kind: 'object' as const, setId: 'builtin_object' };
    const withStates = reducer(s, { type: 'states', states: { intact: { asset: 1 }, destroyed: { asset: 2, transition: 'destroy' } } });
    expect(effectiveSet(withStates, BUILTIN_SETS).items.map((it) => it.label)).toEqual(['intact', 'destroyed', 'intact_to_destroyed']);
    expect(specOf(withStates).states).toEqual(withStates.states);
    const cleared = reducer(withStates, { type: 'states', states: null });
    expect(cleared.states).toBeUndefined();
    expect(effectiveSet(cleared, BUILTIN_SETS).id).toBe('builtin_object');
  });
});
