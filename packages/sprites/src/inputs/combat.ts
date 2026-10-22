// Moved from synty-sprite-generator packages/shared/src/combat.ts (P2, ali3b/sloponator#8).
/**
 * Combat support shared by the server, web renderer, CLI and MCP: clip edits (trim, speed, named events such as
 * "release" or "hit"), default weapon grips (bone + offset + custom sockets), and the naming rules that guess
 * them for Synty / Mixamo content.
 */
import type { DepthRule } from '../manifest/layers.js';

export interface ClipEventMark {
  /** Time in the source clip (seconds, before trim/speed), so trimming never moves an event. */
  t: number;
  name: string;
}

export interface ClipEdit {
  /** Trim window in source seconds (null = clip start / end). */
  start?: number | null;
  end?: number | null;
  /** Playback speed multiplier (1 = as authored). */
  speed?: number;
  events?: ClipEventMark[];
  /**
   * false: the exporter adds no automatic events to this clip (footsteps, the key moment), so `events` is the
   * whole list. Set by `ssg clip --clear-events` and by MCP `set_clip_events` with an empty list (SF-FB-006).
   */
  autoEvents?: boolean;
  /**
   * Play the (trimmed) clip backwards (SF-FB-017): a dash back becomes a dash forward, a fall a get-up. Events keep
   * their source times, so they land on the same pose. Set by `ssg clip --reverse` and MCP `set_clip_events`.
   */
  reverse?: boolean;
  /**
   * Lock the root's yaw (SF-FB-023): the hips' turn about the vertical axis is held at the clip's first key, so a
   * punch that turns the body 120° punches straight ahead in a side view. Only the hips: the upper body's twist
   * against them is kept. Set by `ssg clip --lock-yaw` and MCP `set_clip_events`.
   */
  lockYaw?: boolean;
}

/** Whether exports may add automatic events (footsteps, the key moment) to a clip with this edit. */
export function clipAutoEvents(edit: ClipEdit | null | undefined) {
  return edit?.autoEvents !== false;
}

export interface GripSocket {
  name: string;
  /** Position in the held object's own space (metres). */
  pos: [number, number, number];
}

export interface Grip {
  /** Canonical bone (hand_r, hand_l, spine3…) or a raw bone name. */
  target: string;
  pos: [number, number, number];
  /** Degrees. */
  rot: [number, number, number];
  scale: number;
  sockets?: GripSocket[];
}

/** One attachment in a batch / CLI / MCP loadout (asset by id, placement optional = its saved grip). */
export interface LoadoutItem {
  asset: number;
  target?: string;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: number;
  /** Procedural animation of the held object itself (e.g. weapon_fire). */
  layers?: { id: string; params: Record<string, number> }[];
  /** Layered exports: this item's sheet/part name (default: its slot — weapon, head, hair…). */
  layer?: string;
  /** Layered exports: force the item in front of / behind the body (per direction name, or for all). */
  depth?: DepthRule;
  /** Secondary motion for hair, capes and loose items: a spring that lags behind the bone's movement. */
  secondary?: SecondaryMotion;
  /** Start the item's own animation (e.g. a muzzle flash) at this clip event (hit, release, shoot, cast, footstep_l…). */
  trigger?: string;
  /** Weapon class (rifle, sword…): shown only during that class's clips in a multi-class export. */
  cls?: string;
  /**
   * Held only in the clips of its group (`cls`): a per-clip `with` (FB-074, `anim: [{ clip, with }]`). Hidden in every
   * other clip, baked or layered.
   */
  perClip?: boolean;
  /** This sprite's own placement fix (wins over the item's saved fixes). */
  fix?: PlacementFix;
  /** Revision of the saved placement fix this render used (renders stamp it; a change re-renders the layer). */
  fixRev?: number;
}

