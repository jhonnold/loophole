import { analyzeBoard } from "./analyze.ts";
import { EdgeState, type Grid } from "./grid.ts";
import type { Puzzle } from "./puzzle.ts";
import type { Step } from "./rules.ts";
import { solve } from "./solver.ts";

/**
 * What a hint shows (PRD FR-12), from the player's board and the puzzle's solution:
 * - `solved`: the board is already complete.
 * - `mistake`: `edge` is marked differently from the solution (the lowest such edge); `count` is how
 *   many marks are wrong in all. Mistakes come first, because deductions from a board with a wrong
 *   mark would not make sense to the player.
 * - `step`: the next deduction from the player's board, as the rule solver records it.
 * - `reveal`: no rule applies, so `edge` is one line of the solution, preferably one that extends a
 *   line already on the board.
 */
export type Hint =
  | { readonly kind: "solved" }
  | { readonly kind: "mistake"; readonly edge: number; readonly count: number }
  | { readonly kind: "step"; readonly step: Step }
  | { readonly kind: "reveal"; readonly edge: number };

export interface HintOptions {
  /**
   * Stop looking for a deduction after this many milliseconds, measured with `now`, and reveal a
   * line instead. Default no limit.
   */
  readonly timeLimitMs?: number;
  /** Clock in milliseconds. Default `Date.now`. */
  readonly now?: () => number;
}

/**
 * The next hint for `board` (PRD FR-6, FR-12). `solution` is the puzzle's solution as edge states,
 * and `board` the player's marks; neither is modified. Throws `RangeError` when either has the wrong
 * length.
 */
export function findHint(
  puzzle: Puzzle,
  solution: Uint8Array,
  board: Uint8Array,
  options: HintOptions = {},
): Hint {
  const { grid } = puzzle;
  if (solution.length !== grid.edgeCount || board.length !== grid.edgeCount) {
    throw new RangeError(
      `expected ${grid.edgeCount} edge states, got ${solution.length} and ${board.length}`,
    );
  }
  if (analyzeBoard(puzzle, board).solved) return { kind: "solved" };

  let first = -1;
  let count = 0;
  for (let e = 0; e < grid.edgeCount; e++) {
    if (board[e] === EdgeState.Unknown || board[e] === solution[e]) continue;
    if (first < 0) first = e;
    count++;
  }
  if (count > 0) return { kind: "mistake", edge: first, count };

  // Every mark agrees with the solution, so the solver's deductions from the board are sound. A
  // solve stopped by the time limit has no step and falls through to a revealed line.
  const result = solve(puzzle, { ...options, initial: board, maxSteps: 1 });
  const step = result.steps[0];
  if (step !== undefined) return { kind: "step", step };
  return { kind: "reveal", edge: revealEdge(grid, solution, board) };
}

/**
 * An open edge that is a line in the solution: the first one, in edge order, that touches a dot
 * where exactly one line ends, or else the first one. One exists whenever the board is unsolved and
 * has no mistakes.
 */
function revealEdge(grid: Grid, solution: Uint8Array, board: Uint8Array): number {
  let fallback = -1;
  for (let e = 0; e < grid.edgeCount; e++) {
    if (board[e] !== EdgeState.Unknown || solution[e] !== EdgeState.Line) continue;
    if (fallback < 0) fallback = e;
    if (lineDegree(grid, board, grid.edgeDots[e * 2]) === 1) return e;
    if (lineDegree(grid, board, grid.edgeDots[e * 2 + 1]) === 1) return e;
  }
  return fallback;
}

function lineDegree(grid: Grid, board: Uint8Array, dot: number): number {
  let n = 0;
  for (let j = 0; j < 4; j++) {
    const e = grid.dotEdges[dot * 4 + j];
    if (e >= 0 && board[e] === EdgeState.Line) n++;
  }
  return n;
}
