// Moved from synty-sprite-generator apps/server/src/terrainBuild.ts (P3, ali3b/sloponator#14).
import { Document, TextureInfo, type Material, type Node, type Primitive } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, EXTMeshoptCompression, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { mergeDocuments, prune, reorder, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { MODEL_LICENCE, TERRAIN_SLOTS, boundsOf, buildSkyMesh, buildTerrainMesh, colliderOf, expandSkydome, expandTerrain, placeRing, renderPanorama, ringColour, srgbToLinear, type ModelManifest, type ModelTerrainInfo, type ModelTexFormat, type ModelTrackMaterial, type ModelVec3, type RingProp, type SkydomeSpec, type TerrainSlot, type TerrainSpec } from '../spec/index.js';
import { addColliderNode, encodeTextures, modelIO, worldTriangles, type BuildResult } from './modelBuild.js';
import type { TrackMaterial } from './trackBuild.js';

/**
 * Terrain (CS-FB-003) and skydomes (CS-FB-004) as GLBs: the shared maths (packages/shared terrain.ts, skydome.ts)
 * gives triangles, the collider, scatter spots and ring placements; this file adds Synty swatch materials, the
 * scatter props as GPU instances and the ring props' triangles, and writes the manifest. models.ts resolves the
 * materials and exports the props (metres, bottom-centre) through the model cache first.
 */

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/** A library prop already exported as a GLB (metres, bottom-centre origin). */
export interface PropGlb {
  ref: string;
  glb: Uint8Array;
  pack: string;
  asset: string;
  assetId: number;
}

export interface TerrainBuildInput {
  name: string;
  terrain: TerrainSpec;
  materials: Record<TerrainSlot, TrackMaterial>;
  /** One per scatter item, in order (null when the prop could not be exported: its spots are dropped with a warning). */
  props: (PropGlb | null)[];
  collider: 'box' | 'trimesh';
  texFormat: ModelTexFormat;
  compress?: 'meshopt';
  warnings?: string[];
}

const BLOCK = 4;
const SHADES = 3;

/** A palette texture: per slot three shades side by side (block BLOCK px each); returns the PNG and each (slot, shade) UV. */
async function palette(colors: [number, number, number][], shade: number) {
  const sharp = (await import('sharp')).default;
  const W = BLOCK * SHADES * colors.length, H = BLOCK;
  const px = Buffer.alloc(W * H * 4);
  colors.forEach((c, i) => {
    for (let k = 0; k < SHADES; k++) {
      const f = 1 + (k - 1) * shade;
      const rgb = c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
      for (let y = 0; y < H; y++) for (let x = 0; x < BLOCK; x++) px.set([rgb[0], rgb[1], rgb[2], 255], (y * W + (i * SHADES + k) * BLOCK + x) * 4);
    }
  });
  const png = new Uint8Array(await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
  return { png, uv: (slot: number, k: number): [number, number] => [((slot * SHADES + k) * BLOCK + BLOCK / 2) / W, 0.5] };
}

function nearest(mat: Material) {
  const ti = mat.getBaseColorTextureInfo()!;
  ti.setMagFilter(TextureInfo.MagFilter.NEAREST).setMinFilter(TextureInfo.MinFilter.NEAREST).setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);
}

const quatYawUp = (yaw: number, up: number[]): [number, number, number, number] => {
  const qy: [number, number, number, number] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const ny = Math.max(-1, Math.min(1, up[1]));
  const ax = [up[2], 0, -up[0]];
  const al = Math.hypot(ax[0], ax[2]);
  if (al < 1e-9) return qy;
  const ang = Math.acos(ny);
  const s = Math.sin(ang / 2) / al;
  const qa = [ax[0] * s, 0, ax[2] * s, Math.cos(ang / 2)];
  // qa * qy
  return [
    qa[3] * qy[0] + qa[0] * qy[3] + qa[1] * qy[2] - qa[2] * qy[1],
    qa[3] * qy[1] - qa[0] * qy[2] + qa[1] * qy[3] + qa[2] * qy[0],
    qa[3] * qy[2] + qa[0] * qy[1] - qa[1] * qy[0] + qa[2] * qy[3],
    qa[3] * qy[3] - qa[0] * qy[0] - qa[1] * qy[1] - qa[2] * qy[2],
  ];
};

/** Column-major 4×4 helpers. */
const apply = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const applyDir = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);

