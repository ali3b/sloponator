// Moved from synty-sprite-generator packages/shared/src/light.ts (P2, ali3b/sloponator#8).
/**
 * Lighting (FB-060): one named mood (day, dusk, night…) shared by sprites and tilesets, so a mission's sprites and
 * ground come out in the same palette.
 *
 * Sprites: the three.js render's lights. An ambient sky light (a hemisphere light: the ambient colour from above, a
 * darker brown-tinted version of it from below) and one key light (the sun or moon, casting the contact shadow)
 * at an azimuth and elevation relative to the camera. Unset (or plain "day") is today's light, exactly.
 *
 * Tilesets: the same light graded onto the flat ground (lightTint): the colour an up-facing surface gets under this
 * light divided by what it gets by day, so grass under "dusk" darkens and warms like the soldier standing on it.
 */

export const LIGHT_PRESETS = ['day', 'dusk', 'night', 'overcast', 'desert_noon', 'arctic'] as const;
export type LightPresetId = (typeof LIGHT_PRESETS)[number];

/** A light setting: a preset, optionally with overrides. Every field is optional; unset = the preset's (day's). */
export interface SpriteLight {
  preset?: LightPresetId;
  /** Ambient (sky) colour "#rrggbb". */
  ambient?: string;
  /** Ambient strength (day 1.9). */
  ambientIntensity?: number;
  /** Key light (sun/moon) colour "#rrggbb". */
  key?: string;
  /** Key light strength (day 1.6). */
  keyIntensity?: number;
  /**
   * Horizontal direction the key light comes FROM, in degrees around the model as the camera sees it: 0 = from the
   * camera, 90 = from the right, -90 = from the left, 180 = from behind (day: about -34, front-left).
   */
  azimuth?: number;
  /** Height of the key light above the horizon in degrees (1–90; day: about 48). */
  elevation?: number;
}

/** A light with every value filled in (what the renderer uses). */
export interface ResolvedLight {
  ambient: string;
  /** The hemisphere light's ground colour: the ambient colour times the day ground brown (#7a7068), in linear light. */
  ground: string;
  ambientIntensity: number;
  key: string;
  keyIntensity: number;
  azimuth: number;
  elevation: number;
  /** Key light position (the light shines toward the origin), camera on +z, x to the right. */
  position: [number, number, number];
  /** Opacity of the contact shadow (day 0.28; fainter under a weak key light). */
  shadowOpacity: number;
}

/** Today's light, which an unset light keeps exactly. */
export const DAY_POSITION: readonly [number, number, number] = [-4, 8, 6];
const DAY_DISTANCE = Math.hypot(...DAY_POSITION);
export const DAY_AZIMUTH = (Math.atan2(DAY_POSITION[0], DAY_POSITION[2]) * 180) / Math.PI;
export const DAY_ELEVATION = (Math.atan2(DAY_POSITION[1], Math.hypot(DAY_POSITION[0], DAY_POSITION[2])) * 180) / Math.PI;
const DAY_GROUND = '#7a7068';
const DAY_SHADOW = 0.28;

type PresetValues = Required<Pick<SpriteLight, 'ambient' | 'ambientIntensity' | 'key' | 'keyIntensity'>> & Pick<SpriteLight, 'azimuth' | 'elevation'>;

/** The presets. Day has no angles of its own: it uses the exact day position. */
export const LIGHT_PRESET_VALUES: Record<LightPresetId, PresetValues> = {
  day: { ambient: '#ffffff', ambientIntensity: 1.9, key: '#ffffff', keyIntensity: 1.6 },
  // Warm evening sun from the side, blue-violet sky.
  dusk: { ambient: '#a8acde', ambientIntensity: 1.8, key: '#ffc396', keyIntensity: 1.7, azimuth: -50, elevation: 40 },
  // Dim blue sky light and a pale moon.
  night: { ambient: '#7084c8', ambientIntensity: 1.5, key: '#b8c8ff', keyIntensity: 0.8, azimuth: -30, elevation: 55 },
  // Bright grey sky, hardly any sun.
  overcast: { ambient: '#e4e8ee', ambientIntensity: 2.4, key: '#ffffff', keyIntensity: 0.55, azimuth: -34, elevation: 70 },
  // Warm white sun nearly overhead.
  desert_noon: { ambient: '#fff0d6', ambientIntensity: 1.8, key: '#fff3d8', keyIntensity: 2.3, azimuth: -20, elevation: 76 },
  // Cold blue-white sky and a pale sun.
  arctic: { ambient: '#d6e6ff', ambientIntensity: 2.1, key: '#f0f6ff', keyIntensity: 1.5, azimuth: -40, elevation: 40 },
};

