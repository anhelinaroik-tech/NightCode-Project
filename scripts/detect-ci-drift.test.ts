import { describe, expect, test } from "bun:test";
import { join } from "path";
import { classify, draftIntent, isoWeek, weeklyFailureRate, type Bands, type Run, type WeekPoint } from "./detect-ci-drift";

const bands = Bun.YAML.parse(await Bun.file(join(import.meta.dir, "../intent/bands.yaml")).text()) as Bands;

// A steady ~10% failure rate, then the week under test (the band comes from the weeks before the last 3)
const BASELINE = [0.1, 0.12, 0.08, 0.1, 0.11, 0.09, 0.1, 0.1];
const weeks = (rates: number[]): WeekPoint[] =>
  rates.map((rate, i) => ({ week: `2026-W${String(i + 1).padStart(2, "0")}`, runs: 100, failed: rate * 100, rate }));

describe("classify", () => {
  test("too little history is insufficient data", () => {
    expect(classify(weeks([0.1, 0.5, 0.9]), bands)).toEqual({ status: "insufficient_data", points: 3, required: 6 });
  });

  test.each([
    [0.1, "ok", "none"],
    [0.16, "1sigma", "log"],
    [0.22, "2sigma", "diagnose"],
    [0.3, "3sigma", "propose"],
  ])("latest rate %d is %s → %s", (latest, tier, action) => {
    expect(classify(weeks([...BASELINE, latest]), bands)).toMatchObject({ status: "evaluated", tier, action });
  });

  test("a falling failure rate is never a breach", () => {
    expect(classify(weeks([...BASELINE, 0]), bands)).toMatchObject({ tier: "ok" });
  });

  test("Western Electric rule 2: two of the last three beyond 2 sigma", () => {
    const result = classify(weeks([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.25, 0.25, 0.12]), bands);
    expect(result).toMatchObject({ tier: "2sigma", action: "diagnose" });
    expect(result.status === "evaluated" && result.rule).toContain("WE2");
  });

  test("sigma has a floor so a flat baseline doesn't page on noise", () => {
    expect(classify(weeks([0, 0, 0, 0, 0, 0, 0, 0, 0.04]), bands)).toMatchObject({ tier: "ok", sigma: 0.05 });
  });
});

describe("weeklyFailureRate", () => {
  test("groups by ISO week and ignores cancelled and unfinished runs", () => {
    const runs: Run[] = [
      { status: "completed", conclusion: "success", createdAt: "2026-09-28T10:00:00Z" },
      { status: "completed", conclusion: "failure", createdAt: "2026-09-29T10:00:00Z" },
      { status: "completed", conclusion: "cancelled", createdAt: "2026-09-29T11:00:00Z" },
      { status: "in_progress", conclusion: "", createdAt: "2026-09-30T10:00:00Z" },
      { status: "completed", conclusion: "success", createdAt: "2026-10-05T10:00:00Z" },
    ];
    expect(weeklyFailureRate(runs, new Date("2026-10-12T06:00:00Z"))).toEqual([
      { week: "2026-W40", runs: 2, failed: 1, rate: 0.5 },
      { week: "2026-W41", runs: 1, failed: 0, rate: 0 },
    ]);
  });

  test("leaves out the unfinished current week", () => {
    const runs: Run[] = [
      { status: "completed", conclusion: "success", createdAt: "2026-10-05T10:00:00Z" },
      { status: "completed", conclusion: "failure", createdAt: "2026-10-12T05:00:00Z" },
    ];
    expect(weeklyFailureRate(runs, new Date("2026-10-12T06:00:00Z"))).toEqual([
      { week: "2026-W41", runs: 1, failed: 0, rate: 0 },
    ]);
  });

  test("ISO weeks roll over the year correctly", () => {
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });
});

test("a breach drafts an intent.md in the Stage 1 format", () => {
  const result = classify(weeks([...BASELINE, 0.3]), bands);
  if (result.status !== "evaluated") throw new Error("expected an evaluated result");
  const intent = draftIntent(result, "2026-10-05");
  for (const heading of ["# Intent:", "## Problem", "## Proposed outcome", "## Affected users and systems", "## Constraints", "## Acceptance conditions", "## Open questions"]) {
    expect(intent).toContain(heading);
  }
  expect(intent).toContain("Tier: 3sigma → propose");
});
