# Human approval gates
For: [spec.md](spec.md) R5. Status: accepted by the product owner. ClickUp: 869f1am8y.

These human decisions must survive automation. Each one is enforced by `.claude/hooks/approval-gate.sh` (a team hook in `.claude/settings.json`, so it applies to every Claude Code session in this repo).

| # | Gate | Matches | Decision | How to get approval |
|---|---|---|---|---|
| G1 | Release/DB authorization | Bash: `db:deploy`, `db:migrate`, `prisma migrate deploy\|dev\|reset`, `prisma db push` | **block** unless `RELEASE_APPROVAL` is set | Get sign-off from the release owner, then rerun with `RELEASE_APPROVAL=<ticket or approver>` in the environment |
| G2 | `main` only through PRs | Bash: `git push` to `main` or `HEAD:main`, or a bare `git push` while on `main` | **block** | Push a branch and open a PR; a human approves the merge |
| G3 | No history rewrites on shared branches | Bash: `git push --force` / `-f` / `--force-with-lease` / `--mirror`, `git reset --hard origin/…` | **block** | Ask a human to do it by hand, if it is really needed |
| G4 | Protected paths | Edit/Write, or a Bash command that writes to (redirect, `tee`, `cp`/`mv`/`rm`, `sed -i`, inline script): `.github/workflows/**`, `.claude/settings.json`, `.claude/hooks/**`, existing files in `packages/database/prisma/migrations/**` | **ask** | Confirm in the Claude Code permission prompt |

These gates leave the following unchanged:
- the in-app approval dialog for the CLI's own write tools;
- the `.env` read deny rules in `.claude/settings.json`;
- manual deploys.

Every gate makes the existing controls stricter.

**Known limits.** These are team hooks, so they are advisory against a determined bypass:
- The gates match command text, so an alias or an obfuscated `sh -c` can slip past them.
- Gates only see the command text, so a matching string inside a heredoc can trigger a false block. Run that command another way, or have a human run it.
- Hooks load when a Claude Code session starts.

The backstops are PR review and GitHub branch protection. Moving the gates into managed settings with `allowManagedHooksOnly` plus the sandbox would make them non-negotiable, and that decision belongs to the platform/IT admin.
