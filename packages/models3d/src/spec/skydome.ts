// Moved from synty-sprite-generator packages/shared/src/model3d/skydome.ts (P3, ali3b/sloponator#14).
/**
 * Skydomes per scenery set (CS-FB-004): a low-poly sphere coloured by a vertex gradient (zenith → horizon → ground),
 * unlit, facing in, plus an optional distant silhouette ring baked from Synty background props (mountain ranges,
 * hills, skylines) into one hazy mesh. Pure maths here; the server's terrainBuild.ts writes the GLB. docs/MODELS.md
 * "Skydome" is the contract.
 *
 * Frame: metres, +Y up, the origin at the dome's centre on the ground (the camera's spot); the ring stands on y = 0.
 */
import { rng } from './noise.js';

export const SKYDOME_PRESETS = ['desert', 'tropical', 'alpine', 'city', 'country'] as const;
export type SkydomePreset = (typeof SKYDOME_PRESETS)[number];

/** Bump when the dome or the ring changes for the same spec: cached skydomes are rebuilt. */
export const SKYDOME_VERSION = 3;

export interface SkydomeColors {
  zenith?: string;
  horizon?: string;
  /** Below the horizon (the far ground or sea). */
  ground?: string;
  /** The silhouette ring's own colour before the haze. */
  ring?: string;
}

export interface SkydomeRing {
  /** Synty background props by reference ("Pack/Asset"); default the preset's. Placed side by side all round. */
  assets?: string[];
  /** The ring's distance as a share of the radius (default 0.85). */
  distance?: number;
  /** How high the tallest silhouettes reach, degrees above the horizon (default the preset's, 3–8). */
  elevation?: number;
  /** 0–1: how far the ring's colour fades into the horizon's (default 0.55). */
  haze?: number;
  /** Rings, the far ones lower and hazier (default 2). */
  layers?: number;
}

/** ModelSpec.skydome. */
export interface SkydomeSpec {
  preset?: SkydomePreset;
  /** Dome radius, metres (default 1000; keep it inside the camera's far plane). */
  radius?: number;
  colors?: SkydomeColors;
  /** The silhouette ring: true / left out for the preset's, false for none. */
  ring?: boolean | SkydomeRing;
  /** Segments around (default 32). */
  segments?: number;
  seed?: number;
  /** Also an equirectangular panorama PNG of the dome and ring, this many pixels wide (default 2048; false: none). */
  panorama?: number | false;
}

export class SkydomeSpecError extends Error {}

export interface SkydomePresetDef {
  colors: Required<SkydomeColors>;
  ring: string[];
  elevation: number;
}

/** The presets' colours and silhouette props (each prop is skipped with a warning when its pack is not installed). */
export const SKYDOME_PRESET_DEFS: Record<SkydomePreset, SkydomePresetDef> = {
  desert: {
    colors: { zenith: '#3f7fcf', horizon: '#f3d9aa', ground: '#c8a46e', ring: '#a8704e' },
    ring: ['POLYGON_NatureBiomes_AridDesert/SM_Env_Backrgound_Hill_01', 'POLYGON_NatureBiomes_AridDesert/SM_Env_Backrgound_Hill_02', 'POLYGON_NatureBiomes_AridDesert/SM_Env_Backrgound_Hill_03'],
    elevation: 4,
  },
  tropical: {
    colors: { zenith: '#1f84df', horizon: '#c4ecf7', ground: '#2a8c9c', ring: '#3f6d48' },
    ring: ['POLYGON_NatureBiomes_TropicalJungle/SM_Env_Volcano_01', 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Background_Hill_01', 'POLYGON_NatureBiomes_SwampMarshland/SM_Env_Background_Hill_01'],
    elevation: 5,
  },
  alpine: {
    colors: { zenith: '#3567b3', horizon: '#dfe9f2', ground: '#e6ecf0', ring: '#8d98a8' },
    ring: ['POLYGON_NatureBiomes_AlpineMountain/SM_Env_MountainRange_01', 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_MountainRange_02', 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_MountainRange_03', 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_MountainRange_04'],
    elevation: 8,
  },
  city: {
    colors: { zenith: '#5584c2', horizon: '#dde1e6', ground: '#6a6d72', ring: '#59616e' },
    ring: ['POLYGON_Pro_Racer/SM_Bld_Background_01', 'POLYGON_Pro_Racer/SM_Bld_Background_03', 'POLYGON_Pro_Racer/SM_Bld_Background_05', 'POLYGON_Pro_Racer/SM_Bld_Background_06', 'POLYGON_Pro_Racer/SM_Bld_Background_10', 'POLYGON_Pro_Racer/SM_Bld_Background_11'],
    elevation: 5,
  },
  country: {
    colors: { zenith: '#4785d2', horizon: '#d2e6f0', ground: '#6e8e45', ring: '#4f6b3c' },
    ring: ['POLYGON_Pro_Racer/SM_Gen_Env_Hill_01', 'POLYGON_Pro_Racer/SM_Gen_Env_Hill_02', 'POLYGON_Pro_Racer/SM_Gen_Env_Hill_03', 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Background_Hill_01'],
    elevation: 3.5,
  },
};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
function num(v: unknown, what: string, lo: number, hi: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new SkydomeSpecError(`${what} must be a number ${lo}–${hi}`);
  return r4(n);
}
function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SkydomeSpecError(`${what} must be an object`);
  return v as Record<string, unknown>;
}
function onlyKeys(o: Record<string, unknown>, what: string, keys: readonly string[]) {
  const bad = Object.keys(o).filter((k) => !keys.includes(k));
  if (bad.length) throw new SkydomeSpecError(`${what}: unknown field${bad.length > 1 ? 's' : ''} ${bad.map((k) => `"${k}"`).join(', ')} (allowed: ${keys.join(', ')})`);
}
const colour = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.trim())) throw new SkydomeSpecError(`${what} must be #rrggbb`);
  return v.trim().toLowerCase();
};

