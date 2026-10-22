import * as THREE from 'three';
import { boneForAttachment, classFor, defaultHand, placementFor, slotOfAsset, uniquePartNames, type PlacementFixes, type DepthRule, type Grip, type LoadoutItem, type SecondaryMotion } from '@slop/sprites';
import { assetBox, assetPivot, assetSpace, longAxis, nodeByName, nodesWithRole } from '../anim/templates/helpers';
import { buildLayers, isLoop } from '../anim/templates';
import type { Asset } from '../data';
import type { HeldInfo } from '../export/extras';
import { applyVariant, loadModel } from './assets';
import { type SpriteRenderer } from './SpriteRenderer';

/** One thing to mount on the main asset (already loaded). */
export interface Mount {
  asset: Asset;
  obj: THREE.Object3D;
  /** Canonical bone (hand_r…), raw bone/part name, '' (root) or '@auto'. */
  target: string;
  placement: 'modelled' | 'offset';
  pos: [number, number, number];
  rot: [number, number, number];
  scale: number;
  clip: THREE.AnimationClip | null;
  /** Compute the rotation automatically (weapons without a saved grip). */
  autoOrient?: boolean;
  /** Layered exports: this item's own sheet (part) name; undefined = drawn into the body's sheet. */
  part?: string;
  depth?: DepthRule;
  /** Spring lag behind the bone (hair, capes, pouches). */
  secondary?: SecondaryMotion;
  /** Start the item's own clip at this event of the body clip (muzzle flash on "shoot"…). */
  trigger?: string;
  /** The item's own clip plays once (hidden before the trigger and after it ends). */
  oneShot?: boolean;
  /** The loadout item this mount came from (batch/CLI), kept for incremental comparisons. */
  item?: LoadoutItem;
  /** Weapon class: shown only during that class's clips. */
  cls?: string;
}

/** Which bone an origin-modelled Synty attachment mounts on (shared with the 3D exporter, OR-FB-017). */
export { boneForAttachment };

/**
 * The body's extent in asset space within a horizontal band around height `y` (rest pose): where the torso's
 * back and front are at chest height, for placing packs and capes against the body instead of at a bone origin.
 */
export function bodyBandBox(scene: THREE.Object3D, y: number, halfBand = 0.15) {
  scene.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === 'attachment') return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    const toAsset = new THREE.Matrix4().copy(inv).multiply(m.matrixWorld);
    const skinned = m as THREE.SkinnedMesh;
    for (let i = 0; i < pos.count; i += 3) {
      // Skinned meshes keep bind-space vertices: getVertexPosition applies the skeleton (rest pose here).
      if (skinned.isSkinnedMesh) skinned.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      v.applyMatrix4(toAsset);
      if (Math.abs(v.y - y) <= halfBand) box.expandByPoint(v);
    }
  });
  return box;
}

/**
 * Rotation (degrees, in the target bone's frame) that orients a held weapon sensibly when it has no saved grip:
 * its long axis (pointing away from where it is held) along the character's forward direction in the rest
 * pose — guns and blades point ahead — or upright for bows and shields.
 */
export function autoGripRotation(scene: THREE.Object3D, target: THREE.Object3D, obj: THREE.Object3D, heldName: string): [number, number, number] {
  obj.updateWorldMatrix(true, true);
  const box = assetBox(obj, obj);
  const axis = longAxis(obj, obj).clone();
  // Point the far end (the barrel / blade) away from the grip at the model's origin.
  if (box.getCenter(new THREE.Vector3()).dot(axis) < 0) axis.negate();
  const upright = /(^|_)(long|short|recurve|hunting|great|war|elven|orc)?bow(_|\d|$)|shield|buckler|staff/i.test(heldName);
  const want = upright ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  // Express the character-space direction in the bone's local frame (rest pose).
  scene.updateWorldMatrix(true, true);
  const toBone = new THREE.Matrix4().copy(target.matrixWorld).invert().multiply(scene.matrixWorld);
  const local = want.transformDirection(toBone).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(axis.normalize(), local);
  const e = new THREE.Euler().setFromQuaternion(q);
  const r = (v: number) => Math.round((v * 180) / Math.PI);
  return [r(e.x), r(e.y), r(e.z)];
}

