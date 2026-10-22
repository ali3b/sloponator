// Moved from synty-sprite-generator apps/server/src/trackBuild.ts (P3, ali3b/sloponator#14).
import fs from 'node:fs';
import path from 'node:path';
import { Document, TextureInfo } from '@gltf-transform/core';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { MODEL_LICENCE, TRACK_DEFAULT_MATERIALS, TRACK_SLOTS, boundsOf, colliderOf, expandTrackpiece, parseTint, socketQuat, sweepTrack, type ModelManifest, type ModelSocket, type ModelTexFormat, type ModelTrackMaterial, type ModelVec3, type TrackSlot, type TrackpieceSpec } from '../spec/index.js';
import { addColliderNode, encodeTextures, meshesToChildren, modelIO, type BuildResult } from './modelBuild.js';

/**
 * Track pieces (CS-FB-001) as GLBs: the shared sweep (packages/shared trackpiece.ts) gives flat-shaded triangles per
 * material slot, a collider and the sockets; this file samples each slot's Synty swatch from the library and writes
 * the GLB (one palette material, so a piece is one draw) and its manifest. models.ts resolves and caches it.
 */

export interface SwatchSample {
  rgb: [number, number, number];
  /** UV of the swatch in its atlas, and the atlas' name. */
  uv: [number, number];
  texture: string;
  material: string;
}

/** A sampled swatch with where it came from (the manifest's source.materials entry, plus the colour as bytes). */
export type TrackMaterial = ModelTrackMaterial & { rgb: [number, number, number] };

const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

const swatchCache = new Map<string, SwatchSample>();

/**
 * The swatch a GLB shows most of (area-weighted texel colours at its triangles' UV centres, 5 bits a channel), or,
 * given a target colour, the one of its colours nearest it. `material` limits it to the primitives of that material.
 */
export async function sampleSwatch(glb: string, target?: [number, number, number] | null, material?: string): Promise<SwatchSample | null> {
  const st = fs.statSync(glb);
  const key = `${glb}|${st.size}:${Math.round(st.mtimeMs)}|${target?.join(',') ?? ''}|${material ?? ''}`;
  const hit = swatchCache.get(key);
  if (hit) return hit;
  const sharp = (await import('sharp')).default;
  const doc = await modelIO().read(glb);
  const decoded = new Map<unknown, { data: Buffer; w: number; h: number }>();
  const buckets = new Map<string, { area: number; sum: number[]; uv: [number, number]; best: number; texture: string; material: string }>();
  const pa: number[] = [], pb: number[] = [], pc: number[] = [], ua: number[] = [], ub: number[] = [], uc: number[] = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const m = n.getWorldMatrix();
    const tf = (v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat || (material && mat.getName().toLowerCase() !== material.toLowerCase())) continue;
      const tex = mat.getBaseColorTexture();
      const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute(`TEXCOORD_${mat.getBaseColorTextureInfo()?.getTexCoord() ?? 0}`);
      if (!tex || !tex.getImage() || !pos || !uv || mat.getAlphaMode() === 'BLEND') continue;
      if (!decoded.has(tex)) {
        const { data, info } = await sharp(Buffer.from(tex.getImage()!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        decoded.set(tex, { data, w: info.width, h: info.height });
      }
      const img = decoded.get(tex)!;
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < count; i += 3) {
        const [a, b, c] = [i, i + 1, i + 2].map((k) => (idx ? idx.getScalar(k) : k));
        const A = tf(pos.getElement(a, pa)), B = tf(pos.getElement(b, pb)), C = tf(pos.getElement(c, pc));
        const e1 = [0, 1, 2].map((k) => B[k] - A[k]), e2 = [0, 1, 2].map((k) => C[k] - A[k]);
        const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
        if (!(area > 0)) continue;
        uv.getElement(a, ua);
        uv.getElement(b, ub);
        uv.getElement(c, uc);
        const u = (ua[0] + ub[0] + uc[0]) / 3, v = (ua[1] + ub[1] + uc[1]) / 3;
        const fu = u - Math.floor(u), fv = v - Math.floor(v);
        const x = Math.min(img.w - 1, Math.floor(fu * img.w)), y = Math.min(img.h - 1, Math.floor(fv * img.h));
        const o = (y * img.w + x) * 4;
        const rgb = [img.data[o], img.data[o + 1], img.data[o + 2]];
        const k = `${tex.getName()}|${rgb.map((ch) => ch >> 3).join(',')}`;
        const bk = buckets.get(k) ?? { area: 0, sum: [0, 0, 0], uv: [fu, fv], best: 0, texture: tex.getName() || tex.getURI(), material: mat.getName() };
        bk.area += area;
        rgb.forEach((ch, j) => (bk.sum[j] += ch * area));
        // The UV of the biggest triangle in the bucket: the middle of a swatch, not its edge.
        if (area > bk.best) {
          bk.best = area;
          bk.uv = [fu, fv];
        }
        buckets.set(k, bk);
      }
    }
  }
  const all = [...buckets.values()].map((b) => ({ ...b, rgb: b.sum.map((v) => v / b.area) as [number, number, number] }));
  if (!all.length) return null;
  const dist = (c: number[]) => Math.hypot(c[0] - target![0], c[1] - target![1], c[2] - target![2]);
  const pick = target ? all.sort((a, b) => dist(a.rgb) - dist(b.rgb) || b.area - a.area)[0] : all.sort((a, b) => b.area - a.area)[0];
  const out: SwatchSample = { rgb: pick.rgb.map(Math.round) as [number, number, number], uv: [r4(pick.uv[0]), r4(pick.uv[1])], texture: pick.texture, material: pick.material };
  swatchCache.set(key, out);
  return out;
}

