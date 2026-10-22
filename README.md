# The Sloponator

A game-development stack built on licensed **Synty Studios** assets, designed so that even a small, free language
model can make a good game with it.

- **Asset pipeline:** Synty packs → sprite sheets (any view, clean or pixel art), GLB models, tilesets and levels,
  built like a compiler from one declaration file.
- **Component catalogue:** every Synty asset as a ready-to-use component (`world.spawn('soldier_us_rifle')`), the
  common ones prebuilt, the rest built on first use.

This repo is the **asset pipeline** only (`slop`). The game side — Phaser 3 and three.js runtimes, ready
components, templates, scene scripts that play out as video, and the help loop for weak models — is the separate
**game kit**, [ali3b/slopkit](https://github.com/ali3b/slopkit). The kit talks to the pipeline only through the
manifest formats and `slop build`, so games never contain pipeline code.

The Sloponator is the successor of the Synty Sprite Generator. Why it exists: **[docs/REVIEW.md](docs/REVIEW.md)**.
The plan: **[docs/PLAN.md](docs/PLAN.md)**. Progress is tracked in
[milestones](../../milestones) and on the [project board](../../projects).

## Progress

| Phase | What | Status |
|---|---|---|
| P0 | Review and spikes (renderer, weak-model baseline) | in progress |
| P1 | Foundations: repo tooling, one schema, library import | done (#64, #65) |
| P2 | Sprites through `slop build` | done for sprites: `@slop/sprites`, `@slop/formats`, `@slop/render`, `@slop/cli`, `@slop/bake` (Blender bakes on demand, #69); all 16 Monty sprites build pixel-identical to the old generator (#8, #9, #10, #11, #13). Open: layered sheets, splits, portraits |
| P3 | 3D models and textures | done: `@slop/models3d` (#14/#15/#16), GLBs byte-identical to Off Road / Car Smash's; `slop build` wiring → cli |
| P4 | Levels: tilesets, maps, routes | — |
| P4b | Component catalogue | — |
| P5–P7 | Runtimes, scenes, agent layer, help loop, evals | in [slopkit](https://github.com/ali3b/slopkit) |
| P8 | Migration proof: Monty and Off Road (both repos) | — |
| P9 | One simple UI | — |

## Development

Node 18.19+, npm workspaces under `packages/*` (TypeScript 5.6, strict ESM / NodeNext, vitest, Playwright).

```
npm install
npm run typecheck   # tsc -b over every package
npm test            # vitest, every package
npm run lint        # eslint (typescript-eslint, minimal rules)
npm run docs        # regenerate docs/api/ (declarations.md + JSON Schemas) from packages/schema
```

CI (`.github/workflows/ci.yml`) runs the four on every push and PR and fails when `docs/api/` is stale;
`asset-guard.yml` blocks Synty assets and renders. Packages so far:

- **`@slop/schema`** (`packages/schema`): zod is the one source of truth for every option. `opt()` gives a field its
  help, `doc()` names an object; from that one definition come the JSON Schema, the CLI flags, the MCP tool inputs,
  the markdown reference ([docs/api/declarations.md](docs/api/declarations.md)) and errors that teach: the key, the
  nearest valid key, what it is for and where it is documented. The declaration files `ssg.assets.json`,
  `ssg.models.json` and `ssg.textures.json` are ported from the old generator, and the real games' files validate
  unchanged (`packages/schema/test/fixtures`).
- **`@slop/formats`** (`packages/formats`): what a game reads. zod schemas, TS types and JSON Schemas of
  `ssg-meta/1`, `ssg-layers/1`, `ssg-split/1`, `ssg-turret/1`, the generic sheet JSON, the Phaser 3 anims JSON, the
  object block, the 3D `.model.json` manifest and the `models.json` index; the games' real manifests validate
  unchanged (`packages/formats/test/fixtures`). The contract with slopkit.
- **`@slop/sprites`** (`packages/sprites`): the export core moved from the old generator: engine profiles, sheet
  layout and pure RGBA composition, manifests, clip events, validation, the frame-cache key (now keyed by render
  backend and bundle hash). It describes and packs frames; the render bundle draws them. See
  [packages/sprites/README.md](packages/sprites/README.md).
- **`@slop/render`** (`packages/render`): the three.js render bundle (the old generator's browser render code,
  built once by Vite into the cache dir and named by its content hash) and the Node runner that launches Chromium
  itself, serves the bundle and answers its data requests from `@slop/library` in-process — no server — with the
  frame cache around every render and a blank-frame check on the GPU. See
  [packages/render/README.md](packages/render/README.md).
- **`@slop/cli`** (`packages/cli`): `slop build ssg.assets.json --out <dir>`: validates the file, plans every
  sprite as the old `ssg sprite apply` did, renders through `@slop/render`, packs through `@slop/sprites` and
  writes the same files the old generator downloaded. Goldens: Monty's sprites, pixel for pixel against the old
  generator on both backends, and byte-identical rebuilds. See [packages/cli/README.md](packages/cli/README.md).
- **`@slop/bake`** (`packages/bake`): Blender bakes on demand. The old retarget worker (Python, with its tests), a bake
  store owned by the Sloponator (`~/.cache/slop/bakes`, keyed by input hashes and the Blender and worker versions),
  imports of the old generator's bakes, per-key locks and one Blender at a time. `slop build` bakes what it needs
  before the browser starts. See [packages/bake/README.md](packages/bake/README.md).
- **`@slop/models3d`** (`packages/models3d`): the 3D model export moved from the old generator: GLB + manifest per
  asset (scale, wheels, clips from existing bakes, variants, LODs, poses, seats, dashboards, colliders, meshopt),
  track pieces, terrain, skydomes, composites, the texture export, a content-addressed cache and the
  `ssg.models.json` / `ssg.textures.json` builds (`buildModels`, `buildTextures`); the games' files rebuild byte for
  byte. See [packages/models3d/README.md](packages/models3d/README.md).

## Licence

Code and docs: MIT. **Synty assets are not included** and are never committed: you need your own Synty licence and
packs. Rendered sprites and models stay in local, git-ignored stores.
