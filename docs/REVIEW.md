# Review: the Synty Sprite Generator and the games built with it

*Written 22 October 2026, as phase P0 of the Sloponator. It is the evidence behind the decision in [PLAN.md](PLAN.md).*

## Summary

The Synty Sprite Generator (`ssg`) turns licensed Synty POLYGON packs into 2D sprite sheets, tilesets, Tiled maps and
optimised GLB models. It has a web app, a CLI and an MCP server. Seven browser games were built with it by AI agents
in about a week, and they raised 189 requests (feedback entries), 92% of which were fixed, usually the same or next day.

- **The parts are good.** The Blender retarget worker, the export core, the layer manifest, the declarative apply files
  and the Synty knowledge (scales, roles, bones) all work and are worth keeping.
- **The plumbing between the parts is the problem.** Rendering only works inside a browser page run by the server;
  every option is defined five times; the cache key depends on a hand-bumped version number; about 36 pieces of
  tribal knowledge keep it running; and the scope has grown into level editing, 3D track geometry and a demo game
  inside one server and one database.
- **The games repeat the same code.** Every game re-writes the asset loader, the asset build script, the headless
  check, the deploy script, the sound engine and the touch controls.

**Decision:** build a new solution, **The Sloponator**, by moving the good parts into a clean structure (option C below), and
add what a weak model needs to make games: runtime libraries, ready components, templates, short recipes, a help
loop and evals. The old generator is frozen to bug fixes and keeps serving the games until they move over.

## 1. What exists

### The generator

| | |
|---|---|
| Code | ~108k lines of TypeScript and Python (82k without tests), 529 commits from 15 to 22 Oct 2026 |
| Parts | `apps/web` (React + three.js; renders the sprites), `apps/server` (Fastify + SQLite), `apps/cli` (`ssg` + MCP), `packages/shared` (33k lines of pure logic), `packages/client`, `worker/` (Blender Python), `apps/game` (a demo game) |
| Surface | 121 CLI commands, 464 CLI options, 74 MCP tools, 122 REST routes |
| Docs | README 1,501 lines, docs/ 2,180 lines, TODO 520 lines |
| Data | 28 tables (7 never used); ~30 GB on disk: 20 GB of ingested GLBs, 7.4 GB of extracted packs, 2.2 GB of outputs |
| Library | 38 packs, 17,628 assets, 3,363 animation clips |
| Tests | 162 test files (~1,400 cases), mostly pure logic; 22 browser "walk" scripts run by hand |

Largest files: the MCP tool file (2,331 lines), the CLI entry (2,045), the 3D model build (1,904), the demo game's
main scene (1,568), map operations (1,393), the sprite renderer (1,345), track pieces (1,340), the apply parser
(1,207).

### The games

| Game | Kind | Engine | Size |
|---|---|---|---|
| Solitary Strike | isometric commando shooter, 12 missions | Phaser 3 | 8.4k lines |
| Sidefighter | side-view fighting game, 6 fighters + boss | Phaser 3 | 5.5k lines |
| Monty | room-by-room platformer | Phaser 3 | 1.9k lines |
| Night Shift | isometric city demo (inside the generator repo) | Phaser 3 | 5.2k lines |
| Grim Hollow | top-down dungeon survivor | Canvas 2D | 4.0k lines |
| Off Road | 3D off-road truck racer, 8 tracks, season + shop | three.js + Rapier | 11.5k lines |
| Car Smash Stunt Tracks | 3D stunt racer with a track editor | three.js | 21.0k lines |

Every game may only use the generator through its CLI or MCP. Gaps are written down in the game's `FEEDBACK.md`,
fixed in the generator, and verified from the game side.

## 2. What the games asked for

189 entries, classified by hand (one theme each, ±3):

| Theme | Entries | Examples |
|---|---|---|
| Level authoring (maps, tilesets, routes) | 46 | scatter under-delivers, route queries, clearance from footprints |
| Export / engine-integration bugs | 31 | Phaser pivot off by ~30 px, animation keys collide, a character skin renders white |
| Missing content (clips, creatures, effects) | 28 | hands-up pose, fireball, no spider/snake/bat in the packs |
| CLI/MCP ergonomics and parity | 23 | MCP answers of ~20 kB, MCP schema missing keys the CLI accepts |
| Missing metadata | 17 | footprints, hurtboxes, only box colliders |
| Render quality | 11 | a tank flips, tint never reaches particles |
| Procedural 3D geometry | 11 | track pieces, terrain, skydome |
| Performance and time | 8 | one new clip re-renders the whole sheet |
| Docs and discoverability | 8 | search synonyms |
| Reliability and infrastructure | 6 | CLI rebuilds the web app, preview needs port 5180 |

Three observations:

- **The engine-integration bugs are the kind a runtime library hides.** Pivot vs trim, texture keys, physics-body
  offsets, tile ids and units were each solved in a game, by hand, and the next game had to learn them again.
- **About 45% of the requests are not about sprites** but about levels, gameplay data and 3D content. The tool has
  become a game-content pipeline without being structured as one.
