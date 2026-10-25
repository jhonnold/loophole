import type { Database } from "bun:sqlite";
import type { Job, JobResult, JobStatus } from "../../domain.ts";
import type { JobEnd, JobQueue, NewJob } from "../../ports.ts";

interface JobRow {
  id: string;
  kind: string;
  payload: string;
  status: JobStatus;
  progress: number;
  result: string | null;
  error: string | null;
  attempts: number;
  claimed_by: string | null;
  created_at: number;
  started_at: number | null;
  heartbeat_at: number | null;
  finished_at: number | null;
}

/**
 * The jobs table as a queue. `claimNext` is one `UPDATE … RETURNING` statement, so two workers
 * (in any processes) can never claim the same job.
 */
export class SqliteJobQueue implements JobQueue {
  readonly #insert;
  readonly #get;
  readonly #countQueued;
  readonly #claim;
  readonly #progress;
  readonly #heartbeat;
  readonly #finish;
  readonly #requeueStale;
  readonly #failStale;

  constructor(db: Database) {
    this.#insert = db.query<JobRow, { id: string; kind: string; payload: string; now: number }>(
      "INSERT INTO jobs (id, kind, payload, status, created_at) VALUES ($id, $kind, $payload, 'queued', $now) RETURNING *",
    );
    this.#get = db.query<JobRow, { id: string }>("SELECT * FROM jobs WHERE id = $id");
    this.#countQueued = db.query<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE status = 'queued'",
    );
    this.#claim = db.query<JobRow, { worker: string; now: number }>(
      `UPDATE jobs
       SET status = 'running', claimed_by = $worker, attempts = attempts + 1,
           started_at = $now, heartbeat_at = $now, progress = 0
       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1)
         AND status = 'queued'
       RETURNING *`,
    );
    this.#progress = db.query<void, { id: string; worker: string; progress: number; now: number }>(
      "UPDATE jobs SET progress = $progress, heartbeat_at = $now WHERE id = $id AND status = 'running' AND claimed_by = $worker",
    );
    this.#heartbeat = db.query<void, { id: string; worker: string; now: number }>(
      "UPDATE jobs SET heartbeat_at = $now WHERE id = $id AND status = 'running' AND claimed_by = $worker",
    );
    this.#finish = db.query<
      { id: string },
      {
        id: string;
        worker: string;
        status: JobStatus;
        result: string | null;
        error: string | null;
        now: number;
      }
    >(
      `UPDATE jobs
       SET status = $status, result = $result, error = $error, finished_at = $now,
           progress = CASE WHEN $status = 'done' THEN 1 ELSE progress END
       WHERE id = $id AND status = 'running' AND claimed_by = $worker
       RETURNING id`,
    );
    this.#requeueStale = db.query<void, { before: number; max: number }>(
      `UPDATE jobs SET status = 'queued', claimed_by = NULL, progress = 0
       WHERE status = 'running' AND heartbeat_at < $before AND attempts < $max`,
    );
    this.#failStale = db.query<void, { before: number; max: number; now: number }>(
      `UPDATE jobs SET status = 'failed', error = 'The worker running this job stopped responding.', finished_at = $now
       WHERE status = 'running' AND heartbeat_at < $before AND attempts >= $max`,
    );
  }

  enqueue({ id, job, createdAt }: NewJob): Job {
    const row = this.#insert.get({
      id,
      kind: job.kind,
      payload: JSON.stringify(job.input),
      now: createdAt,
    });
    if (row === null) throw new Error("insert returned no row");
    return fromRow(row);
  }

  get(id: string): Job | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  countQueued(): number {
    return this.#countQueued.get()?.n ?? 0;
  }

  claimNext(workerId: string, now: number): Job | null {
    const row = this.#claim.get({ worker: workerId, now });
    return row === null ? null : fromRow(row);
  }

  setProgress(id: string, workerId: string, progress: number, now: number): void {
    this.#progress.run({ id, worker: workerId, progress, now });
  }

  heartbeat(id: string, workerId: string, now: number): void {
    this.#heartbeat.run({ id, worker: workerId, now });
  }

  finish(id: string, workerId: string, end: JobEnd, now: number): boolean {
    const done = end.status === "done";
    const row = this.#finish.get({
      id,
      worker: workerId,
      status: end.status,
      result: done ? JSON.stringify(end.result) : null,
      error: done ? null : end.error,
      now,
    });
    return row !== null;
  }

  recoverStale(staleBefore: number, maxAttempts: number, now: number): number {
    const failed = this.#failStale.run({ before: staleBefore, max: maxAttempts, now }).changes;
    const requeued = this.#requeueStale.run({ before: staleBefore, max: maxAttempts }).changes;
    return failed + requeued;
  }
}

function fromRow(row: JobRow): Job {
  const base = {
    id: row.id,
    status: row.status,
    progress: row.progress,
    result: row.result === null ? null : (JSON.parse(row.result) as JobResult),
    error: row.error,
    attempts: row.attempts,
    claimedBy: row.claimed_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
  };
  const input = JSON.parse(row.payload);
  switch (row.kind) {
    case "generate":
      return { ...base, kind: "generate", input };
    case "verify":
      return { ...base, kind: "verify", input };
    default:
      throw new Error(`job ${row.id} has unknown kind ${row.kind}`);
  }
}
