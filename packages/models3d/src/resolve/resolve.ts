// Moved from synty-sprite-generator apps/server/src/models.ts (P3, ali3b/sloponator#14): findModelAsset,
// resolveSpec, resolveTrack, trackLookup and exportModel, over @slop/library instead of the DB and the server's
// data/models cache. The routes, model info and previews did not move.
import fs from 'node:fs';
import path from 'node:path';
import type { AssetEntry, Library } from '@slop/library';
import { boneForAttachment } from '@slop/library/synty';
import { canonicalJson, sha256 } from '@slop/sprites';
import {
  MODEL_EXPORTER_VERSION, ModelSpecError, TRACK_VERSION, defaultTexSize, isRoadWheel, normaliseSpec, safeModelName, specHash,
  type ModelManifest, type ModelSpec, type NormalisedModelSpec,
} from '../spec/index.js';
import { buildModel, type BuildAttach, type BuildClip, type BuildInput, type BuildPose, type BuildResult } from '../build/modelBuild.js';
import { SEATS_VERSION, isSeatingName } from '../build/modelSeats.js';
import { companionsOf, missingBodyWarning } from '../build/companions.js';
import { TrackMaterialError, buildTrackpiece, resolveTrackMaterials, type TrackLookup } from '../build/trackBuild.js';
import { resolveScenery } from '../build/terrainModels.js';
import { natureMaterialsFor, readTexturePng } from '../build/natureMaterials.js';
import { resolveComposite } from '../build/compositeBuild.js';
import { bundledMeshes, readGlbJson } from '../build/glb.js';
import { ModelError } from './errors.js';
import { closeNames } from './names.js';
import { clipSourceOf, pickClip } from './clips.js';

/**
 * Resolving a spec against the library and building (or fetching from the cache) the model it describes. The cache
 * is content-addressed like the old server's data/models: one folder per spec hash (`id`) holding `<name>.glb`,
 * `<name>.model.json`, `spec.json` and `source.key`; a model is rebuilt in place (same id, new `rev`) when its
 * sources change (the ingest GLB, an attachment, a bake, the scale fix, part roles, clip edits) or the exporter does
 * (MODEL_EXPORTER_VERSION).
 */

/**
 * Bump when trimesh/convex colliders of assets change for the same spec (2: moving parts left out, CS-FB-002): only
 * those exports rebuild (their ids stay). 3: convex hulls capped at MODEL_CONVEX_MAX_VERTICES.
 */
export const COLLIDER_VERSION = 3;

/** The default cache: `$SLOP_CACHE_DIR/models`, else `~/.cache/slop/models`. */
export function defaultCacheDir() {
  const base = process.env.SLOP_CACHE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(process.env.HOME ?? process.cwd(), '.cache'), 'slop');
  return path.join(base, 'models');
}

export interface ExportOptions {
  lib: Library;
  /** The content-addressed cache root (default defaultCacheDir()). */
  cacheDir?: string;
  /** Rebuild even when the cache has this spec with the same source key. */
  force?: boolean;
}

/** An exported model: its cached files and manifest. */
export interface ModelExport {
  /** The spec hash: the folder under the cache. */
  id: string;
  name: string;
  /** The build's revision (the source key's first 16 hex digits): a different one for the same id means new files. */
  rev: string;
  manifest: ModelManifest;
  /** True when the cache already had this build (nothing was built). */
  cached: boolean;
  dir: string;
  glb: string;
  manifestFile: string;
  /** Files beside the GLB that the manifest names (a skydome's panorama PNG). */
  extra: string[];
}

// ---- content hashes of the inputs (memoised by path and stamp for the run) ----

const hashes = new Map<string, { stamp: string; hash: string }>();

/** The sha256 of a file's contents, or 'missing'. A file that has not changed (size and mtime) is not re-read. */
export function fileHash(p: string): string {
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return 'missing';
  }
  const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
  const had = hashes.get(p);
  if (had && had.stamp === stamp) return had.hash;
  const hash = sha256(new Uint8Array(fs.readFileSync(p)));
  hashes.set(p, { stamp, hash });
  return hash;
}

// ---- assets ----

