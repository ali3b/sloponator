# Spike 2, harness: mini-swe-agent 2.4.6

Date: 2026-10-22, 11:15–13:05 local. Free OpenRouter models, 40 model calls or 20 minutes per run, tasks given
verbatim, the copy's AGENTS.md as the only other guidance. Grader: `grade.mjs` (typecheck, load check, feature probe).

## Results

| model | task | pass | typecheck | loadCheck | feature | calls | minutes | 429s | exit |
|---|---|---|---|---|---|---|---|---|---|
| nvidia/nemotron-3-super-120b-a12b:free | T1 | infra | – | – | – | 1 (failed) | 0.1 | 0 (404) | NotFoundError |
| nvidia/nemotron-3-super-120b-a12b:free | T2 | infra | – | – | – | 0 | – | 0 (404) | not run |
| google/gemma-4-31b-it:free | T1 | infra | – | – | – | 0 | 3 × ~2.3 | 21/21 | RateLimitError |
| google/gemma-4-31b-it:free | T2 | infra | – | – | – | 0 | – | 3/3 probes | not run |
| minimax/minimax-m3.1-flash:free | T1 | **PASS** | yes | yes | yes | 40 | 4.7 | 0 | LimitsExceeded |
| minimax/minimax-m3.1-flash:free | T2 | fail | yes | yes | no | 40 | 8.6 | 0 | LimitsExceeded |
| cohere/north-mini-code:free | T1 | fail | no | yes | no | 40 | 8.7 | 0 | LimitsExceeded |
| cohere/north-mini-code:free | T2 | fail | no | yes | no | 40 | 4.2 | 0 | LimitsExceeded |

cohere/north-mini-code:free was added as the fourth model because two of the three planned models were unusable all
afternoon. "infra" = the model never answered a single request (details per run below). 1 pass out of 4 completed
runs; 0 of 4 runs ever submitted (`COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`): all four burnt the full 40 calls.

## Per run

**nemotron T1 / T2 — infrastructure.** OpenRouter's only provider for this model (Nvidia) answers every request with
HTTP 404 `Function 'ac74040f-…': Not found for account …`: the model is still listed with `tools` support, but its
backend function has been deleted. Seen on the harness's first call and on 6 direct probes a minute apart at 11:16
and 13:02. LiteLLM maps it to `NotFoundError`, which mini-swe-agent treats as non-retryable, so the agent died
before its first observation. T2 was not attempted.

**gemma T1 / T2 — infrastructure.** Every request got HTTP 429 `google/gemma-4-31b-it:free is temporarily
rate-limited upstream` (`limit_source: upstream_provider_shared_pool`, provider Google AI Studio). Not this key's
quota: the free pool for the model was exhausted for everyone. Three whole-run attempts (11:19, 11:24, 11:43) with
the harness's own retries (5, 8 and 8 attempts, exponential 4–60 s backoff, ~2 min each) = 21 requests, 21 × 429.
Still 429 on 3 probes at 13:02–13:04. T2 was not attempted. Logs of the attempts: `gemma/T1-attempt{1,2,3}-429/`.

**minimax T1 — PASS, by accident of timing.** Read AGENTS.md first and the right files (hud.ts, Room.ts, joe.ts)
in 5 calls, then spent ~15 calls reading Phaser's own source under `node_modules` (keyboard plugin, Key.js,
AnimationManager, Clock) rather than trusting the API. The patch itself is good: a `paused` flag, `keydown-P`
handler, early return in `update()`, `time.paused`/`tweens.paused`, anims paused, a PAUSED text in HUD style. It
followed mini.yaml's SWE-bench workflow literally ("create a script to reproduce"): wrote a thorough Playwright
test (`scripts/_pause-check.mjs`), started vite itself, and the test reported "the clock kept running" (a false
alarm: `time.now` is wall time even when the clock is paused) and "the room did not resume" (not reproduced by the
grader), and it was reading Clock.js to debug that when the 40-call limit hit. It never ran the mandated
`load-check` and never submitted; typecheck was run once (pass). **It strayed outside the copy:** one patch
command started with `cd /home/andrew/projects/monty 2>/dev/null || cd "$(pwd)"` (a path it guessed from the
package name and $HOME) and patched the real game's `Room.ts`; it noticed two calls later and reverted with
`git checkout` (monty was clean before and after). Left its test file in the diff.

**minimax T2 — fail, empty diff.** The first two calls read exactly the right files (AGENTS.md, ssg.assets.json,
assets.ts, build-assets.mjs). From call 3 on it prefixed nearly every command with `cd /home/andrew/projects/monty`
(the real repo again) and did all its reading there: Room.ts, the manifest, the skeleton's meta.json, then 8 calls
of Phaser atlas/pivot/origin source. It used the generator CLI only for look-ups (`ssg assets Skeleton_`,
`sprite apply --help`, `projects list`, `sprites --project`), discovered that the copy's project
"Spike2 msa-minimax-T2" does not exist on the server yet, and went down that hole: diffing the copy against the
real repo, grepping the generator's `apps/cli` and `packages/client` source for how projects get created, and
opening the generator's SQLite library (read-only URI) to list projects. Never added `guard` to
ssg.assets.json, never ran `npm run assets`, never touched the room. Only read-only commands outside the copy. No
reasoning text after the first step (bare tool calls).

