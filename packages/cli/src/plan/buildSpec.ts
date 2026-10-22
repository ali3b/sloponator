/**
 * Moved from synty-sprite-generator packages/client/src/spec.ts (P2, ali3b/sloponator#8): friendly export inputs
 * (the keys of ssg.assets.json, the old CLI flags) → a BatchSpec, with the lookups behind `SpecSources`. The sources
 * are now backed by @slop/library (see sources.ts) instead of the old server's HTTP API; the code is otherwise as it
 * was. `JobPreset`s (input.preset) are still accepted but no preset source exists any more.
 */
import {
  BUILTIN_PROFILES, BUILTIN_SETS, DEFAULT_QUALITY, VIEW_PRESETS,
  SECONDARY_PRESETS, WEAPON_CLASSES, stillLabel, stillRef, classSet, moveName, parseAnimRef, parseDirs, pickClassMoves, setItemLabel,
  type AnimationSet, type BatchSpec, type DepthRule, type DirectionSetId, type ExportProfile, type ExtraLayer, type FxLook, type JobPreset, type LayerAlignment, type SpriteLight, parseLight,
  type LoadoutItem, type ObjectFacings, type SecondaryMotion, type SetItem, type ViewConfig, movesetOfAsset, objectView, withAnimPrefix, withAtlasLayout,
  TURRET_ROLES, parseTurret, type TurretSplit, parseSplit, splitSet, type WaistSplit, parsePortrait, type PortraitInput, type PortraitSpec, RELEASE_MODES, type ReleaseMode, checkStates, orderStates, parseStatesArg, parseTransition, stateSet, type ObjectStates, COLLISION_MODES, type CollisionMode, type StateCollision,
  type AssetVariants,
} from '@slop/sprites';
import type { AssetDto, AnimationDto } from '@slop/library';
import { TEMPLATE_CATALOG, armPoseMove } from './templateCatalog.js';
import { parseModelScale } from './state.js';
import { wizKindForAsset } from './words.js';

/**
 * The model record the planner works on: the old web/CLI `Asset` DTO, plus the moveset label a person or the AI
 * put on it in the old generator (the old server sent it on the DTO; the library keeps it under `labels`).
 */
export type Asset = AssetDto & { moveset?: string | null };
/** The clip record the planner works on: the old web/CLI `Animation` DTO. */
export type Animation = AnimationDto;
/** The old `GET /api/assets/:id/variants` answer: the damaged/destroyed versions plus the asked-for model and its pack. */
export type AssetVariantsDto = AssetVariants & { asset: { id: number; name: string; kind: string }; pack: string };

export interface ViewOverrides {
  /**
   * Explicit directions. For objects this also turns the default grid-aligned facing off (unless facings is given).
   * Direction names ("E", "N,S"; FB-098) are accepted too: they become `angles` (see dirsOverride).
   */
  directions?: DirectionSetId;
  /** Chosen directions (FB-098): compass degrees, from direction names in `dirs`. */
  angles?: number[];
  /**
   * Objects: grid-aligned facings instead of directions — 1 (one, front towards the camera), 2 (along both grid axes:
   * walls, fences, wire), 4 (all four); 0 = use directions. Objects in iso/diamond views default to 1.
   */
  facings?: ObjectFacings;
  /** Objects on a diamond tile lock: per-tile-column strips for depth sorting, written to the manifest's object.slices. */
  slice?: 'columns';
  /** Objects: metres above the model's bottom whose vertices make the ground collision (default min(0.5 m, 15 % of the height)). */
  collisionHeight?: number;
  /** Objects: collide with the whole hull ('full'), the ground slice ('base'), or by what the model is ('auto', the default). FB-050. */
  collision?: CollisionMode;
  pitch?: number;
  projection?: 'ortho' | 'persp';
  /** Square frame size in px (exact in fit mode, minimum with ppm). */
  frameSize?: number;
  frameWidth?: number;
  frameHeight?: number;
  /** Fixed pixels per metre (switches the scale lock on). */
  ppm?: number;
  /**
   * 'fit' (FB-070): fit the model into the frame, leaving the project's (or the file's) tile lock and ppm, e.g. for UI
   * icons. Cannot be combined with ppm or tile.
   */
  scale?: 'fit';
  /**
   * Tile lock: the scale comes from the game's tile size, "64x32" (2:1 diamond, iso) or "32x32" (square), so every
   * model (characters, vehicles, objects) shares one real-world scale that matches the map. Wins over ppm.
   */
  tile?: string;
  /** With tile: metres one tile covers on the ground (default 1). */
  metresPerTile?: number;
  fps?: number;
  mirror?: boolean;
  supersample?: 1 | 2 | 3 | 4;
  pixelArt?: boolean;
  outline?: boolean;
  palette?: 'full' | 'model' | 'levels';
  shadow?: 'off' | 'low' | 'high';
}

