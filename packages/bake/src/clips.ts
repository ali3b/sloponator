// Copied from packages/render/web/data.ts (groupAnimations) and packages/render/web/export/setPlan.ts (resolveAnim,
// resolveMatch), themselves from synty-sprite-generator apps/web/src/api.ts and apps/web/src/export/setPlan.ts (P2,
// ali3b/sloponator#69): which installed clip a set item means for one character, so `slop build` can bake every clip
// the page will ask for before the browser starts. Kept in step with the page's copy by test/clips.test.ts (the
// same sources, compared over every sprite of the fixtures). A copy rather than a move so the render bundle is
// untouched; folding the two into @slop/sprites is a follow-up.
import { guessGender, type BatchSpec, type SetItem } from '@slop/sprites';

/** The fields of an installed clip's record (the library's AnimationDto) the resolution reads. */
export interface ClipRecord {
  id: number;
  pack: string;
  name: string;
  rig: string | null;
  category: string | null;
  /** Synty rig family folder: Polygon / Sidekick. */
  set: string | null;
  gender: string | null;
  rootMotion: boolean;
  status: string;
  previousNames?: string[];
}

/** The fields of a character's record (the library's AssetDto) the resolution reads. */
export interface CharacterRecord {
  name: string;
  pack: string;
  rig?: { profile: string } | null;
}

/**
 * One copy per (pack, gender, category, name, root motion) of the installed clips, preferring the copy made for the
 * target rig.
 */
export function groupAnimations<A extends ClipRecord>(anims: A[], targetRig: string | null): A[] {
  const preferredSet = targetRig === 'synty_ue' ? 'Sidekick' : targetRig === 'synty_legacy' ? 'Polygon' : null;
  const groups = new Map<string, A>();
  for (const a of anims) {
    if (a.status !== 'ready') continue;
    const key = `${a.pack}|${a.gender ?? ''}|${a.category ?? ''}|${a.name}|${a.rootMotion}`;
    const cur = groups.get(key);
    if (!cur || (a.set === preferredSet && cur.set !== preferredSet) || (a.rig === targetRig && cur.rig !== targetRig)) groups.set(key, a);
  }
  return [...groups.values()];
}

/** Find the clip a set item means for this character (the copy matching its rig, the right gender). */
export function resolveAnim<A extends ClipRecord>(item: Extract<SetItem, { type: 'anim' }>, anims: A[], asset: CharacterRecord, gender: BatchSpec['gender']): A | null {
  const want = item.gender ?? (gender === 'auto' ? guessGender(asset.name) : gender);
  const grouped = groupAnimations(anims, asset.rig?.profile ?? null);
  const named = (name: string) => grouped.filter(
    (a) => a.rig && a.pack === item.pack && a.name === name && (a.category ?? null) === (item.category ?? null) && a.rootMotion === item.rootMotion,
  );
  // A renamed clip (SF-FB-003): its id names it, else a clip that had this name before.
  const byId = item.clip !== undefined ? anims.find((a) => a.id === item.clip && a.pack === item.pack) : undefined;
  let pool = named(byId?.name ?? item.name);
  if (!pool.length && byId) pool = named(item.name);
  if (!pool.length) {
    const was = grouped.find((a) => a.rig && a.pack === item.pack && (a.previousNames ?? []).includes(item.name) && a.rootMotion === item.rootMotion);
    if (was) pool = named(was.name);
  }
  return pool.find((a) => a.gender === want) ?? pool.find((a) => !a.gender) ?? pool[0] ?? null;
}

/** Variants that rarely suit a sprite sheet unless asked for by name: crouching, first-person, additive, root motion, poses. */
const AVOID = /FPV|Additive|Crouch|Kneel|LeanBack|Sliding|_RM[HV]?$|ReturnToIdle|_Pose|_Begin|_End|_Enter|_Exit|_To[A-Z]/i;

/** Synty ships POLYGON-proportioned clips (POLY_, set "Polygon") and Sidekick ones (MOD_); POLYGON models want the former. */
function styleOf(asset: CharacterRecord) {
  return /sidekick/i.test(asset.pack) ? 'Sidekick' : 'Polygon';
}

/** A clip's style: from its name prefix when it has one (packs file both styles under one set name), else its set. */
const clipStyle = (a: ClipRecord) => (/^MOD_/.test(a.name) ? 'Sidekick' : /^POLY_/.test(a.name) ? 'Polygon' : a.set);

const regex = (pattern: string) => {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
};

/**
 * A "match" item: the installed clip (for this character's rig and gender) that best fits. The `prefer` patterns
 * (exact Synty clips for the move) are tried first, in order, then the general pattern. Among several hits:
 * the character's style (POLYGON vs Sidekick), Synty packs over uploads, the right gender, plain variants over
 * crouching / first-person / root-motion ones, then the shortest name.
 */
export function resolveMatch<A extends ClipRecord>(pattern: string, anims: A[], asset: CharacterRecord, gender: BatchSpec['gender'], prefer: string[] = []): A | null {
  const want = gender === 'auto' ? guessGender(asset.name) : gender;
  const style = styleOf(asset);
  const pool = groupAnimations(anims, asset.rig?.profile ?? null).filter((a) => a.rig && !a.rootMotion);
  for (const p of [...prefer, pattern]) {
    const re = regex(p);
    if (!re) continue;
    const hits = pool.filter((a) => re.test(a.name));
    if (!hits.length) continue;
    const avoidOk = AVOID.test(p);
    const score = (a: A) =>
      (a.pack.startsWith('_') ? 8 : 0) + (clipStyle(a) && clipStyle(a) !== style ? 4 : 0) + (!avoidOk && AVOID.test(a.name) ? 2 : 0) + (a.gender && a.gender !== want ? 1 : 0);
    return hits.sort((a, b) => score(a) - score(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))[0] ?? null;
  }
  return null;
}

/**
 * The skeletal clip one set item plays on a character, following the same chain the render page follows: an `anim`
 * item's clip; a `match` item's best hit, else its `orElse` item's (recursively); null when the item is procedural
 * (a template) or nothing is installed (the page then falls back to a template or leaves the move out).
 */
export function resolveSetItem<A extends ClipRecord>(item: SetItem, anims: A[], asset: CharacterRecord, gender: BatchSpec['gender']): A | null {
  if (item.type === 'template') return null;
  const hit = item.type === 'anim' ? resolveAnim(item, anims, asset, gender) : resolveMatch(item.pattern, anims, asset, gender, item.prefer);
  if (hit) return hit;
  return item.type === 'match' && item.orElse ? resolveSetItem(item.orElse, anims, asset, gender) : null;
}