/** Check a skydome spec and drop what is default (a SkydomeSpecError names the bad field). */
export function normaliseSkydome(raw: unknown): SkydomeSpec {
  const o = obj(raw === true ? {} : raw, 'skydome');
  onlyKeys(o, 'skydome', ['preset', 'radius', 'colors', 'ring', 'segments', 'seed', 'panorama']);
  const s: SkydomeSpec = {};
  if (o.preset !== undefined) {
    if (typeof o.preset !== 'string' || !(SKYDOME_PRESETS as readonly string[]).includes(o.preset)) throw new SkydomeSpecError(`skydome.preset must be one of ${SKYDOME_PRESETS.join(', ')}`);
    s.preset = o.preset as SkydomePreset;
  }
  if (o.radius !== undefined) s.radius = num(o.radius, 'skydome.radius', 10, 100000);
  if (o.colors !== undefined) {
    const co = obj(o.colors, 'skydome.colors');
    onlyKeys(co, 'skydome.colors', ['zenith', 'horizon', 'ground', 'ring']);
    const c: SkydomeColors = {};
    for (const k of ['zenith', 'horizon', 'ground', 'ring'] as const) if (co[k] !== undefined) c[k] = colour(co[k], `skydome.colors.${k}`);
    if (Object.keys(c).length) s.colors = c;
  }
  if (o.ring !== undefined) {
    if (o.ring === false) s.ring = false;
    else if (o.ring !== true) {
      const ro = obj(o.ring, 'skydome.ring');
      onlyKeys(ro, 'skydome.ring', ['assets', 'distance', 'elevation', 'haze', 'layers']);
      const r: SkydomeRing = {};
      if (ro.assets !== undefined) {
        if (!Array.isArray(ro.assets) || !ro.assets.length || ro.assets.length > 12 || !ro.assets.every((a) => typeof a === 'string' && a.trim()))
          throw new SkydomeSpecError('skydome.ring.assets must be a list of 1–12 props ("Pack/Asset")');
        r.assets = ro.assets.map((a) => (a as string).trim());
      }
      if (ro.distance !== undefined) r.distance = num(ro.distance, 'skydome.ring.distance', 0.3, 0.98);
      if (ro.elevation !== undefined) r.elevation = num(ro.elevation, 'skydome.ring.elevation', 0.5, 45);
      if (ro.haze !== undefined) r.haze = num(ro.haze, 'skydome.ring.haze', 0, 1);
      if (ro.layers !== undefined) {
        r.layers = num(ro.layers, 'skydome.ring.layers', 1, 4);
        if (!Number.isInteger(r.layers)) throw new SkydomeSpecError('skydome.ring.layers must be 1–4');
      }
      if (Object.keys(r).length) s.ring = r;
    }
  }
  if (o.segments !== undefined) {
    s.segments = num(o.segments, 'skydome.segments', 8, 128);
    if (!Number.isInteger(s.segments)) throw new SkydomeSpecError('skydome.segments must be a whole number 8–128');
  }
  if (o.seed !== undefined) s.seed = num(o.seed, 'skydome.seed', 0, 2 ** 31);
  if (o.panorama !== undefined) {
    if (o.panorama === false) s.panorama = false;
    else {
      const w = num(o.panorama, 'skydome.panorama', 256, 8192);
      if (!Number.isInteger(w / 2)) throw new SkydomeSpecError('skydome.panorama must be an even width in pixels (256–8192) or false');
      if (w !== 2048) s.panorama = w;
    }
  }
  return s;
}

