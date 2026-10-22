import type { SecondaryMotion } from '@slop/sprites';

/**
 * Secondary motion for rigid attachments (hair, capes, pouches): a damped spring that lags behind the bone it
 * hangs from. Pure maths here (tested); the renderer feeds it bone positions per sample and turns the lag into
 * a rotation of the holder. Deterministic for the same sequence of times.
 */
export interface SpringState {
  /** Lag (world-space, metres-ish) along x and z, and the vertical bob. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  lastT: number | null;
  lastPos: [number, number, number] | null;
  lastVel: [number, number, number] | null;
}

export const newSpring = (): SpringState => ({ x: 0, z: 0, vx: 0, vz: 0, lastT: null, lastPos: null, lastVel: null });

/**
 * Advance the spring to time `t` given the bone's world position. Returns the lag in radians (x, z) to rotate
 * the item by. `loopDuration` keeps the motion continuous when the clip wraps (t < lastT).
 */
export function stepSpring(s: SpringState, t: number, pos: [number, number, number], cfg: SecondaryMotion, loopDuration = 0): [number, number] {
  if (s.lastT === null || s.lastPos === null) {
    s.lastT = t;
    s.lastPos = pos;
    s.lastVel = [0, 0, 0];
    return [0, 0];
  }
  let dt = t - s.lastT;
  if (dt < 0) dt = loopDuration > 0 ? Math.max(1e-3, loopDuration - s.lastT + t) : 1e-3;
  if (dt < 1e-6) return [s.x, s.z];
  dt = Math.min(dt, 0.1);
  const vel: [number, number, number] = [(pos[0] - s.lastPos[0]) / dt, (pos[1] - s.lastPos[1]) / dt, (pos[2] - s.lastPos[2]) / dt];
  const lv = s.lastVel ?? vel;
  const ax = (vel[0] - lv[0]) / dt, ay = (vel[1] - lv[1]) / dt, az = (vel[2] - lv[2]) / dt;
  // The item is thrown opposite to the bone's acceleration, and sags with gravity when the bone rises fast.
  const k = cfg.stiffness, c = 2 * Math.sqrt(k) * cfg.damping, g = cfg.gravity;
  const fx = -ax * 0.03 * g - k * s.x - c * s.vx;
  const fz = (-az * 0.03 - ay * 0.015) * g - k * s.z - c * s.vz;
  s.vx += fx * dt;
  s.vz += fz * dt;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const lim = (cfg.limit * Math.PI) / 180;
  const mag = Math.hypot(s.x, s.z);
  if (mag > lim) {
    s.x *= lim / mag;
    s.z *= lim / mag;
    s.vx *= 0.5;
    s.vz *= 0.5;
  }
  s.lastT = t;
  s.lastPos = pos;
  s.lastVel = vel;
  return [s.x, s.z];
}
