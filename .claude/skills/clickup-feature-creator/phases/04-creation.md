# Phase 4: Creation

Create tickets in this exact order: EPIC → Features → dependencies.

## Step 1: Create the EPIC

Call `clickup_create_task` with:
- `name`: `[EPIC]: ...`
- `list_id`: target list from Phase 1
- `markdown_description`: EPIC description (use `markdown_description`, not `description`)
- `priority`: as discussed, default `"high"`
- `custom_fields`: Task Type → Epic option ID; Repo field if applicable

Save the returned task ID as `EPIC_ID`.

## Step 2: Create each Feature ticket

For each Feature, call `clickup_create_task` with:
- `name`: `[<repo-tag>] ...`
- `list_id`: same list
- `markdown_description`: full ticket content with `## Description`, `## Acceptance Criteria`, `## AI Context` sections
- `priority`: as discussed
- `custom_fields`: Task Type → Feature option ID; Repo field if applicable

Save each returned task ID.

## Step 3: Set dependencies

For each Feature ticket, call `clickup_add_task_dependency`:
- `task_id`: `EPIC_ID`
- `depends_on`: Feature task ID
- `type`: `"waiting_on"`

This marks the EPIC as blocked until all Features are complete.

## Step 4: Confirm

Present a summary:
- EPIC name + URL
- Each Feature name + URL
- "All dependencies set" confirmation
