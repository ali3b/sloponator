// Moved from synty-sprite-generator packages/shared/src/model3d/trackpiece.ts (P3, ali3b/sloponator#14).
/**
 * Procedural track pieces (CS-FB-001): a cross-section `profile` swept along a `path` of turtle segments, on a square
 * grid of `cell` metres. Pure maths (no gltf, no database): the server turns the result into a GLB (modelBuild.ts
 * buildTrackpiece) with Synty swatch materials. docs/MODELS.md "Track pieces" is the contract.
 *
 * Frames: metres, +Y up, a piece is driven along +Z from its entry socket `in` at the origin (the middle of its entry
 * cell edge, on the ground; an elevated entry sits at [0, elevation, 0]). +X is the driver's LEFT.
 *
 * Signs: `turn` and `shift` are positive to the left (+X); `pitch` positive noses up; `bank` and `roll` positive raise
 * the right edge (the outside of a left turn), so a left turn banks with a positive angle.
 */

export type TrackVec3 = [number, number, number];

export const TRACK_SHAPES = ['flat', 'pipe', 'halfpipe', 'tunnel'] as const;
export type TrackShape = (typeof TRACK_SHAPES)[number];
export const TRACK_SIDES = ['both', 'left', 'right', 'none'] as const;
export type TrackSides = (typeof TRACK_SIDES)[number];
/** The material slots of a piece (ModelSpec.trackpiece.materials). */
export const TRACK_SLOTS = ['deck', 'kerb', 'kerbAlt', 'wall', 'support'] as const;
export type TrackSlot = (typeof TRACK_SLOTS)[number];
export const TRACK_SUPPORTS = ['auto', 'none', 'pillars', 'solid'] as const;
export type TrackSupportKind = (typeof TRACK_SUPPORTS)[number];
export const TRACK_BANK_PIVOTS = ['low-edge', 'centre'] as const;

/** Bump when the sweep or a preset changes shape: cached track pieces are rebuilt (same ids, new rev). */
export const TRACK_VERSION = 3;

/** The cross-section (all metres). Any field left out keeps the previous segment's value (or the default). */
export interface TrackProfile {
  /** flat road, closed pipe (tube, the car drives on its inside), half-pipe, or a flat road under a tunnel shell. */
  shape?: TrackShape;
  /** Drivable width between the kerbs' outer edges; for a pipe its diameter. Default 10. */
  width?: number;
  /** Kerb strip width on each edge (0: none). Default 0.6. Kerbs fade out as a profile curls up into a pipe. */
  kerb?: number;
  kerbHeight?: number;
  kerbs?: TrackSides;
  /** Wall / rail height above the deck (0: none). Default 0.8. */
  wall?: number;
  wallThickness?: number;
  walls?: TrackSides;
  /** Deck slab thickness under the surface. Default 0.5. */
  thickness?: number;
  /** Half-pipe: the radius of its curved sides (default width / 4). */
  radius?: number;
  /** Tunnel: clear height inside (default width / 2 + 2). */
  height?: number;
  /**
   * A divided road (CS-FB-012): the width of the central median strip (default 0: none). It stands `medianHeight`
   * (default 0.8, a concrete barrier; 0: a painted strip) on the deck's centre line, in the wall material.
   */
  median?: number;
  medianHeight?: number;
  /** The edge kind flat road ends report from here on (default the spec's `edge`, else `road`; e.g. `highway`). */
  edge?: string;
}

/** One turtle step. Rates are constant over the segment: turn + pitch + roll together make a helix (corkscrew). */
export interface TrackSegment {
  /** Metres along the centreline (> 0). */
  length: number;
  /** Yaw over the segment, degrees, + left. */
  turn?: number;
  /** Pitch over the segment, degrees, + nose up (a loop is 360). */
  pitch?: number;
  /** Rolls the path frame itself over the segment, degrees, + raises the right edge (corkscrews). */
  roll?: number;
  /**
   * CS-FB-027: roll about an axis this many metres above the deck (along its up at the segment's start) instead of
   * about the centre line: a barrel roll whose deck climbs the wall on the side `roll` raises (+: the right), goes
   * over the top 2 × rollRadius up and comes back down. `length` is then the distance along that axis; the roll is
   * eased (rollEase) so the segment starts and ends heading along the axis. Only with `roll` (and bank, profile,
   * blend): no turn, pitch, shift or rise.
   */
  rollRadius?: number;
  /** With rollRadius: the share of the length each end takes to ease the roll rate in or out (0–0.5, default 0.25; 0: a constant rate). */
  rollEase?: number;
  /** Deck bank at the END of the segment (absolute degrees, eased from the previous end); + raises the right edge. */
  bank?: number;
  /** Sideways offset over the segment, metres, + left, eased in and out (the end direction is unchanged). */
  shift?: number;
  /** Upward offset over the segment, metres, eased (an S-shaped slope with level ends). */
  rise?: number;
  /** This segment's profile, merged over the previous one. A step at the segment's start, or with blend eased over it. */
  profile?: TrackProfile;
  /** Ease from the previous segment's profile to this one over the segment (pipe↔road transitions). */
  blend?: boolean;
  /** No geometry: the path flies on (the gap of a jump). */
  gap?: boolean;
}

/** An extra path of a piece (a split's branch, a crossroads arm). */
export interface TrackBranch {
  /** Socket name(s): `name` for its one open end, `name_in` / `name_out` when both are open. */
  name: string;
  /** Start where the main path is after this many segments (0: the entry). Not with `start`. */
  from?: number;
  /** Or start here: a position in the piece and a heading (degrees, 0 = +Z, + left). */
  start?: { pos: TrackVec3; heading?: number; bank?: number };
  path: TrackSegment[];
  /** Profile changes over the main path's (the profile where it starts). */
  profile?: TrackProfile;
  /** Which ends are open (get sockets). Default `end` for `from`, `both` for `start`. */
  open?: 'start' | 'end' | 'both' | 'none';
}

export interface TrackSupports {
  kind: TrackSupportKind;
  /** Pillars: metres between them along the path (default 15). */
  spacing?: number;
  /** Pillars: the side of their square section (default 1.6). */
  size?: number;
}

export const TRACK_PRESETS = [
  'straight', 'curve-left', 'curve-right', 'banked-curve-left', 'banked-curve-right', 'bank-transition', 'slope-up', 'slope-down', 'ramp', 'landing',
  'jump', 'loop', 'corkscrew-left', 'corkscrew-right', 'pipe', 'pipe-in', 'pipe-out', 'halfpipe', 'halfpipe-in', 'halfpipe-out', 'tunnel', 'bridge',
  'chicane-left', 'chicane-right', 'split-left', 'split-right', 'crossroads', 'helix-left', 'helix-right', 'widen', 'narrow', 'barrel-roll',
] as const;
export type TrackPreset = (typeof TRACK_PRESETS)[number];

/** Preset parameters a trackpiece spec may give next to `preset` (each preset takes some of them; see TRACK_PRESET_PARAMS). */
export interface TrackPresetParams {
  /** Cells along the piece (straight, slope, ramp, jump, loop inline is 2, corkscrew, pipe, tunnel, bridge, chicane). */
  length?: number;
  /** Curves and splits: the footprint in cells (1: 1×1, radius half a cell; 2: 2×2, radius 1.5 cells). */
  size?: number;
  /** Curves: degrees turned (default 90). Ramps / jumps: the lip angle (default 20). */
  angle?: number;
  /**
   * Loop: its radius in metres (default 0.4 cell). Curves: the centre-line radius (instead of size; default
   * (size - 0.5) cells). Pipe: the tube's radius (default width / 2). Half-pipe: its sides' radius. Helix: its radius
   * (default half a cell). Barrel roll: the roll axis's height above the deck (default width / 2, a pipe's radius).
   */
  radius?: number;
  /** Banked curve: the bank (default 30). */
  bank?: number;
  /** Banked curve: the share of the arc each bank ramp takes at each end (default 0.25). Slope: the share of the run each curved end takes (default 0.25; 0.5 = no straight; 0 = a constant grade end to end, the ends pitched). */
  transition?: number;
  /** Banked curve: bank at the entry / exit (default 0: level ends that join any flat piece). Bank transition: from / to. */
  bankIn?: number;
  bankOut?: number;
  /** Bank transition: the bank at the entry / exit (degrees). Narrow / widen: the wide profile at the entry / exit ({ width, edge, median… }). */
  from?: number | TrackProfile;
  to?: number | TrackProfile;
  /** Chicane: true makes it a lane change, the exit `shift` metres to the side of the entry (default false: an S-bend that ends in line). */
  offset?: boolean;
  /** Helix: cells it advances along its entry heading while it turns (default 0: the exit sits over the entry). */
  travel?: number;
  /**
   * Slopes: the rise (m); ramps / jumps: the lip height; bridges: the deck height; tunnels: the clear height; helix:
   * the climb over its turn (negative descends).
   */
  height?: number;
  /** Loop and chicane: the sideways offset (m). Corkscrew: the cells it moves sideways (default 1). */
  shift?: number;
  side?: number;
  /** Loop: `offset` (default; the exit leaves `shift` metres to the side of the entry, 1 cell long) or `inline` (2 cells, exit on the centre line). */
  align?: 'offset' | 'inline';
  /** Loop: which way the exit moves (default right). Barrel roll: the wall the deck climbs first (default right). */
  turn?: 'left' | 'right';
}

