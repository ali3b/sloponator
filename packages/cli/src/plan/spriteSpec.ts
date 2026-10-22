/**
 * Moved from synty-sprite-generator packages/shared/src/sprite/spec.ts (P2, ali3b/sloponator#8): a sprite's stored
 * spec, the project defaults it inherits from (effectiveSpec), and the change plan that says what rendering it again
 * means (planChange, forcePlan). Unchanged but for the imports.
 */
import { setItemLabel, type AnimationSet, dirsText, type LoadoutItem, normalizeLight } from '@slop/sprites';
import {
  DIR_KEYS, INHERIT_GROUPS, applyLook, applySize, applyViewCard, initialState, effectiveSet, normalizeOutfits, sortKeys,
  type InheritGroup, type WizardState,
} from './state.js';
import { FIXED_SIZE_VIEWS, type LookId, type SizeId } from './words.js';

/**
 * A Sprite's spec: the Wizard's state without its UI-only fields. One type for the Wizard, the Sprite pages,
 * presets, the prompt resolver and the CLI/MCP.
 */
export type SpriteSpec = Omit<WizardState, 'step' | 'presetId' | 'previewItem' | 'alignTo'> & { version: 1 };

export function specOf(s: WizardState): SpriteSpec {
  const { step: _step, presetId: _presetId, previewItem: _previewItem, alignTo: _alignTo, ...rest } = s;
  return { ...rest, version: 1 };
}

export function stateOf(spec: SpriteSpec, step = 0): WizardState {
  const { version: _version, ...rest } = spec;
  // Outfits saved before items were pooled become selections over one pool (see normalizeOutfits).
  return normalizeOutfits({ ...initialState(), ...rest, step, presetId: null, previewItem: 0, alignTo: null });
}

/** The settings a project shares with its sprites. */
export type ProjectDefaults = Pick<SpriteSpec, 'viewCardId' | 'view' | 'lookId' | 'sizeId' | 'profileId' | 'layers' | 'uniformFrame' | 'layered' | 'gender'>;

export function projectDefaultsOf(s: Pick<SpriteSpec, keyof ProjectDefaults>): ProjectDefaults {
  const { viewCardId, view, lookId, sizeId, profileId, layers, uniformFrame, layered, gender } = s;
  return { viewCardId, view: structuredClone(view), lookId, sizeId, profileId, layers: [...layers], uniformFrame, layered, gender };
}

/** A new project's settings: top-down 8, clean, medium, PNG + JSON. */
export const defaultProjectDefaults = (): ProjectDefaults => projectDefaultsOf(initialState());

/**
 * A sprite's spec with the groups it inherits taken from the project. The size group re-applies the kind's own
 * scale rule, so props stay fitted to the frame while characters, vehicles and objects share the project's pixels
 * per metre (or its tile lock); fixed-size views (RPG Maker, LPC) keep their frame.
 */
export function effectiveSpec(project: ProjectDefaults, sprite: SpriteSpec): SpriteSpec {
  const groups = sprite.inherit ?? [];
  if (!groups.length) return sprite;
  let s: WizardState = stateOf(sprite);
  if (groups.includes('view')) {
    if (project.viewCardId !== 'custom') s = applyViewCard(s, project.viewCardId);
    else {
      // The project's directions, chosen ones included (FB-098), replace the sprite's.
      const { angles: _own, ...view } = s.view;
      s = { ...s, viewCardId: 'custom', view: { ...view, ...Object.fromEntries(DIR_KEYS.map((k) => [k, project.view[k]])), ...(project.view.angles?.length ? { angles: [...project.view.angles] } : {}) } };
    }
    // The sprite's own fps and object options (facings, column slicing) survive the project's view.
    const { facings, slice, collisionHeight, collision } = sprite.view;
    s = { ...s, view: { ...s.view, fps: sprite.view.fps, ...(facings !== undefined ? { facings } : {}), ...(slice ? { slice } : {}), ...(collisionHeight !== undefined ? { collisionHeight } : {}), ...(collision !== undefined ? { collision } : {}) } };
  }
  if (groups.includes('look')) {
    s = project.lookId !== 'custom' ? applyLook(s, project.lookId as LookId) : { ...s, lookId: 'custom', view: { ...s.view, quality: structuredClone(project.view.quality) } };
  }
  if (groups.includes('size')) {
    if (project.sizeId !== 'custom' && !FIXED_SIZE_VIEWS.has(s.viewCardId)) s = applySize(s, project.sizeId as SizeId);
    else if (!FIXED_SIZE_VIEWS.has(s.viewCardId)) s = { ...s, sizeId: 'custom', view: { ...s.view, frameWidth: project.view.frameWidth, frameHeight: project.view.frameHeight, scale: structuredClone(project.view.scale) } };
  }
  // A declared sprite (layeredOwn) keeps its own layering: apply/export --project bake equipment unless asked.
  if (groups.includes('engine')) s = { ...s, profileId: project.profileId, layers: [...project.layers], layered: s.layeredOwn ? s.layered : project.layered, uniformFrame: project.uniformFrame && s.view.scale.mode !== 'fit' };
  if (groups.includes('gender')) s = { ...s, gender: project.gender };
  return { ...specOf(s), inherit: INHERIT_GROUPS.filter((g) => groups.includes(g)) };
}