/**
 * A prop's static meshes merged into `doc`, each primitive's vertices baked into the prop's root frame (so an
 * instance transform places it), materials kept. Returns the primitives (one new mesh) or null when it has none.
 */
async function importProp(doc: Document, glb: Uint8Array, name: string) {
  const src = await modelIO().readBinary(glb);
  const map = mergeDocuments(doc, src);
  const scene = map.get(src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0]) as ReturnType<Document['createScene']> | undefined;
  if (!scene) return null;
  const buffer = doc.getRoot().listBuffers()[0];
  const mesh = doc.createMesh(name);
  const v: number[] = [];
  scene.traverse((n: Node) => {
    const m = n.getMesh();
    if (!m || n.getSkin() || n.getName() === 'collider') return;
    const M = Array.from(n.getWorldMatrix());
    for (const p of m.listPrimitives()) {
      if (p.getMode() !== 4) continue;
      const out = doc.createPrimitive().setMaterial(p.getMaterial());
      for (const sem of p.listSemantics()) {
        const acc = p.getAttribute(sem)!;
        if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'].includes(sem)) continue;
        const count = acc.getCount();
        const size = acc.getElementSize();
        const arr = new Float32Array(count * size);
        for (let i = 0; i < count; i++) {
          acc.getElement(i, v);
          let e = v.slice(0, size);
          if (sem === 'POSITION') e = apply(M, e);
          else if (sem === 'NORMAL') {
            const d = applyDir(M, e);
            const l = Math.hypot(d[0], d[1], d[2]) || 1;
            e = d.map((x) => x / l);
          }
          arr.set(e, i * size);
        }
        out.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(arr).setBuffer(buffer));
      }
      const idx = p.getIndices();
      if (idx) out.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(Array.from(idx.getArray()!))).setBuffer(buffer));
      mesh.addPrimitive(out);
    }
  });
  // The prop's own scene and nodes go; prune drops what nothing uses.
  const old: Node[] = [];
  scene.traverse((n: Node) => void old.push(n));
  for (const n of old) n.dispose();
  scene.dispose();
  await doc.transform(unpartition());
  return mesh.listPrimitives().length ? mesh : (mesh.dispose(), null);
}

function finishDoc(doc: Document) {
  doc.getRoot().getAsset().generator = 'synty-sprite-generator model export (terrain)';
}

/**
 * Write the GLB. meshopt here compresses the float data as it is (reordered, no quantisation): neighbouring tiles
 * keep bit-identical edges, a 2 km grid keeps millimetres, and instanced nodes keep their meshes.
 */
async function writeOut(doc: Document, texFormat: ModelTexFormat, compress: 'meshopt' | undefined) {
  await encodeTextures(doc, texFormat);
  await doc.transform(prune({ keepLeaves: true, keepSolidTextures: true }));
  if (compress === 'meshopt') {
    await MeshoptEncoder.ready;
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  }
  return modelIO().writeBinary(doc);
}

const materialsOf = (mats: Record<string, TrackMaterial>) =>
  Object.fromEntries(Object.entries(mats).map(([k, m]) => {
    const { rgb: _rgb, ...rest } = m;
    return [k, rest];
  })) as Record<TerrainSlot, ModelTrackMaterial>;

