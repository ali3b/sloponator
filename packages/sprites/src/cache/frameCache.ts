// Moved from synty-sprite-generator packages/shared/src/export/frameCache.ts (P2, ali3b/sloponator#8).
import type { ViewConfig, Framing } from '../view/camera.js';
import { canonicalJson, sha256 } from '../hash.js';
import type { BodyBoxes } from '../events/bodyBoxes.js';
import type { ClipEvent } from '../manifest/context.js';

/**
 * FB-121: rendered frames cached per clip × direction, so adding one move to a sprite renders that move only (its
 * other clips' frames come from the cache and the sheet is packed again). An entry's key hashes everything that
 * decides its pixels and per-frame data; anything not covered must not change a frame, so when in doubt it goes in.
 */

/** Bump when the entry format or what a frame holds changes: every older entry stops matching. */
export const FRAME_CACHE_VERSION = 1;

export interface FrameUnitKeyInput {
  /** FRAME_CACHE_VERSION and the RENDERER_VERSION (a generator fix invalidates every frame). */
  version: { cache: number; renderer: number };
  /**
   * The model as the runner prepared it: the asset record (file, variant, scale fix, rig), the batch's gender,
   * loadout, FX look and lighting, and a fingerprint of the prepared scene (mounted items, grips, placement fixes,
   * materials and tints) — whatever the caller knows decides the look of the model before any clip plays.
   */
  model: unknown;
  /** The effective view: camera (pitch, projection, directions), scale, frame size, fps, quality and style. */
  view: ViewConfig;
  /** Framing every frame is rendered with (frame size, ortho extents, pivot, pixels per metre). */
  framing: Framing;
  /** How the frames are rendered: extra layers, blend, the layered passes (each part sheet), sockets tracked. */
  render: {
    layers: string[];
    blend: 'normal' | 'add';
    layered: { occlusion: string; parts: unknown[] } | null;
    partsOnly: boolean;
    sockets: string[];
    bodyBoxes: boolean;
  };
  /** The clip: its sampled times, the keyframe data after trim/speed/reverse/cap and template params, its events. */
  clip: {
    name: string;
    loop: boolean;
    times: number[];
    /** Hash of the clip's keyframe tracks (names, times, values, interpolation). */
    data: string;
    /** The set item it came from (template ids and params, the sprite's own window) and similar recipe data. */
    source: unknown;
    cls: string | null;
    perClip: boolean;
    release: string | null;
    ownGrip: boolean | 'two_hand' | null;
    state: unknown;
    /** Resolved events (they start triggered attachments, rocket shots and releases mid-clip). */
    events: ClipEvent[];
    /** The clip's own grips of held items (a weapon held its own way in a procedural pose), per holder. */
    grips: (number[] | null)[];
  };
  direction: { name: string; worldAngle: number };
}

/** The cache key of one clip × direction (hex SHA-256 of the canonical input). */
export function frameUnitKey(input: FrameUnitKeyInput): string {
  return sha256(canonicalJson(input));
}

/**
 * A short hash per input group (model, view, framing, render, clip, direction, version), kept in the entry's meta:
 * comparing two entries of one clip × direction shows which input made a render miss the cache.
 */
export function frameUnitDigests(input: FrameUnitKeyInput): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, sha256(canonicalJson(v)).slice(0, 12)]));
}

/** Per-frame data kept with the pixels (what the measuring pass would have found). */
export interface CachedFrame {
  opaque: { x: number; y: number; w: number; h: number } | null;
  sockets?: Record<string, { x: number; y: number }>;
  boxes?: BodyBoxes;
  z?: Record<string, number>;
  offset?: Record<string, { x: number; y: number }>;
}

/**
 * meta.json of an entry. Its strips are PNGs named `<sheet>.png` (colour) and `<sheet>.<layer>.png`, frames laid
 * out left to right, top to bottom in `cols` columns of width × height cells.
 */
export interface FrameUnitMeta {
  v: number;
  key: string;
  width: number;
  height: number;
  cols: number;
  frames: CachedFrame[];
  strips: string[];
  /** frameUnitDigests of the key's inputs (diagnostics). */
  inputs?: Record<string, string>;
}

/** Columns of a strip of `n` frames `w` px wide (kept well under browser canvas limits). */
export function stripColumns(n: number, w: number): number {
  return Math.max(1, Math.min(n, Math.floor(8192 / Math.max(1, w))));
}

/** A strip file's name: the sheet's colour frames, or one of its extra layers. */
export const stripName = (sheet: string, layer?: string) => (layer ? `${sheet}.${layer}.png` : `${sheet}.png`);

/** Frames reused from the cache vs frames in the export (clip × direction × frame, mirrored directions excluded). */
export interface FrameCacheStats {
  reused: number;
  total: number;
}

/** "reused 1440 of 1520 frames" (null when nothing was looked up). */
export function frameCacheSummary(s: FrameCacheStats | null | undefined): string | null {
  if (!s || !s.total) return null;
  return `reused ${s.reused} of ${s.total} frame${s.total === 1 ? '' : 's'}`;
}

/** The frame cache stats of a batch's items added up (a sprite's render may be several sheets), null when none had any. */
export function sumFrameCache(items: { frameCache?: FrameCacheStats | null }[]): FrameCacheStats | null {
  const withStats = items.filter((i) => i.frameCache && i.frameCache.total > 0);
  if (!withStats.length) return null;
  return withStats.reduce((s, i) => ({ reused: s.reused + i.frameCache!.reused, total: s.total + i.frameCache!.total }), { reused: 0, total: 0 });
}
