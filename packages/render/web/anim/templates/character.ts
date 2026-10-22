import * as THREE from 'three';
import { X, Y, Z, about, assetBox, assetPivot, assetSpace, deg, ease, nodeByName, pulse, rootTracks, transformTracks } from './helpers';
import type { Template, TemplateAsset } from './types';

/**
 * Procedural poses on the humanoid rig (no pack ships sitting/driving clips). Rotations are given in the
 * asset frame for a T-posed rig (Synty characters rest in a T-pose), and each child's rotation is applied
 * before its parent's, so a +90° knee undoes a -90° hip for the shin.
 */
function pose(root: THREE.Object3D, a: TemplateAsset, rots: Record<string, THREE.Quaternion>, hipDrop: number, name: string) {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [canon, q] of Object.entries(rots)) {
    const bone = a.rigMap?.[canon] && nodeByName(root, a.rigMap[canon]);
    if (bone) tracks.push(...transformTracks(bone, root, 1, () => q, { keys: 1 }));
  }
  const hips = a.rigMap?.hips && nodeByName(root, a.rigMap.hips);
  if (hips && hipDrop) {
    const i = tracks.findIndex((t) => t.name === `${hips.uuid}.quaternion`);
    if (i >= 0) tracks.splice(i, 2);
    tracks.push(...transformTracks(hips, root, 1, () => rots.hips ?? new THREE.Quaternion(), { keys: 1, offset: () => new THREE.Vector3(0, -hipDrop, 0) }));
  }
  return new THREE.AnimationClip(name, 1, tracks);
}

const legsSeated = {
  thigh_l: about(X, deg(-88)),
  thigh_r: about(X, deg(-88)),
  calf_l: about(X, deg(85)),
  calf_r: about(X, deg(85)),
};

export const sit: Template = {
  id: 'sit', label: 'Sit (pose)', kind: 'character', requires: [], loop: true,
  params: [{ key: 'hipDrop', label: 'Hip drop (cm)', min: 0, max: 70, step: 1, default: 40 }],
  build: (root, a, p) =>
    pose(root, a, {
      ...legsSeated,
      // Arms down, hands resting on the thighs.
      upperarm_l: about(X, deg(25)).multiply(about(Z, deg(-72))),
      upperarm_r: about(X, deg(25)).multiply(about(Z, deg(72))),
      lowerarm_l: about(Y, deg(-35)),
      lowerarm_r: about(Y, deg(35)),
    }, p.hipDrop / 100, 'sit'),
};

export const drivePose: Template = {
  id: 'drive_pose', label: 'Drive (seated, hands forward)', kind: 'character', requires: [], loop: true,
  params: [
    { key: 'hipDrop', label: 'Hip drop (cm)', min: 0, max: 70, step: 1, default: 40 },
    { key: 'reach', label: 'Arm drop (°)', min: 0, max: 60, step: 1, default: 30 },
  ],
  build: (root, a, p) =>
    pose(root, a, {
      ...legsSeated,
      spine1: about(X, deg(4)),
      upperarm_l: about(X, deg(p.reach)).multiply(about(Y, deg(-80))),
      upperarm_r: about(X, deg(p.reach)).multiply(about(Y, deg(80))),
      lowerarm_l: about(Y, deg(-25)),
      lowerarm_r: about(Y, deg(25)),
    }, p.hipDrop / 100, 'drive_pose'),
};

/** Arms relaxed at the sides (Synty rigs rest in a T-pose), the base for the procedural combat reactions. */
const armsDown = (spread = 0) => ({
  upperarm_l: about(X, deg(8)).multiply(about(Z, deg(-74 + spread))),
  upperarm_r: about(X, deg(8)).multiply(about(Z, deg(74 - spread))),
  lowerarm_l: about(Y, deg(-12)),
  lowerarm_r: about(Y, deg(12)),
});

/** Time-varying pose: each bone's rotation is a function of u (0..1). */
function motion(root: THREE.Object3D, a: TemplateAsset, length: number, rots: Record<string, (u: number) => THREE.Quaternion>, keys = 24) {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [canon, f] of Object.entries(rots)) {
    const bone = a.rigMap?.[canon] && nodeByName(root, a.rigMap[canon]);
    if (bone) tracks.push(...transformTracks(bone, root, length, (t) => f(t / length), { keys }));
  }
  return tracks;
}

const fixed = (q: THREE.Quaternion) => () => q;

/** Fallback hit reaction (when no pack has one): the torso and head snap back and recover. */
export const hitReact: Template = {
  id: 'hit_react', label: 'Hit reaction (procedural)', kind: 'character', requires: [], loop: false,
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.2, max: 1.5, step: 0.05, default: 0.5 },
    { key: 'angle', label: 'Flinch (°)', min: 5, max: 40, step: 1, default: 18 },
  ],
  events: () => [{ at: 0.15, name: 'hurt' }],
  build: (root, a, p) => {
    // Snap back fast (first 18%), then recover with a small overshoot past upright (outBack), so it reads as
    // an impact rather than a lean. Hips and legs take part: the knees give a little as the body rocks back.
    const back = ease.outBack(1.4);
    const k = (u: number) => (u < 0.18 ? ease.outCubic(u / 0.18) : 1 - back((u - 0.18) / 0.82));
    const arms = Object.fromEntries(Object.entries(armsDown()).map(([b, q]) => [b, fixed(q)]));
    const A = p.angle;
    const tracks = motion(root, a, p.duration, {
      ...arms,
      upperarm_l: (u) => about(X, deg(8 - 14 * k(u))).multiply(about(Z, deg(-74 + 18 * k(u)))),
      upperarm_r: (u) => about(X, deg(8 - 14 * k(u))).multiply(about(Z, deg(74 - 18 * k(u)))),
      lowerarm_l: (u) => about(Y, deg(-12 - 20 * Math.max(0, k(u)))),
      lowerarm_r: (u) => about(Y, deg(12 + 20 * Math.max(0, k(u)))),
      spine1: (u) => about(X, deg(-A * 0.35 * k(u))),
      spine2: (u) => about(X, deg(-A * 0.35 * k(u))),
      spine3: (u) => about(X, deg(-A * 0.3 * k(u))).multiply(about(Y, deg(7 * pulse(u)))),
      head: (u) => about(X, deg(-A * 0.7 * k(Math.max(0, u - 0.04)))), // the head lags the body
      thigh_l: (u) => about(X, deg(-A * 0.25 * Math.max(0, k(u)))),
      thigh_r: (u) => about(X, deg(-A * 0.18 * Math.max(0, k(u)))),
      calf_l: (u) => about(X, deg(A * 0.4 * Math.max(0, k(u)))),
      calf_r: (u) => about(X, deg(A * 0.3 * Math.max(0, k(u)))),
    });
    // The whole body shifts back a few centimetres and dips with the knees.
    const body = rootTracks(root, p.duration, (t) => {
      const v = Math.max(0, k(t / p.duration));
      return { pos: new THREE.Vector3(0, -0.03 * v, -0.06 * v) };
    });
    return new THREE.AnimationClip('hit_react', p.duration, [...tracks, ...body]);
  },
};