export const skydomeName = (s: SkydomeSpec) => `skydome_${s.preset ?? 'country'}`;

export interface ExpandedSkydome {
  preset: SkydomePreset;
  radius: number;
  colors: Required<SkydomeColors>;
  ring: Required<SkydomeRing> | null;
  segments: number;
  seed: number;
  /** Panorama width in pixels, 0 for none. */
  panorama: number;
}

export function expandSkydome(s: SkydomeSpec): ExpandedSkydome {
  const preset = s.preset ?? 'country';
  const def = SKYDOME_PRESET_DEFS[preset];
  const ringSpec = s.ring === false ? null : s.ring === true || s.ring === undefined ? {} : s.ring;
  return {
    preset,
    radius: s.radius ?? 1000,
    colors: { ...def.colors, ...(s.colors ?? {}) },
    ring: ringSpec
      ? { assets: ringSpec.assets ?? def.ring, distance: ringSpec.distance ?? 0.85, elevation: ringSpec.elevation ?? def.elevation, haze: ringSpec.haze ?? 0.55, layers: ringSpec.layers ?? 2 }
      : null,
    segments: s.segments ?? 32,
    seed: s.seed ?? 1,
    panorama: s.panorama === false ? 0 : (s.panorama ?? 2048),
  };
}

const hexRgb = (h: string): [number, number, number] => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255) as [number, number, number];
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];
/** sRGB (0–1) to linear, for glTF vertex colours (COLOR_0 is linear). */
export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** The sky's sRGB colour (0–1) at an elevation in degrees: the dome's gradient. */
export function skyColour(ex: ExpandedSkydome, e: number): [number, number, number] {
  const zen = hexRgb(ex.colors.zenith), hor = hexRgb(ex.colors.horizon), gnd = hexRgb(ex.colors.ground);
  return e >= 0 ? mix(hor, zen, Math.pow(e / 90, 0.55)) : mix(hor, gnd, Math.min(1, -e / 6));
}

/**
 * An equirectangular panorama (three.js EquirectangularReflectionMapping: u = atan2(z, x) / 2π + ½, v = asin(y) / π
 * + ½, row 0 at the top) of the gradient and the ring's triangles (xyz, 9 a triangle, sRGB colour per vertex),
 * painted far to near. Returns RGB bytes, width × width / 2.
 */
