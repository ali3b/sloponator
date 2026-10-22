// Moved from synty-sprite-generator packages/shared/src/export/context.ts (P2, ali3b/sloponator#8).
/**
 * The data every export template renders from. Built once per export from the layout; templates (built-in
 * engine formats and user profiles) only reshape it, so all formats agree on every rectangle and timing.
 */
import type { ClipEvent, ScaleRecord } from '@slop/formats';
import type { Direction, Framing, ViewConfig } from '../view/camera.js';
import type { ObjectInfo } from '../object/footprint.js';
import type { BodyBoxes } from '../events/bodyBoxes.js';
import type { Page, Placement } from '../layout/layout.js';
// These types are the game-facing contract: defined once in @slop/formats, used and re-exported here.
export type { ClipEvent, ScaleRecord };

export interface ClipInput {
  /** Display / animation name, e.g. "Walk_F". */
  name: string;
  loop: boolean;
  /** Number of frames rendered per direction. */
  frameCount: number;
  /** Ground speed of the original motion (m/s), when known: play walk/run cycles at speed / speedMps. */
  speedMps?: number | null;
}

export interface ContextFrame {
  /** Unique frame name, e.g. "Walk_F_E_0". */
  name: string;
  clip: string;
  direction: string;
  index: number;
  page: number;
  file: string;
  /** Rectangle on the page (y measured from the top). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Same rectangle with y measured from the page bottom (Unity, LibGDX-style consumers). */
  yUp: number;
  trimmed: boolean;
  /** Offset of the rectangle inside the untrimmed frame (TexturePacker spriteSourceSize). */
  trimX: number;
  trimY: number;
  sourceW: number;
  sourceH: number;
  /** LibGDX-style offset: trimmed rect's distance from the untrimmed frame's bottom-left. */
  offsetX: number;
  offsetYUp: number;
  /** Feet pivot relative to this (trimmed) rectangle, normalised 0..1 (y down / y up): Unity sprite rects. */
  pivotX: number;
  pivotY: number;
  pivotYUp: number;
  /**
   * Feet pivot normalised to the untrimmed source frame (sourceW × sourceH), y down: the TexturePacker / Phaser
   * convention, where the origin is taken over `sourceSize` and the trimmed rect is drawn at `spriteSourceSize`.
   */
  pivotSrcX: number;
  pivotSrcY: number;
  durationMs: number;
  durationS: number;
  /** Position in the flat frame list (Aseprite frameTags use these). */
  i: number;
  /**
   * Attachment points (hand_r, head, muzzle, attachments…) in pixels from the untrimmed frame's top-left.
   * For mirrored directions use x' = frameWidth - x.
   */
  sockets: Record<string, { x: number; y: number }>;
  /** Characters: head, torso and legs boxes in the same pixels (SF-FB-009; mirrored: x' = frameWidth - x - w). */
  boxes?: BodyBoxes;
}

export interface ContextAnimation {
  /** clip + direction, e.g. "Walk_F_E" (pattern configurable). */
  name: string;
  /**
   * This direction's pivot in pixels, as the direction is drawn: its frames' pivot, or for a mirrored direction
   * (flipX) its source's pivot flipped (x = frameWidth - x). Objects: the direction's anchor; else the export's pivot.
   */
  pivot: { x: number; y: number };
  clip: string;
  direction: string;
  loop: boolean;
  fps: number;
  /** True when this direction reuses another direction's frames flipped horizontally. */
  flipX: boolean;
  mirrorOf: string | null;
  screenAngle: number;
  worldAngle: number;
  frames: ContextFrame[];
  /** First/last flat frame index (contiguous for rendered directions). */
  from: number;
  to: number;
}

/** The scale record of a view, with the pixels per metre the framing used (and the model's own size factor). */
export function scaleRecord(view: Pick<ViewConfig, 'scale'> | undefined, ppm: number | null, modelScale?: number | null): ScaleRecord {
  const s = view?.scale ?? { mode: 'fit' as const };
  const pixelsPerMetre = ppm === null ? null : Math.round(ppm * 1e4) / 1e4;
  const own = modelScale && modelScale !== 1 ? { modelScale: Math.round(modelScale * 1e4) / 1e4 } : {};
  if (s.mode === 'tile') return { mode: 'tile', pixelsPerMetre, tilePx: s.tilePx, tileHeightPx: s.shape === 'diamond' ? s.tilePx / 2 : s.tilePx, metresPerTile: s.metresPerTile, shape: s.shape, ...own };
  return { mode: s.mode, pixelsPerMetre, ...own };
}

