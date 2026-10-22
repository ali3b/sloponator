// Moved from synty-sprite-generator apps/server/src/bundled.ts (P3, ali3b/sloponator#14): only the GLB reading
// (the JSON chunk and the bundled `*_Attach_*` meshes); the DB sync of bundled rows stays with the old ingest.
import fs from 'node:fs';
import { isBundledAttachment } from '@slop/library/synty';

/**
 * Bundled attachments: the `*_Attach_*` meshes Synty ships only inside a combined character file (POLYGON_Generic's
 * SM_Gen_Chr_Attach_Hair_01, Palm City's SM_Chr_Attach_LifeJacket_01, BattleRoyale's armour vests). `attach` names
 * them by mesh name; the exporter keeps only that mesh.
 */

export interface BundledMesh {
  name: string;
  /** Skinned to the file's skeleton (deforms with the character's bones), else a static mesh. */
  skinned: boolean;
  /** Rest-pose bounds in the file's (glTF) space, like meta.bounds. */
  bounds: { min: number[]; max: number[] } | null;
}

export interface GltfNode { name?: string; mesh?: number; skin?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
export interface GltfJson {
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
  materials?: { name?: string }[];
}

/** The JSON chunk of a GLB (no binary data is read). */
export function readGlbJson(file: string): GltfJson {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(20);
    fs.readSync(fd, head, 0, 20, 0);
    if (head.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
    const len = head.readUInt32LE(12);
    if (head.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${file}: first GLB chunk is not JSON`);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 20);
    return JSON.parse(buf.toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

type M4 = number[]; // column-major, like glTF
const ident = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function local(n: GltfNode): M4 {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** The `*_Attach_*` mesh nodes of a glTF, with whether each is skinned and its rest-pose bounds. */
export function bundledMeshes(g: GltfJson): BundledMesh[] {
  const nodes = g.nodes ?? [];
  const parent = new Map<number, number>();
  nodes.forEach((n, i) => n.children?.forEach((c) => parent.set(c, i)));
  const world = (i: number): M4 => {
    let m = local(nodes[i]);
    for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m = mul(local(nodes[p]), m);
    return m;
  };
  const out: BundledMesh[] = [];
  const seen = new Set<string>();
  nodes.forEach((n, i) => {
    if (n.mesh === undefined || !n.name || !isBundledAttachment(n.name) || seen.has(n.name)) return;
    seen.add(n.name);
    // Rest pose. glTF ignores a skinned mesh node's own transform: its joints at their bind pose put each vertex
    // where the accessor says (Blender exports metres there under a 0.01 armature). A static mesh follows its nodes.
    const m = n.skin !== undefined ? ident() : world(i);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of g.meshes?.[n.mesh]?.primitives ?? []) {
      const acc = g.accessors?.[p.attributes.POSITION];
      if (!acc?.min || !acc.max) continue;
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
        for (let r = 0; r < 3; r++) {
          const w = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r];
          lo[r] = Math.min(lo[r], w);
          hi[r] = Math.max(hi[r], w);
        }
      }
    }
    out.push({ name: n.name, skinned: n.skin !== undefined, bounds: lo[0] <= hi[0] ? { min: lo.map(round), max: hi.map(round) } : null });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One name for the same piece shipped two ways (SK_Chr_Attach_Female_Armor_01 = SM_Char_Attach_Female_Armor_01). */
export const pieceKey = (name: string) => name.replace(/^(SK|SM)_/i, '').replace(/(^|_)(Char|Character)_/i, '$1Chr_').toLowerCase();
