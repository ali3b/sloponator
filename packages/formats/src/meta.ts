/**
 * `ssg-meta/1`: `{base}.meta.json`, written next to every sheet whatever the engine format. Gameplay metadata the
 * format's own files have no place for: clip events, per-frame sockets and body boxes in frame pixels, the pivot,
 * the blend mode, the scale record, and for objects their footprint and collision. Mirrors metaData() of
 * @slop/sprites (manifest/meta.ts), plus the `split` and `turret` blocks the exporter spreads in.
 */
import { z } from 'zod';
import { assetRef, blendMode, bodyBoxes, clipInfo, generatorInfo, pixelPoint, scaleRecord, sockets } from './common.js';
import { objectInfo } from './object.js';
import { ssgSplit } from './split.js';
import { ssgTurret } from './turret.js';

/** One animation (clip × direction): its sockets and boxes per frame, in that direction as drawn. */
export const metaAnimation = z.object({
  name: z.string(),
  clip: z.string(),
  direction: z.string(),
  /** True when this direction reuses another direction's frames flipped horizontally (mirror the pixels and the sockets). */
  flipX: z.boolean(),
  /** Per frame: attachment points in pixels from the untrimmed frame's top-left. */
  sockets: z.array(sockets),
  /** Characters: head, torso and legs boxes per frame. */
  boxes: z.array(bodyBoxes).optional(),
});
export type MetaAnimation = z.infer<typeof metaAnimation>;

export const ssgMeta = z.strictObject({
  schema: z.literal('ssg-meta/1'),
  generator: generatorInfo,
  asset: assetRef,
  blend: blendMode,
  frameWidth: z.number(),
  frameHeight: z.number(),
  fps: z.number(),
  /** The frame pivot in pixels (untrimmed frame, from its top-left): the feet, or an object's anchor. */
  pivot: pixelPoint,
  /** "anchor" (objects): each direction pivots on its own anchor, see `object.directions`. Absent: the model origin. */
  pivotSource: z.literal('anchor').optional(),
  pixelsPerMetre: z.number().nullable(),
  scale: scaleRecord,
  note: z.string(),
  clips: z.array(clipInfo),
  /** Present when any frame has sockets or boxes. */
  animations: z.array(metaAnimation).optional(),
  /** Objects and props: footprint, height, anchor and ground collision polygon. */
  object: objectInfo.optional(),
  /** A waist-split character's sheet: which half this is and where the other is. */
  split: ssgSplit.optional(),
  /** A vehicle hull with a separately rendered turret. */
  turret: ssgTurret.optional(),
});
export type SsgMeta = z.infer<typeof ssgMeta>;
