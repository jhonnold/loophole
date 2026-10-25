import type { DailyRecord, GeneratedPuzzle } from "../domain.ts";
import type { Clock, DailyRepository, DailySeeder, WorkerMetrics } from "../ports.ts";
import { DAILY_SIZES } from "./daily-manager.ts";
import { addDays, dayStart, utcDay } from "./days.ts";
import type { JobManager } from "./job-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

export interface DailyStockSettings {
  /** How many days, today included, the scheduler keeps generated. */
  readonly daysAhead: number;
}

/** What one scheduler run did. */
export interface StockReport {
  /** Generation jobs queued, first tries and retries. */
  readonly queued: number;
  /** Today's size classes that have no puzzle yet: players can't play them. */
  readonly missingToday: readonly number[];
}

export interface DailyStockManagerDeps {
  readonly dailies: DailyRepository;
  readonly jobs: JobManager;
  readonly puzzles: PuzzleManager;
  readonly seeds: DailySeeder;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly settings: DailyStockSettings;
  /** Counts failed generations; tests may leave it out. */
  readonly metrics?: Pick<WorkerMetrics, "dailyFailure">;
}

/**
 * The worker's side of daily puzzles (PRD FR-22): keeps the next few days generated, retries
 * failed generations with the next seed, and stores what the jobs make.
 */
export class DailyStockManager {
  readonly #deps: DailyStockManagerDeps;

  constructor(deps: DailyStockManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Queues a generation for every day and size class from today to `daysAhead - 1` days on that
   * has none, and a retry with the next seed for every one whose job failed, timed out or is gone.
   * Safe to run from several workers at once: only one claims each day and size.
   */
  stock(): StockReport {
    const { dailies, jobs, clock, settings } = this.#deps;
    const today = utcDay(clock.now());
    let queued = 0;
    const missingToday: number[] = [];
    for (let i = 0; i < settings.daysAhead; i++) {
      const day = addDays(today, i);
      for (const size of DAILY_SIZES) {
        const row = dailies.get(day, size);
        if (row !== null && row.puzzleId !== null) continue;
        if (day === today) missingToday.push(size);
        if (row !== null) {
          const status = jobs.get(row.jobId)?.status ?? "lost";
          if (status === "queued" || status === "running" || status === "done") continue;
          this.#deps.metrics?.dailyFailure(size);
          console.warn(
            `Daily ${day} ${size}×${size}: generation attempt ${row.attempt} ${status}; trying the next seed`,
          );
        }
        if (this.#queue(day, size, row)) queued++;
      }
    }
    return { queued, missingToday };
  }

  /** For each size class, how many days in a row from today on have their puzzle generated. */
  stocked(): { size: number; days: number }[] {
    const { dailies, clock, settings } = this.#deps;
    return stockedDays(dailies, utcDay(clock.now()), settings.daysAhead);
  }

  /**
   * Stores the puzzle a daily's generation job made, hidden until its day starts, and links it to
   * the day. A job that a retry has replaced stores nothing.
   */
  async complete(jobId: string, day: string, generated: GeneratedPuzzle): Promise<void> {
    const { dailies, puzzles } = this.#deps;
    const size = generated.puzzle.width;
    if (dailies.get(day, size)?.jobId !== jobId) {
      console.warn(`Daily ${day} ${size}×${size}: job ${jobId} was replaced; not stored`);
      return;
    }
    await puzzles.saveDaily(jobId, generated, dayStart(day));
    dailies.setPuzzle(day, size, jobId, jobId, generated.puzzle.meta?.generator ?? null);
  }

  /**
   * Claims the day and size for a new job (first try, or the try after `row`) and queues it, in one
   * transaction: another worker never sees a claimed row whose job isn't in the queue yet.
   */
  #queue(day: string, size: number, row: DailyRecord | null): boolean {
    const { dailies, jobs, seeds, clock, newId } = this.#deps;
    const attempt = row === null ? 0 : row.attempt + 1;
    const jobId = newId();
    return dailies.atomically(() => {
      const claimed =
        row === null
          ? dailies.insert({
              day,
              size,
              attempt,
              jobId,
              puzzleId: null,
              generatorVersion: null,
              createdAt: clock.now(),
            })
          : dailies.retry(day, size, row.attempt, jobId);
      if (!claimed) return false;
      jobs.enqueueDaily(jobId, {
        width: size,
        height: size,
        seed: seeds.seed(day, size, attempt),
        day,
      });
      return true;
    });
  }
}

/**
 * For each daily size class, how many days in a row, from `today` up to `daysAhead` days, have
 * their puzzle generated. 0 means today's is missing: players can't play it.
 */
export function stockedDays(
  dailies: DailyRepository,
  today: string,
  daysAhead: number,
): { size: number; days: number }[] {
  return DAILY_SIZES.map((size) => {
    let days = 0;
    while (days < daysAhead && dailies.get(addDays(today, days), size)?.puzzleId) days++;
    return { size, days };
  });
}
