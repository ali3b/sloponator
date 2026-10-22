import * as THREE from 'three';
import { isStage } from './stage';

/**
 * FB-057: `flag_wave` for flags that are ONE mesh (POLYGON_War's flag poles and banners have no separate flag
 * part to swing). The cloth is found from the vertices and bent by morph targets:
 *
 *   - pole:    a tall model standing on a compact base (a flag pole): the pole is the vertical axis through the
 *              base; vertices further from it than the pole's radius are cloth, waved sideways (around the axis)
 *              by their distance from it (plus half their drop below the cloth's top, for a flag hanging limp);
 *   - hanging: a flat upright sheet (a long banner): hung from its top edge, waved through its thin side by the
 *              distance below the top;
 *   - flat:    a flat lying sheet: fixed along its lowest-x (or lowest-z, along its long side) edge, waved up
 *              and down by the distance from that edge.
 *
 * The wave is a travelling sine along that distance, its amplitude growing from 0 at the fixed edge (the pole and
 * its base never move): offset = A · (s/L) · sin(k·s − ωt). It is split into sin/cos morph targets so the clip
 * only keys their weights and loops seamlessly.
 */

export type ClothMode = 'pole' | 'hanging' | 'flat';

export interface ClothField {
  mode: ClothMode;
  /** Distance from the fixed edge to the free end (metres in the asset frame). */
  length: number;
  /** Distance of a point from the fixed edge (0 on the pole / edge). */
  distance(p: THREE.Vector3): number;
  /** Unit direction a point moves in. */
  direction(p: THREE.Vector3): THREE.Vector3;
}

const percentile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

/** How the cloth of a one-mesh flag is held, from its vertices in the asset frame (null: nothing to wave). */
export function clothField(points: THREE.Vector3[]): ClothField | null {
  if (points.length < 4) return null;
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!(longest > 0)) return null;
  const thin = size.x <= size.y && size.x <= size.z ? 'x' : size.z <= size.y ? 'z' : 'y';
  const flatSheet = size[thin] < 0.08 * longest;

  // A pole: tall, standing on a compact (round or square) foot, and not itself a flat sheet.
  if (!flatSheet && size.y >= 1.6 * Math.max(size.x, size.z)) {
    const foot = points.filter((p) => p.y < box.min.y + 0.1 * size.y);
    const fb = new THREE.Box3().setFromPoints(foot);
    const fs = fb.getSize(new THREE.Vector3());
    if (foot.length && Math.min(fs.x, fs.z) >= 0.4 * Math.max(fs.x, fs.z, 1e-6)) {
      const cx = (fb.min.x + fb.max.x) / 2, cz = (fb.min.z + fb.max.z) / 2;
      const radial = (p: THREE.Vector3) => Math.hypot(p.x - cx, p.z - cz);
      // The pole's radius: most vertices above the foot hug the pole (cloth is a few big quads).
      const above = points.filter((p) => p.y >= box.min.y + 0.1 * size.y).map(radial);
      const r0 = Math.max(percentile(above, 0.25) * 1.3, 0.01 * size.y);
      const footTop = box.min.y + 0.1 * size.y;
      const cloth = points.filter((p) => p.y >= footTop && radial(p) > r0);
      // A flag hanging limp from the pole swings most at its bottom: half the drop below the cloth's top counts.
      const top = cloth.length ? Math.max(...cloth.map((p) => p.y)) : box.max.y;
      const dist = (p: THREE.Vector3) => (p.y < footTop || radial(p) <= r0 ? 0 : radial(p) - r0 + 0.5 * Math.max(0, top - p.y));
      const length = cloth.length ? Math.max(...cloth.map(dist)) : 0;
      if (length > 0.02 * size.y) {
        return {
          mode: 'pole', length,
          distance: dist,
          direction: (p) => {
            const d = new THREE.Vector3(-(p.z - cz), 0, p.x - cx);
            return d.lengthSq() > 1e-12 ? d.normalize() : new THREE.Vector3(0, 0, 1);
          },
        };
      }
    }
  }
  if (thin !== 'y') {
    // Upright: hung from its top edge, swaying through its thin side.
    const n = thin === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    return { mode: 'hanging', length: size.y, distance: (p) => box.max.y - p.y, direction: () => n.clone() };
  }
  // Lying flat: fixed along the lowest edge of its long side.
  const along = size.x >= size.z ? 'x' : 'z';
  const up = new THREE.Vector3(0, 1, 0);
  return { mode: 'flat', length: size[along], distance: (p) => p[along] - box.min[along], direction: () => up.clone() };
}

