# Review of the Synty Sprite Generator, and a proposal: a new game-dev stack ("the Sloponator")

## Context

You asked for two things:
- a deep review of what we built: the generator, plus the games made with it;
- a proposal for a full game-dev stack whose structure, reusable parts, examples and guides are good enough that a weak free model (OpenRouter) can make a good game. When that model is stuck it asks for help, and Claude reviews the docs and fixes them.

Whether that means improving the generator, rewriting its core, or building something new depends on the research. The research below points to **a new solution built by extracting the parts that work** (a "strangler" rewrite, not a rewrite from scratch).

**Your decisions so far:**
- OpenRouter free model.
- 2D and 3D together.
- Help fixes go to you for approval.
- A new, separate repo.
- One simple UI, later.
- The old generator is frozen to bug fixes while the Sloponator is built.

**Added after the first review:**
- **Synty Studio assets only.** That is a closed, known set: 38 packs, 17.6k assets and 3.3k clips today. So the Sloponator can ship a catalogue of **prebuilt, ready-to-use components**, and build anything missing on demand, as the generator does now.
- **Scene scripts and video.** You describe a scene in a script, and the Sloponator plays it out with the characters and renders a video.

## 1. Review findings

### What exists

**The generator.**
- 108k lines, built in 529 commits over 8 days by parallel agent lanes.
- 121 CLI commands, 464 CLI options and 74 MCP tools.
- 28 database tables, 7 of them never used.
- About 30 GB of data.
- Six ways to make a sprite: Wizard, Studio, Batch, the prompt bar, Create and Chat.

**Games made with it:**
- **2D Phaser:** Solitary Strike, Sidefighter, Monty and Night Shift.
- **2D Canvas:** Grim Hollow.
- **3D three.js:** Off Road and Car Smash.

They raised **189 feedback entries**. About 92% of them are fixed, usually within one or two waves.

### What is solid (keep it)

- **The Blender worker** (`worker/*.py`, 1.3k lines): ingest and retargeting.
- **The export core** in `packages/shared/src/export/*`: engine profiles with LiquidJS templates for 10 engines, layout, the `ssg-layers/1` manifest and validation, combat and footstep events.
- **The Synty knowledge:** scales, roles, attachment bones.
- **The declarative apply files** (`ssg.assets.json`, `ssg.models.json`, `ssg.textures.json`). Unknown keys are rejected, which makes them the best interface for weak models.
- **The frame-cache storage.**
- **The 3D model export logic** (`apps/server/src/modelBuild.ts`, `packages/shared/src/model3d/*`).
- **The game-side code that games keep re-writing.** It is battle-tested and should become the runtime libraries.

### Structural problems (ranked by cost)

1. **Rendering only works inside the web app, run in a headless browser.** That browser is driven by the server, which loads either Vite on 5180 or `dist`, guesses the GPU, and needs manual rebuilds and restarts. Most of the pain comes from here.
2. **Nothing checks that the planner, the server and the renderer run the same code.** The plan is computed in the client, so stale `dist` builds, stale MCP processes and tsx restarts all slip through.
3. **The frame-cache key depends on a hand-bumped `RENDERER_VERSION`.** It was bumped 3 times against 131 renderer commits, so the cache can silently serve old frames.
4. **About 36 pieces of "tribal knowledge" keep it running.** Ports, dist vs Vite, inotify ENOSPC, EGL blank frames, `pkill` killing 5180, a shared checkout, DB scale overrides… Games wrap every build in a stall watchdog.
5. **Scope sprawl.** About 60% of the code is not sprite generation: maps and route checking, tilesets, 3D tracks, terrain and sky, AI chat, a demo game. About 45% of feedback asks for game-content and level tools, not sprites. Level authoring alone accounts for 46 entries, the largest group.
6. **Every option is defined in five places:** CLI commander flags, MCP zod schemas, the apply parser, web forms, and 122 unvalidated REST routes. They have already drifted apart.
7. **Too many concepts for a weak model.** Research shows tool accuracy drops well before 74 tools.
8. **No render-correctness tests and no tests of the queue or runner.** The games act as the QA.
9. **The data model is upside down.** A sprite's render is owned by a batch queue row, so deleting the batch deletes the render.
10. **Feedback records drift.** About 44 entries disagree between a game's FEEDBACK.md and TODO.md, and Monty's 8 entries were never triaged.

