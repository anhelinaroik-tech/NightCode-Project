# Phase 1: Discovery

Run codebase and ClickUp workspace discovery in parallel before writing any ticket content.

## Codebase exploration

Explore the project directory to understand:

- **Tech stack** — `package.json`
- **Directory structure** — where schemas, components, services, and utilities live, it is described in CLAUDE.md
- **Naming conventions** — files, functions, modules
- **Existing patterns** — how similar features are implemented (schemas, API routes, UI components)
- **What already exists** — if parts of the requested feature are already implemented, scope tickets only around the gap

This context feeds directly into the AI Context sections of Feature tickets.

## ClickUp workspace discovery

1. Call `clickup_get_workspace_hierarchy` to find the relevant space, folder, and list. Usually that is Development List
2. Ask the user which list to create tickets in if not obvious
3. Call `clickup_get_custom_fields` on the target list and record:
   - **Task Type** field ID + option IDs for "Epic" and "Feature"
   - **Repo** field ID + option values (if present)

Store these IDs — you'll need them in Phase 4.

## Done

Once you have the codebase context and ClickUp field IDs, read `phases/02-planning.md` and proceed.
