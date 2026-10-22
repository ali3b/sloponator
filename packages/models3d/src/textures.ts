// Moved from synty-sprite-generator apps/server/src/textures.ts (the texture list, search, frame detection and
// export), apps/server/src/tileRender.ts (walk, inside, resolveTexture, loadTexture) and
// packages/client/src/textures.ts (parseTexturesFile, applyTextures) (P3, ali3b/sloponator#15). The pack folders
// come from @slop/library; the tileset terrain checks stay with the levels package.
import fs from 'node:fs';
import path from 'node:path';
import type { Library } from '@slop/library';
import { assertValid, texturesFile } from '@slop/schema';
import { sha256 } from '@slop/sprites';
import { decodeImage, encodePng, type RgbaImage } from './build/png.js';

export const TEXTURE_KINDS = ['grass', 'dirt', 'sand', 'rock', 'snow', 'water', 'road'] as const;
export type TextureKind = (typeof TEXTURE_KINDS)[number];

/** Name words that say what ground a texture shows (checked in this order: "Sand_Rock" is sand). */
const KIND_WORDS: [TextureKind, RegExp][] = [
  ['snow', /snow|ice|frost/],
  ['water', /water|ocean|sea|river|lake|pond/],
  ['sand', /sand|desert|beach|dune/],
  ['grass', /grass|lawn|turf|meadow|moss|field/],
  ['road', /road|asphalt|tarmac|street|pavement|concrete|cobble|brick|path|tile/],
  ['rock', /rock|stone|cliff|gravel|pebble|boulder/],
  ['dirt', /dirt|soil|mud|earth|ground|terrain|farm/],
];

/** A guess of the ground a texture shows, from its file name (and its folder when the name says nothing). */
export function guessTextureKind(rel: string): TextureKind | null {
  const parts = rel.toLowerCase().split(/[\\/]/);
  for (const s of [parts[parts.length - 1], parts.slice(-2).join('/')]) for (const [k, re] of KIND_WORDS) if (re.test(s)) return k;
  return null;
}

/** What a texture map is for: only colour (albedo) maps make ground; normal maps, masks etc. are listed with --all. */
export function textureRole(rel: string): 'color' | 'normal' | 'mask' | 'fx' {
  const n = path.basename(rel).toLowerCase();
  if (/normal|_n\.|_nrm|bump|height/.test(n)) return 'normal';
  if (/mask|_ao\b|_ao\.|occlusion|rough|metal|spec|emiss|gloss|_m\.|_e\.|lensdirt|alpha/.test(n)) return 'mask';
  if (/^fx_|particle|smoke|fire|spark|flare|decal/.test(n)) return 'fx';
  return 'color';
}

export interface TextureInfo {
  /** Path to give `texture`: relative to the packs folder ("POLYGON_Generic_v3/Textures/Generic_Grass.png"). */
  path: string;
  pack: string;
  file: string;
  width: number | null;
  height: number | null;
  bytes: number;
  kind: TextureKind | null;
  role: ReturnType<typeof textureRole>;
}

