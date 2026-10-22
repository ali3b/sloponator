// Moved from synty-sprite-generator packages/shared/src/export/strike.ts (P2, ali3b/sloponator#8).
/**
 * The strike of an attack clip (SF-FB-007/008): which limb strikes, the frame it is out furthest (the `hit` event)
 * and how long it stays out (the active window, `hit` → `hit_end`).
 *
 * Each limb is followed relative to the hips (so root motion, a lean or a jump does not count), along the facing.
 * Its extension at a frame is how far it is in front of the hips beyond its stance reach: the lower of the clip's
 * first and last frames (an attack starts and ends on guard), so a guard that already holds a fist forward, a foot
 * planted behind or an arm swinging back and returning to the guard does not count (SF-FB-007 follow-up). The limb
 * with the largest extension strikes; its `hit` is the first frame of its peak, and the window lasts while it keeps
 * `hold` (85 %) of that extension, at least two frames when the clip has them and at most 0.25 s (MAX_WINDOW_S). A
 * combo gets one hit per strike (detectStrikes). A clip trimmed to start or end
 * mid-strike has no stance to measure from: set its events by hand (or per sprite, SF-FB-022).
 *
 * The limb a hit names (strikeAt) is the one that moves furthest forward into the hit, of the hands, feet, knees,
 * elbows and, in a headbutt (`head`), the head (SF-FB-020, SF-FB-022): a jump kick's foot, a knee strike's knee, an
 * elbow's elbow, a headbutt's head.
 *
 * Held weapons strike with the weapon: the hit is where the weapon tip moves fastest (fastestStrike).
 *
 * Positions are in metres (Y up), one per sampled frame.
 */

import type { ClipEvent } from '../manifest/context.js';
import type { TrackPoint } from './groundSpeed.js';

export const STRIKE_LIMBS = ['hand_l', 'hand_r', 'foot_l', 'foot_r', 'knee_l', 'knee_r', 'elbow_l', 'elbow_r', 'head'] as const;
export type StrikeLimb = (typeof STRIKE_LIMBS)[number];
/** The limbs an automatic hit is timed on (knees and elbows only name the limb of a hit, SF-FB-020). */
const TIMING_LIMBS: readonly StrikeLimb[] = ['hand_l', 'hand_r', 'foot_l', 'foot_r', 'head'];

export interface StrikeInput {
  /** Hips per sample; without them the limbs' own positions are used (clips baked in place). */
  hips?: TrackPoint[] | null;
  /** Hand, foot, knee, elbow and head positions per sample (a limb left out or null is not considered). */
  limbs: Partial<Record<StrikeLimb, TrackPoint[] | null>>;
  /** The direction the character faces (horizontal; default +Z, glTF forward). */
  forward?: TrackPoint;
  /** Fraction of the hit's extension the limb must keep to stay active (default 0.85). */
  hold?: number;
  /**
   * A head attack (SF-FB-022, `headStrike(clipName)`: a headbutt): the head strikes, whatever the hands do (in a
   * guard they are in front of the face). Elsewhere the head is left out: a body diving forward into a crouch or a
   * lunge carries it out in front, and it would take the fist's hit.
   */
  head?: boolean;
}

/** Clips the head strikes in (SF-FB-022): headbutts. */
export function headStrike(clipName: string) {
  return /head[_ -]?butt/i.test(clipName);
}

export interface Strike {
  /** The `hit` frame: the striking limb at its furthest. */
  frame: number;
  /** The last active frame (inclusive; the `hit_end` event), >= frame. */
  endFrame: number;
  limb: StrikeLimb;
  /** How far the limb is out past its stance reach at the hit (m). */
  reach: number;
}

/** Below this extension (m) nothing really strikes (a stance shuffle): no automatic hit. */
export const MIN_STRIKE_REACH = 0.1;
/** The default share of the extension a limb keeps while the strike is active. */
export const STRIKE_HOLD = 0.85;

/**
 * Per limb, per frame, along the facing and relative to the hips: `ahead`, how far it is in front of the hips, and
 * `ext`, how far past its stance reach (the lower of the first and last frames).
 */
