// Moved from the old generator's packages/shared/src/map/stateCollision.test.ts (ali3b/sloponator#17, #18).
import { describe, expect, it } from 'vitest';
import { objectCollisionCells, type SpriteObjectBlock } from './tiled.js';

/** FB-085: an object placed in a state whose collision is none has no collision polygon in the map export. */
describe('per-state collision in map exports', () => {
  const block: SpriteObjectBlock = {
    centre: { x: 0, z: 0 },
    tiles: { metresPerTile: 1, shape: 'diamond' },
    collision: { points: [[-2.5, -0.1], [2.5, -0.1], [2.5, 0.1], [-2.5, 0.1]] },
    directions: [{ name: 'SE', worldAngle: 315, mirrorOf: null, tiles: { polygon: [[-2, 1], [2, -1], [2, -0.8], [-2, 1.2]] } }],
    states: [
      { name: 'intact', collision: { points: [[-2.5, -0.1], [2.5, -0.1], [2.5, 0.1], [-2.5, 0.1]] }, directions: [{ name: 'SE', tiles: { polygon: [[-2, 1], [2, -1], [2, -0.8], [-2, 1.2]] } }] },
      { name: 'destroyed', collision: { points: [] }, directions: [{ name: 'SE', tiles: { polygon: [] } }] },
    ],
  };

  it('the intact state keeps its polygon; the destroyed one (collision none) has none', () => {
    expect(objectCollisionCells(block, 1, { state: 'intact', facing: 'SE' })).toHaveLength(4);
    expect(objectCollisionCells(block, 1, { state: 'destroyed', facing: 'SE' })).toBeNull();
  });

  it('a state without tile polygons and no points is still empty, not the base polygon', () => {
    const noTiles: SpriteObjectBlock = { ...block, tiles: null, states: [{ name: 'destroyed', collision: { points: [] } }] };
    expect(objectCollisionCells(noTiles, 1, { state: 'destroyed', facing: 'SE' })).toBeNull();
  });
});
