/**
 * `slop build`: a game's ssg.assets.json → its content pack, like a compiler (docs/PLAN.md §3). Validates the file
 * (@slop/schema), plans every sprite (plan/), renders each through @slop/render (one Chromium for the whole build,
 * frames from the cache when their key matches) and packs it with @slop/sprites into `<out>/<name>/`, the files the
 * old `ssg sprite apply --render --download` wrote (same names, same manifests) so a game's loader is unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assetsFile, validate, formatErrors, type AssetsFile } from '@slop/schema';
import { openLibrary, type Library } from '@slop/library';
import { startRunner, type GpuChoice, type Runner } from '@slop/render';
import { bakeForBuild } from '@slop/bake';
import type { ValidationIssue } from '@slop/sprites';
import { planSprites, projectDefaultsFrom, parseApplyFile, safeName, type PlannedSprite, type ProjectDefaults } from '../plan/index.js';
import { pack } from './pack.js';

export const OLD_DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? path.join(process.env.HOME ?? '.', 'projects/synty-sprite-generator/data');

export interface BuildOptions {
  /** The ssg.assets.json. */
  file: string;
  /** Where the pack goes: `<out>/<sprite name>/`. */
  out: string;
  gpu?: GpuChoice;
  /** Build only these sprites (siblings still count for uniform frames). */
  only?: string[];
  /** Render every frame again (nothing from the frame cache). */
  force?: boolean;
  /** The old generator's data dir (library.db, glb/, bakes/…); default $SLOP_OLD_DATA_DIR or ~/projects/synty-sprite-generator/data. */
  dataDir?: string;
  /** $SLOP_CACHE_DIR or ~/.cache/slop. */
  cacheDir?: string;
  /** Progress lines (stderr). */
  log?: (m: string) => void;
  /** A library already open (tests); else one is opened on dataDir and closed at the end. */
  lib?: Library;
  /** The `generatedAt` the data files record; default: the declaration file's mtime, so an unchanged file rebuilds byte for byte. */
  generatedAt?: string;
}

export interface BuiltSprite {
  name: string;
  asset: string;
  kind: string;
  dir: string;
  files: string[];
  /** Clip × direction × frame counts. */
  clips: number;
  directions: number;
  frames: number;
  /** Frames taken from the frame cache. */
  cached: number;
  /** Render + pack wall time, ms. */
  ms: number;
  validation: ValidationIssue[];
  warnings: string[];
  error?: string;
}

export interface BuildResult {
  file: string;
  out: string;
  project: { name: string | null; defaults: 'file' | 'old project' | 'built-in' };
  bundle: string;
  backend: 'gpu' | 'software';
  glRenderer: string;
  sprites: BuiltSprite[];
  /** Declared things this version does not build yet. */
  skipped: string[];
  seconds: number;
  ok: boolean;
}

export class BuildError extends Error {}

/** The version the data files record as their maker. */
export const GENERATOR = { name: 'Sloponator', version: '0.0.0' };

const DEFAULT_KEYS = ['view', 'look', 'size', 'format', 'fps', 'dirs', 'ppm', 'tile', 'frame', 'scale', 'layers', 'uniform', 'layered', 'gender', 'pixelArt', 'outline', 'palette', 'shadow', 'supersample', 'metresPerTile', 'pitch', 'projection', 'mirror', 'facings', 'slice', 'collision', 'collisionHeight', 'atlas', 'animPrefix', 'movePrefix', 'maxSeconds'];

/**
 * The shared sprite settings: the file's own (`defaults` / top-level keys), else — a file written for the old
 * generator, where they lived in its project — the old project's, when the library still has it, else the built-in
 * defaults (top-down 8, clean, medium, generic).
 */
export function resolveProject(file: AssetsFile, lib: Library, log: (m: string) => void): { name: string | null; defaults: ProjectDefaults; source: BuildResult['project']['defaults'] } {
  const parsed = parseApplyFile(file);
  const name = file.project === undefined ? null : String(file.project);
  const own = Object.keys(parsed.defaults).filter((k) => DEFAULT_KEYS.includes(k));
  if (own.length) return { name, defaults: projectDefaultsFrom(parsed.defaults), source: 'file' };
  const old = name ? lib.project(name) : undefined;
  if (old && old.defaults && typeof old.defaults === 'object' && 'viewCardId' in old.defaults) {
    const d = old.defaults as unknown as ProjectDefaults;
    log(`project "${name}": view ${d.viewCardId}, look ${d.lookId}, size ${d.sizeId}, format ${d.profileId}, fps ${d.view?.fps} taken from the old generator's project (the file sets none; put them in "defaults" to be explicit)`);
    return { name, defaults: d, source: 'old project' };
  }
  return { name, defaults: projectDefaultsFrom({}), source: 'built-in' };
}

