// Moved from synty-sprite-generator packages/shared/src/classes.ts (P2, ali3b/sloponator#8).
/**
 * Weapon classes standardise how a character fights with a kind of weapon: each class has an animation set
 * (the body's poses) and a grip. A layered export with several classes renders ONE body sheet holding every
 * class's clips (named `<class>_<clip>`), so helmets, hair and packs are shared across classes, while each
 * weapon's sheet only has frames for its own class's clips and is hidden during the others.
 */
import { BUILTIN_SETS, MARTIAL_ARTS_MOVES, martialArtsClip, setItemLabel, UNARMED_END, type AnimationSet, type ReleaseMode, type SetItem, type TemplateLayerRef } from './batch.js';
import { parseAnimRef } from './combat.js';

export interface WeaponClass {
  id: string;
  label: string;
  hint: string;
  /** Built-in animation set the body plays for this class. */
  setId: string;
  /** Weapon names that belong to the class (first match wins, in WEAPON_CLASSES order). */
  match: RegExp;
  /** Parameter overrides for the set's fallback templates, by template id (a rifle is shot with both hands). */
  fallbackParams?: Record<string, Record<string, number>>;
  /** Pose laid over the arms of the set's plain locomotion clips (idle, walk, run) for this class. */
  carry?: { id: string; params: Record<string, number> }[];
  /**
   * The style's own clips, by move label (regexes on clip names, tried first): Mixamo downloads named like
   * Rifle_Idle or Pistol_Walk. When one is installed it replaces the generic clip and no carry pose is laid over it.
   */
  clips?: Record<string, string>;
  /**
   * Moves the moveset has only when they are picked by name (`anim: ["idle", "place"]`): never part of the whole
   * moveset, so sprites that take every move stay as they are (FB-073).
   */
  optional?: SetItem[];
  /** Fought with empty hands: no weapon slot, no "no weapon equipped" warning (unarmed, martial_arts). */
  weaponless?: boolean;
}

/** Clip rules for a gun style: `<Word>_Idle`, `<Word>_Walk`… (Mixamo downloads saved under those names), or Mixamo's own names. */
/**
 * Kneel and put something on the ground (time bomb, mine; FB-073): a clip named like Plant_Bomb / Place_Mine /
 * Put_Down, else the procedural kneel_place with the free (left) hand; its `release` is when the hand reaches the ground.
 */
const PLACE: SetItem = { type: 'match', label: 'place', pattern: '^(?!.*bow).*(plant|placing|place[_ ]?(bomb|mine|charge|object|item)|put[_ ]?down)', fallback: [{ id: 'kneel_place', params: {} }] };

const gunClips = (word: string): Record<string, string> => ({
  idle: `^${word}[_ ]?idle`, walk: `^${word}[_ ]?walk`, run: `^${word}[_ ]?run`, shoot: `^${word}[_ ]?(shoot|fir)|^firing[_ ]${word}`,
  reload: `^${word}[_ ]?reload`, hit: `^${word}[_ ]?hit`, death: `^${word}[_ ]?(death|dying)`,
  crouch_idle: `^${word}[_ ]?crouch(ing)?[_ ]?idle`, crouch_walk: `^${word}[_ ]?crouch(ing)?[_ ]?(walk|forward)`,
  crouch_shoot: `^${word}[_ ]?(crouch|kneel)\\w*[_ ]?(shoot|fir)`, prone_idle: `^${word}[_ ]?prone[_ ]?idle`,
  crawl: `^${word}[_ ]?(crawl|prone[_ ]?forward)`, prone_shoot: `^${word}[_ ]?prone[_ ]?(shoot|fir)`,
  throw: `^${word}[_ ]?(throw|grenade|toss)`,
});

