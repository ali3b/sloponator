/**
 * Moved from synty-sprite-generator packages/client/src/apply.ts (P2, ali3b/sloponator#8): declarative sprites. A
 * game's ssg.assets.json lists the sprites it needs in the words of the old `ssg export` flags; this reads the file
 * (its keys, aliases and the rules between them, exactly as `ssg sprite apply` did), turns each entry into export
 * inputs (entryOf) and into the sprite spec the old server would have stored (spriteSpecFor). The parts that talked
 * to the server (applySprites, writeSpriteFiles, projectFor) stayed behind; plan.ts does the planning they did.
 */
import {
  ANIM_LABEL_RE, animRefString, dirsText, cleanClipWindow, parseTrim, type ClipWindow, VIEW_PRESETS, WEAPON_CLASSES, objectView, PHASER_ANIM_PREFIX,
  LIGHT_PRESETS, parseAnimRef, stillRef, parseTurret, turretLabel, parsePortrait, portraitLabel, type PortraitInput, parseSplit, splitLabel, lightLabel, parseLight, setItemLabel, viewGrid,
  RELEASE_MODES, type ReleaseMode, type AnimationSet, type ExtraLayer, type LoadoutItem, type SpriteLight, type ViewConfig,
} from '@slop/sprites';
import { applyOverrides, buildSpec, checkCollision, dirsOverride, resolveAsset, resolveStates, SpecError, statesBaseLoop, type Asset, type ClipWithInput, type ExportInput, type SpecSources, type StatesInput, type ViewOverrides } from './buildSpec.js';
import { INHERIT_GROUPS, applyLook, applySize, applyViewCard, defaultSetFor, effectiveSet, initialState, itemKey, parseModelScale, reducer, sizeFor, lookFor, viewCardFor, type InheritGroup, type WizardState } from './state.js';
import { layeringOf, projectDefaultsOf, specClips, specOf, stateOf, type ProjectDefaults, type SpriteSpec } from './spriteSpec.js';
import { SpriteError, lookIdFor, sizeIdFor, viewIdFor, wizKindOf, withTileScale } from './sprites.js';
import type { WizKind } from './words.js';

type Kind = Exclude<WizKind, 'all'>;
const KINDS: Kind[] = ['character', 'vehicle', 'object', 'prop', 'weapon'];

/**
 * One declared sprite, in the words of `ssg export` (flag names in camelCase; the game's ssg.assets.json keys work
 * as they are). Every key but name and asset may also be given once at the top of the file for every sprite.
 */
export interface SpriteDecl {
  /** The sprite's name in the project (unique in the file): what is matched on the next run. */
  name?: string;
  /** The model: id, name or Pack/Name (e.g. POLYGON_War/SM_Bld_Bunker_01). */
  asset?: string | number;
  kind?: Kind;
  /** Movesets (weapon classes): "rifle", ["rifle", "pistol"] or "rifle,pistol". */
  class?: string | string[];
  /**
   * Clip names, or with class: the moves to keep (idle, walk, crouch_*). An entry may carry this sprite's own trim
   * and cap: "Clip@0.8:2.6", "Clip@max=2", or an object { clip, trim: "0.8:2.6", maxSeconds: 2 } (SF-FB-001); played
   * backwards: "Clip@reverse" or { clip, reverse: true } (SF-FB-017), exported as <Clip>_reverse; the root's yaw
   * locked: "Clip@lockyaw" or { clip, lockYaw: true } (SF-FB-023). With class, names
   * that are installed clips (not moves) are extra clips under their own names (SF-FB-018). SF-FB-022: this sprite's
   * own events ("Clip@hit=1.2@hit_end=1.4" or { clip, events: [{ t, name }] }, source seconds; they replace the
   * clip's shared events) and another export name ("Clip@0:3=kicks_a" or { clip, label: "kicks_a" }), so one clip
   * can be used twice with different windows.
   */
  anim?: string | AnimDecl | (string | AnimDecl)[];
  /**
   * Procedural moves (still, crawl, "drive_turn:steer=25"). A string is one template (its parameters may hold commas).
   * An object { template, with, as } is a template clip with its own held items (FB-074).
   */
  template?: string | TemplateDecl | (string | TemplateDecl)[];
  set?: string;
  /** Held items as in --with (Pack/Model, @bone, =layer, :front, ~class…). */
  with?: string | string[];
  /** Object states: "auto", "auto,destroyed@destroy" or { intact: …, destroyed: { asset, transition } }. */
  states?: StatesInput;
  view?: string;
  dirs?: string | number;
  facings?: 0 | 1 | 2 | 4;
  slice?: 'columns';
  /** Objects: metres above the model's bottom whose vertices make the ground-slice collision. */
  collisionHeight?: number;
  /** Objects: 'full' (the whole hull), 'base' (the ground slice) or 'auto' (by what the model is). FB-050. */
  collision?: 'auto' | 'base' | 'full' | 'concave';
  pitch?: number;
  projection?: 'ortho' | 'persp';
  frame?: number;
  ppm?: number;
  /**
   * Tile lock "64x32" / "32x32". On one sprite, null / false / "none" leaves the file's or project's tile lock
   * (FB-070): the sprite renders at its own ppm, or fitted to the frame without one (UI icons).
   */
  tile?: string | null | false;
  metresPerTile?: number;
  /**
   * "fit": fit the model into the frame, leaving the tile lock and ppm (FB-070). A number (1.3, also "1.3x" or
   * "130%", SF-FB-024): the model drawn that many times its real size under the same ppm/tile lock (a bigger boss);
   * the data files keep the world's pixels per metre and record it as scale.modelScale.
   */
  scale?: 'fit' | number | string;
  fps?: number;
  mirror?: boolean;
  supersample?: 1 | 2 | 3 | 4;
  pixelArt?: boolean;
  outline?: boolean;
  palette?: 'full' | 'model' | 'levels';
  shadow?: 'off' | 'low' | 'high' | false;
  /** Look and size cards (clean, pixel…; small, medium, large), as on the Create page. */
  look?: string;
  size?: string;
  format?: string;
  layers?: string | string[];
  uniform?: boolean;
  atlas?: boolean;
  animPrefix?: string;
  /** false: one moveset's clips keep their bare move names (`idle`, not `martial_arts_idle`). */
  movePrefix?: boolean;
  maxSeconds?: number;
  gender?: ExportInput['gender'];
  /**
   * Each `with` item as its own aligned sheet plus `{base}.layers.json`: true / "mask" (hidden pixels cut away) or
   * "none" (whole items). Unset or false: the items are baked into the body's sheet, as `ssg export` does.
   */
  layered?: boolean | 'mask' | 'none';
  fx?: boolean | { enabled: boolean; tint?: string; intensity?: number; blend?: 'add' | 'normal' };
  /**
   * Lighting (FB-060): "day" (default), "dusk", "night", "overcast", "desert_noon", "arctic", or { preset, ambient,
   * ambientIntensity, key, keyIntensity, azimuth, elevation }. The same names on a tileset grade its ground to match.
   */
  light?: string | SpriteLight;
  tags?: string[];
  /**
   * Objects: the frame pivot in the data files, as `ssg export --pivot`: each direction's object anchor ("anchor",
   * the default) or the model origin ("origin"). Characters always use the origin.
   */
  pivot?: 'anchor' | 'origin';
  /**
   * Vehicles (FB-096): the hull and the turret (its turret/barrel parts) as two sheets from one model, the turret's
   * mount point per hull direction in the hull's data files. true = the turret in the hull's directions; "16", 32 or
   * { "dirs": "16" } = its own directions (also "turretDirs" / "turret_dirs"); false = one sheet.
   */
  turret?: boolean | string | number | { dirs?: string | number } | null;
  /**
   * Characters (SF-FB-021): also a head-and-shoulders still, <base>_portrait.png (+ .json), framed from the head and
   * neck joints: true (256 px, three-quarter, transparent), a size, "320x400,front,#203040", or
   * { "size", "width", "height", "angle", "pitch", "background", "clip" }; false = none.
   */
  portrait?: PortraitInput;
  /**
   * Characters (FB-124): split at the waist into a legs sheet (<base>_legs: idle and locomotion) and a torso sheet
   * (<base>_torso: idle, aim, shoot, throw, reload, with the held weapon) with a per-frame `waist` socket in both, so
   * a game aims the upper body apart from the walk. "waist" / true, or { "at": "waist", "legs": [...], "torso": [...] }
   * to pick the moves of each sheet; "whole": true (FB-126) also writes the whole-body sheet <base> (every move) from the
   * same job and framing; false = one sheet.
   */
  split?: boolean | string | { at?: string; legs?: string[] | string; torso?: string[] | string; whole?: boolean } | null;
  /**
   * SF-FB-025: stills, one frame of a clip or move per direction at a time in source seconds: "Victory_Pose@2.4" or a
   * list (also "stills"); each is a one-frame animation `<Clip>_still` ("Victory_Pose@2.4=ending" names it).
   */
  still?: string | string[];
}

