#!/usr/bin/env bash
# One spike-2 run with OpenCode: run-one.sh <model-short> <openrouter model id> <T1|T2> <port>
# Makes the scratch copy, runs `opencode run` on the task text with only built-in tools (MCP servers disabled by the
# project-local opencode.json), caps it at 20 min wall clock / 40 model steps, then grades and writes
# transcript.jsonl, opencode.log, diff.patch, grade.json, run.json under results/opencode/<short>/<task>/.
set -u
SHORT=$1; MODEL=$2; TASK=$3; PORT=$4
SPIKE=/home/andrew/projects/sloponator/spikes/weak-model
SCRATCH=/tmp/claude-1000/-home-andrew-projects-synty-sprite-generator/1cda9c40-18cc-45d5-b46e-5978712743f8/scratchpad/spike2/opencode
COPY=$SCRATCH/$SHORT-$TASK
RES=$SPIKE/results/opencode/$SHORT/$TASK
OPENCODE=/home/andrew/.opencode/bin/opencode
case $TASK in T1) TASKFILE=T1-pause.md;; T2) TASKFILE=T2-sprite.md;; *) echo "bad task"; exit 2;; esac
mkdir -p "$RES"
set -a; . ~/.config/sloponator/.env; set +a

port_pid() { ss -ltnp 2>/dev/null | grep -E ":$1 " | grep -oP 'pid=\K[0-9]+' | head -1; }
kill_port() { local p; p=$(port_pid "$1"); if [ -n "$p" ]; then echo "killing pid $p on port $1"; kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; fi; }
# Kill anything the model left running inside the copy (never the generator servers: their cwd is elsewhere).
kill_copy_procs() { for p in /proc/[0-9]*; do pid=${p#/proc/}; [ "$pid" = "$$" ] && continue; cwd=$(readlink "$p/cwd" 2>/dev/null) || continue; case "$cwd" in "$COPY"|"$COPY"/*) echo "killing leftover pid $pid ($(tr '\0' ' ' < "$p/cmdline" | cut -c1-80))"; kill "$pid" 2>/dev/null;; esac; done; }
outside_state() { { git -C ~/projects/monty status --short; echo ---; git -C ~/projects/synty-sprite-generator status --short; echo ---; git -C ~/projects/sloponator status --short | grep -v 'spikes/weak-model/results/'; } 2>&1; }

BEFORE=$(outside_state)
TASKTEXT=$(cat "$SPIKE/tasks/$TASKFILE")
ATTEMPT=0; INFRA=0; NOTES=()
while :; do
  ATTEMPT=$((ATTEMPT+1))
  kill_port "$PORT"
  node "$SPIKE/prepare.mjs" "$COPY" "oc-$SHORT-$TASK" "$PORT" || exit 2
  # T2 renders into the renamed project: give it the real project's defaults first (see ensure-project.mjs).
  if [ "$TASK" = T2 ]; then node "$SPIKE/results/opencode/ensure-project.mjs" "Spike2 oc-$SHORT-$TASK" || exit 2; fi
  cp "$SPIKE/results/opencode/opencode.json" "$COPY/opencode.json"
  git -C "$COPY" -c user.name=spike -c user.email=spike@local add opencode.json
  git -C "$COPY" -c user.name=spike -c user.email=spike@local commit -qm 'harness config'
  # Safety: the copy is its own git repo, not inside another checkout.
  [ -d "$COPY/.git" ] && [ "$(git -C "$COPY" rev-parse --show-toplevel)" = "$COPY" ] || { echo "copy is not a standalone repo"; exit 2; }
  cd "$COPY" || exit 2
  START=$(date +%s)
  timeout -s TERM 1200 "$OPENCODE" run --pure --auto --format json --print-logs --log-level INFO --title "oc-$SHORT-$TASK" \
    -m "openrouter/$MODEL" "$TASKTEXT" > "$RES/transcript.jsonl" 2> "$RES/opencode.log" &
  OCPID=$!
  CAPPED=0
  while kill -0 $OCPID 2>/dev/null; do
    n=$(grep -c '"type":"step_start"' "$RES/transcript.jsonl" 2>/dev/null); n=${n:-0}
    if [ "$n" -gt 40 ]; then echo "step cap: $n steps, killing"; kill $OCPID; CAPPED=1; sleep 3; kill -9 $OCPID 2>/dev/null; break; fi
    sleep 5
  done
  wait $OCPID; EXIT=$?
  END=$(date +%s); WALL=$((END-START))
  STEPS=$(grep -c '"type":"step_start"' "$RES/transcript.jsonl" 2>/dev/null); STEPS=${STEPS:-0}
  echo "attempt $ATTEMPT: exit=$EXIT steps=$STEPS wall=${WALL}s capped=$CAPPED"
  # Infrastructure failure: no model step ever ran and the stream ended with an error → retry (3 attempts, 60 s apart).
  if [ "$STEPS" -eq 0 ] && grep -q '"type":"error"' "$RES/transcript.jsonl"; then
    msg=$(grep '"type":"error"' "$RES/transcript.jsonl" | head -1 | cut -c1-300)
    NOTES+=("attempt $ATTEMPT: no step ran, error: $msg")
    if [ $ATTEMPT -lt 3 ]; then sleep 60; continue; fi
    INFRA=1
  fi
  break
done

kill_port "$PORT"
kill_copy_procs
sleep 1
cd "$COPY" && git add -N . && git diff > "$RES/diff.patch"
# Grade (starts its own vite on the port).
timeout 600 node "$SPIKE/grade.mjs" "$COPY" "$TASK" "$PORT" > "$RES/grade.json" 2> "$RES/grade.log"
kill_port "$PORT"
rm -rf "$COPY/.vite-cache"
AFTER=$(outside_state)
STRAYED=false; [ "$BEFORE" = "$AFTER" ] || { STRAYED=true; echo "OUTSIDE STATE CHANGED"; diff <(echo "$BEFORE") <(echo "$AFTER"); }
NOTES_JSON=$(printf '%s\n' "${NOTES[@]:-}" | node -e 'const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean);process.stdout.write(JSON.stringify(l))')
node "$SPIKE/results/opencode/analyse.mjs" "$RES" "$MODEL" "$TASK" "$WALL" "$EXIT" "$CAPPED" "$INFRA" "$STRAYED" "$NOTES_JSON" > "$RES/run.json"
cat "$RES/run.json"; echo; cat "$RES/grade.json"
