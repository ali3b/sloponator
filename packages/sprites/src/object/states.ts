// Moved from synty-sprite-generator packages/shared/src/object/states.ts (P2, ali3b/sloponator#8).
/**
 * Object states (A4): one object sprite holds named states — intact, damaged, destroyed, open… — each drawn from
 * its own library model, plus optional transitions (e.g. the intact model blowing apart with the `destroy`
 * template). Everything lands on ONE sheet: each state is a still animation named after it, each transition an
 * animation `<from>_to_<state>`, all with one framing, so every state shares the frame size, pivot and anchor.
 * The stills alone set that framing; transitions are drawn into it (framingClips below).
 *
 * Synty ships damaged versions of many models as separate files. The names vary:
 *   SM_Veh_Car_01            → SM_Veh_Car_Damaged_01, SM_Veh_Car_Damaged_02
 *   SM_Bld_Barn_01           → SM_Bld_Barn_Broken_01
 *   SM_Veh_German_Tank_01    → SM_Veh_German_Tank_Destroyed_01
 *   SM_Veh_Plane_American_01 → SM_Veh_Plane_Damaged_American_01   (the state word mid-name)
 *   SM_Env_Bridge_Middle     → SM_Env_Bridge_Damaged_Middle        (no number)
 *   SM_Env_Dwarf_Obelisk_01  → SM_Env_Dwarf_Obelisk_01_Broken_02   (number before the state word)
 *   SM_Prop_Candle_Chandelier_02 → SM_Prop_Candle_Chandelier_02_Broken
 * The matcher below drops the state word (a whole `_` token: Damaged, Damage, Broken, Destroyed, Ruin, Ruined,
 * Wreck, Wrecked, Wreckage, Burnt, Burned) and a number right after it, and compares what is left with the intact
 * model's name or its name without the trailing number. Whole families named "Ruin" (SM_Bld_Ruin_Tower_01) are
 * intact models of their own: a name is only a variant when the model it would be a variant of exists.
 */
import type { SetItem, TemplateLayerRef } from '../inputs/batch.js';
import { STATE_COLLISIONS, type StateCollision } from './footprint.js';
import { parseLook } from './scorch.js';

/** The state a Synty word stands for: damaged (still standing) or destroyed (a wreck, a ruin). */
export const STATE_WORDS: Record<string, 'damaged' | 'destroyed'> = {
  damaged: 'damaged', damage: 'damaged', broken: 'damaged',
  destroyed: 'destroyed', ruin: 'destroyed', ruined: 'destroyed', wreck: 'destroyed', wrecked: 'destroyed', wreckage: 'destroyed', burnt: 'destroyed', burned: 'destroyed',
};

/** Order of the automatic states on a sheet. */
export const AUTO_STATE_ORDER = ['intact', 'damaged', 'destroyed'] as const;

/** Kinds that never are object states (a "BrokenBottle" weapon, a character). */
const NOT_OBJECT = new Set(['character', 'weapon', 'attachment', 'fx']);

const isNum = (t: string) => /^\d+$/.test(t);

export interface StateName {
  /** damaged | destroyed */
  state: 'damaged' | 'destroyed';
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
    if (STATE_WORDS[tokens[i].toLowerCase()]) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const before = tokens.slice(0, at);
  let after = tokens.slice(at + 1);
  let index: string | null = null;
  if (after.length && isNum(after[after.length - 1])) {
    index = after[after.length - 1];
    after = after.slice(0, -1);
  }
  return { state: STATE_WORDS[tokens[at].toLowerCase()], word: tokens[at], base: [...before, ...after].join('_').toLowerCase(), index };
}

/** A name and the same name without its trailing number (lower case): what a variant's base may equal. */
function intactKeys(name: string) {
  const tokens = name.toLowerCase().split('_');
  const full = tokens.join('_');
  const stem = tokens.length > 1 && isNum(tokens[tokens.length - 1]) ? tokens.slice(0, -1).join('_') : null;
  return { full, stem, number: stem ? tokens[tokens.length - 1] : null };
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
  state: 'damaged' | 'destroyed';
  word: string;
  /** The best match for its state (same number as the intact model, else the lowest number): used by `auto`. */
  preferred: boolean;
}