/**
 * One clip or move with this sprite's own window: `trim` is "start:end" in source seconds (either side may be
 * empty; also [start, end] or { start, end }), applied over the shared clip edit (its start/end replace the shared
 * trim's); `maxSeconds` caps this clip (wins over the sprite's maxSeconds).
 */
export interface AnimDecl {
  clip: string;
  trim?: string | [number | null, number | null] | { start?: number | null; end?: number | null };
  maxSeconds?: number;
  /** Play the clip backwards (SF-FB-017): a clip picked by name is exported as `<Clip>_reverse`; a move is reversed in place. */
  reverse?: boolean;
  /**
   * Lock the root's yaw (SF-FB-023): the hips stop turning about the vertical (a punch that turns the body punches
   * straight ahead in a side view); false plays the turn even when the shared clip edit locks it.
   */
  lockYaw?: boolean;
  /**
   * SF-FB-022: this sprite's own events for the clip, `[{ "t": 12.1, "name": "hit" }, …]` in SOURCE seconds (like
   * `ssg clip --event`). They replace the clip's shared events for this sprite ([] = none of them); the automatic
   * events apply unless this `autoEvents` is false (a shared `--clear-events` goes with the shared list), and an
   * event named like one (`hit`) takes its place.
   */
  events?: { t: number; name: string }[];
  /** false: no automatic events (footsteps, the key moment) in this sprite's clip. */
  autoEvents?: boolean;
  /**
   * SF-FB-022: the name the clip is exported under (default: the clip's or move's name). Lets one clip appear twice
   * with different windows: { "clip": "Capoeira_Kicks", "trim": "0:3", "label": "kicks_a" }.
   */
  label?: string;
  /**
   * FB-074: this clip's own held items (as in `with`): one sprite, several loadouts. The clip is exported as
   * `<as>_<clip>` (default group: the first item's moveset, e.g. knife, else its name); the sprite's other hand-held
   * items are put away during it, and these items appear in no other clip.
   */
  with?: string | string[];
  as?: string;
  /** FB-103: what happens to these items at the clip's `release` event: hide (default), drop (falls and stays) or keep. */
  release?: ReleaseMode;
  /** SF-FB-025: one frame only, the pose at this many source seconds (exported as `<Clip>_still` unless `label`). */
  still?: number;
}

/** A template clip with its own held items (FB-074): { "template": "shoulder_fire:kneel=1", "with": "…RPG_01", "as": "law" }. */
export interface TemplateDecl {
  template: string;
  with: string | string[];
  as?: string;
  release?: ReleaseMode;
}

/** A file for `ssg sprite apply`: the project, settings for every sprite, and the sprites. */
export interface ApplyFile extends Omit<SpriteDecl, 'name' | 'asset'> {
  project?: string | number;
  /** Settings for every sprite (the same keys may also sit at the top level). */
  defaults?: Omit<SpriteDecl, 'name' | 'asset'>;
  sprites: SpriteDecl[];
}

/** Long names and other spellings of the keys (MCP and export_sprites names, the CLI's flags). */
const ALIASES: Record<string, keyof SpriteDecl> = {
  model: 'asset', classes: 'class', moveset: 'class', movesets: 'class', anims: 'anim', animations: 'anim', templates: 'template',
  directions: 'dirs', frameSize: 'frame', uniformFrame: 'uniform', 'metres-per-tile': 'metresPerTile', 'max-seconds': 'maxSeconds',
  'pixel-art': 'pixelArt', 'anim-prefix': 'animPrefix', 'move-prefix': 'movePrefix', 'collision-height': 'collisionHeight',
  turretDirs: 'turret', turret_dirs: 'turret', 'turret-dirs': 'turret',
  modelScale: 'scale', 'model-scale': 'scale', stills: 'still',
};
export const APPLY_KEYS: readonly string[] = [
  'name', 'asset', 'kind', 'class', 'anim', 'template', 'set', 'with', 'states', 'view', 'dirs', 'facings', 'slice', 'collision', 'collisionHeight', 'pitch', 'projection', 'frame', 'ppm', 'tile',
  'metresPerTile', 'scale', 'fps', 'mirror', 'supersample', 'pixelArt', 'outline', 'palette', 'shadow', 'look', 'size', 'format', 'layers', 'uniform', 'atlas', 'animPrefix', 'movePrefix',
  'maxSeconds', 'gender', 'layered', 'fx', 'light', 'tags', 'pivot', 'turret', 'portrait', 'split', 'still',
];
const KEYS = new Set<string>(APPLY_KEYS);
/** Keys of an `anim` object entry (and their other spellings). */
const ANIM_KEYS: Record<string, keyof AnimDecl | 'template'> = { clip: 'clip', name: 'clip', move: 'clip', anim: 'clip', trim: 'trim', maxSeconds: 'maxSeconds', 'max-seconds': 'maxSeconds', reverse: 'reverse', reversed: 'reverse', lockYaw: 'lockYaw', 'lock-yaw': 'lockYaw', with: 'with', as: 'as', release: 'release', template: 'template',
  events: 'events', autoEvents: 'autoEvents', 'auto-events': 'autoEvents', label: 'label', exportAs: 'label', 'export-as': 'label', still: 'still', at: 'still' };
