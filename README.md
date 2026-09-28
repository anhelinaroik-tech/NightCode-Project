# NightCode

An AI coding agent for the terminal, inspired by Claude Code — built from scratch with [Bun](https://bun.sh), React and [OpenTUI](https://github.com/sst/opentui).

## Roadmap

Built following [this video tutorial](https://www.youtube.com/watch?v=k_D_C3ExypU), one chapter at a time. Each chapter is developed on its own branch and merged into `main` through a pull request.

- [x] Project Setup
- [ ] UI Infrastructure — in progress
- [ ] Routing & Screen Layout
- [ ] Server, Shared Package & Database
- [ ] Sentry Monitoring
- [ ] AI Chat Streaming
- [ ] Session Management
- [ ] Tool Calling
- [ ] Completing The User Experience
- [ ] Usage Based Billing
- [ ] Client-Side Tool Execution

## Requirements

- [Bun](https://bun.sh) `>= 1.3.0`
- A terminal that supports TUI apps (run it in a real terminal, not a piped/CI shell)

## Setup

```bash
git clone https://github.com/anhelinaroik-tech/NightCode-Project.git
cd NightCode-Project
bun install
```

Copy the example configuration and fill in your own values (see [Configuration](#configuration)):

```bash
cp .env.example .env
```

## Run

From the repository root:

```bash
bun run dev
```

This starts `packages/cli/src/index.tsx` in watch mode, so the app restarts when you edit a file.

## Checks

Type-check the CLI package:

```bash
bun run --cwd packages/cli typecheck
```

## Configuration

Configuration is read from environment variables. `.env.example` lists every variable with a placeholder value and is safe to commit. Your real `.env` is git-ignored — never commit it or put real secrets in `.env.example`.

## Project structure

```
packages/cli/src/
├── index.tsx            # app entry point
└── components/
    ├── command-menu/    # slash-command menu (list, filtering, keyboard hook)
    ├── header.tsx
    ├── input-bar.tsx
    ├── status-bar.tsx
    └── border.tsx
```
