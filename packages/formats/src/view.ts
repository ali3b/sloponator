/**
 * The view an export was rendered with, as the generic sheet JSON and the layers manifest's alignment carry it.
 * Mirrors ViewConfig, Framing and LayoutSettings of @slop/sprites (view/camera.ts, layout/layout.ts) field for
 * field; a sprites test checks the two agree both ways.
 */
import { z } from 'zod';
import { tileShape } from './common.js';

export const projection = z.enum(['ortho', 'persp']);
/** Direction sets. 4d = the four diagonals (iso games moving along tile edges); 6f/6p = hex flat-/pointy-top. */
export const directionSetId = z.enum(['1', '2', '4', '4d', '6f', '6p', '8', '12', '16', '32']);
export const directionBasis = z.enum(['world', 'screen']);
export const directionOrder = z.enum(['ccw-e', 'cw-n', 'cw-s', 'ccw-n', 'rpgmaker']);
export const directionNaming = z.enum(['compass', 'words', 'degrees']);
export const collisionMode = z.enum(['auto', 'base', 'full', 'concave']);
export type CollisionMode = z.infer<typeof collisionMode>;

export const scaleConfig = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fit') }),
  z.object({ mode: z.literal('ppm'), ppm: z.number() }),
  z.object({ mode: z.literal('tile'), tilePx: z.number(), metresPerTile: z.number(), shape: tileShape }),
]);
export type ScaleConfig = z.infer<typeof scaleConfig>;

/** Post-render stylization (outline, grading, texture overlay, cel bands). */
export const styleConfig = z.object({
  outline: z.object({ width: z.union([z.literal(0), z.literal(1), z.literal(2)]), color: z.string(), soft: z.boolean().optional() }).optional(),
  grade: z.object({ brightness: z.number().optional(), contrast: z.number().optional(), saturation: z.number().optional(), hue: z.number().optional(), posterize: z.number().optional() }).optional(),
  overlay: z.object({ texture: z.enum(['none', 'paper', 'canvas', 'noise']), opacity: z.number(), blend: z.enum(['multiply', 'overlay']) }).optional(),
  toon: z.object({ steps: z.number() }).optional(),
});
export type StyleConfig = z.infer<typeof styleConfig>;

export const qualityConfig = z.object({
  supersample: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  textureFilter: z.enum(['nearest', 'linear']),
  shadow: z.enum(['off', 'low', 'high']),
  style: z.enum(['clean', 'pixel']).optional(),
  palette: z.enum(['full', 'model', 'levels']).optional(),
  shadeSteps: z.number().optional(),
  colorLevels: z.number().optional(),
  outline: z.boolean().optional(),
  outlineColor: z.string().optional(),
  alphaThreshold: z.union([z.number(), z.literal('soft')]).optional(),
  stylize: styleConfig.optional(),
});
export type QualityConfig = z.infer<typeof qualityConfig>;

export const objectFacings = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]);

export const viewConfig = z.object({
  projection,
  /** Camera elevation above the ground plane in degrees (0 = side view, 90 = straight down). */
  pitch: z.number(),
  fov: z.number(),
  directions: directionSetId,
  /** Chosen directions instead of the whole set: compass degrees (0 = E, 90 = N). */
  angles: z.array(z.number()).optional(),
  basis: directionBasis,
  mirror: z.boolean(),
  order: directionOrder,
  naming: directionNaming,
  scale: scaleConfig,
  frameWidth: z.number(),
  frameHeight: z.number(),
  fps: z.number(),
  padding: z.number(),
  pivotBottom: z.number().nullable().optional(),
  quality: qualityConfig.optional(),
  stylizeByKind: z.object({ body: styleConfig.optional(), equipment: styleConfig.optional(), fx: styleConfig.optional() }).optional(),
  facings: objectFacings.optional(),
  slice: z.literal('columns').optional(),
  collisionHeight: z.number().optional(),
  collision: collisionMode.optional(),
});
export type ViewConfig = z.infer<typeof viewConfig>;

/** The framing every frame was rendered with: ortho extents, camera-space centre, frame size, pivot, pixels per metre. */
export const framing = z.object({
  viewHalfW: z.number(),
  viewHalfH: z.number(),
  centreY: z.number(),
  centreX: z.number().optional(),
  frameWidth: z.number(),
  frameHeight: z.number(),
  pivot: z.object({ x: z.number(), y: z.number() }),
  ppm: z.number().nullable(),
});
export type Framing = z.infer<typeof framing>;

export const layoutMode = z.enum(['grid', 'strips', 'atlas']);
export const layoutSettings = z.object({
  mode: layoutMode,
  grouping: z.enum(['single', 'per-clip']),
  trim: z.boolean(),
  padding: z.number(),
  extrude: z.number(),
  powerOfTwo: z.boolean(),
  maxSize: z.number(),
});
export type LayoutSettings = z.infer<typeof layoutSettings>;

/** A direction as the data files list it (the generic sheet adds `worldAngle`). */
export const directionRef = z.object({ name: z.string(), screenAngle: z.number(), worldAngle: z.number(), mirrorOf: z.string().nullable() });
export type DirectionRef = z.infer<typeof directionRef>;
