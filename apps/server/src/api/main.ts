// Composition root of the HTTP API process: reads the settings, builds the adapters and managers,
// and serves the app.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { loadConfig } from "../config.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { createApp } from "./app.ts";

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);

const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs: new S3BlobStore(config.s3),
  clock: systemClock,
});
const jobs = new JobManager({
  jobs: new SqliteJobQueue(db),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  maxQueued: config.maxQueuedJobs,
});
const app = createApp({ puzzles, jobs, webDir: config.webDir });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // Outer cap; the app itself refuses API bodies over 64 KiB.
  maxRequestBodySize: 1024 * 1024,
  fetch: app.fetch,
});
console.log(`API listening on ${server.url}`);