function forwardTracks(input: StrikeInput) {
  const fwd = input.forward ?? [0, 0, 1];
  const fl = Math.hypot(fwd[0], fwd[2]) || 1;
  const out = new Map<StrikeLimb, { ext: number[]; ahead: number[] }>();
  for (const limb of STRIKE_LIMBS) {
    const track = input.limbs[limb];
    if (!track || track.length < 2 || (limb === 'head' && !input.head)) continue;
    const hips = input.hips && input.hips.length === track.length ? input.hips : null;
    const ahead = track.map((p, i) => ((p[0] - (hips ? hips[i][0] : 0)) * fwd[0] + (p[2] - (hips ? hips[i][2] : 0)) * fwd[2]) / fl);
    const base = Math.min(ahead[0], ahead[ahead.length - 1]);
    out.set(limb, { ext: ahead.map((a) => a - base), ahead });
  }
  return out;
}

/** Hand and elbow, foot and knee: the end of a limb and the joint before it. */
const CHAINS: StrikeLimb[][] = [['hand_l', 'elbow_l'], ['hand_r', 'elbow_r'], ['foot_l', 'knee_l'], ['foot_r', 'knee_r']];

/**
 * The last active frame from `frame` on: through the limb's peak within the next two frames (a hit placed as it
 * swings in), then while it keeps `hold` of that peak's extension; at least frame + 1 when there is one.
 */
function windowEnd(ext: number[], frame: number, hold: number) {
  let peak = frame;
  for (let i = frame + 1; i <= frame + 2 && i < ext.length; i++) if (ext[i] > ext[peak] + 1e-9) peak = i;
  let end = peak;
  const floor = Math.max(0, ext[peak]) * hold;
  while (end + 1 < ext.length && ext[end + 1] >= floor && ext[peak] > 0) end++;
  return Math.min(ext.length - 1, Math.max(end, frame + 1));
}

/** The strike of a clip sampled once per frame: the limb that extends furthest and its peak. Null when nothing does. */
export function detectStrike(input: StrikeInput): Strike | null {
  const tracks = forwardTracks(input);
  let best: Strike | null = null;
  for (const [limb, { ext }] of tracks) {
    if (!TIMING_LIMBS.includes(limb) || (tracks.has('head') && limb !== 'head')) continue;
    let f = 0;
    for (let i = 1; i < ext.length; i++) if (ext[i] > ext[f] + 1e-9) f = i;
    if (!best || ext[f] > best.reach + 1e-9) best = { frame: f, endFrame: f, limb, reach: ext[f] };
  }
  if (!best || best.reach < MIN_STRIKE_REACH) return null;
  const { ext } = tracks.get(best.limb)!;
  return { ...best, endFrame: windowEnd(ext, best.frame, input.hold ?? STRIKE_HOLD), reach: +best.reach.toFixed(3) };
}

/** The longest automatic window (s, MAX_WINDOW_S): a hit and hit_end set by hand (per clip or per sprite) may be longer. */
export const MAX_WINDOW_S = 0.25;
/**
 * Two peaks of one limb are separate strikes only when it pulls back between them to below this share of the lower
 * peak (a kick, the foot back, a second kick), and a strike counts only once its limb has come out from this share of
 * its peak (a foot already forward at the start of a trimmed clip is no strike).
 */
const STRIKE_SEPARATION = 0.5;
/** A combo's further strikes: at least this share of its biggest one, and at least SECOND_STRIKE_REACH (m). */
const SECOND_STRIKE_SHARE = 0.6;
/** Below this (m) a further peak is a step or a guard shuffle, not a second strike. */
export const SECOND_STRIKE_REACH = 0.25;
/**
 * A further kick lifts the foot at least this far (m) above its lowest point in the clip: a foot sliding forward on the
 * floor is a step (a capoeira ginga steps 0.7 m), not a kick.
 */
export const KICK_LIFT = 0.2;

/** The frames to cap an automatic window at, for frames `dt` seconds apart. */
export function maxWindowFrames(dt: number, seconds = MAX_WINDOW_S) {
  return dt > 0 ? Math.max(1, Math.round(seconds / dt)) : Infinity;
}

/**
 * One limb's peaks that are strikes of their own: risen from below half of it, pulled back in between (else one
 * strike, at the first peak unless a later one is clearly further out), with `after`, the lowest it gets after it
 * (before its next peak).
 */
