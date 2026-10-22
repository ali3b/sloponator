// Moved from synty-sprite-generator apps/server/src/modelSeats.ts (P3, ali3b/sloponator#14).
import type { ModelSeat } from '../spec/index.js';

/**
 * Seat points for seating props (OR-FB-024: grandstands, bleachers, benches), from the exported geometry alone. A seat is
 * a flat, upward-facing surface the size of a seat (or a bench plank, cut into seats every SEAT_PITCH metres) at a
 * sitting height above what is in front of it: the step or the row below, or the ground. A seated person faces the open
 * side: towards that lower step, else away from the seat's back.
 */

/** Asset names that are seating (with the label category or tag `seating`). */
export const SEATING_NAME = /grandstand|bleacher|seating|(^|_)benche?s?(_|\d|$)|(^|_)stands?(_|\d|$)|terrace/i;
/** Pieces of a stand that are not sat on (stairs, roofs, ends, trims, barriers). */
export const NOT_SEATING_NAME = /stair|roof|(^|_)end(_|\d|$)|trim|entrance|barrier|railing|text|marking|sign/i;
/** Whether an asset is seating by its name. */
export const isSeatingName = (name: string) => SEATING_NAME.test(name) && !NOT_SEATING_NAME.test(name);

export const SEAT_PITCH = 0.55;
/** Bump when detectSeats changes: seating exports are rebuilt (models.ts sourceKey). */
export const SEATS_VERSION = 7;

interface Patch {
  area: number;
  min: number[];
  max: number[];
  y: number;
  ylo: number;
  yhi: number;
}

const near = (a: number, lo: number, hi: number) => a >= lo && a <= hi;
const areaXZ = (p: { min: number[]; max: number[] }) => (p.max[0] - p.min[0]) * (p.max[2] - p.min[2]);
const overlapXZ = (a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }) =>
  Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0])) * Math.max(0, Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]));

/** The horizontal (XZ) distance between two boxes (0 when they overlap). */
function boxGap(a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }) {
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]), dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(dx, dz);
}

/** The flat upward-facing surfaces of a triangle soup (9 floats a triangle): triangles that share a corner join. */
export function upwardPatches(tris: Float32Array, minUp = 0.94): Patch[] {
  const n = Math.floor(tris.length / 9);
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const up: number[] = [];
  const areas = new Float64Array(n);
  const byCorner = new Map<string, number>();
  const key = (o: number) => `${Math.round(tris[o] * 200)},${Math.round(tris[o + 1] * 200)},${Math.round(tris[o + 2] * 200)}`;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = tris[o + 3] - tris[o], ay = tris[o + 4] - tris[o + 1], az = tris[o + 5] - tris[o + 2];
    const bx = tris[o + 6] - tris[o], by = tris[o + 7] - tris[o + 1], bz = tris[o + 8] - tris[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9 || ny / l < minUp) continue;
    areas[t] = l / 2;
    up.push(t);
    for (let k = 0; k < 3; k++) {
      const c = key(o + k * 3);
      const other = byCorner.get(c);
      if (other === undefined) byCorner.set(c, t);
      else parent[find(t)] = find(other);
    }
  }
  const patches = new Map<number, Patch & { ysum: number }>();
  for (const t of up) {
    const r = find(t);
    let p = patches.get(r);
    if (!p) patches.set(r, (p = { area: 0, ysum: 0, y: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], ylo: Infinity, yhi: -Infinity }));
    const o = t * 9;
    for (let k = 0; k < 3; k++)
      for (let d = 0; d < 3; d++) {
        p.min[d] = Math.min(p.min[d], tris[o + k * 3 + d]);
        p.max[d] = Math.max(p.max[d], tris[o + k * 3 + d]);
      }
    p.area += areas[t];
    p.ysum += ((tris[o + 1] + tris[o + 4] + tris[o + 7]) / 3) * areas[t];
  }
  const list = [...patches.values()].map((p) => ({ area: p.area, min: p.min, max: p.max, y: p.ysum / (p.area || 1), ylo: p.min[1], yhi: p.max[1] }));
  return mergeSlats(list);
}

/**
 * Slats of one seat (a park bench's three planks with gaps between): level patches under 6 cm apart become one. Only
 * patches big enough to matter take part (a few thousand at most).
 */