/** Meshes of the model (not stages of other clips, not sprites). */
function modelMeshes(root: THREE.Object3D) {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o !== root && isStage(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as unknown as THREE.SkinnedMesh).isSkinnedMesh && m.geometry?.attributes.position) out.push(m);
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
}

const STEPS = 24;
/** Each waved mesh's own geometry (before any morph targets), so a rebuild starts from it. */
const baseGeometry = new WeakMap<THREE.Mesh, THREE.BufferGeometry>();

/**
 * Wave the cloth of a one-mesh flag: morph targets on (a copy of) each mesh's geometry and a clip keying their
 * weights. Throws a readable error when the model has nothing that looks like cloth.
 */
export function clothWaveClip(root: THREE.Object3D, p: { duration: number; angle: number }, name = 'flag_wave'): THREE.AnimationClip {
  const meshes = modelMeshes(root);
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toAsset = meshes.map((m) => new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
  const points: THREE.Vector3[] = [];
  meshes.forEach((m, i) => {
    const pos = (baseGeometry.get(m) ?? m.geometry).attributes.position;
    for (let k = 0; k < pos.count; k++) points.push(new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(toAsset[i]));
  });
  const field = clothField(points);
  if (!field) throw new Error(`${name}: this model has no flag part and no cloth to wave (give a part the "flag" role with set_part_role)`);
  // Sway angle (±°) → amplitude at the free end; one wavelength a little longer than the cloth.
  const amp = field.length * Math.sin(THREE.MathUtils.degToRad(Math.min(p.angle, 40))) * 0.9;
  const k = (Math.PI * 2) / (field.length * 1.2);
  const tracks: THREE.KeyframeTrack[] = [];
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * p.duration);
  const phase = (i: number) => (i / STEPS) * Math.PI * 2;
  meshes.forEach((m, i) => {
    // A fresh copy of the model's own geometry per build (the morph texture is cached per geometry).
    const base = baseGeometry.get(m) ?? m.geometry;
    baseGeometry.set(m, base);
    const g = base.clone();
    const pos = g.attributes.position;
    const linear = new THREE.Matrix3().setFromMatrix4(toAsset[i]);
    const back = linear.clone().invert();
    const sinT = new Float32Array(pos.count * 3), cosT = new Float32Array(pos.count * 3);
    let moves = false;
    for (let v = 0; v < pos.count; v++) {
      const at = new THREE.Vector3().fromBufferAttribute(pos, v).applyMatrix4(toAsset[i]);
      const s = field.distance(at);
      if (s <= 0) continue;
      const a = amp * Math.min(1, s / field.length);
      // Asset-frame offset → the mesh's own axes (its scale and rotation).
      const d = field.direction(at).applyMatrix3(back);
      const ss = Math.sin(k * s) * a, cc = Math.cos(k * s) * a;
      sinT.set([d.x * ss, d.y * ss, d.z * ss], v * 3);
      cosT.set([d.x * cc, d.y * cc, d.z * cc], v * 3);
      moves = true;
    }
    if (!moves) return;
    // offset(t) = a·sin(ks − ωt) = sin(ks)·a·cos(ωt) − cos(ks)·a·sin(ωt): four targets keep every weight ≥ 0.
    const neg = (x: Float32Array) => x.map((y) => -y);
    g.morphTargetsRelative = true;
    g.morphAttributes.position = [sinT, neg(sinT), cosT, neg(cosT)].map((x) => new THREE.Float32BufferAttribute(x, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    if (m.geometry !== base) m.geometry.dispose();
    m.geometry = g;
    m.updateMorphTargets();
    const weights: [number[], number[], number[], number[]] = [[], [], [], []];
    for (let j = 0; j <= STEPS; j++) {
      const c = Math.cos(phase(j)), sn = Math.sin(phase(j));
      weights[0].push(Math.max(0, c));
      weights[1].push(Math.max(0, -c));
      weights[2].push(Math.max(0, -sn));
      weights[3].push(Math.max(0, sn));
    }
    weights.forEach((w, t) => tracks.push(new THREE.NumberKeyframeTrack(`${m.uuid}.morphTargetInfluences[${t}]`, times, w)));
  });
  if (!tracks.length) throw new Error(`${name}: found no cloth to wave on this model (every vertex sits on the pole)`);
  return new THREE.AnimationClip(name, p.duration, tracks);
}
