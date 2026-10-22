// Ported from synty-sprite-generator packages/shared/src/sprite/spec.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { BUILTIN_SETS, setItemLabel } from '@slop/sprites';
import { applyLook, applySize, applyViewCard, initialState, parseModelScale, reducer, toBatchSpec, effectiveSet, itemKey, outfitsOf, saveOutfit, switchOutfit, wornItems, setMoveItem, addStillMove, type WizardState } from '../../src/plan/state.js';
import { RENDERER_VERSION, defaultProjectDefaults, effectiveSpec, forcePlan, planChange, planStatus, projectDefaultsOf, specClips, specOf, stateOf, type RenderedState, type SpriteSpec } from '../../src/plan/spriteSpec.js';

const sets = BUILTIN_SETS;
const base = (): SpriteSpec => specOf({ ...initialState(), assetIds: [1] });
const rendered = (spec: SpriteSpec): RenderedState => ({ spec, clips: specClips(spec, sets), loadout: spec.loadout });

describe('sprite spec', () => {
  it('round-trips through wizard state without the UI fields', () => {
    const s = { ...initialState(), step: 3, presetId: 'x', previewItem: 2 };
    const spec = specOf(s);
    expect(spec).not.toHaveProperty('step');
    expect(spec).not.toHaveProperty('presetId');
    expect(spec.version).toBe(1);
    const back = stateOf(spec, 1);
    expect(back.step).toBe(1);
    expect(back.presetId).toBeNull();
    expect(specOf(back)).toEqual(spec);
  });

  it('inherits the project view, look, size and engine; props keep fit-to-frame', () => {
    let proj = stateOf({ ...defaultProjectDefaults(), ...base() });
    proj = applyViewCard(proj, 'side2');
    proj = applyLook(proj, 'pixel');
    proj = applySize(proj, 'small');
    const project = projectDefaultsOf({ ...specOf(proj), profileId: 'godot4' });
    const sprite: SpriteSpec = { ...base(), inherit: ['view', 'look', 'size', 'engine'], view: { ...base().view, fps: 24 } };
    const eff = effectiveSpec(project, sprite);
    expect(eff.viewCardId).toBe('side2');
    expect(eff.view.directions).toBe('2');
    expect(eff.view.fps).toBe(24); // fps stays the sprite's own
    expect(eff.lookId).toBe('pixel');
    expect(eff.view.quality?.style).toBe('pixel');
    expect(eff.sizeId).toBe('small');
    expect(eff.view.scale).toEqual({ mode: 'ppm', ppm: 32 });
    expect(eff.profileId).toBe('godot4');
    const prop = effectiveSpec(project, { ...sprite, kind: 'prop' });
    expect(prop.view.scale.mode).toBe('fit');
    expect(prop.view.frameWidth).toBe(64);
    // Objects (scenery) share the characters' real-world scale.
    const object = effectiveSpec(project, { ...sprite, kind: 'object' });
    expect(object.view.scale).toEqual({ mode: 'ppm', ppm: 32 });
    // A sprite that follows nothing is returned as is.
    expect(effectiveSpec(project, { ...sprite, inherit: [] })).toEqual({ ...sprite, inherit: [] });
  });

  it('objects take a project\'s tile lock; fit-to-frame stays an explicit choice', () => {
    const iso = applyViewCard(stateOf({ ...defaultProjectDefaults(), ...base() }), 'iso8');
    const tile = { mode: 'tile' as const, tilePx: 64, metresPerTile: 1, shape: 'diamond' as const };
    const project = projectDefaultsOf({ ...specOf(iso), sizeId: 'custom', view: { ...iso.view, scale: tile, padding: 2 } });
    const sprite: SpriteSpec = { ...base(), kind: 'object', setId: 'builtin_object', inherit: ['view', 'look', 'size', 'engine'] };
    const eff = effectiveSpec(project, sprite);
    expect(eff.viewCardId).toBe('iso8');
    expect(eff.view.scale).toEqual(tile);
    // A soldier in the same project gets the very same scale, so the two line up 1:1.
    expect(effectiveSpec(project, { ...sprite, kind: 'character' }).view.scale).toEqual(tile);
    // An object that keeps its own size (not inherited) may be fitted to the frame.
    let own = reducer(stateOf({ ...sprite, inherit: ['look'] }), { type: 'view', view: { ...sprite.view, scale: { mode: 'fit' } } });
    own = { ...own, inherit: ['look', 'engine'] };
    expect(effectiveSpec(project, specOf(own)).view.scale.mode).toBe('fit');
    // A size card gives objects pixels per metre, like characters.
    expect(applySize(reducer(initialState(), { type: 'kind', kind: 'object' }), 'medium').view.scale).toEqual({ mode: 'ppm', ppm: 64 });
  });

  it('removes bundled moves by label and keeps extra moves', () => {
    let s = initialState();
    s = reducer(s, { type: 'exclude', label: 'run', on: true });
    expect(effectiveSet(s, sets).items.map((i) => i.label)).toEqual(['idle', 'walk']);
    s = reducer(s, { type: 'exclude', label: 'run', on: false });
    expect(effectiveSet(s, sets).items).toHaveLength(3);
    s = reducer(s, { type: 'set', id: 'builtin_melee' });
    expect(s.excluded).toEqual([]);
  });

  it('per-move edits: an added move in place, a bundle move in the sprite\'s copy of the set, a moveset move as its own move', () => {
    const lock = <T extends { window?: object }>(it: T) => ({ ...it, window: { ...it.window, lockYaw: true } });
    let s = initialState();
    const set = effectiveSet(s, sets);
    // A bundle move: the sprite gets its own copy of the bundle, same order, same set id.
    s = setMoveItem(s, sets, 1, lock(set.items[1]));
    const own = effectiveSet(s, sets);
    expect(own.id).toBe(set.id);
    expect(own.items.map((i) => i.label)).toEqual(['idle', 'walk', 'run']);
    expect(own.items[1].window).toEqual({ lockYaw: true });
    expect(BUILTIN_SETS[0].items[1].window).toBeUndefined();
    // An added move is changed where it is.
    s = reducer(s, { type: 'extra', items: [{ type: 'anim', pack: 'P', name: 'Boss_Punch', category: null, rootMotion: false, gender: null }] });
    s = setMoveItem(s, sets, 3, lock(effectiveSet(s, sets).items[3]));
    expect(s.extraItems).toHaveLength(1);
    expect(s.extraItems[0].window).toEqual({ lockYaw: true });
    // A moveset's move leaves the moveset and comes back as the sprite's own.
    let m = reducer(initialState(), { type: 'classes', ids: ['unarmed'] });
    const ms = effectiveSet(m, sets);
    m = setMoveItem(m, sets, 0, lock(ms.items[0]));
    const after = effectiveSet(m, sets);
    expect(after.items).toHaveLength(ms.items.length);
    expect(after.items.filter((i) => setItemLabel(i) === setItemLabel(ms.items[0]))).toHaveLength(1);
    expect(after.items.at(-1)!.window).toEqual({ lockYaw: true });
  });

  it('adds a still of a move as its own move (SF-FB-025)', () => {
    let s = initialState();
    const idle = effectiveSet(s, sets).items[0];
    const next = addStillMove(s, sets, { ...idle, window: { start: 0.5, lockYaw: true } }, 1.25);
    expect(next).not.toBeNull();
    s = next!;
    const still = effectiveSet(s, sets).items.at(-1)!;
    expect(setItemLabel(still)).toBe('idle_still');
    expect(still.window).toEqual({ still: 1.25, lockYaw: true });
    // The same name twice is refused; another name is fine.
    expect(addStillMove(s, sets, idle, 2)).toBeNull();
    expect(effectiveSet(addStillMove(s, sets, idle, 2, 'pose end')!, sets).items.map(setItemLabel)).toContain('pose_end');
  });

  it('outfits pick layers from one item pool: Base wears everything, switching changes nothing else', () => {
    const helmet = { asset: 7, layer: 'head' }, hat = { asset: 8, layer: 'head_hat' }, hair = { asset: 9, layer: 'hair' };
    let s: WizardState = { ...initialState(), loadout: [helmet] };
    expect(outfitsOf(s).map((o) => o.id)).toEqual(['base']);
    expect(wornItems(s)).toEqual([helmet]); // until outfits exist, Base wears the whole pool
    s = saveOutfit(s, { id: 'winter', name: 'Winter' });
    expect(outfitsOf(s).map((o) => o.id)).toEqual(['base', 'winter']);
    // Adding to the pool while Winter is worn puts the hat on Winter only; Base stays as it was.
    s = reducer(s, { type: 'loadout', items: [helmet, hat] });
    expect(wornItems(s)).toEqual([helmet, hat]);
    expect(wornItems(s, 'base')).toEqual([helmet]);
    s = reducer(s, { type: 'wear', key: itemKey(helmet), on: false });
    expect(wornItems(s)).toEqual([hat]);
    // Switching keeps the pool and movesets: only the worn layers change.
    const pool = s.loadout;
    s = switchOutfit(s, 'base');
    expect(s.loadout).toBe(pool);
    expect(wornItems(s)).toEqual([helmet]);
    // An item leaving the pool leaves every outfit.
    s = reducer(s, { type: 'loadout', items: [hat, hair] });
    expect(outfitsOf(s).find((o) => o.id === 'base')?.items).toEqual([itemKey(hair)]);
    expect(outfitsOf(s).find((o) => o.id === 'winter')?.items).toEqual([itemKey(hat)]);
    s = reducer(s, { type: 'removeOutfit', id: 'winter' });
    expect(s.activeOutfit).toBe('base');
  });

  it('migrates outfits that carried their own loadout and styles into one pool', () => {
    const helmet = { asset: 7, layer: 'head' }, rifle = { asset: 5, layer: 'weapon_rifle', cls: 'rifle' }, pistol = { asset: 6, layer: 'weapon_pistol', cls: 'pistol' };
    const legacy = {
      ...specOf(initialState()), loadout: [helmet, rifle], classes: ['unarmed', 'rifle'], activeOutfit: 'pistolero',
      outfits: [
        { id: 'base', name: 'Base', loadout: [helmet, rifle], classes: ['unarmed', 'rifle'] },
        { id: 'pistolero', name: 'Pistolero', loadout: [pistol], classes: ['unarmed', 'pistol'] },
      ],
    } as unknown as SpriteSpec;
    const s = stateOf(legacy);
    expect(s.loadout).toEqual([helmet, rifle, pistol]);
    expect(s.classes).toEqual(['unarmed', 'rifle', 'pistol']);
    expect(outfitsOf(s).map((o) => [o.id, o.items])).toEqual([['base', [itemKey(helmet), itemKey(rifle)]], ['pistolero', [itemKey(pistol)]]]);
    expect(wornItems(s)).toEqual([pistol]);
  });

  it('switching outfits needs no render', () => {
    const helmet = { asset: 7, layer: 'head' }, hat = { asset: 8, layer: 'head_hat' };
    let s: WizardState = { ...initialState(), loadout: [helmet, hat] };
    s = saveOutfit(s, { id: 'hat', name: 'Hat', items: [itemKey(hat)] });
    const done = { spec: specOf(s), clips: specClips(specOf(s), sets), loadout: s.loadout };
    expect(planChange(done, specOf(switchOutfit(s, 'base')), sets).mode).toBe('none');
  });
});

