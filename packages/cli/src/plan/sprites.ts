/**
 * Moved from synty-sprite-generator packages/client/src/sprites.ts (P2, ali3b/sloponator#8): only the pure helpers
 * of the old CLI/MCP sprite module (the option lookups by id or plain word, project templates, the tile-lock
 * project settings, the one-line description). Finding, creating, changing, rendering and downloading sprites on
 * the old server stayed behind.
 */
import { BUILTIN_PROFILES, VIEW_PRESETS, parseLight, type ExportProfile, type SpriteLight } from '@slop/sprites';
import { parseTileSize } from './buildSpec.js';
import { applyLook, applySize, applyViewCard, initialState } from './state.js';
import { projectDefaultsOf, type ProjectDefaults, type SpriteSpec } from './spriteSpec.js';
import { PROJECT_TEMPLATES } from './templates.js';
import { ENGINE_WORDS, LOOKS, SIZES, VIEW_WORDS, wizKindForAsset, type LookId, type SizeId, type WizKind } from './words.js';

export class SpriteError extends Error {}

const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const byIdOrName = <T extends { id: string; name: string }>(list: T[], ref: string) => list.find((x) => x.id === ref) ?? list.find((x) => ci(x.name, ref));

/** A folder-safe version of a sprite or project name. */
export const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, '_').trim() || 'untitled';

// ---- templates and words ----

/** The shared settings a project template stands for (same as the web's New project dialog). */
export function templateDefaults(id: string): ProjectDefaults {
  const t = PROJECT_TEMPLATES.find((x) => x.id === id) ?? PROJECT_TEMPLATES.find((x) => ci(x.name, id));
  if (!t) throw new SpriteError(`Unknown project template "${id}". Templates: ${PROJECT_TEMPLATES.map((x) => x.id).join(', ')}.`);
  let s = initialState();
  s = applyViewCard(s, t.viewId);
  s = applyLook(s, t.look);
  s = applySize(s, t.size);
  return projectDefaultsOf({ ...s, profileId: t.profileId });
}

/**
 * A project's settings with a tile lock: its sprites share the scale of the game's tiles ("64x32" iso diamond,
 * "32x32" square), so characters, vehicles and objects line up 1:1 on the map. The size becomes custom.
 */
export function withTileScale(d: ProjectDefaults, tile: string, metresPerTile = 1): ProjectDefaults {
  if (!(metresPerTile > 0)) throw new SpriteError('metres per tile must be above 0.');
  let t: ReturnType<typeof parseTileSize>;
  try {
    t = parseTileSize(tile);
  } catch (e) {
    throw new SpriteError((e as Error).message);
  }
  return { ...d, sizeId: 'custom', view: { ...d.view, scale: { mode: 'tile', ...t, metresPerTile }, padding: 2 } };
}

/** "Top-down, 8 directions · Clean · Medium · Godot 4" */
export function describeDefaults(d: Pick<SpriteSpec, 'viewCardId' | 'view' | 'lookId' | 'sizeId' | 'profileId'>) {
  const view = VIEW_WORDS[d.viewCardId]?.title ?? `Custom view (${d.view.directions} directions)`;
  const look = LOOKS.find((l) => l.id === d.lookId)?.title ?? 'Custom look';
  const sc = d.view.scale;
  const size = SIZES.find((z) => z.id === d.sizeId)?.title
    ?? (sc.mode === 'tile' ? `tile lock ${sc.tilePx}×${sc.shape === 'diamond' ? sc.tilePx / 2 : sc.tilePx} (${sc.metresPerTile} m)` : `${d.view.frameWidth}×${d.view.frameHeight} px${sc.mode === 'ppm' ? ` at ${sc.ppm} px/m` : ''}`);
  const engine = ENGINE_WORDS[d.profileId]?.title ?? d.profileId;
  return `${view} · ${look} · ${size} · ${engine}`;
}

/** The Wizard kind of a library model (character, vehicle, object, prop, weapon); the name tells pickups from scenery. */
export function wizKindOf(assetKind: string, name = ''): Exclude<WizKind, 'all'> {
  return wizKindForAsset(assetKind, name);
}

// ---- option lookups (ids or plain words) ----

export function viewIdFor(ref: string) {
  const v = VIEW_PRESETS.find((p) => p.id === ref || ci(p.label, ref)) ?? VIEW_PRESETS.find((p) => VIEW_WORDS[p.id] && ci(VIEW_WORDS[p.id].title, ref));
  if (!v) throw new SpriteError(`Unknown view "${ref}". Views: ${VIEW_PRESETS.map((p) => p.id).join(', ')}.`);
  return v.id;
}
export function lookIdFor(ref: string): LookId {
  const l = LOOKS.find((x) => x.id === ref || ci(x.title, ref));
  if (!l) throw new SpriteError(`Unknown look "${ref}". Looks: ${LOOKS.map((x) => x.id).join(', ')}.`);
  return l.id;
}
export function sizeIdFor(ref: string): SizeId {
  const z = SIZES.find((x) => x.id === ref || ci(x.title, ref));
  if (!z) throw new SpriteError(`Unknown size "${ref}". Sizes: ${SIZES.map((x) => x.id).join(', ')}.`);
  return z.id;
}
/** An export format by id, name or engine word among the built-in profiles (and any extra ones given). */
export function profileFor(ref: string, extra: ExportProfile[] = []): ExportProfile {
  const all = [...BUILTIN_PROFILES, ...extra];
  const p = byIdOrName(all, ref) ?? all.find((x) => ENGINE_WORDS[x.id] && ci(ENGINE_WORDS[x.id].title, ref));
  if (!p) throw new SpriteError(`Unknown format "${ref}". Formats: ${all.map((x) => x.id).join(', ')}.`);
  return p;
}

/** A light setting from a flag, file or tool, as a SpriteError on a bad one (null = day). */
export function lightFrom(v: unknown): SpriteLight | null {
  try {
    return parseLight(v);
  } catch (e) {
    throw new SpriteError((e as Error).message);
  }
}
