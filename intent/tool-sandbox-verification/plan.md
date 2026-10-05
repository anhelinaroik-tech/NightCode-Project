# Plan: tool-sandbox verification loop (from intent.md and spec.md, 2026-10-05)
Accepted in Claude Code plan mode by Anhelina Roik. ClickUp: 869f1am8y.

## Files that change
- `packages/cli/src/lib/local-tools.ts` (export `isInside`)
- `packages/cli/src/lib/local-tools.test.ts` (new)
- `packages/cli/src/lib/tool-contracts.test.ts` (new; in the CLI because `@nightcode/shared` has no Bun types)
- `package.json` (`test`, `check` scripts)
- `CLAUDE.md`, `README.md`
- `.claude/settings.json`, `.claude/hooks/approval-gate.sh` (new), `.claude/hooks/verify-on-stop.sh` (new), `.claude/hooks/approval-gate.test.ts` (new)
- `.github/workflows/ci.yml` (new), `.github/workflows/ci-drift.yml` (new)
- `scripts/detect-ci-drift.ts` (new), `scripts/detect-ci-drift.test.ts` (new), `intent/bands.yaml` (new)
- `intent/tool-sandbox-verification/lesson-mapping.md` (new)

## Order of work
1. Tests and the `isInside` export, then `bun test`.
2. Root scripts, then `bun run check`.
3. CLAUDE.md verification block.
4. Hook scripts and their tests, then the hooks wired into `.claude/settings.json` (the protected-path gate asks from this point on).
5. CI workflow.
6. Drift detector, its tests, `bands.yaml` and the weekly workflow.
7. Lesson mapping, README.
8. Before/after demo, `/code-review`, then the PR.

## Risks
- The Stop hook loops or slows turns. Mitigations: it is skipped when `packages/` has no changes, and it tells Claude to stop retrying after a repeated failure.
- `process.chdir` in tests leaks into other test files. Mitigation: restore it in `afterAll`.
- CI can't resolve the lockfile with a different Bun. Mitigation: pin 1.4.2.

## Proof
- `bun run check` output (green), pasted in the PR.
- The demo: `isInside` changed to `rel.startsWith("..")` makes `bun test` fail on `..cache`; restoring it turns it green.
- The gate tests show block, ask and allow cases; a manual `db:deploy` attempt is blocked with its reason.
- The detector tests cover the log, diagnose and propose tiers and "insufficient data".
- The CI check is green on the PR.
