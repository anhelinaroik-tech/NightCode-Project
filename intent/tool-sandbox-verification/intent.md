# Intent: tool-sandbox verification loop
Author: Anhelina Roik (engineer, originator). Status: accepted. ClickUp: 869f1am8y. Date: 2026-10-05.

## Problem
The only check NightCode has is `bun run typecheck`. Nobody runs it unless they remember to, and nothing runs it on pull requests. There are no tests, no CI, and no rule telling Claude Code to verify its work before it reports done.

The riskiest code in the CLI is the code that runs model-requested tools on the user's machine:
- the project-directory sandbox (`isInside` / `resolveInsideCwd` in `packages/cli/src/lib/local-tools.ts`);
- the PLAN-mode block on write tools.

Typecheck cannot catch regressions there, and one has already shipped and been fixed by hand: names like `..cache` were rejected (commit 128ddda). Today, reviewers re-check this by running the TUI themselves.

Nothing in the repo stops Claude Code from running a database migration/deploy, pushing to `main`, or editing CI and its own settings without a human deciding.

## Proposed outcome
A broken sandbox or mode check is caught automatically. It shows up as a failing check on Claude's own turn (before it says "done") and again on the PR, and a human still makes every merge and release decision.

Concretely:
- A small, deterministic test suite for the sandbox and mode gating.
- One command (`bun run check`) that runs typecheck and the tests, and that CLAUDE.md tells Claude to run before reporting done.
- A Claude Code hook that enforces that command.
- A CI check on every PR.
- Hook-based approval gates for releases, `main` and protected paths.
- A deterministic watch on the CI failure rate that turns drift into a new intent.md.

## Affected users and systems
- Engineers working on NightCode, and Claude Code sessions in this repo.
- The reviewer: Olexiy Syvak.
- `packages/cli` (local tools), `packages/shared` (tool contracts), `CLAUDE.md`, `.claude/settings.json`, the new `.github/workflows/`, and the new `intent/`.
- Not affected: the server, the database schema, and the end-user behaviour of the CLI.

## Constraints
- App behaviour stays the same. The only source change allowed is exporting a function for tests.
- Existing approvals stay intact and are not weakened: the in-app approval dialog for write tools, the `.env` read deny rules, and manual deploys and migrations.
- CI holds no production credentials or database, and has read-only repository permissions. Any AI step in CI is read-only and optional (it is skipped when no API key is configured).
- Bun only, with no new test framework or dependencies. The checks should finish in about a minute.
- The scope is this learning repository. No company-wide or managed settings change.
- Anything an agent proposes reaches `main` only through a PR reviewed by a human.

## Acceptance conditions
- `bun run check` passes locally.
- If `isInside` is deliberately broken (back to `rel.startsWith("..")`), three things fail: `bun test`, the Claude Code Stop hook and the PR's CI check. Restoring it turns all three green.
- A human sees and decides before the following go through: `db:deploy`/`db:migrate`, `git push` to `main` or a force push, and edits to workflows, hook scripts, `.claude/settings.json` or existing migrations. Every block says why and how to get approval.
- The CI drift detector returns log / diagnose / propose for 1σ / 2σ / 3σ fixtures, and "insufficient data" for a short history.
- The PR links this intent, `spec.md` and `plan.md`, and Olexiy Syvak approves it.

## Open questions
- Should branch protection on `main` require the CI check? The repo owner decides; it is a GitHub setting, not a file.
- Should an `ANTHROPIC_API_KEY` secret be added so CI can summarise failures? The repo owner decides; without it the step is skipped.
- Which gates, if any, should later move to managed settings? The platform/IT admin decides; this is out of scope here.
