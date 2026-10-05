#!/bin/bash
# Stop hook: Claude can't report done while `bun run check` fails (CLAUDE.md "Verifying your work").
# Runs when packages/ differs from main (committed or not) and that exact state hasn't passed yet.
# After 3 blocks in a row it lets Claude stop and warns the user, so a check Claude can't fix doesn't loop forever.

input=$(cat)
project="${CLAUDE_PROJECT_DIR:-$PWD}"
session=$(jq -r '.session_id // "default"' <<<"$input")
counter="${TMPDIR:-/tmp}/nightcode-stop-hook-$session"
MAX_BLOCKS=3

verified="${TMPDIR:-/tmp}/nightcode-stop-hook-verified"

cd "$project" || exit 0
# Changes on this branch under packages/, committed during the turn or not
base=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || git rev-parse HEAD)
dirty=$(git status --porcelain -- packages 2>/dev/null)
if [[ -z "$dirty" ]] && git diff --quiet "$base" HEAD -- packages 2>/dev/null; then
  rm -f "$counter"
  exit 0
fi

# Skip a state that already passed: same commit and same uncommitted diff (incl. untracked file names)
state=$( { git rev-parse HEAD; git diff HEAD -- packages; echo "$dirty"; } 2>/dev/null | shasum | cut -d' ' -f1)
[[ "$(cat "$verified" 2>/dev/null)" == "$state" ]] && { rm -f "$counter"; exit 0; }

if output=$(bun run check 2>&1); then
  rm -f "$counter"
  echo "$state" >"$verified"
  exit 0
fi

blocks=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$blocks" >"$counter"
summary=$(grep -E '\(fail\)|error TS|Exited with code [1-9]| fail$|error:' <<<"$output" | head -30)

if ((blocks > MAX_BLOCKS)); then
  rm -f "$counter"
  jq -cn --arg msg "bun run check is still failing after $MAX_BLOCKS fix attempts; the change is NOT verified." \
    '{systemMessage: $msg}'
  exit 0
fi

{
  echo "bun run check failed (attempt $blocks of $MAX_BLOCKS). Fix the code, not the tests, then finish:"
  echo "${summary:-$(tail -30 <<<"$output")}"
  echo "If typecheck can't find the Prisma client, run: bun run --cwd packages/database db:generate"
  ((blocks == MAX_BLOCKS)) && echo "This is the last attempt: if it still fails, report the failure to the user instead of retrying."
} >&2
exit 2
