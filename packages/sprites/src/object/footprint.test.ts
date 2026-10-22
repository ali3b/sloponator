// Moved from synty-sprite-generator packages/shared/src/object/footprint.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS, computeFraming, resolveDirections, type ViewConfig } from '../view/camera.js';
import { buildContext } from '../manifest/context.js';
import { buildLayersManifest } from '../manifest/layers.js';
import { genericData, metaData } from '../profiles/render.js';
import { baseHull, collisionRule, convexHull, defaultCollisionCut, gridAxes, isObjectAssetKind, metresToTiles, objectInfo, polygonArea, projectGround, rotateYaw, toFramePx, type Vec2 } from './footprint.js';

const iso = VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
const tileView = (over: Partial<ViewConfig> = {}): ViewConfig => ({ ...iso, scale: { mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' }, padding: 2, frameWidth: 16, frameHeight: 16, ...over });
const square = (h: number): Vec2[] => [[-h, -h], [h, -h], [h, h], [-h, h]];

describe('convex hull', () => {
  it('keeps the outline counter-clockwise and drops inner and collinear points', () => {
    const hull = convexHull([...square(1), [0, 0], [0.5, 0.2], [1, 0], [0, 1], [-1, -1]]);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBeCloseTo(4);
    expect(hull).toEqual(expect.arrayContaining(square(1)));
  });
  it('passes degenerate input through', () => {
    expect(convexHull([[1, 1], [1, 1]])).toEqual([[1, 1]]);
    expect(convexHull([])).toEqual([]);
  });
});

describe('ground projection', () => {
  it('turns like three.js rotation.y', () => {
    const [x, z] = rotateYaw([1, 0], Math.PI / 2);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });
  it('puts far ground points higher on screen and keeps height', () => {
    // S (270°) shows the model unrotated, +z towards the camera.
    const near = projectGround([0, 1], 0, 270, 30), far = projectGround([0, -1], 0, 270, 30);
    expect(near.up).toBeCloseTo(-0.5);
    expect(far.up).toBeCloseTo(0.5);
    expect(projectGround([0, 0], 2, 270, 30).up).toBeCloseTo(2 * Math.cos(Math.PI / 6));
    expect(projectGround([1, 0], 0, 270, 30).right).toBeCloseTo(1);
  });
  it('lands the framing pivot on the model origin', () => {
    const view = tileView();
    const f = computeFraming({ minY: 0, maxY: 1, radius: 1 }, view);
    const [x, y] = toFramePx([0, 0], 0, 270, view.pitch, f);
    expect(x).toBeCloseTo(f.pivot.x);
    expect(y).toBeCloseTo(f.pivot.y);
  });
  it('has diamond axes along the screen diagonals', () => {
    const [u, v] = gridAxes('diamond');
    expect(u[0] * v[0] + u[1] * v[1]).toBeCloseTo(0);
    expect(u[0]).toBeGreaterThan(0);
    expect(v[0]).toBeLessThan(0);
  });
});

describe('tiles', () => {
  it('rounds up with a millimetre of slack', () => {
    expect(metresToTiles(2.0004, 1)).toEqual({ tiles: 2, exact: 2 });
    expect(metresToTiles(2.01, 1).tiles).toBe(3);
    expect(metresToTiles(0.2, 2)).toEqual({ tiles: 1, exact: 0.1 });
  });
});

describe('objectInfo', () => {
  it('draws a 1 m square, turned onto the grid, as one exact 64×32 iso tile', () => {
    const view = tileView({ directions: '4d' });
    const dirs = resolveDirections(view);
    const framing = computeFraming({ minY: 0, maxY: 0.5, radius: Math.SQRT1_2 }, view);
    const o = objectInfo({ points: square(0.5), minY: 0, maxY: 0.5, view, framing, directions: dirs })!;
    expect(o.footprint).toMatchObject({ w: 1, d: 1 });
    expect(o.tiles).toMatchObject({ w: 1, d: 1, wExact: 1, dExact: 1, shape: 'diamond' });
    expect(o.collision.source).toBe('hull');
    expect(polygonArea(o.collision.points)).toBeGreaterThan(0);
    for (const d of o.directions) {
      const xs = d.polygon.map((p) => p[0]), ys = d.polygon.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(64, 1);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(32, 1);
      expect(d.anchor).toEqual(framing.pivot);
      expect(d.tiles).toMatchObject({ u: 1, v: 1 });
    }
    expect(o.anchor).toEqual(framing.pivot);
  });
  it('says how many tiles an unaligned model spans and where its anchor is', () => {
    const view = tileView({ directions: '1' });
    const dirs = resolveDirections(view);
    // 3 m wide (x 0..3), 1 m deep, origin at a corner: the anchor is the footprint centre, not the origin.
    const pts: Vec2[] = [[0, 0], [3, 0], [3, 1], [0, 1], [1.5, 0.5]];
    const framing = computeFraming({ minY: 0, maxY: 2, radius: Math.hypot(3, 1) }, view);
    const o = objectInfo({ points: pts, minY: 0, maxY: 2, view, framing, directions: dirs })!;
    expect(o.tiles).toMatchObject({ w: 3, d: 1, wExact: 3, dExact: 1 });
    expect(o.centre).toEqual({ x: 1.5, z: 0.5 });
    expect(o.height).toBe(2);
    expect(o.collision.points).toHaveLength(4);
    const ppm = 64 / Math.SQRT2;
    expect(o.anchor!.x).toBeCloseTo(framing.pivot.x + 1.5 * ppm, 1);
    expect(o.anchor!.y).toBeCloseTo(framing.pivot.y + 0.5 * 0.5 * ppm, 1);
    // Facing S the model lies across the diamond grid: each grid axis sees (3 + 1) / √2 metres.
    const d = o.directions[0];
    expect(d.tiles!.uExact).toBeCloseTo(4 / Math.SQRT2, 2);
    expect(d.tiles!.u).toBe(3);
    // The tile polygon is centred on the anchor.
    const us = d.tiles!.polygon.map((p) => p[0]);
    expect(Math.max(...us) + Math.min(...us)).toBeCloseTo(0, 3);
  });
  it('flips mirrored directions', () => {
    const view = tileView({ directions: '8', mirror: true });
    const dirs = resolveDirections(view);
    const pts: Vec2[] = [[0, 0], [2, 0], [2, 1], [0, 1]];
    const framing = computeFraming({ minY: 0, maxY: 1, radius: Math.hypot(2, 1) }, view);
    const o = objectInfo({ points: pts, minY: 0, maxY: 1, view, framing, directions: dirs })!;
    const m = o.directions.find((d) => d.mirrorOf)!;
    const src = o.directions.find((d) => d.name === m.mirrorOf)!;
    expect(m.anchor.x).toBeCloseTo(framing.frameWidth - src.anchor.x);
    expect(m.anchor.y).toBe(src.anchor.y);
    expect(m.tiles!.u).toBe(src.tiles!.v);
    // A rendered direction at the mirrored angle of a symmetric footprint has the same tile spans.
    const plain: ViewConfig = { ...view, mirror: false };
    const real = objectInfo({ points: pts, minY: 0, maxY: 1, view: plain, framing, directions: resolveDirections(plain) })!;
    const same = real.directions.find((d) => d.name === m.name)!;
    expect(same.tiles!.u).toBe(m.tiles!.u);
    expect(same.tiles!.v).toBe(m.tiles!.v);
  });
  it('falls back to the bounds rectangle and leaves screen data out of perspective views', () => {
    const view: ViewConfig = { ...iso, projection: 'persp' };
    const framing = computeFraming({ minY: 0, maxY: 1, radius: 1 }, view);
    const o = objectInfo({ points: [[0, 0], [1, 0], [2, 0]], minY: 0, maxY: 1, view, framing, directions: resolveDirections(view) })!;
    expect(o.collision.source).toBe('bounds');
    expect(o.tiles).toBeNull();
    expect(o.directions).toEqual([]);
    expect(o.anchor).toBeNull();
    expect(objectInfo({ points: [], minY: 0, maxY: 0, view, framing, directions: [] })).toBeNull();
  });
  it('measures a centimetre-imported model at the scale the renderer gives it', () => {
    // POLYGON War's SM_Bld_Bunker_01 imports 100× too small (bounds ±0.0298 × ±0.0381, 0.0306 high); the renderer
    // multiplies its root nodes by the asset's scaleFix (100) and the exporter reads the scaled vertices.
    const fix = 100;
    const raw: Vec2[] = [[-0.0298, -0.0381], [0.0298, -0.0381], [0.0298, 0.0381], [-0.0298, 0.0381]];
    const view = tileView({ directions: '1' });
    const framing = computeFraming({ minY: 0, maxY: 0.0306 * fix, radius: Math.hypot(2.98, 3.81) }, view);
    const o = objectInfo({ points: raw.map(([x, z]) => [x * fix, z * fix]), minY: 0, maxY: 0.0306 * fix, view, framing, directions: resolveDirections(view) })!;
    expect(o.footprint).toMatchObject({ w: 5.96, d: 7.62 });
    expect(o.height).toBe(3.06);
    expect(o.tiles).toMatchObject({ w: 6, d: 8, wExact: 5.96, dExact: 7.62 });
    // 64 px diamond tiles of 1 m: about 45 px per metre, so the bunker is some 270 px wide on screen.
    const xs = o.directions[0].polygon.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo((5.96 * 64) / Math.SQRT2, 0);
  });
  it('knows which asset kinds are objects', () => {
    expect(['prop', 'multipart', 'vehicle', 'rigged', 'fx', 'weapon'].map(isObjectAssetKind)).toEqual([true, true, true, false, false, false]);
  });
});

describe('manifests', () => {
  it('carry the object block in the generic data, the meta file and the layers manifest', () => {
    const view = tileView({ directions: '1' });
    const directions = resolveDirections(view);
    const framing = computeFraming({ minY: 0, maxY: 1, radius: 1 }, view);
    const object = objectInfo({ points: square(0.5), minY: 0, maxY: 1, view, framing, directions })!;
    const ctx = buildContext({
      asset: { name: 'SM_Prop_Crate_01', pack: 'POLYGON_War', kind: 'prop' }, view, framing, directions, clips: [], pages: [],
      placement: () => undefined, pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: '{clip}_{dir}', object,
    });
    expect(genericData(ctx).object).toEqual(object);
    expect(metaData(ctx)?.object).toEqual(object);
    const m = buildLayersManifest({ body: ctx, bodyFiles: [], parts: [], z: () => ({}), occlusion: 'mask', alignment: { view, framing, layout: { mode: 'grid', grouping: 'single', trim: false, padding: 0, extrude: 0, powerOfTwo: false, maxSize: 4096 }, clips: [] } });
    expect(m.object?.tiles).toMatchObject({ w: 1, d: 1 });
    // Without an object (characters) nothing is added.
    const plain = buildContext({ asset: { ...ctx.asset, kind: 'rigged' }, view, framing, directions, clips: [], pages: [], placement: () => undefined, pageFile: '{base}.png', frameName: '{clip}', animationName: '{clip}' });
    expect('object' in genericData(plain)).toBe(false);
    // A tile lock alone is worth a meta file (FB-019): it records the grid, but no object block.
    expect('object' in metaData(plain)!).toBe(false);
    expect(metaData(plain)!.scale).toEqual({ mode: 'tile', pixelsPerMetre: 45.2548, tilePx: 64, tileHeightPx: 32, metresPerTile: 1, shape: 'diamond' });
    const fit = { ...view, scale: { mode: 'fit' as const } };
    const fitFraming = computeFraming({ minY: 0, maxY: 1, radius: 1 }, fit);
    // FB-104: a fitted sprite with nothing else to say still gets its meta, so a game can tell a UI icon by its scale.
    expect(metaData(buildContext({ asset: plain.asset, view: fit, framing: fitFraming, directions, clips: [], pages: [], placement: () => undefined, pageFile: '{base}.png', frameName: '{clip}', animationName: '{clip}' })).scale).toEqual({ mode: 'fit', pixelsPerMetre: null });
  });
});

/** A tree: a 0.4 m trunk up to 2 m, then a 5 × 5.6 m canopy up to 6 m (like POLYGON_War SM_Env_Tree_01). */
function tree(trunk = 0.2) {
  const points: Vec2[] = [], heights: number[] = [];
  const add = (p: Vec2, y: number) => (points.push(p), heights.push(y));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    add([trunk * Math.cos(a), trunk * Math.sin(a)], 0); // trunk foot (and the same points higher up dedupe to it)
    add([2.5 * Math.cos(a), 2.8 * Math.sin(a)], 2 + (k % 3)); // canopy rim
  }
  add([0, 0], 6);
  return { points, heights, minY: 0, maxY: 6 };
}

describe('ground-slice collision (FB-017)', () => {
  const view = tileView({ directions: '1' });
  const directions = resolveDirections(view);
  const framing = computeFraming({ minY: 0, maxY: 6, radius: 3 }, view);
  const width = (pts: Vec2[]) => Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));

  it('collides a tree with its trunk and keeps the canopy, footprint and tiles from the whole model', () => {
    const t = tree();
    const o = objectInfo({ ...t, view, framing, directions })!;
    expect(o.collision.source).toBe('base');
    expect(o.collision.cut).toBe(0.5); // min(0.5 m, 15 % of 6 m)
    expect(width(o.collision.points)).toBeLessThan(1);
    expect(polygonArea(o.collision.points)).toBeGreaterThan(0); // counter-clockwise
    expect(o.canopy?.source).toBe('hull');
    expect(width(o.canopy!.points)).toBeCloseTo(5, 1);
    expect(o.footprint.w).toBeCloseTo(5, 1);
    expect(o.tiles).toMatchObject({ w: 5, d: 6 });
    // The facing's tile span is the canopy's, its polygon the trunk's; the canopy is there in pixels too.
    const d = o.directions[0];
    expect(d.tiles!.u).toBeGreaterThan(3);
    expect(Math.max(...d.tiles!.polygon.map((p) => Math.abs(p[0])))).toBeLessThan(0.5);
    expect(d.polygon).toHaveLength(o.collision.points.length);
    expect(d.canopyPolygon).toHaveLength(o.canopy!.points.length);
  });

  it('takes a configured cut, and falls back to the whole hull when the slice is not much smaller', () => {
    const t = tree();
    // A 3 m cut reaches into the canopy rim: the slice is most of the hull, so the hull stays.
    const high = objectInfo({ ...t, collisionHeight: 3, view, framing, directions })!;
    expect(high.collision.source).toBe('hull');
    expect(high.canopy).toBeUndefined();
    expect(high.directions[0].canopyPolygon).toBeUndefined();
    // A crate is as wide at the bottom as at the top.
    const box: Vec2[] = [...square(0.5), ...square(0.5)];
    const crate = objectInfo({ points: box, heights: [0, 0, 0, 0, 1, 1, 1, 1], minY: 0, maxY: 1, view, framing, directions })!;
    expect(crate.collision.source).toBe('hull');
    // Without heights (older callers) it is the hull, as before.
    expect(objectInfo({ points: t.points, minY: 0, maxY: 6, view, framing, directions })!.collision.source).toBe('hull');
  });

  it('grows a slice that has no area until it has one', () => {
    // A post standing on one point: only the tip touches the ground, the post widens at 1 m.
    const pts: Vec2[] = [[0, 0], [0.1, 0], [0, 0.1], [-0.1, -0.1], [3, 0], [-3, 0], [0, 3], [0, -3]];
    const hs = [0, 1, 1, 1, 4, 4, 4, 4];
    const base = baseHull(pts, hs, 0, 4, 0.5)!;
    expect(base.cut).toBe(1);
    expect(base.points).toHaveLength(3);
    expect(baseHull([[0, 0], [1, 0]], [0, 0], 0, 1, 0.5)).toBeNull();
    const o = objectInfo({ points: pts, heights: hs, minY: 0, maxY: 4, view, framing, directions })!;
    expect(o.collision).toMatchObject({ source: 'base', cut: 1 });
  });

  it('default cut: 0.5 m or 15 % of the height', () => {
    expect(defaultCollisionCut(10)).toBe(0.5);
    expect(defaultCollisionCut(2)).toBeCloseTo(0.3);
  });
});