/** Fallback death (when no pack has one): knees buckle, the body falls, bounces once and settles. */
export const deathFall: Template = {
  id: 'death_fall', label: 'Death fall (procedural)', kind: 'character', requires: [], loop: false,
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.5, max: 3, step: 0.05, default: 1.3 },
    { key: 'forward', label: 'Fall forward (0/1)', min: 0, max: 1, step: 1, default: 0 },
  ],
  events: () => [{ at: 0.05, name: 'hurt' }, { at: 0.7, name: 'dead' }],
  build: (root, a, p) => {
    const dir = p.forward ? 1 : -1;
    // Phases: 0-0.3 knees buckle; 0.15-0.7 the body topples with gravity; 0.7-1 a small bounce and settle.
    const buckle = (u: number) => ease.inOutQuad(u / 0.3);
    const fall = (u: number) => {
      if (u < 0.15) return 0;
      if (u < 0.7) return ((u - 0.15) / 0.55) ** 2;
      const v = (u - 0.7) / 0.3;
      return 1 - 0.06 * Math.sin(Math.PI * Math.min(1, v * 1.6)) * (1 - v); // bounce off the ground
    };
    const lag = (u: number, d: number) => fall(Math.max(0, u - d)); // limbs follow the body a moment later
    const b = assetBox(root, root);
    const edge = new THREE.Vector3(0, b.min.y, dir > 0 ? b.max.z * 0.6 : b.min.z * 0.6);
    const limbs = motion(root, a, p.duration, {
      upperarm_l: (u) => about(X, deg(8 - 55 * lag(u, 0.06))).multiply(about(Z, deg(-74 + 50 * lag(u, 0.06)))),
      upperarm_r: (u) => about(X, deg(8 - 45 * lag(u, 0.09))).multiply(about(Z, deg(74 - 55 * lag(u, 0.09)))),
      lowerarm_l: (u) => about(Y, deg(-20 - 25 * lag(u, 0.12))),
      lowerarm_r: (u) => about(Y, deg(20 + 15 * lag(u, 0.12))),
      spine1: (u) => about(X, deg(dir * 12 * buckle(u))),
      thigh_l: (u) => about(X, deg(-35 * buckle(u) * (1 - 0.6 * fall(u)))),
      thigh_r: (u) => about(X, deg(-28 * buckle(u) * (1 - 0.4 * fall(u)))),
      calf_l: (u) => about(X, deg(60 * buckle(u) * (1 - 0.7 * fall(u)))),
      calf_r: (u) => about(X, deg(50 * buckle(u) * (1 - 0.5 * fall(u)))),
      head: (u) => about(X, deg(-dir * 22 * lag(u, 0.1))),
    }, 36);
    const body = rootTracks(root, p.duration, (t) => {
      const u = t / p.duration;
      const r = about(X, deg(dir * 88) * fall(u));
      // The knees giving way lowers the body before (and while) it topples.
      const drop = 0.22 * buckle(u) * (1 - fall(u));
      return { rot: r, pos: edge.clone().sub(edge.clone().applyQuaternion(r)).add(new THREE.Vector3(0, -drop, 0)) };
    }, 60);
    return new THREE.AnimationClip('death_fall', p.duration, [...limbs, ...body]);
  },
};

/**
 * Fallback gun shot (when no pack has one — the only "shoot" clips most libraries hold are bow shots, which put
 * the weapon in the drawing hand): the gun arm is up and aimed straight ahead, the shot kicks the arm, hand and
 * shoulders up and they settle back. `twoHanded` brings the other hand under the barrel (rifles).
 */
export const aimShoot: Template = {
  id: 'aim_shoot', label: 'Aim and shoot (procedural)', kind: 'character', requires: [], loop: false, gunPose: true,
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.3, max: 1.5, step: 0.05, default: 0.6 },
    { key: 'twoHanded', label: 'Two hands (0/1)', min: 0, max: 1, step: 1, default: 0 },
    { key: 'kick', label: 'Recoil (°)', min: 0, max: 30, step: 1, default: 12 },
  ],
  events: () => [{ at: 0.12, name: 'shoot' }],
  build: (root, a, p) => {
    // The clip starts aimed (a sprite's shoot clip has no wind-up); the shot lands at 10-14% and the kick decays
    // over the rest of the clip.
    const kick = (u: number) => (u < 0.1 ? 0 : u < 0.14 ? (u - 0.1) / 0.04 : Math.exp(-(u - 0.14) * 9));
    const K = p.kick;
    const two = p.twoHanded >= 0.5;
    const down = armsDown();
    // A T-posed right arm points -X: +90° about Y turns it to +Z (straight ahead); a negative X tilt lifts it.
    const rots: Record<string, (u: number) => THREE.Quaternion> = {
      upperarm_r: (u) => about(X, deg(-6 - K * kick(u))).multiply(about(Y, deg(90))),
      lowerarm_r: (u) => about(Y, deg(4 + K * 0.4 * kick(u))),
      // The automatic grip points a gun's barrel forward while the T-posed arm points sideways, i.e. across the
      // arm; with the arm now forward, turning the hand -90° about Y lines the barrel up with the aim.
      hand_r: (u) => about(X, deg(-K * 0.6 * kick(u))).multiply(about(Y, deg(-90))),
      spine3: (u) => about(X, deg(-K * 0.2 * kick(u))),
      upperarm_l: two ? (u) => about(X, deg(10 - K * 0.6 * kick(u))).multiply(about(Y, deg(-70))) : fixed(down.upperarm_l),
      lowerarm_l: two ? fixed(about(Y, deg(-55))) : fixed(down.lowerarm_l),
    };
    const tracks = motion(root, a, p.duration, rots);
    const body = rootTracks(root, p.duration, (t) => ({ pos: new THREE.Vector3(0, 0, -0.02 * kick(t / p.duration)) }));
    return new THREE.AnimationClip('aim_shoot', p.duration, [...tracks, ...body]);
  },
};

/** Fallback reload (when no pack has one): the gun hand comes up to the chest, the free hand works it and both drop back. */
export const reloadGesture: Template = {
  id: 'reload_gesture', label: 'Reload (procedural)', kind: 'character', requires: [], loop: false,
  params: [{ key: 'duration', label: 'Length (s)', min: 0.5, max: 3, step: 0.05, default: 1.2 }],
  events: () => [{ at: 0.55, name: 'reload' }],
  build: (root, a, p) => {
    // reach: hands up over the first 30%, held, down again over the last 25%; slap: the free hand's push home.
    const reach = (u: number) => ease.inOutQuad(Math.min(1, u / 0.3)) * (u < 0.75 ? 1 : 1 - ease.inOutQuad((u - 0.75) / 0.25));
    const slap = (u: number) => pulse((u - 0.45) / 0.2);
    const tracks = motion(root, a, p.duration, {
      upperarm_r: (u) => about(X, deg(8 - 28 * reach(u))).multiply(about(Y, deg(55 * reach(u)))).multiply(about(Z, deg(74 * (1 - reach(u))))),
      lowerarm_r: (u) => about(Y, deg(12 + 70 * reach(u))),
      upperarm_l: (u) => about(X, deg(8 - 20 * reach(u))).multiply(about(Y, deg(-50 * reach(u) - 10 * slap(u)))).multiply(about(Z, deg(-74 * (1 - reach(u))))),
      lowerarm_l: (u) => about(Y, deg(-12 - 85 * reach(u) + 15 * slap(u))),
      spine3: (u) => about(X, deg(5 * reach(u))),
      head: (u) => about(X, deg(12 * reach(u))), // looks down at the gun
    });
    return new THREE.AnimationClip('reload_gesture', p.duration, tracks);
  },
};

