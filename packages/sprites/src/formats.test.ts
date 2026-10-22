/**
 * The writers of this package produce what @slop/formats describes: every manifest they build validates against
 * its schema, and the view/framing/layout types the renderer uses are the very types the formats carry.
 */
import { describe, expect, it } from 'vitest';
import * as formats from '@slop/formats';
import { VIEW_PRESETS, resolveDirections, type Framing, type ViewConfig } from './view/camera.js';
import { buildContext, frameKey, type ClipInput } from './manifest/context.js';
import { genericData, metaData } from './manifest/meta.js';
import { layoutFrames, type FrameInput, type LayoutSettings } from './layout/layout.js';
import { buildLayersManifest } from './manifest/layers.js';
import { splitBlock } from './manifest/split.js';
import { turretBlock, turretMounts } from './manifest/turret.js';
import { objectInfo, objectStates, type Vec2 } from './object/footprint.js';
import { objectSlices } from './object/slices.js';
import { BUILTIN_PROFILES } from './profiles/profiles.js';
import { renderProfile } from './profiles/render.js';
import { bodyBoxes } from './events/bodyBoxes.js';
import type { AnimationSet } from './inputs/batch.js';
import type { LoadoutItem } from './inputs/combat.js';

// Type-level: the renderer's view, framing and layout are assignable to the formats' and back (a field added on one
// side only fails this file's typecheck).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _view: Same<ViewConfig, formats.ViewConfig> = true;
const _framing: Same<Framing, formats.Framing> = true;
const _layout: Same<LayoutSettings, formats.LayoutSettings> = true;
// The manifest's `source` keeps the generator's own recipe loosely: an animation set and loadout items fit in.
const _set: AnimationSet extends formats.SsgLayers['alignment'] ? never : (AnimationSet extends NonNullable<formats.SsgLayers['source']>['set'] ? true : false) = true;
const _item: LoadoutItem extends NonNullable<formats.SsgLayers['source']>['loadout'][number] ? true : false = true;
void [_view, _framing, _layout, _set, _item];

const grid: LayoutSettings = { mode: 'grid', grouping: 'single', trim: false, padding: 0, extrude: 0, powerOfTwo: false, maxSize: 4096 };
const atlas: LayoutSettings = { ...grid, mode: 'atlas', trim: true, padding: 2, extrude: 1, maxSize: 512 };
const iso = VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
const tileView: ViewConfig = { ...iso, mirror: true, scale: { mode: 'tile', tilePx: 64, metresPerTile: 1, shape: 'diamond' }, padding: 2, frameWidth: 16, frameHeight: 16 };
const clips: ClipInput[] = [{ name: 'Walk_F', loop: true, frameCount: 4, speedMps: 1.4 }, { name: 'Attack', loop: false, frameCount: 3 }];

function frames(dirs: string[], size = 64): FrameInput[] {
  return clips.flatMap((c) => dirs.flatMap((d) => Array.from({ length: c.frameCount }, (_, i) => ({ key: frameKey(c.name, d, i), clip: c.name, direction: d, index: i, width: size, height: size, opaque: { x: 16, y: 8, w: 32, h: 50 } }))));
}

/** A character context with sockets, boxes and events, plus the contexts of two part sheets on the same layout. */
function character(layout = grid) {
  const view: ViewConfig = { ...iso, mirror: true };
  const dirs = resolveDirections(view);
  const rendered = dirs.filter((d) => d.mirrorOf === null).map((d) => d.name);
  const pages = layoutFrames(frames(rendered), layout);
  const where = new Map(pages.flatMap((p) => p.placements.map((pl) => [pl.key, { page: p.index, p: pl }])));
  const framing: Framing = { viewHalfW: 1, viewHalfH: 1, centreY: 1, frameWidth: 64, frameHeight: 64, pivot: { x: 32, y: 56 }, ppm: 32 };
  const common = { view, framing, directions: dirs, clips, pages, placement: (k: string) => where.get(k)!, pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: '{base}/{clip}_{dir}' };
  const joints = { head: { x: 32, y: 12 }, head_top: { x: 32, y: 6 }, neck: { x: 32, y: 16 }, hips: { x: 32, y: 34 }, spine: { x: 32, y: 28 }, foot_l: { x: 28, y: 56 }, foot_r: { x: 36, y: 56 } };
  const body = buildContext({
    ...common, asset: { name: 'SK_Character_Biker', pack: 'POLYGON_City_Characters', kind: 'character' },
    sockets: () => ({ hand_r: { x: 40, y: 30 }, weapon_tip: { x: 52.5, y: 28.25 } }),
    boxes: () => bodyBoxes(joints, 32),
    events: (c) => (c === 'Walk_F' ? [{ frame: 1, name: 'footstep_l' }, { frame: 3, name: 'footstep_r' }] : [{ frame: 1, name: 'hit', limb: 'hand_r', endFrame: 2 }, { frame: 2, name: 'hit_end' }]),
    modelScale: 1.3,
  });
  const parts = ['weapon', 'head'].map((name) => buildContext({ ...common, base: `Character_Biker_${name}`, asset: { name: `SM_${name}`, pack: 'P', kind: name === 'weapon' ? 'weapon' : 'attachment' } }));
  return { body, parts, pages, layout, view, framing };
}

