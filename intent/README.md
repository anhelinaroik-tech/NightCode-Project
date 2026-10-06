# Intent home

Every change starts here as a proto-spec (Stage 1 of the AI-Native SDLC Playbook), before any code.
Each change gets its own folder, `intent/<slug>/`, and its artifacts are committed in order:

| File | Stage | Who writes it | Who approves it |
|---|---|---|---|
| `intent.md` | Plan | the originator, brainstorming with Claude (`write-intent` skill) | the product owner, before it is committed |
| `spec.md` | Design | Claude, from `intent.md` | the product owner; higher-risk changes also need a tech lead |
| `plan.md` | Build | Claude in plan mode | the engineer who accepts the plan |
| PR | Build/Test | Claude + engineer | a human code owner (CI and AI review only report) |

Incidents and CI drift (Stage 6: Maintain) enter the same way, as a new `intent/<slug>/intent.md`.

**Source of truth:** the ClickUp task is the work item. Each artifact names its ClickUp ID, and the ClickUp task links back to the commit or PR.

## Template

```markdown
# Intent: <short name>
Author: <name> (<role>). Status: draft | accepted | closed. ClickUp: <task id>. Date: <YYYY-MM-DD>.

## Problem
What cannot be done today, who is affected, and the evidence.

## Proposed outcome
What better looks like, in the originator's words.

## Affected users and systems
People, packages and services touched.

## Constraints
What must not change, and the limits on how it is done.

## Acceptance conditions
Observable checks that say the outcome was reached.

## Open questions
Anything undecided, with who decides it.
```