export const WEAPON_CLASSES: WeaponClass[] = [
  // hit and death only when picked (FB-077): a clip when installed, else the procedural hit_react / death_fall as the gunner's.
  { id: 'unarmed', label: 'Unarmed', hint: 'Idle, walk and run with empty hands.', setId: 'builtin_locomotion', match: /$^/, weaponless: true, optional: [PLACE, ...UNARMED_END] },
  { id: 'sword', label: 'Sword', hint: 'Sword idle, two attacks, block, hit and death.', setId: 'builtin_melee', match: /sword|axe|mace|machete|kukri|katana|cleaver|hammer|club|blade|scythe|halberd|spear/i },
  // Before the sword's rule would see them: short blades held in one hand, stabbing (Mixamo's knife clips).
  { id: 'knife', label: 'Knife', hint: 'Knife idle, two stabs, block, hit and death (knife clips from Mixamo, else the sword moves).', setId: 'builtin_melee', match: /knife|dagger|bayonet/i,
    clips: { idle: '^knife[_ ]?idle', attack_1: '^knife[_ ]?stab[_ ]?reverse', attack_2: '^knife[_ ]?stab[_ ]?fore' } },
  { id: 'bow', label: 'Bow', hint: 'Bow idle, draw, shoot, hit and death.', setId: 'builtin_archer', match: /bow(?!l)|crossbow/i },
  { id: 'staff', label: 'Mage', hint: 'Casting and charging with a staff or wand.', setId: 'builtin_caster', match: /staff|wand|sceptre|scepter|orb/i },
  // Before the rifle's rule would see them (it takes "launcher"): shoulder-fired tubes, shot from the shoulder (FB-072).
  // A grenade launcher stays a rifle. Mixamo-style uploads named Launcher_Idle, RPG_Shoot, Bazooka_Fire… are its own clips.
  { id: 'launcher', label: 'Launcher', hint: 'Shoulder-fired launchers (RPG, LAW, bazooka): carry, shoulder shot standing and kneeling, reload, hit, death.', setId: 'builtin_launcher',
    match: /(^|[^a-z])rpg|bazooka|panzerschreck|panzerfaust|rocket[_ ]?launcher|missile[_ ]?launcher|(^|_)(law|m72|at4)(_|\d|$)/i, carry: [{ id: 'rifle_carry', params: {} }], clips: gunClips('(rpg|launcher|bazooka|rocket[_ ]?launcher)'), optional: [PLACE] },
  { id: 'rifle', label: 'Rifle', hint: 'Two-handed guns: rifles, shotguns, SMGs, machine guns.', setId: 'builtin_gunner', match: /rifle|shotgun|submachine|smg|machinegun|machine_gun|minigun|launcher|sniper|carbine|musket/i, fallbackParams: { aim_shoot: { twoHanded: 1 }, kneel_shoot: { twoHanded: 1 }, prone_idle: { twoHanded: 1 }, crawl: { twoHanded: 1 }, prone_shoot: { twoHanded: 1 } }, carry: [{ id: 'rifle_carry', params: {} }], clips: gunClips('rifle'), optional: [PLACE] },
  { id: 'pistol', label: 'Pistol', hint: 'One-handed guns: pistols and revolvers.', setId: 'builtin_gunner', match: /pistol|revolver|handgun|magnum/i, clips: gunClips('pistol'), optional: [PLACE] },
  // Unarmed side-view fighting: no weapon belongs to it; MartialArts_<Move> uploads (Mixamo) are its own clips.
  { id: 'martial_arts', label: 'Martial arts', hint: 'Unarmed fighting game moves: stance, walk forward/back, jump, crouch, punches, kicks, blocks, hits, knockdown, KO, victory (MartialArts_<Move> clips from Mixamo).', setId: 'builtin_martial_arts', match: /$^/, weaponless: true,
    clips: Object.fromEntries(MARTIAL_ARTS_MOVES.map((m) => [m, martialArtsClip(m)])) },
];

/** Whether a moveset is fought with a weapon (rifle, sword…), not empty hands (unarmed, martial_arts). Unknown ids count as armed. */
export const isArmedClass = (id: string) => !WEAPON_CLASSES.find((c) => c.id === id)?.weaponless;

/** The class a weapon belongs to, from its name (null = not a weapon of any class). */
export function classFor(assetName: string): string | null {
  const n = assetName.toLowerCase();
  return WEAPON_CLASSES.find((c) => !c.weaponless && c.match.test(n))?.id ?? null;
}

/** Equipment slots filled by something held in a hand: a moveset's weapon (`weapon_sword`…), the weapon, the off-hand. */
export const isHeldSlot = (slotId: string) => slotId.startsWith('weapon') || slotId === 'offhand';