**Duplicated game code** (the evidence for runtime libraries):
- **2D:**
  - the ssg loader, 3–5 copies
  - `build-assets` 4, `load-check` 4, `deploy-pages` 6
  - WebAudio 5, touch 3, iso and direction maths 4
- **3D:** about 1,000 lines identical between Off Road and Car Smash: model loader, loop, FM synth and sequencer, retro look, renderer, quality, input.

### Options considered

| Option | Verdict |
|---|---|
| **A. Improve the generator in place** | Fixes the symptoms. The browser-render coupling, the five option definitions and the sprawl are load-bearing, and refactoring them under five live games is the riskiest path. |
| **B. Rewrite only the render core** | Fixes problems 1–3 but not 5–9. The game-stack and weak-model work still has nowhere clean to live. |
| **C. New solution by extraction ("the Sloponator")** ✅ | A clean repo with one schema, a build-tool render path, and separate modules for library, sprites, levels, 3D, runtimes and the agent layer. Proven code is moved in with its tests. The old generator keeps serving the games until they migrate. |

## 2. Technology assessment

| Decision | Options | Choice and why |
|---|---|---|
| **Sprite renderer** | (a) keep three.js, as a prebuilt, hashed render bundle in Chromium launched by the build tool itself (no server, no Vite); (b) Blender EEVEE/Workbench headless; (c) Godot (its `--headless` mode has no renderer); (d) Unity batchmode | **(a)**: the render quality passed Phase 0 and the games are three.js anyway. The cache key includes the bundle hash, so it updates automatically. Blank-frame detection plus retry. (b) is the fallback if the browser stays fragile; it removes Chromium, but layers, iso and pixel post-processing would have to be rewritten in bpy. |
| **Retargeting** | Blender (current), three.js SkeletonUtils (unreliable on Mixamo rigs), Godot, Unity | **Keep the Blender bake.** Clips ship already retargeted, so no runtime or model ever retargets. |
| **Spec and options** | hand-kept per surface (today); one zod schema | **One zod schema.** CLI flags, MCP tools, JSON Schema for the declaration files, REST validation and reference docs are all generated from it. |
| **Game frameworks** | Phaser 3 vs 4 (4.1 is stable, but most training data is Phaser 3), three.js, Babylon, Godot (even frontier agents only manage about 40% on GameCraft-Bench), Kaplay/Excalibur (little training data) | **Phaser 3.80 (pinned) for 2D and three.js 0.186 for 3D.** That is what our games use, and it has the most training data. Lint rules block API drift. |
| **Game authoring style for weak models** | free-form code; a pure JSON game DSL; data plus marked code hooks | **Data first, code in marked hooks.** Entities, tuning and levels go in schema-checked files with fix-it errors, and behaviour goes in small `// EDIT:` hooks on a fixed runtime API. A pure DSL limits games too much. |
| **Agent harness for the weak model** | mini-swe-agent (bash only, easiest for weak models), Aider (whole-file edits, architect/editor), OpenCode or Goose (larger tool surface) | **Spike decides between mini-swe-agent and OpenCode.** Fall back to Aider if the model's tool calling is weak. |
| **Model** | OpenRouter `:free` models with tools (the list rotates), or a cheap paid small model | **`qwen/qwen3.8-27b`** (paid, about $0.04/M input and $1.35/M output), chosen by the user after spike 2 found the free models unavailable for hours. It is a config value, never hard-coded. |

**Risks**

**Free-tier limits.** Free models allow 50 requests a day, or 1,000 a day after a one-time $10 credit purchase, at 20 a minute either way. One task can use 20–60 requests. **The evals need the $10 purchase.** The eval runner retries 429 errors and records them as infrastructure failures, not model failures.

**API key.** Put it in `~/.config/sloponator/.env` as `OPENROUTER_API_KEY=…`. Create the file yourself, for example by typing `! mkdir -p ~/.config/sloponator && nano ~/.config/sloponator/.env` in the prompt; don't paste it in chat. It is never committed.

**Docs research.** An auto-generated or bloated AGENTS.md *hurts* agents. Only short, human-reviewed, task-sized docs help. So every doc fix from the help loop must improve the eval score, not just pass your approval.

## 3. Architecture: two repos

**Decision (22 Oct, after the first draft):** the asset pipeline and the game kit are separate repos. The old
generator sprawled because game concerns (levels, gameplay data, a demo game) grew inside a sprite tool; the kit
must not be able to do that to the pipeline, and games (and the weak model) must never see pipeline code.

### `ali3b/sloponator`: the asset pipeline (`slop`)

