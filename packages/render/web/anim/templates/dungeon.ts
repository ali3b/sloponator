import * as THREE from 'three';
import { X, Y, about, assetBox, assetCentre, assetPivot, deg, ease, longAxis, nodesWithRole, pulse, thinAxis, transformTracks } from './helpers';
import { duration, type Template } from './types';
import { clothWaveClip } from './clothWave';

/**
 * Part animations for fantasy / dungeon / medieval props: levers, drawers, gates and portcullises, traps,
 * catapult and ballista arms, flags. Driven by the part roles in worker/roles.json (lever, drawer, gate, blade,
 * arm, flag, chain), so they apply to any pack that names its parts that way.
 */
const TAU = Math.PI * 2;
const MODE = { key: 'mode', label: 'Mode (0 once, 1 back and forth)', min: 0, max: 1, step: 1, default: 1 };
const amount = (u: number, mode: number) => (mode ? pulse(u) : ease.outCubic(u));

/** A part's pivot, or a bbox point when the pivot sits at the asset origin. */
function pivotOr(n: THREE.Object3D, root: THREE.Object3D, edge: (b: THREE.Box3) => THREE.Vector3) {
  const p = assetPivot(n, root);
  return p.length() > 0.05 ? p : edge(assetBox(n, root));
}

const part = (id: string, label: string, roles: Template['requires'], loop: boolean, params: Template['params'], build: Template['build']): Template => ({
  id, label, kind: 'part', requires: [], anyOf: roles, loop, params, build,
});

export const DUNGEON_TEMPLATES: Template[] = [
  part('lever_pull', 'Lever pull', ['lever'], false, [duration(0.3, 0.8, 3), { key: 'angle', label: 'Throw (°)', min: 10, max: 120, step: 1, default: 60 }, MODE],
    (root, a, p) => new THREE.AnimationClip('lever_pull', p.duration, nodesWithRole(root, a.parts, 'lever').flatMap((n) => {
      const h = pivotOr(n, root, (b) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2)); // base of the handle
      return transformTracks(n, root, p.duration, (t) => about(X, deg(p.angle) * amount(t / p.duration, p.mode)), { centre: h });
    }))),

  part('drawer_open', 'Drawers slide open', ['drawer'], false, [duration(0.3, 0.8, 3), { key: 'depth', label: 'Slide (cm)', min: 5, max: 80, step: 1, default: 30 }, MODE],
    (root, a, p) => new THREE.AnimationClip('drawer_open', p.duration, nodesWithRole(root, a.parts, 'drawer').flatMap((n, i) =>
      transformTracks(n, root, p.duration, () => new THREE.Quaternion(), {
        // Drawers face +Z (the asset front); stagger them a little.
        offset: (t) => new THREE.Vector3(0, 0, (p.depth / 100) * amount(Math.max(0, t / p.duration - i * 0.08) / (1 - i * 0.08), p.mode)),
      })))),

  part('gate_raise', 'Gate / portcullis raise', ['gate'], false, [duration(0.5, 1.5, 5), { key: 'height', label: 'Raise (m)', min: 0.2, max: 6, step: 0.1, default: 2 }, MODE],
    (root, a, p) => new THREE.AnimationClip('gate_raise', p.duration, nodesWithRole(root, a.parts, 'gate').flatMap((n) => {
      const b = assetBox(n, root);
      // Tall thin gates slide up; small grates swing open about their top edge.
      const size = b.getSize(new THREE.Vector3());
      if (size.y >= Math.max(size.x, size.z) * 0.8)
        return transformTracks(n, root, p.duration, () => new THREE.Quaternion(), { offset: (t) => new THREE.Vector3(0, p.height * amount(t / p.duration, p.mode), 0) });
      const h = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, b.max.z);
      return transformTracks(n, root, p.duration, (t) => about(X, -deg(85) * amount(t / p.duration, p.mode)), { centre: h });
    }))),

  part('trap_spikes', 'Trap spikes (thrust up)', ['blade'], true, [duration(0.4, 1.2, 4), { key: 'height', label: 'Thrust (m)', min: 0.05, max: 2, step: 0.05, default: 0.5 }],
    (root, a, p) => new THREE.AnimationClip('trap_spikes', p.duration, nodesWithRole(root, a.parts, 'blade').flatMap((n) =>
      transformTracks(n, root, p.duration, () => new THREE.Quaternion(), {
        // Snap up fast, hold, sink slowly.
        offset: (t) => {
          const u = t / p.duration;
          const k = u < 0.12 ? ease.outBack(2)(u / 0.12) : u < 0.5 ? 1 : 1 - ease.inOutQuad((u - 0.5) / 0.5);
          return new THREE.Vector3(0, p.height * (k - 1), 0);
        },
      })))),

  part('trap_spin', 'Spinning blades', ['blade'], true, [duration(0.2, 0.6, 3), { key: 'turns', label: 'Turns per loop', min: 1, max: 8, step: 1, default: 1 }],
    (root, a, p) => new THREE.AnimationClip('trap_spin', p.duration, nodesWithRole(root, a.parts, 'blade').flatMap((n) =>
      transformTracks(n, root, p.duration, (t) => about(thinAxis(n, root), (t / p.duration) * p.turns * TAU), { centre: assetCentre(n, root) })))),

  part('catapult_fire', 'Catapult / ballista fire', ['arm'], false, [duration(0.4, 1.4, 4), { key: 'angle', label: 'Swing (°)', min: 20, max: 140, step: 1, default: 90 }],
    (root, a, p) => new THREE.AnimationClip('catapult_fire', p.duration, nodesWithRole(root, a.parts, 'arm').flatMap((n) => {
      const h = pivotOr(n, root, (b) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, b.min.z));
      // Whip forward fast (20%), shudder, then winch back slowly.
      return transformTracks(n, root, p.duration, (t) => {
        const u = t / p.duration;
        const k = u < 0.2 ? ease.outBack(1.4)(u / 0.2) : 1 - ease.inOutQuad((u - 0.35) / 0.65) * (u > 0.35 ? 1 : 0);
        return about(X, deg(p.angle) * k);
      }, { centre: h });
    })), ),

  part('flag_wave', 'Flags / banners wave', ['flag'], true, [duration(0.5, 1.6, 5), { key: 'angle', label: 'Sway (± °)', min: 2, max: 40, step: 1, default: 12 }],
    (root, a, p) => {
      const flags = nodesWithRole(root, a.parts, 'flag');
      // FB-057: a flag that is one mesh (no flag part) waves its cloth by vertex instead.
      if (!flags.length) return clothWaveClip(root, { duration: p.duration, angle: p.angle });
      return new THREE.AnimationClip('flag_wave', p.duration, flags.flatMap((n, i) => {
      const b = assetBox(n, root);
      const axis = longAxis(n, root).equals(Y) ? Y : thinAxis(n, root);
      const h = pivotOr(n, root, () => new THREE.Vector3(b.min.x, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2));
      return transformTracks(n, root, p.duration, (t) =>
        about(axis, deg(p.angle) * (Math.sin((t / p.duration) * TAU + i) * 0.7 + Math.sin((t / p.duration) * TAU * 2 + i * 2) * 0.3)), { centre: h });
      }));
    }),
];
