# Spike 2: how weak are the free models, really?

Baseline for the agent layer (P6–P7): free OpenRouter models, in two harnesses, on two small tasks against a real
game (a scratch copy of Monty, a 1.9k-line Phaser 3 game) using today's generator CLI. This measures what the
Sloponator has to compensate for; the same tasks are re-run against the Sloponator's templates later.

| | |
|---|---|
| Tasks | `tasks/T1-pause.md` (pure game code: a pause key), `tasks/T2-sprite.md` (declare + build + show a new generator sprite) |
| Harnesses | mini-swe-agent 2.4 (bash only, no tool calling), OpenCode 1.19 (native tool calling) |
| Models | the free `:free` models with tool support, chosen from `GET /api/v1/models?supported_parameters=tools` on the day |
| Budget | 40 model calls or 20 minutes per run, whichever first |
| Scoring | `grade.mjs`: typecheck, the game's own load-check, and a feature probe over CDP; pass = all three |

`prepare.mjs <dest> <label> <port>` makes the scratch copy (generator project renamed to `Spike2 <label>` so renders
are throwaway), `grade.mjs <dir> <T1|T2> <port>` scores it. Results: `results/<harness>/<model>/<task>/` with
`transcript.*`, `diff.patch`, `grade.json`, `run.json` (calls, wall time, 429s). Summary: `../../docs/spikes/SPIKE-2-weak-model.md`.
