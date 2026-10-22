// Moved from synty-sprite-generator packages/shared/src/model3d/spec.ts (P3, ali3b/sloponator#14).
import { canonicalJson, sha256 } from '@slop/sprites';
import { TrackSpecError, normaliseTrackpiece, trackpieceName, type TrackpieceSpec } from './trackpiece.js';
import { normaliseTerrain, terrainName, type TerrainSpec } from './terrain.js';
import { normaliseSkydome, skydomeName, type SkydomeSpec } from './skydome.js';
import { compositeName, normaliseComposite, type CompositeSpec } from './composite.js';

/**
 * A game-ready 3D model export (GLB plus a `.model.json` manifest), as the CLI (`ssg model export`), the MCP
 * (`export_model`) and the web app ask for it. The server resolves `asset`, normalises the spec and caches the
 * result under its hash (`data/models/<id>/`), so the same spec is built once.
 */
export interface ModelSpec {
  /** Asset id, or name ("SM_Veh_Pickup_Lift_01", or "Pack/Name" when several packs have it). Not with `trackpiece`. */
  asset?: string | number;
  /**
   * A procedural track piece instead of an asset (CS-FB-001): a preset or a path of segments swept with a profile,
   * Synty swatch materials, sockets at its open ends. See docs/MODELS.md "Track pieces".
   */
  trackpiece?: TrackpieceSpec;
  /**
   * Terrain on the track grid instead of an asset (CS-FB-003): one tile (`tile`) or a whole grid of corner heights
   * (`heights`, chunked meshes in one GLB), water and coasts, Synty swatch materials, instanced prop scatter.
   * See docs/MODELS.md "Terrain".
   */
  terrain?: TerrainSpec;
  /** A skydome instead of an asset (CS-FB-004): a gradient dome and a silhouette ring of Synty background props. See docs/MODELS.md "Skydome". */
  skydome?: SkydomeSpec;
  /**
   * One model from several library assets at offsets (CS-FB-024): each part exported, placed and merged into one GLB
   * with shared materials. Takes name, collider (box, convex, trimesh), convexMaxVertices, texSize, texFormat,
   * compress. See docs/MODELS.md "Composite models".
   */
  composite?: CompositeSpec;
  /**
   * The collider the export carries (CS-FB-002): `box` (the manifest's box only; the default for assets) or `trimesh`
   * (also a `collider` node in the GLB: the drivable surfaces and walls of a track piece, the visual mesh of an asset;
   * the default for track pieces) or `convex` (assets: a `collider` node holding the convex hull of the visual mesh).
   */
  collider?: ModelColliderKind;
  /**
   * Parts a trimesh or convex collider leaves out, by role (`wheel`, `door`…) or part name (full or local). Default
   * MODEL_COLLIDER_EXCLUDE (the moving parts: wheels, steering wheels, doors); `[]` keeps every part.
   */
  colliderExclude?: string[];
  /**
   * With collider convex: the most vertices the hull may have (default MODEL_CONVEX_MAX_VERTICES, 255, what physics
   * engines take); a rounder model's hull keeps its most outlying points.
   */
  convexMaxVertices?: number;
  /** Output name (file names and the GLB's root node). Default: the asset's name. */
  name?: string;
  /**
   * Clips baked into the GLB (characters only): a clip name, `name@Masculine|Feminine|Neutral`, `name@Polygon|Sidekick`
   * (the rig family), `name@<pack>` (qualifiers chain: `Idle@Feminine@Sidekick`), or an animation id. Named after
   * the clip in the GLB (a qualified one keeps its qualifiers: `Idle@Feminine`). See parseClipRef.
   */
  clips?: string[];
  /** In-place clips (default true); false keeps the root motion. */
  inPlace?: boolean;
  /**
   * Extra pieces: bundled attachments of the same file by mesh name, or other attachment assets by name or id. An
   * attachment keeps the placement it was authored with (a lift kit is modelled in its pickup's frame, so the body
   * sits on it as is).
   */
  attach?: string[];
  /**
   * When an attachment brings four road wheels of its own (a lift kit), the model's own road wheels are dropped and
   * the attachment's become `manifest.wheels` (default true). False keeps both sets.
   */
  replaceWheels?: boolean;
  /**
   * Where the model's origin goes: the centre of its bottom (default), the centre of the wheel axles at axle height
   * (vehicles; others fall back to bottom-centre), or the source model's own origin.
   */
  origin?: ModelOrigin;
  /**
   * Largest texture side in pixels (textures are scaled down to fit, never up). Default by kind (MODEL_TEX_SIZE):
   * props 256, vehicles and characters 1024. Measured after the atlas is cropped to the part the model uses.
   */
  texSize?: number;
  /** Texture format: webp (EXT_texture_webp, default), png, or keep (as ingested). */
  texFormat?: ModelTexFormat;
  /** Mesh simplification: the fraction of triangles to keep (0.05–1; 1 or unset = none). */
  simplify?: number;
  /** A colour (#rgb / #rrggbb): recolours the body paint (see docs/MODELS.md "Tint"). Not with `variants`. */
  tint?: string;
  /**
   * Paint variants in one GLB (KHR_materials_variants): shared geometry, one material and texture per variant. The
   * first variant is the GLB's default look. A variant without a tint keeps the model's own colours.
   */
  variants?: ModelVariant[];
  /** Geometry compression: meshopt (EXT_meshopt_compression; three.js needs MeshoptDecoder) or none (default). */
  compress?: ModelCompress;
  /**
   * Scale the model uniformly so a dimension matches, in metres: length = Z (forward), width = X, height = Y, as
   * exported (after the scale fix). With several, the smallest scale wins (the model fits all of them).
   */
  fit?: ModelFit;
  /**
   * Bake a character into one static mesh posed at a clip's time (seconds into the clip as exported, after its
   * trim and speed): no skin, no joints, no animations (crowd instancing). Not with `clips` or `poses`.
   */
  pose?: ModelPose;
  /**
   * Several posed static meshes in one GLB: one node per pose (named `name`) with the mesh under it, all at the same
   * origin (the first pose's). The manifest lists them in `poses`. Not with `clips` or `pose`.
   */
  poses?: ModelNamedPose[];
  /**
   * Split the model's triangles by palette swatch (OR-FB-022): a child node `swatch_<hex>` per atlas colour, each with
   * its own material, so a game can swap or light the lamps painted into one mesh. Static models only.
   */
  splitBySwatch?: boolean;
  /**
   * CS-FB-025: levels of detail in the same GLB, as shares of the model's triangles (`[0.5, 0.2]`): a node per level
   * (`LOD0` the model, `LOD1`, …), listed in the manifest's `lods`. The source file's own LOD meshes are used where
   * they are near the share asked for, else the model is simplified. Static models; at most 4, each 0.01–0.95, falling.
   */
  lods?: number[];
  /**
   * The paint a `tint` or `variants` recolour (CS-FB-026): a colour `#rrggbb` (the swatch of the model's texture
   * that is its paint) or a material name (only that material's triangles are read for the paint). Default: found.
   */
  paint?: string;
  /**
   * CS-FB-028: false paints over every decal and livery in the paint's texture with the paint (Street Racer's
   * liveries, numbers, logos); with no tint, in the paint's own colour. Default true: only small lettering enclosed
   * by the paint is painted over.
   */
  decals?: boolean;
}

