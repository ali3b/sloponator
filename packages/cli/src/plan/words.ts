/**
 * Moved from synty-sprite-generator packages/shared/src/sprite/words.ts (P2, ali3b/sloponator#8): the plain words
 * the old Wizard and the sprite planner share. Only what planning needs is kept: the kinds, the view/look/size/engine
 * cards, the Wizard kind of a library model and the equipment slots. The prompt-resolver vocabulary (synonyms, set
 * and template words, kind chips, featured cards) stayed behind.
 */
import { STYLE_PRESETS, type QualityConfig, type ScaleConfig } from '@slop/sprites';

export interface Words {
  title: string;
  body: string;
}

/**
 * What a sprite is. `object` is scenery that stands on the map (buildings, walls, crates, trees): it shares the
 * characters' real-world scale. `prop` is pickups, doors and effects, fitted to the frame.
 */
export type WizKind = 'character' | 'vehicle' | 'object' | 'prop' | 'weapon' | 'all';

/** Every VIEW_PRESETS id in plain words. */
export const VIEW_WORDS: Record<string, Words> = {
  side2: { title: 'Side-scroller', body: 'Seen from the side, facing left and right. For platformers and brawlers.' },
  lowthreequarter: { title: 'Side-on, slightly from above', body: 'Like classic street brawlers: left and right, with a little top view.' },
  jrpg4: { title: 'Top-down, 4 directions', body: 'Up, down, left, right. Like Zelda or Stardew Valley.' },
  topdown8: { title: 'Top-down, 8 directions', body: 'Seen from above at an angle, turning in 8 directions. Most top-down games.' },
  high8: { title: 'High top-down, 8 directions', body: 'Steeper view from above. Good for twin-stick shooters.' },
  straightdown: { title: 'Straight down, rotate in your engine', body: 'One picture from directly above; your game turns it. Smallest files.' },
  iso8: { title: 'Isometric, 8 directions', body: 'The classic diamond-tile look of strategy and city games.' },
  iso4d: { title: 'Isometric, 4 diagonal directions', body: 'Isometric games where units walk along the tile edges.' },
  trueiso8: { title: 'True isometric, 8 directions', body: 'A slightly steeper isometric angle (engineering style).' },
  hexflat6: { title: 'Hex map (flat-top), 6 directions', body: 'For hex-grid games with flat-topped hexes.' },
  hexpointy6: { title: 'Hex map (pointy-top), 6 directions', body: 'For hex-grid games with pointy-topped hexes.' },
  vehicle16: { title: 'Vehicle, 16 directions', body: 'Extra directions so cars turn smoothly.' },
  rts32: { title: 'Strategy units, 32 directions', body: 'Very smooth turning, like classic real-time strategy games.' },
  rpgmaker: { title: 'RPG Maker', body: 'The exact sheet RPG Maker MZ expects (48 px, 4 directions).' },
  lpc: { title: 'LPC sheet', body: 'The Liberated Pixel Cup layout (64 px, 4 directions).' },
};

/** Views that set their own frame size (the size choice does not apply). */
export const FIXED_SIZE_VIEWS = new Set(['rpgmaker', 'lpc']);

export type LookId = 'clean' | 'pixel' | 'hand_painted' | 'stylized';
/** The Look cards: the shared style presets, in plain words. */
export const LOOKS: { id: LookId; title: string; body: string; quality: QualityConfig }[] = STYLE_PRESETS.map((p) => ({ id: p.id, title: p.label, body: p.hint, quality: { ...p.quality } }));

export type SizeId = 'small' | 'medium' | 'large' | 'xl';
/**
 * Sizes. Characters, vehicles and objects keep one real-world scale (so a car is bigger than a person and a
 * bunker bigger than both); props and FX are fitted to the frame so a coin is not two pixels wide.
 */