describe('planChange', () => {
  it('is a full first render when nothing was rendered', () => {
    const p = planChange(null, base(), sets);
    expect(p.mode).toBe('full');
    expect(p.label).toBe('First render');
    expect(p.newClips).toEqual(['idle', 'walk', 'run']);
  });
  it('is none when nothing changed', () => {
    const spec = base();
    expect(planChange(rendered(spec), spec, sets).mode).toBe('none');
  });
  it('re-renders when the object collision settings change (FB-050); auto is the same as unset', () => {
    const spec = base();
    const full = { ...spec, view: { ...spec.view, collision: 'full' as const } };
    expect(planChange(rendered(spec), full, sets)).toMatchObject({ mode: 'full', reasons: ['collision changed'] });
    expect(planChange(rendered(spec), { ...spec, view: { ...spec.view, collisionHeight: 2 } }, sets).reasons).toEqual(['collision changed']);
    expect(planChange(rendered(spec), { ...spec, view: { ...spec.view, collision: 'auto' as const } }, sets).mode).toBe('none');
  });
  it('renders only new items against the existing frames', () => {
    const prev = rendered(base());
    const next = { ...base(), loadout: [{ asset: 5, layer: 'head' }, { asset: 6, layer: 'hair' }] };
    const p = planChange(prev, next, sets);
    expect(p.mode).toBe('parts');
    expect(p.newItems).toHaveLength(2);
    expect(p.reuse).toBe(true);
    expect(p.label).toBe('Added 2 items');
    expect(p.reasons).toEqual(['equipment changed: +2 items']);
    expect(planChange(prev, next, sets, { itemName: (id) => (id === 5 ? 'Helmet' : 'Hair') }).reasons).toEqual(['equipment changed: +Helmet, +Hair']);
    // With other changes (full render), the new items are still a reason (SF-FB-012).
    const full = planChange(prev, { ...next, maxSeconds: 2 }, sets, { itemName: () => 'X' });
    expect(full.mode).toBe('full');
    expect(full.reasons).toEqual(['clip length changed', 'equipment changed: +X, +X']);
    expect(full.label).toBe('Clip length changed');
  });
  it('only new moves: renders just those clips and adds them to the export', () => {
    const prev = rendered(base());
    const next = stateOf(base());
    const p = planChange(prev, specOf(reducer(next, { type: 'set', id: 'builtin_melee' })), sets);
    expect(p.mode).toBe('clips');
    expect(p.newClips).toContain('attack_1');
    expect(p.removedClips).toEqual([]);
    expect(p.label).toMatch(/^New moves/);
  });
  it('re-renders everything when moves are removed too, or items change with them', () => {
    const prev = rendered(specOf(reducer(stateOf(base()), { type: 'set', id: 'builtin_melee' })));
    const p = planChange(prev, specOf(reducer(stateOf(base()), { type: 'set', id: 'builtin_archer' })), sets);
    expect(p.mode).toBe('full');
    expect(p.reuse).toBe(true);
    const withItem = specOf(reducer(reducer(stateOf(base()), { type: 'set', id: 'builtin_melee' }), { type: 'loadout', items: [{ asset: 5, layer: 'head' }] }));
    expect(planChange(rendered(base()), withItem, sets).mode).toBe('full');
  });
  it('a new item in a removed item\'s place is a swap', () => {
    const withHair = { ...base(), loadout: [{ asset: 5, layer: 'head' }, { asset: 6, layer: 'hair' }] };
    const other = { ...base(), loadout: [{ asset: 5, layer: 'head' }, { asset: 9, layer: 'hair' }] };
    const p = planChange(rendered(withHair), other, sets);
    expect(p.mode).toBe('full');
    expect(p.reuse).toBe(true);
    expect(p.dropOnly).toBe(false);
    expect(p.newItems).toEqual([{ asset: 9, layer: 'hair' }]);
    expect(p.removedItems).toEqual([{ asset: 6, layer: 'hair' }]);
    expect(p.reasons).toEqual(['1 item swapped']);
    expect(p.label).toBe('1 item swapped');
  });
  it('a removed item is a drop: full mode, layers still reusable (the runner takes the old sheet out)', () => {
    const withItem = { ...base(), loadout: [{ asset: 5, layer: 'head' }] };
    const p = planChange(rendered(withItem), base(), sets);
    expect(p.mode).toBe('full');
    expect(p.reuse).toBe(true);
    expect(p.removedItems).toHaveLength(1);
    expect(p.dropOnly).toBe(true);
    expect(p.label).toBe('Removed 1 item');
    // Removing one item and changing the look is not a plain drop.
    expect(planChange(rendered(withItem), specOf(applyLook(stateOf(base()), 'pixel')), sets).dropOnly).toBe(false);
  });
  it('notices a changed view, look, format or gender', () => {
    const prev = rendered(base());
    expect(planChange(prev, specOf(applyViewCard(stateOf(base()), 'side2')), sets).reasons).toEqual(expect.arrayContaining(['pitch changed (45 → 0)', 'dirs changed (8 → 2)']));
    expect(planChange(prev, specOf(applyLook(stateOf(base()), 'pixel')), sets).reasons).toContain('supersample changed (2 → 3)');
    expect(planChange(prev, { ...base(), profileId: 'godot4' }, sets).reasons).toContain('format changed');
    expect(planChange(prev, { ...base(), gender: 'Feminine' }, sets).label).toBe('Moves gender changed');
  });
  it('notices the export options sprites carry: clip cap, key prefix, atlas, uniform frames, facings, slicing, model', () => {
    const prev = rendered(base());
    expect(planChange(prev, { ...base(), maxSeconds: 2 }, sets).reasons).toContain('clip length changed');
    expect(planChange(prev, { ...base(), animPrefix: 'ranger/' }, sets).reasons).toContain('format changed');
    expect(planChange(prev, { ...base(), atlas: true }, sets).reasons).toContain('format changed');
    expect(planChange(prev, { ...base(), uniformFrame: !base().uniformFrame }, sets).reasons).toContain('format changed');
    expect(planChange(prev, { ...base(), view: { ...base().view, facings: 2 } }, sets).reasons).toContain('facings changed (none → 2)');
    expect(planChange(prev, { ...base(), view: { ...base().view, slice: 'columns' } }, sets).reasons).toContain('slice changed (none → columns)');
    expect(planChange(prev, { ...base(), assetIds: [2] }, sets).reasons).toContain('model changed');
    expect(planChange(rendered({ ...base(), maxSeconds: 2, atlas: true }), { ...base(), maxSeconds: 2, atlas: true }, sets).mode).toBe('none');
  });
  it('FB-055: names each view and look field that changed, and says when the new value is a default', () => {
    const prev = rendered({ ...base(), view: { ...base().view, fps: 12 } });
    const p = planChange(prev, { ...base(), view: { ...base().view, fps: 10 } }, sets, { defaulted: ['fps'] });
    expect(p.reasons).toEqual(['fps changed (12 → default 10)']);
    expect(p.label).toBe('Fps changed (12 → default 10)');
    expect(planChange(prev, { ...base(), view: { ...base().view, fps: 24 } }, sets).reasons).toEqual(['fps changed (12 → 24)']);
    const ppm = (n: number): SpriteSpec => ({ ...base(), view: { ...base().view, fps: 12, scale: { mode: 'ppm', ppm: n } } });
    expect(planChange(rendered(ppm(64)), ppm(128), sets).reasons).toEqual(['ppm changed (64 → 128)']);
    expect(planChange(rendered({ ...ppm(1), view: { ...ppm(1).view, scale: { mode: 'fit' } } }), ppm(128), sets).reasons).toEqual(['scale changed (fit → ppm 128)']);
    const frame = { ...base(), view: { ...base().view, fps: 12, frameWidth: 64, frameHeight: 64 } };
    expect(planChange(prev, frame, sets).reasons).toEqual([`frame size changed (${base().view.frameWidth}×${base().view.frameHeight} → 64×64)`]);
    const ss = { ...base(), view: { ...base().view, fps: 12, quality: { ...base().view.quality!, supersample: 4 as const } } };
    expect(planChange(prev, ss, sets).reasons).toEqual([`supersample changed (${base().view.quality!.supersample} → 4)`]);
    expect(planChange(prev, { ...base(), view: { ...base().view, fps: 12, mirror: !base().view.mirror } }, sets).reasons).toEqual([`mirror changed (${base().view.mirror} → ${!base().view.mirror})`]);
  });
  it('SF-FB-003: a skeletal clip is keyed by its id, so a rename (or a new id for the same name) changes nothing', () => {
    const clip = (name: string, id?: number, label = 'idle'): SpriteSpec => ({
      ...base(), baseSet: { id: 'adhoc', name: 'x', items: [{ type: 'anim', pack: '_Uploads', name, category: null, rootMotion: false, gender: null, label, ...(id !== undefined ? { clip: id } : {}) }] },
    });
    expect(planChange(rendered(clip('Fighter_Idle', 7)), clip('MartialArts_Idle', 7), sets).mode).toBe('none');
    expect(planChange(rendered(clip('Fighter_Idle')), clip('Fighter_Idle', 7), sets).mode).toBe('none');
    expect(planChange(rendered(clip('Fighter_Idle', 3)), clip('Fighter_Idle', 7), sets).mode).toBe('none');
    // Another clip under the same move name is a changed move.
    expect(planChange(rendered(clip('Fighter_Idle', 3)), clip('Fighter_Kick', 7), sets).reasons).toEqual(['move settings changed']);
    expect(planChange(rendered(clip('Fighter_Idle')), clip('Fighter_Kick'), sets).reasons).toEqual(['move settings changed']);
  });
  it('does not call a move new just because the model lacked its clip', () => {
    // The render left out "run" (not installed); the set is unchanged, so nothing is new.
    const prev = { ...rendered(base()), clips: ['idle', 'walk'] };
    expect(planChange(prev, base(), sets).mode).toBe('none');
    // With the planned clips known, the comparison is literal.
    expect(planChange(prev, base(), sets, { clips: ['idle', 'walk', 'run'] }).newClips).toEqual(['run']);
  });
  it('uses the planned clip names when the caller knows them', () => {
    const prev = { ...rendered(base()), clips: ['idle', 'walk'] };
    expect(planChange(prev, base(), sets, { clips: ['idle', 'walk'] }).mode).toBe('none');
  });
});

