// Moved from synty-sprite-generator packages/shared/src/model3d/hull.test.ts (P3, ali3b/sloponator#14).
import { describe, expect, it } from 'vitest';
import { convexHull3 } from '../src/spec/hull.js';

/** Signed volume of a closed triangle mesh (positive when faces wind counter-clockwise from outside). */
function volume(h: { pos: number[]; idx: number[] }) {
  let v = 0;
  for (let i = 0; i < h.idx.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => h.pos.slice(h.idx[i + k] * 3, h.idx[i + k] * 3 + 3));
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

/** Every edge is shared by exactly two faces, once each way (a closed, consistently wound surface). */
function closed(h: { idx: number[] }) {
  const e = new Map<string, number>();
  for (let i = 0; i < h.idx.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const key = `${h.idx[i + k]},${h.idx[i + ((k + 1) % 3)]}`;
      e.set(key, (e.get(key) ?? 0) + 1);
    }
  return [...e].every(([k, n]) => n === 1 && e.get(k.split(',').reverse().join(',')) === 1);
}

describe('convexHull3 (CS-FB-002 collider convex)', () => {
  it('a cube with points inside: 8 corners, 12 triangles, outward winding, its volume', () => {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) pts.push(i & 1 ? 2 : 0, i & 2 ? 1 : 0, i & 4 ? 3 : 0);
    for (let i = 0; i < 200; i++) pts.push(0.1 + 1.8 * Math.random(), 0.1 + 0.8 * Math.random(), 0.1 + 2.8 * Math.random());
    const h = convexHull3(pts)!;
    expect(h.pos.length / 3).toBe(8);
    expect(h.idx.length / 3).toBe(12);
    expect(volume(h)).toBeCloseTo(6, 6);
    expect(closed(h)).toBe(true);
  });

  it('a sphere of points: closed, every point inside or on it', () => {
    const pts: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.random() < 0.5 ? 1 : Math.random();
      pts.push(r * Math.sqrt(1 - u * u) * Math.cos(t), r * Math.sqrt(1 - u * u) * Math.sin(t), r * u);
    }
    const h = convexHull3(pts)!;
    expect(closed(h)).toBe(true);
    const v = volume(h);
    expect(v).toBeGreaterThan(3.5);
    expect(v).toBeLessThan((4 / 3) * Math.PI + 1e-9);
    // No point is outside any face.
    let worst = -Infinity;
    for (let f = 0; f < h.idx.length; f += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => h.pos.slice(h.idx[f + k] * 3, h.idx[f + k] * 3 + 3));
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      for (let i = 0; i < pts.length; i += 3) worst = Math.max(worst, n[0] * (pts[i] - a[0]) + n[1] * (pts[i + 1] - a[1]) + n[2] * (pts[i + 2] - a[2]));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('maxVertices caps the hull (a sphere of 4000 points to 255, 64 and 4 vertices): closed, inside the full hull, near its volume', () => {
    const pts: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2;
      pts.push(Math.sqrt(1 - u * u) * Math.cos(t), Math.sqrt(1 - u * u) * Math.sin(t), u);
    }
    const full = convexHull3(pts)!;
    expect(full.pos.length / 3).toBeGreaterThan(1000);
    for (const cap of [255, 64, 4]) {
      const h = convexHull3(pts, cap)!;
      expect(h.pos.length / 3).toBeLessThanOrEqual(cap);
      expect(closed(h)).toBe(true);
      expect(volume(h)).toBeLessThanOrEqual(volume(full) + 1e-9);
      if (cap === 255) expect(volume(h) / volume(full)).toBeGreaterThan(0.95);
      if (cap === 64) expect(volume(h) / volume(full)).toBeGreaterThan(0.8);
      // Its vertices are points of the set (on the sphere).
      for (let i = 0; i < h.pos.length; i += 3) expect(Math.hypot(h.pos[i], h.pos[i + 1], h.pos[i + 2])).toBeCloseTo(1, 9);
    }
    // A cube under the cap is untouched.
    const cube: number[] = [];
    for (let i = 0; i < 8; i++) cube.push(i & 1 ? 2 : 0, i & 2 ? 1 : 0, i & 4 ? 3 : 0);
    expect(convexHull3(cube, 255)!.pos.length / 3).toBe(8);
  });

  it('flat or too few points: null', () => {
    expect(convexHull3([0, 0, 0, 1, 0, 0, 0, 1, 0])).toBeNull();
    expect(convexHull3([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0.5, 0.5, 0])).toBeNull();
    expect(convexHull3([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
