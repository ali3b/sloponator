// Moved from synty-sprite-generator apps/server/src/modelBuild.ts (P3, ali3b/sloponator#14).
import fs from 'node:fs';
import { Logger, NodeIO, TextureInfo, type Accessor, type Document, type Animation, type Material, type Mesh, type Node, type Primitive, type Scene, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRMaterialsEmissiveStrength, KHRMaterialsVariants } from '@gltf-transform/extensions';
import { dedup, joinPrimitives, meshopt, prune, transformMesh, unpartition, mergeDocuments } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { MODEL_COLLIDER_EXCLUDE, MODEL_CONVEX_MAX_VERTICES, MODEL_LICENCE, bareChassisCheck, boundsOf, colliderOf, convexHull3, fitScale, hingesOf, isHingeRole, isRoadWheel, isSpinRole, mapWheels, parseTint, wheelSlotOf, type ModelClip, type ModelClipSource, type ModelPoseInfo, type ModelFit, type ModelVariant, type ModelHinge, type ModelManifest, type ModelOrigin, type ModelPart, type ModelSeat, type ModelSocket, type ModelSwatch, type ModelTexFormat, type ModelVec3, type ModelWheel, type WheelSlot, type ModelLod, type ModelDashboard } from '../spec/index.js';
import { marksToClipTimes, resolveClipSpeed } from '@slop/sprites';
import { isBundledAttachment } from '@slop/library/synty';
import type { ClipEdit } from '@slop/sprites';
import { splitBySwatch } from './modelSwatches.js';
import { detectSeats } from './modelSeats.js';
import { localName } from '@slop/library/synty';
import { applyNatureMaterials } from './modelNature.js';
import { readTexturePng, type NatureMaterial } from './natureMaterials.js';
import { GAUGE_NAME, NEEDLE_NAME, dashboardOf } from './modelDashboard.js';
import { looseComponents, simplifyMeshList, triangles as primTriangles } from './modelSimplify.js';

/**
 * The 3D model exporter's core (gltf-transform, no database): reads an ingested GLB, keeps this asset's meshes,
 * merges attachments and baked clips, bakes the scale fix and origin in, pivots each wheel on its own axle and
 * writes a self-contained GLB plus its manifest. models.ts resolves the inputs from the library and caches results.
 *
 * Frames: the ingest GLBs are glTF space already (+Y up, metres before the scale fix). Synty vehicles and
 * characters face +Z; a vehicle whose front wheels sit at -Z is turned round so every export faces +Z.
 */

export interface BuildPart {
  name: string;
  role: string | null;
  /** Pivot in the source GLB's scene space (before the scale fix). */
  pivot?: number[];
  spin_axis?: number[];
}

export interface BuildClip {
  /** Animation name in the output. */
  name: string;
  /** Baked clip GLB (skeleton only, one animation, bone names as the character's). */
  glb: string;
  loop: boolean;
  inPlace: boolean;
  edit?: ClipEdit | null;
  /** The library clip (manifest clips[].source). */
  source?: ModelClipSource;
}

/** A pose to bake into a static mesh (ModelSpec.pose / poses). */
export interface BuildPose {
  name: string;
  /** The clip as the spec named it. */
  ref: string;
  clip: BuildClip;
  /** Seconds into the clip as exported (after its trim and speed). */
  time: number;
}

export type BuildAttach =
  /** A mesh of the asset's own file (a bundled `*_Attach_*` piece). */
  | { name: string; mesh: string }
  /** Another asset's GLB: static pieces keep their place, skinned ones are bound to the character's bones by name. */
  | { name: string; glb: string; scaleFix: number; parts?: BuildPart[]; mount?: string };

export interface BuildInput {
  name: string;
  source: { pack: string; asset: string; assetId: number };
  kind: string;
  glb: string;
  scaleFix: number;
  /** Combined character file: this body's mesh, and the other bodies to drop. */
  variant?: string | null;
  variants?: string[];
  /** A bundled attachment asset: keep only this mesh. */
  bundledMesh?: string | null;
  parts?: BuildPart[];
  /** Canonical bone → bone name (characters). */
  rigMap?: Record<string, string> | null;
  /** Weapon / prop sockets in the object's own space (metres). */
  gripSockets?: { name: string; pos: number[] }[];
  attach?: BuildAttach[];
  /** Drop the model's own road wheels when an attachment brings four (default true). */
  replaceWheels?: boolean;
  clips?: BuildClip[];
  origin: ModelOrigin;
  texSize?: number;
  texFormat: ModelTexFormat;
  simplify?: number;
  tint?: string;
  /** Scale uniformly so these dimensions (metres) fit; the smallest scale wins. */
  fit?: ModelFit;
  /** Paint variants in one GLB (KHR_materials_variants); the first is the default look. */
  paintVariants?: ModelVariant[];
  /** meshopt: EXT_meshopt_compression (quantised, reordered geometry). */
  compress?: 'meshopt';
  /** Crop each atlas to the part of it the model's UVs use, when that saves a lot (default true). */
  cropTextures?: boolean;
  /**
   * Bake the character into static meshes posed at these clip times: no skin, joints or animations. One pose with
   * `poseSingle` puts its mesh on the root node; otherwise each pose is a named node under the root.
   */
  poses?: BuildPose[];
  poseSingle?: boolean;
  /** A seating prop (grandstand, bleachers, bench): the manifest gets `seats` (OR-FB-024; static models). */
  seating?: boolean;
  /** Split the triangles by palette swatch into `swatch_<hex>` child nodes (OR-FB-022; static models). */
  splitBySwatch?: boolean;
  /** Warnings found while resolving the inputs (an ambiguous clip name): the manifest lists them first. */
  warnings?: string[];
  /**
   * trimesh: also a `collider` node holding the visual mesh as one welded triangle mesh (CS-FB-002); convex: the
   * convex hull of it.
   */
  collider?: 'box' | 'trimesh' | 'convex';
  /** Parts the trimesh/convex collider leaves out, by role or part name (default MODEL_COLLIDER_EXCLUDE). */
  colliderExclude?: string[];
  /** Synty nature shader materials by mesh node name (natureMaterials.ts): foliage split, triplanar UVs. */
  nature?: Record<string, NatureMaterial>;
  /** PNG bytes of a texture file (the nature materials' textures). */
  readTexture?: (file: string) => Uint8Array;
  /** Levels of detail as shares of the model's triangles (CS-FB-025; static models). */
  lods?: number[];
  /** The paint to recolour: `#rrggbb` or a material name (CS-FB-026). */
  paint?: string;
  /** false: decals in the paint's texture are painted over (CS-FB-028). */
  decals?: boolean;
  /** The convex collider's most vertices (default MODEL_CONVEX_MAX_VERTICES). */
  convexMaxVertices?: number;
}

export interface BuildResult {
  glb: Uint8Array;
  manifest: ModelManifest;
}

// ---- small column-major 4×4 helpers ------------------------------------------------------------------
type M4 = number[];
const I4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const scaleM = (s: number): M4 => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const translateM = (t: number[]): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
/** Half a turn about +Y (x → -x, z → -z). */
const turnM = (): M4 => [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
const apply = (m: M4, v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const applyDir = (m: M4, v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const v3 = (v: number[]) => v.map(r4) as ModelVec3;

export const modelIO = () =>
  new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const quiet = new Logger(Logger.Verbosity.WARN);

/** Exact bounds of a set of meshes' positions under a matrix each. */
function boundsOfMeshes(items: { mesh: Mesh; matrix: M4 }[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const el: number[] = [];
  for (const { mesh, matrix } of items)
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        const w = apply(matrix, pos.getElement(i, el));
        for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], w[k]);
        hi[k] = Math.max(hi[k], w[k]);
      }
      }
    }
  return lo[0] <= hi[0] ? { min: lo, max: hi } : null;
}

const meshNodes = (doc: Document) => doc.getRoot().listNodes().filter((n) => n.getMesh());

function dropNode(n: Node) {
  n.setMesh(null).setSkin(null);
  if (!n.listChildren().length) n.dispose();
}

/** Every node of a scene, depth first. */
function sceneNodes(scene: Scene) {
  const out: Node[] = [];
  scene.traverse((n) => out.push(n));
  return out;
}

/** The joints of a document's skins by name (first wins), then every other node by name. */
function nodesByName(doc: Document) {
  const out = new Map<string, Node>();
  for (const s of doc.getRoot().listSkins()) for (const j of s.listJoints()) if (!out.has(j.getName())) out.set(j.getName(), j);
  for (const n of doc.getRoot().listNodes()) if (!out.has(n.getName())) out.set(n.getName(), n);
  return out;
}

function interp(path: string, a: number[], b: number[], f: number): number[] {
  if (path === 'rotation') {
    // nlerp along the short way round: close enough between keys sampled at 30 fps.
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const s = dot < 0 ? -1 : 1;
    const q = a.map((v, i) => v + (s * b[i] - v) * f);
    const l = Math.hypot(...q) || 1;
    return q.map((v) => v / l);
  }
  return a.map((v, i) => v + (b[i] - v) * f);
}

/**
 * A clip's keys within its trim window, retimed by its speed (and turned round when reversed). The window's ends
 * get keys of their own (interpolated) so the trimmed clip starts and ends on the right pose.
 */
export function windowKeys(times: number[], values: number[][], path: string, interpolation: string, w: { start: number; end: number; speed: number; reverse?: boolean }) {
  const at = (t: number): number[] => {
    if (t <= times[0]) return values[0];
    if (t >= times[times.length - 1]) return values[values.length - 1];
    let i = 1;
    while (times[i] < t) i++;
    if (interpolation === 'STEP') return values[i - 1];
    const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
    return interp(path, values[i - 1], values[i], f);
  };
  const eps = 1e-5;
  const keep: { t: number; v: number[] }[] = [{ t: w.start, v: at(w.start) }];
  times.forEach((t, i) => {
    if (t > w.start + eps && t < w.end - eps) keep.push({ t, v: values[i] });
  });
  if (w.end - w.start > eps) keep.push({ t: w.end, v: at(w.end) });
  const out = keep.map((k) => ({ t: (w.reverse ? w.end - k.t : k.t - w.start) / w.speed, v: k.v }));
  if (w.reverse) out.reverse();
  return { times: out.map((k) => r4(k.t * 1e2) / 1e2), values: out.map((k) => k.v) };
}

/** Copy a baked clip's channels onto the matching nodes of `doc` as one new animation. Returns its source length. */
async function mergeClip(doc: Document, clip: BuildClip, warnings: string[]) {
  const bake = await modelIO().read(clip.glb);
  const src = bake.getRoot().listAnimations()[0];
  if (!src) throw new Error(`baked clip ${clip.glb} has no animation`);
  const byName = nodesByName(doc);
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const sourceDuration = Math.max(0, ...src.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0));
  const e = clip.edit ?? null;
  let start = Math.max(0, e?.start ?? 0), end = Math.min(sourceDuration, e?.end ?? sourceDuration);
  if (end <= start) {
    start = 0;
    end = sourceDuration;
  }
  const speed = e?.speed && e.speed > 0 ? e.speed : 1;
  if (e?.lockYaw) warnings.push(`clip ${clip.name}: lockYaw is not applied to 3D exports (the game turns the model itself)`);
  const anim: Animation = doc.createAnimation(clip.name);
  let missing = 0;
  for (const ch of src.listChannels()) {
    const target = ch.getTargetNode();
    const path = ch.getTargetPath();
    const sampler = ch.getSampler();
    const to = target && byName.get(target.getName());
    if (!to || !sampler || !path) {
      if (target && !/^Armature/.test(target.getName())) missing++;
      continue;
    }
    const input = sampler.getInput()!, output = sampler.getOutput()!;
    const interpolation = sampler.getInterpolation();
    const times = Array.from(input.getArray() as Float32Array);
    const size = output.getElementSize();
    let outTimes: number[], outValues: number[][];
    if (interpolation === 'CUBICSPLINE') {
      // Tangents would need retiming too: copied as authored (Blender bakes are LINEAR).
      outTimes = times.map((t) => t / speed);
      outValues = Array.from({ length: output.getCount() }, (_, i) => output.getElement(i, []));
    } else {
      const values = Array.from({ length: output.getCount() }, (_, i) => output.getElement(i, []));
      ({ times: outTimes, values: outValues } = windowKeys(times, values, path, interpolation, { start, end, speed, reverse: e?.reverse }));
    }
    const inAcc: Accessor = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(outTimes)).setBuffer(buffer);
    const flat = new Float32Array(outValues.length * size);
    outValues.forEach((v, i) => flat.set(v, i * size));
    const outAcc = doc.createAccessor().setType(output.getType()).setArray(flat).setBuffer(buffer);
    const s = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation(interpolation);
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(to).setTargetPath(path).setSampler(s));
  }
  if (missing) warnings.push(`clip ${clip.name}: ${missing} channels name bones this model does not have`);
  return { sourceDuration, start, end, speed };
}

