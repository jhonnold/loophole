import type { Database } from "bun:sqlite";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { Clock } from "../ports.ts";

/** The progress manager over SQLite on `db`, for route tests: pass it to `createApp` as `progress`. */
export function sqliteProgress(
  db: Database,
  puzzles: PuzzleManager,
  clock: Clock,
): ProgressManager {
  return new ProgressManager({ progress: new SqliteProgressRepository(db), puzzles, clock });
}
