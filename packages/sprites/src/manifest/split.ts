// Moved from synty-sprite-generator packages/shared/src/export/split.ts (P2, ali3b/sloponator#8).
/**
 * FB-124: a character split at the waist, so a game can aim the upper body apart from the legs (mouse aim while
 * walking). One model renders as two sheets that share one framing (frame size, scale and feet pivot):
 *   legs   ({base}_legs):  the hips and legs, upper body hidden, in the locomotion clips (and idle) per direction
 *   torso  ({base}_torso): spine, arms, head and everything they hold, legs hidden, in the idle, aim, shoot,
 *                          throw and reload clips per direction
 * Every frame of both sheets carries a `waist` socket: the joint between the hips and the spine, in untrimmed-frame
 * pixels. The game draws the legs facing the walk and the torso facing the aim, the torso frame placed so its waist
 * lands on the legs frame's waist. Sockets and events go with the sheet that draws them: hands, head, muzzle,
 * weapon tip, shoot and release on the torso; feet, knees and footsteps on the legs.
 */
import type { SplitSheet, SsgSplit } from '@slop/formats';
import type { AnimationSet, SetItem } from '../inputs/batch.js';
import { moveName } from '../inputs/classes.js';
// These types are the game-facing contract: defined once in @slop/formats, used and re-exported here.
export type { SplitSheet };

/** The waist split of a character export: which moves go on which sheet (default: by the move's name). */
export interface WaistSplit {
  at: 'waist';
  /** Moves on the legs sheet (names without the moveset prefix, `*` globs): replaces the rule. */
  legs?: string[];
  /** Moves on the torso sheet: replaces the rule. */
  torso?: string[];
  /**
   * FB-126: also the whole-body sheet ({base}, every move, nothing hidden) from the same job and framing. With it,
   * whole-body moves that are not walks or idles (death, hit, prone, crawl, kneel…) stay off the legs and torso sheets
   * unless a list names them: the game plays those on the whole sheet.
   */
  whole?: boolean;
}

/** The per-frame socket both sheets carry: the hips → spine joint. */
export const WAIST_SOCKET = 'waist';

/** Moves that walk: legs only (unless they also shoot or aim). */
const TRAVEL = /walk|run|jog|sprint|strafe|sneak|shuffle|march/i;
/** Moves the upper body does on top of a walk. */
const UPPER = /shoot|fire|firing|aim|throw|toss|grenade|reload|cast|attack|slash|stab|punch|swing/i;
/** Whole-body moves (both sheets: drawn facing the same way they put the whole body back together). */
const WHOLE = /death|dying|die(_|$)|prone|crawl|roll|dive|jump|fall|knock|get_?up|stand_?up|hit|hurt|react|crouch|kneel|sit|cover|lie|lying/i;