describe('parameters and renderer version (FB-042)', () => {
  const smoke = (params: Record<string, number>): SpriteSpec => ({
    ...base(), kind: 'prop', baseSet: { id: 'adhoc', name: 'smoke', items: [{ type: 'template', layers: [{ id: 'smoke_loop', params }], label: 'smoke_loop' }] },
  });
  it('a template parameter change is a full render with no layer reuse', () => {
    const p = planChange(rendered(smoke({})), smoke({ dark: 0.8 }), sets);
    expect(p.mode).toBe('full');
    expect(p.reasons).toEqual(['move settings changed']);
    expect(p.reuse).toBe(false);
    // Key order in stored JSON does not matter.
    expect(planChange(rendered(smoke({ a: 1, b: 2 })), smoke({ b: 2, a: 1 }), sets).mode).toBe('none');
  });
  it('state looks and transition parameters count too', () => {
    const states = (look: string, transition: string): SpriteSpec => ({ ...base(), kind: 'object', states: { intact: { asset: 1 }, destroyed: { asset: 1, look, transition } } });
    expect(planChange(rendered(states('scorch', 'collapse:blast=1')), states('scorch:dark=0.9', 'collapse:blast=1'), sets).reasons).toEqual(['move settings changed']);
    expect(planChange(rendered(states('scorch', 'collapse:blast=1')), states('scorch', 'collapse:blast=2'), sets).mode).toBe('full');
    expect(planChange(rendered(states('scorch', 'collapse:blast=1')), states('scorch', 'collapse:blast=1'), sets).mode).toBe('none');
  });
  it('an older renderer marks the sprite stale without making it outdated; force renders everything', () => {
    const old = planChange(rendered(base()), base(), sets);
    expect(old.mode).toBe('none');
    expect(old.stale).toBe(true);
    expect(planStatus(old)).toBe('Outdated (renderer updated)');
    const cur = planChange(rendered({ ...base(), rendererVersion: RENDERER_VERSION }), base(), sets);
    expect(cur.stale).toBe(false);
    expect(planStatus(cur)).toBe('Up to date');
    const f = forcePlan(old);
    expect(f).toMatchObject({ mode: 'full', reuse: false, label: 'Renderer updated', reasons: ['renderer updated'] });
    expect(forcePlan(cur)).toMatchObject({ mode: 'full', reuse: false, label: 'Re-render' });
    // A forced parts render becomes a full one that keeps its reasons.
    const parts = planChange(rendered({ ...base(), rendererVersion: RENDERER_VERSION }), { ...base(), loadout: [{ asset: 6, layer: 'hair' }] }, sets);
    expect(parts.mode).toBe('parts');
    expect(forcePlan(parts)).toMatchObject({ mode: 'full', reuse: false, label: 'Added 1 item' });
  });
});

