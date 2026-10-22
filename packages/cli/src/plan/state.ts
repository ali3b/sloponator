/**
 * Moved from synty-sprite-generator packages/shared/src/sprite/state.ts (P2, ali3b/sloponator#8): the Wizard's state
 * as plain data (a sprite's spec is this without the UI fields), the view/look/size cards, outfits, the reducer, the
 * effective set and the batch spec a state renders to. The web-only parts (step validation, job presets, the draft
 * key, opening an export's manifest) stayed behind.
 */
import {
  BUILTIN_SETS, setItemLabel, type AnimationSet, type BatchSpec, type ExtraLayer, type FxLook, type JobPreset, type SetItem,
  VIEW_PRESETS, objectView, type ViewConfig,
  WEAPON_CLASSES, classFor, classSet, isArmedClass,
  stillLabel, type LoadoutItem,
  normalizeLight, type SpriteLight,
  type LayerAlignment,
  withAnimPrefix, withAtlasLayout, type ExportProfile,
  stateSet, type ObjectStates,
  type TurretSplit, type WaistSplit, type PortraitSpec,
} from '@slop/sprites';
import { EQUIP_SLOTS, FIXED_SIZE_VIEWS, LOOKS, SIZES, scaleFor, type EquipSlot, type LookId, type SizeId, type WizKind } from './words.js';

/** An earlier layered export the Wizard (or a Sprite) is adding to. */
export interface AlignTarget {
  /** Export name (the body base) for the summary. */
  name: string;
  alignment: LayerAlignment;
  /** Clip names and equipment the export already has. */
  clips: string[];
  loadout: LoadoutItem[];
  /** The batch holding the export on this server: new layers are merged into its result. */
  batchId?: number;
}

/**
 * Everything the Wizard knows, as plain data: steps only change this state, the preview and the export are
 * computed from it, and presets are this state saved (JobPreset + its `wizard` extras). A Sprite's spec is
 * this state without the UI-only fields (see spec.ts).
 */

