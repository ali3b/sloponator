/**
 * The generic sheet JSON: `{base}.json` of the generic (and GameMaker) format, `{base}.sheet.json` next to every
 * other format's files. Every page, rectangle, timing, socket and box of the export, self-describing, so any
 * engine can read it and the export can be opened again. Mirrors genericData() of @slop/sprites (manifest/meta.ts).
 */
import { z } from 'zod';
import { assetRef, blendMode, bodyBoxes, clipInfo, generatorInfo, pixelPoint, scaleRecord, sockets } from './common.js';
import { objectInfo } from './object.js';
import { ssgSplit } from './split.js';
import { ssgTurret } from './turret.js';
import { directionRef, viewConfig } from './view.js';

export const sheetPage = z.object({
  index: z.number(),
  file: z.string(),
  width: z.number(),
  height: z.number(),
  /** Clip this page belongs to when grouping per clip, otherwise null. */
  clip: z.string().nullable(),
  /** Direction for strip pages. */
  direction: z.string().nullable(),
  /** Extra images aligned with the page (normal, depth, uv, shadow) -> file name. */
  layers: z.record(z.string(), z.string()),
});
export type SheetPage = z.infer<typeof sheetPage>;

export const sheetFrame = z.object({
  page: z.number(),
  /** Rectangle on the page (y measured from the top). */
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  /** Offset of the rectangle inside the untrimmed frame. */
  trimX: z.number(),
  trimY: z.number(),
  sourceW: z.number(),
  sourceH: z.number(),
  durationMs: z.number(),
  sockets: sockets.optional(),
  boxes: bodyBoxes.optional(),
});
export type SheetFrame = z.infer<typeof sheetFrame>;

export const sheetAnimation = z.object({
  name: z.string(),
  clip: z.string(),
  direction: z.string(),
  loop: z.boolean(),
  fps: z.number(),
  flipX: z.boolean(),
  /** Objects (pivotSource "anchor"): this direction's own pivot. */
  pivot: pixelPoint.optional(),
  frames: z.array(sheetFrame),
});
export type SheetAnimation = z.infer<typeof sheetAnimation>;

export const ssgSheet = z.strictObject({
  generator: generatorInfo,
  asset: assetRef,
  frameWidth: z.number(),
  frameHeight: z.number(),
  fps: z.number(),
  pivot: pixelPoint,
  pivotSource: z.literal('anchor').optional(),
  pixelsPerMetre: z.number().nullable(),
  scale: scaleRecord,
  blend: blendMode,
  object: objectInfo.optional(),
  view: viewConfig,
  pages: z.array(sheetPage),
  /** Extra layers exported with every page. */
  layers: z.array(z.string()),
  clips: z.array(clipInfo),
  directions: z.array(directionRef),
  animations: z.array(sheetAnimation),
  split: ssgSplit.optional(),
  turret: ssgTurret.optional(),
});
export type SsgSheet = z.infer<typeof ssgSheet>;
