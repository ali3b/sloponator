// Moved from synty-sprite-generator packages/shared/src/batch.ts (P2, ali3b/sloponator#8).
/**
 * Batch exports: an animation set applied to many assets with one job preset (view + format + layers).
 * Sets reference clips by name (not id) so one set works on every character and survives re-imports.
 */
import type { ViewConfig } from '../view/camera.js';
import type { ClipWindow, LoadoutItem } from './combat.js';
import type { LayerAlignment, LayeredOptions } from '../manifest/layers.js';
import type { ExportProfile } from '../profiles/profiles.js';
import type { SpriteLight } from './light.js';
import type { StateCollision } from '../object/footprint.js';
import type { TurretSplit } from '../manifest/turret.js';
import type { WaistSplit } from '../manifest/split.js';
import type { PortraitSpec } from '../manifest/portrait.js';

/**
 * What a clip's own held items (per-clip `with`) do at its `release` event (FB-103): hide (the grenade has left the hand:
 * the game spawns its own), drop (it falls from the hand and stays where it lands: placed C4) or keep (stays in the hand).
 * Default: hide when the clip has a release event.
 */
export type ReleaseMode = 'hide' | 'drop' | 'keep';
export const RELEASE_MODES: ReleaseMode[] = ['hide', 'drop', 'keep'];

export interface TemplateLayerRef {
  id: string;
  params: Record<string, number>;
}

export type SetItem =
  /** A skeletal clip, matched by pack + category + name (+ gender, root motion). */
  | {
      type: 'anim'; pack: string; name: string; category: string | null; rootMotion: boolean; gender: string | null; label?: string; cls?: string; overlay?: TemplateLayerRef[];
      /** Per-clip `with` (FB-074): this clip holds its own items (group `cls`); other hand-held items are put away. */
      perClip?: boolean;
      /** With perClip: what its items do at the clip's `release` event (FB-103; default hide). */
      release?: ReleaseMode;
      /**
       * The clip's id when it was picked (SF-FB-003): a renamed clip is still found (and is the same move to the
       * outdated check) although `name` is its old name. Without it, or when the id is gone (pack re-installed),
       * the clip is found by name, then by its previous names.
       */
      clip?: number;
      /** This sprite's own trim/cap of the clip (SF-FB-001): source seconds, after the shared clip edit. */
      window?: ClipWindow;
    }
  /** Procedural template layers (poses for characters, part/object animations for vehicles and props). */
  | {
      type: 'template'; layers: TemplateLayerRef[]; label?: string; cls?: string; perClip?: boolean; release?: ReleaseMode;
      /** Object states (object/states.ts): render this clip with this library model instead of the batch's own. */
      model?: number;
      /** Object states: a procedural look of `model` (object/scorch.ts, e.g. "scorch"): drawn from its own copy. */
      look?: string;
      /**
       * Object states: the state this clip shows (a still, or its looping template `loop`), or the transition into
       * it (`from` set).
       */
      state?: { name: string; from?: string; loop?: string; collision?: StateCollision };
      /** A per-clip cap (`window.maxSeconds`); a trim only applies to skeletal clips. */
      window?: ClipWindow;
    }
  /**
   * The first installed clip whose name matches `pattern` (a case-insensitive regex), preferring Synty packs
   * over uploads, e.g. combat sets that work with any combat pack or Mixamo download. When nothing matches,
   * `fallback` template layers are used (e.g. a procedural hit reaction or death fall). `prefer` lists exact
   * clips (regexes, tried in order) from the Synty packs that suit the move best, before the general pattern.
   */
  /** `cls`: the weapon class this clip belongs to (classSet); weapons of other classes are hidden during it. */
  | {
      type: 'match'; pattern: string; label: string; fallback?: TemplateLayerRef[]; prefer?: string[]; cls?: string; overlay?: TemplateLayerRef[]; perClip?: boolean; release?: ReleaseMode;
      /** Used when nothing matches (before `fallback`): a moveset's own clip, else the plain locomotion clip. */
      orElse?: SetItem;
      /** This sprite's own trim/cap of whichever clip the move plays (a procedural stand-in only gets the cap). */
      window?: ClipWindow;
    };

