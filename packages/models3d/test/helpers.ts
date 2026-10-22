/**
 * Test helpers: a stand-in @slop/library built from plain rows (no SQLite, no data dir), and small GLBs built with
 * gltf-transform (a Synty-shaped prop: a textured box under a +90° X / 0.01 root, as the ingest writes them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import type { Animation, AnimationEntry, Asset, AssetEntry, AssetScale, Grip, IngestMeta, Library, Pack } from '@slop/library';
import { encodePng } from '../src/build/png.js';

export const Q_X90: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/** A flat 64×64 palette PNG texture. */
export function texture(doc: Document, rgb: [number, number, number] = [200, 200, 200]) {
  const data = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) data.set([...rgb, 255], i * 4);
  return doc.createTexture('palette').setMimeType('image/png').setImage(new Uint8Array(encodePng({ width: 64, height: 64, data })));
}

/** A box mesh between two corners with uvs. */
export function box(doc: Document, name: string, lo: number[], hi: number[], material: ReturnType<Document['createMaterial']>) {
  const buf = doc.getRoot().listBuffers()[0];
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (const [a, b, c, d] of faces) idx.push(a, b, c, a, c, d);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(16).fill(0.5)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
    .setMaterial(material);
  return doc.createMesh(name).addPrimitive(prim);
}

/** SM_Prop_Test_01: a 1 m × 2 m × 1 m crate in centimetres under a +90° X / 0.01 root, written to `file`. */
export async function propGlb(file: string, name = 'SM_Prop_Test_01', size: [number, number, number] = [100, 200, 100], rgb?: [number, number, number]) {
  const doc = new Document();
  doc.createBuffer();
  const mat = doc.createMaterial('MAT_01').setBaseColorTexture(texture(doc, rgb));
  const root = doc.createNode(name).setRotation(Q_X90).setScale([0.01, 0.01, 0.01]);
  // Local (FBX) frame: x across, y forward, z down (world y = -z, world z = y).
  root.setMesh(box(doc, 'crate', [-size[0] / 2, -size[2] / 2, -size[1]], [size[0] / 2, size[2] / 2, 0], mat));
  doc.createScene('Scene').addChild(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, doc);
}

export interface StubAsset extends Partial<Asset> {
  id: number;
  name: string;
  pack: string;
  /** The GLB file on disk (absolute). */
  glbFile?: string | null;
  meta?: IngestMeta | null;
  scaleFix?: number;
  grip?: Grip | null;
}

export interface StubAnimation extends Partial<Animation> {
  id: number;
  name: string;
  pack: string;
  /** Baked clip files by asset id (absolute paths), in place / with root motion. */
  bakes?: Record<number, { inPlace?: string; rm?: string }>;
}

export interface StubLibrary {
  dataDir?: string;
  packs?: Partial<Pack>[];
  assets?: StubAsset[];
  animations?: StubAnimation[];
}

