# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Runtime is Bun (`>= 1.3.0`), not Node. Run everything from the repo root.

```bash
bun install                                # install workspace deps
bun run dev                                # run the TUI in watch mode (packages/cli/src/index.tsx)
bun run --cwd packages/cli typecheck       # tsc --noEmit — the only automated check
```

- There is **no test runner, linter or formatter** configured. `typecheck` is the only verification available, and it cannot catch runtime/UI behaviour.
- The app is a TUI and needs a real TTY. `bun run dev` will not work in a piped/CI shell, so it can't be exercised from Claude Code's Bash tool; UI changes have to be verified by the user running it in a terminal.
- `cp .env.example .env` is for later use only — nothing reads environment variables yet.

## Architecture

Bun workspace monorepo (`workspaces: ["packages/*"]`) with a single package, `packages/cli` (`@nightcode/cli`). Shared compiler options live in `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); the package tsconfig only adds the JSX settings.

**Rendering is OpenTUI, not React DOM or Ink.** `tsconfig` sets `jsxImportSource: "@opentui/react"`, so JSX tags like `<box>`, `<text>`, `<scrollbox>`, `<textarea>` and `<ascii-font>` are OpenTUI renderables with terminal layout props (flexbox-style, sizes in cells). `src/index.tsx` creates the renderer with `createCliRenderer({ exitOnCtrlC: false })`, so **Ctrl+C does not quit** — the only exit path is the `/exit` command, which calls `renderer.destroy()`.

### Input bar and slash-command menu

The interesting flow spans `components/input-bar.tsx` and `components/command-menu/`:

- `InputBar` owns an **uncontrolled** `<textarea>` (accessed via ref, not React state). It reports edits through `onContentChange` to `useCommandMenu`, which mirrors the text into state and decides whether the menu is open (text starting with `/`) and what the query is.
- `useCommandMenu` also owns the menu's keyboard handling (`useKeyboard`: up/down/escape while open) and scroll syncing with the `<scrollbox>`. `CommandMenu` itself is presentational; it re-filters via `getFilteredCommands` (prefix match on `name` against the `COMMANDS` list in `commands.tsx`).
- Enter is bound to the textarea's `submit` action (Shift+Enter → newline). `textarea.onSubmit` is assigned **once** in a `useEffect`, so it calls through `onSubmitRef.current`, which is reassigned on every render. Keep that ref indirection — otherwise submit handlers go stale. Depending on `showCommandMenu`, it either executes the selected command or submits the text.
- Running a command (`handleCommand`): clear the textarea, then either call `command.action(ctx)` or, if the command has no `action`, insert `command.value + " "` so the user can type arguments. `CommandContext` (`types.ts`) is the capability object handed to actions; today it only has `exit`. New capabilities must be added to that type **and** supplied in `InputBar.handleCommand`.

To add a slash command: add an entry to `COMMANDS`. `CommandMenu` sizes its name column from the longest command name automatically.

### Current state

This is a UI shell. `App` passes a no-op `onSubmit`, `StatusBar` shows a hardcoded mode/model, and every command in `COMMANDS` except `/exit` is a placeholder with no `action`. There is no model/API integration or auth yet, despite `ANTHROPIC_API_KEY` in `.env.example`.
