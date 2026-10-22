// Moved from synty-sprite-generator packages/shared/src/export/footsteps.ts (P2, ali3b/sloponator#8).
/**
 * Automatic `footstep_l` / `footstep_r` clip events (SF-FB-006).
 *
 * A footstep is a foot coming down to the ground (within `tolerance` of its lowest height in the clip) after a
 * swing that carried it a real distance horizontally: `minTravel` metres (FOOTSTEP_MIN_TRAVEL) between lifting off and planting,
 * measured relative to the hips. Relative to the hips covers both kinds of locomotion: in place, the planted foot
 * slides back and swings forward under still hips; with root motion, the hips travel over the planted foot. A
 * stance that bounces on the spot (a boxing idle) lifts and replants its feet in the same place, so it gets none.
 *
 * Positions are in metres (Y up, the asset's scale fix applied), one per sample.
 */

import type { TrackPoint } from './groundSpeed.js';

export interface FootstepInput {
  /** Hips position per sample; without it the feet's own world positions are compared (in-place clips). */
  hips?: TrackPoint[] | null;
  /** Left and right foot positions per sample (null: that foot is not known). */
  left?: TrackPoint[] | null;
  right?: TrackPoint[] | null;
  /** Height above a foot's lowest that still counts as down (m). Default 0.02. */
  tolerance?: number;
  /** Horizontal distance a foot must swing between lifting off and planting to count as a step (m). Default FOOTSTEP_MIN_TRAVEL (0.18). */
  minTravel?: number;
}

export type FootstepEvent = { frame: number; name: 'footstep_l' | 'footstep_r' };

/** Default swing distance for a step: the Mixamo boxing idle shuffles up to ~0.15 m, its slow boxing walk swings 0.22 m+. */
export const FOOTSTEP_MIN_TRAVEL = 0.18;

const horiz = (a: TrackPoint, b: TrackPoint) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Footstep events for a looping clip sampled once per frame, sorted by frame. */
export function detectFootsteps(input: FootstepInput): FootstepEvent[] {
  const tol = input.tolerance ?? 0.02;
  const minTravel = input.minTravel ?? FOOTSTEP_MIN_TRAVEL;
  const out: FootstepEvent[] = [];
  ([['footstep_l', input.left], ['footstep_r', input.right]] as const).forEach(([name, track]) => {
    if (!track || track.length < 2) return;
    const n = track.length;
    const hips = input.hips && input.hips.length === n ? input.hips : null;
    const min = Math.min(...track.map((p) => p[1]));
    if (!Number.isFinite(min)) return;
    const down = track.map((p) => p[1] <= min + tol);
    if (down.every(Boolean)) return;
    const rel = track.map((p, i): TrackPoint => (hips ? [p[0] - hips[i][0], 0, p[2] - hips[i][2]] : [p[0], 0, p[2]]));
    for (let i = 0; i < n; i++) {
      if (!down[i] || down[(i - 1 + n) % n]) continue;
      // Walk back (round the loop) to where the foot was last down: the swing that ends here started there.
      let j = (i - 1 + n) % n;
      for (let s = 0; s < n && !down[j]; s++) j = (j - 1 + n) % n;
      if (horiz(rel[i], rel[j]) >= minTravel) out.push({ frame: i, name });
    }
  });
  return out.sort((a, b) => a.frame - b.frame);
}