export const STEPS = [
  { id: 'start', title: 'Start' },
  { id: 'models', title: 'Models' },
  { id: 'animations', title: 'Animations' },
  { id: 'view', title: 'View' },
  { id: 'look', title: 'Look & size' },
  { id: 'engine', title: 'Engine' },
  { id: 'review', title: 'Review & export' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

/** Settings a sprite can take from its project instead of holding its own. */
export type InheritGroup = 'view' | 'look' | 'size' | 'engine' | 'gender';
export const INHERIT_GROUPS: InheritGroup[] = ['view', 'look', 'size', 'engine', 'gender'];

/**
 * A named choice of which items from the sprite's pool are worn (PixelLab's "state", our outfit). Every pool
 * item is rendered once as its own aligned layer, so switching outfits never renders anything: it only picks
 * layers. Movesets (`classes`) belong to the sprite, not to an outfit. `items` holds item keys (`itemKey`).
 */
export interface Outfit {
  id: string;
  name: string;
  items: string[];
}

/** Outfits saved before items were pooled carried a whole loadout and their own styles (see normalizeOutfits). */
interface LegacyOutfit {
  id: string;
  name: string;
  items?: string[];
  loadout?: LoadoutItem[];
  classes?: string[];
}

/** Identity of a pool item: the same model on the same layer for the same moveset is the same item. */
export const itemKey = (it: Pick<LoadoutItem, 'asset' | 'layer' | 'cls'>) => `${it.asset}:${it.layer ?? ''}:${it.cls ?? ''}`;

export interface WizardState {
  step: number;
  /** The preset this started from (null = fresh). */
  presetId: string | null;
  kind: WizKind;
  assetIds: number[];
  setId: string;
  /** A set that is not in the library (an opened export's ad-hoc set): used instead of setId when present. */
  baseSet?: AnimationSet | null;
  /** Movesets (weapon classes). When set, the export holds every class's clips (`sword_idle`, `bow_shoot`…)
   *  instead of the single set, and each weapon only appears in its own class's clips. */
  classes: string[];
  /** Single moves added on top of the set. */
  extraItems: SetItem[];
  /** Moves of the set (by label) that were removed on the Sprite page. */
  excluded?: string[];
  gender: JobPreset['gender'];
  /** VIEW_PRESETS id, or 'custom' after Advanced edits. */
  viewCardId: string;
  view: ViewConfig;
  lookId: LookId | 'custom';
  sizeId: SizeId | 'custom';
  profileId: string;
  layers: ExtraLayer[];
  uniformFrame: boolean;
  /** The item pool: every item the sprite has, each rendered once as its own layer (outfits pick from it). */
  loadout: LoadoutItem[];
  fx: FxLook | null;
  /** Lighting (FB-060): a preset (dusk, night…) with overrides; unset = day, the default look. */
  light?: SpriteLight;
  /**
   * Export each loadout item as its own aligned sheet (plus a layers manifest): true = hidden pixels cut away
   * (occlusion mask), 'none' = whole items; false = the items baked into the body's sheet (as `ssg export`).
   */
  layered: boolean | 'none';
  /**
   * The sprite's `layered` is its own even while it inherits the engine group. Set on sprites declared by
   * `ssg sprite apply` / `ssg export --project`, which render what `ssg export` renders for the same keys
   * (equipment baked unless the entry says `layered`); sprites made in the app follow the project (layered).
   */
  layeredOwn?: boolean;
  /** Named outfits: which pool items are worn. Without any, the sprite wears everything (Base). */
  outfits?: Outfit[];
  activeOutfit?: string;
  /** Settings taken from the sprite's project (see effectiveSpec). */
  inherit?: InheritGroup[];
  /**
   * Object states (objects and vehicles): named states, each drawn from its own model, plus transitions, on one
   * sheet (object/states.ts). When set they are the sprite's moves: the set is not used.
   */
  states?: ObjectStates;
  /** Cap every clip at this many seconds (loops are cut where the pose joins up; the library clip is untouched). */
  maxSeconds?: number;
  /** Prefix for animation names/keys, tokens {base} and {asset} (see withAnimPrefix); unset = the format's own. */
  animPrefix?: string;
  /**
   * false: a single moveset's clips keep their bare move names (`idle_E`, not `martial_arts_idle_E`). Unset/true:
   * moveset clips are `<moveset>_<move>`. Ignored with several movesets (their moves would collide). SF-FB-010.
   */
  movePrefix?: boolean;
  /**
   * Render snapshots only: the animation prefix a sprite render used by default (the sprite's name, see
   * spriteAnimPrefix), so a later render knows whether it may merge new moves into that export.
   */
  animPrefixAuto?: string;
  /** Render snapshots only: the RENDERER_VERSION that made the render (absent = before versions, 0). */
  rendererVersion?: number;
  /** Pack trimmed frames into atlas pages whatever the format's default layout (see withAtlasLayout). */
  atlas?: boolean;
  /** Objects: frame pivot = each direction's object anchor ("anchor", the export default) or the model origin. */
  pivot?: 'anchor' | 'origin';
  /** Vehicles (FB-096): the hull and the turret as two sheets, the turret with its own directions (BatchSpec.turret). */
  turret?: TurretSplit;
  /** Characters (SF-FB-021): a head-and-shoulders still next to the sheets (BatchSpec.portrait). */
  portrait?: PortraitSpec;
  /** Characters (FB-124): legs and torso as two sheets with a per-frame waist pivot (BatchSpec.split). */
  split?: WaistSplit;
  /**
   * SF-FB-024: the model drawn this many times its real size (1.3 = a boss 30% bigger) under the same ppm or tile
   * lock; unset = 1 (BatchSpec.modelScale).
   */
  modelScale?: number;
  /** Which clip of the plan the preview plays. */
  previewItem: number;
  /** Adding to an earlier export: only new items (or, with new moves, everything) is rendered at its alignment. */
  alignTo?: AlignTarget | null;
}

/** SF-FB-024: the model scale's limits (a factor on the model's real size). */
export const MODEL_SCALE_MIN = 0.05;
export const MODEL_SCALE_MAX = 20;

/**
 * SF-FB-024: a model scale from a file, flag or form: a number or "1.3", "1.3x", "x1.3", "×1.3", "130%". Rounded to
 * 4 decimals; 1 gives null (real size). Throws on anything else or outside 0.05–20.
 */
export function parseModelScale(v: unknown, where = 'scale'): number | null {
  if (v === undefined || v === null) return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const m = /^\s*[x×]?\s*([\d.]+)\s*(%|x|×)?\s*$/i.exec(v);
    n = m && !(v.trim().match(/^[x×]/i) && m[2]) ? Number(m[1]) / (m[2] === '%' ? 100 : 1) : NaN;
  } else n = NaN;
  if (!Number.isFinite(n) || n < MODEL_SCALE_MIN || n > MODEL_SCALE_MAX)
    throw new Error(`${where}: the model scale is a factor from ${MODEL_SCALE_MIN} to ${MODEL_SCALE_MAX} (1.3 = 30% bigger than real size, "130%" works too), got ${JSON.stringify(v)}`);
  return cleanModelScale(n);
}

/** A model scale rounded to 4 decimals, null for 1 (or anything not a usable factor). */
export function cleanModelScale(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(Math.min(MODEL_SCALE_MAX, Math.max(MODEL_SCALE_MIN, n)) * 1e4) / 1e4;
  return r === 1 ? null : r;
}

const DEFAULT_SET: Record<WizKind, string> = {
  character: 'builtin_locomotion', vehicle: 'builtin_vehicle', object: 'builtin_object', prop: 'builtin_pickup', weapon: 'builtin_pickup', all: 'builtin_pickup',
};
export const defaultSetFor = (kind: WizKind) => DEFAULT_SET[kind];

const preset = (id: string) => VIEW_PRESETS.find((p) => p.id === id)!;

export function initialState(): WizardState {
  const base: WizardState = {
    step: 0, presetId: null, kind: 'character', assetIds: [], setId: DEFAULT_SET.character, classes: [], extraItems: [], gender: 'auto',
    viewCardId: 'topdown8', view: structuredClone(preset('topdown8').config), lookId: 'clean', sizeId: 'medium',
    profileId: 'generic', layers: [], uniformFrame: true, loadout: [], fx: null, layered: true, previewItem: 0,
  };
  return withLookAndSize(base);
}

// ---- view / look / size: apply and detect ----

/** Apply the current look and size cards to the view (after a view card change, the size may not apply). */
function withLookAndSize(s: WizardState): WizardState {
  let view = s.view;
  const look = LOOKS.find((l) => l.id === s.lookId);
  if (look) view = { ...view, quality: { ...look.quality } };
  const size = SIZES.find((z) => z.id === s.sizeId);
  if (size && !FIXED_SIZE_VIEWS.has(s.viewCardId)) view = { ...view, scale: scaleFor(s.kind, size), frameWidth: size.frame, frameHeight: size.frame };
  return { ...s, view, uniformFrame: view.scale.mode !== 'fit' && s.uniformFrame };
}

export function applyViewCard(s: WizardState, id: string): WizardState {
  const p = VIEW_PRESETS.find((x) => x.id === id);
  if (!p) return s;
  const next = { ...s, viewCardId: id, view: { ...structuredClone(p.config), fps: s.view.fps } };
  // RPG Maker / LPC fix their own frame size.
  return withLookAndSize(FIXED_SIZE_VIEWS.has(id) ? { ...next, sizeId: 'custom' } : { ...next, sizeId: s.sizeId === 'custom' ? 'medium' : s.sizeId });
}

export const applyLook = (s: WizardState, id: LookId): WizardState => withLookAndSize({ ...s, lookId: id });
export const applySize = (s: WizardState, id: SizeId): WizardState => withLookAndSize({ ...s, sizeId: id });

/** Advanced edits: take the view as given and work out which cards it still matches. */
export function setView(s: WizardState, view: ViewConfig): WizardState {
  return { ...s, view, viewCardId: viewCardFor(view), lookId: lookFor(view), sizeId: sizeFor(view, s.kind) };
}

export const DIR_KEYS = ['pitch', 'directions', 'basis', 'mirror', 'order', 'naming', 'projection'] as const;
export function viewCardFor(view: ViewConfig): string {
  // Chosen directions (FB-098: "dirs": "E") are no card's.
  if (view.angles?.length) return 'custom';
  const hit = VIEW_PRESETS.find((p) => DIR_KEYS.every((k) => p.config[k] === view[k]) && (!FIXED_SIZE_VIEWS.has(p.id) || (p.config.frameWidth === view.frameWidth && p.config.frameHeight === view.frameHeight)));
  return hit?.id ?? 'custom';
}

export function lookFor(view: ViewConfig): LookId | 'custom' {
  const q = view.quality;
  const hit = LOOKS.find((l) => q && JSON.stringify(sortKeys(l.quality)) === JSON.stringify(sortKeys(q)));
  return hit?.id ?? 'custom';
}

export function sizeFor(view: ViewConfig, kind: WizKind): SizeId | 'custom' {
  const hit = SIZES.find((z) => {
    if (view.frameWidth !== z.frame || view.frameHeight !== z.frame) return false;
    const sc = scaleFor(kind, z);
    return sc.mode === view.scale.mode && (sc.mode !== 'ppm' || (view.scale.mode === 'ppm' && view.scale.ppm === sc.ppm));
  });
  return hit?.id ?? 'custom';
}

export function sortKeys<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) as T;
}

