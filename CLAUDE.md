# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Runtime is Bun (`>= 1.3.0`), not Node. Run everything from the repo root.

```bash
bun install                                   # install workspace deps
bun run dev:cli                               # run the TUI in watch mode (packages/cli/src/index.tsx)
bun run dev:server                            # run the Hono API on :3000 with hot reload
bun run typecheck                             # tsc --noEmit in every package — the only automated check
bun run --cwd packages/database db:generate   # generate the Prisma client into packages/database/generated (git-ignored)
bun run --cwd packages/database db:migrate    # create/apply a migration after editing schema.prisma
bun run --cwd packages/database db:deploy     # apply existing migrations
```

- There is **no test runner, linter or formatter** configured. `typecheck` is the only verification available, and it cannot catch runtime/UI behaviour.
- The app is a TUI and needs a real TTY. `bun run dev:cli` will not work in a piped/CI shell, so it can't be exercised from Claude Code's Bash tool; UI changes have to be verified by the user running it in a terminal.
- Env vars live in the root `.env` (`cp .env.example .env`). `DATABASE_URL` is required by the server and Prisma CLI; the CLI reads optional `API_URL`. The database package loads the root `.env` by absolute path, so it works from any cwd.
- The Prisma client must be generated (`db:generate`) before `typecheck` or the server will work on a fresh clone.
- The server can be exercised from Bash: `bun run dev:server` in the background, then `curl localhost:3000/health`.

## Architecture

Bun workspace monorepo (`workspaces: ["packages/*"]`). Shared compiler options live in `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); package tsconfigs extend it (the CLI adds the JSX settings). Packages export their TypeScript sources directly (`exports` → `./src/index.ts`), there is no build step.

- `packages/cli` (`@nightcode/cli`) — the OpenTUI app.
- `packages/server` (`@nightcode/server`) — Hono API. `src/index.ts` checks the DB connection at startup and exits with code 1 and a readable message if it fails; routes are `/health` (200 / 503 depending on DB) and `/sessions` (list, get by id, create). It exports `AppType` for the typed client.
- `packages/shared` (`@nightcode/shared`) — supported chat models and Zod schemas for message parts / stream events, imported by both CLI and server. Put cross-package types here instead of redefining them.
- `packages/database` (`@nightcode/database`) — Prisma 7 with the `pg` driver adapter. `prisma/schema.prisma` + `prisma/migrations`; exports `db`, `checkDatabaseConnection` and the generated types, and enums via `@nightcode/database/enums`.

### CLI ↔ server

`cli/src/lib/api-client.ts` builds a Hono RPC client (`hc<AppType>`) — the CLI imports only the **type** from `@nightcode/server`, so no server code runs in the CLI. Request/response types flow from the route definitions, so chain routes (`new Hono().get(...).post(...)`) to keep them inferable. `lib/http-errors.ts` turns `{error}` responses into messages for toasts. The `NewSession` screen creates a session via `POST /sessions` and navigates to `/sessions/:id` with it in router state; `Session` uses that prefetched data or fetches it.

**Rendering is OpenTUI, not React DOM or Ink.** `tsconfig` sets `jsxImportSource: "@opentui/react"`, so JSX tags like `<box>`, `<text>`, `<scrollbox>`, `<textarea>` and `<ascii-font>` are OpenTUI renderables with terminal layout props (flexbox-style, sizes in cells). `src/index.tsx` creates the renderer with `createCliRenderer({ exitOnCtrlC: false })`, so **Ctrl+C does not quit** — the only exit path is the `/exit` command, which calls `renderer.destroy()`.

### Input bar and slash-command menu

The interesting flow spans `components/input-bar.tsx` and `components/command-menu/`:

- `InputBar` owns an **uncontrolled** `<textarea>` (accessed via ref, not React state). It reports edits through `onContentChange` to `useCommandMenu`, which mirrors the text into state and decides whether the menu is open (text starting with `/`) and what the query is.
- `useCommandMenu` also owns the menu's keyboard handling (`useKeyboard`: up/down/escape while open) and scroll syncing with the `<scrollbox>`. `CommandMenu` itself is presentational; it re-filters via `getFilteredCommands` (prefix match on `name` against the `COMMANDS` list in `commands.tsx`).
- Enter is bound to the textarea's `submit` action (Shift+Enter → newline). `textarea.onSubmit` is assigned **once** in a `useEffect`, so it calls through `onSubmitRef.current`, which is reassigned on every render. Keep that ref indirection — otherwise submit handlers go stale. Depending on `showCommandMenu`, it either executes the selected command or submits the text.
- Running a command (`handleCommand`): clear the textarea, then either call `command.action(ctx)` or, if the command has no `action`, insert `command.value + " "` so the user can type arguments. `CommandContext` (`types.ts`) is the capability object handed to actions; today it only has `exit`. New capabilities must be added to that type **and** supplied in `InputBar.handleCommand`.

To add a slash command: add an entry to `COMMANDS`. `CommandMenu` sizes its name column from the longest command name automatically.

### Current state

Sessions and messages persist in Postgres, but there is no model integration or auth yet: sessions are created with a hardcoded `userId: "mock-user"`, `StatusBar` shows a hardcoded mode/model, and every command in `COMMANDS` except `/exit` is a placeholder with no `action`.