export interface AssetVariants {
  /** The intact model (the asset itself, or the model it is a damaged version of). */
  intact: VariantCandidate;
  /** When the asked-for asset is itself a damaged/destroyed version: which state it is. */
  asked?: { id: number; state: 'damaged' | 'destroyed' };
  /** Every damaged / destroyed version found, damaged first, the preferred one first within a state. */
  variants: StateVariant[];
  /** The automatic states: intact plus the preferred variant of each state found. */
  states: ObjectStates;
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
    if (hits.length) {
      intact = hits[0].c;
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
  const states: ObjectStates = { intact: { asset: intact.id } };
  for (const v of variants) if (v.preferred) states[v.state] = { asset: v.id };
  return { intact: { id: intact.id, name: intact.name, ...(intact.kind ? { kind: intact.kind } : {}) }, ...(asked ? { asked } : {}), variants, states };
}

// ---- the spec ----

/** One state of an object sprite: the library model drawn for it, and how the object gets there. */
export interface ObjectStateSpec {
  /** Library model id. */
  asset: number;
  /**
   * A transition into this state, rendered on the `from` state's model as the animation `<from>_to_<name>`: a
   * template spec ("destroy", "destroy:force=6;duration=2", layers joined with +). Null/absent: no transition.
   */
  transition?: string | null;
  /** The state the transition starts from (default: the first state, usually intact). */
  from?: string;
  /**
   * A procedural look (object/scorch.ts) applied to `asset` for this state, e.g. "scorch" or "scorch:debris=0":
   * a destroyed state drawn from the intact model when the library has no destroyed version of it.
   */
  look?: string;
  /**
   * A looping template played while in this state instead of a still (FB-056), e.g. "drive", "spin",
   * "turret_sweep:angle=40" (layers joined with +): the state's animation loops on the same sheet and framing.
   * A transition out of it starts from the loop's first frame.
   */
  template?: string;
  /**
   * What this state collides with (FB-085), written to its `object.states[].collision` and per-direction polygons:
   * `none` (a blown gate: empty polygons), `base`, `full`, `concave` or `auto` (the model's automatic rule).
   * Absent: the sprite's own collision setting.
   */
  collision?: StateCollision;
}

/** Named states, in sheet order; the first is the base (its model's footprint is the object's). */
export type ObjectStates = Record<string, ObjectStateSpec>;

const STATE_NAME = /^[a-z][a-z0-9_]*$/;

/** A transition's template spec → template layers ("destroy:force=6;duration=2+lids"). Params split on , or ;. */
export function parseTransition(spec: string): TemplateLayerRef[] {
  if (!spec.trim()) throw new Error('empty transition');
  return spec.split('+').map((part) => {
    const [id, args = ''] = part.split(':');
    const params: Record<string, number> = {};
    for (const kv of args.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      const [k, v] = kv.split('=');
      if (!k || v === undefined || Number.isNaN(Number(v))) throw new Error(`bad transition parameter "${kv}" in "${spec}" (use key=number)`);
      params[k.trim()] = Number(v);
    }
    if (!id.trim()) throw new Error(`bad transition "${spec}"`);
    return { id: id.trim(), params };
  });
}

/** What is wrong with a set of states (empty = fine). */
export function checkStates(states: ObjectStates): string[] {
  const names = Object.keys(states);
  const out: string[] = [];
  if (!names.length) out.push('give at least one state');
  for (const n of names) {
    const s = states[n];
    if (!STATE_NAME.test(n)) out.push(`state name "${n}" must be lower case letters, digits and _ (it becomes an animation name)`);
    if (!s || !Number.isInteger(s.asset) || s.asset <= 0) out.push(`state "${n}" needs a model (asset id)`);
    if (s?.from !== undefined && !s.transition) out.push(`state "${n}" has "from" but no transition`);
    if (s?.collision !== undefined && !STATE_COLLISIONS.includes(s.collision)) out.push(`state "${n}": collision must be ${STATE_COLLISIONS.join(', ')}, got ${JSON.stringify(s.collision)}`);
    if (s?.template !== undefined) {
      try {
        parseTransition(s.template);
      } catch (e) {
        out.push(`state "${n}" template: ${(e as Error).message.replace('transition', 'template')}`);
      }
    }
    if (s?.look) {
      try {
        parseLook(s.look);
      } catch (e) {
        out.push(`state "${n}": ${(e as Error).message}`);
      }
    }
    if (s?.transition) {
      const from = s.from ?? names[0];
      if (!states[from]) out.push(`state "${n}": transition from unknown state "${from}"`);
      else if (from === n) out.push(`state "${n}": a transition needs another state to start from (it is the first state; set "from")`);
      try {
        parseTransition(s.transition);
      } catch (e) {
        out.push(`state "${n}": ${(e as Error).message}`);
      }
    }
  }
  return out;
}

/** "intact" first, then the rest in the order given (the first state is the base). */
export function orderStates(states: ObjectStates): ObjectStates {
  const names = Object.keys(states);
  const sorted = names.includes('intact') ? ['intact', ...names.filter((n) => n !== 'intact')] : names;
  return Object.fromEntries(sorted.map((n) => [n, states[n]]));
}

/** Name of the animation a transition becomes. */
export const transitionName = (from: string, to: string) => `${from}_to_${to}`;

/** The animation names a states export holds, in order: the states, then the transitions. */
export function stateClipNames(states: ObjectStates): string[] {
  const names = Object.keys(states);
  return [...names, ...names.filter((n) => states[n].transition).map((n) => transitionName(states[n].from ?? names[0], n))];
}

/**
 * The animation set a states export renders: one still (or the state's own loop, `template`) per state on that
 * state's model, then one clip per transition (its template on the `from` state's model). Set items carry the
 * model (`model`) and the state.
 */
export function stateSet(states: ObjectStates): { id: string; name: string; items: SetItem[] } {
  const names = Object.keys(states);
  const look = (n: string) => (states[n].look ? { look: states[n].look } : {});
  const items: SetItem[] = names.map((n) => {
    const loop = states[n].template;
    const collision = states[n].collision;
    return { type: 'template', layers: loop ? parseTransition(loop) : [{ id: 'still', params: {} }], label: n, model: states[n].asset, ...look(n), state: { name: n, ...(loop ? { loop } : {}), ...(collision ? { collision } : {}) } };
  });
  for (const n of names) {
    const t = states[n].transition;
    if (!t) continue;
    const from = states[n].from ?? names[0];
    items.push({ type: 'template', layers: parseTransition(t), label: transitionName(from, n), model: states[from].asset, ...look(from), state: { name: n, from } });
  }
  return { id: 'states', name: `States: ${stateClipNames(states).join(', ')}`, items };
}

// ---- the "--states" argument ----

export interface StatesArg {
  /** Start from the detected variants (`auto`). */
  auto: boolean;
  /**
   * `auto+scorch`: when no destroyed version is found, a procedural `destroyed` state with this look (and a
   * `collapse` transition unless one is named).
   */
  autoLook?: string;
  /**
   * Named states: a model reference (id, name or Pack/Name), a procedural look (`=@scorch`), a looping template
   * (`:drive`) and/or a transition.
   */
  entries: { name: string; asset?: string; look?: string; template?: string; transition?: string; collision?: StateCollision }[];
}

/**
 * `--states auto`, `auto,destroyed@destroy`, `intact=SM_Veh_Car_01,destroyed=POLYGON_War/SM_Veh_Car_Damaged_01@destroy`,
 * `open=SM_Gate_Open_01@doors:angle=90;duration=1`. Entries are split on commas; transition parameters use `;`.
 * `name@transition` without a model sets the transition of an automatic state.
 * Procedural states (no library model): `destroyed=@scorch` (the base model scorched), `destroyed=@scorch:debris=0@collapse`
 * (with parameters and a transition), and `auto+scorch` (a scorched destroyed state when `auto` finds none).
 * A looping state (FB-056): `name:template` after the model, e.g. `auto,intact:drive,destroyed@destroy` or
 * `intact=SM_Radar_01:spin:duration=2`; parameters of the loop use `=` and `;` like a transition's. A loop on a
 * procedural look needs the object form ({ "look": "scorch", "template": "…" }).
 * A state's collision (FB-085): `;collision=none` (or base, full, concave, auto) at the end of the entry, e.g.
 * `destroyed=@scorch@collapse:blast=1;collision=none`, `auto,destroyed@destroy;collision=none` or
 * `auto,destroyed;collision=none` (only the collision of a found state).
 */
export function parseStatesArg(arg: string): StatesArg {
  const out: StatesArg = { auto: false, entries: [] };
  const bad = (raw: string) =>
    new Error(`bad state "${raw}": use name=model, name=model@transition, name@transition, name:loop or name=@scorch (e.g. destroyed=SM_Veh_Car_Damaged_01@destroy, intact:drive, destroyed=@scorch@collapse)`);
  for (const raw of arg.split(',').map((x) => x.trim()).filter(Boolean)) {
    const autoM = /^auto(?:\s*\+\s*(.+))?$/i.exec(raw);
    if (autoM) {
      out.auto = true;
      if (autoM[1]) {
        parseLook(autoM[1]);
        out.autoLook = autoM[1].trim();
      }
      continue;
    }
    // `;collision=<mode>` (also after `:`) anywhere in the entry, taken out before the rest is read (FB-085).
    let collision: StateCollision | undefined;
    const body = raw.replace(/\s*([;:])\s*collision\s*=\s*([A-Za-z]*)\s*(?=$|[;@])/i, (m, lead: string, v: string, at: number) => {
      const c = v.toLowerCase() as StateCollision;
      if (!STATE_COLLISIONS.includes(c)) throw new Error(`bad state "${raw}": collision must be ${STATE_COLLISIONS.join(', ')}`);
      collision = c;
      // `@collapse:collision=none;blast=1`: keep the `:` that opens the other parameters.
      return lead === ':' && raw[at + m.length] === ';' ? ':' : '';
    });
    const m = /^([A-Za-z]\w*)\s*(.*)$/.exec(body);
    if (!m) throw bad(raw);
    const name = m[1].toLowerCase();
    let rest = m[2].trim();
    const entry: StatesArg['entries'][number] = { name, ...(collision ? { collision } : {}) };
    if (rest.startsWith('=')) {
      rest = rest.slice(1).trim();
      if (rest.startsWith('@')) {
        // A procedural look: up to the next @ (a transition may follow).
        const at = rest.indexOf('@', 1);
        entry.look = (at < 0 ? rest.slice(1) : rest.slice(1, at)).trim();
        if (!entry.look) throw bad(raw);
        parseLook(entry.look);
        rest = at < 0 ? '' : rest.slice(at);
      } else {
        // The model: up to a loop (:) or a transition (@).
        const m2 = /[:@]/.exec(rest);
        const at = m2 ? m2.index : -1;
        entry.asset = (at < 0 ? rest : rest.slice(0, at)).trim();
        if (!entry.asset) throw bad(raw);
        rest = at < 0 ? '' : rest.slice(at);
      }
    }
    if (rest.startsWith(':') && !entry.look) {
      // A looping template (FB-056): up to the transition.
      const at = rest.indexOf('@');
      entry.template = (at < 0 ? rest.slice(1) : rest.slice(1, at)).trim();
      if (!entry.template) throw bad(raw);
      parseTransition(entry.template);
      rest = at < 0 ? '' : rest.slice(at);
    }
    if (rest.startsWith('@')) {
      entry.transition = rest.slice(1).trim();
      if (!entry.transition) throw bad(raw);
    } else if (rest) throw bad(raw);
    if (!entry.asset && !entry.look && !entry.transition && !entry.template && !entry.collision) throw bad(raw);
    out.entries.push(entry);
  }
  if (!out.auto && !out.entries.length) throw new Error('--states needs "auto" or name=model entries');
  return out;
}

// ---- framing ----

/**
 * The clips that set a states export's frame: the state stills only. Transitions (parts flying apart) render into
 * the same frame and are cropped by it, so the static states stay tightly framed and every clip keeps one frame
 * size, pivot and anchor. Exports without states (or with nothing but transitions) frame every clip.
 */
export function framingClips<T>(clips: T[], isTransition: (c: T) => boolean): T[] {
  const still = clips.filter((c) => !isTransition(c));
  return still.length ? still : clips;
}
