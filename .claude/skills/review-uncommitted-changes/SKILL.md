---
name: review-uncommitted-changes
description: Review uncommitted git changes against a quality checklist (functionality, code quality, security). Use when asked to review local changes, check what's ready to commit, or audit unstaged/staged diffs. Ends with a Commit Readiness score 0-10.
---

## Step 1: Identify Uncommitted Changes

- Run `git diff --name-only` (unstaged) and `git diff --cached --name-only` (staged) to find changed files.
- If no files are changed, stop and inform me.
- For each changed file, run `git diff [filename]` and `git diff --cached [filename]` to get the specific additions/deletions.

## Step 2: Apply Review Checklist

Review only the lines modified in the diff against these criteria:

### Functionality

- [ ] Code does what it's supposed to do
- [ ] Edge cases are handled
- [ ] Error handling is appropriate
- [ ] No obvious bugs or logic errors

### Code Quality

- [ ] Code is readable and well-structured
- [ ] Functions are small and focused
- [ ] Variable names are descriptive
- [ ] No code duplication
- [ ] Follows project conventions

### Security

- [ ] No obvious security vulnerabilities
- [ ] Input validation is present
- [ ] Sensitive data is handled properly
- [ ] No hardcoded secrets

## Step 3: Report

Provide a concise summary of issues found in the diff.
End with a "Commit Readiness" score (0-10).