/** A pose to bake (ModelSpec.pose): a clip (any ModelSpec.clips form) and a time in seconds (default 0). */
export interface ModelPose {
  clip: string;
  time?: number;
}
/** One of several baked poses (ModelSpec.poses). */
export interface ModelNamedPose extends ModelPose {
  name: string;
}
export const MODEL_MAX_POSES = 32;

/** The clip genders Synty ships (`name@Feminine`); male/female are accepted too. */
export const CLIP_GENDERS = ['Masculine', 'Feminine', 'Neutral'] as const;

/**
 * A clip reference: an animation id ("859"), or a name with optional `@` qualifiers ("Idle@Feminine@Sidekick",
 * "Idle@ANIMATION_Idles", "Idle@#859"). Each qualifier is matched against the clip's gender, rig family (set) or
 * pack by the server.
 */
export function parseClipRef(ref: string): { id: number } | { name: string; quals: string[] } {
  const r = String(ref ?? '').trim();
  if (/^\d+$/.test(r)) return { id: Number(r) };
  const [name, ...quals] = r.split('@').map((x) => x.trim());
  return { name, quals: quals.filter(Boolean) };
}

/** The gender a clip qualifier names (Masculine, Feminine, Neutral; male/female/m/f), or null. */
export function clipGenderOf(q: string): (typeof CLIP_GENDERS)[number] | null {
  const k = q.trim().toLowerCase();
  if (k === 'masculine' || k === 'male' || k === 'm') return 'Masculine';
  if (k === 'feminine' || k === 'female' || k === 'f') return 'Feminine';
  if (k === 'neutral') return 'Neutral';
  return null;
}