describe('placement fixes', () => {
  it('a changed fix revision is a changed item, so that layer is rendered again (and reused layers stay)', () => {
    const before = { ...base(), loadout: [{ asset: 5, layer: 'weapon', cls: 'rifle', fixRev: 1 }, { asset: 6, layer: 'head' }] };
    const after = { ...base(), loadout: [{ asset: 5, layer: 'weapon', cls: 'rifle', fixRev: 2 }, { asset: 6, layer: 'head' }] };
    const p = planChange(rendered(before), after, sets);
    expect(p.mode).toBe('full');
    expect(p.reuse).toBe(true);
    expect(p.reasons).toEqual(['1 item changed']);
    // No fix before or after: nothing changes (sprites without fixes are untouched).
    expect(planChange(rendered({ ...base(), loadout: [{ asset: 6, layer: 'head' }] }), { ...base(), loadout: [{ asset: 6, layer: 'head' }] }, sets).mode).toBe('none');
  });
});

describe('SF-FB-024: model scale', () => {
  it('parses factors and percentages, 1 is real size (null), and refuses the rest', () => {
    expect(parseModelScale(1.3)).toBe(1.3);
    expect(parseModelScale('1.3x')).toBe(1.3);
    expect(parseModelScale('x1.5')).toBe(1.5);
    expect(parseModelScale('130%')).toBe(1.3);
    expect(parseModelScale(1)).toBeNull();
    expect(parseModelScale(undefined)).toBeNull();
    expect(() => parseModelScale(0)).toThrow(/factor from 0.05 to 20/);
    expect(() => parseModelScale('big')).toThrow(/factor/);
    expect(() => parseModelScale(25)).toThrow(/factor/);
  });
  it('the reducer stores it (1 clears it) and every render of the sprite carries it', () => {
    let s: WizardState = { ...initialState(), assetIds: [1] };
    s = reducer(s, { type: 'modelScale', scale: 1.3 });
    expect(s.modelScale).toBe(1.3);
    const ctx = { sets: BUILTIN_SETS, profiles: [{ id: 'generic' } as never] };
    expect(toBatchSpec(s, ctx).modelScale).toBe(1.3);
    expect(reducer(s, { type: 'modelScale', scale: 1 })).not.toHaveProperty('modelScale');
    expect(reducer(s, { type: 'modelScale', scale: null })).not.toHaveProperty('modelScale');
    expect(toBatchSpec({ ...s, modelScale: undefined }, ctx)).not.toHaveProperty('modelScale');
  });
  it('a different scale is a full render that reuses nothing', () => {
    const spec = specOf({ ...initialState(), assetIds: [1] });
    const prev: RenderedState = { spec, clips: [], loadout: [] };
    const plan = planChange(prev, { ...spec, modelScale: 1.3 }, BUILTIN_SETS, { clips: [] });
    expect(plan.reasons).toEqual(['model scale changed (×1 → ×1.3)']);
    expect([plan.mode, plan.reuse]).toEqual(['full', false]);
    // The sprite's own scale survives whatever it inherits from the project.
    expect(effectiveSpec(defaultProjectDefaults(), { ...spec, modelScale: 1.3, inherit: ['view', 'look', 'size', 'engine'] }).modelScale).toBe(1.3);
  });
});
