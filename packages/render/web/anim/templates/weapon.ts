import * as THREE from 'three';
import { Y, Z, about, assetCentre, deg, easeOut, longAxis, nodesWithRole, pulse, rootTracks, transformTracks, X } from './helpers';
import { duration, type Template } from './types';

const kick = (u: number) => (u < 0.12 ? u / 0.12 : 1 - easeOut((u - 0.12) / 0.88));

export const weaponFire: Template = {
  id: 'weapon_fire', label: 'Weapon fire (recoil, bolt, trigger)', kind: 'part', requires: [], loop: true,
  params: [duration(0.1, 0.3, 2), { key: 'recoil', label: 'Recoil (cm)', min: 0, max: 10, step: 0.5, default: 2 }],
  build(root, a, p) {
    const axis = longAxis(root, root);
    const tracks = [
      ...rootTracks(root, p.duration, (t) => ({ pos: axis.clone().multiplyScalar((-p.recoil / 100) * kick(t / p.duration)), rot: about(X, -deg(4) * kick(t / p.duration)) })),
      ...nodesWithRole(root, a.parts, 'bolt').flatMap((n) =>
        transformTracks(n, root, p.duration, () => new THREE.Quaternion(), { offset: (t) => axis.clone().multiplyScalar(-0.05 * kick(t / p.duration)) }),
      ),
      ...nodesWithRole(root, a.parts, 'trigger').flatMap((n) =>
        transformTracks(n, root, p.duration, (t) => about(X, deg(15) * pulse(Math.min(1, (t / p.duration) * 4))), { centre: assetCentre(n, root) }),
      ),
    ];
    return new THREE.AnimationClip('weapon_fire', p.duration, tracks);
  },
};

export const weaponReload: Template = {
  id: 'weapon_reload', label: 'Weapon reload (magazine)', kind: 'part', requires: ['magazine'], loop: false,
  params: [duration(0.4, 1.2, 4), { key: 'drop', label: 'Drop (cm)', min: 5, max: 60, step: 1, default: 20 }],
  build: (root, a, p) =>
    new THREE.AnimationClip('weapon_reload', p.duration, nodesWithRole(root, a.parts, 'magazine').flatMap((n) =>
      transformTracks(n, root, p.duration, (t) => about(Z, deg(20) * pulse(t / p.duration)), {
        centre: assetCentre(n, root),
        offset: (t) => new THREE.Vector3(0, -(p.drop / 100) * pulse(t / p.duration), 0).add(Y.clone().multiplyScalar(0)),
      }),
    )),
};

export const WEAPON_TEMPLATES = [weaponFire, weaponReload];