/**
 * How each moveset holds its weapon, as a direction measured on the character in that style's own idle pose.
 * Synty weapons share one convention: origin at the grip, barrel or blade along +Z, top along +Y. So aiming +Z
 * along the measured direction (top kept up) puts a rifle across both hands, a pistol or sword along the forearm
 * and a knife in a reverse grip, whatever the model.
 */
export const STYLE_GRIPS: Record<string, 'two_hand' | 'forearm' | 'reverse'> = {
  rifle: 'two_hand',
  pistol: 'forearm',
  sword: 'forearm',
  knife: 'reverse',
  // A launcher lies along the line from the grip hand to the hand on the tube (on the shoulder or carried across).
  launcher: 'two_hand',
};

/**
 * A computed rotation in one form only (G17): rounded to 1e-6 and with w ≥ 0 (q and -q are the same rotation). The
 * same pose can come out as either sign, or a few ulps apart, depending on what the page loaded before; held in
 * that form, the grip, the rifle's matrices, the framing measured with it and the frame cache's keys are the same
 * on every load.
 */
export function stableQuaternion(q: THREE.Quaternion): THREE.Quaternion {
  const s = q.w < 0 || (q.w === 0 && (q.x < 0 || (q.x === 0 && (q.y < 0 || (q.y === 0 && q.z < 0))))) ? -1 : 1;
  const r = (v: number) => Math.round(v * s * 1e6) / 1e6 + 0;
  return q.set(r(q.x), r(q.y), r(q.z), r(q.w)).normalize();
}

/**
 * Re-aim style weapons that have no saved grip, using their style's idle clip: the hand bones' positions at the
 * clip's first frame give the barrel/blade direction (see STYLE_GRIPS), fixed in the hand from then on.
 */