/** What a sprite's latest render was made from (stored on the version, read back from the batch item). */
export interface RenderedState {
  spec: SpriteSpec;
  /** Clip names the render holds (export names). */
  clips: string[];
  loadout: LoadoutItem[];
}

export type ChangeMode = 'none' | 'parts' | 'clips' | 'full';

/**
 * The renderer's output version. Bump it whenever a generator or renderer change alters what an unchanged spec
 * renders to (a fixed blend mode, a new key prefix, better framing...). Renders record it in their snapshot, and a
 * sprite rendered by an older version shows "Outdated (renderer updated)" (ChangePlan.stale) without being
 * re-rendered on its own: `ssg sprite render --force`, `ssg sprite apply --force`, MCP `render_sprite.force` and
 * the web "Re-render" button re-render it. Snapshots without a version count as 0.
 *  1: versions start (FB-042), after the phaser key prefix (FB-030) and smoke blend (FB-031) fixes.
 *  2: vehicles, aircraft and buildings collide with their whole hull, not a ground slice (FB-050).
 *  3: a held item's `projectile` parts (the rocket in an RPG) are hidden from the clip's `shoot` frame on (FB-072).
 */
export const RENDERER_VERSION = 3;

/** JSON with object keys sorted at every level (stable comparisons of stored specs). */
const stableJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? sortKeys(x as object) : x));

export interface ChangePlan {
  mode: ChangeMode;
  /** Whether unchanged layers may be reused from the last render (the runner drops removed items' layers and replaces changed ones). */
  reuse: boolean;
  /** Only items were removed: their layers can be dropped from the export without rendering anything. */
  dropOnly: boolean;
  newItems: LoadoutItem[];
  removedItems: LoadoutItem[];
  newClips: string[];
  removedClips: string[];
  /** Why a re-render is needed, in words. */
  reasons: string[];
  /** A short version label ("Added 2 items", "New moves: run, jump"). */
  label: string;
  /**
   * The last render was made by an older renderer (RENDERER_VERSION). Informational: it does not change `mode`, so
   * "render the outdated ones" leaves such sprites alone; a forced render (forcePlan) re-renders them.
   */
  stale: boolean;
  /** A forced re-render (forcePlan): every frame is rendered again, none taken from the frame cache (FB-121). */
  forced?: boolean;
}

/** Whether a render snapshot comes from an older renderer than this one. */
export const renderedByOlder = (spec: Pick<SpriteSpec, 'rendererVersion'> | null | undefined) => !!spec && (spec.rendererVersion ?? 0) < RENDERER_VERSION;

/**
 * A plan that renders everything again whatever changed (a forced re-render): full mode, no layer reuse (a
 * renderer fix must reach every layer), the plan's own reasons kept, or "forced" / "renderer updated".
 */
export function forcePlan(plan: ChangePlan): ChangePlan {
  if (plan.mode === 'full' && !plan.reuse) return { ...plan, forced: true };
  const reasons = plan.mode === 'none' ? (plan.stale ? ['renderer updated'] : ['forced re-render']) : plan.reasons;
  const label = plan.mode === 'none' ? (plan.stale ? 'Renderer updated' : 'Re-render') : plan.label;
  return { ...plan, mode: 'full', reuse: false, dropOnly: false, reasons, label, forced: true };
}