/** One line per preset, for help texts. */
export const LIGHT_PRESET_WORDS: Record<LightPresetId, string> = {
  day: 'clear daylight (the default look)',
  dusk: 'warm evening sun from the side, blue-violet sky',
  night: 'dim blue sky light and a pale moon',
  overcast: 'bright grey sky, soft faint shadows',
  desert_noon: 'hot sun nearly overhead, short shadows',
  arctic: 'cold blue-white light, pale sun',
};

const HEX = /^#[0-9a-f]{6}$/i;
const LIGHT_KEYS = ['preset', 'ambient', 'ambientIntensity', 'key', 'keyIntensity', 'azimuth', 'elevation'] as const;
/** Other spellings of the override keys (CLI flags, snake_case). */
const LIGHT_ALIASES: Record<string, (typeof LIGHT_KEYS)[number]> = {
  ambient_intensity: 'ambientIntensity', 'ambient-intensity': 'ambientIntensity', key_intensity: 'keyIntensity', 'key-intensity': 'keyIntensity',
  sun: 'key', colour: 'key', color: 'key', intensity: 'keyIntensity',
};

export const isLightPreset = (v: unknown): v is LightPresetId => typeof v === 'string' && (LIGHT_PRESETS as readonly string[]).includes(v);

/** A preset name in any common spelling ("Desert noon", "desert-noon") → its id, else null. */
export function lightPresetOf(v: unknown): LightPresetId | null {
  if (typeof v !== 'string') return null;
  const id = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return isLightPreset(id) ? id : null;
}

/**
 * A light from a file, flag or tool: a preset name ("dusk") or { preset, ambient, ambientIntensity, key,
 * keyIntensity, azimuth, elevation }. Returns the canonical setting, or null for plain day (nothing to store, so a
 * sprite that says "day" stays up to date). Throws with the valid values on a bad one.
 */
export function parseLight(v: unknown, where = 'light'): SpriteLight | null {
  if (v === undefined || v === null || v === false || v === '') return null;
  if (typeof v === 'string') {
    const id = lightPresetOf(v);
    if (!id) throw new Error(`${where}: unknown light "${v}". Presets: ${LIGHT_PRESETS.join(', ')} (or an object with preset, ambient, ambientIntensity, key, keyIntensity, azimuth, elevation).`);
    return normalizeLight({ preset: id });
  }
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where}: light must be a preset name (${LIGHT_PRESETS.join(', ')}) or an object.`);
  const out: SpriteLight = {};
  for (const [k0, x] of Object.entries(v as Record<string, unknown>)) {
    if (x === undefined || x === null) continue;
    const k = (LIGHT_KEYS as readonly string[]).includes(k0) ? (k0 as (typeof LIGHT_KEYS)[number]) : LIGHT_ALIASES[k0];
    if (!k) throw new Error(`${where}: unknown key "${k0}". Keys: ${LIGHT_KEYS.join(', ')}.`);
    if (k === 'preset') {
      const id = lightPresetOf(x);
      if (!id) throw new Error(`${where}: unknown preset "${x}". Presets: ${LIGHT_PRESETS.join(', ')}.`);
      out.preset = id;
    } else if (k === 'ambient' || k === 'key') {
      if (typeof x !== 'string' || !HEX.test(x.trim())) throw new Error(`${where}: ${k} must be a colour "#rrggbb" (got ${JSON.stringify(x)}).`);
      out[k] = x.trim().toLowerCase();
    } else {
      const n = Number(x);
      if (!Number.isFinite(n)) throw new Error(`${where}: ${k} must be a number (got ${JSON.stringify(x)}).`);
      if ((k === 'ambientIntensity' || k === 'keyIntensity') && (n < 0 || n > 10)) throw new Error(`${where}: ${k} must be 0–10 (day: ambient 1.9, key 1.6).`);
      if (k === 'elevation' && (n < 1 || n > 90)) throw new Error(`${where}: elevation must be 1–90 degrees above the horizon.`);
      if (k === 'azimuth' && Math.abs(n) > 360) throw new Error(`${where}: azimuth must be -360–360 degrees (0 = from the camera, 90 = from the right).`);
      out[k] = k === 'azimuth' ? wrapAzimuth(n) : n;
    }
  }
  return normalizeLight(out);
}

const wrapAzimuth = (a: number) => {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return Math.round(x * 1000) / 1000;
};

/** A setting in canonical form: keys in a fixed order, "day" left out, plain day = null. */
export function normalizeLight(l: SpriteLight | null | undefined): SpriteLight | null {
  if (!l) return null;
  const out: SpriteLight = {};
  if (l.preset && l.preset !== 'day') out.preset = l.preset;
  for (const k of LIGHT_KEYS) if (k !== 'preset' && l[k] !== undefined) (out as Record<string, unknown>)[k] = l[k];
  return Object.keys(out).length ? out : null;
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const enc = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const linRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
const hexOfLin = (rgb: number[]) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(1, enc(c))) * 255).toString(16).padStart(2, '0')).join('')}`;

