import * as THREE from 'three';
import { BODY_JOINTS, slotOfAsset, type DepthRule, type LoadoutItem } from '@slop/sprites';
import { assetBox, assetPivot, longAxis, nodeByName, nodesWithRole } from '../anim/templates/helpers';
import type { Asset } from '../data';
import type { SpriteRenderer } from '../render/SpriteRenderer';
import type { ExportPart } from './parts';

/** What an attachment holder carries (set by whoever attached it), so its sockets can be found. */
export interface HeldInfo {
  name: string;
  kind: string;
  parts?: Asset['parts'];
  grip?: Asset['grip'];
  /** Slot label (a person's), when set. */
  slot?: string | null;
}

/** Add a marker under `parent` at a point given in `space` coordinates. */
function marker(parent: THREE.Object3D, space: THREE.Object3D, point: THREE.Vector3, name: string) {
  const m = new THREE.Object3D();
  m.name = name;
  parent.add(m);
  parent.updateWorldMatrix(true, false);
  m.position.copy(parent.worldToLocal(space.localToWorld(point.clone())));
  return m;
}

/** Barrel tips of a model (each barrel-role part's far end, pointing away from the model's centre). */
function muzzles(root: THREE.Object3D, parts: Asset['parts'], space: THREE.Object3D) {
  const centre = assetBox(root, space).getCenter(new THREE.Vector3());
  return nodesWithRole(root, parts, 'barrel').map((b) => {
    const box = assetBox(b, space);
    const axis = longAxis(b, space).clone();
    if (axis.dot(box.getCenter(new THREE.Vector3()).sub(centre)) < 0) axis.negate();
    const size = box.getSize(new THREE.Vector3());
    return marker(b, space, box.getCenter(new THREE.Vector3()).addScaledVector(axis, Math.abs(size.dot(axis)) / 2), 'socket_muzzle');
  });
}

/**
 * The working end of a held weapon/prop: the end of its long axis farthest from where it is held (sword tip,
 * staff head, bow limb, gun barrel), as a marker that follows the hand.
 */
function weaponTip(holder: THREE.Object3D, object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);
  const box = assetBox(object, holder);
  const centre = box.getCenter(new THREE.Vector3());
  const axis = longAxis(object, holder).clone();
  const half = Math.abs(box.getSize(new THREE.Vector3()).dot(axis)) / 2;
  const a = centre.clone().addScaledVector(axis, half), b = centre.clone().addScaledVector(axis, -half);
  // The holder's origin is the grip; the tip is the far end.
  return marker(holder, holder, a.length() >= b.length() ? a : b, 'socket_tip');
}

/**
 * The movesets that have a weapon on the character: every mounted item's class, whether it exports as its own
 * layer or is baked into the body sheet (FB-009: a baked --with rifle counts as the rifle moveset's weapon).
 */
export const armedClasses = (classes: (string | null | undefined)[]) => [...new Set(classes.filter((c): c is string => !!c))];

/**
 * Points tracked per exported frame: hands/head/feet (characters), attachments, held weapons' tips, muzzles
 * and custom grip sockets, each barrel's muzzle (a marker that follows turret and recoil animation) and each
 * turret's centre (`turret`).
 * Also returns the feet used for footstep events (with the hips and hands that ground speeds are measured from), the attachments that export as their own layer (parts),
 * and the body reference point (hips) that part depths are measured against.
 */