function mergeSlats(list: Patch[]): Patch[] {
  const big = list.filter((p) => p.area >= 0.005), small = list.filter((p) => p.area < 0.005);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < big.length && !merged; i++)
      for (let j = i + 1; j < big.length; j++) {
        const a = big[i], b = big[j];
        if (Math.abs(a.y - b.y) > 0.04 || boxGap(a, b) > 0.06 || boxGap(a, b) === 0) continue;
        const area = a.area + b.area;
        big[i] = { area, y: (a.y * a.area + b.y * b.area) / area, min: a.min.map((v, k) => Math.min(v, b.min[k])), max: a.max.map((v, k) => Math.max(v, b.max[k])), ylo: Math.min(a.ylo, b.ylo), yhi: Math.max(a.yhi, b.yhi) };
        big.splice(j, 1);
        merged = true;
        break;
      }
  }
  return [...big, ...small];
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/** Snap a yaw to the nearest quarter turn when it is within ~11° of it; in (-π, π]. */
function snapYaw(a: number) {
  const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
  let y = Math.abs(a - q) < 0.2 ? q : a;
  while (y <= -Math.PI) y += 2 * Math.PI;
  while (y > Math.PI) y -= 2 * Math.PI;
  return r4(y);
}

/**
 * Seats in a triangle soup (model frame, metres, +Y up): see the module comment. `groundY` is the model's bottom.
 * Sorted by height, then x, then z (row by row from the bottom).
 *
 * 1. Candidates: flat upward surfaces 0.2–1 m deep and at least 0.25 m long, mostly filled, above the ground.
 * 2. What is in front: the nearest lower surface beside the candidate across its row (within 1.2 m), else the ground.
 *    A seat is 0.25–1.2 m above it (a bleacher's 0.18 m footboard step is not a seat; the level above it is).
 * 3. Rows of the same shape as an accepted one join it even when nothing is in front (the front row of free-standing
 *    seating, a few centimetres off the model's bottom).
 * 4. A surface under part of a higher seat (a bleacher step under its plank) is its floor, not a seat; a seat point
 *    with a surface just above it (aisle stairs on a terrace step, a seat row on its step) is dropped.
 * 5. Facing: rows at several heights face down the slope (a stand); a single row faces its lower side, else away
 *    from its back.
 */