export interface ExportContext {
  asset: { name: string; pack: string; kind: string };
  /** Base name used in file patterns. */
  base: string;
  view: ViewConfig;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  /**
   * The frame pivot in pixels (untrimmed frame, from its top-left). Characters: the feet (the model origin).
   * Objects (`pivotSource` "anchor", the default): the object's anchor, the footprint's ground centre, of the first
   * direction; each direction's frames carry their own direction's anchor (`animations[].pivot`, frames' pivots).
   */
  pivot: { x: number; y: number };
  /** Where the pivot comes from: "origin" (the model origin: characters, or `--pivot origin`) or "anchor" (objects). */
  pivotSource: PivotSource;
  /** Feet pivot normalised to the frame (y down / y up). */
  pivotX: number;
  pivotY: number;
  pivotYUp: number;
  pixelsPerMetre: number | null;
  /** The scale lock (or fit) the export was rendered at: every data file carries it. */
  scale: ScaleRecord;
  /** Engine units: pixels per metre when the scale is locked, else 100 (Unity's default). */
  pixelsPerUnit: number;
  /** layers: extra images aligned with the page (normal, depth, uv, shadow) -> file name. */
  pages: { index: number; file: string; width: number; height: number; clip: string | null; direction: string | null; layers: Record<string, string> }[];
  frames: ContextFrame[];
  animations: ContextAnimation[];
  clips: (ClipInput & { animations: ContextAnimation[]; events: ClipEvent[] })[];
  /** Extra layers exported with every page. */
  layers: string[];
  directions: Direction[];
  settings: Record<string, string | number | boolean>;
  /** How engines should draw the sheet: 'add' for glowing FX (fireballs, flashes), else 'normal'. */
  blend: 'normal' | 'add';
  /** Objects and props: footprint, height, anchor and ground collision polygon (see docs/LAYERS.md). */
  object?: ObjectInfo;
  generator: { name: string; version: string; generatedAt: string };
}

export type PivotSource = 'origin' | 'anchor';

/** Frame pivots that differ from the framing's (the model origin): one per export, and per rendered direction. */
export interface PivotOverride {
  source: PivotSource;
  pivot: { x: number; y: number };
  byDirection: Record<string, { x: number; y: number }>;
}

/**
 * FB-029: an object's frames pivot on its anchor (where the footprint's ground centre is drawn), per direction, so a
 * sprite placed by its anchor stays put whatever animation plays. `mode` "origin" keeps the model origin (the
 * framing's pivot), as characters always do. Null when there is nothing to change.
 */
export function objectPivots(object: Pick<ObjectInfo, 'anchor' | 'directions'> | null | undefined, mode: PivotSource = 'anchor'): PivotOverride | null {
  if (mode !== 'anchor' || !object?.anchor || !object.directions.length) return null;
  return {
    source: 'anchor',
    pivot: { ...object.anchor },
    byDirection: Object.fromEntries(object.directions.map((d) => [d.name, { ...d.anchor }])),
  };
}

