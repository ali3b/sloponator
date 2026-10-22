# @slop/bake

Blender bakes on demand (P2, [#69](https://github.com/ali3b/sloponator/issues/69)). A clip is retargeted onto a
character once, by Blender headless, into a **bake store** that belongs to the Sloponator. `slop build` bakes every
clip its sprites need **before** it starts Chromium. Before this package existed, a clip the old generator had never
baked failed the sprite with "no bake of … (Blender bakes on demand are not in the Sloponator yet)".

```ts
import { openLibrary } from '@slop/library';
import { BakeStore, bakeClip, bakeForBuild } from '@slop/bake';

const lib = openLibrary({ dataDir: '/home/andrew/projects/synty-sprite-generator/data' });
const store = new BakeStore({ lib });                                    // $SLOP_CACHE_DIR/bakes, else ~/.cache/slop/bakes
const e = await bakeClip({ asset: 'POLYGON_War/Character_FactoryGirl_01', animation: 798, lib, store });
e.glb;               // …/bakes/a384/n798/d95747cbec93f028/clip.glb  (skeleton + the baked action "n798")
e.sidecar.inputs;    // the key's inputs, written out (below)
e.speed;             // ground speed in m/s (null for in-place loops)
store.find({ asset: 384, animation: 798 });                              // a lookup only: never starts Blender
await bakeForBuild(jobs, { lib, log: console.error });                   // what slop build runs before the render
```

## The worker (`worker/`)

This is the old generator's Blender worker, copied in **unchanged** apart from a header line in each Python file that names
its source (the JSON files are byte-for-byte copies): `retarget.py` (the bake), `synty/rigs.py` + `rigs/*.json` (rig detection, the canonical humanoid),
`synty/roles.py` + `roles.json`, `synty/textures.py`, `ingest.py` (pack ingest: not driven from here yet), and
`tests/` (36 unittest cases, plus `make_test_walk.py`, a fixture generator). `npm test` runs the Python suite through
`test/python.test.ts` (`python3 -m unittest discover -s tests -t .` in `worker/`). Without `python3`, the suite is
skipped with a message.

`src/blender.ts` runs Blender with the old command line (`blender -b --factory-startup -P worker/retarget.py --
@args.json`). The arguments go in a temp file, as before. `SSG_EXTRA_RIGS` points at the old data dir's `rigs/`
(user-confirmed profiles). The result is the `RETARGET_OK {...}` line. The arguments are those of the old `bake.ts`:
`{ source: <clip FBX>, target: <character FBX>, out_glb, clip_name: "n<anim>"|"n<anim>_rm", in_place }`. Blender
is `$SLOP_BLENDER`, else `$SSG_BLENDER`, else `blender` on PATH. Bytecode is not written next to the scripts.

**Check:** baking `Walk_F` (#798) onto asset 378 with this worker and Blender 4.0.2 gives a GLB **byte-identical**
to the bake the old generator left in `data/bakes/a378/n798.glb`.

## The store

```
$SLOP_CACHE_DIR/bakes/                       (default ~/.cache/slop/bakes)
  a<asset>/n<anim>[_rm]/<key16>/clip.glb       the character's skeleton + one baked action (meshes stripped)
                               /clip.glb.json  the sidecar: key, inputs, source, speed, worker result
  a<asset>/n<anim>[_rm]/.<key16>.lock/         a bake in progress (owner pid inside)
  .blender.lock/                               a Blender running on this machine
```

The track name inside the GLB is the same as before (`n<anim>`, `n<anim>_rm` with root motion), so the render page
plays a store bake the way it played an old one. Every entry is written to a temp folder beside its final place and
then renamed, so a reader sees a whole entry or nothing.

### The key

`key = sha256(canonical JSON of)`:

| Input | What it is |
|---|---|
| `store` | `BAKE_STORE_VERSION` (1): the entry format |
| `assetGlbHash` | SHA-256 of the character's ingested GLB: the model the clip plays on (its bone names must match) |
| `assetFbxHash` | SHA-256 of the character's FBX: what Blender reads as the target skeleton. This one is not in the issue's list. It is there because a re-exported FBX with an unchanged GLB would otherwise keep a stale bake |
| `animFbxHash` | SHA-256 of the clip's FBX: the source motion |
| `rootMotion` | false (in place: what sprites use) or true (`_rm`) |
| `worker` | `workerVersion()`: 16 hex characters of a hash over `retarget.py`, `synty/__init__.py`, `synty/rigs.py`, `rigs/*.json` and the user-confirmed `data/rigs/*.json`. An edit to anything a retarget reads re-bakes. `ingest.py`, `textures.py` and `roles.json` do not count |
| `blender` | `Blender 4.0.2`: the first line of `blender --version`, asked once per process |

The sidecar writes the inputs out (`inputs`) next to the full `key`, so it is always clear why two entries differ.
File hashes are remembered per (path, size, mtime) for the life of the process. A lookup costs a `stat` per file,
and each file is hashed once.

### Imports

Lookup order (`find`, which never runs Blender):

1. this store's bake for the current inputs and the installed Blender;
2. the old generator's bake of the pair (`data/bakes/a<asset>/n<anim>[_rm].glb` + `.glb.json`, through the
   library's `bakePath()`): if it was imported earlier, that copy is used. Otherwise it is **copied in now** under
   a key whose `worker` and `blender` are `"old-generator"`, with `source: 'imported'`, `importedFrom` and the old
   `speedMps` in the sidecar;
3. with no Blender installed: this store's newest bake of the same inputs by any Blender version.

`ensure` (and `bakeClip`) bake only when `find` has nothing. As a result, nothing the old generator already baked is
baked again (86 models' worth on this machine, about 6 ms per import). `SLOP_BAKE_NO_IMPORT=1` (or `import:
false`) turns imports off.

### Locks and the queue

- **In one process:** concurrent `ensure`s of one key share one promise (the old `inflight` map). A `BlenderQueue`
  runs one Blender at a time.
- **Across processes (two `slop build`s):** a per-key lock directory (`mkdir` is atomic). The second build waits,
  says so (`bake: … is being baked by another process; waiting for it`), and then finds the entry. `.blender.lock`
  also keeps two builds from running two Blenders at once. A lock whose owner pid is gone, or that is older than
  30 minutes, is taken over.
- **With the render:** `slop build` calls `bakeForBuild` after planning and before `startRunner`. The runner only
  looks clips up (and imports). It never starts Blender, so Blender's CPU load and the shared GPU's Chromium never
  overlap.

## What a build bakes (`src/plan.ts`, `src/clips.ts`)

`neededClips(jobs, lib)` resolves every skeletal item of each sprite's set **and of its `uniformWith` siblings**.
The siblings matter because the page measures their clips for the shared frame and quietly skips a sibling clip it
cannot load, which would change the frame size. Resolution follows the page: an `anim` item's clip, a `match`
item's best hit or its `orElse` chain, the Masculine/Feminine copy by `gender` (`auto` guesses from the name), the
copy made for the character's rig. Props and other non-characters are skipped, as on the page. `src/clips.ts` is a
copy of the page's `setPlan.ts`/`groupAnimations`. The render bundle was left untouched. `test/library.test.ts`
checks that the two agree on every built-in set item for a spread of characters and all three gender choices.

`bakeForBuild` prints:

```
bakes: 2 clips imported from the old generator's data/bakes into ~/.cache/slop/bakes
baking 1 clip with Blender 4.0.2: 1/1 Walk_F on Character_FactoryGirl_01 (factory_girl) …
  baked Walk_F on Character_FactoryGirl_01 in 1.2 s
```

A failed bake does not stop the build. It is logged with Blender's error, and the sprite that needs the clip then
fails at render with the 409 below, while the other sprites are still built. Without Blender, the missing clips are
listed with the fix (`set SLOP_BLENDER`).

## The frame cache and the bake's identity

The frame-cache key does **not** need the bake key. `clip.data` in `FrameUnitKeyInput` is `clipDataHash` of the
clip after every edit (`packages/render/web/export/frameCache.ts`), which hashes every track's name, times, values
and interpolation. Two bakes that differ by one keyframe value give different frames. A re-bake that comes out
byte-identical (as Blender 4.0.2 does, see above) keeps its cached frames. A rebuild after wiping the store re-baked
and reused all 16 frames from the cache. Adding the bake key would only throw those frames away. The speed in the
sidecar does not reach a frame: it goes into the data files, which are packed again on every build.

## Reproducibility across Blender versions: the policy

The render and library READMEs carry no measured note on this, so the facts and the choice are recorded here.
Blender's FBX importer and glTF exporter change between releases: bone rolls, the leaf-bone handling, sampling and
float rounding of the exported keyframes. A bake from another Blender is therefore a different input and can move
pixels. On this machine (4.0.2) the same bake twice is byte-identical, and so is the old generator's bake of the
same pair with the same Blender.

- **Own bakes are exact.** The Blender version and the worker hash are in the key, so an upgrade or a worker fix
  re-bakes (seconds per clip) instead of silently mixing versions. The frame cache then follows by content.
- **Imports are kept** whatever Blender is installed now: they are what the old generator made and what the
  goldens were measured against. Their key says `old-generator` instead of guessing a version. To re-bake them with
  the current Blender, set `SLOP_BAKE_NO_IMPORT=1`.
- **Without Blender** (CI, a machine without it), a bake of the same inputs by any Blender is used rather than
  failing. Only missing clips are refused.

## Tests

`npm test`:

- `test/store.test.ts`: a stubbed Blender (`test/fixtures/stub-blender.mjs`) and a fake library. Covers the key
  inputs and each thing that changes them, the sidecar, imports, one run per key in one process and across two
  stores, no overlapping runs, refusals (not a character, no rig), a failed bake leaving nothing behind, no Blender,
  and stale and held locks.
- `test/python.test.ts`: the worker's unittest suite.
- `test/library.test.ts` (old data dir): the clip resolution agrees with the page, and `neededClips` handles gender,
  siblings and props.
- `test/blender.test.ts` (old data dir + Blender): **one real bake** (about 1.3 s). Walk_F goes onto
  Character_FactoryGirl_01, a character with nothing in `data/bakes`. three's GLTFLoader loads it with the clip
  `n798` on her bones, and a second store finds it without Blender.
- `packages/cli/test/bake.test.ts`: `slop build` on a tiny file using that clip. It checks the bake line before the
  runner starts, the store entry, the sheet (1 clip × 2 directions × 8 frames), and byte-identical output from a
  forced second build. `packages/render/test/bakes.test.ts`: the runner's `/slop/bake` from the store (an import),
  and the 409.
