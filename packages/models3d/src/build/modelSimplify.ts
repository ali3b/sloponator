// Moved from synty-sprite-generator apps/server/src/modelSimplify.ts (P3, ali3b/sloponator#14).
import type { Accessor, Document, Mesh, Primitive } from '@gltf-transform/core';
import { simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * Simplification (OR-FB-011, CS-FB-025). Synty meshes are flat-shaded (each corner carries its face's normal), so the
 * normals go first and the vertices are welded on what is left (position, UVs, joints and weights); meshopt then
 * simplifies with the mesh's open borders locked, so pieces modelled apart (a palm's trunk segments, a fence's
 * planks) keep meeting where they met instead of opening gaps; flat normals are given back (the faceted look).
 *
 * Foliage is mostly leaf cards: separate quads that no edge collapse can merge, so a tree kept nearly all its
 * triangles. When a primitive is still well over its target and most of it is small loose pieces (cards of a few
 * triangles), whole cards are thinned out, spread evenly over the crown, and the cards kept are grown a little about
 * their own centres so the crown keeps its cover.
 */

/** A loose piece of at most this many triangles is a card. */
const CARD_TRIANGLES = 12;
/** Cards kept are grown by at most this. */
const MAX_CARD_GROWTH = 1.6;

const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array } as const;

export const triangles = (p: Primitive) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;

function bufferOf(doc: Document) {
  return doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
}

function copyAccessor(doc: Document, a: Accessor, data: ArrayLike<number>) {
  const Ctor = ARRAYS[a.getComponentType() as keyof typeof ARRAYS] ?? Float32Array;
  return doc.createAccessor().setType(a.getType()).setArray(new Ctor(Array.from(data))).setNormalized(a.getNormalized()).setBuffer(bufferOf(doc));
}

/** Every triangle on its own three vertices (attributes copied out through the indices); keeps the given triangles only. */
export function deindexPrimitive(doc: Document, prim: Primitive, keep?: (tri: number) => boolean) {
  const idx = prim.getIndices();
  const at = (i: number) => (idx ? idx.getScalar(i) : i);
  const tris: number[] = [];
  for (let f = 0; f < triangles(prim); f++) if (!keep || keep(f)) tris.push(f);
  const el: number[] = [];
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem)!;
    const size = a.getElementSize();
    const out = new Float64Array(tris.length * 3 * size);
    tris.forEach((f, t) => {
      for (let k = 0; k < 3; k++) {
        a.getElement(at(f * 3 + k), el);
        for (let c = 0; c < size; c++) out[(t * 3 + k) * size + c] = el[c];
      }
    });
    prim.setAttribute(sem, copyAccessor(doc, a, out));
  }
  prim.setIndices(null);
}

/** Flat normals: each corner gets its face's normal (a primitive with its own vertices per triangle). */
export function flatNormals(doc: Document, prim: Primitive) {
  const pos = prim.getAttribute('POSITION');
  if (!pos || prim.getIndices()) return;
  const n = pos.getCount();
  const out = new Float32Array(n * 3);
  const a: number[] = [], b: number[] = [], c: number[] = [];
  for (let f = 0; f + 2 < n; f += 3) {
    pos.getElement(f, a);
    pos.getElement(f + 1, b);
    pos.getElement(f + 2, c);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 3; k++) out.set([nx / l, ny / l, nz / l], (f + k) * 3);
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(bufferOf(doc)));
}

/** Loose pieces of a primitive (triangles joined through shared positions): a component id per triangle. */
export function looseComponents(prim: Primitive): { comp: Int32Array; sizes: number[] } {
  const pos = prim.getAttribute('POSITION')!;
  const idx = prim.getIndices();
  const at = (i: number) => (idx ? idx.getScalar(i) : i);
  const nt = triangles(prim);
  const key = new Map<string, number>();
  const el: number[] = [];
  const vid = (i: number) => {
    pos.getElement(at(i), el);
    const k = `${Math.round(el[0] * 1e4)},${Math.round(el[1] * 1e4)},${Math.round(el[2] * 1e4)}`;
    let v = key.get(k);
    if (v === undefined) key.set(k, (v = key.size));
    return v;
  };
  const tv: number[] = [];
  for (let f = 0; f < nt; f++) tv.push(vid(f * 3), vid(f * 3 + 1), vid(f * 3 + 2));
  const parent = Int32Array.from({ length: key.size }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let f = 0; f < nt; f++) {
    const r = find(tv[f * 3]);
    parent[find(tv[f * 3 + 1])] = r;
    parent[find(tv[f * 3 + 2])] = r;
  }
  const ids = new Map<number, number>();
  const comp = new Int32Array(nt);
  const sizes: number[] = [];
  for (let f = 0; f < nt; f++) {
    const r = find(tv[f * 3]);
    let c = ids.get(r);
    if (c === undefined) {
      ids.set(r, (c = ids.size));
      sizes.push(0);
    }
    comp[f] = c;
    sizes[c]++;
  }
  return { comp, sizes };
}

