// Moved from synty-sprite-generator packages/shared/src/export/sheetMerge.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS, resolveDirections, type Framing, type ViewConfig } from '../view/camera.js';
import { buildContext, frameKey, type ClipInput } from './context.js';
import { layoutFrames, type FrameInput, type LayoutSettings } from '../layout/layout.js';
import { BUILTIN_PROFILES } from '../profiles/profiles.js';
import { genericData } from './meta.js';
import { contextFromGeneric, mergeExtensionFiles, mergeGenericSheets, type GenericSheet } from './sheetMerge.js';

const atlas: LayoutSettings = { mode: 'atlas', grouping: 'single', trim: true, padding: 2, extrude: 1, powerOfTwo: false, maxSize: 256 };
const view: ViewConfig = { ...VIEW_PRESETS.find((p) => p.id === 'iso8')!.config, mirror: true };
const framing: Framing = { viewHalfW: 1, viewHalfH: 1, centreY: 1, frameWidth: 64, frameHeight: 64, pivot: { x: 32, y: 56 }, ppm: 32 };
const dirs = resolveDirections(view);
const rendered = dirs.filter((d) => d.mirrorOf === null).map((d) => d.name);

/** A sheet's context for some clips, its pages numbered from `pageOffset` (as an extension renders them). */
function sheet(clips: ClipInput[], pageOffset = 0) {
  const inputs: FrameInput[] = clips.flatMap((c) => rendered.flatMap((d) => Array.from({ length: c.frameCount }, (_, i) => ({
    key: frameKey(c.name, d, i), clip: c.name, direction: d, index: i, width: 64, height: 64, opaque: { x: 10 + i, y: 8, w: 30, h: 48 },
  }))));
  const pages = layoutFrames(inputs, atlas);
  const where = new Map(pages.flatMap((p) => p.placements.map((pl) => [pl.key, { page: p.index, p: pl }])));
  return buildContext({
    view, framing, directions: dirs, clips, pages, placement: (k) => where.get(k), pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: '{clip}_{dir}',
    asset: { name: 'SK_Character_Biker', pack: 'P', kind: 'character' }, sockets: () => ({ hand_r: { x: 40, y: 30 } }), pageOffset,
  });
}

describe('adding clips to an export', () => {
  const generic = BUILTIN_PROFILES.find((p) => p.id === 'generic')!;

  it('rebuilds the same frame data from a sheet (context round trip)', () => {
    const g = genericData(sheet([{ name: 'Walk_F', loop: true, frameCount: 4 }, { name: 'Attack', loop: false, frameCount: 3 }]));
    const back = genericData(contextFromGeneric(g, generic, 'Character_Biker'));
    expect({ ...back, generator: null }).toEqual({ ...g, generator: null });
  });

  it('numbers new pages after the old ones and appends clips and animations', () => {
    const old = genericData(sheet([{ name: 'Walk_F', loop: true, frameCount: 6 }]));
    const added = genericData(sheet([{ name: 'Shoot', loop: false, frameCount: 5 }], old.pages.length));
    expect(added.pages[0].index).toBe(old.pages.length);
    expect(added.pages[0].file).toBe(`Character_Biker_${old.pages.length}.png`);
    expect(added.animations[0].frames.every((f) => f.page >= old.pages.length)).toBe(true);
    const m = mergeGenericSheets(old, added);
    expect(m.pages.map((p) => p.index)).toEqual([...old.pages, ...added.pages].map((p) => p.index));
    expect(m.clips.map((c) => c.name)).toEqual(['Walk_F', 'Shoot']);
    expect(m.animations.length).toBe(old.animations.length + added.animations.length);
    // Every frame still points at a page the merged sheet lists.
    const ids = new Set(m.pages.map((p) => p.index));
    expect(m.animations.every((a) => a.frames.every((f) => ids.has(f.page)))).toBe(true);
  });

  it('writes merged frame data and regenerates other formats from it', async () => {
    const godot = BUILTIN_PROFILES.find((p) => p.id === 'godot4')!;
    const old = sheet([{ name: 'Walk_F', loop: true, frameCount: 4 }]);
    const added = sheet([{ name: 'Shoot', loop: false, frameCount: 3 }], old.pages.length);
    const files = (ctx: ReturnType<typeof sheet>) => ({ 'Character_Biker.sheet.json': JSON.stringify(genericData(ctx)) });
    const out = await mergeExtensionFiles(files(old), files(added), ['Character_Biker'], godot);
    const merged = JSON.parse(out['Character_Biker.sheet.json']) as GenericSheet;
    expect(merged.clips.map((c) => c.name)).toEqual(['Walk_F', 'Shoot']);
    const tres = Object.entries(out).find(([n]) => n.endsWith('.tres'));
    expect(tres?.[1]).toContain('Shoot');
    expect(tres?.[1]).toContain('Walk_F');
  });
});
