import * as THREE from 'three';
import type { PartMeta, PartRole } from './types';

/**
 * Template helpers. Everything is expressed in the ASSET frame (glTF: +Y up, +Z forward, +X = the asset's
 * left), measured relative to the asset root so the renderer's direction yaw never leaks in. Tracks
 * address nodes by uuid, so duplicate part names can't collide.
 */

export const X = new THREE.Vector3(1, 0, 0);
export const Y = new THREE.Vector3(0, 1, 0);
export const Z = new THREE.Vector3(0, 0, 1);

/** Find the scene nodes for parts with any of the roles (GLTFLoader keeps Blender object names). */
export function nodesWithRole(root: THREE.Object3D, parts: PartMeta[] | undefined, ...roles: PartRole[]) {
  const names = new Set((parts ?? []).filter((p) => p.role && roles.includes(p.role)).map((p) => THREE.PropertyBinding.sanitizeNodeName(p.name)));
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (names.has(o.name)) out.push(o);
  });
  return out;
}

export function nodeByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const n = THREE.PropertyBinding.sanitizeNodeName(name);
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name === n) found = o;
  });
  return found;
}

/** Rest transform of a node relative to the asset root. */
export function assetSpace(node: THREE.Object3D, root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  return new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(node.matrixWorld);
}

/** Bounding box of a node's geometry (including children) in the asset frame. */
export function assetBox(node: THREE.Object3D, root: THREE.Object3D) {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const skip = (o: THREE.Object3D) => {
    // Particle stages of other clips (and sprites, whose geometry is a unit quad) are not the model.
    for (let x: THREE.Object3D | null = o; x && x !== node.parent; x = x.parent) if (x !== node && x.name.startsWith('ssg_stage')) return true;
    return (o as THREE.Sprite).isSprite === true;
  };
  node.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (!g || skip(o)) return;
    g.computeBoundingBox();
    box.union(g.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
  });
  return box;
}

/** Centre of a node's geometry in the asset frame (falls back to its origin). */
export function assetCentre(node: THREE.Object3D, root: THREE.Object3D) {
  const b = assetBox(node, root);
  return b.isEmpty() ? assetPivot(node, root) : b.getCenter(new THREE.Vector3());
}

/** Node origin in the asset frame. */
export function assetPivot(node: THREE.Object3D, root: THREE.Object3D) {
  return new THREE.Vector3().setFromMatrixPosition(assetSpace(node, root));
}

/**
 * Keyframe a node so it is rotated by rot(t) (a rotation in the ASSET frame) about the asset-frame point
 * `centre` (default: the node's own origin), plus an optional asset-frame translation. Works whatever the
 * part's pivot and axes are (tank road wheels pivot at the vehicle origin; doors at their hinge; bones in cm).
 */
export function transformTracks(
  node: THREE.Object3D,
  root: THREE.Object3D,
  duration: number,
  rot: (t: number) => THREE.Quaternion,
  opts: { centre?: THREE.Vector3; offset?: (t: number) => THREE.Vector3; keys?: number; parentAt?: (t: number) => THREE.Matrix4 } = {},
) {
  const keys = opts.keys ?? 48;
  const restPos = new THREE.Vector3();
  const restQ = new THREE.Quaternion();
  const restS = new THREE.Vector3();
  assetSpace(node, root).decompose(restPos, restQ, restS);
  if (opts.parentAt) {
    // The parent moves too (a barrel under a thrown turret): express the asset-frame pose in the parent's pose at
    // each key, so the node ends up exactly where rot/offset put it instead of riding along with its parent.
    const pose = assetPoseAt(node, root, rot, opts);
    const times: number[] = [], quats: number[] = [], positions: number[] = [];
    const lp = new THREE.Vector3(), lq = new THREE.Quaternion(), ls = new THREE.Vector3();
    for (let i = 0; i <= keys; i++) {
      const t = (i / keys) * duration;
      opts.parentAt(t).clone().invert().multiply(pose(t)).decompose(lp, lq, ls);
      times.push(t);
      quats.push(lq.x, lq.y, lq.z, lq.w);
      positions.push(lp.x, lp.y, lp.z);
    }
    return [
      new THREE.QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, quats),
      new THREE.VectorKeyframeTrack(`${node.uuid}.position`, times, positions),
    ];
  }
  const centre = opts.centre ?? restPos;
  const parentM = node.parent && node.parent !== root ? assetSpace(node.parent, root) : new THREE.Matrix4();
  const parentInv = parentM.clone().invert();
  const parentQInv = new THREE.Quaternion();
  parentM.decompose(new THREE.Vector3(), parentQInv, new THREE.Vector3());
  parentQInv.invert();

  const times: number[] = [];
  const quats: number[] = [];
  const positions: number[] = [];
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  for (let i = 0; i <= keys; i++) {
    const t = (i / keys) * duration;
    const r = rot(t);
    q.copy(r).multiply(restQ);
    p.copy(restPos).sub(centre).applyQuaternion(r).add(centre);
    if (opts.offset) p.add(opts.offset(t));
    const lq = parentQInv.clone().multiply(q).normalize();
    const lp = p.clone().applyMatrix4(parentInv);
    times.push(t);
    quats.push(lq.x, lq.y, lq.z, lq.w);
    positions.push(lp.x, lp.y, lp.z);
  }
  return [
    new THREE.QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, quats),
    new THREE.VectorKeyframeTrack(`${node.uuid}.position`, times, positions),
  ];
}