/** Two-bone IK in the asset frame: the upper-arm and forearm directions that put the wrist at `target`. */
function twoBone(shoulder: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3) {
  const toT = target.clone().sub(shoulder);
  const d = Math.min(toT.length(), (a + b) * 0.995);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const elbow = shoulder.clone().add(dir.clone().multiplyScalar(a * cosA)).add(bend.multiplyScalar(a * Math.sqrt(1 - cosA * cosA)));
  const wrist = shoulder.clone().add(dir.clone().multiplyScalar(d));
  return { upper: elbow.clone().sub(shoulder).normalize(), fore: wrist.clone().sub(elbow).normalize() };
}

/**
 * Two-handed rifle carry ("low ready"), laid over the arms of idle, walk and run when no pack has rifle
 * locomotion: the gun hand at the waist in front of the body, the barrel forward, slightly up and across, the
 * free hand under the barrel. Arms are solved with two-bone IK from the rig's own rest proportions, so it fits
 * any humanoid. The gun hand's turn assumes the automatic grip (barrel along the character's forward at rest).
 */
export const rifleCarry: Template = {
  id: 'rifle_carry', label: 'Rifle carry, two hands (procedural)', kind: 'character', requires: [], loop: true, armPose: true,
  params: [
    { key: 'height', label: 'Hand height (0 = hips, 1 = chest)', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'reach', label: 'Hand forward (m)', min: 0.1, max: 0.5, step: 0.01, default: 0.26 },
    { key: 'raise', label: 'Barrel up (°)', min: -20, max: 40, step: 1, default: 12 },
    { key: 'across', label: 'Barrel across the body (°)', min: 0, max: 45, step: 1, default: 22 },
  ],
  build: (root, a, p) => {
    const bone = (k: string) => (a.rigMap?.[k] ? nodeByName(root, a.rigMap[k]) : null);
    const [ur, lr, hr, ul, ll, hips, chest] = ['upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hips', 'spine3'].map(bone);
    if (!ur || !lr || !hr || !ul || !ll || !hips || !chest) return new THREE.AnimationClip('rifle_carry', 1, []);
    const at = (n: THREE.Object3D) => assetPivot(n, root);
    const hl = bone('hand_l');
    const [sR, eR, wR, sL, eL] = [ur, lr, hr, ul, ll].map(at);
    const wL = hl ? at(hl) : eL.clone().add(eL.clone().sub(sL));
    const y = at(hips).y + (at(chest).y - at(hips).y) * p.height;
    // Right is -X in the asset frame (Synty characters face +Z): the gun hand sits a little inside the right shoulder.
    const handR = new THREE.Vector3(sR.x * 0.75, y, sR.z + p.reach);
    const barrel = new THREE.Vector3(0, 0, 1).applyAxisAngle(X, -deg(p.raise)).applyAxisAngle(Y, deg(p.across)).normalize();
    const handL = handR.clone().add(barrel.clone().multiplyScalar(0.3));
    const rots: Record<string, THREE.Quaternion> = {};
    const arm = (side: 'r' | 'l', s: THREE.Vector3, e: THREE.Vector3, w: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3) => {
      const ik = twoBone(s, target, s.distanceTo(e), e.distanceTo(w), pole);
      const U = new THREE.Quaternion().setFromUnitVectors(e.clone().sub(s).normalize(), ik.upper);
      const F = new THREE.Quaternion().setFromUnitVectors(w.clone().sub(e).normalize(), ik.fore);
      rots[`upperarm_${side}`] = U;
      // A child's asset-frame turn is applied before its parent's, so the forearm gets U⁻¹·F to end up at F.
      rots[`lowerarm_${side}`] = U.clone().invert().multiply(F);
      return F;
    };
    const F = arm('r', sR, eR, wR, handR, new THREE.Vector3(-1, -1, -0.3));
    // The gun hand: overall turn = the barrel's direction; the arm already turned it by F.
    rots.hand_r = F.clone().invert().multiply(new THREE.Quaternion().setFromUnitVectors(Z, barrel));
    arm('l', sL, eL, wL, handL, new THREE.Vector3(1, -1, -0.3));
    return pose(root, a, rots, 0, 'rifle_carry');
  },
};

/** Height of the hips above the feet (metres, rest pose): what kneeling and lying down are measured against. */
function hipHeight(root: THREE.Object3D, a: TemplateAsset) {
  const hips = a.rigMap?.hips && nodeByName(root, a.rigMap.hips);
  if (hips) return new THREE.Vector3().setFromMatrixPosition(assetSpace(hips, root)).y;
  const b = assetBox(root, root);
  return (b.max.y - b.min.y) * 0.52;
}

/** The shot: nothing for 10%, the kick at 10-14%, then it decays. */
const shotKick = (u: number) => (u < 0.1 ? 0 : u < 0.14 ? (u - 0.1) / 0.04 : Math.exp(-(u - 0.14) * 9));

/**
 * Arms holding a gun aimed along the body's forward axis tipped by `lift` degrees (0 = straight ahead when
 * standing; -88 = along the head direction, which is ahead along the ground once the body lies face down).
 * `reachR`/`reachL` move one elbow forward a little (crawling), `kick` lifts the gun hand (recoil).
 */
function gunArms(two: boolean, lift: number, o: { kick?: (u: number) => number; reachR?: (u: number) => number; reachL?: (u: number) => number; K?: number } = {}) {
  const K = o.K ?? 12, kick = o.kick ?? (() => 0), reachR = o.reachR ?? (() => 0), reachL = o.reachL ?? (() => 0);
  const down = armsDown();
  const rots: Record<string, (u: number) => THREE.Quaternion> = {
    upperarm_r: (u) => about(X, deg(lift - 6 - K * kick(u) - 12 * reachR(u))).multiply(about(Y, deg(90))),
    lowerarm_r: (u) => about(Y, deg(4 + K * 0.4 * kick(u) + 20 * reachR(u))),
    hand_r: (u) => about(X, deg(-K * 0.6 * kick(u))).multiply(about(Y, deg(-90))),
    upperarm_l: two ? (u) => about(X, deg(lift + 10 - K * 0.6 * kick(u) - 12 * reachL(u))).multiply(about(Y, deg(-70))) : fixed(down.upperarm_l),
    lowerarm_l: two ? (u) => about(Y, deg(-55 - 15 * reachL(u))) : fixed(down.lowerarm_l),
  };
  return rots;
}

/** The kneeling legs of kneel_shoot (right knee on the ground, left foot planted ahead) and how far the body comes down. */
const KNEEL_LEGS = {
  thigh_l: about(X, deg(-80)), calf_l: about(X, deg(85)), foot_l: about(X, deg(-5)),
  thigh_r: about(X, deg(-8)), calf_r: about(X, deg(95)), foot_r: about(X, deg(40)),
};
const KNEEL_DROP = 0.47;

