// Moved from synty-sprite-generator packages/shared/src/model3d/composite.ts (P3, ali3b/sloponator#14).
/**
 * Composite models (CS-FB-024): one model built from several library assets placed at offsets (a gas station canopy
 * over two pumps, an office block and its roof), merged into one GLB with shared materials. Pure checks and maths;
 * the server exports each part and merges them (compositeBuild.ts). docs/MODELS.md "Composite models" is the contract.
 */

export type CompositeVec3 = [number, number, number];

export const COMPOSITE_PART_ORIGINS = ['bottom-centre', 'pivot'] as const;
export type CompositePartOrigin = (typeof COMPOSITE_PART_ORIGINS)[number];

/** One part: a library asset and where it goes in the composite's frame (metres, +Y up, +Z forward). */
export interface CompositePart {
  /** Asset id, name or "Pack/Name". */
  asset: string | number;
  /** Its node in the GLB (default the asset's name; repeats get _2, _3…). */
  name?: string;
  /** Position in metres (default [0, 0, 0]). */
  pos?: CompositeVec3;
  /** Degrees: a number turns it about +Y (yaw, + to the left); [x, y, z] are Euler angles applied X, then Y, then Z (three.js 'XYZ'). */
  rot?: number | CompositeVec3;
  /** A uniform scale, or [x, y, z] (default 1). */
  scale?: number | CompositeVec3;
  /**
   * Where the part's own origin is before it is placed: bottom-centre (default, as an export) or pivot (the source
   * model's own origin, so modular Synty pieces authored in one frame line up at the same pos).
   */
  origin?: CompositePartOrigin;
  /** Extra pieces of this part, as ModelSpec.attach. */
  attach?: string[];
  /** Recolour this part's paint (#rrggbb), as ModelSpec.tint. */
  tint?: string;
  /** The paint its tint recolours, as ModelSpec.paint (`#rrggbb` or a material name). */
  paint?: string;
  /** false: its decals are painted over, as ModelSpec.decals. */
  decals?: boolean;
}

export interface CompositeSpec {
  parts: CompositePart[];
}

/** Bump when the merge changes for the same spec: cached composites rebuild. */
export const COMPOSITE_VERSION = 1;
export const COMPOSITE_MAX_PARTS = 64;

export class CompositeSpecError extends Error {}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const PART_KEYS = ['asset', 'name', 'pos', 'rot', 'scale', 'origin', 'attach', 'tint', 'paint', 'decals'];

function vec(v: unknown, what: string, lo: number, hi: number): CompositeVec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi))
    throw new CompositeSpecError(`${what} must be [x, y, z], numbers ${lo}–${hi}`);
  return v.map(r4) as CompositeVec3;
}

/** A part's default node name: the asset's name (the part after the pack), or part_<i> for an id. */
function partBaseName(asset: string | number, i: number) {
  if (typeof asset === 'number') return `part_${i}`;
  const s = asset.split('/').pop()!.trim();
  return /^\d+$/.test(s) ? `part_${i}` : s;
}
const safeName = (n: string) => n.trim().replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 80) || 'part';

