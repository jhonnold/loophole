import type { DailyStockManager } from "../managers/daily-stock-manager.ts";
import type { JobRunManager } from "../managers/job-run-manager.ts";

export interface WorkerLoopOptions {
  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
  readonly dailies: Pick<DailyStockManager, "stock">;
  readonly workerId: string;
  /** How long to wait when the queue is empty. */
  readonly pollMs: number;
  /** Least time between two sweeps for abandoned jobs, whether the worker is busy or idle. */
  readonly sweepMs: number;
  /** Least time between two checks that the coming days' daily puzzles are generated. */
  readonly stockMs: number;
  /** Stops the loop after the current job. */
  readonly signal: AbortSignal;
  /** Milliseconds, for the sweep timer. */
  readonly now?: () => number;
}

/**
 * The worker's main loop: run jobs back to back while there are any; when the queue is empty,
 * wait `pollMs` before looking again. Abandoned jobs are taken back once at start and then every
 * `sweepMs`, busy or idle, so a dead worker's job does not wait for the queue to drain. Daily
 * puzzles are stocked at start and then every `stockMs` the same way; one of today's still missing
 * at two checks in a row is late, and logged as an error. An error (say, the database staying busy)
 * is logged and the loop carries on after the same wait.
 */
export async function runWorkerLoop({
  runs,
  dailies,
  workerId,
  pollMs,
  sweepMs,
  stockMs,
  signal,
  now = () => performance.now(),
}: WorkerLoopOptions) {
  let lastSweep = Number.NEGATIVE_INFINITY;
  let lastStock = Number.NEGATIVE_INFINITY;
  let missing = new Set<number>();
  while (!signal.aborted) {
    try {
      if (now() - lastSweep >= sweepMs) {
        lastSweep = now();
        const recovered = runs.recoverStale();
        if (recovered > 0) console.log(`Recovered ${recovered} abandoned job(s)`);
      }
      if (now() - lastStock >= stockMs) {
        lastStock = now();
        const { queued, missingToday } = dailies.stock();
        if (queued > 0) console.log(`Queued ${queued} daily puzzle generation(s)`);
        const late = missingToday.filter((size) => missing.has(size));
        if (late.length > 0) {
          const sizes = late.map((size) => `${size}×${size}`).join(", ");
          console.error(`Today's daily puzzles are late: ${sizes} not generated yet`);
        }
        missing = new Set(missingToday);
      }
      if (await runs.runNext(workerId)) continue;
    } catch (err) {
      console.error("Worker loop error:", err);
    }
    await sleep(pollMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