function limbPeaks(ext: number[], hold: number) {
  const peaks: { frame: number; reach: number; low: number; after: number }[] = [];
  let low = ext[0];
  for (let i = 0; i < ext.length; i++) {
    const rising = i === 0 || ext[i] > ext[i - 1] + 1e-9;
    const top = i === ext.length - 1 || ext[i] >= ext[i + 1] - 1e-9;
    if (rising && top) {
      const last = peaks[peaks.length - 1];
      // Not pulled back far since the last peak: one strike (the higher of the two).
      if (last && low >= STRIKE_SEPARATION * Math.min(last.reach, ext[i])) {
        if (ext[i] * hold > last.reach + 1e-9) peaks[peaks.length - 1] = { ...last, frame: i, reach: ext[i] };
      } else peaks.push({ frame: i, reach: ext[i], low, after: Infinity });
      low = ext[i];
    }
    low = Math.min(low, ext[i]);
  }
  peaks.forEach((p, k) => (p.after = Math.min(...ext.slice(p.frame, peaks[k + 1]?.frame ?? ext.length))));
  return peaks.filter((p) => p.low <= STRIKE_SEPARATION * p.reach);
}

/**
 * Every strike of a clip (a combo kicks or punches several times): each limb's peaks, separated where it pulls back
 * below half its reach in between (limbPeaks), the biggest one always (as detectStrike), the others when they reach at
 * least 60 % of it and SECOND_STRIKE_REACH, are of its kind (kicks with a kick, punches with a punch), pull back out of
 * their window and, for a kick, lift the foot (KICK_LIFT). Strikes within two frames of each other (both fists out
 * together) are one: the bigger. Each window ends where its limb leaves `hold` of its peak, before the next strike (another
 * limb takes over) and after at most `maxFrames` frames (maxWindowFrames: 0.25 s). In frame order; empty when
 * nothing strikes.
 */
export function detectStrikes(input: StrikeInput, maxFrames = Infinity): Strike[] {
  const main = detectStrike(input);
  if (!main) return [];
  const tracks = forwardTracks(input);
  const hold = input.hold ?? STRIKE_HOLD;
  const min = Math.max(SECOND_STRIKE_REACH, SECOND_STRIKE_SHARE * main.reach);
  const all: Strike[] = [main];
  // Further strikes are of the biggest one's kind: a kick combo's kicks, a punch combo's punches (an arm thrown up
  // into a cartwheel between two kicks is no punch).
  const kind = (l: StrikeLimb) => l.slice(0, 4);
  for (const [limb, { ext }] of tracks) {
    if (!TIMING_LIMBS.includes(limb) || kind(limb) !== kind(main.limb)) continue;
    const track = input.limbs[limb]!;
    const floor = Math.min(...track.map((q) => q[1]));
    for (const p of limbPeaks(ext, hold)) {
      // A further strike comes back too (a limb still out at the end of a trimmed clip is on its way to the guard),
      // and a kick leaves the floor.
      if (p.reach < min || p.after >= hold * p.reach || (limb === main.limb && Math.abs(p.frame - main.frame) <= 1)) continue;
      if (limb.startsWith('foot') && track[p.frame][1] - floor < KICK_LIFT) continue;
      all.push({ frame: p.frame, endFrame: windowEnd(ext, p.frame, hold), limb, reach: +p.reach.toFixed(3) });
    }
  }
  // Strikes within two frames of each other (both fists out together): one, the bigger. Later, another limb takes over.
  const kept: Strike[] = [];
  for (const s of [...all].sort((a, b) => b.reach - a.reach)) {
    if (kept.some((k) => Math.abs(s.frame - k.frame) <= 2)) continue;
    kept.push(s);
  }
  kept.sort((a, b) => a.frame - b.frame);
  return kept.map((s, i) => {
    const next = kept[i + 1]?.frame ?? Infinity;
    return { ...s, endFrame: Math.max(s.frame, Math.min(s.endFrame, next - 1, s.frame + maxFrames)) };
  });
}

/** A limb counts as striking forward once it is this far (m) past its stance; below it the furthest out decides. */
export const MIN_FORWARD = 0.1;

/**
 * The strike at a given hit frame (a hit set by hand, or a weapon's) and the window from there. The limb (unless
 * given; SF-FB-020): in a headbutt the head; else the arm or leg that moves furthest forward into the hit (from
 * the four frames before it to that frame or up to two frames later: a hit placed as the leading arm swings, a
 * frame before the kick lands), and of that arm or leg the part
 * that leads, furthest in front: the foot of a kick, the knee of a knee strike (the foot hangs under it), the fist
 * of a punch, the elbow of an elbow. Without a forward strike, the limb out furthest. Null without limb tracks.
 */
