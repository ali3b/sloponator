import * as THREE from 'three';
import { fxTexture, type FxTex } from '../../render/fxTextures';
import { tintParticleMaterial, type ParticleTintMode } from '../../render/particleTint';
import { assetBox } from './helpers';

/**
 * A stage lets a template add objects to the asset for one clip: copies of the asset's meshes (debris, puffs)
 * and particle sprites. Each built clip gets its own stage group under the asset root, hidden by default and
 * switched on by the clip itself, so several clips (an export of idle + explode + smoke) can coexist and the
 * mixer restores the others to hidden when a clip stops playing.
 */
export interface Stage {
  /**
   * n copies of the asset's meshes, each in its own group whose origin is the asset's centre (so a template
   * positions, spins and scales a piece about its middle); materials are copied.
   */
  clone(n: number): THREE.Group[];
  /**
   * A camera-facing particle sprite, `size` metres across. 'normal' blend keeps smoke from adding up. `tint`: how
   * the FX look's tint recolours it (particleTint.ts): 'fire' for heat ramps, 'multiply' (default) for the rest.
   */
  sprite(tex: FxTex, size?: number, blend?: 'add' | 'normal', tint?: ParticleTintMode): THREE.Sprite;
  /** A flat quad on the ground (shockwave rings, scorch marks). */
  quad(tex: FxTex, size?: number, blend?: 'add' | 'normal', tint?: ParticleTintMode): THREE.Mesh;
  /** Tracks that hide the asset's own meshes for this clip (particles replace them). */
  hideOriginal(): THREE.KeyframeTrack[];
  /** Tracks every clip built on this stage must include (they show the stage while the clip plays). */
  tracks(duration: number): THREE.KeyframeTrack[];
  /** True once something was added. */
  readonly used: boolean;
  /**
   * True when the clip also has a layer that moves the model itself (`projectile+sparkle`): decorative particles
   * then keep the model instead of replacing it (SF-FB-019).
   */
  overModel: boolean;
}

export const STAGE_PREFIX = 'ssg_stage';
let counter = 0;
const quadGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = (x as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.dispose();
  });
}

/** Remove every stage group (switching assets, or rebuilding a preview). */
export function clearStages(root: THREE.Object3D) {
  for (const c of [...root.children]) {
    if (c.name.startsWith(STAGE_PREFIX)) {
      root.remove(c);
      disposeTree(c);
    }
  }
}

export function isStage(o: THREE.Object3D) {
  return o.name.startsWith(STAGE_PREFIX);
}

export function createStage(root: THREE.Object3D): Stage {
  const group = new THREE.Group();
  group.name = `${STAGE_PREFIX}_${++counter}`;
  group.visible = false;
  let used = false;
  const attach = () => {
    if (!used) {
      used = true;
      root.add(group);
    }
  };
  const originals = () => root.children.filter((c) => !isStage(c));
  const material = (tex: FxTex, blend: 'add' | 'normal', basic: 'sprite' | 'mesh', tint: ParticleTintMode) => {
    const opts = { map: fxTexture(tex), transparent: true, depthWrite: false, color: 0xffffff };
    const m = basic === 'sprite' ? new THREE.SpriteMaterial(opts) : new THREE.MeshBasicMaterial({ ...opts, side: THREE.DoubleSide });
    m.userData.blend = blend;
    if (blend === 'add') {
      // Colour adds up; alpha is the union coverage (as the FX look does for meshes). three's AdditiveBlending also
      // summed alpha (a² per sprite), so where many flames overlapped it passed 1 and the export, multiplying the
      // colour back by it, clipped red-orange to yellow (SF-FB-014).
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.SrcAlphaFactor;
      m.blendDst = THREE.OneFactor;
      m.blendSrcAlpha = THREE.OneFactor;
      m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    }
    return tintParticleMaterial(m, tint);
  };
  return {
    get used() {
      return used;
    },
    overModel: false,
    clone(n) {
      const box = new THREE.Box3();
      for (const c of originals()) box.union(assetBox(c, root));
      const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      attach();
      const out: THREE.Group[] = [];
      for (let i = 0; i < n; i++) {
        const g = new THREE.Group();
        const inner = new THREE.Group();
        inner.position.copy(centre).negate();
        g.add(inner);
        g.position.copy(centre);
        for (const c of originals()) {
          const copy = c.clone(true);
          // The original may be hidden right now by another clip that is playing; the copy must not inherit that.
          copy.visible = true;
          copy.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
            m.frustumCulled = false;
            m.castShadow = false;
          });
          inner.add(copy);
        }
        group.add(g);
        out.push(g);
      }
      return out;
    },
    sprite(tex, size = 1, blend = 'add', tint = 'multiply') {
      attach();
      const s = new THREE.Sprite(material(tex, blend, 'sprite', tint) as THREE.SpriteMaterial);
      s.scale.setScalar(size);
      s.frustumCulled = false;
      group.add(s);
      return s;
    },
    quad(tex, size = 1, blend = 'add', tint = 'multiply') {
      attach();
      const q = new THREE.Mesh(quadGeo, material(tex, blend, 'mesh', tint));
      q.scale.setScalar(size);
      q.position.y = 0.01;
      q.frustumCulled = false;
      group.add(q);
      return q;
    },
    hideOriginal() {
      return originals().map((c) => new THREE.BooleanKeyframeTrack(`${c.uuid}.visible`, [0], [false]));
    },
    tracks() {
      return used ? [new THREE.BooleanKeyframeTrack(`${group.uuid}.visible`, [0], [true])] : [];
    },
  };
}