/** Fallback kneeling shot: right knee on the ground, left foot planted ahead, gun aimed; recoil like aim_shoot. */
export const kneelShoot: Template = {
  id: 'kneel_shoot', label: 'Kneel and shoot (procedural)', kind: 'character', requires: [], loop: false, gunPose: true,
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.3, max: 1.5, step: 0.05, default: 0.6 },
    { key: 'twoHanded', label: 'Two hands (0/1)', min: 0, max: 1, step: 1, default: 0 },
    { key: 'kick', label: 'Recoil (°)', min: 0, max: 30, step: 1, default: 10 },
  ],
  events: () => [{ at: 0.12, name: 'shoot' }],
  build: (root, a, p) => {
    const H = hipHeight(root, a);
    const tracks = motion(root, a, p.duration, {
      ...gunArms(p.twoHanded >= 0.5, 0, { kick: shotKick, K: p.kick }),
      ...Object.fromEntries(Object.entries(KNEEL_LEGS).map(([b, q]) => [b, fixed(q)])),
      spine3: (u) => about(X, deg(4 - p.kick * 0.2 * shotKick(u))),
    });
    // The whole body comes down to thigh height (the right knee rests on the ground).
    const body = rootTracks(root, p.duration, () => ({ pos: new THREE.Vector3(0, -H * KNEEL_DROP, 0) }), 2);
    return new THREE.AnimationClip('kneel_shoot', p.duration, [...tracks, ...body]);
  },
};


/**
 * Arm rotations (asset frame, T-posed rig) that put the wrists at `handR` / `handL` with two-bone IK from the rig's
 * own rest proportions; `aim` is the direction the gun hand points the weapon (the automatic grip holds a weapon
 * along the character's forward at rest).
 */
function armsTo(root: THREE.Object3D, a: TemplateAsset, handR: (s: { sR: THREE.Vector3; sL: THREE.Vector3 }) => THREE.Vector3, handL: (s: { sR: THREE.Vector3; sL: THREE.Vector3 }, r: THREE.Vector3) => THREE.Vector3, aim: THREE.Vector3) {
  const j = armJoints(root, a);
  if (!j) return null;
  const sides = { sR: j.r.s, sL: j.l.s };
  const rots: Record<string, THREE.Quaternion> = {};
  const targetR = handR(sides);
  const F = solveArm(rots, 'r', j.r, targetR, new THREE.Vector3(-1, -1.2, -0.2));
  rots.hand_r = F.clone().invert().multiply(new THREE.Quaternion().setFromUnitVectors(Z, aim.clone().normalize()));
  const foreL = solveArm(rots, 'l', j.l, handL(sides, targetR), new THREE.Vector3(0.6, -1, -0.2));
  return { rots, foreL };
}

/** The rig's arm joints at rest (asset frame): shoulder, elbow and wrist per side; null when the rig lacks them. */
function armJoints(root: THREE.Object3D, a: TemplateAsset) {
  const bone = (k: string) => (a.rigMap?.[k] ? nodeByName(root, a.rigMap[k]) : null);
  const [ur, lr, hr, ul, ll] = ['upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l'].map(bone);
  if (!ur || !lr || !hr || !ul || !ll) return null;
  const at = (n: THREE.Object3D) => assetPivot(n, root);
  const hl = bone('hand_l');
  const [sR, eR, wR, sL, eL] = [ur, lr, hr, ul, ll].map(at);
  const wL = hl ? at(hl) : eL.clone().add(eL.clone().sub(sL));
  return { r: { s: sR, e: eR, w: wR }, l: { s: sL, e: eL, w: wL } };
}

/**
 * Two-bone IK for one arm into `rots` (asset-frame turns, child applied before parent): the upper-arm and forearm
 * turns that put the wrist at `target`, the elbow bending towards `pole`. Returns the forearm's overall turn F (a
 * hand's own turn is then F⁻¹·wanted).
 */
function solveArm(rots: Record<string, THREE.Quaternion>, side: 'r' | 'l', j: { s: THREE.Vector3; e: THREE.Vector3; w: THREE.Vector3 }, target: THREE.Vector3, pole: THREE.Vector3) {
  const ik = twoBone(j.s, target, j.s.distanceTo(j.e), j.e.distanceTo(j.w), pole);
  const U = new THREE.Quaternion().setFromUnitVectors(j.e.clone().sub(j.s).normalize(), ik.upper);
  const F = new THREE.Quaternion().setFromUnitVectors(j.w.clone().sub(j.e).normalize(), ik.fore);
  rots[`upperarm_${side}`] = U;
  rots[`lowerarm_${side}`] = U.clone().invert().multiply(F);
  return F;
}

/**
 * The overall hand turn that points the fingers along `fingers` with the palm facing `palm` (asset frame). Synty
 * rigs rest in a T-pose with the palms down: fingers along -X (right) / +X (left), palm -Y.
 */
