# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Runtime is Bun (`>= 1.3.0`), not Node. Run everything from the repo root.

```bash
bun install                                   # install workspace deps
bun run dev:cli                               # run the TUI in watch mode (packages/cli/src/index.tsx)
bun run dev:server                            # run the Hono API on :3000 with hot reload
bun run typecheck                             # tsc --noEmit in every package
bun run test                                  # bun:test suites in packages/, scripts/ and .claude/hooks/ (plain `bun test` skips .claude/)
bun run check                                 # typecheck + tests — what CI and the Stop hook run
bun run --cwd packages/database db:generate   # generate the Prisma client into packages/database/generated (git-ignored)
bun run --cwd packages/database db:migrate    # create/apply a migration after editing schema.prisma (gated, see below)
bun run --cwd packages/database db:deploy     # apply existing migrations (gated, see below)
```

- Tests cover the local-tool sandbox and PLAN-mode gating (`packages/cli/src/lib/*.test.ts`), the approval-gate hook and the CI drift detector. There is **no linter or formatter**, and nothing tests the TUI. Add a test next to any pure logic you change.
- `.github/workflows/ci.yml` runs `typecheck` and `bun run test` on every PR.
- The app is a TUI and needs a real TTY. `bun run dev:cli` will not work in a piped/CI shell, so it can't be exercised from Claude Code's Bash tool; UI changes have to be verified by the user running it in a terminal.
- Env vars live in the root `.env` (`cp .env.example .env`). `DATABASE_URL`, the Clerk keys and `POLAR_ACCESS_TOKEN` are required by the server; the CLI reads `API_URL`, `CLERK_FRONTEND_API`/`CLERK_OAUTH_CLIENT_ID` (for `/login`) and `SENTRY_DSN`. The README's Configuration table lists every variable. The database package loads the root `.env` by absolute path, so it works from any cwd.
- The Prisma client must be generated (`db:generate`) before `typecheck` or the server will work on a fresh clone.
- The server can be exercised from Bash: `bun run dev:server` in the background, then `curl localhost:3000/health`.

## Architecture