export const TRACK_PRESET_PARAMS: Record<TrackPreset, (keyof TrackPresetParams)[]> = {
  straight: ['length'],
  'curve-left': ['size', 'radius', 'angle'],
  'curve-right': ['size', 'radius', 'angle'],
  'banked-curve-left': ['size', 'radius', 'angle', 'bank', 'transition', 'bankIn', 'bankOut'],
  'banked-curve-right': ['size', 'radius', 'angle', 'bank', 'transition', 'bankIn', 'bankOut'],
  'bank-transition': ['length', 'from', 'to'],
  'slope-up': ['length', 'height', 'transition'],
  'slope-down': ['length', 'height', 'transition'],
  ramp: ['length', 'height', 'angle'],
  landing: ['length', 'height', 'angle'],
  jump: ['length', 'height', 'angle'],
  loop: ['radius', 'shift', 'align', 'turn'],
  'corkscrew-left': ['length', 'side'],
  'corkscrew-right': ['length', 'side'],
  pipe: ['length', 'radius'],
  'pipe-in': ['length', 'radius'],
  'pipe-out': ['length', 'radius'],
  halfpipe: ['length', 'radius'],
  'halfpipe-in': ['length', 'radius'],
  'halfpipe-out': ['length', 'radius'],
  tunnel: ['length', 'height'],
  bridge: ['length', 'height'],
  'chicane-left': ['length', 'shift', 'offset'],
  'chicane-right': ['length', 'shift', 'offset'],
  'split-left': ['size'],
  'split-right': ['size'],
  crossroads: [],
  'helix-left': ['radius', 'height', 'angle', 'travel'],
  'helix-right': ['radius', 'height', 'angle', 'travel'],
  widen: ['length', 'to'],
  narrow: ['length', 'from'],
  'barrel-roll': ['length', 'radius', 'angle', 'transition', 'turn'],
};

/** ModelSpec.trackpiece: a preset (with its parameters) or a path of segments. */
export interface TrackpieceSpec extends TrackPresetParams {
  preset?: TrackPreset;
  /** The grid's cell in metres (default 30). */
  cell?: number;
  /** Declared footprint in cells [across (X), along (Z)]; checked against the geometry (a warning when it does not fit). */
  footprint?: [number, number];
  /** Height of the entry above the ground (default 0; a preset may set it, e.g. a bridge). */
  elevation?: number;
  /** Entry bank and pitch, degrees (default 0). */
  bank?: number;
  pitch?: number;
  /** Bank about the edge that goes down, which stays at path height (default), or about the centre line. */
  bankPivot?: (typeof TRACK_BANK_PIVOTS)[number];
  /** The cross-section at the entry. `width` is a shorthand for profile.width. */
  profile?: TrackProfile;
  width?: number;
  path?: TrackSegment[];
  branches?: TrackBranch[];
  /** Synty swatches per slot: "Pack/Asset" (its dominant colour), "Pack/Asset#rrggbb" (its texel nearest that colour), "Pack/Material[#rrggbb]", or "#rrggbb". */
  materials?: Partial<Record<TrackSlot, string>>;
  /** Pillars or a solid fill down to y = 0 under elevated parts; `auto` (default) pillars where the deck is over 1.5 m up, solid for ramps. */
  supports?: TrackSupportKind | TrackSupports;
  /** Kerb stripe length in metres (default 2). */
  stripe?: number;
  /**
   * The edge kind a flat road end reports in its socket (default `road`; e.g. `highway` for a dual carriageway).
   * Raised flat ends report `elevated` (or `<edge>-elevated`); pipes, half-pipes, tunnels and banked ends their own.
   */
  edge?: string;
}

export class TrackSpecError extends Error {}

// ---- defaults ------------------------------------------------------------------------------------------------
export const TRACK_DEFAULT_CELL = 30;
const PROFILE_DEFAULTS: Required<Omit<TrackProfile, 'radius' | 'height' | 'edge'>> = {
  shape: 'flat', width: 10, kerb: 0.6, kerbHeight: 0.12, kerbs: 'both', wall: 0.8, wallThickness: 0.4, walls: 'both', thickness: 0.5, median: 0, medianHeight: 0.8,
};

/** Default materials: Synty swatches by reference (docs/MODELS.md). Each falls back to its colour when the pack is missing. */
export const TRACK_DEFAULT_MATERIALS: Record<TrackSlot, { ref: string; fallback: string }> = {
  deck: { ref: 'POLYGON_City/SM_Env_Road_Bare_01', fallback: '#454545' },
  kerb: { ref: 'POLYGON_Pro_Racer/SM_Prop_Barrier_05#c0392b', fallback: '#8e3a2e' },
  kerbAlt: { ref: 'POLYGON_Pro_Racer/SM_Prop_Barrier_05#ffffff', fallback: '#c5c2bf' },
  wall: { ref: 'POLYGON_Pro_Racer/SM_Env_Road_Wall_01', fallback: '#696767' },
  support: { ref: 'POLYGON_City/SM_Env_Bridge_Pillar_01', fallback: '#95908b' },
};

// ---- validation ----------------------------------------------------------------------------------------------
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

function num(v: unknown, what: string, lo: number, hi: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new TrackSpecError(`${what} must be a number ${lo}–${hi}`);
  return r4(n);
}
function oneOf<T extends string>(v: unknown, what: string, list: readonly T[]): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new TrackSpecError(`${what} must be one of ${list.join(', ')}`);
  return v as T;
}
function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TrackSpecError(`${what} must be an object`);
  return v as Record<string, unknown>;
}
function onlyKeys(o: Record<string, unknown>, what: string, keys: readonly string[]) {
  const bad = Object.keys(o).filter((k) => !keys.includes(k));
  if (bad.length) throw new TrackSpecError(`${what}: unknown field${bad.length > 1 ? 's' : ''} ${bad.map((k) => `"${k}"`).join(', ')} (allowed: ${keys.join(', ')})`);
}

const PROFILE_KEYS = ['shape', 'width', 'kerb', 'kerbHeight', 'kerbs', 'wall', 'wallThickness', 'walls', 'thickness', 'radius', 'height', 'median', 'medianHeight', 'edge'] as const;
const EDGE_RE = /^[a-z][a-z0-9_-]{0,31}$/i;
function checkProfile(v: unknown, what: string): TrackProfile {
  const o = obj(v, what);
  onlyKeys(o, what, PROFILE_KEYS);
  const p: TrackProfile = {};
  if (o.shape !== undefined) p.shape = oneOf(o.shape, `${what}.shape`, TRACK_SHAPES);
  if (o.width !== undefined) p.width = num(o.width, `${what}.width`, 1, 100);
  if (o.kerb !== undefined) p.kerb = num(o.kerb, `${what}.kerb`, 0, 5);
  if (o.kerbHeight !== undefined) p.kerbHeight = num(o.kerbHeight, `${what}.kerbHeight`, 0, 2);
  if (o.kerbs !== undefined) p.kerbs = oneOf(o.kerbs, `${what}.kerbs`, TRACK_SIDES);
  if (o.wall !== undefined) p.wall = num(o.wall, `${what}.wall`, 0, 20);
  if (o.wallThickness !== undefined) p.wallThickness = num(o.wallThickness, `${what}.wallThickness`, 0.02, 5);
  if (o.walls !== undefined) p.walls = oneOf(o.walls, `${what}.walls`, TRACK_SIDES);
  if (o.thickness !== undefined) p.thickness = num(o.thickness, `${what}.thickness`, 0.02, 10);
  if (o.radius !== undefined) p.radius = num(o.radius, `${what}.radius`, 0.2, 100);
  if (o.height !== undefined) p.height = num(o.height, `${what}.height`, 1, 100);
  if (o.median !== undefined) p.median = num(o.median, `${what}.median`, 0, 50);
  if (o.medianHeight !== undefined) p.medianHeight = num(o.medianHeight, `${what}.medianHeight`, 0, 10);
  if (o.edge !== undefined) {
    if (typeof o.edge !== 'string' || !EDGE_RE.test(o.edge)) throw new TrackSpecError(`${what}.edge must be a short name (letters, digits, _ or -), e.g. highway`);
    p.edge = o.edge;
  }
  if (p.median !== undefined && p.width !== undefined && p.median > p.width - 2) throw new TrackSpecError(`${what}.median must leave at least 1 m of road each side of it`);
  return p;
}

const SEGMENT_KEYS = ['length', 'turn', 'pitch', 'roll', 'rollRadius', 'rollEase', 'bank', 'shift', 'rise', 'profile', 'blend', 'gap'] as const;
function checkSegments(v: unknown, what: string): TrackSegment[] {
  if (!Array.isArray(v) || !v.length) throw new TrackSpecError(`${what} must be a list of segments ({ length, turn?, pitch?, roll?, bank?, shift?, rise?, profile?, blend?, gap? })`);
  if (v.length > 256) throw new TrackSpecError(`${what}: at most 256 segments`);
  return v.map((raw, i) => {
    const w = `${what}[${i}]`;
    const o = obj(raw, w);
    onlyKeys(o, w, SEGMENT_KEYS);
    const s: TrackSegment = { length: num(o.length, `${w}.length`, 0.01, 5000) };
    for (const k of ['turn', 'pitch', 'roll'] as const) if (o[k] !== undefined && o[k] !== 0) s[k] = num(o[k], `${w}.${k}`, -1440, 1440);
    // bank is absolute: 0 levels the deck out (left out, it keeps the previous segment's).
    if (o.bank !== undefined) s.bank = num(o.bank, `${w}.bank`, -1440, 1440);
    if (s.bank !== undefined && Math.abs(s.bank) > 180) throw new TrackSpecError(`${w}.bank must be -180–180 degrees`);
    for (const k of ['shift', 'rise'] as const) if (o[k] !== undefined && o[k] !== 0) s[k] = num(o[k], `${w}.${k}`, -1000, 1000);
    if (o.profile !== undefined) s.profile = checkProfile(o.profile, `${w}.profile`);
    for (const k of ['blend', 'gap'] as const) {
      if (o[k] === undefined) continue;
      if (typeof o[k] !== 'boolean') throw new TrackSpecError(`${w}.${k} must be true or false`);
      if (o[k]) s[k] = true;
    }
    if (o.rollRadius !== undefined) {
      s.rollRadius = num(o.rollRadius, `${w}.rollRadius`, 0.1, 500);
      if (!s.roll) throw new TrackSpecError(`${w}.rollRadius goes with a roll (the degrees to turn about the raised axis)`);
      const other = (['turn', 'pitch', 'shift', 'rise'] as const).filter((k) => s[k]);
      if (other.length) throw new TrackSpecError(`${w}: a roll about a raised axis (rollRadius) takes no ${other.join(', ')}`);
      if (o.rollEase !== undefined) s.rollEase = num(o.rollEase, `${w}.rollEase`, 0, 0.5);
    } else if (o.rollEase !== undefined) throw new TrackSpecError(`${w}.rollEase goes with rollRadius`);
    return s;
  });
}

