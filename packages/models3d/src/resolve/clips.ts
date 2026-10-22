// Moved from synty-sprite-generator apps/server/src/models.ts (P3, ali3b/sloponator#14): the clip lookup
// (clipLabel, pickClip, findClip, clipSourceOf) over @slop/library instead of the DB rows.
import type { AnimationEntry, Library } from '@slop/library';
import { guessGender } from '@slop/sprites';
import { clipGenderOf, parseClipRef, type ModelClipSource } from '../spec/index.js';
import { ModelError } from './errors.js';
import { closeNames } from './names.js';

/** The fields a clip qualifier can name, in the order labels try them. */
const QUAL_DIMS = [(n: AnimationEntry) => n.gender, (n: AnimationEntry) => n.set, (n: AnimationEntry) => n.pack] as const;

/** Whether a qualifier (`Feminine`, `Sidekick`, a pack, `#859`) names this clip. */
function qualMatches(n: AnimationEntry, q: string) {
  const k = q.trim().toLowerCase();
  if (/^#\d+$/.test(k)) return n.id === Number(k.slice(1));
  const g = clipGenderOf(k);
  if (g) return n.gender === g;
  if (n.set && n.set.toLowerCase() === k) return true;
  const pack = n.pack.toLowerCase();
  return pack === k || pack.endsWith(`_${k}`);
}

/**
 * The shortest `name@…` that names one clip among those sharing its name: its gender, rig family or pack, then two
 * of them, all three, and last its id (`name@#859`). The bare name when no other clip has it.
 */
export function clipLabel(n: AnimationEntry, group: AnimationEntry[]) {
  if (group.length <= 1) return n.name;
  const subsets = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];
  for (const sub of subsets) {
    const vals = sub.map((i) => QUAL_DIMS[i](n));
    if (vals.some((v) => !v)) continue;
    if (group.filter((m) => sub.every((i, j) => QUAL_DIMS[i](m) === vals[j])).length === 1) return `${n.name}@${vals.join('@')}`;
  }
  return `${n.name}@#${n.id}`;
}

export interface ClipPick {
  row: AnimationEntry;
  /** Every clip the reference could have meant (one when it is unambiguous). */
  candidates: AnimationEntry[];
  /** A warning when a name matched several clips and one was chosen. */
  warning?: string;
  /** The name the clip takes in the GLB: the library name, plus the qualifiers as written (`Idle_Standing@feminine`). */
  outName: string;
}

/** The ready clips with a rig (the ones a character can take), cached per library for the run. */
const usableClips = new WeakMap<Library, AnimationEntry[]>();
const clipsOf = (lib: Library) => {
  let all = usableClips.get(lib);
  if (!all) {
    all = lib.animations({ status: 'ready', limit: 20000 }).filter((n) => n.rig !== null);
    usableClips.set(lib, all);
  }
  return all;
};

/**
 * A clip for a character by animation id, name (a renamed clip's old name too) or qualified name (OR-FB-010:
 * `Idle@Feminine`, `Idle@Sidekick`, `Idle@ANIMATION_Idles`, chained). Among several matches: the character's gender
 * first, in place first, then the lowest id, with a warning naming the one chosen.
 */
export function pickClip(lib: Library, ref: string, assetName: string): ClipPick {
  const parsed = parseClipRef(ref);
  if ('id' in parsed) {
    const n = lib.animation(parsed.id);
    if (!n) throw new ModelError(`no animation with id ${ref}`, 404);
    return { row: n, candidates: [n], outName: n.name };
  }
  const { name, quals } = parsed;
  if (!name) throw new ModelError(`clip "${ref}": give a clip name before the @`);
  const gender = guessGender(assetName);
  const pick = (rows: AnimationEntry[]) =>
    [...rows].sort((a, b) => Number(a.gender !== null && a.gender !== gender) - Number(b.gender !== null && b.gender !== gender) || Number(a.rootMotion) - Number(b.rootMotion) || a.id - b.id)[0];
  const all = clipsOf(lib);
  const lower = name.toLowerCase();
  let named = all.filter((n) => n.name.toLowerCase() === lower);
  if (!named.length) named = all.filter((n) => n.previousNames.some((p) => p.toLowerCase() === lower));
  if (!named.length) {
    const near = closeNames([...new Set(all.map((n) => n.name))], name, 5);
    throw new ModelError(`no clip named "${name}"${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}`, 404);
  }
  const labels = (rows: AnimationEntry[]) => rows.map((n) => clipLabel(n, named)).join(', ');
  const candidates = named.filter((n) => quals.every((q) => qualMatches(n, q)));
  if (!candidates.length) throw new ModelError(`clip "${ref}": no ${named[0].name} clip is ${quals.join(' and ')} (${named[0].name} clips: ${labels(named)})`, 404);
  const row = pick(candidates);
  const outName = row.name + (quals.length ? `@${quals.join('@')}` : '');
  // The same clip under several ids (one name, several genders, rig families or packs): say which one was used.
  const warning =
    candidates.length > 1
      ? `clip ${ref}: ${candidates.length} clips match; used ${clipLabel(row, named)} (#${row.id}, ${row.pack}). Name one: ${labels(candidates)}`
      : undefined;
  return { row, candidates, outName, ...(warning ? { warning } : {}) };
}

/** A clip for a character by animation id or (qualified) name; see pickClip. */
export function findClip(lib: Library, ref: string, assetName: string): AnimationEntry {
  return pickClip(lib, ref, assetName).row;
}

/** A clip's source for the manifest. */
export const clipSourceOf = (n: AnimationEntry): ModelClipSource => ({ id: n.id, pack: n.pack, name: n.name, variant: n.gender ?? null, set: n.set ?? null });
