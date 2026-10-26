import { JOB_PRIORITY } from "../domain.ts";
import type { DailyStockManager } from "../managers/daily-stock-manager.ts";
import type { JobRunManager } from "../managers/job-run-manager.ts";

export interface LaneOptions {
  readonly runs: Pick<JobRunManager, "runNext">;
  readonly workerId: string;
  /** How long to wait when there is no job to claim. */
  readonly pollMs: number;
  /** Stops the lane: no job is claimed once it aborts, and the running one gets `drainMs`. */
  readonly signal: AbortSignal;
  /**
   * After `signal` aborts, how long a running job may go on before it is stopped and given back to
   * the queue (DECISIONS, WT21 "Graceful shutdown").
   */
  readonly drainMs: number;
}

export interface WorkerLoopOptions extends LaneOptions {
  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
  readonly dailies: Pick<DailyStockManager, "stock">;
  /** Least time between two sweeps for abandoned jobs, whether the worker is busy or idle. */
  readonly sweepMs: number;
  /** Least time between two checks that the coming days' daily puzzles are generated. */
  readonly stockMs: number;
  /** Milliseconds, for the sweep timer. */
  readonly now?: () => number;
}

/**
 * The worker's main loop: run jobs back to back while there are any, by priority (`JOB_PRIORITY`);
 * when the queue is empty, wait `pollMs` before looking again. Abandoned jobs are taken back once
 * at start and then every `sweepMs`, busy or idle, so a dead worker's job does not wait for the
 * queue to drain. Daily puzzles are stocked at start and then every `stockMs` the same way; one of
 * today's still missing at two checks in a row is late, and logged as an error. An error (say, the
 * database staying busy) is logged and the loop carries on after the same wait. When `signal`
 * aborts, the loop claims nothing more, and a running job that hasn't ended `drainMs` later is
 * stopped and given back to the queue.
 */
export async function runWorkerLoop({
  runs,
  dailies,
  workerId,
  pollMs,
  sweepMs,
  stockMs,
  signal,
  drainMs,
  now = () => performance.now(),
}: WorkerLoopOptions) {
  let lastSweep = Number.NEGATIVE_INFINITY;
  let lastStock = Number.NEGATIVE_INFINITY;
  let missing = new Set<number>();
  const drain = drainAfter(signal, drainMs);
  while (!signal.aborted) {
    try {
      if (now() - lastSweep >= sweepMs) {
        lastSweep = now();
        const { requeued, lost } = runs.recoverStale();
        if (requeued > 0) console.log(`Recovered ${requeued} abandoned job(s)`);
        if (lost > 0) console.error(`Failed ${lost} job(s) abandoned on their last attempt`);
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
      if (await runs.runNext(workerId, { cancel: drain.cancel })) continue;
    } catch (err) {
      console.error("Worker loop error:", err);
    }
    await sleep(pollMs, signal);
  }
  drain.dispose();
}

/**
 * A second loop in the worker that runs only verifications (`JOB_PRIORITY.verify`), each at most
 * `VERIFY_TIMEOUT_MS`, next to whatever the main loop runs: a submission's check never waits for
 * a long generation to end (DECISIONS, WT21 "Worker fairness"). Stops like the main loop.
 */
export async function runVerifyLane({ runs, workerId, pollMs, signal, drainMs }: LaneOptions) {
  const drain = drainAfter(signal, drainMs);
  while (!signal.aborted) {
    try {
      const options = { maxPriority: JOB_PRIORITY.verify, cancel: drain.cancel };
      if (await runs.runNext(workerId, options)) continue;
    } catch (err) {
      console.error("Verification lane error:", err);
    }
    await sleep(pollMs, signal);
  }
  drain.dispose();
}

/** A signal that aborts `ms` after `signal` does; `dispose` drops the timer. */
function drainAfter(signal: AbortSignal, ms: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    timer = setTimeout(() => controller.abort(), ms);
  };
  signal.addEventListener("abort", start, { once: true });
  return {
    cancel: controller.signal,
    dispose() {
      signal.removeEventListener("abort", start);
      clearTimeout(timer);
    },
  };
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
