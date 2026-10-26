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
export const GENERATOR_VERSION = "4";

/**
 * Clue removal tests run block by block; a block is at most this many cells on a side. Each block's
 * tests start from the edges the rules decide with every clue in the block hidden.
 */
const BLOCK_SIZE = 2;
/** Clues put back in one round are more than this many rows or columns apart. */
const RESTORE_SPACING = 2;
/** Loops tried before giving up. Only 2×2 and rare small boards need a second; this bounds the loop. */
const MAX_ATTEMPTS = 100;

/**
 * Solves `puzzle` from `initial` (every edge unknown when left out). Generation judges every clue
 * removal by one of these, so the rules it allows decide which clues can go.
 */
type RuleSolver = (puzzle: Puzzle, initial?: Uint8Array) => SolveResult;

/** Every rule, lookahead included. */
const ALL_RULES: RuleSolver = (puzzle, initial) => solve(puzzle, { initial });

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
  /** Clues put back because the whole puzzle got stuck without them (a safeguard; normally 0). */
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
 * 3. In a seeded order, block by block, remove each clue if the rules still solve the whole puzzle
 *    without it (`removeClues`).
 * 4. Solve the whole puzzle from scratch. While it gets stuck, put back removed clues next to the
 *    open edges, spread out, and solve again. A safeguard: step 3's tests reach the same end as
 *    solving from scratch, so this has not been needed in the benchmarks.
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
    if (ALL_RULES(work).status !== "solved") continue;
    const checks = removeClues(work, rng, ALL_RULES, onProgress);
    const { result, restored } = restoreClues(work, full, rng, ALL_RULES);
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

/**
 * Step 3. Removes each clue whose removal leaves the puzzle solved by `rules`, in a seeded order,
 * block by block. Changes `puzzle.clues`; returns the tests made, one per clue of the full set.
 *
 * Solving the whole board from scratch for every test costs too much on large boards, so a test
 * starts from its block's base: the edges `rules` decide with every clue of the block hidden. Every
 * puzzle that has all the clues outside the block has those edges in all its solutions, so starting
 * there is sound, and since the rules only add to what they know, a test ends where solving from
 * scratch would. Bases nest: the board is halved, the longer side first, down to blocks, and each
 * half's base is solved from its parent's once the halves before it are done, so it only has to work
 * out what the parent's base left open.
 *
 * "Ends where solving from scratch would" needs the rules to be monotone in both clues and edges:
 * knowing more edges, or having more clues, never loses a deduction. Every rule is sound, which is
 * not enough on its own, and monotonicity is measured, not proved. After the premature-loop fix in
 * `Engine.set` it held in every run (0 differences in 43,200 solves from random sound partial
 * states and block bases against solving from scratch; 116 before the fix). One theoretical gap is
 * left: the premature-loop rule skips a crossing that would complete the solution, which depends on
 * the total line count, and a dot is not queued again when a line is added elsewhere. The final
 * solve from an empty board in `restoreClues` guards the result: a puzzle the rules cannot solve
 * from scratch is never returned, at worst it keeps more clues than needed.
 */
function removeClues(
  puzzle: Puzzle,
  rng: Rng,
  rules: RuleSolver,
  onProgress: GenerateOptions["onProgress"],
): number {
  const { grid, clues } = puzzle;
  let total = 0;
  for (const k of clues) if (k !== NO_CLUE) total++;
  let done = 0;
  const visit = (top: number, left: number, bottom: number, right: number, base: Uint8Array) => {
    if (bottom - top <= BLOCK_SIZE && right - left <= BLOCK_SIZE) {
      const order = cellsIn(grid, top, left, bottom, right).filter((i) => clues[i] !== NO_CLUE);
      shuffle(order, rng);
      for (const i of order) {
        const k = clues[i];
        clues[i] = NO_CLUE;
        if (rules(puzzle, base).status !== "solved") clues[i] = k;
        done++;
        onProgress?.({ done, total });
      }
      return;
    }
    const parts: [number, number, number, number][] = [];
    if (bottom - top >= right - left) {
      const mid = (top + bottom) >> 1;
      parts.push([top, left, mid, right], [mid, left, bottom, right]);
    } else {
      const mid = (left + right) >> 1;
      parts.push([top, left, bottom, mid], [top, mid, bottom, right]);
    }
    if (rng.int(2) === 1) parts.reverse();
    for (const [t, l, b, r] of parts) {
      visit(t, l, b, r, hiddenBase(puzzle, rules, cellsIn(grid, t, l, b, r), base));
    }
  };
  visit(0, 0, grid.height, grid.width, new Uint8Array(grid.edgeCount));
  return done;
}

/** The edges `rules` decide from `initial` with the clues of `cells` hidden. */
function hiddenBase(
  puzzle: Puzzle,
  rules: RuleSolver,
  cells: number[],
  initial: Uint8Array,
): Uint8Array {
  const clues = puzzle.clues.slice();
  for (const i of cells) clues[i] = NO_CLUE;
  return rules({ grid: puzzle.grid, clues }, initial).edges;
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
  rules: RuleSolver,
): { result: SolveResult; restored: number } {
  const { grid, clues } = puzzle;
  let restored = 0;
  for (;;) {
    const result = rules(puzzle);
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

/** Cells in rows `top` to `bottom - 1` and columns `left` to `right - 1`, row by row. */
function cellsIn(grid: Grid, top: number, left: number, bottom: number, right: number): number[] {
  const cells: number[] = [];
  for (let r = top; r < bottom; r++) {
    for (let c = left; c < right; c++) cells.push(r * grid.width + c);
  }
  return cells;
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
