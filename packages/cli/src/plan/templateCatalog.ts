/**
 * Moved from synty-sprite-generator packages/shared/src/templateCatalog.ts (P2, ali3b/sloponator#8): the procedural
 * templates the old renderer knew (apps/web/src/anim/templates), as plain data, so the planner can check template
 * ids, one-shots and arm poses without loading three.js. Add an entry here whenever the render bundle gains one.
 */
import type { SetItem, TemplateLayerRef } from '@slop/sprites';

export interface TemplateParamInfo {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface TemplateInfo {
  id: string;
  label: string;
  /** part: rigid multi-part models (needs the part roles); object/fx: any model as a whole; character: humanoid rigs. */
  kind: 'part' | 'object' | 'character' | 'fx';
  /** False for one-shots. */
  loop: boolean;
  /** Part roles that must all exist on the model. */
  requires?: string[];
  /** At least one of these part roles must exist. */
  anyOf?: string[];
  params: TemplateParamInfo[];
  /** Named events the template emits (e.g. shoot, release, impact). */
  events?: string[];
  /** An arm-only character pose: `<id>_walk`, `<id>_run` and `<id>_idle` lay it over that locomotion clip (armPoseMove). */
  armPose?: boolean;
}

const p = (key: string, label: string, min: number, max: number, step: number, def: number): TemplateParamInfo => ({ key, label, min, max, step, default: def });

export const TEMPLATE_CATALOG: TemplateInfo[] = [
  { id: 'drive', label: 'Drive (loop)', kind: 'part', loop: true, requires: ['wheel'], params: [p('duration', 'Length (s)', 0.25, 4, 0.05, 0.5), p('revolutions', 'Wheel turns per loop', 1, 8, 1, 1)] },
  { id: 'drive_turn', label: 'Drive while turning', kind: 'part', loop: true, requires: ['wheel'], params: [p('duration', 'Length (s)', 0.25, 4, 0.05, 0.5), p('revolutions', 'Wheel turns per loop', 1, 8, 1, 1), p('steer', 'Steer angle (° left +)', -40, 40, 1, 25), p('roll', 'Body roll (°)', 0, 8, 0.5, 2)] },
  { id: 'idle_engine', label: 'Engine idle (vibration)', kind: 'part', loop: true, params: [p('duration', 'Length (s)', 0.25, 2, 0.05, 0.5), p('amplitude', 'Shake (cm)', 0, 3, 0.1, 0.6), p('cycles', 'Shakes per loop', 1, 12, 1, 4)] },
  { id: 'brake', label: 'Brake (nose dip)', kind: 'part', loop: false, params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 0.8), p('dip', 'Dip (°)', 0, 10, 0.5, 3)] },
  { id: 'doors', label: 'Doors open / close', kind: 'part', loop: false, requires: ['door'], params: [p('duration', 'Length (s)', 0.3, 4, 0.05, 1), p('angle', 'Open angle (°)', 10, 120, 1, 70), p('mode', 'Mode (0 open, 1 close, 2 open+close loop)', 0, 2, 1, 0)] },
  { id: 'lids', label: 'Hatches / lids / canopy open', kind: 'part', loop: false, anyOf: ['lid','canopy','wheel_door'], params: [p('duration', 'Length (s)', 0.3, 4, 0.05, 1), p('angle', 'Open angle (°)', 10, 150, 1, 80), p('mode', 'Mode (0 open, 1 close, 2 open+close loop)', 0, 2, 1, 0)] },
  { id: 'lift', label: 'Lift up / down (forklift)', kind: 'part', loop: true, requires: ['lift'], params: [p('duration', 'Length (s)', 0.5, 6, 0.05, 2), p('height', 'Height (m)', 0.1, 3, 0.05, 1)] },
  { id: 'propeller_spin', label: 'Propellers / rotors spin', kind: 'part', loop: true, requires: ['propeller'], params: [p('duration', 'Length (s)', 0.1, 2, 0.05, 0.25), p('revolutions', 'Turns per loop', 1, 8, 1, 1)] },
  { id: 'fly', label: 'Fly (bank, bob, props)', kind: 'part', loop: true, params: [p('duration', 'Length (s)', 0.5, 6, 0.05, 2), p('bank', 'Bank (°)', 0, 30, 1, 6), p('bob', 'Bob (cm)', 0, 50, 1, 8)] },
  { id: 'turret_sweep', label: 'Turret sweep', kind: 'part', loop: true, anyOf: ['turret','barrel'], params: [p('duration', 'Length (s)', 0.5, 8, 0.05, 3), p('angle', 'Sweep (± °)', 5, 180, 1, 45)] },
  { id: 'fire', label: 'Fire (barrel recoil)', kind: 'part', loop: true, requires: ['barrel'], params: [p('duration', 'Length (s)', 0.2, 3, 0.05, 0.6), p('recoil', 'Recoil (cm)', 1, 80, 1, 25), p('kick', 'Body kick (°)', 0, 6, 0.5, 1.5), p('once', 'Once (0 loop, 1 one-shot)', 0, 1, 1, 0)], events: ['shoot'] },
  { id: 'destroy', label: 'Destroy (parts fly apart)', kind: 'part', loop: false, params: [p('duration', 'Length (s)', 0.5, 5, 0.05, 1.6), p('force', 'Force (m/s)', 1, 20, 0.5, 3.5), p('spread', 'Spread (× footprint radius)', 0.25, 3, 0.05, 1), p('fade', 'Fade out at the end (0/1)', 0, 1, 1, 1)], events: ['impact'] },
  { id: 'weapon_fire', label: 'Weapon fire (recoil, bolt, trigger)', kind: 'part', loop: true, params: [p('duration', 'Length (s)', 0.1, 2, 0.05, 0.3), p('recoil', 'Recoil (cm)', 0, 10, 0.5, 2)] },
  { id: 'weapon_reload', label: 'Weapon reload (magazine)', kind: 'part', loop: false, requires: ['magazine'], params: [p('duration', 'Length (s)', 0.4, 4, 0.05, 1.2), p('drop', 'Drop (cm)', 5, 60, 1, 20)] },
  { id: 'lever_pull', label: 'Lever pull', kind: 'part', loop: false, anyOf: ['lever'], params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 0.8), p('angle', 'Throw (°)', 10, 120, 1, 60), p('mode', 'Mode (0 once, 1 back and forth)', 0, 1, 1, 1)] },
  { id: 'drawer_open', label: 'Drawers slide open', kind: 'part', loop: false, anyOf: ['drawer'], params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 0.8), p('depth', 'Slide (cm)', 5, 80, 1, 30), p('mode', 'Mode (0 once, 1 back and forth)', 0, 1, 1, 1)] },
  { id: 'gate_raise', label: 'Gate / portcullis raise', kind: 'part', loop: false, anyOf: ['gate'], params: [p('duration', 'Length (s)', 0.5, 5, 0.05, 1.5), p('height', 'Raise (m)', 0.2, 6, 0.1, 2), p('mode', 'Mode (0 once, 1 back and forth)', 0, 1, 1, 1)] },
  { id: 'trap_spikes', label: 'Trap spikes (thrust up)', kind: 'part', loop: true, anyOf: ['blade'], params: [p('duration', 'Length (s)', 0.4, 4, 0.05, 1.2), p('height', 'Thrust (m)', 0.05, 2, 0.05, 0.5)] },
  { id: 'trap_spin', label: 'Spinning blades', kind: 'part', loop: true, anyOf: ['blade'], params: [p('duration', 'Length (s)', 0.2, 3, 0.05, 0.6), p('turns', 'Turns per loop', 1, 8, 1, 1)] },
  { id: 'catapult_fire', label: 'Catapult / ballista fire', kind: 'part', loop: false, anyOf: ['arm'], params: [p('duration', 'Length (s)', 0.4, 4, 0.05, 1.4), p('angle', 'Swing (°)', 20, 140, 1, 90)] },
  { id: 'flag_wave', label: 'Flags / banners wave', kind: 'part', loop: true, anyOf: ['flag'], params: [p('duration', 'Length (s)', 0.5, 5, 0.05, 1.6), p('angle', 'Sway (± °)', 2, 40, 1, 12)] },
  { id: 'sit', label: 'Sit (pose)', kind: 'character', loop: true, params: [p('hipDrop', 'Hip drop (cm)', 0, 70, 1, 40)] },
  { id: 'drive_pose', label: 'Drive (seated, hands forward)', kind: 'character', loop: true, params: [p('hipDrop', 'Hip drop (cm)', 0, 70, 1, 40), p('reach', 'Arm drop (°)', 0, 60, 1, 30)] },
  { id: 'hit_react', label: 'Hit reaction (procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.2, 1.5, 0.05, 0.5), p('angle', 'Flinch (°)', 5, 40, 1, 18)], events: ['hurt'] },
  { id: 'death_fall', label: 'Death fall (procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.5, 3, 0.05, 1.3), p('forward', 'Fall forward (0/1)', 0, 1, 1, 0)], events: ['hurt','dead'] },
  { id: 'aim_shoot', label: 'Aim and shoot (procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.3, 1.5, 0.05, 0.6), p('twoHanded', 'Two hands (0/1)', 0, 1, 1, 0), p('kick', 'Recoil (°)', 0, 30, 1, 12)], events: ['shoot'] },
  { id: 'reload_gesture', label: 'Reload (procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.5, 3, 0.05, 1.2)], events: ['reload'] },
  { id: 'rifle_carry', label: 'Rifle carry, two hands (procedural)', kind: 'character', loop: true, armPose: true, params: [p('height', 'Hand height (0 = hips, 1 = chest)', 0, 1, 0.05, 0.45), p('reach', 'Hand forward (m)', 0.1, 0.5, 0.01, 0.26), p('raise', 'Barrel up (°)', -20, 40, 1, 12), p('across', 'Barrel across the body (°)', 0, 45, 1, 22)] },
  { id: 'kneel_shoot', label: 'Kneel and shoot (procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.3, 1.5, 0.05, 0.6), p('twoHanded', 'Two hands (0/1)', 0, 1, 1, 0), p('kick', 'Recoil (°)', 0, 30, 1, 10)], events: ['shoot'] },
  { id: 'shoulder_fire', label: 'Shoulder fire (launcher, procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.4, 2, 0.05, 0.8), p('kneel', 'Kneel (0/1)', 0, 1, 1, 0), p('kick', 'Recoil (°)', 0, 20, 1, 6), p('raise', 'Tube up (°)', -10, 30, 1, 3)], events: ['shoot'] },
  { id: 'prone_idle', label: 'Prone (procedural)', kind: 'character', loop: true, params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 2), p('twoHanded', 'Two hands (0/1)', 0, 1, 1, 0)] },
  { id: 'crawl', label: 'Crawl (procedural)', kind: 'character', loop: true, params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 1.2), p('twoHanded', 'Two hands (0/1)', 0, 1, 1, 0)], events: ['footstep_r','footstep_l'] },
  { id: 'prone_shoot', label: 'Prone shoot (procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 0.6), p('twoHanded', 'Two hands (0/1)', 0, 1, 1, 0), p('kick', 'Recoil (°)', 0, 30, 1, 8)], events: ['shoot'] },
  { id: 'throw', label: 'Throw (grenade, procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.5, 2.5, 0.05, 1.1), p('underhand', 'Underhand (0/1)', 0, 1, 1, 0), p('hand', 'Throwing hand (0 right, 1 left)', 0, 1, 1, 0)], events: ['release'] },
  { id: 'kneel_place', label: 'Kneel and place (procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.6, 3, 0.05, 1.4), p('hand', 'Placing hand (0 left, 1 right)', 0, 1, 1, 0)], events: ['release'] },
  { id: 'walk_cycle', label: 'Walk in place (procedural stand-in)', kind: 'character', loop: true, params: [p('duration', 'Length (s)', 0.4, 3, 0.05, 1), p('stride', 'Leg swing (± °)', 5, 45, 1, 20), p('armSwing', 'Arm swing (± °)', 0, 40, 1, 12)], events: ['footstep_l','footstep_r'] },
  { id: 'hands_up', label: 'Hands up (surrender, procedural)', kind: 'character', loop: true, armPose: true, params: [p('duration', 'Length (s)', 0.5, 4, 0.05, 2), p('onHead', 'Hands on the head (0/1)', 0, 1, 1, 0)] },
  { id: 'hands_up_walk', label: 'Walk with hands up (procedural)', kind: 'character', loop: true, params: [p('duration', 'Length (s)', 0.4, 3, 0.05, 1), p('stride', 'Leg swing (± °)', 5, 45, 1, 20), p('onHead', 'Hands on the head (0/1)', 0, 1, 1, 0)], events: ['footstep_l','footstep_r'] },
  { id: 'raise_to_eyes', label: 'Raise to the eyes (binoculars, camera; procedural)', kind: 'character', loop: false, params: [p('duration', 'Length (s)', 0.6, 4, 0.05, 1.6), p('kneel', 'Kneel (0/1)', 0, 1, 1, 0), p('lower', 'Lower again at the end (0/1)', 0, 1, 1, 1)], events: ['look'] },
  { id: 'burst', label: 'Burst (debris flies out)', kind: 'fx', loop: false, params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 0.8), p('count', 'Pieces', 3, 30, 1, 12), p('spread', 'Spread (× model size)', 0.5, 12, 0.5, 3), p('up', 'Upward bias', 0, 1, 0.05, 0.5), p('gravity', 'Fall (0-1)', 0, 1, 0.05, 0.5), p('size', 'Piece size (×)', 0.1, 2, 0.05, 0.7), p('spin', 'Spin (turns/s)', 0, 6, 0.25, 2)], events: ['impact'] },
  { id: 'impact_burst', label: 'Impact (shards + shockwave)', kind: 'fx', loop: false, params: [p('duration', 'Length (s)', 0.15, 2, 0.05, 0.5), p('size', 'Spread (m)', 0.3, 8, 0.1, 2), p('count', 'Shards', 3, 24, 1, 8), p('flat', 'Shockwave ring (0/1)', 0, 1, 1, 1), p('upright', 'Ring faces the camera (1: side views) or lies on the ground (0)', 0, 1, 1, 0)], events: ['impact'] },
  { id: 'smoke_puffs', label: 'Smoke puffs (rising, one-shot)', kind: 'fx', loop: false, params: [p('duration', 'Length (s)', 0.6, 5, 0.05, 1.8), p('count', 'Puffs', 2, 16, 1, 7), p('rise', 'Rise (m)', 0, 4, 0.1, 1.4), p('spread', 'Spread (m)', 0, 3, 0.05, 0.6), p('size', 'Puff size (m)', 0.2, 4, 0.05, 0.9), p('grow', 'Grow (×)', 1, 5, 0.1, 2.4), p('hot', 'Hot start (0/1)', 0, 1, 1, 0), p('soft', 'Soft translucent puffs (1) or the pack\'s low-poly ones (0)', 0, 1, 1, 1)] },
  { id: 'smoke_loop', label: 'Smoke column (loop)', kind: 'fx', loop: true, params: [p('duration', 'Length (s)', 0.8, 6, 0.05, 2), p('count', 'Puffs', 3, 16, 1, 10), p('rise', 'Rise (m)', 0.2, 8, 0.1, 3.5), p('size', 'Puff size (m)', 0.2, 3, 0.05, 0.7), p('grow', 'Grow (×)', 1, 5, 0.1, 2.2), p('drift', 'Sideways drift (m)', 0, 2, 0.05, 0.4), p('dark', 'Darkness (0 steam – 1 black)', 0, 1, 0.05, 0.6)] },
  { id: 'fire_loop', label: 'Fire (looping flames)', kind: 'fx', loop: true, params: [p('duration', 'Length (s)', 0.3, 2, 0.05, 0.7), p('count', 'Flames', 4, 32, 1, 18), p('height', 'Height (m)', 0.2, 4, 0.05, 1.2), p('width', 'Width (m)', 0.05, 2, 0.05, 0.35), p('size', 'Flame size (m)', 0.1, 2, 0.05, 0.55), p('mesh', 'Keep the model (0/1)', 0, 1, 1, 0)] },
  { id: 'explosion', label: 'Explosion (flash, fireball, sparks)', kind: 'fx', loop: false, params: [p('duration', 'Length (s)', 0.35, 3, 0.05, 0.8), p('size', 'Size (m)', 0.5, 12, 0.1, 3), p('lobes', 'Fireball puffs', 0, 24, 1, 12), p('sparks', 'Sparks', 0, 40, 1, 14)], events: ['impact'] },
  { id: 'sparkle', label: 'Sparkle (twinkling stars, loop)', kind: 'fx', loop: true, params: [p('duration', 'Length (s)', 0.4, 4, 0.05, 1.2), p('count', 'Stars', 2, 24, 1, 9), p('radius', 'Radius (× model size)', 0.2, 4, 0.1, 1), p('size', 'Star size (× model size)', 0.1, 2, 0.05, 0.6), p('mesh', 'Keep the model (0/1; always kept when stacked on a motion like projectile)', 0, 1, 1, 0)] },
  { id: 'fireball', label: 'Fireball (glowing head, flames trailing)', kind: 'fx', loop: true, params: [p('duration', 'Length (s)', 0.2, 2, 0.05, 0.5), p('size', 'Head size (m; without the model)', 0.1, 3, 0.05, 0.5), p('trail', 'Trail length (× head size)', 0.5, 6, 0.1, 2.4), p('count', 'Flames', 6, 40, 1, 22), p('spread', 'Trail width (× head size)', 0.1, 1.5, 0.05, 0.45), p('lift', 'Flames rise (× trail)', 0, 0.6, 0.05, 0.1), p('sparks', 'Sparks', 0, 16, 1, 5), p('pulse', 'Head pulse (%)', 0, 40, 1, 12), p('flip', 'Fly the other way (0/1)', 0, 1, 1, 0), p('mesh', 'The model is the head (0/1)', 0, 1, 1, 1)] },
  { id: 'ring_shock', label: 'Shockwave ring', kind: 'fx', loop: false, params: [p('duration', 'Length (s)', 0.15, 2, 0.05, 0.45), p('size', 'Size (m)', 0.3, 12, 0.1, 3), p('upright', 'Face the camera (1: side views) or lie on the ground (0)', 0, 1, 1, 0)], events: ['impact'] },
  { id: 'still', label: 'Still (single frame)', kind: 'object', loop: true, params: [] },
  { id: 'spin', label: 'Spin', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.25, 6, 0.05, 1.5), p('turns', 'Turns per loop', 1, 8, 1, 1)] },
  { id: 'bob', label: 'Bob up and down', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.25, 6, 0.05, 1.5), p('height', 'Height (cm)', 1, 100, 1, 10)] },
  { id: 'pickup', label: 'Pickup (float + spin)', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.5, 6, 0.05, 2), p('height', 'Float height (cm)', 0, 60, 1, 12)] },
  { id: 'bounce', label: 'Bounce (with squash)', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.25, 4, 0.05, 0.8), p('height', 'Height (cm)', 5, 200, 1, 40)] },
  { id: 'pulse', label: 'Pulse (scale)', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.25, 4, 0.05, 1), p('amount', 'Grow (%)', 1, 100, 1, 15)] },
  { id: 'wobble', label: 'Wobble', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.25, 4, 0.05, 1), p('angle', 'Angle (± °)', 1, 45, 1, 8)] },
  { id: 'fall_over', label: 'Fall over', kind: 'object', loop: false, params: [p('duration', 'Length (s)', 0.3, 3, 0.05, 0.8)] },
  { id: 'hit_shake', label: 'Hit shake', kind: 'object', loop: false, params: [p('duration', 'Length (s)', 0.2, 2, 0.05, 0.5), p('amount', 'Shake (cm)', 1, 30, 1, 6)] },
  { id: 'pop_fade', label: 'Puff (pop, cool down, fade)', kind: 'object', loop: false, params: [p('duration', 'Length (s)', 0.2, 3, 0.05, 0.7), p('size', 'End size (×)', 1, 6, 0.1, 2.5), p('secondary', 'Extra puffs', 0, 4, 1, 2)], events: ['impact'] },
  { id: 'collapse', label: 'Collapse (shake, sink, dust)', kind: 'object', loop: false, params: [p('duration', 'Length (s)', 0.5, 5, 0.05, 1.4), p('shake', 'Shake (cm)', 0, 40, 1, 8), p('sink', 'Sink (% of height)', 0, 50, 1, 10), p('dust', 'Dust puffs', 0, 30, 1, 18), p('blast', 'Explosion flash (0/1)', 0, 1, 1, 0), p('fade', 'Fade out at the end (0/1)', 0, 1, 1, 1)], events: ['impact'] },
  { id: 'projectile', label: 'Projectile in flight (arrow, bolt, orb, thrown star)', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.2, 3, 0.05, 0.5), p('axis', 'Flight axis (0 auto, 1 X, 2 Y, 3 Z)', 0, 3, 1, 0), p('flip', 'Flip direction (0/1)', 0, 1, 1, 0), p('spin', 'Spin (turns/loop): along flight, or in its own plane when it faces', 0, 8, 1, 0), p('pulse', 'Pulse (%)', 0, 60, 1, 0), p('wobble', 'Wobble (± °)', 0, 20, 1, 0), p('face', 'Face (0 auto: flat models face the side, 1 side, 2 up, 3 off)', 0, 3, 1, 0), p('centre', 'Centre on the pivot (0/1)', 0, 1, 1, 1)] },
  { id: 'muzzle_flash', label: 'Muzzle flash (flicker, points along the shot)', kind: 'object', loop: false, params: [p('duration', 'Length (s)', 0.06, 1, 0.05, 0.15), p('size', 'Peak size (×)', 0.5, 4, 0.1, 1.6), p('axis', 'Flight axis (0 auto, 1 X, 2 Y, 3 Z)', 0, 3, 1, 0), p('flip', 'Flip direction (0/1)', 0, 1, 1, 0), p('seed', 'Variation', 0, 9, 1, 0)], events: ['flash'] },
  { id: 'charge', label: 'Charge up (spell / power)', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.3, 4, 0.05, 1), p('grow', 'Grow (%)', 0, 100, 1, 35)] },
  { id: 'trail', label: 'Trail / streak (stretch along flight)', kind: 'object', loop: true, params: [p('duration', 'Length (s)', 0.1, 2, 0.05, 0.3), p('axis', 'Flight axis (0 auto, 1 X, 2 Y, 3 Z)', 0, 3, 1, 0), p('flip', 'Flip direction (0/1)', 0, 1, 1, 0), p('stretch', 'Stretch (×)', 1, 6, 0.1, 2.5), p('width', 'Thickness (×)', 1, 30, 1, 1), p('length', 'Longest (m, 0 = model length × stretch)', 0, 50, 0.5, 3), p('centre', 'Centre on the pivot (0/1)', 0, 1, 1, 1)] },
];