/** An asset by id, or by name ("Name" or "Pack/Name", any case); the first ready one when several share the name. */
export function findModelAsset(lib: Library, ref: string | number): AssetEntry {
  const a = lib.asset(ref);
  if (a) return a;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) throw new ModelError(`no model with id ${ref}`, 404);
  const raw = String(ref).trim();
  const slash = raw.indexOf('/');
  const pack = slash > 0 ? raw.slice(0, slash) : undefined;
  const name = slash > 0 ? raw.slice(slash + 1) : raw;
  if (pack && !lib.pack(pack)) {
    const packs = closeNames(lib.packs().map((p) => p.name), pack, 3);
    throw new ModelError(`no pack named "${pack}"${packs.length ? ` (did you mean ${packs.join(', ')}?)` : ''}`, 404);
  }
  // An error path: every name is compared (a few thousand distinct names in a big library).
  const like = lib.assets({ ...(pack ? { pack } : {}), limit: 5000 }).map((r) => r.name);
  const near = closeNames(like, name, 5);
  throw new ModelError(`no model named "${raw}"${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}`, 404);
}

const usable = (a: AssetEntry | undefined) => {
  if (!a || a.status !== 'ready') return null;
  const glb = a.glbPath();
  return glb ? { glb, pack: a.pack, name: a.name, id: a.id } : null;
};

/** Library lookups for track piece materials: an asset by "Pack/Name", or a pack's material by name. */
export function trackLookup(lib: Library): TrackLookup {
  return {
    asset: (ref) => usable(lib.asset(ref)),
    material: (pack, material) => {
      const want = material.toLowerCase();
      for (const r of lib.assets({ pack, limit: 5000 })) {
        const u = usable(r);
        if (!u) continue;
        try {
          const mats = readGlbJson(u.glb).materials ?? [];
          if (mats.some((m) => (m.name ?? '').toLowerCase() === want)) return u;
        } catch {
          // not a GLB we can read: skip it
        }
      }
      return null;
    },
  };
}

interface Resolved {
  id: string;
  name: string;
  spec: NormalisedModelSpec;
  /** What the export is of, for error messages. */
  label: string;
  build: () => Promise<BuildResult>;
  /** Fingerprint of everything the build reads: a different one rebuilds the cached model. */
  sourceKey: string;
  /** The asset's kind (asset exports). */
  kind?: string;
}

/**
 * resolveSpec options. `wholeAtlases`: a composite's part (CS-FB-024): its atlases kept whole, unsized and in their
 * source encoding (so parts of one pack share them byte for byte), no collider or compression; the composite crops,
 * sizes and encodes them once.
 */
interface ResolveOptions {
  wholeAtlases?: boolean;
}

/** A track piece spec (CS-FB-001): its materials sampled from the library, nothing else to resolve. */
async function resolveTrack(lib: Library, norm: NormalisedModelSpec): Promise<Resolved> {
  const name = norm.name!;
  const id = specHash(norm);
  let mats;
  try {
    mats = await resolveTrackMaterials(norm.trackpiece!.materials, trackLookup(lib));
  } catch (e) {
    throw new ModelError((e as Error).message, e instanceof TrackMaterialError ? 404 : 500);
  }
  const collider = norm.collider === 'box' ? 'box' : 'trimesh';
  const sourceKey = sha256(canonicalJson({ v: MODEL_EXPORTER_VERSION, track: TRACK_VERSION, mats: mats.materials, src: mats.sources }));
  return {
    id, name, spec: norm, label: `trackpiece ${norm.trackpiece!.preset ?? 'custom'}`, sourceKey,
    build: () => buildTrackpiece({ name, trackpiece: norm.trackpiece!, materials: mats.materials, collider, texFormat: norm.texFormat, compress: norm.compress, warnings: mats.warnings }),
  };
}

