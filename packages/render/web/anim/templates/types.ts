import type * as THREE from 'three';
import type { Stage } from './stage';

export type PartRole =
  | 'wheel' | 'wheel_door' | 'track' | 'steering' | 'canopy' | 'door' | 'propeller' | 'control_surface'
  | 'turret' | 'barrel' | 'trigger' | 'bolt' | 'magazine' | 'projectile' | 'lid' | 'lift' | 'emissive' | 'static'
  | 'lever' | 'drawer' | 'gate' | 'blade' | 'arm' | 'chain' | 'flag' | 'gauge' | 'needle';

export interface PartMeta {
  name: string;
  local: string;
  role: PartRole | null;
  /** Role from the rules (before any user override). */
  ruleRole?: PartRole | null;
  overridden?: boolean;
  parent: string | null;
  pivot: [number, number, number];
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/** What a template may need besides the scene: parts for vehicles/props, the rig map for characters. */
export interface TemplateAsset {
  kind: string;
  /** The model's name: a one-mesh model named like a flag (Flag, Banner, Pennant) can still wave (FB-057). */
  name?: string;
  parts?: PartMeta[];
  /** canonical bone -> native bone name (characters). */
  rigMap?: Record<string, string>;
}

/**
 * A procedural animation. Kinds:
 *   part      rigid multi-part assets (vehicles, weapons, doors) — needs the listed part roles
 *   object    any asset as a whole (props, pickups, FX meshes, icons)
 *   character procedural poses on the humanoid rig (sit, drive)
 */
export interface Template {
  id: string;
  label: string;
  kind: 'part' | 'object' | 'character' | 'fx';
  /** Roles that must all exist on the asset (part templates). */
  requires: PartRole[];
  /** At least one of these roles must exist (part templates). */
  anyOf?: PartRole[];
  /** False for one-shots (door opening, fall over, destroy). */
  loop: boolean;
  params: ParamSpec[];
  /** `stage` adds per-clip objects (mesh copies, particle sprites); see stage.ts. */
  build(root: THREE.Object3D, asset: TemplateAsset, params: Record<string, number>, stage: Stage): THREE.AnimationClip;
  /** Poses the arms around a held gun itself: the weapon is held along the gun forearm in this clip (not the idle grip). */
  gunPose?: boolean;
  /**
   * With gunPose: how the clip holds a moveset's weapon. 'two_hand': along the line from the gun hand to the free hand
   * (a launcher on the shoulder); default: along the gun forearm.
   */
  gunGrip?: 'two_hand';
  /**
   * An arm-only pose (FB-076): it rotates nothing below the shoulders, so it can lie over a locomotion clip
   * (`hands_up_walk`, `rifle_carry_run`: see templateCatalog armPoseMove and overlayClip).
   */
  armPose?: boolean;
  /** Ground speed (m/s) an in-place locomotion template is made for (exported as speedMps). */
  speedMps?: (params: Record<string, number>) => number;
  /** Named events this template emits, at a fraction (0..1) of its length: e.g. an impact's "impact" at 0. */
  events?: (params: Record<string, number>) => { at: number; name: string }[];
}

/** @deprecated name kept for existing imports */
export type PartTemplate = Template;

export function defaults(t: Template) {
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]));
}

export const duration = (min = 0.25, def = 1, max = 6): ParamSpec => ({ key: 'duration', label: 'Length (s)', min, max, step: 0.05, default: def });