/** How models.ts finds library things for a material reference. */
export interface TrackLookup {
  /** An asset by "Pack/Name": its GLB file, or null when there is none. */
  asset: (ref: string) => { glb: string; pack: string; name: string; id: number } | null;
  /** The GLB of some asset of `pack` with a material named `material`, or null. */
  material: (pack: string, material: string) => { glb: string; pack: string; name: string; id: number } | null;
}

export class TrackMaterialError extends Error {}

/**
 * Each slot's swatch: the spec's reference or the default. A reference the library cannot give is an error; a default
 * whose pack is missing falls back to its colour with a warning.
 */
export async function resolveTrackMaterials(refs: Partial<Record<TrackSlot, string>> | undefined, lookup: TrackLookup) {
  return resolveMaterialSet(TRACK_SLOTS, refs, TRACK_DEFAULT_MATERIALS, lookup);
}

/** resolveTrackMaterials for any slot set (terrain's too): the spec's reference per slot, or the default with its fallback colour. */
export async function resolveMaterialSet<S extends string>(slots: readonly S[], refs: Partial<Record<S, string>> | undefined, defaults: Record<S, { ref: string; fallback: string }>, lookup: TrackLookup) {
  const out = {} as Record<S, TrackMaterial>;
  const warnings: string[] = [];
  const sources: string[] = [];
  for (const slot of slots) {
    const asked = refs?.[slot];
    const ref = asked ?? defaults[slot].ref;
    try {
      out[slot] = await resolveRef(ref, lookup, sources);
    } catch (e) {
      if (asked) throw new TrackMaterialError(`materials.${slot} "${ref}": ${(e as Error).message}`);
      const fb = defaults[slot].fallback;
      const rgb = parseTint(fb)!.map((v) => Math.round(v * 255)) as [number, number, number];
      out[slot] = { ref, color: fb, rgb, fallback: (e as Error).message };
      warnings.push(`materials.${slot}: the default ${ref} is not in the library (${(e as Error).message}); ${fb} used`);
    }
  }
  return { materials: out, warnings, sources };
}

async function resolveRef(ref: string, lookup: TrackLookup, sources: string[]): Promise<TrackMaterial> {
  if (ref.startsWith('#')) {
    const rgb = parseTint(ref)!.map((v) => Math.round(v * 255)) as [number, number, number];
    return { ref, color: hex(rgb), rgb };
  }
  const hash = ref.indexOf('#');
  const name = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
  const target = hash >= 0 ? parseTint(ref.slice(hash)) : null;
  if (hash >= 0 && !target) throw new Error('the colour after # must be #rrggbb');
  const want = target ? (target.map((v) => v * 255) as [number, number, number]) : null;
  const a = lookup.asset(name);
  let material: string | undefined;
  let src = a;
  if (!a) {
    const slash = name.indexOf('/');
    if (slash > 0) {
      src = lookup.material(name.slice(0, slash), name.slice(slash + 1));
      material = name.slice(slash + 1);
    }
  }
  if (!src) throw new Error('no asset or material of that name (give "Pack/Asset", "Pack/Material" or "#rrggbb")');
  const s = await sampleSwatch(src.glb, want, material);
  if (!s) throw new Error(`${src.name} has no textured surface to sample`);
  sources.push(`${src.glb}:${fs.statSync(src.glb).mtimeMs}`);
  return {
    ref, color: hex(s.rgb), rgb: s.rgb, pack: src.pack, ...(material ? { material: s.material } : { asset: src.name, assetId: src.id, material: s.material }),
    texture: s.texture, uv: s.uv,
  };
}

export interface TrackBuildInput {
  name: string;
  trackpiece: TrackpieceSpec;
  materials: Record<TrackSlot, TrackMaterial>;
  collider: 'box' | 'trimesh';
  texFormat: ModelTexFormat;
  compress?: 'meshopt';
  warnings?: string[];
}

/** The palette: an 8×8 block per slot, nearest-sampled; a slot's UV is its block's middle. */
const BLOCK = 8;

