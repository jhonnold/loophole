// Composition root of the job worker process: reads the settings, builds the adapters and
// managers, and runs jobs until SIGINT or SIGTERM. The job in progress finishes first.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { hmacDailySeeder } from "../adapters/daily-seeds.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { installJsonLogging } from "../adapters/logging.ts";
import {
  createRegistry,
  PrometheusWorkerMetrics,
  serveMetrics,
} from "../adapters/metrics/prometheus.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { DailyStockManager } from "../managers/daily-stock-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { runWorkerLoop } from "./loop.ts";

installJsonLogging({ process: "worker" });
const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
const registry = createRegistry(config.version);

const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs: new S3BlobStore(config.s3),
  clock: systemClock,
});
const queue = new SqliteJobQueue(db);
const jobs = new JobManager({
  jobs: queue,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  maxQueued: config.maxQueuedJobs,
});
// The worker only decides submissions; queueing them and the per-account limit are the API's.
const submissionRepo = new SqliteSubmissionRepository(db);
const submissions = new SubmissionManager({
  submissions: submissionRepo,
  puzzles,
  jobs,
  limiter: new MemoryRateLimiter(systemClock),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
// Reads the queue and the daily stock whenever Prometheus scrapes; `dailies` is set just below.
const metrics: PrometheusWorkerMetrics = new PrometheusWorkerMetrics(registry, {
  activeJobs: () => queue.countActive(),
  dailiesStocked: () => dailies.stocked(),
  submissionVerdicts: () => submissionRepo.countByVerdict(),
});
// Keeps the coming days' daily puzzles generated (PRD FR-22).
const dailies: DailyStockManager = new DailyStockManager({
  dailies: new SqliteDailyRepository(db),
  jobs,
  puzzles,
  seeds: hmacDailySeeder(config.dailies.seedSecret),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  settings: { daysAhead: config.dailies.daysAhead },
  metrics,
});
const runs = new JobRunManager({
  jobs: queue,
  tasks: new ThreadTaskRunner(),
  puzzles,
  submissions,
  dailies,
  clock: systemClock,
  settings: config.jobs,
  metrics,
});

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => controller.abort());
}

const metricsServer =
  config.metrics.workerPort === 0
    ? null
    : serveMetrics(registry, config.metrics.host, config.metrics.workerPort);
if (metricsServer !== null) console.log(`Worker metrics on ${metricsServer.url}metrics`);
console.log(`Worker ${config.workerId} polling for jobs`);
await runWorkerLoop({
  runs,
  dailies,
  workerId: config.workerId,
  pollMs: config.pollMs,
  sweepMs: config.jobs.staleMs / 2,
  stockMs: config.dailies.stockMs,
  signal: controller.signal,
});
metricsServer?.stop();
db.close();
console.log(`Worker ${config.workerId} stopped`);
