import type { Database } from "bun:sqlite";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { HealthManager } from "../managers/health-manager.ts";
import type { BlobStore, Clock } from "../ports.ts";

/** The health manager for route tests, over the SQLite tables on `db` and an in-memory blob store. */
export function healthManager(
  db: Database,
  clock: Clock,
  blobs: BlobStore = new MemoryBlobStore(),
) {
  return new HealthManager({
    jobs: new SqliteJobQueue(db),
    dailies: new SqliteDailyRepository(db),
    blobs,
    clock,
    daysAhead: 3,
    versions: { app: "test", runtime: "bun test" },
    checkTimeoutMs: 1000,
  });
}
