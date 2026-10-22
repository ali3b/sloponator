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
| P1 | Foundations: repo tooling, one schema | done (#64); library import → P2 |
| P2 | Sprites through `slop build` | in progress: export core moved (#8: `@slop/sprites`, `@slop/formats`) |
| P3 | 3D models and textures | — |
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
  `ssg-meta/1`, `ssg-layers/1`, `ssg-split/1`, `ssg-turret/1`, the generic sheet JSON, the Phaser 3 anims JSON and
  the object block; the games' real manifests validate unchanged (`packages/formats/test/fixtures`). The contract
  with slopkit.
- **`@slop/sprites`** (`packages/sprites`): the export core moved from the old generator: engine profiles, sheet
  layout and pure RGBA composition, manifests, clip events, validation, the frame-cache key (now keyed by render
  backend and bundle hash). It describes and packs frames; the render bundle draws them. See
  [packages/sprites/README.md](packages/sprites/README.md).

## Licence

Code and docs: MIT. **Synty assets are not included** and are never committed: you need your own Synty licence and
packs. Rendered sprites and models stay in local, git-ignored stores.
