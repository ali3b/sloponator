// Moved from synty-sprite-generator packages/shared/src/export/pivot.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS, resolveDirections, type Framing, type ViewConfig } from '../view/camera.js';
import type { ObjectInfo } from '../object/footprint.js';
import { buildContext, frameKey, objectPivots, type ClipInput } from './context.js';
import { layoutFrames, type FrameInput, type LayoutSettings } from '../layout/layout.js';
import { BUILTIN_PROFILES } from '../profiles/profiles.js';
import { renderProfile } from '../profiles/render.js';
import { genericData } from './meta.js';
import { contextFromGeneric } from './sheetMerge.js';
import { buildLayersManifest, layersHelperFiles } from './layers.js';

/**
 * FB-029: an object's frames pivot on its anchor (where its footprint's ground centre is drawn), per direction, not
 * on the model origin, so a sprite placed by its anchor does not move when it plays another animation.
 */
const view: ViewConfig = { ...VIEW_PRESETS.find((p) => p.id === 'iso8')!.config, mirror: true };
const dirs = resolveDirections(view);
const rendered = dirs.filter((d) => d.mirrorOf === null);
// The tank of FB-029: 442×348 frames, model origin (221, 230), SE anchor (241.62, 240.31).
const framing: Framing = { viewHalfW: 1, viewHalfH: 1, centreY: 1, frameWidth: 442, frameHeight: 348, pivot: { x: 221, y: 230 }, ppm: 45.25 };
const anchorOf = (i: number) => ({ x: Math.round((200.38 + 6 * i) * 100) / 100, y: 240.31 });
const object = {
  anchor: anchorOf(0),
  directions: dirs.map((d, i) => {
    const src = d.mirrorOf === null ? i : d.mirrorOf;
    const a = anchorOf(src);
    return { name: d.name, worldAngle: d.worldAngle, mirrorOf: d.mirrorOf === null ? null : dirs[d.mirrorOf].name, anchor: d.mirrorOf === null ? a : { x: framing.frameWidth - a.x, y: a.y }, polygon: [] };
  }),
} as unknown as ObjectInfo;

function context(layout: LayoutSettings, pivots: ReturnType<typeof objectPivots>, kind = 'vehicle') {
  const clips: ClipInput[] = [{ name: 'intact', loop: true, frameCount: 1 }, { name: 'intact_to_destroyed', loop: false, frameCount: 3 }];
  const inputs: FrameInput[] = clips.flatMap((c) => rendered.flatMap((d) => Array.from({ length: c.frameCount }, (_, i) => ({
    key: frameKey(c.name, d.name, i), clip: c.name, direction: d.name, index: i, width: 442, height: 348, opaque: { x: 60 + i, y: 40, w: 300, h: 260 },
  }))));
  const pages = layoutFrames(inputs, layout);
  const where = new Map(pages.flatMap((p) => p.placements.map((pl) => [pl.key, { page: p.index, p: pl }])));
  return buildContext({
    view, framing, directions: dirs, clips, pages, placement: (k) => where.get(k), pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: '{clip}_{dir}',
    asset: { name: 'SM_Veh_German_Tank_01', pack: 'POLYGON_War', kind }, object, pivots,
  });
}
const grid: LayoutSettings = { mode: 'grid', grouping: 'single', trim: false, padding: 0, extrude: 0, powerOfTwo: false, maxSize: 8192 };
const atlas: LayoutSettings = { mode: 'atlas', grouping: 'single', trim: true, padding: 2, extrude: 1, powerOfTwo: false, maxSize: 4096 };

