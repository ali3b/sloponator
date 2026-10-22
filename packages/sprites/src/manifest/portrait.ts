// Moved from synty-sprite-generator packages/shared/src/export/portrait.ts (P2, ali3b/sloponator#8).
/**
 * Portraits (SF-FB-021): a head-and-shoulders still of a character, framed from its head and neck joints (so any
 * humanoid rig works), for select screens, dialogue boxes and HUDs. Written next to the sheets as
 * `<base>_portrait.png` (+ `<base>_portrait.json`).
 */

export interface PortraitSpec {
  /** Square output size in pixels (default 256); `width`/`height` set the sides apart. */
  size?: number;
  width?: number;
  height?: number;
  /**
   * Degrees the character is turned from facing the camera: 0 = front, 35 = three-quarter facing screen right
   * (default), -35 = three-quarter facing left, 90 = profile.
   */
  angle?: number;
  /** Camera pitch in degrees, looking down at the face (default 0: level). */
  pitch?: number;
  /** Background: a hex colour (#203040), or null / "transparent" (default). */
  background?: string | null;
  /** The clip whose first frame poses the bust (an exported clip's name; default the first idle, else the first clip). */
  clip?: string;
}

/** What a spec may say for `portrait` (parsePortrait reads it): the angle may be a word (front, 3/4, side). */
export type PortraitInput = boolean | number | string | (Omit<PortraitSpec, 'angle' | 'pitch'> & { angle?: number | string; pitch?: number | string }) | null;

export interface ResolvedPortrait {
  width: number;
  height: number;
  angle: number;
  pitch: number;
  background: string | null;
  clip: string | null;
}

export const PORTRAIT_DEFAULTS: ResolvedPortrait = { width: 256, height: 256, angle: 35, pitch: 0, background: null, clip: null };

/** Angle words: front, three_quarter (3/4, facing right), three_quarter_left, side / profile (facing right), side_left. */
export const PORTRAIT_ANGLES: Record<string, number> = {
  front: 0, three_quarter: 35, '3/4': 35, threequarter: 35, three_quarter_right: 35, '3/4r': 35, three_quarter_left: -35, '3/4l': -35,
  side: 90, profile: 90, side_right: 90, side_left: -90, profile_left: -90,
};

const SIZE_MIN = 16, SIZE_MAX = 2048;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const KEYS = ['size', 'width', 'height', 'angle', 'pitch', 'background', 'bg', 'clip'];

function sizeOf(v: unknown, where: string, key: string) {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < SIZE_MIN || n > SIZE_MAX) throw new Error(`${where}: portrait ${key} must be a whole number of pixels from ${SIZE_MIN} to ${SIZE_MAX} (got ${JSON.stringify(v)}).`);
  return n;
}

function angleOf(v: unknown, where: string) {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase(), word = s.replace(/(?<=[a-z])[\s-]+(?=[a-z])/g, '_');
    if (word in PORTRAIT_ANGLES) return PORTRAIT_ANGLES[word];
    const n = Number(s.replace(/(deg|°)$/, ''));
    if (s === '' || !Number.isFinite(n)) throw new Error(`${where}: portrait angle is degrees from facing the camera (-180..180) or one of ${Object.keys(PORTRAIT_ANGLES).join(', ')} (got ${JSON.stringify(v)}).`);
    v = n;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < -180 || v > 180)
    throw new Error(`${where}: portrait angle is degrees from facing the camera (-180..180) or one of ${Object.keys(PORTRAIT_ANGLES).join(', ')} (got ${JSON.stringify(v)}).`);
  return v;
}

