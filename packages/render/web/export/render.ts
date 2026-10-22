// Moved from synty-sprite-generator apps/web/src/export/exporter.ts (P2, ali3b/sloponator#9): the half that needs the
// three.js scene. It samples the clips, measures the framing, the object footprint, footsteps, ground speed, strike
// events, sockets and body boxes, and renders every clip × direction's frames (styled, with their opaque boxes) as
// PNG strips it hands to the Node runner. What the old exporter did after that — the page layout, composing the
// sheets, the manifests, validation, the zip — is @slop/sprites, driven by `slop build` (packages/cli/src/build/pack.ts).
// Gone with the move: the GIF previews, the layered (one sheet per equipment item) and aligned (--align-to) passes,
// the LPC fixed layout (the plan side stays; the placements are the packer's).
import {
  RPGMAKER_SAMPLES, computeFraming, frameKey, framingClips, isObjectAssetKind, objectInfo, objectSlices, objectStates, resolveDirections, nearestFrame, estimateGroundSpeed, isLocomotionClip,
  resolveClipSpeed, detectFootsteps, type TrackPoint, annotateStrikes, bodyBoxes, detectStrikes, headStrike, maxWindowFrames, fastestStrike, strikeAt, HEAD_LENGTH, type BodyBoxes, type ClipEvent,
  type StrikeInput, type StrikeLimb, type ClipInput, type Direction, type ExportProfile, type FrameInput, type Framing, WEAPON_CLASSES, isArmedClass, putAwayDuring,
  type ValidationIssue, type ViewConfig, styleForKind, type FrameProgress, type StateCollision, releasedBy, releaseModeOf, type ReleaseMode, FRAME_CACHE_VERSION, type FrameUnitKeyInput, type CachedFrame,
  stripName, LPC_SLOTS,
} from '@slop/sprites';
import type { RenderOutput, RenderedUnit } from '../../src/protocol';
import * as THREE from 'three';
import { heldInfo, type RenderLayer, type SpriteRenderer } from '../render/SpriteRenderer';
import { applyStyle } from './stylize';
import { StripWriter, clipDataHash, nodeNames } from './frameCache';

export interface ExportClip {
  name: string;
  loop: boolean;
  clip: THREE.AnimationClip | null;
  /** Named events in this (edited) clip's seconds: "release", "hit", "cast"… */
  events?: { t: number; name: string }[];
  /**
   * Name of an event to place automatically on the clip's key moment (the frame where the weapon tip, or
   * the hand, moves fastest) when no event of that name was given — e.g. "hit" for an attack clip.
   */
  autoKey?: string | null;
  /** false: no automatic events (footsteps, the key moment): the clip's events were cleared on purpose. */
  autoEvents?: boolean;
  /** Ground speed the bake recorded (hips travel in source units): informational only, exports measure their own. */
  speed?: number | null;
  /** Ground speed the clip is made for (m/s): procedural templates declare it. Wins over measuring. */
  knownSpeed?: number | null;
  /** Weapon class this clip belongs to (multi-class exports), or its per-clip `with` group. */
  cls?: string;
  /** Per-clip `with` (FB-074): the clip holds its own items; other hand-held items are put away during it. */
  perClip?: boolean;
  /** With perClip: what its items do at the clip's `release` event (FB-103; default hide). */
  release?: ReleaseMode;
  /** A procedural gun pose: weapons are held along the gun forearm in this clip ('two_hand': from hand to hand; see alignStyleGrips). */
  ownGrip?: boolean | 'two_hand';
  /** Object states: the state this clip shows (a still) or the transition into it (`from` set), and its model. */
  state?: { name: string; from?: string; loop?: string; asset: string; look?: string; collision?: StateCollision };
  /** What the clip was made from (the set item: template params, the sprite's own trim), for the frame cache key. */
  source?: unknown;
  /** SF-FB-025: a still: one frame per direction, the pose at this time of `clip` (seconds), whatever the fps. */
  stillAt?: number;
}

/**
 * Moveset moves with no weapon of their style on the character (rifle moves with only a pistol): they render
 * empty-handed. `armed` holds the classes of every mounted item, layered or baked into the body (FB-009).
 */
