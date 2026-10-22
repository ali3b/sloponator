// Moved from synty-sprite-generator packages/client/src/models.ts (P3, ali3b/sloponator#16): parseModelsFile
// (the defaults merge, built-kind filtering and file names) and the string forms parsePose, parsePoses,
// parseVariants. The field checks themselves are @slop/schema's `modelsFile` (ported from checkModelSpec), so an
// `ssg.models.json` is accepted unchanged and a typo gets the schema's teaching error.
import { assertValid, modelsFile, type ModelDecl as DeclaredModel } from '@slop/schema';
import { ModelError } from './resolve/errors.js';
import { compositeName, safeModelName, skydomeName, terrainName, trackpieceName, type ModelNamedPose, type ModelPose, type ModelSpec, type ModelVariant } from './spec/index.js';

/** One model to build: the file name in the output folder (and the export's name) and its spec. */
export interface ModelDecl {
  name: string;
  spec: ModelSpec;
}

const BUILT = ['trackpiece', 'terrain', 'skydome', 'composite'] as const;
type Built = (typeof BUILT)[number];
/** The fields a built kind takes besides itself (the others describe a library asset). */
const BUILT_FIELDS = ['collider', 'name', 'texSize', 'texFormat', 'compress'];
const builtKeys = (kind: Built) => [kind, ...BUILT_FIELDS, ...(kind === 'composite' ? ['convexMaxVertices'] : [])];
const builtKind = (s: Record<string, unknown>) => BUILT.find((k) => s[k] !== undefined);

/**
 * A pose to bake (ModelSpec.pose): `{ clip, time? }` or the CLI form "Clip:0.2" (seconds after the last colon;
 * the clip may carry @ qualifiers, "Wave@Feminine:0.2").
 */
export function parsePose(v: unknown, what = 'pose'): ModelPose {
  if (typeof v === 'string') {
    const m = /^(.*?)(?::\s*([\d.]+))?$/.exec(v.trim());
    const clip = m?.[1]?.trim() ?? '';
    if (!clip) throw new ModelError(`${what} must name a clip ("Wave_01:0.2", or { clip, time })`);
    const time = m?.[2] !== undefined ? Number(m[2]) : undefined;
    if (time !== undefined && !Number.isFinite(time)) throw new ModelError(`${what}: the time after ":" must be seconds`);
    return { clip, ...(time !== undefined ? { time } : {}) };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ModelError(`${what} must be { clip, time? } (or "Clip:0.2")`);
  const o = v as Record<string, unknown>;
  const clip = typeof o.clip === 'number' ? String(o.clip) : typeof o.clip === 'string' ? o.clip.trim() : '';
  if (!clip) throw new ModelError(`${what}.clip is required (a clip name or id)`);
  return { clip, ...(o.time !== undefined ? { time: o.time as number } : {}) };
}

/** Several poses (ModelSpec.poses): a list of { name, clip, time? } or the CLI form "idle=Idle:0,wave_a=Wave_01:0.2". */
export function parsePoses(v: unknown, what = 'poses'): ModelNamedPose[] {
  const list: unknown[] = typeof v === 'string'
    ? v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
      const eq = x.indexOf('=');
      if (eq < 1) throw new ModelError(`${what}: "${x}" must be name=Clip:time`);
      return { name: x.slice(0, eq).trim(), ...parsePose(x.slice(eq + 1), `${what} ${x.slice(0, eq).trim()}`) };
    })
    : Array.isArray(v) ? v : (() => { throw new ModelError(`${what} must be a list of { name, clip, time? } (or "idle=Idle:0,wave=Wave_01:0.2")`); })();
  const out = list.map((x, i) => {
    const p = parsePose(x, `${what}[${i}]`);
    const name = (x as Record<string, unknown>).name;
    if (typeof name !== 'string' || !name.trim()) throw new ModelError(`${what}[${i}] needs a name (its node in the GLB)`);
    return { name: name.trim(), ...p };
  });
  const dup = duplicate(out.map((x) => x.name));
  if (dup) throw new ModelError(`${what}: the name "${dup}" is used twice`);
  return out;
}

const duplicate = (names: string[]) => {
  const lower = names.map((n) => n.toLowerCase());
  return lower.find((n, i) => lower.indexOf(n) !== i);
};

/**
 * Paint variants from a list of { name, tint } or the CLI form "red=#c62828,blue=#1e5bc6,plain" (a name without a
 * tint keeps the model's own colours).
 */
export function parseVariants(v: unknown, what = 'variants'): ModelVariant[] {
  const list: unknown[] = typeof v === 'string'
    ? v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
      const eq = x.indexOf('=');
      return eq < 0 ? { name: x } : { name: x.slice(0, eq).trim(), tint: x.slice(eq + 1).trim() };
    })
    : Array.isArray(v) ? v : (() => { throw new ModelError(`${what} must be a list of { name, tint } (or "red=#c62828,blue=#1e5bc6")`); })();
  const out = list.map((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new ModelError(`${what}[${i}] must be { name, tint }`);
    const o = x as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim()) throw new ModelError(`${what}[${i}] needs a name`);
    return { name: o.name.trim(), ...(o.tint ? { tint: String(o.tint).toLowerCase() } : {}) };
  });
  const dup = duplicate(out.map((x) => x.name));
  if (dup) throw new ModelError(`${what}: the name "${dup}" is used twice`);
  return out;
}

/** A list of names, or the CLI form "a,b". */
const strList = (v: unknown): string[] => (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v.map(String) : []).map((s) => s.trim()).filter(Boolean);

