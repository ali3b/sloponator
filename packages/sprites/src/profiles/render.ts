// Moved from synty-sprite-generator packages/shared/src/export/render.ts (P2, ali3b/sloponator#8).
import { Liquid } from 'liquidjs';
import { fillPattern, scaleRecord, type ContextAnimation, type ContextFrame, type ExportContext } from '../manifest/context.js';
import type { ExportProfile } from './profiles.js';

/** FNV-1a 64-bit, as two 32-bit halves (stable ids from names, e.g. Unity guids that survive re-exports). */
function fnv64(s: string): [number, number] {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (h1 >>> 7), 0x5bd1e995) >>> 0;
  }
  return [h1, h2];
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

export function createLiquid() {
  const liquid = new Liquid({ strictFilters: true, jsTruthy: false });
  /** 32-hex-digit stable id (Unity guid / spriteID). */
  liquid.registerFilter('guid', (v: unknown) => {
    const s = String(v);
    const [a, b] = fnv64(s);
    const [c, d] = fnv64(`${s}#`);
    return hex8(a) + hex8(b) + hex8(c) + hex8(d);
  });
  /** Positive 63-bit-ish integer id as a decimal string (Unity internalID). */
  liquid.registerFilter('id64', (v: unknown) => {
    const [a, b] = fnv64(String(v));
    return (BigInt(a & 0x7fffffff) * 4294967296n + BigInt(b)).toString();
  });
  /** Always print a decimal point (Godot floats: 12 -> 12.0). */
  liquid.registerFilter('float', (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) ? `${n}.0` : String(+n.toFixed(6));
  });
  liquid.registerFilter('fixed', (v: unknown, digits = 3) => String(+Number(v).toFixed(Number(digits))));
  liquid.registerFilter('pascal', (v: unknown) =>
    String(v).replace(/^(SK_|SM_)/, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(''),
  );
  return liquid;
}

/**
 * Gameplay metadata every engine format gets as `{base}.meta.json`: clip events (release, hit → hit_end with the
 * striking limb, cast, footsteps…), per-frame sockets (weapon_tip, muzzle, hands…) and body boxes (head, torso,
 * legs) in frame pixels, the feet pivot, the blend mode and the scale. Written for every sprite of every kind.
 */
export function metaData(ctx: ExportContext) {
  const hasBoxes = ctx.frames.some((f) => f.boxes);
  const hasSockets = hasBoxes || ctx.frames.some((f) => Object.keys(f.sockets).length);
  // Always written (FB-104): the scale record alone tells a game a UI icon (fit) from a map sprite (ppm / tile lock).
  return {
    schema: 'ssg-meta/1',
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
export function genericData(ctx: ExportContext) {
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

export interface RenderedFile {
  name: string;
  content: string;
}

export class TemplateError extends Error {
  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`);
  }
}

/** Animations whose frames all sit on one page, re-indexed against that page's frame list (Aseprite tags). */
function pageAnimations(anims: ContextAnimation[], pageFrames: ContextFrame[]) {
  const pos = new Map(pageFrames.map((f, i) => [f.i, i]));
  return anims
    .filter((a) => a.frames.length && a.frames.every((f) => pos.has(f.i)))
    .map((a) => ({ ...a, from: pos.get(a.frames[0].i)!, to: pos.get(a.frames[a.frames.length - 1].i)! }));
}

export async function renderProfile(profile: ExportProfile, ctx: ExportContext, liquid = createLiquid()): Promise<RenderedFile[]> {
  const pages = ctx.pages.map((p) => ({ ...p, frames: ctx.frames.filter((f) => f.page === p.index) }));
  const normalPages = ctx.pages.filter((p) => p.layers.normal).length;
  const scope = { ...ctx, pages, normalPages, generic: genericData(ctx), settings: { ...profile.settings, ...ctx.settings } };
  const out: RenderedFile[] = [];
  for (const file of profile.files) {
    const perPage = /\{(pageFile|pageBase|page)\}/.test(file.name);
    const targets = perPage ? pages : [null];
    for (const page of targets) {
      const vars: Record<string, string | number> = page
        ? { page: page.index, pageFile: page.file, pageBase: page.file.replace(/\.[^.]+$/, ''), base: ctx.base }
        : { base: ctx.base };
      const name = fillPattern(file.name, vars);
      try {
        const extra = page ? { page, pageFrames: page.frames, pageAnimations: pageAnimations(ctx.animations, page.frames) } : {};
        const content = await liquid.parseAndRender(file.template, { ...scope, ...extra });
        // A template that renders to nothing (e.g. a normal-map .meta when no normal layer) writes no file.
        if (content.trim()) out.push({ name, content });
      } catch (e) {
        throw new TemplateError(name, (e as Error).message);
      }
    }
  }
  // Events, sockets and blend mode for engines whose own format has no place for them.
  const meta = profile.id === 'generic' ? null : metaData(ctx);
  const metaName = `${ctx.base}.meta.json`;
  if (meta && !out.some((f) => f.name === metaName)) out.push({ name: metaName, content: JSON.stringify(meta, null, 2) + '\n' });
  return out;
}