/** What each key means, for `ssg sprite apply --help` (one line each; a test checks it covers APPLY_KEYS). */
export const APPLY_KEY_DOCS: Record<string, string> = {
  name: 'the sprite\'s name in the project (required, unique): what the next run matches',
  asset: 'the model: id, name or Pack/Name (required; also "model")',
  kind: 'character | vehicle | object | prop | weapon (default: from the model)',
  class: 'movesets: "rifle", ["rifle","pistol"] or "rifle,pistol" (unarmed, sword, knife, bow, staff, launcher, rifle, pistol, martial_arts; also "moveset")',
  anim: 'clip names, or with class the moves to keep ("idle", "crouch_*"); per clip: "Clip@0.8:2.6", "Clip@max=2", "Clip@reverse", "Clip@lockyaw", "Clip@hit=1.2", "Clip@0:3=kicks_a" or { "clip", "trim": "0.8:2.6", "maxSeconds": 2, "reverse": true, "lockYaw": true, "events": [{ "t": 1.2, "name": "hit" }], "autoEvents": false, "label": "kicks_a" }; with class, installed clip names are extra clips under their own names; a clip with its own held items: { "clip", "with": "Pack/Model", "as": "knife" } (FB-074)',
  template: 'procedural moves: "still", ["crawl", "drive_turn:steer=25"]; with its own held items: { "template": "shoulder_fire", "with": "Pack/Model", "as": "law" }',
  set: 'an animation set by id or name (not with class); "none" = only the declared anim/template moves (the default whenever any are declared)',
  with: 'held items as in --with: "Pack/Model", "@bone", "=layer", ":front", "~class"',
  states: 'objects: "auto", "auto,destroyed@destroy", "auto,intact:drive,destroyed@destroy" or { "intact": { "template": "drive" }, "destroyed": { "asset", "transition" } } (no anim/set/class; a template next to states is the intact state\'s loop)',
  view: `view preset: ${VIEW_PRESETS.map((v) => v.id).join(', ')} (default: the project's)`,
  dirs: 'directions: 1, 2, 4, 4d, 8, 16… (also "directions"; on an object in an iso view, 1 = one facing of that view), or the directions by name: "E", "N,S", ["N","S"] (E, NE, N… ENE…; right, up_left…)',
  facings: 'objects: 1, 2 or 4 grid-aligned facings (0 = use dirs)',
  slice: 'objects on a diamond tile: "columns" (per-tile-column strips)',
  collision: 'objects: "full" (whole hull), "base" (ground slice: a trunk), "concave" (the outline of the slice: curved walls, fences) or "auto" (default: vehicles, aircraft, buildings full; trees, poles base)',
  collisionHeight: 'objects: the ground slice\'s height in metres above the bottom (default min(0.5, 15% of the height); also "collision-height")',
  pitch: 'camera pitch in degrees (0 = side, 30 = 2:1 iso)',
  projection: 'ortho | persp',
  frame: 'square frame size in px (the minimum with ppm/tile; also "frameSize")',
  ppm: 'fixed pixels per metre (a sprite\'s own ppm wins over the file\'s tile; next to its own tile, the tile wins with a warning)',
  tile: 'tile lock "64x32" (iso diamond) or "32x32" (square): the scale from the game\'s tile; null/false on a sprite leaves the lock (own ppm, or fit)',
  metresPerTile: 'with tile: metres one tile covers (default 1)',
  scale: '"fit": fit the model into the frame (UI icons), leaving the tile lock and ppm; or a number, the model\'s own size factor (1.3 = a boss 30% bigger, also "130%"; also "modelScale") at the same ppm/tile lock, recorded in the meta as scale.modelScale',
  fps: 'frames per second sampled from the clips',
  mirror: 'true: render only right-facing directions; the engine flips the rest',
  supersample: '1-4: render at N× and average down',
  pixelArt: 'pixel-art style (hard edges, model palette, 1 px outline; also "pixel-art")',
  outline: 'pixel style: 1 px outline',
  palette: 'pixel style colours: full | model | levels',
  shadow: 'off | low | high (false = off)',
  look: 'look card: clean, pixel…',
  size: 'size card: small, medium, large',
  format: 'engine format: phaser3, godot4, unity, generic… (ssg formats)',
  layers: 'extra layers: normal, depth, uv, shadow',
  uniform: 'same frame size and pivot for every model (fixed scale; also "uniformFrame"); the project\'s sprites of one model with uniform at the same view share one frame and pivot',
  atlas: 'pack trimmed frames into atlas pages',
  animPrefix: 'animation key prefix, tokens {base} {asset} (default: the sprite\'s name; "" = bare clip_dir; also "anim-prefix")',
  movePrefix: 'with one class: false = bare move names (keys "hero/idle_E", clips "idle") instead of "hero/martial_arts_idle_E" (also "move-prefix")',
  maxSeconds: 'cap every clip at this many seconds (a clip\'s own maxSeconds in anim wins; also "max-seconds")',
  gender: 'clip gender: auto | Masculine | Feminine',
  layered: 'held items as separate aligned sheets: true / "mask" or "none" (default false: baked into one sheet)',
  fx: 'glowing FX look: true or { "enabled", "tint", "intensity", "blend" }',
  light: `lighting: ${LIGHT_PRESETS.join(' | ')} (default day), or { "preset", "ambient", "ambientIntensity", "key", "keyIntensity", "azimuth", "elevation" }; on a tileset the same names grade the ground`,
  tags: 'sprite tags (default: its movesets)',
  pivot: 'objects: frame pivot "anchor" (default) or "origin"',
  turret: 'vehicles: hull and turret as two sheets, the turret\'s mount per hull direction in the hull\'s meta: true, or the turret\'s own dirs "16" / { "dirs": "32" } (also "turretDirs")',
  portrait: 'characters: also a head-and-shoulders still <base>_portrait.png (+ .json): true (256 px, 3/4, transparent), a size, "320x400,front,#203040" or { "size", "angle" (front | 3/4 | side | degrees), "pitch", "background", "clip" }',
  still: 'one-frame stills of clips or moves: "Victory_Pose@2.4" (source seconds) or a list (also "stills"), each a one-frame animation <Clip>_still per direction ("Clip@2.4=ending" names it); in anim: "Clip@still=2.4" or { "clip", "still": 2.4 }',
  split: 'characters: "waist" = a legs sheet (idle, locomotion) and a torso sheet (idle, aim, shoot, throw, reload, held weapon) with a per-frame waist socket in both, to aim the torso apart from the walk; or { "at": "waist", "legs": [moves], "torso": [moves], "whole": true } (whole: also the whole-body sheet <base> from the same render job and framing, FB-126)',
};

/** `ssg sprite apply --help`: the file format, from the same key list the validator uses (SF-FB-004). */
export function applyFileHelp(): string {
  const w = Math.max(...APPLY_KEYS.map((k) => k.length));
  return [
    'File format (JSON):',
    '  {',
    '    "project": "My Game",            project name or id (--project wins); a new name is created from the settings below',
    '    "defaults": { …sprite keys },     settings for every sprite (also allowed directly at the top level); a sprite\'s own keys win',
    '    "sprites": [ { "name": "hero", "asset": "POLYGON_BattleRoyale/Character_MercenaryMale_01", …sprite keys } ],',
    '    "tilesets": [ … ]                 optional (the levels package reads them)',
    '  }',
    '  Ignored at the top level: $schema, comment, description, generatedBy, maps.',
    '',
    'Defaults: keys left out follow the project (view, look, size, format, gender: editable in the app); a sprite with',
    'no moves gets its kind\'s set (declared anim/template moves, even only clips with their own "with", are all it gets);',
    'equipment ("with") is baked into the body\'s sheet unless "layered".',
    '',
    'Sprite keys (also usable in defaults, except name and asset):',
    ...APPLY_KEYS.map((k) => `  ${k.padEnd(w)}  ${APPLY_KEY_DOCS[k] ?? ''}`),
    '',
    'Per-clip trim and cap (this sprite only; the shared clip and other sprites are untouched):',
    '  "anim": ["MartialArts_Idle", "MartialArts_KO@max=3", { "clip": "MartialArts_Crouch_Punch", "trim": "0.8:2.6", "maxSeconds": 2 }]',
    '  With "class": "martial_arts", "clip" is the move: { "clip": "crouch_punch", "trim": "0.8:2.6" } (or "crouch_punch@0.8:2.6").',
    '  An installed clip that is no move (MartialArts_Flip_Uppercut) is exported next to the moves under its own name, with',
    '  its own trim (merc_m/MartialArts_Flip_Uppercut_E); naming only such clips keeps every move of the class (SF-FB-018).',
    '  Backwards: "MartialArts_Dash_Back@reverse" or { "clip": "MartialArts_Dash_Back", "reverse": true } is exported as',
    '  MartialArts_Dash_Back_reverse; a move ("dash_back@reverse") is reversed in place (SF-FB-017).',
    '  Turning on the spot: "Boss_Punch@lockyaw" or { "clip": "Boss_Punch", "lockYaw": true } holds the hips\' turn about',
    '  the vertical at the first frame, so the punch goes straight ahead in a side view (the upper body\'s twist is kept; SF-FB-023).',
    '',
    'Per-sprite events and one clip twice (SF-FB-022):',
    '  "anim": ["Capoeira_Kicks@0:3=kicks_a", { "clip": "Capoeira_Kicks", "trim": "11.6:14.6", "label": "super",',
    '           "events": [{ "t": 12.1, "name": "hit" }, { "t": 12.4, "name": "hit_end" }] }]',
    '  "=name" (or "label") exports the clip under that name, so the same clip can appear twice with different windows.',
    '  "events" (or "@hit=12.1@hit_end=12.4") are this sprite\'s own events in SOURCE seconds: they replace the clip\'s',
    '  shared events (ssg clip --event) for this sprite only; [] drops them. A "hit" given here replaces the automatic',
    '  one (its limb and window are still measured unless a "hit_end" is given). "autoEvents": false (or "@noauto")',
    '  turns the automatic events off for this sprite\'s clip.',
    '',
    'Several loadouts on one sprite (FB-074): a clip with its own held items, the rest of the sprite unchanged:',
    '  "with": ["POLYGON_War/SM_Wep_American_Rifle_01", "POLYGON_War/SM_Char_Attach_American_Helmet_01"],',
    '  "anim": ["idle", "walk", { "clip": "Knife_Stab_Fore", "trim": "0:0.9", "with": "POLYGON_Palm_City/SM_Wep_Knife_01" }],',
    '  "template": [{ "template": "shoulder_fire:kneel=1", "with": "POLYGON_BattleRoyale/SM_Wep_RPG_01", "as": "law" }]',
    '  Each such clip is <group>_<clip> (knife_Knife_Stab_Fore, law_shoulder_fire; group = "as", else the first item\'s',
    '  moveset, else its name). During it the sprite\'s other hand-held items are put away (worn ones such as the helmet',
    '  stay), and its items appear in no other clip. One sheet, one prefix.',
    '',
    'Animation keys: <animPrefix><clip>_<direction>. animPrefix defaults to "<sprite name>/" (phaser3); clip is the clip name,',
    'or with "class" <moveset>_<move> (merc_m/martial_arts_idle_E). "movePrefix": false (one moveset only) drops the',
    'moveset: merc_m/idle_E, clip "idle" in the meta.',
    '  trim is start:end in SOURCE seconds, like `ssg clip --trim` (either side may be empty). It replaces the shared',
    '  clip trim on the sides it sets (a side it leaves open keeps the shared one); the shared speed and events still',
    '  apply. maxSeconds caps that clip after the trim and wins over the sprite\'s maxSeconds.',
    '',
    'The dry run (--dry-run, with --json for everything) lists each sprite\'s action, what a render would do, and the',
    'resolved settings (view, dirs, mirror, fps, scale/ppm, frame, format, atlas, maxSeconds, with, clips, clip trims). A project',
    'that does not exist yet is reported as "wouldCreate": true.',
  ].join('\n');
}