/** What the kinds are for, in the order listings show them. */
export const TEMPLATE_KINDS: { kind: TemplateInfo['kind']; label: string }[] = [
  { kind: 'character', label: 'Characters (humanoid rigs): poses and combat stand-ins' },
  { kind: 'object', label: 'Any model as a whole: props, pickups, projectiles (still = one frame)' },
  { kind: 'part', label: 'Multi-part models: vehicles, weapons, doors, dungeon props (need the part roles)' },
  { kind: 'fx', label: 'Particle FX' },
];

/** "aim_shoot:duration=0.6,twoHanded=0,kick=12": a template with its default parameters, as -t takes it. */
export function templateUsage(t: TemplateInfo) {
  return t.params.length ? `${t.id}:${t.params.map((x) => `${x.key}=${x.default}`).join(',')}` : t.id;
}

/**
 * The locomotion clips an arm pose can lie over (FB-076), as the built-in locomotion set names them, with the
 * procedural stand-in used when no such clip is installed.
 */
export const ARM_POSE_MOVES: Record<string, { pattern: string; fallback: TemplateLayerRef | null }> = {
  walk: { pattern: '^Walk_F$', fallback: { id: 'walk_cycle', params: {} } },
  run: { pattern: '^Run_F$', fallback: { id: 'walk_cycle', params: { duration: 0.65, stride: 34 } } },
  idle: { pattern: '^Idle_Standing$', fallback: null },
};