export function trackedPoints(scene: THREE.Object3D, asset: Asset, sr: SpriteRenderer) {
  const sockets: { name: string; object: THREE.Object3D }[] = [];
  const parts: ExportPart[] = [];
  const map = asset.rig?.map ?? {};
  // Knees and elbows (SF-FB-020) are the lower leg's and forearm's joints.
  for (const [c, bone] of [['hand_r', 'hand_r'], ['hand_l', 'hand_l'], ['head', 'head'], ['foot_l', 'foot_l'], ['foot_r', 'foot_r'], ['knee_l', 'calf_l'], ['knee_r', 'calf_r'], ['elbow_l', 'lowerarm_l'], ['elbow_r', 'lowerarm_r']]) {
    const n = map[bone] && nodeByName(scene, map[bone]);
    if (n) sockets.push({ name: c, object: n });
  }
  sr.restPose();
  scene.traverse((o) => ['socket_muzzle', 'socket_tip', 'socket_custom'].includes(o.name) && o.removeFromParent());
  let ai = 0, wi = 0, mi = 0;
  const holders: THREE.Object3D[] = [];
  scene.traverse((o) => o.name === 'attachment' && holders.push(o));
  for (const h of holders) {
    const held = h.userData.held as HeldInfo | undefined;
    const part = h.userData.part as string | undefined;
    // Parts (layered exports) are tracked by name; the rest keep their attachment_N names.
    sockets.push({ name: part ? `attach_${part}` : `attachment_${ai++}`, object: h });
    if (part && held) {
      parts.push({
        name: part, slot: slotOfAsset(held), kind: held.kind, asset: held.name, bone: h.parent?.name ?? '',
        blend: held.kind === 'fx' ? 'add' : 'normal', depth: h.userData.depth as DepthRule | undefined, holder: h, item: h.userData.item as LoadoutItem | undefined,
        cls: h.userData.cls as string | undefined,
      });
    }
    const object = h.children[0];
    if (!held || !object || held.kind === 'attachment') continue;
    // Held weapons/props: tip, muzzles, and custom sockets saved with the grip (e.g. a bow's nock).
    if (['weapon', 'prop', 'multipart', 'rigged'].includes(held.kind)) {
      sockets.push({ name: wi ? `weapon_tip_${wi}` : 'weapon_tip', object: weaponTip(h, object) });
      wi++;
    }
    for (const m of muzzles(object, held.parts, object)) sockets.push({ name: mi++ ? `muzzle_${mi - 1}` : 'muzzle', object: m });
    for (const cs of held.grip?.sockets ?? []) {
      sockets.push({ name: cs.name, object: marker(object, object, new THREE.Vector3(...cs.pos), 'socket_custom') });
    }
  }
  // The main asset's own barrels and custom sockets (a turret, or a weapon exported on its own).
  for (const m of muzzles(scene, asset.parts, scene)) sockets.push({ name: mi++ ? `muzzle_${mi - 1}` : 'muzzle', object: m });
  // Vehicles and objects (FB-097): each turret's pivot (its box centre when the pivot sits at the model origin),
  // following the turret's own animation (turret, turret_1…).
  nodesWithRole(scene, asset.parts, 'turret').forEach((t, i) => {
    const pivot = assetPivot(t, scene);
    const at = pivot.length() > 0.05 ? pivot : assetBox(t, scene).getCenter(new THREE.Vector3());
    sockets.push({ name: i ? `turret_${i}` : 'turret', object: marker(t, scene, at, 'socket_custom') });
  });
  for (const cs of asset.grip?.sockets ?? []) sockets.push({ name: cs.name, object: marker(scene, scene, new THREE.Vector3(...cs.pos), 'socket_custom') });
  const foot = (c: string) => (map[c] && nodeByName(scene, map[c])) || null;
  const bodyRef = (map.hips && nodeByName(scene, map.hips)) || scene;
  // Characters: the joints the per-frame body boxes are measured from (SF-FB-009).
  const body: Record<string, THREE.Object3D> = {};
  if (asset.kind === 'character') for (const j of [...BODY_JOINTS, 'neck']) {
    const n = foot(j);
    if (n) body[j] = n;
  }
  return { sockets, feet: { left: foot('foot_l'), right: foot('foot_r'), hips: foot('hips'), hands: [foot('hand_l'), foot('hand_r')], knees: [foot('calf_l'), foot('calf_r')], elbows: [foot('lowerarm_l'), foot('lowerarm_r')], head: foot('head') }, body: body.hips ? body : undefined, parts, bodyRef, armed: armedClasses(holders.map((h) => h.userData.cls as string | undefined)) };
}
