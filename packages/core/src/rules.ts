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
  "line-into-1",
  "line-into-3",
  "two-passes-on",
  "two-in-corner",
  "ones-side-by-side",
  "three-diagonal-one",
  "corner-chain",
  "parity",
  "colour-1",
  "colour-2",
  "colour-3",
  "colour-chain",
  "unreachable",
  "cut-off",
  "two-exits",
  "lookahead",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/**
 * Groups of rules that `solve` can leave out (`SolveOptions.rules`), so a difficulty level can use
 * a smaller set. The rules outside every group always run; lookahead has its own option.
 */
export const RULE_GROUPS = ["corners", "colouring", "connectivity"] as const;

export type RuleGroup = (typeof RULE_GROUPS)[number];

/** The rule ids each group's steps carry. */
export const GROUP_RULES: Readonly<Record<RuleGroup, readonly RuleId[]>> = {
  corners: [
    "line-into-1",
    "line-into-3",
    "two-passes-on",
    "two-in-corner",
    "ones-side-by-side",
    "three-diagonal-one",
    "corner-chain",
  ],
  colouring: ["colour-1", "colour-2", "colour-3", "colour-chain"],
  connectivity: ["unreachable", "cut-off", "two-exits"],
};

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
  "line-into-1":
    "The 1's one line is at this corner, so the loop comes in from outside there and the 1's other sides are crossed.",
  "line-into-3":
    "The loop passes through this corner of the 3, so it comes in from outside there and the 3's far sides are lines.",
  "two-passes-on":
    "The loop passes through both or neither of two opposite corners of a 2, so what holds at one carries across.",
  "two-in-corner":
    "A 2 in the board's corner has both sides there or neither, so either way the loop leaves it along the border.",
  "ones-side-by-side":
    "The loop can't go straight on past the 1s' shared side, so a line there would give a 1 two lines: it is crossed.",
  "three-diagonal-one":
    "The loop passes through the corner the 3 and the 1 share, so the 3's far sides are lines, the 1's crossed.",
  "corner-chain":
    "Working out which corners of the highlighted clues the loop passes through leaves one way for the marked edges.",
  parity:
    "Known edges show whether these two cells are on the same side of the loop, which decides the edge between them.",
  "colour-1":
    "Just one cell beside a 1 is on the other side of the loop (off the board is outside), which settles this edge.",
  "colour-2":
    "Two cells beside a 2 are on its side of the loop, two are not (off the board is outside), which settles this edge.",
  "colour-3":
    "Just one cell beside a 3 is on the same side of the loop as it (off the board is outside), which settles this edge.",
  "colour-chain":
    "Working out which side of the loop the cells beside the highlighted clues are on leaves one way for this edge.",
  unreachable:
    "No path of open edges leads from the loop's lines to these edges, so the loop can't use them: they are crossed.",
  "cut-off":
    "The loop could get to these edges only through this dot, and it can't pass through a dot twice, so they're crossed.",
  "two-exits":
    "The loop must get from one side of these edges to the other, and uses all of them or none, so it uses them all.",
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
  "line-into-1": "Line into a 1's corner",
  "line-into-3": "Line into a 3's corner",
  "two-passes-on": "A 2 passes it on",
  "two-in-corner": "2 in a corner",
  "ones-side-by-side": "1s side by side",
  "three-diagonal-one": "3 diagonal to a 1",
  "corner-chain": "Corners pass along",
  parity: "Inside and outside",
  "colour-1": "Sides around a 1",
  "colour-2": "Sides around a 2",
  "colour-3": "Sides around a 3",
  "colour-chain": "Sides pass along",
  unreachable: "Out of reach",
  "cut-off": "One way in",
  "two-exits": "Only ways across",
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