/** A well-spread order of n items (a stride coprime with n): thinning by it leaves an even spread. */
function spreadOrder(n: number) {
  let stride = Math.max(1, Math.round(n * 0.618));
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  while (n > 1 && gcd(stride, n) !== 1) stride++;
  return Array.from({ length: n }, (_, i) => (i * stride) % Math.max(1, n));
}

/**
 * Thin a primitive's cards towards `target` triangles (see the module comment). Returns the triangles removed.
 * The primitive comes out de-indexed.
 */
export function thinCards(doc: Document, prim: Primitive, target: number): number {
  const before = triangles(prim);
  if (before <= target) return 0;
  const { comp, sizes } = looseComponents(prim);
  const cards = sizes.map((s, c) => ({ c, s })).filter((x) => x.s <= CARD_TRIANGLES);
  const cardTris = cards.reduce((a, x) => a + x.s, 0);
  // Only foliage: most of the primitive is cards.
  if (cardTris < before * 0.5 || cards.length < 8) return 0;
  const need = before - target;
  const order = spreadOrder(cards.length);
  const drop = new Set<number>();
  let removed = 0;
  // Never drop every card: keep at least an eighth of them.
  for (const i of order) {
    if (removed >= need || drop.size >= cards.length - Math.ceil(cards.length / 8)) break;
    drop.add(cards[i].c);
    removed += cards[i].s;
  }
  if (!removed) return 0;
  const kept = cardTris - removed;
  const grow = Math.min(MAX_CARD_GROWTH, Math.sqrt(cardTris / Math.max(1, kept)));
  deindexPrimitive(doc, prim, (f) => !drop.has(comp[f]));
  if (grow > 1.001) {
    // Grow each kept card about its centre (positions only; the de-indexed triangles are in component order).
    const pos = prim.getAttribute('POSITION')!;
    const { comp: c2, sizes: s2 } = looseComponents(prim);
    const sum = s2.map(() => [0, 0, 0, 0]);
    const el: number[] = [];
    const n = pos.getCount();
    for (let v = 0; v < n; v++) {
      pos.getElement(v, el);
      const s = sum[c2[Math.floor(v / 3)]];
      s[0] += el[0];
      s[1] += el[1];
      s[2] += el[2];
      s[3]++;
    }
    const arr = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      pos.getElement(v, el);
      const c = c2[Math.floor(v / 3)];
      const s = sum[c];
      const g = s2[c] <= CARD_TRIANGLES ? grow : 1;
      for (let k = 0; k < 3; k++) arr[v * 3 + k] = s[k] / s[3] + (el[k] - s[k] / s[3]) * g;
    }
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(bufferOf(doc)));
  }
  return removed;
}

/**
 * Simplify these meshes' primitives to about `ratio` of their triangles each. Returns the triangle counts before and
 * after (all primitives together). Triangle primitives only; morph targets are dropped (none on Synty models).
 */
export async function simplifyMeshList(doc: Document, meshes: Mesh[], ratio: number): Promise<{ before: number; after: number }> {
  await MeshoptSimplifier.ready;
  let before = 0, after = 0;
  const seen = new Set<Primitive>();
  for (const m of meshes)
    for (const p of m.listPrimitives()) {
      if (seen.has(p) || p.getMode() !== 4 || !p.getAttribute('POSITION')) continue;
      seen.add(p);
      const n0 = triangles(p);
      before += n0;
      const target = Math.max(1, Math.round(n0 * ratio));
      p.setAttribute('NORMAL', null).setAttribute('TANGENT', null);
      for (const t of p.listTargets()) p.removeTarget(t);
      weldPrimitive(p);
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: true });
      const skinned = !!p.getAttribute('JOINTS_0');
      if (!skinned && triangles(p) > target * 1.15) thinCards(doc, p, target);
      if (p.getIndices()) deindexPrimitive(doc, p);
      flatNormals(doc, p);
      after += triangles(p);
    }
  return { before, after };
}