const vec3 = (v: unknown, what: string): TrackVec3 => {
  if (!Array.isArray(v) || v.length !== 3) throw new TrackSpecError(`${what} must be [x, y, z] in metres`);
  return v.map((x, i) => num(x, `${what}[${i}]`, -10000, 10000)) as TrackVec3;
};

const SPEC_KEYS = [
  'preset', 'cell', 'footprint', 'elevation', 'bank', 'pitch', 'bankPivot', 'profile', 'width', 'path', 'branches', 'materials', 'supports', 'stripe', 'edge',
  'length', 'size', 'angle', 'radius', 'transition', 'bankIn', 'bankOut', 'from', 'to', 'height', 'shift', 'side', 'align', 'turn', 'offset', 'travel',
] as const;
const PARAM_KEYS: (keyof TrackPresetParams)[] = ['length', 'size', 'angle', 'radius', 'bank', 'transition', 'bankIn', 'bankOut', 'from', 'to', 'height', 'shift', 'side', 'align', 'turn', 'offset', 'travel'];

/**
 * Check a trackpiece spec and drop what is default, so equal pieces hash the same (numbers rounded to 0.1 mm / 0.0001°).
 * A TrackSpecError names the bad field.
 */
export function normaliseTrackpiece(raw: unknown): TrackpieceSpec {
  const o = obj(raw, 'trackpiece');
  onlyKeys(o, 'trackpiece', SPEC_KEYS);
  const t: TrackpieceSpec = {};
  if (o.preset !== undefined) t.preset = oneOf(o.preset, 'trackpiece.preset', TRACK_PRESETS);
  if (o.path !== undefined) {
    if (t.preset) throw new TrackSpecError('trackpiece: give a preset or a path, not both');
    t.path = checkSegments(o.path, 'trackpiece.path');
  }
  if (!t.preset && !t.path) throw new TrackSpecError(`trackpiece needs a preset (${TRACK_PRESETS.join(', ')}) or a path of segments`);
  // Preset parameters: only those the preset takes (bank is also the entry bank of a custom path).
  const allowed = t.preset ? TRACK_PRESET_PARAMS[t.preset] : (['bank'] as (keyof TrackPresetParams)[]);
  for (const k of PARAM_KEYS) {
    if (o[k] === undefined) continue;
    if (!allowed.includes(k)) throw new TrackSpecError(`trackpiece: ${t.preset ? `preset ${t.preset}` : 'a custom path'} does not take "${k}"${t.preset ? ` (it takes ${TRACK_PRESET_PARAMS[t.preset].join(', ') || 'no parameters'})` : ''}`);
    if (k === 'align') t.align = oneOf(o.align, 'trackpiece.align', ['offset', 'inline'] as const);
    else if (k === 'turn') t.turn = oneOf(o.turn, 'trackpiece.turn', ['left', 'right'] as const);
    else if ((k === 'from' || k === 'to') && (t.preset === 'widen' || t.preset === 'narrow')) {
      const pr = checkProfile(o[k], `trackpiece.${k}`);
      if (!Object.keys(pr).length) throw new TrackSpecError(`trackpiece.${k} must give the ${t.preset === 'widen' ? 'exit' : 'entry'} profile, e.g. { "width": 43.9, "edge": "highway", "median": 3 }`);
      t[k] = pr;
    } else if (k === 'offset') {
      if (typeof o.offset !== 'boolean') throw new TrackSpecError('trackpiece.offset must be true or false');
      if (o.offset) t.offset = true;
    } else if (k === 'travel') {
      if (o.travel !== 0) t.travel = num(o.travel, 'trackpiece.travel', 0, 32);
    } else if (k === 'side') t.side = num(o.side, 'trackpiece.side', 0, 32);
    else if (k === 'length' || k === 'size') t[k] = num(o[k], `trackpiece.${k}`, 0.1, 32);
    else if (k === 'transition') t.transition = num(o.transition, 'trackpiece.transition', 0, 0.5);
    else if (k === 'radius' || k === 'height' || k === 'shift') t[k] = num(o[k], `trackpiece.${k}`, k === 'shift' || (k === 'height' && t.preset?.startsWith('helix')) ? -500 : 0.1, 500);
    else t[k] = num(o[k], `trackpiece.${k}`, k === 'angle' ? 1 : -180, k === 'angle' && (t.preset?.startsWith('helix') || t.preset === 'barrel-roll') ? 1440 : 180);
  }
  if (o.cell !== undefined) t.cell = num(o.cell, 'trackpiece.cell', 2, 500);
  if (o.footprint !== undefined) {
    if (!Array.isArray(o.footprint) || o.footprint.length !== 2 || !o.footprint.every((n) => Number.isInteger(n) && n >= 1 && n <= 32))
      throw new TrackSpecError('trackpiece.footprint must be [cells across, cells along], whole numbers 1–32');
    t.footprint = [o.footprint[0], o.footprint[1]] as [number, number];
  }
  if (o.elevation !== undefined && o.elevation !== 0) t.elevation = num(o.elevation, 'trackpiece.elevation', -100, 2000);
  if (o.pitch !== undefined && o.pitch !== 0) t.pitch = num(o.pitch, 'trackpiece.pitch', -90, 90);
  if (o.bankPivot !== undefined) t.bankPivot = oneOf(o.bankPivot, 'trackpiece.bankPivot', TRACK_BANK_PIVOTS);
  const profile = o.profile !== undefined ? checkProfile(o.profile, 'trackpiece.profile') : {};
  if (o.width !== undefined) {
    if (profile.width !== undefined) throw new TrackSpecError('trackpiece: give width or profile.width, not both');
    profile.width = num(o.width, 'trackpiece.width', 1, 100);
  }
  if (Object.keys(profile).length) t.profile = profile;
  if (o.branches !== undefined) {
    if (!Array.isArray(o.branches) || o.branches.length > 8) throw new TrackSpecError('trackpiece.branches must be a list of at most 8 { name, from | start, path, profile?, open? }');
    if (t.preset && o.branches.length) throw new TrackSpecError('trackpiece: branches go with a custom path (presets bring their own)');
    t.branches = o.branches.map((b, i) => {
      const w = `trackpiece.branches[${i}]`;
      const bo = obj(b, w);
      onlyKeys(bo, w, ['name', 'from', 'start', 'path', 'profile', 'open']);
      const name = typeof bo.name === 'string' ? bo.name.trim() : '';
      if (!/^[A-Za-z][\w-]{0,31}$/.test(name)) throw new TrackSpecError(`${w}.name must be a socket name (a letter, then letters, digits, _ or -)`);
      const br: TrackBranch = { name, path: checkSegments(bo.path, `${w}.path`) };
      if (bo.from !== undefined && bo.start !== undefined) throw new TrackSpecError(`${w}: give from or start, not both`);
      if (bo.start !== undefined) {
        const so = obj(bo.start, `${w}.start`);
        onlyKeys(so, `${w}.start`, ['pos', 'heading', 'bank']);
        br.start = { pos: vec3(so.pos, `${w}.start.pos`) };
        if (so.heading !== undefined && so.heading !== 0) br.start.heading = num(so.heading, `${w}.start.heading`, -360, 360);
        if (so.bank !== undefined && so.bank !== 0) br.start.bank = num(so.bank, `${w}.start.bank`, -180, 180);
      } else {
        const from = bo.from === undefined ? 0 : bo.from;
        if (!Number.isInteger(from) || (from as number) < 0 || (from as number) > (t.path?.length ?? 0)) throw new TrackSpecError(`${w}.from must be a segment count 0–${t.path?.length ?? 0}`);
        br.from = from as number;
      }
      if (bo.profile !== undefined) br.profile = checkProfile(bo.profile, `${w}.profile`);
      if (bo.open !== undefined) br.open = oneOf(bo.open, `${w}.open`, ['start', 'end', 'both', 'none'] as const);
      return br;
    });
    const names = ['in', 'out', ...t.branches.flatMap((b) => [b.name, `${b.name}_in`, `${b.name}_out`])];
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) throw new TrackSpecError(`trackpiece.branches: the socket name "${dup}" is used twice`);
  }
  if (o.materials !== undefined) {
    const mo = obj(o.materials, 'trackpiece.materials');
    onlyKeys(mo, 'trackpiece.materials', TRACK_SLOTS);
    const m: Partial<Record<TrackSlot, string>> = {};
    for (const k of TRACK_SLOTS) {
      if (mo[k] === undefined) continue;
      if (typeof mo[k] !== 'string' || !String(mo[k]).trim()) throw new TrackSpecError(`trackpiece.materials.${k} must be "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb"`);
      const ref = String(mo[k]).trim();
      if (ref.startsWith('#') && !/^#[0-9a-f]{6}$/i.test(ref)) throw new TrackSpecError(`trackpiece.materials.${k}: a colour must be #rrggbb`);
      m[k] = ref.startsWith('#') ? ref.toLowerCase() : ref;
    }
    if (Object.keys(m).length) t.materials = m;
  }
  if (o.supports !== undefined) {
    if (typeof o.supports === 'string') {
      const k = oneOf(o.supports, 'trackpiece.supports', TRACK_SUPPORTS);
      if (k !== 'auto') t.supports = k;
    } else {
      const so = obj(o.supports, 'trackpiece.supports');
      onlyKeys(so, 'trackpiece.supports', ['kind', 'spacing', 'size']);
      const s: TrackSupports = { kind: oneOf(so.kind ?? 'pillars', 'trackpiece.supports.kind', TRACK_SUPPORTS) };
      if (so.spacing !== undefined) s.spacing = num(so.spacing, 'trackpiece.supports.spacing', 2, 500);
      if (so.size !== undefined) s.size = num(so.size, 'trackpiece.supports.size', 0.1, 20);
      t.supports = s;
    }
  }
  if (o.stripe !== undefined) t.stripe = num(o.stripe, 'trackpiece.stripe', 0.2, 100);
  if (o.edge !== undefined) {
    if (typeof o.edge !== 'string' || !EDGE_RE.test(o.edge)) throw new TrackSpecError('trackpiece.edge must be a short name (letters, digits, _ or -), e.g. highway');
    if (o.edge !== 'road') t.edge = o.edge;
  }
  if (t.preset) expandTrackpiece(t); // a preset whose parameters do not fit (a loop larger than its cell) fails here
  return t;
}

