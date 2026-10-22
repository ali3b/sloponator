// Moved from synty-sprite-generator packages/shared/src/object/facings.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS, computeFraming, facingAngles, facingAxis, objectView, projectAngle, resolveDirections, viewGrid, type ViewConfig } from '../view/camera.js';
import { objectInfo, type Vec2 } from './footprint.js';

const preset = (id: string) => VIEW_PRESETS.find((p) => p.id === id)!.config;
const iso = preset('iso8');
const tileView = (over: Partial<ViewConfig> = {}): ViewConfig => ({ ...iso, scale: { mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' }, padding: 2, frameWidth: 16, frameHeight: 16, ...over });
const rect = (w: number, d: number): Vec2[] => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

describe('grid-aligned facings (FB-013)', () => {
  it('knows the grid a view stands on', () => {
    expect(viewGrid(iso)).toBe('diamond');
    expect(viewGrid(preset('trueiso8'))).toBe('diamond');
    expect(viewGrid(preset('topdown8'))).toBe('square');
    expect(viewGrid({ ...preset('topdown8'), scale: { mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' } })).toBe('diamond');
    expect(viewGrid({ ...iso, scale: { mode: 'tile', tilePx: 32, metresPerTile: 1, shape: 'square' } })).toBe('square');
  });

  it('maps 1, 2 and 4 facings to the grid axes', () => {
    expect(facingAngles('diamond', 1)).toEqual([315]);
    expect(facingAngles('diamond', 2)).toEqual([315, 225]);
    expect(facingAngles('diamond', 4)).toEqual([315, 225, 135, 45]);
    expect(facingAngles('square', 2)).toEqual([270, 0]);
    expect(facingAxis(315, 'diamond')).toBe('+u');
    expect(facingAxis(45, 'diamond')).toBe('-v');
    expect(facingAxis(270, 'diamond')).toBeNull();
    expect(facingAxis(270, 'square')).toBe('+v');
  });

  it('replaces the view\'s directions, named like the 4d set, on the 2:1 tile diagonals', () => {
    const one = resolveDirections({ ...iso, facings: 1 });
    expect(one.map((d) => [d.name, d.worldAngle])).toEqual([['SE', 315]]);
    // A world 45° facing lands on the 2:1 iso tile diagonal (26.57° on screen).
    expect(one[0].screenAngle).toBeCloseTo(projectAngle(315, 30));
    expect(360 - one[0].screenAngle).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 3);
    expect(resolveDirections({ ...iso, facings: 2 }).map((d) => d.name).sort()).toEqual(['SE', 'SW']);
    const four = resolveDirections({ ...iso, facings: 4 });
    expect(four.map((d) => d.name)).toEqual(resolveDirections({ ...iso, directions: '4d' }).map((d) => d.name));
    // Screen basis is ignored (the grid is on the ground); mirroring still halves the sheet.
    expect(resolveDirections({ ...iso, facings: 1, basis: 'screen' })[0].worldAngle).toBe(315);
    expect(resolveDirections({ ...iso, facings: 4, mirror: true }).filter((d) => d.mirrorOf === null)).toHaveLength(2);
    // 0 = the view's own directions.
    expect(resolveDirections({ ...iso, facings: 0 })).toHaveLength(8);
    // Square grids: S, then E.
    expect(resolveDirections({ ...preset('topdown8'), facings: 2 }).map((d) => d.name).sort()).toEqual(['E', 'S']);
  });

  it('lines a model\'s sides up with the tiles in every facing', () => {
    const view = tileView({ facings: 4 });
    const dirs = resolveDirections(view);
    const framing = computeFraming({ minY: 0, maxY: 2, radius: Math.hypot(1, 1.5) }, view);
    const info = objectInfo({ points: rect(2, 3), minY: 0, maxY: 2, view, framing, directions: dirs })!;
    expect(info.directions.map((d) => d.facing).sort()).toEqual(['+u', '+v', '-u', '-v']);
    for (const d of info.directions) {
      // Axis-aligned in tile units: every corner is (±a, ±b) with {a, b} = {1, 1.5}.
      for (const [u, v] of d.tiles!.polygon) expect([Math.abs(u), Math.abs(v)].sort()).toEqual([1, 1.5]);
      expect([d.tiles!.u, d.tiles!.v].sort()).toEqual([2, 3]);
    }
    // The unturned S of an 8-direction view is diagonal across the diamonds.
    const s = objectInfo({ points: rect(2, 3), minY: 0, maxY: 2, view: tileView(), framing, directions: resolveDirections(tileView()) })!;
    expect(s.directions.find((d) => d.name === 'S')!.facing).toBeNull();
  });

  it('keeps facings asked for explicitly', () => {
    expect(objectView({ ...iso, facings: 4 }).facings).toBe(4);
    expect(objectView(iso).facings).toBe(1);
  });
  // The sprite-spec defaults test (toBatchSpec / effectiveSpec) stayed with the Studio state in the old generator.
});
