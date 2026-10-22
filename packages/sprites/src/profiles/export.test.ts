// Moved from synty-sprite-generator packages/shared/src/export/export.test.ts (P2, ali3b/sloponator#8).
/* eslint-disable @typescript-eslint/no-explicit-any -- engine files are read back by shape */
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { VIEW_PRESETS, resolveDirections, type Framing, type ViewConfig } from '../view/camera.js';
import { layoutFrames, packRects, LayoutError, type FrameInput, type LayoutSettings } from '../layout/layout.js';
import { buildContext, frameKey, scaleRecord, type ClipInput, type ContextOptions } from '../manifest/context.js';
import { alignmentSignature, buildLayersManifest } from '../manifest/layers.js';
import { BUILTIN_PROFILES, withAnimPrefix } from './profiles.js';
import { renderProfile } from './render.js';
import { genericData, metaData } from '../manifest/meta.js';

const grid: LayoutSettings = { mode: 'grid', grouping: 'single', trim: false, padding: 0, extrude: 0, powerOfTwo: false, maxSize: 4096 };

function frames(clips: ClipInput[], dirs: string[], size = 64, opaque = { x: 16, y: 8, w: 32, h: 50 }): FrameInput[] {
  return clips.flatMap((c) =>
    dirs.flatMap((d) => Array.from({ length: c.frameCount }, (_, i) => ({ key: frameKey(c.name, d, i), clip: c.name, direction: d, index: i, width: size, height: size, opaque }))),
  );
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layout', () => {
  it('grid: one row per clip × direction, one column per frame', () => {
    const pages = layoutFrames(frames([{ name: 'Walk', loop: true, frameCount: 8 }, { name: 'Idle', loop: true, frameCount: 4 }], ['E', 'N']), grid);
    expect(pages).toHaveLength(1);
    expect([pages[0].width, pages[0].height]).toEqual([8 * 64, 4 * 64]);
    expect(pages[0].placements.find((p) => p.key === frameKey('Idle', 'N', 3))).toMatchObject({ x: 3 * 64, y: 3 * 64 });
  });

  it('grid: rows overflow onto new pages at maxSize', () => {
    // 2 frames per row (128 px wide); a 160 px page fits 2 rows of 64 px.
    const pages = layoutFrames(frames([{ name: 'Walk', loop: true, frameCount: 2 }], ['a', 'b', 'c', 'd', 'e']), { ...grid, maxSize: 160 });
    expect(pages.map((p) => p.placements.length)).toEqual([4, 4, 2]);
  });

  it('grid: a clip longer than the page width continues on the next row', () => {
    // 5 frames of 64 px on a 160 px page: rows of 2, 2, 1 (two pages).
    const pages = layoutFrames(frames([{ name: 'Walk', loop: true, frameCount: 5 }], ['a']), { ...grid, maxSize: 160 });
    expect(pages.map((p) => p.placements.length)).toEqual([4, 1]);
    expect(pages[0].placements.map((p) => [p.x, p.y])).toEqual([[0, 0], [64, 0], [0, 64], [64, 64]]);
    // Strips must stay one row (GameMaker strip images).
    expect(() => layoutFrames(frames([{ name: 'Walk', loop: true, frameCount: 3 }], ['a']), { ...grid, mode: 'strips', maxSize: 160 })).toThrow(LayoutError);
  });

  it('strips: one page per clip and direction', () => {
    const pages = layoutFrames(frames([{ name: 'Walk', loop: true, frameCount: 6 }], ['E', 'W']), { ...grid, mode: 'strips' });
    expect(pages.map((p) => [p.direction, p.width, p.height])).toEqual([['E', 384, 64], ['W', 384, 64]]);
  });

  it('atlas: trims, never overlaps, stays inside pages, respects power of two', () => {
    const s: LayoutSettings = { ...grid, mode: 'atlas', trim: true, padding: 2, extrude: 1, powerOfTwo: true, maxSize: 256 };
    const pages = layoutFrames(frames([{ name: 'Walk', loop: true, frameCount: 12 }], ['E', 'N', 'W']), s);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) {
      expect(Math.log2(p.width) % 1).toBe(0);
      for (const a of p.placements) {
        expect([a.w, a.h, a.trimX, a.trimY, a.trimmed]).toEqual([32, 50, 16, 8, true]);
        expect(a.x + a.w).toBeLessThanOrEqual(p.width);
        expect(a.y + a.h).toBeLessThanOrEqual(p.height);
        for (const b of p.placements) if (a !== b) expect(overlaps(a, b)).toBe(false);
      }
    }
    expect(pages.reduce((n, p) => n + p.placements.length, 0)).toBe(36);
  });

  it('packRects rejects frames larger than a page', () => {
    expect(() => packRects([{ key: 'x', w: 300, h: 10 }], 256)).toThrow(LayoutError);
  });
});