export function detectSeats(tris: Float32Array, groundY: number): ModelSeat[] {
  const patches = upwardPatches(tris);
  type Cand = Patch & { long: 0 | 2; short: 0 | 2; front: Patch | null; drop: number; ok: boolean };
  const cands: Cand[] = [];
  for (const p of patches) {
    const dx = p.max[0] - p.min[0], dz = p.max[2] - p.min[2];
    const long = dx >= dz ? 0 : 2, short = long === 0 ? 2 : 0;
    const L = Math.max(dx, dz), S = Math.min(dx, dz);
    if (p.yhi - p.ylo > 0.12 || !near(S, 0.2, 1.0) || L < 0.25 || p.area < 0.5 * dx * dz || p.y - groundY < 0.05) continue;
    cands.push({ ...p, long, short, front: null, drop: p.y - groundY, ok: false });
  }
  const mid = (p: { min: number[]; max: number[] }, k: number) => (p.min[k] + p.max[k]) / 2;
  for (const c of cands) {
    let bestGap = Infinity;
    for (const p of patches) {
      if (p === c || c.y - p.y < 0.05) continue;
      const g = boxGap(c, p);
      // Beside the seat across its row (not a support under it), overlapping it along the row.
      const along = Math.min(c.max[c.long], p.max[c.long]) - Math.max(c.min[c.long], p.min[c.long]);
      if (g > 1.2 || Math.abs(mid(p, c.short) - mid(c, c.short)) < 0.05 || along < Math.max(0.2, 0.5 * (c.max[c.long] - c.min[c.long]))) continue;
      // Equally near (a bench over its step, beside the level behind it): the one a seated person's feet reach (the
      // drop nearest 0.45 m).
      if (g < bestGap - 0.02 || (Math.abs(g - bestGap) <= 0.02 && c.front && Math.abs(c.y - p.y - 0.45) < Math.abs(c.y - c.front.y - 0.45))) {
        bestGap = g;
        c.front = p;
      }
    }
    c.drop = c.front ? c.y - c.front.y : c.y - groundY;
    c.ok = near(c.drop, 0.25, 1.2);
  }
  // Rows like an accepted one (same depth and length, same row direction) are seats too.
  const shape = (c: Cand) => `${c.long}|${Math.round((c.max[c.short] - c.min[c.short]) / 0.05)}|${Math.round((c.max[c.long] - c.min[c.long]) / 0.25)}`;
  const accepted = new Set(cands.filter((c) => c.ok).map(shape));
  for (const c of cands) if (!c.ok && !c.front && accepted.has(shape(c))) c.ok = true;
  // A seat point with a surface just above it (the aisle stairs on a terrace step, a seat row standing on the step)
  // is not a seat: what is above is.
  const flat = patches.filter((p) => p.area >= 0.5 * areaXZ(p));
  const covered = (pos: number[]) => flat.some((p) => near(p.y - pos[1], 0.05, 0.9) && near(pos[0], p.min[0], p.max[0]) && near(pos[2], p.min[2], p.max[2]));
  // A surface under part of a higher seat (a bleacher's step under its bench plank) is that seat's floor.
  const rows = cands.filter((c) => c.ok);
  const seatsOn = rows.filter((c) => !rows.some((o) => o !== c && near(o.y - c.y, 0.2, 0.9) && overlapXZ(o, c) > 0.1 * Math.min(areaXZ(o), areaXZ(c))));
  const seats: { pos: number[]; yaw: number | null; long: 0 | 2; short: 0 | 2 }[] = [];
  for (const c of seatsOn) {
    let yaw: number | null = null;
    const d = [0, 0, 0];
    if (c.front) {
      // Face the lower surface in front, across the row.
      d[c.short] = Math.sign(mid(c.front, c.short) - mid(c, c.short));
      yaw = Math.atan2(d[0], d[2]);
    } else {
      // On the ground: away from the back (geometry rising behind the seat), if there is one.
      let sum = 0, cnt = 0;
      for (let i = 0; i < tris.length; i += 3) {
        const y = tris[i + 1];
        if (y < c.y + 0.12 || y > c.y + 0.9) continue;
        const a = tris[i + c.long], s = tris[i + c.short];
        if (a < c.min[c.long] || a > c.max[c.long] || s < c.min[c.short] - 0.25 || s > c.max[c.short] + 0.25) continue;
        sum += s - mid(c, c.short);
        cnt++;
      }
      if (cnt && Math.abs(sum / cnt) > 0.02) {
        d[c.short] = -Math.sign(sum / cnt);
        yaw = Math.atan2(d[0], d[2]);
      }
    }
    // A bench or a row seats one person every SEAT_PITCH metres along it.
    const L = c.max[c.long] - c.min[c.long];
    const n = L > 0.8 ? Math.max(1, Math.round(L / SEAT_PITCH)) : 1;
    for (let i = 0; i < n; i++) {
      const pos = [mid(c, 0), c.y, mid(c, 2)];
      pos[c.long] = c.min[c.long] + ((i + 0.5) * L) / n;
      if (!covered(pos)) seats.push({ pos, yaw, long: c.long, short: c.short });
    }
  }
  if (!seats.length) return [];
  // A stand: rows along one axis at several heights face down the slope (where the rows are lower).
  for (const long of [0, 2] as const) {
    const g = seats.filter((x) => x.long === long);
    if (g.length < 2) continue;
    const ys = g.map((x) => x.pos[1]);
    if (Math.max(...ys) - Math.min(...ys) < 0.3) continue;
    const short = g[0].short;
    const my = ys.reduce((a, b) => a + b, 0) / g.length, ms = g.reduce((a, x) => a + x.pos[short], 0) / g.length;
    const cov = g.reduce((a, x) => a + (x.pos[1] - my) * (x.pos[short] - ms), 0);
    if (Math.abs(cov) < 1e-6) continue;
    const d = [0, 0, 0];
    d[short] = -Math.sign(cov);
    for (const x of g) x.yaw = Math.atan2(d[0], d[2]);
  }
  // Seats whose facing nothing told: the most common facing of the others, else +Z.
  const counts = new Map<number, number>();
  for (const s of seats) if (s.yaw !== null) counts.set(snapYaw(s.yaw), (counts.get(snapYaw(s.yaw)) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  return seats
    .map((s) => [r4(s.pos[0]), r4(s.pos[1]), r4(s.pos[2]), s.yaw === null ? common : snapYaw(s.yaw)] as ModelSeat)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
}

