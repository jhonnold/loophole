import { EdgeState, type Grid, NONE } from "./grid.ts";
import { NO_CLUE, type Puzzle } from "./puzzle.ts";

/** Largest grid area `bruteForceSolutions` accepts: it tries 2^cells colourings. */
export const BRUTE_FORCE_MAX_CELLS = 20;

/**
 * Finds solutions by trying every way to colour the cells inside or outside, in increasing bitmask
 * order (bit i set = cell i inside). This is a test oracle: slow, simple, and sharing no logic with
 * the solver.
 *
 * Why it finds every solution exactly once: a single closed loop splits the cells into inside and
 * outside, and an edge is on the loop exactly when the cells on its two sides differ (with
 * everything beyond the border counting as outside). So each solution is the boundary of exactly
 * one non-empty inside set. Each colouring's boundary is kept only if it is one closed loop that
 * satisfies every clue.
 *
 * Returns at most `limit` solutions, each a full edge-state array (`Line` or `Cross`, never
 * `Unknown`). Throws `RangeError` when the grid has more than `BRUTE_FORCE_MAX_CELLS` cells.
 */
export function bruteForceSolutions(puzzle: Puzzle, limit = 2): Uint8Array[] {
  const { grid, clues } = puzzle;
  const n = grid.cellCount;
  if (n > BRUTE_FORCE_MAX_CELLS) {
    throw new RangeError(`brute force supports at most ${BRUTE_FORCE_MAX_CELLS} cells, got ${n}`);
  }
  if (!(limit >= 1)) throw new RangeError(`limit must be at least 1, got ${limit}`);

  const solutions: Uint8Array[] = [];
  const inside = new Uint8Array(n);
  const total = 2 ** n;
  for (let mask = 1; mask < total && solutions.length < limit; mask++) {
    for (let i = 0; i < n; i++) inside[i] = (mask >>> i) & 1;
    const edges = boundary(grid, inside);
    if (cluesMatch(grid, clues, edges) && isOneLoop(grid, edges)) solutions.push(edges);
  }
  return solutions;
}

/** Number of solutions, counting no further than `limit`. */
export function countSolutions(puzzle: Puzzle, limit = 2): number {
  return bruteForceSolutions(puzzle, limit).length;
}

function boundary(grid: Grid, inside: Uint8Array): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  for (let e = 0; e < grid.edgeCount; e++) {
    const a = grid.edgeCells[e * 2];
    const b = grid.edgeCells[e * 2 + 1];
    const inA = a === NONE ? 0 : inside[a];
    const inB = b === NONE ? 0 : inside[b];
    edges[e] = inA !== inB ? EdgeState.Line : EdgeState.Cross;
  }
  return edges;
}

function cluesMatch(grid: Grid, clues: Int8Array, edges: Uint8Array): boolean {
  for (let i = 0; i < grid.cellCount; i++) {
    if (clues[i] === NO_CLUE) continue;
    let lines = 0;
    for (let j = 0; j < 4; j++) {
      if (edges[grid.cellEdges[i * 4 + j]] === EdgeState.Line) lines++;
    }
    if (lines !== clues[i]) return false;
  }
  return true;
}

/** True when the lines are non-empty, every dot touches 0 or 2 of them, and they are all connected. */
function isOneLoop(grid: Grid, edges: Uint8Array): boolean {
  let lineCount = 0;
  let first = NONE;
  for (let e = 0; e < grid.edgeCount; e++) {
    if (edges[e] !== EdgeState.Line) continue;
    lineCount++;
    if (first === NONE) first = e;
  }
  if (lineCount === 0) return false;

  for (let d = 0; d < grid.dotCount; d++) {
    let degree = 0;
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e !== NONE && edges[e] === EdgeState.Line) degree++;
    }
    if (degree !== 0 && degree !== 2) return false;
  }

  const reached = new Uint8Array(grid.edgeCount);
  const stack = [first];
  reached[first] = 1;
  let reachedCount = 0;
  while (stack.length > 0) {
    const e = stack.pop() as number;
    reachedCount++;
    for (let k = 0; k < 2; k++) {
      const d = grid.edgeDots[e * 2 + k];
      for (let j = 0; j < 4; j++) {
        const next = grid.dotEdges[d * 4 + j];
        if (next !== NONE && edges[next] === EdgeState.Line && !reached[next]) {
          reached[next] = 1;
          stack.push(next);
        }
      }
    }
  }
  return reachedCount === lineCount;
}
