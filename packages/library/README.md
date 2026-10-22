# @slop/library

A typed, **read-only** view of the old generator's Synty library, so the pipeline can start on the 30 GB that is
already ingested instead of ingesting it again. Plus the Synty knowledge that is pure data or code.

```ts
import { openLibrary, synty } from '@slop/library';

const lib = openLibrary({ dataDir: '/home/andrew/projects/synty-sprite-generator/data' });
const soldier = lib.asset('POLYGON_War/Character_American_Soldier_01'); // as ssg.assets.json names models; or an id
soldier.glbPath();          // …/data/glb/p7/a378.glb (null when not on disk)
soldier.scale();            // { scale: 1, source: 'auto', auto: 1, extent: 2.05, suspect: null }
soldier.rig();              // { profile: 'synty_legacy', score: 1, map: { hips: 'Hips', … }, bones: [...] }
lib.asset('POLYGON_War/SM_Wep_German_Pistol_01').scale(); // { scale: 10, source: 'override', auto: 100, … }
lib.assets({ query: 'american soldier', kind: 'character', limit: 10 });
lib.assets({ pack: 'POLYGON_War', category: 'wreck' });
const walk = lib.animation('Walk_F');          // or lib.animations({ query: 'Walk_F', rigKind: 'synty_ue' })
walk.bakePath(soldier.id);                     // …/data/bakes/a378/n798.glb when the old server baked it, else null
lib.close();
```

## What it reads

| Source | Read as |
|---|---|
| `data/library.db` | SQLite, opened with better-sqlite3 `{ readonly: true }` (WAL is read, never checkpointed). Tables: `packs`, `assets` (with the ingest `meta` JSON), `animations`, `scale_overrides`, `part_overrides`, `asset_labels`, `clip_edits`, `assets_fts` (FTS5; a LIKE on the name when absent). |
| `data/packs/<Pack>_v<N>/…` | The extracted packs: `asset.fbxPath()`, `animation.fbxPath()`. The DB stores absolute pack dirs; when they no longer exist the same folder name under `dataDir/packs` is used. |
| `data/glb/p<pack>/a<asset>.glb`, `data/thumbs/…png`, `data/meta/…json` | `glbPath()`, `thumbPath()`, `metaPath()` / `meta()`. |
| `data/bakes/a<asset>/n<anim>.glb` (`n<anim>_rm.glb` with root motion) and the `.glb.json` sidecar | `animation.bakePath(assetId)`, `bakeSpeed(assetId)`. |
| `data/rigs/*.json` | User-confirmed rig profiles, loaded after the built-in ones. |

Everything comes back as plain typed objects (`src/types.ts`: `Pack`, `Asset`, `Animation`, `AssetScale`,
`AssetPart`, `AssetRig`, `AssetVariants`…, named after the old `Asset`/`Animation` DTOs). An `AssetEntry` /
`AnimationEntry` is the plain object plus non-enumerable lookups (`glbPath()`, `scale()`, `roles()`, `grip()` for the
old `grips` table…): spread it or
`JSON.stringify` it and you get the plain object.

How rows become values follows the old server: `apps/server/src/main.ts` (assetDto, animDto), `assetSearch.ts`,
`assetVariants.ts`, `scale.ts` + `assetSize.ts` (a saved override, else the pack's unit verdict and the name
rules), `roles.ts` (part overrides over the rules), `rigs.ts`, `bake.ts`, `labels.ts`, `search.ts`.

## `synty`: the knowledge that is pure data

`import { synty } from '@slop/library'` (or `@slop/library/synty`). Each file names the old source it was ported
from, with its tests.

