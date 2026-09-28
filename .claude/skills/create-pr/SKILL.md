---
name: create-pr
description: Automate creation of a GitHub Pull Request by fetching context from the ClickUp task linked in the branch name, summarizing code changes, filling the PR template, and updating the ClickUp task status. Use when asked to create a PR, open a pull request, or submit work for review.
---

1. **Get Branch and Task ID**
   - Run `git branch --show-current` to get the current branch name.
   - Extract the ClickUp Task ID (e.g., `869e0g5k8`) from the branch name (e.g., `feature/869e0g5k8-something` -> `869e0g5k8`).

2. **Fetch Task Details**
   - Use `mcp__clickup__clickup_get_task` with the task ID from Step 1 for full context.
   - Retrieve:
     - **Task Name** (for PR title)
     - **Task ID** (e.g. `869e0g5k8`, for PR body)
     - **Task URL** (for PR body)
     - **Description** (for context)

3. **Analyze Changes (Content Generation)**
   - Run `git log develop..HEAD --oneline` to see commits on this branch.
   - Run `git diff develop...HEAD --stat` to see all changed files.
   - Synthesize into a high-level narrative focused on _functionality_ and _architecture_ — what new capability does this give the system, or what problem does it fix?
   - **Strict constraints (high-level only):**
     - **NO** specific file paths, line numbers, or variable/function names (unless they are core domain concepts).
     - **NO** implementation details (e.g., "Added a for loop").
     - **YES** conceptual descriptions (e.g., "Updated the workflow engine to handle concurrent outcomes").
   - Group findings under thematic headings (e.g., **Feature Addition**, **Refactoring**, **Bug Fix**, **Architecture**) using bullet points.
   - This content will populate the **Changes Made** section.

4. **Prepare PR Content**
   - **Title**: Format as `[<Task ID>] <Task Name>` (e.g., `[869e0g5k8] AAS Tests`).
   - **Body**: Fill out the template at `.github/PULL_REQUEST_TEMPLATE.md`:
     - **Task ID**: Insert the ClickUp task ID.
     - **Task Link**: Insert the ClickUp URL `[ClickUp Task Link](...)`.
     - **Description**: Provide a brief summary of the _goal_ of the PR (can derive from ClickUp task description or the nature of changes).
     - **Changes Made**: Insert the summary generated in Step 3.
     - **Steps to test**: If any of changes are possible to test on deployed environment (e.g. UI/UX changes) then describe exact steps on how to test, otherwise set it to "non-testable".
     - Do NOT include section: 'Checklist', 'Testing'.
     - Do NOT include any mentions like: 'Made with Cursor'.

5. **Create Pull Request**
   - New Pull Request should be created with target into `develop` branch so always use `--base develop` flag for `gh pr create` command!
   - If commiting staged changes do not include --trailer flag!
   - Run `gh pr create --base develop --title "<Title>" --body "<Body>"`
   - If the branch is not pushed, push it first with `git push -u origin <branch_name>`.
   - **Important**: Do not create the PR if one already exists for this branch. Check with `gh pr list --head <branch_name>` first.

6. **Update the ClickUp Task**
   - Use `mcp__clickup__clickup_update_task` with the numeric task ID from Step 2.
   - If task in "IN PROGRESS" status change it to "IN REVIEW".
   - **If QA can test the ticket**: Use `mcp__clickup__clickup_create_comment` on the task with a comment that includes:
     - A **Steps to test** heading
     - The exact **Steps to test** content copied from the PR body (Step 4)
     - A link to the created GitHub PR for reference

7. Provide direct link to new Github Pull Request
