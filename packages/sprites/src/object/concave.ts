// Moved from synty-sprite-generator packages/shared/src/object/concave.ts (P2, ali3b/sloponator#8).
/**
 * Concave ground outlines (FB-099): the shape a wall, fence or sandbag ring really covers on the ground, instead of
 * its convex hull (which fills the inside of a curve). The ground slice's triangles (and loose vertices) are drawn
 * onto a fine grid, small gaps between pieces (sandbags, planks) are closed, holes are filled, and the outline of
 * the biggest piece is traced and simplified into a counter-clockwise polygon in metres (model axes).
 *
 * Pure maths: the exporter feeds it the mesh's triangles; the tests feed it shapes.
 */
type Vec2 = [number, number];

/** Signed area (positive = counter-clockwise in (x, z) maths orientation). */
function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export interface ConcaveInput {
  /** Ground projections of triangles: [x0, z0, x1, z1, x2, z2] each (a vertical face projects to a line, which still counts). */
  tris?: number[][];
  /** Loose ground points (vertices without triangles). */
  points?: Vec2[];
}

export interface ConcaveOptions {
  /** Grid cell size in metres (default: the longer side / 160, between 2 cm and 10 cm). */
  cell?: number;
  /** Gaps up to about twice this many metres are closed (default 0.1 m with triangles, 0.3 m with points only). */
  close?: number;
  /** Most points in the result (default 64): the simplification tolerance grows until it fits. */
  maxPoints?: number;
}

const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

/** Perpendicular distance from p to the segment a-b. */
function segDist(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function douglasPeucker(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts;
  let at = -1, far = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > far) [far, at] = [d, i];
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [...douglasPeucker(pts.slice(0, at + 1), tol).slice(0, -1), ...douglasPeucker(pts.slice(at), tol)];
}