/** Check a composite spec and drop defaults (so equal composites hash the same). A CompositeSpecError names the bad field. */
export function normaliseComposite(raw: unknown): CompositeSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CompositeSpecError('composite must be { parts: [{ asset, pos?, rot?, scale?, … }] }');
  const o = raw as Record<string, unknown>;
  const bad = Object.keys(o).filter((k) => k !== 'parts');
  if (bad.length) throw new CompositeSpecError(`composite takes parts, not ${bad.join(', ')}`);
  if (!Array.isArray(o.parts) || !o.parts.length) throw new CompositeSpecError('composite.parts must be a list of at least one { asset, pos?, rot?, scale?, origin?, name?, attach?, tint? }');
  if (o.parts.length > COMPOSITE_MAX_PARTS) throw new CompositeSpecError(`composite.parts: at most ${COMPOSITE_MAX_PARTS}`);
  const used = new Map<string, number>();
  return {
    parts: o.parts.map((rp, i) => {
      const w = `composite.parts[${i}]`;
      if (!rp || typeof rp !== 'object' || Array.isArray(rp)) throw new CompositeSpecError(`${w} must be { asset, pos?, rot?, scale?, … }`);
      const p = rp as Record<string, unknown>;
      const extra = Object.keys(p).filter((k) => !PART_KEYS.includes(k));
      if (extra.length) throw new CompositeSpecError(`${w}: unknown field${extra.length > 1 ? 's' : ''} ${extra.join(', ')} (allowed: ${PART_KEYS.join(', ')})`);
      let asset: string | number;
      if (typeof p.asset === 'number' && Number.isInteger(p.asset) && p.asset > 0) asset = p.asset;
      else if (typeof p.asset === 'string' && p.asset.trim()) asset = /^\d+$/.test(p.asset.trim()) ? Number(p.asset.trim()) : p.asset.trim();
      else throw new CompositeSpecError(`${w}.asset is required (a model name, Pack/Name or id)`);
      if (p.name !== undefined && (typeof p.name !== 'string' || !p.name.trim())) throw new CompositeSpecError(`${w}.name must be a non-empty string`);
      // Node names are unique: a repeat gets _2, _3…
      const base = safeName(typeof p.name === 'string' ? p.name : partBaseName(asset, i));
      const n = (used.get(base.toLowerCase()) ?? 0) + 1;
      used.set(base.toLowerCase(), n);
      const out: CompositePart = { asset, name: n > 1 ? `${base}_${n}` : base };
      if (p.pos !== undefined) {
        const v = vec(p.pos, `${w}.pos`, -10000, 10000);
        if (v.some((x) => x !== 0)) out.pos = v;
      }
      if (p.rot !== undefined) {
        if (typeof p.rot === 'number') {
          if (!Number.isFinite(p.rot) || Math.abs(p.rot) > 3600) throw new CompositeSpecError(`${w}.rot must be degrees (a yaw) or [x, y, z] degrees`);
          if (r4(p.rot) !== 0) out.rot = r4(p.rot);
        } else {
          const v = vec(p.rot, `${w}.rot`, -3600, 3600);
          if (v.some((x) => x !== 0)) out.rot = v[0] === 0 && v[2] === 0 ? v[1] : v;
        }
      }
      if (p.scale !== undefined) {
        if (typeof p.scale === 'number') {
          if (!Number.isFinite(p.scale) || p.scale < 0.001 || p.scale > 1000) throw new CompositeSpecError(`${w}.scale must be 0.001–1000 (or [x, y, z])`);
          if (r4(p.scale) !== 1) out.scale = r4(p.scale);
        } else {
          const v = vec(p.scale, `${w}.scale`, 0.001, 1000);
          if (v.some((x) => x !== 1)) out.scale = v[0] === v[1] && v[1] === v[2] ? v[0] : v;
        }
      }
      if (p.origin !== undefined) {
        if (!(COMPOSITE_PART_ORIGINS as readonly unknown[]).includes(p.origin)) throw new CompositeSpecError(`${w}.origin must be one of ${COMPOSITE_PART_ORIGINS.join(', ')}`);
        if (p.origin !== 'bottom-centre') out.origin = p.origin as CompositePartOrigin;
      }
      if (p.attach !== undefined) {
        if (!Array.isArray(p.attach) || !p.attach.every((x) => typeof x === 'string' && x.trim())) throw new CompositeSpecError(`${w}.attach must be a list of names`);
        const a = [...new Set(p.attach.map((x: string) => x.trim()))];
        if (a.length) out.attach = a;
      }
      if (p.tint !== undefined) {
        if (typeof p.tint !== 'string' || !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(p.tint.trim())) throw new CompositeSpecError(`${w}.tint must be a colour like #ff8800`);
        let h = p.tint.trim().replace(/^#/, '').toLowerCase();
        if (h.length === 3) h = h.replace(/./g, (c) => c + c);
        if (h !== 'ffffff') out.tint = `#${h}`;
      }
      if (p.paint !== undefined) {
        if (typeof p.paint !== 'string' || !p.paint.trim() || (p.paint.trim().startsWith('#') && !/^#[0-9a-f]{6}$/i.test(p.paint.trim())))
          throw new CompositeSpecError(`${w}.paint must be a colour like #e3b52f or a material name`);
        out.paint = p.paint.trim().startsWith('#') ? p.paint.trim().toLowerCase() : p.paint.trim();
      }
      if (p.decals !== undefined) {
        if (typeof p.decals !== 'boolean') throw new CompositeSpecError(`${w}.decals must be true or false`);
        if (p.decals === false) out.decals = false;
      }
      return out;
    }),
  };
}

/** The composite's default name: composite_<first part's name>. */
export const compositeName = (c: CompositeSpec) => `composite_${c.parts[0]?.name ?? 'model'}`;

const DEG = Math.PI / 180;

/** A part's placement as a quaternion [x, y, z, w] (Euler XYZ, degrees; a number is a yaw about +Y). */
export function compositeQuat(rot: CompositePart['rot']): [number, number, number, number] {
  const [x, y, z] = typeof rot === 'number' ? [0, rot, 0] : (rot ?? [0, 0, 0]);
  const c1 = Math.cos((x * DEG) / 2), s1 = Math.sin((x * DEG) / 2);
  const c2 = Math.cos((y * DEG) / 2), s2 = Math.sin((y * DEG) / 2);
  const c3 = Math.cos((z * DEG) / 2), s3 = Math.sin((z * DEG) / 2);
  // three.js Quaternion.setFromEuler, order XYZ.
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}

/** A part's [x, y, z] scale. */
export const compositeScale = (scale: CompositePart['scale']): CompositeVec3 => (typeof scale === 'number' ? [scale, scale, scale] : (scale ?? [1, 1, 1]));

/** A part's transform as a column-major 4×4 matrix (T · R · S), placing its points in the composite's frame. */
export function compositeMatrix(p: Pick<CompositePart, 'pos' | 'rot' | 'scale'>): number[] {
  const [qx, qy, qz, qw] = compositeQuat(p.rot);
  const [sx, sy, sz] = compositeScale(p.scale);
  const [tx, ty, tz] = p.pos ?? [0, 0, 0];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
