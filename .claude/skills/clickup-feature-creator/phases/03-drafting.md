# Phase 3: Drafting

Draft all tickets in a single message so the user can review them together.

## Naming conventions
- EPIC: `[EPIC]: <Concise feature name>`
- Feature: `[<repo-tag>] <Action-oriented description>` — repo-tag matches the codebase (e.g. `[B2B]`, `[B2C]`, `[AIS]`, `[AAS]`)

## EPIC ticket format

```
Name: [EPIC]: <Concise feature name>

## Description
<2–4 sentences of business context: what are we building, why it matters, expected impact.>

## Breakdown
<One sentence per Feature ticket summarising the work and its order/dependencies.>
```

## Feature ticket format

```
Name: [<repo-tag>] <Action-oriented title>

## Description
<2–3 sentences. What does this ticket deliver? Be specific about technical scope.>

## Acceptance Criteria
- [ ] <Specific, testable criterion — happy path>
- [ ] <Edge case or error state>
- [ ] <UI state / API contract / data validation — as relevant>
(5–8 items; fewer than 3 is underspecified, more than 12 is over-specified)

## AI Context
<Guidance for an AI coding agent picking this up cold. Use only real paths found during discovery.>
- Relevant files/directories to read first
- Existing pattern to follow, with file path (e.g. "follow the schema in `convex/schemas/workflows.ts`")
- Related ticket IDs this depends on or builds upon
- Non-obvious gotchas or constraints
```

## Acceptance Criteria rules
- Each item must be independently verifiable from the code
- Backend tickets: name specific tables, mutations, queries, indexes
- Frontend tickets: name specific UI states, interactions, responsive behaviour
- Integration tickets: cover error handling, retries, data validation

## AI Context rules
- Every reference must be a real file path found during codebase exploration
- Never write generic advice like "follow existing patterns" — name the pattern file
- Cross-reference related ticket IDs once they exist (added in Phase 4, Step 4, after all tickets are created)

## Done

Present all drafts to the user and ask:
> Any descriptions unclear? Acceptance criteria missing? AI Context to adjust? Ready to create?

Once confirmed, read `phases/04-creation.md` and proceed.
