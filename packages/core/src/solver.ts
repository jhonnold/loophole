import { Budget, Engine, SolverStop } from "./engine.ts";
import type { Puzzle } from "./puzzle.ts";
import { RULE_GROUPS, type RuleGroup, type Step } from "./rules.ts";

/**
 * - `solved`: the rules decided every edge; the result is the puzzle's only solution.
 * - `stuck`: no rule applies any more and some edges are still open.
 * - `contradiction`: the clues (with `initial`) break a rule, so there is no solution.
 * - `incomplete`: stopped early by `maxSteps` or the time limit.
 */
export type SolveStatus = "solved" | "stuck" | "contradiction" | "incomplete";

export interface SolveOptions {
  /** Starting edge states, for example a player's board. Defaults to all unknown. Not modified. */
  readonly initial?: Uint8Array;
  /**
   * Use bounded lookahead when the other rules are stuck. Default true. A probe assumes one edge and
   * runs tier 1 only (DECISIONS, WT2 and WT18).
   */
  readonly lookahead?: boolean;
  /**
   * Rule groups to use on top of the rules that always run (`RULE_GROUPS`). Default all of them.
   * A difficulty level can leave groups out; deductions are sound either way.
   */
  readonly rules?: readonly RuleGroup[];
  /**
   * Record steps. Default true. Without them `steps` comes back empty and `maxSteps` does nothing,
   * and solving is faster; generation's clue removal tests read only the status and edges.
   */
  readonly steps?: boolean;
  /** Stop after recording this many steps. Default no limit. */
  readonly maxSteps?: number;
  /** Stop after this many milliseconds, measured with `now`. Default no limit. */
  readonly timeLimitMs?: number;
  /** Clock in milliseconds. Default `Date.now`. */
  readonly now?: () => number;
}

export interface SolveResult {
  readonly status: SolveStatus;
  /** Every deduction applied, in order. */
  readonly steps: Step[];
  /** Edge states when the solver stopped. */
  readonly edges: Uint8Array;
}

/**
 * Applies named deductions until the puzzle is solved or no rule applies (PRD FR-3), recording
 * each one as a step (FR-6). Every deduction is sound: it holds in every solution of the puzzle.
 * So `solved` proves the solution is unique without any guessing.
 */
export function solve(puzzle: Puzzle, options: SolveOptions = {}): SolveResult {
  const now = options.now ?? Date.now;
  const budget = new Budget(
    now,
    now() + (options.timeLimitMs ?? Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );
  const rules = options.rules ?? RULE_GROUPS;
  const engine = new Engine(puzzle, budget, {
    corners: rules.includes("corners"),
    colouring: rules.includes("colouring"),
    connectivity: rules.includes("connectivity"),
  });
  const steps: Step[] = [];
  engine.steps = options.steps === false ? null : steps;
  engine.maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
  let status: SolveStatus;
  try {
    const ok =
      (options.initial === undefined || engine.load(options.initial)) &&
      engine.solveRoot(options.lookahead ?? true);
    status = !ok ? "contradiction" : engine.closed ? "solved" : "stuck";
  } catch (err) {
    if (!(err instanceof SolverStop)) throw err;
    status = "incomplete";
  }
  return { status, steps, edges: engine.edges.slice() };
}