export interface ExportInput {
  /** Asset ids or names (exact name, or the name without its SK_/SM_ prefix). */
  assets: (string | number)[];
  /** Skeletal clip names (e.g. Walk_F, Idle_Standing, Walking). */
  animations?: string[];
  /** Procedural templates: "drive", "sit", "drive_turn:steer=25,duration=0.8". Several in one string join as layers: "drive+doors". */
  templates?: string[];
  /** Animation set id or name. */
  set?: string;
  /**
   * Weapon classes (unarmed, sword, knife, bow, staff, launcher, rifle, pistol, martial_arts): one body sheet with every class's clips; weapons shown
   * only in their class. With classes, `animations`/`templates` pick some of the moves (see pickClassMoves).
   */
  classes?: string[];
  /** A set given whole (an earlier export's own ad-hoc set, from --align-to) instead of looked up by id. */
  inlineSet?: AnimationSet;
  /** Pack trimmed frames into atlas pages (far less texture memory than the grid) whatever the format's default. */
  atlas?: boolean;
  /** Job preset id or name: supplies view/format/layers/set/gender defaults. */
  preset?: string;
  /** View preset id (iso8, topdown8, side2, …). */
  view?: string;
  overrides?: ViewOverrides;
  /** Export profile id or name (godot4, unity, phaser3, pixi, aseprite, libgdx, gamemaker, rpgmaker, lpc, generic, or yours). */
  format?: string;
  layers?: ExtraLayer[];
  gender?: JobPreset['gender'];
  uniformFrame?: boolean;
  name?: string;
  /**
   * Weapons / props held by every character: "SM_Wep_Staff_01" (its saved grip, else the right hand — bows go
   * in the left), "SM_Wep_Bow_01@hand_l", or objects with explicit placement.
   */
  with?: (string | { asset: string | number; target?: string; pos?: [number, number, number]; rot?: [number, number, number]; scale?: number; template?: string; layer?: string; depth?: DepthRule; secondary?: SecondaryMotion | 'soft' | 'medium' | 'stiff'; trigger?: string; cls?: string; perClip?: boolean })[];
  /** Glowing FX look (unlit, tinted; exported with blend "add"). */
  fx?: FxLook | boolean;
  /**
   * Lighting (FB-060): a preset name (day, dusk, night, overcast, desert_noon, arctic) or { preset, ambient,
   * ambientIntensity, key, keyIntensity, azimuth, elevation }. Unset or "day": the default light.
   */
  light?: string | SpriteLight;
  /**
   * Layered export: the body and each `with` item as separate, aligned sheets plus `{base}.layers.json`.
   * true / 'mask' cuts away the pixels the body hides (compose in any order); 'none' keeps whole items and
   * relies on the per-frame z-order.
   */
  layered?: boolean | 'mask' | 'none';
  /** The `alignment` block of an earlier layered export's manifest: new layers/clips line up with it exactly. */
  alignTo?: LayerAlignment;
  /** With alignTo: only render the parts (adding equipment), not the body again. */
  partsOnly?: boolean;
  /** With alignTo: the clips are new to that export; their pages are numbered from this (after the export's own). */
  pageStart?: number;
  /** Layered batches: reuse layers from an earlier batch with the same alignment; render only what changed. */
  incremental?: boolean;
  /** Cap every clip at this many seconds (loops are cut where the pose comes back closest to the first frame). */
  maxSeconds?: number;
  /**
   * Prefix for the animation names/keys, with tokens {base} (sheet base = Phaser texture key) and {asset}.
   * phaser3 defaults to "{base}/" (e.g. "Character_German_Soldier_01/rifle_idle_E"); '' gives bare "{clip}_{dir}".
   */
  animPrefix?: string;
  /**
   * false: a single moveset's clips keep their bare move names (keys `{prefix}idle_E`, not `{prefix}martial_arts_idle_E`).
   * Default: `<moveset>_<move>`. Only with exactly one class (SF-FB-010).
   */
  movePrefix?: boolean;
  /**
   * Clips with their own held items (FB-074): one sprite carries several loadouts. Each entry is a clip (or a move of
   * the movesets) or a template, rendered with its `with` items in the hands; the sprite's other hand-held items are
   * put away during it, and its items appear in no other clip. The clip is named `<group>_<clip>` (knife_Knife_Stab_Fore),
   * the group being `as`, else the first item's moveset (knife, launcher), else its name.
   */
  clipWith?: ClipWithInput[];
  /**
   * Object states (one model): each state drawn from its own model, as a named animation on one sheet with one
   * anchor. "auto" (the damaged/destroyed versions found by name), "auto,destroyed@destroy",
   * "intact=SM_Veh_Car_01,destroyed=SM_Veh_Car_Damaged_01@destroy", or an object { state: model | { asset, transition, from, look } }.
   * Procedural states when there is no library model: "auto,destroyed=@scorch,destroyed@collapse" or "auto+scorch".
   */
  states?: StatesInput;
  /** Objects: frame pivot = each direction's anchor ("anchor", the default) or the model origin ("origin"). */
  pivot?: 'anchor' | 'origin';
  /**
   * Vehicles (FB-096): the hull and the turret (turret/barrel parts) as two sheets, the turret's mount point per hull
   * direction in the hull's data files. true = the turret with the hull's directions; "16"/32 or { dirs } = its own.
   */
  turret?: boolean | string | number | { dirs?: string | number } | null;
  /**
   * Characters (SF-FB-021): also a head-and-shoulders still, <base>_portrait.png (+ .json), framed from the head and
   * neck joints. true = 256 px, three-quarter, transparent; a size; "320x400,front,#203040"; or
   * { size, width, height, angle, pitch, background, clip } (see parsePortrait).
   */
  portrait?: PortraitInput;
  /**
   * Characters (FB-124): split at the waist into a legs sheet (<base>_legs: locomotion, idle) and a torso sheet
   * (<base>_torso: idle, aim, shoot, throw, reload) with a per-frame `waist` socket in both, so a game aims the upper
   * body apart from the walk. "waist" / true, or { at: "waist", legs: [moves], torso: [moves] } to pick the moves;
   * whole: true (FB-126) also writes the whole-body sheet <base> with every move, from the same job and framing.
   */
  split?: boolean | string | { at?: string; legs?: string[] | string; torso?: string[] | string; whole?: boolean } | null;
  /**
   * SF-FB-024: draw the model this many times its real size (1.3 = a boss 30% bigger) under the same ppm or tile
   * lock; also "1.3x" or "130%". The data files keep the world's pixels per metre and record the factor
   * (scale.modelScale). Unset or 1 = real size.
   */
  modelScale?: number | string | null;
  /**
   * SF-FB-025: stills, one frame of a clip (or a move of the movesets) per direction at a time in SOURCE seconds:
   * "Victory_Pose@2.4" (also "Clip@still=2.4"), exported as a one-frame animation `<Clip>_still` next to the moves
   * ("Victory_Pose@2.4=ending" names it). For ending screens and menus.
   */
  stills?: string[];
}

/** One clip with its own held items (see ExportInput.clipWith). */
export interface ClipWithInput {
  /** A clip name (or with classes, a move), with this sprite's own trim as in animations: "Knife_Stab_Fore@0:0.9". */
  anim?: string;
  /** Or a template: "shoulder_fire:kneel=1". */
  template?: string;
  /** The items in the hands for this clip (as in `with`). */
  with: WithInput | WithInput[];
  /** The clip group (its name prefix and the items' group); default: the first item's moveset, else its name. */
  as?: string;
  /**
   * FB-103: what the items do at the clip's `release` event (throw, kneel_place): hide (default; the grenade has left
   * the hand), drop (falls from the hand and stays where it lands) or keep (stays in the hand).
   */
  release?: ReleaseMode;
}
type WithInput = NonNullable<ExportInput['with']>[number];

