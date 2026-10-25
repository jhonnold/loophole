import { decodeEdges, FormatError, findHint, type Hint } from "@loophole/core";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** The board sent for a hint does not fit the puzzle (wrong length or a bad character). */
export class InvalidBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBoardError";
  }
}

/**
 * How long a hint request may look for a deduction. Generated puzzles answer in a few ms; a
 * submitted puzzle that needs search (WT10) gets a revealed line after this instead of tying up the
 * API thread.
 */
export const HINT_TIME_LIMIT_MS = 500;

export interface HintManagerDeps {
  readonly puzzles: PuzzleManager;
}

/**
 * Hints for published puzzles (PRD FR-6, FR-12): the next deduction from a player's board, worked
 * out against the stored solution, which never leaves the server (FR-25). Ranked play (WT11) will
 * record here that a player took a hint.
 */
export class HintManager {
  readonly #deps: HintManagerDeps;

  constructor(deps: HintManagerDeps) {
    this.#deps = deps;
  }

  /**
   * The hint for `edges` (the edge-state encoding) on puzzle `id`, or null when there is no
   * published puzzle with that id. Throws `InvalidBoardError` when `edges` does not fit the puzzle.
   */
  async hint(id: string, edges: string): Promise<Hint | null> {
    const { puzzles } = this.#deps;
    const record = puzzles.get(id);
    if (record === null) return null;
    let board: Uint8Array;
    try {
      board = decodeEdges(record.puzzle.grid, edges);
    } catch (err) {
      if (err instanceof FormatError) throw new InvalidBoardError(err.message);
      throw err;
    }
    const solution = await puzzles.getSolution(id);
    if (solution === null) throw new Error(`Puzzle ${id} has no stored solution`);
    return findHint(record.puzzle, solution, board, { timeLimitMs: HINT_TIME_LIMIT_MS });
  }
}
