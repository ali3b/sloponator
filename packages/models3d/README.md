# @slop/models3d

The 3D model export of the Sloponator (P3, [#14](https://github.com/ali3b/sloponator/issues/14),
[#15](https://github.com/ali3b/sloponator/issues/15), [#16](https://github.com/ali3b/sloponator/issues/16)): a
game-ready GLB plus a `.model.json` manifest per Synty asset, the built kinds (track pieces, terrain, skydomes,
composites) and the texture export, moved from the old generator and driven by `ssg.models.json` /
`ssg.textures.json` **accepted unchanged**. Node only: gltf-transform and meshoptimizer over the library's ingested
GLBs; sharp for textures. No Blender, no server, no browser.

```ts
import { buildModels, buildTextures } from '@slop/models3d/cli';

await buildModels('ssg.models.json', { out: 'public/models' });        // <name>.glb + <name>.model.json + models.json
await buildTextures('ssg.textures.json', { out: 'public/textures' });  // <name>.png|webp + <name>.json + textures.json
```

Options: `only` (declared names), `force` (ignore the caches), `json`, `dataDir` (the library; default
`$SLOP_LIBRARY_DIR`, `$SLOP_OLD_DATA_DIR` or the old checkout's `data/`), `cacheDir`, `lib` (an open library to
reuse). `slop build` (packages/cli) calls these; `bin/slop-models.mjs` runs them by hand:
`npx tsx packages/models3d/bin/slop-models.mjs models ssg.models.json --out public/models --only truck,barrel`.

The lower levels are exported too: `parseModelsFile` → `exportModel(spec, { lib, cacheDir })` → `applyModels`;
`parseTexturesFile` → `exportTextureAs` → `applyTextures`; and the builders themselves (`buildModel(input)`,
`buildTrackpiece`, `buildTerrain`, `buildSkydome`, `buildComposite`) for anything that already has its inputs.

## What moved from where

Every file carries a header naming its source in `synty-sprite-generator`.

| Here | From | What |
|---|---|---|
| `src/spec/spec.ts` | `packages/shared/src/model3d/spec.ts` | `ModelSpec`, `normaliseSpec`, `specHash` (the export id), `MODEL_EXPORTER_VERSION`, tints, fits, colliders |
| `src/spec/manifest.ts` | `…/manifest.ts` | `ModelManifest` and its parts, wheels, sockets, clips, hinges, `mapWheels`, `boundsOf`, `colliderOf` |
| `src/spec/trackpiece.ts`, `terrain.ts`, `skydome.ts`, `composite.ts` | `…/trackpiece.ts` … | the built kinds: presets, profiles, sweeps, grids, water, scatter, sky rings, composite placements |
| `src/spec/hull.ts`, `silhouette.ts`, `noise.ts` | `…/hull.ts`, `…/silhouette.ts`, `map/noise.ts` | convex hulls, the bare-chassis check, the seeded generator the scatter uses |
| `src/build/modelBuild.ts` | `apps/server/src/modelBuild.ts` | the GLB build: scale fix and origin baked in, wheels re-pivoted, attachments merged, clips merged by bone name with trim/speed/events, poses baked, variants (KHR_materials_variants), paint analysis and tints, texture crop/size/encode (webp), alpha cut-outs, FX emissive, simplify/LODs, seats, dashboards, swatches, trimesh/convex colliders, meshopt |
| `src/build/modelSimplify.ts`, `modelSeats.ts`, `modelDashboard.ts`, `modelSwatches.ts`, `modelNature.ts`, `natureMaterials.ts` | the same names under `apps/server/src/` | simplification with locked borders and card thinning, seat detection, gauges and needles, swatch splitting, Synty nature-pack foliage and triplanar materials |
| `src/build/compositeBuild.ts`, `trackBuild.ts`, `terrainBuild.ts`, `terrainModels.ts` | the same names | the built kinds' GLBs and their resolution (materials sampled from library swatches, props through the model cache) |
| `src/build/glb.ts`, `png.ts`, `companions.ts` | `bundled.ts`, `png.ts`, `companions.ts` | GLB JSON reading and bundled `*_Attach_*` meshes; the PNG/TGA codec; a vehicle's companion pieces (now over the library's rows) |
| `src/resolve/resolve.ts`, `clips.ts`, `names.ts`, `errors.ts` | `apps/server/src/models.ts`, `opSprites.ts` | `findModelAsset`, `pickClip` (qualifiers, old names, ids), `resolveSpec`, `exportModel` and the cache, over `@slop/library` instead of the DB |
| `src/declarations.ts`, `src/apply.ts` | `packages/client/src/models.ts` | `parseModelsFile` (defaults merge, built-kind filtering, CLI string forms; the field checks are `@slop/schema`'s), `applyModels` and the `models.json` index |
| `src/textures.ts` | `apps/server/src/textures.ts`, `tileRender.ts`, `packages/client/src/textures.ts` | the texture list and search, frame-grid detection, export with size/format, `parseTexturesFile`, `applyTextures` and the `textures.json` index |
| `packages/formats/src/model.ts` | `…/manifest.ts` | the `.model.json` schema (`ssg-model`) and the `models.json` index schema, mirrored field for field; a models3d test keeps both types in step |

Inputs come from `@slop/library`: the asset (`glbPath`, `meta`, `scale`, `roles`, `rig`, `grip` — added for this),
attachments, pack folders (nature materials, textures) and the clips' bakes (`animation.bakePath`).

## Caching

`exportModel` is content-addressed, like the old server's `data/models/` but under `$SLOP_CACHE_DIR/models`
(default `~/.cache/slop/models`): one folder per export **id** (`specHash` of the normalised spec with the asset
resolved to its id, so a model asked for by name or by id is one model) holding `<name>.glb`, `<name>.model.json`,
`spec.json` and `source.key`. The source key is a hash of everything the build reads: `MODEL_EXPORTER_VERSION`,
the sha256 of the ingest GLB, the scale fix, part roles, the rig map, the grip sockets, each attachment's GLB hash
and scale, each bake's GLB hash and clip edit, the nature textures' hashes, and the per-feature versions
(seats, colliders, track, terrain, skydome, composite). A different key rebuilds in place under the same id with a
new **rev** (the key's first 16 hex digits); the same key is a hit. The old server stamped files by size and mtime;
hashing their contents makes the key the same on any machine with the same library.

`applyModels` writes the output folder from the cache: a model is copied only when the index has another id or
rev for it or its files are missing; files of models no longer declared are removed (only ones the previous
`models.json` lists, never a path outside the folder); `only` builds some models and keeps the others' entries.
Textures are cheap and are not cached: `textures.json` carries each one's rev (exporter version, file name,
content hash, size, format) and an unchanged rev with the files present is skipped.

## Exporter version policy

`MODEL_EXPORTER_VERSION` (spec/spec.ts, now 9) is part of every source key. Bump it when the exporter's output
changes for the same spec and inputs (a different mesh, manifest field or texture encoding), so every cached model
rebuilds under its id and `applyModels` rewrites it; do not bump it for a change that only affects some kinds when
a per-feature version exists (`SEATS_VERSION`, `COLLIDER_VERSION`, `TRACK_VERSION`, `TERRAIN_VERSION`,
`SKYDOME_VERSION`, `COMPOSITE_VERSION`), and never for a refactor that keeps the bytes. Ids never change: they
hash the spec only. The golden test pins the version 4D Stunts was built with and will fail on a bump until its
expectations are revisited.

## What builds identically

`test/golden.test.ts` rebuilds models from the games' real `ssg.models.json` (fixtures in `packages/schema`) and
compares them with the files in `offroad/public/models` and `4dstunts/public/models` (read-only; skipped when
absent). 4D Stunts' files were made by exporter v9 and rebuild **byte for byte**: a vehicle with eight paint
variants and a fit (car-rally), a posed character (driver-a), a composite (sc-gas-station), a prop (ramp), LODs
over nature materials, a skydome with its panorama and a terrain (checked by hand). Off Road's files were made by
v8 hours before three changes to the old generator; barrel, cone, hay_bale and the six-clip driver_grey are byte
for byte the same, and the rest differ only as the old server itself would now differ:

- **truck:** CS-FB-009 re-ruled steering wheels (`steering`) and gear sticks (`lever`); the v8 file has the
  steering wheel as a `wheel` part. Everything else in the manifest and the GLB's structure is equal.
- **simplified models** (fan_*, crowd_*): v9 simplifies with locked borders and card thinning, so the triangles
  kept differ slightly; manifests are equal.
- **cactus_tall:** v9 keeps LOD0 only of a file that ships its own LOD meshes; smaller GLB, tighter bounds.

Textures: 4D Stunts' `ground-*.png` and `.json` rebuild byte for byte (`test/textures.test.ts`).

## Deferred

- **Previews** (the contact-sheet renders of `ssg model preview`, `modelPreview.ts`, `preview.ts`,
  `previewPage.ts`): they need the render bundle; they will come with `packages/render`.
- **Bakes on demand:** clips are merged from the bakes the old generator already made (`data/bakes`); a clip
  never baked onto a character is refused with code `not-baked`. Baking needs the Blender worker (P2's open item).
- **Projects** (`projectModels.ts`, `project.ts`, `model info`, the MCP tools): the old server's; the catalogue
  replaces them.
- **Pack-ingesting skips** (CS-FB-010): there is no ingest here to wait on.
- **`slop build` / `slop find --textures`**: packages/cli (the other P3 branch) wires `buildModels` /
  `buildTextures` in and prints the texture list.

## Tests

`npm test -w @slop/models3d`: 118 moved unit tests (the spec, hull, silhouette, terrain and track piece suites of
`packages/shared/src/model3d`; `modelBuild`, `modelMaterials`, `modelSeats`, `companions` and the GLB half of
`bundled` from `apps/server/test`) plus 34 new ones: the export and cache over a stand-in library, the clip lookup,
`applyModels`, the declarations, the texture export and apply, the formats mirror, and the golden suite (needs the
old data dir and the game checkouts; skipped with a message otherwise). `ndarray-pixels` is pinned to 5.0.1 at the
root (5.2 uses import attributes Node 18 does not parse).
