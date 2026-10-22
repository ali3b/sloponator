/**
 * Texture terrains (Node): find the Synty texture a terrain names in the installed packs, decode it, and give its
 * average colour. Moved from the old generator's apps/server/src/tileRender.ts (resolveTexture, loadTerrainTextures)
 * and textures.ts (averageColor, textureTerrains), with the database replaced by a list of pack folders (the old
 * library's `packs` table, read through @slop/library, or any folders a caller gives).
 *
 * The old ground renderer was never a browser one: the server decoded the texture and drew the atlas with the pure
 * renderer (raster.ts). So texture terrains render here exactly as they did, with no render bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeImage } from './image.js';
import type { RgbaImage } from './raster.js';
import type { Terrain, TilesetBody } from './types.js';

export interface TextureRoots {
  /** The installed packs' root (`<dataDir>/packs`): texture paths resolve inside it. */
  packsDir: string;
  /** The model packs' own folders (absolute), where a path relative to a pack resolves too. */
  packDirs?: string[];
  /** Asset id → its own albedo texture file (an asset-id texture source); null when unknown. */
  assetTexture?: (assetId: number) => string | null;
}

export const inside = (root: string, p: string) => {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Every .png / .tga under a folder (symlinked folders followed), up to `limit`. */
export function walk(root: string, out: string[] = [], limit = 200_000): string[] {
  if (out.length >= limit || !fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory() || (e.isSymbolicLink() && fs.statSync(p, { throwIfNoEntry: false })?.isDirectory())) walk(p, out, limit);
    else if (/\.(png|tga)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const walked = new Map<string, string[]>();
const walkCached = (root: string) => {
  let hit = walked.get(root);
  if (!hit) walked.set(root, (hit = walk(root)));
  return hit;
};

/**
 * The file a texture source names. `path` may be absolute (inside the packs), relative to the packs folder
 * ("POLYGON_Generic_v3/Textures/Generic_Grass.png"), relative to a pack ("Textures/Generic_Grass.png"), or just a
 * trailing part of the path; the shortest match wins. `assetId` takes the asset's own (albedo) texture.
 */
export function resolveTexture(roots: TextureRoots, src: { assetId?: number; path?: string }): string | null {
  const packDirs = (roots.packDirs ?? []).filter(Boolean);
  const allowed = (f: string) => inside(roots.packsDir, f) || packDirs.some((d) => inside(d, f));
  if (src.path) {
    const p = src.path.replace(/\\/g, '/');
    const direct = path.isAbsolute(p) ? [p] : [path.join(roots.packsDir, p), ...packDirs.map((d) => path.join(d, p))];
    for (const f of direct) if (allowed(f) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    const tail = '/' + p.replace(/^\/+/, '').toLowerCase();
    const hits = [roots.packsDir, ...packDirs.filter((d) => !inside(roots.packsDir, d))]
      .flatMap((r) => walkCached(r))
      .filter((f) => ('/' + f.split(path.sep).join('/').toLowerCase()).endsWith(tail));
    hits.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return hits[0] ?? null;
  }
  if (src.assetId !== undefined) {
    const tex = roots.assetTexture?.(src.assetId) ?? null;
    return tex && allowed(tex) && fs.existsSync(tex) ? tex : null;
  }
  return null;
}

const decoded = new Map<string, { mtime: number; image: RgbaImage }>();

export function loadTexture(file: string): RgbaImage {
  const mtime = fs.statSync(file).mtimeMs;
  const hit = decoded.get(file);
  if (hit && hit.mtime === mtime) return hit.image;
  const image = decodeImage(file, fs.readFileSync(file));
  if (decoded.size > 16) decoded.delete(decoded.keys().next().value as string);
  decoded.set(file, { mtime, image });
  return image;
}

/** A texture's average colour "#rrggbb" (sampled on a grid of at most ~65k pixels; transparent ones skipped). */
export function averageColor(img: RgbaImage): string {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 65536)));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < img.height; y += step)
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < 8) continue;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
  const h = (v: number) => Math.round(n ? v / n : 128).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Names close to a missing texture path (same file name, or containing its base name), for the error. */
function suggestTextures(roots: TextureRoots, p: string, n = 5): string[] {
  const base = path.basename(p).toLowerCase().replace(/\.(png|tga)$/i, '');
  const all = [roots.packsDir, ...(roots.packDirs ?? [])].flatMap((r) => walkCached(r));
  const rel = (f: string) => (inside(roots.packsDir, f) ? path.relative(roots.packsDir, f) : f).split(path.sep).join('/');
  const hits = all.filter((f) => path.basename(f).toLowerCase().replace(/\.(png|tga)$/i, '').includes(base));
  return [...new Set(hits.map(rel))].sort((a, b) => a.length - b.length).slice(0, n);
}

/**
 * The texture terrains of a body resolved: each texture found, decoded and its average colour filled into the
 * source (the Tiled wang colour of an untinted texture). Errors name the terrain and the closest textures.
 */
export function textureTerrains(roots: TextureRoots, body: Pick<TilesetBody, 'terrains'>): { terrains: Terrain[]; textures: Record<string, RgbaImage>; errors: string[] } {
  const errors: string[] = [];
  const textures: Record<string, RgbaImage> = {};
  const terrains = body.terrains.map((t) => {
    const s = t.source;
    if (s.type !== 'texture') return t;
    const what = s.path ?? `asset ${s.assetId}`;
    const file = resolveTexture(roots, s);
    if (!file) {
      const near = s.path ? suggestTextures(roots, s.path) : [];
      errors.push(`terrain "${t.name}": texture ${what} isn't in the installed packs (${roots.packsDir}).${near.length ? ` Closest: ${near.join(', ')}.` : ''}`);
      return t;
    }
    try {
      const image = loadTexture(file);
      textures[t.id] = image;
      return { ...t, source: { ...s, color: averageColor(image) } };
    } catch (e) {
      errors.push(`terrain "${t.name}": can't read ${path.basename(file)}: ${(e as Error).message}`);
      return t;
    }
  });
  return { terrains, textures, errors };
}
