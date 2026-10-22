// Moved from synty-sprite-generator apps/server/src/compositeBuild.ts (P3, ali3b/sloponator#14).
import { Document, type Node } from '@gltf-transform/core';
import { dedup, meshopt, mergeDocuments, prune, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { COMPOSITE_VERSION, MODEL_CONVEX_MAX_VERTICES, MODEL_EXPORTER_VERSION, MODEL_LICENCE, boundsOf, colliderOf, compositeMatrix, compositeQuat, compositeScale, convexHull3, defaultTexSize, specHash, type ModelCompositeInfo, type ModelGauge, type ModelManifest, type ModelPart, type ModelSpec, type ModelTexFormat, type ModelVec3, type NormalisedModelSpec } from '../spec/index.js';
import { canonicalJson, sha256 } from '@slop/sprites';
import { addColliderNode, encodeTextures, meshesToChildren, modelIO, shrinkTextures, visualTrimesh, worldTriangles, type BuildResult } from './modelBuild.js';

/**
 * Composite models (CS-FB-024): each part is built like an asset export (bottom-centre or its own pivot), but with
 * its whole atlases (no crop, no resize, the source encoding), so parts of one pack carry byte-identical textures.
 * The parts are merged under one root (a node per part carrying its placement), identical textures and materials are
 * shared, then the atlases are cropped to what the whole model uses, sized and encoded once.
 */

/** A part resolved by models.ts: its build (an intermediate asset export) and what it is. */
export interface CompositePartResolved {
  name: string;
  kind: string;
  sourceKey: string;
  build: () => Promise<BuildResult>;
}

export interface CompositeDeps {
  /** Resolve one part's spec (models.ts resolveSpec with whole atlases). */
  resolvePart: (spec: ModelSpec) => Promise<CompositePartResolved>;
  /** models.ts's error type: (message, status, code?, cache?). */
  error: (message: string, status?: number, code?: string, cache?: { id: string; name: string }) => Error;
}

export interface CompositeResolved {
  id: string;
  name: string;
  spec: NormalisedModelSpec;
  label: string;
  build: () => Promise<BuildResult>;
  sourceKey: string;
}

export async function resolveComposite(norm: NormalisedModelSpec, deps: CompositeDeps): Promise<CompositeResolved> {
  const name = norm.name!;
  const id = specHash(norm);
  const c = norm.composite!;
  const parts: (CompositePartResolved & { node: string; matrix: number[]; pos: ModelVec3; rot: [number, number, number, number]; scale: ModelVec3 })[] = [];
  for (const [i, p] of c.parts.entries()) {
    let r: CompositePartResolved;
    try {
      r = await deps.resolvePart({ asset: p.asset, ...(p.origin === 'pivot' ? { origin: 'pivot' } : {}), ...(p.attach ? { attach: p.attach } : {}), ...(p.tint ? { tint: p.tint } : {}), ...(p.paint ? { paint: p.paint } : {}), ...(p.decals === false ? { decals: false } : {}) });
    } catch (e) {
      const err = e as Error & { status?: number; code?: string };
      // CS-FB-010: a part's pack re-ingesting serves this composite's earlier export, when there is one.
      throw deps.error(`composite.parts[${i}] ${p.asset}: ${err.message}`, err.status ?? 500, err.code, err.code === 'pack-ingesting' ? { id, name } : undefined);
    }
    if (r.kind === 'character') throw deps.error(`composite.parts[${i}] ${p.asset} is a character: a composite is a static model of props, vehicles and buildings`);
    parts.push({ ...r, node: p.name!, matrix: compositeMatrix(p), pos: (p.pos ?? [0, 0, 0]) as ModelVec3, rot: compositeQuat(p.rot).map((v) => Math.round(v * 1e6) / 1e6 + 0) as [number, number, number, number], scale: compositeScale(p.scale) });
  }
  const sourceKey = sha256(canonicalJson({ v: MODEL_EXPORTER_VERSION, composite: COMPOSITE_VERSION, parts: parts.map((p) => p.sourceKey) }));
  // Not asked for: the largest default of the parts' kinds (props 256, vehicles 1024).
  const texSize = norm.texSize ?? Math.max(...parts.map((p) => defaultTexSize(p.kind)));
  return {
    id, name, spec: norm, label: `composite ${name}`, sourceKey,
    build: async () => {
      const built = [];
      for (const p of parts) built.push({ ...p, result: await p.build() });
      return buildComposite({
        name, parts: built, texSize, texFormat: norm.texFormat, compress: norm.compress,
        collider: norm.collider === 'trimesh' || norm.collider === 'convex' ? norm.collider : 'box',
        convexMaxVertices: norm.convexMaxVertices ?? MODEL_CONVEX_MAX_VERTICES,
      });
    },
  };
}

export interface CompositeBuildInput {
  name: string;
  parts: { node: string; matrix: number[]; pos: ModelVec3; rot: [number, number, number, number]; scale: ModelVec3; result: BuildResult }[];
  texSize: number;
  texFormat: ModelTexFormat;
  compress?: 'meshopt';
  collider: 'box' | 'trimesh' | 'convex';
  convexMaxVertices: number;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const apply = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const applyDir = (m: number[], v: number[]) => {
  const d = [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return d.map((x) => r4(x / l)) as ModelVec3;
};

function boxOf(tris: Float32Array) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], tris[i + k]);
        hi[k] = Math.max(hi[k], tris[i + k]);
      }
  return lo[0] <= hi[0] ? boundsOf(lo.map(r4) as ModelVec3, hi.map(r4) as ModelVec3) : null;
}