/** Ground travel of a root-motion clip (metres a second): the hips' horizontal movement over the clip. */
function measuredSpeed(anim: Animation, hips: Node | undefined, duration: number) {
  if (!hips || duration <= 0) return null;
  const ch = anim.listChannels().find((c) => c.getTargetNode() === hips && c.getTargetPath() === 'translation');
  const out = ch?.getSampler()?.getOutput();
  if (!out || out.getCount() < 2) return null;
  const parent = hips.getParentNode();
  const m = parent ? (parent.getWorldMatrix() as unknown as M4) : I4();
  const a = apply(Array.from(m), out.getElement(0, [])), b = apply(Array.from(m), out.getElement(out.getCount() - 1, []));
  return Math.hypot(b[0] - a[0], b[2] - a[2]) / duration;
}

/** Merge another asset's GLB into `doc`: its scene's nodes join the main scene (skinned meshes rebind by bone name). */
async function mergeAttachment(
  doc: Document,
  att: { name: string; glb: string; scaleFix: number; mount?: string },
  mainFix: number,
  warnings: string[],
  rigMap?: Record<string, string> | null,
) {
  const other = await modelIO().read(att.glb);
  for (const a of other.getRoot().listAnimations()) a.dispose();
  const rel = att.scaleFix / (mainFix || 1);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const before = new Set(doc.getRoot().listScenes());
  const byName = nodesByName(doc);
  mergeDocuments(doc, other);
  const added = doc.getRoot().listScenes().filter((s) => !before.has(s));
  for (const s of added) {
    const nodes = sceneNodes(s);
    const skinned = nodes.filter((n) => n.getMesh() && n.getSkin());
    if (skinned.length && byName.size) {
      // Bind to the character's skeleton: same joint order (the inverse bind matrices stay valid for the same rig).
      for (const n of skinned) {
        const skin = n.getSkin()!;
        const joints = skin.listJoints();
        const mapped = joints.map((j) => byName.get(j.getName()));
        if (mapped.some((j) => !j)) {
          warnings.push(`attachment ${att.name}: bones ${joints.filter((_, i) => !mapped[i]).map((j) => j.getName()).slice(0, 5).join(', ')} are not on this model; it keeps its own skeleton`);
          continue;
        }
        for (const j of joints) skin.removeJoint(j);
        for (const j of mapped) skin.addJoint(j!);
        const skel = skin.getSkeleton();
        if (skel) skin.setSkeleton(byName.get(skel.getName()) ?? null);
        n.getParentNode()?.removeChild(n);
        scene.addChild(n);
      }
      // What is left of the attachment's own armature goes.
      for (const n of sceneNodes(s)) if (!n.getMesh() && !n.getSkin()) n.dispose();
    }
    // Headwear (OR-FB-017) rides on its bone: a child of the joint, placed by the joint's bind transform.
    const bone = att.mount && rigMap?.[att.mount] ? byName.get(rigMap[att.mount]) : undefined;
    const roots = s.listChildren();
    const mountAt = bone && !roots.some(() => sceneNodes(s).some((n) => n.getSkin())) ? mountMatrix(doc, bone, roots, rel) : null;
    if (att.mount && !bone) warnings.push(`attachment ${att.name}: the model has no ${att.mount} bone; it keeps its authored place`);
    for (const root of roots) {
      if (rel !== 1) root.setScale(root.getScale().map((v) => v * rel) as [number, number, number]);
      s.removeChild(root);
      if (bone && mountAt) {
        root.setMatrix(mul(mountAt, Array.from(root.getMatrix())) as never);
        bone.addChild(root);
      } else scene.addChild(root);
    }
    s.dispose();
  }
}

/** The inverse of a column-major affine 4×4. */
function invert(m: M4): M4 {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06 || 1;
  return [
    a11 * b11 - a12 * b10 + a13 * b09, a02 * b10 - a01 * b11 - a03 * b09, a31 * b05 - a32 * b04 + a33 * b03, a22 * b04 - a21 * b05 - a23 * b03,
    a12 * b08 - a10 * b11 - a13 * b07, a00 * b11 - a02 * b08 + a03 * b07, a32 * b02 - a30 * b05 - a33 * b01, a20 * b05 - a22 * b02 + a23 * b01,
    a10 * b10 - a11 * b08 + a13 * b06, a01 * b08 - a00 * b10 - a03 * b06, a30 * b04 - a31 * b02 + a33 * b00, a21 * b02 - a20 * b04 - a23 * b00,
    a11 * b07 - a10 * b09 - a12 * b06, a00 * b09 - a01 * b07 + a02 * b06, a31 * b01 - a30 * b03 - a32 * b00, a20 * b03 - a21 * b01 + a22 * b00,
  ].map((v) => v / det);
}

/**
 * Where an attachment's root nodes go under `bone` (OR-FB-017), as the matrix that takes their own scene placement
 * (after `rel`) into the bone's frame. The bone's bind transform is the inverse of its inverse bind matrix (the
 * skin's space, where the body's vertices are), else its world matrix as it stands. An attachment modelled in place
 * on the body (its centre well away from its origin, nothing below the floor) keeps that place; one modelled around
 * its own origin (a helmet) is set at the bone's bind position, upright in the character's frame, as sprites mount it.
 */
export function mountMatrix(doc: Document, bone: Node, roots: Node[], rel = 1): M4 {
  let ibm: M4 | null = null;
  for (const skin of doc.getRoot().listSkins()) {
    const i = skin.listJoints().indexOf(bone);
    const acc = skin.getInverseBindMatrices();
    if (i >= 0 && acc) {
      ibm = acc.getElement(i, []);
      break;
    }
  }
  if (!ibm) ibm = invert(Array.from(bone.getWorldMatrix()));
  const items = roots.flatMap((r) => [r, ...r.listChildren().flatMap(function walk(n: Node): Node[] { return [n, ...n.listChildren().flatMap(walk)]; })])
    .filter((n) => n.getMesh())
    .map((n) => ({ mesh: n.getMesh()!, matrix: mul(scaleM(rel), Array.from(n.getWorldMatrix())) }));
  const b = boundsOfMeshes(items);
  const c = b ? b.min.map((v, i) => (v + b.max[i]) / 2) : [0, 0, 0];
  const inPlace = Math.hypot(c[0], c[1], c[2]) > 0.3 && !!b && b.min[1] > -0.1;
  const bind = invert(ibm);
  const at = inPlace ? I4() : translateM([bind[12], bind[13], bind[14]]);
  // root's world = parent(scene root, identity) × local: the bone-local matrix is ibm × at, then the root's own.
  return mul(ibm, at);
}

/**
 * The pieces of a texture that paint (weight > 0) encloses: 4-connected regions of non-paint texels that touch
 * neither the texture's edge nor anything but paint, each within an eighth of the texture's side (letters, checks,
 * a logo), not a neighbouring swatch the paint happens to surround.
 */
export function paintHoles(weight: Float32Array, w: number, h: number, maxShare = 1 / 8) {
  const mask = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const maxSide = Math.max(2, Math.ceil(Math.max(w, h) * maxShare));
  let count = 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || weight[start] > 0) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let border = false, x0 = w, x1 = -1, y0 = h, y1 = -1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const visit = (j: number) => {
        if (seen[j] || weight[j] > 0) return;
        seen[j] = 1;
        queue[tail++] = j;
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    if (border || x1 - x0 + 1 > maxSide || y1 - y0 + 1 > maxSide) continue;
    count++;
    for (let q = 0; q < tail; q++) mask[queue[q]] = 1;
  }
  return { mask, count };
}

/** Parts a paint colour is never read from (their swatches are not the body's paint), by their local name. */
const NOT_PAINT = /glass|window|wheel|tyre|tire|steer|light|lamp|interior|seat|grill|exhaust|mirror|plate/i;
/** Materials a tint without textured paint never multiplies (CS-FB-026). */
const NOT_PAINT_MATERIAL = /glass|window|wheel|tyre|tire|rim|rubber|interior|chrome|light|lamp/i;

/**
 * How a model's paint is found and recoloured (ModelSpec.paint / decals). `asset` is the model's name: the part names
 * are read without it, so a model named OpenWheeler is not taken for a wheel (CS-FB-026).
 */
export interface PaintOptions {
  asset?: string;
  /** `#rrggbb`: the paint is this swatch; a material name: only that material is read. */
  paint?: string;
  /** false: decals and liveries in the paint's texture are painted over too (CS-FB-028). */
  decals?: boolean;
}

/** A part's name without the model's (`SM_Veh_OpenWheeler_01_Halo_01` → `Halo_01`), for the NOT_PAINT test. */
export function paintLocalName(node: string, asset?: string) {
  if (!asset) return node;
  const a = asset.toLowerCase(), n = node.toLowerCase();
  if (n === a) return '';
  if (n.startsWith(a + '_')) return node.slice(asset.length + 1);
  return localName(node, asset);
}
const notPaintNode = (n: Node, o: PaintOptions) => NOT_PAINT.test(paintLocalName(n.getName(), o.asset));

/**
 * Tint by recolouring the paint: the texel colour that covers the most surface of the model's own body meshes
 * (area-weighted, sampled at each triangle's UV centre) is the paint, and the texels of that colour (and its shades)
 * in the texture take the tint, keeping their brightness relative to the paint. Synty atlases are flat palette
 * swatches, so tyres, glass, lights and trim keep their colours. Lettering inside the paint island (a taxi panel's
 * TAXI) is painted over (paintHoles). Every texture with the same image is recoloured
 * (an attachment from the same pack shares the atlas), but only where the model's own body triangles sample it.
 * False when no textured paint was found.
 */
export async function paintTint(doc: Document, nodes: Node[], tint: [number, number, number] | null, tolerance = 0.16, o: PaintOptions = {}): Promise<boolean> {
  const paint = await analysePaint(doc, nodes, tolerance, o);
  if (!paint) return false;
  // No tint (decals: false alone): the decals are painted over in the paint's own colour.
  tint ??= paint.paint as [number, number, number];
  const png = await recolour(paint, tint);
  for (const t of paintedTextures(doc, paint)) t.setImage(png).setMimeType('image/png');
  return true;
}

/** Where a model's paint is and how much of the tint each texel takes (see paintTint). */
export interface PaintAnalysis {
  tex: Texture;
  /** The texture's image before any recolour (textures with the same image are painted too). */
  srcImage: Buffer;
  data: Buffer;
  w: number;
  h: number;
  weight: Float32Array;
  shade: Float32Array;
  /** The paint colour (0–1). */
  paint: number[];
  /** Decal texels painted over (holes in the paint, or a livery's whole design with decals: false). */
  decals: number;
}

/** The textures a paint recolour applies to: the painted one and every other with the same image. */
export function paintedTextures(doc: Document, p: PaintAnalysis) {
  return doc.getRoot().listTextures().filter((t) => {
    const img = t.getImage();
    return !!img && (t === p.tex || Buffer.from(img).equals(p.srcImage));
  });
}

