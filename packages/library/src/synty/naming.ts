/**
 * Synty naming rules → asset kind. Ported from the old generator: packages/shared/src/fx.ts (isFxName,
 * isWeaponName, isAttachmentName, isBundledAttachment, isHeldAttachment) and apps/server/src/db.ts (refineKind),
 * with their tests (packages/shared/src/fx.test.ts, apps/server/test/kinds.test.ts, apps/server/test/packs.test.ts).
 * The FX rule mirrors worker/synty/textures.py is_fx_mesh() in the Blender worker.
 */

/** What the Blender ingest (and the rules below) call a model. */
export const ASSET_KINDS = ['character', 'rigged', 'vehicle', 'multipart', 'attachment', 'weapon', 'prop', 'fx', 'animation', 'unknown'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Glowing effect geometry: puffs, cones, rings, light rays, flames, orbs. */
const FX_NAME = /(^|_)FX(_|\d|$)|GlowingOrb|LightRay|SunShafts|(^|_)(Electricity|Lightning|Bubble|Puff)(_|\d|$)|Particle_Smoke|Flame_Mesh/i;
/** FX-prefixed things that are really pickups, debris or props. */
const FX_EXCLUDE = /Ammo|Arrow|Crystal|Grenade|Healthcube|Heart|Money|Coin|Note|Question|Shard|Skull|WoodChip|Gore|(^|_)Rock|Wep_|Candle|Chandel|Candelabra|Cart|Moth|Vine|Tower|Prop_|Crowd/i;

export function isFxName(name: string): boolean {
  return !!name && FX_NAME.test(name) && !FX_EXCLUDE.test(name);
}

/** Weapons across packs: SM_Wep_*, fantasy SM_Prop_<weapon>, Dungeon SM_Item_<weapon>, arrows and rigged bows. */
// Weapon words in CamelCase names: the word may be followed by another CamelCase word (SwordOrnate) but not by
// lowercase letters (Stafford), hence case-sensitive matching here.
const W = '(Dagger|Staff|Wand|Sceptre|Sword|Axe|Mace|Hammer|Bow|Crossbow|CrossBow|Shield|Spear|Halberd|Scythe|Club|Flail)';
const WEAPON_NAME = new RegExp(
  [
    '^SM_Wep_',
    `^SM_Prop_([A-Z][a-z]+_?)*${W}(?=[A-Z_\\d]|$)`,
    `^SM_[Ii]tem_(Chr_)?${W}(?=[A-Z_\\d]|$)`,
    '^SM_([Ii]tem_)?Arrow(_|\\d|$)',
    '^Rigged_(Bow|CrossBow)',
  ].join('|'),
);
export function isWeaponName(name: string): boolean {
  // Furniture that holds weapons (altars, displays, racks) stays a prop.
  return !!name && WEAPON_NAME.test(name) && !/Arrow_?(Basket|Quiver|Barrel|Stand|Rack)|_(Altar|Display|Rack|Stand|Holder|Mount|Plaque|Pile|Crate|Barrel)(_|\d|$)/i.test(name);
}

/** Character attachments and weapon mod attachments (scopes, grips): picked to mount on something else. */
export function isAttachmentName(name: string): boolean {
  return /(^|_)(Chr|Char|Character)_Attach_|^SM_Wep_Mod_Attach_/i.test(name);
}

/**
 * Optional pieces Synty bundles into a combined character file next to the bodies (SM_Char_Attach_Male_Armor_01,
 * SM_Chr_Attach_Hair_03, capes, hoods…). They are not part of any one body: the old server listed each as its own
 * attachment asset (a row on the same file with `variant` = the mesh name and `meta.bundled`).
 */
export function isBundledAttachment(name: string): boolean {
  return /(^|_)Attach(_|$)/i.test(name);
}

/** Names whose bows/shields are held weapons even when shipped as character attachments. */
export function isHeldAttachment(name: string): boolean {
  return /_Attach_(Bow|Crossbow|Shield|Sword|Staff|Axe|Dagger)(_|\d|$)/i.test(name);
}

/**
 * Library kinds refined from Synty naming: character attachments (helmets, packs, armour) and weapons are
 * props/rigged meshes to the importer but are picked differently. `kind` is what the Blender ingest decided.
 */
export function refineKind(name: string, kind: string): AssetKind | string {
  if (kind === 'animation' || kind === 'vehicle') return kind;
  // Bows and shields that ship as character attachments are held weapons.
  if (isHeldAttachment(name) && ['attachment', 'prop', 'multipart', 'rigged'].includes(kind)) return 'weapon';
  if (isAttachmentName(name)) return 'attachment';
  if (isWeaponName(name) && ['prop', 'multipart', 'rigged', 'weapon', 'character'].includes(kind)) return 'weapon';
  if (isFxName(name) && ['prop', 'rigged', 'unknown', 'fx'].includes(kind)) return 'fx';
  return kind;
}