/** The string forms the declaration allows (CLI shorthands) turned into the spec's lists. */
function specOf(raw: Record<string, unknown>): ModelSpec {
  const s = { ...raw } as Record<string, unknown>;
  for (const k of ['clips', 'attach', 'colliderExclude'] as const) if (s[k] !== undefined) s[k] = strList(s[k]);
  if (s.variants !== undefined) s.variants = parseVariants(s.variants);
  if (s.pose !== undefined) s.pose = parsePose(s.pose);
  if (s.poses !== undefined) s.poses = parsePoses(s.poses);
  if (typeof s.tint === 'string') s.tint = s.tint.toLowerCase();
  return s as ModelSpec;
}

/** A built spec's default name. */
const builtName = (s: ModelSpec) =>
  s.trackpiece ? trackpieceName(s.trackpiece) : s.terrain ? terrainName(s.terrain) : s.skydome ? skydomeName(s.skydome) : s.composite ? compositeName(s.composite) : undefined;

/**
 * Parse an `ssg.models.json`: `{ project?, models: [{ name, asset, …spec }], defaults: { …spec } }` (or a bare list).
 * `defaults` go under each model (asset fields never under a built kind, and `defaults.trackpiece` /
 * `defaults.terrain` under each piece's own); each model gets its file name (`name`, else the asset, else the built
 * kind's name). Throws a DeclarationError (the schema's teaching errors) for anything wrong.
 */
export function parseModelsFile(file: unknown, where?: string): ModelDecl[] {
  const parsed = assertValid(modelsFile, file, where);
  const list: DeclaredModel[] = Array.isArray(parsed) ? parsed : parsed.models;
  const defaults: Record<string, unknown> = Array.isArray(parsed) ? {} : { ...(parsed.defaults ?? {}) };
  // defaults.trackpiece holds track fields every piece shares (cell, width, profile, materials…), merged under each piece's own.
  const { trackpiece: trackDefaults, terrain: terrainDefaults, ...assetDefaults } = defaults as { trackpiece?: Record<string, unknown>; terrain?: Record<string, unknown> } & Record<string, unknown>;
  const base = specOf(assetDefaults) as Record<string, unknown>;
  const withTrackDefaults = (r: Record<string, unknown>) => {
    if (!trackDefaults || !r.trackpiece || typeof r.trackpiece !== 'object') return r;
    const td = trackDefaults, own = r.trackpiece as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...td, ...own };
    for (const k of ['profile', 'materials']) if (td[k] && own[k] && typeof td[k] === 'object' && typeof own[k] === 'object') merged[k] = { ...(td[k] as object), ...(own[k] as object) };
    // A piece's own profile.width wins over a default width shorthand (and the other way round).
    if (own.width !== undefined && (merged.profile as Record<string, unknown> | undefined)?.width !== undefined && !(own.profile as Record<string, unknown> | undefined)?.width) {
      merged.profile = { ...(merged.profile as object), width: own.width };
      delete merged.width;
    }
    if ((own.profile as Record<string, unknown> | undefined)?.width !== undefined) delete merged.width;
    return { ...r, trackpiece: merged };
  };
  const withTerrainDefaults = (r: Record<string, unknown>) => {
    if (!terrainDefaults || !r.terrain || typeof r.terrain !== 'object') return r;
    const td = terrainDefaults, own = r.terrain as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...td, ...own };
    if (td.materials && own.materials && typeof td.materials === 'object' && typeof own.materials === 'object') merged.materials = { ...(td.materials as object), ...(own.materials as object) };
    // A tile takes no water or clear grid: those defaults only apply to grids.
    if (own.tile !== undefined) for (const k of ['water', 'clear', 'chunk']) if (own[k] === undefined) delete merged[k];
    return { ...r, terrain: merged };
  };
  const seen = new Map<string, string>();
  return list.map((raw, i) => {
    const r = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Record<string, unknown>;
    const label = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `models[${i}]`;
    const own = specOf(withTerrainDefaults(withTrackDefaults(r)));
    // Asset fields in defaults do not apply to a built kind (and track fields not to an asset).
    const kind = builtKind(own as Record<string, unknown>);
    const fromBase = kind
      ? Object.fromEntries(Object.entries(base).filter(([k]) => builtKeys(kind).includes(k) && k !== kind && !(kind === 'skydome' && k === 'collider')))
      : Object.fromEntries(Object.entries(base).filter(([k]) => !(BUILT as readonly string[]).includes(k)));
    const name = own.name?.trim() || (typeof own.asset === 'string' ? own.asset : builtName(own));
    if (!name) throw new ModelError(`model ${label}: name is missing (needed when asset is an id)`);
    const key = safeModelName(name).toLowerCase();
    if (seen.has(key)) throw new ModelError(`model ${name}: the name is used twice (also "${seen.get(key)}"); names are the file names, so each must be different`);
    seen.set(key, name);
    return { name, spec: { ...fromBase, ...own, name } as ModelSpec };
  });
}

/** Local file names for a model: <name>.glb and <name>.model.json. */
export const modelFileNames = (name: string) => {
  const base = safeModelName(name);
  return { glb: `${base}.glb`, manifest: `${base}.model.json` };
};

/** The `asset` column of the models.json index: the asset, or `trackpiece:<preset>`, `terrain:<tile|grid>`, `skydome:<preset>`, `composite:<parts>`. */
export const indexAssetOf = (spec: ModelSpec): string | number =>
  spec.asset ?? (spec.terrain ? `terrain:${spec.terrain.tile ?? 'grid'}` : spec.skydome ? `skydome:${spec.skydome.preset ?? 'country'}` : spec.composite ? `composite:${spec.composite.parts.length}` : `trackpiece:${spec.trackpiece?.preset ?? 'custom'}`);
