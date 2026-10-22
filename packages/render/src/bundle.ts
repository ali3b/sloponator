/**
 * The render bundle: `web/` built once by Vite into the cache dir, in a folder named by the hash of its sources, and
 * identified everywhere else by the hash of what came out (`bundleHash`). The frame cache keys carry `bundleHash`,
 * so a renderer change (any change: three.js, a shader, a template, @slop/sprites' measuring code) invalidates every
 * cached frame by itself. The old generator bumped a RENDERER_VERSION constant for that, 3 times in 131 commits.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
/** packages/render/web: the bundle's sources. */
export const WEB_DIR = path.resolve(here, '../web');
/** packages/sprites/src: bundled into the page too (measuring, events, cache keys), so it is part of the identity. */
const SPRITES_SRC = path.resolve(here, '../../sprites/src');

export interface BundleInfo {
  /** Where the built files are. */
  dir: string;
  /** SHA-256 (first 16 hex) over the built output: the renderer's identity in frame-cache keys. */
  hash: string;
  /** SHA-256 (first 16 hex) over the sources and pinned dependency versions: names the folder, decides when to rebuild. */
  sourceHash: string;
  builtAt: string;
  three: string;
  vite: string;
}

/** The default cache dir: $SLOP_CACHE_DIR, else ~/.cache/slop. */
export function defaultCacheDir(): string {
  return process.env.SLOP_CACHE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(process.env.HOME ?? '.', '.cache'), 'slop');
}

function walk(dir: string, into: string[], skip: (name: string) => boolean) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (skip(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, into, skip);
    else into.push(p);
  }
}

/** Hash of a directory's files: relative path and bytes, in sorted order. */
export function hashDir(dir: string, skip: (name: string) => boolean = () => false): string {
  const h = crypto.createHash('sha256');
  const files: string[] = [];
  walk(dir, files, skip);
  for (const f of files) h.update(path.relative(dir, f)).update('\0').update(fs.readFileSync(f)).update('\0');
  return h.digest('hex').slice(0, 16);
}

/** An installed package's version: its package.json, found upwards from one of its resolvable files. */
const versionOf = (pkg: string, entry: string) => {
  const require = createRequire(import.meta.url);
  for (let d = path.dirname(require.resolve(entry)); d !== path.dirname(d); d = path.dirname(d)) {
    const f = path.join(d, 'package.json');
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { name?: string; version?: string };
      if (j.name === pkg && j.version) return j.version;
    }
  }
  throw new Error(`cannot find the version of ${pkg}`);
};

/** The hash of the bundle's inputs: web/ sources, @slop/sprites sources, three and vite versions. */
export function bundleSourceHash(): { hash: string; three: string; vite: string } {
  const three = versionOf('three', 'three');
  const vite = versionOf('vite', 'vite/package.json');
  const h = crypto.createHash('sha256');
  const skipTests = (n: string) => n.endsWith('.test.ts') || n.endsWith('.fixture.json') || n === 'tsconfig.json';
  h.update(`three@${three}\nvite@${vite}\n`).update(hashDir(WEB_DIR, skipTests)).update(hashDir(SPRITES_SRC, skipTests));
  return { hash: h.digest('hex').slice(0, 16), three, vite };
}

/**
 * The built bundle for the current sources: found under `<cacheDir>/bundles/<sourceHash>/`, or built there now
 * (Vite, about 3 s). `force` rebuilds even when it exists.
 */
export async function ensureBundle(opts: { cacheDir?: string; force?: boolean; log?: (m: string) => void } = {}): Promise<BundleInfo> {
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const src = bundleSourceHash();
  const dir = path.join(cacheDir, 'bundles', src.hash);
  const infoFile = path.join(dir, 'bundle.json');
  if (!opts.force && fs.existsSync(infoFile)) {
    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as BundleInfo;
    if (info.sourceHash === src.hash && fs.existsSync(path.join(dir, 'index.html'))) return { ...info, dir };
  }
  opts.log?.(`building the render bundle (sources ${src.hash}) into ${dir}`);
  const tmp = `${dir}.building-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  const { build } = await import('vite');
  await build({ configFile: path.join(WEB_DIR, 'vite.config.ts'), root: WEB_DIR, logLevel: 'warn', build: { outDir: tmp, emptyOutDir: true } });
  const hash = hashDir(tmp);
  const info: BundleInfo = { dir, hash, sourceHash: src.hash, builtAt: new Date().toISOString(), three: src.three, vite: src.vite };
  fs.writeFileSync(path.join(tmp, 'bundle.json'), JSON.stringify(info, null, 2));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  opts.log?.(`render bundle ${hash} built (three ${src.three}, vite ${src.vite})`);
  return info;
}
