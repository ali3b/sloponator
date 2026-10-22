// Moved from synty-sprite-generator apps/server/src/natureMaterials.ts (P3, ali3b/sloponator#14).
import fs from 'node:fs';
import path from 'node:path';
import { decodeImage, encodePng } from './png.js';

/**
 * Synty's nature shaders, read from the pack's MaterialList at export time (no re-ingest). The ingest gives each
 * mesh one material with one texture, which these shaders do not have:
 *
 * - **Foliage** (`_Leaf_Texture` + `_Trunk_Texture`, Nature Biomes, Fantasy Village, Enchanted Forest): one mesh
 *   holds leaf cards and a trunk, and the shader picks the texture per vertex from vertex colours the ingest drops.
 *   The ingest's texture is often a stray FX circle, so trees exported white. The exporter splits each such mesh into
 *   a leaf part (cards with the leaf texture, alpha-cut) and a trunk part (the palette atlas): see modelBuild.ts
 *   applyNatureMaterials.
 * - **Triplanar** ground and cliffs (`_Triplanar_Texture_Top` / `_Side` / `_Bottom`): textures projected along the
 *   world axes (grass on top, rock on the sides). The exporter projects UVs the same way.
 */

/** One mesh's nature material: absolute texture files. */
export interface NatureMaterial {
  slot: string;
  /** Only the primitives whose texture is this (a placeholder FX circle on a mesh the list does not name). */
  only?: string;
  leaf?: string;
  trunk?: string;
  top?: string;
  side?: string;
  bottom?: string;
}

/** A MaterialList's slots with their texture properties, by mesh name (first listing wins). */
export function parseMaterialSlots(text: string): Map<string, { slot: string; props: Record<string, string> }[]> {
  const out = new Map<string, { slot: string; props: Record<string, string> }[]>();
  let mesh: string | null = null;
  let cur: { slot: string; props: Record<string, string> } | null = null;
  let skip = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('Prefab Name:')) {
      mesh = null;
      cur = null;
    }
    else if (line.startsWith('Mesh Name:')) {
      mesh = line.slice('Mesh Name:'.length).trim();
      skip = out.has(mesh);
      if (!skip) out.set(mesh, []);
      cur = null;
    } else if (line.startsWith('Slot:') && mesh && !skip) {
      cur = { slot: line.slice('Slot:'.length).trim().replace(/\s*\(.*\)\s*$/, ''), props: {} };
      out.get(mesh)!.push(cur);
    } else if (cur && !skip) {
      const m = /^(_\w+):\s*(.+?)\s*\(\1\)\s*$/.exec(line) ?? /^(_\w+):\s*(.+?)\s*$/.exec(line);
      if (m) cur.props[m[1]] = m[2];
    }
  }
  return out;
}

const listCache = new Map<string, { key: string; slots: Map<string, { slot: string; props: Record<string, string> }[]>; files: Map<string, string> }>();

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out, depth + 1);
    else if (/\.(png|tga)$/i.test(e.name)) out.push(f);
  }
  return out;
}

/** The pack's MaterialLists (merged, the pack's own first) and its texture files by lower-case base name. */
/** The pack's MaterialList files: at its top or in a folder or two below (Palm City keeps it in SourceFiles/). */
function materialListFiles(dir: string, depth = 0): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const here = entries.filter((e) => e.isFile() && /^MaterialList.*\.txt$/i.test(e.name)).map((e) => path.join(dir, e.name));
  if (here.length || depth >= 2) return here;
  return entries.filter((e) => e.isDirectory()).flatMap((e) => materialListFiles(path.join(dir, e.name), depth + 1));
}