/** The piece's default name (ModelSpec.name when left out). */
export const trackpieceName = (t: TrackpieceSpec) => `track_${t.preset ?? 'custom'}`.replace(/-/g, '_');

// ---- profile resolution --------------------------------------------------------------------------------------
type FullProfile = Required<Omit<TrackProfile, 'radius' | 'height' | 'edge'>> & { radius?: number; height?: number; edge?: string };

/** A profile as numbers that interpolate (shape becomes the bend of its sides). */
export interface ResolvedProfile {
  /** Side bend in degrees: flat 0, half-pipe 90, pipe 180. */
  beta: number;
  /** Radius of the curved sides, and the flat bottom's width. */
  rc: number;
  f: number;
  /** Half the drivable width (the bank pivot). */
  hw: number;
  kerbL: number; kerbR: number; kh: number;
  wallL: number; wallR: number; wt: number;
  th: number;
  /** Tunnel: 1 when the shell is built, its clear height. */
  roof: number; tunnelH: number;
  /** Median strip width and height. */
  med: number; mh: number;
}

const sideHas = (s: TrackSides, side: 'left' | 'right') => s === 'both' || s === side;

export function resolveProfile(p: FullProfile): ResolvedProfile {
  const w = p.width;
  let beta = 0, rc = w / 2, f = w;
  if (p.shape === 'pipe') {
    beta = 180;
    rc = p.radius ?? w / 2;
    f = 0;
  }
  else if (p.shape === 'halfpipe') {
    rc = Math.min(p.radius ?? w / 4, w / 2);
    beta = 90;
    f = Math.max(0, w - 2 * rc);
  }
  return {
    beta, rc, f, hw: w / 2,
    kerbL: sideHas(p.kerbs, 'left') ? p.kerb : 0, kerbR: sideHas(p.kerbs, 'right') ? p.kerb : 0, kh: p.kerbHeight,
    wallL: p.shape === 'tunnel' || !sideHas(p.walls, 'left') ? 0 : p.wall, wallR: p.shape === 'tunnel' || !sideHas(p.walls, 'right') ? 0 : p.wall, wt: p.wallThickness,
    th: p.thickness,
    roof: p.shape === 'tunnel' ? 1 : 0, tunnelH: Math.max(p.height ?? w / 2 + 2, w / 2 + 0.5),
    med: p.shape === 'flat' || p.shape === 'tunnel' ? p.median : 0, mh: p.medianHeight,
  };
}

const mergeProfile = (a: FullProfile, b: TrackProfile | undefined): FullProfile => {
  if (!b) return a;
  const out = { ...a, ...b };
  // A shape change resets the shape's own radius unless given again.
  if (b.shape && b.shape !== a.shape && b.radius === undefined) delete out.radius;
  return out as FullProfile;
};

const lerpProfile = (a: ResolvedProfile, b: ResolvedProfile, x: number): ResolvedProfile => {
  const o = {} as ResolvedProfile;
  for (const k of Object.keys(a) as (keyof ResolvedProfile)[]) o[k] = a[k] + (b[k] - a[k]) * x;
  o.roof = a.roof && b.roof ? 1 : 0;
  return o;
};

// ---- presets -------------------------------------------------------------------------------------------------
/** A piece ready to sweep: the entry frame, the main path and branches with their profiles, the supports. */
export interface ExpandedTrack {
  cell: number;
  elevation: number;
  bank: number;
  pitch: number;
  bankPivot: 'low-edge' | 'centre';
  profile: FullProfile;
  path: TrackSegment[];
  branches: TrackBranch[];
  supports: Required<TrackSupports>;
  stripe: number;
  /** The name flat road ends report (TrackpieceSpec.edge). */
  edge: string;
}

const DEG = Math.PI / 180;

/**
 * A slope that rises `h` over a horizontal `run` with level ends: an arc pitching up by theta over `tr` of the run, a
 * straight at that grade, the mirror arc. Solved for theta (bisection); r is the arcs' radius.
 */
export function slopeArcs(run: number, h: number, tr: number) {
  const f = (th: number) => run * (2 * tr * (1 - Math.cos(th)) / Math.sin(th) + (1 - 2 * tr) * Math.tan(th)) - h;
  let lo = 1e-9, hi = (89 * Math.PI) / 180;
  if (f(hi) < 0) throw new TrackSpecError(`trackpiece: a rise of ${h} m over ${run} m is too steep`);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  const theta = (lo + hi) / 2;
  return { theta, r: (tr * run) / Math.sin(theta), straight: (run * (1 - 2 * tr)) / Math.cos(theta) };
}

