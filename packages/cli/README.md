# @slop/cli

`slop`, the Sloponator's command line (P2, [#13](https://github.com/ali3b/sloponator/issues/13),
[#11](https://github.com/ali3b/sloponator/issues/11)). This version has one command:

```
node packages/cli/bin/slop.mjs build ssg.assets.json --out public/assets [--gpu auto|nvidia|egl|software] [--only joe,skull] [--force] [--json]
```

It works like a compiler (docs/PLAN.md §3): it reads a game's `ssg.assets.json` **unchanged**, validates it
(`@slop/schema`, errors that teach), plans every sprite exactly as the old `ssg sprite apply` did, renders through
`@slop/render` (one Chromium for the whole build, frames from the cache when nothing changed) and packs through
`@slop/sprites` in the format the file names, writing `<out>/<name>/` with the same file names and manifests the old
`ssg sprite apply --render --download` wrote, so a game's loader is unchanged. Progress goes to stderr:

```
project "Montezuma's Revenge": view side2, look pixel, size small, format phaser3, fps 12 taken from the old generator's project (the file sets none; …)
render runner: bundle 142e48f26a576104, nvidia → gpu (ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL ES 3.2))
sprite 1/16 joe: POLYGON_War/Character_GentleMan_01, 8 moves
sprite 1/16 joe: 8 clips × 2 dirs, 430 frames, 430 from cache, 1.7 s → public/assets/joe
…
skipped: tilesets (tomb): not built by this version (P4)
```

`--json` prints a machine summary on stdout (bundle hash, backend, per sprite: files, frames, cached frames, time,
validation, warnings or error). The exit code is 1 when any sprite failed; the others are still written.

## Planning (`src/plan/`)

The old generator's planning code, ported with its tests (115) and the same behaviour: `apply.ts` (the declarations,
their aliases and rules, `entryOf`, `parseApplyFile`, `spriteSpecFor`), `buildSpec.ts` (`buildSpec`, the lookups of
models, clips, templates, states, held items), the sprite state/spec/render layer (`effectiveSpec`, `toBatchSpec`,
`buildRender`, `uniformSiblings`), the words (view/look/size cards) and the template catalogue. The lookups run on
`@slop/library` (`sources.ts`) through the old DTO shapes. `planSprites(file, { lib, project, force, only })` gives one
`BatchSpec` per sprite: what the old server queued for the sprite's first render, `uniformWith` filled from the
file's other sprites of the same model, `noCache` when forced.

**Shared settings.** The old generator kept a project's view, look, size, format and fps in its database; a
`ssg.assets.json` that named only the project inherited them. `slop build` takes them from the file's own `defaults`
(or top-level keys) when it has any; else, when the file's `project` is one the old library still has, from that
project, with a line on stderr saying so (put them in `defaults` to be explicit); else the built-ins (top-down 8,
clean, medium, generic).

## Build (`src/build/`)

- `build.ts`: validate → plan → `startRunner` → per sprite: render, `pack`, write `<out>/<name>/` (the folder is
  replaced, as before). `generatedAt` in the data files is the declaration file's mtime, so an unchanged file builds
  byte for byte again; `generator` names the Sloponator.
- `pack.ts`: the old exporter's second half: `layoutFrames` on the measured frames, `composePages` (pure RGBA), PNG,
  the profile's Liquid files, `validateSheets` (recorded in the meta/json), the generic `.sheet.json` next to every
  sheet unless the format's `{base}.json` already is it.

**Bakes:** after planning and before the browser starts, `bakeForBuild` (`@slop/bake`) collects every skeletal clip
the sprites (and their uniform-frame siblings) play, imports the old generator's bakes, and bakes the missing ones
with Blender, one at a time (`baking 3 clips with Blender 4.0.2: 1/3 Walk_F on … …`). See packages/bake/README.md.

Cache: `$SLOP_CACHE_DIR` or `~/.cache/slop` (`bundles/<sourceHash>/`, `frames/<kk>/<key>/`, `bakes/a<asset>/n<anim>/<key>/`); the frame-cache key is
`@slop/sprites` `frameUnitKey` with `renderer: { backend, bundle }` — see `packages/render/README.md`. The library:
`--data-dir`, `$SLOP_OLD_DATA_DIR`, else `~/projects/synty-sprite-generator/data`.

## What this version does not build (said loudly, never silently)

- No tilesets or maps (reported as skipped; P4), no 3D (P3).
- No layered equipment sheets (`layered`), waist or turret splits, portraits: a sprite that asks for one fails with
  a message before anything renders. Equipment baked into the body (Monty's hat) is fine.
- No previews (GIFs), no incremental/aligned renders: every build is a full render, cheap because of the frame cache.

## Goldens (`test/goldens/`)

`goldens.test.ts` builds Monty's `joe` and `skull` (`packages/schema/test/fixtures/monty.assets.json`) and compares
them with the old generator's output for the same file: every sheet pixel for pixel, every manifest apart from its
maker's name; then builds again and expects byte-identical files. One golden per backend (`monty.software.json`,
`monty.gpu.json`): a GPU and SwiftShader rasterise differently, down to the atlas width.

The reference is produced once with `node packages/cli/test/goldens/make-reference.mjs --gpu software|nvidia` (the
old generator's CLI against a private copy of its database and a browser launched by the script, as spike 1 did;
nothing touches its shared servers or data) into `~/.cache/slop/goldens/<backend>/monty/`. Only hashes and sizes are
committed (Synty art never is); the test downloads nothing and skips with a message when the old data dir or the
reference is absent, and the GPU golden when the machine has no GPU driver.

Measured on this machine, all 16 Monty sprites identical to the old generator on both backends (2026-10-22): the old
generator's CLI 8.6 s on the GPU and 23.4 s in software for the 16; `slop build` 3.1 s for joe (430 frames) on the GPU
and 7.5 s in software, 1.7 s from the cache.
