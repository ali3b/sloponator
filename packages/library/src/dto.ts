/**
 * The asset and animation records as the old generator's web app and CLI saw them (apps/server/src/main.ts assetDto /
 * animDto → apps/web/src/api.ts `Asset` / `Animation`, packages/client/src/api.ts). The render bundle (@slop/render)
 * and the sprite planner (@slop/cli) were ported from code written against these shapes, so the library hands them
 * out ready-made instead of every port re-deriving them. `glb` / `thumb` are URLs chosen by the caller (the old
 * server served `/files/<rel>`; the render runner answers its own paths).
 */
import type { AnimationEntry, AssetEntry, AssetKind, PartSlot } from './types.js';

export interface AssetDtoPart {
  name: string;
  local: string;
  role: string | null;
  ruleRole?: string | null;
  overridden?: boolean;
  parent?: string | null;
  pivot?: number[];
  bbox_min?: number[];
  bbox_max?: number[];
  spin_axis?: number[];
  pivotM?: number[];
  minM?: number[];
  maxM?: number[];
  sizeM?: number[];
  [k: string]: unknown;
}

/** The old web `Asset` (apps/web/src/api.ts), minus the AI tagging fields nothing here needs. */
export interface AssetDto {
  id: number;
  packId: number;
  pack: string;
  name: string;
  kind: AssetKind;
  status: string;
  error: string | null;
  glb: string | null;
  thumb: string | null;
  variant: string | null;
  variants?: string[];
  bundled?: { file: string; mesh: string; skinned: boolean } | null;
  rig: { profile: string; score: number; map?: Record<string, string> } | null;
  bones?: string[];
  parts?: AssetDtoPart[];
  bounds?: { min: number[]; max: number[] } | null;
  /** Multiply the model's root nodes by this for true metres. */
  scaleFix: number;
  autoScaleFix: number;
  scaleOverridden: boolean;
  sizeSuspect?: string;
  suggestedScale?: number;
  size: [number, number, number] | null;
  sizeM: [number, number, number] | null;
  modular: boolean;
  grip: Record<string, unknown> | null;
  slot: string | null;
  autoSlot?: string;
  category: string | null;
  damaged: boolean;
  tags: string[];
  description: string | null;
  hidden: boolean;
  placements: Record<string, Record<string, unknown> & { rev: number; source: 'human' | 'ai-approved' }>;
}

export interface AssetDtoUrls {
  /** URL of the ingested GLB (the old server: `/files/<rel>`). */
  glb(entry: AssetEntry): string | null;
  thumb(entry: AssetEntry): string | null;
}

/** The old server's `/files/<rel>` URLs. */
export const OLD_FILE_URLS: AssetDtoUrls = {
  glb: (e) => (e.glb ? `/files/${e.glb}` : null),
  thumb: (e) => (e.thumb ? `/files/${e.thumb}` : null),
};

/** The old web `Asset` record for a library entry: what the render bundle and the sprite planner were written for. */
export function assetDto(e: AssetEntry, urls: AssetDtoUrls = OLD_FILE_URLS): AssetDto {
  const meta = e.meta();
  const scale = e.scale();
  const roles = e.roles();
  const parts: AssetDtoPart[] | undefined = meta?.parts?.length
    ? meta.parts.map((p) => {
        const r = roles.find((x) => x.name === p.name);
        return {
          ...p,
          local: r?.local ?? p.name,
          ruleRole: r?.ruleRole ?? null,
          role: r?.role ?? null,
          overridden: r?.overridden ?? false,
          ...(r?.pivotM ? { pivotM: r.pivotM } : {}),
          ...(r?.minM ? { minM: r.minM } : {}),
          ...(r?.maxM ? { maxM: r.maxM } : {}),
          ...(r?.sizeM ? { sizeM: r.sizeM } : {}),
        };
      })
    : undefined;
  const suspect = scale.suspect;
  return {
    id: e.id, packId: e.packId, pack: e.pack, name: e.name, kind: e.kind, status: e.status, error: e.error,
    glb: urls.glb(e), thumb: urls.thumb(e),
    variant: e.variant, variants: meta?.variants && meta.variants.length > 1 ? meta.variants : undefined,
    bundled: meta?.bundled ? { file: meta.bundled.file, mesh: meta.bundled.mesh, skinned: meta.bundled.skinned } : undefined,
    rig: meta?.rig ? { profile: meta.rig.profile, score: meta.rig.score, map: meta.rig.map } : null,
    bones: meta?.bones,
    parts, bounds: meta?.bounds ?? undefined,
    scaleFix: scale.scale, autoScaleFix: scale.auto, scaleOverridden: scale.source === 'override' || scale.source === 'known',
    ...(suspect ? { sizeSuspect: suspect.reason, ...(suspect.suggestedScale ? { suggestedScale: suspect.suggestedScale } : {}) } : {}),
    size: e.size, sizeM: e.size, modular: !!e.modular,
    grip: e.grip(),
    slot: e.slot as PartSlot | null, category: e.category, damaged: e.damaged,
    tags: e.tags, description: e.description, hidden: e.hidden,
    placements: e.placements(),
  };
}

/** The old web `Animation` (apps/web/src/api.ts). */
export interface AnimationDto {
  id: number;
  packId: number;
  pack: string;
  name: string;
  rig: string | null;
  frames: number | null;
  fps: number | null;
  loop: boolean;
  category: string | null;
  set: string | null;
  gender: string | null;
  rootMotion: boolean;
  status: string;
  error: string | null;
  needsMapping: boolean;
  edit?: Record<string, unknown> | null;
  previousNames?: string[];
}

export function animationDto(n: AnimationEntry): AnimationDto {
  return {
    id: n.id, packId: n.packId, pack: n.pack, name: n.name, rig: n.rig, frames: n.frames, fps: n.fps, loop: n.loop, category: n.category, set: n.set, gender: n.gender,
    rootMotion: n.rootMotion, status: n.status, error: n.error, needsMapping: n.needsMapping, edit: n.edit, previousNames: n.previousNames,
  };
}