/** Top-level keys of a game's asset file that are not about sprites (left alone). */
const IGNORED_TOP = new Set(['tilesets', 'maps', '$schema', 'comment', 'description', 'generatedBy']);

const words = (v: unknown, split = true): string[] | undefined => {
  if (v === undefined || v === null) return undefined;
  const all = Array.isArray(v) ? v.map(String) : [String(v)];
  return (split ? all.flatMap((x) => x.split(',')) : all).map((x) => x.trim()).filter(Boolean);
};

/** Keys in their canonical spelling; unknown keys are an error naming the known ones (typos must not pass silently). */
function canonical(raw: Record<string, unknown>, where: string, allowed = KEYS): SpriteDecl {
  const out: Record<string, unknown> = {};
  for (const [k0, v] of Object.entries(raw)) {
    const k = ALIASES[k0] ?? k0;
    if (!allowed.has(k)) throw new SpecError(`${where}: unknown key "${k0}". Keys: ${[...allowed].join(', ')}.`);
    if (v !== undefined) out[k] = v;
  }
  return out as SpriteDecl;
}

/** An `anim` value → `--anim` strings: plain names (comma lists split) and objects as "Clip@start:end@max=N". */
export function animInput(v: unknown, where: string): string[] | undefined {
  return animEntries(v, where).plain;
}

/** An `anim` value split into plain `--anim` strings and clips with their own items (FB-074). */
function animEntries(v: unknown, where: string): { plain?: string[]; clipWith: ClipWithInput[] } {
  if (v === undefined || v === null) return { clipWith: [] };
  const list = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  const clipWith: ClipWithInput[] = [];
  list.forEach((x, i) => {
    const at = Array.isArray(v) ? `${where}: anim[${i}]` : `${where}: anim`;
    if (typeof x === 'string' || typeof x === 'number') {
      out.push(...String(x).split(',').map((w) => w.trim()).filter(Boolean));
      return;
    }
    if (!x || typeof x !== 'object') throw new SpecError(`${at} must be a clip name or { "clip": …, "trim": "0.8:2.6", "maxSeconds": 2, "events": […], "label": …, "with": … }.`);
    const d: Partial<AnimDecl> & { template?: unknown } = {};
    for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
      const key = ANIM_KEYS[k];
      if (!key) throw new SpecError(`${at}: unknown key "${k}". Keys: clip, trim, maxSeconds, reverse, lockYaw, events, autoEvents, label, still, with, as, release (or template, with, as, release).`);
      (d as Record<string, unknown>)[key] = val;
    }
    if (d.template !== undefined) {
      if (d.clip !== undefined || d.trim !== undefined || d.maxSeconds !== undefined || d.reverse !== undefined || d.lockYaw !== undefined || d.events !== undefined || d.autoEvents !== undefined || d.label !== undefined || d.still !== undefined) throw new SpecError(`${at}: a template entry takes template, with, as and release only.`);
      clipWith.push(templateWith({ template: d.template, with: d.with, as: d.as, release: d.release }, at));
      return;
    }
    if (typeof d.clip !== 'string' || !d.clip.trim()) throw new SpecError(`${at}: say which clip or move ("clip": "MartialArts_Crouch_Punch").`);
    if (d.clip.includes('@') || d.clip.includes(',') || d.clip.includes('=')) throw new SpecError(`${at}: "clip" is one name; give the trim as "trim" and another export name as "label".`);
    let w: ClipWindow = {};
    try {
      const t = d.trim;
      if (typeof t === 'string') w = parseTrim(t, `${d.clip} trim`);
      else if (Array.isArray(t)) w = { start: t[0] ?? null, end: t[1] ?? null };
      else if (t && typeof t === 'object') w = { start: t.start ?? null, end: t.end ?? null };
      else if (t !== undefined) throw new Error(`"${d.clip}": trim must be "start:end" (source seconds), [start, end] or { start, end }`);
      if (d.maxSeconds !== undefined) w.maxSeconds = d.maxSeconds as number;
      if (d.reverse !== undefined) {
        if (typeof d.reverse !== 'boolean') throw new Error(`"${d.clip}": reverse is true or false, got ${JSON.stringify(d.reverse)}`);
        if (d.reverse) w.reverse = true;
      }
      if (d.lockYaw !== undefined) {
        if (typeof d.lockYaw !== 'boolean') throw new Error(`"${d.clip}": lockYaw is true or false, got ${JSON.stringify(d.lockYaw)}`);
        w.lockYaw = d.lockYaw;
      }
      if (d.events !== undefined) w.events = d.events as ClipWindow['events'];
      if (d.still !== undefined) {
        if (typeof d.still !== 'number') throw new Error(`"${d.clip}": still is the pose's time in source seconds (a number), got ${JSON.stringify(d.still)}`);
        w.still = d.still;
      }
      if (d.autoEvents !== undefined) {
        if (typeof d.autoEvents !== 'boolean') throw new Error(`"${d.clip}": autoEvents is true or false, got ${JSON.stringify(d.autoEvents)}`);
        if (!d.autoEvents) w.autoEvents = false;
      }
      if (d.label !== undefined && (typeof d.label !== 'string' || !ANIM_LABEL_RE.test(d.label))) throw new Error(`"${d.clip}": label is a name of letters, digits, _ and -, from a letter (got ${JSON.stringify(d.label)})`);
      const ref = animRefString(d.clip.trim(), cleanClipWindow(w, d.clip), d.label);
      if (d.with === undefined && d.as === undefined && d.release === undefined) out.push(ref);
      else clipWith.push({ anim: ref, with: withList(d.with, at), ...asOf(d.as, at), ...releaseOf(d.release, at) });
    } catch (e) {
      if (e instanceof SpecError) throw e;
      throw new SpecError(`${at}: ${(e as Error).message}`);
    }
  });
  return { ...(out.length ? { plain: out } : {}), clipWith };
}

/** A per-clip `with` value: one item or a list (no comma splitting: Pack/Model names stay whole). */
function withList(v: unknown, at: string): string[] {
  const list = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  if (!list.length) throw new SpecError(`${at}: "with" names the items this clip holds ("with": "POLYGON_Palm_City/SM_Wep_Knife_01").`);
  return list;
}
const asOf = (v: unknown, at: string) => {
  if (v === undefined) return {};
  if (typeof v !== 'string' || !/^[a-z][a-z0-9_]*$/i.test(v)) throw new SpecError(`${at}: "as" is a group name of letters, digits and _ (got ${JSON.stringify(v)}).`);
  return { as: v };
};
const releaseOf = (v: unknown, at: string) => {
  if (v === undefined) return {};
  if (!RELEASE_MODES.includes(v as ReleaseMode)) throw new SpecError(`${at}: "release" is ${RELEASE_MODES.join(', ')} (what the held item does at the clip's release event; got ${JSON.stringify(v)}).`);
  return { release: v as ReleaseMode };
};
function templateWith(d: { template?: unknown; with?: unknown; as?: unknown; release?: unknown }, at: string): ClipWithInput {
  if (typeof d.template !== 'string' || !d.template.trim()) throw new SpecError(`${at}: "template" is a template spec ("shoulder_fire:kneel=1").`);
  return { template: d.template.trim(), with: withList(d.with, at), ...asOf(d.as, at), ...releaseOf(d.release, at) };
}