// ---- outfits ----

export const BASE_OUTFIT_ID = 'base';

/**
 * Bring outfits saved before items were pooled up to date: the pool becomes every item any outfit had, the
 * movesets every style any outfit used, and each outfit the keys of its items. Keys of items no longer in the
 * pool are dropped. Already-current outfits pass through unchanged.
 */
export function normalizeOutfits<T extends Pick<WizardState, 'loadout' | 'classes'> & { outfits?: Outfit[] | LegacyOutfit[] }>(s: T): T {
  const list = (s.outfits ?? []) as LegacyOutfit[];
  if (!list.length) return s;
  let loadout = s.loadout;
  let classes = s.classes;
  if (list.some((o) => o.loadout && !o.items)) {
    const pool = [...s.loadout];
    for (const o of list) for (const it of o.loadout ?? []) if (!pool.some((p) => itemKey(p) === itemKey(it))) pool.push(it);
    loadout = pool;
    classes = WEAPON_CLASSES.map((c) => c.id).filter((id) => [...s.classes, ...list.flatMap((o) => o.classes ?? [])].includes(id));
  }
  const keys = new Set(loadout.map(itemKey));
  const outfits: Outfit[] = list.map((o) => ({ id: o.id, name: o.name, items: (o.items ?? (o.loadout ?? []).map(itemKey)).filter((k) => keys.has(k)) }));
  return { ...s, loadout, classes, outfits };
}

