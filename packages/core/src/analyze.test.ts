import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard, hasViolations } from "./analyze.ts";
import { bruteForceSolutions } from "./bruteforce.ts";
import { encodeEdges, parsePuzzle } from "./format.ts";
import { EdgeState, type Grid } from "./grid.ts";
import type { Puzzle } from "./puzzle.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";

// 2×2 grid numbering (see grid.test.ts):
//
//   d0 -0- d1 -1- d2
//   6      7      8
//   d3 -2- d4 -3- d5
//   9      10     11
//   d6 -4- d7 -5- d8
//
// Cell edges: c0 = 0,7,2,6  c1 = 1,8,3,7  c2 = 2,10,4,9  c3 = 3,11,5,10.

const puzzle = (width: number, height: number, clues: string): Puzzle =>
  parsePuzzle({ v: 1, width, height, clues });

function board(grid: Grid, lines: number[], crosses: number[] = []): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  for (const e of lines) edges[e] = EdgeState.Line;
  for (const e of crosses) edges[e] = EdgeState.Cross;
  return edges;
}

/** Edge `e` is a line when bit `e` of `mask` is set, otherwise a cross. */
function fromMask(edgeCount: number, mask: number): Uint8Array {
  const edges = new Uint8Array(edgeCount);
  for (let e = 0; e < edgeCount; e++)
    edges[e] = (mask >>> e) & 1 ? EdgeState.Line : EdgeState.Cross;
  return edges;
}

const NO_VIOLATIONS = { dots: [], overfullCells: [], starvedCells: [], loopEdges: [] };
const OUTER = [0, 1, 8, 11, 5, 4, 9, 6];
const AROUND_C0 = [0, 7, 2, 6];
const AROUND_C3 = [3, 11, 5, 10];

