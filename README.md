# NightCode

An AI coding agent for the terminal, inspired by Claude Code — built from scratch with [Bun](https://bun.sh), React and [OpenTUI](https://github.com/sst/opentui).

## Roadmap

Built following [this video tutorial](https://www.youtube.com/watch?v=k_D_C3ExypU), one chapter at a time. Each chapter is developed on its own branch and merged into `main` through a pull request.

- [ ] Project Setup — in review
- [ ] UI Infrastructure — in progress
- [ ] Routing & Screen Layout
- [ ] Server, Shared Package & Database — in review
- [ ] Sentry Monitoring
- [ ] AI Chat Streaming
- [ ] Session Management
- [ ] Tool Calling
- [ ] Completing The User Experience
- [ ] Usage Based Billing
- [ ] Client-Side Tool Execution

## Requirements

- [Bun](https://bun.sh) `>= 1.3.0`
- A PostgreSQL database (a free [Neon](https://neon.tech) project works)
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

## Database

Put your connection string into `DATABASE_URL` in the root `.env`, then generate the Prisma client and apply the migrations:

```bash
bun run --cwd packages/database db:generate   # generate the Prisma client (needed before typecheck/run)
bun run --cwd packages/database db:deploy     # apply prisma/migrations to the database
```

While changing `schema.prisma`, use `bun run --cwd packages/database db:migrate` to create a new migration.

## Run

The CLI talks to the server, so start both, each in its own terminal, from the repository root:

```bash
bun run dev:server   # API server on http://localhost:3000 (hot reload)
bun run dev:cli      # the TUI (watch mode)
```

Check that the server and database are up:

```bash
curl localhost:3000/health   # {"status":"ok","database":"up"}, or 503 if the database is down
```

If the database is unreachable at startup, the server prints `Cannot connect to <host>/<db>: <reason>` and exits with code 1.

## Checks

Type-check every package:

```bash
bun run typecheck
```

## Configuration

Environment variables are read from the root `.env` (copy it from `.env.example`). Your real `.env` is git-ignored — never commit it or put real secrets in `.env.example`.

| Variable       | Used by | Description |
| -------------- | ------- | ----------- |
| `DATABASE_URL` | server, Prisma CLI | PostgreSQL connection string (required) |
| `API_URL`      | CLI     | Server URL, defaults to `http://localhost:3000` |

## Project structure

Bun workspace with four packages:

```
packages/
├── cli/        # @nightcode/cli — the OpenTUI app; calls the server through a typed Hono client
├── server/     # @nightcode/server — Hono API (/health, /sessions)
├── shared/     # @nightcode/shared — models and Zod schemas used by both CLI and server
└── database/   # @nightcode/database — Prisma schema, migrations and the db client
```
