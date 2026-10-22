/**
 * Sprite planning for `slop build`: a validated ssg.assets.json → one BatchSpec per sprite, exactly what the old
 * generator's `ssg sprite apply` + `ssg sprite render` would have queued for each sprite's first render. Modelled on
 * the planning half of synty-sprite-generator packages/client/src/apply.ts `applySprites` and the old server's
 * `withUniformSiblings` (apps/server/src/sprites.ts), P2, ali3b/sloponator#8. Nothing is stored: there is no
 * project DB any more, so every sprite plans as new (no earlier render, no outfits kept).
 */
import type { Library } from '@slop/library';
import { BUILTIN_PROFILES, BUILTIN_SETS, type BatchSpec } from '@slop/sprites';
import type { AssetsFile } from '@slop/schema';
import { defaultedSettings, layeringWarning, parseApplyFile, resolvedSettings, spriteSpecFor, type ResolvedSettings, type SpriteEntry } from './apply.js';
import { SpecError, type Asset } from './buildSpec.js';
import { buildRender, spritePlan, uniformSiblings, type SpriteLike } from './render.js';
import { librarySources } from './sources.js';
import type { InheritGroup } from './state.js';
import { effectiveSpec, type ChangePlan, type ProjectDefaults, type SpriteSpec } from './spriteSpec.js';
import type { WizKind } from './words.js';

export type Kind = Exclude<WizKind, 'all'>;

export interface PlannedSprite {
  /** The sprite's name in the file. */
  name: string;
  /** The resolved model. */
  asset: Asset;
  /** The wizard kind (character, vehicle, object, prop, weapon). */
  kind: Kind;
  /** The stored sprite spec the old `ssg sprite apply` would have saved. */
  spec: SpriteSpec;
  /** effectiveSpec(project, spec): the spec with the project's shared settings applied. */
  effective: SpriteSpec;
  /** What the old server would have queued for this sprite's first render (uniformWith filled from its siblings). */
  batch: BatchSpec;
  /** What the lookups had to guess or drop (the old `notes`), plus the layering warning. */
  warnings: string[];
  /** The setting groups the sprite holds itself (the rest come from the project). */
  own: InheritGroup[];
  /** The declaration as export inputs. */
  entry: SpriteEntry;
  /** The change plan behind `batch` (a first render, forced or not). */
  plan: ChangePlan;
  /** Every setting the render uses, as the old dry run showed them. */
  settings: ResolvedSettings;
}

export interface PlanOptions {
  lib: Library;
  /** The project's shared settings (projectDefaultsFrom(file defaults), or a stored project's). */
  project: ProjectDefaults;
  /** Render every frame again, none from the frame cache (the batch gets noCache). */
  force?: boolean;
  /** Plan only these sprites (by name, case-insensitive); siblings for uniform frames still come from the whole file. */
  only?: string[];
  /** Hears every warning as it happens (they are also on each sprite). */
  warn?: (message: string) => void;
}

const ctx = { sets: BUILTIN_SETS, profiles: BUILTIN_PROFILES };

/** A validated assets file → its sprites' specs and render batches. Every entry is checked before anything is returned. */
export async function planSprites(file: AssetsFile, opts: PlanOptions): Promise<PlannedSprite[]> {
  const { entries } = parseApplyFile(file);
  const project = { defaults: opts.project };
  const src = librarySources(opts.lib);
  const only = opts.only ? new Set(opts.only.map((n) => n.toLowerCase())) : null;
  if (only) {
    const names = new Set(entries.map((e) => e.name!.toLowerCase()));
    const unknown = [...only].filter((n) => !names.has(n));
    if (unknown.length) throw new SpecError(`"only" names sprites the file does not declare: ${unknown.join(', ')}. Declared: ${entries.map((e) => e.name).join(', ')}.`);
  }
  const planned: { entry: SpriteEntry; name: string; spec: SpriteSpec; asset: Asset; kind: Kind; own: InheritGroup[]; notes: string[] }[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    try {
      const notes: string[] = [];
      const warn = (m: string) => {
        if (notes.includes(m)) return;
        notes.push(m);
        opts.warn?.(`${entry.name}: ${m}`);
      };
      const r = await spriteSpecFor(src, project, entry, { warn });
      planned.push({ entry, name: entry.name!, ...r, notes });
    } catch (e) {
      if (!(e instanceof SpecError) && !(e instanceof Error)) throw e;
      errors.push(`${entry.name ?? String(entry.asset)}: ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new SpecError(`Nothing was planned:\n${errors.map((x) => `  ${x}`).join('\n')}`);

  const sprites: SpriteLike[] = planned.map((p, i) => ({ id: i + 1, name: p.name, assetId: p.asset.id, spec: p.spec, current: null, latest: null }));
  const out: PlannedSprite[] = [];
  planned.forEach((p, i) => {
    if (only && !only.has(p.name.toLowerCase())) return;
    const sprite = sprites[i];
    const plan = spritePlan(sprite, project, BUILTIN_SETS, undefined, { force: !!opts.force, defaulted: defaultedSettings(p.entry) });
    let batch = buildRender(sprite, project, ctx, plan).spec;
    // SF-FB-018: the project's other sprites of the same model that want uniform frames share one frame and pivot.
    const uniformWith = uniformSiblings(batch, sprites.filter((s) => s.id !== sprite.id), project, BUILTIN_SETS);
    if (uniformWith.length) batch = { ...batch, uniformWith };
    const effective = effectiveSpec(opts.project, p.spec);
    const warning = layeringWarning(p.entry, effective);
    if (warning) opts.warn?.(`${p.name}: ${warning}`);
    out.push({
      name: p.name, asset: p.asset, kind: p.kind, spec: p.spec, effective, batch, warnings: [...p.notes, ...(warning ? [warning] : [])], own: p.own,
      entry: p.entry, plan, settings: resolvedSettings(effective, BUILTIN_SETS, (id) => planned.find((q) => q.asset.id === id)?.asset.name),
    });
  });
  return out;
}
