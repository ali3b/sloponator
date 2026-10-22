import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HAIR_NAME } from '@slop/sprites';
import { isBundledAttachment } from '../shared/fx';
import type { Asset } from '../data';

/** Model/clip loading shared by the Studio and the batch runner. */

/** Meshopt-compressed GLBs (model exports with compress: meshopt) decode too. */
export const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const clipCache = new Map<string, Promise<THREE.AnimationClip>>();

/** Load the baked clip GLB once per URL. */
export function loadClip(url: string, clipName: string) {
  if (!clipCache.has(url))
    clipCache.set(url, loader.loadAsync(url).then((g) => g.animations.find((c) => c.name === clipName) ?? g.animations[0]));
  return clipCache.get(url)!;
}

/**
 * Synty colours come from the palette texture. Some FBX (most POLYGON War characters) carry an all-black
 * vertex-colour layer that would multiply the texture to black, so vertex colours are ignored.
 */
function textureColoursOnly(scene: THREE.Object3D) {
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if ((mat as THREE.MeshStandardMaterial).vertexColors) {
        (mat as THREE.MeshStandardMaterial).vertexColors = false;
        mat.needsUpdate = true;
      }
    }
  });
}

/**
 * Give every mesh its own material copies. Clones of a cached model otherwise share materials, so a fade or
 * FX look on one instance (a transparent flag, a tint) would leak into every other copy.
 */
export function cloneMaterials(root: THREE.Object3D) {
  const copies = new Map<THREE.Material, THREE.Material>();
  const copy = (m: THREE.Material) => {
    if (!copies.has(m)) {
      const c = m.clone();
      c.userData = { ...m.userData };
      copies.set(m, c);
    }
    return copies.get(m)!;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Sprite).isSprite) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material as THREE.Material);
  });
  return root;
}

/**
 * Bundled attachments (isBundledAttachment): left visible, every character in a combined file wears all of them at
 * once (POLYGON_BattleRoyale's bodies all wear six overlapping armour vests, so the female mercenary reads as the
 * male one).
 */
export { isBundledAttachment };

/**
 * A bundled attachment asset (one `*_Attach_*` mesh of a combined character file): drop every other mesh of the
 * file and keep the skeleton, so the piece mounts like a separate attachment (skinned ones rebind to the
 * character's bones by name, static ones go on a bone).
 */
export function keepBundledMesh(scene: THREE.Object3D, mesh: string) {
  const want = new Set([mesh, THREE.PropertyBinding.sanitizeNodeName(mesh)]);
  const drop: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    // A multi-material mesh loads as a group (named after the node) of one mesh per material.
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (want.has(p.name)) return;
    drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
}

/**
 * Combined character files: show only this body, hide the other characters sharing the skeleton and the bundled
 * attachments (add those with --with: each is its own attachment asset, see keepBundledMesh).
 */
/** The hair colour for hair whose palette cell is white (SF-FB-013): POLYGON War's and Generic's dark brown. */
export const DEFAULT_HAIR_COLOUR = '#4f412d';

/** Average sRGB colour (0–255) of a texture at up to `max` UV points, or null when it cannot be read. */
export function sampleTexture(image: CanvasImageSource & { width: number; height: number }, uvs: [number, number][], max = 24): [number, number, number] | null {
  if (!uvs.length || !image.width || !image.height) return null;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) : typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d', { willReadFrequently: true }) : null;
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const step = Math.max(1, Math.floor(uvs.length / max));
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < uvs.length; i += step) {
    const [u, v] = uvs[i];
    // glTF textures are not flipped: v = 0 is the image's top row.
    const x = Math.min(image.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * image.width)));
    const y = Math.min(image.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * image.height)));
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      sum[0] += d[0];
      sum[1] += d[1];
      sum[2] += d[2];
      n++;
    } catch {
      return null;
    }
  }
  return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
}

/**
 * Hair attachments whose UVs land on a white palette cell (POLYGON Palm City: its character shader tints hair
 * through a mask, so the texture alone renders the hair flat white) get a hair colour (SF-FB-013). Hair textured
 * in its own colour (POLYGON War, Generic) is left alone.
 */
export function tintWhiteHair(scene: THREE.Object3D, asset: Pick<Asset, 'name' | 'kind'> & { slot?: string | null }, colour = DEFAULT_HAIR_COLOUR) {
  if (asset.kind !== 'attachment' || !(HAIR_NAME.test(asset.name) || asset.slot === 'hair')) return false;
  let tinted = false;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const uv = mesh.isMesh ? mesh.geometry?.getAttribute('uv') : null;
    if (!uv) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      const img = std.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
      if (!img) continue;
      const uvs: [number, number][] = [];
      for (let i = 0; i < uv.count; i++) uvs.push([uv.getX(i), uv.getY(i)]);
      const c = sampleTexture(img, uvs);
      if (!c || Math.min(...c) < 235) continue;
      std.color = new THREE.Color(colour);
      std.needsUpdate = true;
      tinted = true;
    }
  });
  return tinted;
}

export function applyVariant(scene: THREE.Object3D, asset: Asset) {
  cloneMaterials(scene);
  textureColoursOnly(scene);
  // True size: scale the model's root nodes (not the scene, which templates use as the metric asset frame).
  const fix = asset.scaleFix ?? 1;
  if (fix !== 1) for (const child of scene.children) child.scale.multiplyScalar(fix);
  if (asset.bundled) {
    keepBundledMesh(scene, asset.bundled.mesh);
    tintWhiteHair(scene, asset);
    return;
  }
  tintWhiteHair(scene, asset);
  if (!asset.variant || !asset.variants) return;
  const others = new Set(asset.variants.filter((v) => v !== asset.variant).map((v) => THREE.PropertyBinding.sanitizeNodeName(v)));
  scene.traverse((o) => {
    if (others.has(o.name) || ((o as THREE.Mesh).isMesh && isBundledAttachment(o.name))) o.visible = false;
  });
}

const gltfCache = new Map<string, Promise<THREE.Object3D>>();
/** Load a model GLB once; attachments get their own (skeleton-aware) clone. */
export function loadModel(url: string) {
  if (!gltfCache.has(url)) gltfCache.set(url, loader.loadAsync(url).then((g) => g.scene));
  return gltfCache.get(url)!.then((s) => cloneSkinned(s));
}

