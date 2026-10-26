import { Budget, Engine, type Mark, SolverStop } from "./engine.ts";
import { EdgeState } from "./grid.ts";
import type { Puzzle } from "./puzzle.ts";

/** Default verification time limit (PRD NFR-1). */
export const DEFAULT_VERIFY_TIME_LIMIT_MS = 30_000;

/**
 * - `unique`: exactly one solution.
 * - `none`: no solution.
 * - `multiple`: at least two solutions.
 * - `unknown`: the time or node budget ran out before the answer was known.
 */
export type VerifyStatus = "unique" | "none" | "multiple" | "unknown";

export interface VerifyOptions {
  /** Give up with `unknown` after this many milliseconds, measured with `now`. Default 30 000. */
  readonly timeLimitMs?: number;
  /** Clock in milliseconds. Default `Date.now`. Tests pass a fake clock. */
  readonly now?: () => number;
  /** Give up with `unknown` after this many search nodes. Default no limit. */
  readonly maxNodes?: number;
}

export interface VerifyStats {
  /** Search nodes visited (0 when the rules alone decided the puzzle). */
  readonly nodes: number;
  /** Lookahead probes run. */
  readonly probes: number;
  readonly elapsedMs: number;
}

export interface VerifyResult {
  readonly status: VerifyStatus;
  /**
   * Solutions found, as full edge-state arrays: one for `unique`, two different ones for
   * `multiple`, none for `none`, and whatever was found before the budget ran out for `unknown`.
   */
  readonly solutions: Uint8Array[];
  readonly stats: VerifyStats;
}

/**
 * Decides how many solutions a puzzle has (PRD FR-4). Runs the rule solver first; if it gets
 * stuck, searches depth-first and stops at the second solution. Gives up with `unknown` when the
 * time or node budget runs out.
 */
export function verify(puzzle: Puzzle, options: VerifyOptions = {}): VerifyResult {
  const now = options.now ?? Date.now;
  const start = now();
  const budget = new Budget(
    now,
    start + (options.timeLimitMs ?? DEFAULT_VERIFY_TIME_LIMIT_MS),
    options.maxNodes ?? Number.POSITIVE_INFINITY,
  );
  // Colouring after lookahead at the root: no steps are read here, and it saves a colouring pass
  // before every lookahead deduction (DECISIONS, WT17).
  const engine = new Engine(puzzle, budget, { colourLast: true });
  const solutions: Uint8Array[] = [];
  let status: VerifyStatus;
  try {
    if (engine.solveRoot(true)) search(engine, budget, solutions);
    status = solutions.length === 0 ? "none" : solutions.length === 1 ? "unique" : "multiple";
  } catch (err) {
    if (!(err instanceof SolverStop)) throw err;
    status = "unknown";
  }
  return {
    status,
    solutions,
    stats: { nodes: budget.nodes, probes: engine.probes, elapsedMs: now() - start },
  };
}

interface Frame {
  readonly mark: Mark;
  /** Position of the branch edge in the engine's reading order. */
  readonly pos: number;
  triedLine: boolean;
}

/**
 * Depth-first search from a propagated, consistent state, collecting up to two solutions. Branches
 * on the first open edge in reading order, cross first, and runs the rules without lookahead at
 * every node. Edges before a node's branch position are all decided, so the next scan starts
 * there. Uses an explicit stack because a 100×100 board can need thousands of nested branches.
 */
function search(engine: Engine, budget: Budget, solutions: Uint8Array[]): void {
  const stack: Frame[] = [];
  let ok = true;
  for (;;) {
    if (ok) {
      if (engine.closed) {
        solutions.push(engine.edges.slice());
        if (solutions.length >= 2) return;
      } else {
        budget.node();
        // An open edge exists: local() fails when every edge is decided and no loop closed.
        const pos = engine.nextOpen(stack.at(-1)?.pos ?? 0);
        stack.push({ mark: engine.mark(), pos, triedLine: false });
        ok = engine.set(engine.edgeAt(pos), EdgeState.Cross) && engine.propagate(false);
        continue;
      }
    }
    // Backtrack to the deepest branch that still has its line side to try.
    for (;;) {
      const top = stack.at(-1);
      if (top === undefined) return;
      engine.undo(top.mark);
      if (!top.triedLine) {
        top.triedLine = true;
        ok = engine.set(engine.edgeAt(top.pos), EdgeState.Line) && engine.propagate(false);
        break;
      }
      stack.pop();
    }
  }
}
