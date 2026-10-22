import * as THREE from 'three';
import { nodeByName } from './templates/helpers';

/**
 * SF-FB-023: lock a clip's root yaw. A clip like Mixamo's "Quick Left Handed Punch" turns the whole body about 120°
 * about the vertical axis, so in a side view it punches away from the camera. The lock takes that turn out of the
 * hips (the root of the body's bone chain) only: at every key the hips' rotation in model space is split into a twist
 * about the up axis (yaw) and a swing (pitch/roll, the lean), and the twist is held at the clip's first key. The
 * spine, arms and legs are left as authored, so the upper body's twist against the hips (the shoulder turn that
 * drives a punch) is kept; only the body as a whole stops turning. The hips' position track is not touched.
 */

/** The hips bone a clip's yaw lives on: the rig map's, else a bone named hips/pelvis. */
export function findHips(root: THREE.Object3D, rigMap?: Record<string, string>): THREE.Object3D | null {
  const mapped = rigMap?.hips ? nodeByName(root, rigMap.hips) : null;
  if (mapped) return mapped;
  let hips: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hips && /^(mixamorig[:_]?)?(hips?|pelvis)$/i.test(o.name)) hips = o;
  });
  return hips;
}

/**
 * The twist of `q` about the unit `axis` (swing-twist decomposition): the rotation about the axis alone, so that
 * q = twist × swing = swing' × twist with the swings about axes perpendicular to it. Null when the twist is
 * undefined (a half-turn swing, nothing of q left about the axis).
 */
export function twistAbout(q: THREE.Quaternion, axis: THREE.Vector3): THREE.Quaternion | null {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const t = new THREE.Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w);
  if (t.length() < 1e-6) return null;
  return t.normalize();
}

/** The signed angle (radians) of a rotation about `axis` (of its twist about it). */
export function yawAngle(q: THREE.Quaternion, axis: THREE.Vector3 = new THREE.Vector3(0, 1, 0)): number {
  const t = twistAbout(q, axis);
  if (!t) return 0;
  const s = t.x * axis.x + t.y * axis.y + t.z * axis.z;
  return 2 * Math.atan2(s, t.w);
}

/** `world` with its twist about `axis` replaced by `ref` (a rotation about the same axis): the yaw locked. */
export function lockTwist(world: THREE.Quaternion, ref: THREE.Quaternion, axis: THREE.Vector3): THREE.Quaternion {
  const t = twistAbout(world, axis);
  if (!t) return world.clone();
  // world = t × swing, so ref × t⁻¹ × world = ref × swing.
  return ref.clone().multiply(t.invert()).multiply(world).normalize();
}

type Evaluator = THREE.Interpolant & { evaluate(t: number): ArrayLike<number> };

/**
 * The clip with its hips' yaw held at the first key (see the top of this file). `root` is the model the clip plays
 * on (its own transform is not counted: yaw is about the model's up axis, +Y). A clip without a hips rotation track
 * comes back unchanged.
 */
export function lockClipYaw(clip: THREE.AnimationClip, root: THREE.Object3D, rigMap?: Record<string, string>): THREE.AnimationClip {
  const hips = findHips(root, rigMap);
  if (!hips) return clip;
  const parsed = clip.tracks.map((t) => THREE.PropertyBinding.parseTrackName(t.name));
  const trackOf = (o: THREE.Object3D, prop: string) => {
    const i = parsed.findIndex((p) => p.propertyName === prop && (p.nodeName === o.name || p.nodeName === o.uuid));
    return i < 0 ? null : i;
  };
  const hi = trackOf(hips, 'quaternion');
  if (hi === null) return clip;
  // The hips' ancestors below the model root, top first, each with its rotation track if the clip animates it.
  const chain: { node: THREE.Object3D; ev: Evaluator | null }[] = [];
  for (let p = hips.parent; p && p !== root; p = p.parent) {
    const i = trackOf(p, 'quaternion');
    chain.unshift({ node: p, ev: i === null ? null : (clip.tracks[i].createInterpolant() as Evaluator) });
  }
  const up = new THREE.Vector3(0, 1, 0);
  const track = clip.tracks[hi];
  const times = track.times as ArrayLike<number>;
  const src = track.values as ArrayLike<number>;
  const values = new Float32Array(src.length);
  const parent = new THREE.Quaternion(), q = new THREE.Quaternion(), k = new THREE.Quaternion(), prev = new THREE.Quaternion();
  let ref: THREE.Quaternion | null = null;
  for (let i = 0; i < times.length; i++) {
    parent.identity();
    for (const c of chain) parent.multiply(c.ev ? k.fromArray(c.ev.evaluate(times[i]) as number[]) : c.node.quaternion);
    q.set(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3]);
    const world = parent.clone().multiply(q);
    ref ??= twistAbout(world, up) ?? new THREE.Quaternion();
    const local = parent.clone().invert().multiply(lockTwist(world, ref, up)).normalize();
    // Keep neighbouring keys on the same side of the double cover, so the interpolation never takes the long way.
    if (i > 0 && local.dot(prev) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
    prev.copy(local);
    local.toArray(values, i * 4);
  }
  const tracks = clip.tracks.slice();
  tracks[hi] = new THREE.QuaternionKeyframeTrack(track.name, Array.from(times), Array.from(values), track.getInterpolation());
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