/** A `template` value split into template specs and template clips with their own items (FB-074). */
function templateEntries(v: unknown, where: string): { plain?: string[]; clipWith: ClipWithInput[] } {
  if (v === undefined || v === null) return { clipWith: [] };
  const list = Array.isArray(v) ? v : [v];
  const plain: string[] = [];
  const clipWith: ClipWithInput[] = [];
  list.forEach((x, i) => {
    const at = Array.isArray(v) ? `${where}: template[${i}]` : `${where}: template`;
    if (typeof x === 'string' || typeof x === 'number') {
      if (String(x).trim()) plain.push(String(x).trim());
      return;
    }
    if (!x || typeof x !== 'object') throw new SpecError(`${at} must be a template spec or { "template", "with", "as" }.`);
    const o = x as Record<string, unknown>;
    const bad = Object.keys(o).filter((k) => !['template', 'id', 'with', 'as', 'release'].includes(k));
    if (bad.length) throw new SpecError(`${at}: unknown key "${bad[0]}". Keys: template, with, as, release.`);
    clipWith.push(templateWith({ template: o.template ?? o.id, with: o.with, as: o.as, release: o.release }, at));
  });
  return { ...(plain.length ? { plain } : {}), clipWith };
}

/** A true/false key (also "true"/"false" text). */
function boolInput(v: unknown, key: string, where: string): boolean {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  throw new SpecError(`${where}: ${key} must be true or false (got ${JSON.stringify(v)}).`);
}