/**
 * The outfits of a state, always starting with Base. Until outfits are recorded, Base wears every pool item
 * (a sprite created "with a helmet" wears its helmet).
 */
export function outfitsOf(s: Pick<WizardState, 'loadout'> & { outfits?: Outfit[] | LegacyOutfit[] }): Outfit[] {
  const list = (normalizeOutfits({ loadout: s.loadout ?? [], classes: [], outfits: s.outfits }).outfits ?? []) as Outfit[];
  if (list.some((o) => o.id === BASE_OUTFIT_ID)) return list;
  return [{ id: BASE_OUTFIT_ID, name: 'Base', items: (s.loadout ?? []).map(itemKey) }, ...list];
}

/** The outfit being shown (Base when none is chosen or the chosen one is gone). */
export function activeOutfitOf(s: Pick<WizardState, 'loadout' | 'activeOutfit'> & { outfits?: Outfit[] }): Outfit {
  const all = outfitsOf(s);
  return all.find((o) => o.id === (s.activeOutfit ?? BASE_OUTFIT_ID)) ?? all[0];
}

/** The pool items an outfit wears (the active one by default), in pool order. */
export function wornItems(s: Pick<WizardState, 'loadout' | 'activeOutfit'> & { outfits?: Outfit[] }, id?: string): LoadoutItem[] {
  const o = id ? outfitsOf(s).find((x) => x.id === id) ?? activeOutfitOf(s) : activeOutfitOf(s);
  const on = new Set(o.items);
  return s.loadout.filter((it) => on.has(itemKey(it)));
}

/**
 * Create or update an outfit and make it active. A new outfit starts as a copy of the active one. The first
 * time, Base is recorded as what the sprite wears now, so later pool additions don't change it.
 */
export function saveOutfit(s: WizardState, patch: { id?: string; name?: string; items?: string[] } = {}): WizardState {
  const id = patch.id ?? s.activeOutfit ?? BASE_OUTFIT_ID;
  const current = outfitsOf(s);
  const existing = current.find((o) => o.id === id);
  const keys = new Set(s.loadout.map(itemKey));
  const items = (patch.items ?? existing?.items ?? activeOutfitOf(s).items).filter((k) => keys.has(k));
  const outfit: Outfit = { id, name: patch.name ?? existing?.name ?? (id === BASE_OUTFIT_ID ? 'Base' : id), items };
  const outfits = existing ? current.map((o) => (o.id === id ? outfit : o)) : [...current, outfit];
  return { ...s, outfits, activeOutfit: id };
}

