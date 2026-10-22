// Moved from synty-sprite-generator apps/server/src/terrainModels.ts (P3, ali3b/sloponator#14).
import fs from 'node:fs';
import { MODEL_EXPORTER_VERSION, SKYDOME_VERSION, TERRAIN_BIOME_MATERIALS, TERRAIN_SLOTS, TERRAIN_VERSION, expandSkydome, specHash, type ModelManifest, type NormalisedModelSpec } from '../spec/index.js';
import { canonicalJson, sha256 } from '@slop/sprites';
import { TrackMaterialError, resolveMaterialSet, type TrackLookup } from './trackBuild.js';
import { buildSkydome, buildTerrain, type PropGlb } from './terrainBuild.js';
import type { BuildResult } from './modelBuild.js';

/**
 * Resolving terrain (CS-FB-003) and skydome (CS-FB-004) specs for models.ts: materials sampled from the library like
 * a track piece's, and the props (scatter, silhouette ring) exported first through the model cache (metres,
 * bottom-centre), so their GLBs are cached and their changes rebuild the terrain.
 */
export interface SceneryDeps {
  lookup: TrackLookup;
  /** Export a library prop through the model cache (throws a ModelError when it cannot): its id, revision, manifest and cached GLB file. */
  exportProp: (ref: string, texSize: number) => Promise<{ id: string; rev?: string; manifest: ModelManifest; glb: string }>;
  /** models.ts's error type: (message, status). */
  error: (message: string, status?: number) => Error;
}

export interface SceneryResolved {
  id: string;
  name: string;
  spec: NormalisedModelSpec;
  label: string;
  build: () => Promise<BuildResult>;
  sourceKey: string;
}

async function prop(deps: SceneryDeps, ref: string, texSize: number): Promise<PropGlb> {
  const r = await deps.exportProp(ref, texSize);
  const src = r.manifest.source as { pack: string; asset: string; assetId: number };
  return { ref, glb: new Uint8Array(fs.readFileSync(r.glb)), pack: src.pack, asset: src.asset, assetId: src.assetId, key: `${r.id}:${r.rev ?? ''}` } as PropGlb & { key: string };
}

export async function resolveScenery(norm: NormalisedModelSpec, deps: SceneryDeps): Promise<SceneryResolved> {
  const name = norm.name!;
  const id = specHash(norm);
  const warnings: string[] = [];
  if (norm.terrain) {
    const t = norm.terrain;
    const defaults = TERRAIN_BIOME_MATERIALS[t.biome ?? 'meadow'];
    let mats;
    try {
      mats = await resolveMaterialSet(TERRAIN_SLOTS, t.materials, defaults, deps.lookup);
    } catch (e) {
      throw deps.error((e as Error).message, e instanceof TrackMaterialError ? 404 : 500);
    }
    warnings.push(...mats.warnings);
    // Scatter props: a prop the library cannot export is an error (it was asked for by name).
    const props: (PropGlb & { key: string })[] = [];
    for (const [k, s] of (t.scatter ?? []).entries()) {
      try {
        props.push((await prop(deps, s.asset, norm.texSize ?? 256)) as PropGlb & { key: string });
      } catch (e) {
        throw deps.error(`terrain.scatter[${k}] ${s.asset}: ${(e as Error).message}`, 404);
      }
    }
    const collider = norm.collider === 'box' ? 'box' : 'trimesh';
    const sourceKey = sha256(canonicalJson({ v: MODEL_EXPORTER_VERSION, terrain: TERRAIN_VERSION, mats: mats.materials, src: mats.sources, props: props.map((p) => p.key) }));
    return {
      id, name, spec: norm, label: `terrain ${t.tile ?? 'grid'}`, sourceKey,
      build: () => buildTerrain({ name, terrain: t, materials: mats.materials, props, collider, texFormat: norm.texFormat, compress: norm.compress, warnings }),
    };
  }
  const s = norm.skydome!;
  const ex = expandSkydome(s);
  // Ring props: the preset's are skipped with a warning when missing; ones the spec names are an error.
  const asked = typeof s.ring === 'object' && !!s.ring.assets;
  const props: (PropGlb & { key: string })[] = [];
  for (const ref of ex.ring?.assets ?? []) {
    try {
      props.push((await prop(deps, ref, 64)) as PropGlb & { key: string });
    } catch (e) {
      if (asked) throw deps.error(`skydome.ring ${ref}: ${(e as Error).message}`, 404);
      warnings.push(`ring: ${ref} skipped (${(e as Error).message})`);
    }
  }
  const sourceKey = sha256(canonicalJson({ v: MODEL_EXPORTER_VERSION, sky: SKYDOME_VERSION, props: props.map((p) => p.key) }));
  return {
    id, name, spec: norm, label: `skydome ${ex.preset}`, sourceKey,
    build: () => buildSkydome({ name, skydome: s, props, texFormat: norm.texFormat, compress: norm.compress, warnings }),
  };
}
