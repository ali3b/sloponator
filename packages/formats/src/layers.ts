/**
 * `ssg-layers/1`: `{base}.layers.json` of a layered export, where the body and each attached item (weapon, shield,
 * helmet, hair, cape, effect) are separate sheets sharing one frame size, pivot, trim and timing. The manifest
 * says, for every frame, whether each part is in front of or behind the body and where it is attached; an engine
 * draws the same frame index of every sheet in depth order. Mirrors LayersManifest of @slop/sprites
 * (manifest/layers.ts).
 */
import { z } from 'zod';
import { assetRef, blendMode, clipEvent, generatorInfo, pixelPoint, scaleRecord } from './common.js';
import { objectInfo } from './object.js';
import { framing, layoutSettings, viewConfig } from './view.js';

export const partSlot = z.enum(['weapon', 'offhand', 'head', 'hair', 'back', 'body', 'accessory', 'fx']);
export type PartSlot = z.infer<typeof partSlot>;

/** Where a part draws relative to the body: measured per frame ('auto'), forced, or forced per direction name. */
export const depthRule = z.union([z.enum(['auto', 'front', 'back']), z.record(z.string(), z.enum(['front', 'back']))]);
export type DepthRule = z.infer<typeof depthRule>;

export const layerPartInfo = z.object({
  name: z.string(),
  slot: partSlot,
  kind: z.string(),
  asset: z.string(),
  /** Bone (or part) the item is mounted on, '' for the root. */
  bone: z.string(),
  blend: blendMode,
  depth: depthRule,
  /** Weapon class: this sheet only has frames for that class's clips (others are transparent). */
  cls: z.string().optional(),
  /** Sheet base name ({base}_{name}): its images and the format's files for it. */
  base: z.string(),
  pages: z.array(z.string()),
  files: z.array(z.string()),
  /** The loadout item the part was rendered from (tells outfits which part an item is). */
  item: z.object({ asset: z.number(), layer: z.string().optional(), cls: z.string().optional() }).optional(),
});
export type LayerPartInfo = z.infer<typeof layerPartInfo>;

/** A named outfit: which parts to show (the rest are hidden). */
export const outfitPreset = z.object({ id: z.string(), name: z.string(), parts: z.array(z.string()) });
export type OutfitPreset = z.infer<typeof outfitPreset>;

/** Everything a later render needs to line up with this export frame for frame. */
export const layerAlignment = z.object({
  /** Part names already in the export (new items aligned to it get names that do not clash). */
  parts: z.array(z.string()).optional(),
  view: viewConfig,
  framing,
  layout: layoutSettings,
  /** Sample times per clip, so later renders hit the very same poses. */
  clips: z.array(z.object({ name: z.string(), loop: z.boolean(), times: z.array(z.number()) })),
  /** Pages every sheet has (they share one layout): new clips are added on pages after these. */
  pages: z.number().optional(),
  /** Hash of everything above: two exports with the same signature line up frame for frame. */
  signature: z.string(),
});
export type LayerAlignment = z.infer<typeof layerAlignment>;

export const layerFrame = z.object({
  /** Metres along the view axis relative to the body's hips, per part (+ = in front of the body). */
  z: z.record(z.string(), z.number()),
  front: z.record(z.string(), z.boolean()),
  /** The part's attachment point in untrimmed-frame pixels (mirrored directions: x' = frameWidth - x). */
  offset: z.record(z.string(), pixelPoint),
});
export type LayerFrame = z.infer<typeof layerFrame>;

export const validationIssue = z.object({
  level: z.enum(['error', 'warn']),
  code: z.enum([
    'missing_frames', 'frame_count', 'rect_mismatch', 'pivot_mismatch', 'size_mismatch', 'timing_mismatch', 'direction_mismatch', 'page_size', 'pivot_outside',
    'bleeding', 'alignment_mismatch', 'frame_overflow', 'style_without_weapon', 'full_rerender', 'slice_skipped', 'state_clip_skipped', 'state_clip_fallback', 'state_loop_skipped',
  ]),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssue>;

/** A loadout item as the manifest's `source` records it (the generator's own recipe; a game needs none of it). */
export const sourceLoadoutItem = z.object({ asset: z.number(), layer: z.string().optional(), cls: z.string().optional() });
/** The animation set the export was made from: items are the generator's own set entries (anim, template or match). */
export const sourceAnimationSet = z.object({ id: z.string(), name: z.string(), items: z.array(z.record(z.string(), z.unknown())) });

export const ssgLayers = z.strictObject({
  schema: z.literal('ssg-layers/1'),
  generator: generatorInfo,
  asset: assetRef,
  base: z.string(),
  /** 'mask': pixels hidden by the body were cut away, so sheets compose in any order over the body. */
  occlusion: z.enum(['mask', 'none']),
  frameWidth: z.number(),
  frameHeight: z.number(),
  fps: z.number(),
  pivot: pixelPoint,
  pivotSource: z.literal('anchor').optional(),
  pixelsPerMetre: z.number().nullable(),
  scale: scaleRecord,
  object: objectInfo.optional(),
  alignment: layerAlignment,
  body: z.object({ base: z.string(), pages: z.array(z.string()), files: z.array(z.string()) }),
  parts: z.array(layerPartInfo),
  clips: z.array(z.object({ name: z.string(), loop: z.boolean(), frameCount: z.number(), events: z.array(clipEvent), cls: z.string().optional() })),
  /** Weapon classes in this export (clips are named `<class>_<clip>`); the body sheet holds all of them. */
  classes: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  directions: z.array(z.object({ name: z.string(), screenAngle: z.number(), mirrorOf: z.string().nullable() })),
  /** Same order and frame counts as every sheet's `animations`. `front` says where to draw each part; `z` is the measured depth. */
  animations: z.array(z.object({
    name: z.string(),
    clip: z.string(),
    direction: z.string(),
    flipX: z.boolean(),
    pivot: pixelPoint.optional(),
    frames: z.array(layerFrame),
  })),
  validation: z.array(validationIssue),
  /** What produced this export (so a later render can add layers or clips with the same inputs). */
  source: z.object({
    set: sourceAnimationSet,
    gender: z.enum(['auto', 'Masculine', 'Feminine']),
    loadout: z.array(sourceLoadoutItem),
    /** Export format id (godot4, generic…). */
    profile: z.string().optional(),
  }).optional(),
  /** Named outfits: which parts each one shows. Optional; a game that ignores it can show any parts it likes. */
  outfits: z.array(outfitPreset).optional(),
  note: z.string(),
});
export type SsgLayers = z.infer<typeof ssgLayers>;