/** Wear an outfit: only which layers are shown changes; nothing is rendered. */
export function switchOutfit(s: WizardState, id: string): WizardState {
  if (!outfitsOf(s).some((x) => x.id === id)) return s;
  return { ...s, activeOutfit: id, previewItem: 0 };
}

export function removeOutfit(s: WizardState, id: string): WizardState {
  if (id === BASE_OUTFIT_ID) return s;
  const outfits = outfitsOf(s).filter((o) => o.id !== id);
  return { ...s, outfits, activeOutfit: s.activeOutfit === id ? BASE_OUTFIT_ID : s.activeOutfit };
}

/**
 * Set the item pool. Items new to the pool are worn by the active outfit (adding a hat while "Winter" is shown
 * puts it on Winter); items gone from the pool leave every outfit.
 */
export function setPool(s: WizardState, loadout: LoadoutItem[]): WizardState {
  if (!s.outfits?.length) return { ...s, loadout };
  const before = new Set(s.loadout.map(itemKey));
  const added = loadout.map(itemKey).filter((k) => !before.has(k));
  const keys = new Set(loadout.map(itemKey));
  const active = s.activeOutfit ?? BASE_OUTFIT_ID;
  const outfits = outfitsOf(s).map((o) => ({ ...o, items: [...o.items.filter((k) => keys.has(k)), ...(o.id === active ? added : [])] }));
  return { ...s, loadout, outfits };
}

/** The slots for this state: with movesets, one weapon slot per armed style instead of the single weapon. */
export function equipSlots(s: Pick<WizardState, 'classes'>): EquipSlot[] {
  if (!s.classes.length) return EQUIP_SLOTS;
  const perClass = s.classes.filter(isArmedClass).map((id) => {
    const c = WEAPON_CLASSES.find((x) => x.id === id)!;
    return { id: `weapon_${id}`, label: `${c.label} weapon`, kinds: 'weapon', match: c.match, cls: id };
  });
  return [...perClass, ...EQUIP_SLOTS.filter((x) => x.id !== 'weapon')];
}

// ---- reducer ----

export type Action =
  | { type: 'go'; step: number }
  | { type: 'kind'; kind: WizKind }
  | { type: 'assets'; ids: number[] }
  /** The first picked model is an effect (from the Particle FX pack). */
  | { type: 'fxPicked' }
  | { type: 'set'; id: string }
  | { type: 'classes'; ids: string[] }
  | { type: 'extra'; items: SetItem[] }
  /** Object states (objects): named states each drawn from its own model; null or {} = none (the set's moves). */
  | { type: 'states'; states: ObjectStates | null }
  /** Remove (or restore) one move of the set by its label. */
  | { type: 'exclude'; label: string; on: boolean }
  | { type: 'gender'; gender: JobPreset['gender'] }
  | { type: 'viewCard'; id: string }
  | { type: 'view'; view: ViewConfig }
  | { type: 'look'; id: LookId }
  | { type: 'size'; id: SizeId }
  | { type: 'profile'; id: string }
  | { type: 'layers'; layers: ExtraLayer[] }
  | { type: 'uniform'; on: boolean }
  | { type: 'loadout'; items: LoadoutItem[] }
  | { type: 'fx'; fx: FxLook | null }
  | { type: 'light'; light: SpriteLight | null }
  /** SF-FB-024: the model's own size factor (1 or null = real size). */
  | { type: 'modelScale'; scale: number | null }
  | { type: 'layered'; on: boolean }
  | { type: 'alignTo'; target: AlignTarget | null }
  | { type: 'outfit'; id: string }
  | { type: 'saveOutfit'; id?: string; name?: string; items?: string[] }
  | { type: 'removeOutfit'; id: string }
  | { type: 'wear'; key: string; on: boolean }
  | { type: 'inherit'; groups: InheritGroup[] }
  | { type: 'preview'; index: number }
  | { type: 'load'; state: WizardState }
  | { type: 'reset' };

