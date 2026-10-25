import { createPuzzle, serializePuzzle } from "@loophole/core";
import type { GeneratedPuzzle } from "../domain.ts";
import { dayStart } from "../managers/days.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { DailyRepository } from "../ports.ts";

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
