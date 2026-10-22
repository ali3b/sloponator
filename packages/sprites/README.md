# @slop/sprites

The sprite export core of the Sloponator (P2, [#8](https://github.com/ali3b/sloponator/issues/8)): everything that
turns rendered frames into sheets and manifests, and nothing that renders them. Pure Node/TypeScript: no three.js,
no browser, no DOM types. The render bundle (next task) feeds it frames through `FrameSource` and gets back page
images and files.

## What moved from where

Every file carries a header naming its source in the old generator (`synty-sprite-generator/packages/shared/src/…`).
The old flat `export/` directory and its siblings became:

| Here | From | What |
|---|---|---|
| `profiles/profiles.ts` | `export/profiles.ts` | the 10 built-in engine profiles as data (generic, godot4, unity, phaser3, pixi, aseprite, libgdx, gamemaker, rpgmaker, lpc): layout settings, file patterns and LiquidJS templates; `withAnimPrefix`, `withAtlasLayout`, LPC slots |
| `profiles/render.ts` | `export/render.ts` | the LiquidJS renderer (`createLiquid` with the guid/id64/float/fixed/pascal filters, `renderProfile`) |
| `layout/layout.ts` | `export/layout.ts` | sheet packing: grid, strips and MaxRects atlas pages |
| `layout/compose.ts` | *new* (from `apps/web/src/export/exporter.ts`) | `FrameSource`, opaque-box measuring, page composition, atlas extrusion and frame read-back on plain RGBA arrays |
| `manifest/context.ts` | `export/context.ts` | `buildContext`: the one data model every template renders from |
| `manifest/meta.ts` | `export/render.ts` | `metaData` (`ssg-meta/1`) and `genericData` (the generic sheet JSON) |
| `manifest/layers.ts` | `export/layers.ts` | `ssg-layers/1`: slots, depth rules, the manifest builder, merge/drop/outfits, the Godot helper |
| `manifest/split.ts` | `export/split.ts` | the waist split: which moves go on which sheet, `ssg-split/1` block |
| `manifest/turret.ts` | `object/turret.ts` | hull/turret sets, mount points, `ssg-turret/1` block |
| `manifest/sheetMerge.ts` | `export/sheetMerge.ts` | merging an extension export's sheets into an earlier one |
| `manifest/portrait.ts` | `export/portrait.ts` | portrait spec parsing and bust framing |
| `events/` | `export/strike.ts`, `footsteps.ts`, `groundSpeed.ts`, `bodyBoxes.ts` | strike detection (limbs, combos, windows), footsteps, ground speed, body boxes |
| `validate/validate.ts` | `export/validate.ts` | export validation (frame counts, rects, pivots, bleeding…) |
| `cache/frameCache.ts` | `export/frameCache.ts` | the frame-cache **key** logic and entry meta types (not the store) |
| `object/` | `object/footprint.ts`, `concave.ts`, `slices.ts`, `states.ts`, `scorch.ts` | footprint, collision polygons, concave outlines, tile-column slices, object states and scorch looks |
| `view/camera.ts` | `camera.ts` | projections, direction sets, facings, framing, scale lock |
| `inputs/` | `batch.ts`, `combat.ts`, `classes.ts`, `light.ts`, `categories.ts` | what an export is asked for: animation sets (the built-in sets), loadouts and clip edits, weapon classes, lighting, object categories |
| `hash.ts` | `hash.ts` | SHA-256 and canonical JSON |

Tests and JSON fixtures moved with their modules (28 test files). Left behind on purpose: `object/debris.ts` and
`object/transition.test.ts` (the destroy-transition physics, a render-time simulation that belongs with the render
bundle), `templateCatalog.ts`, `sprite/*` (the Studio's sprite state and plans), `plausibleSize`, `fx`, `map`,
`model3d`, `tileset`. Three tests lost one case each that tested the Studio's state (`light`, `states`, `facings`).

## What changed

- **Frame-cache key.** The old key held `version: { cache, renderer }` with `RENDERER_VERSION` bumped by hand (and
  forgotten). The key now has `version: { cache: FRAME_CACHE_VERSION }` for the entry format and
  `renderer: { backend: 'gpu' | 'software', bundle: '<hash>' }` supplied by the caller: the render bundle's build
  hash invalidates every frame whenever the renderer changes, and GPU and software frames are separate entries that
  are never swapped for each other. `frameUnitKey` refuses an unknown backend or an empty bundle hash.
  `FRAME_CACHE_VERSION` is 2 (the key input changed shape).
- **Types come from `@slop/formats`.** `ScaleRecord`, `ClipEvent`, `BodyBoxes`, `ObjectInfo` (and the object
  direction/state/slice types), `LayersManifest` (`SsgLayers`), `SplitBlock` (`SsgSplit`), `TurretBlock`
  (`SsgTurret`) and `ValidationIssue` are defined once as zod schemas in `@slop/formats` and re-exported here;
  `metaData` returns `SsgMeta` and `genericData` returns `SsgSheet`. `src/formats.test.ts` validates every writer's
  output (and the phaser3 anims JSON) against the schemas and pins `ViewConfig`, `Framing` and `LayoutSettings` to
  the formats' types both ways.
- **Imports** are NodeNext (`.js` extensions, inline `type` imports); `noUncheckedIndexedAccess` is off for this
  package only (the moved code was written without it; 488 index accesses would otherwise need `!`).
- `metaData`/`genericData` moved out of the Liquid renderer into `manifest/meta.ts`.

## What stays in the browser (the render-bundle task)

The old `apps/web/src/export/*` and `apps/web/src/render/*` are not here. They draw; this package only describes:

- `SpriteRenderer` (three.js scene, model preparation, clip sampling, stylize passes, readPixels snapshots).
- `exporter.ts`: the orchestration — sample times, render every clip × direction, measure opaque boxes with
  `opaqueBox(frame)` (now here), lay out with `layoutFrames`, compose pages with `composePages` (now here), PNG
  encode, GIF previews, zip, layered passes and occlusion masking, waist/turret orchestration (`waist.ts`,
  `turret.ts`), portraits, extras.
- the frame-cache **store** (`apps/web/src/export/frameCache.ts`: strips, PNG packing, the size-capped on-disk
  store); only the key moved.
- `clipCap`, `setPlan`, `stylize`: render-time clip and style decisions.

The seam is `layout/compose.ts`: the bundle gives a `FrameSource { width, height, pixels(): Uint8Array }` per
frame key (`frameKey(clip, direction, index)`); `opaqueBox` → `FrameInput.opaque` → `layoutFrames` → `composePages`
→ page RGBA → PNG (encoder of the bundle's choice). `extractFrame` reads a frame back out of a page for the cache.
