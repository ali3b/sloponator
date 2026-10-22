/**
 * `ssg-turret/1`: the `turret` block in a vehicle hull's data files when the hull and the turret were rendered as
 * two sheets, the turret with its own directions. Mirrors TurretBlock of @slop/sprites (manifest/turret.ts).
 */
import { z } from 'zod';
import { pixelPoint } from './common.js';

/** Where the turret goes on the hull in one hull direction (pixels, untrimmed hull frame). */
export const turretMount = z.object({
  name: z.string(),
  worldAngle: z.number(),
  mirrorOf: z.string().nullable(),
  /** The turret's pivot (its axis at its base) in the hull's frame, from the top-left. */
  pivot: pixelPoint,
  /** The same point relative to the hull frame's pivot for this direction: draw the turret's pivot here. */
  offset: pixelPoint,
});
export type TurretMount = z.infer<typeof turretMount>;

export const ssgTurret = z.strictObject({
  schema: z.literal('ssg-turret/1'),
  /** The turret sheet's base name (its files are `{base}_0.png`, `{base}.json`/`.meta.json`…). */
  base: z.string(),
  files: z.array(z.string()),
  /** Model parts drawn on the turret sheet (left out of the hull's). */
  parts: z.array(z.string()),
  /** Where the turret turns, metres in the model's axes (y = the turret's base). */
  axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  pixelsPerMetre: z.number().nullable(),
  /** The turret sheet's directions (the game picks one by aim, independently of the hull's). */
  directions: z.array(z.object({ name: z.string(), worldAngle: z.number(), screenAngle: z.number(), mirrorOf: z.string().nullable() })),
  /** The turret sheet's clips: `turret` (still), `turret_fire`… */
  clips: z.array(z.string()),
  /** Per hull direction: where the turret's pivot goes. */
  mounts: z.array(turretMount),
  /** The turret is always drawn over the hull. */
  draw: z.literal('above'),
  note: z.string(),
});
export type SsgTurret = z.infer<typeof ssgTurret>;
