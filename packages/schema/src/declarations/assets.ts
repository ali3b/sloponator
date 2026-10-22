/**
 * `ssg.assets.json`: the sprites and tilesets a game needs, in the words of the old `ssg export` flags. Ported
 * from the old generator's packages/client/src/apply.ts (SpriteDecl, AnimDecl, TemplateDecl, ApplyFile) and
 * packages/shared/src/tileset/declare.ts (TilesetDecl, TerrainDecl), with the same keys and the same strict
 * rejection of unknown keys. Only the canonical spelling of each key is taken; the old generator's other spellings
 * are listed as aliases so an error can say which key was meant.
 */
import { z } from 'zod';
import { doc, opt } from '../meta.js';
import { assetRef, hexColor, light, nameList, projectRef, refList } from './common.js';

export const SPRITE_KINDS = ['character', 'vehicle', 'object', 'prop', 'weapon'] as const;
/** Movesets (weapon classes), in the fixed order their clips come out in. */
export const WEAPON_CLASSES = ['kneel_place', 'unarmed', 'sword', 'knife', 'bow', 'staff', 'launcher', 'rifle_carry', 'rifle', 'pistol', 'martial_arts'] as const;
/** The movesets worth naming (the others are internal helpers that are still accepted). */
export const MAIN_CLASSES = ['unarmed', 'sword', 'knife', 'bow', 'staff', 'launcher', 'rifle', 'pistol', 'martial_arts'] as const;
export const VIEW_PRESETS = ['side2', 'lowthreequarter', 'jrpg4', 'topdown8', 'high8', 'straightdown', 'iso8', 'iso4d', 'trueiso8', 'hexflat6', 'hexpointy6', 'vehicle16', 'rts32', 'rpgmaker', 'lpc'] as const;
export const DIRECTION_SETS = ['1', '2', '4', '4d', '6f', '6p', '8', '12', '16', '32'] as const;
export const LOOKS = ['clean', 'pixel', 'hand_painted', 'stylized'] as const;
export const SIZES = ['small', 'medium', 'large', 'xl'] as const;
export const BUILTIN_FORMATS = ['generic', 'godot4', 'unity', 'phaser3', 'pixi', 'aseprite', 'libgdx', 'gamemaker', 'rpgmaker', 'lpc'] as const;
export const EXTRA_LAYERS = ['normal', 'depth', 'uv', 'shadow'] as const;
export const COLLISION_MODES = ['auto', 'base', 'full', 'concave'] as const;
export const RELEASE_MODES = ['hide', 'drop', 'keep'] as const;
export const GENDERS = ['auto', 'Masculine', 'Feminine'] as const;
export const PALETTES = ['full', 'model', 'levels'] as const;
export const SHADOWS = ['off', 'low', 'high'] as const;
export const MODEL_SCALE_MIN = 0.05;
export const MODEL_SCALE_MAX = 20;

const ANIM_LABEL_RE = /^[A-Za-z_][\w-]*$/;
const COMPASS16 = ['e', 'ene', 'ne', 'nne', 'n', 'nnw', 'nw', 'wnw', 'w', 'wsw', 'sw', 'ssw', 's', 'sse', 'se', 'ese'];
const WORDS8 = ['right', 'up_right', 'up', 'up_left', 'left', 'down_left', 'down', 'down_right'];
const isDirectionName = (s: string) => {
  const n = s.trim().toLowerCase();
  return COMPASS16.includes(n) || WORDS8.includes(n.replace(/[- ]/g, '_')) || /^a\d{1,3}(\.\d+)?$/.test(n);
};
const TILE_OFF = /^\s*(none|off|free|false|null)\s*$/i;
const TILE_RE = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i;

// ---- clips and templates ----

