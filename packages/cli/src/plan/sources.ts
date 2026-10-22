/**
 * The planner's lookups (`SpecSources`, buildSpec.ts) backed by @slop/library instead of the old server's HTTP API
 * (synty-sprite-generator packages/client/src/jobs.ts `sourcesFor`, P2, ali3b/sloponator#8). The answers are the
 * old DTO shapes (`assetDto` / `animationDto`), so the ported lookups run unchanged. User-made sets, export profiles
 * and job presets lived only in the old DB's `docs` table, which is empty: those sources answer [].
 */
import { animationDto, assetDto, type AssetEntry, type Library } from '@slop/library';
import type { Asset, AssetVariantsDto, PackRef, SpecSources } from './buildSpec.js';
import { SpecError } from './buildSpec.js';

const strip = (s: string) => s.replace(/^(sk_|sm_)/i, '');

/** The old `Asset` DTO for a library entry, with the moveset label the old server put on it. */
export function assetOf(e: AssetEntry): Asset {
  const moveset = e.labels?.moveset?.value;
  return { ...assetDto(e), ...(typeof moveset === 'string' ? { moveset } : {}) };
}

/**
 * Models the old `GET /api/assets?q=` would have listed for a query: the ones called so (also with or without the
 * SK_/SM_ prefix, as `resolveAsset` matches them), then the library's search for suggestions.
 */
function findAssets(lib: Library, query: string, packId?: number): Asset[] {
  const name = query.trim();
  const bare = strip(name);
  const names = [...new Set([name, bare, `SK_${bare}`, `SM_${bare}`])];
  const seen = new Set<number>();
  const out: Asset[] = [];
  const add = (e: AssetEntry) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    out.push(assetOf(e));
  };
  for (const n of names) for (const e of lib.assetsNamed(n, packId)) add(e);
  try {
    for (const e of lib.assets({ query: name, ...(packId !== undefined ? { pack: packId } : {}), limit: 200 })) add(e);
  } catch {
    /* a query the search cannot parse: the exact names above are all there is */
  }
  return out;
}

/** The planner's lookups on a library. `warn` hears about guesses (a model in several packs, a renamed clip). */
export function librarySources(lib: Library, warn?: (message: string) => void): SpecSources {
  return {
    findAssets: async (q, packId) => findAssets(lib, q, packId),
    getAsset: async (id) => {
      const e = lib.asset(id);
      if (!e) throw new SpecError(`No model with id ${id}.`);
      return assetOf(e);
    },
    variants: async (id): Promise<AssetVariantsDto> => {
      const e = lib.asset(id);
      if (!e) throw new SpecError(`No model with id ${id}.`);
      return { asset: { id: e.id, name: e.name, kind: e.kind }, pack: e.pack, ...e.variants() };
    },
    findAnimations: async (q) => lib.animations({ query: q }).map(animationDto),
    profiles: async () => [],
    sets: async () => [],
    presets: async () => [],
    packs: async (): Promise<PackRef[]> => lib.packs().map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    ...(warn ? { warn } : {}),
  };
}