export function alignStyleGrips(sr: SpriteRenderer, scene: THREE.Object3D, main: Asset | null, clips: { name: string; clip: THREE.AnimationClip | null; cls?: string; ownGrip?: boolean | 'two_hand' }[]) {
  const map = main?.rig?.map ?? {};
  const bone = (k: string) => (map[k] ? nodeByName(scene, map[k]) : null);
  const handR = bone('hand_r'), handL = bone('hand_l'), foreR = bone('lowerarm_r');
  if (!handR || !foreR) return;
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  /** The holder rotation that points the weapon by `rule` in the pose the scene is in now. */
  const gripNow = (h: THREE.Object3D, rule: 'two_hand' | 'forearm' | 'reverse') => {
    const wristR = world(handR), elbowR = world(foreR);
    const forearm = wristR.clone().sub(elbowR).normalize();
    let dir = rule === 'reverse' ? forearm.clone().negate() : forearm;
    if (rule === 'two_hand' && handL) {
      const across = world(handL).sub(wristR);
      // Only when the off hand is really on the gun (hands apart by more than a third of a forearm).
      if (across.length() > wristR.distanceTo(elbowR) * 0.33) dir = across.normalize();
    }
    // The weapon's top stays as close to up as its direction allows.
    const up = new THREE.Vector3(0, 1, 0);
    let y = up.clone().sub(dir.clone().multiplyScalar(up.dot(dir)));
    if (y.lengthSq() < 1e-6) y = new THREE.Vector3(0, 0, 1).sub(dir.clone().multiplyScalar(dir.z));
    y.normalize();
    const x = new THREE.Vector3().crossVectors(y, dir).normalize();
    const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, dir));
    // The model inside the holder may carry its own root rotation: the holder takes the rest.
    const obj = h.children[0];
    const objLocal = obj ? obj.quaternion.clone() : new THREE.Quaternion();
    const holderWorld = want.multiply(objLocal.invert());
    const parentWorld = h.parent!.getWorldQuaternion(new THREE.Quaternion());
    return stableQuaternion(parentWorld.invert().multiply(holderWorld));
  };
  const pose = (clip: THREE.AnimationClip) => {
    sr.setClip(clip);
    sr.setTime(0);
    scene.updateMatrixWorld(true);
  };
  for (const h of sr.holders) {
    const cls = h.userData.cls as string | undefined;
    // A clip's own item (per-clip with, FB-074) in a group that is no moveset ("law") is held as its kind's style.
    const perClip = !!(h.userData.item as LoadoutItem | undefined)?.perClip;
    const rule = cls ? STYLE_GRIPS[cls] ?? (perClip ? STYLE_GRIPS[classFor((h.userData.held as HeldInfo | undefined)?.name ?? '') ?? ''] : undefined) : undefined;
    if (!rule || !h.userData.autoGrip || !h.parent) continue;
    const ref = clips.find((c) => c.cls === cls && /idle/i.test(c.name) && c.clip && !c.ownGrip) ?? clips.find((c) => c.cls === cls && c.clip);
    if (!ref?.clip) continue;
    pose(ref.clip);
    h.quaternion.copy(gripNow(h, rule));
    h.updateMatrixWorld(true);
    h.userData.gripDefault = h.quaternion.clone();
    // Procedural gun poses (kneeling, prone, crawling, the stand-in shot) hold the weapon their own way: along
    // the gun forearm in that pose, whatever the idle clip's grip was.
    for (const c of clips) {
      if (!c.ownGrip || !c.clip || (c.cls && c.cls !== cls)) continue;
      pose(c.clip);
      h.quaternion.copy(h.userData.gripDefault as THREE.Quaternion);
      scene.updateMatrixWorld(true);
      sr.setClipGrip(c.clip, h, gripNow(h, rule === 'reverse' ? 'reverse' : c.ownGrip === 'two_hand' ? 'two_hand' : 'forearm'));
    }
    h.quaternion.copy(h.userData.gripDefault as THREE.Quaternion);
  }
  // A launcher held without a moveset (`-t shoulder_fire --with SM_Wep_RPG_01`): the shoulder pose still lays the
  // tube along the line between the hands (FB-072); its other clips keep the automatic grip.
  for (const h of sr.holders) {
    if (h.userData.cls || !h.userData.autoGrip || !h.parent || classFor((h.userData.held as HeldInfo | undefined)?.name ?? '') !== 'launcher') continue;
    const base = h.quaternion.clone();
    for (const c of clips) {
      if (c.ownGrip !== 'two_hand' || !c.clip || c.cls) continue;
      pose(c.clip);
      sr.setClipGrip(c.clip, h, gripNow(h, 'two_hand'));
      h.quaternion.copy(base);
    }
  }
  sr.setClip(null);
  sr.restPose();
}

/** Socket / part names of a front (support-hand) grip: a launcher's or rifle's foregrip. */
const FRONT_GRIP = /front|fore|support|off[_ ]?hand|grip[_ ]?l\b|hand[_ ]?l\b|handguard/i;

/**
 * Where the support hand holds a two-handed weapon, in the held model's own space (FB-105): its `front_grip` socket (any
 * grip socket named front/fore/support…), else the centre of a part named like a foregrip, else a point on the weapon's
 * axis ahead of its origin (Synty weapons: origin at the rear grip, barrel along +Z): 30 cm ahead, or 40 % of the way
 * to the muzzle on a short one, at the height of the tube's middle.
 */
