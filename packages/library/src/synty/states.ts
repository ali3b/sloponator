/**
 * Damaged / destroyed versions of a model, found by name in its pack. Ported from the old generator's
 * packages/shared/src/object/states.ts (STATE_WORDS, parseStateName, findStateVariants) with the tests of
 * states.test.ts; the sprite-sheet state spec that followed it there is not part of the library.
 *
 * Synty ships damaged versions of many models as separate files. The names vary:
 *   SM_Veh_Car_01            → SM_Veh_Car_Damaged_01, SM_Veh_Car_Damaged_02
 *   SM_Bld_Barn_01           → SM_Bld_Barn_Broken_01
 *   SM_Veh_German_Tank_01    → SM_Veh_German_Tank_Destroyed_01
 *   SM_Veh_Plane_American_01 → SM_Veh_Plane_Damaged_American_01   (the state word mid-name)
 *   SM_Env_Bridge_Middle     → SM_Env_Bridge_Damaged_Middle        (no number)
 *   SM_Env_Dwarf_Obelisk_01  → SM_Env_Dwarf_Obelisk_01_Broken_02   (number before the state word)
 *   SM_Prop_Candle_Chandelier_02 → SM_Prop_Candle_Chandelier_02_Broken
 * The matcher drops the state word (a whole `_` token) and a number right after it, and compares what is left with
 * the intact model's name or its name without the trailing number. Whole families named "Ruin"
 * (SM_Bld_Ruin_Tower_01) are intact models of their own: a name is only a variant when the model it would be a
 * variant of exists.
 */

export type ObjectState = 'damaged' | 'destroyed';

/** The state a Synty word stands for: damaged (still standing) or destroyed (a wreck, a ruin). */
export const STATE_WORDS: Readonly<Record<string, ObjectState>> = {
  damaged: 'damaged', damage: 'damaged', broken: 'damaged',
  destroyed: 'destroyed', ruin: 'destroyed', ruined: 'destroyed', wreck: 'destroyed', wrecked: 'destroyed', wreckage: 'destroyed', burnt: 'destroyed', burned: 'destroyed',
};

/** Order of the automatic states. */
export const AUTO_STATE_ORDER = ['intact', 'damaged', 'destroyed'] as const;

/** Kinds that never are object states (a "BrokenBottle" weapon, a character). */
const NOT_OBJECT = new Set(['character', 'weapon', 'attachment', 'fx']);

const isNum = (t: string) => /^\d+$/.test(t);

export interface StateName {
  state: ObjectState;
  /** The word as written (Broken, Destroyed…). */
  word: string;
  /** The name without the state word and its number (lower case), to compare with intact names. */
  base: string;
  /** The variant's own number (the one after the state word), if any. */
  index: string | null;
}