/** One paint variant (see ModelSpec.variants). */
export interface ModelVariant {
  name: string;
  /** #rrggbb; left out (or #ffffff), the model's own colours. */
  tint?: string;
}
export const MODEL_MAX_VARIANTS = 16;
export const MODEL_COMPRESS = ['meshopt', 'none'] as const;
export type ModelCompress = (typeof MODEL_COMPRESS)[number];

/** The default largest texture side by asset kind (ModelSpec.texSize); other kinds take `default`. */
export const MODEL_TEX_SIZE: Record<string, number> & { default: number } = { vehicle: 1024, character: 1024, rigged: 1024, multipart: 512, default: 256 };
export const defaultTexSize = (kind: string | null | undefined) => MODEL_TEX_SIZE[kind ?? ''] ?? MODEL_TEX_SIZE.default;

/** Target dimensions in metres (see ModelSpec.fit). */
export interface ModelFit {
  length?: number;
  width?: number;
  height?: number;
}
export const MODEL_FIT_KEYS = ['length', 'width', 'height'] as const;
/** The bounds axis each fit dimension measures: width X, height Y, length Z. */
export const MODEL_FIT_AXIS: Record<(typeof MODEL_FIT_KEYS)[number], 0 | 1 | 2> = { width: 0, height: 1, length: 2 };

/**
 * The uniform scale that makes a model of `size` (metres, [x, y, z]) fit: the smallest of the asked dimensions'
 * ratios. 1 when nothing is asked or the size is degenerate.
 */
export function fitScale(size: number[], fit: ModelFit | undefined | null): number {
  if (!fit) return 1;
  const ks = MODEL_FIT_KEYS.flatMap((k) => {
    const want = fit[k], have = size[MODEL_FIT_AXIS[k]];
    return typeof want === 'number' && want > 0 && have > 1e-9 ? [want / have] : [];
  });
  return ks.length ? Math.min(...ks) : 1;
}

export const MODEL_COLLIDERS = ['box', 'convex', 'trimesh'] as const;
export type ModelColliderKind = (typeof MODEL_COLLIDERS)[number];
/** The roles a trimesh or convex collider of an asset leaves out unless colliderExclude says otherwise: moving parts. */
export const MODEL_COLLIDER_EXCLUDE = ['wheel', 'wheel_door', 'steering', 'door', 'propeller'] as const;
/** The default cap on a convex collider's vertices (ModelSpec.convexMaxVertices): what Rapier / PhysX / Bullet take. */
export const MODEL_CONVEX_MAX_VERTICES = 255;