/**
 * Whether an item can be held, from its true size in metres (x, y, z): a held weapon or shield is small in at least
 * two dimensions (a greatsword is long but narrow, a tower shield under a metre across). Some packs file wall
 * displays as weapons: Dungeon Pack's SM_Item_Sword is a 2 × 2.5 m crest with a sword on it. Unknown size = holdable.
 */
export function isHoldable(size: readonly number[] | null | undefined) {
  if (!size || size.length < 3) return true;
  return [...size].sort((a, b) => b - a)[1] <= 1.2;
}

/**
 * Prefix a set's items with the class id so every class's clips coexist in one export (`rifle_idle`). `prefix`
 * false keeps the bare move names (`idle`): a sprite with one moveset (SF-FB-010). Items keep their class either way.
 */
export function classItems(cls: WeaponClass, sets: AnimationSet[], prefix = true, opts: { optional?: boolean } = {}): SetItem[] {
  const set = sets.find((s) => s.id === cls.setId) ?? BUILTIN_SETS.find((s) => s.id === cls.setId);
  if (!set) return [];
  const items = opts.optional ? [...set.items, ...(cls.optional ?? [])] : set.items;
  return items.map((it) => {
    const label = it.label ?? (it.type === 'anim' ? it.name : it.type === 'match' ? it.pattern : it.layers.map((l) => l.id).join('+'));
    const fallback = it.type === 'match' && it.fallback ? it.fallback.map((l) => ({ ...l, params: { ...l.params, ...(cls.fallbackParams?.[l.id] ?? {}) } })) : undefined;
    const own = cls.clips?.[label];
    const tagged = { label: prefix ? `${cls.id}_${label}` : label, cls: cls.id };
    if (it.type === 'anim') {
      // Plain locomotion (Idle_Standing, Walk_F, Run_F) gets the class's carry pose over its arms...
      const plain = { ...it, ...(cls.carry?.length ? { overlay: cls.carry } : {}), ...tagged } as SetItem;
      // ...unless the style has its own clip for the move, which wins.
      return own ? ({ type: 'match', pattern: '$^', prefer: [own], orElse: plain, ...tagged } as SetItem) : plain;
    }
    if (it.type === 'match') return { ...it, ...(fallback ? { fallback } : {}), ...(own ? { prefer: [own, ...(it.prefer ?? []).filter((p) => p !== own)] } : {}), ...tagged } as SetItem;
    return { ...it, ...tagged } as SetItem;
  });
}

/**
 * One set with every chosen class's clips (`rifle_idle`, `sword_attack_1`…). `movePrefix: false` gives a single
 * moveset's clips their bare move names (`idle`, `punch_light`); with several movesets the prefix always stays.
 */
export function classSet(classIds: string[], sets: AnimationSet[] = [], opts: { movePrefix?: boolean; optional?: boolean } = {}): AnimationSet {
  const classes = classIds.map((id) => WEAPON_CLASSES.find((c) => c.id === id)).filter((c): c is WeaponClass => !!c);
  const prefix = opts.movePrefix !== false || classes.length > 1;
  return {
    id: `classes_${classes.map((c) => c.id).join('+')}`,
    name: classes.map((c) => c.label).join(' + '),
    items: classes.flatMap((c) => classItems(c, sets, prefix, { optional: opts.optional })),
  };
}

/** A model with optional labels (a person's or the AI's), as the asset API returns it. */
export interface LabeledAsset { name: string; kind: string; slot?: string | null; moveset?: string | null }

/** The moveset an item belongs to: its label ('none' = no moveset), else the rule from its name. */
export function movesetOfAsset(a: LabeledAsset): string | null {
  if (a.moveset) return a.moveset === 'none' ? null : a.moveset;
  return classFor(a.name);
}

/** A move's name without its moveset prefix: `rifle_crouch_idle` -> `crouch_idle`. */
export function moveName(it: SetItem) {
  const l = setItemLabel(it);
  return it.cls && l.startsWith(`${it.cls}_`) ? l.slice(it.cls.length + 1) : l;
}

