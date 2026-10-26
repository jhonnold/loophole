import { decodeEdges, type PuzzleWireV1, parsePuzzle } from "../format.ts";
import type { Puzzle } from "../puzzle.ts";
import type { VerifyOptions } from "../verify.ts";
import entries from "./clue-gaps.json";

/**
 * How the benchmark and the corpus test call `verify`: a node budget and no time limit, so the
 * answer is deterministic (DECISIONS, WT2). Defined once so the two cannot drift apart.
 */
export const CLUE_GAP_VERIFY_OPTIONS: VerifyOptions = {
  maxNodes: 10_000,
  timeLimitMs: Number.POSITIVE_INFINITY,
};

/** One entry of `clue-gaps.json`, written by `bench/clue-gaps.ts --write-corpus`. */
export interface ClueGapEntry {
  /** `<generate seed>#<cell>`: the generated puzzle it came from and the clue taken out. */
  readonly id: string;
  /**
   * The generated puzzle without that clue, in the v1 wire format. It keeps the generated puzzle's
   * `seed`, but it is that puzzle minus one clue, so `generate` with that seed does not make it.
   */
  readonly puzzle: PuzzleWireV1;
  /** Index of the cell whose clue was taken out. */
  readonly cell: number;
  /** The clue taken out, 0–3. */
  readonly clue: number;
  /** The edges today's solver decided before it got stuck on `puzzle`, as `encodeEdges` text. */
  readonly stuck: string;
}

/** A corpus entry, parsed. */
export interface ClueGapCase {
  readonly id: string;
  readonly puzzle: Puzzle;
  readonly cell: number;
  readonly clue: number;
  readonly stuck: Uint8Array;
}

/**
 * Boards with exactly one solution where the rule solver got stuck when the corpus was made
 * (WT14), smallest first: generated puzzles with one kept clue taken out. Rule tests for later
 * solver work start from these.
 */
export function clueGapCorpus(): ClueGapCase[] {
  return (entries as ClueGapEntry[]).map((e) => {
    const puzzle = parsePuzzle(e.puzzle);
    return {
      id: e.id,
      puzzle,
      cell: e.cell,
      clue: e.clue,
      stuck: decodeEdges(puzzle.grid, e.stuck),
    };
  });
}
