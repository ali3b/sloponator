/**
 * Moved from synty-sprite-generator packages/shared/src/sprite/render.ts (P2, ali3b/sloponator#8): the batch a
 * sprite render queues (buildRender), the sprite-name animation prefix, and the uniform-frame siblings the old server
 * added (withUniformSiblings). Unchanged but for the imports.
 */
import { PHASER_ANIM_PREFIX, type AnimationSet, type BatchSpec, type LoadoutItem, type LayerAlignment, type ExportProfile } from '@slop/sprites';
import { RENDERER_VERSION, effectiveSpec, forcePlan, planChange, stateOf, type ChangePlan, type ProjectDefaults, type RenderedState, type SpriteSpec } from './spriteSpec.js';
import { effectiveSet, toBatchSpec, viewForKind } from './state.js';

/**
 * Planning a sprite's render, shared by the web pages, the CLI and the MCP tools. The types are structural
 * (what the server's sprite and project DTOs carry) so every client can pass its own DTOs.
 */
export interface SpriteLike {
  id: number;
  name: string;
  assetId: number | null;
  spec: SpriteSpec;
  current?: { n: number; batchId: number; alignment: LayerAlignment | null; clips: string[]; loadout: LoadoutItem[]; spec: SpriteSpec } | null;
  latest?: { n: number } | null;
}
export interface ProjectLike {
  defaults: ProjectDefaults;
}

/** What the sprite's last finished render was made from (null before the first). */
export function renderedState(sprite: SpriteLike): RenderedState | null {
  const c = sprite.current;
  return c ? { spec: c.spec, clips: c.clips, loadout: c.loadout } : null;
}

/** The sprite's spec with the project's shared settings applied, and the model filled in. */
export function effectiveOf(sprite: SpriteLike, project: ProjectLike): SpriteSpec {
  const eff = effectiveSpec(project.defaults, sprite.spec);
  return { ...eff, assetIds: sprite.assetId ? [sprite.assetId] : eff.assetIds };
}

/**
 * What rendering now would do (plannedClips: the clip names the preview resolved, when known). `force`: render
 * everything again even when nothing changed (FB-042: generator fixes, a renderer update).
 */
export function spritePlan(sprite: SpriteLike, project: ProjectLike, sets: AnimationSet[], plannedClips?: string[], opts: { force?: boolean; defaulted?: string[]; itemName?: (assetId: number) => string | undefined } = {}): ChangePlan {
  const plan = planChange(renderedState(sprite), effectiveOf(sprite, project), sets, { ...(plannedClips ? { clips: plannedClips } : {}), ...(opts.defaulted ? { defaulted: opts.defaulted } : {}), ...(opts.itemName ? { itemName: opts.itemName } : {}) });
  return opts.force ? forcePlan(plan) : plan;
}

/**
 * The snapshot an item drop records: nothing is rendered, so the last render's renderer version and key prefix
 * carry over (a drop must not make an old render look current, or a current one stale).
 */
export function dropSnapshot(sprite: SpriteLike, project: ProjectLike): SpriteSpec {
  const eff = effectiveOf(sprite, project);
  const cur = sprite.current?.spec;
  return { ...eff, ...(cur?.animPrefixAuto !== undefined ? { animPrefixAuto: cur.animPrefixAuto } : {}), ...(cur?.rendererVersion !== undefined ? { rendererVersion: cur.rendererVersion } : {}) };
}

export interface RenderRequest {
  spec: BatchSpec;
  mode: 'full' | 'parts' | 'clips';
  label: string;
  snapshot: SpriteSpec;
}

/**
 * The animation-key prefix a sprite render uses when the sprite sets none and its format prefixes keys with the
 * sheet's base name (phaser3: "{base}/"): the sprite's name, so several sprites of one model in a project (smoke and
 * smoke_big, a tank in two liveries) get their own keys in the engine's global animation manager. Null otherwise.
 */
