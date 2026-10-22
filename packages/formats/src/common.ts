/**
 * Pieces shared by every output file: pixel points and boxes, the scale record, clip events, body boxes.
 * Mirrors the types in @slop/sprites (manifest/context.ts, events/bodyBoxes.ts); a sprites test keeps them in step.
 */
import { z } from 'zod';

/** A ground point in metres `[x, z]` (model axes), or a frame pixel `[x, y]` where the field says so. */
export const vec2 = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof vec2>;

/** A pixel position in the untrimmed frame, from its top-left. */
export const pixelPoint = z.object({ x: z.number(), y: z.number() });
export type PixelPoint = z.infer<typeof pixelPoint>;

/** A pixel rectangle in the untrimmed frame. */
export const pixelBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type PixelBox = z.infer<typeof pixelBox>;

/** What wrote the file. */
export const generatorInfo = z.object({ name: z.string(), version: z.string(), generatedAt: z.string() });
export type GeneratorInfo = z.infer<typeof generatorInfo>;

/** The Synty asset the sprite was rendered from. */
export const assetRef = z.object({
  name: z.string(),
  pack: z.string(),
  /** character, prop, vehicle, multipart, weapon, attachment, fx, turret… */
  kind: z.string(),
  /** Objects: the library's category guess (building, vegetation…), null when none. */
  category: z.string().nullable().optional(),
});
export type AssetRef = z.infer<typeof assetRef>;

/** How engines should draw the sheet: 'add' for glowing FX (fireballs, flashes), else 'normal'. */
export const blendMode = z.enum(['normal', 'add']);
export type BlendMode = z.infer<typeof blendMode>;

/** Tile shapes: square tiles along the screen axes, or 2:1 diamond (isometric) tiles along the diagonals. */
export const tileShape = z.enum(['square', 'diamond']);
export type TileShape = z.infer<typeof tileShape>;

/**
 * The scale an export was rendered at, written into every data file so a game can check that all its sprites share
 * one grid. `fit` scales each model into its frame (pixelsPerMetre is then null); `ppm` and `tile` lock it.
 */
export const scaleRecord = z.object({
  mode: z.enum(['fit', 'ppm', 'tile']),
  /** Screen pixels per metre on the ground (null in fit mode and in perspective views). */
  pixelsPerMetre: z.number().nullable(),
  /** Tile lock only: the tile's width and height in pixels (a 2:1 diamond is tilePx × tilePx/2). */
  tilePx: z.number().optional(),
  tileHeightPx: z.number().optional(),
  /** Tile lock only: metres one tile covers on the ground, and the tile shape. */
  metresPerTile: z.number().optional(),
  shape: tileShape.optional(),
  /** The model was drawn this many times its real size (a 1.3× boss) at the world's pixels per metre. Absent = 1. */
  modelScale: z.number().optional(),
});
export type ScaleRecord = z.infer<typeof scaleRecord>;

/** The limb a `hit` event strikes with. */
export const strikeLimb = z.enum(['hand_l', 'hand_r', 'foot_l', 'foot_r', 'knee_l', 'knee_r', 'elbow_l', 'elbow_r', 'head']);
export type StrikeLimb = z.infer<typeof strikeLimb>;

/** A clip event: release, hit (with its limb and last active frame), hit_end, cast, shoot, footstep_l/r… */
export const clipEvent = z.object({
  frame: z.number(),
  name: z.string(),
  /** `hit` only: the striking hand, foot, knee, elbow or head. */
  limb: strikeLimb.optional(),
  /** `hit` only: the last active frame of the strike (inclusive), the frame of its `hit_end` event. */
  endFrame: z.number().optional(),
});
export type ClipEvent = z.infer<typeof clipEvent>;

/** Characters: head, torso and legs boxes in frame pixels (mirrored directions: x' = frameWidth - x - w). */
export const bodyBoxes = z.object({ head: pixelBox.optional(), torso: pixelBox.optional(), legs: pixelBox.optional() });
export type BodyBoxes = z.infer<typeof bodyBoxes>;

/** Attachment points (hand_r, head, muzzle, weapon_tip…) in pixels from the untrimmed frame's top-left. */
export const sockets = z.record(z.string(), pixelPoint);
export type Sockets = z.infer<typeof sockets>;

/** One clip of an export as the data files list it. */
export const clipInfo = z.object({
  name: z.string(),
  loop: z.boolean(),
  /** Frames rendered per direction. */
  frameCount: z.number(),
  events: z.array(clipEvent),
  /** Ground speed of the original motion (m/s), when known: play walk/run cycles at speed / speedMps. */
  speedMps: z.number().optional(),
});
export type ClipInfo = z.infer<typeof clipInfo>;
