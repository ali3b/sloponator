// Copied from synty-sprite-generator packages/shared/src/object/debris.ts (P2, ali3b/sloponator#9): render-time debris/transition physics, used only by the procedural templates of the render bundle.
/**
 * Debris maths for the `destroy` template (A4 follow-up). Flying parts are kept within `spread` × the object's
 * footprint radius (horizontally, from the object's centre) and their rise within `spread` × its height, so a
 * transition stays readable inside the frame its states share. Transitions do not set the frame (see
 * `framingClips` in states.ts): anything that still leaves it is cropped, and the clip fades out at the end.
 * Plain numbers, no three.js: the template builds its tracks from these.
 */

/** Defaults of the `destroy` template's debris parameters. */
export const DESTROY_DEFAULTS = {
  /** Launch speed (m/s) before bounding. */
  force: 3.5,
  /** How far parts may fly: their centres stay within spread × the footprint radius of the object's centre. */
  spread: 1,
  /** 1: the clip fades out over its last 30 %. */
  fade: 1,
} as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DebrisSample {
  t: number;
  /** Offset from the part's rest position (metres). */
  p: Vec3;
  /** Ground hits so far. */
  grounded: number;
}

const G = 9.81;

/**
 * A part thrown with velocity v from height y0 above the ground: bounces (losing energy each time) and slides to
 * rest. Samples every 1/120 s up to `duration`; returns a lookup by time.
 */
export function bounceSim(v: Vec3, y0: number, duration: number, restitution = 0.35): { at: (t: number) => DebrisSample; samples: DebrisSample[] } {
  const dt = 1 / 120;
  const pos = { x: 0, y: 0, z: 0 };
  const vel = { ...v };
  const samples: DebrisSample[] = [];
  let grounded = 0;
  for (let t = 0; t <= duration + dt; t += dt) {
    samples.push({ t, p: { ...pos }, grounded });
    vel.y -= G * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    if (pos.y < -y0) {
      pos.y = -y0;
      vel.y = Math.abs(vel.y) < 1 ? 0 : -vel.y * restitution;
      vel.x *= 0.6;
      vel.z *= 0.6;
      grounded++;
    }
  }
  return { samples, at: (t: number) => samples[Math.min(samples.length - 1, Math.max(0, Math.round(t / dt)))] };
}

export interface DebrisBounds {
  /** Object footprint radius: the farthest its rest geometry reaches from its centre on the ground (metres). */
  radius: number;
  /** Object height above the ground (metres). */
  height: number;
  /** DESTROY_DEFAULTS.spread by default. */
  spread?: number;
  /**
   * The footprint's equal-area radius (√(area / π)): running gear keeps its centre within spread × this of the
   * object's centre (FB-027 follow-up). Without it, running gear is bounded like any other part.
   */
  ground?: number;
}

/** The farthest a part may travel sideways, and the highest it may rise, from where it starts. */
export function debrisLimits(start: { dist: number; y: number }, b: DebrisBounds): { travel: number; rise: number } {
  const s = b.spread ?? DESTROY_DEFAULTS.spread;
  // A part already near the rim may still slide off a little (15 % of the radius) rather than freeze in place.
  const travel = Math.max(0.15 * b.radius, s * b.radius - start.dist);
  const rise = Math.max(0.25 * b.height, s * b.height - start.y);
  return { travel, rise };
}

/**
 * A bounded throw: the launch velocity's upward part is cut so the part rises at most `rise`, the simulated path's
 * sideways offsets are scaled so it travels at most `travel` (the bounce maths is linear in sideways speed, so this
 * equals a slower throw). Offsets are from the part's rest position.
 */