const clipWindowFields = {
  trim: opt(
    z.union([z.string().regex(/^\s*[^:]*:[^:]*\s*$/, 'is start:end in source seconds, e.g. "0.8:2.6" (either side may be empty)'), z.tuple([z.number().min(0).nullable(), z.number().min(0).nullable()]), z.strictObject({ start: z.number().min(0).nullable().optional(), end: z.number().min(0).nullable().optional() })]),
    { help: 'This sprite\'s window of the clip in SOURCE seconds: "start:end" (either side may be empty), [start, end] or { start, end }. It replaces the shared clip trim on the sides it sets.', example: '0.8:2.6' },
  ).optional(),
  maxSeconds: opt(z.number().positive(), { help: 'Cap this clip at this many seconds (after the trim); wins over the sprite\'s maxSeconds.', example: 2 }).optional(),
  reverse: opt(z.boolean(), { help: 'Play the clip backwards (SF-FB-017): a clip picked by name is exported as <Clip>_reverse; a move is reversed in place.' }).optional(),
  lockYaw: opt(z.boolean(), { help: 'Lock the root\'s yaw (SF-FB-023): a punch that turns the body punches straight ahead in a side view; false plays the turn even when the shared clip edit locks it.' }).optional(),
  events: opt(z.array(z.strictObject({ t: z.number().min(0), name: z.string().min(1) })), { help: 'This sprite\'s own events for the clip, in SOURCE seconds (SF-FB-022). They replace the clip\'s shared events for this sprite; [] drops them.', example: [{ t: 1.2, name: 'hit' }] }).optional(),
  autoEvents: opt(z.boolean(), { help: 'false: no automatic events (footsteps, the key moment) in this sprite\'s clip.' }).optional(),
  label: opt(z.string().regex(ANIM_LABEL_RE, 'is a name of letters, digits, _ and -, starting with a letter'), { help: 'The name the clip is exported under (default: the clip\'s or move\'s name), so one clip can appear twice with different windows.', example: 'kicks_a' }).optional(),
  still: opt(z.number().min(0), { help: 'One frame only (SF-FB-025): the pose at this many source seconds, exported as <Clip>_still unless label names it.', example: 2.4 }).optional(),
};

const loadoutFields = {
  with: opt(refList, { help: 'This clip\'s own held items (FB-074), as the sprite\'s `with`: one sprite, several loadouts. Exported as <as>_<clip>; the sprite\'s other hand-held items are put away during it.', example: 'POLYGON_Palm_City/SM_Wep_Knife_01' }).optional(),
  as: opt(z.string().regex(/^[a-z][a-z0-9_]*$/i, 'is a group name of letters, digits and _'), { help: 'The loadout group the clip is exported under (default: the first item\'s moveset, else its name).', example: 'knife' }).optional(),
  release: opt(z.enum(RELEASE_MODES), { help: 'What happens to the held items at the clip\'s `release` event (FB-103): hide (default), drop (falls and stays) or keep.' }).optional(),
};

/** One clip or move with this sprite's own window, events, name and held items. */
export const animDecl = doc(
  z.strictObject({
    clip: opt(z.string().min(1).refine((s) => !/[@,=]/.test(s), 'is one clip or move name: give the trim as "trim" and another export name as "label"'), { help: 'The clip, or with `class` the move (idle, crouch_punch…).', example: 'MartialArts_Crouch_Punch' }),
    ...clipWindowFields,
    ...loadoutFields,
  }),
  {
    id: 'anim',
    title: 'Anim entry',
    summary: 'An `anim` entry as an object: one clip or move with this sprite\'s own trim, cap, events, export name and held items. The string form packs the same into the name: "Clip@0.8:2.6", "Clip@max=2", "Clip@reverse", "Clip@lockyaw", "Clip@hit=1.2@hit_end=1.4", "Clip@0:3=kicks_a", "Clip@still=2.4".',
    aliases: { name: 'clip', move: 'clip', anim: 'clip', 'max-seconds': 'maxSeconds', reversed: 'reverse', 'lock-yaw': 'lockYaw', 'auto-events': 'autoEvents', exportAs: 'label', 'export-as': 'label', at: 'still' },
  },
);
export type AnimDecl = z.infer<typeof animDecl>;

/** A template clip with its own held items (FB-074). */
export const templateDecl = doc(
  z.strictObject({
    template: opt(z.string().min(1), { help: 'A procedural move and its parameters: "still", "crawl", "shoulder_fire:kneel=1", "drive_turn:steer=25".', example: 'shoulder_fire:kneel=1' }),
    with: opt(refList, { help: 'The items held during this template (as the sprite\'s `with`).', example: 'POLYGON_BattleRoyale/SM_Wep_RPG_01' }),
    as: loadoutFields.as,
    release: loadoutFields.release,
  }),
  { id: 'template', title: 'Template entry', summary: 'A `template` entry as an object: a procedural move with its own held items, exported as <as>_<template>. The string form is just the template spec.', aliases: { id: 'template' } },
);
export type TemplateDecl = z.infer<typeof templateDecl>;

const animEntry = z.union([z.string().min(1), animDecl, templateDecl]);
const templateEntry = z.union([z.string().min(1), templateDecl]);

// ---- states, fx, portrait, turret, split ----