export function frontGripPoint(obj: THREE.Object3D, held: Pick<HeldInfo, 'grip' | 'parts'> | undefined) {
  const socket = held?.grip?.sockets?.find((s) => FRONT_GRIP.test(s.name));
  if (socket) return new THREE.Vector3(...socket.pos);
  const part = (held?.parts ?? []).find((p) => FRONT_GRIP.test(p.local || p.name));
  const node = part ? nodeByName(obj, part.name) : null;
  if (node) {
    const b = assetBox(node, obj);
    if (!b.isEmpty()) return b.getCenter(new THREE.Vector3());
  }
  const box = assetBox(obj, obj);
  if (box.isEmpty() || box.max.z <= 0) return null;
  const z = Math.min(0.3, box.max.z * 0.4);
  // The tube's middle at that point: the box's middle height (a launcher's sights and grips stick out about evenly).
  return new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, z);
}

/**
 * The support hand on the weapon (FB-105): in each clip that lays a weapon along both hands (`ownGrip: 'two_hand'`,
 * shoulder_fire), the off arm is solved again with two-bone IK, frame by frame, so the palm closes on the weapon's
 * front grip (frontGripPoint) under the tube instead of the template's guess in the air. The hand keeps the clip's
 * turn (palm up, fingers curled). Call after alignStyleGrips and applyPlacements (the grip and any fix are final).
 */
export function holdFrontGrip(sr: SpriteRenderer, scene: THREE.Object3D, main: Asset | null, clips: { clip: THREE.AnimationClip | null; ownGrip?: boolean | 'two_hand'; cls?: string }[]) {
  const map = main?.rig?.map ?? {};
  const bone = (k: string) => (map[k] ? nodeByName(scene, map[k]) : null);
  const [upper, fore, hand] = [bone('upperarm_l'), bone('lowerarm_l'), bone('hand_l')];
  if (!upper || !fore || !hand) return;
  // The finger direction in the hand's own frame: its first finger bone, else the forearm's line at rest.
  sr.restPose();
  scene.updateMatrixWorld(true);
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const finger = hand.children.find((c) => (c as THREE.Bone).isBone);
  const handQ0 = hand.getWorldQuaternion(new THREE.Quaternion());
  const fingersLocal = (finger ? world(finger).sub(world(hand)) : world(hand).sub(world(fore))).normalize().applyQuaternion(handQ0.clone().invert());
  const palmReach = world(hand).distanceTo(world(fore)) * 0.3; // wrist to the middle of the palm
  let changed = false;
  for (const c of clips) {
    if (c.ownGrip !== 'two_hand' || !c.clip) continue;
    const clip = c.clip;
    // The weapon this clip lays along the hands, else (a saved grip) a launcher it holds.
    const h = sr.holders.find((x) => sr.clipGrip(clip, x) && x.children[0])
      ?? sr.holders.find((x) => x.children[0] && classFor((x.userData.held as HeldInfo | undefined)?.name ?? '') === 'launcher' && (!x.userData.cls || x.userData.cls === c.cls));
    if (!h) continue;
    const local = frontGripPoint(h.children[0], h.userData.held as HeldInfo | undefined);
    if (!local) continue;
    const prev = clip.tracks.find((t) => t.name === `${upper.uuid}.quaternion`);
    const times = prev ? Array.from(prev.times) : Array.from({ length: 25 }, (_, i) => (clip.duration * i) / 24);
    const keys = { upper: [] as number[], fore: [] as number[], hand: [] as number[] };
    sr.setClip(clip);
    for (const t of times) {
      sr.setTime(t);
      scene.updateMatrixWorld(true);
      const target = h.children[0].localToWorld(local.clone());
      const handQ = hand.getWorldQuaternion(new THREE.Quaternion());
      // The palm (not the wrist) goes on the grip, under the tube: back off along the fingers and down by the palm.
      const along = fingersLocal.clone().applyQuaternion(handQ);
      const wrist = target.clone().sub(along.multiplyScalar(palmReach)).add(new THREE.Vector3(0, -0.04, 0));
      const s = world(upper), e = world(fore), w = world(hand);
      const a = s.distanceTo(e), b = e.distanceTo(w);
      const toT = wrist.clone().sub(s);
      const d = Math.min(toT.length(), (a + b) * 0.995);
      const dir = toT.normalize();
      const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
      // The elbow keeps bending the way the clip bends it.
      const pole = e.clone().sub(s);
      const bend = pole.sub(dir.clone().multiplyScalar(pole.dot(dir)));
      if (bend.lengthSq() < 1e-10) bend.set(0, -1, 0);
      bend.normalize();
      const elbow = s.clone().add(dir.clone().multiplyScalar(a * cosA)).add(bend.multiplyScalar(a * Math.sqrt(1 - cosA * cosA)));
      const turn = (o: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) => {
        const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()).multiply(o.getWorldQuaternion(new THREE.Quaternion()));
        o.quaternion.copy(o.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
        o.updateMatrixWorld(true);
      };
      turn(upper, e.clone().sub(s), elbow.clone().sub(s));
      turn(fore, world(hand).sub(world(fore)), s.clone().add(dir.multiplyScalar(d)).sub(world(fore)));
      // The hand keeps its turn in the world (palm up under the tube).
      hand.quaternion.copy(fore.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQ));
      keys.upper.push(...upper.quaternion.toArray());
      keys.fore.push(...fore.quaternion.toArray());
      keys.hand.push(...hand.quaternion.toArray());
    }
    const replaced = new Set([upper, fore, hand].flatMap((o) => [o.uuid, o.name, THREE.PropertyBinding.sanitizeNodeName(o.name)]));
    clip.tracks = clip.tracks.filter((t) => {
      const p = THREE.PropertyBinding.parseTrackName(t.name);
      return !(p.propertyName === 'quaternion' && replaced.has(p.nodeName));
    });
    clip.tracks.push(
      new THREE.QuaternionKeyframeTrack(`${upper.uuid}.quaternion`, times, keys.upper),
      new THREE.QuaternionKeyframeTrack(`${fore.uuid}.quaternion`, times, keys.fore),
      new THREE.QuaternionKeyframeTrack(`${hand.uuid}.quaternion`, times, keys.hand),
    );
    sr.uncacheClip(clip);
    changed = true;
  }
  if (!changed) return;
  sr.setClip(null);
  sr.restPose();
}