/** A Library over plain rows: enough of the interface for the resolver, the clip lookup and the texture export. */
export function stubLibrary(s: StubLibrary): Library {
  const packs: Pack[] = (s.packs ?? []).map((p, i) => ({
    id: p.id ?? i + 1, name: p.name ?? `Pack${i + 1}`, version: 1, kind: p.kind ?? 'models', fileName: 'x.zip', dir: p.dir ?? `/nonexistent/${p.name ?? i}`, status: 'ready', message: null, createdAt: '', assets: 0, animations: 0, errors: 0,
  }));
  const packOf = (name: string) => packs.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const entry = (a: StubAsset): AssetEntry => {
    const pack = packOf(a.pack);
    const plain: Asset = {
      id: a.id, packId: pack?.id ?? 0, pack: a.pack, name: a.name, kind: a.kind ?? 'prop', status: a.status ?? 'ready', error: a.error ?? null, fbx: `${a.name}.fbx`, variant: a.variant ?? null,
      glb: a.glbFile ? `glb/${path.basename(a.glbFile)}` : null, thumb: null, bundled: a.bundled ?? null, category: a.category ?? null, damaged: false, slot: a.slot ?? null, size: null, modular: null,
      tags: a.tags ?? [], description: null, labels: {}, hidden: false,
    };
    const scale: AssetScale = { scale: a.scaleFix ?? 1, source: 'auto', auto: a.scaleFix ?? 1, extent: null, suspect: null };
    const methods = {
      glbPath: () => (a.glbFile && fs.existsSync(a.glbFile) ? a.glbFile : null),
      metaPath: () => null,
      meta: () => a.meta ?? null,
      thumbPath: () => null,
      fbxPath: () => `/nonexistent/${a.name}.fbx`,
      scale: () => scale,
      roles: () => (a.meta?.parts ?? []).map((p) => ({ name: p.name, local: p.name, role: p.role ?? null, ruleRole: p.role ?? null, overridden: false, ...(p.pivot ? { pivot: p.pivot } : {}), ...(p.spin_axis ? { spinAxis: p.spin_axis } : {}) })),
      rig: () => (a.meta?.rig ? { profile: a.meta.rig.profile as 'synty_legacy', score: 1, map: a.meta.rig.map ?? {}, bones: a.meta.bones ?? [] } : null),
      variants: () => ({ damaged: [], destroyed: [], broken: [] }) as unknown as ReturnType<AssetEntry['variants']>,
      grip: () => a.grip ?? null,
    };
    const e = { ...plain } as AssetEntry;
    for (const [k, v] of Object.entries(methods)) Object.defineProperty(e, k, { value: v, enumerable: false });
    return e;
  };
  const animEntry = (n: StubAnimation): AnimationEntry => {
    const pack = packOf(n.pack);
    const plain: Animation = {
      id: n.id, packId: pack?.id ?? 0, pack: n.pack, name: n.name, fbx: `${n.name}.fbx`, rig: n.rig === undefined ? 'synty_legacy' : n.rig, frames: null, fps: 30, loop: n.loop ?? false, category: n.category ?? null,
      set: n.set ?? null, gender: n.gender ?? null, rootMotion: n.rootMotion ?? false, status: 'ready', error: null, needsMapping: false, previousNames: n.previousNames ?? [], edit: n.edit ?? null,
    };
    const methods = {
      bakePath: (assetId: number, o: { inPlace?: boolean } = {}) => {
        const f = n.bakes?.[assetId]?.[o.inPlace ?? true ? 'inPlace' : 'rm'];
        return f && fs.existsSync(f) ? f : null;
      },
      bakeSpeed: () => null,
      metaPath: () => null,
      fbxPath: () => `/nonexistent/${n.name}.fbx`,
      bones: () => [],
    };
    const e = { ...plain } as AnimationEntry;
    for (const [k, v] of Object.entries(methods)) Object.defineProperty(e, k, { value: v, enumerable: false });
    return e;
  };
  const assets = (s.assets ?? []).map(entry);
  const anims = (s.animations ?? []).map(animEntry);
  const isId = (ref: number | string) => typeof ref === 'number' || /^\d+$/.test(String(ref).trim());
  return {
    dataDir: s.dataDir ?? '/nonexistent',
    dbPath: '/nonexistent/library.db',
    hasFts: false,
    packs: () => packs,
    pack: (ref) => (isId(ref) ? packs.find((p) => p.id === Number(ref)) : packOf(String(ref).replace(/[_ ]?v?\d+$/, '')) ?? packOf(String(ref))),
    assets: (q = {}) => {
      let list = assets.filter((a) => (q.status ?? 'ready') === 'all' || a.status === (q.status ?? 'ready'));
      if (q.pack !== undefined) {
        const p = isId(q.pack) ? packs.find((x) => x.id === Number(q.pack)) : packOf(String(q.pack));
        list = p ? list.filter((a) => a.packId === p.id) : [];
      }
      if (q.kind) list = list.filter((a) => (Array.isArray(q.kind) ? q.kind : [q.kind]).includes(a.kind));
      return list.slice(0, q.limit ?? 200);
    },
    asset: (ref) => {
      if (isId(ref)) return assets.find((a) => a.id === Number(ref));
      const sref = String(ref).trim();
      const i = sref.indexOf('/');
      const pack = i > 0 ? packOf(sref.slice(0, i)) : undefined;
      if (i > 0 && !pack) return undefined;
      const name = (i > 0 ? sref.slice(i + 1) : sref).toLowerCase();
      return assets.filter((a) => a.status === 'ready' && a.name.toLowerCase() === name && (!pack || a.packId === pack.id)).sort((a, b) => Number(!!a.variant) - Number(!!b.variant) || a.id - b.id)[0];
    },
    assetsNamed: (name) => assets.filter((a) => a.name.toLowerCase() === name.toLowerCase()),
    animations: () => anims,
    animation: (ref) => (isId(ref) ? anims.find((n) => n.id === Number(ref)) : anims.find((n) => n.name.toLowerCase() === String(ref).toLowerCase())),
    scaleOverrides: () => [],
    close: () => {},
  };
}