/** Simplify a closed ring: split at its two farthest-apart vertices and simplify both halves. */
export function simplifyRing(ring: Vec2[], tol: number): Vec2[] {
  if (ring.length <= 4) return ring;
  const farthestFrom = (from: number) => {
    let at = from, best = -1;
    for (let i = 0; i < ring.length; i++) {
      const d = Math.hypot(ring[i][0] - ring[from][0], ring[i][1] - ring[from][1]);
      if (d > best) [best, at] = [d, i];
    }
    return at;
  };
  // The vertex farthest from the first, then the one farthest from that: a good split for a ring.
  const b = farthestFrom(0), a = farthestFrom(b);
  if (a === b) return ring;
  const [i, j] = a < b ? [a, b] : [b, a];
  const first = douglasPeucker(ring.slice(i, j + 1), tol);
  const second = douglasPeucker([...ring.slice(j), ...ring.slice(0, i + 1)], tol);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * The concave outline of a ground slice, counter-clockwise in (x, z) (positive signed area), metres rounded to the
 * millimetre. Null when nothing with an area is left.
 */
export function concaveOutline(input: ConcaveInput, opts: ConcaveOptions = {}): Vec2[] | null {
  const tris = (input.tris ?? []).filter((t) => t.length >= 6 && t.every(Number.isFinite));
  const points = (input.points ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!tris.length && !points.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const see = (x: number, z: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  for (const t of tris) for (let k = 0; k < 6; k += 2) see(t[k], t[k + 1]);
  for (const p of points) see(p[0], p[1]);
  const extent = Math.max(maxX - minX, maxZ - minZ);
  if (!(extent > 1e-4)) return null;
  const cell = opts.cell ?? Math.min(0.1, Math.max(0.02, extent / 160));
  const close = opts.close ?? (tris.length ? 0.1 : 0.3);
  const r = Math.max(1, Math.ceil(close / cell));
  const pad = r + 2;
  const W = Math.ceil((maxX - minX) / cell) + 1 + 2 * pad, H = Math.ceil((maxZ - minZ) / cell) + 1 + 2 * pad;
  const gx = (x: number) => (x - minX) / cell + pad, gz = (z: number) => (z - minZ) / cell + pad;
  let grid = new Uint8Array(W * H);
  const mark = (i: number, j: number) => {
    if (i >= 0 && j >= 0 && i < W && j < H) grid[j * W + i] = 1;
  };
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 2));
    for (let s = 0; s <= n; s++) mark(Math.floor(x0 + ((x1 - x0) * s) / n), Math.floor(z0 + ((z1 - z0) * s) / n));
  };
  for (const t of tris) {
    const a: Vec2 = [gx(t[0]), gz(t[1])], b: Vec2 = [gx(t[2]), gz(t[3])], c: Vec2 = [gx(t[4]), gz(t[5])];
    line(a[0], a[1], b[0], b[1]);
    line(b[0], b[1], c[0], c[1]);
    line(c[0], c[1], a[0], a[1]);
    // Cells whose centre is inside the triangle.
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const i0 = Math.floor(Math.min(a[0], b[0], c[0])), i1 = Math.ceil(Math.max(a[0], b[0], c[0]));
    const j0 = Math.floor(Math.min(a[1], b[1], c[1])), j1 = Math.ceil(Math.max(a[1], b[1], c[1]));
    const s = Math.sign(area);
    const edge = (p: Vec2, q: Vec2, x: number, z: number) => ((q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0])) * s >= 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i + 0.5, z = j + 0.5;
        if (edge(a, b, x, z) && edge(b, c, x, z) && edge(c, a, x, z)) mark(i, j);
      }
  }
  for (const p of points) mark(Math.floor(gx(p[0])), Math.floor(gz(p[1])));

  // Close small gaps: dilate by a disc of radius r, then erode by it.
  const disc: [number, number][] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r) disc.push([di, dj]);
  const dilate = (src: Uint8Array) => {
    const out = new Uint8Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (!src[j * W + i]) continue;
        for (const [di, dj] of disc) {
          const x = i + di, z = j + dj;
          if (x >= 0 && z >= 0 && x < W && z < H) out[z * W + x] = 1;
        }
      }
    return out;
  };
  const invert = (src: Uint8Array) => src.map((v) => 1 - v);
  grid = invert(dilate(invert(dilate(grid)))) as Uint8Array;

  // Fill holes: every empty cell not reachable from the border is inside.
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let i = 0; i < W; i++) stack.push(i, (H - 1) * W + i);
  for (let j = 0; j < H; j++) stack.push(j * W, j * W + W - 1);
  while (stack.length) {
    const k = stack.pop()!;
    if (outside[k] || grid[k]) continue;
    outside[k] = 1;
    const i = k % W, j = (k - i) / W;
    if (i > 0) stack.push(k - 1);
    if (i < W - 1) stack.push(k + 1);
    if (j > 0) stack.push(k - W);
    if (j < H - 1) stack.push(k + W);
  }
  for (let k = 0; k < W * H; k++) if (!outside[k]) grid[k] = 1;

  // The biggest 4-connected piece.
  const label = new Int32Array(W * H).fill(-1);
  let bestLabel = -1, bestSize = 0, labels = 0;
  for (let k0 = 0; k0 < W * H; k0++) {
    if (!grid[k0] || label[k0] >= 0) continue;
    const id = labels++;
    let size = 0;
    stack.push(k0);
    label[k0] = id;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const i = k % W, j = (k - i) / W;
      for (const n of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1])
        if (n >= 0 && grid[n] && label[n] < 0) {
          label[n] = id;
          stack.push(n);
        }
    }
    if (size > bestSize) [bestSize, bestLabel] = [size, id];
  }
  if (bestLabel < 0) return null;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && label[j * W + i] === bestLabel;

  // Boundary edges between the piece and the rest, with the piece on the left (counter-clockwise), on cell corners.
  const key = (i: number, j: number) => j * (W + 1) + i;
  const next = new Map<number, number[]>();
  const add = (a: [number, number], b: [number, number]) => {
    const k = key(a[0], a[1]);
    const list = next.get(k);
    if (list) list.push(key(b[0], b[1]));
    else next.set(k, [key(b[0], b[1])]);
  };
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (!inside(i, j)) continue;
      if (!inside(i, j - 1)) add([i, j], [i + 1, j]);
      if (!inside(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!inside(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!inside(i - 1, j)) add([i, j + 1], [i, j]);
    }
  const corner = (k: number): Vec2 => [k % (W + 1), Math.floor(k / (W + 1))];
  // Chain the edges into rings; at a corner where two edges leave (cells touching diagonally) take the left turn.
  const rings: Vec2[][] = [];
  for (const [start] of next) {
    while (next.get(start)?.length) {
      const ring: Vec2[] = [];
      let at = start, prev: Vec2 | null = null;
      for (let guard = 0; guard < 4 * W * H + 8; guard++) {
        const outs = next.get(at);
        if (!outs?.length) break;
        const here = corner(at);
        let pick = 0;
        if (outs.length > 1 && prev) {
          const din: Vec2 = [here[0] - prev[0], here[1] - prev[1]];
          let bestTurn = -Infinity;
          outs.forEach((o, n) => {
            const q = corner(o);
            const dout: Vec2 = [q[0] - here[0], q[1] - here[1]];
            const turn = din[0] * dout[1] - din[1] * dout[0];
            if (turn > bestTurn) [bestTurn, pick] = [turn, n];
          });
        }
        const to = outs.splice(pick, 1)[0];
        ring.push(here);
        prev = here;
        at = to;
        if (at === start) break;
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  if (!rings.length) return null;
  let outer = rings[0];
  for (const ring of rings) if (Math.abs(polygonArea(ring)) > Math.abs(polygonArea(outer))) outer = ring;
  // Drop collinear corners, then simplify to at most maxPoints.
  const corners = outer.filter((p, n) => {
    const a = outer[(n - 1 + outer.length) % outer.length], b = outer[(n + 1) % outer.length];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
  const toMetres = (p: Vec2): Vec2 => [round3(minX + (p[0] - pad) * cell), round3(minZ + (p[1] - pad) * cell)];
  const max = Math.max(3, opts.maxPoints ?? 64);
  let tol = 2;
  let ring = simplifyRing(corners, tol);
  while (ring.length > max) ring = simplifyRing(corners, (tol *= 1.5));
  let out = ring.map(toMetres).filter((p, n, a) => n === 0 || p[0] !== a[n - 1][0] || p[1] !== a[n - 1][1]);
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out = out.slice(0, -1);
  if (out.length < 3 || Math.abs(polygonArea(out)) < 1e-6) return null;
  return polygonArea(out) < 0 ? out.reverse() : out;
}