/**
 * Placement fixes on top of the automatic placement (call after alignStyleGrips): per holder, the sprite's own fix,
 * else the item's fix for the holder's moveset, else its any-moveset fix. Offsets are metres in the bone's frame,
 * turns are degrees about the item's own axes; a depth rule overrides the item's. The renderer re-applies the fix
 * whenever a clip changes the holder's grip (SpriteRenderer.applyFix).
 */
export function applyPlacements(sr: SpriteRenderer, opts: { clip?: THREE.AnimationClip | null } = {}) {
  const d = Math.PI / 180;
  for (const h of sr.holders) {
    if (!h.parent) continue;
    // The unfixed placement, kept (once per mount) so a fix is applied on top of it, never on top of an older fix.
    if (h.userData.baseCaptured) {
      // already captured
    } else if (h.matrixAutoUpdate) {
      h.userData.basePos = h.position.clone();
      h.userData.baseScale = h.scale.clone();
      if (!h.userData.gripDefault) h.userData.baseQ = h.quaternion.clone();
    } else h.userData.baseMatrix = h.matrix.clone();
    h.userData.baseCaptured = true;
    const item = h.userData.item as LoadoutItem | undefined;
    const fix = placementFor(h.userData.fixes as PlacementFixes | undefined, (h.userData.cls as string | undefined) ?? null, item?.fix);
    if (!fix) {
      delete h.userData.fix;
      // No fix: the holder goes back to its unfixed placement (setClip below restores grips; this restores the rest).
      if (h.matrixAutoUpdate) {
        if (h.userData.basePos) h.position.copy(h.userData.basePos as THREE.Vector3);
        if (h.userData.baseScale) h.scale.copy(h.userData.baseScale as THREE.Vector3);
        if (h.userData.baseQ) h.quaternion.copy(h.userData.baseQ as THREE.Quaternion);
      } else if (h.userData.baseMatrix) h.matrix.copy(h.userData.baseMatrix as THREE.Matrix4);
      continue;
    }
    const units = sr.unitsPerMetre(h.parent);
    const [px, py, pz] = fix.pos ?? [0, 0, 0];
    const [rx, ry, rz] = fix.rot ?? [0, 0, 0];
    h.userData.fix = {
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * d, ry * d, rz * d)),
      p: new THREE.Vector3(px, py, pz).multiplyScalar(units),
      s: fix.scale ?? 1,
    };
    if (fix.depth && fix.depth !== 'auto') h.userData.depth = fix.depth;
  }
  // Grips for the clip (restored from their base), each holder's fix on top.
  sr.setClip(opts.clip ?? null);
}