export function reducer(s: WizardState, a: Action): WizardState {
  switch (a.type) {
    case 'go': return { ...s, step: Math.max(0, Math.min(STEPS.length - 1, a.step)) };
    case 'kind': {
      if (a.kind === s.kind) return s;
      // A new kind starts with its own sensible set and keeps the look; real-world scale for characters, vehicles and objects.
      const next = withLookAndSize({ ...s, kind: a.kind, assetIds: [], setId: DEFAULT_SET[a.kind], classes: [], extraItems: [], excluded: [], previewItem: 0, sizeId: s.sizeId === 'custom' ? 'medium' : s.sizeId });
      return a.kind === 'vehicle' && s.viewCardId === 'topdown8' ? applyViewCard(next, 'vehicle16') : next;
    }
    case 'assets': return { ...s, assetIds: a.ids };
    case 'fxPicked':
      // Effects look the same from every side: one direction, unless the user already chose a view.
      return s.viewCardId === 'topdown8' || s.viewCardId === 'side2' ? { ...s, viewCardId: 'custom', view: { ...s.view, directions: '1', mirror: false } } : s;
    case 'set': return { ...s, setId: a.id, baseSet: null, classes: [], excluded: [], previewItem: 0 };
    case 'classes': {
      const ids = WEAPON_CLASSES.map((c) => c.id).filter((id) => a.ids.includes(id));
      // Weapons picked before choosing styles get filed under their class (from the layer name, else the first
      // armed style); a style that was dropped loses its weapons.
      const armed = ids.find(isArmedClass);
      const loadout = s.loadout
        .map((it) => (it.layer?.startsWith('weapon') && !it.cls && !it.perClip && armed ? { ...it, cls: (classFor(it.layer) && ids.includes(classFor(it.layer)!) ? classFor(it.layer)! : armed) } : it))
        // Items of a per-clip `with` (FB-074) belong to their clips, not to a moveset: they stay.
        .filter((it) => !it.cls || it.perClip || ids.includes(it.cls));
      return { ...setPool(s, loadout), classes: ids, previewItem: 0 };
    }
    case 'extra': return { ...s, extraItems: a.items };
    case 'states': {
      const { states: _old, ...rest } = s;
      return a.states && Object.keys(a.states).length ? { ...rest, states: a.states, previewItem: 0 } : { ...rest, previewItem: 0 };
    }
    case 'exclude': {
      const cur = s.excluded ?? [];
      return { ...s, excluded: a.on ? [...new Set([...cur, a.label])] : cur.filter((l) => l !== a.label), previewItem: 0 };
    }
    case 'gender': return { ...s, gender: a.gender };
    case 'viewCard': return applyViewCard(s, a.id);
    case 'view': return setView(s, a.view);
    case 'look': return applyLook(s, a.id);
    case 'size': return applySize(s, a.id);
    case 'profile': return { ...s, profileId: a.id };
    case 'layers': return { ...s, layers: a.layers };
    case 'uniform': return { ...s, uniformFrame: a.on };
    case 'loadout': return setPool(s, a.items);
    case 'fx': return { ...s, fx: a.fx };
    case 'light': {
      const { light: _old, ...rest } = s;
      const light = normalizeLight(a.light);
      return light ? { ...rest, light } : rest;
    }
    case 'modelScale': {
      const { modelScale: _old, ...rest } = s;
      const n = a.scale === null ? null : cleanModelScale(a.scale);
      return n === null ? rest : { ...rest, modelScale: n };
    }
    case 'layered': return { ...s, layered: a.on };
    case 'alignTo': return { ...s, alignTo: a.target };
    case 'outfit': return switchOutfit(s, a.id);
    case 'saveOutfit': return saveOutfit(s, { id: a.id, name: a.name, items: a.items });
    case 'wear': {
      const o = activeOutfitOf(s);
      const items = a.on ? [...new Set([...o.items, a.key])] : o.items.filter((k) => k !== a.key);
      return saveOutfit(s, { id: o.id, items });
    }
    case 'removeOutfit': return removeOutfit(s, a.id);
    case 'inherit': return { ...s, inherit: INHERIT_GROUPS.filter((g) => a.groups.includes(g)) };
    case 'preview': return { ...s, previewItem: a.index };
    case 'load': return a.state;
    case 'reset': return initialState();
  }
}

// ---- derived: set, validation, batch, presets ----

/**
 * The view a sprite of this kind renders with: objects in a diamond-grid (iso) view get one grid-aligned facing
 * unless they chose facings (`objectView`); every other kind renders its view as is. Previews, direction counts
 * and the export all use this, so an iso crate shows 1 facing, not 8 directions.
 */
export function viewForKind<V extends ViewConfig>(kind: WizKind, view: V): V {
  return kind === 'object' ? objectView(view) : view;
}

