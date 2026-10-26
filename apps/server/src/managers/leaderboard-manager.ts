import type { Level } from "@loophole/core";
import type { LeaderboardEntry, LeaderboardSlice } from "../domain.ts";
import type { AttemptRepository } from "../ports.ts";
import type { DailyManager } from "./daily-manager.ts";
import { DailyNotFoundError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** A leaderboard as served: its bucket, its top rows and the viewer's place. */
export interface Leaderboard {
  /** The bucket (PRD FR-23): width × height, and the level. */
  readonly area: number;
  readonly level: Level;
  /** How many players are on it. */
  readonly total: number;
  /** The top rows, then the viewer's row and its neighbours, by rank. */
  readonly entries: readonly LeaderboardEntry[];
  /** The viewer's own row, or null when they aren't on the board. */
  readonly me: LeaderboardEntry | null;
}

export interface LeaderboardManagerDeps {
  readonly attempts: AttemptRepository;
  readonly dailies: DailyManager;
  readonly puzzles: PuzzleManager;
}

/**
 * Leaderboards (PRD FR-23): ranked solves of daily puzzles by time, bucketed by area and level, with
 * hinted and implausibly fast solves left out. Each daily has its own board, and each bucket has an
 * all-time board of every player's best time.
 */
export class LeaderboardManager {
  readonly #deps: LeaderboardManagerDeps;

  constructor(deps: LeaderboardManagerDeps) {
    this.#deps = deps;
  }

  /** The board of one daily puzzle. Throws `DailyNotFoundError`. */
  forPuzzle(puzzleId: string, viewerId: string | null, limit: number): Leaderboard {
    const { attempts, dailies, puzzles } = this.#deps;
    const record = puzzles.get(puzzleId);
    if (record === null || dailies.byPuzzle(puzzleId) === null) throw new DailyNotFoundError();
    const { width, height } = record.puzzle.grid;
    const slice = attempts.puzzleBoard(puzzleId, viewerId, limit);
    return board(width * height, record.level, slice, viewerId);
  }

  /** The all-time board of one bucket: each player's best ranked time. */
  forBucket(area: number, level: Level, viewerId: string | null, limit: number): Leaderboard {
    const slice = this.#deps.attempts.bucketBoard(area, level, viewerId, limit);
    return board(area, level, slice, viewerId);
  }
}

function board(
  area: number,
  level: Level,
  slice: LeaderboardSlice,
  viewerId: string | null,
): Leaderboard {
  const me = slice.entries.find((e) => e.userId === viewerId) ?? null;
  return { area, level, total: slice.total, entries: slice.entries, me };
}