/**
 * A placement fix: an adjustment on top of an item's automatic placement (moveset grip rules for weapons, the
 * modelled or auto mount for attachments). Position in metres in the holding bone's frame, rotation in degrees about
 * the item's own axes (Synty: +Z barrel/blade, +Y top), optional other bone, depth rule and scale.
 */
export interface PlacementFix {
  pos?: [number, number, number];
  rot?: [number, number, number];
  target?: string;
  depth?: 'front' | 'back' | 'auto';
  scale?: number;
}

/** Saved fixes of an item by moveset ('' = any moveset), with their revisions. */
export type PlacementFixes = Record<string, PlacementFix & { rev: number; source: 'human' | 'ai-approved' }>;

/** The fix that applies to an item in a moveset: the sprite's own, else the moveset's, else the any-moveset one. */
export function placementFor(saved: PlacementFixes | null | undefined, moveset: string | null | undefined, own?: PlacementFix | null): (PlacementFix & { rev?: number }) | null {
  if (own) return own;
  return (moveset ? saved?.[moveset] : undefined) ?? saved?.[''] ?? null;
}

/** Clamp a fix to sane ranges (±0.5 m, ±180°, scale 0.25–4) and drop empty parts. */
export function cleanPlacement(p: PlacementFix): PlacementFix {
  const clampV = (v: unknown, lim: number) => (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x)) ? (v.map((x) => Math.max(-lim, Math.min(lim, Number(x)))) as [number, number, number]) : undefined);
  const out: PlacementFix = {};
  const pos = clampV(p.pos, 0.5), rot = clampV(p.rot, 180);
  if (pos && pos.some((x) => x !== 0)) out.pos = pos;
  if (rot && rot.some((x) => x !== 0)) out.rot = rot;
  if (typeof p.target === 'string' && p.target.trim()) out.target = p.target.trim();
  if (p.depth === 'front' || p.depth === 'back') out.depth = p.depth;
  if (Number.isFinite(p.scale) && p.scale !== 1) out.scale = Math.max(0.25, Math.min(4, Number(p.scale)));
  return out;
}

export interface SecondaryMotion {
  /** Pull back towards rest (1 = soft … 30 = stiff). */
  stiffness: number;
  /** Damping (0 = swings for ever … 1 = no overshoot). */
  damping: number;
  /** How much the item sags/swings with gravity (0–1). */
  gravity: number;
  /** Largest lag angle, degrees. */
  limit: number;
}

export const SECONDARY_PRESETS: Record<'soft' | 'medium' | 'stiff', SecondaryMotion> = {
  soft: { stiffness: 8, damping: 0.3, gravity: 0.6, limit: 14 },
  medium: { stiffness: 14, damping: 0.45, gravity: 0.4, limit: 9 },
  stiff: { stiffness: 25, damping: 0.6, gravity: 0.2, limit: 5 },
};

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec = (v: unknown, d: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : d;
const name = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/[^\w.-]+/g, '_').slice(0, 40) : '');

/** Validate a clip edit from a client; null when it changes nothing. */
export function cleanClipEdit(e: Partial<ClipEdit>): ClipEdit | null {
  const start = e.start == null ? null : Math.max(0, num(e.start, 0));
  const end = e.end == null ? null : Math.max(0, num(e.end, 0));
  const speed = Math.min(8, Math.max(0.1, num(e.speed, 1)));
  const events = (Array.isArray(e.events) ? e.events : [])
    .map((x) => ({ t: Math.max(0, num((x as ClipEventMark).t, 0)), name: name((x as ClipEventMark).name) }))
    .filter((x) => x.name)
    .sort((a, b) => a.t - b.t)
    .slice(0, 64);
  const noAuto = e.autoEvents === false;
  const reverse = e.reverse === true;
  const lockYaw = e.lockYaw === true;
  if (start === null && end === null && speed === 1 && !events.length && !noAuto && !reverse && !lockYaw) return null;
  return { start, end: end !== null && start !== null && end <= start ? null : end, speed, events, ...(noAuto ? { autoEvents: false } : {}), ...(reverse ? { reverse: true } : {}), ...(lockYaw ? { lockYaw: true } : {}) };
}