/** Read and validate the declaration file; a DeclarationError-style message on failure. */
export function readAssetsFile(file: string): AssetsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new BuildError(`cannot read ${file}: ${(e as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new BuildError(`${file} is not JSON: ${(e as Error).message}`);
  }
  const r = validate(assetsFile, data);
  if (!r.ok) throw new BuildError(formatErrors(r.errors, file));
  return r.value;
}

/** Everything of the sprite's folder replaced by the pack's files (as the old writeSpriteFiles did). */
export function writeSpriteDir(outDir: string, name: string, files: Record<string, Uint8Array>): { dir: string; files: string[] } {
  const dir = path.resolve(outDir, safeName(name));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [n, bytes] of Object.entries(files)) {
    const target = path.resolve(dir, n);
    if (!target.startsWith(dir + path.sep)) continue; // never write outside the folder
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    written.push(target);
  }
  return { dir, files: written };
}

/** One sprite: render, pack, write. */
export async function buildSprite(runner: Runner, p: PlannedSprite, outDir: string, generatedAt: string, log: (m: string) => void): Promise<BuiltSprite> {
  const t0 = performance.now();
  const r = await runner.render({ asset: p.asset.id, spec: p.batch }, { onProgress: (m) => log(`  ${p.name}: ${m}`) });
  const packed = await pack(p.batch, r, { generator: { ...GENERATOR, generatedAt } });
  const w = writeSpriteDir(outDir, p.name, packed.files);
  const dirs = r.output.directions.filter((d) => d.mirrorOf === null).length;
  return {
    name: p.name, asset: `${p.asset.pack}/${p.asset.name}`, kind: p.kind, dir: w.dir, files: w.files.map((f) => path.basename(f)),
    clips: r.output.clips.length, directions: dirs, frames: r.output.cache.total, cached: r.output.cache.reused, ms: Math.round(performance.now() - t0),
    validation: packed.validation, warnings: p.warnings,
  };
}

export async function build(opts: BuildOptions): Promise<BuildResult> {
  const log = opts.log ?? (() => undefined);
  const t0 = performance.now();
  const file = readAssetsFile(opts.file);
  const dataDir = opts.dataDir ?? OLD_DATA_DIR;
  if (!opts.lib && !fs.existsSync(path.join(dataDir, 'library.db'))) throw new BuildError(`no library at ${dataDir} (the old generator's data dir: --data-dir or SLOP_OLD_DATA_DIR)`);
  const lib = opts.lib ?? openLibrary({ dataDir });
  const skipped: string[] = [];
  if (file.tilesets?.length) skipped.push(`tilesets (${file.tilesets.map((t) => t.name).join(', ')}): not built by this version (P4)`);
  if (file.maps?.length) skipped.push(`maps: not built by this version (P4)`);
  try {
    const project = resolveProject(file, lib, log);
    const planned = await planSprites(file, { lib, project: project.defaults, force: opts.force, only: opts.only, warn: (m) => log(`warning: ${m}`) });
    for (const p of planned) {
      const unsupported = p.batch.layered ? 'layered equipment sheets' : p.batch.split ? 'the waist split' : p.batch.turret ? 'the turret split' : p.batch.portrait ? 'portraits' : null;
      if (unsupported) throw new BuildError(`${p.name}: ${unsupported} are not supported by this version of slop build yet`);
    }
    const generatedAt = opts.generatedAt ?? fs.statSync(opts.file).mtime.toISOString();
    fs.mkdirSync(opts.out, { recursive: true });
    // Blender bakes (@slop/bake) for every clip the plan needs, before the browser starts: never beside the render.
    const bakes = await bakeForBuild(planned.map((p) => ({ asset: p.asset.id, spec: p.batch, name: p.name })), { lib, cacheDir: opts.cacheDir, log });
    const runner = await startRunner({ lib, gpu: opts.gpu ?? 'auto', cacheDir: opts.cacheDir, log, bakes: bakes.store });
    const sprites: BuiltSprite[] = [];
    try {
      let i = 0;
      for (const p of planned) {
        i++;
        const n = p.batch.set.items.length;
        log(`sprite ${i}/${planned.length} ${p.name}: ${p.asset.pack}/${p.asset.name}, ${n} move${n === 1 ? '' : 's'}`);
        try {
          const b = await buildSprite(runner, p, opts.out, generatedAt, log);
          sprites.push(b);
          log(`sprite ${i}/${planned.length} ${p.name}: ${b.clips} clip${b.clips === 1 ? '' : 's'} × ${b.directions} dir${b.directions === 1 ? '' : 's'}, ${b.frames} frames, ${b.cached} from cache, ${(b.ms / 1000).toFixed(1)} s → ${path.relative(process.cwd(), b.dir) || '.'}${b.validation.length ? ` (${b.validation.map((v) => `${v.level}:${v.code}`).join(', ')})` : ''}`);
        } catch (e) {
          const msg = (e as Error).message;
          sprites.push({ name: p.name, asset: `${p.asset.pack}/${p.asset.name}`, kind: p.kind, dir: path.resolve(opts.out, safeName(p.name)), files: [], clips: 0, directions: 0, frames: 0, cached: 0, ms: 0, validation: [], warnings: p.warnings, error: msg });
          log(`sprite ${i}/${planned.length} ${p.name}: FAILED: ${msg}`);
        }
      }
      return {
        file: opts.file, out: path.resolve(opts.out), project: { name: project.name, defaults: project.source }, bundle: runner.bundle.hash, backend: runner.backend, glRenderer: runner.glRenderer,
        sprites, skipped, seconds: +((performance.now() - t0) / 1000).toFixed(1), ok: sprites.every((s) => !s.error),
      };
    } finally {
      await runner.close();
    }
  } finally {
    if (!opts.lib) lib.close();
  }
}