/** An entry's `light`: checked now (a typo fails before anything is written), kept canonical; "day" is kept as such. */
function lightInput(v: unknown, where: string): string | SpriteLight {
  try {
    return parseLight(v, `${where}: light`) ?? 'day';
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
}

/** An entry's `pivot`: "anchor" or "origin". */
function pivotInput(v: unknown, where: string): 'anchor' | 'origin' {
  if (v === 'anchor' || v === 'origin') return v;
  throw new SpecError(`${where}: pivot must be "anchor" (each direction's object anchor, the default) or "origin" (the model origin) (got ${JSON.stringify(v)}).`);
}

/** An entry's `turret` (FB-096), checked now: true, a direction count or { dirs }; false/null = no split. */
function turretInput(v: unknown, where: string): ExportInput['turret'] {
  try {
    const t = parseTurret(v, where);
    return t ? (t.dirs ? { dirs: t.dirs } : true) : false;
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
}

/** An entry's `split` (FB-124), checked now: "waist" or { at, legs, torso, whole }; false/null = one sheet. */
function splitInput(v: unknown, where: string): ExportInput['split'] {
  try {
    const t = parseSplit(v, where);
    return t ? (t.legs || t.torso || t.whole ? { at: 'waist', ...(t.legs ? { legs: t.legs } : {}), ...(t.torso ? { torso: t.torso } : {}), ...(t.whole ? { whole: true } : {}) } : 'waist') : false;
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
}

/** An entry's `still` (SF-FB-025): "Clip@2.4" or a list, each checked now and kept as "Clip@still=2.4". */
function stillInput(v: unknown, where: string): string[] {
  const list = (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof x === 'string' ? x.split(',') : [x]));
  return list.map((x) => {
    if (typeof x !== 'string' || !x.trim()) throw new SpecError(`${where}: still is "Clip@seconds" (e.g. "Victory_Pose@2.4") or a list of them, got ${JSON.stringify(x)}.`);
    try {
      const ref = stillRef(x);
      parseAnimRef(ref);
      return ref;
    } catch (e) {
      throw new SpecError(`${where}: ${(e as Error).message}`);
    }
  });
}

/** An entry's `portrait` (SF-FB-021), checked now; false/null = none. */
function portraitInput(v: unknown, where: string): ExportInput['portrait'] {
  try {
    return parsePortrait(v, where) ?? false;
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
}

/** An entry's `layered` as an export input: true/"mask" → mask, "none" → none, false → not layered. */
function layeredInput(v: unknown, where: string): ExportInput['layered'] {
  if (v === true || v === 'mask' || v === 'true') return 'mask';
  if (v === 'none') return 'none';
  if (v === false || v === 'false') return false;
  throw new SpecError(`${where}: layered must be true, false, "mask" or "none" (got ${JSON.stringify(v)}).`);
}

/** What one declared sprite asks for: its name (null = from the model), model, kind, cards and export inputs. */
export interface SpriteEntry {
  name: string | null;
  asset: string | number;
  kind?: Kind;
  look?: string;
  size?: string;
  tags?: string[];
  input: ExportInput;
  /** What the declaration had to drop or reinterpret (FB-070: a key that is ignored), passed on as warnings. */
  notes?: string[];
}

/** `tile` values that leave the tile lock (FB-070): null, false, "none", "off", "free". */
const tileOff = (v: unknown) => v === null || v === false || (typeof v === 'string' && /^\s*(none|off|free|false|null)\s*$/i.test(v));

/** A declaration (with the file's defaults under it) → export inputs. */
export function entryOf(decl: SpriteDecl, defaults: Omit<SpriteDecl, 'name' | 'asset'> = {}, where = 'sprite'): SpriteEntry {
  const defs = canonical(defaults as Record<string, unknown>, `${where} (defaults)`);
  const mine = canonical(decl as Record<string, unknown>, where);
  const d: SpriteDecl = { ...defs, ...mine };
  const notes: string[] = [];
  // SF-FB-024: a number is the model's own size factor, not a scale mode.
  let modelScale: number | null | undefined;
  if (d.scale !== undefined && d.scale !== 'fit') {
    try {
      modelScale = parseModelScale(d.scale, `${where}: scale`);
    } catch {
      throw new SpecError(`${where}: scale must be "fit" or the model's size factor (1.3 = 30% bigger, "130%"), got ${JSON.stringify(d.scale)}; for a fixed scale give ppm or tile.`);
    }
    delete d.scale;
    if (mine.scale !== 'fit') delete mine.scale;
  }
  // FB-070: the scale. A sprite's own ppm or scale "fit" wins over the file's tile lock; tile null/false leaves it.
  const leaves = (mine.tile !== undefined && tileOff(mine.tile)) || mine.scale === 'fit' || (mine.ppm !== undefined && mine.tile === undefined);
  if (leaves && defs.tile !== undefined && mine.tile === undefined) delete d.tile;
  if (mine.scale === 'fit' && mine.ppm === undefined) delete d.ppm;
  if (d.tile !== undefined && tileOff(d.tile)) {
    delete d.tile;
    if (d.ppm === undefined) d.scale = 'fit';
  }
  if (d.tile === undefined && d.metresPerTile !== undefined && leaves) {
    if (mine.metresPerTile !== undefined) notes.push(`${where}: metresPerTile ${mine.metresPerTile} is ignored: the sprite leaves the tile lock.`);
    delete d.metresPerTile;
  }
  if (d.asset === undefined || d.asset === '') throw new SpecError(`${where}: say which model ("asset": "Pack/Model").`);
  if (d.kind !== undefined && !KINDS.includes(d.kind)) throw new SpecError(`${where}: kind must be one of ${KINDS.join(', ')}.`);
  // `template: "still"` next to states says what the states already are (each state is a still): accepted and dropped.
  if (d.states !== undefined && d.template !== undefined && (templateEntries(d.template, where).plain ?? []).every((t) => t === 'still') && !templateEntries(d.template, where).clipWith.length) delete d.template;
  // Any other template next to states is the base state's loop (FB-056): "template": "drive" with "states": "auto,…".
  if (d.states !== undefined && (d.anim !== undefined || d.set !== undefined || d.class !== undefined)) {
    throw new SpecError(`${where}: states are the sprite's moves; leave out anim, set and class (or drop states). A state can loop: "template": "drive" (the intact state's loop) or { "intact": { "template": "drive" } }.`);
  }
  const num = (k: keyof SpriteDecl) => {
    const v = d[k];
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new SpecError(`${where}: ${k} must be a number (got ${JSON.stringify(v)}).`);
    return n;
  };
  // Movesets in their fixed order, so the clips come out the same however they are listed.
  const classes = words(d.class);
  const ordered = classes ? WEAPON_CLASSES.map((c) => c.id).filter((id) => classes.includes(id)) : undefined;
  const bad = classes?.filter((c) => !WEAPON_CLASSES.some((w) => w.id === c));
  if (bad?.length) throw new SpecError(`${where}: unknown moveset ${bad.join(', ')} (movesets: ${WEAPON_CLASSES.map((c) => c.id).join(', ')}).`);
  const overrides: ViewOverrides = {
    ...(d.dirs !== undefined ? dirsOverride(d.dirs) : {}),
    ...(d.facings !== undefined ? { facings: num('facings') as ViewOverrides['facings'] } : {}),
    ...(d.slice !== undefined ? { slice: d.slice } : {}),
    ...(d.collision !== undefined ? { collision: checkCollision(d.collision) } : {}),
    ...(d.collisionHeight !== undefined ? { collisionHeight: num('collisionHeight') } : {}),
    ...(d.pitch !== undefined ? { pitch: num('pitch') } : {}),
    ...(d.projection !== undefined ? { projection: d.projection } : {}),
    ...(d.frame !== undefined ? { frameSize: num('frame') } : {}),
    ...(d.ppm !== undefined ? { ppm: num('ppm') } : {}),
    ...(d.tile !== undefined ? { tile: String(d.tile) } : {}),
    ...(d.metresPerTile !== undefined ? { metresPerTile: num('metresPerTile') } : {}),
    ...(d.scale === 'fit' ? { scale: 'fit' as const } : {}),
    ...(d.fps !== undefined ? { fps: num('fps') } : {}),
    ...(d.mirror !== undefined ? { mirror: !!d.mirror } : {}),
    ...(d.supersample !== undefined ? { supersample: num('supersample') as ViewOverrides['supersample'] } : {}),
    ...(d.pixelArt !== undefined ? { pixelArt: !!d.pixelArt } : {}),
    ...(d.outline !== undefined ? { outline: !!d.outline } : {}),
    ...(d.palette !== undefined ? { palette: d.palette } : {}),
    ...(d.shadow !== undefined ? { shadow: d.shadow === false ? 'off' : d.shadow } : {}),
  };
  const anims = animEntries(d.anim, where);
  const temps = templateEntries(d.template, where);
  // FB-086: "set": "none" says the declared moves are all the sprite has (no kind's default set). Moves declared in
  // any form (anim, template, class, states, a clip with its own items) already mean that; without any it is an error.
  const noSet = typeof d.set === 'string' && /^\s*none\s*$/i.test(d.set);
  if (noSet && !anims.plain && !temps.plain && !anims.clipWith.length && !temps.clipWith.length && !words(d.class)?.length && d.states === undefined) {
    throw new SpecError(`${where}: "set": "none" leaves the sprite without moves: give anim or template (or leave set out for the kind's own set).`);
  }
  const input: ExportInput = {
    assets: [d.asset],
    ...(ordered?.length ? { classes: ordered } : {}),
    ...(anims.plain ? { animations: anims.plain } : {}),
    ...(temps.plain ? { templates: temps.plain } : {}),
    ...(anims.clipWith.length || temps.clipWith.length ? { clipWith: [...anims.clipWith, ...temps.clipWith] } : {}),
    ...(d.set !== undefined && !noSet ? { set: String(d.set) } : {}),
    ...(words(d.with) ? { with: words(d.with) } : {}),
    ...(d.states !== undefined ? { states: d.states } : {}),
    ...(d.view !== undefined ? { view: String(d.view) } : {}),
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(d.format !== undefined ? { format: String(d.format) } : {}),
    ...(d.layers !== undefined ? { layers: words(d.layers) as ExtraLayer[] } : {}),
    ...(d.uniform !== undefined ? { uniformFrame: !!d.uniform } : {}),
    ...(d.atlas !== undefined ? { atlas: !!d.atlas } : {}),
    ...(d.animPrefix !== undefined ? { animPrefix: String(d.animPrefix) } : {}),
    ...(d.movePrefix !== undefined ? { movePrefix: boolInput(d.movePrefix, 'movePrefix', where) } : {}),
    ...(d.maxSeconds !== undefined ? { maxSeconds: num('maxSeconds') } : {}),
    ...(d.gender !== undefined ? { gender: d.gender } : {}),
    ...(d.layered !== undefined ? { layered: layeredInput(d.layered, where) } : {}),
    ...(d.fx !== undefined ? { fx: d.fx } : {}),
    ...(d.light !== undefined ? { light: lightInput(d.light, where) } : {}),
    ...(d.pivot !== undefined ? { pivot: pivotInput(d.pivot, where) } : {}),
    ...(d.turret !== undefined ? { turret: turretInput(d.turret, where) } : {}),
    ...(d.portrait !== undefined ? { portrait: portraitInput(d.portrait, where) } : {}),
    ...(d.split !== undefined ? { split: splitInput(d.split, where) } : {}),
    ...(modelScale ? { modelScale } : {}),
    ...(d.still !== undefined ? { stills: stillInput(d.still, where) } : {}),
  };
  return { name: d.name?.trim() || null, asset: d.asset, kind: d.kind, look: d.look, size: d.size, tags: d.tags, input, ...(notes.length ? { notes } : {}) };
}

/** A whole apply file → its project ref and entries (names checked unique). */
export function parseApplyFile(file: unknown): { project?: string | number; defaults: Omit<SpriteDecl, 'name' | 'asset'>; entries: SpriteEntry[] } {
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new SpecError('The apply file must be a JSON object with "project" and "sprites".');
  const { project, sprites, defaults: nested, ...top } = file as Record<string, unknown>;
  if (!Array.isArray(sprites)) throw new SpecError('The apply file needs "sprites": [ { "name": …, "asset": "Pack/Model", … } ].');
  const topDefaults: Record<string, unknown> = {};
  const topKeys = new Set([...KEYS].filter((k) => k !== 'name' && k !== 'asset'));
  for (const [k, v] of Object.entries(top)) if (!IGNORED_TOP.has(k)) topDefaults[k] = v;
  const defaults = { ...canonical(topDefaults, 'top level', topKeys), ...canonical((nested ?? {}) as Record<string, unknown>, 'defaults', topKeys) };
  const entries = sprites.map((s, i) => {
    if (!s || typeof s !== 'object') throw new SpecError(`sprites[${i}] must be an object.`);
    return entryOf(s as SpriteDecl, defaults, `sprites[${i}]${(s as SpriteDecl).name ? ` (${(s as SpriteDecl).name})` : ''}`);
  });
  const seen = new Map<string, number>();
  entries.forEach((e, i) => {
    if (!e.name) throw new SpecError(`sprites[${i}]: give it a "name" (that is what the next run matches).`);
    const k = e.name.toLowerCase();
    if (seen.has(k)) throw new SpecError(`Two sprites are named "${e.name}" (sprites[${seen.get(k)}] and sprites[${i}]).`);
    seen.set(k, i);
  });
  if (project !== undefined && typeof project !== 'string' && typeof project !== 'number') throw new SpecError('"project" must be a project name or id.');
  return { project: project as string | number | undefined, defaults, entries };
}

// ---- export inputs → a sprite spec ----

const has = (o: ViewOverrides, ...keys: (keyof ViewOverrides)[]) => keys.some((k) => o[k] !== undefined);

/**
 * The sprite spec that renders what the export inputs ask for. `mode: 'project'` (apply): the setting groups the
 * entry names become the sprite's own and the rest come from the project (as when a sprite is made on the Create
 * page). `mode: 'export'` (`ssg export --project`): every group is the sprite's own, with export's defaults (iso8,
 * generic), so the sprite renders exactly what the export would. `keep` (the sprite being updated) keeps its outfits.
 */
export async function spriteSpecFor(
  sources: SpecSources,
  project: { defaults: ProjectDefaults },
  entry: SpriteEntry,
  opts: { mode?: 'project' | 'export'; keep?: SpriteSpec; warn?: (message: string) => void } = {},
): Promise<{ spec: SpriteSpec; asset: Asset; kind: Kind; own: InheritGroup[] }> {
  const mode = opts.mode ?? 'project';
  const input = entry.input;
  if (input.alignTo || input.partsOnly || input.inlineSet) throw new SpecError('Adding to an earlier export (align-to) is not kept as a sprite: render the sprite again instead (its next version adds only what changed).');
  if (input.preset) throw new SpecError('Job presets are not kept on sprites: give the options themselves.');
  if (input.assets.length !== 1) throw new SpecError('One model per sprite.');
  const src: SpecSources = { ...sources, ...(opts.warn ? { warn: opts.warn } : {}) };
  entry.notes?.forEach((m) => src.warn?.(m));
  const model = await resolveAsset(src, input.assets[0]);
  const kind = entry.kind ?? wizKindOf(model.kind, model.name);
  // Nothing to do named: a declared sprite gets its kind's moves, as on the Create page (export insists on moves).
  // FB-086: clips with their own items (template/anim objects with `with`) are moves too: no default set under them.
  const noMoves = !input.animations?.length && !input.templates?.length && !input.clipWith?.length && !input.stills?.length && !input.set && !input.classes?.length && input.states === undefined;
  const ov = input.overrides ?? {};
  // The export's own checks and lookups (models, clips, templates, format, states, held items). In project mode the
  // view comes from the project's (applyOverrides below warns about what loses there), so buildSpec gets overrides
  // without the settings that would be ignored and does not warn about them against its iso8 base.
  const quiet: ViewOverrides = { ...ov };
  if (mode === 'project') {
    if (quiet.tile) delete quiet.ppm;
    if (!quiet.tile) delete quiet.metresPerTile;
  }
  const { spec: bs } = await buildSpec(src, { ...input, assets: [model.id], ...(input.overrides ? { overrides: quiet } : {}), ...(noMoves && mode === 'project' ? { set: defaultSetFor(kind) } : {}) });
  const asset = model;
  let s: WizardState = stateOf({ ...specOf(initialState()), ...project.defaults, version: 1 });
  s = { ...s, kind, assetIds: [asset.id], setId: defaultSetFor(kind) };

  const own = new Set<InheritGroup>();
  if (mode === 'export') INHERIT_GROUPS.forEach((g) => own.add(g));
  else {
    if (input.view || has(ov, 'directions', 'facings', 'slice', 'pitch', 'projection', 'mirror')) own.add('view');
    if (entry.look || has(ov, 'pixelArt', 'outline', 'palette', 'shadow', 'supersample')) own.add('look');
    if (entry.size || has(ov, 'frameSize', 'frameWidth', 'frameHeight', 'ppm', 'tile', 'metresPerTile', 'scale')) own.add('size');
    // Layering is not a reason to own the engine group: a declared sprite always keeps its own (layeredOwn below).
    if (input.format !== undefined || input.layers !== undefined || input.uniformFrame !== undefined) own.add('engine');
    if (input.gender !== undefined) own.add('gender');
  }

  // View, look and size.
  let viewDirs: string | undefined;
  try {
    if (mode === 'export') s = { ...s, view: structuredClone(bs.view) };
    else {
      if (input.view) s = applyViewCard(s, viewIdFor(input.view));
      if (entry.look) s = applyLook(s, lookIdFor(entry.look));
      if (entry.size) s = applySize(s, sizeIdFor(entry.size));
      viewDirs = s.view.directions;
      if (Object.keys(ov).length) s = { ...s, view: applyOverrides(s.view, ov, (m) => src.warn?.(m)) };
    }
  } catch (e) {
    if (e instanceof SpriteError) throw new SpecError(e.message);
    throw e;
  }
  // FB-062: `dirs: 1` on an object in a view with grid facings (iso) is one facing of that view (facings 1), not a
  // straight-on custom view with one direction.
  const oneFacing = mode === 'project' && (kind === 'object' || (kind === 'vehicle' && input.states !== undefined)) && String(ov.directions) === '1' && !ov.angles?.length && ov.facings === undefined && viewDirs !== undefined && viewGrid(s.view) === 'diamond';
  if (oneFacing) s = { ...s, view: { ...s.view, directions: viewDirs as ViewConfig['directions'], facings: 1 } };
  // Objects default to one grid-aligned facing in iso views; directions asked for (export's --dirs) win over that.
  else if (kind === 'object' && ov.directions && ov.facings === undefined) s = { ...s, view: { ...s.view, facings: 0 } };
  // A vehicle with states is an object in the world (a tank and its wreck): one grid-aligned facing in iso, as props.
  if (mode === 'project' && kind === 'vehicle' && input.states !== undefined && ov.directions === undefined && ov.facings === undefined) s = { ...s, view: objectView(s.view) };
  if (mode === 'export' || Object.keys(ov).length) {
    s = {
      ...s,
      viewCardId: own.has('view') ? viewCardFor(s.view) : s.viewCardId,
      // A look or size card named without finer settings stays that card.
      lookId: own.has('look') ? (entry.look && !has(ov, 'pixelArt', 'outline', 'palette', 'shadow', 'supersample') ? s.lookId : lookFor(s.view)) : s.lookId,
      sizeId: own.has('size') ? (entry.size && !has(ov, 'frameSize', 'frameWidth', 'frameHeight', 'ppm', 'tile', 'metresPerTile', 'scale') ? s.sizeId : sizeFor(s.view, kind)) : s.sizeId,
    };
  }

  // Moves: states, movesets (with the picked moves), clips/templates, a set, or the kind's own set.
  const userSets: AnimationSet[] = await src.sets();
  if (input.states !== undefined) s = { ...s, states: await resolveStates(src, asset, input.states, { baseLoop: statesBaseLoop(input.templates) }) };
  else if (input.classes?.length) {
    s = reducer(s, { type: 'classes', ids: input.classes });
    if (input.movePrefix === false) s = { ...s, movePrefix: false };
    // The picked moves as the movesets minus the rest; a move picked with its own parameters replaces the stock one.
    const full = effectiveSet(s, userSets).items;
    const picked = bs.set.items;
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
    s = {
      ...s,
      excluded: full.filter((it) => !picked.some((p) => same(p, it))).map(setItemLabel),
      extraItems: picked.filter((p) => !full.some((f) => same(f, p))),
    };
  } else if (input.animations?.length || input.templates?.length || input.clipWith?.length || input.stills?.length) s = { ...s, baseSet: structuredClone(bs.set) };
  else if (input.set) s = reducer(s, { type: 'set', id: bs.set.id });

  // Held items, format, and the per-sprite extras.
  s = reducer(s, { type: 'loadout', items: bs.loadout ?? [] });
  if (mode === 'export' || input.format !== undefined) s = { ...s, profileId: bs.profile.id };
  if (mode === 'export' || input.layers !== undefined) s = { ...s, layers: [...bs.layers] };
  if (mode === 'export' || input.uniformFrame !== undefined) s = { ...s, uniformFrame: bs.uniformFrame };
  // Equipment as export does it: baked into the body's sheet unless the entry says layered (true/mask, or none).
  // Stored as the sprite's own so the project's setting (layered, for sprites made in the app) does not apply.
  s = { ...s, layered: bs.layered ? (bs.layered.occlusion === 'none' ? 'none' : true) : false, layeredOwn: true };
  if (mode === 'export' || input.gender !== undefined) s = { ...s, gender: bs.gender };
  s = { ...s, fx: bs.fx ?? null };
  // Lighting is stored only when it is not day, so sprites that never mention light keep their specs (and stay up to date).
  if (bs.light) s = { ...s, light: bs.light };
  if (input.maxSeconds) s = { ...s, maxSeconds: input.maxSeconds };
  if (input.animPrefix !== undefined) s = { ...s, animPrefix: input.animPrefix };
  // `ssg export --project` renders what the export would: phaser keys keep the export's "{base}/" prefix. Declared
  // sprites (apply) leave it unset, so their keys default to the sprite's name (spriteAnimPrefix).
  else if (mode === 'export' && bs.profile.animationName.startsWith(PHASER_ANIM_PREFIX)) s = { ...s, animPrefix: PHASER_ANIM_PREFIX };
  if (input.atlas) s = { ...s, atlas: true };
  if (input.pivot) s = { ...s, pivot: input.pivot };
  if (bs.turret) s = { ...s, turret: bs.turret };
  if (bs.portrait) s = { ...s, portrait: bs.portrait };
  if (bs.split) s = { ...s, split: bs.split };
  if (bs.modelScale) s = { ...s, modelScale: bs.modelScale };

  // What the person did in the app that the entry does not speak about: outfits over the same items.
  if (opts.keep?.outfits?.length) {
    const keys = new Set(s.loadout.map(itemKey));
    s = { ...s, outfits: opts.keep.outfits.map((o) => ({ ...o, items: o.items.filter((k) => keys.has(k)) })), ...(opts.keep.activeOutfit ? { activeOutfit: opts.keep.activeOutfit } : {}) };
  }
  const groups = INHERIT_GROUPS.filter((g) => own.has(g));
  const spec: SpriteSpec = { ...specOf(s), inherit: INHERIT_GROUPS.filter((g) => !own.has(g)), version: 1 };
  return { spec: JSON.parse(JSON.stringify(spec)) as SpriteSpec, asset, kind, own: groups };
}

/**
 * The settings an entry leaves to their defaults, by the names plan reasons use (FB-055): a removed `fps` reads
 * "fps changed (12 → default 10)".
 */
export function defaultedSettings(entry: SpriteEntry): string[] {
  const ov = entry.input.overrides ?? {};
  const view = entry.input.view !== undefined;
  const size = entry.size !== undefined || has(ov, 'frameSize', 'frameWidth', 'frameHeight', 'ppm', 'tile', 'metresPerTile', 'scale');
  const look = entry.look !== undefined || has(ov, 'pixelArt');
  const pairs: [string, boolean][] = [
    ['fps', has(ov, 'fps')], ['dirs', view || has(ov, 'directions')], ['pitch', view || has(ov, 'pitch')], ['projection', view || has(ov, 'projection')],
    ['mirror', view || has(ov, 'mirror')], ['facings', has(ov, 'facings', 'directions')], ['slice', has(ov, 'slice')],
    ['frame size', size || look], ['scale', size], ['padding', size],
    ['supersample', look || has(ov, 'supersample')], ['outline', look || has(ov, 'outline')], ['palette', look || has(ov, 'palette')], ['shadow', look || has(ov, 'shadow')],
  ];
  return pairs.filter(([, declared]) => !declared).map(([k]) => k);
}

/** Specs compared as data: key order, unset keys and the server's placement-fix stamps don't count. */
export function sameSpec(a: SpriteSpec, b: SpriteSpec): boolean {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k, v]) => v !== undefined && k !== 'fixRev').sort(([p], [q]) => p.localeCompare(q)).map(([k, v]) => [k, norm(v)]));
    }
    return x;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * A warning when the sprite would render its equipment as separate layers although the entry did not ask for
 * layers (`ssg export` bakes `with` items into one sheet unless --layered): a game loading `<base>.json` would
 * draw the body without them. Declared sprites keep their own layering, so this only fires if that is lost.
 */