/** Resolve a spec against the library: the asset, its attachments, and the clips (from the bakes the old generator made). */
async function resolveSpec(raw: ModelSpec, o: Required<Pick<ExportOptions, 'lib' | 'cacheDir'>> & ExportOptions, opts: ResolveOptions = {}): Promise<Resolved> {
  const { lib } = o;
  let norm: NormalisedModelSpec;
  try {
    norm = normaliseSpec(raw);
  } catch (e) {
    if (e instanceof ModelSpecError || e instanceof Error) throw new ModelError((e as Error).message);
    throw e;
  }
  if (norm.trackpiece) return resolveTrack(lib, norm);
  if (norm.composite)
    return resolveComposite(norm, {
      resolvePart: (spec) => resolveSpec(spec, o, { wholeAtlases: true }).then((r) => ({ name: r.name, kind: r.kind ?? 'prop', sourceKey: r.sourceKey, build: r.build })),
      error: (m, status, code) => new ModelError(m, status, code),
    });
  // Terrain and skydomes (CS-FB-003/004): their props go through this same cache first.
  if (norm.terrain || norm.skydome)
    return resolveScenery(norm, {
      lookup: trackLookup(lib),
      exportProp: (ref, texSize) => exportModel({ asset: ref, texSize }, o),
      error: (m, status) => new ModelError(m, status),
    });
  const a = findModelAsset(lib, norm.asset!);
  const notReady = (r: AssetEntry, what: string) => new ModelError(`${what} is not ready (${r.status}${r.error ? `: ${r.error}` : ''})`, 409);
  if (a.status !== 'ready') throw notReady(a, a.name);
  const glb = a.glbPath();
  if (!glb) throw new ModelError(`${a.name}: its GLB is missing (re-ingest the pack in the old generator)`, 409);
  const name = norm.name ?? safeModelName(a.name);
  // The hash is of the resolved spec: by name or by id, the same model.
  const spec: NormalisedModelSpec = { ...norm, asset: a.id, name };
  const id = specHash(spec);
  const meta = a.meta();
  const scaleFix = a.scale().scale;
  const parts = a.roles().map((p) => ({ name: p.name, role: p.role, pivot: p.pivot, spin_axis: p.spinAxis }));

  // Attachments: a bundled mesh of the same file, or another asset.
  const own = (() => {
    try {
      return bundledMeshes(readGlbJson(glb)).map((m) => m.name);
    } catch {
      return [];
    }
  })();
  const attach: BuildAttach[] = [];
  const keyParts: unknown[] = [];
  for (const ref of norm.attach) {
    const mine = own.find((m) => m.toLowerCase() === ref.toLowerCase());
    if (mine) {
      attach.push({ name: mine, mesh: mine });
      continue;
    }
    const d = findModelAsset(lib, ref);
    if (d.status !== 'ready') throw notReady(d, `attachment ${d.name}`);
    if (d.glb === a.glb && d.bundled) {
      attach.push({ name: d.name, mesh: d.bundled.mesh });
      continue;
    }
    const g = d.glbPath();
    if (!g) throw new ModelError(`attachment ${d.name}: its GLB is missing`, 409);
    if (d.bundled) throw new ModelError(`attachment ${d.name} is a piece of another character file (${d.bundled.file}): attach pieces of this model's own file`);
    // Headwear on a character rides on the head bone (OR-FB-017), placed as the sprite renderer mounts it.
    const mount = a.kind === 'character' && boneForAttachment(d.name, d.slot) === 'head' ? 'head' : undefined;
    const dFix = d.scale().scale;
    attach.push({ name: d.name, glb: g, scaleFix: dFix, parts: d.roles().map((p) => ({ name: p.name, role: p.role, pivot: p.pivot, spin_axis: p.spinAxis })), ...(mount ? { mount } : {}) });
    keyParts.push([d.id, fileHash(g), dFix]);
  }

  // Clips (characters): the bakes the old generator made for this asset, named by the clip's library name (plus the
  // qualifiers it was asked for by, so Idle@Masculine and Idle@Feminine are two clips).
  const clips: BuildClip[] = [];
  const warnings: string[] = [];
  // CS-FB-008: a wheeled vehicle whose body is a separate piece, exported without one, is a bare chassis.
  const bodyHint =
    a.kind === 'vehicle' ? missingBodyWarning(a.name, companionsOf(a, lib.assets({ pack: a.packId, limit: 5000 })), norm.attach, parts.some((p) => isRoadWheel({ name: p.name, role: p.role }))) : null;
  if (bodyHint) warnings.push(bodyHint);
  const posing = norm.pose ? [{ name, ...norm.pose }] : (norm.poses ?? []);
  if ((norm.clips.length || posing.length) && a.kind !== 'character')
    throw new ModelError(`${a.name} is a ${a.kind}: only characters take ${norm.clips.length ? 'clips' : 'a pose'}`);
  const byId = new Map<number, BuildClip>();
  const resolveClip = async (ref: string) => {
    const p = pickClip(lib, ref, a.name);
    const n = p.row;
    const had = byId.get(n.id);
    if (had) return had;
    const file = n.bakePath(a.id, { inPlace: norm.inPlace });
    if (!file)
      throw new ModelError(
        `clip ${n.name} (#${n.id}) is not baked onto ${a.name}${norm.inPlace ? '' : ' with root motion'}: the Sloponator only merges bakes the old generator made (export the model there once, or bake the clip)`,
        409, 'not-baked',
      );
    if (p.warning) warnings.push(p.warning);
    const edit = n.edit;
    // Two clips of one name (an id, and the same name qualified): the later one is told apart by its id.
    let outName = p.outName;
    if ([...byId.values()].some((c) => c.name.toLowerCase() === outName.toLowerCase())) outName = `${n.name}@#${n.id}`;
    const c: BuildClip = { name: outName, glb: file, loop: !!n.loop, inPlace: norm.inPlace, edit, source: clipSourceOf(n) };
    byId.set(n.id, c);
    keyParts.push([n.id, fileHash(file), edit, p.candidates.map((x) => x.id)]);
    return c;
  };
  for (const ref of norm.clips) {
    const c = await resolveClip(ref);
    if (!clips.includes(c)) clips.push(c);
  }
  const poses: BuildPose[] = [];
  for (const p of posing) poses.push({ name: p.name, ref: p.clip, clip: await resolveClip(p.clip), time: p.time });

  // Synty nature shaders (foliage, triplanar ground): the pack's MaterialList, by the GLB's mesh node names.
  const packDir = lib.pack(a.packId)?.dir;
  const nature = (() => {
    try {
      const j = readGlbJson(glb);
      const meshNodes = (j.nodes ?? []).filter((n) => n.mesh !== undefined && n.name);
      // Meshes on Synty's foliage placeholder material (the FX circle).
      const placeholder = meshNodes
        .filter((n) => j.meshes?.[n.mesh!]?.primitives.some((p) => /^FX_Circle_Tex/i.test(j.materials?.[p.material ?? -1]?.name ?? '')))
        .map((n) => n.name!);
      return natureMaterialsFor(packDir, meshNodes.map((n) => n.name!), placeholder);
    } catch {
      return {};
    }
  })();
  const natureFiles = [...new Set(Object.values(nature).flatMap((m) => [m.leaf, m.trunk, m.top, m.side, m.bottom].filter((f): f is string => !!f)))].sort();
  const rigMap = a.rig()?.map ?? null;
  const gripSockets = a.grip()?.sockets?.map((s) => ({ name: s.name, pos: s.pos })) ?? [];
  const input: BuildInput = {
    name,
    source: { pack: a.pack, asset: a.name, assetId: a.id },
    kind: a.kind,
    glb,
    scaleFix,
    variant: a.variant,
    variants: meta?.variants && meta.variants.length > 1 ? meta.variants : undefined,
    bundledMesh: a.bundled?.mesh ?? null,
    parts,
    rigMap,
    gripSockets,
    attach,
    replaceWheels: spec.replaceWheels !== false,
    clips,
    origin: spec.origin,
    // Not asked for: the kind's default (props 256, vehicles and characters 1024).
    texSize: opts.wholeAtlases ? undefined : (spec.texSize ?? defaultTexSize(a.kind)),
    texFormat: opts.wholeAtlases ? 'keep' : spec.texFormat,
    ...(opts.wholeAtlases ? { cropTextures: false } : {}),
    simplify: spec.simplify,
    tint: spec.tint,
    fit: spec.fit,
    paintVariants: spec.variants,
    compress: spec.compress,
    ...(spec.splitBySwatch ? { splitBySwatch: true } : {}),
    // Grandstands, bleachers, benches (by name, or the category or a tag `seating`) get seat points (OR-FB-024).
    ...(a.kind !== 'character' && (isSeatingName(a.name) || (a.category as string | null) === 'seating' || a.tags.includes('seating')) ? { seating: true } : {}),
    ...(poses.length ? { poses, poseSingle: !!norm.pose } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(spec.collider === 'trimesh' || spec.collider === 'convex' ? { collider: spec.collider } : {}),
    ...(spec.colliderExclude ? { colliderExclude: spec.colliderExclude } : {}),
    ...(Object.keys(nature).length ? { nature, readTexture: readTexturePng } : {}),
    ...(spec.lods ? { lods: spec.lods } : {}),
    ...(spec.paint ? { paint: spec.paint } : {}),
    ...(spec.decals === false ? { decals: false } : {}),
    ...(spec.convexMaxVertices ? { convexMaxVertices: spec.convexMaxVertices } : {}),
  };
  const sourceKey = sha256(
    canonicalJson({
      v: MODEL_EXPORTER_VERSION, glb: fileHash(glb), fix: scaleFix, parts: input.parts, grip: input.gripSockets, rig: input.rigMap, keyParts,
      ...(input.seating ? { seating: SEATS_VERSION } : {}), ...(bodyHint ? { bodyHint } : {}), ...(input.collider ? { collider: COLLIDER_VERSION } : {}),
      ...(natureFiles.length ? { nature: natureFiles.map((f) => [f, fileHash(f)]) } : {}),
    }),
  );
  return { id, name, spec, label: input.source.asset, build: () => buildModel(input), sourceKey, kind: a.kind };
}

const inflight = new Map<string, Promise<ModelExport>>();

/** The files of a cached export, when they are all there. */
function cachedExport(dir: string, id: string, name: string): ModelExport | null {
  const glb = path.join(dir, `${name}.glb`), manifestFile = path.join(dir, `${name}.model.json`), keyFile = path.join(dir, 'source.key');
  if (!fs.existsSync(glb) || !fs.existsSync(manifestFile) || !fs.existsSync(keyFile)) return null;
  const sourceKey = fs.readFileSync(keyFile, 'utf8').trim();
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as ModelManifest;
  const extra = manifest.skydome?.panorama ? [path.join(dir, manifest.skydome.panorama.file)] : [];
  if (extra.some((f) => !fs.existsSync(f))) return null;
  return { id, name, rev: sourceKey.slice(0, 16), manifest, cached: true, dir, glb, manifestFile, extra };
}

/** Export (or fetch from the cache) the model a spec describes. */
export async function exportModel(spec: ModelSpec, options: ExportOptions): Promise<ModelExport> {
  const o = { ...options, cacheDir: options.cacheDir ?? defaultCacheDir() };
  const r = await resolveSpec(spec, o);
  const dir = path.join(o.cacheDir, r.id);
  const keyFile = path.join(dir, 'source.key');
  if (!o.force && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8').trim() === r.sourceKey) {
    const hit = cachedExport(dir, r.id, r.name);
    if (hit) return hit;
  }
  const running = inflight.get(r.id);
  if (running) return running;
  const p = (async () => {
    let built: BuildResult & { files?: { name: string; data: Uint8Array }[] };
    try {
      built = await r.build();
    } catch (e) {
      throw e instanceof ModelError ? e : new ModelError(`export of ${r.label} failed: ${(e as Error).message}`, 500);
    }
    fs.mkdirSync(dir, { recursive: true });
    // Written beside and renamed, so a reader never sees half a file.
    const put = (file: string, data: string | Uint8Array) => {
      fs.writeFileSync(`${file}.tmp`, data);
      fs.renameSync(`${file}.tmp`, file);
    };
    // Files of an earlier build of this spec under another name go.
    for (const f of fs.readdirSync(dir)) if (/\.(glb|model\.json|png)$/.test(f) && !f.startsWith(`${r.name}.`) && !f.startsWith(`${r.name}_`)) fs.rmSync(path.join(dir, f));
    const glb = path.join(dir, `${r.name}.glb`), manifestFile = path.join(dir, `${r.name}.model.json`);
    put(glb, built.glb);
    put(manifestFile, JSON.stringify(built.manifest, null, 2));
    put(path.join(dir, 'spec.json'), JSON.stringify(r.spec, null, 2));
    // Files beside the GLB (a skydome's panorama PNG), named in the manifest.
    const extra: string[] = [];
    for (const f of built.files ?? []) {
      put(path.join(dir, f.name), f.data);
      extra.push(path.join(dir, f.name));
    }
    put(keyFile, r.sourceKey);
    return { id: r.id, name: r.name, rev: r.sourceKey.slice(0, 16), manifest: built.manifest, cached: false, dir, glb, manifestFile, extra };
  })().finally(() => inflight.delete(r.id));
  inflight.set(r.id, p);
  return p;
}
