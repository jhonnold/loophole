import { describe, expect, test } from "bun:test";
import { EdgeState } from "./grid.ts";
import { deriveClues, NO_CLUE } from "./puzzle.ts";
import { solve } from "./solver.ts";
import { CLUE_GAP_VERIFY_OPTIONS, clueGapCorpus } from "./test-support/clue-gaps.ts";
import { verify } from "./verify.ts";

/**
 * Ids of the corpus entries the rule solver solves. Empty when the corpus was made (WT14): every
 * entry was stuck. A solver change that solves more adds their ids, like a golden value; a missing
 * id means a rule got weaker. WT15's premature-loop fix solves the first three.
 */
const SOLVED: string[] = ["clue-gaps-5-81#5", "clue-gaps-10-8#26", "clue-gaps-10-8#27"];

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
    });
  }

  test(`the rule solver solves exactly the entries in SOLVED (${SOLVED.length} today)`, () => {
    const solved = corpus.filter((c) => solve(c.puzzle).status === "solved").map((c) => c.id);
    expect(solved).toEqual(SOLVED);
  });
});
