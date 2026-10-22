/**
 * How Synty ships things: pack zip names, which FBX files are models or clips, and what a clip's path says about it.
 * Ported from the old generator's apps/server/src/packs.ts (parsePackName, animationInfo, isModelFbx,
 * animationFiles, ingestPriority) and packages/shared/src/combat.ts (combatCategory, combatLoops), with the tests
 * of apps/server/test/packs.test.ts. Zip extraction is not ported: this package never writes.
 */
import path from 'node:path';

export type PackKind = 'models' | 'animations';

/**
 * Identity and version from a Synty zip name, so a newer upload replaces the older pack:
 *   POLYGON_City_SourceFiles_v6.zip          -> POLYGON_City, 6, models
 *   POLYGON_BattleRoyale_Source_Files_v5.zip -> POLYGON_BattleRoyale, 5, models
 *   ANIMATION_Idles_SourceFiles_v3.zip       -> ANIMATION_Idles, 3, animations
 *   my_mixamo_clips.zip                      -> my_mixamo_clips, 1, (guessed from contents)
 */
export function parsePackName(fileName: string): { name: string; version: number; kind: PackKind | null } {
  const base = path.basename(fileName).replace(/\.zip$/i, '');
  const m = base.match(/^(.*?)(?:_Source_?Files)?(?:_v(\d+))?$/i);
  const name = (m?.[1] || base).replace(/_+$/, '');
  const version = m?.[2] ? Number(m[2]) : 1;
  const kind: PackKind | null = /^ANIMATION_/i.test(name) ? 'animations' : /^POLYGON_|^SIMPLE_|^SYNTY_/i.test(name) ? 'models' : null;
  return { name, version, kind };
}

/** Combat clip naming (Synty combat packs and Mixamo): category and one-shot guess. */
export function combatCategory(clipName: string): string | null {
  const n = clipName.toLowerCase();
  if (/death|die|dying|dead/.test(n)) return 'Combat/Death';
  if (/hit|hurt|damage|impact|stagger|knockback|react/.test(n)) return 'Combat/Hit';
  if (/block|parry|guard/.test(n)) return 'Combat/Block';
  if (/dodge|roll|evade/.test(n)) return 'Combat/Dodge';
  // Bow shots first: Synty's "Shoot_Reload" releases an arrow and nocks the next one.
  const bow = /bow|arrow/.test(n) || /draw/.test(n);
  if (bow && /shoot|fire|release/.test(n)) return 'Combat/Bow';
  if (/reload/.test(n)) return 'Combat/Reload';
  if (/cast|spell|magic|channel/.test(n)) return 'Combat/Cast';
  // Synty's aiming clips only draw the string ("Aiming_ToDrawn"); Mixamo's "Draw Arrow" is a whole shot.
  if (bow && /aim|todrawn/.test(n) && !/arrow/.test(n)) return 'Combat/BowDraw';
  if (bow && /draw|attack/.test(n)) return 'Combat/Bow';
  if (/shoot|fire|aim|recoil|rifle|pistol|gun/.test(n)) return 'Combat/Shoot';
  // Fighting-game moves too (SF-FB-007): uppercuts, jabs, sweeps and the martial-arts special (a hadouken push).
  if (/attack|slash|swing|stab|thrust|punch|kick|strike|combo|smash|chop|throw|uppercut|jab|haymaker|hadouken|sweep|headbutt|head_butt|elbow/.test(n) || /^martial[_ ]?arts[_ ]?special/.test(n)) return 'Combat/Attack';
  return null;
}

/** One-shot unless it is clearly a loop (combat idles, aim holds, channel loops). */
export function combatLoops(clipName: string): boolean {
  return /idle|loop|hold|aim(?!.*shoot)|channel|run|walk|strafe/i.test(clipName) && !/death|die|hit|attack|shoot|cast|release/i.test(clipName);
}

export interface AnimationInfo {
  /** The clip's name shared by every rig/gender copy: Walk_F, Walk_F_RM. */
  name: string;
  /** Synty rig family folder: Polygon / Sidekick; null outside a Synty pack. */
  set: string | null;
  gender: string | null;
  /** Locomotion/Walk, Idle, Combat/Attack… */
  category: string | null;
  rootMotion: boolean;
  /** Cycles loop; transitions and one-shots do not. */
  loop: boolean;
}