function handFacing(side: 'r' | 'l', fingers: THREE.Vector3, palm: THREE.Vector3) {
  const basis = (f: THREE.Vector3, n: THREE.Vector3) => {
    const x = f.clone().normalize();
    const y = n.clone().sub(x.clone().multiplyScalar(n.dot(x))).normalize();
    return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
  };
  const rest = basis(new THREE.Vector3(side === 'r' ? -1 : 1, 0, 0), new THREE.Vector3(0, -1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(basis(fingers, palm).multiply(rest.invert()));
}

/**
 * Finger bones below a hand (not in the canonical rig map: Synty's Finger_01 / IndexFinger_01, Mixamo's
 * LeftHandIndex1), each joint curled `angle` degrees towards the palm (palms rest facing down). Thumbs stay open.
 */
function fingerCurl(root: THREE.Object3D, a: TemplateAsset, side: 'r' | 'l', angle: number) {
  const hand = a.rigMap?.[`hand_${side}`] ? nodeByName(root, a.rigMap[`hand_${side}`]) : null;
  const out: { bone: THREE.Object3D; q: THREE.Quaternion }[] = [];
  if (!hand) return out;
  const down = new THREE.Vector3(0, -1, 0);
  const visit = (o: THREE.Object3D, thumb: boolean) => {
    for (const c of o.children) {
      if (!(c as THREE.Bone).isBone || /socket|prop|attach|weapon|ik|twist/i.test(c.name)) continue;
      const isThumb = thumb || /thumb/i.test(c.name);
      const next = c.children.find((x) => (x as THREE.Bone).isBone);
      const from = assetPivot(c, root);
      const dir = (next ? assetPivot(next, root).sub(from) : from.clone().sub(assetPivot(o, root))).normalize();
      const axis = new THREE.Vector3().crossVectors(dir, down);
      // The knuckles (the first joint below the hand) bend a little less than the finger joints.
      if (!isThumb && axis.lengthSq() > 1e-6) out.push({ bone: c, q: about(axis.normalize(), deg(o === hand ? angle * 0.6 : angle)) });
      visit(c, isThumb);
    }
  };
  visit(hand, false);
  return out;
}

/** Fixed tracks closing one hand's fingers around a grip (see fingerCurl). */
function gripTracks(root: THREE.Object3D, a: TemplateAsset, side: 'r' | 'l', length: number, angle = 45) {
  return fingerCurl(root, a, side, angle).flatMap(({ bone, q }) => transformTracks(bone, root, length, () => q, { keys: 1 }));
}

/**
 * Shoulder-fired launcher (RPG, LAW, bazooka; FB-072): the tube rests on the right shoulder pointing ahead, the gun
 * hand on the grip under it, the free hand on the tube in front, the head tilted down along the sights. `kneel` puts
 * the right knee on the ground (as kneel_shoot). The clip starts aimed; the shot (`shoot`, at 15 %) rocks the body
 * back and it settles. The weapon's parts with the `projectile` role (the rocket in the tube) are hidden from the
 * `shoot` frame on, so the game spawns its own rocket there (the `weapon_tip` socket).
 */
export const shoulderFire: Template = {
  id: 'shoulder_fire', label: 'Shoulder fire (launcher, procedural)', kind: 'character', requires: [], loop: false, gunPose: true, gunGrip: 'two_hand',
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.4, max: 2, step: 0.05, default: 0.8 },
    { key: 'kneel', label: 'Kneel (0/1)', min: 0, max: 1, step: 1, default: 0 },
    { key: 'kick', label: 'Recoil (°)', min: 0, max: 20, step: 1, default: 6 },
    { key: 'raise', label: 'Tube up (°)', min: -10, max: 30, step: 1, default: 3 },
  ],
  events: () => [{ at: 0.15, name: 'shoot' }],
  build: (root, a, p) => {
    const kneel = p.kneel >= 0.5;
    const kick = (u: number) => (u < 0.15 ? 0 : u < 0.19 ? (u - 0.15) / 0.04 : Math.exp(-(u - 0.19) * 7));
    const aimAt = (k: number) => new THREE.Vector3(0, 0, 1).applyAxisAngle(X, -deg(p.raise + p.kick * 0.5 * k)).normalize();
    // The gun hand on the grip just ahead of and below the right shoulder (the tube lies on the shoulder); the free
    // hand reaches across to the tube's front. The recoil pushes both hands back a little.
    const pose = (k: number) => {
      const aim = aimAt(k);
      return armsTo(root, a,
        ({ sR }) => new THREE.Vector3(sR.x * 0.95, sR.y + 0.01, sR.z + 0.17 - 0.04 * k),
        ({ sR }, r) => r.clone().add(aim.clone().multiplyScalar(0.3)).add(new THREE.Vector3(-sR.x * 0.15, -0.01, 0)),
        aim);
    };
    const rest = pose(0), kicked = pose(1);
    const rots: Record<string, (u: number) => THREE.Quaternion> = {};
    if (rest && kicked) {
      for (const k of Object.keys(rest.rots)) rots[k] = (u) => rest.rots[k].clone().slerp(kicked.rots[k], kick(u));
      // FB-105: the front hand holds the tube from below (palm up, fingers curled round it) instead of reaching out
      // flat; the renderer then puts it on the launcher's own front grip (attach.ts holdFrontGrip).
      const palmUp = handFacing('l', new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
      rots.hand_l = (u) => rest.foreL.clone().slerp(kicked.foreL, kick(u)).invert().multiply(palmUp);
    }
    // Head down and turned to the right shoulder, cheek along the tube.
    rots.head = (u) => about(Y, deg(-14)).multiply(about(Z, deg(12))).multiply(about(X, deg(10 - 4 * kick(u))));
    rots.spine3 = (u) => about(X, deg(3 - p.kick * 0.3 * kick(u)));
    if (kneel) for (const [b, q] of Object.entries(KNEEL_LEGS)) rots[b] = fixed(q);
    else Object.assign(rots, { thigh_l: fixed(about(X, deg(-14))), calf_l: fixed(about(X, deg(12))), thigh_r: fixed(about(X, deg(6))) });
    const H = hipHeight(root, a);
    const tracks = [...motion(root, a, p.duration, rots), ...gripTracks(root, a, 'l', p.duration), ...gripTracks(root, a, 'r', p.duration)];
    // Kneeling: the body comes down to thigh height. The shot rocks it back a few centimetres.
    const body = rootTracks(root, p.duration, (t) => ({ pos: new THREE.Vector3(0, kneel ? -H * KNEEL_DROP : -0.01, -0.04 * kick(t / p.duration)) }));
    return new THREE.AnimationClip('shoulder_fire', p.duration, [...tracks, ...body]);
  },
};

/**
 * Lying face down, gun ahead along the ground. The body is tipped forward about the feet and moved back so the
 * hips sit over the sprite's pivot. `crawl` makes it an army crawl cycle: elbows reach in turn while the opposite
 * knee comes up the side; `shoot` adds a recoil kick; `idle` breathes.
 */
function proneClip(root: THREE.Object3D, a: TemplateAsset, p: Record<string, number>, name: string, mode: 'idle' | 'crawl' | 'shoot') {
  const H = hipHeight(root, a);
  const two = p.twoHanded >= 0.5;
  const tau = 2 * Math.PI;
  const crawling = mode === 'crawl' ? 1 : 0;
  const side = (u: number) => Math.sin(tau * u); // + right elbow / left knee, - the other pair
  const wR = (u: number) => crawling * Math.max(0, side(u));
  const wL = (u: number) => crawling * Math.max(0, -side(u));
  const breathe = (u: number) => (mode === 'idle' ? 0.5 - 0.5 * Math.cos(tau * u) : 0);
  const tracks = motion(root, a, p.duration, {
    ...gunArms(two, -88, { kick: mode === 'shoot' ? shotKick : undefined, K: p.kick ?? 8, reachR: wR, reachL: wL }),
    head: (u) => about(X, deg(-62 - 3 * breathe(u))),
    spine3: (u) => about(X, deg(-10 - 2 * breathe(u))).multiply(about(Z, deg(5 * crawling * side(u)))),
    spine1: (u) => about(Z, deg(-4 * crawling * side(u))),
    // Knees come up the side in turn (crawl); at rest the legs lie a little apart, toes on the ground.
    thigh_l: (u) => about(Z, deg(10 + 60 * wL(u))),
    calf_l: (u) => about(Z, deg(-75 * wL(u))),
    thigh_r: (u) => about(Z, deg(-10 - 60 * wR(u))),
    calf_r: (u) => about(Z, deg(75 * wR(u))),
    foot_l: fixed(about(X, deg(55))),
    foot_r: fixed(about(X, deg(55))),
  }, 32);
  const tip = about(X, deg(90));
  const body = rootTracks(root, p.duration, (t) => {
    const u = t / p.duration;
    // Each crawl stroke pushes the body forward and back a little (in place); breathing lifts the back.
    const surge = 0.05 * crawling * Math.sin(2 * tau * u);
    return { rot: tip, pos: new THREE.Vector3(0, 0.12 + 0.01 * breathe(u), -H + surge) };
  }, 32);
  return new THREE.AnimationClip(name, p.duration, [...tracks, ...body]);
}

const proneParams = (duration: number) => [
  { key: 'duration', label: 'Length (s)', min: 0.3, max: 3, step: 0.05, default: duration },
  { key: 'twoHanded', label: 'Two hands (0/1)', min: 0, max: 1, step: 1, default: 0 },
];

/** Fallback prone idle (no pack has one): lying face down, gun ahead, breathing. */
export const proneIdle: Template = {
  id: 'prone_idle', label: 'Prone (procedural)', kind: 'character', requires: [], loop: true, gunPose: true, params: proneParams(2),
  build: (root, a, p) => proneClip(root, a, p, 'prone_idle', 'idle'),
};

/** Fallback army crawl: elbows and knees in turn, in place (move the sprite at about 0.6 m/s). */
export const crawl: Template = {
  id: 'crawl', label: 'Crawl (procedural)', kind: 'character', requires: [], loop: true, gunPose: true, params: proneParams(1.2),
  events: () => [{ at: 0.25, name: 'footstep_r' }, { at: 0.75, name: 'footstep_l' }],
  // One stroke cycle covers about 0.72 m (0.6 m/s at the default 1.2 s): a shorter cycle crawls faster.
  speedMps: (p) => 0.72 / Math.max(0.3, p.duration),
  build: (root, a, p) => proneClip(root, a, p, 'crawl', 'crawl'),
};

/** Fallback prone shot: the prone pose with a recoil kick. */
export const proneShoot: Template = {
  id: 'prone_shoot', label: 'Prone shoot (procedural)', kind: 'character', requires: [], loop: false, gunPose: true,
  params: [...proneParams(0.6), { key: 'kick', label: 'Recoil (°)', min: 0, max: 30, step: 1, default: 8 }],
  events: () => [{ at: 0.12, name: 'shoot' }],
  build: (root, a, p) => proneClip(root, a, p, 'prone_shoot', 'shoot'),
};

/** A bone rotation keyed at moments u (0..1), eased in and out between keys (slerp). */
function keyed(keys: [number, THREE.Quaternion][]) {
  return (u: number) => {
    if (u <= keys[0][0]) return keys[0][1].clone();
    for (let i = 1; i < keys.length; i++) {
      const [u1, q1] = keys[i];
      if (u > u1) continue;
      const [u0, q0] = keys[i - 1];
      return q0.clone().slerp(q1, ease.inOutQuad((u - u0) / Math.max(1e-6, u1 - u0)));
    }
    return keys[keys.length - 1][1].clone();
  };
}

/**
 * Throw (a grenade): wind up, swing, let go at `release`, follow through and recover. Overhand (default) brings
 * the hand up behind the head; underhand swings it low and lobs forward with bent knees. `hand` picks the
 * throwing arm (0 = right, 1 = left: a soldier keeps the rifle in the right hand and throws with the left).
 * The thrown object's start point is the hand: hand_r / hand_l are tracked per frame in the export's sockets.
 */
export const throwMove: Template = {
  id: 'throw', label: 'Throw (grenade, procedural)', kind: 'character', requires: [], loop: false,
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.5, max: 2.5, step: 0.05, default: 1.1 },
    { key: 'underhand', label: 'Underhand (0/1)', min: 0, max: 1, step: 1, default: 0 },
    { key: 'hand', label: 'Throwing hand (0 right, 1 left)', min: 0, max: 1, step: 1, default: 0 },
  ],
  events: () => [{ at: 0.45, name: 'release' }],
  build: (root, a, p) => {
    const under = p.underhand >= 0.5;
    // Built for the right arm; the left arm mirrors it across the body (turns about Y and Z change sign).
    const s = p.hand >= 0.5 ? -1 : 1;
    const t = s > 0 ? 'r' : 'l', o = s > 0 ? 'l' : 'r';
    const arm = (yDeg: number, zDeg: number, xDeg = 0) => about(X, deg(xDeg)).multiply(about(Y, deg(s * yDeg))).multiply(about(Z, deg(s * zDeg)));
    const fore = (yDeg: number, zDeg = 0) => about(Y, deg(s * yDeg)).multiply(about(Z, deg(s * zDeg)));
    const down = arm(0, 74, 8), foreDown = fore(12);
    // Key moments: 0 rest, 0.35 wound up, 0.45 release, 0.6 follow-through, 1 back at rest.
    const K = [0, 0.35, 0.45, 0.6, 1];
    const throwing = under
      ? [down, arm(-50, 80), arm(80, 35), arm(85, -15), down]
      : [down, arm(-40, -40), arm(70, -25), arm(80, 35), down];
    const throwFore = under ? [foreDown, fore(10), fore(5), fore(15), foreDown] : [foreDown, fore(10, -75), fore(15, -10), fore(10), foreDown];
    // The other arm reaches forward for balance while winding up, then swings back down.
    const offArm = (yDeg: number, zDeg: number, xDeg: number) => about(X, deg(xDeg)).multiply(about(Y, deg(-s * yDeg))).multiply(about(Z, deg(-s * zDeg)));
    const otherDown = offArm(0, 74, 8);
    const other = [otherDown, offArm(60, 20, 10), offArm(20, 50, 8), offArm(-10, 70, 8), otherDown];
    // Torso: turned away (throwing shoulder back) and leaning back, then forward through the release.
    const twist = [0, -28, 18, 22, 0], lean = under ? [0, 10, 6, 14, 0] : [0, -10, 14, 18, 0];
    const bend = under ? [0, 1, 0.6, 0.3, 0] : [0, 0.3, 0.5, 0.4, 0];
    const at = (vals: THREE.Quaternion[]) => keyed(K.map((k, i) => [k, vals[i]]));
    const num = (vals: number[]) => (u: number) => {
      if (u >= 1) return vals[vals.length - 1];
      const i = K.findIndex((k) => k >= u);
      if (i <= 0) return vals[0];
      return vals[i - 1] + (vals[i] - vals[i - 1]) * ease.inOutQuad((u - K[i - 1]) / (K[i] - K[i - 1]));
    };
    const tw = num(twist), le = num(lean), kn = num(bend);
    const tracks = motion(root, a, p.duration, {
      [`upperarm_${t}`]: at(throwing),
      [`lowerarm_${t}`]: at(throwFore),
      [`upperarm_${o}`]: at(other),
      [`lowerarm_${o}`]: fixed(fore(-12)),
      spine1: (u) => about(Y, deg(s * tw(u) * 0.4)).multiply(about(X, deg(le(u) * 0.4))),
      spine2: (u) => about(Y, deg(s * tw(u) * 0.3)).multiply(about(X, deg(le(u) * 0.3))),
      spine3: (u) => about(Y, deg(s * tw(u) * 0.3)).multiply(about(X, deg(le(u) * 0.3))),
      head: (u) => about(Y, deg(-s * tw(u) * 0.6)), // eyes stay on the target
      // The front foot (opposite the throwing arm) steps in; the knees give a little (more underhand).
      [`thigh_${o}`]: (u) => about(X, deg(-25 * kn(u) - 12 * Math.max(0, tw(u)) / 22)),
      [`calf_${o}`]: (u) => about(X, deg(30 * kn(u))),
      [`thigh_${t}`]: (u) => about(X, deg(10 * kn(u))),
      [`calf_${t}`]: (u) => about(X, deg(35 * kn(u))),
    }, 40);
    const H = hipHeight(root, a);
    const body = rootTracks(root, p.duration, (time) => {
      const u = time / p.duration;
      // Weight back while winding up, forward through the release, home again (in place).
      const shift = num([0, -0.05, 0.05, 0.07, 0])(u);
      return { pos: new THREE.Vector3(0, -H * 0.08 * kn(u), shift) };
    }, 40);
    return new THREE.AnimationClip('throw', p.duration, [...tracks, ...body]);
  },
};

