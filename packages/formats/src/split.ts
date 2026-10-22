/**
 * `ssg-split/1`: the `split` block in each sheet's data files (meta.json, the generic json and .sheet.json) of a
 * character rendered as a legs sheet and a torso sheet with a per-frame `waist` socket in both, so a game aims
 * the torso apart from the walk. Mirrors SplitBlock of @slop/sprites (manifest/split.ts).
 */
import { z } from 'zod';

export const splitSheet = z.enum(['legs', 'torso']);
export type SplitSheet = z.infer<typeof splitSheet>;

const sheetRef = z.object({ base: z.string(), files: z.array(z.string()), clips: z.array(z.string()) });

export const ssgSplit = z.strictObject({
  schema: z.literal('ssg-split/1'),
  at: z.literal('waist'),
  /** Which sheet this file belongs to (`whole`: the whole-body sheet of a split with `whole`). */
  sheet: z.enum(['legs', 'torso', 'whole']),
  /** Socket name of the per-frame waist pivot (in both sheets). */
  pivot: z.literal('waist'),
  /** Skeleton joints the cut was made at: the hips bone (legs side) and the first spine bone (torso side). */
  bones: z.object({ hips: z.string(), spine: z.string() }),
  legs: sheetRef,
  torso: sheetRef,
  /** The whole-body sheet made from the same job and framing (a split with `whole`). */
  whole: sheetRef.extend({ note: z.string() }).optional(),
  /** Draw order: the legs, then the torso over them. */
  draw: z.array(splitSheet),
  note: z.string(),
});
export type SsgSplit = z.infer<typeof ssgSplit>;