export function boundedThrow(v: Vec3, y0: number, duration: number, limits: { travel: number; rise: number }) {
  const vy = Math.min(v.y, Math.sqrt(2 * G * Math.max(0, limits.rise)));
  const sim = bounceSim({ x: v.x, y: vy, z: v.z }, y0, duration);
  const far = Math.max(0, ...sim.samples.map((s) => Math.hypot(s.p.x, s.p.z)));
  const k = far > limits.travel ? limits.travel / far : 1;
  const samples = sim.samples.map((s) => ({ ...s, p: { x: s.p.x * k, y: s.p.y, z: s.p.z * k } }));
  const dt = 1 / 120;
  return { samples, scale: k, at: (t: number) => samples[Math.min(samples.length - 1, Math.max(0, Math.round(t / dt)))] };
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * How a state transition (FB-027) ends on its destination state, opaque throughout (FB-043): first the destination
 * model fades in over [toStart, toEnd] *underneath* the still fully opaque source (which hides it wherever it covers
 * it), then, once the destination is fully opaque, the source (and its debris) fades out over [fromStart, fromEnd]
 * on top of it. The two never fade at the same time, so at every moment one of them is opaque and nothing behind the
 * object shows through (both half transparent at once showed the bunker's and the container's insides). The renderer
 * draws a fading model's front surface only (a depth prepass, SpriteRenderer.syncFades), so it is never seen inside
 * out. From `fromEnd` on only the destination model shows, at rest: the last frame is the destination state's
 * still, so an engine switches to it without a pop.
 */
export const TRANSITION_FADE = { toStart: 0.45, toEnd: 0.6, fromStart: 0.6, fromEnd: 0.9 } as const;

/** Opacity of a transition's source and destination models at u ∈ [0, 1] of the clip. */
export function transitionOpacity(u: number, f: { toStart: number; toEnd: number; fromStart: number; fromEnd: number } = TRANSITION_FADE) {
  return { from: 1 - smooth((u - f.fromStart) / (f.fromEnd - f.fromStart)), to: smooth((u - f.toStart) / (f.toEnd - f.toStart)) };
}

/**
 * How far a transition has carried the source model towards the destination's pose at u ∈ [0, 1] (FB-043): 0 at
 * the start, 1 by the time the source starts fading out (TRANSITION_FADE.fromStart), so while it fades on top of
 * the destination the two overlap exactly (a scorched copy sunk less than the collapse used to pop up).
 */
export function transitionPoseWeight(u: number, start = 0.15, f: { fromStart: number } = TRANSITION_FADE) {
  return smooth((u - start) / Math.max(1e-6, f.fromStart - start));
}

/** Opacity of a destroy clip at u ∈ [0, 1] of its length: 1, then the transition's fade-out when `fade` is on. */
export const destroyOpacity = (u: number, fade: number) => (fade ? transitionOpacity(u).from : 1);

/** A part of a multi-part model, measured at rest (metres, the object's frame). */
export interface PartShape {
  /** Horizontal distance of its centre from the object's centre. */
  dist: number;
  /** Height of its centre above the ground. */
  y: number;
  /** Half its vertical extent at rest. */
  halfHeight: number;
  /** Radius of its bounding sphere (half its box diagonal). */
  radius: number;
  /**
   * Its box volume (m³). Parts are weighed by the cube root of it when given: a long thin barrel has a big
   * bounding sphere but little mass. Without it, by `radius`.
   */
  volume?: number;
  /** Running gear (a wheel or track role): it stays close to the hull (see `DebrisBounds.ground`). */
  running?: boolean;
  /** A track (the role): it forms the hull's sides on screen, so it stays level with the hull. */
  track?: boolean;
}

/** The unparted body of a model: a Synty tank's hull is the mesh its parts hang under, not a part itself. */
export interface DebrisBody {
  /** Its box volume (m³). */
  volume: number;
  /** Radius of its bounding sphere. */
  radius: number;
}

/** How one part moves in the destroy template. */
export interface PartPlan {
  /** The biggest part, when the model has no unparted body (then it is the hull): lifts and drops, barely turns. */
  main: boolean;
  /** Hull-sized (main, a track, or at least BIG_PART of the hull's size): stays level with the hull. */
  big: boolean;
  /** Its size against the hull (the body, or the biggest part), 0..1. */
  size: number;
  /** Launch speed factor (heavy parts are thrown slower). */
  launch: number;
  /** The most it may tip away from upright (radians); Infinity = it tumbles freely. */
  tilt: number;
  /** Bounded throw limits: sideways travel and rise of its centre (metres). */
  travel: number;
  rise: number;
  /** How far below its rest position it lands (metres): a hull-sized part up on the hull lands back on it (0). */
  floor: number;
}

/**
 * The most a hull-sized part tips (FB-027 follow-up). A 2:1 camera (30° pitch) halves the ground plane on screen,
 * so a tilt shows up to ~1.75× larger there: 2.5° stays within ±5° on screen. The old 20° for a track (a slab as
 * long as the hull, forming its sides) read as the whole hull tipping 30–40° towards the camera.
 */
export const HULL_TILT = (2.5 * Math.PI) / 180;
/** The whole model's jolt as it blows (degrees about its side axis, eased in and back out over the first 40 %). */
export const DESTROY_JOLT = 2;
/** Parts at least this share of the hull's size (cube root of the volume) count as hull-sized. */
export const BIG_PART = 0.45;
/** Parts at least this share tip at most MEDIUM_TILT; smaller ones tumble freely. */
export const MEDIUM_PART = 0.25;
export const MEDIUM_TILT = (30 * Math.PI) / 180;

/**
 * Debris weighted by size (FB-027): the hull stays level (the model's unparted body, else its biggest part,
 * tips ≤ HULL_TILT) and hull-sized parts (the tracks, a turret) stay level with it, shift a little and, if they
 * sit up on the hull, land back on it; middling parts tip at most 30° and small ones tumble. Every part's top
 * stays below the object's height (the frame the stills set reaches there), whatever its rotation: its rise is
 * cut so the centre plus the part's reach at its largest tilt stays under `bounds.height`. Running gear (wheels,
 * tracks) keeps its centre within `spread` × `bounds.ground` (the footprint's equal-area radius) of the centre.
 */
export function partPlans(parts: PartShape[], b: DebrisBounds & { body?: DebrisBody | null }): PartPlan[] {
  const weight = (p: { volume?: number; radius: number }) => (p.volume !== undefined ? Math.cbrt(Math.max(0, p.volume)) : p.radius);
  const body = b.body && b.body.volume > 0 ? b.body : null;
  const biggestPart = Math.max(1e-6, ...parts.map(weight));
  const ref = Math.max(biggestPart, body ? weight(body) : 0);
  // With an unparted body the body is the hull (it only moves with the whole model); else the biggest part is.
  const mainIndex = body ? -1 : parts.findIndex((p) => weight(p) === biggestPart);
  const s = b.spread ?? DESTROY_DEFAULTS.spread;
  return parts.map((p, i) => {
    const main = i === mainIndex;
    const size = weight(p) / ref;
    const big = main || !!p.track || size >= BIG_PART;
    // How high the part's top reaches above its centre at a tilt.
    const reachAt = (a: number) => (Number.isFinite(a) ? Math.min(p.radius, p.halfHeight * Math.cos(a) + p.radius * Math.sin(a)) : p.radius);
    let tilt = big ? HULL_TILT : size >= MEDIUM_PART ? MEDIUM_TILT : Infinity;
    // A part up top that would poke above the object as it tumbles (a hatch, a thin barrel) only tips.
    if (!Number.isFinite(tilt) && p.y + p.radius > b.height) tilt = MEDIUM_TILT;
    // A long part up top (a barrel) tips less, so its raised end stays under the object's height too.
    while (Number.isFinite(tilt) && tilt > HULL_TILT && p.y + reachAt(tilt) > b.height) tilt = Math.max(HULL_TILT, tilt - Math.PI / 180);
    const lim = debrisLimits({ dist: p.dist, y: p.y }, b);
    const reach = reachAt(tilt);
    const headroom = Math.max(0, b.height - (p.y + Math.max(reach, p.halfHeight)));
    const rise = Math.min(lim.rise, headroom, big ? 0.12 * b.height : Infinity);
    let travel = big ? Math.min(lim.travel, 0.1 * b.radius) : lim.travel;
    if (p.running && b.ground) travel = Math.min(travel, Math.max(0.15 * b.ground, s * b.ground - p.dist));
    const bottom = Math.max(0, p.y - p.halfHeight);
    // A hull-sized part up on the hull (a turret) lands back where it sat; everything else falls to the ground.
    const floor = big && bottom > 0.25 * b.height ? 0 : bottom;
    return { main, big, size, launch: big ? 0.35 : 1 - 0.5 * size, tilt, travel, rise, floor };
  });
}

/**
 * A rotation angle for a part over the clip: free spinners turn `spin` radians in all, slowing on each bounce;
 * limited parts ease to their tilt and stay there (u = t / duration).
 */
export function partTilt(plan: Pick<PartPlan, 'tilt'>, spin: number, u: number, grounded: number) {
  if (!Number.isFinite(plan.tilt)) return (spin * u) / (1 + grounded);
  const k = 1 - (1 - Math.min(1, Math.max(0, u / 0.35))) ** 3;
  return Math.sign(spin || 1) * plan.tilt * k;
}

/**
 * partTilt along a throw, continuous (FB-027 follow-up): a free spinner turns at `spin` per clip, slowed to
 * 1 / (1 + bounces) of that after each bounce, so its angle never jumps when it lands. (spin × u / (1 + bounces)
 * halved the angle at the first bounce: a jump of up to ~3 turns in one frame, which the keyframes between swung
 * through wildly for parts whose pivot is far from their centre, like Synty's wheels pivoting at the tank's origin.)
 */
export function tiltAlong(plan: Pick<PartPlan, 'tilt'>, spin: number, samples: DebrisSample[], duration: number) {
  if (Number.isFinite(plan.tilt)) return (t: number) => partTilt(plan, spin, t / duration, 0);
  const angles: number[] = [];
  let a = 0;
  samples.forEach((s, i) => {
    if (i) a += ((spin * (s.t - samples[i - 1].t)) / duration) / (1 + s.grounded);
    angles.push(a);
  });
  const dt = samples.length > 1 ? samples[1].t - samples[0].t : 1;
  return (t: number) => angles[Math.min(angles.length - 1, Math.max(0, Math.round(t / dt)))];
}

// ---- collapse: the transition for any model (FB-028) ----

/** Defaults of the `collapse` template. */
export const COLLAPSE_DEFAULTS = {
  duration: 1.4,
  /** Shake amplitude (cm). */
  shake: 8,
  /** Sink at the end (% of the model's height); it squashes by half as much. */
  sink: 10,
  /** Dust puffs (0 = none). */
  dust: 18,
  /** 1: a short explosion flash and fire puffs at the start. */
  blast: 0,
  /** 1: the model fades out (into the destination state in a states export). */
  fade: 1,
} as const;

/**
 * The look of `collapse`'s dust (FB-028 follow-up): dark earthy browns that darken as the cloud thickens (sRGB,
 * by fraction of the clip), nearly opaque at their peak, so the cloud reads at 64×32 tile scale against a pale
 * building. The pale greys before washed out. Each puff fades in over 8 % from its start and is gone by 95 %.
 */
export const COLLAPSE_DUST = {
  colours: [[0, '#6b5e4f'], [0.5, '#4e463d'], [1, '#3b3631']] as [number, string][],
  opacity: 0.95,
} as const;

/**
 * The whole-model motion of `collapse` at u ∈ [0, 1]: a decaying shake over the first 45 %, then it sinks (metres),
 * squashes (vertical scale, by half the sink's fraction of the height) and tilts (radians) with gravity-like
 * easing until 75 %.
 */
export function collapseMotion(u: number, o: { shake: number; sink: number; height?: number }) {
  const c = Math.min(1, Math.max(0, u));
  const amp = o.shake * Math.max(0, 1 - c / 0.45);
  const fall = Math.min(1, Math.max(0, (c - 0.15) / 0.6)) ** 2;
  const sinkFraction = o.height ? Math.min(0.5, o.sink / o.height) : 0;
  return {
    x: amp > 0 ? amp * Math.sin(c * Math.PI * 2 * 9) : 0,
    z: amp > 0 ? amp * Math.sin(c * Math.PI * 2 * 7 + 1) : 0,
    sink: o.sink * fall,
    scaleY: 1 - 0.5 * sinkFraction * fall,
    tilt: ((2.5 * Math.PI) / 180) * fall,
  };
}

/**
 * One dust puff of `collapse`: it starts at the model's foot (inside its footprint), rolls outwards and rises; it
 * never leaves the footprint circle or rises past the model's height, and it is gone (opacity 0) from 95 % of the
 * clip on, so the last frame is the destination state alone. `r` is a seeded random source.
 */
export function dustPuff(i: number, n: number, b: { radius: number; height: number }, r: () => number) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 + r() * 0.8;
  const start = b.radius * (0.35 + 0.35 * r());
  const reach = b.radius * (0.15 + 0.2 * r());
  const size = Math.min(b.radius * (0.45 + 0.35 * r()), b.height * 1.2);
  const delay = 0.04 + 0.3 * r();
  const lift = b.height * (0.15 + 0.35 * r());
  return {
    size,
    at(u: number) {
      const k = Math.min(1, Math.max(0, (u - delay) / (1 - delay)));
      const scale = size * (0.35 + 0.65 * (1 - (1 - k) ** 3));
      // Inside the footprint circle and under the model's height, whatever its size.
      const dist = Math.min(start + reach * (1 - (1 - k) ** 2), Math.max(0, b.radius - scale / 2));
      const y = Math.min(scale * 0.35 + lift * k, Math.max(scale * 0.35, b.height - scale / 2));
      const fadeIn = Math.min(1, Math.max(0, (u - delay) / 0.08));
      const fadeOut = 1 - Math.min(1, Math.max(0, (u - 0.6) / 0.35));
      return { x: Math.cos(a) * dist, y, z: Math.sin(a) * dist, scale, opacity: COLLAPSE_DUST.opacity * fadeIn * fadeOut };
    },
  };
}

