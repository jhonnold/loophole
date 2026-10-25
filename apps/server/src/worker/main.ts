// Composition root of the job worker process: reads the settings, builds the adapters and
// managers, and runs jobs until SIGINT or SIGTERM. The job in progress finishes first.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { runWorkerLoop } from "./loop.ts";

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);

const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs: new S3BlobStore(config.s3),
  clock: systemClock,
});
const queue = new SqliteJobQueue(db);
// The worker only decides submissions; queueing them and the per-account limit are the API's.
const submissions = new SubmissionManager({
  submissions: new SqliteSubmissionRepository(db),
  puzzles,
  jobs: new JobManager({
    jobs: queue,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: config.maxQueuedJobs,
  }),
  limiter: new MemoryRateLimiter(systemClock),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
const runs = new JobRunManager({
  jobs: queue,
  tasks: new ThreadTaskRunner(),
  puzzles,
  submissions,
  clock: systemClock,
  settings: config.jobs,
});

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => controller.abort());
}

console.log(`Worker ${config.workerId} polling for jobs`);
await runWorkerLoop({
  runs,
  workerId: config.workerId,
  pollMs: config.pollMs,
  sweepMs: config.jobs.staleMs / 2,
  signal: controller.signal,
});
db.close();
console.log(`Worker ${config.workerId} stopped`);