export async function buildComposite(input: CompositeBuildInput): Promise<BuildResult> {
  const warnings: string[] = [];
  const doc = new Document();
  doc.createBuffer();
  const root = doc.createNode(input.name);
  const scene = doc.createScene('Scene').addChild(root);
  doc.getRoot().setDefaultScene(scene);
  const io = modelIO();
  const sources: { pack: string; asset: string; assetId: number }[] = [];
  const parts: ModelPart[] = [];
  const gauges: ModelGauge[] = [];
  const placed: { node: Node; info: Omit<ModelCompositeInfo['parts'][number], 'bounds'> }[] = [];
  for (const p of input.parts) {
    const src = await io.readBinary(p.result.glb);
    const map = mergeDocuments(doc, src);
    const srcScene = map.get(src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0]) as ReturnType<Document['createScene']>;
    const node = doc.createNode(p.node).setTranslation(p.pos).setRotation(p.rot).setScale(p.scale);
    for (const child of srcScene.listChildren()) {
      srcScene.removeChild(child);
      node.addChild(child);
    }
    srcScene.dispose();
    root.addChild(node);
    for (const a of doc.getRoot().listAnimations()) a.dispose();
    const m = p.result.manifest;
    if (node.listChildren().some((n) => { let skinned = false; n.traverse((x) => void (x.getSkin() && (skinned = true))); return skinned; }))
      throw new Error(`part ${p.node} is skinned: a composite is a static model`);
    const s = m.source as { pack: string; asset: string; assetId: number };
    sources.push(s);
    // Its parts (wheels, doors) with their pivots and axes in the composite's frame.
    for (const q of m.parts) {
      const out: ModelPart = { ...q, pivot: apply(p.matrix, q.pivot).map(r4) as ModelVec3 };
      if (q.spinAxis) out.spinAxis = applyDir(p.matrix, q.spinAxis);
      if (q.radius !== undefined) out.radius = r4(q.radius * Math.cbrt(Math.abs(p.scale[0] * p.scale[1] * p.scale[2])));
      if (q.hinge) out.hinge = { pos: out.pivot, axis: applyDir(p.matrix, q.hinge.axis) };
      if (q.axis) out.axis = applyDir(p.matrix, q.axis);
      parts.push(out);
    }
    // CS-FB-023: a part's dials and needles, in the composite's frame.
    const k = Math.cbrt(Math.abs(p.scale[0] * p.scale[1] * p.scale[2]));
    for (const g of m.dashboard?.gauges ?? [])
      gauges.push({
        ...g,
        center: apply(p.matrix, g.center).map(r4) as ModelVec3,
        normal: applyDir(p.matrix, g.normal),
        radius: r4(g.radius * k),
        ...(g.needle
          ? { needle: { ...g.needle, pivot: apply(p.matrix, g.needle.pivot).map(r4) as ModelVec3, axis: applyDir(p.matrix, g.needle.axis), rest: applyDir(p.matrix, g.needle.rest), length: r4(g.needle.length * k) } }
          : {}),
      });
    for (const w of m.warnings ?? []) warnings.push(`${p.node}: ${w}`);
    placed.push({ node, info: { node: p.node, pack: s.pack, asset: s.asset, assetId: s.assetId, pos: p.pos, rot: p.rot, scale: p.scale } });
  }
  // One buffer, then identical textures and materials of different parts shared.
  await doc.transform(unpartition(), dedup(), prune({ keepLeaves: true, keepSolidTextures: true }));
  await shrinkTextures(doc, { size: input.texSize, crop: true });
  await encodeTextures(doc, input.texFormat);
  await doc.transform(prune({ keepLeaves: true, keepSolidTextures: true }));

  const meshNodes = (n: Node) => {
    const out: Node[] = [];
    n.traverse((x) => void (x.getMesh() && x.getName() !== 'collider' && out.push(x)));
    return out;
  };
  const all = boxOf(worldTriangles(meshNodes(root)));
  if (!all) throw new Error('the composite has no geometry');
  const info: ModelCompositeInfo = {
    parts: placed.map(({ node, info: i }) => ({ ...i, bounds: boxOf(worldTriangles(meshNodes(node))) ?? all })),
    materials: doc.getRoot().listMaterials().length,
    textures: doc.getRoot().listTextures().length,
  };
  let trimesh: ReturnType<typeof addColliderNode> | null = null;
  let convex: ReturnType<typeof addColliderNode> | null = null;
  if (input.collider !== 'box') {
    const t = visualTrimesh(doc, root);
    if (input.collider === 'trimesh') trimesh = t.idx.length ? addColliderNode(doc, root, t.pos, t.idx) : null;
    else {
      const h = convexHull3(t.pos, input.convexMaxVertices);
      if (h) convex = addColliderNode(doc, root, h.pos, h.idx, true);
      else warnings.push('collider convex: the composite is flat (no volume to hull), so only the box is given');
    }
  }
  if (input.compress === 'meshopt') {
    await MeshoptEncoder.ready;
    meshesToChildren(doc);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  }
  const manifest: ModelManifest = {
    version: 1,
    name: input.name,
    source: { kind: 'composite', parts: input.parts.map((p, i) => ({ name: p.node, pack: sources[i].pack, asset: sources[i].asset, assetId: sources[i].assetId })) },
    units: 'm',
    forward: '+Z',
    up: '+Y',
    origin: 'composite',
    bounds: all,
    parts,
    sockets: [],
    clips: [],
    collider: { ...colliderOf(all), ...(trimesh ? { trimesh } : {}), ...(convex ? { convex } : {}) },
    licence: MODEL_LICENCE,
    composite: info,
    ...(gauges.length ? { dashboard: { gauges } } : {}),
    ...(input.compress === 'meshopt' ? { compress: 'meshopt' as const } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  doc.getRoot().getAsset().generator = 'synty-sprite-generator model export (composite)';
  (doc.getRoot().getAsset() as { extras?: unknown }).extras = { manifest: `${input.name}.model.json` };
  return { glb: await io.writeBinary(doc), manifest };
}