/**
 * Kneel and place something on the ground (a time bomb, a mine; FB-073): down on the right knee, lean in and reach
 * the free hand (left by default; `hand=1` the right) to the ground in front, `release` the moment it touches, then
 * stand up again. The other hand stays down at the side (a rifle stays in it). In place, one-shot.
 */
export const kneelPlace: Template = {
  id: 'kneel_place', label: 'Kneel and place (procedural)', kind: 'character', requires: [], loop: false,
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.6, max: 3, step: 0.05, default: 1.4 },
    { key: 'hand', label: 'Placing hand (0 left, 1 right)', min: 0, max: 1, step: 1, default: 0 },
  ],
  events: () => [{ at: 0.45, name: 'release' }],
  build: (root, a, p) => {
    // Phases: 0-0.3 down on one knee, leaning in; 0.3-0.45 the hand reaches the ground; held a moment; 0.6-1 up again.
    const down = (u: number) => (u < 0.3 ? ease.inOutQuad(u / 0.3) : u < 0.62 ? 1 : 1 - ease.inOutQuad((u - 0.62) / 0.38));
    const reach = (u: number) => (u < 0.2 ? 0 : u < 0.45 ? ease.inOutQuad((u - 0.2) / 0.25) : u < 0.55 ? 1 : u < 0.75 ? 1 - ease.inOutQuad((u - 0.55) / 0.2) : 0);
    // Built for the left hand; the right mirrors it across the body (turns about Y and Z change sign).
    const s = p.hand >= 0.5 ? -1 : 1;
    const t = s > 0 ? 'l' : 'r', o = s > 0 ? 'r' : 'l';
    const restArm = armsDown();
    const placing = s > 0 ? restArm.upperarm_l : restArm.upperarm_r;
    const reached = about(X, deg(48)).multiply(about(Y, deg(-s * 82)));
    const id = new THREE.Quaternion();
    const legs = (b: keyof typeof KNEEL_LEGS) => (u: number) => id.clone().slerp(KNEEL_LEGS[b], down(u));
    const tracks = motion(root, a, p.duration, {
      [`upperarm_${t}`]: (u) => placing.clone().slerp(reached, reach(u)),
      [`lowerarm_${t}`]: (u) => about(Y, deg(-s * (12 - 4 * reach(u)))),
      [`upperarm_${o}`]: fixed(s > 0 ? restArm.upperarm_r : restArm.upperarm_l),
      [`lowerarm_${o}`]: fixed(s > 0 ? restArm.lowerarm_r : restArm.lowerarm_l),
      spine1: (u) => about(X, deg(12 * down(u) + 10 * reach(u))),
      spine2: (u) => about(X, deg(8 * down(u) + 10 * reach(u))).multiply(about(Y, deg(s * 8 * reach(u)))),
      spine3: (u) => about(X, deg(6 * down(u) + 6 * reach(u))),
      head: (u) => about(X, deg(10 * down(u) + 8 * reach(u))),
      thigh_l: legs('thigh_l'), calf_l: legs('calf_l'), foot_l: legs('foot_l'),
      thigh_r: legs('thigh_r'), calf_r: legs('calf_r'), foot_r: legs('foot_r'),
    }, 40);
    const H = hipHeight(root, a);
    const body = rootTracks(root, p.duration, (time) => ({ pos: new THREE.Vector3(0, -H * KNEEL_DROP * down(time / p.duration), 0) }), 40);
    return new THREE.AnimationClip('kneel_place', p.duration, [...tracks, ...body]);
  },
};

