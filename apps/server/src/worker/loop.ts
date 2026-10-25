import type { JobRunManager } from "../managers/job-run-manager.ts";

export interface WorkerLoopOptions {
  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
  readonly workerId: string;
  /** How long to wait when the queue is empty. */
  readonly pollMs: number;
  /** Stops the loop after the current job. */
  readonly signal: AbortSignal;
}

/**
 * The worker's main loop: run jobs back to back while there are any; when the queue is empty,
 * take back abandoned jobs and wait `pollMs` before looking again. An error (say, the database
 * staying busy) is logged and the loop carries on after the same wait.
 */
export async function runWorkerLoop({ runs, workerId, pollMs, signal }: WorkerLoopOptions) {
  while (!signal.aborted) {
    try {
      if (await runs.runNext(workerId)) continue;
      const recovered = runs.recoverStale();
      if (recovered > 0) console.log(`Recovered ${recovered} abandoned job(s)`);
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
