// Server-side performance check (PRD NFR-1), not part of `bun run check`: runs generations and
// verifications the way the worker does, each in a fresh thread under the worker's time limits,
// and fails if a budget is missed. Timings depend on the machine and its load: run it on an idle
// host (it prints the load average first).
//   bun run bench:jobs            all sizes, 10 to 25 minutes (one 100×100 generation takes 6 to 19)
//   bun run bench:jobs --quick    up to 30×30 and one 100×100 verification
import { availableParallelism, loadavg } from "node:os";
import type { PuzzleWireV1 } from "@loophole/core";
import { ThreadTaskRunner } from "../src/adapters/tasks/thread-task-runner.ts";
import type { Task } from "../src/domain.ts";

/** NFR-1: generation p95 under 10 s up to 30×30 and under 30 s at 40×40, the largest daily. */
function generateBudgetMs(size: number): number | null {
  if (size <= 30) return 10_000;
  return size <= 40 ? 30_000 : null;
}
/** The worker's limits (GENERATE_TIMEOUT_MS, VERIFY_TIMEOUT_MS defaults). */
const GENERATE_TIMEOUT_MS = 1_800_000;
const VERIFY_TIMEOUT_MS = 45_000;
/** NFR-1: a verification ends (with a verdict or `unknown`) within core's 30 s budget. */
const VERIFY_BUDGET_MS = 30_000;

const quick = process.argv.includes("--quick");
const runner = new ThreadTaskRunner();
const failures: string[] = [];

const [load1] = loadavg();
const cores = availableParallelism();
console.log(`load average ${load1.toFixed(2)} on ${cores} cores`);
if (load1 > cores / 2) console.log("warning: the host is busy; timings will be slow");

async function timed(task: Task, timeoutMs: number) {
  const started = performance.now();
  const outcome = await runner.run(task, { timeoutMs, onProgress: () => {} });
  return { outcome, ms: performance.now() - started };
}

function p95(sorted: number[]): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

const sizes: [number, number][] = [
  [7, 20],
  [10, 20],
  [20, 20],
  [30, 20],
  ...(quick
    ? []
    : ([
        [40, 5],
        [100, 1],
      ] as [number, number][])),
];
/** The generated 100×100, verified below as a submission. */
let generated100: PuzzleWireV1 | undefined;
for (const [size, count] of sizes) {
  const times: number[] = [];
  for (let n = 0; n < count; n++) {
    const task: Task = {
      kind: "generate",
      input: { width: size, height: size, seed: `bench-jobs-${n}` },
    };
    const { outcome, ms } = await timed(task, GENERATE_TIMEOUT_MS);
    if (outcome.status !== "done")
      failures.push(`generate ${size}×${size} #${n}: ${outcome.status}`);
    else if (size === 100 && outcome.output.kind === "generate")
      generated100 = outcome.output.generated.puzzle;
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  const p = p95(times);
  console.log(
    `generate ${size}×${size}: n=${count} p95=${p.toFixed(0)}ms max=${times.at(-1)?.toFixed(0)}ms`,
  );
  const budget = generateBudgetMs(size);
  if (budget !== null && p >= budget) {
    failures.push(`generate ${size}×${size}: p95 ${p.toFixed(0)} ms is over ${budget} ms`);
  }
}

// The generated 100×100 (the rules solve it; not with --quick) and an empty 100×100 grid (many
// solutions: the search must find two and stop) as submissions.
const puzzles: [string, PuzzleWireV1][] = [];
if (generated100 !== undefined) puzzles.push(["generated 100×100", generated100]);
puzzles.push(["empty 100×100", { v: 1, width: 100, height: 100, clues: ".".repeat(10_000) }]);
for (const [label, puzzle] of puzzles) {
  const { outcome, ms } = await timed({ kind: "verify", input: { puzzle } }, VERIFY_TIMEOUT_MS);
  const verdict =
    outcome.status === "done" && outcome.output.kind === "verify"
      ? outcome.output.verified.status
      : outcome.status;
  console.log(`verify ${label}: ${verdict} in ${ms.toFixed(0)}ms`);
  if (outcome.status !== "done" || ms > VERIFY_BUDGET_MS + 5_000) {
    failures.push(
      `verify ${label}: ${verdict} after ${ms.toFixed(0)} ms (budget ${VERIFY_BUDGET_MS} ms)`,
    );
  }
}

if (failures.length > 0) {
  console.error(`FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("All within NFR-1's budgets.");