function makeContext(viewOver: Partial<ViewConfig> = {}, layout: LayoutSettings = grid, layers: string[] = [], o: { asset?: string; animationName?: string; boxes?: ContextOptions['boxes']; events?: ContextOptions['events']; sockets?: ContextOptions['sockets']; kind?: string; modelScale?: number; clips?: ClipInput[] } = {}) {
  const view: ViewConfig = { ...VIEW_PRESETS.find((p) => p.id === 'iso8')!.config, ...viewOver };
  const dirs = resolveDirections(view);
  const rendered = dirs.filter((d) => d.mirrorOf === null).map((d) => d.name);
  const clips: ClipInput[] = o.clips ?? [{ name: 'Walk_F', loop: true, frameCount: 4 }, { name: 'Death', loop: false, frameCount: 3 }];
  const pages = layoutFrames(frames(clips, rendered), layout);
  const where = new Map(pages.flatMap((p) => p.placements.map((pl) => [pl.key, { page: p.index, p: pl }])));
  const framing: Framing = { viewHalfW: 1, viewHalfH: 1, centreY: 1, frameWidth: 64, frameHeight: 64, pivot: { x: 32, y: 56 }, ppm: 32 };
  return buildContext({
    asset: { name: o.asset ?? 'SK_Character_Biker', pack: 'POLYGON_City_Characters', kind: o.kind ?? 'character' },
    view, framing, directions: dirs, clips, pages,
    placement: (k) => where.get(k)!, pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: o.animationName ?? '{clip}_{dir}',
    layers, sockets: o.sockets ?? (() => ({ hand_r: { x: 10, y: 20 } })), events: o.events ?? ((c) => (c === 'Walk_F' ? [{ frame: 1, name: 'footstep_l' }] : [])),
    boxes: o.boxes, modelScale: o.modelScale,
  });
}

describe('context', () => {
  it('mirrored directions reuse the source frames and are flagged flipX', () => {
    const ctx = makeContext({ mirror: true });
    const w = ctx.animations.find((a) => a.name === 'Walk_F_W')!;
    const e = ctx.animations.find((a) => a.name === 'Walk_F_E')!;
    expect(w.flipX).toBe(true);
    expect(w.mirrorOf).toBe('E');
    expect(w.frames.map((f) => f.name)).toEqual(e.frames.map((f) => f.name));
    expect(ctx.frames).toHaveLength((4 + 3) * 5); // 5 rendered directions
    expect(ctx.animations).toHaveLength(2 * 8);
  });

  it('pivots and y-up coordinates', () => {
    const ctx = makeContext();
    const f = ctx.frames[0];
    expect([f.pivotX, f.pivotY, f.pivotYUp]).toEqual([0.5, 56 / 64, 1 - 56 / 64]);
    expect(f.yUp).toBe(ctx.pages[0].height - f.y - f.h);
    expect(ctx.pixelsPerUnit).toBe(32);
  });
});