/** Width and height from a PNG's IHDR or a TGA's header, without decoding. */
function imageSize(file: string): [number, number] | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    if (/\.png$/i.test(file) && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (/\.tga$/i.test(file)) return [b.readUInt16LE(12), b.readUInt16LE(14)];
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export const inside = (root: string, p: string) => {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Every PNG and TGA under a folder (symlinked pack folders followed). */
export function walk(root: string, out: string[] = [], limit = 200_000): string[] {
  if (out.length >= limit || !fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory() || (e.isSymbolicLink() && fs.statSync(p, { throwIfNoEntry: false })?.isDirectory())) walk(p, out, limit);
    else if (/\.(png|tga)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** The pack folders textures live in: the library's packs folder and each model pack's own dir. */
function packsOf(lib: Library) {
  const packsDir = path.join(lib.dataDir, 'packs');
  const packs = lib.packs().filter((p) => p.kind === 'models' && p.dir);
  return { packsDir, packs };
}

const listCache = new WeakMap<Library, { key: string; list: TextureInfo[] }>();

/** Every texture image in the installed model packs (listed once per library). */
export function allTextures(lib: Library): TextureInfo[] {
  const { packsDir, packs } = packsOf(lib);
  const key = JSON.stringify([packsDir, packs.map((p) => [p.name, p.dir])]);
  const had = listCache.get(lib);
  if (had && had.key === key) return had.list;
  const roots = [packsDir, ...packs.map((p) => p.dir).filter((d) => !inside(packsDir, d))];
  const list: TextureInfo[] = [];
  const seen = new Set<string>();
  for (const root of roots)
    for (const f of walk(root)) {
      if (seen.has(f)) continue;
      seen.add(f);
      const rel = (inside(packsDir, f) ? path.relative(packsDir, f) : path.join(path.basename(root), path.relative(root, f))).split(path.sep).join('/');
      if (rel.startsWith('_') || rel.includes('/.')) continue; // uploads and hidden folders
      const pack = packs.find((p) => inside(p.dir, f));
      const size = imageSize(f);
      list.push({
        path: rel, pack: pack?.name ?? rel.split('/')[0], file: path.basename(f), width: size?.[0] ?? null, height: size?.[1] ?? null,
        bytes: fs.statSync(f).size, kind: guessTextureKind(rel), role: textureRole(rel),
      });
    }
  list.sort((a, b) => a.path.localeCompare(b.path));
  listCache.set(lib, { key, list });
  return list;
}

export interface TextureQuery {
  search?: string;
  pack?: string;
  /** Also normal maps, masks and effect textures. */
  all?: boolean;
  limit?: number;
}

const tokens = (s: string) => s.toLowerCase().replace(/\.(png|tga)$/i, '').split(/[^a-z0-9]+/).filter(Boolean);

/** Search textures: every word must be in the path (or be its guessed kind); ground kinds and big maps first. */
export function searchTextures(lib: Library, q: TextureQuery = {}): { total: number; textures: TextureInfo[] } {
  const words = tokens(q.search ?? '');
  const pack = q.pack?.toLowerCase();
  const hits = allTextures(lib).filter((t) => {
    if (!q.all && t.role !== 'color') return false;
    if (pack && !t.pack.toLowerCase().includes(pack) && !t.path.toLowerCase().startsWith(pack)) return false;
    const hay = t.path.toLowerCase();
    return words.every((w) => hay.includes(w) || t.kind === w);
  });
  hits.sort((a, b) => Number(!a.kind) - Number(!b.kind) || (b.width ?? 0) - (a.width ?? 0) || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { total: hits.length, textures: hits.slice(0, Math.max(1, q.limit ?? 50)) };
}

/**
 * The file a texture source names. `path` may be absolute (inside the packs), relative to the packs folder
 * ("POLYGON_Generic_v3/Textures/Generic_Grass.png"), relative to a pack ("Textures/Generic_Grass.png"), or just a
 * trailing part of the path; the shortest match wins. `assetId` takes the asset's own (albedo) texture.
 */
export function resolveTexture(lib: Library, src: { assetId?: number; path?: string }): string | null {
  const { packsDir, packs } = packsOf(lib);
  const packDirs = packs.map((p) => p.dir);
  const allowed = (f: string) => inside(packsDir, f) || packDirs.some((d) => inside(d, f));
  if (src.path) {
    const p = src.path.replace(/\\/g, '/');
    const direct = path.isAbsolute(p) ? [p] : [path.join(packsDir, p), ...packDirs.map((d) => path.join(d, p))];
    for (const f of direct) if (allowed(f) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    const tail = '/' + p.replace(/^\/+/, '').toLowerCase();
    const hits = [packsDir, ...packDirs.filter((d) => !inside(packsDir, d))]
      .flatMap((r) => walk(r))
      .filter((f) => ('/' + f.split(path.sep).join('/').toLowerCase()).endsWith(tail));
    hits.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return hits[0] ?? null;
  }
  if (src.assetId !== undefined) {
    const tex = lib.asset(src.assetId)?.meta()?.texture;
    return typeof tex === 'string' && allowed(tex) && fs.existsSync(tex) ? tex : null;
  }
  return null;
}

const decoded = new Map<string, { mtime: number; image: RgbaImage }>();

/** A PNG or TGA decoded (the last 16 kept). */
export function loadTexture(file: string): RgbaImage {
  const mtime = fs.statSync(file).mtimeMs;
  const hit = decoded.get(file);
  if (hit && hit.mtime === mtime) return hit.image;
  const image = decodeImage(file, fs.readFileSync(file));
  if (decoded.size > 16) decoded.delete(decoded.keys().next().value as string);
  decoded.set(file, { mtime, image });
  return image;
}

/** The average colour of an image, "#rrggbb" (sampled on a grid for big textures). */
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

// ---- texture export (OR-FB-020): a texture as PNG + a sheet description, for games that build their own particles ----

/** A sprite sheet's frame grid: `cols` × `rows` cells of `width` × `height` px, `count` of them used (row by row). */
export interface TextureFrames {
  cols: number;
  rows: number;
  count: number;
  width: number;
  height: number;
  /** How the grid was found: a `_4x4` in the name, or the gaps in the image (alpha, or brightness on black). */
  from: 'name' | 'alpha' | 'luminance';
}

export interface TextureSheetMeta {
  name: string;
  source: { pack: string; path: string };
  width: number;
  height: number;
  /** transparent: the alpha carries the shape (alpha blend); black: opaque on black (additive blend). */
  background: 'transparent' | 'black' | 'opaque';
  frames: TextureFrames | null;
  /** CS-FB-021: the image's format (png unless asked for webp). */
  format?: TextureFormat;
  /** CS-FB-021: the source's size, when the export was scaled down (`size`). */
  sourceSize?: [number, number];
}

/** CS-FB-021: texture export formats. */
export const TEXTURE_FORMATS = ['png', 'webp'] as const;
export type TextureFormat = (typeof TEXTURE_FORMATS)[number];
/** Bump when exported texture images change for the same request: `rev` changes, so a build writes them again. */
export const TEXTURE_EXPORT_VERSION = 1;

/** How a texture is exported (CS-FB-021): its largest side in px (scaled down, never up) and its format. */
export interface TextureExportOptions {
  size?: number;
  format?: TextureFormat;
}

export class TextureOptionError extends Error {}

/** Check size and format options (strings from a CLI, or numbers). */
export function textureExportOptions(q: { size?: unknown; format?: unknown }): TextureExportOptions {
  const o: TextureExportOptions = {};
  if (q.size !== undefined && q.size !== null && q.size !== '') {
    const n = Number(q.size);
    if (!Number.isInteger(n) || n < 8 || n > 8192) throw new TextureOptionError('size must be a whole number of pixels, 8–8192');
    o.size = n;
  }
  if (q.format !== undefined && q.format !== null && q.format !== '') {
    if (!(TEXTURE_FORMATS as readonly unknown[]).includes(q.format)) throw new TextureOptionError(`format must be one of ${TEXTURE_FORMATS.join(', ')}`);
    o.format = q.format as TextureFormat;
  }
  return o;
}

/** A `_4x4` / `-8x8` (cols × rows) in a texture's name. */
export function framesFromName(name: string): [number, number] | null {
  const m = /(?:^|[_\-\s.])(\d{1,2})x(\d{1,2})(?=[_\-\s.]|$)/i.exec(name.replace(/\.(png|tga)$/i, ''));
  if (!m) return null;
  const c = Number(m[1]), r = Number(m[2]);
  return c >= 1 && r >= 1 && c * r >= 2 ? [c, r] : null;
}

/** What carries a texture's shape: its alpha when the alpha varies, else its brightness (FX painted on black). */
export function inkOf(img: RgbaImage): { ink: Uint8Array; from: 'alpha' | 'luminance'; background: TextureSheetMeta['background'] } {
  const { width: w, height: h, data } = img;
  let minA = 255, dark = 0;
  for (let i = 0; i < w * h; i++) {
    minA = Math.min(minA, data[i * 4 + 3]);
    if (Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 12) dark++;
  }
  const ink = new Uint8Array(w * h);
  if (minA < 250) {
    for (let i = 0; i < w * h; i++) ink[i] = data[i * 4 + 3];
    return { ink, from: 'alpha', background: 'transparent' };
  }
  for (let i = 0; i < w * h; i++) ink[i] = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return { ink, from: 'luminance', background: dark > w * h * 0.3 ? 'black' : 'opaque' };
}

/**
 * The runs of a profile (ink texels per column or row) that hold something, with gaps under 1.5 % of the length
 * bridged (a wisp of smoke that thins out is still one frame).
 */
function segments(profile: number[], floor: number) {
  const n = profile.length, bridge = Math.max(1, Math.round(n * 0.015));
  const out: [number, number][] = [];
  let start = -1, lastInk = -Infinity;
  for (let i = 0; i < n; i++) {
    if (profile[i] <= floor) continue;
    if (start < 0) start = i;
    else if (i - lastInk > bridge) {
      out.push([start, lastInk]);
      start = i;
    }
    lastInk = i;
  }
  if (start >= 0) out.push([start, lastInk]);
  return out;
}

/** How many evenly spaced cells a profile's segments make (each segment inside its own cell), else 1. */
function periodOf(profile: number[], floor: number) {
  const segs = segments(profile, floor);
  const n = profile.length;
  for (let k = segs.length; k >= 2; k--) {
    if (segs.length !== k) continue;
    const cell = n / k;
    if (segs.every(([a, b], i) => a >= Math.floor(i * cell) - 1 && b <= Math.ceil((i + 1) * cell) + 1)) return k;
  }
  return 1;
}

/**
 * A sprite sheet's frame grid: from its name (`_4x4`), else from the image, where the frames stand apart on an empty
 * (transparent or black) background in evenly spaced cells. Null for a single image.
 */
export function detectFrames(img: RgbaImage, name: string): TextureFrames | null {
  const { width: w, height: h } = img;
  const { ink, from } = inkOf(img);
  const used = (cols: number, rows: number) => {
    let count = 0;
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let any = false;
        for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch) && !any; y += 2)
          for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x += 2) if (ink[y * w + x] > 16) (any = true);
        if (any) count = r * cols + c + 1;
      }
    return count;
  };
  const named = framesFromName(name);
  if (named) {
    const [cols, rows] = named;
    return { cols, rows, count: used(cols, rows) || cols * rows, width: Math.floor(w / cols), height: Math.floor(h / rows), from: 'name' };
  }
  const colP = new Array(w).fill(0), rowP = new Array(h).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (ink[y * w + x] > 16) {
        colP[x]++;
        rowP[y]++;
      }
  // A column or row with ink in under 0.2 % of its texels counts as empty (stray specks, compression noise).
  const cols = periodOf(colP, h * 0.002), rows = periodOf(rowP, w * 0.002);
  if (cols * rows < 2) return null;
  return { cols, rows, count: used(cols, rows), width: Math.floor(w / cols), height: Math.floor(h / rows), from };
}

export class TextureNotFound extends Error {
  constructor(message: string, readonly status = 404) {
    super(message);
  }
}

/**
 * The texture a reference names: an asset id (its albedo texture), a path as the texture list prints it (or its
 * tail), or a file name with or without the extension; several matches by name are an error that lists them.
 */
export function findTexture(lib: Library, ref: string | number, pack?: string): { file: string; info: TextureInfo | null } {
  const raw = String(ref).trim();
  if (!raw) throw new TextureNotFound('texture: give a name, a path or an asset id', 400);
  const all = allTextures(lib);
  const { packsDir } = packsOf(lib);
  const infoOf = (file: string) => all.find((t) => file.split(path.sep).join('/').endsWith(`/${t.path}`) || path.resolve(packsDir, t.path) === file) ?? null;
  if (/^\d+$/.test(raw)) {
    const file = resolveTexture(lib, { assetId: Number(raw) });
    if (!file) throw new TextureNotFound(`asset ${raw} has no texture in the installed packs`);
    return { file, info: infoOf(file) };
  }
  const want = raw.replace(/\\/g, '/').toLowerCase();
  const inPack = (t: TextureInfo) => !pack || t.pack.toLowerCase().includes(pack.toLowerCase()) || t.path.toLowerCase().startsWith(pack.toLowerCase());
  const strip = (s: string) => s.replace(/\.(png|tga)$/i, '');
  let hits = all.filter((t) => inPack(t) && (t.path.toLowerCase() === want || ('/' + t.path.toLowerCase()).endsWith('/' + want)));
  if (!hits.length) hits = all.filter((t) => inPack(t) && strip(t.file.toLowerCase()) === strip(want.split('/').pop()!));
  // A PNG and a TGA of the same image (Pro Racer ships both): the PNG.
  if (hits.length > 1) {
    const png = hits.filter((t) => /\.png$/i.test(t.file));
    if (png.length && new Set(png.map((t) => strip(t.path))).size === new Set(hits.map((t) => strip(t.path))).size) hits = png;
  }
  if (hits.length === 1) {
    const file = resolveTexture(lib, { path: hits[0].path });
    if (file) return { file, info: hits[0] };
  }
  if (hits.length > 1) throw new TextureNotFound(`texture "${raw}" matches ${hits.length}: ${hits.slice(0, 8).map((t) => t.path).join(', ')}${hits.length > 8 ? ', …' : ''}. Give the path (or pack).`, 409);
  const near = searchTextures(lib, { search: raw, pack, all: true, limit: 5 }).textures.map((t) => t.path);
  throw new TextureNotFound(`no texture "${raw}"${near.length ? `. Closest: ${near.join(', ')}` : ''}. Find one with \`slop find --textures <word>\`.`);
}

/**
 * What an export of these options is of, before it is made (CS-FB-021): the source file and a revision that changes
 * when the file, the options or the exporter do. The old server's revision stamped the file (size, mtime); this
 * one hashes its contents, so the same texture on another machine gets the same revision.
 */
export function textureRevision(lib: Library, ref: string | number, pack: string | undefined, o: TextureExportOptions = {}) {
  const { file } = findTexture(lib, ref, pack);
  const content = sha256(new Uint8Array(fs.readFileSync(file)));
  return { file, rev: sha256(JSON.stringify([TEXTURE_EXPORT_VERSION, path.basename(file), content, o.size ?? null, o.format ?? 'png'])).slice(0, 16) };
}

/** A texture as PNG bytes (a PNG file as it is, a TGA re-encoded) and its sheet description. */
export function exportTexture(lib: Library, ref: string | number, pack?: string): { meta: TextureSheetMeta; png: Buffer } {
  const { file, info } = findTexture(lib, ref, pack);
  const img = loadTexture(file);
  const { packsDir } = packsOf(lib);
  const rel = info?.path ?? path.relative(packsDir, file).split(path.sep).join('/');
  const name = path.basename(file).replace(/\.(png|tga)$/i, '');
  const meta: TextureSheetMeta = {
    name,
    source: { pack: info?.pack ?? rel.split('/')[0], path: rel },
    width: img.width,
    height: img.height,
    background: inkOf(img).background,
    frames: detectFrames(img, name),
  };
  const png = /\.png$/i.test(file) ? fs.readFileSync(file) : encodePng(img);
  return { meta, png };
}

export interface TextureExportResult {
  meta: TextureSheetMeta;
  image: Buffer;
  mime: 'image/png' | 'image/webp';
  rev: string;
}

/**
 * A texture scaled to fit `size` (never up; lanczos) and written as `format` (PNG, or webp: quality 90). The sheet
 * description follows the scaled image.
 */
export async function exportTextureAs(lib: Library, ref: string | number, pack: string | undefined, o: TextureExportOptions = {}): Promise<TextureExportResult> {
  const base = exportTexture(lib, ref, pack);
  const { rev } = textureRevision(lib, ref, pack, o);
  const format = o.format ?? 'png';
  const big = Math.max(base.meta.width, base.meta.height);
  const scale = o.size && big > o.size ? o.size / big : 1;
  if (scale === 1 && format === 'png') return { meta: { ...base.meta, format }, image: base.png, mime: 'image/png', rev };
  const sharp = (await import('sharp')).default;
  let pipe = sharp(base.png);
  const w = Math.max(1, Math.round(base.meta.width * scale)), h = Math.max(1, Math.round(base.meta.height * scale));
  if (scale < 1) pipe = pipe.resize({ width: w, height: h, fit: 'fill', kernel: 'lanczos3' });
  const image = format === 'webp' ? await pipe.webp({ quality: 90, effort: 6, alphaQuality: 100 }).toBuffer() : await pipe.png({ compressionLevel: 9 }).toBuffer();
  const f = base.meta.frames;
  const meta: TextureSheetMeta = {
    ...base.meta,
    width: w,
    height: h,
    frames: f && scale < 1 ? { ...f, width: Math.round(f.width * scale * 1000) / 1000, height: Math.round(f.height * scale * 1000) / 1000 } : f,
    format,
    ...(scale < 1 ? { sourceSize: [base.meta.width, base.meta.height] as [number, number] } : {}),
  };
  return { meta, image, mime: format === 'webp' ? 'image/webp' : 'image/png', rev };
}

// ---- ssg.textures.json ----

/** One declared texture (an `ssg.textures.json` entry). */
export interface TextureDecl {
  /** File name in the folder (without extension); unique. */
  name: string;
  /** A texture name, a path from the texture list, or an asset id. */
  texture: string | number;
  pack?: string;
  /** Largest side in px (scaled down, never up). */
  size?: number;
  format?: TextureFormat;
}

export const TEXTURES_INDEX = 'textures.json';
const safeBase = (s: string) => s.replace(/[^\w.-]+/g, '_');

/**
 * Parse an `ssg.textures.json`: `{ textures: [{ name, texture, pack?, size?, format? }], defaults?: { size?, format?, pack? } }`.
 * The schema (@slop/schema texturesFile) checks it; defaults go under each entry; a name defaults to the file's own.
 */
export function parseTexturesFile(data: unknown, where?: string): TextureDecl[] {
  const f = assertValid(texturesFile, data, where);
  const defaults = f.defaults ?? {};
  const seen = new Set<string>();
  return f.textures.map((raw, i) => {
    const e = { ...defaults, ...raw };
    const texture = typeof e.texture === 'number' ? e.texture : e.texture.trim();
    const name = e.name?.trim() ? safeBase(e.name.trim()) : safeBase(String(texture).split('/').pop()!.replace(/\.(png|tga)$/i, ''));
    if (seen.has(name.toLowerCase())) throw new TextureNotFound(`textures[${i}]: the name "${name}" is used twice`, 400);
    seen.add(name.toLowerCase());
    const d: TextureDecl = { name, texture };
    if (e.pack !== undefined) d.pack = e.pack.trim();
    if (e.size !== undefined) d.size = e.size;
    if (e.format !== undefined) d.format = e.format;
    return d;
  });
}

export interface TexturesIndex {
  version: 1;
  textures: Record<string, { rev: string; texture: string | number; image: string; meta: string; data: TextureSheetMeta }>;
}

export interface TextureApplyItem {
  name: string;
  action: 'written' | 'updated' | 'unchanged';
  rev: string;
  image: string;
  meta: string;
  width: number;
  height: number;
}

export interface TextureApplyResult {
  dir: string;
  index: string;
  textures: TextureApplyItem[];
  /** Files a previous run wrote for textures the file no longer declares (deleted). */
  removed: string[];
}

export function readTexturesIndex(file: string): TexturesIndex | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && j.version === 1 && j.textures && typeof j.textures === 'object' ? (j as TexturesIndex) : null;
  } catch {
    return null;
  }
}

