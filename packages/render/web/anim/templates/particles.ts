import * as THREE from 'three';
import { Y, assetBox, colorRamp, ease, instanceTracks, rng, rootTracks, about } from './helpers';
import { duration, type Template } from './types';
import type { Stage } from './stage';

/**
 * Particle systems built from the asset's own meshes (debris, fireball) and the Particle FX pack's sprites
 * (low-poly puffs, glows, sparkles, rings). Every particle is a real object with its own tracks, so sheets show
 * many elements moving independently instead of one scaled mesh. Deterministic: same params, same frames.
 * Best rendered with the glowing FX look (additive), except smoke, which renders with normal blending by default
 * (fxLookFor in @ssg/shared).
 */

const TAU = Math.PI * 2;
const fx = (
  id: string, label: string, loop: boolean, params: Template['params'], build: Template['build'], events?: Template['events'],
): Template => ({ id, label, kind: 'fx', requires: [], loop, params, build, events });

const p = (key: string, label: string, min: number, max: number, step: number, def: number) => ({ key, label, min, max, step, default: def });

/** Centre and size of the asset (metres, in its own frame). */
function bounds(root: THREE.Object3D) {
  const b = assetBox(root, root);
  if (b.isEmpty()) return { centre: new THREE.Vector3(0, 0.5, 0), extent: 1, minY: 0 };
  const size = b.getSize(new THREE.Vector3());
  return { centre: b.getCenter(new THREE.Vector3()), extent: Math.max(size.x, size.y, size.z, 0.05), minY: b.min.y };
}

/** Sprite rotation in the image plane (puffs and sparkles turning as they live). */
function spinTrack(s: THREE.Sprite, d: number, f: (t: number) => number, keys = 24) {
  const times = Array.from({ length: keys + 1 }, (_, i) => (i / keys) * d);
  return new THREE.NumberKeyframeTrack(`${s.uuid}.material.rotation`, times, times.map(f));
}

/** Random unit direction, biased upwards by `up` (0 = sphere, 1 = mostly up). */
function direction(r: () => number, up: number) {
  const a = r() * TAU;
  const y = up + (1 - up) * (r() * 2 - 1);
  const h = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(Math.cos(a) * h, y, Math.sin(a) * h).normalize();
}

/** Originals' own transforms kept, scaled by k around their pivots (fireball cores, flame meshes). */
function originalsTracks(root: THREE.Object3D, stage: Stage, d: number, f: (t: number) => { k: number; opacity?: number; color?: THREE.Color }) {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const c of root.children) {
    if (c.name.startsWith('ssg_stage')) continue;
    const pos = c.position.clone(), base = c.scale.clone(), rot = c.quaternion.clone();
    tracks.push(...instanceTracks(c, d, (t) => {
      const v = f(t);
      return { pos, rot, scale: base.clone().multiplyScalar(v.k), opacity: v.opacity, color: v.color };
    }));
  }
  void stage;
  return tracks;
}

const FIRE = colorRamp([[0, '#fff6c8'], [0.25, '#ffc040'], [0.6, '#ff6a20'], [1, '#5a1408']]);
/**
 * Flames cool faster than a fireball: only the newest tongues at the base are white-hot, most of the fire is its
 * colour (SF-FB-014: fire_loop was mostly white). Under a tint the cool end takes the tint (particleTint 'fire').
 */
const FLAME = colorRamp([[0, '#fff2c0'], [0.1, '#ffd060'], [0.3, '#ff8a28'], [0.65, '#e04010'], [1, '#5a1408']]);
const SMOKE = colorRamp([[0, '#b8b4ae'], [0.5, '#8e8a86'], [1, '#6a6764']]);
/** Dark smoke (a burning wreck, oil fire): blended with SMOKE by the smoke column's darkness. */
const DARK_SMOKE = colorRamp([[0, '#3a3633'], [0.5, '#4a4643'], [1, '#5a5754']]);
const HOT_SMOKE = colorRamp([[0, '#ffc070'], [0.18, '#a07050'], [0.5, '#77706a'], [1, '#5c5854']]);

