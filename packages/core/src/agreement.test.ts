/**
 * PRD FR-5: the verifier and the rule solver agree with the brute-force oracle on small grids.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { bruteForceSolutions } from "./bruteforce.ts";
import { encodeEdges } from "./format.ts";
import { EdgeState } from "./grid.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "./puzzle.ts";
import { solve } from "./solver.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { verify } from "./verify.ts";

/** Checks `solve` and `verify` against every brute-force solution of `p`. */
function checkAgainstBruteForce(p: Puzzle): void {
  const all = bruteForceSolutions(p, Number.POSITIVE_INFINITY);
  const encoded = new Set(all.map(encodeEdges));

  const v = verify(p);
  expect(v.status).toBe(all.length === 0 ? "none" : all.length === 1 ? "unique" : "multiple");
  expect(v.solutions.length).toBe(Math.min(all.length, 2));
  for (const s of v.solutions) expect(encoded.has(encodeEdges(s))).toBe(true);
  if (v.solutions.length === 2) {
    expect(encodeEdges(v.solutions[0])).not.toBe(encodeEdges(v.solutions[1]));
  }
  // Starting again from the root with deeper lookahead, at once or from the middle of a search
  // (after its first node; about 640 of these puzzles search further), finds the same solutions.
  for (const deepenAfterNodes of [0, 1]) {
    const deep = verify(p, { deepenAfterNodes });
    expect(deep.status).toBe(v.status);
    expect(deep.solutions.map(encodeEdges)).toEqual(v.solutions.map(encodeEdges));
  }

  // Every edge the rule solver decides agrees with every solution, with every rule group, with
  // each group alone and with none.
  for (const rules of [undefined, ["corners"], ["colouring"], ["connectivity"], []] as const) {
    const r = solve(p, { rules });
    r.edges.forEach((state, e) => {
      if (state === EdgeState.Unknown) return;
      for (const s of all) expect(s[e]).toBe(state);
    });
    if (r.status === "solved") expect(all.length).toBe(1);
    if (r.status === "contradiction") expect(all.length).toBe(0);
    expect(r.status).not.toBe("incomplete");
    // Without steps the engine works incrementally (DECISIONS, WT19) but finds the same status,
    // with every group and with none.
    if (rules === undefined || rules.length === 0) {
      expect(solve(p, { rules, steps: false }).status).toBe(r.status);
    }
  }
}

describe("agreement with brute force", () => {
  // Every clue assignment (5 choices per cell) on every grid of at most 6 cells: 70,930 puzzles.
  const sizes: [number, number][] = [
    [1, 1],
    [1, 2],
    [2, 1],
    [1, 3],
    [3, 1],
    [1, 4],
    [4, 1],
    [2, 2],
    [1, 5],
    [5, 1],
    [1, 6],
    [6, 1],
    [2, 3],
    [3, 2],
  ];
  for (const [w, h] of sizes) {
    test(`every puzzle on a ${w}×${h} grid`, () => {
      const n = w * h;
      const clues = new Array<number>(n);
      for (let code = 0; code < 5 ** n; code++) {
        let x = code;
        for (let i = 0; i < n; i++) {
          clues[i] = (x % 5) - 1;
          x = Math.floor(x / 5);
        }
        checkAgainstBruteForce(createPuzzle(w, h, clues));
      }
    });
  }

  test("a clue whose open sides lie in different regions (found by fast-check)", () => {
    // Before any line is drawn, the 1 at row 1 can still use either its top or its bottom side,
    // and those lie in regions the crosses have already cut apart.
    checkAgainstBruteForce(
      createPuzzle(2, 4, [NO_CLUE, NO_CLUE, 0, 1, 1, NO_CLUE, NO_CLUE, NO_CLUE]),
    );
  });

  test("random puzzles with a planted solution, up to 4×4", () => {
    fc.assert(
      fc.property(arbPuzzleWithSolution(4, 4), ({ puzzle }) => checkAgainstBruteForce(puzzle)),
      { numRuns: 1000 },
    );
  });

  test("random puzzles with a planted solution, up to 5×4", () => {
    fc.assert(
      fc.property(arbPuzzleWithSolution(5, 4), ({ puzzle }) => checkAgainstBruteForce(puzzle)),
      { numRuns: 20 },
    );
  });

  test("random clue grids, up to 4×4", () => {
    const arb = fc
      .record({ width: fc.integer({ min: 1, max: 4 }), height: fc.integer({ min: 1, max: 4 }) })
      .chain(({ width, height }) =>
        fc.record({
          width: fc.constant(width),
          height: fc.constant(height),
          clues: fc.array(fc.constantFrom(NO_CLUE, NO_CLUE, NO_CLUE, 0, 1, 2, 3), {
            minLength: width * height,
            maxLength: width * height,
          }),
        }),
      );
    fc.assert(
      fc.property(arb, ({ width, height, clues }) =>
        checkAgainstBruteForce(createPuzzle(width, height, clues)),
      ),
      { numRuns: 1000 },
    );
  });
});