/**
 * The asset-frame pose (a matrix) transformTracks gives `node` at time t: rotated by rot(t) about `centre`, plus
 * the offset. Children of an animated part use it as their `parentAt`.
 */
export function assetPoseAt(
  node: THREE.Object3D,
  root: THREE.Object3D,
  rot: (t: number) => THREE.Quaternion,
  opts: { centre?: THREE.Vector3; offset?: (t: number) => THREE.Vector3 } = {},
) {
  const restPos = new THREE.Vector3(), restQ = new THREE.Quaternion(), restS = new THREE.Vector3();
  assetSpace(node, root).decompose(restPos, restQ, restS);
  const centre = (opts.centre ?? restPos).clone();
  return (t: number) => {
    const r = rot(t);
    const p = restPos.clone().sub(centre).applyQuaternion(r).add(centre);
    if (opts.offset) p.add(opts.offset(t));
    return new THREE.Matrix4().compose(p, r.clone().multiply(restQ), restS);
  };
}

export const about = (axis: THREE.Vector3, angle: number) => new THREE.Quaternion().setFromAxisAngle(axis, angle);
export const deg = (d: number) => (d * Math.PI) / 180;
export const none = () => new THREE.Quaternion();

/** The axis a round part (wheel, propeller) spins about: its thinnest extent, in the asset frame. */
export function thinAxis(node: THREE.Object3D, root: THREE.Object3D) {
  const s = assetBox(node, root).getSize(new THREE.Vector3());
  return s.x <= s.y && s.x <= s.z ? X : s.y <= s.z ? Y : Z;
}

/** Longest extent axis (barrels recoil along it). */
export function longAxis(node: THREE.Object3D, root: THREE.Object3D) {
  const s = assetBox(node, root).getSize(new THREE.Vector3());
  return s.x >= s.y && s.x >= s.z ? X : s.y >= s.z ? Y : Z;
}

/** Smooth 0→1→0 over u in [0,1]. */
export const pulse = (u: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
/** Ease-out 0→1. */
export const easeOut = (u: number) => 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;

/** Deterministic pseudo-random in [0,1) from a string. */
export function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Whole-asset transform tracks on the glTF scene root (object templates). */
export function rootTracks(
  root: THREE.Object3D,
  duration: number,
  f: (t: number) => { pos?: THREE.Vector3; rot?: THREE.Quaternion; scale?: THREE.Vector3 | number },
  keys = 48,
) {
  const times: number[] = [];
  const pos: number[] = [];
  const quat: number[] = [];
  const scl: number[] = [];
  for (let i = 0; i <= keys; i++) {
    const t = (i / keys) * duration;
    const v = f(t);
    const p = (v.pos ?? new THREE.Vector3()).clone().add(root.position);
    const q = (v.rot ?? new THREE.Quaternion()).clone().multiply(root.quaternion);
    const s = typeof v.scale === 'number' ? new THREE.Vector3(v.scale, v.scale, v.scale) : (v.scale ?? new THREE.Vector3(1, 1, 1));
    times.push(t);
    pos.push(p.x, p.y, p.z);
    quat.push(q.x, q.y, q.z, q.w);
    scl.push(root.scale.x * s.x, root.scale.y * s.y, root.scale.z * s.z);
  }
  return [
    new THREE.VectorKeyframeTrack(`${root.uuid}.position`, times, pos),
    new THREE.QuaternionKeyframeTrack(`${root.uuid}.quaternion`, times, quat),
    new THREE.VectorKeyframeTrack(`${root.uuid}.scale`, times, scl),
  ];
}

/** Opacity tracks for every mesh and sprite (materials made transparent, no depth writes; multi-material meshes too). */
export function opacityTracks(root: THREE.Object3D, duration: number, f: (t: number) => number, keys = 24) {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = Array.from({ length: keys + 1 }, (_, i) => (i / keys) * duration);
  const values = times.map(f);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Sprite).isSprite) return;
    // Particle stages animate their own opacity.
    for (let x: THREE.Object3D | null = o.parent; x && x !== root; x = x.parent) if (x.name.startsWith('ssg_stage')) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat, i) => {
      // The renderer turns a faded material back to its own settings whenever it is fully opaque (syncFades), so
      // stills of the same model (and the end of a crossfade) render exactly as without the fade.
      mat.userData.ssgOpaque ??= { transparent: mat.transparent, depthWrite: mat.depthWrite };
      (mat as THREE.Material).transparent = true;
      (mat as THREE.Material).depthWrite = false;
      tracks.push(new THREE.NumberKeyframeTrack(Array.isArray(m.material) ? `${m.uuid}.material[${i}].opacity` : `${m.uuid}.material.opacity`, times, values));
    });
  });
  return tracks;
}