/** Expand a (normalised) spec: a preset becomes segments with its parameters worked out on the grid. */
export function expandTrackpiece(t: TrackpieceSpec): ExpandedTrack {
  const c = t.cell ?? TRACK_DEFAULT_CELL;
  const base: FullProfile = { ...PROFILE_DEFAULTS, ...(t.profile ?? {}) } as FullProfile;
  const w = base.width;
  // The road's whole width with its walls: what a loop or split must clear.
  const outer = w + 2 * (base.wall > 0 && base.walls !== 'none' ? base.wallThickness : 0);
  let elevation = t.elevation ?? 0;
  let bank = t.bank ?? 0;
  let pitch = t.pitch ?? 0;
  let profile = base;
  let supports: TrackSupportKind = 'auto';
  let path: TrackSegment[] = t.path ?? [];
  let branches: TrackBranch[] = t.branches ?? [];
  const L = (cells: number | undefined, d = 1) => (cells ?? d) * c;
  const fail = (m: string) => {
    throw new TrackSpecError(`trackpiece ${t.preset}: ${m}`);
  };
  const p = t.preset;
  if (p === 'straight') path = [{ length: L(t.length) }];
  else if (p === 'curve-left' || p === 'curve-right' || p === 'banked-curve-left' || p === 'banked-curve-right') {
    const sgn = p.endsWith('left') ? 1 : -1;
    if (t.size !== undefined && t.radius !== undefined) fail('give size or radius, not both');
    const size = t.size ?? (p.startsWith('banked') ? 2 : 1);
    const R = t.radius ?? (size - 0.5) * c;
    if (R < w / 2 + 0.5) fail(`a radius of ${r4(R)} m is too tight for a ${w} m road`);
    const ang = t.angle ?? 90;
    const arc = R * ang * DEG;
    if (p.startsWith('banked')) {
      const b = (t.bank ?? 30) * sgn;
      const tr = t.transition ?? 0.25;
      bank = (t.bankIn ?? 0) * sgn;
      const out = (t.bankOut ?? 0) * sgn;
      path = [
        ...(tr > 0 ? [{ length: arc * tr, turn: ang * tr * sgn, bank: b }] : []),
        { length: arc * (1 - 2 * tr), turn: ang * (1 - 2 * tr) * sgn, bank: b },
        ...(tr > 0 ? [{ length: arc * tr, turn: ang * tr * sgn, bank: out }] : []),
      ];
      if (tr === 0) {
      bank = b;
      path[0].bank = b;
    }
      supports = 'solid';
    } else path = [{ length: arc, turn: ang * sgn }];
  } else if (p === 'bank-transition') {
    bank = (t.from as number | undefined) ?? 0;
    path = [{ length: L(t.length), bank: (t.to as number | undefined) ?? 30 }];
    supports = 'solid';
  } else if (p === 'slope-up' || p === 'slope-down') {
    // Level ends, curved over `transition` of the run each, a straight of constant grade between (exact closed-form arcs).
    // CS-FB-020: transition 0 is one straight at a constant grade end to end (the ends pitched, as a planar hill tile).
    const h = t.height ?? c / 5;
    const run = L(t.length);
    const tr = t.transition ?? 0.25;
    const sg = p === 'slope-up' ? 1 : -1;
    if (p === 'slope-down') elevation += h;
    if (tr === 0) {
      pitch = (Math.atan2(h, run) / DEG) * sg;
      path = [{ length: Math.hypot(run, h) }];
    } else {
      const { theta, r, straight } = slopeArcs(run, h, tr);
      const deg = (theta / DEG) * sg;
      path = [{ length: r * theta, pitch: deg }, ...(straight > 1e-6 ? [{ length: straight }] : []), { length: r * theta, pitch: -deg }];
    }
    supports = 'solid';
  } else if (p === 'ramp' || p === 'landing' || p === 'jump') {
    const h = t.height ?? 2.5;
    const th = (t.angle ?? 20) * DEG;
    const r = h / (1 - Math.cos(th));
    const run = r * Math.sin(th);
    const cells = t.length ?? (p === 'jump' ? 3 : 1);
    const lip = p === 'jump' ? c : cells * c;
    if (run > lip + 1e-9) fail(`a ${t.height ?? 2.5} m lip at ${t.angle ?? 20}° needs ${r4(run)} m, more than ${r4(lip)} m: lower it or steepen it`);
    const up: TrackSegment[] = [...(lip - run > 1e-6 ? [{ length: lip - run }] : []), { length: r * th, pitch: (t.angle ?? 20) }];
    const down: TrackSegment[] = [{ length: r * th, pitch: (t.angle ?? 20) }, ...(lip - run > 1e-6 ? [{ length: lip - run }] : [])];
    if (p === 'ramp') path = up;
    else if (p === 'landing') {
      elevation += h;
      pitch = -(t.angle ?? 20);
      path = down;
    } else {
      if (cells < 3) fail('a jump is at least 3 cells long (ramp, gap, landing)');
      // The gap: a symmetric arc from the lip (pitched up) to the landing (pitched down) over the middle cells.
      const G = (cells - 2) * c;
      const rg = G / (2 * Math.sin(th));
      path = [...up, { length: 2 * th * rg, pitch: -2 * (t.angle ?? 20), gap: true }, ...down];
    }
    supports = 'solid';
  } else if (p === 'loop') {
    const r = t.radius ?? 0.4 * c;
    const s = (t.shift ?? outer + 0.5) * (t.turn === 'left' ? 1 : -1);
    const quarter = (Math.PI / 2) * r;
    if (Math.abs(s) < outer) fail(`a shift of ${Math.abs(s)} m is less than the road's ${r4(outer)} m: the exit would hit the entry`);
    const loop: TrackSegment[] = [
      { length: quarter, pitch: 90 },
      { length: 2 * quarter, pitch: 180, shift: (t.align === 'inline' ? 1 : 1) * s },
      { length: quarter, pitch: 90 },
    ];
    if (t.align === 'inline') {
      if (r > c - 1) fail(`radius ${r} m does not fit 2 cells of ${c} m`);
      path = [{ length: c - r, shift: -s / 2 }, { length: r }, ...loop, { length: r }, { length: c - r, shift: -s / 2 }];
    } else {
      if (r > c / 2 - 0.5) fail(`radius ${r} m does not fit a ${c} m cell (at most ${c / 2 - 0.5} m; or align: inline, 2 cells)`);
      path = [{ length: c / 2 }, ...loop, { length: c / 2 }];
    }
  } else if (p === 'corkscrew-left' || p === 'corkscrew-right') {
    const D = L(t.length, 2);
    const S = (t.side ?? 1) * c;
    // One screw turn (constant pitch and roll rates): it comes back level, `S` to the side and `D` on.
    const rho = S / D;
    const k = Math.hypot(1, rho);
    const len = D * (1 + rho * rho);
    const sgn = p === 'corkscrew-left' ? 1 : -1;
    path = [{ length: len, pitch: (360 * rho) / k, roll: (sgn * 360) / k }];
  } else if (p === 'barrel-roll') {
    // CS-FB-027: a roll about an axis `radius` above the deck, along the entry: up one wall, over the top 2 × radius
    // up, down the other, level in and out with the exit on the entry's line `length` cells on.
    const R = t.radius ?? w / 2;
    const sgn = t.turn === 'left' ? -1 : 1;
    path = [{ length: L(t.length, 2), roll: (t.angle ?? 360) * sgn, rollRadius: R, ...(t.transition !== undefined ? { rollEase: t.transition } : {}) }];
    supports = 'none';
  } else if (p === 'pipe' || p === 'halfpipe' || p === 'tunnel') {
    profile = mergeProfile(base, p === 'tunnel' ? { shape: 'tunnel', ...(t.height ? { height: t.height } : {}) } : { shape: p, ...(t.radius ? { radius: t.radius } : {}), ...(p === 'halfpipe' ? { wall: 0 } : {}) });
    path = [{ length: L(t.length) }];
  } else if (p === 'helix-left' || p === 'helix-right') {
    // A full turn (or `angle`) on a circle while climbing `height`, eased so both ends are level: the exit sits over the entry.
    const sgn = p === 'helix-left' ? 1 : -1;
    const R = t.radius ?? c / 2;
    if (R < w / 2 + 0.5) fail(`a radius of ${r4(R)} m is too tight for a ${w} m road`);
    const ang = t.angle ?? 360;
    const h = t.height ?? 0.44 * c;
    if (h < 0) elevation += -h;
    const helix: TrackSegment = { length: R * ang * DEG, turn: ang * sgn, rise: h };
    // travel (CS-FB-011): level straights of half the advance before and after the turn, so the exit is `travel`
    // cells on from the entry in the same column (the turn's circle beside them).
    const D = (t.travel ?? 0) * c;
    path = D > 0 ? [{ length: D / 2 }, helix, { length: D / 2 }] : [helix];
  } else if (p === 'pipe-in' || p === 'pipe-out' || p === 'halfpipe-in' || p === 'halfpipe-out') {
    const tube: TrackProfile = p.startsWith('pipe') ? { shape: 'pipe', ...(t.radius ? { radius: t.radius } : {}) } : { shape: 'halfpipe', wall: 0, ...(t.radius ? { radius: t.radius } : {}) };
    const road: TrackProfile = { shape: 'flat', wall: base.wall };
    if (p.endsWith('-in')) path = [{ length: L(t.length), profile: tube, blend: true }];
    else {
      profile = mergeProfile(base, tube);
      path = [{ length: L(t.length), profile: road, blend: true }];
    }
  } else if (p === 'bridge') {
    elevation += t.height ?? 8;
    path = [{ length: L(t.length) }];
    supports = 'pillars';
  } else if (p === 'chicane-left' || p === 'chicane-right') {
    const s = (t.shift ?? 0.6 * w) * (p === 'chicane-left' ? 1 : -1);
    const len = L(t.length);
    // offset (CS-FB-011): one eased shift, a lane change whose exit is `shift` to the side, heading on.
    path = t.offset ? [{ length: len, shift: s }] : [{ length: len / 2, shift: s }, { length: len / 2, shift: -s }];
  } else if (p === 'widen' || p === 'narrow') {
    // CS-FB-012: the profile eased from the road to the wide one (width, median, edge) over the piece, or back.
    // Default: three times the road's width with a 3 m median, a highway (14.63 m → 43.89 m).
    const W = ((p === 'widen' ? t.to : t.from) as TrackProfile | undefined) ?? { width: r4(Math.min(100, 3 * w)), median: 3, edge: 'highway' };
    if ((W.median ?? 0) > (W.width ?? w) - 2) fail(`a ${W.median} m median does not fit a ${W.width ?? w} m road`);
    // The road end: every field the wide profile sets, back at the spec's own value (and the spec's edge).
    const road: TrackProfile = { ...Object.fromEntries(Object.keys(W).map((k) => [k, (base as Record<string, unknown>)[k]])), edge: t.edge ?? 'road' };
    if (p === 'widen') path = [{ length: L(t.length), profile: W, blend: true }];
    else {
      profile = mergeProfile(base, W);
      path = [{ length: L(t.length), profile: road, blend: true }];
    }
  } else if (p === 'split-left' || p === 'split-right') {
    const sgn = p === 'split-left' ? 1 : -1;
    const size = t.size ?? 2;
    const R = (size - 0.5) * c;
    const hw = outer / 2;
    if (R < 3 * hw) fail(`size ${size} is too tight to split a ${r4(outer)} m road`);
    // The branch's outer edge leaves the main road's edge at this angle: up to there each drops its walls and kerbs on the shared side.
    const phi = Math.acos((R - hw) / (R + hw));
    const zClear = Math.min(size * c, (R + hw) * Math.sin(phi) + 1);
    const branchSide: TrackSides = sgn > 0 ? 'left' : 'right';
    const mainSide: TrackSides = sgn > 0 ? 'right' : 'left';
    path = [{ length: zClear, profile: { walls: mainSide, kerbs: mainSide } }, ...(size * c - zClear > 1e-6 ? [{ length: size * c - zClear, profile: { walls: 'both' as const, kerbs: 'both' as const } }] : [])];
    const phiDeg = phi / DEG + 2;
    branches = [{
      name: 'branch', from: 0, open: 'end',
      path: [{ length: R * phiDeg * DEG, turn: sgn * phiDeg, profile: { walls: branchSide, kerbs: branchSide } }, { length: R * (90 - phiDeg) * DEG, turn: sgn * (90 - phiDeg), profile: { walls: 'both', kerbs: 'both' } }],
    }];
  } else if (p === 'crossroads') {
    const hw = outer / 2;
    // The main road drops its walls and kerbs where the arms join; each arm runs from its cell edge to the main deck's edge.
    path = [{ length: c / 2 - hw }, { length: 2 * hw, profile: { walls: 'none', kerbs: 'none' } }, { length: c / 2 - hw, profile: { walls: 'both', kerbs: 'both' } }];
    branches = [
      { name: 'left', start: { pos: [c / 2, 0, c / 2], heading: -90 }, open: 'start', path: [{ length: c / 2 - w / 2 }] },
      { name: 'right', start: { pos: [-w / 2, 0, c / 2], heading: -90 }, open: 'end', path: [{ length: c / 2 - w / 2 }] },
    ];
  }
  if (!path.length) throw new TrackSpecError('trackpiece: the path is empty');
  const sp = t.supports;
  const kind = sp === undefined ? supports : typeof sp === 'string' ? sp : sp.kind;
  const spObj: Partial<TrackSupports> = typeof sp === 'object' ? sp : {};
  return {
    cell: c,
    elevation,
    bank,
    pitch,
    bankPivot: t.bankPivot ?? 'low-edge',
    profile,
    path,
    branches,
    supports: { kind, spacing: spObj.spacing ?? 15, size: spObj.size ?? 1.6 },
    stripe: t.stripe ?? 2,
    edge: t.edge ?? 'road',
  };
}

// ---- vectors -------------------------------------------------------------------------------------------------
type V = TrackVec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulS = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** v turned about the unit axis a by phi (Rodrigues). */
const rotate = (v: V, a: V, phi: number): V => {
  const c = Math.cos(phi), s = Math.sin(phi);
  return add(add(mulS(v, c), mulS(cross(a, v), s)), mulS(a, dot(a, v) * (1 - c)));
};

/** A frame on the path: position, forward (tangent), up and right (= forward × up). */
export interface TrackFrame {
  p: V;
  t: V;
  u: V;
  r: V;
}

const ease = (x: number) => x * x * (3 - 2 * x);
const easeD = (x: number) => 6 * x * (1 - x);

/**
 * Where a segment takes the turtle: the frame at `s` metres into it (0..length), its true tangent with any shift or
 * rise, before the bank. Constant body rates make every segment a screw motion, so this is exact (closed form).
 */
export function segmentFrame(start: TrackFrame, seg: TrackSegment, s: number): TrackFrame {
  const L = seg.length;
  if (seg.rollRadius) return offsetRollFrame(start, seg, s);
  // Body angular velocity per metre in (left, up, forward) coordinates (right-handed: left × up = forward): turn about
  // +up, pitch about +right (= -left), roll about -forward.
  const wb: V = [(-(seg.pitch ?? 0) * DEG) / L, ((seg.turn ?? 0) * DEG) / L, (-(seg.roll ?? 0) * DEG) / L];
  const k = len(wb);
  const F = (v: V): V => add(add(mulS(start.r, -v[0]), mulS(start.u, v[1])), mulS(start.t, v[2]));
  let ub: V = [0, 1, 0], tb: V = [0, 0, 1];
  let I: V;
  if (k * L < 1e-12) I = [0, 0, s];
  else {
    const a = mulS(wb, 1 / k);
    const phi = k * s;
    ub = rotate(ub, a, phi);
    tb = rotate(tb, a, phi);
    const e: V = [0, 0, 1];
    I = add(add(mulS(e, Math.sin(phi) / k), mulS(cross(a, e), (1 - Math.cos(phi)) / k)), mulS(a, dot(a, e) * (s - Math.sin(phi) / k)));
  }
  const x = L > 0 ? s / L : 1;
  // Shift (+left = -right) and rise move along the segment's start frame, eased in and out.
  const D = add(mulS(start.r, -(seg.shift ?? 0)), mulS(start.u, seg.rise ?? 0));
  const p = add(add(start.p, F(I)), mulS(D, ease(x)));
  const t0 = F(tb), u0 = F(ub);
  const t = norm(add(t0, mulS(D, easeD(x) / L)));
  const u = norm(sub(u0, mulS(t, dot(u0, t))));
  return { p, t, u, r: cross(t, u) };
}

