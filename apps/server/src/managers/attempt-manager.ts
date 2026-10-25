import { decodeEdges, EdgeState, FormatError } from "@loophole/core";
import type { AttemptRecord, DailyRecord, PuzzleRecord } from "../domain.ts";
import type { AttemptRepository, Clock } from "../ports.ts";
import type { DailyManager } from "./daily-manager.ts";
import { addDays, streakLength } from "./days.ts";
import {
  AttemptNotFoundError,
  DailyEndedError,
  DailyNotFoundError,
  InvalidBoardError,
  WrongSolutionError,
} from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/**
 * How much less than the server measured a player's own time may be: a tenth of the server's time,
 * at least 3 s and at most 15 s. A solve can reach the server late (a slow network, a retry), so
 * the player's clock counts; but never by more than this, so a client can't claim a time it didn't
 * play, and on a small board the allowance stays small next to the time itself (DECISIONS, "Ranked
 * attempts and timing").
 */
export function rankedGraceMs(serverMs: number): number {
  return Math.min(15_000, Math.max(3_000, Math.round(serverMs / 10)));
}

/**
 * The least time a ranked solve of a W×H puzzle can take: 0.1 s per cell, at least 5 s. Drawing
 * the loop alone takes longer, so a faster solve was not played on the board and isn't ranked.
 */
export function minRankedMs(area: number): number {
  return Math.max(5_000, area * 100);
}

/** An attempt as a player sees it. */
export interface AttemptView {
  readonly attempt: AttemptRecord;
  /** Time on the ranked clock: until now while playing, the ranked time once finished. */
  readonly elapsedMs: number;
  /** Place on the puzzle's leaderboard, for a ranked solve; else null. */
  readonly rank: number | null;
}

/** What a player sends to finish an attempt. */
export interface FinishInput {
  /** The board, in the wire format's edge-state encoding. */
  readonly edges: string;
  /** The player's own clock since the attempt started. */
  readonly elapsedMs: number;
}

/** A player's daily status (PRD FR-24). */
export interface DailySummary {
  readonly day: string;
  /** Consecutive days, up to today, with a finished daily attempt. */
  readonly streak: number;
  /** The last seven days, oldest first, and whether each has a finished attempt. */
  readonly week: readonly { readonly day: string; readonly finished: boolean }[];
  /** Today's attempts. */
  readonly attempts: readonly AttemptView[];
  /** Best ranked time per leaderboard bucket. */
  readonly bests: readonly {
    readonly area: number;
    readonly level: number;
    readonly timeMs: number;
  }[];
}

export interface AttemptManagerDeps {
  readonly attempts: AttemptRepository;
  readonly dailies: DailyManager;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
}

/**
 * Ranked attempts at daily puzzles (PRD FR-17, FR-23 to FR-25). A player gets one attempt per daily,
 * started on its day. Its clock runs on the server from the start and never stops; finishing sends
 * the board, which must be the stored solution, and the player's own time, which counts if it is
 * within `rankedGraceMs` of the server's. A solve is ranked unless a hint was used during it or it
 * was faster than `minRankedMs`. The progress records stay the board players resume (DECISIONS).
 */
export class AttemptManager {
  readonly #deps: AttemptManagerDeps;

  constructor(deps: AttemptManagerDeps) {
    this.#deps = deps;
  }

  /** The user's attempt at a daily puzzle, or null. Throws `DailyNotFoundError`. */
  get(userId: string, puzzleId: string): AttemptView | null {
    this.#daily(puzzleId);
    const attempt = this.#deps.attempts.get(userId, puzzleId);
    return attempt === null ? null : this.#view(attempt);
  }

  /**
   * Starts the user's attempt at today's daily `puzzleId`, or returns the one already started.
   * Throws `DailyNotFoundError`, or `DailyEndedError` for an earlier day's daily.
   */
  start(userId: string, puzzleId: string): AttemptView {
    const { attempts, dailies, clock } = this.#deps;
    const { daily, puzzle } = this.#daily(puzzleId);
    const existing = attempts.get(userId, puzzleId);
    if (existing !== null) return this.#view(existing);
    if (!dailies.isLive(daily)) throw new DailyEndedError();
    const { width, height } = puzzle.puzzle.grid;
    attempts.insert({
      userId,
      puzzleId,
      day: daily.day,
      area: width * height,
      level: puzzle.level,
      startedAt: clock.now(),
      finishedAt: null,
      timeMs: null,
      assisted: false,
      ranked: false,
    });
    return this.#view(this.#stored(userId, puzzleId));
  }