describe('built-in profiles render valid output', () => {
  const atlas: LayoutSettings = { ...grid, mode: 'atlas', trim: true, padding: 2, extrude: 1, maxSize: 512 };
  for (const profile of BUILTIN_PROFILES.filter((p) => !p.special)) {
    it(profile.id, async () => {
      const ctx = makeContext({ mirror: true }, profile.layout.mode === 'atlas' ? atlas : profile.layout);
      const files = await renderProfile(profile, ctx);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        if (f.name.endsWith('.json')) expect(() => JSON.parse(f.content), f.name).not.toThrow();
        if (f.name.endsWith('.meta')) {
          const doc = yaml.load(f.content) as any;
          const sprites = doc.TextureImporter.spriteSheet.sprites;
          const page = Number(f.name.match(/_(\d+)\.png\.meta$/)![1]);
          expect(sprites).toHaveLength(ctx.frames.filter((x) => x.page === page).length);
          expect(doc.guid).toMatch(/^[0-9a-f]{32}$/);
          expect(doc.TextureImporter.spritePixelsToUnits).toBe(32);
        }
        if (f.name.endsWith('.tres')) {
          expect(f.content.match(/\[sub_resource type="AtlasTexture"/g)).toHaveLength(ctx.frames.length);
          expect(f.content).toContain('"speed": 12.0');
          expect(f.content).toContain('&"Death_E"');
          expect(f.content).toMatch(new RegExp(`load_steps=${ctx.pages.length + ctx.frames.length + 1} `));
        }
      }
    });
  }

  it('aseprite frameTags index into the page frame list', async () => {
    const ctx = makeContext();
    const [file] = await renderProfile(BUILTIN_PROFILES.find((p) => p.id === 'aseprite')!, ctx);
    const doc = JSON.parse(file.content);
    for (const tag of doc.meta.frameTags) expect(doc.frames[tag.from].filename.startsWith(tag.name)).toBe(true);
  });

  it('normal-map layer: Godot CanvasTexture, Unity secondary texture + normal .meta only when exported', async () => {
    const godot = BUILTIN_PROFILES.find((p) => p.id === 'godot4')!;
    const unity = BUILTIN_PROFILES.find((p) => p.id === 'unity')!;
    const withN = makeContext({}, grid, ['normal']);
    const tres = (await renderProfile(godot, withN))[0].content;
    expect(tres).toContain('[sub_resource type="CanvasTexture"');
    expect(tres).toContain('Character_Biker_0_normal.png');
    expect(tres).toMatch(new RegExp(`load_steps=${withN.pages.length * 3 + withN.frames.length + 1} `));
    const metas = await renderProfile(unity, withN);
    expect(metas.map((f) => f.name)).toEqual(['Character_Biker_0.png.meta', 'Character_Biker_0_normal.png.meta', 'Character_Biker.meta.json']);
    expect((yaml.load(metas[0].content) as any).TextureImporter.spriteSheet.secondaryTextures[0].name).toBe('_NormalMap');
    expect((yaml.load(metas[1].content) as any).TextureImporter.textureType).toBe(1);
    expect((await renderProfile(unity, makeContext())).map((f) => f.name)).toEqual(['Character_Biker_0.png.meta', 'Character_Biker.meta.json']);
  });

  it('FB-104: a fitted weapon with no events or sockets still gets its meta sidecar with the scale record', async () => {
    const ctx = makeContext({ scale: { mode: 'fit' } }, grid, [], { asset: 'SM_Wep_Grenade_01', kind: 'weapon', events: () => [], sockets: () => ({}) });
    const files = await renderProfile(BUILTIN_PROFILES.find((p) => p.id === 'phaser3')!, ctx);
    const meta = JSON.parse(files.find((f) => f.name.endsWith('.meta.json'))!.content);
    expect(meta.scale).toMatchObject({ mode: 'fit' });
    expect(meta.animations).toBeUndefined();
  });

  it('engine formats get a meta sidecar with events, sockets and blend; Godot gets events_at()', async () => {
    const ctx = { ...makeContext(), blend: 'add' as const };
    const files = await renderProfile(BUILTIN_PROFILES.find((p) => p.id === 'phaser3')!, ctx);
    const meta = JSON.parse(files.find((f) => f.name === 'Character_Biker.meta.json')!.content);
    expect(meta.schema).toBe('ssg-meta/1');
    expect(meta.blend).toBe('add');
    expect(meta.clips.find((c: any) => c.name === 'Walk_F').events).toEqual([{ frame: 1, name: 'footstep_l' }]);
    expect(meta.animations[0].sockets[0]).toEqual({ hand_r: { x: 10, y: 20 } });
    const gd = (await renderProfile(BUILTIN_PROFILES.find((p) => p.id === 'godot4')!, ctx)).find((f) => f.name.endsWith('.gd'))!.content;
    expect(gd).toContain('"Walk_F": [{"frame": 1, "name": "footstep_l"}]');
    expect(gd).toContain('const BLEND := "add"');
    expect(gd).toContain('static func events_at(clip: String, frame: int) -> Array:');
    // Generic already carries everything: no sidecar.
    const generic = await renderProfile(BUILTIN_PROFILES.find((p) => p.id === 'generic')!, ctx);
    expect(generic.map((f) => f.name)).toEqual(['Character_Biker.json']);
    expect(JSON.parse(generic[0].content).blend).toBe('add');
  });

  it('generic JSON carries sockets, events and layers', async () => {
    const [f] = await renderProfile(BUILTIN_PROFILES.find((p) => p.id === 'generic')!, makeContext({}, grid, ['normal', 'shadow']));
    const g = JSON.parse(f.content);
    expect(g.layers).toEqual(['normal', 'shadow']);
    expect(g.clips.find((c: any) => c.name === 'Walk_F').events).toEqual([{ frame: 1, name: 'footstep_l' }]);
    expect(g.animations[0].frames[0].sockets).toEqual({ hand_r: { x: 10, y: 20 } });
  });

  /**
   * FB-001. Phaser 3.80 (JSONHash/JSONArray parsers + Frame.setTrim + Texture.setFrame): a frame with `pivot` gets
   * customPivot, the sprite's size is the frame's realWidth/realHeight (= sourceSize), origin = pivot, and the trimmed
   * image is drawn at (x, y) - origin * sourceSize + spriteSourceSize. Emulated from the JSON alone, the ground
   * pivot must land exactly on (x, y) and the opaque content where the untrimmed frame puts it.
   */
  it('phaser3: frame pivots put the ground point on the sprite position, trimmed or not', async () => {
    const phaser = BUILTIN_PROFILES.find((p) => p.id === 'phaser3')!;
    const atlas: LayoutSettings = { ...grid, mode: 'atlas', trim: true, padding: 2, extrude: 1, maxSize: 512 };
    const framesOf = async (ctx: ReturnType<typeof makeContext>) => {
      const json = JSON.parse((await renderProfile(phaser, ctx)).find((f) => f.name === 'Character_Biker.json')!.content);
      return new Map<string, any>(json.textures.flatMap((t: any) => t.frames.map((f: any) => [f.filename, f])));
    };
    // Where a pixel (px, py) of the frame's image lands for a sprite added at (0, 0).
    const screen = (f: any, px: number, py: number) => {
      const ox = f.pivot.x * f.sourceSize.w, oy = f.pivot.y * f.sourceSize.h; // displayOrigin over realWidth/Height
      const dx = f.trimmed ? f.spriteSourceSize.x : 0, dy = f.trimmed ? f.spriteSourceSize.y : 0;
      return [+(px - ox + dx).toFixed(6), +(py - oy + dy).toFixed(6)];
    };
    const untrimmed = await framesOf(makeContext());
    const trimmed = await framesOf(makeContext({}, atlas));
    expect(untrimmed.size).toBe(trimmed.size);
    const framingPivot = { x: 32, y: 56 }; // makeContext's framing; opaque rect at (16, 8) 32×50
    for (const [name, u] of untrimmed) {
      const t = trimmed.get(name);
      expect(u.trimmed).toBe(false);
      expect(t.trimmed).toBe(true);
      expect([t.spriteSourceSize.w, t.spriteSourceSize.h]).toEqual([32, 50]);
      // The ground pivot of the untrimmed frame is the sprite's position.
      expect(screen(u, framingPivot.x, framingPivot.y)).toEqual([0, 0]);
      // The trimmed image's first pixel is the untrimmed frame's (16, 8): both must land on the same screen point.
      expect(screen(t, 0, 0)).toEqual(screen(u, 16, 8));
      expect(screen(t, framingPivot.x - 16, framingPivot.y - 8)).toEqual([0, 0]);
      expect(t.pivot).toEqual(u.pivot);
    }
  });

  it('phaser3: animation keys are namespaced by the base (= texture key), so two models load together', async () => {
    const phaser = BUILTIN_PROFILES.find((p) => p.id === 'phaser3')!;
    const animsOf = async (asset: string, profile = phaser) => {
      const ctx = makeContext({ mirror: true }, grid, [], { asset, animationName: profile.animationName });
      return JSON.parse((await renderProfile(profile, { ...ctx, settings: profile.settings })).find((f) => f.name.endsWith('_anims.json'))!.content).anims as any[];
    };
    const a = await animsOf('SK_Character_American_Soldier_01');
    const b = await animsOf('SK_Character_German_Soldier_01');
    expect(a.map((x) => x.key)).toContain('Character_American_Soldier_01/Walk_F_E');
    const keys = [...a, ...b].map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Frames point at the texture with the same name as the prefix.
    for (const x of b) for (const f of x.frames) expect(f.key).toBe('Character_German_Soldier_01');
    // --anim-prefix '' gives the old bare keys; a custom prefix replaces the default (no doubling).
    expect((await animsOf('SK_Character_German_Soldier_01', withAnimPrefix(phaser, ''))).map((x) => x.key)).toContain('Walk_F_E');
    expect(withAnimPrefix(phaser, '{asset}:').animationName).toBe('{asset}:{clip}_{dir}');
    expect((await animsOf('SK_Character_German_Soldier_01', withAnimPrefix(phaser, '{asset}:')))[0].key).toMatch(/^SK_Character_German_Soldier_01:/);
    // Godot's helper builds names from its animPrefix setting: a literal prefix goes there too.
    const godot = withAnimPrefix(BUILTIN_PROFILES.find((p) => p.id === 'godot4')!, 'hero_');
    expect([godot.animationName, godot.settings.animPrefix]).toEqual(['hero_{clip}_{dir}', 'hero_']);
  });

  it('template errors name the file', async () => {
    const bad = { ...BUILTIN_PROFILES[0], files: [{ name: 'x.txt', template: '{% for %}' }] };
    await expect(renderProfile(bad, makeContext())).rejects.toThrow(/x\.txt/);
  });
});

