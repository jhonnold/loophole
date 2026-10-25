import type { PuzzleWireV1 } from "@loophole/core";
import type { Job, JobInput } from "../domain.ts";
import type { Clock, JobQueue } from "../ports.ts";
import { QueueFullError } from "./errors.ts";

export interface JobManagerDeps {
  readonly jobs: JobQueue;
  readonly clock: Clock;
  readonly newId: () => string;
  /** New jobs are refused while this many are waiting. */
  readonly maxQueued: number;
}

export interface GenerateRequest {
  readonly width: number;
  readonly height: number;
  /** Picked at random when absent. */
  readonly seed?: string;
}

/** Queues background jobs and reports on them. The worker process runs them (`JobRunManager`). */
export class JobManager {
  readonly #deps: JobManagerDeps;

  constructor(deps: JobManagerDeps) {
    this.#deps = deps;
  }

  /** Queues a puzzle generation (PRD FR-11: never in the request path). Throws `QueueFullError`. */
  enqueueGenerate(request: GenerateRequest): Job {
    const seed = request.seed ?? this.#deps.newId();
    return this.#enqueue({
      kind: "generate",
      input: { width: request.width, height: request.height, seed },
    });
  }

  /** Queues a uniqueness check of a puzzle (PRD FR-4). Throws `QueueFullError`. */
  enqueueVerify(puzzle: PuzzleWireV1): Job {
    return this.#enqueue({ kind: "verify", input: { puzzle } });
  }

  get(id: string): Job | null {
    return this.#deps.jobs.get(id);
  }

  #enqueue(job: JobInput): Job {
    const { jobs, clock, newId, maxQueued } = this.#deps;
    if (jobs.countQueued() >= maxQueued) throw new QueueFullError(maxQueued);
    return jobs.enqueue({ id: newId(), job, createdAt: clock.now() });
  }
}