  /**
   * Finishes the user's attempt with their board (PRD FR-17, FR-25). Sending a finished attempt's
   * solution again, as a retry does, returns it unchanged. Throws `DailyNotFoundError`,
   * `AttemptNotFoundError`, `InvalidBoardError` or `WrongSolutionError`.
   */
  async finish(userId: string, puzzleId: string, input: FinishInput): Promise<AttemptView> {
    const { attempts, puzzles, clock } = this.#deps;
    const { puzzle } = this.#daily(puzzleId);
    const before = attempts.get(userId, puzzleId);
    if (before === null) throw new AttemptNotFoundError();
    if (before.finishedAt !== null) return this.#view(before);
    let board: Uint8Array;
    try {
      board = decodeEdges(puzzle.puzzle.grid, input.edges);
    } catch (err) {
      if (err instanceof FormatError) throw new InvalidBoardError(err.message);
      throw err;
    }
    const solution = await puzzles.getSolution(puzzleId);
    if (solution === null) throw new Error(`Puzzle ${puzzleId} has no stored solution`);
    for (let e = 0; e < solution.length; e++) {
      if ((board[e] === EdgeState.Line) !== (solution[e] === EdgeState.Line)) {
        throw new WrongSolutionError();
      }
    }
    // Read again after the await: a hint may have marked the attempt meanwhile. From here to the
    // write nothing awaits, so nothing else runs in between.
    const attempt = this.#stored(userId, puzzleId);
    if (attempt.finishedAt !== null) return this.#view(attempt);
    const now = clock.now();
    const serverMs = Math.max(0, now - attempt.startedAt);
    const grace = rankedGraceMs(serverMs);
    const timeMs = Math.min(serverMs, Math.max(input.elapsedMs, serverMs - grace));
    const ranked = !attempt.assisted && timeMs >= minRankedMs(attempt.area);
    attempts.finish(userId, puzzleId, { finishedAt: now, timeMs, ranked });
    return this.#view(this.#stored(userId, puzzleId));
  }

  /**
   * Records that the user was shown a hint on `puzzleId` (PRD FR-12): their unfinished attempt at
   * it, if any, becomes assisted and won't be ranked. Returns whether the puzzle is today's daily.
   */
  recordHint(userId: string | null, puzzleId: string): boolean {
    const { attempts, dailies } = this.#deps;
    const daily = dailies.byPuzzle(puzzleId);
    if (daily === null) return false;
    if (userId !== null) attempts.markAssisted(userId, puzzleId);
    return dailies.isLive(daily);
  }

  /** The user's streak, last week, today's attempts and best times (PRD FR-24). */
  summary(userId: string): DailySummary {
    const { attempts, dailies } = this.#deps;
    const today = dailies.today();
    const days = new Set(attempts.finishedDays(userId));
    const week = [6, 5, 4, 3, 2, 1, 0].map((back) => {
      const day = addDays(today, -back);
      return { day, finished: days.has(day) };
    });
    return {
      day: today,
      streak: streakLength(days, today),
      week,
      attempts: attempts.listForDay(userId, today).map((a) => this.#view(a)),
      bests: attempts.bests(userId),
    };
  }

  #daily(puzzleId: string): { daily: DailyRecord; puzzle: PuzzleRecord } {
    const daily = this.#deps.dailies.byPuzzle(puzzleId);
    const puzzle = this.#deps.puzzles.get(puzzleId);
    if (daily === null || puzzle === null) throw new DailyNotFoundError();
    return { daily, puzzle };
  }

  #stored(userId: string, puzzleId: string): AttemptRecord {
    const attempt = this.#deps.attempts.get(userId, puzzleId);
    if (attempt === null) throw new Error(`Attempt ${userId}/${puzzleId} is missing`);
    return attempt;
  }

  #view(attempt: AttemptRecord): AttemptView {
    const elapsedMs = attempt.timeMs ?? Math.max(0, this.#deps.clock.now() - attempt.startedAt);
    let rank: number | null = null;
    if (attempt.ranked) {
      const board = this.#deps.attempts.puzzleBoard(attempt.puzzleId, attempt.userId, 0);
      rank = board.entries.find((e) => e.userId === attempt.userId)?.rank ?? null;
    }
    return { attempt, elapsedMs, rank };
  }
}