/**
 * One sprite's own window on a clip (SF-FB-001): a trim in SOURCE seconds (like `ssg clip --trim`) and/or a length
 * cap, for this sprite only; the shared clip and other sprites are untouched. Stored on the sprite's set item.
 */
export interface ClipWindow {
  /** Trim window in source seconds (unset/null = the shared edit's side, else the clip's start / end). */
  start?: number | null;
  end?: number | null;
  /** Cap this clip at this many seconds (wins over the sprite's maxSeconds for this clip). */
  maxSeconds?: number;
  /**
   * Play the clip backwards for this sprite (SF-FB-017), on top of the shared edit (a shared reverse is undone). A
   * reversed clip picked by name is exported as `<Clip>_reverse`, so it can sit next to the clip played forwards.
   */
  reverse?: boolean;
  /**
   * Lock the root's yaw for this sprite (SF-FB-023): true locks it, false plays the clip's turn even when the shared
   * edit locks it; unset keeps the shared edit's. The export name stays the clip's.
   */
  lockYaw?: boolean;
  /**
   * This sprite's own events for the clip (SF-FB-022), in source seconds like the shared ones: they REPLACE the
   * clip's shared events (`ssg clip --event`) for this sprite only (an empty list: none of them), and with them the
   * shared `autoEvents: false`. The automatic events (a hit's limb and hit_end window, footsteps) apply unless this
   * window's `autoEvents` is false; an event named like an automatic one (`hit`) stands in for it.
   */
  events?: ClipEventMark[];
  /** false: no automatic events (footsteps, the key moment) for this sprite's clip. */
  autoEvents?: false;
  /**
   * SF-FB-025: one frame only, the pose at this many SOURCE seconds (like a trim's start), in every direction: a still
   * for ending screens and menus, exported as a one-frame animation (default name `<Clip>_still`). Trims, caps,
   * reverse and events do not apply to it.
   */
  still?: number;
}

/** An export (animation) name a sprite gives a clip or move (SF-FB-022): letters, digits, _ and -, from a letter. */
export const ANIM_LABEL_RE = /^[A-Za-z_][\w-]*$/;

const secs = (v: string, what: string, ref: string) => {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n) || n < 0) throw new Error(`"${ref}": ${what} must be seconds (0 or more), got "${v}"`);
  return n;
};

/** "0.8:2.6", ":2.6" or "0.8:" (source seconds, either side may be empty) → a trim window. */
export function parseTrim(trim: string, ref = trim): { start: number | null; end: number | null } {
  const m = /^\s*([^:]*):([^:]*)\s*$/.exec(trim);
  if (!m) throw new Error(`"${ref}": a trim is start:end in source seconds, e.g. 0.8:2.6 (either side may be empty)`);
  const start = m[1].trim() ? secs(m[1], 'the trim start', ref) : null;
  const end = m[2].trim() ? secs(m[2], 'the trim end', ref) : null;
  if (start === null && end === null) throw new Error(`"${ref}": the trim names neither a start nor an end`);
  if (start !== null && end !== null && end <= start) throw new Error(`"${ref}": the trim end (${end}) must come after its start (${start})`);
  return { start, end };
}