/**
 * The share of a roll done `x` (0..1) into a segment whose rate eases in over `tr` of it and out over the last `tr`
 * (a half-cosine ramp, constant between), and its derivative. tr 0: linear.
 */
export function rollEased(x: number, tr: number): { g: number; dg: number } {
  if (tr <= 0) return { g: x, dg: 1 };
  const A = 1 - tr;
  const ramp = (u: number) => u / 2 - (tr / (2 * Math.PI)) * Math.sin((Math.PI * u) / tr);
  const w = (u: number) => (1 - Math.cos((Math.PI * u) / tr)) / 2;
  if (x <= tr) return { g: ramp(x) / A, dg: w(x) / A };
  if (x >= 1 - tr) return { g: 1 - ramp(1 - x) / A, dg: w(1 - x) / A };
  return { g: (tr / 2 + x - tr) / A, dg: 1 / A };
}

/**
 * CS-FB-027: a roll about an axis `rollRadius` above the start frame's deck, along its forward: `s` metres along that
 * axis the deck has turned psi about it (eased), so its centre is R(1 − cos psi) up and R sin psi to the right
 * (+roll), its up points at the axis. Exact (closed form).
 */
function offsetRollFrame(start: TrackFrame, seg: TrackSegment, s: number): TrackFrame {
  const L = seg.length, R = seg.rollRadius!;
  const { g, dg } = rollEased(L > 0 ? s / L : 1, seg.rollEase ?? 0.25);
  const total = (seg.roll ?? 0) * DEG;
  const psi = total * g, dpsi = (total * dg) / L;
  const c = Math.cos(psi), sn = Math.sin(psi);
  const p = add(add(add(start.p, mulS(start.t, s)), mulS(start.u, R * (1 - c))), mulS(start.r, R * sn));
  const u = sub(mulS(start.u, c), mulS(start.r, sn));
  const rr = add(mulS(start.r, c), mulS(start.u, sn));
  const t = norm(add(start.t, mulS(rr, R * dpsi)));
  return { p, t, u, r: cross(t, u) };
}

/** The frame a piece starts with: the entry socket, pitched and at its elevation. */
export function entryFrame(ex: Pick<ExpandedTrack, 'elevation' | 'pitch'>): TrackFrame {
  const pt = ex.pitch * DEG;
  const t: V = [0, Math.sin(pt), Math.cos(pt)];
  const u: V = [0, Math.cos(pt), -Math.sin(pt)];
  return { p: [0, ex.elevation, 0], t, u, r: cross(t, u) };
}

/** Bank the frame: +b raises the right edge. With a low-edge pivot the frame is lifted so the low edge stays put. */
function banked(f: TrackFrame, bank: number, hw: number, pivot: 'low-edge' | 'centre'): TrackFrame {
  const b = bank * DEG;
  const r = add(mulS(f.r, Math.cos(b)), mulS(f.u, Math.sin(b)));
  const u = sub(mulS(f.u, Math.cos(b)), mulS(f.r, Math.sin(b)));
  const p = pivot === 'low-edge' ? add(f.p, mulS(f.u, hw * Math.abs(Math.sin(b)))) : f.p;
  return { p, t: f.t, u, r };
}

/** One sampled point of a path: the banked frame, the profile there, and arc length. */
interface Ring {
  f: TrackFrame;
  prof: ResolvedProfile;
  s: number;
}

interface SegRun {
  seg: TrackSegment;
  rings: Ring[];
  flags: SectionFlags;
  /** Arc length where the segment starts (within its path). */
  s0: number;
}

interface PathTrace {
  runs: SegRun[];
  /** The banked frames at each segment boundary (index i = after i segments). */
  ends: TrackFrame[];
  /** The unbanked turtle frames and banks at each boundary (to start branches). */
  turtles: { f: TrackFrame; bank: number; profile: FullProfile }[];
  length: number;
}

/**
 * Walk a path: per segment, sample rings (frames and profiles) dense enough for its turns and bank and profile
 * changes. Segment boundaries are exact; rings in between are where the sweep puts its vertices.
 */
function tracePath(start: TrackFrame, startBank: number, startProfile: FullProfile, segs: TrackSegment[], pivot: 'low-edge' | 'centre', stripe: number, arcs: boolean): PathTrace {
  let f = start, bank = startBank, prof = startProfile, sAcc = 0;
  const runs: SegRun[] = [];
  const startRes = resolveProfile(startProfile);
  const ends: TrackFrame[] = [banked(start, bank, startRes.hw, pivot)];
  const turtles = [{ f: start, bank, profile: startProfile }];
  for (const seg of segs) {
    const p1 = mergeProfile(prof, seg.profile);
    const ra = resolveProfile(seg.blend ? prof : p1), rb = resolveProfile(p1);
    const b0 = bank, b1 = seg.bank ?? bank;
    const ang = Math.hypot(seg.turn ?? 0, seg.pitch ?? 0, seg.roll ?? 0);
    const changes = Math.abs(b1 - b0) / 5 + (seg.blend ? Math.max(Math.abs(rb.beta - ra.beta) / 10, 4) : 0);
    const kerb = Math.max(ra.kerbL, ra.kerbR, rb.kerbL, rb.kerbR) > 0;
    // Rings: at most 2 m apart (one kerb stripe), 5° of turn apart, a step every 5° of bank, finer for shifts.
    let n = Math.max(1, Math.ceil(seg.length / Math.min(2, stripe)), Math.ceil(ang / 5), Math.ceil(changes), seg.shift || seg.rise ? Math.ceil(seg.length / 1.5) : 0);
    if (seg.gap) n = 1;
    else if (kerb) n = Math.max(n, Math.round(seg.length / stripe));
    const rings: Ring[] = [];
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      const fr = segmentFrame(f, seg, seg.length * x);
      const e = ease(x);
      const pr = seg.blend ? lerpProfile(ra, rb, e) : rb;
      rings.push({ f: banked(fr, b0 + (b1 - b0) * e, pr.hw, pivot), prof: pr, s: sAcc + seg.length * x });
    }
    const flags: SectionFlags = {
      kerb,
      wall: Math.max(ra.wallL, ra.wallR, rb.wallL, rb.wallR) > 0,
      roof: !!(ra.roof && rb.roof),
      arcs,
      ...(Math.max(ra.med, rb.med) > 0 ? { median: true } : {}),
    };
    runs.push({ seg, rings, flags, s0: sAcc });
    f = segmentFrame(f, seg, seg.length);
    bank = b1;
    prof = p1;
    sAcc += seg.length;
    ends.push(banked(f, bank, rb.hw, pivot));
    turtles.push({ f, bank, profile: prof });
  }
  return { runs, ends, turtles, length: sAcc };
}

// ---- the cross-section ---------------------------------------------------------------------------------------
type P2 = [number, number];
/** A swept face: a section edge from p to q, `out` a direction its face looks (to orient the winding). */
interface Edge {
  p: P2;
  q: P2;
  out: P2;
  slot: TrackSlot | 'stripe';
  collide?: boolean;
}
interface Section {
  edges: Edge[];
  /** End caps: convex polygons (quads) in section coordinates. */
  caps: { pts: P2[]; slot: TrackSlot }[];
  /** Outermost bottom corners (left, right): where a solid fill drops to the ground. */
  bottom: [P2, P2];
}

const ARC_STEPS = 12;
const ROOF_STEPS = 12;

/**
 * The cross-section at one ring (a = metres to the right, h = metres up the deck's normal). Its edges come in the
 * same order for every ring of a segment (the flags fix the topology), so consecutive rings zip into quads.
 */
export interface SectionFlags {
  kerb: boolean;
  wall: boolean;
  roof: boolean;
  arcs: boolean;
  /** A median strip on the centre line (CS-FB-012). */
  median?: boolean;
}