function packLists(packDir: string) {
  const lists = materialListFiles(packDir).sort((a, b) => Number(/core|generic/i.test(path.basename(a))) - Number(/core|generic/i.test(path.basename(b))) || a.localeCompare(b));
  if (!lists.length) return null;
  const key = lists.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join('|');
  const hit = listCache.get(packDir);
  if (hit && hit.key === key) return hit;
  const slots = new Map<string, { slot: string; props: Record<string, string> }[]>();
  for (const f of lists) for (const [k, v] of parseMaterialSlots(fs.readFileSync(f, 'utf8'))) if (!slots.has(k)) slots.set(k, v);
  const files = new Map<string, string>();
  for (const f of walk(packDir).sort((a, b) => a.length - b.length)) {
    const b = path.basename(f).toLowerCase();
    if (!files.has(b)) files.set(b, f);
  }
  const entry = { key, slots, files };
  listCache.set(packDir, entry);
  return entry;
}

/** A texture the list names (`leafPatch_04.tga`), found in the pack by its file name (or its stem with another extension). */
function findFile(files: Map<string, string>, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const b = name.trim().toLowerCase();
  if (files.has(b)) return files.get(b);
  const stem = b.replace(/\.\w+$/, '');
  for (const ext of ['.png', '.tga']) if (files.has(stem + ext)) return files.get(stem + ext);
  return undefined;
}

/** Synty's foliage placeholder: an FBX leaf material that points at the white FX circle (its colour came from vertex colours). */
export const FOLIAGE_PLACEHOLDER = 'FX_Circle_Tex';

/** The pack's usual leaf texture (its most listed `leafPatch_*`, else its most listed leaf texture with "leaf" in the name). */
function usualLeaf(lists: NonNullable<ReturnType<typeof packLists>>): string | undefined {
  const counts = new Map<string, number>();
  for (const slots of lists.slots.values()) for (const s of slots) if (s.props._Leaf_Texture) counts.set(s.props._Leaf_Texture, (counts.get(s.props._Leaf_Texture) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return findFile(lists.files, ranked.find((k) => /leafpatch/i.test(k)) ?? ranked.find((k) => /leaf/i.test(k)));
}

/**
 * The nature materials of a model's meshes, by mesh node name: only meshes whose MaterialList slot is a foliage
 * (leaf + trunk) or triplanar slot whose textures are in the pack. A mesh the list does not name (or names with several
 * slots) whose material is the FX circle placeholder (`placeholder`) gets the pack's usual leaf texture on those
 * triangles. Empty when the pack has none.
 */
export function natureMaterialsFor(packDir: string | null | undefined, meshNames: string[], placeholder: string[] = []): Record<string, NatureMaterial> {
  const out: Record<string, NatureMaterial> = {};
  if (!packDir) return out;
  const lists = packLists(packDir);
  if (!lists) return out;
  for (const name of meshNames) {
    const slots = lists.slots.get(name);
    if (!slots || slots.length !== 1) {
      // Several slots (one material each, as the ingest made them) or none: only a placeholder leaf material is fixed.
      const leaf = placeholder.includes(name) ? usualLeaf(lists) : undefined;
      if (leaf) out[name] = { slot: 'Foliage', leaf, only: FOLIAGE_PLACEHOLDER };
      continue;
    }
    const { slot, props } = slots[0];
    const leaf = findFile(lists.files, props._Leaf_Texture), trunk = findFile(lists.files, props._Trunk_Texture);
    const top = findFile(lists.files, props._Triplanar_Texture_Top), side = findFile(lists.files, props._Triplanar_Texture_Side);
    const bottom = findFile(lists.files, props._Triplanar_Texture_Bottom);
    if (top && side) out[name] = { slot, top, side, ...(bottom ? { bottom } : {}) };
    else if (leaf || trunk) out[name] = { slot, ...(leaf ? { leaf } : {}), ...(trunk ? { trunk } : {}) };
  }
  return out;
}

/** A texture file as PNG bytes (a PNG as it is; a TGA decoded and re-encoded). */
export function readTexturePng(file: string): Uint8Array {
  const buf = fs.readFileSync(file);
  if (/\.png$/i.test(file)) return new Uint8Array(buf);
  return new Uint8Array(encodePng(decodeImage(file, buf)));
}