- **Infrastructure trouble is under-counted.** The agent running the loop absorbed most of it, so it lives in session
  notes rather than in FEEDBACK. Every game wraps its asset build in a 3–4 minute stall watchdog.

The records drift: about 44 entries are "open" or "triaged" in a game but done in the generator's TODO, and one
game's 8 entries were never triaged at all.

## 3. Structural problems, ranked by cost

1. **Rendering only works inside the web app, in a headless browser driven by the server.** The browser loads either
   the Vite dev server or the built `dist`, depending on what happens to be running; it guesses the GPU (NVIDIA EGL
   returns a blank frame about 1 time in 10; SwiftShader runs at ~3 fps); and changes to the renderer need a manual
   web build and server restart. Process chain: CLI → server → Chromium running the web app → server → Blender.
2. **Nothing checks that the planner, the server and the renderer run the same code.** The render plan is computed in
   the client, stored by the server and executed by the web page. A stale `dist`, a long-running MCP process or a
   half-restarted server each run older code without saying so.
3. **The frame cache can serve stale frames.** Its key includes a hand-bumped `RENDERER_VERSION`, bumped 3 times
   against 131 commits to the renderer. A lighting or camera fix without a bump silently reuses old frames.
4. **About 36 pieces of tribal knowledge keep it running.** Fixed ports (5180/5181/5182 plus a port per game, two of
   which collide); dist vs Vite; the server caching the dist asset list; file watchers that miss edits or run out of
   inotify handles; `pkill vite` in a game killing the generator's renderer; one GPU worker; a database scale override
   that must survive rebuilds; a shared checkout used by several sessions; and more.
5. **Scope sprawl.** About 60% of the code is not sprite generation: maps and route checking, tilesets, 3D model,
   terrain and track export, AI chat, and a demo game, all in one server, one database and one CLI.
6. **Every option is defined five times:** CLI flags, MCP schemas, the apply-file parser, web forms and unvalidated
   REST bodies. They already disagree (for example the frame-rate limits differ between two MCP tools and the CLI).
7. **Too many concepts and tools.** A user meets projects, sprites, versions, batches, sets, presets, profiles,
   templates, movesets, loadouts, outfits, layers, looks, splits, states, facings, stamps, grips, placements and labels;
   there are six ways to make a sprite. Tool-use accuracy of models drops well before 74 tools.
8. **No render-correctness tests,** and no tests of the job queue or the runner. The games are the QA.
9. **The data model is upside down.** A sprite's current render is a file owned by a batch-queue row; deleting the
   batch deletes the render.
10. **Unauthenticated server on all interfaces,** hand-written migrations, a database backup per wave, and seven
    tables that were built but never used.

## 4. What is solid

- **Blender worker** (`worker/*.py`, ~1.3k lines): FBX → GLB ingest and animation retargeting onto both Synty rigs.
  Small, isolated, solves hard problems.
- **Export core** (`packages/shared/src/export/*`): 10 engine formats as JSON profiles with templates, sheet layout,
  the `ssg-layers/1` layered-equipment manifest and its validation, combat and footstep events.
- **Declarative apply files** (`ssg.assets.json`, `ssg.models.json`, `ssg.textures.json`): one file declares what a
  game needs; re-applying changes only what changed; unknown keys are errors. This is the best interface for a weak
  model.
- **Synty knowledge:** scale fixes, part roles, attachment bones, naming rules.
- **Frame-cache storage:** content-addressed, size-capped, atomic. Only its key versioning needs fixing.
- **3D model export:** GLB + manifest with variants, wheels, sockets, seats, LODs, colliders.
- **The game-side code** that keeps being re-written is battle-tested in seven games.

## 5. Duplicated game code

| Piece | Copies | Notes |
|---|---|---|
| Sprite-sheet loader (manifest, atlas, animations, events) | 3 Phaser + 2 generic-format | `setupAssets` is effectively identical |
| Asset build script (`ssg` wrapper with stall watchdog) | 4 | the wrapper is copied verbatim |
| Headless load check (Chromium, page errors, screenshot) | 4 Phaser + 2 three.js | first ~25 lines identical |
| GitHub Pages deploy | 6 | near-identical |
| WebAudio sound core | 5 | same unlock / master / noise pattern |
| Touch controls | 3 + 2 (3D) | same design, written each time |
| Direction from angle, iso projection, depth sort | 4 | same maths, different conventions |
| 3D model loader, fixed-step loop, FM synth, sequencer, retro look, renderer, quality, input | Off Road ↔ Car Smash | ~1,000 lines identical |
| Game rules (`CLAUDE.md`), FEEDBACK template, TODO format | 5 | near-verbatim |

## 6. Options considered

| Option | Verdict |
|---|---|
| **A. Improve the generator in place** | Fixes symptoms. The browser-render coupling, the five option definitions and the sprawl are load-bearing; refactoring them under five live games is the riskiest path. |
| **B. Rewrite only the render core** | Fixes problems 1–3, not 5–9, and the game stack still has no clean home. |
| **C. New solution by extraction (the Sloponator)** | Chosen. A clean repo with one schema, a compiler-style build with its own render process, separate modules, runtime libraries and an agent layer. Proven code moves in with its tests; the old generator keeps serving games until they migrate. |

