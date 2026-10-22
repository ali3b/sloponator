/**
 * The level half of `slop build` (ali3b/sloponator#17, #18): the `tilesets` and `maps` sections of a game's
 * ssg.assets.json, built by @slop/levels into the same files the old pipeline wrote (`<out>/tilesets/<name>/`, and
 * each map's `export` folder). build.ts calls it after the sprites, so the maps can read the sprites it just wrote:
 *
 *   const levels = await buildLevels(opts.file, { out: opts.out, only: opts.only, dataDir: opts.dataDir, lib, log });
 */
import path from 'node:path';
import { buildLevels as build, type BuildLevelsOptions, type BuildLevelsResult } from '@slop/levels';

export type { BuildLevelsResult } from '@slop/levels';

export interface LevelsOptions extends Partial<Omit<BuildLevelsOptions, 'out'>> {
  /** The content pack folder (`slop build --out`). */
  out: string;
}

/** Build the file's tilesets and maps; a file with neither does nothing (null). */
export async function buildLevels(file: string, opts: LevelsOptions): Promise<BuildLevelsResult | null> {
  const r = await build(file, { ...opts, out: path.resolve(opts.out) });
  return r.tilesets.length || r.maps.length ? r : null;
}
