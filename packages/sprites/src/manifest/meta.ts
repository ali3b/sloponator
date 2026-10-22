// Moved from synty-sprite-generator packages/shared/src/export/render.ts (metaData, genericData) (P2, ali3b/sloponator#8).
/**
 * The two JSON views of an export every engine format can carry: `{base}.meta.json` (ssg-meta/1: clip events,
 * sockets, body boxes, pivot, scale, object data) and the generic sheet JSON (`{base}.json` of the generic format,
 * `{base}.sheet.json` for every other format: every rectangle and timing).
 */
import type { SsgMeta, SsgSheet } from '@slop/formats';
import { scaleRecord, type ExportContext } from './context.js';

/**
 * Gameplay metadata every engine format gets as `{base}.meta.json`: clip events (release, hit → hit_end with the
 * striking limb, cast, footsteps…), per-frame sockets (weapon_tip, muzzle, hands…) and body boxes (head, torso,
 * legs) in frame pixels, the feet pivot, the blend mode and the scale. Written for every sprite of every kind.
 */
export function metaData(ctx: ExportContext): SsgMeta {
  const hasBoxes = ctx.frames.some((f) => f.boxes);
  const hasSockets = hasBoxes || ctx.frames.some((f) => Object.keys(f.sockets).length);
  // Always written (FB-104): the scale record alone tells a game a UI icon (fit) from a map sprite (ppm / tile lock).
  return {
    schema: 'ssg-meta/1' as const,
    generator: ctx.generator,
    asset: ctx.asset,
    blend: ctx.blend,
    frameWidth: ctx.frameWidth,
    frameHeight: ctx.frameHeight,
    fps: ctx.fps,
    pivot: ctx.pivot,
    ...(ctx.pivotSource === 'anchor' ? { pivotSource: 'anchor' as const } : {}),
    pixelsPerMetre: ctx.pixelsPerMetre,
    scale: ctx.scale ?? scaleRecord(ctx.view, ctx.pixelsPerMetre),
    note: hasBoxes
      ? 'Socket positions and boxes are pixels from the untrimmed frame top-left; for flipX animations use x = frameWidth - x (boxes: x = frameWidth - x - w).'
      : 'Socket positions are pixels from the untrimmed frame top-left; for flipX animations use x = frameWidth - x.',
    clips: ctx.clips.map((c) => ({ name: c.name, loop: c.loop, frameCount: c.frameCount, events: c.events, ...(c.speedMps ? { speedMps: c.speedMps } : {}) })),
    animations: hasSockets
      ? ctx.animations.map((a) => ({
          name: a.name, clip: a.clip, direction: a.direction, flipX: a.flipX, sockets: a.frames.map((f) => f.sockets),
          ...(hasBoxes ? { boxes: a.frames.map((f) => f.boxes ?? {}) } : {}),
        }))
      : undefined,
    ...(ctx.object ? { object: ctx.object } : {}),
  };
}

/** A clean, self-describing JSON view of the export (the "generic" format, and the Sheet Viewer's input). */
export function genericData(ctx: ExportContext): SsgSheet {
  return {
    generator: ctx.generator,
    asset: ctx.asset,
    frameWidth: ctx.frameWidth,
    frameHeight: ctx.frameHeight,
    fps: ctx.fps,
    pivot: ctx.pivot,
    ...(ctx.pivotSource === 'anchor' ? { pivotSource: 'anchor' as const } : {}),
    pixelsPerMetre: ctx.pixelsPerMetre,
    scale: ctx.scale ?? scaleRecord(ctx.view, ctx.pixelsPerMetre),
    blend: ctx.blend,
    ...(ctx.object ? { object: ctx.object } : {}),
    view: ctx.view,
    pages: ctx.pages,
    layers: ctx.layers,
    clips: ctx.clips.map((c) => ({ name: c.name, loop: c.loop, frameCount: c.frameCount, events: c.events, ...(c.speedMps ? { speedMps: c.speedMps } : {}) })),
    directions: ctx.directions.map((d) => ({
      name: d.name, screenAngle: d.screenAngle, worldAngle: d.worldAngle,
      mirrorOf: d.mirrorOf === null ? null : ctx.directions[d.mirrorOf].name,
    })),
    animations: ctx.animations.map((a) => ({
      name: a.name, clip: a.clip, direction: a.direction, loop: a.loop, fps: a.fps, flipX: a.flipX,
      // Objects pivot on their anchor, which differs per direction (FB-029).
      ...(ctx.pivotSource === 'anchor' ? { pivot: a.pivot } : {}),
      frames: a.frames.map((f) => ({
        page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, trimX: f.trimX, trimY: f.trimY,
        sourceW: f.sourceW, sourceH: f.sourceH, durationMs: f.durationMs,
        ...(Object.keys(f.sockets).length ? { sockets: f.sockets } : {}),
        ...(f.boxes ? { boxes: f.boxes } : {}),
      })),
    })),
  };
}
