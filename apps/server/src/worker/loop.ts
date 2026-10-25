import type { JobRunManager } from "../managers/job-run-manager.ts";

export interface WorkerLoopOptions {
  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
  readonly workerId: string;
  /** How long to wait when the queue is empty. */
  readonly pollMs: number;
  /** Least time between two sweeps for abandoned jobs, whether the worker is busy or idle. */
  readonly sweepMs: number;
  /** Stops the loop after the current job. */
  readonly signal: AbortSignal;
  /** Milliseconds, for the sweep timer. */
  readonly now?: () => number;
}

/**
 * The worker's main loop: run jobs back to back while there are any; when the queue is empty,
 * wait `pollMs` before looking again. Abandoned jobs are taken back once at start and then every
 * `sweepMs`, busy or idle, so a dead worker's job does not wait for the queue to drain. An error
 * (say, the database staying busy) is logged and the loop carries on after the same wait.
 */
export async function runWorkerLoop({
  runs,
  workerId,
  pollMs,
  sweepMs,
  signal,
  now = () => performance.now(),
}: WorkerLoopOptions) {
  let lastSweep = Number.NEGATIVE_INFINITY;
  while (!signal.aborted) {
    try {
      if (now() - lastSweep >= sweepMs) {
        lastSweep = now();
        const recovered = runs.recoverStale();
        if (recovered > 0) console.log(`Recovered ${recovered} abandoned job(s)`);
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