/**
 * "hands_up_walk" (any `<arm pose>_<walk|run|idle>`, FB-076) as a set item: the installed walk/run/idle clip with the
 * arm pose laid over its arms (`overlay`), else the procedural stand-in (the template of that name when there is one,
 * like hands_up_walk, else walk_cycle's legs under the pose). Parameters of the pose go to the pose, the others to the
 * stand-in's legs. Null when `id` is no such combination.
 */
export function armPoseMove(id: string, params: Record<string, number> = {}): SetItem | null {
  const m = /^(.+)_(walk|run|idle)$/.exec(id);
  const pose = m ? TEMPLATE_CATALOG.find((t) => t.id === m[1] && t.armPose) : undefined;
  if (!m || !pose) return null;
  const move = ARM_POSE_MOVES[m[2]];
  const keys = new Set(pose.params.map((x) => x.key).filter((k) => k !== 'duration'));
  const poseParams = Object.fromEntries(Object.entries(params).filter(([k]) => keys.has(k)));
  const legParams = Object.fromEntries(Object.entries(params).filter(([k]) => !keys.has(k)));
  const fallback: TemplateLayerRef[] = TEMPLATE_CATALOG.some((t) => t.id === id)
    ? [{ id, params }]
    : [...(move.fallback ? [{ id: move.fallback.id, params: { ...move.fallback.params, ...legParams } }] : []), { id: pose.id, params: poseParams }];
  return { type: 'match', label: id, pattern: move.pattern, overlay: [{ id: pose.id, params: poseParams }], fallback };
}
