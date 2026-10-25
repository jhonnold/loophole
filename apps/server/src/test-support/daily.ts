import type { Database } from "bun:sqlite";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { SqliteAttemptRepository } from "../adapters/db/attempt-repository.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { SqliteDisplayNameRepository } from "../adapters/db/display-name-repository.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { GeneratedPuzzle } from "../domain.ts";
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { dayStart } from "../managers/days.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { Clock, DailyRepository } from "../ports.ts";

/** 2×2 all 2s, as a generation job makes it; its only loop runs around the outside. */
export const SMALL_DAILY: GeneratedPuzzle = {
  puzzle: serializePuzzle(
    createPuzzle(2, 2, [2, 2, 2, 2], { seed: "secret-seed", meta: { generator: "1" } }),
  ),
  solution: "112211121121",
  steps: [],
};

/**
 * Stores `SMALL_DAILY` as the daily of `day` for size class `size` under puzzle id `id`, as the
 * worker would, hidden until the day starts.
 */
export async function storeDaily(
  dailies: DailyRepository,
  puzzles: PuzzleManager,
  day: string,
  id: string,
  size = 7,
): Promise<void> {
  await puzzles.saveDaily(id, SMALL_DAILY, dayStart(day));
  dailies.insert({
    day,
    size,
    attempt: 0,
    jobId: id,
    puzzleId: id,
    generatorVersion: "1",
    createdAt: 0,
  });
}

/**
 * The daily side of the API for route tests: SQLite repositories on `db`, the hint manager that
 * records assists, and a rate limiter of its own. Spread the result into `createApp`'s deps.
 */
export function dailyDeps(db: Database, clock: Clock, puzzles: PuzzleManager) {
  const dailyRepo = new SqliteDailyRepository(db);
  const attemptRepo = new SqliteAttemptRepository(db);
  const dailies = new DailyManager({ dailies: dailyRepo, puzzles, clock });
  const attempts = new AttemptManager({ attempts: attemptRepo, dailies, puzzles, clock });
  return {
    dailyRepo,
    dailies,
    attempts,
    hints: new HintManager({ puzzles, attempts }),
    leaderboards: new LeaderboardManager({ attempts: attemptRepo, dailies, puzzles }),
    displayNames: new DisplayNameManager({
      names: new SqliteDisplayNameRepository(db),
      limiter: new MemoryRateLimiter(clock),
      clock,
    }),
  };
}