export interface AnimationSet {
  id: string;
  name: string;
  items: SetItem[];
}

export type ExtraLayer = 'normal' | 'depth' | 'uv' | 'shadow';

export interface JobPreset {
  id: string;
  name: string;
  view: ViewConfig;
  profileId: string;
  layers: ExtraLayer[];
  setId: string | null;
  /** Masculine/Feminine clip choice: guess per character from its name, or force one. */
  gender: 'auto' | 'Masculine' | 'Feminine';
  /** ppm/tile scale: measure every asset first so all share one frame size and feet pivot. */
  uniformFrame: boolean;
  /** Extra choices saved by the Wizard (ignored elsewhere; older presets simply lack it). */
  wizard?: WizardPresetExtras;
}

export interface WizardPresetExtras {
  version: 1;
  /** Which models the preset was made for: character, vehicle, prop, weapon or all. */
  kind?: string;
  /** The models picked when saved (kept if they still exist). */
  assetIds?: number[];
  /** Wizard card ids, so the same cards show as chosen when the preset is loaded. */
  viewCardId?: string;
  lookId?: string;
  sizeId?: string;
  /** The set with any single moves added in the wizard (setId then names the set it started from). */
  set?: AnimationSet;
  loadout?: LoadoutItem[];
  fx?: FxLook | null;
  layered?: LayeredOptions | null;
  /** Weapon classes (movesets) chosen instead of one set: unarmed, sword, bow, staff, rifle, pistol, martial_arts. */
  classes?: string[];
}

/** What a runner needs, embedded at creation so a batch is reproducible even if presets change later. */
export interface BatchSpec {
  name: string;
  assetIds: number[];
  set: AnimationSet;
  view: ViewConfig;
  profile: ExportProfile;
  layers: ExtraLayer[];
  gender: JobPreset['gender'];
  uniformFrame: boolean;
  /**
   * With uniformFrame: other sprites of the same model in the project (their sets and held items), measured with this
   * batch's own so every sheet of the model gets one frame size and pivot (SF-FB-018). Set by the server.
   */
  uniformWith?: { set: AnimationSet; loadout?: LoadoutItem[] }[];
  /** Held weapons / props for every character in the batch (each at its saved grip unless placed here). */
  loadout?: LoadoutItem[];
  /** Glowing FX rendering (unlit, tinted; engines should draw these sheets additively). */
  fx?: FxLook;
  /** Lighting (FB-060): preset and overrides for the scene lights; unset = day (see light.ts). */
  light?: SpriteLight;
  /** Export the body and every loadout item as separate, aligned sheets plus `{base}.layers.json`. */
  layered?: LayeredOptions;
  /** Line up with an earlier layered export (its `alignment`): same framing, layout and sample times. */
  alignTo?: LayerAlignment;
  /** With alignTo: render only the parts (adding items to an existing export). */
  partsOnly?: boolean;
  /** With alignTo: fold the result into that earlier batch's result for the same asset (server-side merge). */
  mergeInto?: number;
  /**
   * With alignTo: the set holds only new clips, rendered for the body and every item at the stored framing, on
   * pages numbered from `pageStart`, then merged into `mergeInto`. If the new clips need bigger frames than the
   * export has, the runner renders `fallbackSet` (the whole set) from scratch instead.
   */
  extendClips?: { pageStart: number; fallbackSet?: AnimationSet };
  /** Layered batches: reuse layers from an earlier batch of the same asset with the same alignment; render only what changed. */
  incremental?: boolean;
  /**
   * FB-121: render every frame again instead of taking unchanged clip × direction frames from the frame cache (a
   * forced re-render). Fresh frames still go into the cache.
   */
  noCache?: boolean;
  /** Write a preview GIF per animation (previews/<clip>_<dir>.gif) whatever the format; sprite renders ask for it. */
  previews?: boolean;
  /**
   * Cap each clip at this many seconds (an 8 s idle becomes a short loop). Loops are cut where the pose comes back
   * closest to the first frame, so they still loop cleanly; one-shots are cut at the cap. The shared clip is untouched.
   */
  maxSeconds?: number;
  /**
   * Objects: the frame pivot written in the data files. "anchor" (the default): each direction's object anchor, so
   * a sprite placed by its anchor stays put when it plays another animation (FB-029); "origin": the model origin.
   */
  pivot?: 'anchor' | 'origin';
  /**
   * Vehicles (FB-096): render the hull and the turret (turret/barrel parts) as two sheets, the turret with its own
   * directions, and write the turret's mount point per hull direction into the hull's data files (object/turret.ts).
   */
  turret?: TurretSplit;
  /**
   * Characters (FB-124): render a legs sheet ({base}_legs: locomotion) and a torso sheet ({base}_torso: aim, shoot,
   * throw…) with one framing and a per-frame `waist` socket in both, so a game aims the torso apart from the walk.
   */
  split?: WaistSplit;
  /**
   * Characters (SF-FB-021): also render a head-and-shoulders still, framed from the head and neck joints, as
   * <base>_portrait.png (+ <base>_portrait.json) next to the sheets (export/portrait.ts).
   */
  portrait?: PortraitSpec;
  /**
   * SF-FB-024: draw the model (with what it holds) this many times its real size under the same ppm or tile lock: a
   * 1.3× boss renders 1.3× bigger, its sockets, pivot, footprint and ground speed with it. The data files keep the
   * world's pixels per metre and record the factor (scale.modelScale). Unset = 1.
   */
  modelScale?: number;
}

