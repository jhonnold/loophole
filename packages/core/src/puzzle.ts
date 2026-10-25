import { createGrid, EdgeState, type Grid } from "./grid.ts";

/** Marks a cell without a clue in `Puzzle.clues`. */
export const NO_CLUE = -1;

export interface Puzzle {
  readonly grid: Grid;
  /** One entry per cell, row-major: 0–3, or `NO_CLUE`. */
  readonly clues: Int8Array;
  readonly seed?: string;
  readonly meta?: Readonly<Record<string, string>>;
}

export interface PuzzleOptions {
  readonly seed?: string;
  readonly meta?: Readonly<Record<string, string>>;
}

/**
 * Builds a puzzle. `clues` defaults to no clues. Throws `RangeError` for a bad size, a clues array
 * of the wrong length, or a clue outside 0–3 and `NO_CLUE`. Use `parsePuzzle` for untrusted input.
 */
export function createPuzzle(
  width: number,
  height: number,
  clues?: ArrayLike<number>,
  options: PuzzleOptions = {},
): Puzzle {
  const grid = createGrid(width, height);
  const out = new Int8Array(grid.cellCount).fill(NO_CLUE);
  if (clues !== undefined) {
    if (clues.length !== grid.cellCount) {
      throw new RangeError(`expected ${grid.cellCount} clues, got ${clues.length}`);
    }
    for (let i = 0; i < grid.cellCount; i++) {
      const k = clues[i];
      if (k !== NO_CLUE && k !== 0 && k !== 1 && k !== 2 && k !== 3) {
        throw new RangeError(`clue at cell ${i} must be 0-3 or ${NO_CLUE}, got ${k}`);
      }
      out[i] = k;
    }
  }
  const puzzle: { grid: Grid; clues: Int8Array; seed?: string; meta?: Record<string, string> } = {
    grid,
    clues: out,
  };
  if (options.seed !== undefined) puzzle.seed = options.seed;
  if (options.meta !== undefined) puzzle.meta = { ...options.meta };
  return puzzle;
}

/**
 * Counts the `Line` sides of every cell. Values are 0–4; a 4 only happens when the loop is that one
 * cell, so map 4 to `NO_CLUE` before using the result as clues.
 */
export function deriveClues(grid: Grid, edges: Uint8Array): Int8Array {
  const clues = new Int8Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      if (edges[grid.cellEdges[i * 4 + j]] === EdgeState.Line) n++;
    }
    clues[i] = n;
  }
  return clues;
}
