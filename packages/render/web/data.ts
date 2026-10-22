/**
 * The render bundle's data access: what apps/web/src/api.ts gave the old renderer (assets, clips, bakes), fetched
 * from paths the Node runner answers in-process (packages/render/src/runner.ts, `page.route`). No server exists:
 * the origin is a name only this browser knows. The record shapes are the old DTOs, handed out by @slop/library.
 */
import type { AnimationDto, AssetDto } from '@slop/library';
import type { Grip, PlacementFixes } from '@slop/sprites';
import type { PartMeta } from './anim/templates/types';

/** The old web `Asset`: the library's DTO with the fields the renderer reads typed as it reads them. */
export type Asset = Omit<AssetDto, 'parts' | 'grip' | 'placements'> & { parts?: PartMeta[]; grip?: Grip | null; placements?: PlacementFixes };
export type Animation = AnimationDto;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export const api = {
  asset: (id: number) => fetch(`/slop/assets/${id}`).then((r) => json<Asset>(r)),
  animations: () => fetch('/slop/animations').then((r) => json<Animation[]>(r)),
  /** The baked (retargeted) clip of an animation on a character: its GLB URL, the track name and the recorded ground speed. */
  bake: (asset: number, animation: number, inPlace = true) =>
    fetch(`/slop/bake/${asset}/${animation}${inPlace ? '' : '?rm=1'}`).then((r) => json<{ url: string; clip: string; speed?: number | null }>(r)),
};

/**
 * One copy per (pack, gender, category, name, root motion) of the installed clips, preferring the copy made for the
 * target rig (apps/web/src/api.ts groupAnimations).
 */
export function groupAnimations(anims: Animation[], targetRig: string | null) {
  const preferredSet = targetRig === 'synty_ue' ? 'Sidekick' : targetRig === 'synty_legacy' ? 'Polygon' : null;
  const groups = new Map<string, Animation>();
  for (const a of anims) {
    if (a.status !== 'ready') continue;
    const key = `${a.pack}|${a.gender ?? ''}|${a.category ?? ''}|${a.name}|${a.rootMotion}`;
    const cur = groups.get(key);
    if (!cur || (a.set === preferredSet && cur.set !== preferredSet) || (a.rig === targetRig && cur.rig !== targetRig)) groups.set(key, a);
  }
  return [...groups.values()];
}