/**
 * Procedural walk in place (the stand-in when no walk clip is installed, and the legs under an arm pose such as
 * hands_up_walk): thighs swing ±`stride`, the swinging knee bends, the hips dip at each footfall and the arms swing
 * opposite the legs. Feet land at 25 % (left) and 75 % (right).
 */
function walkTracks(root: THREE.Object3D, a: TemplateAsset, p: Record<string, number>) {
  const tau = 2 * Math.PI;
  const S = p.stride, A = p.armSwing ?? 12;
  const down = armsDown();
  // The left thigh is forward while sin > 0; a knee bends while its leg swings forward (its thigh angle falling).
  const knee = (phase: number) => 45 * Math.max(0, Math.cos(phase)) ** 1.5;
  const tracks = motion(root, a, p.duration, {
    thigh_l: (u) => about(X, deg(-S * Math.sin(tau * u))),
    thigh_r: (u) => about(X, deg(S * Math.sin(tau * u))),
    calf_l: (u) => about(X, deg(6 + knee(tau * u))),
    calf_r: (u) => about(X, deg(6 + knee(tau * u + Math.PI))),
    foot_l: (u) => about(X, deg(-6 * Math.sin(tau * u))),
    foot_r: (u) => about(X, deg(6 * Math.sin(tau * u))),
    upperarm_l: (u) => about(X, deg(A * Math.sin(tau * u))).multiply(down.upperarm_l),
    upperarm_r: (u) => about(X, deg(-A * Math.sin(tau * u))).multiply(down.upperarm_r),
    lowerarm_l: fixed(down.lowerarm_l),
    lowerarm_r: fixed(down.lowerarm_r),
    spine1: (u) => about(Y, deg(3 * Math.sin(tau * u))),
  }, 32);
  // The hips are lowest at the footfalls (both feet on the ground, legs apart).
  const body = rootTracks(root, p.duration, (t) => ({ pos: new THREE.Vector3(0, -0.025 * Math.sin(tau * (t / p.duration)) ** 2, 0) }), 32);
  return [...tracks, ...body];
}

/** Ground speed of walkTracks: each half cycle the body passes over a step of 2·leg·sin(stride) (leg ≈ 0.85 m). */
const walkSpeed = (p: Record<string, number>) => (4 * 0.85 * Math.sin(deg(p.stride))) / Math.max(0.3, p.duration);
const walkParams = [
  { key: 'duration', label: 'Length (s)', min: 0.4, max: 3, step: 0.05, default: 1 },
  { key: 'stride', label: 'Leg swing (± °)', min: 5, max: 45, step: 1, default: 20 },
];
const footsteps = () => [{ at: 0.25, name: 'footstep_l' }, { at: 0.75, name: 'footstep_r' }];

export const walkCycle: Template = {
  id: 'walk_cycle', label: 'Walk in place (procedural stand-in)', kind: 'character', requires: [], loop: true,
  params: [...walkParams, { key: 'armSwing', label: 'Arm swing (± °)', min: 0, max: 40, step: 1, default: 12 }],
  events: footsteps,
  speedMps: walkSpeed,
  build: (root, a, p) => new THREE.AnimationClip('walk_cycle', p.duration, walkTracks(root, a, p)),
};

/**
 * Hands up (surrender, FB-076): upper arms out to the sides, forearms up, palms forward; `onHead` puts the hands on
 * the head instead (a prisoner). Only the arms move (and breathe a little), so it also lies over a walk or run
 * clip: `hands_up_walk` (or `<pose>_walk` / `_run` / `_idle` of any arm pose, see templateCatalog armPoseMove).
 */
