// Ported from synty-sprite-generator packages/shared/src/sprite/render.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, BUILTIN_SETS } from '@slop/sprites';
import { buildRender, dropSnapshot, effectiveOf, spriteAnimPrefix, spritePlan, type ProjectLike, type SpriteLike } from '../../src/plan/render.js';
import { RENDERER_VERSION, projectDefaultsOf, specClips, specOf } from '../../src/plan/spriteSpec.js';
import { initialState } from '../../src/plan/state.js';

const ctx = { sets: BUILTIN_SETS, profiles: BUILTIN_PROFILES };
const spec = () => ({ ...specOf(initialState()), kind: 'character' as const, assetIds: [7], loadout: [{ asset: 5, layer: 'head' }], inherit: [] });
const project: ProjectLike = { defaults: projectDefaultsOf(specOf(initialState())) };
const sprite = (over: Partial<SpriteLike> = {}): SpriteLike => ({ id: 1, name: 'Knight', assetId: 7, spec: spec(), current: null, latest: null, ...over });

describe('buildRender', () => {
  it('a first render is a full one with preview GIFs and layer reuse', () => {
    const s = sprite();
    const r = buildRender(s, project, ctx, spritePlan(s, project, BUILTIN_SETS));
    expect(r.mode).toBe('full');
    expect(r.spec.previews).toBe(true);
    expect(r.spec.incremental).toBe(true);
    expect(r.spec.name).toBe('Knight v1: First render');
    expect(r.snapshot.assetIds).toEqual([7]);
  });
  it('a new item on a rendered sprite is a parts-only render aligned to the current export', () => {
    // The snapshot a render records is the effective spec (project settings applied), as the server stores it.
    const cur = { n: 1, batchId: 9, alignment: { view: initialState().view, framing: {} as never, layout: {} as never, clips: [], signature: 'sig', parts: ['head'] }, clips: specClips(effectiveOf(sprite(), project), BUILTIN_SETS), loadout: [{ asset: 5, layer: 'head' }], spec: effectiveOf(sprite(), project) };
    const s = sprite({ current: cur, latest: { n: 1 }, spec: { ...spec(), loadout: [{ asset: 5, layer: 'head' }, { asset: 6, layer: 'hair' }] } });
    const plan = spritePlan(s, project, BUILTIN_SETS);
    expect(plan.mode).toBe('parts');
    const r = buildRender(s, project, ctx, plan);
    expect(r.mode).toBe('parts');
    expect(r.spec.partsOnly).toBe(true);
    expect(r.spec.mergeInto).toBe(9);
    expect(r.spec.loadout).toEqual([{ asset: 6, layer: 'hair' }]);
    expect(r.spec.previews).toBe(true);
    expect(r.spec.name).toBe('Knight v2: Added 1 item');
  });

  it('phaser keys default to the sprite name (FB-030); other formats and a set prefix are left alone', () => {
    const phaser = { ...spec(), profileId: 'phaser3', inherit: [] };
    const smoke = sprite({ name: 'smoke big', spec: phaser });
    const r = buildRender(smoke, project, ctx, spritePlan(smoke, project, BUILTIN_SETS));
    expect(r.spec.profile.animationName).toBe('smoke_big/{clip}_{dir}');
    expect(r.snapshot.animPrefixAuto).toBe('smoke_big/');
    // The snapshot does not make the sprite look outdated.
    expect(spritePlan({ ...smoke, current: { n: 1, batchId: 3, alignment: null, clips: specClips(effectiveOf(smoke, project), BUILTIN_SETS), loadout: phaser.loadout, spec: r.snapshot }, latest: { n: 1 } }, project, BUILTIN_SETS).mode).toBe('none');
    expect(spriteAnimPrefix('x', { profileId: 'phaser3', animPrefix: '' }, BUILTIN_PROFILES)).toBeNull();
    expect(spriteAnimPrefix('x', { profileId: 'generic' }, BUILTIN_PROFILES)).toBeNull();
    expect(buildRender(sprite(), project, ctx, spritePlan(sprite(), project, BUILTIN_SETS)).snapshot.animPrefixAuto).toBeUndefined();
  });

  it('records the renderer version; force re-renders an up-to-date sprite without reuse (FB-042)', () => {
    const s = sprite();
    const r = buildRender(s, project, ctx, spritePlan(s, project, BUILTIN_SETS));
    expect(r.snapshot.rendererVersion).toBe(RENDERER_VERSION);
    const cur = { n: 1, batchId: 3, alignment: null, clips: specClips(effectiveOf(s, project), BUILTIN_SETS), loadout: s.spec.loadout, spec: r.snapshot };
    const done = sprite({ current: cur, latest: { n: 1 } });
    const plan = spritePlan(done, project, BUILTIN_SETS);
    expect(plan.mode).toBe('none');
    expect(plan.stale).toBe(false);
    // An old render (no version) is stale but not outdated.
    expect(spritePlan(sprite({ current: { ...cur, spec: effectiveOf(s, project) }, latest: { n: 1 } }), project, BUILTIN_SETS)).toMatchObject({ mode: 'none', stale: true });
    const forced = spritePlan(done, project, BUILTIN_SETS, undefined, { force: true });
    expect(forced.mode).toBe('full');
    const fr = buildRender(done, project, ctx, forced);
    expect(fr.mode).toBe('full');
    expect(fr.spec.incremental).toBeUndefined();
    // FB-121: a forced render takes no frames from the frame cache; a normal one may.
    expect(fr.spec.noCache).toBe(true);
    expect(buildRender(s, project, ctx, spritePlan(s, project, BUILTIN_SETS)).spec.noCache).toBeUndefined();
    expect(fr.spec.name).toBe('Knight v2: Re-render');
    // A drop renders nothing: it keeps the last render's version.
    expect(dropSnapshot(done, project).rendererVersion).toBe(RENDERER_VERSION);
    expect(dropSnapshot(sprite({ current: { ...cur, spec: effectiveOf(s, project) } }), project).rendererVersion).toBeUndefined();
  });
});
