import * as THREE from 'three';
import { COLLAPSE_DEFAULTS, COLLAPSE_DUST, blastPlan, collapseMotion, dustPuff, transitionOpacity } from '../../shared/debris';
import { X, Y, Z, about, assetBox, colorRamp, deg, ease, instanceTracks, longAxis, opacityTracks, pulse, rng, rootTracks } from './helpers';
import { duration, type Template } from './types';

const TAU = Math.PI * 2;
const obj = (id: string, label: string, loop: boolean, params: Template['params'], build: Template['build'], events?: Template['events']): Template => ({
  id, label, kind: 'object', requires: [], loop, params, build, events,
});

/** Rotation that turns the model's long axis (or the chosen axis) to point forward (+Z, the direction of travel). */
function alignForward(root: THREE.Object3D, axis: number, flip: number) {
  const a = axis === 1 ? X : axis === 2 ? Y : axis === 3 ? Z : longAxis(root, root);
  // Point the end farther from the origin forwards (arrow heads and orb fronts are modelled away from the pivot).
  const b = assetBox(root, root);
  const c = b.getCenter(new THREE.Vector3());
  const dir = a.clone().multiplyScalar(c.dot(a) < 0 ? -1 : 1).multiplyScalar(flip ? -1 : 1);
  return new THREE.Quaternion().setFromUnitVectors(dir.normalize(), Z.clone());
}
/** Model axes by index (0 X, 1 Y, 2 Z). */
const AXES = [X, Y, Z];
/** A model counts as flat (a star, a disc, a ring) when its thinnest side is under half its middle one. */
export function flatAxis(root: THREE.Object3D): THREE.Vector3 | null {
  const s = assetBox(root, root).getSize(new THREE.Vector3()).toArray();
  const order = [0, 1, 2].sort((a, b) => s[a] - s[b]);
  return s[order[0]] < 0.5 * s[order[1]] ? AXES[order[0]] : null;
}

/**
 * A projectile's orientation (SF-FB-019). Flat models facing a camera (face 0 auto or 1 side: the side views'
 * camera looks along the model's X; 2 up: top-down views) turn their flat side that way and their chosen (else
 * longest) in-plane axis forward; `normal` is the axis they then spin about. Otherwise (face 3, or not flat) the
 * long or chosen axis points along the flight (alignForward) and the spin turns about it.
 */
export function projectileAlign(root: THREE.Object3D, axis: number, flip: number, face: number): { align: THREE.Quaternion; normal: THREE.Vector3 | null } {
  const thin = face === 3 ? null : flatAxis(root);
  if (!thin) return { align: alignForward(root, axis, flip), normal: null };
  const s = assetBox(root, root).getSize(new THREE.Vector3());
  const others = AXES.filter((a) => a !== thin).sort((a, b) => s.dot(b) - s.dot(a));
  const chosen = axis >= 1 && axis <= 3 ? AXES[axis - 1] : null;
  const f = (chosen && chosen !== thin ? chosen : others[0]).clone().multiplyScalar(flip ? -1 : 1);
  const target = face === 2 ? Y : X;
  // Rotation taking (f, thin, f × thin) to (Z, target, Z × target).
  const from = new THREE.Matrix4().makeBasis(f, thin, new THREE.Vector3().crossVectors(f, thin));
  const to = new THREE.Matrix4().makeBasis(Z, target, new THREE.Vector3().crossVectors(Z, target));
  const m = to.multiply(from.transpose());
  return { align: new THREE.Quaternion().setFromRotationMatrix(m), normal: target.clone() };
}

/** Root position that keeps the model-space point `c` on the origin under rotation `q` and scale `k`. */
export function centreOffset(c: THREE.Vector3, q: THREE.Quaternion, k: THREE.Vector3) {
  return c.clone().multiply(k).applyQuaternion(q).negate();
}

/** Emissive colour ramp on FX materials only (palette meshes keep their texture colours). */
function emissiveRamp(root: THREE.Object3D, d: number, ramp: (u: number) => THREE.Color, keys = 24) {
  const times = Array.from({ length: keys + 1 }, (_, i) => (i / keys) * d);
  const values = times.flatMap((t) => ramp(t / d).toArray());
  const tracks: THREE.KeyframeTrack[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || o.parent?.name.startsWith('ssg_stage')) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.emissive && mat.userData?.ssg_fx) tracks.push(new THREE.ColorKeyframeTrack(`${m.uuid}.material.emissive`, times, values));
  });
  return tracks;
}