```
packages/
  schema/    zod: the one source for every option → CLI, MCP, JSON Schema, docs            (done, P1)
  formats/   JSON Schemas + TS types for everything a game reads: the contract with slopkit
  library/   pack ingest + Blender worker + Synty knowledge; imports the existing data/glb + packs read-only
  render/    the three.js render bundle (built once, hashed) + a runner launched by the build tool; GPU/SwiftShader, blank-frame check
  sprites/   characters/objects → sheets: export core, profiles, layers, events, frame cache (key = inputs + bundle hash + backend)
  levels/    tilesets + Tiled maps + level tools (routes, zones, game markers)
  models3d/  GLB export + manifest, textures, track pieces / terrain / sky
  catalog/   the Synty component catalogue: curated ids, tags, sizes, slots, movesets, behaviour hints; prebuilt
             outputs + build-on-demand into one content-addressed store
  cli/       `slop`: build · find · info · catalog · doctor (+ a small MCP for the same)
docs/        REVIEW.md · PLAN.md · api/ (generated)
```

- **`slop build`** works like a compiler: it reads a game's declaration files (`ssg.assets.json`, `ssg.models.json`,
  `ssg.textures.json`, accepted unchanged), hashes each job, reuses cached frames, launches its own render process
  and writes a **content pack** (sheets, GLBs, tilesets, maps, manifests). No server, no Vite, no restarts.
- **A sprite owns its renders.** Jobs are temporary.
- The pipeline knows nothing about Phaser, three.js at runtime, templates, scenes or the weak model.

### `ali3b/slopkit`: the game kit (`kit`)

```
packages/
  core/      engine-free: fixed-step loop, actions (keys/pad/touch → named actions), audio (unlock, mixer, FM synth,
             sequencer, sfx), save + migrations, event bus, directions/projection, rng, debug hooks
  phaser/    content-pack loader (sheets, layers/outfits, sockets, events), SsgSprite (dir from angle, Arcade body from
             pivot), iso depth sort, Tiled map + zones, touch overlay, scene helpers, text styles
  three/     model loader (variants, wheels, sockets, seats, LODs, colliders), renderer/quality/retro, cameras, touch widgets
  components/ Character, Vehicle, Door, Pickup, Prop, Spawner for both runtimes; world.spawn(id)
  scenes/    scene scripts: schema, prose→script (LLM), director (timeline, paths, cameras), playScene(), frame-exact video capture + TTS/music
  cli/       `kit`: new · find · add · build · check · run · scene · help-me · deploy · record · doctor (+ a 6–8 tool MCP)
templates/   phaser-topdown · phaser-side · phaser-iso · three-vehicle · three-arena (each runs as-is)
examples/    one small finished game per template, made only through the kit
docs/        AGENTS.md (short, human-reviewed) · recipes/ (one task each, full code) · api/ (generated)
help/ evals/ .claude/skills/{review-help,run-evals}
```

- The kit depends on the pipeline **only** through `@slop/formats` (a versioned package) and the `slop` CLI, which
  `kit build` calls. `kit doctor` checks the two versions agree. A game can also run on a prebuilt catalogue pack
  with no pipeline installed.
- **`kit find` / `kit add`** are the weak model's way to get assets: they query the catalogue and edit the
  declaration files; `kit build` runs `slop build`.
- **Weak-model rules:** one way to do each thing; errors name the fix and the recipe; `kit check` gives PASS/FAIL
  with screenshots; templates already run and the model edits marked `// EDIT:` regions.

### Component catalogue (Synty-only)

Because the asset set is closed, everything in it can be known, labelled and built ahead of time.

- **A component** is one Synty asset plus everything a game needs to use it as-is:
  - a readable id (`soldier_us_rifle`, `jeep_military`, `door_wood_01`) with tags, category, real size and slots;
  - compatible movesets, sockets, seats and a collider;
  - a behaviour hint, for example: character moves on a moveset, a vehicle is drivable, a door opens, a pickup can be collected, scenery is static;
  - preview images;
  - the built outputs, listed below.
- **Built outputs.** Every component gets a GLB with its manifest. Characters also get standard movesets. 2D sprites come in the standard presets: top-down 8, iso 8 and side 2, each in a clean and a pixel look.
- **Prebuild in two tiers:**
  - **Tier 1** is about 300 curated common components, built in advance. Games and the weak model get instant results, and `kit find` shows real previews.
  - **Tier 2** is everything else, built on first request with the current pipeline and cached under the same content key. Every build grows the shared catalogue.