/** The painted texture with the paint recoloured to `tint` (a PNG). */
export async function recolour(p: PaintAnalysis, tint: [number, number, number]) {
  const sharp = (await import('sharp')).default;
  const { data, w, h, weight, shade } = p;
  const out = Buffer.from(data);
  for (let i = 0; i < w * h; i++) {
    const t = weight[i];
    if (!(t > 0)) continue;
    const o = i * 4;
    for (let k = 0; k < 3; k++) {
      const src = data[o + k] / 255;
      const next = Math.min(1, tint[k] * shade[i]);
      out[o + k] = Math.round((src + (next - src) * t) * 255);
    }
  }
  return new Uint8Array(await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
}

/** Find the paint of a model's own body meshes (see paintTint); null when no textured paint was found. */
export async function analysePaint(doc: Document, nodes: Node[], tolerance = 0.16, o: PaintOptions = {}): Promise<PaintAnalysis | null> {
  const paintHex = o.paint && /^#[0-9a-f]{6}$/i.test(o.paint) ? parseTint(o.paint) : null;
  const paintMat = o.paint && !paintHex ? o.paint.toLowerCase() : null;
  const sharp = (await import('sharp')).default;
  const decoded = new Map<Texture, { data: Buffer; w: number; h: number }>();
  const decode = async (t: Texture) => {
    if (!decoded.has(t)) {
      const { data, info } = await sharp(Buffer.from(t.getImage()!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      decoded.set(t, { data, w: info.width, h: info.height });
    }
    return decoded.get(t)!;
  };
  // Area per quantised colour (5 bits a channel), with the area-weighted mean colour of each bucket.
  const buckets = new Map<string, { area: number; sum: number[]; tex: Texture }>();
  // Texels the body's triangles cover (their UV boxes, 2 px wider): only these are recoloured, so a piece of another
  // model sharing the atlas (a lift kit's rims) keeps its colours even where they come near the paint.
  const masks = new Map<Texture, Uint8Array>();
  const pa: number[] = [], pb: number[] = [], pc: number[] = [], ua: number[] = [], ub: number[] = [], uc: number[] = [];
  for (const n of nodes) {
    if (notPaintNode(n, o)) continue;
    for (const prim of n.getMesh()!.listPrimitives()) {
      const mat = prim.getMaterial();
      if (paintMat && !(mat?.getName() ?? '').toLowerCase().includes(paintMat)) continue;
      const tex = mat?.getBaseColorTexture();
      const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute(`TEXCOORD_${mat?.getBaseColorTextureInfo()?.getTexCoord() ?? 0}`);
      if (!mat || !tex || !tex.getImage() || mat.getAlphaMode() === 'BLEND' || !pos || !uv) continue;
      const img = await decode(tex);
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < count; i += 3) {
        const [a, b, c] = [i, i + 1, i + 2].map((k) => (idx ? idx.getScalar(k) : k));
        pos.getElement(a, pa);
    pos.getElement(b, pb);
    pos.getElement(c, pc);
        const e1 = [0, 1, 2].map((k) => pb[k] - pa[k]), e2 = [0, 1, 2].map((k) => pc[k] - pa[k]);
        const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
        if (!(area > 0)) continue;
        uv.getElement(a, ua);
    uv.getElement(b, ub);
    uv.getElement(c, uc);
        const u = (ua[0] + ub[0] + uc[0]) / 3, v = (ua[1] + ub[1] + uc[1]) / 3;
        const x = Math.min(img.w - 1, Math.floor((u - Math.floor(u)) * img.w)), y = Math.min(img.h - 1, Math.floor((v - Math.floor(v)) * img.h));
        let mask = masks.get(tex);
        if (!mask) masks.set(tex, (mask = new Uint8Array(img.w * img.h)));
        const us = [ua[0], ub[0], uc[0]], vs = [ua[1], ub[1], uc[1]];
        const uo = Math.floor(u), vo = Math.floor(v);
        const x0 = Math.max(0, Math.floor((Math.min(...us) - uo) * img.w) - 2), x1 = Math.min(img.w - 1, Math.ceil((Math.max(...us) - uo) * img.w) + 2);
        const y0 = Math.max(0, Math.floor((Math.min(...vs) - vo) * img.h) - 2), y1 = Math.min(img.h - 1, Math.ceil((Math.max(...vs) - vo) * img.h) + 2);
        for (let yy = y0; yy <= y1; yy++) mask.fill(1, yy * img.w + x0, yy * img.w + x1 + 1);
        const o = (y * img.w + x) * 4;
        const rgb = [img.data[o], img.data[o + 1], img.data[o + 2]];
        const key = rgb.map((ch) => ch >> 3).join(',');
        const bk = buckets.get(key) ?? { area: 0, sum: [0, 0, 0], tex };
        bk.area += area;
        rgb.forEach((ch, k) => (bk.sum[k] += ch * area));
        buckets.set(key, bk);
      }
    }
  }
  // Paint is the colour of the most surface, saturated colours first: a body's dark underside, bed liner and
  // interior often cover more than its paint, and a white or grey car still wins over its darks.
  const score = (k: { area: number; sum: number[] }) => {
    const c = k.sum.map((v) => v / k.area / 255);
    const hi = Math.max(...c), lo = Math.min(...c);
    const sat = hi > 0 ? (hi - lo) / hi : 0;
    return k.area * (0.2 + sat) * (hi < 0.3 ? 0.3 : 1);
  };
  // A paint colour named in the spec (CS-FB-026): that colour, in the texture where the body's triangles cover the
  // most texels near it (a second paint colour no triangle centre lands on is still found).
  let best: { tex: Texture } | undefined;
  let paint: number[];
  if (paintHex) {
    let most = 0;
    for (const [tex, mask] of masks) {
      const img = await decode(tex);
      let n = 0;
      for (let i = 0; i < img.w * img.h; i++)
        if (mask[i] && Math.hypot(img.data[i * 4] / 255 - paintHex[0], img.data[i * 4 + 1] / 255 - paintHex[1], img.data[i * 4 + 2] / 255 - paintHex[2]) < 0.12) n++;
      if (n > most) {
      most = n;
      best = { tex };
    }
    }
    paint = paintHex;
  } else {
    const top = [...buckets.values()].sort((a, b) => score(b) - score(a))[0];
    best = top;
    paint = top ? top.sum.map((v) => v / top.area / 255) : [];
  }
  if (!best) return null;
  const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const paintLum = Math.max(0.02, lum(paint[0], paint[1], paint[2]));
  const srcImage = Buffer.from(best.tex.getImage()!);
  const { data, w, h } = await decode(best.tex);
  const lo = tolerance * 0.6;
  const mask = masks.get(best.tex)!;
  // How much of the tint each texel takes (0: none) and at what brightness (its shade of the paint).
  const weight = new Float32Array(w * h), shade = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
    // A shade of the paint (lit or in shadow) is the paint scaled: compared at the paint's brightness.
    const f = lum(r, g, b) / paintLum;
    if (f < 0.45 || f > 1.6) continue;
    const d = Math.hypot(r - paint[0] * f, g - paint[1] * f, b - paint[2] * f) / Math.max(1, f);
    if (d >= tolerance) continue;
    // Full recolour near the paint, fading out towards the tolerance (anti-aliased swatch edges).
    weight[i] = d <= lo ? 1 : 1 - (d - lo) / (tolerance - lo);
    shade[i] = f;
  }
  // CS-FB-028: decals: false on a livery (a texture that is mostly the paint, Street Racer's Veh_Tex_*): its whole
  // design (logos, numbers, a second colour) is painted over wherever the body samples it.
  let masked = 0, painted = 0;
  for (let i = 0; i < w * h; i++)
    if (mask[i]) {
      masked++;
      if (weight[i] > 0) painted++;
    }
  const livery = masked > 0 && painted / masked >= 0.25;
  let decals = 0;
  if (o.decals === false && livery) {
    for (let i = 0; i < w * h; i++)
      if (mask[i] && weight[i] < 1) {
        // A shade of the paint keeps its shading; anything else takes the plain tint.
        if (weight[i] === 0) {
      decals++;
      shade[i] = 1;
    }
        weight[i] = 1;
      }
  }
  // Lettering and decals inside the paint island (a taxi panel's TAXI and checks) are painted over: texels that are
  // not paint but are enclosed by it, in small pieces, take the plain tint, as do the paint texels that edge them.
  // decals: false on an atlas takes pieces up to half the texture.
  const holes = paintHoles(weight, w, h, o.decals === false ? 1 / 2 : 1 / 8);
  if (holes.count) {
    const ring = Math.max(1, Math.round(Math.max(w, h) / 1024));
    const edge = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!holes.mask[y * w + x]) continue;
        for (let yy = Math.max(0, y - ring); yy <= Math.min(h - 1, y + ring); yy++) edge.fill(1, yy * w + Math.max(0, x - ring), yy * w + Math.min(w - 1, x + ring) + 1);
      }
    for (let i = 0; i < w * h; i++)
    if (holes.mask[i] || (edge[i] && weight[i] > 0)) {
      if (holes.mask[i]) decals++;
      weight[i] = 1;
      shade[i] = 1;
    }
  }
  return { tex: best.tex, srcImage, data, w, h, weight, shade, paint, decals };
}

// ---- posed bounds (characters) ------------------------------------------------------------------------
type Quat = number[];
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const norm3 = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return v.map((x) => x / l);
};
/** The rotation taking unit vector a to unit vector b. */
function qFromTo(a: number[], b: number[]): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    // Opposite: half a turn about any axis perpendicular to a.
    const ax = norm3(Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[1], a[0], 0]);
    return [ax[0], ax[1], ax[2], 0];
  }
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l);
}
/** The rotation of a (uniformly scaled) column-major matrix. */
function quatOf(m: number[]): Quat {
  const sx = Math.hypot(m[0], m[1], m[2]) || 1, sy = Math.hypot(m[4], m[5], m[6]) || 1, sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const a = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
  // a is column-major 3×3: r(row, col) = a[col * 3 + row].
  const r = (row: number, col: number) => a[col * 3 + row];
  const tr = r(0, 0) + r(1, 1) + r(2, 2);
  let q: Quat;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    q = [(r(2, 1) - r(1, 2)) / S, (r(0, 2) - r(2, 0)) / S, (r(1, 0) - r(0, 1)) / S, S / 4];
  } else if (r(0, 0) > r(1, 1) && r(0, 0) > r(2, 2)) {
    const S = Math.sqrt(1 + r(0, 0) - r(1, 1) - r(2, 2)) * 2;
    q = [S / 4, (r(0, 1) + r(1, 0)) / S, (r(0, 2) + r(2, 0)) / S, (r(2, 1) - r(1, 2)) / S];
  } else if (r(1, 1) > r(2, 2)) {
    const S = Math.sqrt(1 + r(1, 1) - r(0, 0) - r(2, 2)) * 2;
    q = [(r(0, 1) + r(1, 0)) / S, S / 4, (r(1, 2) + r(2, 1)) / S, (r(0, 2) - r(2, 0)) / S];
  } else {
    const S = Math.sqrt(1 + r(2, 2) - r(0, 0) - r(1, 1)) * 2;
    q = [(r(0, 2) + r(2, 0)) / S, (r(1, 2) + r(2, 1)) / S, S / 4, (r(1, 0) - r(0, 1)) / S];
  }
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l);
}

/** A pose: node TRS values that replace the nodes' own while the bounds are measured. */
type Pose = Map<Node, { translation?: number[]; rotation?: number[]; scale?: number[] }>;

/** Run `fn` with the pose applied to its nodes, then put the nodes back. */
function withPose<T>(pose: Pose, fn: () => T): T {
  const saved = [...pose.keys()].map((n) => ({ n, t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }));
  try {
    for (const [n, p] of pose) {
      if (p.translation) n.setTranslation(p.translation as [number, number, number]);
      if (p.rotation) n.setRotation(p.rotation as [number, number, number, number]);
      if (p.scale) n.setScale(p.scale as [number, number, number]);
    }
    return fn();
  } finally {
    for (const x of saved) x.n.setTranslation(x.t).setRotation(x.r).setScale(x.s);
  }
}

/** The pose at a clip's first frame (its keys start at 0). */
export function clipStartPose(anim: Animation): Pose {
  const pose: Pose = new Map();
  for (const ch of anim.listChannels()) {
    const n = ch.getTargetNode(), path = ch.getTargetPath(), out = ch.getSampler()?.getOutput();
    if (!n || !out || !out.getCount() || (path !== 'translation' && path !== 'rotation' && path !== 'scale')) continue;
    // A cubic spline key is [in-tangent, value, out-tangent].
    const v = out.getElement(ch.getSampler()!.getInterpolation() === 'CUBICSPLINE' ? 1 : 0, []);
    pose.set(n, { ...pose.get(n), [path]: v });
  }
  return pose;
}

/**
 * The bind pose with the arms lowered: each upper arm turned so it points down (a little out from the body), its
 * lower arm and hand following. Empty when the rig has no arms to turn.
 */
export function armsDownPose(byName: Map<string, Node>, rigMap: Record<string, string>): Pose {
  const pose: Pose = new Map();
  for (const side of ['l', 'r']) {
    const upper = byName.get(rigMap[`upperarm_${side}`] ?? ''), lower = byName.get(rigMap[`lowerarm_${side}`] ?? '');
    const parent = upper?.getParentNode();
    if (!upper || !lower || !parent) continue;
    const um = Array.from(upper.getWorldMatrix()), lm = Array.from(lower.getWorldMatrix());
    const d = norm3([lm[12] - um[12], lm[13] - um[13], lm[14] - um[14]]);
    // Already hanging (an A-pose rig): leave it.
    if (d[1] < -0.8) continue;
    const want = norm3([Math.sign(d[0]) * 0.2, -1, 0]);
    const world = qmul(qFromTo(d, want), quatOf(um));
    pose.set(upper, { rotation: qmul(qconj(quatOf(Array.from(parent.getWorldMatrix()))), world) });
  }
  return pose;
}

/** A skinned node's joint matrices as its joints stand (world × inverse bind), or null for a static node. */
function jointMatrices(n: Node): M4[] | null {
  const skin = n.getSkin();
  if (!skin) return null;
  const ibm = skin.getInverseBindMatrices();
  return skin.listJoints().map((j, i) => mul(Array.from(j.getWorldMatrix()), ibm ? ibm.getElement(i, []) : I4()));
}

/**
 * A primitive's vertices where its node and joints put them, in scene space (CPU skinning: each skinned vertex by its
 * weighted joints, a static mesh by its node), and its normals turned the same way when asked for and present.
 */
