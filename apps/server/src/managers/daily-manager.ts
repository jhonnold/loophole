import { DEFAULT_LEVEL, type Level } from "@loophole/core";
import type { DailyRecord } from "../domain.ts";
import type { Clock, DailyRepository } from "../ports.ts";
import { addDays, dayStart, utcDay } from "./days.ts";
import { DailyNotFoundError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/**
 * The daily size classes (PRD §14 question 6, design kit) and the level each one's puzzle is made
 * at (PRD FR-22, FR-23): each day has a W×W puzzle of each, at that level. One level per size
 * class; all hard for now (DECISIONS, WT21 "Levels on the server").
 */
export const DAILY_CLASSES: readonly { readonly size: number; readonly level: Level }[] = [
  { size: 7, level: "hard" },
  { size: 10, level: "hard" },
  { size: 20, level: "hard" },
  { size: 40, level: "hard" },
];

/** The daily size classes, smallest first. */
export const DAILY_SIZES: readonly number[] = DAILY_CLASSES.map((c) => c.size);

/** The level a size class's daily puzzle is made at; hard for a size without a daily. */
export function dailyLevel(size: number): Level {
  return DAILY_CLASSES.find((c) => c.size === size)?.level ?? DEFAULT_LEVEL;
}

/** A day's daily puzzles. */
export interface DailySet {
  readonly day: string;
  /** The day is today, so its puzzles can be played ranked. */
  readonly live: boolean;
  /** When the next day's puzzles come out: the next 00:00 UTC. */
  readonly nextAt: number;
  /**
   * One per size class, smallest first; `puzzleId` is null while the puzzle isn't ready. `level` is
   * the stored puzzle's, or the size class's while there is none.
   */
  readonly puzzles: readonly {
    readonly size: number;
    readonly level: Level;
    readonly puzzleId: string | null;
  }[];
}

export interface DailyManagerDeps {
  readonly dailies: DailyRepository;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
}

/**
 * Which puzzles are the daily puzzles (PRD FR-22): one per size class, the same for everyone,
 * switching at 00:00 UTC. The worker makes them ahead of time (`DailyStockManager`); a daily
 * puzzle stays hidden until its day starts.
 */
export class DailyManager {
  readonly #deps: DailyManagerDeps;

  constructor(deps: DailyManagerDeps) {
    this.#deps = deps;
  }

  /** Today's UTC day. */
  today(): string {
    return utcDay(this.#deps.clock.now());
  }

  /** The daily puzzles of `day` (today by default). Throws `DailyNotFoundError` for a day to come. */
  forDay(day = this.today()): DailySet {
    const { dailies, puzzles } = this.#deps;
    const today = this.today();
    if (day > today) throw new DailyNotFoundError("That day's daily puzzles aren't out yet.");
    const rows = new Map(dailies.listDay(day).map((r) => [r.size, r]));
    return {
      day,
      live: day === today,
      nextAt: dayStart(addDays(today, 1)),
      puzzles: DAILY_SIZES.map((size) => {
        const puzzleId = rows.get(size)?.puzzleId ?? null;
        // An admin may have unpublished a broken daily.
        const record = puzzleId === null ? null : puzzles.get(puzzleId);
        return {
          size,
          level: record?.level ?? dailyLevel(size),
          puzzleId: record === null ? null : puzzleId,
        };
      }),
    };
  }

  /** The daily that a puzzle players can see is, or null when it isn't one. */
  byPuzzle(puzzleId: string): DailyRecord | null {
    if (this.#deps.puzzles.get(puzzleId) === null) return null;
    return this.#deps.dailies.getByPuzzle(puzzleId);
  }

  /** Whether `daily` is today's, so it can be played ranked. */
  isLive(daily: DailyRecord): boolean {
    return daily.day === this.today();
  }
}
