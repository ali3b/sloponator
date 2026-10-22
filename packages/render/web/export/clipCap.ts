import * as THREE from 'three';
import type { ExportClip } from './render';

/** Candidate cut points are this far apart (seconds). */
const STEP = 1 / 30;

/** How far the pose at `t` is from the pose at 0: summed over the clip's rotation tracks (0 = the same pose). */
function poseDistance(clip: THREE.AnimationClip, t: number) {
  let d = 0;
  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    const it = track.createInterpolant();
    const a = Array.from(it.evaluate(0) as ArrayLike<number>);
    const b = Array.from(it.evaluate(t) as ArrayLike<number>);
    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    d += 1 - Math.min(1, dot);
  }
  return d;
}

/** A capped loop may play this much faster or slower so its loop point lands on the cap (SF-FB-021). */
const MAX_RETIME = 1.25;

/**
 * Where to cut a clip so it plays for `maxSeconds`. A loop is cut where the pose comes back closest to the first
 * frame, between cap / 1.25 and cap × 1.25 (and not past the clip's end), slightly preferring cuts near the cap;
 * capClip then retimes that stretch to exactly the cap, so the loop has round(cap × fps) frames and still joins up
 * (SF-FB-021: cutting short in the second half gave 12–20 frames for a 2 s cap at 12 fps). A one-shot is cut at
 * the cap. Clips already short enough keep their length.
 */
export function cutTime(clip: THREE.AnimationClip, maxSeconds: number, loop: boolean) {
  if (clip.duration <= maxSeconds) return clip.duration;
  if (!loop) return maxSeconds;
  const lo = maxSeconds / MAX_RETIME, hi = Math.min(clip.duration, maxSeconds * MAX_RETIME);
  const candidates = [hi];
  for (let t = Math.floor(hi / STEP) * STEP; t >= lo - 1e-9; t -= STEP) if (t < hi - 1e-9) candidates.push(t);
  let best = maxSeconds, bestScore = Infinity;
  for (const t of candidates) {
    // A pose match wins; among equally good cuts the one nearest the cap (the least retimed) does.
    const score = poseDistance(clip, t) + 1e-3 * Math.abs(Math.log(t / maxSeconds));
    if (score < bestScore - 1e-6) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** A capped loop whose cut still differs from the first frame by more than this is blended into it. */
const JOIN_TOLERANCE = 1e-3;

/**
 * Blend the last `seconds` of a (copied) clip's tracks into its first-frame pose, so the frame after the last is the
 * first again: a loop cut where no pose quite comes back still joins up instead of popping. Tracks get keys every
 * STEP over the tail; quaternions slerp, other numeric tracks lerp, with a smoothstep weight.
 */
export function blendTailToStart(clip: THREE.AnimationClip, seconds: number) {
  const d = clip.duration, from = Math.max(0, d - seconds);
  clip.tracks = clip.tracks.map((track) => {
    const quat = track instanceof THREE.QuaternionKeyframeTrack;
    if (!quat && !(track instanceof THREE.VectorKeyframeTrack) && !(track instanceof THREE.NumberKeyframeTrack)) return track;
    const size = track.getValueSize(), it = track.createInterpolant();
    const sample = (t: number) => Array.from(it.evaluate(t) as ArrayLike<number>);
    const start = sample(0);
    const times: number[] = [], values: number[] = [];
    for (let i = 0; i < track.times.length && track.times[i] < from - 1e-9; i++) {
      times.push(track.times[i]);
      values.push(...Array.from(track.values.subarray(i * size, (i + 1) * size)));
    }
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    const n = Math.max(1, Math.ceil((d - from) / STEP));
    for (let j = 0; j <= n; j++) {
      const t = from + ((d - from) * j) / n, x = j / n, w = x * x * (3 - 2 * x);
      const v = sample(t);
      if (quat) values.push(...qa.fromArray(v).slerp(qb.fromArray(start), w).toArray());
      else values.push(...v.map((a, k) => a + (start[k] - a) * w));
      times.push(t);
    }
    const Track = track.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new Track(track.name, times, values);
  });
  return clip;
}

/**
 * The clip capped at `maxSeconds` (FB-011: an 8.6 s idle at 10 fps is 86 frames). The shared clip is left as it
 * is: a copy is cut (cutTime) and, for a loop, retimed so it lasts exactly `maxSeconds`; events past the cut go
 * and the rest move with the retime.
 */
export function capClip(c: ExportClip, maxSeconds: number | undefined): ExportClip {
  if (!maxSeconds || !c.clip || c.clip.duration <= maxSeconds) return c;
  const t = cutTime(c.clip, maxSeconds, c.loop);
  const clip = c.clip.clone();
  const k = c.loop ? maxSeconds / t : 1;
  if (k !== 1) for (const track of clip.tracks) track.scale(k);
  clip.duration = t * k;
  // No pose near the cap comes back to the first frame: the last quarter (at most half a second) blends into it.
  if (c.loop && poseDistance(clip, clip.duration) > JOIN_TOLERANCE) blendTailToStart(clip, Math.min(0.5, clip.duration / 4));
  return { ...c, clip, ...(c.events ? { events: c.events.filter((e) => e.t < t).map((e) => (k === 1 ? e : { ...e, t: e.t * k })) } : {}) };
}
