---
name: create-pr
description: Automate creation of a GitHub Pull Request by fetching context from the ClickUp task linked in the branch name, running local checks, summarizing code changes into the project's PR format (Ticket / Goal / Changes / Verification / Run evidence), and updating the ClickUp task status. Use when asked to create a PR, open a pull request, or submit work for review.
---

1. **Get Branch, Base and Task ID**
   - Capture the branch name once and always quote it: `branch="$(git branch --show-current)"`, then use `"$branch"` in every command.
   - Extract the ClickUp Task ID from the branch name if present (e.g., `feat(869f8gcxf)-Build-UI-infrastructure` -> `869f8gcxf`, `feature/869e0g5k8-something` -> `869e0g5k8`).
   - If the branch has no Task ID, there is no ticket — skip Steps 2 and 7 and fill **Ticket** with `No ticket (<reason, e.g. tooling>)`.
   - Base branch is `main`. If this branch is stacked on another open PR (its commits start from that PR's head, not from `main`), use that PR's head branch as the base and note it in **Ticket**.

2. **Fetch Task Details**
   - Use `mcp__clickup__clickup_get_task` with the task ID from Step 1 for full context.
   - Retrieve:
     - **Task Name** (for PR title)
     - **Task ID** (e.g. `869e0g5k8`, for PR body)
     - **Task URL** (for PR body)
     - **Description** (for context)

3. **Run Local Checks**
   - Run `bun run --cwd packages/cli typecheck` and record pass/fail.
   - `bun run dev` needs a real TTY and cannot be run from Claude Code. Leave that box unchecked with a note, and ask the user whether they ran it.
   - Never tick a box for a check that was not actually run.

4. **Analyze Changes (Content Generation)**
   - Run `git log "<base>..HEAD" --oneline` to see commits on this branch.
   - Run `git diff "<base>...HEAD" --stat` to see all changed files.
   - Write one bullet per logical change: start with a past-tense verb (Added, Reworked, Merged, Fixed, Removed) and say what it does for the project, e.g. "Reworked review-uncommitted-changes to cover staged, unstaged and untracked changes".
   - **Strict constraints:**
     - **NO** file paths, line numbers or function names unless they are the thing being changed (a skill, a command, a component).
     - **NO** implementation details (e.g., "Added a for loop").
     - No sub-headings inside **Changes** — a flat bullet list.

5. **Prepare PR Content**
   - **Title**: `[<Task ID>] <Task Name>` (e.g., `[869f1am8t] Project Setup & Component Architecture`). Without a ticket: a short imperative summary.
   - **Body**: use exactly this structure:

     ```markdown
     ## Ticket
     [<Task ID>](<ClickUp URL>)   <!-- or: No ticket (<reason>). -->
     <!-- If stacked: "Stacked on #<n> (<branch>), because <reason>." -->

     ## Goal
     <1–2 sentences: why this PR exists, from the ClickUp description or the nature of the changes>

     ## Changes
     - <bullets from Step 4>

     ## Verification
     - [ ] `bun run --cwd packages/cli typecheck` passes   <!-- tick only if Step 3's typecheck passed; otherwise leave unticked and note the failure -->
     - [ ] `bun run dev` starts without errors (<result, or "not run: <reason>">)
     - [ ] <any other manual check, e.g. a dry run or real use of the change>

     ## Run evidence
     <Screenshot / recording / terminal output of the change working, or "Not applicable: <reason>" when no app code changed>
     ```

   - Do NOT add a "Summary by CodeRabbit" section — CodeRabbit appends it itself.
   - Do NOT include any mentions like: 'Made with Cursor'.
   - Show the title and body to the user and wait for approval before creating the PR.

6. **Create Pull Request**
   - **Important**: Do not create the PR if one already exists for this branch. Check with `gh pr list --head "$branch" --state open` first.
   - If the branch is not pushed, push it first with `git push -u origin "$branch"`.
   - If commiting staged changes do not include --trailer flag!
   - Run `gh pr create --base "<base>" --title "<Title>" --body "<Body>"`.

7. **Update the ClickUp Task**
   - Use `mcp__clickup__clickup_update_task` with the exact task ID from Step 2, unchanged.
   - If task in "IN PROGRESS" status change it to "IN REVIEW".
   - **If QA can test the ticket**: Use `mcp__clickup__clickup_create_comment` on the task with a comment that includes:
     - A **Steps to test** heading, with steps derived from **Verification**
     - A link to the created GitHub PR for reference

8. Provide direct link to new Github Pull Request