export function buildSection(pr: ResolvedProfile, flags: SectionFlags): Section {
  const K = flags.arcs ? ARC_STEPS : 0;
  // One side of the surface from the centre outwards: the flat half, then the curved side.
  const half: { a: number; h: number; n: P2 }[] = [{ a: pr.f / 2, h: 0, n: [0, 1] }];
  for (let j = 1; j <= K; j++) {
    const ph = (pr.beta * DEG * j) / K;
    half.push({ a: pr.f / 2 + pr.rc * Math.sin(ph), h: pr.rc * (1 - Math.cos(ph)), n: [-Math.sin(ph), Math.cos(ph)] });
  }
  const surf: { p: P2; n: P2 }[] = [
    ...half.slice().reverse().map((x) => ({ p: [-x.a, x.h] as P2, n: [-x.n[0], x.n[1]] as P2 })),
    ...half.map((x) => ({ p: [x.a, x.h] as P2, n: x.n })),
  ];
  const under = surf.map((x) => ({ p: [x.p[0] - x.n[0] * pr.th, x.p[1] - x.n[1] * pr.th] as P2, n: x.n }));
  const edges: Edge[] = [];
  const caps: Section['caps'] = [];
  const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const away = (a: P2, b: P2, from: P2): P2 => [mid(a, b)[0] - from[0], mid(a, b)[1] - from[1]];
  for (let j = 0; j + 1 < surf.length; j++) {
    const a = surf[j], b = surf[j + 1];
    const n: P2 = [(a.n[0] + b.n[0]) / 2, (a.n[1] + b.n[1]) / 2];
    edges.push({ p: a.p, q: b.p, out: n, slot: 'deck', collide: true });
    edges.push({ p: under[j].p, q: under[j + 1].p, out: [-n[0], -n[1]], slot: 'support' });
    caps.push({ pts: [a.p, b.p, under[j + 1].p, under[j].p], slot: 'deck' });
  }
  // The slab's two sides (outward along the surface at each edge).
  const sideOut = (i: number, sign: number): P2 => {
    const n = surf[i].n;
    return [n[1] * sign, -n[0] * sign];
  };
  const last = surf.length - 1;
  edges.push({ p: under[0].p, q: surf[0].p, out: sideOut(0, -1), slot: 'deck' });
  edges.push({ p: surf[last].p, q: under[last].p, out: sideOut(last, 1), slot: 'deck' });
  let bottom: [P2, P2] = [under[0].p, under[last].p];
  // Kerbs and walls stand on the edges, along the surface's normal there; `t` points outward along the surface.
  for (const side of [-1, 1] as const) {
    const e = side < 0 ? surf[0] : surf[last];
    const t = sideOut(side < 0 ? 0 : last, side);
    const n = e.n;
    const at = (x: number, y: number): P2 => [e.p[0] + t[0] * x + n[0] * y, e.p[1] + t[1] * x + n[1] * y];
    const fade = Math.max(0, 1 - pr.beta / 90);
    const k = (side < 0 ? pr.kerbL : pr.kerbR) * fade;
    if (flags.kerb) {
      const q = [at(-k, 0), at(0, 0), at(0, pr.kh * fade), at(-k, pr.kh * fade)];
      const c: P2 = mid(q[0], q[2]);
      edges.push({ p: q[3], q: q[0], out: away(q[3], q[0], c), slot: 'stripe' });
      edges.push({ p: q[2], q: q[3], out: away(q[2], q[3], c), slot: 'stripe' });
      edges.push({ p: q[1], q: q[2], out: away(q[1], q[2], c), slot: 'stripe' });
      caps.push({ pts: q, slot: 'kerb' });
    }
    const H = (side < 0 ? pr.wallL : pr.wallR) * Math.max(0, 1 - pr.beta / 180);
    if (flags.wall) {
      const wt = pr.wt * (H > 1e-6 ? 1 : 0);
      const q = [at(0, -pr.th), at(wt, -pr.th), at(wt, H), at(0, H)];
      const c: P2 = mid(q[0], q[2]);
      for (let j = 0; j < 4; j++) edges.push({ p: q[j], q: q[(j + 1) % 4], out: away(q[j], q[(j + 1) % 4], c), slot: 'wall', collide: j === 3 });
      caps.push({ pts: q, slot: 'wall' });
      if (side < 0) bottom = [q[1], bottom[1]];
      else bottom = [bottom[0], q[1]];
    }
  }
  if (flags.median) {
    // A median strip on the centre line: a barrier box standing on the deck (it grows from nothing as the width
    // blends up from 0, so a widening road's median starts as a nose).
    const m = pr.med * Math.max(0, 1 - pr.beta / 90);
    const H = pr.mh * Math.min(1, m);
    const q: P2[] = [[-m / 2, 0], [m / 2, 0], [m / 2, H], [-m / 2, H]];
    const c: P2 = [0, H / 2];
    for (const j of [1, 2, 3]) edges.push({ p: q[j], q: q[(j + 1) % 4], out: away(q[j], q[(j + 1) % 4], c), slot: 'wall', collide: true });
    caps.push({ pts: q, slot: 'wall' });
  }
  if (flags.roof) {
    // A tunnel shell: walls up from the deck edges, a half-circle roof. Inner face drivable-solid (collider), outer face out.
    const R = pr.hw, st = Math.max(pr.wt, 0.3);
    const hWall = Math.max(0, pr.tunnelH - R);
    const inner: P2[] = [[pr.hw, -pr.th], [pr.hw, hWall]];
    const outerPts: P2[] = [[pr.hw + st, -pr.th], [pr.hw + st, hWall]];
    for (let j = 1; j < ROOF_STEPS; j++) {
      const ph = (Math.PI * j) / ROOF_STEPS;
      inner.push([R * Math.cos(ph), hWall + R * Math.sin(ph)]);
      outerPts.push([(R + st) * Math.cos(ph), hWall + (R + st) * Math.sin(ph)]);
    }
    inner.push([-pr.hw, hWall], [-pr.hw, -pr.th]);
    outerPts.push([-pr.hw - st, hWall], [-pr.hw - st, -pr.th]);
    const centre: P2 = [0, hWall];
    for (let j = 0; j + 1 < inner.length; j++) {
      const o = away(inner[j], inner[j + 1], centre);
      edges.push({ p: inner[j], q: inner[j + 1], out: [-o[0], -o[1]], slot: 'wall', collide: true });
      edges.push({ p: outerPts[j], q: outerPts[j + 1], out: away(outerPts[j], outerPts[j + 1], centre), slot: 'wall' });
      caps.push({ pts: [inner[j], inner[j + 1], outerPts[j + 1], outerPts[j]], slot: 'wall' });
    }
    edges.push({ p: outerPts[0], q: inner[0], out: [0, -1], slot: 'wall' });
    edges.push({ p: inner[inner.length - 1], q: outerPts[outerPts.length - 1], out: [0, -1], slot: 'wall' });
    bottom = [outerPts[outerPts.length - 1], outerPts[0]];
  }
  return { edges, caps, bottom };
}

// ---- the sweep -----------------------------------------------------------------------------------------------
export interface TrackSocket {
  name: string;
  /** in: forward points into the piece (you drive in here); out: forward points out of it. */
  dir: 'in' | 'out';
  pos: V;
  forward: V;
  up: V;
  /**
   * What the end is, to match neighbours: road (or the spec's `edge`, e.g. highway), elevated (a flat end above the
   * ground), banked-left / banked-right (bank raising the right / left edge), pipe, halfpipe or tunnel.
   */
  edge: string;
  /** The drivable width there (a pipe: its diameter) and the bank, degrees. */
  width: number;
  bank: number;
  /** A divided road: the median strip's width (left out when there is none). */
  median?: number;
}

/** A socket's edge kind (TrackSocket.edge). */
export function edgeKind(p: Pick<TrackProfile, 'shape'>, bank: number, height: number, base = 'road') {
  if (p.shape === 'pipe' || p.shape === 'halfpipe' || p.shape === 'tunnel') return p.shape;
  if (Math.abs(bank) > 0.5) return bank > 0 ? 'banked-left' : 'banked-right';
  if (height > 0.5) return base === 'road' ? 'elevated' : `${base}-elevated`;
  return base;
}

export interface TrackMesh {
  /** Flat-shaded triangles per material slot (xyz per vertex, three vertices a triangle). */
  slots: Record<TrackSlot, { pos: number[]; nrm: number[] }>;
  /** The collider: drivable surfaces and walls, welded, indexed. */
  collider: { pos: number[]; idx: number[] };
  sockets: TrackSocket[];
  bounds: { min: V; max: V };
  /** The grid cells the geometry covers: [across, along], and the lowest cell's corner [x, z]. */
  footprint: { cells: [number, number]; min: [number, number] };
  /** Centre-line length of the main path, metres. */
  length: number;
  supports: TrackSupportKind;
  warnings: string[];
}

const toWorld = (f: TrackFrame, q: P2): V => add(f.p, add(mulS(f.r, q[0]), mulS(f.u, q[1])));
const dirWorld = (f: TrackFrame, q: P2): V => add(mulS(f.r, q[0]), mulS(f.u, q[1]));