/** "crouch_*", "rifle_?dle" or a plain name: a case-insensitive whole-name pattern. */
const globRe = (g: string) => new RegExp(`^${g.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const safeRe = (re: string) => {
  try {
    return new RegExp(re, 'i');
  } catch {
    return /$^/;
  }
};

/** The clip names a move stands for: its own clip, its moveset's own clips (Rifle_Shoot), the plain clip it falls back to. */
function playsClip(it: SetItem, name: string): boolean {
  if (it.type === 'anim') return it.name.toLowerCase() === name.toLowerCase();
  if (it.type !== 'match') return false;
  // A stand-in played backwards (dash_forward's reversed dash_back) is not the clip as named.
  return (it.prefer ?? []).some((re) => safeRe(re).test(name)) || (!!it.orElse && !it.orElse.window?.reverse && playsClip(it.orElse, name));
}

/** Template ids a move uses: its own layers, or its procedural stand-in. */
function templateIdsOf(it: SetItem): string[] {
  if (it.type === 'template') return it.layers.map((l) => l.id);
  if (it.type === 'match') return [...(it.fallback ?? []).map((l) => l.id), ...(it.orElse ? templateIdsOf(it.orElse) : [])];
  return [];
}

/** The procedural layers of a move's stand-in that include template `id` (with the moveset's parameters). */
function standInLayers(it: SetItem, id: string): TemplateLayerRef[] {
  if (it.type === 'template') return it.layers;
  if (it.type === 'match') {
    if (it.fallback?.some((l) => l.id === id)) return it.fallback;
    if (it.orElse) return standInLayers(it.orElse, id);
  }
  return [{ id, params: {} }];
}

/** "throw:underhand=1,hand=0" -> id and numeric params (bad values are left to the caller's own parser). */
function templateRef(spec: string) {
  const [id, args = ''] = spec.split(':');
  const params: Record<string, number> = {};
  for (const kv of args.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined && !Number.isNaN(Number(v))) params[k.trim()] = Number(v);
  }
  return { id: id.trim(), params };
}

const withParams = (layers: TemplateLayerRef[], id: string, params: Record<string, number>) => layers.map((l) => (l.id === id ? { ...l, params: { ...l.params, ...params } } : l));

/**
 * Pick some moves of a moveset export (`--class rifle --anim idle,walk,shoot -t crawl`) instead of all of them.
 * A name picks the moves it matches, tried in turn: the move's name with or without the moveset prefix, as a glob
 * (`idle`, `rifle_idle`, `crouch_*`); else a clip the move plays (`Idle_Standing`, `Rifle_Shoot`); else the
 * move's clip pattern. A template picks the moves it names, or whose procedural stand-in it is (its parameters,
 * e.g. `throw:underhand=1`, go to that stand-in). Moves keep the set's order. What picks nothing is returned
 * unmatched (the caller adds it as an extra clip, or reports it). With no picks at all, every move is kept.
 *
 * SF-FB-018: a name in `opts.clips` (installed clips, lower case) is never matched onto a move by the move's clip
 * pattern: MartialArts_Flip_Uppercut is a clip of its own, not the uppercut. Nor is a clip asked for backwards
 * (`Clip@reverse`). Names the pattern did match are listed in `folded`, so callers can say so.
 */
export function pickClassMoves(items: SetItem[], picks: { animations?: string[]; templates?: string[] }, opts: { clips?: ReadonlySet<string> } = {}) {
  const chosen = new Map<number, SetItem>();
  const unmatched = { animations: [] as string[], templates: [] as string[] };
  /** Templates kept as asked (FB-094). */
  const kept: SetItem[] = [];
  /** Moves asked for under another name (SF-FB-022). */
  const renamed: SetItem[] = [];
  const folded: { ref: string; moves: string[] }[] = [];
  const where = (test: (it: SetItem) => boolean) => items.map((it, i) => (test(it) ? i : -1)).filter((i) => i >= 0);
  const byName = (name: string) => {
    const re = globRe(name);
    return where((it) => re.test(setItemLabel(it)) || re.test(moveName(it)));
  };
  for (const ref of picks.animations ?? []) {
    // "crouch_punch@0.8:2.6": the move with this sprite's own trim/cap (SF-FB-001).
    const { name, window, label } = parseAnimRef(ref);
    let hits = byName(name);
    const clip = !!window?.reverse || !!opts.clips?.has(name.toLowerCase());
    if (!hits.length && !window?.reverse) hits = where((it) => playsClip(it, name));
    if (!hits.length && !clip) {
      hits = where((it) => it.type === 'match' && safeRe(it.pattern).test(name));
      if (hits.length) folded.push({ ref, moves: hits.map((i) => setItemLabel(items[i])) });
    }
    if (!hits.length) unmatched.animations.push(ref);
    // "kick_heavy@0.2:0.9=kick_short" (SF-FB-022): a copy of the move under its own name, next to the move itself.
    if (label && hits.length) {
      const it = items[hits[0]];
      renamed.push({ ...it, label, ...(window ? { window } : {}) } as SetItem);
      continue;
    }
    for (const i of hits) {
      if (window) chosen.set(i, { ...(chosen.get(i) ?? items[i]), window });
      else if (!chosen.has(i)) chosen.set(i, items[i]);
    }
  }
  for (const spec of picks.templates ?? []) {
    if (spec.includes('+')) {
      unmatched.templates.push(spec); // several layers: a move of its own
      continue;
    }
    const { id, params } = templateRef(spec);
    const hits = byName(id);
    if (!hits.length) {
      // FB-094: a template that names no move but is a move's procedural stand-in (kneel_shoot for crouch_shoot) is
      // kept as asked: the template itself, with its parameters, named after it in each moveset (rifle_kneel_shoot),
      // so an installed crouch-shoot clip does not silently replace it. Added after the moves, as other extra clips.
      const stands = where((it) => templateIdsOf(it).includes(id));
      if (!stands.length) unmatched.templates.push(spec);
      const seen = new Set<string>();
      for (const i of stands) {
        const it = items[i];
        const cls = it.cls ?? '';
        if (seen.has(cls)) continue;
        seen.add(cls);
        const layers = standInLayers(it, id);
        const label = it.cls && setItemLabel(it).startsWith(`${it.cls}_`) ? `${it.cls}_${id}` : id;
        kept.push({ type: 'template', layers: withParams(layers, id, params), label, ...(it.cls ? { cls: it.cls } : {}), ...(it.window?.maxSeconds ? { window: { maxSeconds: it.window.maxSeconds } } : {}) });
      }
      continue;
    }
    for (const i of hits) {
      const it = chosen.get(i) ?? items[i];
      // Parameters go to the move's procedural layer of that id (its stand-in when no clip is installed).
      const tuned: SetItem = !Object.keys(params).length ? it
        : it.type === 'template' ? { ...it, layers: withParams(it.layers, id, params) }
        : it.type === 'match' && it.fallback ? { ...it, fallback: withParams(it.fallback, id, params) }
        : it;
      chosen.set(i, tuned);
    }
  }
  const any = (picks.animations?.length ?? 0) + (picks.templates?.length ?? 0) > 0;
  // Kept templates come after the moves, as extra clips do (a declared sprite stores them as its extras: same order).
  const picked = [...[...chosen.entries()].sort((a, b) => a[0] - b[0]).map(([, it]) => it), ...renamed, ...kept];
  return { items: any ? picked : items, unmatched, folded };
}

/**
 * Whether a held item is put away during a clip because of per-clip `with` (FB-074): an item brought by a clip's own
 * `with` (perClip) shows only in the clips of its group; a clip with its own items puts away every other hand-held
 * item (the sprite's rifle during the knife stab), while worn items (a helmet) stay. Sprites without per-clip items
 * are not affected (moveset weapons are still hidden by class only in layered exports, as before).
 */
export function putAwayDuring(clip: { cls?: string; perClip?: boolean }, item: { cls?: string; perClip?: boolean; handHeld: boolean }): boolean {
  if (item.perClip) return item.cls !== clip.cls;
  if (clip.perClip) return item.handHeld && item.cls !== clip.cls;
  return false;
}

/**
 * What a clip's own items do at its `release` event (FB-103): a per-clip `with` hides them by default (the grenade has
 * left the hand, the charge is on the ground: the game spawns its own); other clips keep what they hold.
 */
export function releaseModeOf(clip: { perClip?: boolean; release?: ReleaseMode }): ReleaseMode {
  return clip.perClip ? clip.release ?? 'hide' : 'keep';
}

/** Whether an item is one a clip lets go of at its release: the clip's own per-clip items (its group). */
export function releasedBy(clip: { cls?: string; perClip?: boolean }, item: { cls?: string; perClip?: boolean }): boolean {
  return !!clip.perClip && !!item.perClip && item.cls === clip.cls;
}
