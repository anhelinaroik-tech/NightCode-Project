import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Mode } from "@nightcode/shared";
import { executeLocalTool, isInside } from "./local-tools";

describe("isInside", () => {
  const root = resolve("/project");

  test.each(["foo", "foo/bar.ts", "..cache", "..cache/x", "a/../b", "."])("%s is inside", (path) => {
    expect(isInside(root, resolve(root, path))).toBe(true);
  });

  test.each(["..", "../x", "../project-other", "foo/../../x"])("%s is outside", (path) => {
    expect(isInside(root, resolve(root, path))).toBe(false);
  });

  test("an unrelated absolute path is outside", () => {
    expect(isInside(root, resolve("/etc/passwd"))).toBe(false);
  });
});

// executeLocalTool resolves paths against process.cwd(), so run it inside a throwaway project
describe("executeLocalTool sandbox", () => {
  const originalCwd = process.cwd();
  let base: string;
  let project: string;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "nightcode-tools-")));
    project = join(base, "project");
    await mkdir(join(project, "..cache"), { recursive: true });
    await writeFile(join(project, "hello.txt"), "hello");
    await writeFile(join(project, "..cache", "entry.txt"), "cached");
    await writeFile(join(base, "secret.txt"), "secret");
    await symlink(base, join(project, "escape"));
    process.chdir(project);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(base, { recursive: true, force: true });
  });

  test("reads a file inside the project", async () => {
    expect(await executeLocalTool("readFile", { path: "hello.txt" }, Mode.BUILD)).toEqual({ content: "hello" });
  });

  test("reads names that start with .. but stay inside", async () => {
    expect(await executeLocalTool("readFile", { path: "..cache/entry.txt" }, Mode.BUILD)).toEqual({
      content: "cached",
    });
  });

  test("rejects a ../ path", async () => {
    await expect(executeLocalTool("readFile", { path: "../secret.txt" }, Mode.BUILD)).rejects.toThrow(
      "outside the project directory"
    );
  });

  test("rejects an absolute path outside the project", async () => {
    await expect(executeLocalTool("readFile", { path: join(base, "secret.txt") }, Mode.BUILD)).rejects.toThrow(
      "outside the project directory"
    );
  });

  test("rejects a symlink that points out of the project", async () => {
    await expect(executeLocalTool("readFile", { path: "escape/secret.txt" }, Mode.BUILD)).rejects.toThrow(
      "outside the project directory"
    );
  });

  test("rejects writing through a symlink out of the project", async () => {
    await expect(
      executeLocalTool("writeFile", { path: "escape/new.txt", content: "x" }, Mode.BUILD)
    ).rejects.toThrow("outside the project directory");
  });

  test("writes and reads back inside the project in BUILD mode", async () => {
    await executeLocalTool("writeFile", { path: "out/new.txt", content: "written" }, Mode.BUILD);
    expect(await executeLocalTool("readFile", { path: "out/new.txt" }, Mode.BUILD)).toEqual({ content: "written" });
  });

  test.each([
    ["writeFile", { path: "plan.txt", content: "x" }],
    ["editFile", { path: "hello.txt", oldString: "hello", newString: "bye" }],
    ["bash", { command: "echo hi" }],
  ])("PLAN mode rejects %s", async (toolName, input) => {
    await expect(executeLocalTool(toolName, input, Mode.PLAN)).rejects.toThrow("not available in PLAN mode");
  });

  test("PLAN mode still allows readFile", async () => {
    expect(await executeLocalTool("readFile", { path: "hello.txt" }, Mode.PLAN)).toEqual({ content: "hello" });
  });
});
