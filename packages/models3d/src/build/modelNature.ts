// Moved from synty-sprite-generator apps/server/src/modelNature.ts (P3, ali3b/sloponator#14).
import { TextureInfo, type Document, type Material, type Node, type Primitive, type Texture } from '@gltf-transform/core';
import type { NatureMaterial } from './natureMaterials.js';
import { looseComponents } from './modelSimplify.js';

/**
 * Synty nature shader materials in an export (see natureMaterials.ts for where they come from): foliage meshes split
 * into a leaf part (cards on the leaf texture, alpha-cut, both sides) and a trunk part (the palette atlas), and
 * triplanar ground given UVs projected along the world axes, per face: grass on top, rock on the sides.
 */

/**
 * A triangle whose UVs span more than this share of the texture samples a leaf texture (palette triangles sit inside one
 * swatch, a few hundredths of the atlas: Meadow Forest's trunk under 0.02, its leaf cards the whole texture; Fantasy
 * Village's leaf clusters 0.05–0.3).
 */
export const LEAF_UV_SPAN = 0.04;
/** Metres one repeat of a triplanar texture covers. */
export const TRIPLANAR_TILE_M = 6;

const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array } as const;

function indexAccessor(doc: Document, idx: number[], vertices: number) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  return doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(vertices > 65535 ? new Uint32Array(idx) : new Uint16Array(idx))
    .setBuffer(buffer);
}

const triCount = (p: Primitive) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
const vid = (p: Primitive) => {
  const idx = p.getIndices();
  return (i: number) => (idx ? idx.getScalar(i) : i);
};

/**
 * Each triangle of a primitive is leaf (its UVs span much of the texture) or trunk (a palette swatch), decided per
 * loose piece (triangles joined through shared positions) by the most of its triangles, so a card or a branch is never
 * cut in two.
 */
export function leafTriangles(prim: Primitive, span = LEAF_UV_SPAN): boolean[] {
  const uv = prim.getAttribute('TEXCOORD_0');
  const n = triCount(prim);
  if (!uv) return new Array(n).fill(false);
  const at = vid(prim);
  const wide: boolean[] = [];
  const t: number[] = [];
  for (let f = 0; f < n; f++) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      uv.getElement(at(f * 3 + k), t);
      u0 = Math.min(u0, t[0]);
      u1 = Math.max(u1, t[0]);
      v0 = Math.min(v0, t[1]);
      v1 = Math.max(v1, t[1]);
    }
    wide.push(Math.max(u1 - u0, v1 - v0) > span);
  }
  const { comp, sizes } = looseComponents(prim);
  const votes = sizes.map(() => 0);
  wide.forEach((w, f) => w && votes[comp[f]]++);
  return wide.map((_, f) => votes[comp[f]] * 2 > sizes[comp[f]]);
}

/** The axis a triplanar shader projects a face along: 0 top, 1 side, 2 bottom (by its normal in metres). */
export function triplanarFace(n: number[]): 0 | 1 | 2 {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const y = n[1] / l;
  return y > 0.7 ? 0 : y < -0.7 ? 2 : 1;
}

/** UVs of a point (metres) on a face projected along its dominant axis; v runs down the texture, so up is up. */
export function triplanarUv(p: number[], n: number[], tile = TRIPLANAR_TILE_M): [number, number] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0] / tile, p[2] / tile];
  if (ax >= az) return [p[2] / tile, -p[1] / tile];
  return [p[0] / tile, -p[1] / tile];
}

/** Give a primitive its own vertices per triangle (every attribute copied out through the indices). */
function deindex(doc: Document, prim: Primitive) {
  const at = vid(prim);
  const n = triCount(prim) * 3;
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem)!;
    const size = a.getElementSize();
    const Ctor = ARRAYS[a.getComponentType() as keyof typeof ARRAYS] ?? Float32Array;
    const out = new Ctor(n * size);
    const el: number[] = [];
    for (let i = 0; i < n; i++) {
      a.getElement(at(i), el);
      for (let k = 0; k < size; k++) out[i * size + k] = el[k];
    }
    prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(out).setNormalized(a.getNormalized()).setBuffer(buffer));
  }
  prim.setIndices(null);
}

export interface NatureOptions {
  /** The source's scale fix (source units → metres), for triplanar tiling. */
  scale: number;
  /** PNG bytes of a texture file. */
  read: (file: string) => Uint8Array;
}

/**
 * Apply the nature materials (by mesh node name) to these nodes' meshes. Returns the names of the nodes changed.
 * Run before transforms are baked (node world matrices place triplanar faces).
 */