describe("analyzeBoard", () => {
  test("an empty board has no violations and is not solved", () => {
    const p = puzzle(2, 2, "2...");
    const a = analyzeBoard(p, board(p.grid, []));
    expect(a).toEqual({
      violations: NO_VIOLATIONS,
      solved: false,
      satisfiedClues: 0,
      clueCount: 1,
    });
  });

  test("flags dots with 3 or 4 lines", () => {
    const p = puzzle(2, 2, "....");
    expect(analyzeBoard(p, board(p.grid, [0, 1, 7])).violations.dots).toEqual([1]);
    expect(analyzeBoard(p, board(p.grid, [2, 3, 7, 10])).violations.dots).toEqual([4]);
  });

  test("flags a clue with too many lines", () => {
    const p = puzzle(2, 2, "1...");
    const a = analyzeBoard(p, board(p.grid, [0, 6]));
    expect(a.violations.overfullCells).toEqual([0]);
    expect(a.satisfiedClues).toBe(0);
  });

  test("flags a clue with too many crosses", () => {
    const p = puzzle(2, 2, "3..0");
    expect(analyzeBoard(p, board(p.grid, [], [0, 6])).violations.starvedCells).toEqual([0]);
    expect(analyzeBoard(p, board(p.grid, [], [0])).violations.starvedCells).toEqual([]);
    // A 0 is satisfied by crosses, never starved.
    const a = analyzeBoard(p, board(p.grid, [], AROUND_C3));
    expect(a.violations.starvedCells).toEqual([]);
    expect(a.satisfiedClues).toBe(1);
  });

  test("flags a closed loop that does not satisfy the clues", () => {
    const p = puzzle(2, 2, "2222");
    const a = analyzeBoard(p, board(p.grid, AROUND_C0));
    expect(a.violations.loopEdges).toEqual([0, 2, 6, 7]);
    expect(a.solved).toBe(false);
  });

  test("flags a closed loop when other lines exist", () => {
    const p = puzzle(2, 2, "....");
    const a = analyzeBoard(p, board(p.grid, [...AROUND_C0, 5]));
    expect(a.violations.loopEdges).toEqual([0, 2, 6, 7]);
    expect(a.solved).toBe(false);
  });

  test("flags every closed loop", () => {
    // 3×1: c0 = 0,7,3,6 and c2 = 2,9,5,8.
    const p = puzzle(3, 1, "...");
    const a = analyzeBoard(p, board(p.grid, [0, 7, 3, 6, 2, 9, 5, 8]));
    expect(a.violations.loopEdges).toEqual([0, 2, 3, 5, 6, 7, 8, 9]);
  });

  test("does not flag open paths", () => {
    const p = puzzle(2, 2, "....");
    expect(analyzeBoard(p, board(p.grid, [0, 1, 8]))).toEqual({
      violations: NO_VIOLATIONS,
      solved: false,
      satisfiedClues: 0,
      clueCount: 0,
    });
  });

  test("treats two loops sharing a dot as a dot violation, not a closed loop", () => {
    const p = puzzle(2, 2, "....");
    const a = analyzeBoard(p, board(p.grid, [...AROUND_C0, ...AROUND_C3]));
    expect(a.violations.dots).toEqual([4]);
    expect(a.violations.loopEdges).toEqual([]);
    expect(a.solved).toBe(false);
  });

  test("detects a solved board, with or without crosses", () => {
    const p = puzzle(2, 2, "2222");
    const crossed = analyzeBoard(p, board(p.grid, OUTER, [2, 3, 7, 10]));
    expect(crossed).toEqual({
      violations: NO_VIOLATIONS,
      solved: true,
      satisfiedClues: 4,
      clueCount: 4,
    });
    expect(analyzeBoard(p, board(p.grid, OUTER)).solved).toBe(true);
  });

  test("any single loop solves a puzzle without clues", () => {
    const p = puzzle(1, 1, ".");
    expect(analyzeBoard(p, board(p.grid, [0, 1, 2, 3])).solved).toBe(true);
  });

  test("rejects edge states of the wrong length", () => {
    const p = puzzle(1, 1, ".");
    expect(() => analyzeBoard(p, new Uint8Array(3))).toThrow(RangeError);
  });

  test("finds exactly the 13 loops among all line sets on an empty 2×2", () => {
    const p = puzzle(2, 2, "....");
    let solved = 0;
    for (let mask = 0; mask < 2 ** 12; mask++) {
      if (analyzeBoard(p, fromMask(12, mask)).solved) solved++;
    }
    expect(solved).toBe(13);
  });

  test("solved matches brute force over every line set", () => {
    const sizes = fc.constantFrom<[number, number]>([1, 1], [1, 2], [2, 1], [1, 3], [3, 1], [2, 2]);
    const clue = fc.oneof(
      { arbitrary: fc.constant("."), weight: 3 },
      { arbitrary: fc.constantFrom("0", "1", "2", "3"), weight: 2 },
    );
    fc.assert(
      fc.property(sizes, fc.array(clue, { minLength: 4, maxLength: 4 }), ([w, h], chars) => {
        const p = puzzle(w, h, chars.slice(0, w * h).join(""));
        const expected = bruteForceSolutions(p, Number.POSITIVE_INFINITY).map(encodeEdges);
        const solved: string[] = [];
        const n = p.grid.edgeCount;
        for (let mask = 0; mask < 2 ** n; mask++) {
          const edges = fromMask(n, mask);
          if (analyzeBoard(p, edges).solved) solved.push(encodeEdges(edges));
        }
        expect(solved.sort()).toEqual(expected.sort());
      }),
      { numRuns: 40 },
    );
  });

  test("never flags a board that agrees with a solution (FR-15)", () => {
    fc.assert(
      fc.property(
        arbPuzzleWithSolution(4, 4),
        fc.infiniteStream(fc.boolean()),
        ({ puzzle: p, solution }, reveal) => {
          const edges = new Uint8Array(p.grid.edgeCount);
          const shown = reveal.take(edges.length);
          let e = 0;
          for (const r of shown) {
            if (r) edges[e] = solution[e];
            e++;
          }
          expect(hasViolations(analyzeBoard(p, edges).violations)).toBe(false);
          const full = analyzeBoard(p, solution);
          expect(full.solved).toBe(true);
          expect(hasViolations(full.violations)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("hasViolations", () => {
  test("is true when any list is non-empty", () => {
    expect(hasViolations(NO_VIOLATIONS)).toBe(false);
    expect(hasViolations({ ...NO_VIOLATIONS, starvedCells: [3] })).toBe(true);
    expect(hasViolations({ ...NO_VIOLATIONS, loopEdges: [1] })).toBe(true);
  });
});
