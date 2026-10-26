import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { EdgeState } from "./grid.ts";
import { deriveClues, NO_CLUE } from "./puzzle.ts";
import { RULE_GROUPS, type RuleGroup } from "./rules.ts";
import { solve } from "./solver.ts";
import { CLUE_GAP_VERIFY_OPTIONS, clueGapCorpus } from "./test-support/clue-gaps.ts";
import { verify } from "./verify.ts";

/**
 * Ids of the corpus entries the rule solver solves. Empty when the corpus was made (WT14): every
 * entry was stuck. A solver change that solves more adds their ids, like a golden value; a missing
 * id means a rule got weaker. WT15's premature-loop fix solved 3; WT16's corner rules 23; WT17's
 * colouring 29. `SOLVED_WITHOUT_COLOURING` is the same with the colouring group left out (WT16's
 * 23), `SOLVED_WITHOUT_GROUPS` with every group left out (WT15's three). Colouring alone, without
 * the corners, solves the same 29 as every group. WT18's connectivity group adds none of these
 * (lookahead found them already); without lookahead it adds 3: every group solves
 * `SOLVED_WITHOUT_LOOKAHEAD`, the groups before WT18 `SOLVED_WITHOUT_LOOKAHEAD_WT17`.
 */
const SOLVED: string[] = [
  "clue-gaps-5-3#16",
  "clue-gaps-5-18#14",
  "clue-gaps-5-41#4",
  "clue-gaps-5-41#9",
  "clue-gaps-5-44#16",
  "clue-gaps-5-56#3",
  "clue-gaps-5-81#1",
  "clue-gaps-5-81#5",
  "clue-gaps-5-87#17",
  "clue-gaps-5-95#3",
  "clue-gaps-5-95#18",
  "clue-gaps-7-3#14",
  "clue-gaps-7-5#17",
  "clue-gaps-7-6#11",
  "clue-gaps-7-8#0",
  "clue-gaps-7-8#3",
  "clue-gaps-7-10#27",
  "clue-gaps-10-0#77",
  "clue-gaps-10-1#73",
  "clue-gaps-10-1#81",
  "clue-gaps-10-2#12",
  "clue-gaps-10-2#37",
  "clue-gaps-10-3#41",
  "clue-gaps-10-4#26",
  "clue-gaps-10-4#35",
  "clue-gaps-10-7#60",
  "clue-gaps-10-8#26",
  "clue-gaps-10-8#27",
  "clue-gaps-10-11#64",
];
const SOLVED_WITHOUT_COLOURING: string[] = [
  "clue-gaps-5-3#16",
  "clue-gaps-5-18#14",
  "clue-gaps-5-41#4",
  "clue-gaps-5-44#16",
  "clue-gaps-5-56#3",
  "clue-gaps-5-81#1",
  "clue-gaps-5-81#5",
  "clue-gaps-5-87#17",
  "clue-gaps-5-95#18",
  "clue-gaps-7-3#14",
  "clue-gaps-7-5#17",
  "clue-gaps-7-8#0",
  "clue-gaps-7-10#27",
  "clue-gaps-10-0#77",
  "clue-gaps-10-2#12",
  "clue-gaps-10-2#37",
  "clue-gaps-10-3#41",
  "clue-gaps-10-4#26",
  "clue-gaps-10-4#35",
  "clue-gaps-10-7#60",
  "clue-gaps-10-8#26",
  "clue-gaps-10-8#27",
  "clue-gaps-10-11#64",
];
const SOLVED_WITHOUT_GROUPS: string[] = [
  "clue-gaps-5-81#5",
  "clue-gaps-10-8#26",
  "clue-gaps-10-8#27",
];
const SOLVED_WITHOUT_LOOKAHEAD: string[] = [
  "clue-gaps-5-41#4",
  "clue-gaps-5-41#9",
  "clue-gaps-5-44#16",
  "clue-gaps-5-81#1",
  "clue-gaps-5-81#5",
  "clue-gaps-5-95#3",
  "clue-gaps-5-95#18",
  "clue-gaps-10-0#77",
  "clue-gaps-10-3#41",
  "clue-gaps-10-4#35",
  "clue-gaps-10-7#60",
];
const SOLVED_WITHOUT_LOOKAHEAD_WT17: string[] = [
  "clue-gaps-5-41#4",
  "clue-gaps-5-41#9",
  "clue-gaps-5-44#16",
  "clue-gaps-5-81#1",
  "clue-gaps-5-95#18",
  "clue-gaps-10-3#41",
  "clue-gaps-10-4#35",
  "clue-gaps-10-7#60",
];