export function styleWithoutWeapon(clipClasses: (string | undefined)[], armed: string[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const cls of new Set(clipClasses.filter((c): c is string => !!c && isArmedClass(c)))) {
    if (armed.includes(cls)) continue;
    const label = WEAPON_CLASSES.find((c) => c.id === cls)?.label ?? cls;
    out.push({ level: 'warn', code: 'style_without_weapon', message: `${label} moves have no ${label.toLowerCase()} weapon equipped: they render empty-handed` });
  }
  return out;
}

/** Loop-aware sample times: loops stop one frame short of the start (seamless); one-shots end on their last pose. */
export function clipSampleTimes(duration: number, fps: number, loop: boolean) {
  if (duration <= 0) return [0];
  const steps = Math.max(1, Math.round(duration * fps));
  if (loop) return Array.from({ length: steps }, (_, i) => (i / steps) * duration);
  // Sample the end pose just before the end: at exactly `duration` the mixer wraps back to the first pose.
  return Array.from({ length: steps + 1 }, (_, i) => Math.min((i / steps) * duration, duration - 1e-4));
}

/** Profile view requirements override the Studio's view (e.g. RPG Maker needs 4 directions in its order). */
export function effectiveView(view: ViewConfig, profile: ExportProfile): ViewConfig {
  const v = { ...view, ...(profile.view ?? {}) };
  // A profile that fixes the direction set also drops chosen directions (FB-098).
  if (profile.view?.directions) delete v.angles;
  return v;
}

function sampleTimes(duration: number, n: number, loop: boolean) {
  if (n <= 1 || duration <= 0) return [0];
  // Loops end one frame before the start (seamless); one-shots include their last pose.
  return Array.from({ length: n }, (_, i) => (loop ? i / n : i / (n - 1)) * duration);
}

