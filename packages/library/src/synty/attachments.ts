/**
 * Where a Synty attachment goes on a character. Ported from the old generator's packages/shared/src/export/layers.ts
 * (HAIR_NAME, boneForAttachment, slotFor; tests in layers.test.ts) and packages/shared/src/combat.ts (defaultHand).
 * Bone names are the canonical ones of synty/rigs (canonical.json): head, spine3, hips, hand_l, hand_r.
 */

export type PartSlot = 'weapon' | 'offhand' | 'head' | 'hair' | 'back' | 'body' | 'accessory' | 'fx';

/** Hair pieces by name (SF-FB-013: a ponytail or braid is hair too, worn on the head). */
export const HAIR_NAME = /hair|ponytail|pigtail|braid|beard|moustache|mustache|sideburn|eyebrow/i;

/** Which canonical bone an origin-modelled Synty attachment mounts on, from its name (or its hair/head slot label). */
export function boneForAttachment(name: string, slot?: string | null): 'head' | 'spine3' | 'hips' | 'hand_r' | null {
  const n = name.toLowerCase();
  if (slot === 'hair' || slot === 'head' || HAIR_NAME.test(n)) return 'head';
  // "cap" only as a word (Cap_01, Baseball_Cap): a cape is a back item.
  if (/helmet|hat|(^|_)cap(?=_|\d|$)|hair|mask|glasses|goggle|beard|moustache|head|hood|beret|bandana|headset|ear|visor/.test(n)) return 'head';
  if (/backpack|_pack|bedroll|radio|parachute|cape|vest|armou?r|chest|scarf|tank|quiver/.test(n)) return 'spine3';
  if (/canteen|pouch|holster|belt|shovel|knife|sheath|bag|grenade|ammo/.test(n)) return 'hips';
  if (/glove|watch|bracelet|wrist/.test(n)) return 'hand_r';
  return null;
}

/** Which slot an attached asset fills, from its name and kind (keep in step with boneForAttachment). */
export function slotFor(name: string, kind: string): PartSlot {
  const n = name.toLowerCase();
  if (kind === 'fx') return 'fx';
  if (/shield|buckler/.test(n)) return 'offhand';
  if (['weapon', 'prop', 'multipart', 'rigged'].includes(kind)) return 'weapon';
  if (HAIR_NAME.test(n)) return 'hair';
  if (/helmet|hat|cap(_|\d|$)|mask|glasses|goggle|hood|beret|bandana|headset|visor|crown|tiara/.test(n)) return 'head';
  if (/backpack|_pack|bedroll|cape|cloak|parachute|quiver|radio/.test(n)) return 'back';
  if (/vest|armou?r|chest|scarf|pauldron|plate/.test(n)) return 'body';
  return 'accessory';
}

/** Which hand holds a weapon by default, from its name (bows and shields in the left hand). */
export function defaultHand(assetName: string): 'hand_l' | 'hand_r' {
  return /(^|_)(long|short|recurve|hunting|great|war|elven|orc)?bow(_|\d|$)|shield|buckler|torch|lantern|offhand/i.test(assetName) ? 'hand_l' : 'hand_r';
}
