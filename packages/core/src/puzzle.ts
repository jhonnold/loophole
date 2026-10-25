import { createGrid, EdgeState, type Grid } from "./grid.ts";

/** Marks a cell without a clue in `Puzzle.clues`. */
export const NO_CLUE = -1;

/** Limits on seeds and meta, shared with the wire format. A puzzle built here always serializes. */
export const MAX_SEED_LENGTH = 128;
export const MAX_META_ENTRIES = 32;
export const MAX_META_KEY_LENGTH = 64;
export const MAX_META_VALUE_LENGTH = 1024;

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
 * of the wrong length, a clue outside 0–3 and `NO_CLUE`, or a seed or meta that the wire format
 * would reject. Use `parsePuzzle` for untrusted input.
 */
export function createPuzzle(
  width: number,
  height: number,
  clues?: ArrayLike<number>,
  options: PuzzleOptions = {},
): Puzzle {
  const grid = createGrid(width, height);
  const out = new Int8Array(grid.cellCount).fill(NO_CLUE);
  const { seed, meta } = options;
  if (seed !== undefined && (seed.length < 1 || seed.length > MAX_SEED_LENGTH)) {
    throw new RangeError(`seed must be 1 to ${MAX_SEED_LENGTH} characters, got ${seed.length}`);
  }
  if (meta !== undefined) {
    const entries = Object.entries(meta);
    if (entries.length > MAX_META_ENTRIES) {
      throw new RangeError(
        `meta must have at most ${MAX_META_ENTRIES} entries, got ${entries.length}`,
      );
    }
    for (const [key, value] of entries) {
      if (key.length < 1 || key.length > MAX_META_KEY_LENGTH) {
        throw new RangeError(
          `meta keys must be 1 to ${MAX_META_KEY_LENGTH} characters, got ${JSON.stringify(key)}`,
        );
      }
      if (value.length > MAX_META_VALUE_LENGTH) {
        throw new RangeError(
          `meta.${key} must be at most ${MAX_META_VALUE_LENGTH} characters, got ${value.length}`,
        );
      }
    }
  }
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
