# Spec: tool-sandbox verification loop
From: [intent.md](intent.md) (accepted 2026-10-05). Status: accepted. ClickUp: 869f1am8y.
Constraints applied: CLAUDE.md (Bun, no build step, shared types in `@nightcode/shared`), the repo skills (`create-pr`, `fix-pr-issues`), and the intent's constraints.

## Requirements
**R1. Sandbox and mode tests.** `bun test` covers the following:
- `isInside`: inside for `foo`, `..cache`, `a/../b` and the root itself; outside for `..`, `../x` and an absolute path elsewhere.
- `executeLocalTool` in a throwaway project directory:
  - a `../` path is rejected with "outside the project directory";
  - a symlink pointing out of the project is rejected;
  - PLAN mode rejects `writeFile`, `editFile` and `bash`, and allows `readFile`;
  - a BUILD-mode `writeFile` → `readFile` round-trip returns the content.
- `@nightcode/shared`: `isReadOnlyTool` is true only for `readFile`, `listDirectory`, `glob` and `grep`, and `getToolContracts(Mode.PLAN)` contains no write tool.

**R2. One verification command.**
- Root scripts: `test` = `bun test`, and `check` = `bun run typecheck && bun test`.

**R3. CLAUDE.md feedback loop.**
- Update Commands.
- Replace "there is no test runner" with the new state.
- Add `## Verifying your work`: run `bun run check` before reporting done, paste the output, and fix the code, not the test.
- Add `## Things Claude gets wrong` with the path-check rule.
- Add a pointer to `intent/`.

**R4. Stop hook.** Before Claude finishes a turn, the hook runs `bun run check` if the working tree has changes under `packages/`. If the check fails, the hook exits 2 with the failing output, so Claude has to keep fixing.

**R5. Approval gates.** A `PreToolUse` hook script, `.claude/hooks/approval-gate.sh`, enforces the gates listed in [gates.md](gates.md). It blocks or asks, and always explains the reason and the route to approval.

**R6. CI check.** `.github/workflows/ci.yml` runs on PRs and pushes to `main` with `contents: read`:
1. install with a frozen lockfile;
2. `db:generate`;
3. `typecheck`;
4. `bun test`.

After a failure, an optional read-only `claude -p` triage step writes a short summary to the job summary. It runs only if the `ANTHROPIC_API_KEY` secret exists.

**R7. CI drift watch.**
- `scripts/detect-ci-drift.ts` reads finished CI runs from `gh run list --json` and computes the weekly failure rate.
- It compares the latest point against the rolling mean and σ and applies Western Electric rule 1 (one point beyond 3σ) and rule 2 (2 of 3 beyond 2σ).
- It maps the result to the tiers in `intent/bands.yaml`.
- At *propose*, it writes a draft `intent/ci-drift-<date>/intent.md` and the weekly workflow opens a GitHub issue with it. Nothing else is automated.
- Below the minimum number of points it reports "insufficient data".

**R8. Mapping note.** `lesson-mapping.md` maps every playbook lesson to what this change applies, or explains why it is not adopted.

## Design
| Area | Decision |
|---|---|
| Test runner | Built-in `bun:test`; no new dependency. Test files sit next to their source (`*.test.ts`). |
| Exposing `isInside` | Add `export` to the existing function. No other source change. |
| Filesystem tests | `mkdtemp` under the OS temp dir. `process.chdir` into it in `beforeAll` and back in `afterAll`, because the sandbox resolves against `process.cwd()`. |
| Hook scripts | Bash + `jq`, the same form as the course example. They live in `.claude/hooks/` and are referenced via `${CLAUDE_PROJECT_DIR}`. |
| Block vs ask | **Block** (exit 2, message on stderr) means the action needs an authorization that lives outside the session. **Ask** (`permissionDecision: "ask"`) means a human at the keyboard can decide on the spot. |
| Gate tests | `.claude/hooks/approval-gate.test.ts` pipes sample hook JSON into the script with `Bun.spawn` and asserts exit codes and stdout. |
| Drift maths | A pure function `classify(points, bands)` that is fully unit tested. `gh` I/O is kept in a thin wrapper. The YAML is parsed with Bun's built-in `Bun.YAML`, so no dependency is needed. |
| CI Bun version | `oven-sh/setup-bun@v2` pinned to the local version (1.4.2) so the lockfile resolves the same way. |
| Linkage | Each artifact header carries the ClickUp ID. The ClickUp comment gets the PR link and merge SHA. |

## Areas of concern
1. **The command-menu filter can't be unit tested cheaply.** `commands.tsx` imports dialogs (OpenTUI), OAuth and billing modules. Testing `getFilteredCommands` would mean mocking all of them, so it is **dropped from scope**. The intent only asks for the sandbox and mode gating.
2. **The Stop hook adds latency and can loop.** Typecheck plus tests takes a few seconds on each turn that touched `packages/`. To bound this, the hook skips when nothing under `packages/` changed. Accepted: the hook blocks. *Amended during build:* blocking on every failure would loop forever if Claude can't fix the check, so the hook blocks at most 3 times in a row. On the 3rd block it tells Claude to report the failure; after that it lets the turn end and shows the user "the change is NOT verified".
3. **The Stop hook needs the Prisma client.** On a fresh clone typecheck fails until `db:generate` runs. The hook message names that fix.
4. **Gate matching is string-based.** The `git push`/deploy detection inspects the command text, so a determined workaround (an alias, or `sh -c` with obfuscation) could slip through. Likewise, G4 (protected paths) only sees the Edit/Write tools: a Bash redirect such as `cat > .github/workflows/x.yml` is not caught (*found during build*). That is acceptable for a team-level hook, because branch protection and code-owner review on the PR still catch it. Making it non-negotiable needs managed settings plus the sandbox (out of scope; see lesson-mapping).
5. **The gate also guards its own config.** Editing `.claude/settings.json` and `.claude/hooks/**` will ask for confirmation, including while this change is being built. That is intended.
6. **The drift baseline is thin.** The repo has few CI runs, so the detector will report "insufficient data" for several weeks. Its correctness is proven with fixtures, not live data.
7. **The workflow can open issues.** `ci-drift.yml` needs `issues: write`. That is the only write permission granted to CI, and it is not a code path to `main`.
8. **Branch protection isn't in this change.** The "agent can only reach `main` via PR" guarantee needs GitHub branch protection, which is a repo setting. The local gate covers Claude Code sessions only. The repo owner should enable protection (see the intent's open questions).

Policy conflicts: none found. Every gate tightens an existing control, and none is weakened.
