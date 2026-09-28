---
name: fix-pr-issues
description: Triage and fix issues on a GitHub Pull Request until it is merge-ready. Fetches PR context, resolves merge conflicts, addresses review comments, and fixes CI failures. Stops before committing — presents a proposed commit for human approval. Usage: /fix-pr-issues <github-pr-url>
---

**Usage:** `/fix-pr-issues <github-pr-url>`

Example: `/fix-pr-issues https://github.com/org/repo/pull/123`

---

## Step 1: Parse input

- Extract the PR URL from the command text. If missing or invalid, stop and ask for a full GitHub PR URL.
- Accept formats:
  - `https://github.com/<owner>/<repo>/pull/<number>`
  - `github.com/<owner>/<repo>/pull/<number>`
  - `<owner>/<repo>#<number>` or `<owner>/<repo>/pull/<number>`

---

## Step 2: Fetch PR context

Prefer the GitHub MCP tool (`mcp__plugin_github_github__pull_request_read`) over raw `gh` calls — it returns structured data instead of hand-rolled JSON/GraphQL parsing. Parse `<owner>/<repo>/<number>` from the URL first.

Fetch in parallel where possible:

- `method: get` — title, state, mergeable, mergeStateStatus, head/base ref, body.
- `method: get_check_runs` and `method: get_status` — CI status (replaces `gh pr checks`).
- `method: get_reviews` — reviewDecision / approvals.
- `method: get_review_comments` — review threads, each with `isResolved` / `isOutdated` already attached (paginate with `perPage`/`after` if truncated).

Fall back to `gh pr view "<url>" --json ...` or `gh api graphql` only if the MCP server is disconnected or a field it doesn't expose is needed.

Rules when reading the results:

- Read only comment bodies and the minimum location/URL needed to act.
- Do not dump or re-read entire payloads.
- Skip resolved, outdated, or purely informational threads unless they contain an open action item.
- Validate Bugbot / bot findings before fixing; explain when you disagree or are unsure.

Build a prioritized issue list:

1. Merge conflicts / mergeStateStatus not `CLEAN`
2. Failing required CI checks
3. Unresolved human review comments requesting changes
4. Valid unresolved bot findings

If no actionable issues remain, report PR is merge-ready and stop.

---

## Step 3: Sync local workspace to PR branch

```bash
gh pr checkout "<url>"
git fetch origin
```

- If branch is behind base, merge or rebase per repo convention (default: merge latest base into PR branch).
- If merge conflicts exist, resolve intelligently — preserve intent of both sides. If intents conflict, stop and ask for clarification.

Confirm you are on the PR head branch before editing.

---

## Step 4: Fix issues (loop)

Work one category at a time. After each batch, re-run targeted verification before moving on.

### A. Merge conflicts

- Resolve conflict markers in affected files.
- Run type-check / lint on touched files if available in project.

### B. Review comments

For each unresolved thread:

1. Open the referenced file and line.
2. Read surrounding code and PR diff context: `git diff <base>...<head> -- <path>` locally (post-checkout), or `pull_request_read` `method: get_diff` / `get_files` if not yet checked out.
3. Apply the smallest correct fix that addresses the comment.
4. Skip nits, style-only prefs, or suggestions already handled unless reviewer explicitly blocked merge.

Do **not** mark GitHub threads resolved via API unless the user explicitly asks.

### C. CI failures

For each failing required check:

1. Read the failure log: `gh run view <run-id> --log-failed` or check annotations from `gh pr checks`.
2. Fix root cause within PR scope only.
3. Re-run locally when possible (`npm test`, `npm run lint`, `npm run type-check`, etc. — use project scripts).
4. Never weaken CI/workflows just to pass.
5. Never make unrelated code changes to green CI.
6. If failure seems unrelated, first merge/rebase latest base branch; another PR may have fixed it.

Repeat until mergeable + required checks pass + review items triaged.

---

## Step 5: Verify

Before finishing:

```bash
git status
git diff --stat
# project-specific verification, e.g.:
npm run lint
npm run type-check
```

Summarize:

- Issues found
- Fixes applied (file + brief reason)
- Checks still failing (if any)
- Items needing human decision (if any)

---

## Step 6: Stop for human review (do not commit or push)

**Stop here.** Do **not** run `git commit`, `git push`, or any other command that publishes changes unless the user explicitly asks after reviewing.

When fixes were made, prepare a commit preview for the human:

```bash
git status
git diff --stat
git diff          # full unstaged diff, or staged if you ran git add
git log -5 --oneline
```

Then present:

1. **Files changed** — list every path that would be committed.
2. **Summary of changes** — brief per-file rationale tied to the issues fixed.
3. **Proposed commit message** — follow repo style from `git log`; use Conventional Commits (`fix:`, `refactor:`, etc.). Do **not** run `git commit`.
4. **Suggested next commands** — show what the human can run after approval, e.g.:

```bash
git add <paths>
git commit -m "<proposed message>"
git push origin HEAD
gh pr checks "<url>"
```

Rules:

- Stage files with `git add` only if it helps the human see `git diff --cached`; otherwise leave changes unstaged and list paths to add.
- Never commit secrets; call out any file that should stay out of the commit.
- Do **not** force-push unless user explicitly requests it.
- Tell the human to review the diff, then commit/push themselves or ask you to commit.

---

## Output format

```markdown
## PR: [<number>] <title>

<link>

### Issues addressed

- [category] <short description> — <files changed>

### Still open

- <item needing user input, if any>

### CI

- <local verification pass/fail; note that remote checks update only after human pushes>

### Proposed commit

- **Message:** `<suggested conventional commit message>`
- **Files:** `<paths to stage>`
- **Commands:** `<git add / commit / push the human can run>`

### Next step

- **Awaiting human review** — review diff and proposed commit; commit/push when ready, or ask agent to commit.
- Otherwise: <merge-ready | waiting on CI | needs user decision>
```

---

## Guardrails

- Scope fixes to this PR only.
- Prefer minimal diffs; match existing code style.
- Do not create a new PR.
- Do not close or merge the PR unless explicitly asked.
- Do not amend commits already pushed to remote.
- Do not commit or push unless the user explicitly asks after reviewing the proposed changes.
- Ask before destructive git operations.
