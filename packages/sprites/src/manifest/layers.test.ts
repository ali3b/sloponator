// Moved from synty-sprite-generator packages/shared/src/export/layers.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS, resolveDirections, type Framing, type ViewConfig } from '../view/camera.js';
import { buildContext, frameKey, type ClipInput, type ExportContext } from './context.js';
import { layoutFrames, type FrameInput, type LayoutSettings } from '../layout/layout.js';
import {
  alignmentSignature, applyDepthRule, buildLayersManifest, diffParts, drawOrder, dropPartsFromManifest, layersHelperFiles, mergeManifests, outfitPresets, slotFor, uniquePartNames, type LayersManifest,
} from './layers.js';
import { validateSheets } from '../validate/validate.js';
import type { LoadoutItem } from '../inputs/combat.js';

const grid: LayoutSettings = { mode: 'grid', grouping: 'single', trim: false, padding: 0, extrude: 0, powerOfTwo: false, maxSize: 4096 };
const atlas: LayoutSettings = { ...grid, mode: 'atlas', trim: true, padding: 2, extrude: 1, maxSize: 512 };
const view: ViewConfig = { ...VIEW_PRESETS.find((p) => p.id === 'iso8')!.config, mirror: true };
const framing: Framing = { viewHalfW: 1, viewHalfH: 1, centreY: 1, frameWidth: 64, frameHeight: 64, pivot: { x: 32, y: 56 }, ppm: 32 };
const clips: ClipInput[] = [{ name: 'Walk_F', loop: true, frameCount: 4 }, { name: 'Attack', loop: false, frameCount: 3 }];

function frames(dirs: string[], opaque = { x: 16, y: 8, w: 32, h: 50 }): FrameInput[] {
  return clips.flatMap((c) => dirs.flatMap((d) => Array.from({ length: c.frameCount }, (_, i) => ({ key: frameKey(c.name, d, i), clip: c.name, direction: d, index: i, width: 64, height: 64, opaque }))));
}

/** A body context and part contexts that share one layout (as the exporter makes them). */
function sheets(layout = grid, partNames = ['weapon', 'head']) {
  const dirs = resolveDirections(view);
  const rendered = dirs.filter((d) => d.mirrorOf === null).map((d) => d.name);
  const pages = layoutFrames(frames(rendered), layout);
  const where = new Map(pages.flatMap((p) => p.placements.map((pl) => [pl.key, { page: p.index, p: pl }])));
  const common = { view, framing, directions: dirs, clips, pages, placement: (k: string) => where.get(k)!, pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: '{clip}_{dir}' };
  const body = buildContext({ ...common, asset: { name: 'SK_Character_Biker', pack: 'P', kind: 'character' }, sockets: () => ({ attach_weapon: { x: 40, y: 30 } }) });
  const parts = partNames.map((name) => buildContext({ ...common, base: `Character_Biker_${name}`, asset: { name: `SM_${name}`, pack: 'P', kind: name === 'weapon' ? 'weapon' : 'attachment' } }));
  return { body, parts, pages, layout };
}

function manifestInput(s = sheets()): Parameters<typeof buildLayersManifest>[0] {
  const z = (clip: string, dir: string, i: number) => ({ weapon: dir === 'N' ? -0.2 : 0.3 + i * 0.01, head: 0.05 });
  return {
    body: s.body, bodyFiles: ['Character_Biker.json'],
    parts: s.parts.map((ctx, i) => ({ ctx, files: [`${ctx.base}.json`], info: { name: ['weapon', 'head'][i], slot: ['weapon', 'head'][i] as 'weapon' | 'head', kind: ctx.asset.kind, asset: ctx.asset.name, bone: 'Hand_R', blend: 'normal', depth: 'auto' } })),
    z, offset: () => ({ weapon: { x: 40, y: 30 } }), occlusion: 'mask',
    alignment: { view, framing, layout: s.layout, clips: clips.map((c) => ({ name: c.name, loop: c.loop, times: [0, 0.1, 0.2] })) },
  };
}
const manifest = (s = sheets()): LayersManifest => buildLayersManifest(manifestInput(s));