/** An object (a tree with a trunk) on a diamond tile lock, with a damaged state and column slices. */
function tree() {
  const dirs = resolveDirections(tileView);
  const rect = (w: number, d: number, y0: number, y1: number) => {
    const pts: Vec2[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    return { points: [...pts, ...pts], heights: [y0, y0, y0, y0, y1, y1, y1, y1] };
  };
  const trunk = rect(0.4, 0.4, 0, 1), canopy = rect(3, 3, 1.2, 4);
  const framing: Framing = { viewHalfW: 2, viewHalfH: 3, centreY: 1.5, frameWidth: 180, frameHeight: 270, pivot: { x: 90, y: 230 }, ppm: 45.2548 };
  const input = { points: [...trunk.points, ...canopy.points], heights: [...trunk.heights, ...canopy.heights], minY: 0, maxY: 4, view: tileView, framing, directions: dirs, subject: { name: 'SM_Env_Tree_03', kind: 'prop' } };
  const base = objectInfo(input)!;
  const damaged = objectInfo({ ...input, points: trunk.points, heights: trunk.heights, maxY: 1 })!;
  const info = objectStates(base, [
    { name: 'intact', animation: 'intact', asset: 'SM_Env_Tree_03', info: base },
    { name: 'damaged', animation: 'damaged', asset: 'SM_Env_Tree_03_Damaged', look: 'scorch', info: damaged },
  ], [{ animation: 'intact_to_damaged', from: 'intact', to: 'damaged', asset: 'SM_Env_Tree_03' }]);
  info.slices = objectSlices(info, tileView, framing) ?? undefined;
  const pages = layoutFrames(frames(dirs.filter((d) => d.mirrorOf === null).map((d) => d.name), 180), grid);
  const where = new Map(pages.flatMap((p) => p.placements.map((pl) => [pl.key, { page: p.index, p: pl }])));
  const ctx = buildContext({
    asset: { name: 'SM_Env_Tree_03', pack: 'POLYGON_War', kind: 'prop' }, view: tileView, framing, directions: dirs, clips, pages,
    placement: (k) => where.get(k)!, pageFile: '{base}_{page}.png', frameName: '{clip}_{dir}_{i}', animationName: '{clip}_{dir}',
    object: info, pivots: { source: 'anchor', pivot: info.anchor!, byDirection: Object.fromEntries(info.directions.map((d) => [d.name, d.anchor])) },
  });
  return { ctx, info, framing, dirs };
}

const valid = (f: formats.FormatSpec, data: unknown) => expect(formats.checkFormat(f, JSON.parse(JSON.stringify(data)))).toEqual([]);
const format = (id: string) => formats.formatById(id)!;

describe('the writers produce what @slop/formats describes', () => {
  it('ssg-meta/1 of a character: sockets, boxes, events with limbs, model scale', () => {
    const meta = metaData(character().body);
    valid(format('ssg-meta/1'), meta);
    expect(meta.animations?.[0]?.boxes?.[0]?.torso).toBeDefined();
    expect(meta.scale.modelScale).toBe(1.3);
    expect(meta.clips.find((c) => c.name === 'Attack')?.events[0]).toMatchObject({ limb: 'hand_r', endFrame: 2 });
  });

  it('ssg-meta/1 and the object block of a tree with states and slices; anchors as pivots', () => {
    const { ctx } = tree();
    const meta = metaData(ctx);
    valid(format('ssg-meta/1'), meta);
    valid(format('ssg-object'), meta.object);
    expect(meta.pivotSource).toBe('anchor');
    expect(meta.object?.collision.source).toBe('base');
    expect(meta.object?.canopy).toBeDefined();
    expect(meta.object?.states?.map((s) => s.name)).toEqual(['intact', 'damaged']);
    expect(meta.object?.transitions?.[0]?.animation).toBe('intact_to_damaged');
    expect(meta.object?.slices?.mode).toBe('columns');
    expect(meta.object?.directions.every((d) => d.facing !== undefined)).toBe(true);
  });

  it('the generic sheet JSON of both, and the .sheet.json written next to every format', async () => {
    valid(format('ssg-sheet'), genericData(character(atlas).body));
    valid(format('ssg-sheet'), genericData(tree().ctx));
    const generic = BUILTIN_PROFILES.find((p) => p.id === 'generic')!;
    const [file] = await renderProfile(generic, character().body);
    expect(file!.name).toBe('Character_Biker.json');
    valid(format('ssg-sheet'), JSON.parse(file!.content));
  });

  it('every built-in format\'s meta.json validates, and the phaser3 anims JSON too', async () => {
    const ctx = character(atlas).body;
    for (const p of BUILTIN_PROFILES.filter((p) => !p.special)) {
      const files = await renderProfile(p, ctx);
      const meta = files.find((f) => f.name === 'Character_Biker.meta.json');
      if (p.id === 'generic') expect(meta).toBeUndefined();
      else valid(format('ssg-meta/1'), JSON.parse(meta!.content));
      const anims = files.find((f) => f.name.endsWith('_anims.json'));
      if (p.id === 'phaser3') {
        const data = JSON.parse(anims!.content);
        expect(formats.detectFormat(anims!.name, data)?.id).toBe('phaser3-anims');
        valid(format('phaser3-anims'), data);
        expect((data as formats.PhaserAnims).anims[0]!.key).toBe('Character_Biker/Walk_F_E');
      }
    }
  });

  it('ssg-layers/1 with parts, classes and the source recipe', () => {
    const s = character();
    const set: AnimationSet = { id: 'builtin_melee', name: 'Melee', items: [{ type: 'match', pattern: 'walk', label: 'walk' }] };
    const loadout: LoadoutItem[] = [{ asset: 12, layer: 'weapon', cls: 'sword', depth: { N: 'back' } }];
    const m = buildLayersManifest({
      body: s.body, bodyFiles: ['Character_Biker.json'],
      parts: s.parts.map((ctx, i) => ({ ctx, files: [`${ctx.base}.json`], info: { name: ['weapon', 'head'][i]!, slot: (['weapon', 'head'] as const)[i]!, kind: ctx.asset.kind, asset: ctx.asset.name, bone: 'Hand_R', blend: 'normal', depth: i ? 'auto' : { N: 'back' }, ...(i ? {} : { cls: 'sword', item: { asset: 12, layer: 'weapon', cls: 'sword' } }) } })),
      z: (_c, dir, i) => ({ weapon: dir === 'N' ? -0.2 : 0.3 + i * 0.01, head: 0.05 }), offset: () => ({ weapon: { x: 40, y: 30 } }), occlusion: 'mask',
      clipClass: () => 'sword', classes: [{ id: 'sword', label: 'Sword' }],
      alignment: { view: s.view, framing: s.framing, layout: s.layout, clips: clips.map((c) => ({ name: c.name, loop: c.loop, times: [0, 0.1, 0.2] })) },
      validation: [{ level: 'warn', code: 'bleeding', message: 'atlas padding under 2' }],
    });
    m.source = { set, gender: 'auto', loadout, profile: 'phaser3' };
    m.outfits = [{ id: 'bare', name: 'Bare', parts: ['head'] }];
    valid(format('ssg-layers/1'), m);
    expect(m.alignment.signature).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ssg-split/1 and ssg-turret/1 blocks, inside a meta.json and on their own', () => {
    const sheets = { bones: { hips: 'Hips', spine: 'Spine_01' }, legs: { base: 'X_legs', files: ['X_legs.json'], clips: ['walk'] }, torso: { base: 'X_torso', files: ['X_torso.json'], clips: ['aim'] }, whole: { base: 'X', files: ['X.json'], clips: ['walk', 'aim', 'death'] } };
    const split = splitBlock({ sheet: 'legs', ...sheets });
    valid(format('ssg-split/1'), split);
    const { dirs, framing } = tree();
    const mounts = turretMounts({ axis: { x: 0, y: 1.8, z: -0.3 }, pitch: tileView.pitch, framing, directions: dirs, pivotOf: () => framing.pivot });
    const turret = turretBlock({ base: 'Tank_turret', files: ['Tank_turret.json'], parts: ['Turret', 'Barrel'], axis: { x: 0, y: 1.8, z: -0.3 }, pixelsPerMetre: framing.ppm, clips: ['turret', 'turret_fire'], mounts, directions: dirs });
    valid(format('ssg-turret/1'), turret);
    expect(turret.mounts).toHaveLength(dirs.length);
    const meta: formats.SsgMeta = { ...metaData(character().body), split, turret };
    valid(format('ssg-meta/1'), meta);
    expect(formats.detectFormat('X_legs.meta.json', meta)?.id).toBe('ssg-meta/1');
  });
});