/** Where a held asset goes by default: its saved grip, else the hand its type uses (bow → left). */
export function defaultGrip(held: Asset): Grip {
  return held.grip ?? { target: defaultHand(held.name), pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 };
}

/**
 * Mount attachments on the main asset: skinned ones (armour) rebind to the character's bones, the rest go on a
 * bone/part — keeping Synty's modelled placement or at an offset from the bone. Each holder records what it
 * carries (`userData.held`) so its sockets (weapon tip, muzzle, custom) can be exported.
 */
export function mountAttachments(sr: SpriteRenderer, scene: THREE.Object3D, main: Asset | null, mounts: Mount[]) {
  sr.clearAttachments();
  // Placement is measured against the character's rest pose (attachments are modelled on it).
  sr.restPose();
  const map = main?.rig?.map ?? {};
  const canonBones = Object.values(map).map((n) => nodeByName(scene, n)).filter((b): b is THREE.Object3D => !!b);
  const resolve = (t: string) => (t && t !== '@auto' && (nodeByName(scene, map[t] ?? t) || nodeByName(scene, t))) || null;
  for (const m of mounts) {
    // Held weapons without a saved grip get a sensible automatic orientation.
    if (m.autoOrient && main?.kind === 'character') {
      const t = resolve(m.target);
      if (t) m.rot = autoGripRotation(scene, t, m.obj, m.asset.name);
    }
    const d = Math.PI / 180;
    const offset = { pos: new THREE.Vector3(...m.pos), rot: new THREE.Euler(m.rot[0] * d, m.rot[1] * d, m.rot[2] * d), scale: m.scale };
    const held: HeldInfo = { name: m.asset.name, kind: m.asset.kind, parts: m.asset.parts, grip: m.asset.grip, slot: m.asset.slot };
    let skinned = false;
    m.obj.traverse((o) => (skinned ||= (o as THREE.SkinnedMesh).isSkinnedMesh === true));
    if (skinned && main?.kind === 'character' && m.asset.kind === 'attachment') {
      const h = sr.addSkinnedAttachment(m.obj); // armour etc.: deforms with the character's own bones
      Object.assign(h.userData, { held, part: m.part, depth: m.depth, item: m.item });
      continue;
    }
    let target: THREE.Object3D = resolve(m.target) || scene;
    const ownBox = new THREE.Box3().setFromObject(m.obj);
    const c = ownBox.getCenter(new THREE.Vector3());
    // Synty attachments come two ways: modelled in place on the character (centre well away from the origin),
    // or modelled around their own origin to be mounted on a bone (POLYGON War helmets, packs). An item that
    // hangs below the floor (a cape modelled downwards from its neck origin) cannot be in place, however far
    // its centre is from the origin; it would otherwise snap to the nearest bone, a toe.
    const inPlace = c.length() > 0.3 && ownBox.min.y > -0.1;
    if (m.target === '@auto' && canonBones.length) {
      const byName = boneForAttachment(m.asset.name, m.asset.slot);
      target = inPlace || !byName || !map[byName]
        ? canonBones.reduce((best, b) => (assetPivot(b, scene).distanceTo(c) < assetPivot(best, scene).distanceTo(c) ? b : best), canonBones[0])
        : nodeByName(scene, map[byName]) ?? scene;
    }
    let modelled: THREE.Matrix4 | undefined;
    if (m.placement === 'modelled') {
      const inv = assetSpace(target, scene).invert();
      let at = assetPivot(target, scene);
      if (!inPlace && m.target === '@auto' && boneForAttachment(m.asset.name, m.asset.slot) === 'spine3' && main?.kind === 'character') {
        // Packs, bedrolls, capes, quivers: centred on the spine, pushed back until they sit against the torso.
        // Vertically: the middle of the back (between hips and upper spine), not the upper-spine joint.
        const hips = map.hips && nodeByName(scene, map.hips);
        const midY = hips ? (at.y + assetPivot(hips, scene).y) / 2 : at.y;
        const torso = bodyBandBox(scene, midY);
        const own = assetBox(m.obj, m.obj);
        if (!torso.isEmpty() && !own.isEmpty()) {
          const size = own.getSize(new THREE.Vector3()), centre = own.getCenter(new THREE.Vector3());
          at = new THREE.Vector3(at.x, midY, torso.min.z - size.z / 2 + 0.02).sub(centre);
        }
      }
      // Origin-modelled: mount at the bone's origin (or the computed spot), upright in character space.
      modelled = inPlace ? inv : inv.multiply(new THREE.Matrix4().makeTranslation(at));
    }
    const h = sr.addAttachment(target, m.obj, offset, m.clip, modelled);
    Object.assign(h.userData, { held, part: m.part, depth: m.depth, secondary: m.secondary, trigger: m.clip ? m.trigger : undefined, oneShot: m.oneShot, item: m.item, cls: m.cls, autoGrip: !!m.autoOrient, target: m.target, fixes: m.asset.placements });
    // The rocket in a launcher (parts with the projectile role): fired on the clip's `shoot`, hidden from then on (FB-072).
    const projectiles = nodesWithRole(m.obj, m.asset.parts, 'projectile');
    if (projectiles.length) h.userData.projectiles = projectiles;
  }
}

