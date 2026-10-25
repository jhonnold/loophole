import { deriveClues, NO_CLUE, type Puzzle } from "@loophole/core";

/** A clue that would rule out the second of two answers. */
export interface Suggestion {
  readonly cell: number;
  readonly clue: number;
}

/**
 * For a puzzle with two answers `a` and `b` (edge states): the first empty cell, in reading order,
 * whose side count differs between them, with its count in `a`. That clue keeps `a` and rules out
 * `b`. Null when every empty cell has the same count in both, so no single new clue tells them
 * apart.
 */
export function suggestClue(puzzle: Puzzle, a: Uint8Array, b: Uint8Array): Suggestion | null {
  const { grid, clues } = puzzle;
  const countA = deriveClues(grid, a);
  const countB = deriveClues(grid, b);
  for (let i = 0; i < grid.cellCount; i++) {
    if (clues[i] !== NO_CLUE || countA[i] === countB[i] || countA[i] > 3) continue;
    return { cell: i, clue: countA[i] };
  }
  return null;
}