/** Every value of a light (unset = day, exactly as the renderer always lit sprites). */
export function resolveLight(l: SpriteLight | null | undefined): ResolvedLight {
  const p = LIGHT_PRESET_VALUES[l?.preset ?? 'day'];
  const ambient = l?.ambient ?? p.ambient;
  const keyIntensity = l?.keyIntensity ?? p.keyIntensity;
  const az = l?.azimuth ?? p.azimuth;
  const el = l?.elevation ?? p.elevation;
  let position: [number, number, number];
  if (az === undefined && el === undefined) position = [...DAY_POSITION];
  else {
    const a = ((az ?? DAY_AZIMUTH) * Math.PI) / 180, e = ((el ?? DAY_ELEVATION) * Math.PI) / 180;
    const h = Math.cos(e) * DAY_DISTANCE;
    position = [Math.sin(a) * h, Math.sin(e) * DAY_DISTANCE, Math.cos(a) * h];
  }
  const g = linRgb(DAY_GROUND), am = linRgb(ambient);
  return {
    ambient, ground: ambient === '#ffffff' ? DAY_GROUND : hexOfLin(am.map((c, i) => c * g[i])),
    ambientIntensity: l?.ambientIntensity ?? p.ambientIntensity, key: l?.key ?? p.key, keyIntensity,
    azimuth: az ?? DAY_AZIMUTH, elevation: el ?? DAY_ELEVATION, position,
    shadowOpacity: DAY_SHADOW * Math.min(1, keyIntensity / LIGHT_PRESET_VALUES.day.keyIntensity),
  };
}

/** Whether a light renders exactly like day (nothing changes). */
export const isDayLight = (l: SpriteLight | null | undefined) => normalizeLight(l) === null;

/**
 * The linear-light multiplier per channel that this light gives an up-facing surface compared with day: ambient
 * (the full sky colour from above) plus the key light at its elevation (Lambert). [1, 1, 1] for day.
 */
export function lightTint(l: SpriteLight | null | undefined): [number, number, number] {
  if (isDayLight(l)) return [1, 1, 1];
  const of = (r: ResolvedLight) => {
    const a = linRgb(r.ambient), k = linRgb(r.key);
    const s = Math.max(0, Math.sin((r.elevation * Math.PI) / 180));
    return a.map((c, i) => c * r.ambientIntensity + k[i] * r.keyIntensity * s);
  };
  const day = of(resolveLight(null)), cur = of(resolveLight(l));
  return cur.map((c, i) => Math.min(2, c / day[i])) as [number, number, number];
}

/**
 * The tint grade as a lookup table: sRGB byte in → sRGB byte out, per channel (data[ch * 256 + v]). Null for day
 * (pictures stay byte for byte as they were).
 */
export function lightGradeTable(l: SpriteLight | null | undefined): Uint8Array | null {
  if (isDayLight(l)) return null;
  const t = lightTint(l);
  const out = new Uint8Array(768);
  for (let ch = 0; ch < 3; ch++)
    for (let v = 0; v < 256; v++) out[ch * 256 + v] = Math.round(Math.max(0, Math.min(1, enc(lin(v / 255) * t[ch]))) * 255);
  return out;
}

/** A short description: "dusk", "night (key #ffffff)", "custom (ambient #… 1.2)". */
export function lightLabel(l: SpriteLight | null | undefined): string {
  const n = normalizeLight(l);
  if (!n) return 'day';
  const extra = LIGHT_KEYS.filter((k) => k !== 'preset' && n[k] !== undefined).map((k) => `${k} ${n[k]}`);
  return `${n.preset ?? 'day'}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}