function handsUpArms(root: THREE.Object3D, a: TemplateAsset, p: Record<string, number>) {
  const j = armJoints(root, a);
  if (!j) return {};
  const head = a.rigMap?.head ? nodeByName(root, a.rigMap.head) : null;
  const top = head ? assetPivot(head, root) : j.r.s.clone().lerp(j.l.s, 0.5).add(new THREE.Vector3(0, 0.15, 0));
  const onHead = p.onHead >= 0.5;
  const pose = (lift: number) => {
    const rots: Record<string, THREE.Quaternion> = {};
    for (const side of ['r', 'l'] as const) {
      const arm = j[side];
      const out = side === 'r' ? -1 : 1; // the asset's +X is its left
      const a0 = arm.s.distanceTo(arm.e), b0 = arm.e.distanceTo(arm.w);
      const target = onHead
        ? top.clone().add(new THREE.Vector3(out * 0.07, 0.13 + lift * 0.3 * b0, -0.03))
        : arm.s.clone().add(new THREE.Vector3(out * a0 * 0.92, b0 * (0.92 + lift), a0 * 0.18));
      const F = solveArm(rots, side, arm, target, onHead ? new THREE.Vector3(out, 0.3, 0.4) : new THREE.Vector3(out, -1, 0.1));
      const want = onHead
        ? handFacing(side, new THREE.Vector3(-out, 0.2, -0.3), new THREE.Vector3(0, -1, 0)) // palms down on the head, fingers in
        : handFacing(side, new THREE.Vector3(out * 0.15, 1, 0), new THREE.Vector3(0, 0, 1)); // fingers up, palms forward
      rots[`hand_${side}`] = F.clone().invert().multiply(want);
    }
    return rots;
  };
  // Breathing: the hands rise a few millimetres and settle once per loop.
  const low = pose(0), high = pose(0.04);
  return Object.fromEntries(Object.keys(low).map((k) => [k, (u: number) => low[k].clone().slerp(high[k], 0.5 - 0.5 * Math.cos(2 * Math.PI * u))]));
}

const onHeadParam = { key: 'onHead', label: 'Hands on the head (0/1)', min: 0, max: 1, step: 1, default: 0 };

export const handsUp: Template = {
  id: 'hands_up', label: 'Hands up (surrender, procedural)', kind: 'character', requires: [], loop: true, armPose: true,
  params: [{ key: 'duration', label: 'Length (s)', min: 0.5, max: 4, step: 0.05, default: 2 }, onHeadParam],
  build: (root, a, p) => new THREE.AnimationClip('hands_up', p.duration, motion(root, a, p.duration, handsUpArms(root, a, p))),
};

/**
 * Walking with the hands up (FB-076). As a set item it is the installed walk clip with hands_up laid over its arms
 * (templateCatalog armPoseMove); this build is the stand-in when no walk clip is installed: walk_cycle's legs.
 */
export const handsUpWalk: Template = {
  id: 'hands_up_walk', label: 'Walk with hands up (procedural)', kind: 'character', requires: [], loop: true,
  params: [...walkParams, onHeadParam],
  events: footsteps,
  speedMps: walkSpeed,
  build: (root, a, p) => {
    const arms = new Set(['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'].flatMap((k) => {
      const b = a.rigMap?.[k] ? nodeByName(root, a.rigMap[k]) : null;
      return b ? [`${b.uuid}.quaternion`, `${b.uuid}.position`] : [];
    }));
    const legs = walkTracks(root, a, { ...p, armSwing: 0 }).filter((t) => !arms.has(t.name));
    return new THREE.AnimationClip('hands_up_walk', p.duration, [...legs, ...motion(root, a, p.duration, handsUpArms(root, a, p))]);
  },
};

/**
 * Raise a held item to the eyes (binoculars, a camera; FB-088): both hands bring it up in front of the face over the
 * first 30 %, `look` fires once it is there (35 %), it is held, and with `lower` it comes down again over the last
 * 25 % (lower=0 ends at the eyes, to chain into a held look). The item stays in its saved grip in the right hand; the
 * left hand steadies it. `kneel` puts the right knee on the ground (as kneel_shoot).
 */
export const raiseToEyes: Template = {
  id: 'raise_to_eyes', label: 'Raise to the eyes (binoculars, camera; procedural)', kind: 'character', requires: [], loop: false,
  params: [
    { key: 'duration', label: 'Length (s)', min: 0.6, max: 4, step: 0.05, default: 1.6 },
    { key: 'kneel', label: 'Kneel (0/1)', min: 0, max: 1, step: 1, default: 0 },
    { key: 'lower', label: 'Lower again at the end (0/1)', min: 0, max: 1, step: 1, default: 1 },
  ],
  events: () => [{ at: 0.35, name: 'look' }],
  build: (root, a, p) => {
    const kneel = p.kneel >= 0.5, lower = p.lower >= 0.5;
    const up = (u: number) => ease.inOutQuad(Math.min(1, u / 0.3)) * (lower && u > 0.75 ? 1 - ease.inOutQuad((u - 0.75) / 0.25) : 1);
    const head = a.rigMap?.head ? nodeByName(root, a.rigMap.head) : null;
    const j = armJoints(root, a);
    const eyes = head ? assetPivot(head, root).add(new THREE.Vector3(0, 0.08, 0.1)) : j ? j.r.s.clone().lerp(j.l.s, 0.5).add(new THREE.Vector3(0, 0.2, 0.1)) : new THREE.Vector3();
    // The hands meet a little below and in front of the eyes, either side of the item.
    const raised = armsTo(root, a,
      () => eyes.clone().add(new THREE.Vector3(-0.06, -0.07, 0.1)),
      () => eyes.clone().add(new THREE.Vector3(0.06, -0.07, 0.1)),
      Z);
    const down = armsDown(8);
    const rest: Record<string, THREE.Quaternion> = { ...down, hand_r: new THREE.Quaternion(), hand_l: new THREE.Quaternion() };
    const rots: Record<string, (u: number) => THREE.Quaternion> = {};
    if (raised) {
      const steady = raised.foreL.clone().invert().multiply(handFacing('l', new THREE.Vector3(0, 0.3, 1), new THREE.Vector3(-1, 0, 0)));
      const target: Record<string, THREE.Quaternion> = { ...raised.rots, hand_l: steady };
      for (const k of Object.keys(target)) rots[k] = (u) => (rest[k] ?? new THREE.Quaternion()).clone().slerp(target[k], up(u));
    }
    // Looking through it: the head tips forward a touch, the shoulders lean in.
    rots.head = (u) => about(X, deg(4 * up(u)));
    rots.spine3 = (u) => about(X, deg(4 * up(u)));
    if (kneel) for (const [b, q] of Object.entries(KNEEL_LEGS)) rots[b] = fixed(q);
    const H = hipHeight(root, a);
    const tracks = [...motion(root, a, p.duration, rots, 40), ...gripTracks(root, a, 'l', p.duration, 30), ...gripTracks(root, a, 'r', p.duration)];
    const body = rootTracks(root, p.duration, () => ({ pos: new THREE.Vector3(0, kneel ? -H * KNEEL_DROP : 0, 0) }), 2);
    return new THREE.AnimationClip('raise_to_eyes', p.duration, [...tracks, ...body]);
  },
};

export const CHARACTER_TEMPLATES = [sit, drivePose, hitReact, deathFall, aimShoot, reloadGesture, rifleCarry, kneelShoot, shoulderFire, proneIdle, crawl, proneShoot, throwMove, kneelPlace, walkCycle, handsUp, handsUpWalk, raiseToEyes];