export function allSets(userSets: AnimationSet[]) {
  return [...BUILTIN_SETS, ...userSets];
}

/** The set that will be exported: the chosen one plus any single moves, minus removed moves. */
export function effectiveSet(s: WizardState, userSets: AnimationSet[]): AnimationSet {
  if (s.states && Object.keys(s.states).length && s.kind !== 'character') return stateSet(s.states);
  const base = s.classes.length
    ? classSet(s.classes, allSets(userSets), { movePrefix: s.movePrefix })
    : s.baseSet ?? allSets(userSets).find((x) => x.id === s.setId) ?? BUILTIN_SETS.find((x) => x.id === DEFAULT_SET[s.kind])!;
  const excluded = new Set(s.excluded ?? []);
  const items = excluded.size ? base.items.filter((it) => !excluded.has(setItemLabel(it))) : base.items;
  if (!s.extraItems.length && !excluded.size) return base;
  const name = s.extraItems.length ? `${base.name} + ${s.extraItems.map(setItemLabel).join(', ')}` : base.name;
  return { id: `wizard_${base.id}`, name, items: [...items, ...s.extraItems] };
}

/**
 * The state with move `index` of the effective set replaced by `item` (the sprite page's per-move edits: a lock-yaw
 * override, SF-FB-023). The way the CLI stores a sprite's own window: an added move is changed in place, a move of a
 * picked bundle or clip list goes into the sprite's own copy of that set (`baseSet`, order kept), and a moveset's move
 * is left out of the moveset and added as the sprite's own move.
 */
export function setMoveItem(s: WizardState, userSets: AnimationSet[], index: number, item: SetItem): WizardState {
  const set = effectiveSet(s, userSets);
  const old = set.items[index];
  if (!old) return s;
  const extraStart = set.items.length - s.extraItems.length;
  if (index >= extraStart) return { ...s, extraItems: s.extraItems.map((it, i) => (i === index - extraStart ? item : it)) };
  if (!s.classes.length) {
    const base = effectiveSet({ ...s, extraItems: [], excluded: [] }, userSets);
    return { ...s, baseSet: { ...base, items: base.items.map((it) => (it === old ? item : it)) } };
  }
  return { ...s, excluded: [...new Set([...(s.excluded ?? []), setItemLabel(old)])], extraItems: [...s.extraItems, item] };
}

/**
 * SF-FB-025: a one-frame still of a move's clip at `at` source seconds, added as the sprite's own move (exported as
 * `name`, default `<move>_still`). It keeps the move's clip, held items and yaw lock; trims, caps and events do not
 * apply to a still. Null when the set has a move of that name already.
 */
export function addStillMove(s: WizardState, userSets: AnimationSet[], item: SetItem, at: number, name?: string): WizardState | null {
  const label = (name?.trim() || stillLabel(setItemLabel(item))).replace(/[^\w-]+/g, '_');
  if (effectiveSet(s, userSets).items.some((it) => setItemLabel(it) === label)) return null;
  const window = { still: Math.max(0, at), ...(item.window?.lockYaw !== undefined ? { lockYaw: item.window.lockYaw } : {}) };
  return { ...s, extraItems: [...s.extraItems, { ...item, window, label }], excluded: (s.excluded ?? []).filter((l) => l !== label) };
}

/** A set item's clip name as the exporter writes it. */
const clipNameOf = (it: SetItem) => setItemLabel(it).replace(/[^\w-]+/g, '_');

/**
 * What adding to an existing export means for the batch: new items only → rendered against the stored frames and
 * merged in (parts only); new moves only → just those clips, for the body and every item, on new pages merged in
 * (when the export records its page count); new moves and new items together → everything again.
 */
export function alignPlan(s: WizardState, set: AnimationSet) {
  const t = s.alignTo;
  if (!t) return null;
  const newClips = set.items.map(clipNameOf).filter((l) => !t.clips.includes(l));
  const same = (a: LoadoutItem, b: LoadoutItem) => a.asset === b.asset && (a.layer ?? null) === (b.layer ?? null) && (a.cls ?? null) === (b.cls ?? null);
  const newItems = s.loadout.filter((it) => !t.loadout.some((o) => same(o, it)));
  const mode = !newClips.length ? ('parts' as const) : !newItems.length && t.alignment.pages ? ('clips' as const) : ('full' as const);
  return { target: t, mode, newClips, newItems };
}