const glob = (g: string) => new RegExp(`^${g.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const listed = (list: string[], names: string[]) => list.some((g) => names.some((n) => glob(g).test(n)));

/**
 * Which sheets a move goes on. `name` is the move's name without the moveset prefix (moveName); `full` its export
 * name (rifle_walk). Idles and whole-body moves go on both; walks on the legs; the rest (aim, shoot, throw, reload)
 * on the torso. A split's own lists replace the rule for their sheet.
 */
export function sheetsOfMove(name: string, split: WaistSplit, full = name): Record<SplitSheet, boolean> {
  const names = [name, full];
  const idle = /idle/i.test(name);
  const travel = TRAVEL.test(name) && !/idle|turn/i.test(name);
  const whole = WHOLE.test(name);
  const upper = UPPER.test(name);
  // With the whole sheet (FB-126) a whole-body move that is not a walk or an idle is played from that sheet only.
  const wholeOnly = !!split.whole && whole && !travel && !idle;
  const legs = split.legs ? listed(split.legs, names) : !wholeOnly && (idle || whole || travel);
  const torso = split.torso ? listed(split.torso, names) : !wholeOnly && (idle || whole || !travel || upper);
  return { legs, torso };
}

/** The set's items for one sheet (an empty sheet keeps nothing: the caller refuses it). */
export function splitSet(set: AnimationSet, split: WaistSplit, sheet: SplitSheet): AnimationSet {
  const items = set.items.filter((it: SetItem) => sheetsOfMove(moveName(it), split, itemName(it))[sheet]);
  return { ...set, items };
}

const itemName = (it: SetItem) => {
  const l = it.label ?? (it.type === 'anim' ? it.name : it.type === 'match' ? it.pattern : it.layers.map((x) => x.id).join('+'));
  return l;
};

/** Events by sheet: footsteps (and landings) on the legs, everything else (shoot, release, hit…) on the torso. */
export function eventSheet(name: string): SplitSheet {
  return /^footstep|^step|^land/i.test(name) ? 'legs' : 'torso';
}

/**
 * A `split` value from a spec (sprite file, export flags, MCP): "waist" / true = split at the waist by the default
 * rule; { "at": "waist", "legs": [...], "torso": [...], "whole": true } = with its own move lists and/or the
 * whole-body sheet as well (FB-126); "waist+whole" = the rule plus the whole sheet; false / null / "off" = one sheet.
 */
export function parseSplit(v: unknown, where = 'split'): WaistSplit | null {
  if (v === undefined || v === null || v === false) return null;
  if (v === true) return { at: 'waist' };
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['off', 'none', 'false', 'no', ''].includes(s)) return null;
    if (['waist', 'on', 'true', 'yes'].includes(s)) return { at: 'waist' };
    if (['waist+whole', 'whole'].includes(s)) return { at: 'waist', whole: true };
    throw new Error(`${where}: split must be "waist" (got ${JSON.stringify(v)}).`);
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const unknown = Object.keys(o).filter((k) => !['at', 'legs', 'torso', 'whole'].includes(k));
    if (unknown.length) throw new Error(`${where}: unknown key ${unknown.join(', ')} (split takes { "at": "waist", "legs": [moves], "torso": [moves], "whole": true }).`);
    if (o.whole !== undefined && o.whole !== null && typeof o.whole !== 'boolean') throw new Error(`${where}: split.whole must be true or false (got ${JSON.stringify(o.whole)}).`);
    if (o.at !== undefined && String(o.at).toLowerCase() !== 'waist') throw new Error(`${where}: split.at must be "waist" (got ${JSON.stringify(o.at)}).`);
    const list = (k: 'legs' | 'torso') => {
      const x = o[k];
      if (x === undefined || x === null) return undefined;
      const arr = typeof x === 'string' ? x.split(',') : Array.isArray(x) ? x : null;
      if (!arr || arr.some((n) => typeof n !== 'string')) throw new Error(`${where}: split.${k} must be a list of move names (got ${JSON.stringify(x)}).`);
      const names = (arr as string[]).map((n) => n.trim()).filter(Boolean);
      return names.length ? names : undefined;
    };
    const legs = list('legs'), torso = list('torso');
    return { at: 'waist', ...(legs ? { legs } : {}), ...(torso ? { torso } : {}), ...(o.whole === true ? { whole: true } : {}) };
  }
  throw new Error(`${where}: split must be "waist" or { "at": "waist", "legs": [...], "torso": [...] } (got ${JSON.stringify(v)}).`);
}

/** Short text for a split ("split waist"), or null. */
export function splitLabel(s: WaistSplit | null | undefined) {
  if (!s) return null;
  const own = [s.legs ? `legs ${s.legs.join(',')}` : '', s.torso ? `torso ${s.torso.join(',')}` : ''].filter(Boolean);
  return `split waist${s.whole ? ' + whole' : ''}${own.length ? ` (${own.join('; ')})` : ''}`;
}

/**
 * A sheet's animation-name pattern: with {base} in it the keys already differ per sheet; otherwise (a sprite's own
 * prefix "ranger/", or bare names) the sheet goes in after the prefix (ranger/legs/rifle_walk_N, torso_rifle_aim_E),
 * so engines with one global animation table (Phaser) never see the legs and torso claim the same key.
 */
export function splitAnimationName(pattern: string, sheet: SplitSheet): string {
  const at = pattern.indexOf('{clip}');
  if (at < 0) return pattern;
  const prefix = pattern.slice(0, at);
  if (prefix.includes('{base}')) return pattern;
  return `${prefix}${sheet}${prefix === '' || prefix.endsWith('/') ? (prefix ? '/' : '_') : '_'}${pattern.slice(at)}`;
}

/**
 * The same split without the whole sheet: what the legs and torso sheets are rendered from (frame-cache keys, so
 * adding `whole` to a split re-uses the halves already rendered).
 */
export const halvesOf = (s: WaistSplit): WaistSplit => {
  const { whole: _whole, ...rest } = s;
  return rest;
};

/** Sheet base names of a split export. */
export const splitBases = (base: string): Record<SplitSheet, string> => ({ legs: `${base}_legs`, torso: `${base}_torso` });

export const SPLIT_NOTE =
  'Two sheets of one character with one framing. Each frame of both has a `waist` socket (untrimmed-frame pixels; flipX: x = frameWidth - x). ' +
  'Draw the legs frame for the walk direction at the character\'s ground point (the usual pivot), then the torso frame for the aim direction on top, ' +
  'placed so its waist socket lands on the legs frame\'s waist socket: torso.x = legs.x + legsWaist.x - torsoWaist.x (same for y), in untrimmed-frame pixels. ' +
  'The torso always draws over the legs. A clip on both sheets (idle, crouch, death…) drawn in one direction is the whole body again.';

/** FB-126: what the whole-body sheet of a split export is for. */
export const SPLIT_WHOLE_NOTE =
  'The whole-body sheet of the same character, with the same framing (frame size, scale and feet pivot) as the legs and torso sheets, ' +
  'so a game can swap between it and the composited pair at the same ground point: the whole sheet for moves without mouse aim (keyboard play, prone, death…), ' +
  'the legs + torso pair while aiming apart from the walk.';

/** The `split` block in each sheet's data files (meta.json / the generic json and .sheet.json). */
export type SplitBlock = SsgSplit;

export function splitBlock(o: { sheet: SplitBlock['sheet']; bones: SplitBlock['bones']; legs: SplitBlock['legs']; torso: SplitBlock['torso']; whole?: Omit<NonNullable<SplitBlock['whole']>, 'note'> }): SplitBlock {
  return {
    schema: 'ssg-split/1', at: 'waist', sheet: o.sheet, pivot: WAIST_SOCKET, bones: o.bones, legs: o.legs, torso: o.torso,
    ...(o.whole ? { whole: { ...o.whole, note: SPLIT_WHOLE_NOTE } } : {}), draw: ['legs', 'torso'], note: SPLIT_NOTE,
  };
}

/**
 * Where to draw the torso frame's top-left, given the legs frame's top-left and both frames' waist sockets
 * (untrimmed frames; a flipX animation's socket is mirrored: x = frameWidth - x).
 */
export function torsoOffset(o: {
  legsAt: { x: number; y: number };
  legsWaist: { x: number; y: number };
  torsoWaist: { x: number; y: number };
  frameWidth: number;
  legsFlip?: boolean;
  torsoFlip?: boolean;
}) {
  const lx = o.legsFlip ? o.frameWidth - o.legsWaist.x : o.legsWaist.x;
  const tx = o.torsoFlip ? o.frameWidth - o.torsoWaist.x : o.torsoWaist.x;
  return { x: o.legsAt.x + lx - tx, y: o.legsAt.y + o.legsWaist.y - o.torsoWaist.y };
}
