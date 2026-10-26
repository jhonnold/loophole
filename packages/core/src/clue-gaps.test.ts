import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { EdgeState } from "./grid.ts";
import { deriveClues, NO_CLUE } from "./puzzle.ts";
import { solve } from "./solver.ts";
import { CLUE_GAP_VERIFY_OPTIONS, clueGapCorpus } from "./test-support/clue-gaps.ts";
import { verify } from "./verify.ts";

/**
 * Ids of the corpus entries the rule solver solves. Empty when the corpus was made (WT14): every
 * entry was stuck. A solver change that solves more adds their ids, like a golden value; a missing
 * id means a rule got weaker. WT15's premature-loop fix solved 3; WT16's corner rules solve 23.
 * `SOLVED_WITHOUT_CORNERS` is the same with the corners group left out (WT15's three).
 */
const SOLVED: string[] = [
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
const SOLVED_WITHOUT_CORNERS: string[] = [
  "clue-gaps-5-81#5",
  "clue-gaps-10-8#26",
  "clue-gaps-10-8#27",
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
      expect(disagreements(solve(c.puzzle, { rules: [] }).edges, solution)).toBe(0);
    });
  }

  test(`the rule solver solves exactly the entries in SOLVED (${SOLVED.length} today)`, () => {
    const solved = corpus.filter((c) => solve(c.puzzle).status === "solved").map((c) => c.id);
    expect(solved).toEqual(SOLVED);
    const without = corpus
      .filter((c) => solve(c.puzzle, { rules: [] }).status === "solved")
      .map((c) => c.id);
    expect(without).toEqual(SOLVED_WITHOUT_CORNERS);
  });

  test("from a correct partial board, with or without corners, no edge contradicts the solution", () => {
    // The only solution of each entry, found once.
    const solutions = corpus.map((c) => verify(c.puzzle, CLUE_GAP_VERIFY_OPTIONS).solutions[0]);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: corpus.length - 1 }),
        // One flag per edge of the largest corpus board (10×10: 220 edges); about a quarter given.
        fc.array(fc.constantFrom(false, false, false, true), { minLength: 220, maxLength: 220 }),
        fc.boolean(),
        (n, given, corners) => {
          const solution = solutions[n];
          const initial = solution.map((s, e) => (given[e] ? s : EdgeState.Unknown));
          const result = solve(corpus[n].puzzle, { initial, rules: corners ? undefined : [] });
          expect(result.status).not.toBe("contradiction");
          expect(disagreements(result.edges, solution)).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
