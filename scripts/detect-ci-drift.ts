// Stage 6 (Maintain) control-band check for the CI test failure rate. Deterministic, no model involved.
// Usage: bun scripts/detect-ci-drift.ts [--runs runs.json] [--write-intent]
//   --runs          read `gh run list --json conclusion,createdAt,status` output from a file instead of calling gh
//   --write-intent  on a diagnose/propose breach, write intent/ci-drift-<date>/intent.md (Stage 1 format)
// Prints one JSON line with the result; the ci-drift workflow turns a written intent into a GitHub issue.
import { mkdir } from "fs/promises";
import { join } from "path";

export type Run = { conclusion: string; createdAt: string; status: string };
export type Tier = "ok" | "1sigma" | "2sigma" | "3sigma";
export type Bands = {
  baseline: string;
  min_points: number;
  min_sigma: number;
  tiers: Record<Exclude<Tier, "ok">, { action: string; routes?: string[] }>;
};
export type Result =
  | { status: "insufficient_data"; points: number; required: number }
  | { status: "evaluated"; tier: Tier; action: string; rule: string | null; latest: number; mean: number; sigma: number; z: number; weeks: WeekPoint[] };
export type WeekPoint = { week: string; runs: number; failed: number; rate: number };

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

// ISO week label, e.g. 2026-W40
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Weekly failure rate of finished weeks, oldest first. The current week is left out, because a few hours of
// runs would make one failure look like a 100% rate. Cancelled/skipped and unfinished runs say nothing about test health.
export function weeklyFailureRate(runs: Run[], now = new Date()): WeekPoint[] {
  const currentWeek = isoWeek(now);
  const weeks = new Map<string, { runs: number; failed: number }>();
  for (const run of runs) {
    if (run.status !== "completed" || run.conclusion === "cancelled" || run.conclusion === "skipped") continue;
    const key = isoWeek(new Date(run.createdAt));
    if (key >= currentWeek) continue;
    const week = weeks.get(key) ?? { runs: 0, failed: 0 };
    week.runs += 1;
    if (FAILED.has(run.conclusion)) week.failed += 1;
    weeks.set(key, week);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { runs, failed }]) => ({ week, runs, failed, rate: failed / runs }));
}

function baselineWindow(bands: Bands) {
  const match = /^rolling_(\d+)w$/.exec(bands.baseline);
  if (!match) throw new Error(`Unsupported baseline "${bands.baseline}", expected rolling_<n>w`);
  return Number(match[1]);
}

// Only upward drift matters: a falling failure rate is good news, not an incident.
export function classify(weeks: WeekPoint[], bands: Bands): Result {
  const window = baselineWindow(bands);
  if (weeks.length < bands.min_points) {
    return { status: "insufficient_data", points: weeks.length, required: bands.min_points };
  }

  const rates = weeks.map((w) => w.rate);
  const latest = rates.at(-1)!;
  // The baseline excludes the 3-point evaluation window, so a recent spike can't widen its own band
  const baseline = rates.slice(-window - 3, -3);
  const mean = baseline.reduce((sum, r) => sum + r, 0) / baseline.length;
  const variance = baseline.reduce((sum, r) => sum + (r - mean) ** 2, 0) / baseline.length;
  const sigma = Math.max(Math.sqrt(variance), bands.min_sigma);
  const zOf = (rate: number) => (rate - mean) / sigma;
  const z = zOf(latest);

  let tier: Tier = "ok";
  let rule: string | null = null;
  if (z > 3) {
    tier = "3sigma";
    rule = "WE1: latest point beyond 3 sigma";
  } else if (z > 2 || rates.slice(-3).filter((r) => zOf(r) > 2).length >= 2) {
    tier = "2sigma";
    rule = z > 2 ? "latest point beyond 2 sigma" : "WE2: 2 of the last 3 points beyond 2 sigma";
  } else if (z > 1) {
    tier = "1sigma";
    rule = "latest point beyond 1 sigma";
  }

  const action = tier === "ok" ? "none" : bands.tiers[tier].action;
  return { status: "evaluated", tier, action, rule, latest, mean, sigma, z, weeks };
}

export function draftIntent(result: Extract<Result, { status: "evaluated" }>, today: string): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const rows = result.weeks
    .slice(-9)
    .map((w) => `| ${w.week} | ${w.runs} | ${w.failed} | ${pct(w.rate)} |`)
    .join("\n");
  return `# Intent: CI test failure rate drift (${today})
Author: ci-drift detector (automated, Stage 6). Status: draft — needs triage. ClickUp: none yet.

## Problem
The CI test failure rate breached its control band: ${result.rule}.
Latest week ${result.weeks.at(-1)!.week}: ${pct(result.latest)} against a baseline of ${pct(result.mean)} (sigma ${pct(result.sigma)}, z = ${result.z.toFixed(2)}). Tier: ${result.tier} → ${result.action}.

| Week | Runs | Failed | Rate |
|---|---|---|---|
${rows}

## Proposed outcome
The failure rate returns to its baseline band, and the cause is fixed (or the flaky test is quarantined) through a reviewed PR.

## Affected users and systems
Everyone merging to main; the CI workflow (.github/workflows/ci.yml); whichever tests failed in the window (see the failed runs).

## Constraints
No direct pushes to main, no disabled or deleted tests without a linked fix, existing approval gates unchanged (intent/tool-sandbox-verification/gates.md).

## Acceptance conditions
- The root cause is named in this file before any fix is merged.
- After the fix, the next weekly check is back under 1 sigma.
- A regression test (eval) for the cause is added to the suite.

## Open questions
- Real regression or flaky test? (triager decides: fix now, schedule or dismiss; a dismissal means retuning intent/bands.yaml)
`;
}

async function loadRuns(file: string | undefined): Promise<Run[]> {
  if (file) return Bun.file(file).json();
  const proc = Bun.spawnSync([
    "gh", "run", "list", "--workflow", "ci.yml", "--limit", "500", "--json", "conclusion,createdAt,status",
  ]);
  // Before ci.yml reaches the default branch there is simply no history yet
  if (proc.exitCode !== 0 && proc.stderr.toString().includes("not found")) return [];
  if (proc.exitCode !== 0) throw new Error(`gh run list failed: ${proc.stderr.toString()}`);
  return JSON.parse(proc.stdout.toString());
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const runsIndex = args.indexOf("--runs");
  const root = join(import.meta.dir, "..");
  const bands = Bun.YAML.parse(await Bun.file(join(root, "intent/bands.yaml")).text()) as Bands;
  const result = classify(weeklyFailureRate(await loadRuns(runsIndex >= 0 ? args[runsIndex + 1] : undefined)), bands);

  let intentPath: string | null = null;
  if (args.includes("--write-intent") && result.status === "evaluated" && ["diagnose", "propose"].includes(result.action)) {
    const today = new Date().toISOString().slice(0, 10);
    const dir = join(root, "intent", `ci-drift-${today}`);
    await mkdir(dir, { recursive: true });
    intentPath = join(dir, "intent.md");
    await Bun.write(intentPath, draftIntent(result, today));
  }

  const { weeks: _, ...summary } = result as Result & { weeks?: unknown };
  console.log(JSON.stringify({ ...summary, intentPath }));
}
