import { analyzeBoard } from "./analyze.ts";
import { EdgeState, type Grid } from "./grid.ts";
import { LEVEL_SETTINGS, puzzleLevel } from "./level.ts";
import type { Puzzle } from "./puzzle.ts";
import type { Probe, RuleId, Step } from "./rules.ts";
import { solve } from "./solver.ts";

/**
 * What a hint shows (PRD FR-12), from the player's board and the puzzle's solution:
 * - `solved`: the board is already complete.
 * - `mistake`: `edge` is marked differently from the solution (the lowest such edge); `count` is how
 *   many marks are wrong in all. Mistakes come first, because deductions from a board with a wrong
 *   mark would not make sense to the player.
 * - `step`: the next line the rules reach from the player's board, using the rules of the puzzle's
 *   level (`puzzleLevel`), so an easy puzzle's hints name only easy rules. `step` is the deduction
 *   that draws the line; `before` are the steps it rests on that only cross edges, in the order the
 *   solver made them. Crosses the line does not need are left out, so a hint never asks for crosses
 *   alone (DECISIONS, "Hints end in a line"). A lookahead step (in either place) carries its probe:
 *   the assumed state, the steps from it that the contradiction rests on, and the contradiction.
 * - `reveal`: no rule applies, so `edge` is one line of the solution, preferably one that extends a
 *   line already on the board.
 */
export type Hint =
  | { readonly kind: "solved" }
  | { readonly kind: "mistake"; readonly edge: number; readonly count: number }
  | { readonly kind: "step"; readonly step: Step; readonly before: readonly Step[] }
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
  // solve that gets stuck or runs out of time before it draws a line falls through to a revealed one.
  const { minClueShare, ...ruleSet } = LEVEL_SETTINGS[puzzleLevel(puzzle)];
  const solved = solve(puzzle, {
    ...options,
    ...ruleSet,
    initial: board,
    stopAtLine: true,
    explain: true,
  });
  const { steps, reads } = explainSteps(grid, board, solved.steps);
  const step = steps.at(-1);
  if (step?.changes.some((c) => c.state === EdgeState.Line)) {
    return { kind: "step", step, before: supportingSteps(grid, steps, reads) };
  }
  return { kind: "reveal", edge: revealEdge(grid, solution, board) };
}

/**
 * Rules that read only lines (or nothing) on the board, so no earlier cross is a reason for them:
 * a satisfied clue or a full dot counts lines, a premature loop follows them, a 0 needs nothing.
 */
const LINES_ONLY: ReadonlySet<RuleId> = new Set([
  "clue-zero",
  "clue-satisfied",
  "dot-full",
  "premature-loop",
  "loop-complete",
]);

/**
 * The steps before the last one (which draws a line) that it rests on: walking back, a step is kept
 * when it decided an edge around the cells or dots of the last step or of a step already kept. A
 * step's cells and dots are its reason, so this follows local rules exactly; for rules that reason
 * over the whole board (parity, colouring, connectivity, chains) a far cross may be missed, which
 * leaves the hint's explanation short but its move sound. A lookahead step's reason also takes the
 * board's edges its probe read (`reads`).
 */
function supportingSteps(
  grid: Grid,
  steps: readonly Step[],
  reads: ReadonlyMap<Step, readonly number[]>,
): Step[] {
  const need = new Set<number>();
  const addReason = (step: Step) => {
    if (LINES_ONLY.has(step.rule)) return;
    addAround(grid, need, step.cells, step.dots);
    for (const e of reads.get(step) ?? []) need.add(e);
  };
  addReason(steps[steps.length - 1]);
  const kept: Step[] = [];
  for (let i = steps.length - 2; i >= 0; i--) {
    if (!steps[i].changes.some((c) => need.has(c.edge))) continue;
    kept.push(steps[i]);
    addReason(steps[i]);
  }
  return kept.reverse();
}