/**
 * Load a batch/CLI loadout (asset ids + optional placement) into mounts, using each item's saved grip. In a
 * layered export every item becomes its own part (named by its slot unless the item says otherwise).
 */
export async function loadoutMounts(items: LoadoutItem[], fetchAsset: (id: number) => Promise<Asset>, opts: { layered?: boolean; reserved?: string[] } = {}): Promise<Mount[]> {
  const out: Mount[] = [];
  const loaded: { it: LoadoutItem; asset: Asset; obj: THREE.Object3D }[] = [];
  for (const it of items) {
    const asset = await fetchAsset(it.asset);
    if (!asset.glb) continue;
    const obj = await loadModel(asset.glb);
    applyVariant(obj, asset);
    loaded.push({ it, asset, obj });
  }
  const names = opts.layered ? uniquePartNames(loaded.map(({ it, asset }) => ({ slot: slotOfAsset(asset), layer: it.layer })), opts.reserved) : [];
  loaded.forEach(({ it, asset, obj }, i) => {
    const g = defaultGrip(asset);
    const layers = it.layers ?? [];
    out.push({
      asset, obj,
      target: it.target ?? (asset.kind === 'attachment' ? '@auto' : g.target),
      placement: asset.kind === 'attachment' ? 'modelled' : 'offset',
      pos: it.pos ?? g.pos, rot: it.rot ?? g.rot, scale: it.scale ?? g.scale,
      autoOrient: !asset.grip && !it.rot && asset.kind !== 'attachment',
      clip: layers.length ? buildLayers(obj, { kind: asset.kind, name: asset.name, parts: asset.parts, rigMap: asset.rig?.map }, layers) : null,
      part: opts.layered ? names[i] : undefined,
      depth: it.depth,
      secondary: it.secondary,
      trigger: it.trigger,
      oneShot: layers.length ? !isLoop(layers) : undefined,
      item: it,
      cls: it.cls,
    });
  });
  return out;
}