export function applyNatureMaterials(doc: Document, nodes: Node[], nature: Record<string, NatureMaterial>, o: NatureOptions): string[] {
  const textures = new Map<string, Texture>();
  const mats = new Map<string, Material>();
  const textureOf = (file: string) => {
    let t = textures.get(file);
    if (!t) {
      const name = file.split(/[\\/]/).pop()!.replace(/\.\w+$/, '');
      t = doc.createTexture(name).setImage(o.read(file)).setMimeType('image/png').setURI(`${name}.png`);
      textures.set(file, t);
    }
    return t;
  };
  const materialOf = (base: Material | null, slot: string, kind: 'leaf' | 'trunk' | 'ground', file: string) => {
    const key = `${slot}|${kind}|${file}`;
    let m = mats.get(key);
    if (!m) {
      const name = `${slot}_${kind === 'leaf' ? 'Leaf' : kind === 'trunk' ? 'Trunk' : file.split(/[\\/]/).pop()!.replace(/\.\w+$/, '')}`;
      m = (base ? base.clone() : doc.createMaterial()).setName(name).setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(textureOf(file));
      m.setMetallicFactor(0).setRoughnessFactor(1).setNormalTexture(null).setEmissiveTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null);
      const info = m.getBaseColorTextureInfo()!;
      info.setTexCoord(0);
      if (kind === 'leaf') m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
      else m.setAlphaMode('OPAQUE');
      // The trunk is a palette atlas: sampled nearest (crisp swatches, as the ingest sets its atlases).
      if (kind === 'trunk') info.setMagFilter(TextureInfo.MagFilter.NEAREST);
      if (kind === 'ground') info.setWrapS(TextureInfo.WrapMode.REPEAT).setWrapT(TextureInfo.WrapMode.REPEAT);
      mats.set(key, m);
    }
    return m;
  };
  const stem = (s: string | undefined | null) => (s ?? '').split(/[\\/]/).pop()!.replace(/\.\w+$/, '').toLowerCase();
  const changed: string[] = [];
  const done = new Set<unknown>();
  for (const node of nodes) {
    const nm = nature[node.getName()];
    const mesh = node.getMesh();
    if (!nm || !mesh || done.has(mesh)) continue;
    done.add(mesh);
    let did = false;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || !prim.getAttribute('POSITION')) continue;
      const base = prim.getMaterial();
      if (nm.only && stem(base?.getBaseColorTexture()?.getName() || base?.getBaseColorTexture()?.getURI() || base?.getName()) !== nm.only.toLowerCase()) continue;
      if (nm.top && nm.side) {
        // ---- triplanar: per-face projection along the world axes, in metres ----
        deindex(doc, prim);
        const pos = prim.getAttribute('POSITION')!;
        const w = Array.from(node.getWorldMatrix());
        const ap = (v: number[]) => [0, 1, 2].map((r) => (w[r] * v[0] + w[4 + r] * v[1] + w[8 + r] * v[2] + w[12 + r]) * o.scale);
        const n = pos.getCount();
        const uvs = new Float32Array(n * 2);
        const groups: number[][] = [[], [], []];
        const el: number[] = [];
        for (let f = 0; f < n / 3; f++) {
          const p = [0, 1, 2].map((k) => ap(pos.getElement(f * 3 + k, el)));
          const e1 = [0, 1, 2].map((k) => p[1][k] - p[0][k]), e2 = [0, 1, 2].map((k) => p[2][k] - p[0][k]);
          const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          groups[triplanarFace(nrm)].push(f * 3, f * 3 + 1, f * 3 + 2);
          for (let k = 0; k < 3; k++) uvs.set(triplanarUv(p[k], nrm), (f * 3 + k) * 2);
        }
        const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
        for (const sem of prim.listSemantics()) if (/^TEXCOORD_/.test(sem)) prim.setAttribute(sem, null);
        prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer));
        const files = [nm.top, nm.side, nm.bottom ?? nm.side];
        // Faces sharing a texture share a primitive.
        const byFile = new Map<string, number[]>();
        groups.forEach((g, i) => g.length && byFile.set(files[i], [...(byFile.get(files[i]) ?? []), ...g]));
        let first = true;
        for (const [file, idx] of byFile) {
          const target = first ? prim : prim.clone();
          target.setIndices(indexAccessor(doc, idx, n)).setMaterial(materialOf(base, nm.slot, 'ground', file));
          if (!first) mesh.addPrimitive(target);
          first = false;
        }
        did = true;
        continue;
      }
      // ---- foliage: leaf cards on the leaf texture, the rest on the trunk atlas ----
      const leafFile = nm.leaf, trunkFile = nm.trunk;
      if (leafFile && trunkFile && leafFile !== trunkFile) {
        const leaf = leafTriangles(prim);
        const at = vid(prim);
        const li: number[] = [], ti: number[] = [];
        leaf.forEach((isLeaf, f) => (isLeaf ? li : ti).push(at(f * 3), at(f * 3 + 1), at(f * 3 + 2)));
        const n = prim.getAttribute('POSITION')!.getCount();
        if (!li.length || !ti.length) prim.setMaterial(materialOf(base, nm.slot, li.length ? 'leaf' : 'trunk', li.length ? leafFile : trunkFile));
        else {
          const leafPrim = prim.clone();
          prim.setIndices(indexAccessor(doc, ti, n)).setMaterial(materialOf(base, nm.slot, 'trunk', trunkFile));
          leafPrim.setIndices(indexAccessor(doc, li, n)).setMaterial(materialOf(base, nm.slot, 'leaf', leafFile));
          mesh.addPrimitive(leafPrim);
        }
        did = true;
      } else {
        // One texture for the whole mesh (branch cards, grass, a billboard tree card): only when the ingest's differs.
        const file = leafFile ?? trunkFile!;
        const cur = base?.getBaseColorTexture();
        if (stem(cur?.getName() || cur?.getURI()) === stem(file)) continue;
        prim.setMaterial(materialOf(base, nm.slot, leafFile ? 'leaf' : 'trunk', file));
        did = true;
      }
    }
    if (did) changed.push(node.getName());
  }
  return changed;
}

/** For tests: the triangle count of each primitive's material. */
export function trianglesByMaterial(nodes: Node[]) {
  const out: Record<string, number> = {};
  for (const n of nodes) for (const p of n.getMesh()?.listPrimitives() ?? []) out[p.getMaterial()?.getName() ?? '-'] = (out[p.getMaterial()?.getName() ?? '-'] ?? 0) + triCount(p);
  return out;
}