export function strikeAt(input: StrikeInput, frame: number, limb?: StrikeLimb | null): Strike | null {
  const tracks = forwardTracks(input);
  if (!tracks.size) return null;
  const f = Math.max(0, Math.min(Math.max(...[...tracks.values()].map((t) => t.ext.length)) - 1, frame));
  const peak = (v: number[] | undefined) => (v ? Math.max(...v.slice(f, f + 3)) : -Infinity);
  /**
   * How far a part moves forward into the hit: at the hit or up to two frames later, past where it was over the
   * four frames before. Not the reach past the stance: in a clip trimmed mid-move (a crouch) a knee that steps back
   * at the end would count as out in front all along.
   */
  const swing = (t: { ahead: number[] } | undefined) => {
    if (!t) return -Infinity;
    let best = -Infinity;
    for (let i = f; i <= f + 2 && i < t.ahead.length; i++) best = Math.max(best, t.ahead[i] - Math.min(...t.ahead.slice(Math.max(0, f - 4), i + 1)));
    return best;
  };
  let pick: StrikeLimb | null = limb && tracks.has(limb) ? limb : tracks.has('head') ? 'head' : null;
  if (!pick) {
    let best = MIN_FORWARD;
    for (const chain of CHAINS) {
      const moved = Math.max(...chain.map((l) => swing(tracks.get(l))));
      if (moved <= best + 1e-9) continue;
      best = moved;
      const [end, joint] = chain;
      // The end of the limb unless the joint is further in front (by 2 cm).
      pick = joint && (!tracks.has(end) || peak(tracks.get(joint)?.ahead) > peak(tracks.get(end)!.ahead) + 0.02) ? joint : end;
    }
  }
  if (!pick) for (const [l, t] of tracks) if (!pick || peak(t.ext) > peak(tracks.get(pick)!.ext)) pick = l;
  const { ext } = tracks.get(pick!)!;
  const at = Math.min(ext.length - 1, f);
  return { frame: at, endFrame: windowEnd(ext, at, input.hold ?? STRIKE_HOLD), limb: pick!, reach: +(ext[at] ?? 0).toFixed(3) };
}

/**
 * A weapon's strike: the frame where its tip moves fastest (into that frame), active while it keeps at least half
 * that speed. Null for fewer than three samples.
 */
export function fastestStrike(tip: TrackPoint[], limb: StrikeLimb): Strike | null {
  if (tip.length < 3) return null;
  const speed = tip.map((p, i) => (i ? Math.hypot(p[0] - tip[i - 1][0], p[1] - tip[i - 1][1], p[2] - tip[i - 1][2]) : 0));
  let f = 1;
  for (let i = 2; i < speed.length; i++) if (speed[i] > speed[f]) f = i;
  return { frame: f, endFrame: windowEnd(speed, f, 0.5), limb, reach: 0 };
}

/**
 * Give every `hit` its striking `limb` and active window: `endFrame` is the frame of the first `hit_end` at or after
 * it (before the next hit) when the clip has one, else the strike's own window, at most `maxFrames` frames past the
 * hit (maxWindowFrames, 0.25 s) and ending before the next hit, which is also added as a `hit_end` event when
 * `addEnds` (automatic events allowed). `strike(frame)` measures the strike at a hit frame.
 */
export function annotateStrikes(events: ClipEvent[], strike: (frame: number) => Strike | null, addEnds: boolean, maxFrames = Infinity): ClipEvent[] {
  const sorted = [...events].sort((a, b) => a.frame - b.frame);
  const hits = sorted.filter((e) => e.name === 'hit');
  if (!hits.length) return sorted;
  const out: ClipEvent[] = [];
  for (const e of sorted) {
    if (e.name !== 'hit') {
      out.push(e);
      continue;
    }
    const next = hits.find((h) => h.frame > e.frame)?.frame ?? Infinity;
    const end = sorted.find((x) => x.name === 'hit_end' && x.frame >= e.frame && x.frame < next);
    const s = strike(e.frame);
    const hit: ClipEvent = { ...e, ...(s ? { limb: s.limb } : {}) };
    if (end) hit.endFrame = end.frame;
    else if (s && addEnds) {
      hit.endFrame = Math.max(e.frame, Math.min(s.endFrame, e.frame + maxFrames, Number.isFinite(next) ? next - 1 : s.endFrame));
      out.push({ frame: hit.endFrame, name: 'hit_end' });
    }
    out.push(hit);
  }
  // A hit and its hit_end on one frame (a one-frame window): the hit first.
  return out.sort((a, b) => a.frame - b.frame || Number(a.name === 'hit_end') - Number(b.name === 'hit_end'));
}