export const PARTICLE_TEMPLATES: Template[] = [
  fx('burst', 'Burst (debris flies out)', false, [
    duration(0.3, 0.8, 3), p('count', 'Pieces', 3, 30, 1, 12), p('spread', 'Spread (× model size)', 0.5, 12, 0.5, 3), p('up', 'Upward bias', 0, 1, 0.05, 0.5),
    p('gravity', 'Fall (0-1)', 0, 1, 0.05, 0.5), p('size', 'Piece size (×)', 0.1, 2, 0.05, 0.7), p('spin', 'Spin (turns/s)', 0, 6, 0.25, 2),
  ], (root, _a, prm, stage) => {
    // Distances are in model sizes, so a 5 cm shard and a 2 m crate both fill the frame the same way.
    const { centre, extent } = bounds(root);
    const r = rng(`burst:${prm.count}:${prm.spread}`);
    const d = prm.duration, reach = prm.spread * extent;
    const tracks: THREE.KeyframeTrack[] = [...stage.hideOriginal()];
    for (const g of stage.clone(prm.count)) {
      const dir = direction(r, prm.up), dist = reach * (0.5 + 0.5 * r());
      const axis = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), spin = prm.spin * (0.5 + r());
      const sz = prm.size * (0.6 + 0.8 * r());
      tracks.push(...instanceTracks(g, d, (t) => {
        const u = t / d;
        const pos = centre.clone().addScaledVector(dir, dist * ease.outCubic(u));
        pos.y = Math.max(0.02 * extent, pos.y - prm.gravity * reach * u * u);
        return {
          pos,
          rot: new THREE.Quaternion().setFromAxisAngle(axis, spin * t * TAU),
          scale: sz * (1 - ease.inQuad((u - 0.6) / 0.4)),
          opacity: 1 - ease.inQuad((u - 0.65) / 0.35),
        };
      }));
    }
    return new THREE.AnimationClip('burst', d, tracks);
  }, () => [{ at: 0, name: 'impact' }]),

  fx('impact_burst', 'Impact (shards + shockwave)', false, [
    duration(0.15, 0.5, 2), p('size', 'Spread (m)', 0.3, 8, 0.1, 2), p('count', 'Shards', 3, 24, 1, 8), p('flat', 'Shockwave ring (0/1)', 0, 1, 1, 1),
    p('upright', 'Ring faces the camera (1: side views) or lies on the ground (0)', 0, 1, 1, 0),
  ], (root, _a, prm, stage) => {
    const { centre, extent } = bounds(root);
    const r = rng(`impact:${prm.count}`);
    const d = prm.duration;
    const tracks: THREE.KeyframeTrack[] = [...stage.hideOriginal()];
    for (const g of stage.clone(prm.count)) {
      const dir = direction(r, 0.35), dist = (prm.size / 2) * (0.6 + 0.6 * r());
      const axis = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const sz = Math.min(1, prm.size / (extent * 4)) * (0.5 + r());
      tracks.push(...instanceTracks(g, d, (t) => {
        const u = t / d, e = ease.outCubic(u);
        const pos = centre.clone().addScaledVector(dir, dist * e);
        pos.y = Math.max(0.02, pos.y - 2.5 * u * u * dist);
        return { pos, rot: new THREE.Quaternion().setFromAxisAngle(axis, u * TAU * 1.5), scale: sz * (1 - ease.inQuad((u - 0.5) / 0.5)), opacity: 1 - ease.inQuad((u - 0.55) / 0.45) };
      }));
    }
    const flash = stage.sprite('glow', prm.size * 0.6);
    tracks.push(...instanceTracks(flash, d, (t) => {
      const u = t / d;
      return { pos: centre.clone(), scale: prm.size * 0.7 * ease.outExpo(u / 0.2), opacity: 1 - ease.outQuad(u / 0.45) };
    }));
    if (prm.flat) {
      // As ring_shock (SF-FB-016): on the ground the ring is edge-on to a side view's camera; upright=1 makes it a
      // camera-facing sprite at the model's middle, a full ring in any view.
      const upright = prm.upright >= 0.5;
      const ring = upright ? stage.sprite('ring', 1) : stage.quad('ring', 1);
      const at = upright ? centre.clone() : new THREE.Vector3(0, 0.02, 0);
      tracks.push(...instanceTracks(ring, d, (t) => {
        const u = t / d;
        return { pos: at.clone(), scale: 0.2 + prm.size * ease.outExpo(u), opacity: 1 - ease.inQuad(u) };
      }));
    }
    return new THREE.AnimationClip('impact_burst', d, tracks);
  }, () => [{ at: 0, name: 'impact' }]),

  fx('smoke_puffs', 'Smoke puffs (rising, one-shot)', false, [
    duration(0.6, 1.8, 5), p('count', 'Puffs', 2, 16, 1, 7), p('rise', 'Rise (m)', 0, 4, 0.1, 1.4), p('spread', 'Spread (m)', 0, 3, 0.05, 0.6),
    p('size', 'Puff size (m)', 0.2, 4, 0.05, 0.9), p('grow', 'Grow (×)', 1, 5, 0.1, 2.4), p('hot', 'Hot start (0/1)', 0, 1, 1, 0),
    p('soft', 'Soft translucent puffs (1) or the pack\'s low-poly ones (0)', 0, 1, 1, 1),
  ], (root, _a, prm, stage) => {
    const { centre } = bounds(root);
    const r = rng(`smoke:${prm.count}:${prm.hot}`);
    const d = prm.duration, ramp = prm.hot ? HOT_SMOKE : SMOKE;
    // Soft (default): cloudy, see-through puffs that thin out as they spread, so dust reads as dust at game scale
    // instead of grey low-poly boulders (Sidefighter review). soft=0: the pack's low-poly puffs, as before.
    const soft = prm.soft >= 0.5;
    const peak = soft ? 0.7 : 0.9;
    const tracks: THREE.KeyframeTrack[] = [...stage.hideOriginal()];
    for (let i = 0; i < prm.count; i++) {
      const s = stage.sprite(soft ? 'soft' : 'puff', prm.size, 'normal');
      const delay = (i / prm.count) * 0.35 * d, life = d - delay;
      const a = r() * TAU, off = prm.spread * (0.3 + 0.7 * r()), spin = (r() - 0.5) * 2.4, rot0 = r() * TAU;
      const drift = new THREE.Vector3(Math.cos(a) * off, 0, Math.sin(a) * off);
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = Math.max(0, (t - delay) / life);
        const pos = centre.clone().add(new THREE.Vector3(0, -centre.y * 0.5, 0)).addScaledVector(drift, ease.outCubic(u));
        pos.y += prm.rise * ease.outCubic(u);
        const fade = soft ? 1 - ease.outQuad((u - 0.2) / 0.8) : 1 - ease.inQuad((u - 0.35) / 0.65);
        const alpha = t < delay ? 0 : Math.min(1, u / 0.12) * fade * peak;
        return { pos, scale: prm.size * (0.3 + (prm.grow - 0.3) * ease.outCubic(u)), opacity: alpha, color: ramp(u) };
      }));
      tracks.push(spinTrack(s, d, (t) => rot0 + spin * t));
    }
    return new THREE.AnimationClip('smoke_puffs', d, tracks);
  }),

  fx('smoke_loop', 'Smoke column (loop)', true, [
    duration(0.8, 2, 6), p('count', 'Puffs', 3, 16, 1, 10), p('rise', 'Rise (m)', 0.2, 8, 0.1, 3.5), p('size', 'Puff size (m)', 0.2, 3, 0.05, 0.7),
    p('grow', 'Grow (×)', 1, 5, 0.1, 2.2), p('drift', 'Sideways drift (m)', 0, 2, 0.05, 0.4), p('dark', 'Darkness (0 steam – 1 black)', 0, 1, 0.05, 0.6),
  ], (root, _a, prm, stage) => {
    const { centre } = bounds(root);
    const r = rng(`smokeloop:${prm.count}`);
    const d = prm.duration;
    const tracks: THREE.KeyframeTrack[] = [...stage.hideOriginal()];
    const colour = (u: number) => SMOKE(u).lerp(DARK_SMOKE(u), Math.min(1, Math.max(0, prm.dark)));
    for (let i = 0; i < prm.count; i++) {
      const s = stage.sprite('puff', prm.size, 'normal');
      const phase = i / prm.count, rot0 = r() * TAU, side = (r() - 0.5) * 2;
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = (t / d + phase) % 1;
        // Each puff climbs the whole column once per loop (rising faster near the source), widening as it goes.
        const pos = new THREE.Vector3(side * 0.15 + prm.drift * u * u, Math.max(0, centre.y * 0.3) + prm.rise * (0.65 * u + 0.35 * ease.outQuad(u)), Math.sin(phase * 7) * 0.1);
        return { pos, scale: prm.size * (0.35 + (prm.grow - 0.35) * u), opacity: Math.min(1, u / 0.1) * (1 - ease.inQuad((u - 0.45) / 0.55)) * 0.9, color: colour(u) };
      }, 48));
      tracks.push(spinTrack(s, d, (t) => rot0 + (t / d) * 1.2));
    }
    return new THREE.AnimationClip('smoke_loop', d, tracks);
  }),

  fx('fire_loop', 'Fire (looping flames)', true, [
    duration(0.3, 0.7, 2), p('count', 'Flames', 4, 32, 1, 18), p('height', 'Height (m)', 0.2, 4, 0.05, 1.2), p('width', 'Width (m)', 0.05, 2, 0.05, 0.35),
    p('size', 'Flame size (m)', 0.1, 2, 0.05, 0.55), p('mesh', 'Keep the model (0/1)', 0, 1, 1, 0),
  ], (root, _a, prm, stage) => {
    const r = rng(`fire:${prm.count}`);
    const d = prm.duration;
    const tracks: THREE.KeyframeTrack[] = [];
    if (prm.mesh) {
      // The flame model itself flickers (a whole number of flickers per loop, so it loops cleanly).
      tracks.push(...originalsTracks(root, stage, d, (t) => ({ k: 1 + 0.12 * Math.sin((t / d) * TAU * 3) + 0.06 * Math.sin((t / d) * TAU * 7) })));
    } else tracks.push(...stage.hideOriginal());
    // A glowing core at the base, hot enough to stay pale under a tint.
    const core = stage.sprite('glow', prm.width * 4, 'add', 'fire');
    tracks.push(...instanceTracks(core, d, (t) => ({
      pos: new THREE.Vector3(0, prm.size * 0.4, 0), scale: prm.width * 4 * (1 + 0.08 * Math.sin((t / d) * TAU * 3)), opacity: 0.85, color: new THREE.Color('#ffd890'),
    })));
    // Low-poly flame tongues: overlapping puffs rising, shrinking and cooling from yellow-white to red. Every third is
    // an inner tongue, smaller, lower and hotter (brighter than white: the export rolls piled-up light to white-hot),
    // so the fire has a white-hot heart and outer flames in its colour.
    for (let i = 0; i < prm.count; i++) {
      const s = stage.sprite('puff', prm.size, 'add', 'fire');
      const phase = i / prm.count + r() * 0.05, a = r() * TAU, rad = prm.width * (0.15 + 0.85 * r()), rot0 = r() * TAU;
      const inner = i % 3 === 0;
      const k = inner ? { rad: 0.35, h: 0.55, size: 0.6, heat: 0.3, hot: 3 } : { rad: 1, h: 1, size: 1, heat: 1, hot: 1 };
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = (t / d + phase) % 1;
        const wob = Math.sin((t / d) * TAU * 2 + a) * prm.width * 0.2;
        const pos = new THREE.Vector3(Math.cos(a) * rad * k.rad * (1 - u) + wob, prm.size * 0.35 + prm.height * k.h * ease.outQuad(u), Math.sin(a) * rad * k.rad * (1 - u));
        // Born small at the base, swell quickly, then shrink and cool as they lick upwards.
        const grow = u < 0.18 ? 0.45 + 0.55 * ease.outQuad(u / 0.18) : 1 - 0.8 * ease.inQuad((u - 0.18) / 0.82);
        return { pos, scale: prm.size * k.size * grow, opacity: Math.min(1, u * 12) * (1 - ease.inCubic(u)), color: FLAME(u * k.heat).multiplyScalar(k.hot) };
      }, 48));
      tracks.push(spinTrack(s, d, (t) => rot0 + (t / d) * TAU * (i % 2 ? 1 : -1)));
    }
    void root;
    return new THREE.AnimationClip('fire_loop', d, tracks);
  }),

  fx('explosion', 'Explosion (flash, fireball, sparks)', false, [
    duration(0.35, 0.8, 3), p('size', 'Size (m)', 0.5, 12, 0.1, 3), p('lobes', 'Fireball puffs', 0, 24, 1, 12), p('sparks', 'Sparks', 0, 40, 1, 14),
  ], (root, _a, prm, stage) => {
    const { centre, extent } = bounds(root);
    const r = rng(`explosion:${prm.lobes}:${prm.sparks}`);
    const d = prm.duration, S = prm.size;
    const tracks: THREE.KeyframeTrack[] = [];
    // Core: the model itself (an FX sphere) swells and cools from white to dark red, then fades.
    const k = S / extent;
    tracks.push(...originalsTracks(root, stage, d, (t) => {
      const u = t / d;
      return { k: k * (0.25 + 0.75 * ease.outCubic(u / 0.6)), opacity: 1 - ease.inQuad((u - 0.4) / 0.6), color: FIRE(u * 1.1) };
    }));
    // Flash.
    const flash = stage.sprite('glow', S, 'add', 'fire');
    tracks.push(...instanceTracks(flash, d, (t) => {
      const u = t / d;
      return { pos: centre.clone(), scale: S * 1.6 * ease.outExpo(u / 0.12), opacity: 1 - ease.outQuad(u / 0.3) };
    }));
    // Fireball lobes: low-poly puffs pushed outwards.
    for (let i = 0; i < prm.lobes; i++) {
      const s = stage.sprite('puff', S * 0.4, 'add', 'fire');
      const dir = direction(r, 0.3), dist = S * (0.2 + 0.25 * r()), delay = r() * 0.1 * d, rot0 = r() * TAU;
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = Math.max(0, (t - delay) / (d - delay));
        return {
          pos: centre.clone().addScaledVector(dir, dist * ease.outCubic(u)).add(new THREE.Vector3(0, S * 0.15 * u, 0)),
          scale: S * (0.25 + 0.55 * ease.outCubic(u)) * (0.7 + 0.6 * ((i * 0.37) % 1)),
          opacity: t < delay ? 0 : 1 - ease.inQuad((u - 0.35) / 0.65), color: FIRE(u),
        };
      }));
      tracks.push(spinTrack(s, d, (t) => rot0 + t * 1.5));
    }
    // Sparks thrown out with gravity.
    for (let i = 0; i < prm.sparks; i++) {
      // They stay within about one fireball size, so the frame is not mostly empty space.
      const s = stage.sprite('spark', S * 0.25, 'add', 'fire');
      const dir = direction(r, 0.45), reach = S * (0.6 + 0.5 * r());
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = t / d;
        const pos = centre.clone().addScaledVector(dir, reach * ease.outCubic(u));
        pos.y -= S * 0.35 * u * u;
        return { pos, scale: S * 0.25 * (1 - u * 0.6), opacity: 1 - ease.inQuad((u - 0.5) / 0.5), color: FIRE(u * 0.6) };
      }));
    }
    return new THREE.AnimationClip('explosion', d, tracks);
  }, () => [{ at: 0, name: 'impact' }]),

  fx('sparkle', 'Sparkle (twinkling stars, loop)', true, [
    duration(0.4, 1.2, 4), p('count', 'Stars', 2, 24, 1, 9), p('radius', 'Radius (× model size)', 0.2, 4, 0.1, 1), p('size', 'Star size (× model size)', 0.1, 2, 0.05, 0.6),
    p('mesh', 'Keep the model (0/1; always kept when stacked on a motion like projectile)', 0, 1, 1, 0),
  ], (root, _a, prm, stage) => {
    const { centre, extent } = bounds(root);
    const r = rng(`sparkle:${prm.count}`);
    const d = prm.duration, size = prm.size * extent;
    const tracks: THREE.KeyframeTrack[] = prm.mesh || stage.overModel ? [] : [...stage.hideOriginal()];
    for (let i = 0; i < prm.count; i++) {
      const s = stage.sprite('spark', size);
      const pos = centre.clone().add(direction(r, 0).multiplyScalar(prm.radius * extent * Math.sqrt(r())));
      const phase = r(), rot0 = r() * TAU;
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = (t / d + phase) % 1;
        const tw = Math.sin(Math.PI * u) ** 2;
        return { pos, scale: size * (0.2 + 0.8 * tw), opacity: tw };
      }, 32));
      tracks.push(spinTrack(s, d, (t) => rot0 + (t / d) * Math.PI));
    }
    return new THREE.AnimationClip('sparkle', d, tracks);
  }),

  fx('fireball', 'Fireball (glowing head, flames trailing)', true, [
    duration(0.2, 0.5, 2), p('size', 'Head size (m; without the model)', 0.1, 3, 0.05, 0.5), p('trail', 'Trail length (× head size)', 0.5, 6, 0.1, 2.4),
    p('count', 'Flames', 6, 40, 1, 22), p('spread', 'Trail width (× head size)', 0.1, 1.5, 0.05, 0.45), p('lift', 'Flames rise (× trail)', 0, 0.6, 0.05, 0.1),
    p('sparks', 'Sparks', 0, 16, 1, 5), p('pulse', 'Head pulse (%)', 0, 40, 1, 12), p('flip', 'Fly the other way (0/1)', 0, 1, 1, 0),
    p('mesh', 'The model is the head (0/1)', 0, 1, 1, 1),
  ], (root, _a, prm, stage) => {
    // SF-FB-015: a projectile fireball in one template. It flies along the model's +Z (the facing direction, as
    // `projectile` points it; flip=1 the other way), so in side views it travels across the screen and in top views
    // along each direction: the flames stream out behind it, across the picture plane in both. The head sits on
    // the pivot, so the game draws the sprite where the fireball is.
    const box = assetBox(root, root);
    const useMesh = prm.mesh >= 0.5 && !box.isEmpty();
    const { centre, extent } = bounds(root);
    const H = useMesh ? extent : prm.size;
    const head = useMesh ? centre : new THREE.Vector3();
    const back = new THREE.Vector3(0, 0, prm.flip ? 1 : -1);
    const L = prm.trail * H, d = prm.duration;
    const r = rng(`fireball:${prm.count}:${prm.sparks}`);
    const tracks: THREE.KeyframeTrack[] = useMesh ? [] : [...stage.hideOriginal()];
    if (useMesh) {
      // Centre the model's bounds on the pivot (the stage rides along, so the particles stay put around it).
      const off = centre.clone().multiply(root.scale).applyQuaternion(root.quaternion).negate();
      tracks.push(...rootTracks(root, d, () => ({ pos: off }), 2));
    }
    const beat = (t: number) => 1 + (prm.pulse / 100) * Math.sin((t / d) * TAU * 2);
    // Head: a wide glow and a white-hot core (brighter than white, so it stays white under any tint).
    const halo = stage.sprite('glow', H * 2.4, 'add', 'fire');
    tracks.push(...instanceTracks(halo, d, (t) => ({ pos: head.clone(), scale: H * 2.4 * beat(t), opacity: 0.8, color: new THREE.Color('#ffb050') }), 24));
    const core = stage.sprite('glow', H * 1.2, 'add', 'fire');
    tracks.push(...instanceTracks(core, d, (t) => ({ pos: head.clone(), scale: H * 1.2 * beat(t + d / 4), opacity: 1, color: new THREE.Color('#fff4d8').multiplyScalar(2.5) }), 24));
    // Flames: puffs born at the head, streaming back, shrinking and cooling; spread both across (top views) and
    // up/down (side views). A whole number of cycles per loop, so the sheet loops cleanly.
    for (let i = 0; i < prm.count; i++) {
      const s = stage.sprite('puff', H, 'add', 'fire');
      const phase = i / prm.count + r() * 0.04, a = r() * TAU, w = prm.spread * H * (0.3 + 0.7 * r()), rot0 = r() * TAU;
      const side = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = (t / d + phase) % 1;
        const pos = head.clone()
          .addScaledVector(back, H * 0.15 + L * ease.outQuad(u))
          .addScaledVector(side, w * Math.sin(Math.PI * Math.min(1, u * 1.6)) * 0.6)
          .add(new THREE.Vector3(0, prm.lift * L * u * u, 0));
        const scale = H * (0.95 - 0.7 * ease.inQuad(u)) * (u < 0.1 ? 0.6 + 4 * u : 1);
        return { pos, scale, opacity: Math.min(1, u * 14) * (1 - ease.inCubic(u)), color: FLAME(0.08 + u * 0.92).multiplyScalar(u < 0.15 ? 1.6 : 1) };
      }, 36));
      tracks.push(spinTrack(s, d, (t) => rot0 + (t / d) * TAU * (i % 2 ? 1 : -1)));
    }
    // Sparks shed behind, a little faster than the flames.
    for (let i = 0; i < prm.sparks; i++) {
      const s = stage.sprite('spark', H * 0.35, 'add', 'fire');
      const phase = r(), a = r() * TAU, w = prm.spread * H * (0.5 + r());
      const side = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      tracks.push(...instanceTracks(s, d, (t) => {
        const u = (t / d + phase) % 1;
        return {
          pos: head.clone().addScaledVector(back, H * 0.3 + L * 1.15 * u).addScaledVector(side, w * u),
          scale: H * 0.35 * (1 - 0.6 * u), opacity: Math.sin(Math.PI * u), color: FIRE(u * 0.6),
        };
      }, 24));
    }
    return new THREE.AnimationClip('fireball', d, tracks);
  }),

  fx('ring_shock', 'Shockwave ring', false, [
    duration(0.15, 0.45, 2), p('size', 'Size (m)', 0.3, 12, 0.1, 3),
    p('upright', 'Face the camera (1: side views) or lie on the ground (0)', 0, 1, 1, 0),
  ], (root, _a, prm, stage) => {
    const d = prm.duration;
    // SF-FB-016: on the ground the ring is edge-on to a side view's camera (a 186×16 px sliver); upright, it is a
    // camera-facing sprite at the model's middle, a full ring in any view.
    const upright = prm.upright >= 0.5;
    const ring = upright ? stage.sprite('ring', 1) : stage.quad('ring', 1);
    const glow = upright ? stage.sprite('glow', 1) : stage.quad('glow', 1);
    const at = upright ? bounds(root).centre : new THREE.Vector3(0, 0.02, 0);
    const tracks: THREE.KeyframeTrack[] = [...stage.hideOriginal()];
    tracks.push(...instanceTracks(ring, d, (t) => {
      const u = t / d;
      return { pos: at.clone(), scale: 0.2 + prm.size * ease.outExpo(u), opacity: 1 - ease.inQuad(u) };
    }));
    tracks.push(...instanceTracks(glow, d, (t) => {
      const u = t / d;
      return { pos: at.clone().setY(at.y - (upright ? 0 : 0.005)), scale: 0.2 + prm.size * 0.8 * ease.outExpo(u), opacity: 0.6 * (1 - ease.outQuad(u)) };
    }));
    return new THREE.AnimationClip('ring_shock', d, tracks);
  }, () => [{ at: 0, name: 'impact' }]),
];

export { about, Y };