describe('slots and names', () => {
  it('slotFor', () => {
    expect(slotFor('SM_Wep_American_Rifle_01', 'weapon')).toBe('weapon');
    expect(slotFor('SM_Prop_Shield_01', 'weapon')).toBe('offhand');
    expect(slotFor('SM_Char_Attach_American_Helmet_01', 'attachment')).toBe('head');
    expect(slotFor('SM_Char_Attach_Hair_02', 'attachment')).toBe('hair');
    expect(slotFor('SM_Gen_Chr_Attach_Ponytail_01', 'attachment')).toBe('hair');
    expect(slotFor('SM_Chr_Attach_Backpack_01', 'attachment')).toBe('back');
    expect(slotFor('SM_Chr_Attach_Armour_01', 'attachment')).toBe('body');
    expect(slotFor('SM_Chr_Attach_Watch_01', 'attachment')).toBe('accessory');
    expect(slotFor('FX_Cone_01', 'fx')).toBe('fx');
  });
  it('uniquePartNames', () => {
    expect(uniquePartNames([{ slot: 'weapon' }, { slot: 'weapon' }, { slot: 'head', layer: 'Helmet A' }, { slot: 'head', layer: 'helmet_a' }])).toEqual(['weapon', 'weapon_2', 'helmet_a', 'helmet_a_2']);
    expect(uniquePartNames([{ slot: 'weapon' }], ['weapon', 'head'])).toEqual(['weapon_2']);
  });
  it('drawOrder and depth rules', () => {
    expect(drawOrder({ weapon: 0.3, cape: -0.4, hair: 0.05, shield: -0.1 })).toEqual(['cape', 'shield', 'body', 'hair', 'weapon']);
    expect(drawOrder({ weapon: 0.3, cape: -0.4 }, 'mask')).toEqual(['body', 'cape', 'weapon']);
    expect(applyDepthRule(-0.3, 'front', 'E')).toBeGreaterThan(0);
    expect(applyDepthRule(0.3, 'back', 'E')).toBeLessThan(0);
    expect(applyDepthRule(0.3, { N: 'back' }, 'N')).toBeLessThan(0);
    expect(applyDepthRule(0.3, { N: 'back' }, 'S')).toBe(0.3);
    expect(applyDepthRule(0.3, 'auto', 'S')).toBe(0.3);
  });
});

describe('manifest', () => {
  it('lines up with every sheet and copies z to mirrored directions', () => {
    const s = sheets();
    const m = manifest(s);
    expect(m.schema).toBe('ssg-layers/1');
    expect(m.parts.map((p) => p.base)).toEqual(['Character_Biker_weapon', 'Character_Biker_head']);
    expect(m.animations).toHaveLength(s.body.animations.length);
    for (const a of m.animations) {
      const ctxA = s.body.animations.find((x) => x.name === a.name)!;
      expect(a.frames).toHaveLength(ctxA.frames.length);
      for (const p of s.parts) expect(p.animations.find((x) => x.name === a.name)!.frames.map((f) => [f.x, f.y, f.w, f.h])).toEqual(ctxA.frames.map((f) => [f.x, f.y, f.w, f.h]));
    }
    const n = m.animations.find((a) => a.name === 'Walk_F_N')!, s2 = m.animations.find((a) => a.name === 'Walk_F_S')!;
    expect(n.frames[0].z.weapon).toBeLessThan(0);
    expect(s2.frames[0].z.weapon).toBeGreaterThan(0);
    expect(n.frames[0].front.weapon).toBe(true); // masked sheets always draw over the body
    const whole = buildLayersManifest({ ...manifestInput(s), occlusion: 'none' });
    expect(whole.animations.find((a) => a.name === 'Walk_F_N')!.frames[0].front.weapon).toBe(false);
    const w = m.animations.find((a) => a.name === 'Walk_F_W')!, e = m.animations.find((a) => a.name === 'Walk_F_E')!;
    expect(w.flipX).toBe(true);
    expect(w.frames.map((f) => f.z.weapon)).toEqual(e.frames.map((f) => f.z.weapon));
    expect(w.frames[0].offset.weapon).toEqual({ x: 40, y: 30 });
    expect(m.alignment.signature).toMatch(/^[0-9a-f]{16}$/);
    expect(m.alignment.parts).toEqual(['weapon', 'head']);
  });
  it('signature ignores key order', () => {
    const a = { view, framing, layout: grid, clips: [{ name: 'A', loop: true, times: [0, 1] }] };
    const b = { clips: [{ times: [0, 1], loop: true, name: 'A' }], layout: { ...grid }, framing: { ...framing }, view: { ...view } };
    expect(alignmentSignature(a)).toBe(alignmentSignature(b));
    expect(alignmentSignature({ ...a, framing: { ...framing, pivot: { x: 1, y: 2 } } })).not.toBe(alignmentSignature(a));
  });
  it('godot helper lists every part; other formats get nothing', async () => {
    const m = manifest();
    const files = await layersHelperFiles('godot4', m);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('Character_Biker_layers.gd');
    expect(files[0].content).toContain('Character_Biker_weapon.tres');
    expect(files[0].content).toContain('Character_Biker_head.tres');
    expect(files[0].content).toContain('class_name CharacterBikerLayers');
    expect(files[0].content).toContain('"Walk_F_N": [{ "weapon": true, "head": true }');
    expect(await layersHelperFiles('generic', m)).toEqual([]);
  });
  it('weapon classes: clip and part classes reach the manifest and the godot helper hides other classes', async () => {
    const inp = manifestInput();
    const m = buildLayersManifest({
      ...inp,
      parts: inp.parts.map((p) => (p.info.name === 'weapon' ? { ...p, info: { ...p.info, cls: 'rifle' } } : p)),
      clipClass: () => 'rifle',
      classes: [{ id: 'unarmed', label: 'Unarmed' }, { id: 'rifle', label: 'Rifle' }],
    });
    expect(m.classes).toEqual([{ id: 'unarmed', label: 'Unarmed' }, { id: 'rifle', label: 'Rifle' }]);
    expect(m.clips.every((c) => c.cls === 'rifle')).toBe(true);
    expect(m.parts.find((p) => p.name === 'weapon')?.cls).toBe('rifle');
    expect(m.parts.find((p) => p.name === 'head')?.cls).toBeUndefined();
    const [gd] = await layersHelperFiles('godot4', m);
    expect(gd.content).toContain('"name": "weapon", "res": "Character_Biker_weapon.tres", "blend": "normal", "cls": "rifle"');
    expect(gd.content).toContain('"name": "head", "res": "Character_Biker_head.tres", "blend": "normal", "cls": ""');
    expect(gd.content).toContain('anim.begins_with(cls + "_")');
  });

  it('merges an aligned export (new part, same clips)', () => {
    const base = manifest();
    const add = { ...manifest(), parts: [{ ...base.parts[0], name: 'shield', base: 'Character_Biker_shield', slot: 'offhand' as const }], animations: base.animations.map((a) => ({ ...a, frames: a.frames.map(() => ({ z: { shield: -0.1 }, front: { shield: false }, offset: {} })) })) };
    const m = mergeManifests(base, add);
    expect(m.parts.map((p) => p.name)).toEqual(['weapon', 'head', 'shield']);
    expect(m.alignment.parts).toEqual(['weapon', 'head', 'shield']);
    expect(m.alignment.signature).toBe(base.alignment.signature);
    expect(m.animations[0].frames[0].z).toEqual({ ...base.animations[0].frames[0].z, shield: -0.1 });
  });
});