describe('fighting-game meta (SF-FB-008/009): hit windows with the striking limb, per-frame body boxes', () => {
  const torso = { x: 20, y: 18, w: 24, h: 30 };
  const ctx = makeContext({ mirror: true }, grid, [], {
    events: (c) => (c === 'Death' ? [{ frame: 1, name: 'hit', limb: 'foot_r', endFrame: 2 }, { frame: 2, name: 'hit_end' }] : []),
    boxes: (k) => ({ torso: { ...torso, y: torso.y + Number(k.split('|')[2]) }, head: { x: 26, y: 4, w: 12, h: 14 } }),
  });
  it('meta.json: the hit carries limb and endFrame, and every frame has a torso box', () => {
    const meta = metaData(ctx)!;
    expect(meta.clips.find((c) => c.name === 'Death')!.events).toEqual([{ frame: 1, name: 'hit', limb: 'foot_r', endFrame: 2 }, { frame: 2, name: 'hit_end' }]);
    for (const a of meta.animations!) {
      expect(a.boxes, a.name).toHaveLength(a.sockets.length);
      a.boxes!.forEach((b, i) => expect(b.torso).toEqual({ ...torso, y: torso.y + i }));
    }
    expect(meta.note).toContain('x = frameWidth - x - w');
  });
  it('generic JSON frames carry the boxes too', () => {
    const g = genericData(ctx);
    expect(g.animations.every((a) => a.frames.every((f) => f.boxes?.torso))).toBe(true);
  });
  it('no boxes: the meta has none', () => {
    const meta = metaData(makeContext())!;
    expect(meta.animations![0]).not.toHaveProperty('boxes');
  });
});

