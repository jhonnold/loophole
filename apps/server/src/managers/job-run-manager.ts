import type { Job, JobResult, Task, TaskOutput } from "../domain.ts";
import type { Clock, JobEnd, JobQueue, TaskRunner, WorkerMetrics } from "../ports.ts";
import type { DailyStockManager } from "./daily-stock-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";
import type { SubmissionManager } from "./submission-manager.ts";

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
  /** Decides the submission a verification was for. */
  readonly submissions: SubmissionManager;
  /** Stores a daily puzzle's generation. */
  readonly dailies: Pick<DailyStockManager, "complete">;
  readonly clock: Clock;
  readonly settings: JobRunSettings;
  /** Counts each job's end and running time; tests may leave it out. */
  readonly metrics?: Pick<WorkerMetrics, "jobFinished" | "jobsLost">;
}

export interface RunNextOptions {
  /** Claims only jobs whose priority is at most this (`JOB_PRIORITY`); any job when left out. */
  readonly maxPriority?: number;
  /**
   * Aborted when the worker is shutting down and the job may not run any longer: the task is
   * stopped and the job given back to the queue for another worker. Nothing is claimed once it
   * has aborted.
   */
  readonly cancel?: AbortSignal;
}

/** Runs queued jobs, one at a time per worker: claim, run off-thread, store the outcome. */
export class JobRunManager {
  readonly #deps: JobRunManagerDeps;

  constructor(deps: JobRunManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Claims and runs the next queued job (by priority, then oldest first). Resolves to false when
   * there was none to claim.
   */
  async runNext(workerId: string, options: RunNextOptions = {}): Promise<boolean> {
    const { jobs, tasks, clock, settings } = this.#deps;
    if (options.cancel?.aborted) return false;
    const job = jobs.claimNext(workerId, clock.now(), options.maxPriority);
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
    let end: JobEnd | "cancelled";
    try {
      const outcome = await tasks.run(toTask(job), {
        timeoutMs,
        onProgress,
        signal: options.cancel,
      });
      if (outcome.status === "cancelled") {
        end = "cancelled";
      } else if (outcome.status === "done") {
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
    if (end === "cancelled") {
      // The worker is shutting down: the next worker runs the job again from the start.
      if (jobs.release(job.id, workerId)) {
        console.warn(`Job ${job.id} stopped at shutdown and given back to the queue`);
      }
      return true;
    }
    const finishedAt = clock.now();
    // Counted only when the job really ended here: a job taken back is run again, and counted then.
    if (jobs.finish(job.id, workerId, end, finishedAt)) {
      this.#deps.metrics?.jobFinished(
        job.kind,
        end.status,
        (finishedAt - (job.startedAt ?? finishedAt)) / 1000,
      );
    } else {
      console.warn(`Job ${job.id} was taken back; result not recorded`);
    }
    return true;
  }

  /** Requeues or fails running jobs whose worker stopped sending heartbeats. */
  recoverStale(): { requeued: number; lost: number } {
    const { jobs, clock, settings } = this.#deps;
    const now = clock.now();
    const recovery = jobs.recoverStale(now - settings.staleMs, settings.maxAttempts, now);
    if (recovery.lost > 0) this.#deps.metrics?.jobsLost(recovery.lost);
    return recovery;
  }

  /**
   * Stores what a task produced. A generated puzzle takes its job's id, and a daily one goes to its
   * day; a verification for a submission decides that submission.
   */
  async #store(job: Job, output: TaskOutput): Promise<JobResult> {
    switch (output.kind) {
      case "generate":
        if (job.kind === "generate" && job.input.day !== undefined) {
          await this.#deps.dailies.complete(job.id, job.input.day, output.generated);
        } else {
          await this.#deps.puzzles.saveGenerated(job.id, output.generated);
        }
        return { kind: "generate", puzzleId: job.id };
      case "verify":
        if (job.kind === "verify" && job.input.submissionId !== undefined) {
          await this.#deps.submissions.complete(job.input.submissionId, output.verified);
        }
        return { kind: "verify", status: output.verified.status };
    }
  }
}

function toTask(job: Job): Task {
  return job.kind === "generate"
    ? { kind: "generate", input: job.input }
    : { kind: "verify", input: job.input };
}
