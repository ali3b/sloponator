// Moved from synty-sprite-generator packages/shared/src/object/slices.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS, computeFraming, resolveDirections, type ViewConfig } from '../view/camera.js';
import { buildContext } from '../manifest/context.js';
import { genericData } from '../manifest/meta.js';
import { objectInfo, type Vec2 } from './footprint.js';
import { columnStrips, objectSlices } from './slices.js';

const iso = VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
const tileView = (over: Partial<ViewConfig> = {}): ViewConfig => ({ ...iso, scale: { mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' }, padding: 2, frameWidth: 16, frameHeight: 16, ...over });
const rect = (w: number, d: number): Vec2[] => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

describe('column strips', () => {
  it('cuts a 2×2 footprint into four 32 px strips centred on the anchor', () => {
    const s = columnStrips({ anchor: { x: 100, y: 80 }, u: 2, v: 2, tilePx: 64, pitch: 30, frameWidth: 200, frameHeight: 120 });
    expect(s).toHaveLength(4);
    // Outer strips reach the frame edges; inner boundaries every half tile.
    expect(s.map((x) => [x.x, x.w])).toEqual([[0, 68], [68, 32], [100, 32], [132, 68]]);
    expect(s.every((x) => x.y === 0 && x.h === 120)).toBe(true);
    // Front outline: left corner (36, 80) → bottom corner (100, 112) → right corner (164, 80).
    expect(s[0].edge).toEqual([[36, 80], [68, 96]]);
    expect(s[1].edge).toEqual([[68, 96], [100, 112]]);
    expect(s[2].edge).toEqual([[100, 112], [132, 96]]);
    expect(s[3].edge).toEqual([[132, 96], [164, 80]]);
    expect(s.map((x) => x.tile)).toEqual([{ u: 0, v: 1 }, { u: 1, v: 1 }, { u: 1, v: 1 }, { u: 1, v: 0 }]);
    expect(s.map((x) => x.sortY)).toEqual([88, 104, 104, 88]);
    expect(s[1].ground).toEqual({ x: 84, y: 104 });
  });

  it('handles uneven footprints and a single tile', () => {
    const s = columnStrips({ anchor: { x: 64, y: 64 }, u: 3, v: 1, tilePx: 64, pitch: 30, frameWidth: 128, frameHeight: 96 });
    expect(s).toHaveLength(4);
    expect(s.map((x) => x.tile)).toEqual([{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }, { u: 2, v: 0 }]);
    // The bottom corner of a 3×1 block: half a tile right of the anchor and a tile height below it.
    expect(s[2].edge).toEqual([[64, 80], [96, 96]]);
    const one = columnStrips({ anchor: { x: 32, y: 40 }, u: 1, v: 1, tilePx: 64, pitch: 30, frameWidth: 64, frameHeight: 64 });
    expect(one.map((x) => [x.x, x.w])).toEqual([[0, 32], [32, 32]]);
    expect(one[0].edge).toEqual([[0, 40], [32, 56]]);
  });

  it('follows the tile height of other pitches', () => {
    const s = columnStrips({ anchor: { x: 64, y: 64 }, u: 1, v: 1, tilePx: 64, pitch: 90, frameWidth: 128, frameHeight: 128 });
    expect(s[0].edge[1][1]).toBeCloseTo(96, 0);
  });
});

describe('object.slices', () => {
  const view = tileView({ facings: 4, slice: 'columns' });
  const dirs = resolveDirections(view);
  const framing = computeFraming({ minY: 0, maxY: 3, radius: Math.hypot(1, 1.5) }, view);
  const info = objectInfo({ points: rect(2, 3), minY: 0, maxY: 3, view, framing, directions: dirs })!;
  const slices = objectSlices(info, view, framing)!;

  it('has u + v strips per direction whose front outline is the footprint\'s', () => {
    expect(slices).toMatchObject({ mode: 'columns', stripPx: 32, tilePx: 64, tileHeightPx: 32 });
    expect(slices.directions.map((d) => d.name)).toEqual(info.directions.map((d) => d.name));
    for (const d of info.directions) {
      const strips = slices.directions.find((x) => x.name === d.name)!.strips;
      expect(strips).toHaveLength(5);
      const xs = d.polygon.map((p) => p[0]), ys = d.polygon.map((p) => p[1]);
      // Left, bottom and right corners of the rendered footprint are the outline's ends and its lowest point.
      expect(strips[0].edge[0][0]).toBeCloseTo(Math.min(...xs), 1);
      expect(strips[4].edge[1][0]).toBeCloseTo(Math.max(...xs), 1);
      expect(Math.max(...strips.flatMap((s) => s.edge.map((p) => p[1])))).toBeCloseTo(Math.max(...ys), 1);
      // Strips tile the frame without gaps.
      expect(strips[0].x).toBe(0);
      strips.slice(1).forEach((s, i) => expect(s.x).toBe(strips[i].x + strips[i].w));
      expect(strips[4].x + strips[4].w).toBe(framing.frameWidth);
    }
  });

  it('needs a diamond tile lock', () => {
    const sq = tileView({ scale: { mode: 'tile', tilePx: 32, metresPerTile: 1, shape: 'square' } });
    const f = computeFraming({ minY: 0, maxY: 3, radius: 2 }, sq);
    expect(objectSlices(objectInfo({ points: rect(2, 3), minY: 0, maxY: 3, view: sq, framing: f, directions: resolveDirections(sq) })!, sq, f)).toBeNull();
    const ppm: ViewConfig = { ...iso, scale: { mode: 'ppm', ppm: 32 } };
    const f2 = computeFraming({ minY: 0, maxY: 3, radius: 2 }, ppm);
    expect(objectSlices(objectInfo({ points: rect(2, 3), minY: 0, maxY: 3, view: ppm, framing: f2, directions: resolveDirections(ppm) })!, ppm, f2)).toBeNull();
  });

  it('travels into the generic JSON with the object block', () => {
    const object = { ...info, slices };
    const ctx = buildContext({
      asset: { name: 'SM_Bld_Bunker_01', pack: 'POLYGON_War', kind: 'prop' }, view, framing, directions: dirs, clips: [], pages: [],
      placement: () => undefined, pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: '{clip}_{dir}', object,
    });
    expect(genericData(ctx).object?.slices).toEqual(slices);
  });
});