/** A file name a previous index lists, if it is a plain name in the folder (never a path out of it). */
const plain = (f: unknown): f is string => typeof f === 'string' && !!f && path.basename(f) === f && f !== '.' && f !== '..';

export interface TextureApplyOptions {
  lib: Library;
  /** Only these textures (by declared name); the rest keep their files and index entries. */
  only?: string[];
  /** Write every texture again, whatever the index says. */
  force?: boolean;
  onLine?: (line: string) => void;
}

/**
 * Keep a folder in step with declared textures (CS-FB-021): each is exported with its size and format and written as
 * `<name>.<png|webp>` + `<name>.json` only when its revision (source file, size, format) differs from the last run's
 * or a file is missing; files of textures no longer declared (that the previous `textures.json` lists) are removed;
 * `textures.json` indexes them. Every texture is checked before the folder is touched.
 */
export async function applyTextures(decls: TextureDecl[], dir: string, opts: TextureApplyOptions): Promise<TextureApplyResult> {
  const { lib } = opts;
  const say = opts.onLine ?? (() => {});
  const indexFile = path.join(dir, TEXTURES_INDEX);
  const prev = readTexturesIndex(indexFile);
  const wanted = opts.only ? new Set(opts.only.map((n) => n.toLowerCase())) : null;
  if (wanted) {
    const names = new Set(decls.map((d) => d.name.toLowerCase()));
    const missing = [...wanted].filter((n) => !names.has(n));
    if (missing.length) throw new TextureNotFound(`no texture named ${missing.map((n) => `"${n}"`).join(', ')} in the file (declared: ${decls.map((d) => d.name).join(', ')})`);
  }
  const chosen = wanted ? decls.filter((d) => wanted.has(d.name.toLowerCase())) : decls;
  const got: { d: TextureDecl; r: TextureExportResult | { rev: string; unchanged: true } }[] = [];
  for (const d of chosen) {
    const old = prev?.textures[d.name];
    const have = !opts.force && !!old && plain(old.image) && plain(old.meta) && fs.existsSync(path.join(dir, old.image)) && fs.existsSync(path.join(dir, old.meta)) && String(old.texture) === String(d.texture);
    try {
      const o = { size: d.size, format: d.format };
      const { rev } = textureRevision(lib, d.texture, d.pack, o);
      got.push({ d, r: have && old!.rev === rev ? { rev, unchanged: true } : await exportTextureAs(lib, d.texture, d.pack, o) });
    } catch (e) {
      throw new TextureNotFound(`texture ${d.name}: ${(e as Error).message}${got.length ? ' (the folder was not changed)' : ''}`, (e as TextureNotFound).status ?? 500);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const index: TexturesIndex = { version: 1, textures: {} };
  if (wanted) for (const [n, t] of Object.entries(prev?.textures ?? {})) if (!wanted.has(n.toLowerCase())) index.textures[n] = t;
  const items: TextureApplyItem[] = [];
  const keep = new Set<string>([TEXTURES_INDEX, ...Object.values(index.textures).flatMap((t) => [t.image, t.meta])]);
  for (const { d, r } of got) {
    const old = prev?.textures[d.name];
    if ('unchanged' in r && old) {
      index.textures[d.name] = { ...old, texture: d.texture };
      items.push({ name: d.name, action: 'unchanged', rev: r.rev, image: old.image, meta: old.meta, width: old.data.width, height: old.data.height });
      keep.add(old.image).add(old.meta);
      continue;
    }
    const x = r as TextureExportResult;
    const image = `${d.name}.${x.mime === 'image/webp' ? 'webp' : 'png'}`, meta = `${d.name}.json`;
    const action = old ? 'updated' : 'written';
    fs.writeFileSync(path.join(dir, image), x.image);
    fs.writeFileSync(path.join(dir, meta), JSON.stringify({ ...x.meta, image }, null, 2) + '\n');
    say(`${d.name}: ${action}`);
    index.textures[d.name] = { rev: x.rev, texture: d.texture, image, meta, data: x.meta };
    items.push({ name: d.name, action, rev: x.rev, image, meta, width: x.meta.width, height: x.meta.height });
    keep.add(image).add(meta);
  }
  const removed: string[] = [];
  for (const old of Object.values(prev?.textures ?? {}))
    for (const f of [old.image, old.meta])
      if (plain(f) && !keep.has(f) && fs.existsSync(path.join(dir, f))) {
        fs.rmSync(path.join(dir, f));
        removed.push(f);
      }
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  return { dir: path.resolve(dir), index: path.resolve(indexFile), textures: items, removed };
}