export interface FxLook {
  enabled: boolean;
  /** CSS colour multiplied into the FX (e.g. "#ff7a20" fire, "#60c0ff" ice). */
  tint?: string;
  /** Brightness multiplier. */
  intensity?: number;
  /** 'add' (default): overlaps brighten, engines draw the sheet additively; 'normal' for smoke and dust. */
  blend?: 'add' | 'normal';
}

/** Particle templates drawn with normal blending (smoke darkens what is behind it; additive would light it up). */
export const NORMAL_BLEND_TEMPLATES: ReadonlySet<string> = new Set(['smoke_puffs', 'smoke_loop']);

/**
 * The FX look a model renders with: the batch's own, else glowing for FX-kind models. A glowing look without a
 * blend over a set of smoke templates only (NORMAL_BLEND_TEMPLATES) blends normally at plain brightness, so smoke
 * comes out as grey smoke with `blend: normal` in the export, not as light added on top.
 */
export function fxLookFor(spec: { fx?: FxLook; set?: Pick<AnimationSet, 'items'> }, assetKind: string): FxLook | undefined {
  const fx = spec.fx ?? (assetKind === 'fx' ? { enabled: true } : undefined);
  if (!fx?.enabled || fx.blend) return fx;
  const items = spec.set?.items ?? [];
  const smoke = items.length > 0 && items.every((it) => it.type === 'template' && it.layers.length > 0 && it.layers.every((l) => NORMAL_BLEND_TEMPLATES.has(l.id)));
  return smoke ? { ...fx, blend: 'normal', intensity: fx.intensity ?? 1 } : fx;
}

/** Guess which Synty clip gender suits a character from its name (Synty names say Female/Girl/Woman…). */
export function guessGender(assetName: string): 'Masculine' | 'Feminine' {
  return /female|woman|girl|lady|grandma|nurse|mother|queen|princess|witch|_f_|_f$/i.test(assetName) ? 'Feminine' : 'Masculine';
}

export function setItemLabel(item: SetItem) {
  if (item.label) return item.label;
  return item.type === 'anim' ? item.name : item.type === 'match' ? item.pattern : item.layers.map((l) => l.id).join('+');
}