/** "SM_Wep_Knife_01" → "knife": a group name from a model name (pack prefixes, kinds and numbers dropped). */
export function groupFromName(name: string) {
  const words = name.split(/[_\s-]+/).filter((w) => w && !/^(sm|sk|wep|prop|item|gen|chr|char|attach|\d+)$/i.test(w));
  return (words.join('_') || name).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

/**
 * "Knife_Stab_Fore@0:0.9 with POLYGON_Palm_City/SM_Wep_Knife_01 as knife" (template: "template:shoulder_fire:kneel=1 with SM_Wep_RPG_01"),
 * optionally ending "release hide|drop|keep" (FB-103: "template:throw:hand=1 with SM_Wep_Grenade_01 release hide").
 */
export function parseClipWith(text: string): ClipWithInput {
  const r = text.trim().match(/^(.*?)\s+release\s+(\w+)$/i);
  const release = r ? (r[2].toLowerCase() as ReleaseMode) : undefined;
  if (release && !RELEASE_MODES.includes(release)) throw new SpecError(`"${text}": release is ${RELEASE_MODES.join(', ')}.`);
  const m = (r ? r[1] : text).trim().match(/^(.+?)\s+with\s+(.+?)(?:\s+as\s+([A-Za-z][\w]*))?$/);
  if (!m) throw new SpecError(`"${text}": say "<clip> with <item>[,<item>] [as <group>] [release hide|drop|keep]", e.g. "Knife_Stab_Fore with SM_Wep_Knife_01" or "template:shoulder_fire:kneel=1 with SM_Wep_RPG_01 as law".`);
  const what = m[1].trim();
  const items = m[2].split(',').map((x) => x.trim()).filter(Boolean);
  const t = what.match(/^(?:template|t):(.+)$/i);
  return { ...(t ? { template: t[1].trim() } : { anim: what }), with: items, ...(m[3] ? { as: m[3] } : {}), ...(release ? { release } : {}) };
}

/**
 * `--states` text, or states by name: a model (id, name, Pack/Name) or { asset, transition, from, look, template }.
 * `template` (also `anim`; a string or a list, layers joined with +) is the state's own loop, e.g. "drive" (FB-056).
 */
export type StatesInput = string | Record<string, number | string | StateEntryInput>;
export interface StateEntryInput {
  asset?: number | string;
  transition?: string | null;
  from?: string;
  look?: string;
  template?: string | string[] | null;
  /** Another name for `template` (objects have no skeletal clips: a template id such as "spin"). */
  anim?: string | string[] | null;
  /** What the state collides with (FB-085): none (a blown gate), base, full, concave or auto. */
  collision?: StateCollision;
}

/** A state's loop as one template spec ("drive+turret_sweep"), null to remove it, undefined = not given. */
function loopOf(e: StateEntryInput, where: string): string | null | undefined {
  if (e.template !== undefined && e.anim !== undefined) throw new SpecError(`state "${where}": give template or anim, not both.`);
  const v = e.template !== undefined ? e.template : e.anim;
  if (v === undefined || v === null) return v;
  const list = (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);
  if (!list.length || list.every((x) => x === 'still')) return null;
  return list.filter((x) => x !== 'still').join('+');
}

/** Data the builder needs from the server (injected so it is unit-testable). */
export interface SpecSources {
  /** Models whose name contains the query (only in pack `packId` when given). */
  findAssets(query: string, packId?: number): Promise<Asset[]>;
  getAsset(id: number): Promise<Asset>;
  /** Damaged / destroyed versions of a model (GET /api/assets/:id/variants), for `states: "auto"`. */
  variants?(id: number): Promise<AssetVariantsDto>;
  findAnimations(query: string): Promise<Animation[]>;
  profiles(): Promise<ExportProfile[]>;
  sets(): Promise<AnimationSet[]>;
  presets(): Promise<JobPreset[]>;
  /** Installed packs, for "Pack/Model" names (without it the pack is matched on the found models only). */
  packs?(): Promise<PackRef[]>;
  /** Told about guesses the caller should see, e.g. a model name found in several packs. */
  warn?(message: string): void;
}

export interface PackRef {
  id: number;
  name: string;
  kind?: string;
}

export class SpecError extends Error {}

const norm = (s: string) => s.toLowerCase().replace(/^(sk_|sm_)/, '');

/** Best suggestions first: names starting with the query, then containing it; shorter names first. */
export function suggest(names: string[], query: string) {
  const q = query.toLowerCase();
  const rank = (n: string) => (norm(n).startsWith(norm(q)) || n.toLowerCase().startsWith(q) ? 0 : 1) * 1000 + n.length;
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 8);
}

/** "POLYGON_War/SM_Env_Tree_01" -> { pack: "POLYGON_War", name: "SM_Env_Tree_01" }; a bare name has no pack. */
export function splitPackRef(ref: string): { pack?: string; name: string } {
  const i = ref.lastIndexOf('/');
  return i > 0 ? { pack: ref.slice(0, i).trim(), name: ref.slice(i + 1).trim() } : { name: ref.trim() };
}

/** A pack by id or name (case-insensitive, version suffix like "_v2" optional); unknown -> an error listing the packs. */
export function findPack<T extends PackRef>(packs: T[], ref: string | number): T {
  const r = String(ref).trim().toLowerCase();
  const p = packs.find((x) => String(x.id) === r) ?? packs.find((x) => x.name.toLowerCase() === r) ?? packs.find((x) => x.name.toLowerCase() === r.replace(/[_ ]?v?\d+$/, ''));
  if (p) return p;
  const models = packs.filter((x) => !x.kind || x.kind === 'models');
  throw new SpecError(`No pack "${ref}". Packs: ${(models.length ? models : packs).map((x) => x.name).join(', ')}`);
}

/**
 * A model by id, name, or "Pack/Name". Names are not unique across packs: a bare name that several packs
 * share picks the first (as before) and warns with the candidates.
 */
export async function resolveAsset(src: SpecSources, ref: string | number): Promise<Asset> {
  if (typeof ref === 'number' || /^\d+$/.test(ref)) return src.getAsset(Number(ref));
  const { pack, name } = splitPackRef(ref);
  let packId: number | undefined;
  let packName: string | undefined;
  if (pack !== undefined) {
    if (src.packs) {
      const p = findPack(await src.packs(), pack);
      packId = p.id;
      packName = p.name;
    } else packName = pack;
  }
  const inPack = (a: Asset) => packName === undefined || (packId !== undefined ? a.packId === packId : a.pack.toLowerCase() === packName.toLowerCase());
  const hits = (await src.findAssets(name, packId)).filter((a) => a.status === 'ready' && inPack(a));
  const sameName = hits.filter((a) => a.name.toLowerCase() === name.toLowerCase());
  const candidates = sameName.length ? sameName : hits.filter((a) => norm(a.name) === norm(name));
  const exact = candidates[0];
  if (exact) {
    const packs = [...new Set(candidates.map((a) => a.pack))];
    if (packs.length > 1)
      src.warn?.(
        `"${ref}" is in ${packs.length} packs (${candidates.map((a) => `${a.pack}/${a.name} #${a.id}`).join(', ')}); using ${exact.pack}/${exact.name} (#${exact.id}). Name it as Pack/Model, e.g. ${packs[1]}/${candidates.find((a) => a.pack === packs[1])!.name}.`,
      );
    return exact;
  }
  const names = suggest(hits.map((a) => a.name), name).map((n) => (packName !== undefined ? `${packName}/${n}` : n));
  const where = packName !== undefined ? ` in ${packName}` : '';
  throw new SpecError(names.length ? `No model named "${name}"${where}. Did you mean: ${names.join(', ')}?` : `No model matches "${name}"${where}.`);
}

/**
 * "Walk_F" -> a set item matched by pack + category + name; gender left to the batch rule. The item carries the
 * clip's id (`clip`), so the outdated check knows the clip whatever it is called. A renamed clip's old name still
 * resolves (SF-FB-003): the item keeps the name it was asked by (the export's clip names and the last render's
 * frames stay as they are) and a warning says the clip's new name.
 */
export async function resolveAnimation(src: SpecSources, ref: string): Promise<SetItem> {
  // "Clip@0.8:2.6" / "Clip@max=2": the clip with this sprite's own trim/cap (SF-FB-001).
  // "Clip@0:3=kicks_a": exported as kicks_a (SF-FB-022), so the same clip can be used twice with other windows.
  const { name, window, label } = animRef(ref);
  const hits = (await src.findAnimations(name)).filter((a) => a.status === 'ready' && a.rig);
  const is = (n: string) => n.toLowerCase() === name.toLowerCase();
  const pick = (pool: Animation[]) => pool.find((a) => !a.rootMotion) ?? pool[0];
  const a = pick(hits.filter((x) => is(x.name)));
  // A clip played backwards (SF-FB-017) is exported as <Clip>_reverse, so it can sit next to the clip played forwards.
  const labelOf = (n: string) => label ?? (window?.reverse ? `${n}_reverse` : n);
  if (a) return { type: 'anim', pack: a.pack, name: a.name, category: a.category, rootMotion: a.rootMotion, gender: null, label: labelOf(a.name), clip: a.id, ...(window ? { window } : {}) };
  const renamed = pick(hits.filter((x) => (x.previousNames ?? []).some(is)));
  if (renamed) {
    const was = renamed.previousNames!.find(is)!;
    src.warn?.(`clip ${was} was renamed to ${renamed.name}: the old name works for now; say ${renamed.name} in the spec (its exported clip is then called ${renamed.name}).`);
    return { type: 'anim', pack: renamed.pack, name: was, category: renamed.category, rootMotion: renamed.rootMotion, gender: null, label: labelOf(was), clip: renamed.id, ...(window ? { window } : {}) };
  }
  const names = suggest(hits.filter((x) => !x.rootMotion).map((x) => x.name), name);
  throw new SpecError(names.length ? `No animation named "${name}". Did you mean: ${names.join(', ')}?` : `No animation matches "${name}".`);
}