export function skinPrimitive(n: Node, prim: Primitive, jointM: M4[] | null, withNormals = false) {
  const pos = prim.getAttribute('POSITION')!;
  const nrmIn = withNormals ? prim.getAttribute('NORMAL') : null;
  const count = pos.getCount();
  const out = new Float32Array(count * 3);
  const nrm = nrmIn ? new Float32Array(count * 3) : null;
  const nodeM = Array.from(n.getWorldMatrix());
  const sets = jointM ? [0, 1].map((i) => ({ j: prim.getAttribute(`JOINTS_${i}`), w: prim.getAttribute(`WEIGHTS_${i}`) })).filter((x) => x.j && x.w) : [];
  const v: number[] = [], nv: number[] = [], jn: number[] = [], wt: number[] = [];
  const m: number[] = new Array(16);
  for (let i = 0; i < count; i++) {
    pos.getElement(i, v);
    let mat: number[] = nodeM;
    if (sets.length) {
      // The weighted sum of the joint matrices (linear blend skinning), normalised by the weights' sum.
      m.fill(0);
      let sum = 0;
      for (const set of sets) {
        set.j!.getElement(i, jn);
        set.w!.getElement(i, wt);
        for (let k = 0; k < jn.length; k++) {
          const jm = jointM![jn[k]];
          if (!(wt[k] > 0) || !jm) continue;
          for (let e = 0; e < 16; e++) m[e] += jm[e] * wt[k];
          sum += wt[k];
        }
      }
      if (sum > 0) mat = m.map((x) => x / sum);
    }
    const p = apply(mat, v);
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
    if (nrm && nrmIn) {
      nrmIn.getElement(i, nv);
      const d = norm3(applyDir(mat, nv));
      nrm[i * 3] = d[0];
      nrm[i * 3 + 1] = d[1];
      nrm[i * 3 + 2] = d[2];
    }
  }
  return { pos: out, nrm };
}

/** The box of flat xyz position arrays. */
function boundsOfArrays(arrays: Float32Array[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const a of arrays)
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[i + k]);
      hi[k] = Math.max(hi[k], a[i + k]);
    }
  return lo[0] <= hi[0] ? { min: lo, max: hi } : null;
}

/**
 * The bounds of a document's meshes as its nodes stand (CPU skinning: each skinned vertex where its joints put it,
 * a static mesh by its node), in scene space.
 */
export function posedBounds(doc: Document) {
  const arrays: Float32Array[] = [];
  for (const n of meshNodes(doc)) {
    const jm = jointMatrices(n);
    for (const prim of n.getMesh()!.listPrimitives()) if (prim.getAttribute('POSITION')) arrays.push(skinPrimitive(n, prim, jm).pos);
  }
  return boundsOfArrays(arrays);
}

/**
 * The pose at a time in a clip: each channel's keys interpolated (linear, nlerp for rotations; step; a cubic
 * spline's key values, linearly).
 */
export function clipPoseAt(anim: Animation, t: number): Pose {
  const pose: Pose = new Map();
  for (const ch of anim.listChannels()) {
    const n = ch.getTargetNode(), path = ch.getTargetPath(), sampler = ch.getSampler();
    const input = sampler?.getInput(), out = sampler?.getOutput();
    if (!n || !sampler || !input || !out || !out.getCount() || (path !== 'translation' && path !== 'rotation' && path !== 'scale')) continue;
    const cubic = sampler.getInterpolation() === 'CUBICSPLINE';
    const value = (i: number) => out.getElement(cubic ? i * 3 + 1 : i, []);
    const times = input.getArray() as Float32Array;
    let v: number[];
    if (t <= times[0]) v = value(0);
    else if (t >= times[times.length - 1]) v = value(times.length - 1);
    else {
      let i = 1;
      while (times[i] < t) i++;
      const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
      v = sampler.getInterpolation() === 'STEP' ? value(i - 1) : interp(path, value(i - 1), value(i), f);
    }
    pose.set(n, { ...pose.get(n), [path]: v });
  }
  return pose;
}

/** Skin attributes a baked (static) primitive drops. */
const SKIN_ATTR = /^(JOINTS|WEIGHTS)_\d+$/;

/**
 * Bake a skinned document into static meshes, one per pose (OR-FB-012): every mesh node is CPU-skinned at the
 * pose's clip time and its primitives copied with the posed positions and normals (no joints, weights, tangents or
 * morph targets); primitives sharing a material are joined. Then the skeleton, skins, animations and skinned meshes
 * go, leaving only `exportRoot`. Positions are in scene space as `exportRoot` stands (it carries the scale fix).
 */
async function bakePoses(doc: Document, exportRoot: Node, poses: BuildPose[], warnings: string[]) {
  const root = doc.getRoot();
  const anims = new Map<BuildClip, { anim: Animation; duration: number }>();
  for (const p of poses) {
    if (anims.has(p.clip)) continue;
    const w = await mergeClip(doc, p.clip, warnings);
    anims.set(p.clip, { anim: root.listAnimations().find((a) => a.getName() === p.clip.name)!, duration: (w.end - w.start) / w.speed });
  }
  const nodes = meshNodes(doc);
  const baked = poses.map((p) => {
    const { anim, duration } = anims.get(p.clip)!;
    let t = p.time;
    if (t > duration + 1e-4) {
      t = p.clip.loop && duration > 0 ? t % duration : duration;
      warnings.push(`pose ${p.name}: ${p.clip.name} is ${r4(duration)} s long; ${p.time} s baked as ${r4(t)} s (${p.clip.loop ? 'it loops' : 'its end'})`);
    }
    const items = withPose(clipPoseAt(anim, t), () =>
      nodes.flatMap((n) => {
        const jm = jointMatrices(n);
        return n.getMesh()!.listPrimitives().filter((prim) => prim.getAttribute('POSITION')).map((prim) => ({ prim, ...skinPrimitive(n, prim, jm, true) }));
      }),
    );
    return { p, t: r4(t), bounds: boundsOfArrays(items.map((x) => x.pos)), items };
  });
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const meshes = baked.map(({ p, items }) => {
    const prims = items.map(({ prim, pos, nrm }) => {
      const out = doc.createPrimitive().setMode(prim.getMode()).setMaterial(prim.getMaterial()).setIndices(prim.getIndices());
      for (const sem of prim.listSemantics()) {
        if (sem === 'POSITION' || sem === 'NORMAL' || sem === 'TANGENT' || SKIN_ATTR.test(sem)) continue;
        out.setAttribute(sem, prim.getAttribute(sem));
      }
      out.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer));
      if (nrm) out.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer));
      return out;
    });
    // A body and its worn pieces on one atlas material become one primitive: one draw for an instanced crowd.
    const groups = new Map<string, Primitive[]>();
    for (const prim of prims) {
      const key = `${root.listMaterials().indexOf(prim.getMaterial()!)}|${prim.getMode()}|${prim.listSemantics().sort().join(',')}|${prim.getIndices() ? 1 : 0}`;
      groups.set(key, [...(groups.get(key) ?? []), prim]);
    }
    const mesh = doc.createMesh(p.name);
    for (const g of groups.values()) {
      if (g.length === 1) {
        mesh.addPrimitive(g[0]);
        continue;
      }
      mesh.addPrimitive(joinPrimitives(g));
      for (const x of g) x.dispose();
    }
    return mesh;
  });
  const oldMeshes = new Set(nodes.map((n) => n.getMesh()!));
  for (const a of root.listAnimations()) a.dispose();
  for (const sk of root.listSkins()) sk.dispose();
  for (const n of root.listNodes()) if (n !== exportRoot) n.dispose();
  for (const m of oldMeshes) m.dispose();
  return baked.map(({ p, t, bounds }, i) => ({ p, t, bounds, mesh: meshes[i] }));
}

// ---- textures ------------------------------------------------------------------------------------------
/** Every texture slot of a material: its texture and how it is sampled. */
const textureSlots = (m: Material): { tex: Texture | null; info: TextureInfo | null }[] => [
  { tex: m.getBaseColorTexture(), info: m.getBaseColorTextureInfo() },
  { tex: m.getEmissiveTexture(), info: m.getEmissiveTextureInfo() },
  { tex: m.getNormalTexture(), info: m.getNormalTextureInfo() },
  { tex: m.getOcclusionTexture(), info: m.getOcclusionTextureInfo() },
  { tex: m.getMetallicRoughnessTexture(), info: m.getMetallicRoughnessTextureInfo() },
];

/** A texture sampled with nearest filtering (a palette atlas): resized with the nearest kernel, kept lossless. */
const isNearest = (infos: (TextureInfo | null)[]) => infos.some((i) => i?.getMagFilter() === TextureInfo.MagFilter.NEAREST);

/**
 * Shrink the textures: crop each atlas to the box its UVs use (plus a few texels), remapping those UVs, when that
 * keeps at most `cropAt` of the image; then scale it down to fit `size` (nearest-sampled palettes with the
 * nearest kernel, so swatches stay crisp). An atlas whose UVs wrap (tiling), that one primitive samples with another
 * texture on the same UV set, or that has a texture transform, is not cropped. Images come out as PNG.
 * Returns the crops made (for tests and the manifest's debugging).
 */
export async function shrinkTextures(doc: Document, o: { size?: number; crop?: boolean; cropAt?: number; pad?: number }) {
  const sharp = (await import('sharp')).default;
  const uses = new Map<Texture, { prim: Primitive; texCoord: number; info: TextureInfo | null }[]>();
  const noCrop = new Set<Texture>();
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      const bySet = new Map<number, Set<Texture>>();
      for (const { tex, info } of textureSlots(mat)) {
        if (!tex || !tex.getImage()) continue;
        const tc = info?.getTexCoord() ?? 0;
        if (!uses.has(tex)) uses.set(tex, []);
        uses.get(tex)!.push({ prim, texCoord: tc, info });
        if (info?.getExtension('KHR_texture_transform')) noCrop.add(tex);
        if (!bySet.has(tc)) bySet.set(tc, new Set());
        bySet.get(tc)!.add(tex);
      }
      for (const set of bySet.values()) if (set.size > 1) for (const t of set) noCrop.add(t);
    }
  const crops: { texture: string; from: [number, number]; box: [number, number, number, number] }[] = [];
  const uv: number[] = [];
  for (const [tex, list] of uses) {
    const img = Buffer.from(tex.getImage()!);
    const meta = await sharp(img).metadata();
    const W = meta.width ?? 0, H = meta.height ?? 0;
    if (!W || !H) continue;
    const nearest = isNearest(list.map((u) => u.info));
    let box: [number, number, number, number] | null = null;
    if (o.crop !== false && !noCrop.has(tex)) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const { prim, texCoord } of list) {
        const a = prim.getAttribute(`TEXCOORD_${texCoord}`);
        if (!a) continue;
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, uv);
          if (uv[0] < u0) u0 = uv[0];
          if (uv[0] > u1) u1 = uv[0];
          if (uv[1] < v0) v0 = uv[1];
          if (uv[1] > v1) v1 = uv[1];
        }
      }
      const eps = 1e-3;
      if (u0 <= u1 && u0 >= -eps && v0 >= -eps && u1 <= 1 + eps && v1 <= 1 + eps) {
        const raw = [Math.floor(u0 * W), Math.floor(v0 * H), Math.ceil(u1 * W), Math.ceil(v1 * H)];
        const side = Math.max(raw[2] - raw[0], raw[3] - raw[1], 1);
        // A few texels of the output around the box: in source pixels, more when the image is scaled down a lot.
        const scale = o.size ? Math.min(1, o.size / side) : 1;
        const pad = Math.ceil((o.pad ?? 4) / scale);
        const x0 = Math.max(0, raw[0] - pad), y0 = Math.max(0, raw[1] - pad), x1 = Math.min(W, raw[2] + pad), y1 = Math.min(H, raw[3] + pad);
        if ((x1 - x0) * (y1 - y0) <= (o.cropAt ?? 0.6) * W * H) box = [x0, y0, x1 - x0, y1 - y0];
      }
    }
    if (box) {
      const [x0, y0, cw, ch] = box;
      const prims = new Set(list.map((u) => u.prim));
      const remapped = new Set<Accessor>();
      for (const { prim, texCoord } of list) {
        const sem = `TEXCOORD_${texCoord}`;
        let a = prim.getAttribute(sem);
        if (!a || remapped.has(a)) continue;
        // UVs another primitive reads for another texture are copied, not remapped under it.
        if (a.listParents().some((p) => p.propertyType === 'Primitive' && !prims.has(p as Primitive))) {
          a = a.clone();
          prim.setAttribute(sem, a);
        }
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, uv);
          a.setElement(i, [(uv[0] * W - x0) / cw, (uv[1] * H - y0) / ch]);
        }
        remapped.add(a);
      }
      crops.push({ texture: tex.getName() || tex.getURI(), from: [W, H], box });
    }
    const w = box ? box[2] : W, h = box ? box[3] : H;
    const resize = o.size && Math.max(w, h) > o.size;
    if (!box && !resize) continue;
    let pipe = sharp(img);
    if (box) pipe = pipe.extract({ left: box[0], top: box[1], width: box[2], height: box[3] });
    if (resize) {
      // extract and resize in one sharp pipeline need the extract first: toBuffer between them keeps the order.
      pipe = sharp(await pipe.png().toBuffer()).resize({ width: o.size, height: o.size, fit: 'inside', kernel: nearest ? 'nearest' : 'lanczos3' });
    }
    tex.setImage(new Uint8Array(await pipe.png().toBuffer())).setMimeType('image/png');
  }
  return crops;
}