export async function buildTerrain(input: TerrainBuildInput): Promise<BuildResult> {
  const warnings = [...(input.warnings ?? [])];
  const ex = expandTerrain(input.terrain);
  const m = buildTerrainMesh(ex);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const LAND = TERRAIN_SLOTS.filter((s): s is Exclude<TerrainSlot, 'water'> => s !== 'water');
  const pal = await palette(LAND.map((s) => input.materials[s].rgb), ex.shade);
  const tex = doc.createTexture('TerrainPalette').setImage(pal.png).setMimeType('image/png').setURI('TerrainPalette.png');
  const mat = doc.createMaterial('TerrainPalette').setBaseColorTexture(tex).setRoughnessFactor(0.95).setMetallicFactor(0);
  nearest(mat);
  const w = input.materials.water.rgb.map((c) => srgbToLinear(c / 255));
  const water = doc.createMaterial('TerrainWater').setBaseColorFactor([w[0], w[1], w[2], 0.85]).setAlphaMode('BLEND').setRoughnessFactor(0.15).setMetallicFactor(0);
  const root = doc.createNode(input.name);
  const scene = doc.createScene('Scene').addChild(root);
  doc.getRoot().setDefaultScene(scene);
  const f32 = (a: number[]) => doc.createAccessor().setType('VEC3').setArray(new Float32Array(a)).setBuffer(buffer);
  const indices = (count: number) => doc.createAccessor().setType('SCALAR').setArray(count > 65535 ? Uint32Array.from({ length: count }, (_, i) => i) : Uint16Array.from({ length: count }, (_, i) => i)).setBuffer(buffer);
  const chunks: ModelTerrainInfo['chunks'] = [];
  const waterNodes: string[] = [];
  for (const ch of m.chunks) {
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
    LAND.forEach((slot, si) => {
      const s = ch.slots[slot];
      pos.push(...s.pos);
      nrm.push(...s.nrm);
      s.shade.forEach((k) => {
        const [u, vv] = pal.uv(si, k);
        uv.push(u, vv, u, vv, u, vv);
      });
    });
    if (!pos.length) continue;
    const count = pos.length / 3;
    const prim: Primitive = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', f32(pos)).setAttribute('NORMAL', f32(nrm))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer)).setIndices(indices(count));
    root.addChild(doc.createNode(ch.name).setMesh(doc.createMesh(ch.name).addPrimitive(prim)));
    chunks.push({ node: ch.name, tiles: ch.tiles, triangles: count / 3 });
    if (ch.water.pos.length) {
      const wn = ch.name.replace(/^terrain/, 'water');
      const wp = doc.createPrimitive().setMaterial(water).setAttribute('POSITION', f32(ch.water.pos)).setAttribute('NORMAL', f32(ch.water.nrm)).setIndices(indices(ch.water.pos.length / 3));
      root.addChild(doc.createNode(wn).setMesh(doc.createMesh(wn).addPrimitive(wp)).setExtras({ water: true }));
      waterNodes.push(wn);
    }
  }
  const trimesh = input.collider === 'trimesh' ? addColliderNode(doc, root, m.collider.pos, m.collider.idx) : null;

  // Scatter: each prop's mesh once, instanced at its spots (EXT_mesh_gpu_instancing; three.js r150+ loads it as an InstancedMesh).
  const scatter: ModelTerrainInfo['scatter'] = [];
  if (ex.scatter.length) {
    const inst = doc.createExtension(EXTMeshGPUInstancing).setRequired(true);
    for (let k = 0; k < ex.scatter.length; k++) {
      const spots = m.spots.filter((s) => s.item === k);
      const prop = input.props[k];
      if (!prop) continue;
      if (!spots.length) {
        warnings.push(`scatter[${k}] ${ex.scatter[k].asset}: no spot fits (density, maxSlope, on, clear)`);
        continue;
      }
      const node = `scatter_${k}`;
      const mesh = await importProp(doc, prop.glb, node);
      if (!mesh) {
        warnings.push(`scatter[${k}] ${prop.asset}: no static mesh to scatter`);
        continue;
      }
      const T: number[] = [], R: number[] = [], S: number[] = [];
      for (const s of spots) {
        T.push(...s.pos);
        R.push(...quatYawUp(s.yaw, s.up));
        S.push(s.scale, s.scale, s.scale);
      }
      const im = inst.createInstancedMesh()
        .setAttribute('TRANSLATION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(T)).setBuffer(buffer))
        .setAttribute('ROTATION', doc.createAccessor().setType('VEC4').setArray(new Float32Array(R)).setBuffer(buffer))
        .setAttribute('SCALE', doc.createAccessor().setType('VEC3').setArray(new Float32Array(S)).setBuffer(buffer));
      root.addChild(doc.createNode(node).setMesh(mesh).setExtension('EXT_mesh_gpu_instancing', im));
      scatter.push({ asset: prop.asset, pack: prop.pack, assetId: prop.assetId, node, count: spots.length });
    }
  }
  finishDoc(doc);
  (doc.getRoot().getAsset() as { extras?: unknown }).extras = { manifest: `${input.name}.model.json` };
  const glb = await writeOut(doc, input.texFormat, input.compress);
  const b = boundsOf(m.bounds.min.map(r4) as ModelVec3, m.bounds.max.map(r4) as ModelVec3);
  const manifest: ModelManifest = {
    version: 1,
    name: input.name,
    source: { kind: 'terrain', tile: input.terrain.tile ?? null, ...(input.terrain.tile && (input.terrain.dir ?? defaultDir(input.terrain.tile)) ? { dir: input.terrain.dir ?? defaultDir(input.terrain.tile)! } : {}), materials: materialsOf(input.materials) },
    units: 'm',
    forward: '+Z',
    up: '+Y',
    origin: 'tile',
    bounds: b,
    parts: [],
    sockets: [],
    clips: [],
    collider: { ...colliderOf(b), ...(trimesh ? { trimesh } : {}) },
    licence: MODEL_LICENCE,
    terrain: {
      cell: ex.cell, step: ex.step, tiles: [ex.cols, ex.rows], gridMin: m.gridMin, subdiv: ex.subdiv, shape: ex.shape, chunks,
      water: m.waterTiles ? { level: ex.level, nodes: waterNodes, tiles: m.waterTiles } : null,
      scatter,
    },
    ...(input.compress === 'meshopt' ? { compress: 'meshopt' as const } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  return { glb, manifest };
}

const defaultDir = (tile: string) => ({ slope: 'N', 'corner-outer': 'NE', 'corner-inner': 'NE', coast: 'NE' })[tile] as string | undefined;

// ---- skydome -------------------------------------------------------------------------------------------------
export interface SkydomeBuildInput {
  name: string;
  skydome: SkydomeSpec;
  /** The ring props (those the library has), in the order of the expanded ring's assets. */
  props: PropGlb[];
  texFormat: ModelTexFormat;
  compress?: 'meshopt';
  warnings?: string[];
}

/** A build with files beside the GLB (models.ts writes them into the export's folder; the manifest names them). */
export type BuildWithFiles = BuildResult & { files?: { name: string; data: Uint8Array }[] };

const RING_TRIS = 600;

/** A triangle soup (9 floats a triangle) welded on position alone and simplified towards `target` triangles. */
async function simplifySoup(tris: Float32Array, target: number): Promise<Float32Array> {
  await MeshoptSimplifier.ready;
  const at = new Map<string, number>();
  const pos: number[] = [];
  const idx = new Uint32Array(tris.length / 3);
  for (let i = 0; i < tris.length; i += 3) {
    const k = `${Math.round(tris[i] * 1e3)},${Math.round(tris[i + 1] * 1e3)},${Math.round(tris[i + 2] * 1e3)}`;
    let v = at.get(k);
    if (v === undefined) {
      at.set(k, (v = pos.length / 3));
      pos.push(tris[i], tris[i + 1], tris[i + 2]);
    }
    idx[i / 3] = v;
  }
  const P = new Float32Array(pos);
  const [out] = MeshoptSimplifier.simplify(idx, P, 3, target * 3, 0.05);
  const res = new Float32Array(out.length * 3);
  for (let i = 0; i < out.length; i++) res.set(P.subarray(out[i] * 3, out[i] * 3 + 3), i * 3);
  return res;
}

export async function buildSkydome(input: SkydomeBuildInput): Promise<BuildWithFiles> {
  const warnings = [...(input.warnings ?? [])];
  const ex = expandSkydome(input.skydome);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const unlit = doc.createExtension(KHRMaterialsUnlit);
  const mat = doc.createMaterial('Skydome').setDoubleSided(true).setRoughnessFactor(1).setMetallicFactor(0).setExtension('KHR_materials_unlit', unlit.createUnlit());
  const root = doc.createNode(input.name);
  const scene = doc.createScene('Scene').addChild(root);
  doc.getRoot().setDefaultScene(scene);
  const lin = (c: number[]) => c.map(srgbToLinear);
  const sky = buildSkyMesh(ex);
  const col: number[] = [];
  for (let i = 0; i < sky.col.length; i += 3) col.push(...lin(sky.col.slice(i, i + 3)));
  const domePrim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(sky.pos)).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(sky.idx)).setBuffer(buffer));
  root.addChild(doc.createNode('dome').setMesh(doc.createMesh('dome').addPrimitive(domePrim)));

  // The ring: each prop's triangles (in its frame), placed all round, coloured by haze and height.
  let ring: { node: string; props: number; triangles: number } | null = null;
  let ringTris: { pos: number[]; col: number[] } = { pos: [], col: [] };
  if (ex.ring && input.props.length) {
    const shapes: { tris: Float32Array; prop: RingProp }[] = [];
    for (const p of input.props) {
      const d = await modelIO().readBinary(p.glb);
      const nodes: Node[] = [];
      d.getRoot().getDefaultScene()?.traverse((n) => void (n.getMesh() && !n.getSkin() && n.getName() !== 'collider' && nodes.push(n)));
      let tris = worldTriangles(nodes);
      // A distant silhouette needs few triangles: simplify a detailed prop down to about RING_TRIS.
      if (tris.length / 9 > RING_TRIS) tris = await simplifySoup(tris, RING_TRIS);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
      for (let i = 0; i < tris.length; i += 3) {
        x0 = Math.min(x0, tris[i]);
      x1 = Math.max(x1, tris[i]);
        y1 = Math.max(y1, tris[i + 1]);
        z0 = Math.min(z0, tris[i + 2]);
      z1 = Math.max(z1, tris[i + 2]);
      }
      if (!tris.length || y1 <= 0) {
        warnings.push(`ring ${p.ref}: no geometry above the ground`);
        continue;
      }
      shapes.push({ tris, prop: { width: x1 - x0, depth: z1 - z0, height: y1 } });
    }
    const places = placeRing(ex, shapes.map((s) => s.prop));
    const pos: number[] = [], rc: number[] = [], srgb: number[] = [];
    for (const pl of places) {
      const { tris, prop } = shapes[pl.prop];
      const c = Math.cos(pl.yaw), s = Math.sin(pl.yaw);
      for (let i = 0; i < tris.length; i += 3) {
        const x = tris[i] * pl.scale, y = Math.max(0, tris[i + 1]) * pl.scale, z = tris[i + 2] * pl.scale;
        // Turned about +Y by yaw (+Z → (sin, 0, cos)), then moved out.
        pos.push(pl.pos[0] + c * x + s * z, y - 0.5, pl.pos[2] - s * x + c * z);
        const cc = ringColour(ex, pl.haze, tris[i + 1] / prop.height);
        srgb.push(...cc);
        rc.push(...lin(cc));
      }
    }
    if (pos.length) {
      const prim = doc.createPrimitive().setMaterial(mat)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
        .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(rc)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(pos.length / 3 > 65535 ? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) : Uint16Array.from({ length: pos.length / 3 }, (_, i) => i)).setBuffer(buffer));
      root.addChild(doc.createNode('ring').setMesh(doc.createMesh('ring').addPrimitive(prim)));
      ring = { node: 'ring', props: places.length, triangles: pos.length / 9 };
    }
    ringTris = { pos, col: srgb };
  } else if (ex.ring) warnings.push('ring: none of its props is in the library; the dome has no silhouettes');
  finishDoc(doc);
  doc.getRoot().getAsset().generator = 'synty-sprite-generator model export (skydome)';
  (doc.getRoot().getAsset() as { extras?: unknown }).extras = { manifest: `${input.name}.model.json` };
  const glb = await writeOut(doc, input.texFormat, input.compress);
  const R = ex.radius;
  const b = boundsOf([-R, -R, -R], [R, R, R]);
  const files: { name: string; data: Uint8Array }[] = [];
  let panorama: { file: string; width: number; height: number } | null = null;
  if (ex.panorama) {
    const sharp = (await import('sharp')).default;
    const rgb = renderPanorama(ex, ringTris, ex.panorama);
    const file = `${input.name}_panorama.png`;
    files.push({ name: file, data: new Uint8Array(await sharp(Buffer.from(rgb), { raw: { width: ex.panorama, height: ex.panorama / 2, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer()) });
    panorama = { file, width: ex.panorama, height: ex.panorama / 2 };
  }
  const manifest: ModelManifest = {
    version: 1,
    name: input.name,
    source: { kind: 'skydome', preset: ex.preset, ring: input.props.map((p) => ({ ref: p.ref, pack: p.pack, asset: p.asset, assetId: p.assetId })) },
    units: 'm',
    forward: '+Z',
    up: '+Y',
    origin: 'centre',
    bounds: b,
    parts: [],
    sockets: [],
    clips: [],
    collider: colliderOf(b),
    licence: MODEL_LICENCE,
    skydome: { radius: R, colors: ex.colors, dome: 'dome', ring, panorama },
    ...(input.compress === 'meshopt' ? { compress: 'meshopt' as const } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  return { glb, manifest, files };
}