/** Check ModelSpec.convexMaxVertices: undefined for the default, else a whole number 4–65535 (with collider convex). */
export function convexCapOf(spec: Pick<ModelSpec, 'collider' | 'convexMaxVertices'>): number | undefined {
  const v = spec.convexMaxVertices;
  if (v === undefined || v === null) return undefined;
  if (spec.collider !== 'convex') throw new ModelSpecError('convexMaxVertices goes with collider convex');
  if (!Number.isInteger(v) || v < 4 || v > 65535) throw new ModelSpecError('convexMaxVertices must be a whole number 4–65535');
  return v === MODEL_CONVEX_MAX_VERTICES ? undefined : v;
}

export const MODEL_ORIGINS = ['bottom-centre', 'axle-centre', 'pivot'] as const;
export type ModelOrigin = (typeof MODEL_ORIGINS)[number];
export const MODEL_TEX_FORMATS = ['png', 'webp', 'keep'] as const;
export type ModelTexFormat = (typeof MODEL_TEX_FORMATS)[number];

/** A spec with its defaults filled in and its values checked: what the hash and the exporter see. */
export interface NormalisedModelSpec {
  /** The asset (absent for a track piece, terrain or skydome). */
  asset?: string | number;
  trackpiece?: TrackpieceSpec;
  terrain?: TerrainSpec;
  skydome?: SkydomeSpec;
  composite?: CompositeSpec;
  /** Only when it is not the kind's default (box for assets and composites, trimesh for track pieces). */
  collider?: ModelColliderKind;
  /** Only with a trimesh or convex collider, and only when it is not MODEL_COLLIDER_EXCLUDE (lower case, sorted). */
  colliderExclude?: string[];
  /** Only with a convex collider, and only when it is not MODEL_CONVEX_MAX_VERTICES. */
  convexMaxVertices?: number;
  name?: string;
  clips: string[];
  inPlace: boolean;
  attach: string[];
  /** Only when false (the default, true, is left out so older specs keep their hash). */
  replaceWheels?: false;
  origin: ModelOrigin;
  texSize?: number;
  texFormat: ModelTexFormat;
  simplify?: number;
  tint?: string;
  fit?: ModelFit;
  /** Each with its tint normalised (#rrggbb, left out for the model's own colours). */
  variants?: ModelVariant[];
  /** Only when meshopt (none, the default, is left out). */
  compress?: 'meshopt';
  /** Each time rounded to 0.1 ms. */
  pose?: { clip: string; time: number };
  poses?: { name: string; clip: string; time: number }[];
  /** Only when true. */
  splitBySwatch?: true;
  /** Falling shares, each rounded to 0.001. */
  lods?: number[];
  /** #rrggbb (lower case) or a material name. */
  paint?: string;
  /** Only when false. */
  decals?: false;
}

export class ModelSpecError extends Error {}

/** Bump when the exporter's output changes for the same spec: cached models are rebuilt (their ids stay). */
export const MODEL_EXPORTER_VERSION = 9;
/** At most this many levels of detail besides LOD0 (ModelSpec.lods). */
export const MODEL_MAX_LODS = 4;

/** A name safe for file names and glTF node names: letters, digits, `_`, `-`, `.` (others become `_`). */
export function safeModelName(name: string) {
  return String(name).trim().replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 80) || 'model';
}