/**
 * Encode every texture as `format`: webp (lossless for nearest-sampled palettes, so swatch edges stay exact; quality
 * 90 otherwise) with EXT_texture_webp, or png. `keep` leaves them as they are.
 */
export async function encodeTextures(doc: Document, format: ModelTexFormat) {
  if (format === 'keep') return;
  const sharp = (await import('sharp')).default;
  const infos = new Map<Texture, (TextureInfo | null)[]>();
  for (const m of doc.getRoot().listMaterials()) for (const { tex, info } of textureSlots(m)) if (tex) infos.set(tex, [...(infos.get(tex) ?? []), info]);
  let webp = false;
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage();
    if (!img) continue;
    if (format === 'png') {
      if (t.getMimeType() !== 'image/png') t.setImage(new Uint8Array(await sharp(Buffer.from(img)).png({ compressionLevel: 9 }).toBuffer())).setMimeType('image/png');
      continue;
    }
    const lossless = isNearest(infos.get(t) ?? []);
    const out = await sharp(Buffer.from(img)).webp(lossless ? { lossless: true, effort: 6 } : { quality: 90, effort: 6 }).toBuffer();
    t.setImage(new Uint8Array(out)).setMimeType('image/webp');
    if (t.getURI()) t.setURI(t.getURI().replace(/\.\w+$/, '.webp'));
    webp = true;
  }
  if (webp) doc.createExtension(EXTTextureWebP).setRequired(true);
}

// ---- material modes ------------------------------------------------------------------------------------
/** The FX kinds the ingest marks a material with (glTF extras `ssg_fx`, worker/ingest.py build_material). */
const fxKindOf = (m: Material): 'sprite' | 'unlit' | null => {
  const fx = (m.getExtras() as { ssg_fx?: unknown } | null)?.ssg_fx;
  return fx === 'sprite' || fx === 'unlit' ? fx : null;
};

/**
 * FX materials (OR-FB-019): the ingest's self-lit FX material keeps its look in the export. It glows (emissive white,
 * times the tint when one is asked for, KHR_materials_emissive_strength), its diffuse is off, it blends
 * (alphaMode BLEND, both sides), and extras say how to composite it: `fx: 'additive'` (a game adds it over the scene,
 * as the sprite renderer does) next to the ingest's `ssg_fx`. A particle sprite glows with its own texture. Returns
 * the materials changed.
 */
export function applyFxMaterials(doc: Document, tint: [number, number, number] | null): Material[] {
  const out: Material[] = [];
  for (const m of doc.getRoot().listMaterials()) {
    const kind = fxKindOf(m);
    if (!kind) continue;
    const t = tint ?? [1, 1, 1];
    const base = m.getBaseColorFactor();
    m.setAlphaMode('BLEND').setDoubleSided(true).setEmissiveFactor([t[0], t[1], t[2]]);
    m.setBaseColorFactor([0, 0, 0, base[3]]);
    if (kind === 'sprite' && m.getBaseColorTexture()) {
      const info = m.getBaseColorTextureInfo();
      m.setEmissiveTexture(m.getBaseColorTexture());
      const em = m.getEmissiveTextureInfo();
      if (info && em) em.setTexCoord(info.getTexCoord()).setMagFilter(info.getMagFilter()).setMinFilter(info.getMinFilter()).setWrapS(info.getWrapS()).setWrapT(info.getWrapT());
    }
    m.setExtension('KHR_materials_emissive_strength', doc.createExtension(KHRMaterialsEmissiveStrength).createEmissiveStrength().setEmissiveStrength(1.5));
    m.setExtras({ ...(m.getExtras() as Record<string, unknown>), fx: 'additive' });
    out.push(m);
  }
  return out;
}

/**
 * Alpha-cutout textures (OR-FB-018): an opaque material whose base colour texture is transparent where its
 * primitives' UVs fall (enough of the corners and triangle centres on texels with alpha under 0.5; one stray sample on
 * a palette sheet is not enough) becomes alphaMode MASK (cutoff 0.5), double-sided: cactus and grass cards, bushes.
 * Libraries ingested before the ingest did this themselves export right too. Returns the materials changed.
 */
export async function applyAlphaCutout(doc: Document): Promise<Material[]> {
  const sharp = (await import('sharp')).default;
  const decoded = new Map<Texture, { data: Buffer; w: number; h: number } | null>();
  const samples = new Map<Material, { clear: number; n: number }>();
  const uv: number[] = [];
  const at = (img: { data: Buffer; w: number; h: number }, u: number, v: number) => {
    const x = Math.min(img.w - 1, Math.floor((u - Math.floor(u)) * img.w)), y = Math.min(img.h - 1, Math.floor((v - Math.floor(v)) * img.h));
    return img.data[(y * img.w + x) * 4 + 3] / 255;
  };
  /** A texture with some transparency, decoded (null: opaque everywhere). */
  const decode = async (tex: Texture) => {
    if (!decoded.has(tex)) {
      const src = sharp(Buffer.from(tex.getImage()!));
      const meta = await src.metadata();
      if (!meta.hasAlpha) decoded.set(tex, null);
      else {
        const { data, info } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let min = 255;
        for (let i = 3; i < data.length; i += 4) if (data[i] < min) min = data[i];
        decoded.set(tex, min >= 255 ? null : { data, w: info.width, h: info.height });
      }
    }
    return decoded.get(tex) ?? null;
  };
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      if (!mat || !tex || !tex.getImage() || mat.getAlphaMode() !== 'OPAQUE' || fxKindOf(mat)) continue;
      const img = await decode(tex);
      const a = img && prim.getAttribute(`TEXCOORD_${mat.getBaseColorTextureInfo()?.getTexCoord() ?? 0}`);
      if (!img || !a) continue;
      const s = samples.get(mat) ?? { clear: 0, n: 0 };
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : a.getCount();
      const tri: number[][] = [];
      for (let i = 0; i < count; i++) {
        a.getElement(idx ? idx.getScalar(i) : i, uv);
        tri.push([uv[0], uv[1]]);
        s.n++;
        if (at(img, uv[0], uv[1]) < 0.5) s.clear++;
        if (tri.length === 3) {
          const cu = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cv = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          s.n++;
          if (at(img, cu, cv) < 0.5) s.clear++;
          tri.length = 0;
        }
      }
      samples.set(mat, s);
    }
  const out: Material[] = [];
  for (const [m, s] of samples) {
    if (!s.n || s.clear < Math.max(1, 0.01 * s.n)) continue;
    m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    out.push(m);
  }
  // Cut-out materials are also on solid pieces that the source's custom shader draws opaque: a palm's trunk samples
  // the transparent part of its frond texture (CS-FB-025: "gaps in the trunk"). A loose piece bigger than a card whose
  // triangles mostly sample clear texels is drawn opaque (the texture's colours run on under its alpha).
  const solid = new Map<Material, Material>();
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of [...mesh.listPrimitives()]) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      if (!mat || !tex || !tex.getImage() || mat.getAlphaMode() !== 'MASK' || fxKindOf(mat)) continue;
      const img = await decode(tex);
      const a = img && prim.getAttribute(`TEXCOORD_${mat.getBaseColorTextureInfo()?.getTexCoord() ?? 0}`);
      if (!img || !a || prim.getMode() !== 4) continue;
      const idx = prim.getIndices();
      const vi = (i: number) => (idx ? idx.getScalar(i) : i);
      const nt = (idx ? idx.getCount() : a.getCount()) / 3;
      const { comp, sizes } = looseComponents(prim);
      const clearTris = sizes.map(() => 0);
      for (let f = 0; f < nt; f++) {
        let u = 0, v = 0, clearCorners = 0;
        for (let k = 0; k < 3; k++) {
          a.getElement(vi(f * 3 + k), uv);
          u += uv[0] / 3;
          v += uv[1] / 3;
          if (at(img, uv[0], uv[1]) < 0.5) clearCorners++;
        }
        if (at(img, u, v) < 0.5 && clearCorners >= 2) clearTris[comp[f]]++;
      }
      const isSolid = sizes.map((n, c) => n > 12 && clearTris[c] >= 0.7 * n);
      if (!isSolid.some(Boolean)) continue;
      const keep: number[] = [], opaque: number[] = [];
      for (let f = 0; f < nt; f++) (isSolid[comp[f]] ? opaque : keep).push(vi(f * 3), vi(f * 3 + 1), vi(f * 3 + 2));
      let sm = solid.get(mat!);
      if (!sm) solid.set(mat!, (sm = mat!.clone().setName(`${mat!.getName()}_Solid`).setAlphaMode('OPAQUE')));
      const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
      const n = prim.getAttribute('POSITION')!.getCount();
      const indices = (list: number[]) => doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? new Uint32Array(list) : new Uint16Array(list)).setBuffer(buffer);
      if (!keep.length) prim.setMaterial(sm);
      else {
        mesh.addPrimitive(prim.clone().setIndices(indices(opaque)).setMaterial(sm));
        prim.setIndices(indices(keep));
      }
    }
  return out;
}

/**
 * The materials a tint multiplies when no textured paint was found (CS-FB-026): the opaque materials of the model's
 * own body parts (not wheels, glass, the interior), and not tyre, rim, glass or chrome materials by name; a material
 * the spec names as the paint, only that. All opaque ones when that leaves none.
 */
export function fallbackPaintMaterials(own: Node[], o: PaintOptions = {}): Set<Material> {
  const opaque = (nodes: Node[]) => nodes.flatMap((n) => n.getMesh()!.listPrimitives().map((p) => p.getMaterial())).filter((m): m is Material => !!m && m.getAlphaMode() !== 'BLEND');
  const all = new Set(opaque(own));
  if (o.paint && !/^#/.test(o.paint)) {
    const named = new Set([...all].filter((m) => m.getName().toLowerCase().includes(o.paint!.toLowerCase())));
    if (named.size) return named;
  }
  const body = new Set(opaque(own.filter((n) => !notPaintNode(n, o))).filter((m) => !NOT_PAINT_MATERIAL.test(m.getName())));
  // A material the wheels or glass also use is still the body's when it is the only one (one atlas for everything).
  return body.size ? body : all;
}

// ---- variants ------------------------------------------------------------------------------------------
/**
 * Paint variants (KHR_materials_variants): the model's paint (paintTint) recoloured once per variant into a texture
 * of its own, each painted material cloned per variant with that texture, and a mapping on every primitive that
 * uses a painted material. The first variant is the default look (its texture replaces the original). Without
 * textured paint, each variant multiplies the model's own opaque materials. Returns the manifest's variant list.
 */
export async function applyVariants(doc: Document, own: Node[], variants: ModelVariant[], warnings: string[], o: PaintOptions = {}) {
  const ext = doc.createExtension(KHRMaterialsVariants);
  const vs = variants.map((v) => ext.createVariant(v.name));
  const tints = variants.map((v) => parseTint(v.tint));
  const looks = new Map<Material, Material[]>();
  const paint = await analysePaint(doc, own, 0.16, o);
  if (paint) {
    const texs = new Set(paintedTextures(doc, paint));
    const original = new Uint8Array(await (await import('sharp')).default(paint.data, { raw: { width: paint.w, height: paint.h, channels: 4 } }).png().toBuffer());
    // A variant without a tint keeps the model's colours; with decals: false its decals still go (painted in the paint).
    const images = await Promise.all(tints.map((t) => (t ? recolour(paint, t) : o.decals === false ? recolour(paint, paint.paint as [number, number, number]) : Promise.resolve(original))));
    for (const t of texs) t.setImage(images[0]).setMimeType('image/png');
    const name = paint.tex.getName() || 'paint';
    const varTex = images.map((img, i) => (i === 0 ? null : doc.createTexture(`${name}_${variants[i].name}`).setImage(img).setMimeType('image/png')));
    for (const m of doc.getRoot().listMaterials()) {
      const tex = m.getBaseColorTexture();
      if (!tex || !texs.has(tex)) continue;
      looks.set(m, variants.map((v, i) => (i === 0 ? m : m.clone().setName(`${m.getName()}_${v.name}`).setBaseColorTexture(varTex[i]))));
    }
  } else {
    const mats = fallbackPaintMaterials(own, o);
    warnings.push(`variants: no paint colour found in a texture; ${mats.size ? `each variant's tint multiplies the model's own body materials (${[...mats].map((m) => m.getName()).join(', ')}; give paint to name one)` : 'all variants look the same (the model has no opaque material of its own)'}`);
    for (const m of mats) {
      const f = m.getBaseColorFactor();
      const factor = (t: number[] | null) => (t ? [f[0] * t[0], f[1] * t[1], f[2] * t[2], f[3]] : [...f]) as [number, number, number, number];
      looks.set(m, variants.map((v, i) => (i === 0 ? m : m.clone().setName(`${m.getName()}_${v.name}`).setBaseColorFactor(factor(tints[i])))));
      m.setBaseColorFactor(factor(tints[0]));
    }
  }
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const ms = prim.getMaterial() && looks.get(prim.getMaterial()!);
      if (!ms) continue;
      const list = ext.createMappingList();
      ms.forEach((m, i) => list.addMapping(ext.createMapping().setMaterial(m).addVariant(vs[i])));
      prim.setExtension('KHR_materials_variants', list);
    }
  return variants.map((v) => ({ name: v.name, tint: v.tint ?? null }));
}