/** Adds the edges around `cells` and `dots` to `need`. */
function addAround(
  grid: Grid,
  need: Set<number>,
  cells: readonly number[],
  dots: readonly number[],
): void {
  for (const c of cells) for (let j = 0; j < 4; j++) need.add(grid.cellEdges[c * 4 + j]);
  for (const d of dots) {
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e >= 0) need.add(e);
    }
  }
}

/**
 * The solve's steps with each lookahead probe cut down to what its contradiction rests on
 * (`pruneProbe`), replaying them from `board`; `reads` maps each such step to the edges its probe
 * read that were already decided on the board.
 */
function explainSteps(
  grid: Grid,
  board: Uint8Array,
  steps: readonly Step[],
): { steps: Step[]; reads: Map<Step, readonly number[]> } {
  const now = board.slice();
  const reads = new Map<Step, readonly number[]>();
  const out = steps.map((s) => {
    let t = s;
    if (s.probe !== undefined) {
      const pruned = pruneProbe(grid, now, s.probe);
      t = { ...s, probe: pruned.probe };
      reads.set(t, pruned.read);
    }
    for (const c of s.changes) now[c.edge] = c.state;
    return t;
  });
  return { steps: out, reads };
}

/**
 * The probe's steps that its contradiction rests on, by the same backward walk as
 * `supportingSteps` but counting lines as reasons too: a step is kept when it decided an edge
 * around the contradiction (its cells, dots, loop and breaking edge) or around a kept step's cells
 * and dots. Rules that read only lines (`LINES_ONLY`), and too many lines at a dot or round a
 * number, rest on the lines there alone. A premature-loop step names only the path's two ends, so
 * the path's edges, as they stood then, count too. `read` is the edges the kept steps and the contradiction read that were
 * already decided on `board`. A probe that ends with no lines anywhere rests on every step.
 */
function pruneProbe(grid: Grid, board: Uint8Array, probe: Probe): { probe: Probe; read: number[] } {
  const what = board.slice();
  what[probe.assumed.edge] = probe.assumed.state;
  // Each step's reason, read off the board as it stood just before it.
  const reasons = probe.steps.map((s) => {
    const reason = new Set<number>();
    addAround(grid, reason, s.cells, s.dots);
    if (LINES_ONLY.has(s.rule)) {
      for (const e of reason) if (what[e] !== EdgeState.Line) reason.delete(e);
      if (s.rule === "premature-loop")
        for (const e of linePath(grid, what, s.dots[0])) reason.add(e);
    }
    for (const c of s.changes) what[c.edge] = c.state;
    return reason;
  });
  const x = probe.contradiction;
  const need = new Set<number>();
  addAround(grid, need, x.cells, x.dots);
  // Too many lines at a dot or round a number rests on those lines alone.
  if (x.kind === "dot-three" || x.kind === "clue-over") {
    for (const e of need) if (what[e] !== EdgeState.Line) need.delete(e);
  }
  for (const e of x.edges) need.add(e);
  if (x.edge !== null) need.add(x.edge);
  if (x.kind === "no-loop") for (let e = 0; e < grid.edgeCount; e++) need.add(e);
  const kept: Probe["steps"][number][] = [];
  for (let i = probe.steps.length - 1; i >= 0; i--) {
    const s = probe.steps[i];
    if (!s.changes.some((c) => need.has(c.edge))) continue;
    kept.push(s);
    for (const e of reasons[i]) need.add(e);
  }
  const read = [...need].filter((e) => board[e] !== EdgeState.Unknown).sort((a, b) => a - b);
  return { probe: { ...probe, steps: kept.reverse() }, read };
}

/** The edges of the line path that ends at dot `from`, from there to its other end. */
function linePath(grid: Grid, board: Uint8Array, from: number): number[] {
  const out: number[] = [];
  let d = from;
  let prev = -1;
  for (;;) {
    let next = -1;
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e >= 0 && e !== prev && board[e] === EdgeState.Line) {
        next = e;
        break;
      }
    }
    if (next < 0) return out;
    out.push(next);
    prev = next;
    d = grid.edgeDots[next * 2] === d ? grid.edgeDots[next * 2 + 1] : grid.edgeDots[next * 2];
    if (d === from) return out;
  }
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
