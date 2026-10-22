import * as THREE from 'three';
import { CHARACTER_TEMPLATES } from './character';
import { OBJECT_TEMPLATES } from './object';
import { VEHICLE_TEMPLATES } from './vehicle';
import { WEAPON_TEMPLATES } from './weapon';
import { PARTICLE_TEMPLATES } from './particles';
import { DUNGEON_TEMPLATES } from './dungeon';
import { createStage } from './stage';
import { defaults, type Template, type TemplateAsset } from './types';

export const TEMPLATES: Template[] = [...VEHICLE_TEMPLATES, ...WEAPON_TEMPLATES, ...DUNGEON_TEMPLATES, ...CHARACTER_TEMPLATES, ...PARTICLE_TEMPLATES, ...OBJECT_TEMPLATES];

const FLAG_WORDS = new Set(['flag', 'flags', 'banner', 'banners', 'pennant', 'pennants']);
/** A model named like a flag or banner (a whole word: SM_Env_Flag_Pole_01, SM_Prop_FlagLine_01, SM_Prop_Banner_02). */
export const isFlagName = (name: string | undefined) =>
  !!name && name.split(/[_\s\d-]+|(?<=[a-z])(?=[A-Z])/).some((w) => FLAG_WORDS.has(w.toLowerCase()));

/** Templates that make sense for an asset: part templates need their roles; poses need a humanoid rig. */
export function templatesFor(asset: TemplateAsset | null | undefined) {
  if (!asset) return [];
  const roles = new Set((asset.parts ?? []).map((p) => p.role));
  const multipart = (asset.parts ?? []).length > 0;
  const list = TEMPLATES.filter((t) => {
    if (t.kind === 'character') return asset.kind === 'character' && !!asset.rigMap;
    if (t.kind === 'object' || t.kind === 'fx') return asset.kind !== 'character';
    // FB-057: a flag without a flag part (one mesh, e.g. every POLYGON_War flag) waves its cloth by vertex.
    if (t.id === 'flag_wave' && !roles.has('flag') && asset.kind !== 'character' && isFlagName(asset.name)) return true;
    if (!multipart) return false;
    // Gun animations only for guns (melee weapons and bows have no trigger, bolt or magazine).
    if (t.id.startsWith('weapon_')) return roles.has('trigger') || roles.has('bolt') || roles.has('magazine');
    return t.requires.every((r) => roles.has(r)) && (!t.anyOf || t.anyOf.some((r) => roles.has(r)));
  });
  // FX models: particle effects first; everything else: their own part animations first, particles last.
  const rank = (t: Template) => (asset.kind === 'fx' ? (t.kind === 'fx' ? 0 : 1) : t.kind === 'fx' ? 2 : t.kind === 'part' ? 0 : 1);
  return list.sort((x, y) => rank(x) - rank(y));
}

export interface TemplateLayer {
  id: string;
  params: Record<string, number>;
}

/** Build several templates into one clip (e.g. drive + doors). Later layers win on the same property. */
export function buildLayers(root: THREE.Object3D, asset: TemplateAsset, layers: TemplateLayer[]) {
  // One stage per built clip: particle templates add their sprites/copies to it.
  const stage = createStage(root);
  stage.overModel = layers.some((l) => { const k = TEMPLATES.find((x) => x.id === l.id)?.kind; return !!k && k !== 'fx'; });
  const clips = layers
    .map((l) => {
      const t = TEMPLATES.find((x) => x.id === l.id);
      return t ? t.build(root, asset, { ...defaults(t), ...l.params }, stage) : null;
    })
    .filter((c): c is THREE.AnimationClip => !!c);
  if (!clips.length) return null;
  const byName = new Map<string, THREE.KeyframeTrack>();
  for (const c of clips) for (const t of c.tracks) byName.set(t.name, t);
  const duration = Math.max(...clips.map((c) => c.duration));
  for (const t of stage.tracks(duration)) byName.set(t.name, t);
  const C = clips[0].constructor as typeof THREE.AnimationClip;
  return new C(layers.map((l) => l.id).join('+'), duration, [...byName.values()]);
}

/** Ground speed (m/s) the layers are made for: the first locomotion template's, else null. */
export function layerSpeed(layers: TemplateLayer[]) {
  for (const l of layers) {
    const t = TEMPLATES.find((x) => x.id === l.id);
    if (t?.speedMps) return t.speedMps({ ...defaults(t), ...l.params });
  }
  return null;
}

/** Events emitted by the layers, in seconds of the built clip. */
export function layerEvents(layers: TemplateLayer[], clipDuration: number) {
  const out: { t: number; name: string }[] = [];
  for (const l of layers) {
    const t = TEMPLATES.find((x) => x.id === l.id);
    for (const e of t?.events?.({ ...defaults(t), ...l.params }) ?? []) out.push({ t: e.at * clipDuration, name: e.name });
  }
  return out;
}

/**
 * Lay template poses over a skeletal clip: the bones the templates rotate take the templates' rotations, every
 * other track (legs, spine, root motion) stays the clip's own. Used for weapon carries over plain locomotion
 * (a rifle held in both hands while walking). Returns a new clip; the cached original is untouched.
 */
export function overlayClip(root: THREE.Object3D, asset: TemplateAsset, base: THREE.AnimationClip, layers: TemplateLayer[]) {
  const over = buildLayers(root, asset, layers);
  if (!over) return base;
  const rotated = new Map<string, THREE.Object3D>();
  for (const t of over.tracks) {
    if (!t.name.endsWith('.quaternion')) continue;
    const node = root.getObjectByProperty('uuid', t.name.slice(0, -'.quaternion'.length));
    if (node) rotated.set(t.name, node);
  }
  const names = new Set<string>();
  for (const n of rotated.values()) names.add(n.uuid).add(n.name).add(THREE.PropertyBinding.sanitizeNodeName(n.name));
  const kept = base.tracks.filter((t) => {
    const parsed = THREE.PropertyBinding.parseTrackName(t.name);
    return !(parsed.propertyName === 'quaternion' && names.has(parsed.nodeName));
  });
  // A looping pose (hands_up breathing) is stretched to one cycle of the clip, so the clip still loops seamlessly.
  const stretch = isLoop(layers) && over.duration > 0 && base.duration > 0 ? base.duration / over.duration : 1;
  const added = over.tracks.filter((t) => rotated.has(t.name)).map((t) => (stretch !== 1 ? t.clone().scale(stretch) : t));
  return new THREE.AnimationClip(base.name, base.duration, [...kept, ...added]);
}

/** Clips loop unless a layer is a one-shot, or a looping template was asked to play once (`once=1`, e.g. fire:once=1). */
export const isLoop = (layers: TemplateLayer[]) => layers.every((l) => TEMPLATES.find((t) => t.id === l.id)?.loop !== false && !l.params?.once);

export * from './types';