const COMBAT_BASE: SetItem[] = [
  { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Idle', name: 'Idle_Standing', rootMotion: false, gender: null, label: 'idle' },
  { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Locomotion/Walk', name: 'Walk_F', rootMotion: false, gender: null, label: 'walk' },
  { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Locomotion/Run', name: 'Run_F', rootMotion: false, gender: null, label: 'run' },
];
const WALK_RUN = COMBAT_BASE.slice(1);
/** Synty clip names: POLYGON versions (Sword: Attack_X_Sword; Bow/Goblin: POLY_BOW_X) and Sidekick ones (MOD_SWD_X, MOD_BOW_X). */
const swd = (core: string) => `^(MOD_SWD_)?${core}(_Sword)?$`;
const bow = (core: string) => `^(POLY|MOD)_BOW_${core}$`;
const gbl = (core: string) => `^(POLY|MOD)_GBL_${core}$`;
const HIT = 'hit|hurt|react|damage|impact';
const DEATH = 'death|dying|die';
const end = (prefer: { hit?: string[]; death?: string[] } = {}): SetItem[] => [
  { type: 'match', label: 'hit', pattern: HIT, fallback: [{ id: 'hit_react', params: {} }], prefer: prefer.hit },
  { type: 'match', label: 'death', pattern: DEATH, fallback: [{ id: 'death_fall', params: {} }], prefer: prefer.death },
];
/** Front-facing reactions read best on a sprite: from the sword pack, else the bow pack. */
const COMBAT_END = end({ hit: [swd('Hit_F_React'), bow('Hit_Head_F_React')], death: [swd('Death_F(_01)?'), bow('Death_Stomach_F')] });

/**
 * A martial-arts move's own clip: a Mixamo download saved as `MartialArts_<Move>` (MartialArts_Punch_Light). The move must end
 * the name (a digit may follow), so `jump` does not take MartialArts_Jump_Kick nor `idle` MartialArts_Idle_Breathing.
 */
export const martialArtsClip = (move: string) => `^martial[_ ]?arts[_ ]?${move.replace(/_/g, '[_ ]?')}(?![_ ]?[a-z])`;
/** Moves of the unarmed fighting moveset (builtin_martial_arts), in the set's order. */
export const MARTIAL_ARTS_MOVES = [
  'idle', 'walk_forward', 'walk_back', 'jump', 'crouch_idle', 'dash_back', 'dash_forward', 'punch_light', 'punch_heavy', 'kick_light', 'kick_heavy',
  'crouch_punch', 'crouch_kick', 'jump_kick', 'uppercut', 'special', 'block', 'crouch_block', 'hit_head', 'hit_body', 'knockdown',
  'get_up', 'ko', 'victory', 'taunt', 'swept',
] as const;
/** Clips no martial-arts move may borrow from a general pattern: weapon packs (a sword, bow or gun in the pose). */
const NO_WEAPON = '^(?!.*(sword|swd|bow|gbl|rifle|pistol|gun|knife|staff|spear|shield))';
const fgt = (label: (typeof MARTIAL_ARTS_MOVES)[number], pattern: string, more: Partial<Extract<SetItem, { type: 'match' }>> = {}): SetItem =>
  ({ type: 'match', label, pattern, ...more, prefer: [martialArtsClip(label), ...(more.prefer ?? [])] });

/**
 * The unarmed moveset's hit and death, only when picked (FB-077): the front-facing sword-pack reactions (no weapon
 * in those poses), else any clip of that name without a weapon in it, else the procedural hit_react / death_fall.
 */
export const UNARMED_END: SetItem[] = COMBAT_END.map((it) => (it.type === 'match' ? { ...it, pattern: `${NO_WEAPON}.*(${it.pattern})` } : it));
const DASH_BACK = fgt('dash_back', `${NO_WEAPON}.*(dash|dodge|hop|step)[_ ]?(back|bwd|b$)`, { prefer: ['^Dodge_B(_Sword)?$', '^MOD_SWD_Dodge_B$'] });

/** Ready-made sets; users can copy and edit them. Clip names match the Synty ANIMATION packs. */
export const BUILTIN_SETS: AnimationSet[] = [
  {
    id: 'builtin_locomotion',
    name: 'Locomotion basics (idle, walk, run)',
    items: [
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Idle', name: 'Idle_Standing', rootMotion: false, gender: null, label: 'idle' },
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Locomotion/Walk', name: 'Walk_F', rootMotion: false, gender: null, label: 'walk' },
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Locomotion/Run', name: 'Run_F', rootMotion: false, gender: null, label: 'run' },
    ],
  },
  {
    id: 'builtin_vehicle',
    name: 'Vehicle basics (idle engine, drive, turn)',
    items: [
      { type: 'template', layers: [{ id: 'idle_engine', params: {} }], label: 'idle' },
      { type: 'template', layers: [{ id: 'drive', params: {} }], label: 'drive' },
      { type: 'template', layers: [{ id: 'drive_turn', params: { steer: 25 } }], label: 'turn_left' },
      { type: 'template', layers: [{ id: 'drive_turn', params: { steer: -25 } }], label: 'turn_right' },
    ],
  },
  // Combat sets: clips matched by name, so they work with Synty combat packs and Mixamo downloads alike; hit and
  // death fall back to procedural animations when no such clip is installed.
  {
    id: 'builtin_melee',
    name: 'Combat: melee (idle, walk, run, 2 attacks, block, hit, death)',
    items: [
      { type: 'match', label: 'idle', pattern: '^Idle_Standing$', prefer: [swd('Idle_Base')] },
      ...WALK_RUN,
      { type: 'match', label: 'attack_1', pattern: '(sword|melee|axe|1h|2h|great).*(attack|slash|swing)|^(attack|slash)(_?0?1)?$|slash.*0?1|attack.*light', prefer: [swd('Attack_LightCombo01A')] },
      { type: 'match', label: 'attack_2', pattern: '(attack|slash|swing|stab).*0?2|combo|thrust|stab|attack.*heavy', prefer: [swd('Attack_HeavyCombo01A')] },
      { type: 'match', label: 'block', pattern: 'block|parry', prefer: [swd('Block_Loop')] },
      ...end({ hit: [swd('Hit_F_React')], death: [swd('Death_F(_01)?')] }),
    ],
  },
  {
    id: 'builtin_archer',
    name: 'Combat: archer (idle, walk, run, draw, shoot, hit, death)',
    items: [
      { type: 'match', label: 'idle', pattern: '^Idle_Standing$', prefer: [bow('Stand_Idle_BowDown')] },
      ...WALK_RUN,
      { type: 'match', label: 'draw', pattern: 'bow.*(draw|aim)|draw.*arrow', prefer: [bow('Stand_Aiming_ToDrawn')] },
      { type: 'match', label: 'shoot', pattern: 'bow.*(shoot|fire|release)|arrow.*(shoot|release)|archer', prefer: [bow('Stand_Shoot_Reload'), bow('Stand_Shoot_ToAiming')] },
      ...end({ hit: [bow('Hit_Head_F_React')], death: [bow('Death_Stomach_F'), bow('Death_Head_F')] }),
    ],
  },
  {
    id: 'builtin_caster',
    name: 'Combat: caster (idle, walk, run, cast, charge, hit, death)',
    items: [
      ...COMBAT_BASE,
      { type: 'match', label: 'cast', pattern: 'cast|spell|magic.*attack|1h_magic|2h_magic' },
      { type: 'match', label: 'charge', pattern: 'charge|channel|magic.*(idle|loop|power)' },
      ...COMBAT_END,
    ],
  },
  {
    id: 'builtin_gunner',
    name: 'Combat: gunner (idle, walk, run, shoot, reload, crouch, prone, crawl, throw, hit, death)',
    items: [
      ...COMBAT_BASE,
      // Bow clips are the only "shoot"/"reload" names most libraries have: never those (the weapon would sit in the
      // drawing hand); without a gun clip the procedural aim-and-shoot / reload stand in.
      { type: 'match', label: 'shoot', pattern: '^(?!.*bow).*((rifle|pistol|gun|firing).*(shoot|fire)|shoot|firing)', fallback: [{ id: 'aim_shoot', params: {} }] },
      { type: 'match', label: 'reload', pattern: '^(?!.*bow).*reload', fallback: [{ id: 'reload_gesture', params: {} }] },
      // Cover: crouching from the locomotion pack (a moveset lays its carry pose over the arms); kneeling shots,
      // prone and crawling procedural unless a pack or an upload (named prone / crawl…) has them.
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Idle', name: 'Idle_Crouching', rootMotion: false, gender: null, label: 'crouch_idle' },
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Locomotion/Crouch', name: 'Crouch_FwdStrafeF', rootMotion: false, gender: null, label: 'crouch_walk' },
      { type: 'match', label: 'crouch_shoot', pattern: '^(?!.*bow).*(crouch|kneel).*(shoot|fire|firing)', fallback: [{ id: 'kneel_shoot', params: {} }] },
      { type: 'match', label: 'prone_idle', pattern: '^(?!.*bow).*prone.*(idle|loop)|^prone$', fallback: [{ id: 'prone_idle', params: {} }] },
      { type: 'match', label: 'crawl', pattern: '^(?!.*bow).*(crawl|prone.*(forward|fwd|move))', fallback: [{ id: 'crawl', params: {} }] },
      { type: 'match', label: 'prone_shoot', pattern: '^(?!.*bow).*prone.*(shoot|fire|firing)', fallback: [{ id: 'prone_shoot', params: {} }] },
      // Grenade: a throw clip (a Mixamo "Throw" download, or Rifle_Throw for the rifle moveset), else the procedural
      // overhand throw with the free (left) hand, the gun staying in the right. Its `release` event is the let-go.
      { type: 'match', label: 'throw', pattern: '^(?!.*(bow|spear|javelin)).*(throw|toss|grenade)', fallback: [{ id: 'throw', params: { hand: 1 } }] },
      ...COMBAT_END,
    ],
  },
  // Shoulder-fired launchers (FB-072): no pack has launcher clips, so the shots are the procedural shoulder_fire (the
  // tube on the right shoulder; its projectile part is hidden from the `shoot` frame on) unless an upload matches.
  {
    id: 'builtin_launcher',
    name: 'Combat: launcher (idle, walk, run, shoulder shot standing and kneeling, reload, crouch, hit, death)',
    items: [
      ...COMBAT_BASE,
      { type: 'match', label: 'shoot', pattern: '^(?!.*bow).*(rpg|launcher|bazooka|rocket).*(shoot|fire|firing)', fallback: [{ id: 'shoulder_fire', params: {} }] },
      { type: 'match', label: 'crouch_shoot', pattern: '^(?!.*bow).*(rpg|launcher|bazooka|rocket).*(crouch|kneel).*(shoot|fire|firing)', fallback: [{ id: 'shoulder_fire', params: { kneel: 1 } }] },
      { type: 'match', label: 'reload', pattern: '^(?!.*bow).*(rpg|launcher|bazooka|rocket).*reload', fallback: [{ id: 'reload_gesture', params: {} }] },
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Idle', name: 'Idle_Crouching', rootMotion: false, gender: null, label: 'crouch_idle' },
      { type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Locomotion/Crouch', name: 'Crouch_FwdStrafeF', rootMotion: false, gender: null, label: 'crouch_walk' },
      ...COMBAT_END,
    ],
  },
  // Unarmed side-view fighting (Street Fighter style). Each move plays its MartialArts_<Move> upload first; without one,
  // the plain locomotion and reaction clips stand in (sword-pack knockdown / get-up, procedural hit and fall), and
  // moves with no stand-in (punches, kicks, taunt…) are left out until their clip is installed.
  {
    id: 'builtin_martial_arts',
    name: 'Combat: martial arts (stance, walk fwd/back, jump, crouch, punches, kicks, blocks, hits, knockdown, KO, victory)',
    items: [
      fgt('idle', '^Idle_Standing$', { prefer: ['^(fight|boxing|combat)[_ ]?(idle|stance)'] }),
      fgt('walk_forward', '^Walk_F$'),
      fgt('walk_back', '^Walk_BckStrafeB$|^Walk_B$'),
      fgt('jump', '^Jump_Idle$|^Jump$'),
      fgt('crouch_idle', '^Idle_Crouching$'),
      DASH_BACK,
      // SF-FB-017: a forward dash clip (MartialArts_Dash_Forward, a Mixamo boxing step forward), else dash_back played
      // backwards (its push-off and settle mirrored in time, but a slide-step forward all the same).
      fgt('dash_forward', `${NO_WEAPON}.*(dash|dodge|hop|step|lunge)[_ ]?(forward|fwd|f$)`, { orElse: { ...DASH_BACK, label: 'dash_forward', window: { reverse: true } } as SetItem }),
      fgt('punch_light', `${NO_WEAPON}(?!.*(crouch|jump|heavy|strong)).*(jab|punch|boxing)`),
      fgt('punch_heavy', `${NO_WEAPON}(?!.*(crouch|jump)).*(punch.*(heavy|strong|hard)|cross|hook|haymaker)`),
      fgt('kick_light', `${NO_WEAPON}(?!.*(crouch|jump|heavy|strong|ground)).*kick`),
      fgt('kick_heavy', `${NO_WEAPON}(?!.*(crouch|jump)).*(kick.*(heavy|strong|hard)|roundhouse|spin.*kick)`),
      fgt('crouch_punch', `${NO_WEAPON}.*(crouch|low).*punch`),
      fgt('crouch_kick', `${NO_WEAPON}.*(crouch|low).*kick|leg[_ ]?sweep`),
      fgt('jump_kick', `${NO_WEAPON}.*(jump|flying|air).*kick`),
      fgt('uppercut', `${NO_WEAPON}.*uppercut`),
      fgt('special', `${NO_WEAPON}.*(special|hadouken|fireball|super)`),
      fgt('block', `${NO_WEAPON}(?!.*crouch).*(block|guard)`),
      fgt('crouch_block', `${NO_WEAPON}.*crouch.*(block|guard)`),
      fgt('hit_head', `${NO_WEAPON}(?!.*(stomach|body|gut)).*(${HIT})`, { fallback: [{ id: 'hit_react', params: {} }] }),
      fgt('hit_body', `${NO_WEAPON}.*(stomach|body|gut).*(${HIT})`, { fallback: [{ id: 'hit_react', params: { angle: 26 } }] }),
      fgt('knockdown', 'knock[_ ]?down[_ ]?(begin|enter|start)?$|knocked[_ ]?down', { prefer: [swd('KnockDown_Begin'), swd('KnockDown_Enter')], fallback: [{ id: 'death_fall', params: {} }] }),
      fgt('get_up', 'get[_ ]?up|stand[_ ]?up|knock[_ ]?down[_ ]?(end|exit)', { prefer: [swd('KnockDown_End'), swd('KnockDown_Exit')] }),
      fgt('ko', `${NO_WEAPON}.*(knock[_ ]?out|${DEATH})`, { fallback: [{ id: 'death_fall', params: {} }] }),
      fgt('victory', 'victory|cheer|celebrat|(^|_)win'),
      fgt('taunt', 'taunt|provok'),
      fgt('swept', 'swept|trip|sweep.*(fall|hit)', { fallback: [{ id: 'death_fall', params: { forward: 0, duration: 0.8 } }] }),
    ],
  },
  {
    id: 'builtin_goblin',
    name: 'Goblin (idle, walk, run, sprint, menace, hit, death)',
    items: [
      { type: 'match', label: 'idle', pattern: '^Idle_Standing$', prefer: [gbl('Idle_Standing')] },
      { type: 'match', label: 'walk', pattern: '^Walk_F$', prefer: [gbl('Walk_F')] },
      { type: 'match', label: 'run', pattern: '^Run_F$', prefer: [gbl('Run_F')] },
      { type: 'match', label: 'sprint', pattern: '^Sprint_F$', prefer: [gbl('Sprint_F')] },
      { type: 'match', label: 'menace', pattern: 'menac|taunt|roar', prefer: [gbl('Idle_Fidget_Menacing')] },
      ...COMBAT_END,
    ],
  },
  {
    id: 'builtin_pickup',
    name: 'Pickup / prop (float + spin, bounce)',
    items: [
      { type: 'template', layers: [{ id: 'pickup', params: {} }], label: 'pickup' },
      { type: 'template', layers: [{ id: 'bounce', params: {} }], label: 'bounce' },
    ],
  },
  // Objects and scenery (buildings, walls, crates, trees): one still pose per direction, at the characters' scale.
  { id: 'builtin_object', name: 'Object (standing still)', items: [{ type: 'template', layers: [{ id: 'still', params: {} }], label: 'idle' }] },
  // Particle FX (best on FX meshes such as FX_Sphere_Puff_01 / SM_Flame_FX; FX models glow by default).
  { id: 'builtin_fx_explosion', name: 'FX: explosion (fireball, sparks)', items: [{ type: 'template', layers: [{ id: 'explosion', params: {} }], label: 'explosion' }] },
  { id: 'builtin_fx_fire', name: 'FX: fire (looping flames)', items: [{ type: 'template', layers: [{ id: 'fire_loop', params: {} }], label: 'fire' }] },
  { id: 'builtin_fx_smoke', name: 'FX: smoke (puffs, column)', items: [
    { type: 'template', layers: [{ id: 'smoke_puffs', params: {} }], label: 'smoke_puffs' },
    { type: 'template', layers: [{ id: 'smoke_loop', params: {} }], label: 'smoke_loop' },
  ] },
  // Dungeon / medieval props: each item applies only when the model has that part (lever, drawer, lid, gate…).
  {
    id: 'builtin_prop_dungeon',
    name: 'Dungeon props (levers, drawers, lids, gates, traps, flags)',
    items: [
      { type: 'template', layers: [{ id: 'still', params: {} }], label: 'idle' },
      { type: 'template', layers: [{ id: 'lever_pull', params: {} }], label: 'lever' },
      { type: 'template', layers: [{ id: 'drawer_open', params: {} }], label: 'drawer' },
      { type: 'template', layers: [{ id: 'lids', params: {} }], label: 'open' },
      { type: 'template', layers: [{ id: 'doors', params: {} }], label: 'doors' },
      { type: 'template', layers: [{ id: 'gate_raise', params: {} }], label: 'gate' },
      { type: 'template', layers: [{ id: 'trap_spikes', params: {} }], label: 'spikes' },
      { type: 'template', layers: [{ id: 'trap_spin', params: {} }], label: 'spin' },
      { type: 'template', layers: [{ id: 'flag_wave', params: {} }], label: 'wave' },
    ],
  },
  {
    id: 'builtin_vehicle_medieval',
    name: 'Medieval vehicles (cart drive, turn; catapult fire)',
    items: [
      { type: 'template', layers: [{ id: 'drive', params: {} }], label: 'drive' },
      { type: 'template', layers: [{ id: 'drive_turn', params: { steer: 25 } }], label: 'turn_left' },
      { type: 'template', layers: [{ id: 'drive_turn', params: { steer: -25 } }], label: 'turn_right' },
      { type: 'template', layers: [{ id: 'catapult_fire', params: {} }], label: 'fire' },
    ],
  },
];

/** Frames rendered so far in one model's export, as the runner reports them to the batch (FB-016). */
export interface FrameProgress {
  done: number;
  total: number;
  /** Milliseconds since the model's frames started rendering. */
  elapsedMs: number;
}

/** Seconds left at the rate so far (null until a frame is done, or when the total is unknown). */
export function framesEta(f: FrameProgress): number | null {
  if (!(f.total > 0) || !(f.done > 0) || !(f.elapsedMs >= 0)) return null;
  return Math.max(0, Math.round(((f.elapsedMs / f.done) * Math.max(0, f.total - f.done)) / 1000));
}

/**
 * A model's progress (0..1) from its frames: 5 % to load and measure, 90 % for the frames, the last 5 % to write
 * the files and upload.
 */
export const framesProgress = (f: Pick<FrameProgress, 'done' | 'total'>) => (f.total > 0 ? 0.05 + 0.9 * Math.min(1, Math.max(0, f.done / f.total)) : 0.05);