const corpus = clueGapCorpus();

/** Edges that `edges` decides differently from `solution`. */
function disagreements(edges: Uint8Array, solution: Uint8Array): number {
  let n = 0;
  for (let e = 0; e < edges.length; e++) {
    if (edges[e] !== EdgeState.Unknown && edges[e] !== solution[e]) n++;
  }
  return n;
}

describe("clue-gap corpus", () => {
  test("has 36 entries with distinct ids, smallest boards first", () => {
    expect(corpus.length).toBe(36);
    expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length);
    const sizes = corpus.map((c) => c.puzzle.grid.cellCount);
    expect(sizes).toEqual(sizes.toSorted((a, b) => a - b));
  });

  for (const c of corpus) {
    test(`${c.id} has one solution, which the stuck board and the solver agree with`, () => {
      const result = verify(c.puzzle, CLUE_GAP_VERIFY_OPTIONS);
      expect(result.status).toBe("unique");
      const solution = result.solutions[0];
      expect(c.puzzle.clues[c.cell]).toBe(NO_CLUE);
      expect(deriveClues(c.puzzle.grid, solution)[c.cell]).toBe(c.clue);
      expect(c.stuck.includes(EdgeState.Unknown)).toBe(true);
      expect(disagreements(c.stuck, solution)).toBe(0);
      expect(disagreements(solve(c.puzzle).edges, solution)).toBe(0);
      for (const rules of [["corners"], ["colouring"], ["connectivity"], []] as const) {
        expect(disagreements(solve(c.puzzle, { rules }).edges, solution)).toBe(0);
      }
    });
  }

  test(`the rule solver solves exactly the entries in SOLVED (${SOLVED.length} today)`, () => {
    const solvedWith = (rules?: readonly RuleGroup[], lookahead = true) =>
      corpus
        .filter((c) => solve(c.puzzle, { rules, lookahead }).status === "solved")
        .map((c) => c.id);
    expect(solvedWith()).toEqual(SOLVED);
    expect(solvedWith(["colouring"])).toEqual(SOLVED);
    expect(solvedWith(["corners", "colouring"])).toEqual(SOLVED);
    expect(solvedWith(["corners"])).toEqual(SOLVED_WITHOUT_COLOURING);
    expect(solvedWith(["corners", "connectivity"])).toEqual(SOLVED_WITHOUT_COLOURING);
    expect(solvedWith([])).toEqual(SOLVED_WITHOUT_GROUPS);
    expect(solvedWith(undefined, false)).toEqual(SOLVED_WITHOUT_LOOKAHEAD);
    expect(solvedWith(["corners", "colouring"], false)).toEqual(SOLVED_WITHOUT_LOOKAHEAD_WT17);
  });

  test("from a correct partial board, with any rule groups, nothing contradicts the solution", () => {
    // The only solution of each entry, found once.
    const solutions = corpus.map((c) => verify(c.puzzle, CLUE_GAP_VERIFY_OPTIONS).solutions[0]);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: corpus.length - 1 }),
        // One flag per edge of the largest corpus board (10×10: 220 edges); about a quarter given.
        fc.array(fc.constantFrom(false, false, false, true), { minLength: 220, maxLength: 220 }),
        fc.subarray([...RULE_GROUPS]),
        (n, given, rules) => {
          const solution = solutions[n];
          const initial = solution.map((s, e) => (given[e] ? s : EdgeState.Unknown));
          const result = solve(corpus[n].puzzle, { initial, rules });
          expect(result.status).not.toBe("contradiction");
          expect(disagreements(result.edges, solution)).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
