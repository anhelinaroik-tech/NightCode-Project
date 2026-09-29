---
name: fix-uncommitted-changes
description: Address issues identified by the most recent /review-uncommitted-changes run. Reads the prior review findings from conversation context and applies or suggests code corrections for each flagged item. Use after running /review-uncommitted-changes to act on its findings.
---

## Step 1: Analyze Review Context

- Read the previous chat history to identify the "Issues" or "Needs Changes" points raised by the `/review-uncommitted-changes` command.
- Focus specifically on the uncommitted changes in the current branch.

## Step 2: Implementation

- For each identified issue, suggest or apply the necessary code corrections.
- Ensure the fixes align with the project's existing style and the `/review-uncommitted-changes` checklist criteria.
- If a fix is ambiguous, provide the most optimized version and explain why.

## Step 3: Verification

- Once the code is updated, briefly explain how each review point was addressed.
- Suggest running `/review-uncommitted-changes` one last time to confirm all items are now checked off.

## Output

- If you changed code: "I have applied fixes for the following review points: [List of points]"
- If you only suggested fixes: "I suggest the following fixes (not yet applied): [List of points]"
- Followed by the code blocks or file updates.