/** The batch's light: only when the sprite has one (unset = day), so day batches stay as they were. */
const lightOf = (s: Pick<WizardState, 'light'>): { light?: SpriteLight } => {
  const l = normalizeLight(s.light);
  return l ? { light: l } : {};
};

export function toBatchSpec(s: WizardState, ctx: { sets: AnimationSet[]; profiles: ExportProfile[] }, assetIds = s.assetIds): BatchSpec {
  const set = effectiveSet(s, ctx.sets);
  const profile = stateProfile(s, ctx.profiles);
  // Clip caps travel with every render of the sprite (added moves and parts line up with capped clips).
  const capped = s.maxSeconds && s.maxSeconds > 0 ? { maxSeconds: s.maxSeconds } : {};
  // SF-FB-024: the sprite's own model scale goes with every render of it (added items and moves line up with it).
  const scaled = s.modelScale && s.modelScale !== 1 ? { modelScale: s.modelScale } : {};
  const plan = alignPlan(s, set);
  if (plan?.mode === 'parts') {
    // Only the new items, rendered at the opened export's alignment and merged into it.
    return {
      name: `${plan.target.name} + ${plan.newItems.length} item${plan.newItems.length === 1 ? '' : 's'}`,
      assetIds, set, view: plan.target.alignment.view, profile, layers: s.layers, gender: s.gender, uniformFrame: false,
      loadout: plan.newItems, ...(s.fx ? { fx: s.fx } : {}), ...lightOf(s), layered: { occlusion: 'mask' as const },
      alignTo: plan.target.alignment, partsOnly: true, ...(plan.target.batchId ? { mergeInto: plan.target.batchId } : {}), ...capped, ...scaled,
    };
  }
  if (plan?.mode === 'clips') {
    // Only the new clips, for the body and every item, at the export's framing, on pages after its own.
    const items = set.items.filter((it) => plan.newClips.includes(clipNameOf(it)));
    const n = plan.newClips.length;
    return {
      name: `${plan.target.name} + ${n} move${n === 1 ? '' : 's'}`,
      assetIds, set: { ...set, id: `${set.id}_more`, name: `${set.name} (new moves)`, items }, view: plan.target.alignment.view, profile, layers: s.layers, gender: s.gender,
      uniformFrame: false, ...(s.loadout.length ? { loadout: s.loadout } : {}), ...(s.fx ? { fx: s.fx } : {}), ...lightOf(s), layered: { occlusion: 'mask' as const },
      alignTo: plan.target.alignment, extendClips: { pageStart: plan.target.alignment.pages!, fallbackSet: set },
      ...(plan.target.batchId ? { mergeInto: plan.target.batchId } : {}), ...(s.pivot ? { pivot: s.pivot } : {}), ...capped, ...scaled,
    };
  }
  return {
    name: `${set.name} — ${assetIds.length} model${assetIds.length === 1 ? '' : 's'}`,
    // Objects in an iso view render one grid-aligned facing unless the spec chose facings (0 = its directions).
    assetIds, set, view: viewForKind(s.kind, s.view), profile, layers: s.layers, gender: s.gender,
    uniformFrame: s.uniformFrame && s.view.scale.mode !== 'fit',
    ...(s.loadout.length ? { loadout: s.loadout } : {}),
    ...(s.fx ? { fx: s.fx } : {}),
    ...lightOf(s),
    ...(s.layered && s.loadout.length ? { layered: { occlusion: s.layered === 'none' ? ('none' as const) : ('mask' as const) } } : {}),
    ...(s.pivot ? { pivot: s.pivot } : {}),
    ...(s.turret ? { turret: s.turret } : {}),
    ...(s.split ? { split: s.split } : {}),
    ...(s.portrait ? { portrait: s.portrait } : {}),
    ...capped,
    ...scaled,
  };
}

/** The state's export format with its own animation-name prefix and atlas packing applied. */
export function stateProfile(s: Pick<WizardState, 'profileId' | 'animPrefix' | 'atlas'>, profiles: ExportProfile[]): ExportProfile {
  let profile = profiles.find((p) => p.id === s.profileId) ?? profiles[0];
  if (s.animPrefix !== undefined) profile = withAnimPrefix(profile, s.animPrefix);
  if (s.atlas) profile = withAtlasLayout(profile);
  return profile;
}