export const stateEntry = doc(
  z.strictObject({
    asset: opt(assetRef, { help: 'The model of this state (default: the sprite\'s).', example: 'POLYGON_War/SM_Veh_Tank_Destroyed_01' }).optional(),
    transition: opt(z.string().nullable(), { help: 'The transition template played into this state ("destroy", "blast=1"), or null for none.', example: 'destroy' }).optional(),
    from: opt(z.string(), { help: 'The state the transition starts from.' }).optional(),
    look: opt(z.string(), { help: 'A look for this state ("scorch:dark=0.9").' }).optional(),
    template: opt(z.union([z.string(), z.array(z.string())]).nullable(), { help: 'The state\'s looping template (objects have no skeletal clips).', example: 'drive' }).optional(),
    anim: opt(z.union([z.string(), z.array(z.string())]).nullable(), { help: 'Another name for template.' }).optional(),
    collision: opt(z.enum(['none', ...COLLISION_MODES]), { help: 'What the state collides with (FB-085): none (a blown gate), base, full, concave or auto.' }).optional(),
  }),
  { id: 'state', title: 'State', summary: 'One object state in the object form of `states`: `{ "intact": { "template": "drive" }, "destroyed": { "asset", "transition" } }`.' },
);

const states = z.union([z.string().min(1), z.record(z.string(), z.union([z.number().int().positive(), z.string(), stateEntry]))]);

export const fxObject = doc(
  z.strictObject({
    enabled: opt(z.boolean(), { help: 'Whether the FX look is on.' }),
    tint: opt(hexColor, { help: 'The glow colour.', example: '#ff7a20' }).optional(),
    intensity: opt(z.number().min(0), { help: 'How strong the glow is (1 = as authored).', example: 1.2 }).optional(),
    blend: opt(z.enum(['add', 'normal']), { help: 'How the sprite blends over the scene: add (light, fire) or normal.' }).optional(),
  }),
  { id: 'fx', title: 'FX', summary: 'The glowing FX look as an object (`"fx": true` is the default glow).' },
);

const pixels = z.number().int().min(16).max(4096);
export const portraitObject = doc(
  z.strictObject({
    size: opt(pixels, { help: 'Square output size in pixels (default 256).', example: 256 }).optional(),
    width: opt(pixels, { help: 'Width in pixels, with height for a non-square portrait.' }).optional(),
    height: opt(pixels, { help: 'Height in pixels.' }).optional(),
    angle: opt(z.union([z.number().min(-180).max(180), z.string()]), { help: 'How far the character is turned from the camera: degrees (-180..180), or front, 3/4 (default, facing right), 3/4 left, side, side left.', example: '3/4' }).optional(),
    pitch: opt(z.union([z.number().min(0).max(60), z.string()]), { help: 'Camera pitch looking down at the face, 0–60 degrees (default 0).' }).optional(),
    background: opt(z.string().nullable(), { help: 'A hex colour (#203040), or null / "transparent" (default).', example: '#203040' }).optional(),
    clip: opt(z.string().min(1), { help: 'The clip whose first frame poses the bust (default: the first idle, else the first clip).' }).optional(),
  }),
  { id: 'portrait', title: 'Portrait', summary: 'The object form of `portrait` (SF-FB-021): a head-and-shoulders still <base>_portrait.png (+ .json). The string form is "320x400,front,#203040".', aliases: { bg: 'background' } },
);

export const turretObject = doc(
  z.strictObject({ dirs: opt(z.union([z.enum(DIRECTION_SETS), z.number().int()]), { help: 'The turret\'s own direction count (default: the hull\'s).', example: '16' }).optional() }),
  { id: 'turret', title: 'Turret', summary: 'The object form of `turret` (FB-096): `{ "dirs": "16" }`.', aliases: { directions: 'dirs' } },
);

export const splitObject = doc(
  z.strictObject({
    at: opt(z.literal('waist'), { help: 'Where to split: waist (the only place today).' }).optional(),
    legs: opt(nameList, { help: 'The moves of the legs sheet (default: idle and locomotion).', example: ['idle', 'walk', 'run'] }).optional(),
    torso: opt(nameList, { help: 'The moves of the torso sheet (default: idle, aim, shoot, throw, reload).', example: ['idle', 'aim', 'shoot'] }).optional(),
    whole: opt(z.boolean(), { help: 'Also write the whole-body sheet <base> (every move) from the same job and framing (FB-126).' }).optional(),
  }),
  { id: 'split', title: 'Split', summary: 'The object form of `split` (FB-124): a legs sheet and a torso sheet with a per-frame waist socket in both.' },
);

// ---- the sprite ----

const dirs = z
  .union([z.number().int(), z.string().min(1), z.array(z.union([z.string(), z.number()])).min(1)])
  .refine((v) => {
    const tokens = (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(/[,\s]+/)).filter(Boolean);
    if (tokens.length === 1 && (DIRECTION_SETS as readonly string[]).includes(tokens[0]!.toLowerCase())) return true;
    return tokens.length > 0 && tokens.every(isDirectionName);
  }, `is a direction count (${DIRECTION_SETS.join(', ')}) or direction names (E, "N,S", ["N", "S"]; right, up_left…; a045)`);