describe('object frame pivots (FB-029)', () => {
  it('objectPivots: the anchor per direction by default, nothing for "origin" or objects without an anchor', () => {
    const p = objectPivots(object)!;
    expect(p.source).toBe('anchor');
    expect(p.pivot).toEqual(object.anchor);
    for (const d of object.directions) expect(p.byDirection[d.name]).toEqual(d.anchor);
    expect(objectPivots(object, 'origin')).toBeNull();
    expect(objectPivots(null)).toBeNull();
    expect(objectPivots({ anchor: null, directions: [] })).toBeNull();
  });

  it('every frame of a direction pivots on that direction\'s anchor, in every clip', () => {
    for (const layout of [grid, atlas]) {
      const ctx = context(layout, objectPivots(object));
      expect(ctx.pivot).toEqual(object.anchor);
      expect(ctx.pivotSource).toBe('anchor');
      for (const f of ctx.frames) {
        const a = object.directions.find((d) => d.name === f.direction)!.anchor;
        expect(f.pivotSrcX).toBeCloseTo(a.x / f.sourceW, 9);
        expect(f.pivotSrcY).toBeCloseTo(a.y / f.sourceH, 9);
        expect(f.pivotX).toBeCloseTo((a.x - f.trimX) / f.w, 9);
        expect(f.pivotYUp).toBeCloseTo(1 - (a.y - f.trimY) / f.h, 9);
      }
      // Mirrored directions: their own (flipped) anchor, as drawn.
      for (const an of ctx.animations) expect(an.pivot).toEqual(object.directions.find((d) => d.name === an.direction)!.anchor);
    }
  });

  it('phaser3: each frame\'s pivot × sourceSize is the anchor, so play() keeps a sprite placed by its anchor still', async () => {
    const phaser = BUILTIN_PROFILES.find((p) => p.id === 'phaser3')!;
    const ctx = context(atlas, objectPivots(object));
    const json = JSON.parse((await renderProfile(phaser, ctx)).find((f) => f.name === 'Veh_German_Tank_01.json')!.content);
    const frames = json.textures.flatMap((t: { frames: unknown[] }) => t.frames) as { filename: string; pivot: { x: number; y: number }; sourceSize: { w: number; h: number } }[];
    expect(frames.length).toBe(ctx.frames.length);
    for (const f of frames) {
      const dir = ctx.frames.find((x) => x.name === f.filename)!.direction;
      const a = object.directions.find((d) => d.name === dir)!.anchor;
      // Within the 5 decimals Phaser's pivot is written with (a hundredth of a pixel).
      expect(Math.abs(f.pivot.x * f.sourceSize.w - a.x)).toBeLessThan(0.01);
      expect(Math.abs(f.pivot.y * f.sourceSize.h - a.y)).toBeLessThan(0.01);
    }
  });

  it('godot4 and the generic data carry the per-direction pivots; a merged sheet keeps them', async () => {
    const ctx = context(atlas, objectPivots(object));
    const gd = (await renderProfile(BUILTIN_PROFILES.find((p) => p.id === 'godot4')!, ctx)).find((f) => f.name.endsWith('.gd'))!.content;
    const se = object.directions.find((d) => d.name === rendered[1].name)!.anchor;
    expect(gd).toContain(`"offset": Vector2(${se.x}, ${se.y})`);
    expect(gd).toContain('object anchor (first direction)');
    const g = genericData(ctx);
    expect(g.pivotSource).toBe('anchor');
    expect(g.animations.every((a) => 'pivot' in a)).toBe(true);
    const back = contextFromGeneric(g, BUILTIN_PROFILES.find((p) => p.id === 'generic')!, ctx.base);
    expect(back.pivotSource).toBe('anchor');
    expect(back.frames.map((f) => [f.pivotSrcX, f.pivotSrcY])).toEqual(ctx.frames.map((f) => [f.pivotSrcX, f.pivotSrcY]));
    expect({ ...genericData(back), generator: null }).toEqual({ ...g, generator: null });
  });

  it('layered object exports: the manifest carries each animation\'s pivot, and the Godot layers script uses it (FB-028 follow-up)', async () => {
    const ctx = context(atlas, objectPivots(object));
    const m = buildLayersManifest({ body: ctx, bodyFiles: [], parts: [], z: () => ({}), occlusion: 'mask', alignment: { view: ctx.view, framing, layout: atlas, clips: [] } });
    expect(m.pivotSource).toBe('anchor');
    expect(m.pivot).toEqual(object.anchor);
    for (const a of m.animations) expect(a.pivot).toEqual(object.directions.find((d) => d.name === a.direction)!.anchor);
    const [gd] = await layersHelperFiles('godot4', m);
    const se = rendered[1].name;
    expect(gd.content).toContain(`"intact_${se}": Vector2(${object.directions.find((d) => d.name === se)!.anchor.x}, 240.31)`);
    expect(gd.content).toContain('pivot.x = FRAME_WIDTH - pivot.x');
    expect(gd.content).toContain('s.offset = -pivot');
    // --pivot origin: one pivot, no per-animation ones.
    const o = buildLayersManifest({ body: context(atlas, null), bodyFiles: [], parts: [], z: () => ({}), occlusion: 'mask', alignment: { view: ctx.view, framing, layout: atlas, clips: [] } });
    expect(o).not.toHaveProperty('pivotSource');
    expect(o.animations.every((a) => !('pivot' in a))).toBe(true);
  });

  it('Godot: offset = -pivot with centered = false is right for flip_h directions too', () => {
    // Godot 4's AnimatedSprite2D draws its frame in Rect2(offset, size) (centered = false) and flip_h mirrors the
    // texture inside that rect (a negative width becomes a flip flag; the rect and offset stay). So texture pixel u
    // lands at x = offset.x + (flip_h ? w - u : u). The anchor pixel must land on the node's origin.
    const ctx = context(grid, objectPivots(object));
    const w = ctx.frameWidth;
    const drawnAt = (u: number, offsetX: number, flip: boolean) => offsetX + (flip ? w - u : u);
    for (const a of ctx.animations) {
      const src = a.mirrorOf ?? a.direction;
      const srcAnchor = object.directions.find((d) => d.name === src)!.anchor;
      // The godot4 helper's DIRECTIONS "offset" for this direction (its own pivot), used as -offset.
      expect(drawnAt(srcAnchor.x, -a.pivot.x, a.flipX)).toBeCloseTo(0, 6);
      // The layers script plays the source animation with flip_h and flips the source pivot itself.
      const srcPivot = ctx.animations.find((x) => x.clip === a.clip && x.direction === src)!.pivot;
      const layersPivotX = a.flipX ? w - srcPivot.x : srcPivot.x;
      expect(drawnAt(srcAnchor.x, -layersPivotX, a.flipX)).toBeCloseTo(0, 6);
    }
    expect(ctx.animations.some((a) => a.flipX)).toBe(true);
  });

  it('--pivot origin (and characters) keep the model origin', () => {
    for (const ctx of [context(atlas, objectPivots(object, 'origin')), context(atlas, null, 'character')]) {
      expect(ctx.pivot).toEqual(framing.pivot);
      expect(ctx.pivotSource).toBe('origin');
      for (const f of ctx.frames) expect(f.pivotSrcX).toBeCloseTo(221 / 442, 9);
      expect(genericData(ctx)).not.toHaveProperty('pivotSource');
    }
  });
});
