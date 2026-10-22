// Moved from synty-sprite-generator apps/server/src/modelSwatches.ts (P3, ali3b/sloponator#14).
import type { Document, Material, Node, Primitive, Texture } from '@gltf-transform/core';
import type { ModelSwatch } from '../spec/index.js';

/**
 * Split by swatch (OR-FB-022, ModelSpec.splitBySwatch). Synty paints a whole prop with one palette atlas, so a traffic
 * light's lamps are triangles of one mesh that happen to sample the red, amber and green swatches. Each triangle is
 * given the colour of the texel at its UV centre; the triangles of one colour become their own primitive with their
 * own material (a copy of the original, named `swatch_<hex>`) on a child node named `swatch_<hex>`. The vertex data is
 * shared, only the indices are split. A game finds the lamp nodes by colour and swaps or lights their materials.
 */

type Rgba = { data: Uint8Array | Buffer; w: number; h: number };

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** The texel a UV samples (nearest, wrapped), as #rrggbb. */
export function texelHex(img: Rgba, u: number, v: number) {
  const wrap = (x: number) => x - Math.floor(x);
  const x = Math.min(img.w - 1, Math.floor(wrap(u) * img.w)), y = Math.min(img.h - 1, Math.floor(wrap(v) * img.h));
  const o = (y * img.w + x) * 4;
  return `#${hex2(img.data[o])}${hex2(img.data[o + 1])}${hex2(img.data[o + 2])}`;
}

/** Each triangle's swatch colour: its UV centre's texel, or the material's base colour when it has no texture. */
export function triangleSwatches(prim: Primitive, img: Rgba | null, factor: number[]): string[] {
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : prim.getAttribute('POSITION')!.getCount();
  const at = (i: number) => (idx ? idx.getScalar(i) : i);
  const uv = prim.getAttribute('TEXCOORD_0');
  const flat = `#${hex2(factor[0] * 255)}${hex2(factor[1] * 255)}${hex2(factor[2] * 255)}`;
  const out: string[] = [];
  const t: number[] = [];
  for (let f = 0; f + 2 < count; f += 3) {
    if (!img || !uv) {
      out.push(flat);
      continue;
    }
    let u = 0, v = 0;
    for (let k = 0; k < 3; k++) {
      uv.getElement(at(f + k), t);
      u += t[0] / 3;
      v += t[1] / 3;
    }
    out.push(texelHex(img, u, v));
  }
  return out;
}

/**
 * Split the mesh of each of `nodes` by swatch: the node keeps its place (and part role) and loses its mesh; a child per
 * colour carries that colour's triangles. Returns the swatches (for the manifest) and the new child nodes.
 */
export async function splitBySwatch(doc: Document, nodes: Node[], warnings: string[]): Promise<{ swatches: ModelSwatch[]; children: Map<Node, Node[]> }> {
  const sharp = (await import('sharp')).default;
  const decoded = new Map<Texture, Rgba | null>();
  const decode = async (t: Texture | null) => {
    if (!t) return null;
    if (!decoded.has(t)) {
      try {
        const { data, info } = await sharp(Buffer.from(t.getImage()!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        decoded.set(t, { data, w: info.width, h: info.height });
      } catch {
        decoded.set(t, null);
      }
    }
    return decoded.get(t)!;
  };
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const plan: { node: Node; groups: Map<string, { prim: Primitive; tris: number[] }[]> }[] = [];
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const groups = new Map<string, { prim: Primitive; tris: number[] }[]>();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || !prim.getAttribute('POSITION')) continue;
      const mat = prim.getMaterial();
      const colours = triangleSwatches(prim, await decode(mat?.getBaseColorTexture() ?? null), mat?.getBaseColorFactor() ?? [1, 1, 1, 1]);
      colours.forEach((c, f) => {
        const list = groups.get(c) ?? [];
        let g = list.find((x) => x.prim === prim);
        if (!g) list.push((g = { prim, tris: [] }));
        g.tris.push(f);
        groups.set(c, list);
      });
    }
    if (groups.size) plan.push({ node, groups });
  }
  // `swatch_<hex>` when one node has that colour, else `<node>_swatch_<hex>`.
  const owners = new Map<string, number>();
  for (const p of plan) for (const c of p.groups.keys()) owners.set(c, (owners.get(c) ?? 0) + 1);
  const mats = new Map<string, Material>();
  const swatches: ModelSwatch[] = [];
  const children = new Map<Node, Node[]>();
  for (const { node, groups } of plan) {
    const kids: Node[] = [];
    for (const [c, parts] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const name = owners.get(c)! > 1 ? `${node.getName()}_swatch_${c.slice(1)}` : `swatch_${c.slice(1)}`;
      const mesh = doc.createMesh(name);
      let triangles = 0;
      for (const { prim, tris } of parts) {
        const src = prim.getIndices();
        const at = (i: number) => (src ? src.getScalar(i) : i);
        const vcount = prim.getAttribute('POSITION')!.getCount();
        const arr = vcount > 65535 ? new Uint32Array(tris.length * 3) : new Uint16Array(tris.length * 3);
        tris.forEach((f, i) => {
          for (let k = 0; k < 3; k++) arr[i * 3 + k] = at(f * 3 + k);
        });
        const out = prim.clone().setIndices(doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer));
        const base = prim.getMaterial();
        if (base) {
          const key = `${c}|${base.getName()}`;
          let m = mats.get(key);
          // extras.swatch keeps the copies apart through dedup (three.js: material.userData.swatch).
          if (!m) mats.set(key, (m = base.clone().setName(`swatch_${c.slice(1)}`).setExtras({ ...base.getExtras(), swatch: c })));
          out.setMaterial(m);
        }
        mesh.addPrimitive(out);
        triangles += tris.length;
      }
      const child = doc.createNode(name).setMesh(mesh);
      node.addChild(child);
      kids.push(child);
      swatches.push({ node: name, parent: node.getName(), color: c, triangles });
    }
    // The old mesh is left for the exporter's prune (its vertex data is shared with the swatch primitives).
    node.setMesh(null);
    children.set(node, kids);
  }
  if (swatches.length > 64) warnings.push(`splitBySwatch: ${swatches.length} swatches (a texture that is not a palette atlas splits into many pieces)`);
  return { swatches, children };
}