/**
 * Before meshopt's quantisation: quantize moves a mesh into a dequantising transform on its node, so every mesh
 * node hands its mesh to an unnamed child first. The named nodes (wheels, doors) keep their pivots.
 */
export function meshesToChildren(doc: Document) {
  for (const n of meshNodes(doc)) {
    if (n.getSkin()) continue;
    const child = doc.createNode('').setMesh(n.getMesh());
    n.setMesh(null).addChild(child);
  }
}

/** Add the `collider` node (CS-FB-002): a plain triangle mesh with no material, under the root, extras { collider: true }. */
export function addColliderNode(doc: Document, root: Node, pos: ArrayLike<number>, idx: ArrayLike<number>, convex = false) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const vertices = pos.length / 3;
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(Array.from(pos))).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(vertices > 65535 ? new Uint32Array(Array.from(idx)) : new Uint16Array(Array.from(idx))).setBuffer(buffer));
  const extras = convex ? { collider: true, convex: true } : { collider: true };
  const mesh = doc.createMesh('collider').addPrimitive(prim).setExtras(extras);
  const node = doc.createNode('collider').setMesh(mesh).setExtras(extras);
  root.addChild(node);
  return { node: 'collider', triangles: idx.length / 3, vertices };
}

/**
 * The visual mesh as one welded triangle mesh in the export root's frame (positions within 0.1 mm merged, degenerate
 * triangles dropped): an asset's trimesh collider.
 */
export function visualTrimesh(doc: Document, root: Node, skip: (n: Node) => boolean = () => false) {
  const inv = invert(Array.from(root.getWorldMatrix()));
  const pos: number[] = [], idx: number[] = [];
  const at = new Map<string, number>();
  const v: number[] = [];
  const nodes: Node[] = [];
  const skipped = (n: Node | null): boolean => !!n && n !== root && (skip(n) || skipped(n.getParentNode()));
  root.traverse((n) => void (n.getMesh() && !n.getSkin() && n.getName() !== 'collider' && !skipped(n) && nodes.push(n)));
  for (const n of nodes) {
    const m = mul(inv, Array.from(n.getWorldMatrix()));
    for (const prim of n.getMesh()!.listPrimitives()) {
      const p = prim.getAttribute('POSITION');
      if (!p || prim.getMode() !== 4) continue;
      const ix = prim.getIndices();
      const count = ix ? ix.getCount() : p.getCount();
      const vid = (k: number) => {
        const w = apply(m, p.getElement(k, v));
        const key = w.map((x) => Math.round(x * 1e4)).join(',');
        let id = at.get(key);
        if (id === undefined) {
      at.set(key, (id = pos.length / 3));
      pos.push(...w);
    }
        return id;
      };
      for (let i = 0; i + 2 < count; i += 3) {
        const t = [i, i + 1, i + 2].map((k) => vid(ix ? ix.getScalar(k) : k));
        if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) idx.push(...t);
      }
    }
  }
  return { pos, idx };
}

export const triangleCount = (doc: Document) =>
  doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0);

/**
 * Simplify every mesh (or these) to about `ratio` of its triangles: modelSimplify.ts (meshopt with locked borders,
 * error 1% of the mesh's size; foliage cards thinned), skinned ones included (OR-FB-011: a kept vertex keeps its own
 * joints and weights). A warning says when the meshes could not get near the ratio.
 */
export async function simplifyMeshes(doc: Document, ratio: number, warnings: string[], meshes = doc.getRoot().listMeshes()) {
  const { before, after } = await simplifyMeshList(doc, meshes, ratio);
  if (before > 0 && after > before * ratio * 1.2 + 2)
    warnings.push(`simplify: kept ${Math.round((after / before) * 100)}% of the triangles (${after} of ${before}), not ${Math.round(ratio * 100)}%: the mesh cannot lose more without changing shape`);
  return { before, after };
}

/** A Synty LOD mesh node (`…_LOD2`): its group (the name without the suffix) and level. */
export function lodLevelOf(name: string): { key: string; level: number } | null {
  const m = /^(.*)_LOD(\d+)$/i.exec(name);
  return m ? { key: m[1], level: Number(m[2]) } : null;
}

/**
 * Which of a group's own LOD meshes stands for a share of LOD0's triangles (CS-FB-025): the level nearest the
 * target (in ratio); used as it is when it is at most 25% over, else simplified on from there. Null: simplify LOD0.
 */
export function pickLodSource(levels: { level: number; triangles: number }[], target: number): { level: number; simplify?: number } | null {
  const cands = levels.filter((l) => l.level > 0 && l.triangles > 0);
  if (!cands.length || target <= 0) return null;
  // Nearest in ratio, an overshoot counting half again (a level under the target, a billboard card for a far level,
  // beats one far over it that would need simplifying).
  const cost = (t: number) => (t > target ? 1.5 * Math.log(t / target) : Math.log(target / t));
  const best = cands.sort((a, b) => cost(a.triangles) - cost(b.triangles) || a.level - b.level)[0];
  if (best.triangles <= target * 1.25) return { level: best.level };
  const ratio = target / best.triangles;
  return { level: best.level, simplify: Math.max(0.01, Math.round(ratio * 1000) / 1000) };
}

/** The meshes of a node and its descendants (not the collider). */
function meshesUnder(n: Node): Mesh[] {
  const out: Mesh[] = [];
  n.traverse((c) => void (c.getMesh() && c.getName() !== 'collider' && !out.includes(c.getMesh()!) && out.push(c.getMesh()!)));
  return out;
}
const meshTriangles = (meshes: Mesh[]) => meshes.reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + primTriangles(p), 0), 0);

interface LodLevel {
  ratio: number;
  node: Node;
  /** Copies of LOD0 meshes still to simplify to the level's share. */
  fromLod0: { source: Node; node: Node }[];
  /** The source file's own level meshes, some to simplify on by a factor. */
  synty: { node: Node; simplify?: number }[];
}

/**
 * Lay out the levels of detail (before the prune: the source's own level meshes are only held by the stash). Every
 * mesh node of the model moves under `LOD0`; each level is a node `LOD<i>` beside it. A Synty LOD group (`X_LOD0`
 * with `X_LOD1`…) is stood for by its own level nearest the share (pickLodSource); any other mesh is copied from LOD0
 * once LOD0 is final (finishLods).
 */
function planLods(doc: Document, exportRoot: Node, ratios: number[], stash: { key: string; level: number; name: string; mesh: Mesh }[], offset: number[], baseRatio: number) {
  const lod0 = doc.createNode('LOD0');
  for (const c of exportRoot.listChildren()) {
    exportRoot.removeChild(c);
    lod0.addChild(c);
  }
  exportRoot.addChild(lod0);
  const meshNodesUnder: Node[] = [];
  lod0.traverse((n) => void (n.getMesh() && meshNodesUnder.push(n)));
  const used = new Set<Mesh>();
  const names = new Set(meshNodesUnder.map((n) => n.getName()));
  const levels: LodLevel[] = ratios.map((ratio, i) => {
    const node = doc.createNode(`LOD${i + 1}`);
    exportRoot.addChild(node);
    const level: LodLevel = { ratio, node, fromLod0: [], synty: [] };
    for (const src of meshNodesUnder) {
      const l = lodLevelOf(src.getName());
      const own = l && l.level === 0 ? stash.filter((s) => s.key === l.key) : [];
      const tris0 = meshTriangles([src.getMesh()!]) * baseRatio;
      const pick = own.length ? pickLodSource(own.map((s) => ({ level: s.level, triangles: meshTriangles([s.mesh]) })), tris0 * ratio) : null;
      const st = pick ? own.find((s) => s.level === pick.level)! : null;
      if (st) {
        const mesh = used.has(st.mesh) ? st.mesh.clone() : st.mesh;
        used.add(mesh);
        // The source's node name, unless an earlier level already took it (two shares from one source level).
        const name = names.has(st.name) ? `${st.name}_L${i + 1}` : st.name;
        names.add(name);
        const child = doc.createNode(name).setMesh(mesh).setTranslation(offset.map((v) => r4(-v)) as [number, number, number]);
        node.addChild(child);
        level.synty.push({ node: child, ...(pick!.simplify ? { simplify: pick!.simplify } : {}) });
      } else {
        const t = src.getWorldTranslation();
        const child = doc.createNode(`${src.getName()}_LOD${i + 1}`).setTranslation([t[0], t[1], t[2]]);
        node.addChild(child);
        level.fromLod0.push({ source: src, node: child });
      }
    }
    return level;
  });
  return { lod0, levels };
}

/** Fill in the levels copied from LOD0 and simplify each level to its share; the manifest's `lods`. */
async function finishLods(doc: Document, plan: ReturnType<typeof planLods>, warnings: string[]): Promise<ModelLod[]> {
  const tris0 = meshTriangles(meshesUnder(plan.lod0));
  const out: ModelLod[] = [{ level: 0, node: plan.lod0.getName(), ratio: 1, triangles: tris0, source: 'model' }];
  for (const [i, l] of plan.levels.entries()) {
    const copies: Mesh[] = [];
    for (const f of l.fromLod0) {
      const m = f.source.getMesh()!.clone();
      f.node.setMesh(m);
      copies.push(m);
    }
    if (copies.length) await simplifyMeshList(doc, copies, l.ratio);
    for (const s of l.synty) if (s.simplify && s.simplify < 1) await simplifyMeshList(doc, [s.node.getMesh()!], s.simplify);
    const tris = meshTriangles(meshesUnder(l.node));
    if (tris > tris0 * l.ratio * 1.3 + 2) warnings.push(`lods: LOD${i + 1} kept ${tris} triangles, not ${Math.round(tris0 * l.ratio)} (${Math.round(l.ratio * 100)}%): the mesh cannot lose more without changing shape`);
    out.push({ level: i + 1, node: l.node.getName(), ratio: l.ratio, triangles: tris, source: l.synty.length ? 'synty' : 'simplified' });
  }
  return out;
}