/** The status line for a plan: "No changes", "Outdated: look changed", "Outdated (renderer updated)". */
export const planStatus = (plan: ChangePlan): string =>
  plan.mode !== 'none' ? `Outdated: ${plan.label}` : plan.stale ? 'Outdated (renderer updated)' : 'Up to date';

/** The clip names a spec exports (the same sanitising as the exporter), unless the caller knows better. */
export function specClips(spec: SpriteSpec, sets: AnimationSet[]): string[] {
  const used = new Set<string>();
  return effectiveSet(stateOf(spec), sets).items.map((it) => {
    let label = setItemLabel(it).replace(/[^\w-]+/g, '_');
    while (used.has(label)) label += '_';
    used.add(label);
    return label;
  });
}

/** Each exported clip's own trim/cap (SF-FB-001), by clip name, as text (clips without one are left out). */
function clipWindows(spec: SpriteSpec, sets: AnimationSet[]): Record<string, string> {
  const names = specClips(spec, sets);
  const out: Record<string, string> = {};
  effectiveSet(stateOf(spec), sets).items.forEach((it, i) => {
    if (it.window) out[names[i]] = JSON.stringify(sortKeys(it.window));
  });
  return out;
}

const sameItem = (a: LoadoutItem, b: LoadoutItem) => a.asset === b.asset && (a.layer ?? null) === (b.layer ?? null) && (a.cls ?? null) === (b.cls ?? null);
const itemChanged = (a: LoadoutItem, b: LoadoutItem) =>
  JSON.stringify([a.target, a.pos, a.rot, a.scale, a.layers, a.depth, a.secondary, a.trigger, a.fix, a.fixRev, a.perClip]) !== JSON.stringify([b.target, b.pos, b.rot, b.scale, b.layers, b.depth, b.secondary, b.trigger, b.fix, b.fixRev, b.perClip]);

// Object facings and column slicing are part of the view (absent on sprites made before them: the same as unset).
type ViewOf = SpriteSpec['view'];
const scaleText = (sc: ViewOf['scale']) => (sc.mode === 'fit' ? 'fit' : sc.mode === 'ppm' ? `ppm ${sc.ppm}` : `tile ${sc.tilePx}x${sc.shape === 'diamond' ? sc.tilePx / 2 : sc.tilePx} @${sc.metresPerTile} m`);
const shown = (v: unknown) => (v === undefined || v === null ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v));
/**
 * The view fields a render depends on, each with the name a reason gives it (FB-055: "fps changed (12 → 10)", not
 * "view or size changed"). `defaulted`: the fields whose new value is a default (the declaration left them out).
 */
