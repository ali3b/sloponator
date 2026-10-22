// Moved from synty-sprite-generator packages/shared/src/object/scorch.ts (P2, ali3b/sloponator#8).
/**
 * Procedural object states (FB-028): a state drawn from the base model itself when the library has no damaged or
 * destroyed version of it. `scorch` is the base model burnt out: its colours darkened towards charcoal, sunk a
 * little into the ground, squashed and tilted slightly, with optional rubble around its foot. Plain numbers here;
 * the renderer (apps/web/src/render/scorch.ts) applies them to a copy of the model.
 *
 * Asked for with `--states auto,destroyed=@scorch,destroyed@collapse`, `destroyed=@scorch:dark=0.8;debris=0@collapse`
 * or `auto+scorch` (a scorched `destroyed` state, with a `collapse` transition, when no destroyed model is found).
 */

/** The procedural looks a state can take, with their parameters' defaults. */
export const STATE_LOOKS = {
  scorch: {
    /** How burnt (0 = unchanged colours, 1 = charcoal): it desaturates and mixes towards charcoal (FB-043). */
    dark: 0.7,
    /** How far it sinks into the ground, as a fraction of its height. */
    sink: 0.06,
    /** Vertical squash (fraction of its height). */
    squash: 0.08,
    /** Tilt (degrees). */
    tilt: 3,
    /** Pieces of rubble around its foot (0 = none). */
    debris: 8,
  },
} as const;

export type StateLookId = keyof typeof STATE_LOOKS;

export interface StateLook {
  id: StateLookId;
  params: Record<string, number>;
}

/** "scorch" or "scorch:dark=0.8;debris=0" → a look (throws on unknown looks or parameters). */
export function parseLook(spec: string): StateLook {
  const [rawId, args = ''] = spec.trim().replace(/^@/, '').split(':');
  const id = rawId.trim().toLowerCase();
  if (!(id in STATE_LOOKS)) throw new Error(`unknown procedural state "@${id}" (looks: ${Object.keys(STATE_LOOKS).map((k) => `@${k}`).join(', ')})`);
  const defaults = STATE_LOOKS[id as StateLookId] as Record<string, number>;
  const params: Record<string, number> = { ...defaults };
  for (const kv of args.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!k || v === undefined || Number.isNaN(Number(v))) throw new Error(`bad parameter "${kv}" in "@${spec}" (use key=number)`);
    if (!(k.trim() in defaults)) throw new Error(`"@${id}" has no parameter "${k.trim()}" (it has ${Object.keys(defaults).join(', ')})`);
    params[k.trim()] = Number(v);
  }
  return { id: id as StateLookId, params };
}

/** Deterministic pseudo-random in [0, 1) from a string. */
function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Charcoal (linear RGB): the colour a fully burnt (`dark=1`) surface takes, sRGB #3a3532. */
export const SCORCH_CHARCOAL: [number, number, number] = [0.042, 0.036, 0.033];

/**
 * How `dark` burns a colour (FB-043): `desaturate` of the way to its own grey (luminance), then `toCharcoal` of the
 * way to charcoal. A multiplier alone kept the hue (a rust-red container only turned dark red at 0.9); this greys
 * and blackens it, and reaches charcoal at 1.
 */
export function burnAmounts(dark: number) {
  const d = Math.min(1, Math.max(0, dark));
  return { desaturate: Math.min(1, d * 1.25), toCharcoal: d };
}

/** A linear RGB colour burnt by `dark` (see burnAmounts); the renderer does the same per pixel for textured materials. */
export function burnColor(rgb: readonly [number, number, number], dark: number): [number, number, number] {
  const { desaturate, toCharcoal } = burnAmounts(dark);
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return rgb.map((c, i) => {
    const g = c + (l - c) * desaturate;
    return g + (SCORCH_CHARCOAL[i] - g) * toCharcoal;
  }) as [number, number, number];
}

export interface ScorchPlan {
  /** How burnt (0..1): colours are burnt with burnColor / burnAmounts. */
  dark: number;
  /** A white surface burnt (linear RGB, 0..1): the multiplier for rubble and emissive colours. */
  tint: [number, number, number];
  /** Metres to lower the model (positive = down). */
  sink: number;
  /** Vertical scale (1 - squash). */
  scaleY: number;
  /** Tilt angle (radians) about a horizontal axis (x, z) through the footprint centre. */
  tilt: number;
  axis: { x: number; z: number };
  /** Rubble pieces: ground position (metres, model axes), size (metres) and yaw (radians). Inside the footprint. */
  rubble: { x: number; z: number; size: number; yaw: number }[];
}

/**
 * The scorched version of a model whose rest box is `box` (metres, model axes). Rubble lies along the inside of
 * the footprint's edge so it does not widen the state's footprint or collision.
 */
export function scorchPlan(box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }, params: Record<string, number> = {}, seed = 'scorch'): ScorchPlan {
  const p = { ...STATE_LOOKS.scorch, ...params } as Record<keyof typeof STATE_LOOKS.scorch, number>;
  const dark = Math.min(1, Math.max(0, p.dark));
  const tint = burnColor([1, 1, 1], dark);
  const h = Math.max(0, box.max.y - Math.max(0, box.min.y));
  const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const a = rand(`${seed}:axis`) * Math.PI * 2;
  const n = Math.max(0, Math.round(p.debris));
  const size = Math.max(0.08, Math.min(w, d) * 0.12);
  const rubble = Array.from({ length: n }, (_, i) => {
    // Around the edge, a little inside it (so the piece stays within the footprint).
    const t = (i + rand(`${seed}:${i}:t`) * 0.6) / Math.max(1, n);
    const ang = t * Math.PI * 2;
    const rx = Math.max(0, w / 2 - size * 0.6), rz = Math.max(0, d / 2 - size * 0.6);
    const s = size * (0.6 + 0.8 * rand(`${seed}:${i}:s`));
    return { x: cx + Math.cos(ang) * rx * 0.92, z: cz + Math.sin(ang) * rz * 0.92, size: Math.min(s, size * 1.2), yaw: rand(`${seed}:${i}:y`) * Math.PI * 2 };
  });
  return {
    dark,
    tint,
    sink: Math.max(0, p.sink) * h,
    scaleY: 1 - Math.min(0.5, Math.max(0, p.squash)),
    tilt: (Math.max(0, Math.min(20, p.tilt)) * Math.PI) / 180,
    axis: { x: Math.cos(a), z: Math.sin(a) },
    rubble,
  };
}