- **Runtime components.** For each behaviour hint, `runtime-phaser` and `runtime-three` provide a component: `Character`, `Vehicle`, `Door`, `Pickup`, `Prop`, `Spawner`. A template does `world.spawn('soldier_us_rifle', {x, y})` and gets a working, animated, colliding thing. Weak models compose these instead of writing loaders.
- **Labelling.** Tags and descriptions are generated once with Claude and saved as data in the repo, so you can review them. The existing `labels`/`roles.json` rules seed them.
- **Known gaps are explicit.** For example, there is no spider, snake or bat. `kit find` answers "not in your packs; closest: …; pack that has it: …". Gaps are listed in `catalog/GAPS.md`, and you decide what to buy.

### Scene scripts and video

You write a scene, and the Sloponator plays it out with the characters and renders it to video. The same script can also play in a game as a cutscene.

- **Script format.** A screenplay-like YAML, checked against the schema. It names:
  - the setting: a Synty environment or a generated level;
  - the cast: catalogue ids, outfits and props;
  - beats: `walk_to`, `run_to`, `drive_to`, `say`, `play` (a clip or emote), `look_at`, `pick_up`/`hand_to`, `sit`/`enter_vehicle`, `wait`, `together`;
  - shots: wide, close, over the shoulder, follow, orbit, cut or blend;
  - music, and sound effects bound to events.
- **Prose to script.** `kit scene write "two soldiers meet at a jeep, one hands over a map, they drive off"` turns the description into a script using only catalogue ids and known clips. It validates the script and fills in defaults. You can edit the YAML afterwards.
- **The director** turns the script into a timeline:
  - routes are computed on the level's walk grid, reusing the generator's route code;
  - clips are blended and placed by the existing Blender-baked retargets;
  - props are attached through sockets, and characters enter vehicles through their seats.
- **Render.** the Sloponator uses frame-exact capture: deterministic stepping in the render bundle, as Car Smash's `record.mjs` already does. That renders to PNG frames and then to an MP4 with ffmpeg. Looks: clean, the retro/pixel filter, or 2D sprite-style top-down/iso, which uses the sprites themselves.
- **Audio.** Dialogue is spoken by local Piper TTS with one voice per character, plus subtitles. The FM music and sound effects come from runtime-core, and everything is mixed offline in sync. This reuses the documentary pipeline. Synty faces have no lip rig, so dialogue uses head and gesture emotes, not lip sync.
- **Outputs:** an MP4, a contact sheet of shots, and the timeline JSON. A game can play the same script through the runtime's `playScene()`.

### Help loop
1. **The model asks for help.** `kit help-me "…"`, or the MCP tool `ask_for_help`, records:
   - the question;
   - the template;
   - the `check` output;
   - the diff;
   - the model;
   - the recipes it read.

   The request goes into `HELP.md` and `sloponator/help/inbox/`.
2. **`/review-help` (Claude) handles each request:**
   - answers it in the game's `HELP.md`;
   - classifies the gap: doc, example, error message, runtime, pipeline, or the model's own mistake;
   - drafts the fix on a `help/HELP-NNN` branch, together with an eval case that reproduces the problem.
3. **You approve, but only fixes that don't lower the eval score are offered.** Failed eval runs are mined the same way.

## Public on GitHub, so you can track progress

- **Repositories.** Both are public on GitHub from their first commit: `ali3b/sloponator` (pipeline) and `ali3b/slopkit` (game kit).
- **Progress tracking:**
  - one GitHub **milestone** per phase (P0–P9) and one **issue** per work item, taken from this plan;
  - a **Project board** with the columns Todo, In progress, Review (waiting for you) and Done;
  - a **progress table** in the README, updated at each phase end.
- **Commits and pushes.** Work happens on branches, with a PR per phase that is merged and pushed at its end. Each phase gets a release note with screenshots or videos (as a GitHub Release).
- **Help loop.** Help requests and doc-fix branches also become issues labelled `help-request` and PRs. The eval scoreboard is published as a Pages page.
- **Synty licence.** Code, schemas, labels and docs are public. **Synty assets and anything rendered from them are never committed:** packs, GLBs, sprites and catalogue outputs stay in local, git-ignored stores. Public media is limited to demo screenshots and videos, as the games already publish. A CI guard blocks binary asset paths.

## 4. Phases (each one committed and demoable; review between phases)

