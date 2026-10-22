// Moved from synty-sprite-generator packages/shared/src/map/noise.ts (P3, ali3b/sloponator#14): only what the
// terrain and skydome builders use (the seeded generator); the map generators' seeds stay with the levels package.
/**
 * Seeded randomness. Integer hashing only (Math.imul, shifts, floor), so a seed gives the same scatter on every
 * machine and engine.
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
