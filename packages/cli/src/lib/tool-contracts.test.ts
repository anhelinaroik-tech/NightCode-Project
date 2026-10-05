import { describe, expect, test } from "bun:test";
import { getToolContracts, isReadOnlyTool, Mode } from "@nightcode/shared";

const READ_ONLY = ["readFile", "listDirectory", "glob", "grep"];
const WRITE = ["writeFile", "editFile", "bash"];

describe("tool contracts", () => {
  test.each(READ_ONLY)("%s is read-only", (name) => {
    expect(isReadOnlyTool(name)).toBe(true);
  });

  test.each([...WRITE, "unknownTool"])("%s is not read-only", (name) => {
    expect(isReadOnlyTool(name)).toBe(false);
  });

  test("PLAN mode exposes only read-only tools", () => {
    expect(Object.keys(getToolContracts(Mode.PLAN)).sort()).toEqual([...READ_ONLY].sort());
  });

  test("BUILD mode exposes read and write tools", () => {
    expect(Object.keys(getToolContracts(Mode.BUILD)).sort()).toEqual([...READ_ONLY, ...WRITE].sort());
  });
});
