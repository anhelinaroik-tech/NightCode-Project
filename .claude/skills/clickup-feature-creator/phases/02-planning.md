# Phase 2: Planning

## Understand the feature

Ask the user to describe what they want to build. Capture:
- **Business goal** — what problem does this solve? Who benefits?
- **Scope boundaries** — what's in and out of scope?
- **Technical constraints** — integrations, existing systems, performance requirements
- **Priority** — does this block other work?

If the description is vague, ask follow-up questions. If you must make assumptions, list them explicitly so the user can correct them before tickets are written.

## Propose the breakdown

Present a numbered list — short names with one-line descriptions:

> Here's how I'd break this down:
>
> 1. **Define data model for X** — new tables/schemas for ...
> 2. **Build backend mutations for Y** — CRUD operations and validation ...
> 3. **Create UI component for Z** — form/page/panel that ...
> 4. **Integrate with external service** — API client and webhook handling ...
>
> Does this look right? Want to add, remove, or restructure anything?

Wait for confirmation before drafting full ticket content.

## Breakdown rules
- 5-10 Feature tickets per EPIC 
- Group by technical boundary: schema → backend → frontend → integration
- Each ticket ~1–3 days of work
- Tickets should be independently implementable with minimal cross-dependencies

## Done

Once the breakdown is confirmed, read `phases/03-drafting.md` and proceed.