/** "#f80" / "#ff8800" / "ff8800" → [r, g, b] in 0–1, or null when it is not a colour. */
export function parseTint(tint: string | undefined | null): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(tint ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const list = (v: unknown, what: string): string[] => {
  if (v === undefined || v === null) return [];
  const arr = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : null;
  if (!arr) throw new ModelSpecError(`${what} must be a list of names`);
  return arr.map((x) => String(x).trim()).filter(Boolean);
};

/**
 * Fill in the defaults and check a spec (a ModelSpecError names the bad field). Clip and attachment order is kept
 * (it is the GLB's animation order); duplicates are dropped. Default values are left out of the result's optional
 * fields, so `{ asset: 1 }` and `{ asset: 1, simplify: 1, texFormat: 'webp', compress: 'none' }` hash the same.
 */
export function normaliseSpec(spec: ModelSpec): NormalisedModelSpec {
  if (!spec || typeof spec !== 'object') throw new ModelSpecError('spec must be an object');
  if (spec.collider !== undefined && !(MODEL_COLLIDERS as readonly unknown[]).includes(spec.collider)) throw new ModelSpecError(`collider must be one of ${MODEL_COLLIDERS.join(', ')}`);
  const built = BUILT_KINDS.filter((k) => spec[k] !== undefined && spec[k] !== null);
  if (built.length > 1) throw new ModelSpecError(`give one of ${BUILT_KINDS.join(', ')}, not ${built.join(' and ')}`);
  if (built.length) return normaliseBuiltSpec(spec, built[0]);
  const asset = typeof spec.asset === 'number' ? spec.asset : typeof spec.asset === 'string' && /^\d+$/.test(spec.asset.trim()) ? Number(spec.asset.trim()) : String(spec.asset ?? '').trim();
  if (asset === '' || (typeof asset === 'number' && !(Number.isInteger(asset) && asset > 0))) throw new ModelSpecError('asset is required (a model name or id)');
  const origin = spec.origin ?? 'bottom-centre';
  if (!MODEL_ORIGINS.includes(origin)) throw new ModelSpecError(`origin must be one of ${MODEL_ORIGINS.join(', ')}`);
  const texFormat = spec.texFormat ?? 'webp';
  if (!MODEL_TEX_FORMATS.includes(texFormat)) throw new ModelSpecError(`texFormat must be one of ${MODEL_TEX_FORMATS.join(', ')}`);
  let texSize: number | undefined;
  if (spec.texSize !== undefined && spec.texSize !== null) {
    const n = Number(spec.texSize);
    if (!Number.isFinite(n) || n < 16 || n > 8192) throw new ModelSpecError('texSize must be 16–8192 pixels');
    texSize = Math.round(n);
  }
  let simplify: number | undefined;
  if (spec.simplify !== undefined && spec.simplify !== null) {
    const n = Number(spec.simplify);
    if (!Number.isFinite(n) || n <= 0 || n > 1) throw new ModelSpecError('simplify is the fraction of triangles to keep, 0.05–1');
    if (n < 1) simplify = Math.max(0.05, Math.round(n * 1000) / 1000);
  }
  const tintOf = (v: unknown, what: string): string | undefined => {
    if (v === undefined || v === null || String(v).trim() === '') return undefined;
    const c = parseTint(String(v));
    if (!c) throw new ModelSpecError(`${what} must be a colour like #ff8800`);
    const hex = '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    return hex === '#ffffff' ? undefined : hex;
  };
  const tint = tintOf(spec.tint, 'tint');
  let variants: ModelVariant[] | undefined;
  if (spec.variants !== undefined && spec.variants !== null) {
    if (!Array.isArray(spec.variants)) throw new ModelSpecError('variants must be a list of { name, tint }');
    if (spec.variants.length > MODEL_MAX_VARIANTS) throw new ModelSpecError(`variants: at most ${MODEL_MAX_VARIANTS}`);
    if (spec.variants.length) {
      if (tint) throw new ModelSpecError('give the tint in variants (each variant has its own), not tint as well');
      variants = spec.variants.map((v, i) => {
        if (!v || typeof v !== 'object') throw new ModelSpecError(`variants[${i}] must be { name, tint }`);
        const bad = Object.keys(v).filter((k) => k !== 'name' && k !== 'tint');
        if (bad.length) throw new ModelSpecError(`variants[${i}] takes name and tint, not ${bad.join(', ')}`);
        const name = String(v.name ?? '').trim();
        if (!name) throw new ModelSpecError(`variants[${i}] needs a name`);
        const t = tintOf(v.tint, `variants[${i}].tint`);
        return { name: safeModelName(name), ...(t ? { tint: t } : {}) };
      });
      const names = variants.map((v) => v.name.toLowerCase());
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) throw new ModelSpecError(`variants: the name "${dup}" is used twice`);
    }
  }
  const compress = spec.compress ?? 'none';
  if (!MODEL_COMPRESS.includes(compress)) throw new ModelSpecError(`compress must be one of ${MODEL_COMPRESS.join(', ')}`);
  let fit: ModelFit | undefined;
  if (spec.fit !== undefined && spec.fit !== null) {
    if (typeof spec.fit !== 'object' || Array.isArray(spec.fit)) throw new ModelSpecError('fit must be { length?, width?, height? } in metres');
    const bad = Object.keys(spec.fit).filter((k) => !(MODEL_FIT_KEYS as readonly string[]).includes(k));
    if (bad.length) throw new ModelSpecError(`fit takes length, width and height (metres), not ${bad.join(', ')}`);
    for (const k of MODEL_FIT_KEYS) {
      const v = (spec.fit as Record<string, unknown>)[k];
      if (v === undefined || v === null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0.001 || n > 10000) throw new ModelSpecError(`fit.${k} must be a size in metres (0.001–10000)`);
      (fit ??= {})[k] = Math.round(n * 1e4) / 1e4;
    }
  }
  const poseOf = (v: unknown, what: string, named: boolean) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ModelSpecError(`${what} must be { ${named ? 'name, ' : ''}clip, time? }`);
    const o = v as Record<string, unknown>;
    const allowed = named ? ['name', 'clip', 'time'] : ['clip', 'time'];
    const bad = Object.keys(o).filter((k) => !allowed.includes(k));
    if (bad.length) throw new ModelSpecError(`${what} takes ${allowed.join(', ')}, not ${bad.join(', ')}`);
    const clip = typeof o.clip === 'number' ? String(o.clip) : typeof o.clip === 'string' ? o.clip.trim() : '';
    if (!clip) throw new ModelSpecError(`${what}.clip is required (a clip name or id)`);
    const t = o.time === undefined || o.time === null ? 0 : Number(o.time);
    if (!Number.isFinite(t) || t < 0 || t > 3600) throw new ModelSpecError(`${what}.time must be seconds into the clip (0–3600)`);
    return { clip, time: Math.round(t * 1e4) / 1e4 };
  };
  let pose: NormalisedModelSpec['pose'];
  let poses: NormalisedModelSpec['poses'];
  if (spec.pose !== undefined && spec.pose !== null) pose = poseOf(spec.pose, 'pose', false);
  if (spec.poses !== undefined && spec.poses !== null) {
    if (!Array.isArray(spec.poses)) throw new ModelSpecError('poses must be a list of { name, clip, time? }');
    if (spec.poses.length > MODEL_MAX_POSES) throw new ModelSpecError(`poses: at most ${MODEL_MAX_POSES}`);
    if (spec.poses.length) {
      poses = spec.poses.map((p, i) => {
        const base = poseOf(p, `poses[${i}]`, true);
        const name = String((p as ModelNamedPose).name ?? '').trim();
        if (!name) throw new ModelSpecError(`poses[${i}] needs a name (its node in the GLB)`);
        return { name: safeModelName(name), ...base };
      });
      const names = poses.map((p) => p.name.toLowerCase());
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) throw new ModelSpecError(`poses: the name "${dup}" is used twice`);
    }
  }
  if (spec.splitBySwatch !== undefined && spec.splitBySwatch !== null && typeof spec.splitBySwatch !== 'boolean') throw new ModelSpecError('splitBySwatch must be true or false');
  if (spec.decals !== undefined && spec.decals !== null && typeof spec.decals !== 'boolean') throw new ModelSpecError('decals must be true or false');
  let lods: number[] | undefined;
  if (spec.lods !== undefined && spec.lods !== null) {
    const raw = typeof (spec.lods as unknown) === 'string' ? String(spec.lods).split(',') : spec.lods;
    if (!Array.isArray(raw)) throw new ModelSpecError('lods must be a list of triangle shares, e.g. [0.5, 0.2]');
    if (raw.length > MODEL_MAX_LODS) throw new ModelSpecError(`lods: at most ${MODEL_MAX_LODS} levels besides the model`);
    lods = raw.map((v, i) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0.01 || n > 0.95) throw new ModelSpecError(`lods[${i}] must be a share of the triangles, 0.01–0.95`);
      return Math.round(n * 1000) / 1000;
    });
    if (lods.some((v, i) => i > 0 && v >= lods![i - 1])) throw new ModelSpecError('lods must fall: each level keeps fewer triangles than the one before ([0.5, 0.2])');
    if (!lods.length) lods = undefined;
  }
  let paint: string | undefined;
  if (spec.paint !== undefined && spec.paint !== null && String(spec.paint).trim()) {
    const raw = String(spec.paint).trim();
    if (/^#/.test(raw)) {
      const c = parseTint(raw);
      if (!c) throw new ModelSpecError('paint must be a colour like #e3b52f or a material name');
      paint = '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    } else paint = raw;
  }
  if (pose && poses) throw new ModelSpecError('give one pose or a list of poses, not both');
  if ((pose || poses) && list(spec.clips, 'clips').length) throw new ModelSpecError('a posed export is a static mesh with no animations: leave clips out (the pose names its clip)');
  const uniq = (xs: string[]) => xs.filter((x, i) => xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  let colliderExclude: string[] | undefined;
  if (spec.colliderExclude !== undefined && spec.colliderExclude !== null) {
    if (spec.collider !== 'trimesh' && spec.collider !== 'convex') throw new ModelSpecError('colliderExclude goes with collider trimesh or convex');
    const ex = [...new Set(list(spec.colliderExclude, 'colliderExclude').map((x) => x.toLowerCase()))].sort();
    if (ex.join(',') !== [...MODEL_COLLIDER_EXCLUDE].sort().join(',')) colliderExclude = ex;
  }
  const name = spec.name !== undefined && spec.name !== null && String(spec.name).trim() ? safeModelName(String(spec.name)) : undefined;
  const convexMaxVertices = convexCapOf(spec);
  return {
    asset,
    ...(name ? { name } : {}),
    ...(spec.collider === 'trimesh' || spec.collider === 'convex' ? { collider: spec.collider } : {}),
    ...(colliderExclude ? { colliderExclude } : {}),
    ...(convexMaxVertices ? { convexMaxVertices } : {}),
    clips: uniq(list(spec.clips, 'clips')),
    inPlace: spec.inPlace !== false,
    attach: uniq(list(spec.attach, 'attach')),
    ...(spec.replaceWheels === false ? { replaceWheels: false as const } : {}),
    origin,
    ...(texSize ? { texSize } : {}),
    texFormat,
    ...(simplify ? { simplify } : {}),
    ...(tint ? { tint } : {}),
    ...(fit ? { fit } : {}),
    ...(variants ? { variants } : {}),
    ...(compress === 'meshopt' ? { compress } : {}),
    ...(pose ? { pose } : {}),
    ...(poses ? { poses } : {}),
    ...(spec.splitBySwatch === true ? { splitBySwatch: true as const } : {}),
    ...(lods ? { lods } : {}),
    ...(paint ? { paint } : {}),
    ...(spec.decals === false ? { decals: false as const } : {}),
  };
}

/** Kinds the exporter builds instead of loading an asset. */
export const BUILT_KINDS = ['trackpiece', 'terrain', 'skydome', 'composite'] as const;
export type BuiltKind = (typeof BUILT_KINDS)[number];
/** The fields a built kind takes besides itself (the rest describe an asset). texSize sizes a terrain's scatter props. */
const BUILT_SPEC_FIELDS = ['name', 'collider', 'texSize', 'texFormat', 'compress'];

/** normaliseSpec for a track piece, terrain or skydome: checked (its error → ModelSpecError), asset-only fields refused. */
function normaliseBuiltSpec(spec: ModelSpec, kind: BuiltKind): NormalisedModelSpec {
  const fields = [kind, ...BUILT_SPEC_FIELDS, ...(kind === 'composite' ? ['convexMaxVertices'] : [])];
  const given = Object.entries(spec).filter(([k, v]) => v !== undefined && v !== null && !fields.includes(k));
  // Defaults a normalised spec carries (clips [], origin…) are fine; anything that asks for something is not.
  const asks = given.filter(([k, v]) => !((k === 'clips' || k === 'attach') && Array.isArray(v) && !v.length) && !(k === 'inPlace' && v === true) && !(k === 'origin' && v === 'bottom-centre'));
  if (asks.length) throw new ModelSpecError(`a ${kind} is built, not loaded: ${asks.map(([k]) => k).join(', ')} ${asks.length > 1 ? 'do' : 'does'} not apply (it takes ${fields.join(', ')})`);
  if (kind === 'skydome' && spec.collider === 'trimesh') throw new ModelSpecError('a skydome has no collider: leave collider out');
  if (spec.collider === 'convex' && kind !== 'composite') throw new ModelSpecError(`a ${kind} takes collider ${kind === 'skydome' ? 'box' : 'trimesh (the default) or box'}; convex is for assets`);
  let body: { trackpiece: TrackpieceSpec } | { terrain: TerrainSpec } | { skydome: SkydomeSpec } | { composite: CompositeSpec };
  let defName: string;
  try {
    if (kind === 'trackpiece') {
      const t = normaliseTrackpiece(spec.trackpiece);
      body = { trackpiece: t };
      defName = trackpieceName(t);
    } else if (kind === 'terrain') {
      const t = normaliseTerrain(spec.terrain);
      body = { terrain: t };
      defName = terrainName(t);
    } else if (kind === 'composite') {
      const t = normaliseComposite(spec.composite);
      body = { composite: t };
      defName = compositeName(t);
    } else {
      const t = normaliseSkydome(spec.skydome);
      body = { skydome: t };
      defName = skydomeName(t);
    }
  } catch (e) {
    throw new ModelSpecError((e as Error).message);
  }
  let texSize: number | undefined;
  if (spec.texSize !== undefined && spec.texSize !== null && (kind === 'terrain' || kind === 'composite')) {
    texSize = Number(spec.texSize);
    if (!Number.isInteger(texSize) || texSize < 16 || texSize > 4096) throw new ModelSpecError('texSize must be a whole number 16–4096');
  }
  const texFormat = spec.texFormat ?? 'webp';
  if (!MODEL_TEX_FORMATS.includes(texFormat)) throw new ModelSpecError(`texFormat must be one of ${MODEL_TEX_FORMATS.join(', ')}`);
  const compress = spec.compress ?? 'none';
  if (!MODEL_COMPRESS.includes(compress)) throw new ModelSpecError(`compress must be one of ${MODEL_COMPRESS.join(', ')}`);
  const name = spec.name !== undefined && spec.name !== null && String(spec.name).trim() ? safeModelName(String(spec.name)) : safeModelName(defName);
  // A composite's collider defaults to box (as an asset's); the others' to trimesh.
  const collider = kind === 'composite' ? (spec.collider === 'trimesh' || spec.collider === 'convex' ? spec.collider : undefined) : spec.collider === 'box' ? ('box' as const) : undefined;
  const convexMaxVertices = kind === 'composite' ? convexCapOf(spec) : undefined;
  return {
    ...body,
    name,
    ...(texSize ? { texSize } : {}),
    ...(collider ? { collider } : {}),
    ...(convexMaxVertices ? { convexMaxVertices } : {}),
    clips: [],
    inPlace: true,
    attach: [],
    origin: 'bottom-centre',
    texFormat,
    ...(compress === 'meshopt' ? { compress } : {}),
  };
}
export { TrackSpecError };

/**
 * The model's id: a hash of the normalised spec (16 hex digits). The server hashes the spec with `asset` resolved
 * to the asset's id and `name` filled in, so a model asked for by name or by id is the same model.
 */
export function specHash(spec: ModelSpec | NormalisedModelSpec) {
  return sha256('model3d:' + canonicalJson(normaliseSpec(spec as ModelSpec))).slice(0, 16);
}