describe('validation', () => {
  it('passes a consistent layered export', () => {
    const s = sheets(atlas);
    expect(validateSheets([s.body, ...s.parts], { layout: atlas })).toEqual([]);
  });
  it('flags mismatches', () => {
    const s = sheets();
    const other = sheets().body;
    const shifted: ExportContext = { ...other, pivot: { x: 1, y: 1 }, frameWidth: 32 };
    const codes = validateSheets([s.body, shifted], { layout: grid }).map((i) => i.code);
    expect(codes).toContain('pivot_mismatch');
    expect(codes).toContain('size_mismatch');
    const fewer: ExportContext = { ...other, animations: other.animations.map((a) => ({ ...a, frames: a.frames.slice(1) })) };
    expect(validateSheets([s.body, fewer], { layout: grid }).map((i) => i.code)).toContain('frame_count');
    expect(validateSheets([s.body], { layout: { ...atlas, padding: 0 } }).map((i) => i.code)).toContain('bleeding');
    const gappy: ExportContext = { ...other, clips: other.clips.map((c) => ({ ...c, animations: c.animations.map((a) => ({ ...a, frames: a.frames.slice(1) })) })) };
    expect(validateSheets([gappy], { layout: grid }).map((i) => i.code)).toContain('missing_frames');
  });
});

describe('diffParts', () => {
  const prev = { parts: [{ name: 'head', asset: 'SM_Helmet' }, { name: 'hair', asset: 'SM_Hair' }], loadout: [{ asset: 5, layer: 'head' }, { asset: 6, layer: 'hair' }] };
  it('finds nothing to render when the earlier export already has every part unchanged', () => {
    const r = diffParts(prev, [{ name: 'head', asset: 'SM_Helmet', item: { asset: 5, layer: 'head' } }, { name: 'hair', asset: 'SM_Hair', item: { asset: 6, layer: 'hair' } }]);
    expect(r).toEqual({ missing: [], extra: [] });
  });
  it('renders new or changed items and drops layers this render does not want', () => {
    // Same model, another sprite: a helmet from a different asset, no hair, a new cape.
    const r = diffParts(prev, [{ name: 'head', asset: 'SM_Helmet2', item: { asset: 9, layer: 'head' } }, { name: 'cape', asset: 'SM_Cape', item: { asset: 7, layer: 'cape' } }]);
    expect(r.missing.map((p) => p.name)).toEqual(['head', 'cape']);
    // The old helmet sheet goes too (the new helmet takes its name), and the unwanted hair.
    expect(r.extra).toEqual(['head', 'hair']);
  });
  it('treats a changed option on the same asset as a new render of that part, dropping its old sheet first', () => {
    const r = diffParts(prev, [{ name: 'head', asset: 'SM_Helmet', item: { asset: 5, layer: 'head', scale: 1.2 } }]);
    expect(r.missing.map((p) => p.name)).toEqual(['head']);
    expect(r.extra).toEqual(['head', 'hair']);
  });
  it('a swapped item under the same layer name replaces the old sheet rather than sitting beside it', () => {
    const r = diffParts(prev, [{ name: 'head', asset: 'SM_Helmet', item: { asset: 5, layer: 'head' } }, { name: 'hair', asset: 'SM_Hair_02', item: { asset: 12, layer: 'hair' } }]);
    expect(r.missing.map((p) => p.name)).toEqual(['hair']);
    expect(r.extra).toEqual(['hair']);
  });
});

