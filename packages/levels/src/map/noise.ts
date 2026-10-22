// Moved from the old generator's packages/shared/src/map/noise.ts (ali3b/sloponator#17, #18).
/**
 * Seeded randomness for the map generators. Integer hashing only (Math.imul, shifts, floor), so a seed gives the
 * same map on every machine and engine.
 */

/** A 32-bit hash of a seed and up to three integers. */
export function hash32(seed: number, a = 0, b = 0, c = 0): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (const v of [a | 0, b | 0, c | 0]) {
    h = Math.imul(h ^ v, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** A hash as a number in [0, 1). */
export const hash01 = (seed: number, a = 0, b = 0, c = 0) => hash32(seed, a, b, c) / 4294967296;

/** A seeded generator of numbers in [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let s = hash32(seed, 0x5eed) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A whole-number seed from any number or string (strings hash, so "mission-3" works as a seed). A string ending in
 * "+<digits>" is the seed before it plus that number ("mission-3+31" = mapSeed("mission-3") + 31): the readable
 * form of the seeds a generation plan derives for its steps (seedStep).
 */
export function mapSeed(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v) | 0;
  const s = String(v ?? '');
  const step = s.match(/^(.+)\+(\d{1,9})$/s);
  if (step) return (mapSeed(step[1]) + Number(step[2])) | 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h | 0;
}

/**
 * The seed of a plan's step k from the plan's seed, as the caller wrote it: a number gives a number (seed + k), text
 * gives text ("mission2" → "mission2+31"), and both read back (mapSeed) as the same whole number.
 */
export function seedStep(seed: number | string, k: number): number | string {
  return typeof seed === 'number' ? mapSeed(seed) + k : `${seed}+${k}`;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1] at (x, y) with a lattice of 1 unit. */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = smooth(x - x0), ty = smooth(y - y0);
  const v00 = hash01(seed, x0, y0), v10 = hash01(seed, x0 + 1, y0), v01 = hash01(seed, x0, y0 + 1), v11 = hash01(seed, x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * tx, b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/**
 * Fractal value noise in [0, 1]: `octaves` layers, each twice the frequency and half the weight of the last.
 * `scale` is the size of the largest features in the units of x and y.
 */
export function fbm(seed: number, x: number, y: number, scale: number, octaves = 3): number {
  let sum = 0, amp = 1, total = 0, f = 1 / Math.max(1e-6, scale);
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * f + o * 17.31, y * f + o * 9.73);
    total += amp;
    amp /= 2;
    f *= 2;
  }
  return sum / total;
}

/** 1-D fractal noise in [-1, 1] (for jittering a path along its length). */
export function noise1(seed: number, t: number, scale: number, octaves = 2): number {
  return fbm(seed, t, 0.5, scale, octaves) * 2 - 1;
}