const VIEW_FIELDS: { name: string; get: (v: ViewOf) => unknown; text?: (v: ViewOf) => string }[] = [
  { name: 'projection', get: (v) => v.projection },
  { name: 'pitch', get: (v) => v.pitch },
  // Chosen directions (FB-098) count only when set, so specs without them compare as before.
  { name: 'dirs', get: (v) => (v.angles?.length ? [v.directions, v.angles] : v.directions), text: (v) => dirsText(v) },
  { name: 'direction basis', get: (v) => v.basis },
  { name: 'mirror', get: (v) => v.mirror },
  { name: 'direction order', get: (v) => v.order },
  { name: 'direction names', get: (v) => v.naming },
  { name: 'frame size', get: (v) => [v.frameWidth, v.frameHeight], text: (v) => `${v.frameWidth}×${v.frameHeight}` },
  { name: 'scale', get: (v) => sortKeys(v.scale), text: (v) => scaleText(v.scale) },
  { name: 'fps', get: (v) => v.fps },
  { name: 'padding', get: (v) => v.padding },
  { name: 'pivot height', get: (v) => v.pivotBottom ?? null },
  { name: 'facings', get: (v) => v.facings ?? null },
  { name: 'slice', get: (v) => v.slice ?? null },
];
function viewChanges(a: ViewOf, b: ViewOf, defaulted: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of VIEW_FIELDS) {
    if (JSON.stringify(f.get(a)) === JSON.stringify(f.get(b))) continue;
    // Pixels per metre on both sides reads as "ppm changed (64 → 128)".
    const name = f.name === 'scale' && a.scale.mode === 'ppm' && b.scale.mode === 'ppm' ? 'ppm' : f.name;
    const before = name === 'ppm' ? String((a.scale as { ppm: number }).ppm) : f.text ? f.text(a) : shown(f.get(a));
    const after = name === 'ppm' ? String((b.scale as { ppm: number }).ppm) : f.text ? f.text(b) : shown(f.get(b));
    out.push(`${name} changed (${before} → ${defaulted.includes(name) || (name === 'ppm' && defaulted.includes('scale')) ? 'default ' : ''}${after})`);
  }
  return out;
}
/** The object collision settings (FB-050): they change the manifest's polygons, not the pixels. */
const collisionKey = (s: SpriteSpec) => JSON.stringify([s.view.collisionHeight ?? null, s.view.collision && s.view.collision !== 'auto' ? s.view.collision : null]);
/** The look (quality) fields that differ, by name: "supersample changed (2 → 3)", "outline changed (true → false)". */
function lookChanges(a: SpriteSpec, b: SpriteSpec, defaulted: readonly string[]): string[] {
  const qa = (a.view.quality ?? {}) as Record<string, unknown>, qb = (b.view.quality ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(qa), ...Object.keys(qb)])].sort()
    .filter((k) => stableJson(qa[k] ?? null) !== stableJson(qb[k] ?? null))
    .map((k) => (typeof (qa[k] ?? qb[k]) === 'object' ? `look changed (${k})` : `${k} changed (${shown(qa[k])} → ${defaulted.includes(k) ? 'default ' : ''}${shown(qb[k])})`));
}
/** The sprite's light in canonical form (plain day and unset are the same: null). */
const lightKey = (s: SpriteSpec) => stableJson(normalizeLight(s.light));
/** How equipment comes out: baked into the body's sheet, or one layer per item (mask / none). No items: nothing to layer. */
export const layeringOf = (s: Pick<SpriteSpec, 'layered' | 'loadout'>): 'baked' | 'mask' | 'none' =>
  !s.layered || !s.loadout?.length ? 'baked' : s.layered === 'none' ? 'none' : 'mask';

/**
 * A spec's moves as data, with every skeletal clip's identity (its id and name) taken out and listed apart, in
 * order: the set and states with every parameter (template params, transition params, state looks such as
 * "scorch:dark=0.9").
 */
function movesKey(x: SpriteSpec): { key: string; clips: { clip?: number; name: string }[] } {
  const clips: { clip?: number; name: string }[] = [];
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    if (o.type === 'anim' && typeof o.name === 'string') {
      const { name, clip, ...rest } = o;
      clips.push({ ...(typeof clip === 'number' ? { clip } : {}), name: name as string });
      return Object.fromEntries(Object.entries(sortKeys(rest)).map(([k, w]) => [k, strip(w)]));
    }
    return Object.fromEntries(Object.entries(sortKeys(o)).map(([k, w]) => [k, strip(w)]));
  };
  const key = stableJson(strip([x.setId, x.baseSet ?? null, x.classes, x.extraItems, x.excluded ?? [], x.states ?? null, x.movePrefix !== false]));
  return { key, clips };
}

/**
 * Whether two specs ask for the same moves. A skeletal clip is keyed by its id (SF-FB-003): one picked as
 * "Fighter_Idle" and then as "MartialArts_Idle" after a rename is the same clip; so is a clip of the same name
 * whose id changed (a re-installed pack) or that a snapshot made before ids were kept names alone.
 */
function sameMoves(a: SpriteSpec, b: SpriteSpec): boolean {
  const ka = movesKey(a), kb = movesKey(b);
  if (ka.key !== kb.key || ka.clips.length !== kb.clips.length) return false;
  return ka.clips.every((c, i) => {
    const d = kb.clips[i];
    return c.name === d.name || (c.clip !== undefined && c.clip === d.clip);
  });
}

/**
 * What rendering the sprite again means, compared with its last render: nothing; only new equipment (rendered
 * against the existing frames and merged in); or everything (new moves, a changed view, look, size, format,
 * gender, effect or lighting — unchanged layers are still reused; removed items' layers are dropped and changed ones replaced).
 */
export interface ChangePlanOptions {
  /** The clip names the render will hold, when the caller knows them. */
  clips?: string[];
  /**
   * Settings whose value is a default because the declaration leaves them out (fps, dirs, ppm, supersample…, by
   * the names reasons use): their reason reads "fps changed (12 → default 10)".
   */
  defaulted?: string[];
  /** Names for held items by asset id (SF-FB-012): reasons read "equipment changed: +SM_Char_Attach_Hair_02". */
  itemName?: (assetId: number) => string | undefined;
}