/** Replace {tokens} in a file/frame-name pattern. Unknown tokens are left as-is. */
export function fillPattern(pattern: string, vars: Record<string, string | number>) {
  return pattern.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

export interface ContextOptions {
  asset: { name: string; pack: string; kind: string };
  view: ViewConfig;
  framing: Framing;
  directions: Direction[];
  clips: ClipInput[];
  pages: Page[];
  /** Placement lookup by frame key `${clip}|${direction}|${index}`; undefined = not in this layout (e.g. LPC hurt has no up row). */
  placement: (key: string) => { page: number; p: Placement } | undefined;
  pageFile: string; // pattern: {base} {page} {clip} {direction} {n}
  frameName: string; // pattern: {clip} {dir} {i}
  animationName: string; // pattern: {clip} {dir} {base} {asset}
  settings?: Record<string, string | number | boolean>;
  /** Extra layer names (each page gets `{pageBase}_{layer}.png`). */
  layers?: string[];
  sockets?: (key: string) => Record<string, { x: number; y: number }> | undefined;
  /** Characters: body boxes per frame key (SF-FB-009). */
  boxes?: (key: string) => BodyBoxes | undefined;
  events?: (clip: string) => ClipEvent[];
  blend?: 'normal' | 'add';
  /** Base name for file patterns (default: the asset name without SK_/SM_); parts of a layered export use `{base}_{part}`. */
  base?: string;
  /**
   * Number the pages from here (files, page indices and frames' `page`): new clips added to an earlier export get
   * pages after its existing ones, so nothing is overwritten and the merged sheet is one list.
   */
  pageOffset?: number;
  /** Footprint, anchor and collision of an object (props, vehicles): written into the data files. */
  object?: ObjectInfo | null;
  /** Frame pivots other than the framing's model origin (objects: their anchors, see objectPivots). */
  pivots?: PivotOverride | null;
  /** SF-FB-024: the model's own size factor, recorded in the scale record (the pixels per metre stay the world's). */
  modelScale?: number | null;
}

export const frameKey = (clip: string, direction: string, index: number) => `${clip}|${direction}|${index}`;

export function buildContext(o: ContextOptions): ExportContext {
  const base = o.base ?? o.asset.name.replace(/^(SK_|SM_)/, '');
  const off = o.pageOffset ?? 0;
  const pageFiles = o.pages.map((p) =>
    fillPattern(o.pageFile, { base, asset: o.asset.name, page: p.index + off, clip: p.clip ?? 'all', direction: p.direction ?? 'all', dir: p.direction ?? 'all', n: p.placements.length }),
  );
  const pivot = o.pivots?.pivot ?? o.framing.pivot;
  const pivotOf = (direction: string) => o.pivots?.byDirection[direction] ?? pivot;
  const frames: ContextFrame[] = [];
  const animations: ContextAnimation[] = [];
  const frameMs = 1000 / o.view.fps;

  for (const clip of o.clips) {
    const byDir = new Map<string, ContextFrame[]>();
    for (const d of o.directions.filter((x) => x.mirrorOf === null)) {
      const list: ContextFrame[] = [];
      for (let i = 0; i < clip.frameCount; i++) {
        const where = o.placement(frameKey(clip.name, d.name, i));
        if (!where) continue;
        const { page, p } = where;
        const pg = o.pages[page];
        const pivot = pivotOf(d.name);
        const f: ContextFrame = {
          name: fillPattern(o.frameName, { clip: clip.name, dir: d.name, direction: d.name, i, base }),
          clip: clip.name, direction: d.name, index: i, page: page + off, file: pageFiles[page],
          x: p.x, y: p.y, w: p.w, h: p.h, yUp: pg.height - p.y - p.h,
          trimmed: p.trimmed, trimX: p.trimX, trimY: p.trimY, sourceW: p.sourceW, sourceH: p.sourceH,
          offsetX: p.trimX, offsetYUp: p.sourceH - p.trimY - p.h,
          pivotX: (pivot.x - p.trimX) / p.w, pivotY: (pivot.y - p.trimY) / p.h, pivotYUp: 1 - (pivot.y - p.trimY) / p.h,
          pivotSrcX: pivot.x / p.sourceW, pivotSrcY: pivot.y / p.sourceH,
          durationMs: frameMs, durationS: frameMs / 1000, i: frames.length,
          sockets: o.sockets?.(frameKey(clip.name, d.name, i)) ?? {},
        };
        const boxes = o.boxes?.(frameKey(clip.name, d.name, i));
        if (boxes && Object.keys(boxes).length) f.boxes = boxes;
        frames.push(f);
        list.push(f);
      }
      byDir.set(d.name, list);
    }
    for (const d of o.directions) {
      const src = d.mirrorOf === null ? d : o.directions[d.mirrorOf];
      const list = byDir.get(src.name) ?? [];
      if (!list.length) continue;
      animations.push({
        name: fillPattern(o.animationName, { clip: clip.name, dir: d.name, direction: d.name, base, asset: o.asset.name }),
        pivot: pivotOf(d.name),
        clip: clip.name, direction: d.name, loop: clip.loop, fps: o.view.fps,
        flipX: d.mirrorOf !== null, mirrorOf: d.mirrorOf === null ? null : src.name,
        screenAngle: d.screenAngle, worldAngle: d.worldAngle,
        frames: list, from: list[0]?.i ?? 0, to: list[list.length - 1]?.i ?? 0,
      });
    }
  }

  return {
    asset: o.asset,
    base,
    view: o.view,
    frameWidth: o.framing.frameWidth,
    frameHeight: o.framing.frameHeight,
    fps: o.view.fps,
    pivot,
    pivotSource: o.pivots?.source ?? 'origin',
    pivotX: pivot.x / o.framing.frameWidth,
    pivotY: pivot.y / o.framing.frameHeight,
    pivotYUp: 1 - pivot.y / o.framing.frameHeight,
    pixelsPerMetre: o.framing.ppm,
    scale: scaleRecord(o.view, o.framing.ppm, o.modelScale),
    pixelsPerUnit: o.framing.ppm ?? 100,
    pages: o.pages.map((p, i) => ({
      index: p.index + off, file: pageFiles[i], width: p.width, height: p.height, clip: p.clip, direction: p.direction,
      layers: Object.fromEntries((o.layers ?? []).map((l) => [l, pageFiles[i].replace(/(\.[^.]+)$/, `_${l}$1`)])),
    })),
    layers: o.layers ?? [],
    frames,
    animations,
    clips: o.clips.map((c) => ({ ...c, animations: animations.filter((a) => a.clip === c.name), events: o.events?.(c.name) ?? [] })),
    directions: o.directions,
    settings: o.settings ?? {},
    blend: o.blend ?? 'normal',
    ...(o.object ? { object: o.object } : {}),
    generator: { name: 'Synty Sprite Generator', version: '0.3', generatedAt: new Date().toISOString() },
  };
}