export function layeringWarning(entry: Pick<SpriteEntry, 'input'>, effective: Pick<SpriteSpec, 'layered' | 'loadout'>): string | null {
  if (entry.input.layered !== undefined) return null;
  const mode = layeringOf(effective);
  if (mode === 'baked') return null;
  const n = effective.loadout.length;
  return `renders its ${n} equipment item${n === 1 ? '' : 's'} as separate layers (${mode}) although the entry does not say "layered": `
    + `<base>.json holds the body only. Set "layered": false to bake them into one sheet, or "layered": true to keep the layers.`;
}

/**
 * The settings a sprite renders with (its own and the project's, merged), as the dry run shows them (SF-FB-004), so
 * a game can see that fps, ppm, mirror, atlas, maxSeconds… will apply before anything renders.
 */
export interface ResolvedSettings {
  view: string;
  dirs: string;
  facings: number | null;
  /** Objects with their own collision settings (FB-050): "full", "base", "auto", plus the slice height. */
  collision?: string;
  mirror: boolean;
  pitch: number;
  projection: string;
  fps: number;
  scale: string;
  ppm: number | null;
  tile: string | null;
  frame: string;
  look: string;
  supersample: number;
  pixelArt: boolean;
  outline: boolean;
  shadow: string;
  format: string;
  atlas: boolean;
  animPrefix: string | null;
  layers: string[];
  uniform: boolean;
  layered: 'baked' | 'mask' | 'none';
  maxSeconds: number | null;
  gender: string;
  pivot: string;
  /** Vehicles split into hull and turret sheets (FB-096): "turret", "turret 16 dirs". */
  turret?: string;
  /** Characters with a portrait (SF-FB-021): "portrait 256×256 3/4 transparent". */
  portrait?: string;
  /** Characters split at the waist (FB-124): "split waist". */
  split?: string;
  /** SF-FB-024: the model's own size factor when not 1. */
  modelScale?: number;
  /** Lighting (FB-060): "day", a preset, or a preset with overrides. */
  light: string;
  /**
   * Held items and attachments (SF-FB-012), as `with` writes them: "POLYGON_War/SM_Char_Attach_Hair_02",
   * "Pack/SM_Wep_Rifle_01@hand_r=rifle~rifle". Left out when the sprite holds nothing.
   */
  with?: string[];
  /** The moves the render holds, by export name. */
  clips: string[];
  /** Moves with their own trim/cap (SF-FB-001): source-seconds window and cap, by export name. */
  clipWindows?: Record<string, ClipWindow>;
}

