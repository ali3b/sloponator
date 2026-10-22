import * as THREE from 'three';
import { DESTROY_DEFAULTS, DESTROY_JOLT, boundedThrow, destroyOpacity, partPlans, tiltAlong } from '../../shared/debris';
import {
  X, Y, Z, about, assetBox, assetCentre, assetPivot, assetPoseAt, deg, easeOut, longAxis, nodesWithRole, opacityTracks, pulse, rand, rootTracks, thinAxis, transformTracks,
} from './helpers';
import { duration, type Template, type TemplateAsset } from './types';

const TAU = Math.PI * 2;

/** Box (asset frame) of the model's own geometry outside the given part nodes and their children: a tank's hull. */
export function bodyBox(root: THREE.Object3D, parts: Set<THREE.Object3D>) {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const visit = (o: THREE.Object3D) => {
    if (parts.has(o) || o.name.startsWith('ssg_stage') || (o as THREE.Sprite).isSprite) return;
    const g = (o as THREE.Mesh).geometry;
    if (g) {
      g.computeBoundingBox();
      box.union(g.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    }
    o.children.forEach(visit);
  };
  root.children.forEach(visit);
  return box;
}

/** Vehicle centre and whether a part is at the front (+Z is forward). */
function frame(root: THREE.Object3D) {
  const c = assetBox(root, root).getCenter(new THREE.Vector3());
  return { centre: c, isFront: (n: THREE.Object3D) => assetCentre(n, root).z > c.z };
}

function wheelSpin(root: THREE.Object3D, a: TemplateAsset, d: number, revs: number, steer = 0) {
  const { isFront } = frame(root);
  return nodesWithRole(root, a.parts, 'wheel').flatMap((w) =>
    transformTracks(w, root, d, (t) => {
      const spin = about(X, (t / d) * revs * TAU); // rolling towards +Z
      return steer && isFront(w) ? about(Y, steer).multiply(spin) : spin;
    }, { centre: assetCentre(w, root) }),
  );
}

/** Where a door/lid hinges: its own pivot, unless the pivot sits at the asset origin (then a bbox edge). */
function hinge(n: THREE.Object3D, root: THREE.Object3D, edge: (b: THREE.Box3) => THREE.Vector3) {
  const p = assetPivot(n, root);
  return p.length() > 0.05 ? p : edge(assetBox(n, root));
}

export const drive: Template = {
  id: 'drive', label: 'Drive (loop)', kind: 'part', requires: ['wheel'], loop: true,
  params: [duration(0.25, 0.5, 4), { key: 'revolutions', label: 'Wheel turns per loop', min: 1, max: 8, step: 1, default: 1 }],
  build: (root, a, p) => new THREE.AnimationClip('drive', p.duration, wheelSpin(root, a, p.duration, p.revolutions)),
};

export const driveTurn: Template = {
  id: 'drive_turn', label: 'Drive while turning', kind: 'part', requires: ['wheel'], loop: true,
  params: [
    duration(0.25, 0.5, 4),
    { key: 'revolutions', label: 'Wheel turns per loop', min: 1, max: 8, step: 1, default: 1 },
    { key: 'steer', label: 'Steer angle (° left +)', min: -40, max: 40, step: 1, default: 25 },
    { key: 'roll', label: 'Body roll (°)', min: 0, max: 8, step: 0.5, default: 2 },
  ],
  build(root, a, p) {
    const steer = deg(p.steer);
    const tracks = wheelSpin(root, a, p.duration, p.revolutions, steer);
    for (const s of nodesWithRole(root, a.parts, 'steering'))
      tracks.push(...transformTracks(s, root, p.duration, () => about(thinAxis(s, root), steer * 3), { centre: assetCentre(s, root), keys: 1 }));
    // Lean out of the turn.
    tracks.push(...rootTracks(root, p.duration, () => ({ rot: about(Z, -Math.sign(p.steer) * deg(p.roll)) }), 1));
    return new THREE.AnimationClip('drive_turn', p.duration, tracks);
  },
};

export const idleEngine: Template = {
  id: 'idle_engine', label: 'Engine idle (vibration)', kind: 'part', requires: [], loop: true,
  params: [duration(0.25, 0.5, 2), { key: 'amplitude', label: 'Shake (cm)', min: 0, max: 3, step: 0.1, default: 0.6 }, { key: 'cycles', label: 'Shakes per loop', min: 1, max: 12, step: 1, default: 4 }],
  build: (root, _a, p) =>
    new THREE.AnimationClip('idle_engine', p.duration, rootTracks(root, p.duration, (t) => ({ pos: new THREE.Vector3(0, (p.amplitude / 100) * Math.sin((t / p.duration) * p.cycles * TAU), 0) }))),
};

export const brake: Template = {
  id: 'brake', label: 'Brake (nose dip)', kind: 'part', requires: [], loop: false,
  params: [duration(0.3, 0.8, 3), { key: 'dip', label: 'Dip (°)', min: 0, max: 10, step: 0.5, default: 3 }],
  build: (root, _a, p) =>
    new THREE.AnimationClip('brake', p.duration, rootTracks(root, p.duration, (t) => {
      const u = t / p.duration;
      const k = u < 0.3 ? easeOut(u / 0.3) : 1 - easeOut((u - 0.3) / 0.7) * 1; // dip fast, settle back
      return { rot: about(X, deg(p.dip) * k) };
    })),
};

const MODE = { key: 'mode', label: 'Mode (0 open, 1 close, 2 open+close loop)', min: 0, max: 2, step: 1, default: 0 };
const openness = (u: number, mode: number) => (mode === 0 ? easeOut(u) : mode === 1 ? 1 - easeOut(u) : pulse(u));

export const doors: Template = {
  id: 'doors', label: 'Doors open / close', kind: 'part', requires: ['door'], loop: false,
  params: [duration(0.3, 1, 4), { key: 'angle', label: 'Open angle (°)', min: 10, max: 120, step: 1, default: 70 }, MODE],
  build(root, a, p) {
    const { centre } = frame(root);
    const flat = (v: THREE.Vector3) => Math.hypot(v.x - centre.x, v.z - centre.z);
    const tracks = nodesWithRole(root, a.parts, 'door').flatMap((door) => {
      const c = assetCentre(door, root);
      const h = hinge(door, root, (b) => new THREE.Vector3(c.x, c.y, b.max.z)); // front edge
      // Open outward: pick the swing direction that moves the door away from the vehicle.
      const swung = (s: number) => c.clone().sub(h).applyQuaternion(about(Y, s * deg(p.angle))).add(h);
      const sign = flat(swung(1)) >= flat(swung(-1)) ? 1 : -1;
      return transformTracks(door, root, p.duration, (t) => about(Y, sign * deg(p.angle) * openness(t / p.duration, p.mode)), { centre: h });
    });
    return new THREE.AnimationClip('doors', p.duration, tracks);
  },
};

export const lids: Template = {
  id: 'lids', label: 'Hatches / lids / canopy open', kind: 'part', requires: [], anyOf: ['lid', 'canopy', 'wheel_door'], loop: false,
  params: [duration(0.3, 1, 4), { key: 'angle', label: 'Open angle (°)', min: 10, max: 150, step: 1, default: 80 }, MODE],
  build(root, a, p) {
    const tracks = nodesWithRole(root, a.parts, 'lid', 'canopy', 'wheel_door').flatMap((lid) => {
      const c = assetCentre(lid, root);
      const h = hinge(lid, root, (b) => new THREE.Vector3(c.x, b.max.y, b.min.z)); // rear top edge
      const up = (s: number) => c.clone().sub(h).applyQuaternion(about(X, s * deg(p.angle))).add(h).y;
      const sign = up(1) >= up(-1) ? 1 : -1;
      return transformTracks(lid, root, p.duration, (t) => about(X, sign * deg(p.angle) * openness(t / p.duration, p.mode)), { centre: h });
    });
    return new THREE.AnimationClip('lids', p.duration, tracks);
  },
};

export const lift: Template = {
  id: 'lift', label: 'Lift up / down (forklift)', kind: 'part', requires: ['lift'], loop: true,
  params: [duration(0.5, 2, 6), { key: 'height', label: 'Height (m)', min: 0.1, max: 3, step: 0.05, default: 1 }],
  build: (root, a, p) =>
    new THREE.AnimationClip('lift', p.duration, nodesWithRole(root, a.parts, 'lift').flatMap((n) =>
      transformTracks(n, root, p.duration, () => new THREE.Quaternion(), { offset: (t) => new THREE.Vector3(0, p.height * pulse(t / p.duration), 0) }),
    )),
};

function propellers(root: THREE.Object3D, a: TemplateAsset, d: number, revs: number) {
  return nodesWithRole(root, a.parts, 'propeller').flatMap((n) =>
    transformTracks(n, root, d, (t) => about(thinAxis(n, root), (t / d) * revs * TAU), { centre: assetCentre(n, root) }),
  );
}

export const propellerSpin: Template = {
  id: 'propeller_spin', label: 'Propellers / rotors spin', kind: 'part', requires: ['propeller'], loop: true,
  params: [duration(0.1, 0.25, 2), { key: 'revolutions', label: 'Turns per loop', min: 1, max: 8, step: 1, default: 1 }],
  build: (root, a, p) => new THREE.AnimationClip('propeller_spin', p.duration, propellers(root, a, p.duration, p.revolutions)),
};

export const fly: Template = {
  id: 'fly', label: 'Fly (bank, bob, props)', kind: 'part', requires: [], loop: true,
  params: [duration(0.5, 2, 6), { key: 'bank', label: 'Bank (°)', min: 0, max: 30, step: 1, default: 6 }, { key: 'bob', label: 'Bob (cm)', min: 0, max: 50, step: 1, default: 8 }],
  build(root, a, p) {
    const tracks = [
      ...rootTracks(root, p.duration, (t) => {
        const u = (t / p.duration) * TAU;
        return { rot: about(Z, deg(p.bank) * Math.sin(u)), pos: new THREE.Vector3(0, (p.bob / 100) * Math.sin(2 * u), 0) };
      }),
      ...propellers(root, a, p.duration, Math.max(1, Math.round(p.duration * 8))),
      ...nodesWithRole(root, a.parts, 'control_surface').flatMap((n) =>
        transformTracks(n, root, p.duration, (t) => about(X, deg(8) * Math.sin((t / p.duration) * TAU)), { centre: assetCentre(n, root) }),
      ),
    ];
    return new THREE.AnimationClip('fly', p.duration, tracks);
  },
};

export const turretSweep: Template = {
  id: 'turret_sweep', label: 'Turret sweep', kind: 'part', requires: [], anyOf: ['turret', 'barrel'], loop: true,
  params: [duration(0.5, 3, 8), { key: 'angle', label: 'Sweep (± °)', min: 5, max: 180, step: 1, default: 45 }],
  build(root, a, p) {
    const turrets = nodesWithRole(root, a.parts, 'turret');
    const barrels = nodesWithRole(root, a.parts, 'barrel');
    const axisPoint = assetCentre(turrets[0] ?? barrels[0] ?? root, root);
    // Barrels are often siblings of the turret, so they rotate about the turret's axis too.
    const tracks = [...turrets, ...barrels.filter((b) => !turrets.some((t) => t === b.parent))].flatMap((n) =>
      transformTracks(n, root, p.duration, (t) => about(Y, deg(p.angle) * Math.sin((t / p.duration) * TAU)), { centre: axisPoint }),
    );
    return new THREE.AnimationClip('turret_sweep', p.duration, tracks);
  },
};

/**
 * Barrel recoil and a body kick. Loops by default (one shot per loop); `once=1` makes it a one-shot (FB-097).
 * Either way the clip carries a `shoot` event at the start (the recoil frame), and the barrel's tip is the
 * `muzzle` socket in the meta (export/extras.ts).
 */
export const fire: Template = {
  id: 'fire', label: 'Fire (barrel recoil)', kind: 'part', requires: ['barrel'], loop: true,
  params: [duration(0.2, 0.6, 3), { key: 'recoil', label: 'Recoil (cm)', min: 1, max: 80, step: 1, default: 25 }, { key: 'kick', label: 'Body kick (°)', min: 0, max: 6, step: 0.5, default: 1.5 },
    { key: 'once', label: 'Once (0 loop, 1 one-shot)', min: 0, max: 1, step: 1, default: 0 }],
  events: () => [{ at: 0, name: 'shoot' }],
  build(root, a, p) {
    const { centre } = frame(root);
    const kick = (u: number) => (u < 0.1 ? u / 0.1 : 1 - easeOut((u - 0.1) / 0.9));
    const tracks = nodesWithRole(root, a.parts, 'barrel').flatMap((b) => {
      const c = assetCentre(b, root);
      const axis = longAxis(b, root).clone();
      // Point the axis from the vehicle centre out along the barrel; recoil goes the other way.
      if (axis.dot(c.clone().sub(centre)) < 0) axis.negate();
      return transformTracks(b, root, p.duration, () => new THREE.Quaternion(), { offset: (t) => axis.clone().multiplyScalar((-p.recoil / 100) * kick(t / p.duration)) });
    });
    tracks.push(...rootTracks(root, p.duration, (t) => ({ rot: about(X, -deg(p.kick) * kick(t / p.duration)) })));
    return new THREE.AnimationClip('fire', p.duration, tracks);
  },
};

export const destroy: Template = {
  id: 'destroy', label: 'Destroy (parts fly apart)', kind: 'part', requires: [], loop: false,
  params: [duration(0.5, 1.6, 5), { key: 'force', label: 'Force (m/s)', min: 1, max: 20, step: 0.5, default: DESTROY_DEFAULTS.force },
    { key: 'spread', label: 'Spread (× footprint radius)', min: 0.25, max: 3, step: 0.05, default: DESTROY_DEFAULTS.spread },
    { key: 'fade', label: 'Fade out at the end (0/1)', min: 0, max: 1, step: 1, default: DESTROY_DEFAULTS.fade }],
  events: () => [{ at: 0, name: 'impact' }],
  build(root, a, p) {
    const { centre } = frame(root);
    // Debris stays within `spread` × the object's footprint radius and below its height (see debris.ts): the
    // states' frame holds the transition, which is drawn into it.
    const box = assetBox(root, root);
    const radius = Math.max(...[box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => Math.hypot(x - centre.x, z - centre.z))));
    const foot = box.getSize(new THREE.Vector3());
    // Running gear stays within the footprint's equal-area radius (FB-027 follow-up: the wheels spread wide).
    const ground = Math.sqrt((foot.x * foot.z) / Math.PI);
    const roles = new Map((a.parts ?? []).map((part) => [part.name, part.role]));
    const nodes = (a.parts ?? []).flatMap((part) => {
      const n = root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(part.name));
      if (!n) return [];
      const b = assetBox(n, root);
      if (b.isEmpty()) return [];
      const size = b.getSize(new THREE.Vector3());
      return [{ name: part.name, n, c: b.getCenter(new THREE.Vector3()), halfHeight: size.y / 2, radius: size.length() / 2, volume: size.x * size.y * size.z }];
    });
    // The hull: the model's own geometry outside every part. Synty's tanks hang their parts under the hull mesh,
    // so the hull is no part; the biggest part (the turret, with its barrel) used to be kept level instead.
    const body = bodyBox(root, new Set(nodes.map((x) => x.n)));
    const bodySize = body.isEmpty() ? null : body.getSize(new THREE.Vector3());
    const bounds = {
      radius, ground, height: Math.max(0.1, box.max.y), spread: p.spread ?? DESTROY_DEFAULTS.spread,
      body: bodySize ? { volume: bodySize.x * bodySize.y * bodySize.z, radius: bodySize.length() / 2 } : null,
    };
    // Weighted by size (FB-027): the hull and hull-sized parts (tracks, turret) stay level, middling parts tip a
    // little, small ones tumble; nothing rises past the object's height.
    const plans = partPlans(nodes.map((x) => {
      const role = roles.get(x.name);
      return {
        dist: Math.hypot(x.c.x - centre.x, x.c.z - centre.z), y: x.c.y, halfHeight: x.halfHeight, radius: x.radius, volume: x.volume,
        running: role === 'wheel' || role === 'track', track: role === 'track',
      };
    }), bounds);
    const moves = nodes.map(({ name, n, c }, i) => {
      const plan = plans[i];
      const out = c.clone().sub(centre).setY(0).normalize();
      if (!Number.isFinite(out.x)) out.set(rand(name) - 0.5, 0, rand(`${name}z`) - 0.5).normalize();
      const f = p.force * plan.launch;
      const v = out.multiplyScalar(f * (0.6 + rand(name))).setY(f * (0.8 + rand(`${name}y`)));
      // Hull-sized parts tip about a level axis (they lean, never twist on screen); the rest about any axis.
      const spinAxis = new THREE.Vector3(rand(`${name}a`) - 0.5, plan.big ? 0 : rand(`${name}b`) - 0.5, rand(`${name}c`) - 0.5).normalize();
      const spin = (2 + 6 * rand(`${name}s`)) * Math.PI;
      // It comes to rest at its floor: the ground (its bottom on it), or back on the hull for a turret.
      const sim = boundedThrow({ x: v.x, y: v.y, z: v.z }, plan.floor, p.duration, { travel: plan.travel, rise: plan.rise });
      const angle = tiltAlong(plan, spin, sim.samples, p.duration);
      const rot = (t: number) => about(spinAxis, angle(t));
      const offset = (t: number) => {
        const o = sim.at(t).p;
        return new THREE.Vector3(o.x, o.y, o.z);
      };
      return { n, rot, offset, centre: c, pose: assetPoseAt(n, root, rot, { centre: c, offset }) };
    });
    // A part under another moving part (a barrel under the turret) is placed against its parent's pose at each
    // key; it used to get its own throw on top of its parent's (thrown twice, through the hull and the ground).
    const posed = new Map(moves.map((m) => [m.n, m.pose]));
    const poseOf = (o: THREE.Object3D): ((t: number) => THREE.Matrix4) | null => {
      if (o === root || !o.parent) return null;
      const own = posed.get(o);
      if (own) return own;
      const up = poseOf(o.parent);
      return up ? (t: number) => up(t).multiply(o.matrix) : null;
    };
    const tracks = moves.flatMap((m) => {
      const parentAt = m.n.parent ? poseOf(m.n.parent) : null;
      return transformTracks(m.n, root, p.duration, m.rot, { centre: m.centre, offset: m.offset, keys: 64, ...(parentAt ? { parentAt } : {}) });
    });
    // The body jolts down and tilts as it blows, then settles back (a lasting tilt would lift the far end). 2° is
    // ≤ 3.5° on a 2:1 screen.
    const jolt = nodes.length
      ? rootTracks(root, p.duration, (t) => {
          const k = pulse(Math.min(1, (t / p.duration) / 0.4));
          return { pos: new THREE.Vector3(0, -0.12 * k, 0), rot: about(X, deg(DESTROY_JOLT) * k) };
        })
      : [];
    const fade = p.fade ? opacityTracks(root, p.duration, (t) => destroyOpacity(t / p.duration, p.fade)) : [];
    return new THREE.AnimationClip('destroy', p.duration, [...tracks, ...jolt, ...fade]);
  },
};

export const VEHICLE_TEMPLATES = [drive, driveTurn, idleEngine, brake, doors, lids, lift, propellerSpin, fly, turretSweep, fire, destroy];