function pitchOf(v: unknown, where: string) {
  const n = typeof v === 'string' ? Number(v.trim().replace(/(deg|°)$/, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 60) throw new Error(`${where}: portrait pitch is 0..60 degrees (got ${JSON.stringify(v)}).`);
  return n;
}

function backgroundOf(v: unknown, where: string): string | null {
  if (v === null || v === undefined || v === false) return null;
  const s = String(v).trim();
  if (['', 'transparent', 'none', 'clear'].includes(s.toLowerCase())) return null;
  if (!HEX.test(s)) throw new Error(`${where}: portrait background is a hex colour like #203040, or transparent (got ${JSON.stringify(v)}).`);
  return s.toLowerCase();
}

/**
 * A `portrait` value from a spec (sprite file, export flag, MCP): true / "on" = the defaults; a size (256); a
 * string of tokens separated by commas or spaces ("256", "320x400", "front", "3/4", "-35", "angle=20", "#203040",
 * "bg=transparent", "pitch=10", "clip=Idle"); or an object of PortraitSpec. false / null / "off" = none.
 */
export function parsePortrait(v: unknown, where = 'portrait'): PortraitSpec | null {
  if (v === undefined || v === null || v === false) return null;
  if (v === true) return {};
  if (typeof v === 'number') return { size: sizeOf(v, where, 'size') };
  if (typeof v === 'string') {
    const s = v.trim();
    if (['off', 'none', 'false', 'no'].includes(s.toLowerCase())) return null;
    if (['', 'on', 'true', 'yes'].includes(s.toLowerCase())) return {};
    const out: PortraitSpec = {};
    for (const tok of s.split(/[,\s]+/).filter(Boolean)) {
      const kv = /^([a-z]+)=(.*)$/i.exec(tok);
      if (kv) {
        Object.assign(out, parsePortrait({ [kv[1].toLowerCase()]: kv[2] }, where));
        continue;
      }
      const wh = /^(\d+)x(\d+)$/i.exec(tok);
      if (wh) {
        out.width = sizeOf(wh[1], where, 'width');
        out.height = sizeOf(wh[2], where, 'height');
      } else if (/^\d+$/.test(tok)) out.size = sizeOf(tok, where, 'size');
      else if (tok.startsWith('#') || tok.toLowerCase() === 'transparent') out.background = backgroundOf(tok, where);
      else out.angle = angleOf(tok, where);
    }
    return out;
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const unknown = Object.keys(o).filter((k) => !KEYS.includes(k));
    if (unknown.length) throw new Error(`${where}: unknown portrait key ${unknown.join(', ')} (portrait takes ${KEYS.filter((k) => k !== 'bg').join(', ')}).`);
    const out: PortraitSpec = {};
    if (o.size !== undefined) out.size = sizeOf(o.size, where, 'size');
    if (o.width !== undefined) out.width = sizeOf(o.width, where, 'width');
    if (o.height !== undefined) out.height = sizeOf(o.height, where, 'height');
    if (o.angle !== undefined) out.angle = angleOf(o.angle, where);
    if (o.pitch !== undefined) out.pitch = pitchOf(o.pitch, where);
    const bg = o.background !== undefined ? o.background : o.bg;
    if (bg !== undefined) out.background = backgroundOf(bg, where);
    if (o.clip !== undefined && o.clip !== null) {
      if (typeof o.clip !== 'string' || !o.clip.trim()) throw new Error(`${where}: portrait clip is a clip name (got ${JSON.stringify(o.clip)}).`);
      out.clip = o.clip.trim();
    }
    return out;
  }
  throw new Error(`${where}: portrait is true, a size, a string like "256,3/4,#203040" or { size, angle, pitch, background, clip } (got ${JSON.stringify(v)}).`);
}

/** The spec with every default filled in. */
export function resolvePortrait(p: PortraitSpec): ResolvedPortrait {
  const d = PORTRAIT_DEFAULTS;
  return {
    width: p.width ?? p.size ?? d.width,
    height: p.height ?? p.size ?? p.width ?? d.height,
    angle: p.angle ?? d.angle,
    pitch: p.pitch ?? d.pitch,
    background: p.background ?? d.background,
    clip: p.clip ?? d.clip,
  };
}

/** The ground facing (worldAngle, compass degrees) a portrait renders at: front faces the camera (270, south). */
export const portraitWorldAngle = (angle: number) => (((270 + angle) % 360) + 360) % 360;

/** "portrait 256×256 3/4 transparent" for dry runs and sprite settings. */
export function portraitLabel(p: PortraitSpec | null | undefined) {
  if (!p) return null;
  const r = resolvePortrait(p);
  const word = Object.entries(PORTRAIT_ANGLES).find(([k, a]) => a === r.angle && ['front', '3/4', 'three_quarter_left', 'side', 'side_left'].includes(k))?.[0];
  return `portrait ${r.width}×${r.height} ${word ?? `${r.angle}°`}${r.pitch ? ` pitch ${r.pitch}°` : ''} ${r.background ?? 'transparent'}${r.clip ? ` from ${r.clip}` : ''}`;
}

type XY = { x: number; y: number };

/** Camera-space points of the posed bust, metres (x right, y up on screen). */
export interface BustPoints {
  /** The head joint (the base of the skull). */
  head: XY;
  neck: XY;
  /** Height of the top of the head (hair, helmet). */
  crown: number;
  /** Shoulder joints (upper arms or clavicles), when the rig has them. */
  shoulders: XY[];
}

/** Room above the crown, and how far below the neck the bust goes, in head heights (neck joint to crown). */
export const BUST_HEADROOM = 0.25;
export const BUST_BELOW_NECK = 0.95;
export const BUST_BELOW_SHOULDERS = 0.55;

/**
 * Where the camera looks and how much it shows for a bust in a width × height image: from just above the crown
 * down to the upper chest (below the neck and the shoulder joints), the face roughly centred across.
 */
export function bustFraming(p: BustPoints, width: number, height: number) {
  const hh = Math.max(p.crown - p.neck.y, 0.05);
  const top = p.crown + BUST_HEADROOM * hh;
  let bottom = p.neck.y - BUST_BELOW_NECK * hh;
  if (p.shoulders.length) bottom = Math.min(bottom, Math.min(...p.shoulders.map((s) => s.y)) - BUST_BELOW_SHOULDERS * hh);
  const viewHalfH = (top - bottom) / 2;
  const viewHalfW = viewHalfH * (width / height);
  const shoulderMid = p.shoulders.length ? p.shoulders.reduce((s, q) => s + q.x, 0) / p.shoulders.length : p.neck.x;
  const centreX = 0.5 * p.head.x + 0.25 * p.neck.x + 0.25 * shoulderMid;
  return { centreX, centreY: (top + bottom) / 2, viewHalfW, viewHalfH, ppm: height / (top - bottom) };
}
