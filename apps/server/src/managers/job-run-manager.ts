import type { Job, JobResult, Task, TaskOutput } from "../domain.ts";
import type { Clock, JobEnd, JobQueue, TaskRunner } from "../ports.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

export interface JobRunSettings {
  /** Hard time limit for a generation. */
  readonly generateTimeoutMs: number;
  /** Hard time limit for a verification; above core's own 30 s budget (PRD NFR-1). */
  readonly verifyTimeoutMs: number;
  /** Least time between two progress writes for one job. */
  readonly progressIntervalMs: number;
  /** Time between heartbeats while a job runs. */
  readonly heartbeatMs: number;
  /** A running job with no heartbeat for this long is treated as abandoned. */
  readonly staleMs: number;
  /** A job abandoned this many times fails instead of going back to the queue. */
  readonly maxAttempts: number;
}

export interface JobRunManagerDeps {
  readonly jobs: JobQueue;
  readonly tasks: TaskRunner;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
  readonly settings: JobRunSettings;
}

/** Runs queued jobs, one at a time per worker: claim, run off-thread, store the outcome. */
export class JobRunManager {
  readonly #deps: JobRunManagerDeps;

  constructor(deps: JobRunManagerDeps) {
    this.#deps = deps;
  }

  /** Claims and runs the oldest queued job. Resolves to false when the queue was empty. */
  async runNext(workerId: string): Promise<boolean> {
    const { jobs, tasks, clock, settings } = this.#deps;
    const job = jobs.claimNext(workerId, clock.now());
    if (job === null) return false;
    const timeoutMs =
      job.kind === "generate" ? settings.generateTimeoutMs : settings.verifyTimeoutMs;
    let lastWrite = Number.NEGATIVE_INFINITY;
    const onProgress = (progress: number) => {
      const now = clock.now();
      if (now - lastWrite < settings.progressIntervalMs) return;
      lastWrite = now;
      jobs.setProgress(job.id, workerId, progress, now);
    };
    const heartbeat = setInterval(() => {
      try {
        jobs.heartbeat(job.id, workerId, clock.now());
      } catch (err) {
        // A missed beat is harmless; the next one, or the job's end, writes again.
        console.error(`Heartbeat for job ${job.id} failed:`, err);
      }
    }, settings.heartbeatMs);
    let end: JobEnd;
    try {
      const outcome = await tasks.run(toTask(job), {
        timeoutMs,
        onProgress,
      });
      if (outcome.status === "done") {
        end = { status: "done", result: await this.#store(job, outcome.output) };
      } else if (outcome.status === "timeout") {
        end = { status: "timeout", error: `Stopped after the ${timeoutMs / 1000} s time limit.` };
      } else {
        end = { status: "failed", error: outcome.error };
      }
    } catch (err) {
      end = { status: "failed", error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearInterval(heartbeat);
    }
    if (!jobs.finish(job.id, workerId, end, clock.now())) {
      console.warn(`Job ${job.id} was taken back; result not recorded`);
    }
    return true;
  }

  /** Requeues or fails running jobs whose worker stopped sending heartbeats. */
  recoverStale(): number {
    const { jobs, clock, settings } = this.#deps;
    const now = clock.now();
    return jobs.recoverStale(now - settings.staleMs, settings.maxAttempts, now);
  }

  /** Stores what a task produced. A generated puzzle takes its job's id. */
  async #store(job: Job, output: TaskOutput): Promise<JobResult> {
    switch (output.kind) {
      case "generate":
        await this.#deps.puzzles.saveGenerated(job.id, output.generated);
        return { kind: "generate", puzzleId: job.id };
      case "verify":
        return { kind: "verify", status: output.verified.status };
    }
  }
}

function toTask(job: Job): Task {
  return job.kind === "generate"
    ? { kind: "generate", input: job.input }
    : { kind: "verify", input: job.input };
}