/** A per-sprite window checked: numbers ≥ 0, end after start, a cap above 0; undefined when it says nothing. */
export function cleanClipWindow(w: ClipWindow | undefined, ref = 'clip'): ClipWindow | undefined {
  if (!w) return undefined;
  const out: ClipWindow = {};
  for (const k of ['start', 'end'] as const) {
    const v = w[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`"${ref}": trim ${k} must be seconds (0 or more), got ${JSON.stringify(v)}`);
    out[k] = v;
  }
  if (out.start !== undefined && out.end !== undefined && out.end! <= out.start!) throw new Error(`"${ref}": the trim end (${out.end}) must come after its start (${out.start})`);
  if (w.maxSeconds !== undefined) {
    if (typeof w.maxSeconds !== 'number' || !(w.maxSeconds > 0)) throw new Error(`"${ref}": maxSeconds must be a number of seconds above 0, got ${JSON.stringify(w.maxSeconds)}`);
    out.maxSeconds = w.maxSeconds;
  }
  if (w.reverse !== undefined && typeof w.reverse !== 'boolean') throw new Error(`"${ref}": reverse is true or false, got ${JSON.stringify(w.reverse)}`);
  if (w.reverse) out.reverse = true;
  if (w.lockYaw !== undefined && typeof w.lockYaw !== 'boolean') throw new Error(`"${ref}": lockYaw is true or false, got ${JSON.stringify(w.lockYaw)}`);
  if (w.lockYaw !== undefined) out.lockYaw = w.lockYaw;
  if (w.events !== undefined) {
    if (!Array.isArray(w.events)) throw new Error(`"${ref}": events is a list of { "t": source seconds, "name": "hit" }, got ${JSON.stringify(w.events)}`);
    out.events = w.events.map((e) => {
      const t = (e as ClipEventMark)?.t, n = (e as ClipEventMark)?.name;
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) throw new Error(`"${ref}": an event's t must be source seconds (0 or more), got ${JSON.stringify(e)}`);
      if (typeof n !== 'string' || !/^[\w.-]{1,40}$/.test(n)) throw new Error(`"${ref}": an event's name is letters, digits, _, . and - (got ${JSON.stringify(n)})`);
      return { t, name: n };
    }).sort((a, b) => a.t - b.t);
  }
  if (w.autoEvents !== undefined && (w.autoEvents as unknown) !== true) {
    if (w.autoEvents !== false) throw new Error(`"${ref}": autoEvents is true or false, got ${JSON.stringify(w.autoEvents)}`);
    out.autoEvents = false;
  }
  if (w.still !== undefined && w.still !== null) {
    if (typeof w.still !== 'number' || !Number.isFinite(w.still) || w.still < 0) throw new Error(`"${ref}": still must be source seconds (0 or more), got ${JSON.stringify(w.still)}`);
    // One frame: the window is that pose alone (a trim, cap, reverse or events would say nothing).
    const other = (['start', 'end', 'maxSeconds', 'reverse', 'events'] as const).filter((k) => out[k] !== undefined);
    if (other.length) throw new Error(`"${ref}": a still is one frame at its time: leave out ${other.map((k) => (k === 'start' || k === 'end' ? 'the trim' : k)).filter((k, i, a) => a.indexOf(k) === i).join(', ')}`);
    return { still: w.still, ...(out.lockYaw !== undefined ? { lockYaw: out.lockYaw } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** SF-FB-025: the export name a still gets when none is given: `<Clip>_still`. */
export const stillLabel = (name: string) => `${name.trim().replace(/[^\w-]+/g, '_')}_still`;

/**
 * SF-FB-025: `--still <clip>@<seconds>` (also "<clip>@<seconds>=name") as an anim ref: "Victory@still=2.4". The
 * seconds are SOURCE seconds; "Clip@still=2.4" refs pass through.
 */
export function stillRef(ref: string): string {
  const body = ref.trim();
  const m = /^(.+?)\s*@\s*(?:still\s*=\s*)?([^@=\s]+)\s*(?:=\s*([A-Za-z_][\w-]*))?$/.exec(body);
  if (!m || !m[1].trim() || m[1].includes('@')) throw new Error(`"${ref}": a still is <clip>@<seconds>, e.g. Victory_Pose@2.4 (source seconds; "=name" at the end names it)`);
  const t = secs(m[2], 'the still time', ref);
  return `${m[1].trim()}@still=${t}${m[3] ? `=${m[3]}` : ''}`;
}

/**
 * A clip or move with this sprite's window: "Clip", "Clip@0.8:2.6" (trim), "Clip@max=2" or "Clip@2s" (cap),
 * "Clip@reverse" (played backwards, SF-FB-017), "Clip@lockyaw" (the root's yaw locked, SF-FB-023; "@nolockyaw" undoes a
 * shared lock), "Clip@hit=12.1@hit_end=12.4" (this sprite's own events in source
 * seconds, SF-FB-022), "Clip@noauto" (no automatic events), or several: "Clip@0.8:2.6@max=2@reverse". A trailing
 * "=name" exports it under that name (SF-FB-022), so one clip can be used twice: "Capoeira_Kicks@0:3=kicks_a",
 * "Capoeira_Kicks@11.6:14.6=super". Used by `--anim`, the apply file's anim strings and
 * `{clip, trim, maxSeconds, reverse, lockYaw, events, autoEvents, label}` objects.
 */
export function parseAnimRef(ref: string): { name: string; window?: ClipWindow; label?: string } {
  let body = ref.trim();
  let label: string | undefined;
  // "=name" at the very end (a letter first, so the cap "max=2" and an event "hit=12.1" are not taken for it).
  const alias = /^(.*[^=\s])\s*=\s*([A-Za-z_][\w-]*)$/.exec(body);
  if (alias && !/^max(-?seconds)?$/i.test(alias[1].split('@').pop()!.trim())) {
    body = alias[1];
    label = alias[2];
  }
  const [name, ...parts] = body.split('@');
  if (!name.trim()) throw new Error(`"${ref}": name the clip or move before the @`);
  if (name.includes('=')) throw new Error(`"${ref}": export it under another name with "=name" at the very end (letters, digits, _ and -, from a letter)`);
  if (!parts.length) return { name: name.trim(), ...(label ? { label } : {}) };
  const w: ClipWindow = {};
  for (const p of parts) {
    const cap = /^\s*(?:max(?:-?seconds)?\s*=\s*([^\s]+)|([\d.]+)\s*s)\s*$/i.exec(p);
    const event = /^\s*([A-Za-z_][\w.-]*)\s*=\s*([^\s=]+)\s*$/.exec(p);
    const still = /^\s*still\s*=\s*([^\s=]+)\s*$/i.exec(p);
    if (still) w.still = secs(still[1], 'the still time', ref);
    else if (p.includes(':')) Object.assign(w, parseTrim(p, ref));
    else if (/^\s*(reverse|reversed|rev)\s*$/i.test(p)) w.reverse = true;
    else if (/^\s*no-?auto(-?events)?\s*$/i.test(p)) w.autoEvents = false;
    else if (/^\s*lock-?yaw\s*$/i.test(p)) w.lockYaw = true;
    else if (/^\s*no-?lock-?yaw\s*$/i.test(p)) w.lockYaw = false;
    else if (cap) {
      const n = secs(cap[1] ?? cap[2], 'the cap', ref);
      if (!(n > 0)) throw new Error(`"${ref}": the cap must be above 0 seconds`);
      w.maxSeconds = n;
    } else if (event) (w.events ??= []).push({ name: event[1], t: secs(event[2], `the time of event ${event[1]}`, ref) });
    else throw new Error(`"${ref}": after @ give a trim start:end in source seconds (0.8:2.6, :2.6), a cap (max=2 or 2s), reverse, lockyaw, an event (hit=1.2), noauto or still=<seconds>`);
  }
  const window = cleanClipWindow(w, ref);
  // A still (SF-FB-025) is exported as <Clip>_still unless named, so it sits next to the clip itself.
  if (window?.still !== undefined && !label) label = stillLabel(name);
  return { name: name.trim(), ...(window ? { window } : {}), ...(label ? { label } : {}) };
}

/** The `parseAnimRef` text for a clip, window and export name (the inverse). */
export function animRefString(name: string, w?: ClipWindow, label?: string): string {
  const c = cleanClipWindow(w, name);
  const as = label ? `=${label}` : '';
  if (!c) return `${name}${as}`;
  if (c.still !== undefined) return `${name}@still=${c.still}${as}`;
  const trim = c.start !== undefined || c.end !== undefined ? `@${c.start ?? ''}:${c.end ?? ''}` : '';
  const events = (c.events ?? []).map((e) => `@${e.name}=${e.t}`).join('');
  return `${name}${trim}${c.maxSeconds !== undefined ? `@max=${c.maxSeconds}` : ''}${c.reverse ? '@reverse' : ''}${c.lockYaw !== undefined ? (c.lockYaw ? '@lockyaw' : '@nolockyaw') : ''}${events}${c.autoEvents === false ? '@noauto' : ''}${as}`;
}

/**
 * The clip edit a sprite renders with: the shared edit (`ssg clip`, the Studio) with this sprite's trim on top. The
 * sprite's start/end (source seconds) REPLACE the shared ones on the sides it sets; a side it leaves open keeps the
 * shared trim. The shared speed and events still apply (events stay in source seconds, so they never move).
 */
export function spriteClipEdit(shared: ClipEdit | null | undefined, w: ClipWindow | undefined): ClipEdit | null {
  const hasStart = w?.start !== undefined && w.start !== null;
  const hasEnd = w?.end !== undefined && w.end !== null;
  // The sprite's reverse turns the clip round from how it plays shared (a shared reverse played backwards again is forwards).
  const flip = w?.reverse === true;
  // The sprite's own events replace the shared ones (SF-FB-022); its autoEvents false turns the automatic ones off.
  const ownEvents = w?.events !== undefined;
  const noAuto = w?.autoEvents === false;
  const ownYaw = w?.lockYaw !== undefined;
  if (!hasStart && !hasEnd && !flip && !ownEvents && !noAuto && !ownYaw) return shared ?? null;
  const out: ClipEdit = { ...(shared ?? {}), start: hasStart ? w!.start! : shared?.start ?? null, end: hasEnd ? w!.end! : shared?.end ?? null };
  if (ownEvents) {
    // The sprite's own events come with its own autoEvents: the shared "no automatic events" went with the shared list.
    out.events = w!.events!.map((e) => ({ ...e }));
    delete out.autoEvents;
  }
  if (noAuto) out.autoEvents = false;
  const reverse = !!shared?.reverse !== flip;
  if (reverse) out.reverse = true;
  else delete out.reverse;
  // The sprite's own yaw lock (SF-FB-023) wins over the shared one, either way.
  if (ownYaw) {
    if (w!.lockYaw) out.lockYaw = true;
    else delete out.lockYaw;
  }
  return out;
}

/**
 * Where a clip of `sourceDuration` seconds plays for a sprite: the source window, the speed, and the rendered length
 * (the cap is the clip's own maxSeconds, else the sprite's; a capped loop is cut where it joins up and retimed to the cap).
 */
export function resolveClipWindow(sourceDuration: number, shared: ClipEdit | null | undefined, w: ClipWindow | undefined, spriteMaxSeconds?: number) {
  const e = spriteClipEdit(shared, w);
  let start = Math.max(0, e?.start ?? 0);
  let end = Math.min(sourceDuration, e?.end ?? sourceDuration);
  if (end <= start) {
    // as applyClipEdit: an empty window is ignored
    start = 0;
    end = sourceDuration;
  }
  const speed = e?.speed && e.speed > 0 ? e.speed : 1;
  const maxSeconds = w?.maxSeconds ?? spriteMaxSeconds;
  const length = (end - start) / speed;
  return { start, end, speed, maxSeconds: maxSeconds ?? null, duration: maxSeconds && maxSeconds < length ? maxSeconds : length };
}

export function cleanGrip(g: Partial<Grip>): Grip | null {
  if (!g || typeof g.target !== 'string') return null;
  return {
    target: g.target.slice(0, 80),
    pos: vec(g.pos, [0, 0, 0]),
    rot: vec(g.rot, [0, 0, 0]),
    scale: Math.min(20, Math.max(0.01, num(g.scale, 1))),
    sockets: (Array.isArray(g.sockets) ? g.sockets : [])
      .map((s) => ({ name: name((s as GripSocket).name), pos: vec((s as GripSocket).pos, [0, 0, 0]) }))
      .filter((s) => s.name)
      .slice(0, 16),
  };
}

/** Which hand holds a weapon by default, from its name (bows and shields in the left hand). */
export function defaultHand(assetName: string): 'hand_l' | 'hand_r' {
  return /(^|_)(long|short|recurve|hunting|great|war|elven|orc)?bow(_|\d|$)|shield|buckler|torch|lantern|offhand/i.test(assetName) ? 'hand_l' : 'hand_r';
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
export function combatLoops(clipName: string) {
  return /idle|loop|hold|aim(?!.*shoot)|channel|run|walk|strafe/i.test(clipName) && !/death|die|hit|attack|shoot|cast|release/i.test(clipName);
}

/**
 * The event a combat clip's key moment should be called (the frame the game spawns/damages on). The clip's library
 * category (e.g. Combat/Attack set by hand) counts when its name says nothing (SF-FB-007 follow-up).
 */
export function keyEventName(clipName: string, category?: string | null): string | null {
  const c = combatCategory(clipName) ?? (category === 'Combat/Attack' ? category : null);
  if (!c) return null;
  // The Shoot category also takes every clip with "Rifle"/"Pistol"/"Aim" in its name (rifle idles, walks, aim
  // holds); only a clip that actually fires has a shot to mark.
  if (c === 'Combat/Shoot' && !/shoot|shot|fire|firing|recoil/i.test(clipName)) return /attack|slash|stab|punch|kick|strike|melee|bash|butt/i.test(clipName) ? 'hit' : null;
  return {
    'Combat/Cast': 'cast', 'Combat/Bow': 'release', 'Combat/BowDraw': 'drawn', 'Combat/Shoot': 'shoot', 'Combat/Attack': 'hit', 'Combat/Reload': 'reload',
    'Combat/Death': 'dead', 'Combat/Hit': 'hurt', 'Combat/Block': 'block', 'Combat/Dodge': 'dodge',
  }[c] ?? null;
}

/** Convert edit marks (source seconds) to times in the edited clip (after trim and speed); drops marks outside. */
export function marksToClipTimes(marks: ClipEventMark[] | undefined, edit: ClipEdit | null | undefined, sourceDuration?: number) {
  const start = edit?.start ?? 0, speed = edit?.speed ?? 1, end = Math.min(edit?.end ?? Infinity, sourceDuration ?? Infinity);
  const inside = (marks ?? []).filter((m) => m.t >= start - 1e-6 && m.t <= end + 1e-6);
  // A reversed clip (SF-FB-017) plays from the window's end back to its start: a mark keeps its pose, so its time flips.
  if (edit?.reverse && Number.isFinite(end)) return inside.map((m) => ({ t: (end - m.t) / speed, name: m.name })).sort((a, b) => a.t - b.t);
  return inside.map((m) => ({ t: (m.t - start) / speed, name: m.name }));
}

/** Nearest sample index for a time. */
export function nearestFrame(times: number[], t: number) {
  let best = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  return best;
}

/**
 * Map edit marks (source seconds) to exported frame indices for a clip sampled at `times` (edited-clip seconds).
 * Marks outside the trim window are dropped.
 */
export function marksToFrames(marks: ClipEventMark[], edit: ClipEdit | null | undefined, times: number[]) {
  const start = edit?.start ?? 0;
  const speed = edit?.speed ?? 1;
  const end = edit?.end ?? Infinity;
  const out: { frame: number; name: string }[] = [];
  for (const m of marks) {
    if (m.t < start - 1e-6 || m.t > end + 1e-6) continue;
    const t = (m.t - start) / speed;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    out.push({ frame: best, name: m.name });
  }
  return out;
}
