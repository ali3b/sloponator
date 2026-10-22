// Moved from synty-sprite-generator packages/shared/src/object/concave.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { concaveOutline } from './concave.js';
import { convexHull, objectInfo, polygonArea, type Vec2 } from './footprint.js';
import type { Framing } from '../view/camera.js';

/** Point in polygon (even-odd). */
const inside = (poly: Vec2[], [x, z]: Vec2) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/** A half ring of boxes (sandbags): radius r, thickness t, n pieces, height h; triangles as the renderer gives them. */
function curvedWall(r = 3, t = 0.5, n = 12, h = 1) {
  const tris: number[] = [];
  const points: Vec2[] = [];
  const heights: number[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = (Math.PI * k) / n, a1 = (Math.PI * (k + 1)) / n;
    const q: Vec2[] = [
      [Math.cos(a0) * (r - t / 2), Math.sin(a0) * (r - t / 2)], [Math.cos(a0) * (r + t / 2), Math.sin(a0) * (r + t / 2)],
      [Math.cos(a1) * (r + t / 2), Math.sin(a1) * (r + t / 2)], [Math.cos(a1) * (r - t / 2), Math.sin(a1) * (r - t / 2)],
    ];
    for (const y of [0, h]) {
      tris.push(q[0][0], y, q[0][1], q[1][0], y, q[1][1], q[2][0], y, q[2][1]);
      tris.push(q[0][0], y, q[0][1], q[2][0], y, q[2][1], q[3][0], y, q[3][1]);
    }
    for (const p of q) {
      for (const y of [0, h]) {
        points.push(p);
        heights.push(y);
      }
    }
  }
  return { tris, points, heights };
}

const flatTris = (tris: number[]) => {
  const out: number[][] = [];
  for (let k = 0; k < tris.length; k += 9) out.push([tris[k], tris[k + 2], tris[k + 3], tris[k + 5], tris[k + 6], tris[k + 8]]);
  return out;
};

describe('concaveOutline (FB-099)', () => {
  it('follows a curved wall: the inside of the curve stays open', () => {
    const w = curvedWall();
    const poly = concaveOutline({ tris: flatTris(w.tris) })!;
    expect(poly.length).toBeGreaterThanOrEqual(6);
    expect(poly.length).toBeLessThanOrEqual(64);
    expect(polygonArea(poly)).toBeGreaterThan(0); // counter-clockwise
    // The middle of the half ring is free; the wall itself is covered.
    expect(inside(poly, [0, 1])).toBe(false);
    expect(inside(poly, [0, 2])).toBe(false);
    expect(inside(poly, [0, 3])).toBe(true);
    expect(inside(poly, [3 * Math.cos(0.3), 3 * Math.sin(0.3)])).toBe(true);
    // Area close to the wall's own (π·r·t ≈ 4.71 m²), far under the convex hull's.
    const area = polygonArea(poly);
    expect(area).toBeGreaterThan(4);
    expect(area).toBeLessThan(6.5);
    expect(area).toBeLessThan(polygonArea(convexHull(w.points)) / 2);
  });

  it('closes small gaps between pieces', () => {
    const tris = [
      [0, 0, 1, 0, 1, 0.3], [0, 0, 1, 0.3, 0, 0.3],
      [1.08, 0, 2, 0, 2, 0.3], [1.08, 0, 2, 0.3, 1.08, 0.3],
    ];
    const poly = concaveOutline({ tris })!;
    expect(inside(poly, [1.04, 0.15])).toBe(true);
    expect(inside(poly, [0.5, 0.15]) && inside(poly, [1.5, 0.15])).toBe(true);
  });

  it('a plain box stays a box (vertical faces still count)', () => {
    const tris = [[-2, -0.2, 2, -0.2, 2, 0.2], [-2, -0.2, 2, 0.2, -2, 0.2], [-2, -0.2, 2, -0.2, 2, -0.2]];
    const poly = concaveOutline({ tris })!;
    expect(poly.length).toBeLessThanOrEqual(8);
    expect(Math.abs(polygonArea(poly) - 1.6)).toBeLessThan(0.3);
  });

  it('works from vertices alone, and gives null for nothing', () => {
    const pts: Vec2[] = [];
    for (let k = 0; k <= 40; k++) for (const rr of [2.8, 3, 3.2]) pts.push([Math.cos((Math.PI * k) / 40) * rr, Math.sin((Math.PI * k) / 40) * rr]);
    const poly = concaveOutline({ points: pts })!;
    expect(inside(poly, [0, 1])).toBe(false);
    expect(inside(poly, [0, 3])).toBe(true);
    expect(concaveOutline({})).toBeNull();
    expect(concaveOutline({ points: [[1, 1]] })).toBeNull();
  });
});

describe('objectInfo collision concave / none', () => {
  const framing: Framing = { frameWidth: 256, frameHeight: 256, pivot: { x: 128, y: 200 }, viewHalfW: 4, ppm: 32 } as unknown as Framing;
  const view = { pitch: 30, projection: 'ortho' as const, scale: { mode: 'tile' as const, tilePx: 64, shape: 'diamond' as const, metresPerTile: 1 } };
  const dirs = [{ name: 'S', worldAngle: 0, mirrorOf: null }] as never;
  const w = curvedWall();
  const base = { points: w.points, heights: w.heights, minY: 0, maxY: 1, view, framing, directions: dirs } as const;

  it('concave: the outline of the slice, with source and cut', () => {
    const info = objectInfo({ ...base, tris: w.tris, collision: 'concave' })!;
    expect(info.collision.source).toBe('concave');
    expect(info.collision.rule).toBe('asked');
    expect(info.collision.cut).toBe(1);
    expect(inside(info.collision.points, [0, 1])).toBe(false);
    expect(info.directions[0].polygon.length).toBe(info.collision.points.length);
    expect(info.directions[0].tiles!.polygon.length).toBe(info.collision.points.length);
    // Footprint and tiles still cover the whole model.
    expect(info.footprint.w).toBeCloseTo(6.5, 1);
  });

  it('concave without triangles uses the vertices', () => {
    const info = objectInfo({ ...base, collision: 'concave' })!;
    expect(info.collision.source).toBe('concave');
  });

  it('none: no polygon at all', () => {
    const info = objectInfo({ ...base, collision: 'none' })!;
    expect(info.collision).toEqual({ source: 'none', points: [], rule: 'asked' });
    expect(info.directions[0].polygon).toEqual([]);
    expect(info.directions[0].tiles!.polygon).toEqual([]);
    expect(info.canopy).toBeUndefined();
  });
});