// ---- easing, randomness, colour ramps and per-instance tracks (particle templates) ----------------------
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
export const ease = {
  linear: (u: number) => clamp01(u),
  inQuad: (u: number) => clamp01(u) ** 2,
  outQuad: (u: number) => 1 - (1 - clamp01(u)) ** 2,
  inOutQuad: (u: number) => ((u = clamp01(u)) < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2),
  inCubic: (u: number) => clamp01(u) ** 3,
  outCubic: (u: number) => 1 - (1 - clamp01(u)) ** 3,
  inOutCubic: (u: number) => ((u = clamp01(u)) < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  outExpo: (u: number) => ((u = clamp01(u)) >= 1 ? 1 : 1 - 2 ** (-10 * u)),
  /** Overshoots then settles (pop). */
  outBack: (s = 1.70158) => (u: number) => {
    u = clamp01(u) - 1;
    return 1 + (s + 1) * u ** 3 + s * u ** 2;
  },
  outBounce: (u: number) => {
    u = clamp01(u);
    const n = 7.5625, d = 2.75;
    if (u < 1 / d) return n * u * u;
    if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
    if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
    return n * (u -= 2.625 / d) * u + 0.984375;
  },
};

/** Seeded random stream (mulberry32): the same seed always gives the same particles. */
export function rng(seed: string) {
  let a = Math.floor(rand(seed) * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Colour over a 0..1 lifetime from (position, css colour) stops, interpolated in linear light. */
export function colorRamp(stops: [number, string][]) {
  const cs = stops.map(([p, c]) => [p, new THREE.Color(c)] as const);
  return (u: number) => {
    u = clamp01(u);
    for (let i = 1; i < cs.length; i++) {
      if (u <= cs[i][0]) {
        const [p0, c0] = cs[i - 1], [p1, c1] = cs[i];
        return c0.clone().lerp(c1, (u - p0) / Math.max(1e-6, p1 - p0));
      }
    }
    return cs[cs.length - 1][1].clone();
  };
}

export interface InstanceState {
  pos?: THREE.Vector3;
  rot?: THREE.Quaternion;
  scale?: number | THREE.Vector3;
  opacity?: number;
  /** Colour of sprites/basic materials, or the emissive colour of FX meshes. */
  color?: THREE.Color;
}

/** Transform, opacity and colour tracks for one particle instance (an object and its materials). */
export function instanceTracks(obj: THREE.Object3D, duration: number, f: (t: number) => InstanceState, keys = 36) {
  const times: number[] = [], pos: number[] = [], quat: number[] = [], scl: number[] = [], op: number[] = [], col: number[] = [];
  let hasOp = false, hasCol = false, hasRot = false;
  for (let i = 0; i <= keys; i++) {
    const t = (i / keys) * duration;
    const v = f(t);
    times.push(t);
    const p = v.pos ?? new THREE.Vector3();
    pos.push(p.x, p.y, p.z);
    const q = v.rot ?? new THREE.Quaternion();
    if (v.rot) hasRot = true;
    quat.push(q.x, q.y, q.z, q.w);
    const s = typeof v.scale === 'number' ? new THREE.Vector3(v.scale, v.scale, v.scale) : (v.scale ?? new THREE.Vector3(1, 1, 1));
    scl.push(s.x, s.y, s.z);
    op.push(v.opacity ?? 1);
    if (v.opacity !== undefined) hasOp = true;
    const c = v.color ?? new THREE.Color(1, 1, 1);
    col.push(c.r, c.g, c.b);
    if (v.color) hasCol = true;
  }
  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack(`${obj.uuid}.position`, times, pos),
    new THREE.VectorKeyframeTrack(`${obj.uuid}.scale`, times, scl),
  ];
  if (hasRot) tracks.push(new THREE.QuaternionKeyframeTrack(`${obj.uuid}.quaternion`, times, quat));
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Sprite).isSprite) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (Array.isArray(mat)) return;
    if (hasOp) {
      mat.transparent = true;
      mat.depthWrite = false;
      tracks.push(new THREE.NumberKeyframeTrack(`${m.uuid}.material.opacity`, times, op));
    }
    if (hasCol) {
      // FX meshes glow through their emissive colour; sprites and basic materials through their colour.
      const prop = mat.emissive && mat.userData?.ssg_fx ? 'emissive' : 'color';
      tracks.push(new THREE.ColorKeyframeTrack(`${m.uuid}.material.${prop}`, times, col));
    }
  });
  return tracks;
}
