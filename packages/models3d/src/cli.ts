/**
 * The command entry points `slop build` calls for the 3D side (P3, ali3b/sloponator#14/#15/#16): `buildModels`
 * reads an `ssg.models.json` and keeps a folder of GLBs + manifests in step with it; `buildTextures` does the same
 * for an `ssg.textures.json`. Both open the library read-only, build through the content-addressed cache and write
 * the same files and indexes the old `ssg model apply` / `ssg texture apply` wrote. bin/slop-models.mjs is a thin
 * wrapper for running them by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openLibrary, type Library } from '@slop/library';
import { DeclarationError } from '@slop/schema';
import { parseModelsFile } from './declarations.js';
import { applyModels, type ModelApplyResult } from './apply.js';
import { defaultCacheDir } from './resolve/resolve.js';
import { ModelError } from './resolve/errors.js';
import { applyTextures, parseTexturesFile, TextureNotFound, type TextureApplyResult } from './textures.js';

/** Where the old generator's data dir is: `$SLOP_LIBRARY_DIR`, else `$SLOP_OLD_DATA_DIR`, else the usual checkout. */
export function defaultDataDir() {
  return process.env.SLOP_LIBRARY_DIR ?? process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
}

export interface BuildOptions {
  /** The output folder (default: `public/models` or `public/textures` next to the file). */
  out?: string;
  /** Only these declared names. */
  only?: string[];
  /** Rebuild / rewrite everything, ignoring the caches and the index. */
  force?: boolean;
  /** Print the result as JSON instead of lines. */
  json?: boolean;
  /** The library's data dir (default defaultDataDir()). */
  dataDir?: string;
  /** The model cache (default `$SLOP_CACHE_DIR/models` or `~/.cache/slop/models`). */
  cacheDir?: string;
  /** An open library to reuse (else one is opened and closed here). */
  lib?: Library;
  /** Where lines go (default stderr with --json, else stdout). */
  log?: (line: string) => void;
}

/** A clean error for the CLI: the message and an exit code. */
export class BuildError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new BuildError(`cannot read ${file}: ${(e as Error).message}`, 2);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new BuildError(`${file} is not JSON: ${(e as Error).message}`, 2);
  }
}

async function withLibrary<T>(o: BuildOptions, fn: (lib: Library) => Promise<T>): Promise<T> {
  if (o.lib) return fn(o.lib);
  const dataDir = o.dataDir ?? defaultDataDir();
  let lib: Library;
  try {
    lib = openLibrary({ dataDir });
  } catch (e) {
    throw new BuildError(`no library at ${dataDir} (${(e as Error).message}); set SLOP_LIBRARY_DIR`, 2);
  }
  try {
    return await fn(lib);
  } finally {
    lib.close();
  }
}

const rethrow = (e: unknown): never => {
  if (e instanceof BuildError) throw e;
  if (e instanceof DeclarationError) throw new BuildError(e.message, 2);
  if (e instanceof ModelError || e instanceof TextureNotFound) throw new BuildError(e.message, e.status === 404 ? 3 : e.status === 400 ? 2 : 1);
  throw e;
};

const logger = (o: BuildOptions) => o.log ?? ((line: string) => (o.json ? process.stderr : process.stdout).write(`${line}\n`));

/**
 * `slop build` for models: read `file` (an ssg.models.json), export every model it declares through the cache and
 * keep `out` (default `public/models` beside the file) in step with it: `<name>.glb`, `<name>.model.json` and the
 * `models.json` index.
 */
export async function buildModels(file: string, o: BuildOptions = {}): Promise<ModelApplyResult> {
  const say = logger(o);
  const out = o.out ?? path.join(path.dirname(path.resolve(file)), 'public', 'models');
  try {
    const decls = parseModelsFile(readJson(file), file);
    return await withLibrary(o, async (lib) => {
      const r = await applyModels(decls, out, { lib, cacheDir: o.cacheDir ?? defaultCacheDir(), force: o.force, only: o.only, onLine: say });
      if (o.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      else say(`${r.models.length} model${r.models.length === 1 ? '' : 's'} in ${r.dir}: ${summary(r.models.map((m) => m.action))}${r.removed.length ? `, ${r.removed.length} removed` : ''}`);
      return r;
    });
  } catch (e) {
    return rethrow(e);
  }
}

/**
 * `slop build` for textures: read `file` (an ssg.textures.json) and keep `out` (default `public/textures` beside the
 * file) in step with it: `<name>.png|webp`, `<name>.json` and the `textures.json` index.
 */
export async function buildTextures(file: string, o: BuildOptions = {}): Promise<TextureApplyResult> {
  const say = logger(o);
  const out = o.out ?? path.join(path.dirname(path.resolve(file)), 'public', 'textures');
  try {
    const decls = parseTexturesFile(readJson(file), file);
    return await withLibrary(o, async (lib) => {
      const r = await applyTextures(decls, out, { lib, force: o.force, only: o.only, onLine: say });
      if (o.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      else say(`${r.textures.length} texture${r.textures.length === 1 ? '' : 's'} in ${r.dir}: ${summary(r.textures.map((t) => t.action))}${r.removed.length ? `, ${r.removed.length} removed` : ''}`);
      return r;
    });
  } catch (e) {
    return rethrow(e);
  }
}

function summary(actions: string[]) {
  const n = (a: string) => actions.filter((x) => x === a).length;
  return [n('written') && `${n('written')} written`, n('updated') && `${n('updated')} updated`, n('unchanged') && `${n('unchanged')} unchanged`].filter(Boolean).join(', ') || 'nothing to do';
}