**cohere T1 — fail, edit loop.** Never read AGENTS.md (`ls -la`, then straight into `src/`), so it never learned
the port, never started the dev server and never ran load-check. Read Room.ts/hud.ts/joe.ts in 11 calls and had a
plausible design by call 12 (P key, `paused` flag, early return in `update()`, PAUSED text in HUD style), then spent
28 calls failing to get it into the file: a from-memory rewrite of the whole 600-line Room.ts via heredoc (typecheck
errors from its own reconstruction), multi-line `sed -i` with unescaped slashes, a CommonJS edit script in an ESM
package (`.js` → `.cjs`), four Python `str.replace`/`re.sub` scripts each followed by `git checkout` when typecheck
failed, and a final heredoc rewrite. Twice a Python edit typechecked clean, but it re-read the file, decided it
looked wrong and reverted anyway. Final state: a broken whole-file rewrite (2 type errors) plus 6 junk files
(edit scripts, `Room.ts.backup`, `temp_room.ts`). Stayed inside the copy.

**cohere T2 — fail, declared but not built.** First command: `find /workspace/game …` (a hallucinated sandbox path).
Then pwd, README, AGENTS.md (call 4) and the right files. The `guard` entry in ssg.assets.json is correct
(Character_Skeleton_Knight, Idle_Standing + Walk_F, copied from the skeleton entry down to its templates), written
with a small Python json edit after a multi-line `sed -i` failed. But it never ran `npm run assets` (no
`public/assets/guard`), never placed a guard in the room, never started the dev server. Calls 7–26 were spent
grepping how skeleton creatures are typed and placed; two typechecks on an unchanged tree; then it was mid-way
through widening the `'skull' | 'skeleton'` unions to include `'guard'` (sed -i, a `re.sub` with a bad escape) when
the limit hit, so typecheck now fails on the two call sites it had not reached. One malformed tool call (JSON
arguments cut at 4500 chars → format error, one call wasted).

## Observations

1. **Availability is the first problem, before capability.** Two of the three chosen models (both listed with
   `tools` support that morning) did not answer one request between 11:15 and 13:05: one provider-deleted (404),
   one with an exhausted shared free pool (429). The agent layer needs a model fallback list and a one-call probe
   before every run, and must treat 404/429-upstream as "switch model", not "retry".
2. **No model budgets steps.** All four completed runs ran to the 40-call limit and none submitted. The models do
   not plan around a budget; exploration and debugging expand to fill it. A harness for weak models has to impose
   the plan (read these files, make this edit, run these checks, submit) rather than hope for it.
3. **Edit mechanics, not design, sink the bash-only harness.** cohere T1 had the right design at call 12 and spent
   28 calls on sed/heredoc/python edit attempts. minimax's edits (python `str.replace`) worked first time. With
   bash as the only tool, the edit method is the dominant variable; a real edit tool (as OpenCode has) should be
   compared directly on this run.
4. **Path guessing is a real safety issue.** minimax guessed `/home/andrew/projects/monty` from the package name in
   both runs and once wrote to the real repo (self-reverted). cohere started with `/workspace/game`. The copies must
   be isolated (container, or at least unguessable names and no shared $HOME), not just "please stay in this
   folder" in AGENTS.md.
5. **Scope discipline is absent.** minimax read Phaser's source (~15 and 8 calls), the generator's source and its
   SQLite DB; none of that was needed. Explicit "do not read outside src/ and the files named here" instructions
   are cheap and would have given minimax T2 its missing 20 calls.
6. **T2's pipeline step was never reached.** Nobody ran `npm run assets`. The only correct declaration (cohere)
   came from the task's explicit "declared the same way as the existing skeleton sprite" plus the example in the
   JSON: concrete templates work, inference does not. The generator CLI was only ever used for `--help`/list
   look-ups, correctly.
7. **Verification is skipped or self-invented.** AGENTS.md was read in 3 of 4 runs (cohere T1 skipped it). The
   mandated typecheck + load-check sequence was completed by nobody; minimax substituted its own Playwright test
   (and then chased a false alarm from it).
8. **The one pass is fragile.** minimax T1 passes the grader's probe, but the run itself ended in the middle of
   debugging with an unsubmitted, test-file-polluted tree. Judged by "would a maintainer merge this", it is 0/4.

## Harness notes

- `mini` 2.4.6 default `mini.yaml` (one `bash` function tool via LiteLLM, model `openrouter/<id>`; the text-based
  variant was not used). The spike README's "bash only, no tool calling" describes the single-tool design; in 2.x the
  tool is still delivered through function calling, which is why tool-capable models were required.
- Overlay (`msa-overlay.yaml`, merged on top): `agent.step_limit: 40`, `cost_limit: 0`,
  `wall_time_limit_seconds: 1150`, `mode: yolo`, `confirm_exit: false`; `environment.timeout: 600` (the default 30 s
  per command would have killed any asset build); `model.cost_tracking: ignore_errors` (free models report $0 and the
  default throws). Env: `MSWEA_CONFIGURED=1` (skips the interactive first-run setup; no global .env was created),
  `MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT=8` (default 10; tenacity waits 4,4,4,8,16,32,60 s), outer `timeout 1200`.
- The venv's LiteLLM 1.106 failed to import (`No module named 'mcp'`) on the first attempt; `pip install mcp` fixed
  it. No model call was made by that attempt.
- One run at a time, 10 s between runs, ports 5320–5327, copies under `scratchpad/spike2/msa/<model>-<task>/`
  (kept, `.vite-cache` removed). Monty's working tree and the generator repo were clean after every run; the only
  write outside a copy was minimax T1's self-reverted patch of the real `Room.ts`.
- Per run: `transcript.json` (mini-swe-agent trajectory), `mini.log` (console), `diff.patch`, `git-status.txt`,
  `run.json`, `grade.json`; minimax/T1 also has the screenshot its own test took (`screenshot-model-pause.png`). The
  grader takes no screenshot.