- **naming.ts** `refineKind`, `isWeaponName`, `isAttachmentName`, `isFxName`, `isHeldAttachment`, `isBundledAttachment`: Synty name → kind.
- **categories.ts** `autoCategory`: building / vegetation / rock / wall_fence / barrier / crate_container / furniture / wreck / vehicle / military / ground / decal / misc, and the damaged flag.
- **attachments.ts** `boneForAttachment`, `slotFor`, `defaultHand`: which canonical bone and slot an attachment takes.
- **scale.ts** `autoScaleFix`, `packScaleVerdict`, `scaleFixFor`, `plausibleSizeOf`, `unitCheckedFix`, `sizeSuspectFor`: the double-scaled-pack fixes.
- **scale-overrides.json** / `KNOWN_SCALE_OVERRIDES`: the per-model overrides exported from the DB (the POLYGON_War
  luger's 10: the auto fix makes it a 2.3 m gun and an aligned export then fails with `frame_overflow`). `scale()`
  falls back to it when the DB row is gone; `npm run scale-overrides -w @slop/library` re-exports the table.
- **roles.ts** + **roles.json** `roleFor`, `localName`, `partMetres`: part roles of multi-part models (the same rules file the Blender worker uses).
- **rigs.ts** + **rigs/*.json** `detect`, `propose`, `CANONICAL`: rig profiles (synty_legacy, synty_ue, mixamo) and the canonical humanoid.
- **packs.ts** `parsePackName`, `animationInfo`, `isModelFbx`, `animationFiles`, `combatCategory`: how Synty ships packs and clips.
- **states.ts** `findStateVariants`, `parseStateName`: damaged / destroyed versions by name.

## What it never does

- **Writes.** No table is written, no file under `data/` is created, moved or removed. The connection is read-only;
  the test suite checks the DB's mtimes before and after.
- **Blender.** No ingest, no retarget, no bake: `bakePath()` only reports a bake the old server already made.
- **Servers.** Nothing talks to the old generator's web (5180) or API (5181); it reads the files directly.

## Tests

`npm test` runs the pure unit tests on `synty` (fixtures only) and, when
`/home/andrew/projects/synty-sprite-generator/data` (or `SLOP_OLD_DATA_DIR`) exists, the suite against the real
library: asset 378, the skeleton knight by pack-qualified name, the luger's override, the Walk_F clips, bakes. Without
the data dir that suite is skipped with a message. No Synty binary is ever committed; the JSON data here is names,
regexes and numbers.

## Open questions for P2

- **Ingest of new packs.** The Blender worker (`worker/ingest.py`, `worker/synty/*.py`, `worker/roles.json`,
  `worker/rigs/*.json`) stays in the old repo; this package only reads what it produced. P2 decides where the worker
  lives in the Sloponator, how a new pack is ingested into a store this package can read, and whether the ingest
  `meta` JSON format is kept (this package types the keys it reads and keeps the rest).
- **Bakes on demand.** `bakePath()` returns null for a pairing the old server never baked. P2 needs a `render`/`sprites`
  side that asks for a retarget (through the worker) and a cache keyed like the old `bakes/a<asset>/n<anim>.glb`.
- **Search.** Only the FTS5 table and a LIKE fallback are ported; the old search's synonym groups ("first aid" →
  Medkit, FB-075), the broader-word and kind-hint re-ranking (FB-087) and the size/modular/wheels filters are not.
  They belong with the catalogue (`kit find`), which should answer in game words anyway.
- **Labels.** The `asset_labels` table (a person's or the AI's kind/slot/category/tags) is read, but it is empty in
  the current DB; the AI tagging and suggestion workflow is not ported.
- **Duplicate names.** POLYGON_BattleRoyale ships some characters twice (`FBX/Characters` and
  `FBX/Characters/Unreal_Characters`); 913 (pack, name) pairs in the DB are not unique. `asset()` takes the whole-file
  row with the lowest id, `assetsNamed()` lists them all. The catalogue should pick one per component.
- **Modular flag and sizes.** Read from the columns the old server cached (`size_x..z`, `modular`); 27 rows were never
  measured and come back with `size` from the meta bounds and `modular: null`. The modular rules (`assetSize.ts
  modularReason`) are not ported.
