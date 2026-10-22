// Moved from synty-sprite-generator apps/web/src/export/frameCache.ts (P2, ali3b/sloponator#9): the fingerprints that go
// into frame-cache keys (clip data, the prepared scene, the asset record) and the PNG strips one clip × direction's
// frames are encoded in. The store itself (lookup/get/put over HTTP, the zipped entry) stayed behind: the Node runner
// keeps entries on disk (packages/render/src/frameStore.ts) and computes the keys with @slop/sprites.
import { Sha256, stripColumns } from '@slop/sprites';
import type * as THREE from 'three';

const round = (x: number) => Math.round(x * 1e5) / 1e5;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Stable names for the nodes of a scene (traversal order and name), so tracks that address nodes by uuid (procedural
 * templates do: a fresh uuid every time the model loads) hash the same from one load to the next.
 */
export function nodeNames(roots: THREE.Object3D[]): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  for (const r of roots) r.traverse((o) => void (out.has(o.uuid) || out.set(o.uuid, `#${i++}:${o.name}`)));
  return out;
}

/**
 * Hash of a clip's keyframes after every edit (trim, speed, reverse, cap, template params): what it plays. Node uuids
 * in track names are replaced by their stable names (nodeNames).
 */
export function clipDataHash(clip: THREE.AnimationClip | null, names?: Map<string, string>): string {
  if (!clip) return 'none';
  const h = new Sha256().update(`${round(clip.duration)}|${clip.tracks.length}`);
  for (const t of clip.tracks) {
    const name = t.name.replace(UUID, (u) => names?.get(u) ?? names?.get(u.toUpperCase()) ?? u);
    h.update(`\n${name}|${t.ValueTypeName}|${t.getInterpolation()}|${t.times.length}|${t.values.length}|`);
    h.update(t.times);
    h.update(t.values as ArrayBufferView);
  }
  return h.hex();
}

/** Plain data out of userData (grips, fixes, item info): vectors and quaternions as rounded arrays, objects dropped. */
function plain(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? round(v) : String(v);
  if (depth > 4 || typeof v !== 'object') return undefined;
  const o = v as { isVector3?: boolean; isQuaternion?: boolean; isEuler?: boolean; isVector2?: boolean; isMatrix4?: boolean; toArray?: () => number[]; constructor?: unknown };
  if ((o.isVector3 || o.isQuaternion || o.isVector2 || o.isMatrix4) && o.toArray) return o.toArray().map(round);
  if (o.isEuler && o.toArray) return (o.toArray() as unknown[]).map((x) => (typeof x === 'number' ? round(x) : x));
  if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1)).filter((x) => x !== undefined);
  if (o.constructor !== Object) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) {
    const x = plain((v as Record<string, unknown>)[k], depth + 1);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

function materialSig(m: THREE.Material): string {
  const x = m as THREE.MeshStandardMaterial & { color?: THREE.Color; emissive?: THREE.Color };
  const tex = (t: THREE.Texture | null | undefined) => {
    if (!t) return null;
    const img = t.image as { width?: number; height?: number; src?: string } | undefined;
    return [t.name, img?.width ?? 0, img?.height ?? 0, typeof img?.src === 'string' && !img.src.startsWith('blob:') ? img.src : '', t.flipY, t.colorSpace];
  };
  return JSON.stringify([
    m.type, m.name, m.visible, round(m.opacity), m.transparent, m.blending, m.side, m.depthWrite, m.alphaTest, m.vertexColors,
    x.color?.getHexString() ?? null, x.emissive?.getHexString() ?? null, x.emissiveIntensity ?? null, x.roughness ?? null, x.metalness ?? null,
    tex(x.map), tex(x.emissiveMap), tex(x.normalMap), tex(x.alphaMap), plain(m.userData),
  ]);
}

/**
 * A fingerprint of the prepared scene: its structure, geometry, materials (tints, looks), the mounted items and their
 * grips and placement fixes. Bones and held items are posed by every clip, so their current pose is left out (the
 * holders' default grips and fixes in userData are kept); other nodes keep their transforms.
 */
export function sceneFingerprint(roots: THREE.Object3D[], holders: THREE.Object3D[] = []): string {
  const h = new Sha256();
  const held = new Set(holders);
  const seenGeo = new Set<THREE.BufferGeometry>();
  const seen = new Set<THREE.Object3D>();
  for (const root of [...roots, ...holders]) {
    root.traverse((o) => {
      if (seen.has(o)) return;
      seen.add(o);
      const bone = (o as THREE.Bone).isBone === true;
      const tf = held.has(o)
        ? [...o.position.toArray(), ...o.scale.toArray()]
        : bone ? [] : [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()];
      h.update(`\n${o.type}|${o.name}|${o.parent?.name ?? ''}|${o.visible}|${tf.map(round).join(',')}|${o.children.length}|${JSON.stringify(plain(o.userData))}`);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const g = m.geometry;
        h.update(`g${g.index?.count ?? 0}:${Object.entries(g.attributes).map(([k, a]) => `${k}${a.count}x${a.itemSize}`).join(',')}|${Object.keys(g.morphAttributes).join(',')}`);
        if (!seenGeo.has(g)) {
          seenGeo.add(g);
          const pos = g.attributes.position;
          if (pos && 'array' in pos) h.update(pos.array as ArrayBufferView);
          if (g.index) h.update(g.index.array as ArrayBufferView);
        }
        for (const mat of ([] as THREE.Material[]).concat(m.material)) h.update(materialSig(mat));
        if (m.morphTargetInfluences?.length) h.update(m.morphTargetInfluences.map(round).join(','));
      }
    });
  }
  return h.hex();
}

/** The asset record minus what never changes a pixel (AI tags, thumbnails, status), for a cache key. */
export function assetIdentity(a: Record<string, unknown>): Record<string, unknown> {
  const { aiTags: _t, aiDescription: _d, taggedAt: _a, thumb: _th, status: _s, error: _e, ...rest } = a;
  return rest;
}

// ---- strips: one clip × direction's frames in one PNG per sheet and layer ----

type Canvas = HTMLCanvasElement;

const makeCanvas = (w: number, h: number): Canvas => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const pngBytes = (c: Canvas) => new Promise<Uint8Array>((resolve, reject) =>
  c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('could not encode a frame strip'))), 'image/png'));

/** Collects the frames of one strip in order; `done` once every frame has landed. */
export class StripWriter {
  private canvas: Canvas;
  private ctx: CanvasRenderingContext2D;
  private landed = 0;
  readonly cols: number;

  constructor(readonly n: number, readonly w: number, readonly h: number) {
    this.cols = stripColumns(n, w);
    this.canvas = makeCanvas(this.cols * w, Math.ceil(n / this.cols) * h);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Frame `i` (null: a frame left transparent, still counted). */
  put(i: number, frame: Canvas | null) {
    if (frame) this.ctx.drawImage(frame, (i % this.cols) * this.w, Math.floor(i / this.cols) * this.h);
    this.landed++;
  }

  get done() {
    return this.landed >= this.n;
  }

  async encode() {
    const b = await pngBytes(this.canvas);
    this.canvas.width = 0;
    this.canvas.height = 0;
    return b;
  }

  /** The strip as base64 PNG (what crosses from the page to the Node runner). */
  async encodeBase64() {
    const b = await this.encode();
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
    return btoa(s);
  }
}
