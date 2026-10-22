// Moved from synty-sprite-generator packages/shared/src/model3d/silhouette.ts (P3, ali3b/sloponator#14).
/**
 * Silhouette coverage of a triangle soup (pure maths, for export checks): the share of a rectangle a projection of
 * the triangles covers, sampled on an N × N grid of cell centres.
 */

/**
 * The share (0..1) of the rectangle `rect` = [x0, y0, x1, y1] in the plane of axes (ax, ay) (0 = X, 1 = Y, 2 = Z)
 * that the triangles (9 floats each) cover, seen along the third axis.
 */
export function silhouetteCoverage(tris: ArrayLike<number>, ax: 0 | 1 | 2, ay: 0 | 1 | 2, rect: [number, number, number, number], N = 32): number {
  const [x0, y0, x1, y1] = rect;
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return 0;
  const g = new Uint8Array(N * N);
  const cx = (i: number) => x0 + ((i + 0.5) / N) * w, cy = (j: number) => y0 + ((j + 0.5) / N) * h;
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const px = [tris[t + ax], tris[t + 3 + ax], tris[t + 6 + ax]], py = [tris[t + ay], tris[t + 3 + ay], tris[t + 6 + ay]];
    const d = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
    if (Math.abs(d) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor(((Math.min(...px) - x0) / w) * N - 0.5)), i1 = Math.min(N - 1, Math.ceil(((Math.max(...px) - x0) / w) * N - 0.5));
    const j0 = Math.max(0, Math.floor(((Math.min(...py) - y0) / h) * N - 0.5)), j1 = Math.min(N - 1, Math.ceil(((Math.max(...py) - y0) / h) * N - 0.5));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        if (g[j * N + i]) continue;
        const x = cx(i), y = cy(j);
        const a = ((px[1] - x) * (py[2] - y) - (px[2] - x) * (py[1] - y)) / d;
        const b = ((px[2] - x) * (py[0] - y) - (px[0] - x) * (py[2] - y)) / d;
        if (a >= -1e-9 && b >= -1e-9 && 1 - a - b >= -1e-9) g[j * N + i] = 1;
      }
  }
  let n = 0;
  for (const v of g) n += v;
  return n / (N * N);
}

/** Thresholds of the bare-chassis check (bareChassisCheck), measured on Synty cars: bodies cover ≥ 0.9 of the side. */
export const BARE_CHASSIS_TOP = 0.85;
export const BARE_CHASSIS_SIDE = 0.7;

/**
 * A geometric "no body-sized mesh" check for a car (CS-FB-008 follow-up): its non-wheel triangles seen from above
 * fill the rectangle between the wheel centres (a car-sized frame), but seen from the side they leave the band from
 * the axles up to the wheel tops mostly open (a frame or roll cage, not body panels). Null when it looks bodied (or
 * there is nothing to measure), else both coverages.
 */
export function bareChassisCheck(tris: ArrayLike<number>, wheels: { pos: number[]; radius: number }[]): { top: number; side: number } | null {
  if (wheels.length < 4 || !tris.length) return null;
  const xs = wheels.map((w) => w.pos[0]), zs = wheels.map((w) => w.pos[2]);
  const R = Math.max(...wheels.map((w) => w.radius));
  const axle = wheels.reduce((s, w) => s + w.pos[1], 0) / wheels.length;
  const top = silhouetteCoverage(tris, 0, 2, [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]);
  const side = silhouetteCoverage(tris, 2, 1, [Math.min(...zs), axle, Math.max(...zs), axle + 2 * R]);
  return top >= BARE_CHASSIS_TOP && side < BARE_CHASSIS_SIDE ? { top, side } : null;
}