/** Opaque bounding box of a frame (alpha > 0). */
function opaqueBox(c: HTMLCanvasElement) {
  const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface RenderOptions {
  sr: SpriteRenderer;
  asset: { name: string; pack: string; kind: string; category?: string | null };
  view: ViewConfig;
  clips: ExportClip[];
  profile: ExportProfile;
  /** Extra image layers aligned with the sheet (normal maps for 2D lighting, depth, palette UVs, shadow). */
  layers?: Exclude<RenderLayer, 'color'>[];
  /** Named points tracked per frame (hands, head, muzzle, attachments). */
  sockets?: { name: string; object: THREE.Object3D }[];
  /** Foot bones for footstep events; with the hips (and hands, for crawls) they measure locomotion ground speed. */
  feet?: { left: THREE.Object3D | null; right: THREE.Object3D | null; hips?: THREE.Object3D | null; hands?: (THREE.Object3D | null)[]; knees?: (THREE.Object3D | null)[]; elbows?: (THREE.Object3D | null)[]; head?: THREE.Object3D | null };
  /** Characters: skeleton joints by canonical name (hips, spine1…, head, thigh_l…) for the per-frame body boxes (SF-FB-009). */
  body?: Record<string, THREE.Object3D>;
  /** How engines should draw the sheet ('add' for glowing FX). */
  blend?: 'normal' | 'add';
  /** Notes to record in the export's validation. */
  notes?: ValidationIssue[];
  /** Objects: the frame pivot is the object's anchor per direction ("anchor", the default, FB-029) or the model origin ("origin"). */
  pivot?: 'anchor' | 'origin';
  /** Movesets that have a weapon equipped (batch exports): a style's moves without one are flagged. */
  armedClasses?: string[];
  /** A status line, and while frames render how many are done (at most twice a second). */
  onProgress?: (msg: string, frames?: FrameProgress) => void;
  /**
   * FB-121: frames cached per clip × direction. `model` identifies the prepared model (asset record, loadout, FX,
   * lighting, scene fingerprint). `lookup` is the runner's: for each unit the cached per-frame data, or null for a
   * miss (also with `bypass`, when everything is rendered again).
   */
  frameCache?: { model: unknown; bypass?: boolean; lookup(units: { id: string; input: Omit<FrameUnitKeyInput, 'renderer'>; n: number }[]): Promise<(CachedFrame[] | null)[]> };
  /** A rendered unit's strips and per-frame data, as soon as they are complete. */
  emit: (unit: RenderedUnit) => Promise<void>;
  /** Render with this framing instead of measuring one (a waist split's sheets share the whole body's framing). */
  framing?: Framing;
  /** false: no automatic footstep events. */
  footsteps?: boolean;
}

/** A frame rendered blank twice although a neighbour in its clip × direction is not: the GPU handed back nothing. */
export class BlankFrameError extends Error {
  constructor(readonly clip: string, readonly direction: string, readonly index: number) {
    super(`blank frame: ${clip} ${direction} #${index} rendered fully transparent twice while the frame next to it is not (a GPU readback failure: run again, or --gpu software)`);
    this.name = 'BlankFrameError';
  }
}

export async function runRender(opts: RenderOptions): Promise<Omit<RenderOutput, 'asset'>> {
  const { sr, profile } = opts;
  // SF-FB-024: the model's own size factor (set on the renderer by prepare). Fitted views fit it whatever its size.
  const modelScale = opts.view.scale.mode === 'fit' ? 1 : sr.modelScale;
  // Additive FX sheets are not lit by engine 2D lights: a normal map would be wasted pages.
  if (opts.blend === 'add' && opts.layers?.includes('normal')) opts = { ...opts, layers: opts.layers.filter((l) => l !== 'normal') };
  const view = effectiveView(opts.view, profile);
  const dirs: Direction[] = resolveDirections(view);
  sr.setQuality(view.quality);
  const rendered = dirs.filter((d) => d.mirrorOf === null);
  const validation: ValidationIssue[] = [...(opts.notes ?? [])];

  // What to render: (clip, frame times) per output clip.
  type Plan = { name: string; loop: boolean; clip: THREE.AnimationClip | null; times: number[]; dirs: Direction[]; cls?: string; perClip?: boolean; release?: ReleaseMode };
  const plans: Plan[] = [];
  if (profile.special === 'rpgmaker') {
    const c = opts.clips[0];
    const d = c.clip?.duration ?? 0;
    plans.push({ name: c.name, loop: true, clip: c.clip, times: RPGMAKER_SAMPLES.map((t) => t * d), dirs: rendered });
  } else if (profile.special === 'lpc') {
    for (const slot of LPC_SLOTS) {
      const c = opts.clips.find((x) => x.name === profile.settings[slot.slot]);
      if (!c) continue;
      plans.push({
        name: slot.slot, loop: c.loop, clip: c.clip,
        times: sampleTimes(c.clip?.duration ?? 0, slot.frames, c.loop),
        dirs: rendered.filter((d) => (slot.rows as readonly string[]).includes(d.name)),
      });
    }
    if (!plans.length) throw new Error('Map at least one of your clips to an LPC slot (walk, slash, …).');
  } else {
    for (const c of opts.clips) {
      const sampled = c.stillAt !== undefined ? [c.stillAt] : clipSampleTimes(c.clip?.duration ?? 0, view.fps, c.loop);
      plans.push({ name: c.name, loop: c.stillAt !== undefined ? false : c.loop, clip: c.clip, times: sampled, dirs: rendered, cls: c.cls, ...(c.perClip ? { perClip: true, ...(c.release ? { release: c.release } : {}) } : {}) });
    }
  }
  // A moveset whose moves have no weapon of that style renders empty hands in a weapon pose (the rifle
  // style with only a pistol equipped).
  if (opts.armedClasses) validation.push(...styleWithoutWeapon(plans.map((p) => p.cls), opts.armedClasses));

  // One framing for the whole export so every clip shares scale and pivot.
  // Object states: the stills set it; transitions (debris flying) are drawn into the same frame and cropped by it.
  const stateOf = (p: Plan) => opts.clips.find((c) => c.name === p.name)?.state;
  const framed = framingClips(plans, (p) => !!stateOf(p)?.from);
  const measured: Framing = computeFraming(sr.measureClips(framed.map((p) => ({ clip: p.clip, times: p.times }))), view);
  const framing: Framing = opts.framing ?? measured;
  const { frameWidth: fw, frameHeight: fh } = framing;
  // Objects (props, vehicles): footprint, anchor and ground collision from the model at the first frame's pose.
  // Glowing effects stand on nothing.
  const object = isObjectAssetKind(opts.asset.kind) && opts.blend !== 'add' && plans.length
    ? (() => {
        // A state's own collision (FB-085: a blown gate collides with nothing) wins over the sprite's.
        const measure = (plan: Plan) => {
          sr.setClip(plan.clip);
          const collision = stateOf(plan)?.collision ?? view.collision;
          return objectInfo({ ...sr.groundShape(plan.times[0] ?? 0, { tris: collision === 'concave' }), collisionHeight: view.collisionHeight, collision, subject: opts.asset, view, framing, directions: dirs });
        };
        // Object states: the base state (the first clip) sets the footprint and anchor; each state adds its own.
        const base = measure(plans[0]);
        const stills = plans.filter((p) => stateOf(p) && !stateOf(p)!.from);
        if (!base || !stills.length) return base;
        return objectStates(
          base,
          stills.map((p) => ({ name: stateOf(p)!.name, animation: p.name, asset: stateOf(p)!.asset, ...(stateOf(p)!.look ? { look: stateOf(p)!.look } : {}), ...(stateOf(p)!.loop ? { loop: stateOf(p)!.loop } : {}), info: measure(p) })),
          plans.filter((p) => stateOf(p)?.from).map((p) => ({ animation: p.name, from: stateOf(p)!.from!, to: stateOf(p)!.name, asset: stateOf(p)!.asset })),
        );
      })()
    : null;
  // Large objects on a diamond tile lock: per-tile-column strips for depth sorting (rects into each frame).
  if (view.slice === 'columns') {
    const slices = object ? objectSlices(object, view, framing) : null;
    if (object && slices) object.slices = slices;
    else validation.push({ level: 'warn', code: 'slice_skipped', message: object ? 'slice columns needs a diamond tile lock (e.g. --tile 64x32): no strips written' : 'slice columns is for objects (props, buildings): no strips written' });
  }

  // Footsteps: a foot that comes down to the ground after swinging a real distance (detectFootsteps), so a
  // stance bouncing on the spot gets none. Clips whose events were cleared (autoEvents false) or that carry their
  // own footstep events get no automatic ones.
  const events = new Map<string, ClipEvent[]>();
  if ((opts.feet?.left || opts.feet?.right) && opts.footsteps !== false) {
    const v = new THREE.Vector3();
    const at = (o: THREE.Object3D | null | undefined): TrackPoint | null => (o ? (o.getWorldPosition(v), [v.x, v.y, v.z]) : null);
    // Only cycles (walk, run…): in one-shots a body lying on the ground would read as feet planting.
    for (const plan of plans.filter((p) => p.loop)) {
      const c = opts.clips.find((x) => x.name === plan.name);
      if (c?.autoEvents === false || c?.events?.some((e) => /^footstep_/.test(e.name))) continue;
      sr.setClip(plan.clip);
      const hips: TrackPoint[] = [], left: TrackPoint[] = [], right: TrackPoint[] = [];
      for (const t of plan.times) {
        sr.setTime(t);
        const h = at(opts.feet.hips), l = at(opts.feet.left), r = at(opts.feet.right);
        if (h) hips.push(h);
        if (l) left.push(l);
        if (r) right.push(r);
      }
      events.set(plan.name, detectFootsteps({ hips: hips.length ? hips : null, left: left.length ? left : null, right: right.length ? right : null }));
    }
  }

  // Ground speed of locomotion cycles (speedMps), measured on the posed skeleton in metres (scale fix applied):
  // planted feet (or hands) slide back relative to the hips at the ground speed. Sampled finely, not per frame.
  const measuredSpeed = new Map<string, number>();
  const hipsBone = opts.feet?.hips;
  const contactBones = [opts.feet?.left, opts.feet?.right, ...(opts.feet?.hands ?? [])].filter((b): b is THREE.Object3D => !!b);
  if (hipsBone && contactBones.length) {
    const v = new THREE.Vector3();
    const at = (o: THREE.Object3D): TrackPoint => {
      o.getWorldPosition(v);
      return [v.x, v.y, v.z];
    };
    for (const plan of plans) {
      const c = opts.clips.find((x) => x.name === plan.name);
      if (!plan.clip || c?.knownSpeed || !isLocomotionClip(plan.name, plan.loop)) continue;
      sr.setClip(plan.clip);
      const times = clipSampleTimes(plan.clip.duration, 60, plan.loop);
      const hips: TrackPoint[] = [];
      const contacts: TrackPoint[][] = contactBones.map(() => []);
      for (const t of times) {
        sr.setTime(t);
        hips.push(at(hipsBone));
        contactBones.forEach((b, k) => contacts[k].push(at(b)));
      }
      const s = estimateGroundSpeed({ times, duration: plan.clip.duration, loop: plan.loop, hips, contacts });
      if (s !== null) measuredSpeed.set(plan.name, s);
    }
  }

  // Clip events: given ones (stored edits, template events) plus the automatic key moment. A `hit` is placed where
  // the striking hand or foot reaches out furthest (detectStrike, SF-FB-007; a combo gets one hit per strike,
  // detectStrikes), or with a held weapon where its tip moves fastest; every hit gets its limb (the hand, foot, knee
  // or elbow furthest forward, SF-FB-020) and active window (hit → hit_end, SF-FB-008; automatic ones at most 0.25 s). Other key events (shoot, cast, release…) sit where the weapon tip (else the muzzle, else a hand) moves fastest.
  const socketOf = (name: string) => opts.sockets?.find((s) => s.name === name);
  const tipSocket = socketOf('weapon_tip');
  const keySocket = tipSocket ?? socketOf('muzzle') ?? socketOf('hand_r') ?? socketOf('hand_l');
  const limbObjects: [StrikeLimb, THREE.Object3D | null | undefined][] = [
    ['hand_l', opts.feet?.hands?.[0]], ['hand_r', opts.feet?.hands?.[1]], ['foot_l', opts.feet?.left], ['foot_r', opts.feet?.right],
    ['knee_l', opts.feet?.knees?.[0]], ['knee_r', opts.feet?.knees?.[1]], ['elbow_l', opts.feet?.elbows?.[0]], ['elbow_r', opts.feet?.elbows?.[1]], ['head', opts.feet?.head],
  ];
  // The hand holding the weapon: the hand bone the tip marker hangs under.
  const weaponLimb = ((): StrikeLimb | null => {
    for (let o: THREE.Object3D | null = tipSocket?.object ?? null; o; o = o.parent) {
      const hit = limbObjects.find(([l, b]) => b === o && l.startsWith('hand'));
      if (hit) return hit[0];
    }
    return null;
  })();
  for (const plan of plans) {
    const c = opts.clips.find((x) => x.name === plan.name);
    if (!c) continue;
    const list: ClipEvent[] = events.get(plan.name) ?? [];
    for (const e of c.events ?? []) list.push({ frame: nearestFrame(plan.times, e.t), name: e.name });
    const auto = c.autoEvents !== false;
    const wantsKey = !!c.autoKey && auto && plan.times.length > 2 && !list.some((e) => e.name === c.autoKey);
    const hasHit = list.some((e) => e.name === 'hit') || (wantsKey && c.autoKey === 'hit');
    if (!wantsKey && !hasHit) {
      events.set(plan.name, list.sort((a, b) => a.frame - b.frame));
      continue;
    }
    // Sample the key socket, the hips and the hands, feet, knees, elbows and head once per frame.
    sr.setClip(plan.clip);
    const v = new THREE.Vector3();
    const at = (o: THREE.Object3D): TrackPoint => (o.getWorldPosition(v), [v.x, v.y, v.z]);
    const key: TrackPoint[] = [], hips: TrackPoint[] = [];
    const limbs: Partial<Record<StrikeLimb, TrackPoint[]>> = {};
    for (const [l, b] of limbObjects) if (b) limbs[l] = [];
    for (const t of plan.times) {
      sr.setTime(t);
      if (keySocket) key.push(at(keySocket.object));
      if (opts.feet?.hips) hips.push(at(opts.feet.hips));
      for (const [l, b] of limbObjects) if (b) limbs[l]!.push(at(b));
    }
    // The head strikes only in head attacks (SF-FB-022): by the clip's name, or the source clip's.
    const input: StrikeInput = { hips: hips.length ? hips : null, limbs, head: headStrike(plan.name) || headStrike(plan.clip?.name ?? '') };
    const weapon = tipSocket && weaponLimb ? fastestStrike(key, weaponLimb) : null;
    // Automatic windows last at most 0.25 s (a long trimmed combo held one window to its end); set by hand, any length.
    const cap = maxWindowFrames(plan.times.length > 1 ? plan.times[1] - plan.times[0] : 0);
    if (wantsKey) {
      if (c.autoKey === 'hit') {
        for (const s of weapon ? [weapon] : detectStrikes(input, cap)) list.push({ frame: s.frame, name: 'hit' });
      } else if (keySocket) {
        const s = fastestStrike(key, 'hand_r');
        if (s) list.push({ frame: s.frame, name: c.autoKey! });
      }
    }
    const last = plan.times.length - 1;
    events.set(plan.name, annotateStrikes(list, (frame) => (weapon ? { ...weapon, frame, endFrame: weapon.frame === frame ? weapon.endFrame : Math.min(last, frame + 1) } : strikeAt(input, frame)), auto, cap));
  }

  const extraLayers = (opts.layers ?? []) as RenderLayer[];
  const sockets = new Map<string, Record<string, { x: number; y: number }>>();
  const boxes = new Map<string, BodyBoxes>();
  const bodyJoints = opts.body && opts.body.hips ? Object.entries(opts.body) : null;
  const wp = new THREE.Vector3();
  const inputs: FrameInput[] = [];

  // FB-121: frames cached per clip × direction. A unit the cache holds is not rendered: its per-frame data comes
  // from the cache (and its pixels stay with the runner). The others are rendered and handed over as they complete.
  type Unit = { id: string; input: Omit<FrameUnitKeyInput, 'renderer'>; n: number; hit: CachedFrame[] | null };
  const units = new Map<string, Unit>();
  const unitOf = (plan: Plan, d: Direction) => units.get(`${plan.name}\n${d.name}`)!;
  const fc = opts.frameCache ?? null;
  const render = { layers: extraLayers.map(String), blend: opts.blend ?? 'normal', layered: null, partsOnly: false, sockets: (opts.sockets ?? []).map((x) => x.name), bodyBoxes: !!bodyJoints };
  // The model scale only when not 1, so frames cached before it existed keep their keys.
  const model = { asset: opts.asset, prepared: fc?.model ?? null, ...(modelScale !== 1 ? { modelScale } : {}) };
  const names = nodeNames(sr.assetRoot ? [sr.assetRoot, ...sr.holders] : sr.holders);
  for (const plan of plans) {
    const c = opts.clips.find((x) => x.name === plan.name);
    const clip = {
      name: plan.name, loop: plan.loop, times: plan.times, data: clipDataHash(plan.clip, names), source: c?.source ?? null, cls: plan.cls ?? null, perClip: !!plan.perClip,
      release: plan.release ?? null, ownGrip: c?.ownGrip ?? null, state: c?.state ?? null, events: events.get(plan.name) ?? [],
      grips: plan.clip ? sr.holders.map((h) => sr.clipGrip(plan.clip!, h)?.toArray().map((x) => Math.round(x * 1e5) / 1e5) ?? null) : [],
    };
    for (const d of plan.dirs) {
      const input = { version: { cache: FRAME_CACHE_VERSION }, model, view, framing, render, clip, direction: { name: d.name, worldAngle: d.worldAngle } };
      units.set(`${plan.name}\n${d.name}`, { id: `${plan.name}\n${d.name}`, input, n: plan.times.length, hit: null });
    }
  }
  if (fc) {
    // Always asked, even when bypassed: the runner needs every unit's key to store what gets rendered (it answers
    // misses for all of them on a forced render).
    const list = [...units.values()];
    const found = await fc.lookup(list.map((u) => ({ id: u.id, input: u.input, n: u.n }))).catch(() => list.map(() => null));
    if (!fc.bypass) list.forEach((u, i) => {
      const f = found[i];
      if (f && f.length === u.n) u.hit = f;
    });
  }
  const reused = [...units.values()].reduce((s, u) => s + (u.hit ? u.n : 0), 0);
  const prevSize = { w: sr.renderer.domElement.width, h: sr.renderer.domElement.height };
  sr.renderer.setPixelRatio(1);
  sr.renderer.setSize(fw, fh, false);
  let n = 0;
  const frameCount = plans.reduce((s, p) => s + p.times.length * p.dirs.length, 0);
  const total = (frameCount - reused) * (1 + extraLayers.length);
  if (fc) opts.onProgress?.(reused ? `reused ${reused} of ${frameCount} frames from the frame cache, rendering ${frameCount - reused}` : fc.bypass ? `rendering all ${frameCount} frames (forced: frame cache not used)` : `rendering ${frameCount} frames (none cached)`);
  /** This frame's body boxes: the joints projected, the head's top derived, padded at the body's pixels per metre. */
  const frameBoxes = (): BodyBoxes => {
    const rect = { width: fw, height: fh };
    const pts: Record<string, { x: number; y: number } | null> = {};
    for (const [name, o] of bodyJoints!) pts[name] = sr.project(o.getWorldPosition(wp), rect);
    const body = opts.body!;
    const neck = body.neck ?? body.spine3 ?? body.spine2;
    if (body.head && neck) {
      const head = body.head.getWorldPosition(new THREE.Vector3());
      const up = head.clone().sub(neck.getWorldPosition(new THREE.Vector3()));
      if (up.lengthSq() > 1e-8) pts.head_top = sr.project(head.addScaledVector(up.normalize(), HEAD_LENGTH), rect);
    }
    // Pixels per metre at the hips, across the screen (perspective views shrink with distance).
    const hips = body.hips.getWorldPosition(new THREE.Vector3());
    const right = sr.lastCamera ? new THREE.Vector3().setFromMatrixColumn(sr.lastCamera.matrixWorld, 0).normalize() : new THREE.Vector3(1, 0, 0);
    const a = sr.project(hips, rect), b = sr.project(hips.clone().add(right), rect);
    const ppm = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : framing.ppm ?? 0;
    return bodyBoxes(pts, ppm);
  };
  /**
   * One frame. readPixels, not drawImage(canvas): see SpriteRenderer.snapshot. A headless GPU hands back an empty
   * buffer now and then (the old generator saw it about 1 frame in 10 under load on NVIDIA EGL), so a blank result
   * is rendered once more; a frame still blank after that is reported to the caller, which decides whether it is
   * blank for real (its neighbours are too: a part hidden by its trigger) or a failure (#10).
   */
  const renderFrame = (plan: Plan, d: Direction, i: number, layer?: RenderLayer) => {
    for (let attempt = 0; ; attempt++) {
      sr.clear();
      if (layer) sr.render(view, framing, d.worldAngle, plan.times[i], { x: 0, y: 0, width: fw, height: fh }, false, layer);
      else sr.render(view, framing, d.worldAngle, plan.times[i], { x: 0, y: 0, width: fw, height: fh });
      const snap = sr.snapshot();
      if (!snap.blank || attempt >= 1) return snap;
    }
  };
  // Post-render look (outline, grading, texture).
  const style = styleForKind(view, 'body');
  const started = performance.now();
  let lastReport = -Infinity;
  const progress = () => {
    n++;
    const now = performance.now();
    if (now - lastReport < 500 && n < total) return;
    lastReport = now;
    opts.onProgress?.(`rendered ${n}/${total} frames`, { done: n, total, elapsedMs: Math.round(now - started) });
  };
  // The render loop never waits for anything, so progress reports and the page would stall until it ends: hand the
  // event loop a turn about twice a second (a message, which background tabs do not throttle).
  let lastYield = performance.now();
  const breathe = async () => {
    if (performance.now() - lastYield < 500) return;
    await new Promise<void>((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(null);
    });
    lastYield = performance.now();
  };
  const emits: Promise<void>[] = [];
  try {
    sr.setPass(null);
    sr.setShadow(true);
    for (const plan of plans) {
      sr.setClip(plan.clip);
      // Per-clip `with` (FB-074): clip-only items outside their clips, and the sprite's other hand-held items during
      // a clip that brings its own.
      const away = new Set(sr.holders.filter((h) => putAwayDuring(plan, heldInfo(h))));
      sr.setHidden([...away]);
      // Triggered attachment animations start at their event in this clip; springs settle over one pass first.
      const evs = events.get(plan.name) ?? [];
      sr.setTriggerTimes((name) => {
        const e = evs.find((x) => x.name === name);
        return e ? plan.times[e.frame] ?? null : null;
      });
      // A launcher's rocket leaves the tube on the clip's shot (FB-072).
      const shot = evs.find((x) => x.name === 'shoot');
      sr.setShotTime(shot ? plan.times[shot.frame] ?? null : null);
      // A clip's own items leave the hand at its release (FB-103): hidden (default) or dropped from that frame on.
      const release = evs.find((x) => x.name === 'release');
      const mode = releaseModeOf(plan);
      sr.setRelease(release && mode !== 'keep' ? { t: plan.times[release.frame] ?? 0, mode, holders: sr.holders.filter((h) => releasedBy(plan, heldInfo(h))) } : null);
      sr.warmSecondary(plan.times);
      for (const d of plan.dirs) {
        const unit = unitOf(plan, d);
        if (unit.hit) {
          // From the cache: what this pass would have measured. Springs still step through the frames.
          for (let i = 0; i < plan.times.length; i++) {
            const key = frameKey(plan.name, d.name, i);
            const f = unit.hit[i];
            if (sr.hasSecondary) sr.pose(d.worldAngle, plan.times[i]);
            if (f.sockets && opts.sockets?.length) sockets.set(key, f.sockets);
            if (f.boxes && bodyJoints) boxes.set(key, f.boxes);
            inputs.push({ key, clip: plan.name, direction: d.name, index: i, width: fw, height: fh, opaque: f.opaque });
          }
          continue;
        }
        const writers = new Map<string, StripWriter>([[stripName('body'), new StripWriter(unit.n, fw, fh)]]);
        for (const l of extraLayers) writers.set(stripName('body', l), new StripWriter(unit.n, fw, fh));
        const frames: CachedFrame[] = [];
        const blank: boolean[] = [];
        for (let i = 0; i < plan.times.length; i++) {
          const key = frameKey(plan.name, d.name, i);
          const snap = renderFrame(plan, d, i);
          const c = snap.canvas;
          blank.push(snap.blank);
          applyStyle(c, style);
          const box = opaqueBox(c);
          const pts: Record<string, { x: number; y: number }> = {};
          if (opts.sockets?.length) {
            for (const s of opts.sockets) {
              const p = sr.project(s.object.getWorldPosition(wp), { width: fw, height: fh });
              if (p) pts[s.name] = p;
            }
            sockets.set(key, pts);
          }
          const bb = bodyJoints ? frameBoxes() : undefined;
          if (bb) boxes.set(key, bb);
          frames.push({ opaque: box, ...(opts.sockets?.length ? { sockets: pts } : {}), ...(bb ? { boxes: bb } : {}) });
          inputs.push({ key, clip: plan.name, direction: d.name, index: i, width: fw, height: fh, opaque: box });
          writers.get(stripName('body'))!.put(i, c);
          for (const layer of extraLayers) {
            const lc = renderFrame(plan, d, i, layer).canvas;
            writers.get(stripName('body', layer))!.put(i, lc);
            progress();
          }
          progress();
          await breathe();
        }
        // A frame still blank after its second render, next to one that is not: the GPU dropped it (#10).
        for (let i = 0; i < blank.length; i++) {
          if (!blank[i]) continue;
          if ((i > 0 && !blank[i - 1]) || (i + 1 < blank.length && !blank[i + 1])) throw new BlankFrameError(plan.name, d.name, i);
        }
        // Encoded and handed over as soon as the unit is complete, so a long export never holds more than one
        // clip × direction's strips.
        const strips: Record<string, string> = {};
        for (const [name, w] of writers) strips[name] = await w.encodeBase64();
        const cols = writers.get(stripName('body'))!.cols;
        emits.push(opts.emit({ id: unit.id, strips, cols, frames }));
      }
    }
    await Promise.all(emits);
  } finally {
    sr.setPass(null);
    sr.setHidden([]);
    sr.setShadow(true);
    sr.renderer.setSize(prevSize.w, prevSize.h, false);
  }
  const clipsIn: ClipInput[] = plans.map((p) => {
    const c = opts.clips.find((x) => x.name === p.name);
    // A procedural clip's declared speed is for the model at real size: a bigger model strides further (SF-FB-024).
    const speedMps = resolveClipSpeed({ name: p.name, loop: p.loop, declared: c?.knownSpeed ? c.knownSpeed * sr.modelScale : c?.knownSpeed, measured: measuredSpeed.get(p.name) });
    return { name: p.name, loop: p.loop, frameCount: p.times.length, speedMps: speedMps ?? null };
  });
  opts.onProgress?.('rendered');
  return {
    view, framing, directions: dirs,
    plans: plans.map((p) => ({ name: p.name, loop: p.loop, times: p.times, dirs: p.dirs.map((d) => d.name), ...(p.cls ? { cls: p.cls } : {}), ...(p.perClip ? { perClip: true } : {}), ...(p.release ? { release: p.release } : {}) })),
    clips: clipsIn, events: Object.fromEntries(events), object, sockets: Object.fromEntries(sockets), boxes: Object.fromEntries(boxes), inputs, validation, modelScale,
    blend: opts.blend ?? 'normal', layers: extraLayers.map(String),
    units: [...units.values()].map((u) => ({ id: u.id, clip: u.id.split('\n')[0], direction: u.id.split('\n')[1], n: u.n, input: u.input, cached: !!u.hit })),
    cache: { reused, total: frameCount }, special: profile.special,
  };
}
