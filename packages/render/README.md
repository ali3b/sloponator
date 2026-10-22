# @slop/render

The three.js sprite renderer of the Sloponator (P2, [#9](https://github.com/ali3b/sloponator/issues/9),
[#10](https://github.com/ali3b/sloponator/issues/10)): a **render bundle** built once and named by its content hash,
and a **Node runner** that launches Chromium itself, serves the bundle from a made-up origin and answers every data
request in-process from `@slop/library`. No server, no Vite dev server, no "which build is the server serving"
(docs/REVIEW.md §8 items 1–10, 21, 34–36 are gone with it). It renders frames; `@slop/sprites` packs them.

```ts
import { openLibrary } from '@slop/library';
import { startRunner } from '@slop/render';

const lib = openLibrary({ dataDir: '/home/andrew/projects/synty-sprite-generator/data' });
const runner = await startRunner({ lib, gpu: 'auto', log: console.error });   // builds the bundle if needed, launches Chromium
runner.bundle.hash;                                                           // '142e48f26a576104': in every frame-cache key
runner.backend;                                                               // 'gpu' | 'software': what the page reports
const r = await runner.render({ asset: 7171, spec: batchSpec });              // a BatchSpec as @slop/cli plans it
r.output;   // framing, directions, plans, clips (with ground speed), events, object footprint, sockets, body boxes, layout inputs
r.units;    // per clip × direction: decoded RGBA frames (from the render or the frame cache) + the cache key
await runner.close();
```

## The bundle (`web/`)

The old generator's browser-side render code, copied in with headers naming its source (`apps/web/src/render/*`,
`export/*`, `anim/*` of synty-sprite-generator), plus the two pieces of its shared package that only the renderer
used (`shared/debris.ts`, `shared/templateCatalog.ts`). three.js is pinned to the old version (0.170.0), vite to
5.4.11. What was trimmed: React and every page, the batch queue and its server uploads, the GIF previews, the zip,
the layered (one sheet per equipment item) and aligned (`--align-to`) passes, the waist and turret splits and the
portrait. `export/render.ts` is the old exporter's first half: the half that needs the scene.

- `entry.ts` + `index.html`: one `SpriteRenderer` on one canvas and `window.__slop.render(job)`. A job is a library
  asset id and a `BatchSpec`. The page prepares the model (`export/prepare.ts`: load, variant, loadout, FX look,
  lighting, the set's clips), measures the uniform frame over the sibling sprites' clips (`uniformWith`), then
  `runRender`: sample times, framing, object footprint/anchor/collision, footsteps, ground speed, strike events,
  sockets and body boxes per frame, and the frames themselves, styled (outline, grading) and measured (opaque box),
  encoded as one PNG strip per clip × direction and handed to the runner through `window.__slopEmit`.
- `data.ts`: the data the page asks for, from `/slop/...` paths the runner answers (below). The record shapes are
  the old DTOs, handed out by `@slop/library` (`assetDto`, `animationDto`).
- `src/protocol.ts` is the one file both halves share: the job, the per-unit frame data, the render's output.

**Build and hash.** `ensureBundle()` hashes the bundle's inputs (`web/**`, `packages/sprites/src/**`, the three and
vite versions) into `sourceHash`, looks for `<cacheDir>/bundles/<sourceHash>/` and builds it there with Vite when
missing (about 3 s, `minify: false`, content-hashed chunk names). The hash of what came out is the **bundle hash**
(`bundle.json`): the renderer's identity. Every frame-cache key carries it, so any change to the renderer — a
shader, a template, three.js, the measuring code in `@slop/sprites` — invalidates every cached frame by itself. The
old generator bumped a `RENDERER_VERSION` constant for that, 3 times in 131 commits.

## The runner (`src/`)

- `browser.ts`: `chromiumLaunch(gpu)`, ported from the old server. `auto` takes the machine's GPU when a driver is
  found (an NVIDIA card through its EGL vendor library, else whatever EGL device the system offers), `nvidia` / `egl`
  force those, `software` is SwiftShader (several times slower, works anywhere, CI included). The **backend** of a
  render is what the page actually reports (`WEBGL_debug_renderer_info`), not what was asked: a GPU that was not
  picked up renders as `software` and says so.
- `runner.ts`: one Chromium per `startRunner`, closed by `close()` (the CLI opens one per build). The page loads
  `http://slop.render/`, a name only this browser knows; `page.route` answers everything:

  | Request | Answered from |
  |---|---|
  | `/`, `/assets/*` | the bundle's files |
  | `/slop/assets/:id` | `assetDto(lib.asset(id))` (kind, rig, parts and roles, scale fix, grip, placements…) |
  | `/slop/glb/:id` | the asset's ingested GLB (`data/glb/p<pack>/a<id>.glb`) |
  | `/slop/animations` | every ready clip (`animationDto`) |
  | `/slop/bake/:asset/:anim` | the bake the old generator made (`data/bakes/a<asset>/n<anim>.glb` + its speed sidecar), else **409 naming the clip and the model**: Blender bakes on demand are not here yet |
  | `/slop/bakes/:asset/:anim` | the baked GLB |
  | `/slop/fx/:kind` | the POLYGON Particle FX pack's sprites (glow, puff, spark, ring, flame, disc, streak) |

  Around each `render()` the runner runs the **frame cache**: the page sends the key inputs of every clip × direction
  (`@slop/sprites` `FrameUnitKeyInput` minus the renderer), the runner adds `renderer: { backend, bundle }`, computes
  `frameUnitKey`, and answers from the store with the cached per-frame data (the page then skips those units);
  rendered units come back as PNG strips and are stored for the next build. `noCache` on the spec renders everything.
- `frameStore.ts`: `<cacheDir>/frames/<kk>/<key>/meta.json` (`FrameUnitMeta`: opaque boxes, sockets, body boxes per
  frame, the input digests, the renderer) + `body.png` (and `body.<layer>.png`), written atomically. Nothing is ever
  invalidated by hand: the key names the backend and the bundle.
- `strips.ts`: PNG strips ↔ `FrameSource` with pngjs, straight alpha both ways; `encodePng` is deterministic.

**Cache dir:** `$SLOP_CACHE_DIR`, else `~/.cache/slop` (`bundles/`, `frames/`, and the goldens' references).

## Blank frames (#10)

A headless GPU hands back an empty buffer now and then (the old generator saw it about 1 frame in 10 under load on
NVIDIA EGL). The page's cheap sanity check on every frame is its read-back alpha: a frame with no opaque pixel at all
is rendered a second time. A frame still blank after that is accepted only when its neighbours in the clip ×
direction are blank too (a part hidden by its trigger, an empty clip); next to a frame that is not, the render fails
with `BlankFrameError`, naming the clip, direction and frame index, and the CLI reports it (run again, or
`--gpu software`). In 16 sprites × 2 backends of Monty no blank frame occurred.

## Determinism

The same job on the same bundle and backend gives the same frames and, through `@slop/cli`, the same bytes (the
goldens test builds twice). GPU and software frames differ (spike 1: edges and anti-aliasing; the trim boxes then
change the atlas packing), which is why the key separates them and the goldens come per backend.

## Not yet

Layered equipment sheets and the layers manifest, waist/turret splits, portraits, GIF previews, several worker pages,
Blender bakes on demand, the aligned (incremental) passes. `packages/render/web` keeps the code for most of these
(`attach.ts`, `extras.ts` list the parts); what is missing is the pass in `export/render.ts` and the packer.

## Tests

`npm test` (`vitest`): the backend choice, strips, the store, the bundle build into a temp cache dir (~3 s), and the
data handler against the old generator's library (skipped with a message without its data dir). The browser itself
is exercised by `@slop/cli`'s goldens (`packages/cli/test/goldens`).