/**
 * A plane like POLYGON_War SM_Veh_Plane_German_01 (FB-050): a 9 m fuselage along z, 10 m wings at z 0..1.5, the
 * main gear 0.6 m up, and only the tail wheel touching the ground at the back (z = -4.2).
 */
function plane() {
  const points: Vec2[] = [], heights: number[] = [];
  const add = (p: Vec2, y: number) => (points.push(p), heights.push(y));
  for (const [x, z] of [[-0.1, -4.3], [0.1, -4.3], [0.1, -4.1], [-0.1, -4.1]] as Vec2[]) add([x, z], 0); // tail wheel
  for (const [x, z] of [[-1.5, 0.8], [1.5, 0.8], [-1.5, 1.2], [1.5, 1.2]] as Vec2[]) add([x, z], 0.6); // main gear
  for (const [x, z] of [[-0.6, -4.5], [0.6, -4.5], [-0.6, 4.5], [0.6, 4.5]] as Vec2[]) add([x, z], 1); // fuselage
  for (const [x, z] of [[-5, 0], [5, 0], [-5, 1.5], [5, 1.5]] as Vec2[]) add([x, z], 1.2); // wings
  add([0, 0], 3);
  return { points, heights, minY: 0, maxY: 3 };
}

describe('collision rule by what the model is (FB-050)', () => {
  const view = tileView({ directions: '1' });
  const directions = resolveDirections(view);
  const framing = computeFraming({ minY: 0, maxY: 6, radius: 6 }, view);
  const area = (pts: Vec2[]) => Math.abs(polygonArea(pts));

  it('names: vehicles, aircraft and buildings are full; trees, poles, lamps and signs thin; the rest by shape', () => {
    expect(collisionRule({ name: 'SM_Veh_Plane_German_01', kind: 'prop' })).toBe('vehicle');
    expect(collisionRule({ name: 'SM_Prop_Aircraft_Wreck_01', kind: 'prop' })).toBe('vehicle');
    expect(collisionRule({ name: 'SM_Heli_Transport_01', kind: 'prop' })).toBe('vehicle');
    expect(collisionRule({ name: 'SM_Jet_Fighter_01', kind: 'prop' })).toBe('vehicle');
    expect(collisionRule({ name: 'SM_Tank_01', kind: 'vehicle' })).toBe('vehicle');
    expect(collisionRule({ name: 'Anything', kind: 'prop', category: 'wreck' })).toBe('vehicle');
    expect(collisionRule({ name: 'SM_Bld_Tower_01', kind: 'prop' })).toBe('building');
    expect(collisionRule({ name: 'SM_Env_Tree_Pine_01', kind: 'prop' })).toBe('thin');
    expect(collisionRule({ name: 'SM_Prop_LampPost_01', kind: 'prop' })).toBe('thin');
    expect(collisionRule({ name: 'SM_Prop_Sign_Road_01', kind: 'prop' })).toBe('thin');
    expect(collisionRule({ name: 'SM_Prop_Crate_01', kind: 'prop' })).toBe('shape');
    expect(collisionRule(undefined)).toBe('shape');
  });

  it('a plane collides with its whole hull, not the tail wheel', () => {
    const p = plane();
    const named = objectInfo({ ...p, subject: { name: 'SM_Veh_Plane_German_01', kind: 'prop' }, view, framing, directions })!;
    expect(named.collision).toMatchObject({ source: 'hull', rule: 'vehicle' });
    expect(named.canopy).toBeUndefined();
    expect(area(named.collision.points)).toBeGreaterThan(20);
    // Unnamed, its shape decides: the slice is tiny but sits at the tail, far from the middle, so the hull stays.
    const anon = objectInfo({ ...p, view, framing, directions })!;
    expect(anon.collision).toMatchObject({ source: 'hull', rule: 'shape' });
    // Asked for: the slice (the tail wheel), whatever the model is.
    const asked = objectInfo({ ...p, collision: 'base', subject: { name: 'SM_Veh_Plane_German_01', kind: 'prop' }, view, framing, directions })!;
    expect(asked.collision).toMatchObject({ source: 'base', rule: 'asked' });
    expect(area(asked.collision.points)).toBeLessThan(0.1);
  });

  it('a tree keeps its trunk by name and by shape; full is honoured; buildings and vehicles never slice', () => {
    const t = tree();
    expect(objectInfo({ ...t, subject: { name: 'SM_Env_Tree_01', kind: 'prop' }, view, framing, directions })!.collision).toMatchObject({ source: 'base', rule: 'thin' });
    expect(objectInfo({ ...t, view, framing, directions })!.collision).toMatchObject({ source: 'base', rule: 'shape' });
    expect(objectInfo({ ...t, collision: 'full', view, framing, directions })!.collision).toMatchObject({ source: 'hull', rule: 'asked' });
    expect(objectInfo({ ...t, subject: { name: 'SM_Bld_Watchtower_01', kind: 'prop' }, view, framing, directions })!.collision).toMatchObject({ source: 'hull', rule: 'building' });
    expect(objectInfo({ ...t, subject: { name: 'SM_Thing_01', kind: 'vehicle' }, view, framing, directions })!.collision).toMatchObject({ source: 'hull', rule: 'vehicle' });
    // collisionHeight given: the slice at that height when it is at most half the hull (the old rule).
    expect(objectInfo({ ...t, collisionHeight: 1, subject: { name: 'SM_Veh_Plane_01', kind: 'prop' }, view, framing, directions })!.collision).toMatchObject({ source: 'base', rule: 'height' });
  });

  it('an unnamed thing with a wide base but under half the hull is not sliced by shape alone', () => {
    // A 1 x 1 m plinth under a 3 x 3 m top: 11 % of the hull and centred = sliced; a 2 x 2 m base (44 %) is not.
    const mk = (b: number) => ({ points: [...square(b), ...square(1.5)], heights: [0, 0, 0, 0, 2, 2, 2, 2], minY: 0, maxY: 3 });
    expect(objectInfo({ ...mk(0.5), view, framing, directions })!.collision.source).toBe('base');
    expect(objectInfo({ ...mk(1), view, framing, directions })!.collision.source).toBe('hull');
    // With a "thin" name the old half-the-hull rule applies.
    expect(objectInfo({ ...mk(1), subject: { name: 'SM_Prop_Umbrella_01', kind: 'prop' }, view, framing, directions })!.collision.source).toBe('base');
  });
});