const tile = z.union([
  z.string().refine((s) => TILE_OFF.test(s) || (TILE_RE.test(s) && ((m) => Number(m[1]) === Number(m[2]) || Number(m[1]) === 2 * Number(m[2]))(TILE_RE.exec(s)!)), 'is WxH: a 2:1 diamond ("64x32") or a square ("32x32"); or "none"'),
  z.null(),
  z.literal(false),
]);

const scale = z.union([
  z.literal('fit'),
  z.number().min(MODEL_SCALE_MIN).max(MODEL_SCALE_MAX),
  z.string().regex(/^\s*[x×]?\s*[\d.]+\s*(%|x|×)?\s*$/i, `is "fit" or the model's size factor from ${MODEL_SCALE_MIN} to ${MODEL_SCALE_MAX} (1.3 = 30% bigger; "130%" and "1.3x" work too)`),
]);

/** Every sprite key but name and asset: usable on a sprite, in `defaults`, and at the top of the file. */
export const spriteSettingFields = {
  kind: opt(z.enum(SPRITE_KINDS), { help: 'What the model is (default: from the model).' }).optional(),
  class: opt(nameList, { help: `Movesets: "rifle", ["rifle", "pistol"] or "rifle,pistol" (${MAIN_CLASSES.join(', ')}).`, example: 'rifle' }).optional(),
  anim: opt(z.union([animEntry, z.array(animEntry)]), { help: 'Clip names, or with class the moves to keep ("idle", "crouch_*"); each may carry its own trim, cap, events and held items ("Clip@0.8:2.6", "Clip@max=2", or an Anim entry object). With class, installed clip names are extra clips under their own names.', example: ['idle', 'walk', { clip: 'Knife_Stab_Fore', trim: '0:0.9', with: 'POLYGON_Palm_City/SM_Wep_Knife_01' }] }).optional(),
  template: opt(z.union([templateEntry, z.array(templateEntry)]), { help: 'Procedural moves: "still", ["crawl", "drive_turn:steer=25"]; with its own held items a Template entry object.', example: 'still' }).optional(),
  set: opt(z.string().min(1), { help: 'An animation set by id or name (not with class); "none" = only the declared anim/template moves (the default whenever any are declared).', example: 'builtin_locomotion' }).optional(),
  with: opt(refList, { help: 'Held items: "Pack/Model", "@bone", "=layer", ":front", "~class".', example: ['POLYGON_War/SM_Wep_American_Rifle_01'] }).optional(),
  states: opt(states, { help: 'Objects: "auto", "auto,destroyed@destroy", "auto,intact:drive,destroyed@destroy" or { "intact": { "template": "drive" }, "destroyed": { "asset", "transition" } } (no anim/set/class; a template next to states is the intact state\'s loop).', example: 'auto,destroyed@destroy' }).optional(),
  view: opt(z.enum(VIEW_PRESETS), { help: 'The view preset (default: the project\'s).' }).optional(),
  dirs: opt(dirs, { help: 'Directions: 1, 2, 4, 4d, 8, 16… (on an object in an iso view, 1 = one facing of that view), or the directions by name: "E", "N,S", ["N", "S"].', example: '8' }).optional(),
  facings: opt(z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]), { help: 'Objects: 1, 2 or 4 grid-aligned facings (0 = use dirs).', example: 4 }).optional(),
  slice: opt(z.literal('columns'), { help: 'Objects on a diamond tile: "columns" (per-tile-column strips).' }).optional(),
  collision: opt(z.enum(COLLISION_MODES), { help: 'Objects: full (whole hull), base (ground slice: a trunk), concave (the outline of the slice: curved walls, fences) or auto (default: vehicles, aircraft, buildings full; trees, poles base).' }).optional(),
  collisionHeight: opt(z.number().min(0), { help: 'Objects: the ground slice\'s height in metres above the bottom (default min(0.5, 15% of the height)).', example: 0.5 }).optional(),
  pitch: opt(z.number().min(0).max(90), { help: 'Camera pitch in degrees (0 = side, 30 = 2:1 iso, 90 = straight down).', example: 30 }).optional(),
  projection: opt(z.enum(['ortho', 'persp']), { help: 'The camera projection.' }).optional(),
  frame: opt(z.number().int().positive(), { help: 'Square frame size in px (the minimum with ppm/tile).', example: 128 }).optional(),
  ppm: opt(z.number().positive(), { help: 'Fixed pixels per metre (a sprite\'s own ppm wins over the file\'s tile; next to its own tile, the tile wins with a warning).', example: 64 }).optional(),
  tile: opt(tile, { help: 'Tile lock "64x32" (iso diamond) or "32x32" (square): the scale from the game\'s tile; null/false on a sprite leaves the lock (own ppm, or fit).', example: '64x32' }).optional(),
  metresPerTile: opt(z.number().positive(), { help: 'With tile: metres one tile covers (default 1).', example: 1 }).optional(),
  scale: opt(scale, { help: '"fit": fit the model into the frame (UI icons), leaving the tile lock and ppm; or a number, the model\'s own size factor (1.3 = a boss 30% bigger, also "130%") at the same ppm/tile lock.', example: 'fit' }).optional(),
  fps: opt(z.number().positive(), { help: 'Frames per second sampled from the clips.', example: 12 }).optional(),
  mirror: opt(z.boolean(), { help: 'true: render only right-facing directions; the engine flips the rest.' }).optional(),
  supersample: opt(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), { help: '1–4: render at N× and average down.', example: 2 }).optional(),
  pixelArt: opt(z.boolean(), { help: 'Pixel-art style (hard edges, model palette, 1 px outline).' }).optional(),
  outline: opt(z.boolean(), { help: 'Pixel style: 1 px outline.' }).optional(),
  palette: opt(z.enum(PALETTES), { help: 'Pixel style colours: full, model or levels.' }).optional(),
  shadow: opt(z.union([z.enum(SHADOWS), z.literal(false)]), { help: 'The drop shadow: off, low or high (false = off).', example: 'off' }).optional(),
  look: opt(z.enum(LOOKS), { help: 'Look card: clean, pixel, hand_painted, stylized.' }).optional(),
  size: opt(z.enum(SIZES), { help: 'Size card: small (64 px), medium (128), large (256), xl (512).' }).optional(),
  format: opt(z.string().min(1), { help: `Engine format: ${BUILTIN_FORMATS.join(', ')} (or a custom profile).`, example: 'phaser3' }).optional(),
  layers: opt(z.union([z.string().min(1), z.array(z.enum(EXTRA_LAYERS))]), { help: 'Extra layers: normal, depth, uv, shadow.', example: ['normal'] }).optional(),
  uniform: opt(z.boolean(), { help: 'Same frame size and pivot for every direction and clip (fixed scale); the project\'s sprites of one model with uniform at the same view share one frame and pivot.' }).optional(),
  atlas: opt(z.boolean(), { help: 'Pack trimmed frames into atlas pages.' }).optional(),
  animPrefix: opt(z.string(), { help: 'Animation key prefix, tokens {base} {asset} (default: the sprite\'s name; "" = bare clip_dir).', example: '{base}/' }).optional(),
  movePrefix: opt(z.boolean(), { help: 'With one class: false = bare move names (keys "hero/idle_E", clips "idle") instead of "hero/martial_arts_idle_E".' }).optional(),
  maxSeconds: opt(z.number().positive(), { help: 'Cap every clip at this many seconds (a clip\'s own maxSeconds in anim wins).', example: 3 }).optional(),
  gender: opt(z.enum(GENDERS), { help: 'Clip gender: auto, Masculine or Feminine.' }).optional(),
  layered: opt(z.union([z.boolean(), z.literal('mask'), z.literal('none')]), { help: 'Held items as separate aligned sheets: true / "mask" (hidden pixels cut away) or "none" (whole items); false (default): baked into one sheet.' }).optional(),
  fx: opt(z.union([z.boolean(), fxObject]), { help: 'Glowing FX look: true or { "enabled", "tint", "intensity", "blend" }.', example: { enabled: true, tint: '#ff7a20', intensity: 1.2 } }).optional(),
  light: opt(light, { help: `Lighting (FB-060): ${['day', 'dusk', 'night', 'overcast', 'desert_noon', 'arctic'].join(', ')} (default day), or a Light object.`, example: 'dusk' }).optional(),
  tags: opt(z.array(z.string()), { help: 'Sprite tags (default: its movesets).', example: ['enemy'] }).optional(),
  pivot: opt(z.enum(['anchor', 'origin']), { help: 'Objects: the frame pivot in the data files: each direction\'s object anchor (default) or the model origin.' }).optional(),
  turret: opt(z.union([z.boolean(), z.enum(DIRECTION_SETS), z.number().int(), turretObject, z.null()]), { help: 'Vehicles (FB-096): hull and turret as two sheets, the turret\'s mount per hull direction in the hull\'s meta: true, or the turret\'s own dirs "16" / { "dirs": "32" }; false = one sheet.', example: true }).optional(),
  portrait: opt(z.union([z.boolean(), pixels, z.string(), portraitObject, z.null()]), { help: 'Characters (SF-FB-021): also a head-and-shoulders still <base>_portrait.png: true (256 px, 3/4, transparent), a size, "320x400,front,#203040" or a Portrait object; false = none.', example: '240x192,front' }).optional(),
  split: opt(z.union([z.boolean(), z.string(), splitObject, z.null()]), { help: 'Characters (FB-124): "waist" = a legs sheet and a torso sheet with a per-frame waist socket in both, to aim the torso apart from the walk; or a Split object; false = one sheet.', example: 'waist' }).optional(),
  still: opt(nameList, { help: 'One-frame stills of clips or moves: "Victory_Pose@2.4" (source seconds) or a list, each a one-frame animation <Clip>_still per direction ("Clip@2.4=ending" names it).', example: 'Victory_Pose@2.4=ending' }).optional(),
};

