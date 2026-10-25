import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { bruteForceSolutions, countSolutions } from "./bruteforce.ts";
import { encodeEdges, parsePuzzle } from "./format.ts";
import { EdgeState } from "./grid.ts";
import { createPuzzle, deriveClues, NO_CLUE } from "./puzzle.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { FIXTURES } from "./test-support/fixtures.ts";

describe("bruteForceSolutions", () => {
  // Loops on an empty grid = simple cycles in the (W+1)×(H+1) grid graph (OEIS A140517 for squares).
  const emptyCounts: [number, number, number][] = [
    [1, 1, 1],
    [1, 2, 3],
    [2, 1, 3],
    [1, 3, 6],
    [2, 2, 13],
    [2, 3, 40],
    [3, 2, 40],
    [3, 3, 213],
    [2, 4, 108],
    [3, 4, 1049],
    [4, 4, 9349],
  ];
  for (const [w, h, n] of emptyCounts) {
    test(`finds ${n} loops on an empty ${w}×${h} grid`, () => {
      expect(countSolutions(createPuzzle(w, h), Number.POSITIVE_INFINITY)).toBe(n);
    });
  }

  for (const f of FIXTURES) {
    test(`fixture ${f.name} has ${f.count} solution(s)`, () => {
      const p = parsePuzzle({ v: 1, width: f.width, height: f.height, clues: f.clues });
      const found = bruteForceSolutions(p, Number.POSITIVE_INFINITY);
      expect(found.length).toBe(f.count);
      if (f.solutions !== undefined) expect(found.map(encodeEdges)).toEqual([...f.solutions]);
    });
  }

  test("stops at the limit", () => {
    const p = createPuzzle(3, 3);
    expect(countSolutions(p)).toBe(2);
    expect(countSolutions(p, 1)).toBe(1);
    expect(bruteForceSolutions(p, 5).length).toBe(5);
  });

  test("returns full assignments of lines and crosses", () => {
    for (const s of bruteForceSolutions(createPuzzle(2, 2), Number.POSITIVE_INFINITY)) {
      expect(s.every((v) => v === EdgeState.Line || v === EdgeState.Cross)).toBe(true);
    }
  });

  test("rejects grids over 20 cells and a limit below 1", () => {
    expect(() => countSolutions(createPuzzle(5, 5))).toThrow(RangeError);
    expect(() => countSolutions(createPuzzle(1, 1), 0)).toThrow(RangeError);
    expect(() => countSolutions(createPuzzle(1, 1), Number.NaN)).toThrow(RangeError);
  });

  test("finds the planted solution, and every solution fits the clues", () => {
    fc.assert(
      fc.property(arbPuzzleWithSolution(3, 3), ({ puzzle, solution }) => {
        const found = bruteForceSolutions(puzzle, Number.POSITIVE_INFINITY);
        expect(found.map(encodeEdges)).toContain(encodeEdges(solution));
        for (const s of found) {
          const derived = deriveClues(puzzle.grid, s);
          puzzle.clues.forEach((k, i) => {
            if (k !== NO_CLUE) expect(derived[i]).toBe(k);
          });
        }
      }),
      { numRuns: 50 },
    );
  });
});
