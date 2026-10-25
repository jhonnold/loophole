// Composition root for the OpenAPI document: builds the app over in-memory adapters, only to read
// its route definitions. `scripts/gen-api.ts` writes the result to openapi.yaml.
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { createApp } from "./app.ts";

export function openApiDocument() {
  const db = openDatabase(":memory:");
  const app = createApp({
    puzzles: new PuzzleManager({
      puzzles: new SqlitePuzzleRepository(db),
      blobs: new MemoryBlobStore(),
      clock: systemClock,
    }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      maxQueued: 1,
    }),
  });
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Loophole API",
      version: "0.1.0",
      description: "Puzzles and background jobs. Errors are RFC 9457 problem details.",
    },
  });
  db.close();
  return doc;
}
