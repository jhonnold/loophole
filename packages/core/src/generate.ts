import { EdgeState, type Grid } from "./grid.ts";
import { generateLoop, LOOP_THRESHOLDS, type LoopThresholds } from "./loop.ts";
import { createPuzzle, deriveClues, NO_CLUE, type Puzzle } from "./puzzle.ts";
import { createRng, type Rng } from "./rng.ts";
import { type SolveResult, solve } from "./solver.ts";

/**
 * Version of the generator's output. The same seed, size and options give the same puzzle for the
 * same version (PRD FR-10). Bump it whenever any output changes, including through a change to the
 * solver's rules, which decide which clues can go.
 */
export const GENERATOR_VERSION = "3";

/** A clue's removal is tested with the edges this many cells around it unknown, the rest given. */
const WINDOW_RADIUS = 3;
/** Clues put back in one round are more than this many rows or columns apart. */
const RESTORE_SPACING = 2;
/** Loops tried before giving up. Only 2×2 and rare small boards need a second; this bounds the loop. */
const MAX_ATTEMPTS = 100;

export interface GenerateProgress {
  /** Clue removal tests done so far. */
  readonly done: number;
  /** Clue removal tests this attempt makes in all. */
  readonly total: number;
}

export interface GenerateOptions {
  readonly width: number;
  readonly height: number;
  /** Any string from 1 to 128 characters. The core never picks one itself. */
  readonly seed: string;
  /** Default `LOOP_THRESHOLDS`. */
  readonly thresholds?: LoopThresholds;
  /**
   * Called after every clue removal test. Purely informational: it does not change the result.
   * Throw from it to stop generation; the error propagates out of `generate`.
   */
  readonly onProgress?: (progress: GenerateProgress) => void;
}

export interface GenerateStats {
  /** Loops made, counting rejected ones. 1 unless a loop was rejected. */
  readonly attempts: number;
  readonly clueCount: number;
  /** Clue removal tests made. */
  readonly checks: number;
  /** Clues put back because the whole puzzle got stuck without them. */
  readonly restored: number;
}

export interface GenerateResult {
  /** Has `seed` and `meta.generator` = `GENERATOR_VERSION`. */
  readonly puzzle: Puzzle;
  /** The only solution, as edge states (`Line` and `Cross`). */
  readonly solution: Uint8Array;
  /** `solve(puzzle)` from an empty board: status `solved`, steps for hints (FR-6). */
  readonly solve: SolveResult;
  readonly stats: GenerateStats;
}

/**
 * Generates a puzzle with exactly one solution (PRD FR-7 to FR-10).
 *
 * 1. Make a random winding loop that meets the thresholds (`generateLoop`).
 * 2. Give every cell its clue (a cell with 4 lines gets none). If the rule
 *    solver cannot solve that (two loops can share every clue, as the L shapes on a 2×2 board do),
 *    try a new loop, with one more cell added after shaping than the last.
 * 3. In random order, remove each clue if the solver can still decide the 7×7 window of cells
 *    around it with every edge outside the window given. This local test is cheap but generous.
 * 4. Solve the whole puzzle from scratch. While it gets stuck, put back removed clues next to the
 *    open edges, spread out, and solve again.
 *
 * The result is solved by the rules alone, which proves it has one solution (PRD §9). Uses only the
 * seeded generator and no clock, so it is deterministic. Throws `RangeError` for a bad size, seed or
 * thresholds.
 */