/**
 * SF-FB-025: one still ("Clip@2.4", "move@2.4=name") as a set item with the window { still }: a move of the sprite's
 * movesets (or of its set) by name, else an installed clip. A move's still is named `<move label>_still`.
 */
export async function resolveStill(src: SpecSources, raw: string, set: AnimationSet, input: Pick<ExportInput, 'classes' | 'movePrefix'>): Promise<SetItem> {
  let ref: string;
  try {
    ref = stillRef(raw);
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
  const { name, window, label } = animRef(ref);
  const auto = label === stillLabel(name);
  // A move of the movesets (their optional moves too) or of the set by its name, else an installed clip, else a
  // move the name picks as --anim would (a glob, a clip a move plays).
  const pool = input.classes?.length ? [...set.items, ...classSet(input.classes, await src.sets(), { movePrefix: input.movePrefix, optional: true }).items] : set.items;
  const lower = name.toLowerCase();
  const asMove = (move: SetItem): SetItem => {
    const { window: _w, ...it } = move as SetItem & { window?: unknown };
    return { ...it, label: auto ? stillLabel(setItemLabel(move)) : label!, window: window! } as SetItem;
  };
  const exact = pool.find((it) => setItemLabel(it).toLowerCase() === lower || moveName(it).toLowerCase() === lower);
  if (exact) return asMove(exact);
  try {
    return await resolveAnimation(src, ref);
  } catch (e) {
    const picked = input.classes?.length ? pickClassMoves(pool, { animations: [name] }).items[0] : undefined;
    if (picked) return asMove(picked);
    throw new SpecError(`still "${raw}": ${(e as Error).message.replace(/^No/, 'no')}${input.classes?.length ? ' (nor a move of the movesets)' : ''}`);
  }
}

/** `parseAnimRef` with its errors as spec errors. */
export function animRef(ref: string) {
  try {
    return parseAnimRef(ref);
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
}

/** "drive_turn:steer=25,duration=0.8+doors" -> template layers. */
/**
 * Templates given next to states (FB-056): one loop for the base state (intact), layers joined with +; "still"
 * (what a state is anyway) adds nothing.
 */
export function statesBaseLoop(templates: string[] | undefined): string | undefined {
  const list = (templates ?? []).map((t) => t.trim()).filter((t) => t && t !== 'still');
  return list.length ? list.join('+') : undefined;
}

export function parseTemplate(spec: string): SetItem {
  const layers = spec.split('+').map((part) => {
    const [id, args = ''] = part.split(':');
    const params = Object.fromEntries(
      args.split(',').filter(Boolean).map((kv) => {
        const [k, v] = kv.split('=');
        if (!k || v === undefined || Number.isNaN(Number(v))) throw new SpecError(`Bad template parameter "${kv}" in "${spec}" (use key=number).`);
        return [k.trim(), Number(v)];
      }),
    );
    return { id: id.trim(), params };
  });
  // An arm pose over a locomotion clip (FB-076): hands_up_walk is the walk clip with hands_up on its arms.
  const over = layers.length === 1 ? armPoseMove(layers[0].id, layers[0].params) : null;
  if (over) return over;
  return { type: 'template', layers, label: layers.map((l) => l.id).join('+') };
}

/** "64x32" → a 64 px 2:1 diamond tile; "32x32" → a 32 px square tile. */
export function parseTileSize(t: string): { tilePx: number; shape: 'square' | 'diamond' } {
  const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(t);
  if (!m) throw new SpecError(`Bad tile size "${t}": use WxH, e.g. 64x32 (iso diamond) or 32x32 (square).`);
  const w = Number(m[1]), h = Number(m[2]);
  if (w > 0 && w === h) return { tilePx: w, shape: 'square' };
  if (w > 0 && w === 2 * h) return { tilePx: w, shape: 'diamond' };
  throw new SpecError(`Tile size "${t}" is neither square (32x32) nor a 2:1 diamond (64x32).`);
}

/** A collision mode from a flag or file: auto, base, full (FB-050) or concave (FB-099). */
export function checkCollision(v: unknown): CollisionMode {
  if (COLLISION_MODES.includes(v as CollisionMode)) return v as CollisionMode;
  throw new SpecError(`collision must be ${COLLISION_MODES.slice(0, -1).join(', ')} or ${COLLISION_MODES[COLLISION_MODES.length - 1]}, got ${JSON.stringify(v)}.`);
}

/**
 * Overrides that would be dropped without a word (FB-070): ppm next to a tile lock (the tile wins), metresPerTile
 * without one. `view` is the view they apply to (its own tile lock keeps metresPerTile meaningful).
 */
export function ignoredOverrides(o: ViewOverrides = {}, view?: ViewConfig): string[] {
  const out: string[] = [];
  if (o.ppm !== undefined && o.tile) out.push(`ppm ${o.ppm} is ignored: the tile lock (tile ${o.tile}) sets the scale. Leave tile out ("tile": null) to render at ppm ${o.ppm}.`);
  if (o.metresPerTile !== undefined && !o.tile && view?.scale.mode !== 'tile') out.push(`metresPerTile ${o.metresPerTile} is ignored without a tile lock (give tile too).`);
  return out;
}

/**
 * A `dirs` value (spec, CLI flag or MCP) as overrides (FB-098): a direction set ("8", 1, "4d") or direction names
 * ("E", "N,S", ["N", "S"]), which give `angles` and the set with as many directions.
 */
export function dirsOverride(v: unknown): Pick<ViewOverrides, 'directions' | 'angles'> {
  try {
    const d = parseDirs(v);
    return { directions: d.directions, ...(d.angles ? { angles: d.angles } : {}) };
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
}

/** Overrides → the view. `warn` hears about settings that lose (ppm under a tile lock, see ignoredOverrides). */
export function applyOverrides(view: ViewConfig, o: ViewOverrides = {}, warn?: (message: string) => void): ViewConfig {
  if (o.scale !== undefined && o.scale !== 'fit') throw new SpecError(`scale must be "fit" (got ${JSON.stringify(o.scale)}); for a fixed scale give ppm or tile.`);
  if (o.scale === 'fit' && (o.ppm !== undefined || o.tile)) throw new SpecError(`scale "fit" fits the model into the frame: leave out ${o.ppm !== undefined ? 'ppm' : 'tile'} (or scale).`);
  if (warn) ignoredOverrides(o, view).forEach((m) => warn(m));
  const v: ViewConfig = { ...view, quality: { ...DEFAULT_QUALITY, ...(view.quality ?? {}) } };
  if (o.directions) {
    // Names ("E") may arrive as they were typed (MCP, older callers): read them here too.
    const d: { directions?: DirectionSetId; angles?: number[] } = o.angles?.length ? { directions: o.directions, angles: o.angles } : dirsOverride(o.directions);
    if (!d.directions) throw new SpecError(`dirs: ${JSON.stringify(o.directions)} is no direction set.`);
    v.directions = d.directions;
    if (d.angles?.length) v.angles = [...d.angles];
    else delete v.angles;
  }
  if (o.facings !== undefined) {
    if (![0, 1, 2, 4].includes(o.facings)) throw new SpecError(`facings must be 1, 2 or 4 (or 0 for directions), got ${o.facings}.`);
    v.facings = o.facings;
  } else if (o.directions) delete v.facings;
  if (o.slice) v.slice = o.slice;
  if (o.collisionHeight !== undefined) {
    if (!(o.collisionHeight > 0)) throw new SpecError(`collisionHeight must be a positive number of metres, got ${o.collisionHeight}.`);
    v.collisionHeight = o.collisionHeight;
  }
  if (o.collision !== undefined) v.collision = checkCollision(o.collision);
  if (o.pitch !== undefined) v.pitch = o.pitch;
  if (o.projection) v.projection = o.projection;
  if (o.fps) v.fps = o.fps;
  if (o.mirror !== undefined) v.mirror = o.mirror;
  if (o.pixelArt) {
    v.quality = { ...v.quality!, style: 'pixel', textureFilter: 'nearest', supersample: Math.max(3, v.quality!.supersample) as 3 | 4 };
    if (!o.frameSize && !o.frameWidth && !o.ppm && !o.tile && !o.scale) v.frameWidth = v.frameHeight = Math.min(v.frameWidth, 64);
  }
  if (o.frameSize) v.frameWidth = v.frameHeight = o.frameSize;
  if (o.frameWidth) v.frameWidth = o.frameWidth;
  if (o.frameHeight) v.frameHeight = o.frameHeight;
  if (o.scale === 'fit') {
    // Out of a fixed scale the frame is no longer a minimum the model grows past: give it the medium size (128).
    if (v.scale.mode !== 'fit' && !o.frameSize && !o.frameWidth) v.frameWidth = v.frameHeight = o.pixelArt ? 64 : 128;
    v.scale = { mode: 'fit' };
  }
  if (o.ppm) {
    v.scale = { mode: 'ppm', ppm: o.ppm };
    v.padding = 2;
    if (!o.frameSize && !o.frameWidth) v.frameWidth = v.frameHeight = 16; // frames grow to fit at this scale
  }
  if (o.tile) {
    const metresPerTile = o.metresPerTile ?? 1;
    if (!(metresPerTile > 0)) throw new SpecError('metresPerTile must be above 0.');
    v.scale = { mode: 'tile', ...parseTileSize(o.tile), metresPerTile };
    v.padding = 2;
    if (!o.frameSize && !o.frameWidth) v.frameWidth = v.frameHeight = 16;
  } else if (o.metresPerTile && v.scale.mode === 'tile') v.scale = { ...v.scale, metresPerTile: o.metresPerTile };
  if (o.supersample) v.quality = { ...v.quality!, supersample: o.supersample };
  if (o.outline !== undefined) v.quality = { ...v.quality!, outline: o.outline };
  if (o.palette) v.quality = { ...v.quality!, palette: o.palette };
  if (o.shadow) v.quality = { ...v.quality!, shadow: o.shadow };
  return v;
}

const byIdOrName = <T extends { id: string; name: string }>(list: T[], ref: string) =>
  list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase() === ref.toLowerCase());

/**
 * Movesets with animations/templates: those pick some of the moves (`idle`, `crouch_*`, `Rifle_Shoot`, `-t crawl`)
 * instead of rendering them all. Names that are no move of the movesets are added as extra clips.
 */
async function pickMoves(src: SpecSources, set: AnimationSet, input: ExportInput, optional: SetItem[] = []): Promise<AnimationSet> {
  if (!input.animations?.length && !input.templates?.length) return set;
  input.animations?.forEach(animRef); // bad trims as spec errors, before the moves are matched
  const picks = { animations: input.animations, templates: input.templates };
  // SF-FB-018: names a move's clip pattern would take (MartialArts_Flip_Uppercut → uppercut) that are installed clips
  // stay clips of their own, exported under their names with their own trims. Only those names are looked up.
  const guess = [...pickClassMoves(set.items, picks).folded, ...(optional.length ? pickClassMoves(optional, picks).folded : [])];
  const clips = new Set<string>();
  for (const { ref } of guess) {
    const name = animRef(ref).name;
    if ((await src.findAnimations(name)).some((a) => a.status === 'ready' && a.rig && a.name.toLowerCase() === name.toLowerCase())) clips.add(name.toLowerCase());
  }
  const first = pickClassMoves(set.items, picks, { clips });
  // Moves a moveset has only when asked for (place, FB-073): names the regular moves did not take may pick them.
  const more = optional.length && (first.unmatched.animations.length || first.unmatched.templates.length) ? pickClassMoves(optional, first.unmatched, { clips }) : null;
  for (const f of [...first.folded, ...(more?.folded ?? [])]) {
    src.warn?.(`"${f.ref}" is neither a move nor an installed clip: it was matched onto ${f.moves.join(', ')} by the move's clip pattern (name the move, or install the clip to export it under its own name).`);
  }
  // Only extra clips named, no move (SF-FB-018): the whole moveset plus the extras.
  const items = first.items.length || more?.items.length ? [...first.items, ...(more?.items ?? [])] : set.items;
  const unmatched = more?.unmatched ?? first.unmatched;
  const extra: SetItem[] = [];
  const moves = [...new Set([...set.items, ...optional].map(moveName))].join(', ');
  for (const a of unmatched.animations) {
    try {
      extra.push(await resolveAnimation(src, a));
    } catch (e) {
      throw new SpecError(`"${a}" is no move of the moveset (${moves}) and ${(e as Error).message.replace(/^No/, 'no')}`);
    }
  }
  for (const t of unmatched.templates) extra.push(parseTemplate(t));
  const all = [...items, ...extra];
  return { ...set, name: `${set.name}: ${all.map((i) => setItemLabel(i)).join(', ')}`, items: all };
}

/**
 * Object states for a model: "auto" takes the damaged/destroyed versions found by name (the model itself, or the
 * intact model it is a version of, is `intact`); named entries add or replace states (their model resolved by
 * id or name) and set transitions. Without "auto", the model itself is `intact` unless an entry uses it.
 */
export async function resolveStates(src: SpecSources, asset: Asset, input: StatesInput, opts: { baseLoop?: string } = {}): Promise<ObjectStates> {
  let auto = false;
  let autoLook: string | undefined;
  let entries: { name: string; asset?: number | string; transition?: string | null; from?: string; look?: string; template?: string | null; collision?: StateCollision }[];
  if (typeof input === 'string') {
    try {
      const parsed = parseStatesArg(input);
      auto = parsed.auto;
      autoLook = parsed.autoLook;
      entries = parsed.entries;
    } catch (e) {
      throw new SpecError((e as Error).message);
    }
  } else {
    entries = Object.entries(input).map(([name, v]) => {
      if (typeof v !== 'object' || v === null) return { name, asset: v };
      const { template: _t, anim: _a, ...rest } = v;
      const loop = loopOf(v, name);
      return { name, ...rest, ...(loop !== undefined ? { template: loop } : {}) };
    });
    if (!entries.length) throw new SpecError('states: give at least one state, or "auto".');
  }
  let states: ObjectStates = {};
  if (auto) {
    if (!src.variants) throw new SpecError('states "auto" needs the server (variant search).');
    const found = await src.variants(asset.id);
    if (found.asked) src.warn?.(`${asset.name} is the ${found.asked.state} version of ${found.intact.name}: ${found.intact.name} is the intact state.`);
    states = { ...found.states };
    // auto+scorch: a procedural destroyed state (the intact model scorched) when no destroyed model exists.
    if (autoLook && !states.destroyed) states.destroyed = { asset: found.intact.id, look: autoLook, transition: 'collapse' };
    const named = new Set(entries.filter((e) => e.asset !== undefined || e.look !== undefined).map((e) => e.name));
    if (Object.keys(states).length < 2 && ![...named].some((n) => n !== 'intact'))
      throw new SpecError(`No damaged or destroyed versions of ${found.intact.name} found in ${found.pack} (names with _Damaged, _Destroyed, _Broken, _Ruin, _Wreck). Name the states instead, e.g. intact=${found.intact.name},destroyed=<model>, or draw a scorched one: auto+scorch (or destroyed=@scorch@collapse).`);
  }
  const resolved: { name: string; id?: number; transition?: string | null; from?: string; look?: string; template?: string | null; collision?: StateCollision }[] = [];
  for (const e of entries) resolved.push({ name: e.name, ...(e.asset !== undefined ? { id: (await resolveAsset(src, e.asset)).id } : {}), transition: e.transition, from: e.from, ...(e.look ? { look: e.look } : {}), ...(e.template !== undefined ? { template: e.template } : {}), ...(e.collision !== undefined ? { collision: e.collision } : {}) });
  // The model itself is intact unless an entry draws intact (or uses the model); `intact:drive` only adds a loop.
  if (!auto && !resolved.some((e) => (e.name === 'intact' && (e.id !== undefined || e.look)) || e.id === asset.id)) states.intact = { asset: asset.id };
  // A procedural look is drawn from the base model (the first state's: intact) unless a model is named.
  const baseAsset = () => states.intact?.asset ?? Object.values(states)[0]?.asset ?? asset.id;
  for (const e of resolved) {
    const prev = states[e.name];
    if (e.id === undefined && !e.look && !prev) throw new SpecError(`state "${e.name}" has no model${auto ? ' (none was found for it)' : ''}: name one, e.g. ${e.name}=<model>, or draw it procedurally: ${e.name}=@scorch.`);
    const look = e.look ?? (e.id === undefined ? prev?.look : undefined);
    const template = e.template !== undefined ? e.template : prev?.template;
    const collision = e.collision ?? prev?.collision;
    states[e.name] = {
      asset: e.id ?? (e.look ? baseAsset() : prev!.asset),
      ...(look ? { look } : {}),
      ...(template ? { template } : {}),
      ...(e.transition ?? prev?.transition ? { transition: (e.transition ?? prev?.transition)! } : {}),
      ...(e.from ?? prev?.from ? { from: (e.from ?? prev?.from)! } : {}),
      ...(collision ? { collision } : {}),
    };
  }
  states = orderStates(states);
  // `template` next to `states` (FB-056): the base state's loop, unless it has its own.
  const base = Object.keys(states)[0];
  if (opts.baseLoop && base && !states[base].template) states[base] = { ...states[base], template: opts.baseLoop };
  const problems = checkStates(states);
  const unknownIn = (spec: string) => {
    try {
      return parseTransition(spec).map((l) => l.id).filter((id) => !TEMPLATE_CATALOG.some((t) => t.id === id));
    } catch {
      return []; // reported by checkStates
    }
  };
  for (const [name, st] of Object.entries(states)) {
    const unknown = st.transition ? unknownIn(st.transition) : [];
    if (unknown.length) problems.push(`state "${name}": unknown template ${unknown.join(', ')} (see ssg templates; e.g. destroy)`);
    const loopUnknown = st.template ? unknownIn(st.template) : [];
    if (loopUnknown.length) problems.push(`state "${name}": unknown loop template ${loopUnknown.join(', ')} (see ssg templates; e.g. drive, spin, turret_sweep)`);
    else if (st.template && parseTransition(st.template).some((l) => TEMPLATE_CATALOG.find((t) => t.id === l.id)?.loop === false))
      problems.push(`state "${name}": template ${st.template} is a one-shot; a state's template loops (drive, spin…). Give a one-shot as a transition instead (${name}@…).`);
  }
  if (problems.length) throw new SpecError(`states: ${problems.join('; ')}`);
  return states;
}

export async function buildSpec(src: SpecSources, input: ExportInput): Promise<{ spec: BatchSpec; assets: Asset[] }> {
  if (!input.assets?.length) throw new SpecError('Give at least one model.');
  if (input.maxSeconds !== undefined && !(input.maxSeconds > 0)) throw new SpecError(`maxSeconds must be a number of seconds above 0 (got ${input.maxSeconds}).`);
  const preset = input.preset ? byIdOrName(await src.presets(), input.preset) : undefined;
  if (input.preset && !preset) throw new SpecError(`No job preset "${input.preset}".`);

  // View: preset view -> named view preset -> iso8; then overrides.
  let view: ViewConfig;
  if (input.view) {
    const v = VIEW_PRESETS.find((p) => p.id === input.view || p.label.toLowerCase() === input.view!.toLowerCase());
    if (!v) throw new SpecError(`Unknown view "${input.view}". Views: ${VIEW_PRESETS.map((p) => p.id).join(', ')}`);
    view = v.config;
  } else view = preset?.view ?? VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
  view = applyOverrides(view, input.overrides, (m) => src.warn?.(m));

  const profiles = [...BUILTIN_PROFILES, ...(await src.profiles())];
  const formatRef = input.format ?? preset?.profileId ?? 'generic';
  let profile = byIdOrName(profiles, formatRef);
  if (!profile) throw new SpecError(`Unknown format "${formatRef}". Formats: ${profiles.map((p) => p.id).join(', ')}`);
  if (input.animPrefix !== undefined) profile = withAnimPrefix(profile, input.animPrefix);
  if (input.atlas) profile = withAtlasLayout(profile);

  const assets: Asset[] = [];
  for (const a of input.assets) assets.push(await resolveAsset(src, a));
  // Objects in an iso view stand on the diamond grid: one grid-aligned facing unless directions were asked for.
  // A vehicle with states (a tank and its wreck) is placed as an object too.
  const allObjects = assets.every((a) => wizKindForAsset(a.kind, a.name) === 'object' || (input.states !== undefined && wizKindForAsset(a.kind, a.name) === 'vehicle'));
  if (allObjects && !input.overrides?.directions && !input.alignTo) view = objectView(view);

  // Animations: explicit clips/templates make an ad-hoc set; otherwise a named set or the preset's set (objects
  // and scenery need none: they stand still).
  let set: AnimationSet;
  if (input.classes?.length && input.set && !input.inlineSet) throw new SpecError(`A set and movesets (classes) can't be combined: the movesets are the set. Pick some of their moves with animations/templates instead (e.g. idle, walk, shoot).`);
  const items: SetItem[] = [];
  if (!input.classes?.length || input.inlineSet) {
    for (const a of input.animations ?? []) items.push(await resolveAnimation(src, a));
    for (const t of input.templates ?? []) items.push(parseTemplate(t));
  }
  if (input.states !== undefined) {
    if (assets.length !== 1) throw new SpecError('states are for one model at a time.');
    if (input.animations?.length || input.set || input.classes?.length || input.inlineSet)
      throw new SpecError('states are the export\'s animations: leave out animations, set and classes (give a transition per state instead, e.g. destroyed@destroy, or a loop: intact:drive).');
    if (wizKindForAsset(assets[0].kind, assets[0].name) === 'character') throw new SpecError(`states are for objects and vehicles, not characters (${assets[0].name}).`);
    set = stateSet(await resolveStates(src, assets[0], input.states, { baseLoop: statesBaseLoop(input.templates) }));
  } else if (input.inlineSet) set = input.inlineSet;
  else if (input.classes?.length) {
    if (input.movePrefix === false && input.classes.length > 1) throw new SpecError(`movePrefix: false is for one moveset; with ${input.classes.join(' + ')} the moves would share names (idle, walk…). Keep the prefix or split the sprite.`);
    const sets = await src.sets();
    set = classSet(input.classes, sets, { movePrefix: input.movePrefix });
    if (!set.items.length) throw new SpecError(`Unknown weapon classes "${input.classes.join(', ')}". Classes: ${WEAPON_CLASSES.map((c) => c.id).join(', ')}.`);
    const regular = new Set(set.items.map(setItemLabel));
    const optional = classSet(input.classes, sets, { movePrefix: input.movePrefix, optional: true }).items.filter((it) => !regular.has(setItemLabel(it)));
    set = await pickMoves(src, set, input, optional);
  } else if (items.length) set = { id: 'adhoc', name: items.map((i) => i.label).join(', '), items };
  else {
    const ref = input.set ?? preset?.setId ?? (allObjects ? 'builtin_object' : undefined);
    if (!ref && (input.clipWith?.length || input.stills?.length)) set = { id: 'adhoc', name: '', items: [] };
    else {
      if (!ref) throw new SpecError('Say what to animate: animations (clip names), templates (e.g. drive, sit) or a set.');
      const found = byIdOrName([...BUILTIN_SETS, ...(await src.sets())], ref);
      if (!found) throw new SpecError(`No animation set "${ref}".`);
      set = found;
    }
  }

  // SF-FB-025: stills, added after the moves (a move's or a clip's pose at one time).
  if (input.stills?.length) {
    if (input.states !== undefined) throw new SpecError('stills are for clips and moves: an object\'s states are stills already.');
    const extra: SetItem[] = [];
    for (const raw of input.stills) extra.push(await resolveStill(src, raw, set, input));
    set = { ...set, name: `${set.name}${set.items.length ? ' + ' : ''}${extra.map(setItemLabel).join(', ')}`, items: [...set.items, ...extra] };
  }

  // SF-FB-022: one clip may be used twice, but each needs its own export name ("Clip@0:3=kicks_a").
  if (input.animations?.length || input.stills?.length) {
    const seen = new Set<string>();
    for (const it of set.items) {
      const l = setItemLabel(it);
      if (seen.has(l.toLowerCase())) throw new SpecError(`"${l}" is asked for twice: give each its own name with "=name" at the end (e.g. ${l}@0:3=${l}_a) or "label" in an anim object.`);
      seen.add(l.toLowerCase());
    }
  }
  // Loadout: "asset@bone" strings or placement objects; templates animate the held object (e.g. weapon_fire).
  const loadout: LoadoutItem[] = [];
  const heldItem = async (w: WithInput, group?: string): Promise<{ item: LoadoutItem; asset: Asset }> => {
    const o = typeof w === 'string' ? parseWith(w) : w;
    const held = await resolveAsset(src, o.asset);
    const t = typeof w === 'string' ? undefined : w.template;
    const perClip = group !== undefined || (typeof w !== 'string' && !!w.perClip);
    return { asset: held, item: {
      asset: held.id, target: o.target,
      ...(typeof w === 'string' ? {} : { pos: w.pos, rot: w.rot, scale: w.scale }),
      ...(t ? { layers: (parseTemplate(t) as Extract<SetItem, { type: 'template' }>).layers } : {}),
      ...(o.layer ? { layer: o.layer } : {}),
      ...(o.depth ? { depth: o.depth } : {}),
      ...(o.secondary ? { secondary: typeof o.secondary === 'string' ? SECONDARY_PRESETS[o.secondary] : o.secondary } : {}),
      ...(o.trigger ? { trigger: o.trigger } : {}),
      // With classes, weapons belong to a class (given, or from the name) and only appear in its clips. A clip's own
      // items (FB-074) belong to its group.
      ...(group !== undefined ? { cls: group } : input.classes?.length && (o.cls ?? movesetOfAsset(held)) ? { cls: o.cls ?? movesetOfAsset(held)! } : perClip && o.cls ? { cls: o.cls } : {}),
      ...(perClip ? { perClip: true } : {}),
    } };
  };
  for (const w of input.with ?? []) loadout.push((await heldItem(w)).item);
  // Clips with their own items (FB-074): each becomes `<group>_<clip>` holding them; its items join the loadout once.
  if (input.clipWith?.length) {
    if (input.states !== undefined) throw new SpecError('clipWith is for characters: states have no held items.');
    const extra: SetItem[] = [];
    for (const [i, c] of input.clipWith.entries()) {
      const where = `clipWith[${i}]`;
      if (!c || (c.anim === undefined) === (c.template === undefined)) throw new SpecError(`${where}: give a clip (anim) or a template, and the items it holds (with).`);
      const ws = (Array.isArray(c.with) ? c.with : [c.with]).filter((w) => w !== undefined && w !== null && w !== '');
      if (!ws.length) throw new SpecError(`${where}: say what the clip holds ("with": "Pack/Model").`);
      if (c.as !== undefined && !/^[a-z][a-z0-9_]*$/i.test(c.as)) throw new SpecError(`${where}: "as" is a name of letters, digits and _ (got ${JSON.stringify(c.as)}).`);
      const helds: { item: LoadoutItem; asset: Asset }[] = [];
      for (const w of ws) helds.push(await heldItem(w, ''));
      const group = (c.as ?? helds.map((h) => movesetOfAsset(h.asset)).find((m) => !!m) ?? groupFromName(helds[0].asset.name)).toLowerCase();
      let it: SetItem;
      let base: string;
      if (c.template !== undefined) {
        it = parseTemplate(c.template);
        base = setItemLabel(it);
      } else {
        const ref = c.anim!;
        try {
          it = await resolveAnimation(src, ref);
          base = setItemLabel(it);
        } catch (e) {
          // Not a clip: a move of the sprite's movesets or of the group's own moveset ("attack_2", "place").
          const ids = [...new Set([...(input.classes ?? []), ...(WEAPON_CLASSES.some((w) => w.id === group) ? [group] : [])])];
          const moves = ids.length ? classSet(ids, await src.sets(), { optional: true }).items : [];
          const { items: hit } = pickClassMoves(moves, { animations: [ref] });
          if (!hit.length) throw new SpecError(`${where}: ${(e as Error).message}`);
          it = hit.find((h) => h.cls === group) ?? hit[0];
          base = moveName(it);
        }
      }
      if (c.release !== undefined && !RELEASE_MODES.includes(c.release)) throw new SpecError(`${where}: release is ${RELEASE_MODES.join(', ')} (got ${JSON.stringify(c.release)}).`);
      extra.push({ ...it, label: `${group}_${base}`, cls: group, perClip: true, ...(c.release ? { release: c.release } : {}) } as SetItem);
      for (const h of helds) {
        const item = { ...h.item, cls: group, perClip: true };
        if (!loadout.some((x) => x.asset === item.asset && x.cls === group && (x.layer ?? null) === (item.layer ?? null))) loadout.push(item);
      }
    }
    set = { ...set, name: `${set.name}${set.items.length ? ' + ' : ''}${extra.map(setItemLabel).join(', ')}`, items: [...set.items, ...extra] };
  }
  const fx: FxLook | undefined = input.fx === true ? { enabled: true } : input.fx ? input.fx : undefined;
  let light: SpriteLight | null;
  try {
    light = parseLight(input.light);
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
  const layered = input.layered || input.alignTo ? { occlusion: input.layered === 'none' ? ('none' as const) : ('mask' as const) } : undefined;
  if (input.partsOnly && !input.alignTo) throw new SpecError('partsOnly needs alignTo (the manifest of the export to line up with).');
  if (input.alignTo && !loadout.length && !input.partsOnly) {
    // Adding clips to an existing layered export: the stored parts must be mounted too. Callers pass them in `with`.
  }

  const turret = await turretOf(src, input, assets, view);
  let modelScale: number | null;
  try {
    modelScale = parseModelScale(input.modelScale, 'modelScale');
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
  if (modelScale && view.scale.mode === 'fit') src.warn?.(`the model scale ×${modelScale} does nothing in a fitted view (the model is fitted into the frame): give ppm or a tile lock.`);
  const split = splitOf(input, assets, set);
  let portrait: PortraitSpec | null;
  try {
    portrait = parsePortrait(input.portrait);
  } catch (e) {
    throw new SpecError((e as Error).message);
  }

  const spec: BatchSpec = {
    name: input.name ?? `${set.name} — ${assets.length === 1 ? assets[0].name : `${assets.length} models`}`,
    assetIds: assets.map((a) => a.id),
    set,
    view,
    profile,
    layers: input.layers ?? preset?.layers ?? [],
    gender: input.gender ?? preset?.gender ?? 'auto',
    uniformFrame: input.uniformFrame ?? preset?.uniformFrame ?? view.scale.mode !== 'fit',
    ...(loadout.length ? { loadout } : {}),
    ...(fx ? { fx } : {}),
    ...(light ? { light } : {}),
    ...(layered ? { layered } : {}),
    ...(input.alignTo ? { alignTo: input.alignTo } : {}),
    ...(input.partsOnly ? { partsOnly: true } : {}),
    ...(input.alignTo && input.pageStart !== undefined ? { extendClips: { pageStart: input.pageStart } } : {}),
    ...(input.incremental && layered ? { incremental: true } : {}),
    ...(input.maxSeconds ? { maxSeconds: input.maxSeconds } : {}),
    ...(input.pivot ? { pivot: input.pivot } : {}),
    ...(turret ? { turret } : {}),
    ...(split ? { split } : {}),
    ...(portrait ? { portrait } : {}),
    ...(modelScale ? { modelScale } : {}),
  };
  return { spec, assets };
}

/** Roles of a model's parts (fetching the model when a search result came without them). */
async function partRoles(src: SpecSources, a: Asset) {
  const parts = a.parts ?? (await src.getAsset(a.id)).parts ?? [];
  return new Set(parts.map((p) => p.role).filter((r): r is string => !!r));
}

/**
 * FB-096: the export's turret split, checked: every model needs a turret or barrel part (ssg parts sets roles), an
 * ortho view, and no states or layered equipment (the hull and turret are their own two sheets).
 */
export async function turretOf(src: SpecSources, input: Pick<ExportInput, 'turret' | 'states' | 'layered' | 'alignTo'>, assets: Asset[], view: Pick<ViewConfig, 'projection'>): Promise<TurretSplit | null> {
  let t: TurretSplit | null;
  try {
    t = parseTurret(input.turret);
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
  if (!t) return null;
  if (input.states !== undefined) throw new SpecError('turret and states can\'t be combined: the turret split is for a vehicle that drives and aims (make the wreck its own sprite with states).');
  if (input.layered || input.alignTo) throw new SpecError('turret is its own layering (a hull sheet and a turret sheet): leave out layered.');
  if (view.projection === 'persp') throw new SpecError('turret needs an orthographic view (the mount offsets are exact only without perspective).');
  for (const a of assets) {
    const roles = await partRoles(src, a);
    if (!TURRET_ROLES.some((r) => roles.has(r)))
      throw new SpecError(`${a.name} has no turret or barrel part to split off. Set one with: ssg parts ${a.name} <part> turret (ssg parts ${a.name} lists them).`);
  }
  return t;
}

/**
 * FB-124: the export's waist split, checked: characters only (a skeleton with hips and a spine), not with a turret,
 * states or layered equipment, and both sheets need at least one move of the set.
 */
export function splitOf(input: Pick<ExportInput, 'split' | 'turret' | 'states' | 'layered' | 'alignTo'>, assets: Pick<Asset, 'name' | 'kind' | 'rig'>[], set: AnimationSet): WaistSplit | null {
  let s: WaistSplit | null;
  try {
    s = parseSplit(input.split);
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
  if (!s) return null;
  if (input.turret !== undefined && input.turret !== null && input.turret !== false) throw new SpecError('split and turret can\'t be combined: split is for characters, turret for vehicles.');
  if (input.states !== undefined) throw new SpecError('split and states can\'t be combined.');
  if (input.layered || input.alignTo) throw new SpecError('split is its own layering (a legs sheet and a torso sheet): leave out layered (held items are drawn on the torso sheet).');
  for (const a of assets) {
    if (a.kind !== 'character') throw new SpecError(`split "waist" is for characters: ${a.name} is a ${a.kind}.`);
    const map = a.rig?.map;
    if (map && (!map.hips || !(map.spine1 || map.spine2 || map.spine3)))
      throw new SpecError(`${a.name}'s skeleton has no ${!map.hips ? 'hips' : 'spine'} bone to cut at (see its bone mapping).`);
  }
  for (const sheet of ['legs', 'torso'] as const) {
    if (!splitSet(set, s, sheet).items.length)
      throw new SpecError(`split: no move of the set goes on the ${sheet} sheet (${sheet === 'legs' ? 'add idle or walk' : 'add idle, aim or shoot'}, or name the moves with { "${sheet}": [...] }).`);
  }
  return s;
}

/**
 * "asset", "asset@bone", "asset:front|:back" (depth), "asset:sway|:sway-soft|:sway-stiff" (secondary motion),
 * "asset=layername", "asset!event" (start its animation at that clip event), "asset~class" (weapon class) — any
 * order after the asset.
 */
export function parseWith(w: string): { asset: string; target?: string; layer?: string; depth?: DepthRule; secondary?: 'soft' | 'medium' | 'stiff'; trigger?: string; cls?: string } {
  const m = w.match(/^([^@:=!~]+)(.*)$/);
  if (!m) return { asset: w };
  const out: ReturnType<typeof parseWith> = { asset: m[1] };
  for (const part of m[2].match(/[@:=!~][^@:=!~]*/g) ?? []) {
    const v = part.slice(1);
    if (part[0] === '@') out.target = v;
    else if (part[0] === '=') out.layer = v;
    else if (part[0] === '!') out.trigger = v;
    else if (part[0] === '~') out.cls = v;
    else if (v === 'front' || v === 'back') out.depth = v;
    else if (v === 'sway' || v === 'sway-medium') out.secondary = 'medium';
    else if (v === 'sway-soft') out.secondary = 'soft';
    else if (v === 'sway-stiff') out.secondary = 'stiff';
    else throw new SpecError(`"${w}": after the item name use :front, :back, :sway (or :sway-soft / :sway-stiff)`);
  }
  return out;
}
