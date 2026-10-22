import * as THREE from 'three';

/**
 * Materials faded by a clip (opacityTracks) are transparent without depth writes only while they are see-through;
 * at full opacity they get their own settings (and shadows) back, so a still or the end of a crossfade renders
 * exactly like the model without any fade. Meshes nearly invisible cast no shadow.
 *
 * With `frontOnly` (a states export, FB-043) a fading model shows its front surface only: its meshes draw first
 * among the transparent ones (render order -1, before the dust, which stays in front), and each fading material
 * calls `prepass` before it draws, which lays down the depth of every fading mesh (SpriteRenderer.fadePrepass), so a
 * pixel blends the model's nearest surface over what is behind it (the opaque destination state) instead of its far
 * walls and floor seen through the near ones. Returns the fading meshes.
 */
export function syncFadeMaterials(root: THREE.Object3D | null | undefined, frontOnly: boolean, prepass: THREE.Material['onBeforeRender']) {
  const fading: THREE.Mesh[] = [];
  root?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    let faded = false, seen = false, front = false;
    for (const mat of mats) {
      const orig = mat?.userData?.ssgOpaque as { transparent: boolean; depthWrite: boolean } | undefined;
      if (!orig) continue;
      seen = true;
      const opaque = mat.opacity >= 0.999;
      const transparent = opaque ? orig.transparent : true;
      const depthWrite = opaque ? orig.depthWrite : false;
      if (mat.transparent !== transparent || mat.depthWrite !== depthWrite) {
        mat.transparent = transparent;
        mat.depthWrite = depthWrite;
        mat.needsUpdate = true;
      }
      if (mat.opacity < 0.5) faded = true;
      const f = frontOnly && !opaque && mat.opacity > 0.001;
      if (f) front = true;
      const hook = f ? prepass : THREE.Material.prototype.onBeforeRender;
      if (mat.onBeforeRender !== hook) mat.onBeforeRender = hook;
    }
    if (!seen) return;
    if (m.userData.ssgCastShadow === undefined) m.userData.ssgCastShadow = m.castShadow;
    m.castShadow = !faded && (m.userData.ssgCastShadow as boolean);
    if (m.userData.ssgRenderOrder === undefined) m.userData.ssgRenderOrder = m.renderOrder;
    m.renderOrder = front ? -1 : (m.userData.ssgRenderOrder as number);
    if (front) fading.push(m);
  });
  return fading;
}