export function generate(options: GenerateOptions): GenerateResult {
  const { width, height, seed, onProgress } = options;
  const thresholds = options.thresholds ?? LOOP_THRESHOLDS;
  // Each field by name, so a partial object (say, parsed JSON) fails here too.
  for (const name of ["minCoverage", "minSpan"] as const) {
    const share = thresholds[name];
    if (!(share >= 0 && share <= 1)) {
      throw new RangeError(`thresholds.${name} must be from 0 to 1, got ${share}`);
    }
  }
  const meta = { generator: GENERATOR_VERSION };
  // Checks the size and seed before any work.
  const grid = createPuzzle(width, height, undefined, { seed, meta }).grid;
  const rng = createRng(seed);
  for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
    const solution = generateLoop(grid, rng, thresholds, attempts - 1);
    const full = deriveClues(grid, solution).map((k) => (k === 4 ? NO_CLUE : k));
    const clues = full.slice();
    const work: Puzzle = { grid, clues };
    if (solve(work).status !== "solved") continue;
    const checks = removeClues(work, solution, rng, onProgress);
    const { result, restored } = restoreClues(work, full, rng);
    let clueCount = 0;
    for (const k of clues) if (k !== NO_CLUE) clueCount++;
    return {
      puzzle: createPuzzle(width, height, clues, { seed, meta }),
      solution,
      solve: result,
      stats: { attempts, clueCount, checks, restored },
    };
  }
  throw new Error(`no usable loop after ${MAX_ATTEMPTS} attempts`);
}

/** Step 3: the local removal test, in random order. Changes `puzzle.clues`; returns the tests made. */
function removeClues(
  puzzle: Puzzle,
  solution: Uint8Array,
  rng: Rng,
  onProgress: GenerateOptions["onProgress"],
): number {
  const { grid, clues } = puzzle;
  const order: number[] = [];
  for (let i = 0; i < grid.cellCount; i++) if (clues[i] !== NO_CLUE) order.push(i);
  shuffle(order, rng);
  const initial = new Uint8Array(grid.edgeCount);
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    const k = clues[i];
    clues[i] = NO_CLUE;
    initial.set(solution);
    forEachNear(grid, i, WINDOW_RADIUS, (x) => {
      for (let j = 0; j < 4; j++) initial[grid.cellEdges[x * 4 + j]] = EdgeState.Unknown;
    });
    if (solve(puzzle, { initial }).status !== "solved") clues[i] = k;
    onProgress?.({ done: n + 1, total: order.length });
  }
  return order.length;
}

/**
 * Step 4: solve from scratch; while stuck, put back removed clues of cells next to an open edge
 * (or, if there are none, any removed clues), keeping each round's picks spread out. Terminates
 * because each round puts back at least one clue and the full clue set solves.
 */
function restoreClues(
  puzzle: Puzzle,
  full: Int8Array,
  rng: Rng,
): { result: SolveResult; restored: number } {
  const { grid, clues } = puzzle;
  let restored = 0;
  for (;;) {
    const result = solve(puzzle);
    if (result.status === "solved") return { result, restored };
    const removed: number[] = [];
    const nearOpen: number[] = [];
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] !== NO_CLUE || full[i] === NO_CLUE) continue;
      removed.push(i);
      for (let j = 0; j < 4; j++) {
        if (result.edges[grid.cellEdges[i * 4 + j]] === EdgeState.Unknown) {
          nearOpen.push(i);
          break;
        }
      }
    }
    const candidates = nearOpen.length > 0 ? nearOpen : removed;
    shuffle(candidates, rng);
    const blocked = new Uint8Array(grid.cellCount);
    for (const i of candidates) {
      if (blocked[i]) continue;
      clues[i] = full[i];
      restored++;
      forEachNear(grid, i, RESTORE_SPACING, (x) => {
        blocked[x] = 1;
      });
    }
  }
}

/** Calls `visit` with every cell at most `radius` rows and `radius` columns away from cell `i`. */
function forEachNear(grid: Grid, i: number, radius: number, visit: (cell: number) => void): void {
  const W = grid.width;
  const r = Math.floor(i / W);
  const c = i % W;
  const rowEnd = Math.min(grid.height - 1, r + radius);
  const colEnd = Math.min(W - 1, c + radius);
  for (let rr = Math.max(0, r - radius); rr <= rowEnd; rr++) {
    for (let cc = Math.max(0, c - radius); cc <= colEnd; cc++) visit(rr * W + cc);
  }
}

/** Fisher–Yates shuffle in place with the seeded generator. */
function shuffle(items: number[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = items[i];
    items[i] = items[j];
    items[j] = t;
  }
}