/** What a model's name says about its state: null for a name without a state word. */
export function parseStateName(name: string): StateName | null {
  const tokens = name.split('_');
  let at = -1;
  for (let i = tokens.length - 1; i > 0; i--) {
    if (STATE_WORDS[tokens[i]!.toLowerCase()]) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const before = tokens.slice(0, at);
  let after = tokens.slice(at + 1);
  let index: string | null = null;
  const last = after[after.length - 1];
  if (last !== undefined && isNum(last)) {
    index = last;
    after = after.slice(0, -1);
  }
  const word = tokens[at]!;
  return { state: STATE_WORDS[word.toLowerCase()]!, word, base: [...before, ...after].join('_').toLowerCase(), index };
}

/** A name and the same name without its trailing number (lower case): what a variant's base may equal. */
function intactKeys(name: string) {
  const tokens = name.toLowerCase().split('_');
  const full = tokens.join('_');
  const last = tokens[tokens.length - 1]!;
  const stem = tokens.length > 1 && isNum(last) ? tokens.slice(0, -1).join('_') : null;
  return { full, stem, number: stem ? last : null };
}

export interface VariantCandidate {
  id: number;
  name: string;
  kind?: string;
}

/** Is `variant` (parsed) a state of `intact`? 'number' = same number as the intact model, 'name' = matches otherwise. */
function matchVariant(intact: string, v: StateName): 'number' | 'name' | null {
  const k = intactKeys(intact);
  if (v.base === k.full) return 'number';
  if (k.stem !== null && v.base === k.stem) return v.index !== null && Number(v.index) === Number(k.number) ? 'number' : 'name';
  return null;
}

export interface StateVariant extends VariantCandidate {
  state: ObjectState;
  word: string;
  /** The best match for its state (same number as the intact model, else the lowest number). */
  preferred: boolean;
}

export interface AssetVariants {
  /** The intact model (the asset itself, or the model it is a damaged version of). */
  intact: VariantCandidate;
  /** When the asked-for asset is itself a damaged/destroyed version: which state it is. */
  asked?: { id: number; state: ObjectState };
  /** Every damaged / destroyed version found, damaged first, the preferred one first within a state. */
  variants: StateVariant[];
  /** The automatic states: intact plus the preferred variant of each state found, by asset id. */
  states: Record<string, { asset: number }>;
}

/**
 * The damaged and destroyed versions of a model among the models of its pack (`pack` should hold every model of
 * the same pack; the asset itself may be in it). Given a damaged model, its intact model is found first.
 */
export function findStateVariants(asset: VariantCandidate, pack: VariantCandidate[]): AssetVariants {
  const others = pack.filter((c) => c.id !== asset.id && !NOT_OBJECT.has(c.kind ?? ''));
  let intact: VariantCandidate = asset;
  let asked: AssetVariants['asked'];
  const own = parseStateName(asset.name);
  if (own) {
    // A damaged model: its intact one, preferring the same number (SM_Veh_Car_Damaged_01 → SM_Veh_Car_01).
    const hits = others.map((c) => ({ c, m: matchVariant(c.name, own) })).filter((x) => x.m);
    hits.sort((a, b) => (a.m === 'number' ? 0 : 1) - (b.m === 'number' ? 0 : 1) || a.c.name.localeCompare(b.c.name));
    const first = hits[0];
    if (first) {
      intact = first.c;
      asked = { id: asset.id, state: own.state };
    }
  }
  const pool = [...pack.filter((c) => !NOT_OBJECT.has(c.kind ?? '')), ...(pack.some((c) => c.id === asset.id) ? [] : [asset])].filter((c) => c.id !== intact.id);
  const found = pool
    .map((c) => ({ c, p: parseStateName(c.name) }))
    .filter((x): x is { c: VariantCandidate; p: StateName } => !!x.p)
    .map((x) => ({ ...x, m: matchVariant(intact.name, x.p) }))
    .filter((x) => x.m);
  const order = (s: string) => AUTO_STATE_ORDER.indexOf(s as (typeof AUTO_STATE_ORDER)[number]);
  found.sort((a, b) => order(a.p.state) - order(b.p.state) || (a.m === 'number' ? 0 : 1) - (b.m === 'number' ? 0 : 1) || Number(a.p.index ?? 0) - Number(b.p.index ?? 0) || a.c.name.localeCompare(b.c.name));
  const seen = new Set<string>();
  const variants: StateVariant[] = found.map(({ c, p }) => {
    const preferred = !seen.has(p.state);
    seen.add(p.state);
    return { id: c.id, name: c.name, ...(c.kind ? { kind: c.kind } : {}), state: p.state, word: p.word, preferred };
  });
  const states: AssetVariants['states'] = { intact: { asset: intact.id } };
  for (const v of variants) if (v.preferred) states[v.state] = { asset: v.id };
  return { intact: { id: intact.id, name: intact.name, ...(intact.kind ? { kind: intact.kind } : {}) }, ...(asked ? { asked } : {}), variants, states };
}