describe('outfit presets', () => {
  const part = (name: string, item?: { asset: number; layer?: string; cls?: string }) =>
    ({ name, slot: 'head', kind: 'attachment', asset: name, bone: 'Head', blend: 'normal', depth: 'auto', base: `b_${name}`, pages: [], files: [], ...(item ? { item } : {}) }) as LayersManifest['parts'][number];
  const manifest = (parts: LayersManifest['parts'], loadout: LoadoutItem[] = []) =>
    ({ parts, source: { set: { id: 's', name: 's', items: [] }, gender: 'auto', loadout }, animations: [], alignment: { parts: parts.map((p) => p.name) } }) as unknown as LayersManifest;

  it('maps outfit items to parts by the item each part records', () => {
    const m = manifest([part('head', { asset: 7, layer: 'head' }), part('head_hat', { asset: 8, layer: 'head_hat' }), part('weapon_rifle', { asset: 5, layer: 'weapon_rifle', cls: 'rifle' })]);
    const presets = outfitPresets(m, [{ id: 'base', name: 'Base', items: ['7:head:', '5:weapon_rifle:rifle'] }, { id: 'hat', name: 'Hat', items: ['8:head_hat:', '99:x:'] }]);
    expect(presets).toEqual([{ id: 'base', name: 'Base', parts: ['head', 'weapon_rifle'] }, { id: 'hat', name: 'Hat', parts: ['head_hat'] }]);
  });

  it('falls back to the source loadout order for exports made before parts recorded their item', () => {
    const m = manifest([part('head'), part('back')], [{ asset: 7 }, { asset: 9, layer: 'back' }]);
    expect(outfitPresets(m, [{ id: 'o', name: 'O', items: ['7:head:', '9:back:'] }])[0].parts).toEqual(['head', 'back']);
  });

  it('drops removed parts from the presets', () => {
    const m = { ...manifest([part('head', { asset: 7 }), part('back', { asset: 9 })]), outfits: [{ id: 'o', name: 'O', parts: ['head', 'back'] }] } as LayersManifest;
    expect(dropPartsFromManifest(m, ['back']).outfits).toEqual([{ id: 'o', name: 'O', parts: ['head'] }]);
  });
});

describe('adding clips to a layered export', () => {
  it('keeps every sheet\'s pages, appends the new clips to the alignment and refreshes its signature', () => {
    const base = manifest();
    const add: LayersManifest = {
      ...base,
      clips: [{ ...base.clips[0], name: 'Shoot' }],
      body: { ...base.body, pages: ['Character_Biker_9.png'] },
      parts: base.parts.map((p) => ({ ...p, pages: [`${p.base}_9.png`] })),
      alignment: { ...base.alignment, clips: [...base.alignment.clips, { name: 'Shoot', loop: false, times: [0, 0.1] }] },
      animations: base.animations.filter((a) => a.clip === 'Walk_F').map((a) => ({ ...a, name: a.name.replace('Walk_F', 'Shoot'), clip: 'Shoot' })),
    };
    const m = mergeManifests(base, add);
    expect(m.parts[0].pages).toEqual([...base.parts[0].pages, `${base.parts[0].base}_9.png`]);
    expect(m.body.pages).toEqual([...base.body.pages, 'Character_Biker_9.png']);
    expect(m.alignment.clips.map((c) => c.name)).toEqual(['Walk_F', 'Attack', 'Shoot']);
    expect(m.alignment.signature).not.toBe(base.alignment.signature);
    expect(m.alignment.pages).toBe(base.body.pages.length + 1);
    expect(m.clips.map((c) => c.name)).toEqual(['Walk_F', 'Attack', 'Shoot']);
  });
});