Bun workspace monorepo (`workspaces: ["packages/*"]`). Shared compiler options live in `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); package tsconfigs extend it (the CLI adds the JSX settings). Packages export their TypeScript sources directly (`exports` → `./src/index.ts`), there is no build step.

- `packages/cli` (`@nightcode/cli`) — the OpenTUI app.
- `packages/server` (`@nightcode/server`) — Hono API. `src/index.ts` checks the DB connection at startup and exits with code 1 and a readable message if it fails; routes are `/health` (200 / 503 depending on DB), `/sessions` (list, get by id, create, delete), `/chat` (streams AI SDK UI messages), `/auth` (Clerk OAuth callback) and `/billing` (Polar checkout/portal). `/sessions` and `/chat` require a Clerk OAuth token and are scoped to its user. It exports `AppType` for the typed client.
- `packages/shared` (`@nightcode/shared`) — supported chat models, modes and the tool contracts (input schemas, `isReadOnlyTool`), imported by both CLI and server. Put cross-package types here instead of redefining them.
- `packages/database` (`@nightcode/database`) — Prisma 7 with the `pg` driver adapter. `prisma/schema.prisma` + `prisma/migrations`; the root export is the generated types only (safe to import without `DATABASE_URL`); `db` and `checkDatabaseConnection` come from `@nightcode/database/client`. A session's message history is stored as a JSON column (`Session.messages`); there is no separate messages table.

### CLI ↔ server

`cli/src/lib/api-client.ts` builds a Hono RPC client (`hc<AppType>`) — the CLI imports only the **type** from `@nightcode/server`, so no server code runs in the CLI. Request/response types flow from the route definitions, so chain routes (`new Hono().get(...).post(...)`) to keep them inferable. `lib/http-errors.ts` turns `{error}` responses into messages for toasts. The `NewSession` screen creates a session via `POST /sessions` and navigates to `/sessions/:id` with it in router state; `Session` uses that prefetched data or fetches it.

**Rendering is OpenTUI, not React DOM or Ink.** `tsconfig` sets `jsxImportSource: "@opentui/react"`, so JSX tags like `<box>`, `<text>`, `<scrollbox>`, `<textarea>` and `<ascii-font>` are OpenTUI renderables with terminal layout props (flexbox-style, sizes in cells). `src/index.tsx` creates the renderer with `createCliRenderer({ exitOnCtrlC: false })`, so **Ctrl+C does not quit** — the only exit path is the `/exit` command, which calls `renderer.destroy()`.

### Input bar and slash-command menu

The interesting flow spans `components/input-bar.tsx` and `components/command-menu/`:

- `InputBar` owns an **uncontrolled** `<textarea>` (accessed via ref, not React state). It reports edits through `onContentChange` to `useCommandMenu`, which mirrors the text into state and decides whether the menu is open (text starting with `/`) and what the query is.
- `useCommandMenu` also owns the menu's keyboard handling (`useKeyboard`: up/down/escape while open) and scroll syncing with the `<scrollbox>`. `CommandMenu` itself is presentational; it re-filters via `getFilteredCommands` (prefix match on `name` against the `COMMANDS` list in `commands.tsx`).
- Enter is bound to the textarea's `submit` action (Shift+Enter → newline). `textarea.onSubmit` is assigned **once** in a `useEffect`, so it calls through `onSubmitRef.current`, which is reassigned on every render. Keep that ref indirection — otherwise submit handlers go stale. Depending on `showCommandMenu`, it either executes the selected command or submits the text.
- Running a command (`handleCommand`): clear the textarea, then either call `command.action(ctx)` or, if the command has no `action`, insert `command.value + " "` so the user can type arguments. `CommandContext` (`types.ts`) is the capability object handed to actions (`exit`, `toast`, `dialog`, `navigate`, `mode`/`setMode`, `setModel`). New capabilities must be added to that type **and** supplied in `InputBar.handleCommand`.

To add a slash command: add an entry to `COMMANDS`. `CommandMenu` sizes its name column from the longest command name automatically.

### Current state

Chat streams from Anthropic/OpenAI models through the AI SDK. Agent tools are declared on the server without `execute` and run in the CLI (`cli/src/lib/local-tools.ts`, called from `hooks/use-chat.ts`); tools that change local state wait for the user's approval in a dialog. Users log in with Clerk (`/login`), sessions are scoped to the user, and usage is billed in credits through the Polar sandbox. Every command in `COMMANDS` has an `action`.

## Verifying your work

- Run `bun run check` before reporting any task complete, and paste its output. It must end with `0 fail` and every package's typecheck must exit with code 0.
- If a test fails, fix the code, not the test. Never skip, delete or loosen a failing test to get green.
- The Stop hook (`.claude/hooks/verify-on-stop.sh`) re-runs `bun run check` when files under `packages/` changed and blocks finishing while it fails. If it keeps failing, report the failure to the user instead of retrying.
- UI changes still need the user to run `bun run dev:cli` in a real terminal. Say so rather than claiming they were verified.

## Approval gates

`.claude/hooks/approval-gate.sh` runs before every Bash, Edit and Write call (the list lives in `intent/tool-sandbox-verification/gates.md`):
- **Blocked:** DB migrations/deploys unless `RELEASE_APPROVAL` is set; `git push` to `main`; force and mirror pushes; `git reset --hard origin/…`.
- **Asks the user:** edits to `.github/workflows/`, `.claude/settings.json`, `.claude/hooks/` and existing Prisma migrations, whether through Edit/Write or a shell command that writes there.
- The gates match command text, so a command whose heredoc only *mentions* `git push … +x` can be blocked. Don't work around it; run it differently or ask the user.

When a gate blocks, tell the user the reason and the route to approval it printed. Do not try to work around it.

## Things Claude gets wrong

- Path containment: compare the first segment of `relative(root, target)` (`rel === ".." || rel.startsWith("../")`). Never use `rel.startsWith("..")`, which rejects names like `..cache` (fixed in 128ddda and covered by `local-tools.test.ts`).

## Changes start as intent

Non-trivial changes go through `intent/<slug>/`: first `intent.md` (`write-intent` skill), then `spec.md`, then `plan.md`, then the PR. A human accepts each step. See `intent/README.md`. CI drift and repeat review findings come back the same way, as new intents.