const SPRITE_ALIASES = {
  model: 'asset', classes: 'class', moveset: 'class', movesets: 'class', anims: 'anim', animations: 'anim', templates: 'template', directions: 'dirs', frameSize: 'frame', uniformFrame: 'uniform',
  'metres-per-tile': 'metresPerTile', 'max-seconds': 'maxSeconds', 'pixel-art': 'pixelArt', 'anim-prefix': 'animPrefix', 'move-prefix': 'movePrefix', 'collision-height': 'collisionHeight',
  turretDirs: 'turret', turret_dirs: 'turret', 'turret-dirs': 'turret', modelScale: 'scale', 'model-scale': 'scale', stills: 'still',
};

const words = (v: unknown): string[] => (v === undefined || v === null ? [] : (Array.isArray(v) ? v.map(String) : [String(v)]).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean));
const hasEntries = (v: unknown) => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0);

type SpriteSettings = { [K in keyof typeof spriteSettingFields]?: unknown };
/** The rules that hold between a sprite's keys (ported from entryOf). */
function checkSpriteRules(d: SpriteSettings, ctx: z.RefinementCtx) {
  const bad = words(d.class).filter((c) => !(WEAPON_CLASSES as readonly string[]).includes(c));
  if (bad.length) ctx.addIssue({ code: 'custom', path: ['class'], message: `unknown moveset ${bad.map((c) => JSON.stringify(c)).join(', ')} (movesets: ${MAIN_CLASSES.join(', ')})` });
  if (d.states !== undefined && (d.anim !== undefined || d.set !== undefined || d.class !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['states'], message: 'states are the sprite\'s moves: leave out anim, set and class (or drop states). A state can loop: "template": "drive" (the intact state\'s loop) or { "intact": { "template": "drive" } }' });
  }
  const noSet = typeof d.set === 'string' && /^\s*none\s*$/i.test(d.set);
  if (noSet && !hasEntries(d.anim) && !hasEntries(d.template) && !words(d.class).length && d.states === undefined) {
    ctx.addIssue({ code: 'custom', path: ['set'], message: '"set": "none" leaves the sprite without moves: give anim or template (or leave set out for the kind\'s own set)' });
  }
  const layers = typeof d.layers === 'string' ? words(d.layers) : [];
  const badLayer = layers.filter((l) => !(EXTRA_LAYERS as readonly string[]).includes(l));
  if (badLayer.length) ctx.addIssue({ code: 'custom', path: ['layers'], message: `unknown layer ${badLayer.map((c) => JSON.stringify(c)).join(', ')} (layers: ${EXTRA_LAYERS.join(', ')})` });
}