/** Sweep an expanded piece into triangles, its collider and its sockets. */
export function sweepTrack(ex: ExpandedTrack): TrackMesh {
  const slots = Object.fromEntries(TRACK_SLOTS.map((s) => [s, { pos: [] as number[], nrm: [] as number[] }])) as TrackMesh['slots'];
  const col: number[] = [];
  const warnings: string[] = [];
  const tri = (slot: TrackSlot, a: V, b: V, c: V, ref: V) => {
    let n = cross(sub(b, a), sub(c, a));
    const l = len(n);
    if (l < 1e-9) return;
    n = mulS(n, 1 / l);
    if (dot(n, ref) < 0) {
      [b, c] = [c, b];
      n = mulS(n, -1);
    }
    slots[slot].pos.push(...a, ...b, ...c);
    slots[slot].nrm.push(...n, ...n, ...n);
  };
  const quad = (slot: TrackSlot, a: V, b: V, c: V, d: V, ref: V) => {
    tri(slot, a, b, c, ref);
    tri(slot, a, c, d, ref);
  };
  const colTri = (a: V, b: V, c: V) => {
    if (len(cross(sub(b, a), sub(c, a))) < 1e-9) return;
    col.push(...a, ...b, ...c);
  };

  const anyArcs = (ps: FullProfile[]) => ps.some((p) => p.shape === 'pipe' || p.shape === 'halfpipe');
  const profilesOf = (start: FullProfile, segs: TrackSegment[]) => {
    const out = [start];
    let p = start;
    for (const s of segs) out.push((p = mergeProfile(p, s.profile)));
    return out;
  };
  const sweepRuns = (trace: PathTrace) => {
    for (const run of trace.runs) {
      if (run.seg.gap) continue;
      const secs = run.rings.map((r) => buildSection(r.prof, run.flags));
      for (let i = 0; i + 1 < run.rings.length; i++) {
        const A = run.rings[i], B = run.rings[i + 1];
        const sa = secs[i], sb = secs[i + 1];
        const stripeSlot: TrackSlot = Math.floor(((A.s + B.s) / 2) / ex.stripe + 1e-9) % 2 === 0 ? 'kerb' : 'kerbAlt';
        sa.edges.forEach((e, j) => {
          const eb = sb.edges[j];
          const pa = toWorld(A.f, e.p), qa = toWorld(A.f, e.q), pb = toWorld(B.f, eb.p), qb = toWorld(B.f, eb.q);
          const ref = add(dirWorld(A.f, e.out), dirWorld(B.f, eb.out));
          quad(e.slot === 'stripe' ? stripeSlot : e.slot, pa, qa, qb, pb, ref);
          if (e.collide) {
            colTri(pa, qa, qb);
            colTri(pa, qb, pb);
          }
        });
        // A solid fill: from the outermost bottom corners straight down to the ground, where the deck is upright.
        if (ex.supports.kind === 'solid' && A.f.u[1] > 0.3 && B.f.u[1] > 0.3) {
          for (const k of [0, 1] as const) {
            const pa = toWorld(A.f, sa.bottom[k]), pb = toWorld(B.f, sb.bottom[k]);
            if (pa[1] <= 0.01 && pb[1] <= 0.01) continue;
            const ga: V = [pa[0], Math.min(0, pa[1]), pa[2]], gb: V = [pb[0], Math.min(0, pb[1]), pb[2]];
            const out = mulS(add(A.f.r, B.f.r), k === 0 ? -1 : 1);
            quad('support', pa, pb, gb, ga, [out[0], 0, out[2]]);
          }
        }
      }
      // End caps of the segment (hidden where the next segment carries on; they close profile steps and the piece ends).
      for (const [ring, sec, sign] of [[run.rings[0], secs[0], -1], [run.rings[run.rings.length - 1], secs[secs.length - 1], 1]] as const) {
        const ref = mulS(ring.f.t, sign);
        for (const c of sec.caps) {
          const w = c.pts.map((q) => toWorld(ring.f, q));
          for (let j = 1; j + 1 < w.length; j++) tri(c.slot, w[0], w[j], w[j + 1], ref);
        }
        if (ex.supports.kind === 'solid' && ring.f.u[1] > 0.3) {
          const [l, r] = sec.bottom.map((q) => toWorld(ring.f, q));
          if (l[1] > 0.01 || r[1] > 0.01) quad('support', l, r, [r[0], Math.min(0, r[1]), r[2]], [l[0], Math.min(0, l[1]), l[2]], ref);
        }
      }
    }
  };

  const start = entryFrame(ex);
  const mainProfiles = profilesOf(ex.profile, ex.path);
  const branchStarts = ex.branches.map((b) => b);
  const allProfiles = [...mainProfiles, ...branchStarts.flatMap((b) => profilesOf(mergeProfile(ex.profile, b.profile), b.path))];
  const arcs = anyArcs(allProfiles);
  const main = tracePath(start, ex.bank, ex.profile, ex.path, ex.bankPivot, ex.stripe, arcs);
  const traces: { trace: PathTrace; name: string | null; open: 'start' | 'end' | 'both' | 'none' }[] = [{ trace: main, name: null, open: 'both' }];
  for (const b of ex.branches) {
    let f: TrackFrame, bank: number, prof: FullProfile;
    if (b.start) {
      const h = (b.start.heading ?? 0) * DEG;
      const t: V = [Math.sin(h), 0, Math.cos(h)];
      f = { p: b.start.pos, t, u: [0, 1, 0], r: cross(t, [0, 1, 0]) };
      bank = b.start.bank ?? 0;
      prof = mergeProfile(ex.profile, b.profile);
    } else {
      const at = main.turtles[b.from ?? 0];
      f = at.f;
      bank = at.bank;
      prof = mergeProfile(at.profile, b.profile);
    }
    traces.push({ trace: tracePath(f, bank, prof, b.path, ex.bankPivot, ex.stripe, arcs), name: b.name, open: b.open ?? (b.start ? 'both' : 'end') });
  }
  for (const { trace } of traces) sweepRuns(trace);

  // Pillars: square columns from the deck's underside down to the ground, along each path, where the deck is upright and up.
  const supports = ex.supports.kind;
  const pillarAt = (ring: Ring) => {
    const under = toWorld(ring.f, [0, -ring.prof.th]);
    // Only under a deck that is right way up and not steep (auto: also well off the ground), never in a loop or corkscrew's climb.
    if (ring.f.u[1] < (supports === 'auto' ? 0.9 : 0.7) || Math.abs(ring.f.t[1]) > 0.45 || under[1] < (supports === 'auto' ? 1.5 : 0.3)) return;
    const fw = norm([ring.f.t[0], 0, ring.f.t[2]]);
    const side: V = [fw[2], 0, -fw[0]];
    const hs = ex.supports.size / 2;
    const top = under[1] + 0.05;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(add([under[0], 0, under[2]], mulS(side, a * hs)), mulS(fw, b * hs)));
    for (let j = 0; j < 4; j++) {
      const a = corners[j], b = corners[(j + 1) % 4];
      const mid = mulS(add(a, b), 0.5);
      const out = sub(mid, [under[0], 0, under[2]]);
      quad('support', [a[0], top, a[2]], [b[0], top, b[2]], b, a, out);
    }
  };
  if (supports === 'pillars' || supports === 'auto') {
    for (const { trace } of traces) {
      for (let s = ex.supports.spacing / 2; s < trace.length; s += ex.supports.spacing) {
        const run = trace.runs.find((r) => s >= r.s0 && s <= r.s0 + r.seg.length);
        if (!run || run.seg.gap) continue;
        // The nearest ring (rings are at most a couple of metres apart).
        const ring = run.rings.reduce((best, r) => (Math.abs(r.s - s) < Math.abs(best.s - s) ? r : best));
        pillarAt(ring);
      }
    }
  }

  // Sockets: one per open end, exactly at the path's boundary frames.
  const sockets: TrackSocket[] = [];
  const sock = (name: string, dir: 'in' | 'out', f: TrackFrame, at: PathTrace['turtles'][number]) => {
    const r = resolveProfile(at.profile);
    sockets.push({
      name, dir, pos: f.p.map(r4) as V, forward: f.t.map(r4) as V, up: f.u.map(r4) as V,
      edge: edgeKind(at.profile, at.bank, f.p[1], at.profile.edge ?? ex.edge), width: r4(at.profile.shape === 'pipe' ? 2 * r.rc : at.profile.width), bank: r4(at.bank),
      ...(r.med > 0 ? { median: r4(r.med) } : {}),
    });
  };
  for (const { trace, name, open } of traces) {
    const ends = trace.ends, tt = trace.turtles;
    const first = [ends[0], tt[0]] as const, last = [ends[ends.length - 1], tt[tt.length - 1]] as const;
    if (name === null) {
      sock('in', 'in', ...first);
      sock('out', 'out', ...last);
      continue;
    }
    if (open === 'both') {
      sock(`${name}_in`, 'in', ...first);
      sock(`${name}_out`, 'out', ...last);
    } else if (open === 'start') sock(name, 'in', ...first);
    else if (open === 'end') sock(name, 'out', ...last);
  }

  // Weld the collider (exact positions), then the bounds and the footprint.
  const key = (i: number) => `${Math.round(col[i] * 1e5)},${Math.round(col[i + 1] * 1e5)},${Math.round(col[i + 2] * 1e5)}`;
  const at = new Map<string, number>();
  const cpos: number[] = [], cidx: number[] = [];
  for (let i = 0; i < col.length; i += 3) {
    const k = key(i);
    let v = at.get(k);
    if (v === undefined) {
      v = cpos.length / 3;
      at.set(k, v);
      cpos.push(col[i], col[i + 1], col[i + 2]);
    }
    cidx.push(v);
  }
  const lo: V = [Infinity, Infinity, Infinity], hi: V = [-Infinity, -Infinity, -Infinity];
  for (const s of TRACK_SLOTS)
    for (let i = 0; i < slots[s].pos.length; i += 3) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], slots[s].pos[i + k]);
        hi[k] = Math.max(hi[k], slots[s].pos[i + k]);
      }
  if (!(lo[0] <= hi[0])) throw new TrackSpecError('trackpiece: the piece has no geometry (every segment is a gap?)');
  // An overhang under 0.6 m past a grid line (the slab and wall edges of a pitched end, CS-FB-020) does not claim the next cell.
  const c = ex.cell, tol = 0.6;
  const cx0 = Math.floor((lo[0] + c / 2 + tol) / c), cx1 = Math.ceil((hi[0] + c / 2 - tol) / c);
  const cz0 = Math.floor((lo[2] + tol) / c), cz1 = Math.ceil((hi[2] - tol) / c);
  const footprint = { cells: [Math.max(1, cx1 - cx0), Math.max(1, cz1 - cz0)] as [number, number], min: [r4(cx0 * c - c / 2), r4(cz0 * c)] as [number, number] };
  return { slots, collider: { pos: cpos, idx: cidx }, sockets, bounds: { min: lo, max: hi }, footprint, length: r4(main.length), supports, warnings };
}

/** The rotation of a socket frame (+Z to forward, +Y to up) as a quaternion [x, y, z, w]. */
export function socketQuat(forward: V, up: V): [number, number, number, number] {
  const z = norm(forward);
  const y = norm(sub(up, mulS(z, dot(up, z))));
  const x = cross(y, z);
  // Columns x, y, z of the rotation matrix.
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / S, (m02 - m20) / S, (m10 - m01) / S, S / 4];
  } else if (m00 > m11 && m00 > m22) {
    const S = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [S / 4, (m01 + m10) / S, (m02 + m20) / S, (m21 - m12) / S];
  } else if (m11 > m22) {
    const S = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / S, S / 4, (m12 + m21) / S, (m02 - m20) / S];
  } else {
    const S = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / S, (m12 + m21) / S, S / 4, (m10 - m01) / S];
  }
  return q.map((v) => r4(v) + 0) as [number, number, number, number];
}

/**
 * Where piece B's sockets land when its socket `bIn` is joined to piece A's socket `aOut` (A in its own frame): the
 * rigid transform taking B's frame at `bIn` onto A's at `aOut`. Returns a function mapping B points to A's frame.
 * Joining an `in` to an `out` matches forward; for tests and games that chain pieces.
 */
export function joinTransform(aOut: Pick<TrackSocket, 'pos' | 'forward' | 'up'>, bIn: Pick<TrackSocket, 'pos' | 'forward' | 'up'>) {
  const basis = (s: Pick<TrackSocket, 'forward' | 'up'>) => {
    const z = norm(s.forward), y = norm(sub(s.up, mulS(z, dot(s.up, z))));
    return { x: cross(y, z), y, z };
  };
  const A = basis(aOut), B = basis(bIn);
  const local = (v: V): V => [dot(v, B.x), dot(v, B.y), dot(v, B.z)];
  const world = (l: V): V => add(add(mulS(A.x, l[0]), mulS(A.y, l[1])), mulS(A.z, l[2]));
  return {
    point: (p: V): V => add(aOut.pos, world(local(sub(p, bIn.pos)))),
    dir: (d: V): V => world(local(d)),
  };
}
