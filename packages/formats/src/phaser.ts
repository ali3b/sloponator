/**
 * The Phaser 3 animations file of the phaser3 format: `{base}_anims.json`, loaded with `anims.fromJSON`. Keys are
 * `<base>/<clip>_<dir>` by default (the base is also the multiatlas texture key), so several models share one scene.
 * `flipX` is this generator's addition (Phaser ignores it): mirrored directions reuse another direction's frames
 * and the game flips the sprite. Mirrors the PHASER_ANIMS template of @slop/sprites (profiles/profiles.ts).
 */
import { z } from 'zod';

export const phaserAnim = z.strictObject({
  key: z.string(),
  frameRate: z.number(),
  /** -1 loops, 0 plays once. */
  repeat: z.number(),
  flipX: z.boolean(),
  frames: z.array(z.strictObject({ key: z.string(), frame: z.string() })),
});
export type PhaserAnim = z.infer<typeof phaserAnim>;

export const phaserAnims = z.strictObject({ anims: z.array(phaserAnim) });
export type PhaserAnims = z.infer<typeof phaserAnims>;
