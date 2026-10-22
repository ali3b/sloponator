// Moved from the old generator's packages/shared/src/map/objectSummary.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import { compactObjectSummary, objectSummary } from './objectSummary.js';

describe('objectSummary (FB-045)', () => {
  it('tile-locked: per-facing tiles and metres; cells on a map at the same scale follow the facing', () => {
    const s = objectSummary({
      footprint: { w: 7.2, d: 2.9 }, height: 3.14159, anchor: { x: 100.123, y: 80 }, tiles: { w: 8, d: 3, metresPerTile: 1 },
      directions: [{ name: 'SE', tiles: { u: 8, v: 3, uExact: 7.2, vExact: 2.9 } }, { name: 'SW', tiles: { u: 3, v: 8, uExact: 2.9, vExact: 7.2 } }],
    }, 1);
    expect(s).toEqual({
      facings: ['SE', 'SW'], perFacing: { SE: { u: 8, v: 3, metres: [7.2, 2.9] }, SW: { u: 3, v: 8, metres: [2.9, 7.2] } }, metres: { w: 7.2, d: 2.9 },
      tiles: { w: 8, d: 3, metresPerTile: 1 }, height: 3.14, anchor: { x: 100.12, y: 80 }, cells: { SE: [8, 3], SW: [3, 8] },
    });
  });

  it('not tile-locked: metres per facing from the grid axis it faces; a map at another scale gets the unturned cells', () => {
    const s = objectSummary({ footprint: { w: 3, d: 1 }, height: 2, anchor: null, tiles: null, directions: [{ name: 'SE', facing: '+u' }, { name: 'NE', facing: '-v' }, { name: 'S', facing: null }], states: [{ name: 'intact' }, { name: 'destroyed' }] }, 2);
    expect(s.perFacing).toEqual({ SE: { metres: [1, 3] }, NE: { metres: [3, 1] } });
    expect(s.states).toEqual(['intact', 'destroyed']);
    expect(s.cells).toEqual({ SE: [2, 1], NE: [2, 1], S: [2, 1] });
    expect(objectSummary({ footprint: { w: 1, d: 1 }, directions: [] }).cells).toBeUndefined();
  });

  it('compactObjectSummary: one string per facing', () => {
    const base = { footprint: { w: 7.2, d: 2.9 }, height: 3, anchor: { x: 100, y: 80 }, tiles: { w: 8, d: 3, metresPerTile: 1 }, states: [{ name: 'intact' }],
      directions: [{ name: 'SE', tiles: { u: 8, v: 3, uExact: 7.2, vExact: 2.9 } }, { name: 'SW', tiles: { u: 3, v: 8, uExact: 2.9, vExact: 7.2 } }] };
    expect(compactObjectSummary(objectSummary(base))).toEqual({ facings: { SE: '8×3 cells, 7.2×2.9 m', SW: '3×8 cells, 2.9×7.2 m' }, height: 3, states: ['intact'], anchor: [100, 80] });
    expect(compactObjectSummary(objectSummary({ footprint: { w: 1.5, d: 1 }, height: 1, directions: [] }, 1)).facings).toEqual({ any: '2×1 cells, 1.5×1 m' });
  });
});
