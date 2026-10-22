// Moved from synty-sprite-generator packages/shared/src/export/groundSpeed.ts (P2, ali3b/sloponator#8).
/**
 * Ground speed of a locomotion clip (m/s), written to exports as `clips[].speedMps` so a game can play a walk/run
 * cycle at `speed / speedMps` without the feet sliding.
 *
 * Measured on the posed skeleton in the model's real size (metres, Y up; the asset's scale fix already applied):
 *   - root motion: the hips' net horizontal travel over the cycle, divided by its time;
 *   - in place: while a foot (or any contact point) is planted, it moves backwards relative to the hips at exactly
 *     the ground speed. So: find each contact point's planted samples (within `tolerance` of its lowest height, and
 *     that lowest height near the floor) and take the median of its horizontal speed relative to the hips there.
 * Points planted the whole clip (dragged feet, a static pose) say nothing and are skipped. The fastest contact
 * point wins, so dragging limbs in a crawl don't pull the speed down.
 */

export type TrackPoint = readonly [number, number, number];

export interface GroundSpeedInput {
  /** Sample times (seconds), ascending. */
  times: number[];
  /** Clip length (seconds): a loop's last sample wraps to its first after this. */
  duration: number;
  loop: boolean;
  /** Hips position per sample (metres, Y up). */
  hips: TrackPoint[];
  /** Contact points per sample: feet, optionally hands (crawls). Each track has one position per sample. */
  contacts: TrackPoint[][];
  /** Height above a point's lowest that still counts as planted (m). Default 0.03. */
  tolerance?: number;
}

/** Hips travel faster than this (m/s) means the clip carries root motion. */
const ROOT_MOTION_MIN = 0.25;
/** A contact point whose lowest height is this far above the floor never touches it (hands in a walk). */
const FLOOR_BAND = 0.15;

const horiz = (a: TrackPoint, b: TrackPoint) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Ground speed in m/s, or null when the clip shows no travel to measure. */
export function estimateGroundSpeed(input: GroundSpeedInput): number | null {
  const { times, duration, loop, hips, contacts } = input;
  const n = times.length;
  if (n < 4 || hips.length !== n) return null;
  const tol = input.tolerance ?? 0.03;

  // Root motion: the hips really travel.
  const span = times[n - 1] - times[0];
  if (span > 0) {
    const net = horiz(hips[n - 1], hips[0]) / span;
    if (net >= ROOT_MOTION_MIN) return net;
  }

  const tracks = contacts.filter((c) => c.length === n);
  if (!tracks.length) return null;
  const floor = Math.min(...tracks.flatMap((c) => c.map((p) => p[1])));
  const dtOf = (a: number, b: number) => (b >= a ? times[b] - times[a] : times[b] + duration - times[a]);
  let best: number | null = null;
  for (const c of tracks) {
    const min = Math.min(...c.map((p) => p[1]));
    if (min > floor + FLOOR_BAND) continue;
    const down = c.map((p) => p[1] <= min + tol);
    if (down.every(Boolean)) continue;
    // Planted steps: consecutive samples both on the ground (wrapping round for loops). The few swing samples
    // that still skim the ground at a stance's edges move forwards fast; the median leaves them out.
    const speeds: number[] = [];
    let dt = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : loop ? 0 : -1;
      if (j < 0 || !down[i] || !down[j]) continue;
      const t = dtOf(i, j);
      if (t <= 0) continue;
      // Relative to the hips: with root motion the foot stands still and the hips move; in place it is the reverse.
      const ri: TrackPoint = [c[i][0] - hips[i][0], 0, c[i][2] - hips[i][2]];
      const rj: TrackPoint = [c[j][0] - hips[j][0], 0, c[j][2] - hips[j][2]];
      speeds.push(horiz(ri, rj) / t);
      dt += t;
    }
    if (speeds.length < 2 || dt < 0.04) continue;
    speeds.sort((x, y) => x - y);
    const m = speeds.length >> 1;
    const v = speeds.length % 2 ? speeds[m] : (speeds[m - 1] + speeds[m]) / 2;
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Words that make a looping clip a locomotion cycle (walk, run, crawl, strafe, sprint…). */
const LOCOMOTION = /walk|run|jog|sprint|strafe|crawl|sneak|shuffle|march|swim/i;
/** Clips that may mention a travel word but stand, fall or turn ("walk_to_idle", "run_death", "turn_walk"). */
const NOT_LOCOMOTION = /idle|turn|death|dying|reload/i;

/** True for looping travel cycles ("rifle_walk_shoot" too); idles, shots, deaths, reloads and one-shots are not. */
export function isLocomotionClip(name: string, loop: boolean) {
  return loop && LOCOMOTION.test(name) && !NOT_LOCOMOTION.test(name);
}

/** Believable on-foot speeds: anything outside is a measuring artefact, not a speed. */
export const SPEED_RANGE = { min: 0.1, max: 12 } as const;

/**
 * The `speedMps` an export writes for a clip, or undefined to leave it out.
 *   declared  a procedural template's own speed (authoritative)
 *   measured  estimateGroundSpeed on the posed skeleton
 * Non-locomotion clips never get one, and nothing outside SPEED_RANGE is written. (The bake's own hips-travel
 * figure is not used: it is in the source rig's units and reads ~0 for in-place clips, 25–100 m/s for falls.)
 */
export function resolveClipSpeed(c: { name: string; loop: boolean; declared?: number | null; measured?: number | null }) {
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= SPEED_RANGE.min && v <= SPEED_RANGE.max;
  const round = (v: number) => Math.round(v * 100) / 100;
  if (ok(c.declared)) return round(c.declared);
  if (!isLocomotionClip(c.name, c.loop)) return undefined;
  if (ok(c.measured)) return round(c.measured);
  return undefined;
}