export function spriteAnimPrefix(name: string, spec: Pick<SpriteSpec, 'animPrefix' | 'profileId'>, profiles: ExportProfile[]): string | null {
  if (spec.animPrefix !== undefined) return null;
  const profile = profiles.find((p) => p.id === spec.profileId) ?? profiles[0];
  if (!profile?.animationName.startsWith(PHASER_ANIM_PREFIX)) return null;
  return `${name.trim().replace(/[^\w.-]+/g, '_') || 'sprite'}/`;
}

/**
 * The batch for a render: new equipment only is rendered against the current frames and merged in; anything
 * else is a full render, reusing unchanged layers from the last one when nothing was removed.
 */
export function buildRender(sprite: SpriteLike, project: ProjectLike, ctx: { sets: AnimationSet[]; profiles: ExportProfile[] }, plan: ChangePlan): RenderRequest {
  const eff = effectiveOf(sprite, project);
  let state = stateOf(eff);
  const cur = sprite.current;
  // Phaser-style keys default to the sprite's name. An export made under another prefix gets a full render, so its
  // old animations are not merged with new ones under a different prefix.
  const autoPrefix = spriteAnimPrefix(sprite.name, eff, ctx.profiles);
  if (autoPrefix) state = { ...state, animPrefix: autoPrefix };
  const prefixKept = (cur?.spec.animPrefixAuto ?? null) === autoPrefix;
  // New items, or only new moves: rendered against the current export's frames and merged into it. New moves
  // need an export that records its page count (made since clips could be added); else everything is rendered.
  // Equipment baked into the body (not layered) has no layers to add to: always a full render.
  if (prefixKept && state.layered && !state.turret && !state.split && plan.reuse && (plan.mode === 'parts' || (plan.mode === 'clips' && cur?.alignment?.pages)) && cur?.alignment) {
    state = { ...state, alignTo: { name: sprite.name, alignment: cur.alignment, clips: cur.clips, loadout: cur.loadout, batchId: cur.batchId } };
  }
  const spec = toBatchSpec(state, ctx);
  const mode = spec.partsOnly ? 'parts' : spec.extendClips ? 'clips' : 'full';
  const n = (sprite.latest?.n ?? 0) + 1;
  return {
    // Sprite renders always carry preview GIFs: the gallery portrait, the Layers tab and the CLI/MCP rely on them.
    spec: { ...spec, name: `${sprite.name} v${n}: ${plan.label}`, previews: true, ...(mode === 'full' && spec.layered && plan.reuse ? { incremental: true } : {}), ...(plan.forced ? { noCache: true } : {}) },
    // The snapshot records the renderer version: renders by an older one show as stale (ChangePlan.stale).
    mode, label: plan.label, snapshot: { ...eff, ...(autoPrefix ? { animPrefixAuto: autoPrefix } : {}), rendererVersion: RENDERER_VERSION },
  };
}

/**
 * SF-FB-018: `uniform` across a project's sprites of one model. The sets (and held items) of the other sprites of the
 * same model that also want uniform frames at the same view, for a full render's measuring pass: the runner sizes the
 * frame and feet pivot for all of them, so every sheet of the model shares one frame size and pivot. Partial renders
 * (aligned to an earlier export) and fitted scales share nothing.
 */
export function uniformSiblings(spec: BatchSpec, siblings: Pick<SpriteLike, 'id' | 'assetId' | 'spec'>[], project: ProjectLike, sets: AnimationSet[]): { set: AnimationSet; loadout?: LoadoutItem[] }[] {
  if (!spec.uniformFrame || spec.alignTo || spec.view.scale.mode === 'fit' || spec.assetIds.length !== 1) return [];
  const view = JSON.stringify(spec.view);
  const out: { set: AnimationSet; loadout?: LoadoutItem[] }[] = [];
  for (const sib of siblings) {
    if (sib.assetId !== spec.assetIds[0]) continue;
    const s = stateOf(effectiveOf(sib as SpriteLike, project));
    if (!s.uniformFrame || s.view.scale.mode === 'fit' || JSON.stringify(viewForKind(s.kind, s.view)) !== view) continue;
    out.push({ set: effectiveSet(s, sets), ...(s.loadout.length ? { loadout: s.loadout } : {}) });
  }
  return out;
}