export async function buildTrackpiece(input: TrackBuildInput): Promise<BuildResult> {
  const sharp = (await import('sharp')).default;
  const warnings = [...(input.warnings ?? [])];
  const ex = expandTrackpiece(input.trackpiece);
  const m = sweepTrack(ex);
  warnings.push(...m.warnings);
  const doc = new Document();
  const buffer = doc.createBuffer();
  // The palette texture: one block per slot in the swatch's colour.
  const W = BLOCK * TRACK_SLOTS.length, H = BLOCK;
  const px = Buffer.alloc(W * H * 4);
  TRACK_SLOTS.forEach((slot, i) => {
    const c = input.materials[slot].rgb;
    for (let y = 0; y < H; y++) for (let x = 0; x < BLOCK; x++) px.set([c[0], c[1], c[2], 255], (y * W + i * BLOCK + x) * 4);
  });
  const png = new Uint8Array(await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
  const tex = doc.createTexture('TrackPalette').setImage(png).setMimeType('image/png').setURI('TrackPalette.png');
  const mat = doc.createMaterial('TrackPalette').setBaseColorTexture(tex).setRoughnessFactor(0.9).setMetallicFactor(0);
  const ti = mat.getBaseColorTextureInfo()!;
  ti.setMagFilter(TextureInfo.MagFilter.NEAREST).setMinFilter(TextureInfo.MinFilter.NEAREST).setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  TRACK_SLOTS.forEach((slot, i) => {
    const s = m.slots[slot];
    const u = (i * BLOCK + BLOCK / 2) / W, v = 0.5;
    pos.push(...s.pos);
    nrm.push(...s.nrm);
    for (let k = 0; k < s.pos.length / 3; k++) uv.push(u, v);
  });
  const count = pos.length / 3;
  const prim = doc
    .createPrimitive()
    .setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(count > 65535 ? Uint32Array.from({ length: count }, (_, i) => i) : Uint16Array.from({ length: count }, (_, i) => i)).setBuffer(buffer));
  const root = doc.createNode(input.name);
  const deck = doc.createNode(`${input.name}_mesh`).setMesh(doc.createMesh(input.name).addPrimitive(prim));
  root.addChild(deck);
  const scene = doc.createScene('Scene').addChild(root);
  doc.getRoot().setDefaultScene(scene);
  const trimesh = input.collider === 'trimesh' ? addColliderNode(doc, root, m.collider.pos, m.collider.idx) : null;
  await encodeTextures(doc, input.texFormat);
  await doc.transform(prune({ keepLeaves: true, keepSolidTextures: true }));
  if (input.compress === 'meshopt') {
    await MeshoptEncoder.ready;
    meshesToChildren(doc);
    // 16-bit positions: about 1 mm over a 65 m piece, so joined pieces still meet.
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16 }));
  }
  const b = boundsOf(m.bounds.min.map(r4) as ModelVec3, m.bounds.max.map(r4) as ModelVec3);
  const sockets: ModelSocket[] = m.sockets.map((s) => ({ name: s.name, node: input.name, pos: s.pos, rot: socketQuat(s.forward, s.up), forward: s.forward, up: s.up, dir: s.dir, edge: s.edge, width: s.width, bank: s.bank, ...(s.median ? { median: s.median } : {}) }));
  if (input.trackpiece.footprint) {
    const [fx, fz] = input.trackpiece.footprint;
    if (m.footprint.cells[0] > fx || m.footprint.cells[1] > fz)
      warnings.push(`footprint: the piece covers ${m.footprint.cells.join('×')} cells, more than the ${fx}×${fz} declared`);
  }
  const manifest: ModelManifest = {
    version: 1,
    name: input.name,
    source: {
      kind: 'trackpiece',
      preset: input.trackpiece.preset ?? null,
      materials: Object.fromEntries(TRACK_SLOTS.map((s) => {
        const { rgb: _rgb, ...rest } = input.materials[s];
        return [s, rest];
      })) as Record<TrackSlot, ModelTrackMaterial>,
    },
    units: 'm',
    forward: '+Z',
    up: '+Y',
    origin: 'entry',
    bounds: b,
    parts: [],
    sockets,
    clips: [],
    collider: { ...colliderOf(b), ...(trimesh ? { trimesh } : {}) },
    licence: MODEL_LICENCE,
    trackpiece: { cell: ex.cell, footprint: m.footprint.cells, gridMin: m.footprint.min, length: m.length, supports: m.supports },
    ...(input.compress === 'meshopt' ? { compress: 'meshopt' as const } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  doc.getRoot().getAsset().generator = 'synty-sprite-generator model export (trackpiece)';
  (doc.getRoot().getAsset() as { extras?: unknown }).extras = { manifest: `${input.name}.model.json` };
  const glb = await modelIO().writeBinary(doc);
  return { glb, manifest };
}

/** For scripts: write a build to a folder. */
export function writeBuild(dir: string, name: string, r: BuildResult) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.glb`), r.glb);
  fs.writeFileSync(path.join(dir, `${name}.model.json`), JSON.stringify(r.manifest, null, 2));
}
