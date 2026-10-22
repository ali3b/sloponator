// Moved from synty-sprite-generator packages/client/src/models.ts applyModels / downloadModel (P3,
// ali3b/sloponator#16): the output folder kept in step with ssg.models.json and its models.json index, with the
// same names and contents as `ssg model apply` wrote. The server is gone: exports come from the local cache, and
// "downloading" is copying out of it. The project sync and the pack-ingesting skips (CS-FB-010) did not move.
import fs from 'node:fs';
import path from 'node:path';
import type { ModelManifest } from './spec/index.js';
import { indexAssetOf, modelFileNames, type ModelDecl } from './declarations.js';
import { exportModel, type ExportOptions, type ModelExport } from './resolve/resolve.js';
import { ModelError } from './resolve/errors.js';

/** The `models.json` index written next to the files. */
export interface ModelsIndex {
  version: 1;
  models: Record<string, ModelsIndexEntry>;
}

export interface ModelsIndexEntry {
  /** The export id (spec hash) and build revision: unchanged id and rev = unchanged files. */
  id: string;
  rev?: string;
  /** The asset, or `trackpiece:<preset>`, `terrain:<tile|grid>`, `skydome:<preset>`, `composite:<parts>`. */
  asset: string | number;
  /** File names in the folder. */
  glb: string;
  manifest: string;
  /** The manifest itself, so a game can load this one file. */
  data: ModelManifest;
}

export const MODELS_INDEX = 'models.json';

export interface ModelApplyItem {
  name: string;
  id: string;
  rev: string;
  action: 'written' | 'updated' | 'unchanged';
  /** The cache already had this export (nothing was built). */
  cached: boolean;
  glb: string;
  manifest: string;
}

export interface ModelApplyResult {
  dir: string;
  index: string;
  models: ModelApplyItem[];
  /** Files this tool wrote before that the file no longer declares (deleted). */
  removed: string[];
}

/** The previous index, or null; a broken or foreign file is ignored (and nothing is removed for it). */
export function readModelsIndex(file: string): ModelsIndex | null {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8')) as ModelsIndex;
    return d && d.version === 1 && d.models && typeof d.models === 'object' ? d : null;
  } catch {
    return null;
  }
}

/** A file name from an index entry, only when it is a plain name in the folder (never ../ or a path). */
const plainName = (f: unknown): string | null => (typeof f === 'string' && f && path.basename(f) === f && f !== '.' && f !== '..' && f !== MODELS_INDEX ? f : null);

/** Copy an export's GLB and manifest into `dir` (created) under `name`. Returns the files written. */
export function writeModel(exp: ModelExport, dir: string, name = exp.name): { dir: string; glb: string; manifest: string; files: string[] } {
  fs.mkdirSync(dir, { recursive: true });
  const names = modelFileNames(name);
  const glb = path.join(dir, names.glb);
  const manifest = path.join(dir, names.manifest);
  fs.copyFileSync(exp.glb, glb);
  const data = JSON.parse(JSON.stringify(exp.manifest)) as ModelManifest;
  // Files beside the GLB the manifest names (a skydome's panorama PNG), renamed after `name` like the GLB.
  const extra: string[] = [];
  const pano = data.skydome?.panorama;
  if (pano) {
    const base = `${names.glb.replace(/\.glb$/, '')}_panorama.png`;
    fs.copyFileSync(path.join(exp.dir, pano.file), path.join(dir, base));
    extra.push(path.join(dir, base));
    pano.file = base;
  }
  fs.writeFileSync(manifest, `${JSON.stringify(data, null, 2)}\n`);
  return { dir, glb, manifest, files: [glb, manifest, ...extra] };
}

export interface ApplyOptions extends ExportOptions {
  /** Only these models (by declared name); the rest keep their files and index entries. */
  only?: string[];
  onLine?: (line: string) => void;
}

/**
 * Export every declared model and keep `dir` in step: copy only what changed (by export id and revision), delete the
 * files of models no longer declared (only files the previous models.json lists), and write models.json.
 * Every spec is resolved and built before anything in the folder changes; an export error stops the run with the
 * folder unchanged.
 */
export async function applyModels(decls: ModelDecl[], dir: string, opts: ApplyOptions): Promise<ModelApplyResult> {
  const say = opts.onLine ?? (() => {});
  const indexFile = path.join(dir, MODELS_INDEX);
  const prev = readModelsIndex(indexFile);
  const wanted = opts.only ? new Set(opts.only.map((n) => n.toLowerCase())) : null;
  if (wanted) {
    const names = new Set(decls.map((d) => d.name.toLowerCase()));
    const missing = [...wanted].filter((n) => !names.has(n));
    if (missing.length) throw new ModelError(`no model named ${missing.map((n) => `"${n}"`).join(', ')} in the file (declared: ${decls.map((d) => d.name).join(', ')})`, 404);
  }
  const chosen = wanted ? decls.filter((d) => wanted.has(d.name.toLowerCase())) : decls;
  const exports: { d: ModelDecl; exp: ModelExport }[] = [];
  for (const d of chosen) {
    try {
      const exp = await exportModel(d.spec, opts);
      say(`${d.name}: ${exp.cached ? 'cached' : 'built'} (${exp.id}:${exp.rev})`);
      exports.push({ d, exp });
    } catch (e) {
      throw new ModelError(`model ${d.name}: ${(e as Error).message}${exports.length ? ' (the folder was not changed)' : ''}`, (e as ModelError).status, (e as ModelError).code);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const items: ModelApplyItem[] = [];
  const index: ModelsIndex = { version: 1, models: {} };
  // With `only`, the other models keep their entries (and so their files).
  if (wanted) for (const [n, m] of Object.entries(prev?.models ?? {})) if (!wanted.has(n.toLowerCase())) index.models[n] = m;
  for (const { d, exp } of exports) {
    const files = modelFileNames(d.name);
    const old = prev?.models[d.name];
    const present = fs.existsSync(path.join(dir, files.glb)) && fs.existsSync(path.join(dir, files.manifest));
    let action: ModelApplyItem['action'] = 'unchanged';
    if (!old || old.id !== exp.id || old.rev !== exp.rev || old.glb !== files.glb || old.manifest !== files.manifest || !present) {
      writeModel(exp, dir, d.name);
      action = old ? 'updated' : 'written';
      say(`${d.name}: ${action}`);
    }
    items.push({ name: d.name, id: exp.id, rev: exp.rev, action, cached: exp.cached, glb: files.glb, manifest: files.manifest });
    // The index carries the manifest as written (a panorama file renamed after the model).
    const data = action === 'unchanged' && old ? old.data : (JSON.parse(fs.readFileSync(path.join(dir, files.manifest), 'utf8')) as ModelManifest);
    index.models[d.name] = { id: exp.id, rev: exp.rev, asset: indexAssetOf(d.spec), glb: files.glb, manifest: files.manifest, data };
  }
  // Stale files: ones the previous index lists that the new one does not.
  const keep = new Set(Object.values(index.models).flatMap((m) => [m.glb, m.manifest, m.data?.skydome?.panorama?.file].filter((f): f is string => !!f)));
  const removed: string[] = [];
  for (const m of Object.values(prev?.models ?? {})) {
    for (const f of [plainName(m?.glb), plainName(m?.manifest), plainName(m?.data?.skydome?.panorama?.file)]) {
      if (!f || keep.has(f) || removed.includes(f)) continue;
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        fs.rmSync(p);
        removed.push(f);
        say(`removed ${f}`);
      }
    }
  }
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  return { dir, index: indexFile, models: items, removed };
}