export function renderPanorama(ex: ExpandedSkydome, ring: { pos: ArrayLike<number>; col: ArrayLike<number> }, width: number): Uint8Array {
  const W = width, H = width / 2;
  const img = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const e = 90 - ((y + 0.5) / H) * 180;
    const c = skyColour(ex, e).map((v) => Math.round(v * 255));
    for (let x = 0; x < W; x++) img.set(c, (y * W + x) * 3);
  }
  const uvOf = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z) || 1;
    return [(Math.atan2(z, x) / (2 * Math.PI) + 0.5) * W, (1 - (Math.asin(Math.max(-1, Math.min(1, y / l))) / Math.PI + 0.5)) * H];
  };
  const n = ring.pos.length / 9;
  const order = Array.from({ length: n }, (_, i) => i).map((i) => {
    let d = 0;
    for (let k = 0; k < 3; k++) d += Math.hypot(ring.pos[i * 9 + k * 3], ring.pos[i * 9 + k * 3 + 2]);
    return { i, d };
  }).sort((a, b) => b.d - a.d);
  for (const { i } of order) {
    const P = [0, 1, 2].map((k) => uvOf(ring.pos[i * 9 + k * 3], ring.pos[i * 9 + k * 3 + 1], ring.pos[i * 9 + k * 3 + 2]));
    const Cc = [0, 1, 2].map((k) => [0, 1, 2].map((ch) => ring.col[i * 9 + k * 3 + ch] * 255));
    // Across the seam: move the left vertices one width right, and draw the triangle at both places.
    const us = P.map((p) => p[0]);
    if (Math.max(...us) - Math.min(...us) > W / 2) for (const p of P) if (p[0] < W / 2) p[0] += W;
    for (const shift of [0, -W]) {
      const Q = P.map((p) => [p[0] + shift, p[1]]);
      const x0 = Math.max(0, Math.floor(Math.min(Q[0][0], Q[1][0], Q[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(Q[0][0], Q[1][0], Q[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(Q[0][1], Q[1][1], Q[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(Q[0][1], Q[1][1], Q[2][1])));
      if (x0 > x1 || y0 > y1) continue;
      const area = (Q[1][0] - Q[0][0]) * (Q[2][1] - Q[0][1]) - (Q[2][0] - Q[0][0]) * (Q[1][1] - Q[0][1]);
      if (Math.abs(area) < 1e-12) continue;
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const sx = px + 0.5, sy = py + 0.5;
          const w0 = ((Q[1][0] - sx) * (Q[2][1] - sy) - (Q[2][0] - sx) * (Q[1][1] - sy)) / area;
          const w1 = ((Q[2][0] - sx) * (Q[0][1] - sy) - (Q[0][0] - sx) * (Q[2][1] - sy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const o = (py * W + px) * 3;
          for (let ch = 0; ch < 3; ch++) img[o + ch] = Math.round(w0 * Cc[0][ch] + w1 * Cc[1][ch] + w2 * Cc[2][ch]);
        }
    }
  }
  return img;
}

/** The dome: an indexed sphere facing in, smooth, with sRGB vertex colours (the GLB stores them linear). */
export function buildSkyMesh(ex: ExpandedSkydome) {
  const R = ex.radius, seg = ex.segments;
  // Elevations (degrees): dense near the horizon where the gradient turns.
  const elev = [-90, -30, -8, -2, 0, 2, 5, 10, 18, 30, 45, 65, 90];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (const e of elev) {
    const er = (e * Math.PI) / 180;
    const c = skyColour(ex, e);
    for (let k = 0; k <= seg; k++) {
      const az = (k / seg) * Math.PI * 2;
      pos.push(R * Math.cos(er) * Math.sin(az), R * Math.sin(er), R * Math.cos(er) * Math.cos(az));
      col.push(...c);
    }
  }
  const W = seg + 1;
  for (let r = 0; r + 1 < elev.length; r++)
    for (let k = 0; k < seg; k++) {
      const a = r * W + k, b = a + 1, c = a + W, d = c + 1;
      // Facing in (seen from the centre, counter-clockwise).
      idx.push(a, c, b, b, c, d);
    }
  return { pos, col, idx };
}

/** A silhouette prop's footprint for placement: its width along X, depth along Z and height (metres, bottom-centre origin). */
export interface RingProp {
  width: number;
  depth: number;
  height: number;
}

export interface RingPlacement {
  prop: number;
  layer: number;
  /** Where its origin goes (on y = 0), its yaw (radians about +Y; its +Z faces the centre), uniform scale, and the haze (0–1). */
  pos: [number, number, number];
  yaw: number;
  scale: number;
  haze: number;
}

/**
 * Place props side by side all round, per layer: each scaled so its height reaches about `elevation` degrees (the
 * nearer layers lower and less hazy), turned to face the centre, overlapping a little so the skyline has no gaps.
 */
export function placeRing(ex: ExpandedSkydome, props: RingProp[]): RingPlacement[] {
  if (!ex.ring || !props.length) return [];
  const out: RingPlacement[] = [];
  const r = rng(ex.seed * 7919 + 13);
  const L = ex.ring.layers;
  for (let layer = 0; layer < L; layer++) {
    // Layer 0 is the farthest (closest to the dome), the last the nearest.
    const f = L === 1 ? 1 : layer / (L - 1);
    const D = ex.radius * ex.ring.distance * (1 - 0.15 * f);
    const tanE = Math.tan((ex.ring.elevation * (1 - 0.4 * f) * Math.PI) / 180);
    const haze = Math.min(1, ex.ring.haze * (1.25 - 0.6 * f));
    const circ = 2 * Math.PI * D;
    let along = r() * 20;
    const start = along;
    let guard = 0;
    while (along < start + circ && guard++ < 4000) {
      const p = Math.floor(r() * props.length);
      const pr = props[p];
      const target = D * tanE * (0.55 + 0.45 * r());
      const scale = target / Math.max(0.01, pr.height);
      const w = Math.max(1, pr.width * scale);
      const at = along + w / 2;
      const az = at / D;
      out.push({ prop: p, layer, pos: [r4(D * Math.sin(az)), 0, r4(D * Math.cos(az))], yaw: r4(az + Math.PI), scale: r4(scale), haze: r4(haze) });
      along += w * 0.7;
    }
  }
  return out;
}

/** The ring colour of a vertex: the ring colour, faded to the horizon by the haze, a little lighter towards the tops. */
export function ringColour(ex: ExpandedSkydome, haze: number, heightShare: number): [number, number, number] {
  const base = hexRgb(ex.colors.ring), hor = hexRgb(ex.colors.horizon);
  return mix(base, hor, Math.min(1, haze + 0.15 * Math.max(0, Math.min(1, heightShare))));
}
