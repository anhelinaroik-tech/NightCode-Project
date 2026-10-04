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

## Tools and permissions

Tools run **on your machine, inside the CLI**, not on the server. The server only tells the model which tools exist (their names and input schemas, shared through `@nightcode/shared`). When the model calls a tool, the CLI runs it in the directory you started `nightcode` from and sends the result back, and the model continues its answer. Which tools are offered depends on the agent mode:

| Tool            | What it can do | PLAN | BUILD | Asks first |
| --------------- | -------------- | :--: | :---: | :--------: |
| `readFile`      | Read a file (first 10,000 characters) | ✓ | ✓ | |
| `listDirectory` | List a directory, skipping hidden entries and `node_modules` | ✓ | ✓ | |
| `glob`          | Find files by pattern (up to 200 results) | ✓ | ✓ | |
| `grep`          | Search file contents by regex (up to 50 matches) | ✓ | ✓ | |
| `writeFile`     | Create or overwrite a file, creating parent directories | | ✓ | ✓ |
| `editFile`      | Replace one exact, unique string in a file | | ✓ | ✓ |
| `bash`          | Run any shell command (30 s default timeout, output truncated to 20,000 characters) | | ✓ | ✓ |

Boundaries:

- **Approval.** Before `writeFile`, `editFile` or `bash` runs, the CLI shows what it will do (the command, the file and its contents, or the edit) and waits. `y`/Enter allows it; `n`, Esc or clicking outside rejects it. A rejection is sent back to the model as a tool error, and the model is told not to retry. Several calls in one step are asked one after another.
- **Read-only tools run without asking.** They can read any file inside the project directory, including files like `.env`, and the content is sent to the model provider.
- **PLAN mode** offers only the read-only tools, and the CLI also refuses to run a changing tool in PLAN mode if the model asks for one anyway.
- Every tool input is validated against its Zod schema before it runs. File tools resolve paths against the project directory and refuse anything outside it.
- Tool failures (bad input, missing file, command errors) are sent back to the model as tool errors, so the conversation continues instead of hanging. The UI shows each call with its input and a short result, or the error in red.
- Pressing Esc during a reply rejects any pending approvals and stops the turn; it does not resubmit tool results.
- **`bash` is not sandboxed.** Once allowed, a command runs with your user's permissions and environment variables, so read the command before approving it. Use PLAN mode for read-only work.

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
├── server/     # @nightcode/server — Hono API (/health, /sessions, /chat)
├── shared/     # @nightcode/shared — models and Zod schemas used by both CLI and server
└── database/   # @nightcode/database — Prisma schema, migrations and the db client
```
