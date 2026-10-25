import type { Job, JobInput, JobResult, PuzzleRecord, Task, TaskOutcome } from "./domain.ts";

/**
 * The interfaces managers depend on. Adapters implement them; the composition roots
 * (`api/main.ts`, `worker/main.ts`) pick the implementations.
 */

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface PuzzleRepository {
  /** Stores a new puzzle. Does nothing when a puzzle with this id already exists. */
  insert(record: PuzzleRecord): void;
  get(id: string): PuzzleRecord | null;
  /** Published puzzles, newest first. */
  listPublished(limit: number): PuzzleRecord[];
}

/** Text blobs by key, such as solutions and solver traces. */
export interface BlobStore {
  put(key: string, body: string, contentType: string): Promise<void>;
  /** Resolves to null when there is no blob under `key`. */
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export interface NewJob {
  readonly id: string;
  readonly job: JobInput;
  readonly createdAt: number;
}

/**
 * The jobs table. Updates to a running job name the worker that claimed it and do nothing when
 * another worker holds the job or it is no longer running.
 */
export interface JobQueue {
  enqueue(job: NewJob): Job;
  get(id: string): Job | null;
  countQueued(): number;
  /** Atomically takes the oldest queued job for `workerId`, or returns null when there is none. */
  claimNext(workerId: string, now: number): Job | null;
  /** Stores progress (0 to 1); also counts as a heartbeat. */
  setProgress(id: string, workerId: string, progress: number, now: number): void;
  heartbeat(id: string, workerId: string, now: number): void;
  /** Ends a running job. Returns false when the worker no longer holds it. */
  finish(id: string, workerId: string, end: JobEnd, now: number): boolean;
  /**
   * Running jobs whose last heartbeat is before `staleBefore` go back to the queue, or fail once
   * they have been claimed `maxAttempts` times. Returns how many jobs it changed.
   */
  recoverStale(staleBefore: number, maxAttempts: number, now: number): number;
}

export type JobEnd =
  | { readonly status: "done"; readonly result: JobResult }
  | { readonly status: "failed" | "timeout"; readonly error: string };

export interface TaskRunOptions {
  /** The task is stopped and reported as `timeout` after this long. */
  readonly timeoutMs: number;
  /** Called with progress from 0 to 1, at most about once per percent. */
  readonly onProgress: (progress: number) => void;
}

/** Runs CPU-heavy tasks (generation, verification) off the caller's thread. */
export interface TaskRunner {
  run(task: Task, options: TaskRunOptions): Promise<TaskOutcome>;
}