const axisParam = { key: 'axis', label: 'Flight axis (0 auto, 1 X, 2 Y, 3 Z)', min: 0, max: 3, step: 1, default: 0 };
const flipParam = { key: 'flip', label: 'Flip direction (0/1)', min: 0, max: 1, step: 1, default: 0 };

export const OBJECT_TEMPLATES: Template[] = [
  // A single frame (static props, buildings): one direction set, no motion.
  obj('still', 'Still (single frame)', true, [], () => new THREE.AnimationClip('still', 0.001, [])),
  obj('spin', 'Spin', true, [duration(0.25, 1.5, 6), { key: 'turns', label: 'Turns per loop', min: 1, max: 8, step: 1, default: 1 }], (root, _a, p) =>
    new THREE.AnimationClip('spin', p.duration, rootTracks(root, p.duration, (t) => ({ rot: about(Y, (t / p.duration) * p.turns * TAU) })))),
  obj('bob', 'Bob up and down', true, [duration(0.25, 1.5, 6), { key: 'height', label: 'Height (cm)', min: 1, max: 100, step: 1, default: 10 }], (root, _a, p) =>
    new THREE.AnimationClip('bob', p.duration, rootTracks(root, p.duration, (t) => ({ pos: new THREE.Vector3(0, (p.height / 100) * (0.5 - 0.5 * Math.cos((t / p.duration) * TAU)), 0) })))),
  obj('pickup', 'Pickup (float + spin)', true, [duration(0.5, 2, 6), { key: 'height', label: 'Float height (cm)', min: 0, max: 60, step: 1, default: 12 }], (root, _a, p) =>
    new THREE.AnimationClip('pickup', p.duration, rootTracks(root, p.duration, (t) => ({
      rot: about(Y, (t / p.duration) * TAU),
      pos: new THREE.Vector3(0, (p.height / 100) * (1 + Math.sin((t / p.duration) * TAU)) / 2 + 0.1, 0),
    })))),
  obj('bounce', 'Bounce (with squash)', true, [duration(0.25, 0.8, 4), { key: 'height', label: 'Height (cm)', min: 5, max: 200, step: 1, default: 40 }], (root, _a, p) =>
    new THREE.AnimationClip('bounce', p.duration, rootTracks(root, p.duration, (t) => {
      const u = t / p.duration;
      const h = Math.sin(Math.PI * u);
      const squash = 1 - 0.2 * Math.max(0, 1 - h * 6); // squash near the ground
      return { pos: new THREE.Vector3(0, (p.height / 100) * h, 0), scale: new THREE.Vector3(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash)) };
    }))),
  obj('pulse', 'Pulse (scale)', true, [duration(0.25, 1, 4), { key: 'amount', label: 'Grow (%)', min: 1, max: 100, step: 1, default: 15 }], (root, _a, p) =>
    new THREE.AnimationClip('pulse', p.duration, rootTracks(root, p.duration, (t) => ({ scale: 1 + (p.amount / 100) * pulse(t / p.duration) })))),
  obj('wobble', 'Wobble', true, [duration(0.25, 1, 4), { key: 'angle', label: 'Angle (± °)', min: 1, max: 45, step: 1, default: 8 }], (root, _a, p) =>
    new THREE.AnimationClip('wobble', p.duration, rootTracks(root, p.duration, (t) => ({ rot: about(Z, deg(p.angle) * Math.sin((t / p.duration) * TAU)) })))),
  obj('fall_over', 'Fall over', false, [duration(0.3, 0.8, 3)], (root, _a, p) => {
    // Tip forward about the front bottom edge.
    const b = assetBox(root, root);
    const edge = new THREE.Vector3(0, b.min.y, b.max.z);
    return new THREE.AnimationClip('fall_over', p.duration, rootTracks(root, p.duration, (t) => {
      const u = t / p.duration;
      const r = about(X, deg(90) * (u * u)); // accelerate like gravity
      return { rot: r, pos: edge.clone().sub(edge.clone().applyQuaternion(r)) };
    }));
  }),
  obj('hit_shake', 'Hit shake', false, [duration(0.2, 0.5, 2), { key: 'amount', label: 'Shake (cm)', min: 1, max: 30, step: 1, default: 6 }], (root, _a, p) =>
    new THREE.AnimationClip('hit_shake', p.duration, rootTracks(root, p.duration, (t) => {
      const u = t / p.duration;
      return { pos: new THREE.Vector3((p.amount / 100) * Math.sin(u * 6 * TAU) * (1 - u), 0, 0) };
    }))),
  obj('pop_fade', 'Puff (pop, cool down, fade)', false, [
    duration(0.2, 0.7, 3), { key: 'size', label: 'End size (×)', min: 1, max: 6, step: 0.1, default: 2.5 },
    { key: 'secondary', label: 'Extra puffs', min: 0, max: 4, step: 1, default: 2 },
  ], (root, _a, p, stage) => {
    const d = p.duration;
    // Pops past its size and settles (outBack), drifts up a little, fades out over the second half.
    const pop = ease.outBack(1.6);
    const tracks: THREE.KeyframeTrack[] = [
      ...rootTracks(root, d, (t) => {
        const u = t / d;
        return { scale: 0.2 + (p.size - 0.2) * (u < 0.35 ? pop(u / 0.35) : 1 + 0.1 * (u - 0.35)), rot: about(Y, u * 0.8), pos: new THREE.Vector3(0, 0.15 * u, 0) };
      }),
      ...opacityTracks(root, d, (t) => 1 - ease.inQuad((t / d - 0.45) / 0.55)),
      // FX meshes cool from white-hot to ember red as they fade.
      ...emissiveRamp(root, d, colorRamp([[0, '#ffffff'], [0.3, '#ffd070'], [0.65, '#ff7a30'], [1, '#4a2018']])),
    ];
    // Smaller puffs thrown off the main one, a moment later.
    const r = rng(`pop:${p.secondary}`);
    const { centre, extent } = (() => {
      const b = assetBox(root, root);
      const sz = b.getSize(new THREE.Vector3());
      return { centre: b.getCenter(new THREE.Vector3()), extent: Math.max(sz.x, sz.y, sz.z, 0.05) };
    })();
    for (const g of stage.clone(p.secondary)) {
      const a = r() * TAU, delay = 0.08 + r() * 0.15, dir = new THREE.Vector3(Math.cos(a), 0.4 + r() * 0.5, Math.sin(a)).normalize();
      tracks.push(...instanceTracks(g, d, (t) => {
        const u = Math.max(0, (t / d - delay) / (1 - delay));
        return {
          pos: centre.clone().addScaledVector(dir, extent * 0.6 * ease.outCubic(u)),
          scale: (t / d < delay ? 0 : 0.5) * (0.4 + 0.6 * ease.outCubic(u)),
          opacity: 1 - ease.inQuad((u - 0.3) / 0.7),
        };
      }));
    }
    return new THREE.AnimationClip('pop_fade', d, tracks);
  }, () => [{ at: 0, name: 'impact' }]),

  // A transition for any model, one mesh or many (FB-028): it shakes, sinks and squashes a little into a dust
  // cloud, and fades out (in a states export, into the destination state: see endOnState).
  obj('collapse', 'Collapse (shake, sink, dust)', false, [
    duration(0.5, COLLAPSE_DEFAULTS.duration, 5),
    { key: 'shake', label: 'Shake (cm)', min: 0, max: 40, step: 1, default: COLLAPSE_DEFAULTS.shake },
    { key: 'sink', label: 'Sink (% of height)', min: 0, max: 50, step: 1, default: COLLAPSE_DEFAULTS.sink },
    { key: 'dust', label: 'Dust puffs', min: 0, max: 30, step: 1, default: COLLAPSE_DEFAULTS.dust },
    { key: 'blast', label: 'Explosion flash (0/1)', min: 0, max: 1, step: 1, default: COLLAPSE_DEFAULTS.blast },
    { key: 'fade', label: 'Fade out at the end (0/1)', min: 0, max: 1, step: 1, default: COLLAPSE_DEFAULTS.fade },
  ], (root, _a, p, stage) => {
    const d = p.duration;
    const b = assetBox(root, root);
    const box = b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)) : b;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const height = Math.max(0.05, box.max.y - Math.max(0, box.min.y));
    const radius = Math.max(0.1, Math.max(size.x, size.z) / 2);
    const tracks: THREE.KeyframeTrack[] = rootTracks(root, d, (t) => {
      const m = collapseMotion(t / d, { shake: p.shake / 100, sink: (p.sink / 100) * height, height });
      // Squash and tilt about the model's origin (on the ground under Synty props); the sink keeps the raised side low.
      return { pos: new THREE.Vector3(m.x, -m.sink, m.z), rot: about(X, m.tilt), scale: new THREE.Vector3(1, m.scaleY, 1) };
    }, 60);
    if (p.fade) tracks.push(...opacityTracks(root, d, (t) => transitionOpacity(t / d).from));
    // Dust: dark earthy puffs (COLLAPSE_DUST) rolling out from the foot and rising, thickest while the models swap, gone at the end.
    const r = rng(`collapse:${p.dust}`);
    const dustColor = colorRamp(COLLAPSE_DUST.colours);
    for (let i = 0; i < p.dust; i++) {
      const puff = dustPuff(i, Math.round(p.dust), { radius, height }, r);
      const s = stage.sprite('puff', puff.size, 'normal');
      tracks.push(...instanceTracks(s, d, (t) => {
        const st = puff.at(t / d);
        return { pos: new THREE.Vector3(centre.x + st.x, st.y, centre.z + st.z), scale: st.scale, opacity: st.opacity, color: dustColor(t / d) };
      }, 36));
    }
    if (p.blast) {
      // A short flash and a few fire puffs at the moment of impact (additive, gone by a third of the clip), sized
      // and placed by the footprint, not the height (FB-044): a tall thin radio tower got a flash half its height,
      // wider than its frame column, which the frame cropped into a slab. See blastPlan.
      const fire = colorRamp([[0, '#fff6c8'], [0.3, '#ffc040'], [0.7, '#ff6a20'], [1, '#5a1408']]);
      const plan = blastPlan({ radius, height });
      const flash = stage.sprite('glow', plan.flash.size, 'add');
      tracks.push(...instanceTracks(flash, d, (t) => {
        const u = t / d;
        return { pos: new THREE.Vector3(centre.x, plan.flash.y, centre.z), scale: plan.flash.size * ease.outExpo(u / 0.08), opacity: 1 - ease.outQuad(u / 0.25) };
      }));
      for (let i = 0; i < plan.puffs; i++) {
        const s = stage.sprite('puff', plan.puff.size, 'add', 'fire');
        const a = r() * TAU, dist = plan.puff.reach * (0.35 + 0.65 * r());
        tracks.push(...instanceTracks(s, d, (t) => {
          const u = Math.min(1, (t / d) / 0.35);
          const st = plan.puff.at(u, dist);
          return {
            pos: new THREE.Vector3(centre.x + Math.cos(a) * st.dist, st.y, centre.z + Math.sin(a) * st.dist),
            scale: st.scale, opacity: 1 - ease.inQuad(u), color: fire(u),
          };
        }));
      }
    }
    return new THREE.AnimationClip('collapse', d, tracks);
  }, () => [{ at: 0, name: 'impact' }]),

  // ---- projectiles & combat FX (the engine moves the projectile; this animates it in place) ----
  obj('projectile', 'Projectile in flight (arrow, bolt, orb, thrown star)', true, [
    duration(0.2, 0.5, 3), axisParam, flipParam,
    { key: 'spin', label: 'Spin (turns/loop): along flight, or in its own plane when it faces', min: 0, max: 8, step: 1, default: 0 },
    { key: 'pulse', label: 'Pulse (%)', min: 0, max: 60, step: 1, default: 0 },
    { key: 'wobble', label: 'Wobble (± °)', min: 0, max: 20, step: 1, default: 0 },
    { key: 'face', label: 'Face (0 auto: flat models face the side, 1 side, 2 up, 3 off)', min: 0, max: 3, step: 1, default: 0 },
    { key: 'centre', label: 'Centre on the pivot (0/1)', min: 0, max: 1, step: 1, default: 1 },
  ], (root, _a, p) => {
    // SF-FB-019: a flat model (a thrown star, a disc, a ring) faces the camera and spins in its own plane; anything
    // else points along the flight and spins about it (a rifled bolt). Either way it turns about its bounds centre,
    // which sits on the pivot, so the frame is about the model's size and the game draws it where it flies.
    const { align, normal } = projectileAlign(root, p.axis, p.flip, p.face);
    const shift = p.centre ? assetBox(root, root).getCenter(new THREE.Vector3()) : null;
    const scale0 = root.scale.clone();
    const roll = normal ?? Z;
    const yawAxis = normal ? new THREE.Vector3().crossVectors(Z, normal).normalize() : Y;
    return new THREE.AnimationClip('projectile', p.duration, rootTracks(root, p.duration, (t) => {
      const u = t / p.duration;
      const spin = about(roll, u * p.spin * TAU);
      const wob = about(yawAxis, deg(p.wobble) * Math.sin(u * 2 * TAU));
      const rot = wob.multiply(spin).multiply(align);
      const k = 1 + (p.pulse / 100) * Math.sin(u * 2 * TAU);
      return { rot, scale: k, pos: shift ? centreOffset(shift, rot.clone().multiply(root.quaternion), scale0.clone().multiplyScalar(k)) : undefined };
    }));
  }),
  obj('muzzle_flash', 'Muzzle flash (flicker, points along the shot)', false, [
    duration(0.06, 0.15, 1), { key: 'size', label: 'Peak size (×)', min: 0.5, max: 4, step: 0.1, default: 1.6 }, axisParam, flipParam,
    { key: 'seed', label: 'Variation', min: 0, max: 9, step: 1, default: 0 },
  ], (root, _a, p) => {
    // The flash's long axis (a cone's height) points forward, the direction of the shot. It flickers through
    // a few uneven peaks, with a random roll and a slightly squashed cross-section, like a real flash.
    const align = alignForward(root, p.axis, p.flip);
    const r = rng(`flash:${p.seed}`);
    const roll = r() * TAU, sx = 0.85 + r() * 0.3, sy = 0.85 + r() * 0.3;
    const keys = [0, 0.1, 0.25, 0.45, 0.7, 1], peaks = [0, 1, 0.55, 0.9, 0.3, 0], alphas = [1, 1, 0.7, 0.85, 0.35, 0];
    const at = (u: number, v: number[]) => {
      for (let i = 1; i < keys.length; i++) if (u <= keys[i]) return v[i - 1] + (v[i] - v[i - 1]) * ((u - keys[i - 1]) / (keys[i] - keys[i - 1]));
      return v[v.length - 1];
    };
    return new THREE.AnimationClip('muzzle_flash', p.duration, [
      ...rootTracks(root, p.duration, (t) => {
        const u = t / p.duration, k = p.size * at(u, peaks);
        return { scale: new THREE.Vector3(k * sx, k * sy, k), rot: about(Z, roll + u * 0.6).multiply(align) };
      }, 18),
      ...opacityTracks(root, p.duration, (t) => at(t / p.duration, alphas), 18),
    ]);
  }, () => [{ at: 0, name: 'flash' }]),
  obj('charge', 'Charge up (spell / power)', true, [duration(0.3, 1, 4), { key: 'grow', label: 'Grow (%)', min: 0, max: 100, step: 1, default: 35 }], (root, _a, p) =>
    new THREE.AnimationClip('charge', p.duration, rootTracks(root, p.duration, (t) => {
      const u = t / p.duration;
      return { scale: 1 + (p.grow / 100) * (0.5 + 0.5 * Math.sin(u * 3 * TAU)) * (0.6 + 0.4 * Math.sin(u * TAU)), rot: about(Y, u * TAU) };
    }))),
  obj('trail', 'Trail / streak (stretch along flight)', true, [
    duration(0.1, 0.3, 2), axisParam, flipParam,
    { key: 'stretch', label: 'Stretch (×)', min: 1, max: 6, step: 0.1, default: 2.5 },
    // Some FX meshes are hair-thin (1 cm): thicken them so they survive at sprite resolution.
    { key: 'width', label: 'Thickness (×)', min: 1, max: 30, step: 1, default: 1 },
    // SF-FB-019: FX_Bullet_Trail_01 is 16.5 m long; stretched it made a 12698 px frame.
    { key: 'length', label: 'Longest (m, 0 = model length × stretch)', min: 0, max: 50, step: 0.5, default: 3 },
    { key: 'centre', label: 'Centre on the pivot (0/1)', min: 0, max: 1, step: 1, default: 1 },
  ], (root, _a, p) => {
    const align = alignForward(root, p.axis, p.flip);
    // Scale applies in the model's own axes (before the rotation), so stretch its flight axis.
    const a = p.axis === 1 ? X : p.axis === 2 ? Y : p.axis === 3 ? Z : longAxis(root, root);
    const box = assetBox(root, root);
    const len = box.isEmpty() ? 0 : Math.abs(box.getSize(new THREE.Vector3()).dot(a) * root.scale.dot(a));
    // The stretched streak at its longest fits within `length` metres (the trail only, not its thickness).
    const cap = p.length > 0 && len * p.stretch > p.length ? p.length / (len * p.stretch) : 1;
    const shift = p.centre && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : null;
    const q = align.clone().multiply(root.quaternion);
    return new THREE.AnimationClip('trail', p.duration, [
      ...rootTracks(root, p.duration, (t) => {
        const u = t / p.duration;
        const k = 1 + (p.stretch - 1) * (0.75 + 0.25 * Math.sin(u * TAU));
        const o = p.width / Math.sqrt(k);
        const scale = new THREE.Vector3(a === X ? k * cap : o, a === Y ? k * cap : o, a === Z ? k * cap : o);
        return { rot: align, scale, pos: shift ? centreOffset(shift, q, scale.clone().multiply(root.scale)) : undefined };
      }, 16),
      ...opacityTracks(root, p.duration, (t) => 0.75 + 0.25 * Math.cos((t / p.duration) * TAU), 16),
    ]);
  }),
];
