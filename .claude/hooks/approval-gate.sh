#!/bin/bash
# PreToolUse approval gates (intent/tool-sandbox-verification/gates.md).
# Exit 2 blocks the call and shows stderr to Claude; printing a permissionDecision of "ask" makes the user confirm.
# Every decision other than a plain allow is appended to .claude/gate-log.jsonl with a timestamp.

input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")
project="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"
project="${project:-$PWD}"

log() {
  jq -cn --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg gate "$1" --arg decision "$2" --arg tool "$tool" \
    --arg target "$3" '{ts: $ts, gate: $gate, decision: $decision, tool: $tool, target: $target}' \
    >>"$project/.claude/gate-log.jsonl" 2>/dev/null
}

block() { # gate, target, reason, route
  log "$1" block "$2"
  echo "Blocked by approval gate $1: $3" >&2
  echo "How to get approval: $4" >&2
  exit 2
}

ask() { # gate, target, reason
  log "$1" ask "$2"
  jq -cn --arg reason "Approval gate $1: $3" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $reason}}'
  exit 0
}

if [[ "$tool" == "Bash" ]]; then
  cmd=$(jq -r '.tool_input.command // ""' <<<"$input")

  # G1: release/DB authorization
  if grep -Eq 'db:(deploy|migrate)|prisma[[:space:]]+(migrate[[:space:]]+(deploy|dev|reset)|db[[:space:]]+push)' <<<"$cmd"; then
    if [[ -z "$RELEASE_APPROVAL" ]]; then
      block G1 "$cmd" "database migrations and deploys need a release authorization." \
        "get sign-off from the release owner, then start Claude Code with RELEASE_APPROVAL=<ticket or approver> set, or run the command yourself."
    fi
    log G1 allow "$cmd (RELEASE_APPROVAL=$RELEASE_APPROVAL)"
  fi

  # Check each command in a chain separately (split on ;, &&, || and |)
  while IFS= read -r segment; do
    [[ "$segment" =~ git[[:space:]]+push ]] || [[ "$segment" =~ git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+origin ]] || continue

    # G3: no history rewrites on shared branches
    if [[ "$segment" =~ git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+origin ]] ||
      grep -Eq '(^|[[:space:]])(--force(-with-lease)?(=[^[:space:]]*)?|--mirror|-[a-zA-Z]*f[a-zA-Z]*)([[:space:]]|$)|[[:space:]]\+[^[:space:]]+' <<<"$segment"; then
      block G3 "$segment" "force pushes, mirror pushes and hard resets to a remote branch rewrite shared history." \
        "ask a human to run it by hand if it is really needed."
    fi

    # G2: main only through pull requests
    if [[ "$segment" =~ git[[:space:]]+push ]]; then
      args=$(sed -E 's/.*git[[:space:]]+push//' <<<"$segment")
      branch=$(git -C "$project" branch --show-current 2>/dev/null)
      positional=$(tr ' ' '\n' <<<"$args" | grep -Ev '^(-|$)' | wc -l | tr -d ' ')
      # Explicit target (main, HEAD:main, refs/heads/main), or pushing the current branch while on main
      if grep -Eq '(^|[[:space:]:])(refs/heads/)?main([[:space:]]|$)' <<<"$args" ||
        { [[ "$branch" == "main" ]] && { ((positional <= 1)) || grep -Eq '(^|[[:space:]])HEAD([[:space:]]|$)' <<<"$args"; }; }; then
        block G2 "$segment" "changes reach main only through a reviewed pull request." \
          "push a feature branch (git push -u origin <branch>) and open a PR; a human approves the merge."
      fi
    fi
  done < <(sed -E 's/(&&|\|\||;|\|)/\n/g' <<<"$cmd")

  # G4 via the shell: a command that names a protected path and can write files (redirect, tee, cp, mv, rm,
  # in-place edits, chmod/ln, or an inline script) needs the same confirmation as an Edit/Write
  protected='(\.github/workflows|\.claude/settings\.json|\.claude/hooks|prisma/migrations)'
  redirect=">{1,2}[[:space:]]*[\"']?[^[:space:]&]*$protected"
  writes='(^|[[:space:];&|(])(tee|cp|mv|rm|truncate|ln|chmod|install|dd)[[:space:]]|(sed|perl)[[:space:]]+(-[a-zA-Z]*[[:space:]]+)*-i|(python3?|node|ruby|perl|bun)[[:space:]]+(-[ec]|-[[:space:]]|<<)'
  if grep -Eq "$redirect" <<<"$cmd" || { grep -Eq "$protected" <<<"$cmd" && grep -Eq "$writes" <<<"$cmd"; }; then
    ask G4 "$cmd" "this shell command may write to a protected path (CI, Claude Code guardrails or migrations); a human must confirm it."
  fi
  exit 0
fi

if [[ "$tool" == "Edit" || "$tool" == "Write" || "$tool" == "MultiEdit" || "$tool" == "NotebookEdit" ]]; then
  file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$input")
  [[ "$file" == /* ]] || file="$project/$file"
  rel="${file#"$project"/}"

  # G4: protected paths
  case "$rel" in
    .github/workflows/* | .claude/settings.json | .claude/hooks/*)
      ask G4 "$rel" "$rel controls CI or Claude Code's own guardrails; a human must confirm this edit." ;;
    packages/database/prisma/migrations/*)
      [[ -e "$file" ]] && ask G4 "$rel" "$rel is an applied migration; edit it only if you are sure, normally add a new migration instead." ;;
  esac
fi

exit 0