/**
 * `collapse:blast=1`'s flash and fire puffs (FB-044), sized and placed by the model's footprint (`radius`, metres,
 * half its widest side), not its height: a tall thin model (the 1.7 × 1.7 × 12.3 m radio tower) got a flash 18 m
 * across centred 6 m up, wider than its frame column, which the frame cropped into a rectangular slab. The flash is
 * a radial glow billboard at most 2.4 × the radius across (the footprint's diagonal for a square one) and 1.5 × the
 * height, low on the model; the puffs stay inside 1.2 × the radius around the centre and below the model's top.
 */
export function blastPlan(b: { radius: number; height: number }) {
  const radius = Math.max(0.05, b.radius), height = Math.max(0.05, b.height);
  const flashSize = Math.min(2.4 * radius, 1.5 * height);
  const size = Math.min(0.5 * height, radius);
  const room = 1.2 * radius;
  // Low on the model: lift a little as they grow, never through its top.
  const climb = Math.min(height, 2 * radius) * 0.3;
  return {
    flash: { size: flashSize, y: Math.min(height / 2, flashSize * 0.35) },
    puffs: 6,
    puff: {
      size,
      /** The farthest a puff's centre travels from the centre. */
      reach: Math.max(0, room - size / 2),
      /** A puff thrown `dist` (≤ reach) out, at u ∈ [0, 1] of its life. */
      at(u: number, dist: number) {
        const k = 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
        const scale = size * (0.4 + 0.6 * k);
        const y = Math.max(scale * 0.35, Math.min(scale * 0.5 + climb * k, height - scale / 2));
        return { dist: Math.min(dist, Math.max(0, room - size / 2)) * k, y, scale };
      },
    },
  };
}