export const SIZES: { id: SizeId; title: string; body: string; ppm: number; frame: number }[] = [
  { id: 'small', title: 'Small', body: 'About 64 px per frame. Pixel art and mobile.', ppm: 32, frame: 64 },
  { id: 'medium', title: 'Medium', body: 'About 128 px per frame. Most games.', ppm: 64, frame: 128 },
  { id: 'large', title: 'Large', body: 'About 256 px per frame. HD games and close-ups.', ppm: 128, frame: 256 },
  { id: 'xl', title: 'Extra large', body: 'About 512 px per frame. Detail for checking grips, weapons and poses; slow to render.', ppm: 256, frame: 512 },
];

/** Pickups, collectibles and icons among the library's props: fitted to the frame, not placed on the map. */
const PICKUP_NAME = /(^fx_|coin|gem|jewel|potion|pickup|collect|health|medkit|ammo|power_?up|heart|loot|icon|(^|_)key(_|\d|$))/i;

/**
 * The Wizard kind of a library model: props and multipart models are objects (scenery at real scale) unless their
 * name says pickup, collectible or effect; effects are props.
 */
export function wizKindForAsset(kind: string, name = ''): Exclude<WizKind, 'all'> {
  if (kind === 'character' || kind === 'rigged') return 'character';
  if (kind === 'vehicle') return 'vehicle';
  if (kind === 'weapon' || kind === 'attachment') return 'weapon';
  if (kind === 'prop' || kind === 'multipart') return PICKUP_NAME.test(name) ? 'prop' : 'object';
  return 'prop';
}

export const usesRealScale = (kind: WizKind) => kind === 'character' || kind === 'vehicle' || kind === 'object';
export function scaleFor(kind: WizKind, size: (typeof SIZES)[number]): ScaleConfig {
  return usesRealScale(kind) ? { mode: 'ppm', ppm: size.ppm } : { mode: 'fit' };
}

/** Engines shown as cards (profile ids); everything else is under "More formats". */
export const ENGINE_WORDS: Record<string, Words> = {
  godot4: { title: 'Godot 4', body: 'Ready-made SpriteFrames for AnimatedSprite2D.' },
  unity: { title: 'Unity', body: 'A sprite sheet Unity slices automatically, with feet pivots.' },
  phaser3: { title: 'Phaser 3', body: 'An atlas and animations you load with two lines of code.' },
  pixi: { title: 'PixiJS', body: 'A spritesheet JSON for AnimatedSprite.' },
  generic: { title: 'Any engine (PNG + JSON)', body: 'One picture and a simple description file. Works everywhere.' },
  aseprite: { title: 'Aseprite JSON', body: 'For tools that read Aseprite exports.' },
  libgdx: { title: 'libGDX', body: 'A TextureAtlas file.' },
  gamemaker: { title: 'GameMaker', body: 'Strip images GameMaker imports with the right frame count.' },
  rpgmaker: { title: 'RPG Maker MZ', body: 'A single-character walking sheet.' },
  lpc: { title: 'LPC sheet', body: 'The Liberated Pixel Cup universal sheet.' },
};
/** Equipment slots of the catalogue: what to search for and which slot id the item is filed under. */
export interface EquipSlot {
  id: string;
  label: string;
  /** Asset kinds to search (comma list for the API). */
  kinds: string;
  /** Names that belong in the slot. */
  match: RegExp;
  /** Moveset the slot's weapon belongs to (per-class weapon slots). */
  cls?: string;
}

export const EQUIP_SLOTS: EquipSlot[] = [
  { id: 'weapon', label: 'Weapon in hand', kinds: 'weapon', match: /./ },
  { id: 'offhand', label: 'Shield / off-hand', kinds: 'weapon,attachment', match: /shield|buckler|torch|lantern/i },
  { id: 'head', label: 'Helmet / hat', kinds: 'attachment', match: /helmet|hat|cap(_|\d|$)|mask|glasses|goggle|hood|beret|bandana|headset|visor|crown|tiara/i },
  { id: 'back', label: 'Cape / backpack', kinds: 'attachment', match: /backpack|_pack|bedroll|cape|cloak|parachute|quiver|radio/i },
];
