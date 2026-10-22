import * as THREE from 'three';
import type { ClipEdit } from '@slop/sprites';
import { lockClipYaw } from './lockYaw';

/** The model a clip plays on, for edits that need its skeleton (lockYaw: the hips and the bones above them). */
export interface ClipRig {
  root: THREE.Object3D;
  rigMap?: Record<string, string>;
}

/**
 * Apply a clip edit (trim window in source seconds, playback speed, reverse) to a baked clip. Keys are resampled at
 * the window edges so the first and last poses are exact; the result starts at 0. A reversed clip (SF-FB-017) plays
 * the window from its end back to its start. A yaw lock (SF-FB-023, lockYaw.ts) holds the hips' turn about the vertical
 * at the source clip's first key, before the trim; it needs the model (`rig`) and is skipped without one.
 */
export function applyClipEdit(clip: THREE.AnimationClip, edit: ClipEdit | null | undefined, rig?: ClipRig | null): THREE.AnimationClip {
  if (!edit) return clip;
  if (edit.lockYaw && rig) clip = lockClipYaw(clip, rig.root, rig.rigMap);
  const start = Math.max(0, edit.start ?? 0);
  const end = Math.min(clip.duration, edit.end ?? clip.duration);
  const speed = edit.speed && edit.speed > 0 ? edit.speed : 1;
  const reverse = edit.reverse === true;
  if (start <= 0 && end >= clip.duration && speed === 1 && !reverse) return clip;
  if (end <= start) return clip;
  const tracks = clip.tracks.map((track) => {
    const size = track.getValueSize();
    const interp = track.createInterpolant() as THREE.Interpolant & { evaluate(t: number): ArrayLike<number> };
    const times: number[] = [];
    const values: number[] = [];
    const push = (t: number) => {
      times.push((reverse ? end - t : t - start) / speed);
      const v = interp.evaluate(t);
      for (let i = 0; i < size; i++) values.push(v[i]);
    };
    const src = [start, ...Array.from(track.times as ArrayLike<number>).filter((t) => t > start + 1e-6 && t < end - 1e-6), end];
    for (const t of reverse ? src.reverse() : src) push(t);
    const Ctor = track.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new Ctor(track.name, times, values);
  });
  return new THREE.AnimationClip(clip.name, (end - start) / speed, tracks);
}
