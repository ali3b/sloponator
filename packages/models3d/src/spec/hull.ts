// Moved from synty-sprite-generator packages/shared/src/model3d/hull.ts (P3, ali3b/sloponator#14).
/**
 * A 3D convex hull (quickhull) for `collider: convex` (CS-FB-002): the smallest convex triangle mesh around a point
 * set, faces wound counter-clockwise seen from outside. Positions are welded (0.01 mm) first. Null when the points
 * are flat or fewer than four (no volume to hull).
 *
 * `maxVertices` caps the hull's vertices (physics engines take at most 255 or so): points are then added farthest
 * first across the whole hull, and it stops at the cap, so the result is the hull of the most outlying points (a
 * little inside the full hull, never outside it).
 */
export function convexHull3(points: ArrayLike<number>, maxVertices = Infinity): { pos: number[]; idx: number[] } | null {
  const P: number[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 2 < points.length; i += 3) {
    const p = [points[i], points[i + 1], points[i + 2]];
    if (!p.every(Number.isFinite)) continue;
    const key = p.map((x) => Math.round(x * 1e5)).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      P.push(p);
    }
  }
  if (P.length < 4) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  const extent = Math.max(...hi.map((v, k) => v - lo[k]));
  if (!(extent > 0)) return null;
  const eps = extent * 1e-7;

  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a: number[]) => Math.sqrt(dot(a, a));

  // The first tetrahedron: the two extreme points farthest apart, the point farthest from their line, the point
  // farthest from their plane.
  const ext: number[] = [];
  for (let k = 0; k < 3; k++) {
    let a = 0, b = 0;
    P.forEach((p, i) => {
      if (p[k] < P[a][k]) a = i;
      if (p[k] > P[b][k]) b = i;
    });
    ext.push(a, b);
  }
  let i0 = ext[0], i1 = ext[1], best = -1;
  for (const a of ext) for (const b of ext) {
    const d = len(sub(P[a], P[b]));
    if (d > best) {
        best = d;
        i0 = a;
        i1 = b;
      }
  }
  if (best <= eps) return null;
  const dir = sub(P[i1], P[i0]);
  let i2 = -1;
  best = eps;
  P.forEach((p, i) => {
    const d = len(cross(dir, sub(p, P[i0]))) / len(dir);
    if (d > best) {
      best = d;
      i2 = i;
    }
  });
  if (i2 < 0) return null;
  const n0 = cross(sub(P[i1], P[i0]), sub(P[i2], P[i0]));
  const n0l = len(n0);
  let i3 = -1;
  best = eps;
  P.forEach((p, i) => {
    const d = Math.abs(dot(n0, sub(p, P[i0]))) / n0l;
    if (d > best) {
      best = d;
      i3 = i;
    }
  });
  if (i3 < 0) return null;

  interface Face { v: [number, number, number]; n: number[]; d: number; out: number[]; alive: boolean }
  let faces: Face[] = [];
  // Each directed edge a→b to the face it bounds (its twin b→a is on the neighbour).
  const N = P.length;
  const edgeFace = new Map<number, Face>();
  const link = (f: Face, on: boolean) => {
    for (let k = 0; k < 3; k++) {
      const key = f.v[k] * N + f.v[(k + 1) % 3];
      if (on) edgeFace.set(key, f);
      else if (edgeFace.get(key) === f) edgeFace.delete(key);
    }
  };
  const makeFace = (a: number, b: number, c: number): Face => {
    const n = cross(sub(P[b], P[a]), sub(P[c], P[a]));
    const l = len(n) || 1;
    const nn = n.map((x) => x / l);
    return { v: [a, b, c], n: nn, d: dot(nn, P[a]), out: [], alive: true };
  };
  const dist = (f: Face, p: number[]) => dot(f.n, p) - f.d;
  const tet = [i0, i1, i2, i3];
  for (const [a, b, c, o] of [[0, 1, 2, 3], [0, 3, 1, 2], [1, 3, 2, 0], [2, 3, 0, 1]]) {
    let f = makeFace(tet[a], tet[b], tet[c]);
    // Wound so the fourth corner is behind it (its normal points out).
    if (dist(f, P[tet[o]]) > 0) f = makeFace(tet[a], tet[c], tet[b]);
    faces.push(f);
    link(f, true);
  }
  const pending: Face[] = [];
  const assign = (pts: number[], to: Face[]) => {
    for (const i of pts) {
      let bestF: Face | null = null, bestD = eps;
      for (const f of to) {
        const d = dist(f, P[i]);
        if (d > bestD) {
        bestD = d;
        bestF = f;
      }
      }
      if (bestF) {
        if (!bestF.out.length) pending.push(bestF);
        bestF.out.push(i);
      }
    }
  };
  const inTet = new Set(tet);
  assign(P.map((_, i) => i).filter((i) => !inTet.has(i)), faces);

  let alive = faces.length;
  const capped = Number.isFinite(maxVertices);
  let vertices = 4;
  while (pending.length) {
    if (vertices >= Math.max(4, maxVertices)) break;
    let f: Face;
    if (capped) {
      // The pending face with the farthest outside point next (the cap keeps the points that matter most).
      let bi = -1, bd = -Infinity;
      for (let k = 0; k < pending.length; k++) {
        const g = pending[k];
        if (!g.alive || !g.out.length) continue;
        for (const i of g.out) {
          const d = dist(g, P[i]);
          if (d > bd) {
        bd = d;
        bi = k;
      }
        }
      }
      if (bi < 0) break;
      f = pending[bi];
      pending[bi] = pending[pending.length - 1];
      pending.pop();
    } else f = pending.pop()!;
    if (!f.alive || !f.out.length) continue;
    vertices++;
    let ip = f.out[0], far = -Infinity;
    for (const i of f.out) {
      const d = dist(f, P[i]);
      if (d > far) {
        far = d;
        ip = i;
      }
    }
    const p = P[ip];
    // The faces p sees, found across shared edges from f; the horizon is where a visible face meets a hidden one.
    const visible = new Set<Face>([f]);
    const stack = [f];
    const horizon: [number, number][] = [];
    while (stack.length) {
      const v = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const a = v.v[k], b = v.v[(k + 1) % 3];
        const nb = edgeFace.get(b * N + a);
        if (!nb || visible.has(nb)) continue;
        if (dist(nb, p) > eps) {
          visible.add(nb);
          stack.push(nb);
        }
      }
    }
    for (const v of visible)
      for (let k = 0; k < 3; k++) {
        const a = v.v[k], b = v.v[(k + 1) % 3];
        const nb = edgeFace.get(b * N + a);
        if (!nb || !visible.has(nb)) horizon.push([a, b]);
      }
    const orphans: number[] = [];
    for (const v of visible) {
      v.alive = false;
      link(v, false);
      for (const i of v.out) if (i !== ip) orphans.push(i);
      v.out = [];
    }
    const added = horizon.map(([a, b]) => makeFace(a, b, ip));
    for (const a of added) link(a, true);
    faces.push(...added);
    assign(orphans, added);
    alive += added.length - visible.size;
    if (faces.length > 64 && faces.length > 4 * alive) faces = faces.filter((x) => x.alive);
  }
  const live = faces.filter((f) => f.alive);
  const remap = new Map<number, number>();
  const pos: number[] = [], idx: number[] = [];
  for (const f of live)
    for (const i of f.v) {
      let j = remap.get(i);
      if (j === undefined) {
        remap.set(i, (j = pos.length / 3));
        pos.push(...P[i]);
      }
      idx.push(j);
    }
  return { pos, idx };
}
