import { DEFAULT_LEVEL, type Level, type PuzzleWireV1 } from "@loophole/core";
import { type GenerateInput, JOB_PRIORITY, type Job, type JobInput } from "../domain.ts";
import type { Clock, JobQueue } from "../ports.ts";
import { QueueFullError, TooManyPendingJobsError } from "./errors.ts";

export interface JobManagerDeps {
  readonly jobs: JobQueue;
  readonly clock: Clock;
  readonly newId: () => string;
  /** New jobs are refused while this many are waiting. */
  readonly maxQueued: number;
  /** A requester's generations are refused while this many of theirs are waiting or running. */
  readonly maxPendingPerRequester: number;
}

export interface GenerateRequest {
  readonly width: number;
  readonly height: number;
  /** Picked at random when absent. */
  readonly seed?: string;
  /** Hard (core's `DEFAULT_LEVEL`) when absent. */
  readonly level?: Level;
}

/** Queues background jobs and reports on them. The worker process runs them (`JobRunManager`). */
export class JobManager {
  readonly #deps: JobManagerDeps;

  constructor(deps: JobManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Queues a player's puzzle generation (PRD FR-11: never in the request path). `requester` names
   * who asked (`user:<id>`, or `ip:<address>` for a guest). Players' generations are claimed after
   * every verification and daily puzzle (`JOB_PRIORITY`). Throws `TooManyPendingJobsError` while
   * the requester has `maxPendingPerRequester` generations waiting or running, and
   * `QueueFullError`.
   */
  enqueueGenerate(request: GenerateRequest, requester: string): Job {
    const { jobs, newId, maxPendingPerRequester } = this.#deps;
    if (jobs.countPending(requester) >= maxPendingPerRequester) {
      throw new TooManyPendingJobsError(maxPendingPerRequester);
    }
    const input: GenerateInput = {
      width: request.width,
      height: request.height,
      seed: request.seed ?? newId(),
      level: request.level ?? DEFAULT_LEVEL,
    };
    return this.#enqueue({ kind: "generate", input }, JOB_PRIORITY.player, requester);
  }

  /**
   * Queues a uniqueness check of a puzzle (PRD FR-4), for the submission `submissionId` when given.
   * Checks are claimed before every other job. Throws `QueueFullError`.
   */
  enqueueVerify(puzzle: PuzzleWireV1, submissionId?: string): Job {
    const input = submissionId === undefined ? { puzzle } : { puzzle, submissionId };
    return this.#enqueue({ kind: "verify", input }, JOB_PRIORITY.verify, null);
  }

  /**
   * Queues the generation of a daily puzzle under job id `id` (PRD FR-22), claimed after
   * verifications and before players' generations. Never refused for a full queue: the
   * scheduler's few jobs a day must not wait behind players' jobs.
   */
  enqueueDaily(id: string, input: GenerateInput & { readonly day: string }): Job {
    const { jobs, clock } = this.#deps;
    return jobs.enqueue({
      id,
      job: { kind: "generate", input },
      createdAt: clock.now(),
      priority: JOB_PRIORITY.daily,
    });
  }

  get(id: string): Job | null {
    return this.#deps.jobs.get(id);
  }

  #enqueue(job: JobInput, priority: number, requester: string | null): Job {
    const { jobs, clock, newId, maxQueued } = this.#deps;
    if (jobs.countQueued() >= maxQueued) throw new QueueFullError(maxQueued);
    return jobs.enqueue({ id: newId(), job, createdAt: clock.now(), priority, requester });
  }
}
