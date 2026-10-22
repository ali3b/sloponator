/**
 * Synty knowledge that is pure data or code: naming rules → kind and category, attachment bones and slots, scale
 * fixes and known overrides, part roles, rig profiles, pack/clip naming and damaged-state variants. Everything here
 * works without the database or the data dir.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export * from './naming.js';
export * from './categories.js';
export * from './attachments.js';
export * from './scale.js';
export * from './roles.js';
export * from './rigs.js';
export * from './packs.js';
export * from './states.js';

/** A scale override as the old DB keyed it (pack name + FBX path + body variant), with why it exists. */
export interface KnownScaleOverride {
  pack: string;
  fbx: string;
  variant: string;
  /** The model's name (for reading; the key is pack + fbx + variant). */
  name: string;
  scale: number;
  why: string;
}

export const SCALE_OVERRIDES_FILE = fileURLToPath(new URL('./scale-overrides.json', import.meta.url));

/** The overrides exported from the old DB (scale-overrides.json): the German pistol's 10, and whatever is added later. */
export const KNOWN_SCALE_OVERRIDES: readonly KnownScaleOverride[] = (JSON.parse(fs.readFileSync(SCALE_OVERRIDES_FILE, 'utf8')) as { overrides: KnownScaleOverride[] }).overrides;

/** The known override for a model, by the DB's key. */
export function knownScaleOverride(pack: string, fbx: string, variant = ''): KnownScaleOverride | undefined {
  return KNOWN_SCALE_OVERRIDES.find((o) => o.pack === pack && o.fbx === fbx && o.variant === variant);
}
