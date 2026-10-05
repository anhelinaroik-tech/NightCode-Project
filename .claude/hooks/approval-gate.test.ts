import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const GATE = join(import.meta.dir, "approval-gate.sh");
let project: string;

// A throwaway git repo on a feature branch, so "bare git push" checks and the decision log don't touch this repo
beforeAll(async () => {
  project = await realpath(await mkdtemp(join(tmpdir(), "nightcode-gate-")));
  Bun.spawnSync(["git", "init", "-q", "-b", "feature"], { cwd: project });
  await mkdir(join(project, ".claude"), { recursive: true });
  await mkdir(join(project, "packages/database/prisma/migrations/0001_init"), { recursive: true });
  await writeFile(join(project, "packages/database/prisma/migrations/0001_init/migration.sql"), "-- init");
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

function runGate(input: object, env: Record<string, string> = {}) {
  const { RELEASE_APPROVAL: _, ...baseEnv } = process.env;
  const proc = Bun.spawnSync(["bash", GATE], {
    stdin: new TextEncoder().encode(JSON.stringify({ cwd: project, ...input })),
    env: { ...baseEnv, CLAUDE_PROJECT_DIR: project, ...env },
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const bash = (command: string, env?: Record<string, string>) =>
  runGate({ tool_name: "Bash", tool_input: { command } }, env);
const edit = (file_path: string) => runGate({ tool_name: "Edit", tool_input: { file_path } });

describe("G1 release/DB authorization", () => {
  test.each([
    "bun run --cwd packages/database db:deploy",
    "bun run --cwd packages/database db:migrate",
    "bunx prisma migrate deploy",
    "npx prisma migrate reset --force",
    "bunx prisma db push",
  ])("blocks `%s` without RELEASE_APPROVAL", (command) => {
    const { code, stderr } = bash(command);
    expect(code).toBe(2);
    expect(stderr).toContain("G1");
    expect(stderr).toContain("RELEASE_APPROVAL");
  });

  test("allows it when RELEASE_APPROVAL is set in the session", () => {
    expect(bash("bun run --cwd packages/database db:deploy", { RELEASE_APPROVAL: "869f1am8y" }).code).toBe(0);
  });

  test("still allows db:generate", () => {
    expect(bash("bun run --cwd packages/database db:generate").code).toBe(0);
  });
});

describe("G2 main only through PRs", () => {
  test.each([
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin HEAD:refs/heads/main",
    "git add . && git push origin main",
  ])(
    "blocks `%s`",
    (command) => {
      const { code, stderr } = bash(command);
      expect(code).toBe(2);
      expect(stderr).toContain("G2");
      expect(stderr).toContain("open a PR");
    }
  );

  test.each(["git push -u origin feature", "git push origin feat/main-menu", "git push"])(
    "allows `%s` from a feature branch",
    (command) => {
      expect(bash(command).code).toBe(0);
    }
  );
});

describe("G2 while main is checked out", () => {
  let onMain: string;
  beforeAll(async () => {
    onMain = await realpath(await mkdtemp(join(tmpdir(), "nightcode-gate-main-")));
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: onMain });
  });
  afterAll(async () => {
    await rm(onMain, { recursive: true, force: true });
  });

  test.each(["git push", "git push origin", "git push origin HEAD", "git push -u origin HEAD"])("blocks `%s`", (command) => {
    const proc = Bun.spawnSync(["bash", GATE], {
      stdin: new TextEncoder().encode(JSON.stringify({ tool_name: "Bash", tool_input: { command } })),
      env: { ...process.env, CLAUDE_PROJECT_DIR: onMain },
    });
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("G2");
  });
});

describe("G3 no history rewrites", () => {
  test.each([
    "git push --force origin feature",
    "git push -f",
    "git push --force-with-lease origin feature",
    "git push origin +feature",
    "git reset --hard origin/main",
  ])("blocks `%s`", (command) => {
    const { code, stderr } = bash(command);
    expect(code).toBe(2);
    expect(stderr).toContain("G3");
  });

  test("allows git push --follow-tags", () => {
    expect(bash("git push --follow-tags origin feature").code).toBe(0);
  });
});

describe("G4 protected paths", () => {
  test.each([".github/workflows/ci.yml", ".claude/settings.json", ".claude/hooks/approval-gate.sh"])(
    "asks before editing %s",
    (path) => {
      const { code, stdout } = edit(join(project, path));
      expect(code).toBe(0);
      expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe("ask");
    }
  );

  test("asks before editing an applied migration", () => {
    const { stdout } = edit(join(project, "packages/database/prisma/migrations/0001_init/migration.sql"));
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  });

  test.each(["packages/database/prisma/migrations/0002_new/migration.sql", "packages/cli/src/index.tsx", "README.md"])(
    "allows editing %s",
    (path) => {
      const { code, stdout } = edit(join(project, path));
      expect(code).toBe(0);
      expect(stdout).toBe("");
    }
  );
});

test("everyday commands pass through", () => {
  for (const command of ["bun run check", "git status", "git commit -m 'fix: main menu'", "ls -la"]) {
    expect(bash(command).code).toBe(0);
  }
});

test("blocks and asks are logged with a timestamp", async () => {
  bash("git push origin main");
  const lines = (await Bun.file(join(project, ".claude/gate-log.jsonl")).text()).trim().split("\n");
  const last = JSON.parse(lines.at(-1)!);
  expect(last).toMatchObject({ gate: "G2", decision: "block", tool: "Bash" });
  expect(last.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
