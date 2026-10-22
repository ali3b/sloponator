import * as THREE from 'three';
import { SCORCH_CHARCOAL, burnAmounts, burnColor, parseLook, scorchPlan } from '@slop/sprites';

const rubbleGeo = new THREE.DodecahedronGeometry(0.5, 0);

const f = (x: number) => x.toFixed(4);

/**
 * Burn a material's per-pixel colour (FB-043): textured or vertex-coloured materials (Synty's palette atlas, under a
 * white `color`) can only be burnt in the shader, after the texture and vertex colours are applied: the same
 * desaturate-then-charcoal as burnColor.
 */
export function burnShader(mat: THREE.Material, dark: number) {
  const { desaturate, toCharcoal } = burnAmounts(dark);
  const ch = SCORCH_CHARCOAL.map(f).join(', ');
  const key = `ssg_scorch:${f(dark)}`;
  mat.userData.ssgBurn = dark;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  float ssgL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(mix(diffuseColor.rgb, vec3(ssgL), ${f(desaturate)}), vec3(${ch}), ${f(toCharcoal)});
}`);
  };
  mat.customProgramCacheKey = () => key;
}

/**
 * Turn a loaded copy of a model into a procedural state (FB-028), in place: `scorch` burns its colours (greys them
 * and darkens them towards charcoal, FB-043; materials are copied first: loaded models share them with the cache and the intact state), sinks,
 * squashes and tilts it a little about its footprint centre, and lays rubble along the inside of its footprint.
 * Call it before the model is handed to the renderer (its rest pose is the scorched one). The scene is marked
 * `userData.ssgLook`, so a transition into it ends on its pose (endOnState).
 */
export function applyLook(scene: THREE.Object3D, look: string, seed: string) {
  const l = parseLook(look);
  if (l.id !== 'scorch') return;
  // Measured in the frame the model is placed in (its own transform, e.g. a scale fix, included).
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return;
  const plan = scorchPlan(box, l.params, seed);
  const tint = new THREE.Color(...plan.tint);
  scene.userData.ssgLook = look;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const burn = (mat: THREE.Material) => {
      const c = mat.clone() as THREE.MeshStandardMaterial;
      // Plain colours are burnt here; a texture or vertex colours under the colour are burnt per pixel.
      if (c.map || c.vertexColors) burnShader(c, plan.dark);
      else if (c.color) c.color.setRGB(...burnColor([c.color.r, c.color.g, c.color.b], plan.dark));
      if (c.emissive) c.emissive.multiply(tint);
      if (c.roughness !== undefined) c.roughness = Math.max(c.roughness, 0.95);
      if (c.metalness !== undefined) c.metalness = Math.min(c.metalness, 0.1);
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(burn) : burn(m.material);
  });
  // Sink, squash and tilt about the footprint centre on the ground: M = T(c - sink) · R · S · T(-c).
  const c = new THREE.Vector3((box.min.x + box.max.x) / 2, Math.max(0, box.min.y), (box.min.z + box.max.z) / 2);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(plan.axis.x, 0, plan.axis.z), plan.tilt);
  const m = new THREE.Matrix4()
    .makeTranslation(c.x, c.y - plan.sink, c.z)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeScale(1, plan.scaleY, 1))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  scene.updateMatrix();
  scene.matrix.copy(m.multiply(scene.matrix));
  scene.matrix.decompose(scene.position, scene.quaternion, scene.scale);
  scene.updateMatrixWorld(true);
  // Rubble on the ground: placed in world terms, then expressed in the scene's (now transformed) frame.
  if (plan.rubble.length) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.3, 0.28, 0.26).multiply(tint), roughness: 1, flatShading: true });
    const toLocal = scene.matrixWorld.clone().invert();
    const parentWorld = scene.parent ? scene.parent.matrixWorld.clone() : new THREE.Matrix4();
    for (const r of plan.rubble) {
      const piece = new THREE.Mesh(rubbleGeo, mat);
      piece.name = 'ssg_rubble';
      const world = parentWorld.clone().multiply(
        new THREE.Matrix4().compose(new THREE.Vector3(r.x, r.size * 0.3, r.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw), new THREE.Vector3(r.size, r.size * 0.6, r.size)),
      );
      toLocal.clone().multiply(world).decompose(piece.position, piece.quaternion, piece.scale);
      piece.castShadow = true;
      piece.receiveShadow = true;
      scene.add(piece);
    }
  }
}
