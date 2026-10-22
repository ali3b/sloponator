# The Sloponator

A game-development stack built on licensed **Synty Studios** assets, designed so that even a small, free language
model can make a good game with it.

- **Asset pipeline:** Synty packs → sprite sheets (any view, clean or pixel art), GLB models, tilesets and levels,
  built like a compiler from one declaration file.
- **Component catalogue:** every Synty asset as a ready-to-use component (`world.spawn('soldier_us_rifle')`), the
  common ones prebuilt, the rest built on first use.
- **Runtimes:** Phaser 3 (2D) and three.js (3D) libraries for loading, input, audio, saves and cameras.
- **Scene scripts:** describe a scene, get a video of the characters playing it out, or a cutscene in a game.
- **For weak models:** templates that already run, one-task recipes, errors that say how to fix them, `slop check`,
  and `slop help-me`, which sends a request to a stronger model that answers it and fixes the docs.

The Sloponator is the successor of the Synty Sprite Generator. Why it exists: **[docs/REVIEW.md](docs/REVIEW.md)**.
The plan: **[docs/PLAN.md](docs/PLAN.md)**. Progress is tracked in
[milestones](../../milestones) and on the [project board](../../projects).

## Progress

| Phase | What | Status |
|---|---|---|
| P0 | Review and spikes (renderer, weak-model baseline) | in progress |
| P1 | Foundations: repo, one schema, library import | — |
| P2 | Sprites through `slop build` | — |
| P3 | 3D models and textures | — |
| P4 | Levels: tilesets, maps, routes | — |
| P4b | Component catalogue | — |
| P5 | Runtimes: core, Phaser, three.js | — |
| P5b | Scene scripts and video | — |
| P6 | Agent layer: CLI, MCP, templates, examples, docs | — |
| P7 | Help loop and evals | — |
| P8 | Migration proof: Monty and Off Road | — |
| P9 | One simple UI | — |

## Licence

Code and docs: MIT. **Synty assets are not included** and are never committed: you need your own Synty licence and
packs. Rendered sprites and models stay in local, git-ignored stores.