/** A view card id; a customised view names the preset whose camera it keeps ("side2 (custom)"). */
function viewLabel(card: string, v: SpriteSpec['view']): string {
  if (card !== 'custom') return card;
  const base = VIEW_PRESETS.find((p) => p.config.pitch === v.pitch && p.config.projection === v.projection && p.config.directions === v.directions);
  return base ? `${base.id} (custom)` : 'custom';
}

/** A held item as a `with` string (SF-FB-012): its name, then @bone, =layer, :front/:back, !event, ~class when set. */
export function withText(it: LoadoutItem, itemName?: (assetId: number) => string | undefined): string {
  const depth = it.depth === 'front' || it.depth === 'back' ? it.depth : null;
  return `${itemName?.(it.asset) ?? `#${it.asset}`}${it.target ? `@${it.target}` : ''}${it.layer ? `=${it.layer}` : ''}${depth ? `:${depth}` : ''}${it.trigger ? `!${it.trigger}` : ''}${it.cls ? `~${it.cls}` : ''}`;
}

export function resolvedSettings(eff: SpriteSpec, sets: AnimationSet[], itemName?: (assetId: number) => string | undefined): ResolvedSettings {
  const v = eff.view;
  const q = v.quality ?? ({} as NonNullable<typeof v.quality>);
  const sc = v.scale;
  const clips = specClips(eff, sets);
  const windows: Record<string, ClipWindow> = {};
  effectiveSet(stateOf(eff), sets).items.forEach((it, i) => {
    if (it.window) windows[clips[i]] = it.window;
  });
  return {
    view: viewLabel(eff.viewCardId ?? viewCardFor(v), v), dirs: dirsText(v), facings: v.facings ? v.facings : null,
    ...(v.collision || v.collisionHeight !== undefined ? { collision: `${v.collision ?? 'auto'}${v.collisionHeight !== undefined ? ` @${v.collisionHeight} m` : ''}` } : {}), mirror: !!v.mirror, pitch: v.pitch, projection: v.projection, fps: v.fps,
    scale: sc.mode, ppm: sc.mode === 'ppm' ? sc.ppm : null, tile: sc.mode === 'tile' ? `${sc.tilePx}x${sc.shape === 'diamond' ? sc.tilePx / 2 : sc.tilePx} (${sc.metresPerTile} m/tile)` : null,
    frame: `${v.frameWidth}x${v.frameHeight}${sc.mode === 'fit' ? '' : ' (min)'}`,
    look: eff.lookId, supersample: q.supersample ?? 1, pixelArt: q.style === 'pixel', outline: !!q.outline, shadow: q.shadow ?? 'off',
    format: eff.profileId, atlas: !!eff.atlas, animPrefix: eff.animPrefix ?? null, layers: [...eff.layers], uniform: !!eff.uniformFrame, layered: layeringOf(eff),
    maxSeconds: eff.maxSeconds ?? null, gender: eff.gender, pivot: eff.pivot ?? 'anchor', ...(eff.turret ? { turret: turretLabel(eff.turret)! } : {}), ...(eff.portrait ? { portrait: portraitLabel(eff.portrait)! } : {}), ...(eff.split ? { split: splitLabel(eff.split)! } : {}), ...(eff.modelScale && eff.modelScale !== 1 ? { modelScale: eff.modelScale } : {}), light: lightLabel(eff.light),
    ...(eff.loadout?.length ? { with: eff.loadout.map((it) => withText(it, itemName)) } : {}), clips,
    ...(Object.keys(windows).length ? { clipWindows: windows } : {}),
  };
}

// ---- the project ----

/** A new project's settings from the file's defaults: its view, tile lock and format, so the app shows the game's setup. */
export function projectDefaultsFrom(d: Omit<SpriteDecl, 'name' | 'asset'>): ProjectDefaults {
  let s = initialState();
  try {
    if (d.view) s = applyViewCard(s, viewIdFor(String(d.view)));
    if (d.look) s = applyLook(s, lookIdFor(d.look));
    if (d.size) s = applySize(s, sizeIdFor(d.size));
  } catch (e) {
    throw new SpecError((e as Error).message);
  }
  let defaults = projectDefaultsOf({ ...s, ...(d.format ? { profileId: String(d.format) } : {}) });
  if (d.tile) defaults = withTileScale(defaults, String(d.tile), d.metresPerTile !== undefined ? Number(d.metresPerTile) : undefined);
  if (d.fps) defaults = { ...defaults, view: { ...defaults.view, fps: Number(d.fps) } };
  return defaults;
}