export async function buildModel(input: BuildInput): Promise<BuildResult> {
  const warnings: string[] = [...(input.warnings ?? [])];
  const io = modelIO();
  const doc = await io.read(input.glb);
  doc.setLogger(quiet);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  // The ingest's own takes (a T-pose "Take 001") are not clips of this model.
  for (const a of root.listAnimations()) a.dispose();

  // ---- keep this asset's meshes ----
  const attach = input.attach ?? [];
  const keepBundled = new Set(attach.filter((a): a is { name: string; mesh: string } => 'mesh' in a).map((a) => a.mesh));
  if (input.bundledMesh) {
    for (const n of meshNodes(doc)) if (n.getName() !== input.bundledMesh) dropNode(n);
  } else if (input.variant && input.variants?.length) {
    const others = new Set(input.variants.filter((v) => v !== input.variant));
    for (const n of meshNodes(doc)) if (others.has(n.getName()) || (isBundledAttachment(n.getName()) && !keepBundled.has(n.getName()))) dropNode(n);
  }
  for (const m of keepBundled) if (!meshNodes(doc).some((n) => n.getName() === m)) warnings.push(`attachment ${m} is not in this model's file`);
  // Synty nature shaders (foliage leaf + trunk, triplanar ground) from the pack's MaterialList, by mesh name.
  if (input.nature && Object.keys(input.nature).length)
    applyNatureMaterials(doc, meshNodes(doc), input.nature, { scale: input.scaleFix || 1, read: input.readTexture ?? readTexturePng });
  // The model's own mesh nodes (not an attachment's): where the paint colour is read for a tint.
  const ownNodes = new Set(meshNodes(doc));
  for (const a of attach) if ('glb' in a) await mergeAttachment(doc, a, input.scaleFix, warnings, input.rigMap);
  // Vertex colours are ignored (some Synty FBX carry an all-black layer that would multiply the texture to black).
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('COLOR_0', null);

  const s = input.scaleFix || 1;
  // An attachment's own parts (a lift kit's wheels) are parts of the model too; its pivots are in its own scale.
  const attachParts = attach.flatMap((a) => ('glb' in a ? (a.parts ?? []).map((p) => ({ ...p, pivot: p.pivot?.map((v) => (v * a.scaleFix) / s) })) : []));
  // An attachment with four road wheels of its own (a lift kit) replaces the model's: the body's go.
  const attachRoad = new Set(attachParts.filter(isRoadWheel).map((p) => p.name));
  const replaced = new Set(
    input.replaceWheels !== false && attachRoad.size >= 4 ? (input.parts ?? []).filter((p) => isRoadWheel(p) && !attachRoad.has(p.name)).map((p) => p.name) : [],
  );
  for (const n of meshNodes(doc)) if (replaced.has(n.getName())) dropNode(n);
  // CS-FB-025: Synty files carry their own levels of detail (`…_LOD0` to `…_LOD3`, the last often a billboard card),
  // which were all exported on top of each other. The export is LOD0; the other levels are kept aside for `lods`.
  const lodStash: { key: string; level: number; name: string; mesh: Mesh; world: M4 }[] = [];
  {
    const groups = new Map<string, Set<number>>();
    for (const n of meshNodes(doc)) {
      const l = lodLevelOf(n.getName());
      if (l && !n.getSkin()) groups.set(l.key, (groups.get(l.key) ?? new Set()).add(l.level));
    }
    for (const n of meshNodes(doc)) {
      const l = lodLevelOf(n.getName());
      if (!l || l.level === 0 || n.getSkin() || !groups.get(l.key)?.has(0)) continue;
      lodStash.push({ ...l, name: n.getName(), mesh: n.getMesh()!, world: Array.from(n.getWorldMatrix()) });
      dropNode(n);
    }
  }
  const bodyParts = (input.parts ?? []).filter((p) => !replaced.has(p.name));
  const nodes = meshNodes(doc);
  const skinned = nodes.some((n) => n.getSkin());
  const partOf = new Map([...attachParts, ...bodyParts].map((p) => [p.name, p]));
  let dashboard: ModelDashboard | undefined;
  // Only parts that turn continuously (wheels, propellers, tracks) are pivoted at their centre with a spin axis.
  const isSpin = (p: BuildPart | undefined) => !!p && isSpinRole(p.role);
  // The fit's uniform scale on top of the scale fix (1 without a fit).
  let k = 1;
  let turned = false;
  let bounds: { min: number[]; max: number[] } = { min: [0, 0, 0], max: [0, 0, 0] };
  let offset = [0, 0, 0];
  const parts: ModelPart[] = [];
  // Characters: the clips merged so far and the pose the bounds measure.
  const merged: { c: BuildClip; w: Awaited<ReturnType<typeof mergeClip>> }[] = [];
  let poseName: string | undefined;
  // Posed exports: the baked poses (the manifest's list) and their nodes.
  let posed: { info: ModelPoseInfo; node: Node }[] | null = null;
  let seats: ModelSeat[] | undefined;
  const exportRoot = doc.createNode(input.name);
  // A mesh node with the model's own name (a Synty body node) is renamed, so the root's name is unique.
  for (const n of root.listNodes()) if (n !== exportRoot && n.getName() === input.name) n.setName(`${input.name}_Mesh`);

  if (!skinned) {
    // CS-FB-023: a gauge or needle the source gives no role (an attached speedometer, a dial named after the model)
    // is one by its node name (after the rename above, so the name is the one the parts are looked up by).
    for (const n of nodes) {
      const nm = n.getName();
      const p = partOf.get(nm);
      // Only with a gauge in the name: a syringe or a compass needle is not an instrument.
      if (p?.role || !GAUGE_NAME.test(nm)) continue;
      partOf.set(nm, { ...(p ?? {}), name: nm, role: NEEDLE_NAME.test(nm) ? 'needle' : 'gauge' });
    }
    // ---- static: bake every node's transform, the turn and the scale into its mesh, then pivot the parts ----
    // Front wheels behind the rear ones: the model faces -Z and is turned round.
    const wheelZ = (slotFront: boolean) => {
      const ws = nodes.filter((n) => partOf.get(n.getName())?.role === 'wheel' && wheelSlotOf(n.getName())?.startsWith(slotFront ? 'f' : 'r'));
      const b = ws.length ? boundsOfMeshes(ws.map((n) => ({ mesh: n.getMesh()!, matrix: Array.from(n.getWorldMatrix()) }))) : null;
      return b ? (b.min[2] + b.max[2]) / 2 : null;
    };
    const fz = wheelZ(true), rz = wheelZ(false);
    turned = fz !== null && rz !== null && fz < rz;
    if (input.fit) {
      const pre = boundsOfMeshes(nodes.map((n) => ({ mesh: n.getMesh()!, matrix: mul(mul(turned ? turnM() : I4(), scaleM(s)), Array.from(n.getWorldMatrix())) })));
      if (pre) k = fitScale(pre.max.map((v, i) => v - pre.min[i]), input.fit);
    }
    const base = mul(turned ? turnM() : I4(), scaleM(s * k));
    const seen = new Set<Mesh>();
    for (const n of nodes) {
      let mesh = n.getMesh()!;
      // A mesh shared by several nodes (instanced wheels) gets a copy per node: each is baked to its own place.
      if (seen.has(mesh)) {
        mesh = mesh.clone();
        n.setMesh(mesh);
      }
      seen.add(mesh);
      transformMesh(mesh, mul(base, Array.from(n.getWorldMatrix())) as never);
    }
    // The levels kept aside are baked the same way (placed at the origin below).
    for (const st of lodStash) {
      if (seen.has(st.mesh)) st.mesh = st.mesh.clone();
      seen.add(st.mesh);
      transformMesh(st.mesh, mul(base, st.world) as never);
    }
    for (const n of nodes) {
      n.getParentNode()?.removeChild(n);
      scene.removeChild(n);
      n.setMatrix(I4() as never);
      exportRoot.addChild(n);
    }
    // Nodes left without a mesh (the source's empty groups) go; nothing else is parented to them now.
    for (const n of root.listNodes()) if (n !== exportRoot && !n.getMesh() && !nodes.includes(n)) n.dispose();
    const b = boundsOfMeshes(nodes.map((n) => ({ mesh: n.getMesh()!, matrix: I4() })));
    if (!b) throw new Error(`${input.source.asset} has no geometry to export`);
    // Pivots in model space before the origin: wheels at their own centre, doors and lids on their hinge (derived
    // from their box when the source has no pivot), other parts at their source pivot.
    const pivots = new Map<Node, number[]>();
    const hinges = hingesOf(
      nodes.flatMap((n) => {
        const p = partOf.get(n.getName());
        const nb = p && isHingeRole(p.role) ? boundsOfMeshes([{ mesh: n.getMesh()!, matrix: I4() }]) : null;
        return p && nb ? [{ name: n.getName(), role: p.role, min: nb.min, max: nb.max }] : [];
      }),
      b,
    );
    const hingeAxis = new Map<Node, ModelHinge['axis']>();
    for (const n of nodes) {
      const p = partOf.get(n.getName());
      if (!p) continue;
      const authored = p.pivot && p.pivot.some((v) => v !== 0) ? apply(base, p.pivot) : null;
      const h = hinges.get(n.getName());
      if (isSpin(p)) {
        const nb = boundsOfMeshes([{ mesh: n.getMesh()!, matrix: I4() }])!;
        pivots.set(n, nb.min.map((v, i) => (v + nb.max[i]) / 2));
      } else if (h) {
        pivots.set(n, authored ?? h.pos);
        hingeAxis.set(n, h.axis);
      } else if (authored) pivots.set(n, authored);
    }
    const wheelNodes = nodes.filter((n) => isRoadWheel(partOf.get(n.getName()) ?? { role: null, name: n.getName() }) && pivots.has(n));
    if (input.origin === 'bottom-centre') offset = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
    else if (input.origin === 'axle-centre') {
      if (wheelNodes.length) {
        const cs = wheelNodes.map((n) => pivots.get(n)!);
        offset = [0, 1, 2].map((k) => cs.reduce((acc, c) => acc + c[k], 0) / cs.length);
      } else {
        warnings.push('origin axle-centre needs wheels: bottom-centre used');
        offset = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
      }
    }
    // Each node sits at its pivot (less the origin), its geometry around it.
    for (const n of nodes) {
      const p = pivots.get(n) ?? [0, 0, 0];
      if (p.some((v) => v !== 0)) transformMesh(n.getMesh()!, translateM(p.map((v) => -v)) as never);
      n.setTranslation(p.map((v, i) => r4(v - offset[i])) as [number, number, number]);
    }
    bounds = { min: b.min.map((v, i) => v - offset[i]), max: b.max.map((v, i) => v - offset[i]) };
    for (const n of nodes) {
      const p = partOf.get(n.getName());
      if (!p) continue;
      const part: ModelPart = { node: n.getName(), role: p.role, pivot: v3(n.getTranslation()) };
      const axis = hingeAxis.get(n);
      if (axis) part.hinge = { pos: part.pivot, axis };
      if (isSpin(p)) {
        const axis = applyDir(turned ? turnM() : I4(), p.spin_axis ?? [1, 0, 0]).map((v) => (Math.abs(v) < 1e-9 ? 0 : v));
        const l = Math.hypot(...axis) || 1;
        const ax = axis.map((v) => v / l);
        const nb = boundsOfMeshes([{ mesh: n.getMesh()!, matrix: I4() }])!;
        const size = nb.max.map((v, i) => v - nb.min[i]);
        // Half the largest extent across the axis (an X axle: the wheel's height or length).
        const across = [0, 1, 2].filter((k) => Math.abs(ax[k]) < 0.7).map((k) => size[k]);
        part.radius = r4(Math.max(...(across.length ? across : size)) / 2);
        part.spinAxis = v3(ax);
      }
      parts.push(part);
    }
    // CS-FB-023: dials and needles (an attached needle without a pivot of its own is pivoted on its hub).
    const authored = new Set(nodes.filter((n) => partOf.get(n.getName())?.pivot?.some((v) => v !== 0)).map((n) => n.getName()));
    dashboard = dashboardOf(nodes, parts, authored, (n, at) => {
      const t = n.getTranslation();
      transformMesh(n.getMesh()!, translateM([0, 1, 2].map((i) => t[i] - at[i])) as never);
      n.setTranslation(at.map(r4) as [number, number, number]);
    });
    if (input.seating) {
      // OR-FB-024: seat points from the placed geometry (modelSeats.ts).
      seats = detectSeats(worldTriangles(nodes), bounds.min[1]);
    }
  } else {
    // ---- skinned: the skeleton stays as authored, under a root that carries the scale fix and the origin ----
    for (const n of scene.listChildren()) {
      scene.removeChild(n);
      exportRoot.addChild(n);
    }
    if (s !== 1) exportRoot.setScale([s, s, s]);
  }
  if (skinned && input.poses?.length) {
    // ---- posed (OR-FB-012): static meshes baked at clip times; no skin, joints or clips are left ----
    const baked = await bakePoses(doc, exportRoot, input.poses, warnings);
    exportRoot.setScale([1, 1, 1]);
    const b0 = baked[0].bounds;
    if (!b0) throw new Error(`${input.source.asset} has no geometry to export`);
    // The first pose sets the fit and the origin, so every pose stands on the same spot (a game swaps them in place).
    if (input.fit) k = fitScale(b0.max.map((v, i) => v - b0.min[i]), input.fit);
    if (input.origin === 'axle-centre') warnings.push('origin axle-centre needs wheels: bottom-centre used');
    if (input.origin !== 'pivot') offset = [(b0.min[0] + b0.max[0]) * k / 2, b0.min[1] * k, (b0.min[2] + b0.max[2]) * k / 2];
    const place = translateM(offset.map((v) => -v));
    const m = mul(place, scaleM(k));
    posed = [];
    for (const { p, t, mesh } of baked) {
      transformMesh(mesh, m as never);
      const node = input.poseSingle ? exportRoot.setMesh(mesh) : doc.createNode(p.name === input.name ? `${p.name}_pose` : p.name).setMesh(mesh);
      if (node !== exportRoot) exportRoot.addChild(node);
      const pb = boundsOfMeshes([{ mesh, matrix: I4() }])!;
      posed.push({ info: { name: p.name, node: node.getName(), clip: p.ref, time: t, ...(p.clip.source ? { source: p.clip.source } : {}), bounds: boundsOf(v3(pb.min), v3(pb.max)) }, node });
    }
    const all = boundsOfMeshes(baked.map(({ mesh }) => ({ mesh, matrix: I4() })))!;
    bounds = { min: all.min, max: all.max };
  } else if (skinned) {
    // The clips go in first: the bounds measure the first frame of the first clip.
    for (const c of input.clips ?? []) {
      if (root.listAnimations().some((a) => a.getName() === c.name)) continue;
      merged.push({ c, w: await mergeClip(doc, c, warnings) });
    }
    // Bounds and collider from a pose a game stands the character in, not the bind T-pose (arms out, 2 m wide): the
    // first frame of the first clip, else the bind pose with the arms lowered. CPU skinning places each vertex.
    const first = root.listAnimations()[0];
    let pose: Pose = new Map();
    if (first) {
      pose = clipStartPose(first);
      poseName = `clip:${first.getName()}`;
    }
    else if (input.rigMap) {
      pose = armsDownPose(nodesByName(doc), input.rigMap);
      poseName = pose.size ? 'rest' : 'bind';
    } else poseName = 'bind';
    let b = withPose(pose, () => posedBounds(doc));
    if (!b) throw new Error(`${input.source.asset} has no geometry to export`);
    if (input.fit) {
      // The fit scales the root (and so the skeleton, its clips and their root motion) with the scale fix. The root
      // sits at the origin here, so the bounds scale with it.
      k = fitScale(b.max.map((v, i) => v - b!.min[i]), input.fit);
      if (k !== 1) {
        exportRoot.setScale([s * k, s * k, s * k]);
        b = { min: b.min.map((v) => v * k), max: b.max.map((v) => v * k) };
      }
    }
    if (input.origin === 'axle-centre') warnings.push('origin axle-centre needs wheels: bottom-centre used');
    if (input.origin !== 'pivot') offset = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
    exportRoot.setTranslation(offset.map((v) => r4(-v)) as [number, number, number]);
    bounds = { min: b.min.map((v, i) => v - offset[i]), max: b.max.map((v, i) => v - offset[i]) };
  }
  // OR-FB-022: lamps painted into one mesh become their own nodes (modelSwatches.ts).
  let swatches: ModelSwatch[] | undefined;
  if (input.splitBySwatch && skinned) warnings.push('splitBySwatch: only static models are split (this one is skinned)');
  else if (input.splitBySwatch) {
    const r = await splitBySwatch(doc, nodes, warnings);
    swatches = r.swatches;
    for (const [n, kids] of r.children) if (ownNodes.has(n)) for (const kid of kids) ownNodes.add(kid);
  }
  scene.addChild(exportRoot);
  root.setDefaultScene(scene);

  // ---- clips ----
  const clips: ModelClip[] = [];
  if (input.clips?.length && !skinned) warnings.push('clips need a skinned model (a character): none were added');
  else if (input.clips?.length) {
    const hipsName = input.rigMap?.hips ?? 'Hips';
    for (const { c, w } of merged) {
      const duration = (w.end - w.start) / w.speed;
      const anim = root.listAnimations().find((a) => a.getName() === c.name)!;
      const hips = nodesByName(doc).get(hipsName);
      const measured = c.inPlace ? null : measuredSpeed(anim, hips, duration);
      const speedMps = resolveClipSpeed({ name: c.name, loop: c.loop, measured });
      const events = marksToClipTimes(c.edit?.events, c.edit ?? null, w.sourceDuration).map((m) => ({ t: r4(m.t), name: m.name }));
      clips.push({ name: c.name, duration: r4(duration), loop: c.loop, ...(speedMps !== undefined ? { speedMps } : {}), ...(events.length ? { events } : {}), ...(c.source ? { source: c.source } : {}) });
    }
  }

  // ---- sockets ----
  const sockets: ModelSocket[] = [];
  const byName = nodesByName(doc);
  if (skinned && !posed && input.rigMap) {
    for (const [socket, bone] of [['hand_r', 'hand_r'], ['hand_l', 'hand_l'], ['head', 'head'], ['chest', 'spine3'], ['hips', 'hips']] as const) {
      const b = input.rigMap[bone];
      if (b && byName.has(b)) sockets.push({ name: socket, node: b, pos: [0, 0, 0], rot: [0, 0, 0, 1] });
    }
  }
  for (const g of input.gripSockets ?? []) {
    const p = apply(mul(turned ? turnM() : I4(), scaleM(k)), g.pos).map((v, i) => v - (skinned && !posed ? 0 : offset[i]));
    sockets.push({ name: g.name, node: input.name, pos: v3(p), rot: [0, 0, 0, 1] });
  }

  // ---- levels of detail (CS-FB-025): LOD0 is the model; each level a node of copies at fewer triangles ----
  let lodPlan: Awaited<ReturnType<typeof planLods>> | null = null;
  if (input.lods?.length && (skinned || posed)) warnings.push('lods: only static models get levels of detail (this one is skinned)');
  else if (input.lods?.length) lodPlan = planLods(doc, exportRoot, input.lods, lodStash, offset, input.simplify ?? 1);

  // ---- materials and textures ----
  await doc.transform(unpartition(), prune({ keepLeaves: true, keepAttributes: false, keepSolidTextures: true }), dedup());
  if (input.simplify && input.simplify < 1) await simplifyMeshes(doc, input.simplify, warnings, lodPlan ? meshesUnder(lodPlan.lod0) : undefined);
  const lods = lodPlan ? await finishLods(doc, lodPlan, warnings) : undefined;
  // Atlases cropped to what the model uses and scaled to the size asked for, before any recolour (so a variant's
  // texture is the same small crop).
  await shrinkTextures(doc, { size: input.texSize, crop: input.cropTextures !== false });
  const tint = parseTint(input.tint);
  // Cards and foliage cut out by their texture's alpha; FX materials glow and blend (the tint is their glow colour).
  await applyAlphaCutout(doc);
  const fxMats = applyFxMaterials(doc, tint);
  // A posed export's own body is its baked meshes.
  const own = posed ? posed.map((x) => x.node) : [...ownNodes].filter((n) => !n.isDisposed() && n.getMesh());
  const paintOpts: PaintOptions = { asset: input.source.asset, ...(input.paint ? { paint: input.paint } : {}), ...(input.decals === false ? { decals: false } : {}) };
  const variants = input.paintVariants?.length ? await applyVariants(doc, own, input.paintVariants, warnings, paintOpts) : undefined;
  const fxOnly = fxMats.length > 0 && own.every((n) => n.getMesh()!.listPrimitives().every((p) => !p.getMaterial() || fxMats.includes(p.getMaterial()!)));
  // CS-FB-028: decals: false with no tint paints the decals over in the paint's own colour.
  if (!tint && !variants && input.decals === false && !fxOnly && !(await paintTint(doc, own, null, 0.16, paintOpts))) warnings.push('decals: no paint colour found in a texture, so nothing was painted over');
  if (tint && !fxOnly && !(await paintTint(doc, own, tint, 0.16, paintOpts))) {
    // No painted texture to recolour: the tint multiplies the model's own body materials (not glass, tyres or the
    // interior, not an attachment's).
    const mats = fallbackPaintMaterials(own, paintOpts);
    warnings.push(`tint: no paint colour found in a texture; ${mats.size ? `multiplied into the model's own body materials instead (${[...mats].map((m) => m.getName()).join(', ')}; give paint to name one)` : 'not applied (the model has no opaque material of its own)'}`);
    for (const m of mats) {
      if (!m) continue;
      const f = m.getBaseColorFactor();
      m.setBaseColorFactor([f[0] * tint[0], f[1] * tint[1], f[2] * tint[2], f[3]]);
    }
  }
  await encodeTextures(doc, input.texFormat);
  await doc.transform(prune({ keepLeaves: true, keepSolidTextures: true }));
  // CS-FB-002: a trimesh collider from the visual mesh (static models and baked poses; a skinned mesh moves).
  // Moving parts (wheels, the steering wheel, doors by default) are left out: a game moves them on their own.
  let trimesh: (ReturnType<typeof addColliderNode> & { excluded?: string[] }) | null = null;
  let convex: (ReturnType<typeof addColliderNode> & { excluded?: string[] }) | null = null;
  if (input.collider === 'trimesh' || input.collider === 'convex') {
    if (skinned && !posed) warnings.push(`collider ${input.collider}: a skinned character moves, so only the box is given (bake a pose for a static mesh)`);
    else {
      const ex = new Set((input.colliderExclude ?? MODEL_COLLIDER_EXCLUDE).map((x) => x.toLowerCase()));
      const excluded = parts
        .filter((p) => (p.role && ex.has(p.role.toLowerCase())) || ex.has(p.node.toLowerCase()) || [...ex].some((x) => p.node.toLowerCase().endsWith(`_${x}`)))
        .map((p) => p.node);
      const skip = new Set(excluded);
      const t = visualTrimesh(doc, exportRoot, (n) => skip.has(n.getName()) || !!lodPlan?.levels.some((l) => l.node === n));
      const more = excluded.length ? { excluded } : {};
      if (input.collider === 'trimesh') {
        if (t.idx.length) trimesh = { ...addColliderNode(doc, exportRoot, t.pos, t.idx), ...more };
      } else {
        const h = convexHull3(t.pos, input.convexMaxVertices ?? MODEL_CONVEX_MAX_VERTICES);
        if (h) convex = { ...addColliderNode(doc, exportRoot, h.pos, h.idx, true), ...more };
        else warnings.push('collider convex: the mesh is flat (no volume to hull), so only the box is given');
      }
    }
  }
  if (input.compress === 'meshopt') {
    await MeshoptEncoder.ready;
    meshesToChildren(doc);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  }

  // ---- manifest ----
  const mb = boundsOf(v3(bounds.min), v3(bounds.max));
  const wheelParts = parts.filter(isRoadWheel);
  const mapped = mapWheels(wheelParts.map((p) => ({ ...p, pos: p.pivot })));
  const wheels = mapped
    ? (Object.fromEntries(
        (Object.entries(mapped) as [WheelSlot, ModelPart & { pos: ModelVec3 }][]).map(([slot, p]) => [
          slot,
          { node: p.node, radius: p.radius ?? 0, axle: p.spinAxis ?? [1, 0, 0], steer: slot.startsWith('f'), pos: p.pivot } satisfies ModelWheel,
        ]),
      ) as Record<WheelSlot, ModelWheel>)
    : undefined;
  // Only a vehicle drives on its wheels: a pit box's casters are not worth a warning (OR-FB-023).
  if (wheelParts.length && !wheels && input.kind === 'vehicle') warnings.push(`${wheelParts.length} wheels could not be mapped to front/rear left/right`);
  // CS-FB-008 follow-up: a car (it has a steering wheel) whose geometry spans its wheels from above but is open from
  // the side is a frame or roll cage: its body is likely a separate asset (the name check above finds the usual ones).
  if (wheels && !skinned && input.kind === 'vehicle' && parts.some((p) => p.role === 'steering') && !warnings.some((w) => w.startsWith('no body mesh'))) {
    const moving = new Set(parts.filter((p) => isSpinRole(p.role) || p.role === 'wheel_door').map((p) => p.node));
    const body: Node[] = [];
    exportRoot.traverse((n) => {
      if (n.getMesh() && n.getName() !== 'collider' && !moving.has(n.getName()) && !moving.has(n.getParentNode()?.getName() ?? '')) body.push(n);
    });
    const bare = bareChassisCheck(worldTriangles(body), Object.values(wheels));
    if (bare)
      warnings.push(
        `no body mesh: ${input.source.asset} looks like a bare chassis (from above it fills its wheelbase, ${Math.round(bare.top * 100)} %, but its sides between the axles are only ${Math.round(bare.side * 100)} % covered); if its body is a separate asset, attach it`,
      );
  }
  const manifest: ModelManifest = {
    version: 1,
    name: input.name,
    source: input.source,
    units: 'm',
    forward: '+Z',
    up: '+Y',
    origin: input.origin,
    bounds: mb,
    parts,
    ...(wheels ? { wheels } : {}),
    sockets,
    clips,
    collider: { ...colliderOf(mb), ...(trimesh ? { trimesh } : {}), ...(convex ? { convex } : {}) },
    licence: MODEL_LICENCE,
    ...(input.fit ? { scale: { modelScale: Math.round(k * 1e6) / 1e6, fit: input.fit } } : {}),
    ...(variants ? { variants } : {}),
    ...(input.compress === 'meshopt' ? { compress: 'meshopt' as const } : {}),
    ...(skinned && !posed && poseName ? { pose: poseName } : {}),
    ...(posed ? { poses: posed.map((x) => x.info) } : {}),
    ...(swatches ? { swatches } : {}),
    ...(seats?.length ? { seats } : {}),
    ...(lods ? { lods } : {}),
    ...(dashboard?.gauges.length ? { dashboard } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  root.getAsset().generator = 'synty-sprite-generator model export';
  (root.getAsset() as { extras?: unknown }).extras = { manifest: `${input.name}.model.json` };
  const glb = await io.writeBinary(doc);
  return { glb, manifest };
}

/** The triangles of static mesh nodes where their nodes place them: 9 floats a triangle. */
export function worldTriangles(nodes: Node[]) {
  const out: number[] = [];
  const v: number[] = [];
  for (const n of nodes) {
    const m = Array.from(n.getWorldMatrix());
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      const pos = prim.getAttribute('POSITION');
      if (!pos || prim.getMode() !== 4) continue;
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < count; i += 3)
        for (let k = 0; k < 3; k++) out.push(...apply(m, pos.getElement(idx ? idx.getScalar(i + k) : i + k, v)));
    }
  }
  return new Float32Array(out);
}

/** Read a GLB file's bytes (for tests and the spike). */
export const readFile = (p: string) => new Uint8Array(fs.readFileSync(p));