describe('scale record (FB-019): every data file says which grid it was rendered for', () => {
  const tile = { mode: 'tile' as const, tilePx: 64, metresPerTile: 1, shape: 'diamond' as const };
  const layout = grid;
  const framing: Framing = { viewHalfW: 1, viewHalfH: 1, centreY: 1, frameWidth: 64, frameHeight: 64, pivot: { x: 32, y: 56 }, ppm: 32 };
  it('a character under a tile lock: generic json, meta.json and the layers manifest', () => {
    const ctx = makeContext({ scale: tile });
    const want = { mode: 'tile', pixelsPerMetre: 32, tilePx: 64, tileHeightPx: 32, metresPerTile: 1, shape: 'diamond' };
    expect(ctx.scale).toEqual(want);
    expect(genericData(ctx).scale).toEqual(want);
    expect(metaData(ctx)!.scale).toEqual(want);
    const m = buildLayersManifest({ body: ctx, bodyFiles: [], parts: [], z: () => ({}), occlusion: 'mask', alignment: { view: ctx.view, framing, layout, clips: [] } });
    expect(m.scale).toEqual(want);
  });
  it('square tiles, ppm and fit', () => {
    expect(scaleRecord({ scale: { mode: 'tile', tilePx: 32, metresPerTile: 2, shape: 'square' } }, 16)).toEqual({ mode: 'tile', pixelsPerMetre: 16, tilePx: 32, tileHeightPx: 32, metresPerTile: 2, shape: 'square' });
    expect(scaleRecord({ scale: { mode: 'ppm', ppm: 48 } }, 48)).toEqual({ mode: 'ppm', pixelsPerMetre: 48 });
    expect(scaleRecord({ scale: { mode: 'fit' } }, null)).toEqual({ mode: 'fit', pixelsPerMetre: null });
    expect(scaleRecord(undefined, null)).toEqual({ mode: 'fit', pixelsPerMetre: null });
    expect(makeContext({ scale: { mode: 'ppm', ppm: 32 } }).scale).toEqual({ mode: 'ppm', pixelsPerMetre: 32 });
  });
  it('SF-FB-024: a 1.3× model keeps the world\'s pixels per metre and records its own factor', () => {
    const ctx = makeContext({ scale: tile }, grid, [], { modelScale: 1.3 });
    const want = { mode: 'tile', pixelsPerMetre: 32, tilePx: 64, tileHeightPx: 32, metresPerTile: 1, shape: 'diamond', modelScale: 1.3 };
    expect(ctx.pixelsPerMetre).toBe(32);
    expect(ctx.scale).toEqual(want);
    expect(metaData(ctx)!.pixelsPerMetre).toBe(32);
    expect(metaData(ctx)!.scale).toEqual(want);
    expect(genericData(ctx).scale).toEqual(want);
    const m = buildLayersManifest({ body: ctx, bodyFiles: [], parts: [], z: () => ({}), occlusion: 'mask', alignment: { view: ctx.view, framing, layout, clips: [] } });
    expect(m.scale).toEqual(want);
    // Real size records nothing extra.
    expect(makeContext({ scale: tile }, grid, [], { modelScale: 1 }).scale).not.toHaveProperty('modelScale');
    expect(scaleRecord({ scale: { mode: 'ppm', ppm: 48 } }, 48, 0.75)).toEqual({ mode: 'ppm', pixelsPerMetre: 48, modelScale: 0.75 });
  });
  it('SF-FB-025: a still is a one-frame, non-looping animation per direction in every format', async () => {
    const ctx = makeContext({ scale: tile }, grid, [], { clips: [{ name: 'Walk_F', loop: true, frameCount: 4 }, { name: 'Victory_still', loop: false, frameCount: 1 }] });
    const still = ctx.animations.filter((a) => a.clip === 'Victory_still');
    expect(still.length).toBe(ctx.directions.length);
    expect(still.every((a) => a.frames.length === 1 && !a.loop && a.from === a.to)).toBe(true);
    expect(metaData(ctx)!.clips.find((c) => c.name === 'Victory_still')).toMatchObject({ frameCount: 1, loop: false, events: [] });
    for (const p of BUILTIN_PROFILES.filter((x) => !x.special)) {
      const files = await renderProfile(p, ctx);
      expect(files.length, p.id).toBeGreaterThan(0);
      expect(files.map((f) => String(f.content)).join('\n'), p.id).toContain('Victory_still');
    }
  });
  it('every built-in format writes it into its data file', async () => {
    const ctx = makeContext({ scale: tile });
    let checked = 0;
    for (const p of BUILTIN_PROFILES) {
      const files = await renderProfile(p, ctx);
      const data = files.find((f) => f.name === `${ctx.base}.meta.json`) ?? files.find((f) => f.name === `${ctx.base}.json` && p.id === 'generic');
      if (!data) continue;
      expect(JSON.parse(data.content).scale, p.id).toMatchObject({ mode: 'tile', tilePx: 64 });
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });
  it('the collision slice height does not change the alignment signature', () => {
    const ctx = makeContext({ scale: tile });
    const a = { view: ctx.view, framing, layout, clips: [] };
    expect(alignmentSignature({ ...a, view: { ...a.view, collisionHeight: 1 } })).toBe(alignmentSignature(a));
  });
});