/** The reason for new held items (SF-FB-012): "equipment changed: +SM_Char_Attach_Hair_02" (or "+2 items" without names). */
export function equipmentReason(items: LoadoutItem[], itemName?: (assetId: number) => string | undefined): string {
  const names = items.map((it) => itemName?.(it.asset));
  return `equipment changed: ${names.every((n) => !!n) ? names.map((n) => `+${n}`).join(', ') : `+${items.length} item${items.length === 1 ? '' : 's'}`}`;
}

export function planChange(prev: RenderedState | null, next: SpriteSpec, sets: AnimationSet[], opts: ChangePlanOptions = {}): ChangePlan {
  const clips = opts.clips ?? specClips(next, sets);
  if (!prev) return { mode: 'full', reuse: true, dropOnly: false, newItems: next.loadout, removedItems: [], newClips: clips, removedClips: [], reasons: ['not rendered yet'], label: 'First render', stale: false };
  const reasons: string[] = [];
  // Without the planned clip names (which need the model and the installed clips), moves count as changed only
  // when the set itself changed: clips a model lacks are left out of a render, and must not look "new" forever.
  const setDiffers = !sameMoves(prev.spec, next);
  const setChanged = !!opts.clips || setDiffers;
  const newClips = setChanged ? clips.filter((c) => !prev.clips.includes(c)) : [];
  const removedClips = setChanged ? prev.clips.filter((c) => !clips.includes(c)) : [];
  const newItems = next.loadout.filter((it) => !prev.loadout.some((o) => sameItem(o, it)));
  const changedItems = next.loadout.filter((it) => prev.loadout.some((o) => sameItem(o, it) && itemChanged(o, it)));
  const removedItems = prev.loadout.filter((o) => !next.loadout.some((it) => sameItem(o, it)));
  if (newClips.length) reasons.push(`new moves: ${newClips.join(', ')}`);
  if (removedClips.length) reasons.push(`moves removed: ${removedClips.join(', ')}`);
  // Per-move trims/caps (SF-FB-001): the same moves, cut differently.
  let cut: string[] = [];
  if (setDiffers) {
    const before = clipWindows(prev.spec, sets), after = clipWindows(next, sets);
    cut = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k] && !newClips.includes(k) && !removedClips.includes(k));
  }
  // Same clip names, other settings: a template's or a state's parameters changed (FB-042). A trim is reported as such.
  const paramsChanged = setDiffers && !newClips.length && !removedClips.length && !cut.length;
  if (paramsChanged) reasons.push('move settings changed');
  if (prev.spec.assetIds.length && next.assetIds.length && JSON.stringify(prev.spec.assetIds) !== JSON.stringify(next.assetIds)) reasons.push('model changed');
  reasons.push(...viewChanges(prev.spec.view, next.view, opts.defaulted ?? []));
  reasons.push(...lookChanges(prev.spec, next, opts.defaulted ?? []));
  if (collisionKey(prev.spec) !== collisionKey(next)) reasons.push('collision changed');
  if (stableJson(prev.spec.turret ?? null) !== stableJson(next.turret ?? null)) reasons.push('turret split changed');
  if (stableJson(prev.spec.split ?? null) !== stableJson(next.split ?? null)) reasons.push('waist split changed');
  if (stableJson(prev.spec.portrait ?? null) !== stableJson(next.portrait ?? null)) reasons.push('portrait changed');
  // SF-FB-024: the model's own size factor; every frame changes, so nothing of the last render is reused.
  const scaleChanged = (prev.spec.modelScale ?? 1) !== (next.modelScale ?? 1);
  if (scaleChanged) reasons.push(`model scale changed (×${prev.spec.modelScale ?? 1} → ×${next.modelScale ?? 1})`);
  if (prev.spec.profileId !== next.profileId || JSON.stringify(prev.spec.layers) !== JSON.stringify(next.layers) || (prev.spec.loadout?.length && next.loadout.length && layeringOf(prev.spec) !== layeringOf(next))
    || (prev.spec.animPrefix ?? null) !== (next.animPrefix ?? null) || !!prev.spec.atlas !== !!next.atlas || !!prev.spec.uniformFrame !== !!next.uniformFrame
    || (prev.spec.pivot ?? 'anchor') !== (next.pivot ?? 'anchor')) reasons.push('format changed');
  if ((prev.spec.maxSeconds ?? null) !== (next.maxSeconds ?? null)) reasons.push('clip length changed');
  if (cut.length) reasons.push(`clip trim changed: ${cut.join(', ')}`);
  if (prev.spec.gender !== next.gender) reasons.push('moves gender changed');
  if (stableJson(prev.spec.fx ?? null) !== stableJson(next.fx ?? null)) reasons.push('effect look changed');
  // Lighting (FB-060): only a sprite that has one is compared, so sprites rendered before lights stay up to date.
  const lightChanged = lightKey(prev.spec) !== lightKey(next);
  if (lightChanged) reasons.push('lighting changed');
  // A removed item whose place (layer or moveset) a new item takes is a swap, not a removal.
  const swapped = removedItems.filter((o) => newItems.some((it) => (o.layer && it.layer === o.layer) || (o.cls && it.cls === o.cls)));
  const plainRemoved = removedItems.length - swapped.length;
  if (changedItems.length) reasons.push(`${changedItems.length} item${changedItems.length === 1 ? '' : 's'} changed`);
  if (swapped.length) reasons.push(`${swapped.length} item${swapped.length === 1 ? '' : 's'} swapped`);
  if (plainRemoved) reasons.push(`${plainRemoved} item${plainRemoved === 1 ? '' : 's'} removed`);
  const full = reasons.length > 0;
  // Only new moves (nothing removed, no item or setting changed): they can be rendered on their own and added to
  // the export (the body and every layer get just the new clips), when the last render allows it (buildRender).
  const onlyNewClips = newClips.length > 0 && reasons.length === 1 && !newItems.length;
  const mode: ChangeMode = onlyNewClips ? 'clips' : full ? 'full' : newItems.length ? 'parts' : 'none';
  const n = newItems.length;
  const dropOnly = full && reasons.length === 1 && removedItems.length > 0 && !newItems.length;
  const label = mode === 'none' ? 'No changes' : mode === 'clips' ? `New moves: ${newClips.join(', ')}` : mode === 'parts' ? `Added ${n} item${n === 1 ? '' : 's'}` : dropOnly ? `Removed ${removedItems.length} item${removedItems.length === 1 ? '' : 's'}` : newClips.length && reasons.length === 1 ? `New moves: ${newClips.join(', ')}` : reasons[0].replace(/^./, (c) => c.toUpperCase());
  // Changed move parameters or lighting change every layer's frames: nothing can be reused.
  // New items are a reason in every mode (SF-FB-012): next to other changes too, not only in a parts-only render.
  // Items that take a removed item's place are already "swapped".
  const added = newItems.filter((it) => !swapped.some((o) => (o.layer && it.layer === o.layer) || (o.cls && it.cls === o.cls)));
  const equipment = added.length ? [equipmentReason(added, opts.itemName)] : [];
  return { mode, reuse: !paramsChanged && !lightChanged && !scaleChanged, dropOnly, newItems, removedItems, newClips, removedClips, reasons: full ? [...reasons, ...equipment] : equipment, label, stale: renderedByOlder(prev.spec) };
}

/** A sprite is outdated when rendering it again would change something. */
export const isOutdated = (prev: RenderedState | null, next: SpriteSpec, sets: AnimationSet[], opts: ChangePlanOptions = {}) => planChange(prev, next, sets, opts).mode !== 'none';

/** Which inherit groups differ between a sprite and its project (for the "own view" badges). */
export function overriddenGroups(project: ProjectDefaults, sprite: SpriteSpec): InheritGroup[] {
  const inherit = sprite.inherit ?? [];
  return INHERIT_GROUPS.filter((g) => !inherit.includes(g));
}

/**
 * A sprite's kind as the gallery and `ssg sprites --kind` filter it: the Wizard kind its spec stores (object,
 * prop, character, vehicle, weapon), else the stored kind (sprites made before kinds were Wizard kinds keep the
 * library kind, e.g. prop or multipart).
 */
export const spriteKindOf = (s: { kind: string; spec?: { kind?: string } | null }): string => (s.spec?.kind && s.spec.kind !== 'all' ? s.spec.kind : s.kind);