- **P0 Review and spikes (gate).**
  - Write up this review as `docs/REVIEW.md`, published as a page you can share.
  - **Spike 1:** the render bundle, run by a CLI with no server, renders a soldier walk in 8 directions identical to today's output. Measure the time.
  - **Spike 2:** after you add the key, run 2 free models in mini-swe-agent and OpenCode on one small task, to get a baseline.
  - **Gate:** keep the three.js renderer or switch to the Blender fallback; choose the harness and model.
- **P1 Foundations.** Create the repo (npm workspaces, TS 5.6, vitest, Playwright), the `schema` package with its generators, and the `library` package, which imports the existing data read-only. The old generator is frozen; new requests are logged against the Sloponator.
- **P2 Sprites through `slop build`.**
  - Move the export core and renderer into the Sloponator.
  - Run render golden tests: pixel comparison against reference sheets, which do not exist today.
  - Bring over objects and props.
  - Accept `ssg.assets.json` as input, so games can switch with no rewrite.
- **P3 3D models and textures.** Bring over `modelBuild` and `model3d`. `ssg.models.json` and `ssg.textures.json` are accepted unchanged.
- **P4 Levels.** Bring over tilesets and maps, and move routes, zones and markers into the levels module.
- **P4b Component catalogue.**
  - Write the curated ids and labels.
  - Prebuild Tier 1, about 300 components: GLBs plus the standard sprite presets, run in the background on the one GPU worker.
  - Build Tier 2 on demand.
  - Add `slop catalog find` with previews, and `GAPS.md` (the kit's `kit find` wraps it).
- **P5 Runtimes (slopkit).**
  - Build runtime-core, runtime-phaser and runtime-three, extracted from the games and tested against real exports.
  - Add the runtime components (`Character`, `Vehicle`, `Door`, `Pickup`, `Prop`, `Spawner`) and `world.spawn(id)`.
- **P5b Scene scripts and video (slopkit).**
  - The script schema, and `kit scene write` (prose to script).
  - The director: routes, clips, sockets, seats, shots.
  - Frame-exact video render with TTS, subtitles and music.
  - `playScene()` in the runtimes.
  - Three demo scenes, all checked into examples: a meeting at a jeep, a tavern conversation, and a chase.
- **P6 Agent layer (slopkit).** The `kit` CLI and MCP, templates, examples, the docs, and the error-message pass.
- **P7 Help loop and evals (slopkit).**
  - Write 8 briefs, for example: top-down survival, coin platformer, iso defence, 1v1 fighter, kart race, 3D marble, arena brawler, modding an example.
  - For each brief: a new game, then the free model, then `kit check`, then a Claude judge scoring screenshots and video, then a scoreboard.
  - **Target:** at least 5 of the 8 briefs reach PASS and are judged "good".
- **P8 Migration proof (both).** Move Monty (2D) and Off Road (3D) onto the Sloponator. Their existing load-checks must pass.
- **P9 One simple UI (sloponator).** A single viewer/editor (library, sprite with inspect and placement, levels) on the Sloponator daemon. Retire the old web app once it matches the features you still use.

## Verification

- **P0 spikes:** Spike 1 passes when the standalone render matches pixel for pixel, with its timing recorded. Spike 2 passes when the baseline transcripts and scores are saved.
- **Every package:** vitest. The render goldens run in `npm test`.
- **`slop build`** on the existing `ssg.assets.json` / `ssg.models.json` files from Solitary Strike, Sidefighter, Monty and Off Road produces manifests that validate against `formats` and that the games load (their load-checks pass).
- **Tribal-knowledge items:** the 36 items in REVIEW.md each get a status, either "gone in the Sloponator" or "documented in `slop doctor`".
- **Catalogue:**
  - every Tier 1 component has a GLB, sprites and a preview, all of which validate;
  - `slop find "soldier with rifle"` returns previews in under 1 s;
  - asking for a Tier 2 item builds it and caches it;
  - asking for a known gap gives the "closest / pack that has it" answer.
- **Scenes:**
  - `kit scene write` followed by `kit scene render` turns a one-line description into an MP4 with the right cast, voices, subtitles and shots;
  - rendering the same script twice gives the same frames;
  - the same script plays as a cutscene in a template game, and its load-check passes.
- **Help loop:** in a scratch game, `kit help-me` produces an inbox entry. `/review-help` answers it and drafts a branch with an eval case.
- **End to end:** the eval scoreboard (model, briefs, pass rate, judge scores, requests used), and a game the free model built, played in the browser.
