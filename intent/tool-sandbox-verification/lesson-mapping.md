# How the AI-Native SDLC Playbook maps to NightCode
ClickUp: 869f1am8y. Scope: this learning repository only. No company-wide or managed settings were changed.

## Bottleneck
**Testing/verification.**
- Before this change, `bun run typecheck` was the only check, run by hand. There were no tests, no CI and no "verify before done" rule for Claude.
- The tool sandbox in the CLI (the code that decides which files a model may touch) had already regressed once (128ddda, `..cache`). Reviewers re-checked it by running the TUI themselves.

## Practice → what we applied
| Stage | Playbook practice | Applied here | Where |
|---|---|---|---|
| Plan | Capture as intent.md | Intent home + template; this change's intent, accepted by the product owner before commit | `intent/README.md`, `intent.md` |
| Plan | Repeat processes as skills | Intent template encoded as a skill | `.claude/skills/write-intent/` |
| Design | Requirements and design | `spec.md` produced from intent.md with flagged *Areas of concern*, signed off before build; the gate list is drafted for the lead | `spec.md`, `gates.md` |
| Build | Plan mode as the default start | Plan accepted in plan mode, saved as `plan.md` (Files / Order / Risks / Proof) | `plan.md` |
| Build | The CLAUDE.md | Commands, "Verifying your work", "Things Claude gets wrong", approval gates, intent workflow | `CLAUDE.md` |
| Build | Skills as institutional knowledge | Reused the existing `create-pr` / `fix-pr-issues` skills; added `write-intent` | `.claude/skills/` |
| Build | Parallel sessions and subagents | Not needed for a change this small (see below) | — |
| Test | Give Claude a feedback loop | `bun run check` + a Stop hook that blocks "done" while it fails (max 3 attempts, then warns the user) | `.claude/hooks/verify-on-stop.sh` |
| Test | Continuous evals in CI | Deterministic regression tests act as the eval layer and run on every PR | `*.test.ts`, `.github/workflows/ci.yml` |
| Deploy | AI in the PR review loop | `/code-review` run before opening the PR, findings in the PR description; optional read-only Claude triage of CI failures | PR, `ci.yml` |
| Deploy | Hooks as approval gates | `PreToolUse` gate: block DB release without `RELEASE_APPROVAL`, block pushes to `main` and force pushes, ask before editing CI/guardrail files and applied migrations; decisions logged with a timestamp | `.claude/hooks/approval-gate.sh`, `gates.md` |
| Deploy | CI/CD integration | Read-only CI (`contents: read`, no secrets required, no production credentials) | `ci.yml` |
| Maintain | Closing the loop on metrics | Deterministic weekly check of the CI failure rate against `bands.yaml` (WE rules 1–2). A breach becomes a draft intent.md and a triage issue | `scripts/detect-ci-drift.ts`, `intent/bands.yaml`, `ci-drift.yml` |

## Human approval boundary
Automation reports; people decide.
- **Agent side:** Claude may edit code, run tests and propose. CI and AI review only report; they can't approve or merge.
- **Gates:**
  - Accepting `intent.md` and `spec.md`: product owner.
  - Accepting the plan: engineer.
  - Merge to `main`: human PR review (Olexiy Syvak).
  - DB migrations/deploys: release owner, via `RELEASE_APPROVAL`.
  - CI, hook and settings edits: confirmed in the permission prompt.
  - CI-drift findings: triaged by a human (fix, schedule or dismiss).
- **Preserved, not weakened:**
  - the CLI's in-app approval dialog for write tools;
  - the `.env` read deny rules;
  - manual deploys;
  - every existing permission entry.

## Maintenance feedback
- A CI breach or a production regression becomes a new `intent/<slug>/intent.md` (the detector drafts it) and goes through the same pipeline.
- When review flags the same mistake twice, it goes into CLAUDE.md under "Things Claude gets wrong". The first entry is the `..` path-check rule.
- When a fix ships, a regression test is added (the acceptance condition in the drift intent template).
- If a triager dismisses a drift alarm, retune `intent/bands.yaml` through a PR.

**Metrics, read from Git and CI:**
- Leading: time from the `intent.md` commit to the `spec.md` commit to the PR, and from a band breach to a triage issue.
- Lagging: `spec.md` commits after `plan.md` (rework); CI failure rate; repeat incidents of the same class.

## Deliberately not adopted (bounded scope)
| Control | Why not here |
|---|---|
| Managed settings (`allowManagedHooksOnly`, sandbox, `disableBypassPermissionsMode`, marketplace allowlist) | Owned by the platform/IT admin; the ticket forbids company-wide changes. The gates in `gates.md` are the ones that would move there. |
| Org branch protection / merge gating on CI | A GitHub setting, not a file. Recommended to the repo owner (open question in intent.md). |
| Managed Code Review service + `REVIEW.md` | Needs an admin to enable it. A local `/code-review` covers the learning goal. |
| Agent evals in CI (`claude -p` against eval prompts with an API key) | Needs a paid secret. Deterministic tests are enough for this logic. |
| Verifier subagent, parallel sessions/worktrees | Too small a change to benefit. |
| MCP deploy tools, per-environment autonomy tiers, rehearsed rollback | NightCode has no deploy pipeline in this repo. Rollback is a revert PR. |
| Spec-on-merge automation, Claude Design, auto mode by default | Organisation-level process; intent→spec ran by hand here, as the course suggests starting. |
| OpenTelemetry export, Claude Tag on-call | Need org infrastructure. |
