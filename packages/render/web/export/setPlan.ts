import { guessGender, setItemLabel, type AnimationSet, type BatchSpec, type SetItem } from '@slop/sprites';
import { groupAnimations, type Animation, type Asset } from '../data';
import { templatesFor } from '../anim/templates';

/** Find the clip a set item means for this character (the copy matching its rig, the right gender). */
export function resolveAnim(item: Extract<SetItem, { type: 'anim' }>, anims: Animation[], asset: Asset, gender: BatchSpec['gender']) {
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
function styleOf(asset: Asset) {
  return /sidekick/i.test(asset.pack) ? 'Sidekick' : 'Polygon';
}

/** A clip's style: from its name prefix when it has one (packs file both styles under one set name), else its set. */
const clipStyle = (a: Animation) => (/^MOD_/.test(a.name) ? 'Sidekick' : /^POLY_/.test(a.name) ? 'Polygon' : a.set);

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
export function resolveMatch(pattern: string, anims: Animation[], asset: Asset, gender: BatchSpec['gender'], prefer: string[] = []) {
  const want = gender === 'auto' ? guessGender(asset.name) : gender;
  const style = styleOf(asset);
  const pool = groupAnimations(anims, asset.rig?.profile ?? null).filter((a) => a.rig && !a.rootMotion);
  for (const p of [...prefer, pattern]) {
    const re = regex(p);
    if (!re) continue;
    const hits = pool.filter((a) => re.test(a.name));
    if (!hits.length) continue;
    const avoidOk = AVOID.test(p);
    const score = (a: Animation) =>
      (a.pack.startsWith('_') ? 8 : 0) + (clipStyle(a) && clipStyle(a) !== style ? 4 : 0) + (!avoidOk && AVOID.test(a.name) ? 2 : 0) + (a.gender && a.gender !== want ? 1 : 0);
    return hits.sort((a, b) => score(a) - score(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
  }
  return null;
}

/**
 * How one set item turns out for one model:
 *  anim      an installed clip (detail: its name)
 *  match     a clip found by name pattern
 *  template  procedural animation
 *  fallback  no clip found, a procedural stand-in is used (e.g. hit reaction)
 *  missing   nothing found: this clip is left out
 *  not-for-kind  the item does not apply to this kind of model (walk on a car): left out
 */
export type PlanVia = 'anim' | 'match' | 'template' | 'fallback' | 'missing' | 'not-for-kind';
export interface SetPlanItem {
  index: number;
  label: string;
  via: PlanVia;
  detail: string;
}

/** Which items of a set will be exported for this model, and how (the same rules as the batch runner). */
export function planSet(set: AnimationSet, asset: Asset, anims: Animation[], gender: BatchSpec['gender']): SetPlanItem[] {
  const available = new Set(templatesFor({ kind: asset.kind, name: asset.name, parts: asset.parts, rigMap: asset.rig?.map }).map((t) => t.id));
  const used = new Set<string>();
  return set.items.map((item, index) => {
    let label = setItemLabel(item).replace(/[^\w-]+/g, '_');
    while (used.has(label)) label += '_';
    const out = (via: PlanVia, detail: string): SetPlanItem => {
      if (via !== 'missing' && via !== 'not-for-kind') used.add(label);
      return { index, label, via, detail };
    };
    const skeletal = (it: SetItem): SetPlanItem => {
      if (it.type === 'anim') {
        const a = resolveAnim(it, anims, asset, gender);
        return a ? out('anim', `${a.name}${it.overlay?.length ? ' + carry pose' : ''}`) : out('missing', `${it.name} is not installed`);
      }
      if (it.type !== 'match') return out('missing', '');
      const a = resolveMatch(it.pattern, anims, asset, gender, it.prefer);
      if (a) return out('match', a.name);
      if (it.orElse) return skeletal(it.orElse);
      const fb = (it.fallback ?? []).filter((l) => available.has(l.id));
      return fb.length ? out('fallback', fb.map((l) => l.id).join(' + ')) : out('missing', 'no matching clip installed');
    };
    if (item.type === 'anim' || item.type === 'match') {
      if (asset.kind !== 'character') return out('not-for-kind', 'character animation');
      return skeletal(item);
    }
    const layers = item.layers.filter((l) => available.has(l.id));
    return layers.length ? out('template', layers.map((l) => l.id).join(' + ')) : out('not-for-kind', `${item.layers.map((l) => l.id).join(' + ')} needs other parts`);
  });
}

/** Items that produce a clip. */
export const plannedClips = (plan: SetPlanItem[]) => plan.filter((p) => p.via !== 'missing' && p.via !== 'not-for-kind');