/**
 * Synty ANIMATION packs ship each clip once per rig family:
 *   SourceFiles/Animations/Polygon/Masculine/Locomotion/Walk/A_Walk_F_Masc.fbx          (POLYGON rig)
 *   SourceFiles/Animations/Sidekick/Masculine/Locomotion/Walk/A_MOD_BL_Walk_F_Masc.fbx  (Sidekick rig)
 * Both normalise to the same name ("Walk_F"), so a library can list the clip once and bake whichever
 * copy matches the target character's rig.
 */
export function animationInfo(rel: string): AnimationInfo {
  const parts = rel.split('/');
  const file = parts[parts.length - 1]!.replace(/\.fbx$/i, '');
  const a = parts.findIndex((p) => /^animations$/i.test(p));
  const set = a >= 0 && parts.length > a + 2 ? parts[a + 1]! : null;
  const g = parts.findIndex((p) => /^(masculine|feminine|neutral)$/i.test(p));
  const gender = g >= 0 ? parts[g]! : null;
  const rawCategory = g >= 0 ? parts.slice(g + 1, -1).join('/') || null : null;
  // Folder naming differs between the two sets (Idle/Idles, Transition/Transitions).
  const category = rawCategory?.replace(/^Idles\b/, 'Idle').replace(/^Transition\b/, 'Transitions') ?? null;
  const rootMotion = /rootmotion|_RM(_|$)/i.test(file);
  const name = file
    .replace(/^A_/, '')
    .replace(/^MOD_BL_/, '')
    .replace(/_(Masc|Femn|Neut)$/i, '')
    .replace(/_RootMotion/i, '_RM'); // Polygon set says RootMotion, Sidekick says RM
  // Cycles loop; transitions (Idle_ToWalk), one-shots (Angry, Death) and in-air clips don't.
  let loop = /idle|walk|run|sprint|crouch|strafe|shuffle|loop|swim|fly/i.test(file) && !/_?to_?(idle|walk|run|sprint|stand|crouch)|start|stop|jump|land/i.test(file);
  // Combat clips (Synty combat packs, Mixamo): attacks, casts, shots, hits and deaths are one-shots, filed under
  // Combat/* when the pack's folders don't say otherwise.
  const combat = combatCategory(name);
  const combatFolder = !category || /combat|attack|weapon|magic|spell|melee|ranged|sword|bow|gun|rifle|pistol|fight/i.test(category);
  if (combat && combatFolder) loop = combatLoops(name);
  return { name, set, gender, category: category ?? (combatFolder ? combat : null), rootMotion, loop };
}

/** Which files of a model pack become assets. Collision proxies and Maya scenes are skipped. */
export function isModelFbx(rel: string): boolean {
  if (!/\.fbx$/i.test(rel)) return false;
  // Collision proxies: *_Collision.fbx, *_Collision_01.fbx, or anything under a Collision folder.
  return !/(^|\/)(Custom_)?Collisions?\//i.test(rel) && !/_Collision(_\d+)?\.fbx$/i.test(rel);
}

/**
 * Which FBX files of an animation pack are clips. Synty packs keep clips under Animations/ next to demo
 * props and levels; a plain zip of Mixamo downloads has no such folder, so every FBX is a clip.
 */
export function animationFiles(files: string[]): string[] {
  const fbx = files.filter((f) => /\.fbx$/i.test(f));
  const underAnimations = fbx.filter((f) => /(^|\/)Animations\//i.test(f));
  return underAnimations.length ? underAnimations : fbx;
}

/** Priority so the useful assets appear first while a big pack ingests (characters, vehicles, weapons, the rest). */
export function ingestPriority(rel: string): number {
  const f = path.basename(rel);
  if (/^(SK_Chr|SK_Character|SM_Chr_(?!Attach)|Character_|Chr_)/i.test(f)) return 0;
  if (/(SM|SK)_Veh_/i.test(f) && !/Veh_Attach/i.test(f)) return 1;
  if (/SM_Wep_/i.test(f)) return 2;
  return 3;
}
