import type { EdgeState } from "./grid.ts";

/**
 * The named deductions the rule solver uses (PRD FR-3), with a short explanation of each for hints
 * (FR-6, FR-12). A solver step names its rule by id; the UI shows the text and highlights the
 * step's cells and dots.
 */
export const RULE_IDS = [
  "clue-zero",
  "clue-satisfied",
  "clue-needs-all",
  "dot-full",
  "dot-continue",
  "dot-dead-end",
  "corner-1",
  "corner-3",
  "adjacent-3s",
  "diagonal-3s",
  "premature-loop",
  "loop-complete",
  "parity",
  "lookahead",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export const RULE_TEXT: Readonly<Record<RuleId, string>> = {
  "clue-zero": "A 0 has no lines around it, so all four of its sides are crossed.",
  "clue-satisfied":
    "This number already has that many lines around it, so its remaining sides are crossed.",
  "clue-needs-all":
    "This number needs every side that is still open, so those sides are all lines.",
  "dot-full": "Two lines already meet at this dot, so its other edges are crossed.",
  "dot-continue": "The line that reaches this dot has to go on, and only one edge is left open.",
  "dot-dead-end":
    "No line reaches this dot and only one edge is open, so the loop cannot pass through it.",
  "corner-1":
    "The loop cannot enter this corner from outside, and a 1 cannot use both sides there, so both are crossed.",
  "corner-3":
    "The loop cannot enter this corner from outside, and a 3 must use at least one side there, so both are lines.",
  "adjacent-3s":
    "Two 3s side by side: their outer sides are lines, and the edges that continue their shared side are crossed.",
  "diagonal-3s": "Two 3s touching at a corner: the sides at their far corners are lines.",
  "premature-loop":
    "This edge would close a loop while other lines or numbers still need it, so it is crossed.",
  "loop-complete":
    "The loop is closed and every number is satisfied, so all other edges are crossed.",
  parity:
    "Known edges show whether these two cells are on the same side of the loop, which decides the edge between them.",
  lookahead:
    "Trying the other choice for this edge quickly leads to a contradiction, so it must be this way.",
};

/** A short name for each rule, shown as the hint card's title. */
export const RULE_TITLE: Readonly<Record<RuleId, string>> = {
  "clue-zero": "A zero",
  "clue-satisfied": "Clue complete",
  "clue-needs-all": "Clue saturated",
  "dot-full": "Dot full",
  "dot-continue": "Line goes on",
  "dot-dead-end": "Dead end",
  "corner-1": "1 in a corner",
  "corner-3": "3 in a corner",
  "adjacent-3s": "3s side by side",
  "diagonal-3s": "3s corner to corner",
  "premature-loop": "No small loops",
  "loop-complete": "Loop complete",
  parity: "Inside and outside",
  lookahead: "Try and see",
};

/** One edge a step decided. */
export interface EdgeChange {
  readonly edge: number;
  readonly state: typeof EdgeState.Line | typeof EdgeState.Cross;
}

/**
 * One applied deduction. `changes` are the edges it set, in order. `cells` and `dots` are the
 * reason: the clue cells and dots a hint highlights.
 */
export interface Step {
  readonly rule: RuleId;
  readonly changes: readonly EdgeChange[];
  readonly cells: readonly number[];
  readonly dots: readonly number[];
}