/** One declared sprite. */
export const spriteDecl = doc(
  z
    .strictObject({
      name: opt(z.string().min(1), { help: 'The sprite\'s name in the project (unique in the file): what the next run matches.', example: 'hero' }),
      asset: opt(assetRef, { help: 'The model: id, name or Pack/Name.', example: 'POLYGON_War/Character_American_Soldier_01' }),
      ...spriteSettingFields,
    })
    .superRefine(checkSpriteRules),
  {
    id: 'sprite',
    title: 'Sprite',
    summary: 'One sprite: a model and how to render it. Every key but name and asset may also sit in `defaults` or at the top of the file, for every sprite; a sprite\'s own keys win.',
    aliases: SPRITE_ALIASES,
  },
);
export type SpriteDecl = z.infer<typeof spriteDecl>;

/** Settings for every sprite: the sprite keys without name and asset. */
export const spriteDefaults = doc(z.strictObject(spriteSettingFields).superRefine(checkSpriteRules), {
  id: 'sprite-defaults',
  title: 'Sprite defaults',
  summary: 'The `defaults` object (and the same keys at the top level): every Sprite key but name and asset.',
  aliases: SPRITE_ALIASES,
});

// ---- tilesets ----

export const TERRAIN_KINDS = ['grass', 'dirt', 'sand', 'mud', 'road', 'water', 'snow', 'jungle', 'rock', 'custom'] as const;
export const MIX_MODES = ['auto', 'triples', 'pairs'] as const;