## 7. Outside research (October 2026)

- **Renderer.** Keeping three.js as a pinned, hashed render bundle launched by the build tool removes most of the
  pain without rewriting the render logic. Blender EEVEE/Workbench headless is the fallback (it would remove Chromium
  but means rewriting layers, isometric and pixel post-processing in Python). Godot's `--headless` mode has no
  renderer; Unity batchmode needs a display and brings its own licence. Blender sprite add-ons only render camera
  rings, without layers or manifests.
- **Retargeting.** Keep the Blender bake; three.js `SkeletonUtils.retargetClip` is unreliable on Mixamo rigs.
- **Frameworks for model-written games.** Phaser 3 and three.js have the most training data. Phaser 4 is stable
  (4.1) but models mix its API with Phaser 3, so the Sloponator pins Phaser 3.80. Frontier agents build about 40% of Godot
  games end to end (GameCraft-Bench); weak models will do worse.
- **What helps weak models.** Short, human-reviewed, task-specific instructions (bulk or generated `AGENTS.md`
  files measurably hurt); few tools (accuracy improved when tools were cut from 48 to 25); declarative files with a
  validator whose errors say how to fix them; whole-file or bash-only edits; and an eval suite to judge every change.
- **Harnesses for free OpenRouter models.** mini-swe-agent (bash only, easiest for weak models), OpenCode and Goose
  (headless, larger tool surface), Aider (whole-file edits). Free models allow 50 requests a day, or 1,000 after a
  one-time $10 credit purchase, at 20 a minute; one agent task uses 20–60.

## 8. Tribal knowledge to retire

Each item gets a status in the Sloponator: *gone* (the design removes it) or *documented in `slop doctor`*.

| # | Item | the Sloponator |
|---|---|---|
| 1 | Fixed ports 5180/5181/5182, lane and game ports (two games share one) | gone: `slop build` needs no server |
| 2 | Runner loads Vite or dist depending on how the server started | gone: one pinned render bundle |
| 3 | Server caches the dist asset list; 404 until restart after a web build | gone |
| 4 | Stale shared module leaves batches queued forever | gone |
| 5 | Touching the Vite config kills the dev server (inotify) | gone |
| 6 | A game's `pkill vite` kills the renderer | gone |
| 7 | Runner browser idles out after 60 s | gone: launched per build |
| 8 | File watcher silently misses edits | gone |
| 9 | Fast-forward merge restarts the watcher mid-checkout | gone |
| 10 | inotify exhausted; server runs without a watcher | gone |
| 11 | Only one server resumes ingests | doctor |
| 12 | Lanes on another exporter version need their own models dir | gone: content-addressed store |
| 13 | Lane Vite instances need their own cache dir | gone |
| 14 | Never commit everything in the shared checkout | doctor (process) |
| 15 | Wave branch names collide between sessions | doctor (process) |
| 16 | Fast-forward merge piped to `tail` hides failures | doctor (process) |
| 17 | A worktree's `node_modules` symlink got committed | gone: template `.gitignore` |
| 18 | Lanes overwrite each other's pid files | gone |
| 19 | FEEDBACK merge conflicts drop status lines | gone: help requests are issues |
| 20 | One GPU worker only; heavy runs crash desktop apps | doctor |
| 21 | NVIDIA EGL returns a blank frame ~1 in 10 | gone: blank-frame check + retry |
| 22 | EGL picks a different GPU for demos and headless | doctor |
| 23 | SwiftShader ~3 fps; new headless greys the bottom 90 px; video clock 10% slow | gone: frame-exact capture |
| 24 | A pistol needs a scale override that must survive a DB rebuild | gone: overrides live in versioned data |
| 25 | Batch list shows only the newest 50 | gone |
| 26 | All runs share one database, so walks reuse each other's exports | gone: content keys |
| 27 | MCP writes are limited to allowed dirs, the CLI is not | gone: one schema, one rule |
| 28 | A long-running MCP process serves a stale schema | gone: version handshake |
| 29 | Restart a game's dev server after rebuilding assets | gone: runtime reloads the manifest |
| 30 | Load checks fail under load; re-run before believing them | doctor |
| 31 | Mixamo download recipe (tokens, rate limits, session expiry) | doctor |
| 32 | Duplicate pack installs are not detected | gone |
| 33 | Model export fails during a re-ingest | gone |
| 34 | Frame-cache keys drifted between runner pages | gone: canonical key |
| 35 | "The dev server is usually down; the API serves dist" | gone |
| 36 | Render plan computed on the client and run elsewhere | gone: plan and render in one process |

## 9. Synty licence

Synty packs, the GLBs and sprites made from them, and catalogue outputs are never committed to the public the Sloponator
repo. Only code, schemas, labels, docs, and demo screenshots and videos are public.
