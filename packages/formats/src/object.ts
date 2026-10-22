/**
 * Object data: the `object` block of a prop's, vehicle's or building's data files (footprint, height, anchor,
 * ground collision polygon, grid facings, per-tile-column slices, object states and transitions).
 * Mirrors ObjectInfo and friends of @slop/sprites (object/footprint.ts, object/slices.ts).
 */
import { z } from 'zod';
import { pixelPoint, tileShape, vec2 } from './common.js';

/** Where a collision polygon came from: the hull, the bounds, the ground slice's hull, its concave outline, or nothing. */
export const collisionSource = z.enum(['hull', 'bounds', 'base', 'concave', 'none']);
export type CollisionSource = z.infer<typeof collisionSource>;
/** Why the collision is what it is (see @slop/sprites collisionRule). */
export const collisionRule = z.enum(['asked', 'height', 'vehicle', 'building', 'thin', 'shape']);
export type CollisionRule = z.infer<typeof collisionRule>;
/** The grid axis a facing points along ('+u' = down-right on a diamond grid). */
export const facingAxis = z.enum(['+u', '+v', '-u', '-v']);
export type FacingAxis = z.infer<typeof facingAxis>;

/** Model-axes footprint in metres: w along x, d along z, and its bounds around the model origin. */
export const objectFootprint = z.object({ w: z.number(), d: z.number(), minX: z.number(), maxX: z.number(), minZ: z.number(), maxZ: z.number() });
/** Footprint in whole tiles (ceil) and exact, model axes lined up with the grid. Null without a tile scale. */
export const objectTiles = z.object({ w: z.number(), d: z.number(), wExact: z.number(), dExact: z.number(), tilePx: z.number(), metresPerTile: z.number(), shape: tileShape }).nullable();
/** Ground collision polygon in metres, model axes, counter-clockwise in (x, z). */
export const objectCollision = z.object({ source: collisionSource, points: z.array(vec2), cut: z.number().optional(), rule: collisionRule.optional() });
export const objectCanopy = z.object({ source: z.enum(['hull', 'bounds']), points: z.array(vec2) });

export const objectDirection = z.object({
  name: z.string(),
  worldAngle: z.number(),
  /** This direction shows another one flipped horizontally (its pixels are already flipped here). */
  mirrorOf: z.string().nullable(),
  /** Pixel in the untrimmed frame (from its top-left) where the footprint's ground centre is drawn. */
  anchor: pixelPoint,
  /** The ground collision polygon in frame pixels (same points and order as `collision.points`). */
  polygon: z.array(vec2),
  /** With a `base` collision: the whole model's hull (`canopy.points`) in frame pixels. */
  canopyPolygon: z.array(vec2).optional(),
  /** With a tile scale: the footprint along the grid's u and v axes, and the polygon in tiles around the anchor. */
  tiles: z.object({ u: z.number(), v: z.number(), uExact: z.number(), vExact: z.number(), polygon: z.array(vec2) }).optional(),
  /** The grid axis the model's front (+Z) points along, or null when not grid-aligned. */
  facing: facingAxis.nullable().optional(),
});
export type ObjectDirection = z.infer<typeof objectDirection>;

/** One per-tile-column strip of a frame (objects on a diamond tile lock, for depth sorting). */
export const objectSlice = z.object({
  index: z.number(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  tile: z.object({ u: z.number(), v: z.number() }),
  edge: z.tuple([vec2, vec2]),
  ground: pixelPoint,
  sortY: z.number(),
});
export type ObjectSlice = z.infer<typeof objectSlice>;

export const objectSlices = z.object({
  mode: z.literal('columns'),
  stripPx: z.number(),
  tilePx: z.number(),
  tileHeightPx: z.number(),
  directions: z.array(z.object({ name: z.string(), strips: z.array(objectSlice) })),
  note: z.string(),
});
export type ObjectSlices = z.infer<typeof objectSlices>;

/** One state of an object export: its animation, model, and its own footprint and collision. */
export const objectStateInfo = z.object({
  name: z.string(),
  animation: z.string(),
  asset: z.string(),
  look: z.string().optional(),
  loop: z.string().optional(),
  footprint: objectFootprint,
  height: z.number(),
  bottom: z.number(),
  centre: z.object({ x: z.number(), z: z.number() }),
  tiles: objectTiles,
  collision: objectCollision,
  sameAsBase: z.boolean(),
  directions: z.array(z.object({ name: z.string(), polygon: z.array(vec2), tiles: z.object({ u: z.number(), v: z.number(), polygon: z.array(vec2) }).optional() })),
});
export type ObjectStateInfo = z.infer<typeof objectStateInfo>;

export const objectTransitionInfo = z.object({ animation: z.string(), from: z.string(), to: z.string(), asset: z.string() });
export type ObjectTransitionInfo = z.infer<typeof objectTransitionInfo>;

export const objectInfo = z.object({
  footprint: objectFootprint,
  /** Top of the model above the ground plane (y = 0 at the model origin), metres. */
  height: z.number(),
  /** Lowest point (0 for a model standing on its origin; negative when it reaches below the ground). */
  bottom: z.number(),
  /** Ground centre of the footprint relative to the model origin, metres (model axes). The anchor is drawn here. */
  centre: z.object({ x: z.number(), z: z.number() }),
  tiles: objectTiles,
  collision: objectCollision,
  canopy: objectCanopy.optional(),
  pixelsPerMetre: z.number().nullable(),
  /** The first direction's anchor; per direction in `directions`. */
  anchor: pixelPoint.nullable(),
  directions: z.array(objectDirection),
  slices: objectSlices.optional(),
  note: z.string(),
  states: z.array(objectStateInfo).optional(),
  transitions: z.array(objectTransitionInfo).optional(),
});
export type ObjectInfo = z.infer<typeof objectInfo>;