export const terrainDecl = doc(
  z
    .strictObject({
      name: opt(z.string().min(1), { help: 'The terrain\'s name (unique in the tileset).', example: 'grass' }),
      kind: opt(z.enum(TERRAIN_KINDS), { help: 'What it is (default: the name if it is a kind, else custom): sets the default colour and water/shore behaviour.' }).optional(),
      color: opt(hexColor, { help: 'Flat palette colour (default: the kind\'s). Not with texture.', example: '#8a6440' }).optional(),
      noise: opt(z.number().min(0).max(1), { help: '0–1 noise on the palette colour.', example: 0.3 }).optional(),
      texture: opt(z.union([z.string().min(1), z.number().int().positive()]), { help: 'A texture instead of a colour: a texture path inside the packs, or an installed asset id.', example: 'POLYGON_Generic_v3/Textures/Generic_Grass.png' }).optional(),
      scale: opt(z.number().positive(), { help: 'With texture: metres one repeat of the texture covers (default one tile).', example: 4 }).optional(),
      tint: opt(hexColor, { help: 'A tint over the texture or colour.', example: '#c0d0a0' }).optional(),
      variants: opt(z.number().int().min(1), { help: 'Random variants of this terrain\'s tiles (default: the tileset\'s).', example: 3 }).optional(),
      blend: opt(nameList, { help: 'Terrains to make transitions with (the same as listing the pairs).', example: ['grass', 'dirt'] }).optional(),
      height: opt(z.union([z.literal(0), z.literal(1)]), { help: '1 = raised one level: cliffs where it meets ground terrains (`cliff: true` is the same).' }).optional(),
      cliff: opt(z.boolean(), { help: 'true = raised one level with cliffs (the same as height 1).' }).optional(),
      shore: opt(z.boolean(), { help: 'Shore treatment where it meets another terrain (default: on for water).' }).optional(),
    })
    .superRefine((t, ctx) => {
      if (t.color !== undefined && t.texture !== undefined) ctx.addIssue({ code: 'custom', path: ['texture'], message: 'a colour or a texture, not both' });
      if (t.cliff !== undefined && t.height !== undefined && (t.cliff ? 1 : 0) !== t.height) ctx.addIssue({ code: 'custom', path: ['cliff'], message: 'cliff and height disagree' });
      if (t.scale !== undefined && t.texture === undefined) ctx.addIssue({ code: 'custom', path: ['scale'], message: 'scale is for textures: give texture too' });
    }),
  { id: 'terrain', title: 'Terrain', summary: 'One terrain of a tileset: a colour or a texture, and how it meets its neighbours. A bare string is a terrain with that name.', aliases: { colour: 'color' } },
);
export type TerrainDecl = z.infer<typeof terrainDecl>;

const pairEntry = z.union([z.tuple([z.string().min(1), z.string().min(1)]), z.string().regex(/^[^,+]+[,+][^,+]+$/, 'names two terrains, "grass,dirt"')]);
const pairNames = (p: z.infer<typeof pairEntry>): [string, string] => (typeof p === 'string' ? (p.split(/[,+]/).map((s) => s.trim()) as [string, string]) : p);

