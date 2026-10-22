import * as THREE from 'three';
import { transitionOpacity, transitionPoseWeight } from '../../shared/debris';
import { opacityTracks } from './helpers';

/** The uuids of the meshes under `root` that belong to the model (not to a particle stage). */
function modelMeshIds(root: THREE.Object3D) {
  const ids = new Set<string>();
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh && !(o as THREE.Sprite).isSprite) return;
    for (let x: THREE.Object3D | null = o.parent; x && x !== root; x = x.parent) if (x.name.startsWith('ssg_stage')) return;
    ids.add(o.uuid);
  });
  return ids;
}

/**
 * When the destination is a procedural look of the same model (a scorched copy, applyLook: sunk, squashed and tilted
 * about its foot), the source's root motion is carried to the destination's pose (FB-043): from its own pose the
 * template's motion blends into the destination's position, rotation and scale (transitionPoseWeight), reaching it
 * exactly when the source starts fading out on top of it. Before, the collapse sank 10 % and the scorched still
 * (sunk 6 %) faded in taller, so the object popped up at the end.
 */
function poseTracks(clip: THREE.AnimationClip, from: THREE.Object3D, to: THREE.Object3D, keys = 60) {
  const d = clip.duration;
  const find = (k: string) => clip.tracks.find((t) => t.name === `${from.uuid}.${k}`);
  const sample = (k: 'position' | 'quaternion' | 'scale', rest: number[]) => {
    const t = find(k);
    if (!t) return () => rest;
    const it = t.createInterpolant();
    return (time: number) => Array.from(it.evaluate(time) as ArrayLike<number>);
  };
  const pos = sample('position', from.position.toArray());
  const quat = sample('quaternion', from.quaternion.toArray());
  const scl = sample('scale', from.scale.toArray());
  const times: number[] = [], P: number[] = [], Q: number[] = [], S: number[] = [];
  const q = new THREE.Quaternion();
  for (let i = 0; i <= keys; i++) {
    const t = (i / keys) * d;
    const w = transitionPoseWeight(t / d);
    times.push(t);
    P.push(...new THREE.Vector3().fromArray(pos(t)).lerp(to.position, w).toArray());
    Q.push(...q.fromArray(quat(t)).normalize().slerp(to.quaternion, w).toArray());
    S.push(...new THREE.Vector3().fromArray(scl(t)).lerp(to.scale, w).toArray());
  }
  // The last key exactly the destination's (no rounding through slerp/lerp).
  P.splice(-3, 3, ...to.position.toArray());
  Q.splice(-4, 4, ...to.quaternion.toArray());
  S.splice(-3, 3, ...to.scale.toArray());
  return [
    new THREE.VectorKeyframeTrack(`${from.uuid}.position`, times, P),
    new THREE.QuaternionKeyframeTrack(`${from.uuid}.quaternion`, times, Q),
    new THREE.VectorKeyframeTrack(`${from.uuid}.scale`, times, S),
  ];
}

/**
 * Make a state transition end on its destination state (FB-027): the source model (`from`, the one the template
 * animated) and the destination state's model (`to`, at rest) crossfade over the last part of the clip
 * (transitionOpacity: the destination fades in under the opaque source, then the source fades out over the opaque
 * destination, FB-043), so the last frame is the destination's still. The template's own opacity tracks on the
 * source model are replaced; its motion, debris and particles are kept (its root motion ends on a procedural
 * destination's pose: poseTracks). The renderer must show both models
 * while the clip plays (SpriteRenderer.setClipModel(clip, from, to)).
 */
export function endOnState(clip: THREE.AnimationClip, from: THREE.Object3D, to: THREE.Object3D): THREE.AnimationClip {
  if (from === to) return clip;
  const d = clip.duration;
  const own = modelMeshIds(from);
  const retarget = !!to.userData.ssgLook && !from.userData.ssgLook && to.parent === from.parent;
  const rootMotion = new Set(['position', 'quaternion', 'scale'].map((k) => `${from.uuid}.${k}`));
  const kept = clip.tracks.filter((t) => {
    if (retarget && rootMotion.has(t.name)) return false;
    const m = /^([^.]+)\.material(\[\d+\])?\.opacity$/.exec(t.name);
    return !(m && own.has(m[1]));
  });
  const C = clip.constructor as typeof THREE.AnimationClip;
  return new C(clip.name, d, [
    ...kept,
    ...(retarget ? poseTracks(clip, from, to) : []),
    ...opacityTracks(from, d, (t) => transitionOpacity(t / d).from, 30),
    ...opacityTracks(to, d, (t) => transitionOpacity(t / d).to, 30),
  ]);
}