export const tilesetDecl = doc(
  z
    .strictObject({
      name: opt(z.string().min(1), { help: 'The tileset\'s name (unique in the file): what the next run matches.', example: 'temperate' }),
      tile: opt(z.string().regex(TILE_RE, 'is WxH: "64x32" (2:1 iso diamond) or "32x32" (square)'), { help: '"64x32" (2:1 iso diamond, the default) or "32x32" (square, orthogonal); default: the file\'s tile.', example: '64x32' }).optional(),
      metresPerTile: opt(z.number().positive(), { help: 'Metres one tile covers (default: the file\'s, else 1).', example: 1 }).optional(),
      noisePeriod: opt(z.number().positive(), { help: 'Period of the large-scale ground noise in tiles (default 4).', example: 4 }).optional(),
      variants: opt(z.number().int().min(1), { help: 'Default random variants per corner combination (a terrain\'s own variants wins; default 1).', example: 2 }).optional(),
      terrains: opt(z.array(z.union([terrainDecl, z.string().min(1)])).min(1), { help: 'The terrains, by name or as Terrain objects.', cli: false }),
      pairs: opt(z.union([z.array(pairEntry), z.literal('all')]), { help: 'Terrain pairs that get transition tiles ([["grass", "dirt"]] or ["grass,dirt"]), or "all" for every pair.', example: [['grass', 'dirt']] }).optional(),
      cliffHeight: opt(z.number().positive(), { help: 'Cliff face height in pixels for raised terrains (default tileHeight / 2).', example: 16 }).optional(),
      mixes: opt(z.enum(MIX_MODES), { help: 'Tiles where three or four terrains meet: auto (default: every mix while the tileset has few terrains), triples or pairs.' }).optional(),
      light: opt(light, { help: 'Lighting preset ("dusk") or a Light object, as a sprite\'s light: grades the ground to match (FB-060).', example: 'dusk' }).optional(),
      comment: opt(z.unknown(), { help: 'A note for people; ignored.', cli: false }).optional(),
      description: opt(z.unknown(), { help: 'A note for people; ignored.', cli: false }).optional(),
    })
    .superRefine((t, ctx) => {
      const names = new Map<string, number>();
      t.terrains.forEach((x, i) => {
        const n = (typeof x === 'string' ? x : x.name).trim().toLowerCase();
        const first = names.get(n);
        if (first !== undefined) ctx.addIssue({ code: 'custom', path: ['terrains', i], message: `two terrains are named "${typeof x === 'string' ? x : x.name}" (also terrains[${first}])` });
        else names.set(n, i);
      });
      const declared = [...names.keys()];
      const known = (n: string, path: (string | number)[], what: string) => {
        if (!names.has(n.trim().toLowerCase())) ctx.addIssue({ code: 'custom', path, message: `${what} names terrain "${n}", which the tileset doesn't declare (${declared.join(', ')})` });
      };
      if (Array.isArray(t.pairs)) {
        t.pairs.forEach((p, k) => {
          const [a, b] = pairNames(p);
          known(a, ['pairs', k], `pairs[${k}]`);
          known(b, ['pairs', k], `pairs[${k}]`);
          if (a.trim().toLowerCase() === b.trim().toLowerCase()) ctx.addIssue({ code: 'custom', path: ['pairs', k], message: `pairs[${k}] needs two different terrains` });
        });
      }
      t.terrains.forEach((x, i) => {
        if (typeof x === 'string') return;
        for (const b of words(x.blend)) known(b, ['terrains', i, 'blend'], `terrain "${x.name}" blend`);
      });
    }),
  {
    id: 'tileset',
    title: 'Tileset',
    summary: 'One tileset: its tile size, terrains and which pairs blend. A declaration is the whole truth about a tileset (terrains it does not list are removed), and tiles that stay keep their ids, so maps made with it stay valid.',
    aliases: { 'metres-per-tile': 'metresPerTile' },
    ignored: ['orientation'],
  },
);
export type TilesetDecl = z.infer<typeof tilesetDecl>;

// ---- the file ----

export const assetsFile = doc(
  z
    .strictObject({
      $schema: opt(z.string(), { help: 'The JSON Schema this file follows (editors use it); ignored.', cli: false }).optional(),
      comment: opt(z.unknown(), { help: 'A note for people; ignored.', cli: false }).optional(),
      description: opt(z.unknown(), { help: 'A note for people; ignored.', cli: false }).optional(),
      generatedBy: opt(z.unknown(), { help: 'What wrote the file; ignored.', cli: false }).optional(),
      project: opt(projectRef, { help: 'The project\'s name or id (a new name is created from the settings below); the CLI\'s --project wins.', example: 'My Game' }).optional(),
      sprites: opt(z.array(spriteDecl), { help: 'The sprites.', cli: false }),
      tilesets: opt(z.array(tilesetDecl), { help: 'The tilesets (see Tileset).', cli: false }).optional(),
      maps: opt(z.array(z.unknown()), { help: 'Level maps built from the tilesets; checked by the levels package (P4), passed through here.', cli: false }).optional(),
      defaults: opt(spriteDefaults, { help: 'Settings for every sprite (the same keys may also sit at the top level); a sprite\'s own keys win.', cli: false }).optional(),
      ...spriteSettingFields,
    })
    .superRefine((f, ctx) => {
      checkSpriteRules(f, ctx);
      const seen = new Map<string, number>();
      f.sprites.forEach((s, i) => {
        const k = s.name.trim().toLowerCase();
        const first = seen.get(k);
        if (first !== undefined) ctx.addIssue({ code: 'custom', path: ['sprites', i, 'name'], message: `two sprites are named "${s.name}" (sprites[${first}] and sprites[${i}])` });
        else seen.set(k, i);
      });
      const names = new Map<string, number>();
      (f.tilesets ?? []).forEach((t, i) => {
        const k = t.name.trim().toLowerCase();
        const first = names.get(k);
        if (first !== undefined) ctx.addIssue({ code: 'custom', path: ['tilesets', i, 'name'], message: `two tilesets are named "${t.name}" (tilesets[${first}] and tilesets[${i}])` });
        else names.set(k, i);
      });
    }),
  {
    id: 'assets-file',
    title: 'ssg.assets.json',
    summary: 'Declares the sprites (and tilesets) a game needs. `slop build` creates or updates each by name, renders what is outdated and downloads it into the game. Settings for every sprite go in `defaults` or at the top level.',
    aliases: SPRITE_ALIASES,
  },
);
export type AssetsFile = z.infer<typeof assetsFile>;
