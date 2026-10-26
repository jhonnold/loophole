import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { bruteForceSolutions } from "./bruteforce.ts";
import { decodeEdges, encodeEdges, parsePuzzle } from "./format.ts";
import { createGrid, EdgeState } from "./grid.ts";
import { generateLoop } from "./loop.ts";
import { createPuzzle, deriveClues, NO_CLUE } from "./puzzle.ts";
import { createRng } from "./rng.ts";
import { GROUP_RULES, RULE_GROUPS, RULE_IDS, type RuleId, type Step } from "./rules.ts";
import { solve } from "./solver.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { FIXTURES } from "./test-support/fixtures.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

/** A step written compactly: changes as "edge:state" pairs. */
function brief(step: Step) {
  return {
    rule: step.rule,
    changes: step.changes.map((c) => `${c.edge}:${c.state}`).join(" "),
    cells: step.cells,
    dots: step.dots,
  };
}

/** Replays steps from `initial` and checks each one only sets edges that were still unknown. */
function replay(edgeCount: number, steps: Step[], initial?: Uint8Array): Uint8Array {
  const edges = initial === undefined ? new Uint8Array(edgeCount) : initial.slice();
  for (const step of steps) {
    expect(step.changes.length).toBeGreaterThan(0);
    for (const { edge, state } of step.changes) {
      expect(edges[edge]).toBe(EdgeState.Unknown);
      edges[edge] = state;
    }
  }
  return edges;
}

describe("solve: each rule", () => {
  // [width, height, clues, step index, expected step]. Edge numbering: docs/FORMAT.md.
  const cases: [number, number, string, number, ReturnType<typeof brief>][] = [
    [2, 2, "0...", 0, { rule: "clue-zero", changes: "0:2 7:2 2:2 6:2", cells: [0], dots: [] }],
    [2, 2, "0...", 1, { rule: "dot-dead-end", changes: "1:2", cells: [], dots: [1] }],
    [1, 2, "3.", 0, { rule: "corner-3", changes: "0:1 3:1", cells: [0], dots: [0] }],
    [1, 2, "1.", 0, { rule: "corner-1", changes: "0:2 3:2", cells: [0], dots: [0] }],
    [1, 2, "3.", 2, { rule: "premature-loop", changes: "1:2", cells: [], dots: [2, 3] }],
    [1, 2, "3.", 3, { rule: "dot-continue", changes: "6:1", cells: [], dots: [3] }],
    [
      2,
      3,
      "..33..",
      0,
      { rule: "adjacent-3s", changes: "11:1 13:1 9:2 15:2", cells: [2, 3], dots: [] },
    ],
    [2, 3, "..33..", 1, { rule: "parity", changes: "12:2", cells: [2, 3], dots: [] }],
    [2, 3, "..33..", 2, { rule: "clue-needs-all", changes: "3:1 5:1", cells: [3], dots: [] }],
    [2, 3, "..33..", 4, { rule: "dot-full", changes: "10:2", cells: [], dots: [5] }],
    [2, 3, ".331..", 1, { rule: "diagonal-3s", changes: "4:1 11:1", cells: [1, 2], dots: [] }],
    [1, 3, "0..", 3, { rule: "lookahead", changes: "2:1", cells: [], dots: [4, 5] }],
    [2, 3, ".331..", 12, { rule: "clue-satisfied", changes: "3:2", cells: [3], dots: [] }],
    [
      2,
      3,
      "33....",
      8,
      { rule: "loop-complete", changes: "4:2 5:2 6:2 7:2 14:2 15:2 16:2", cells: [], dots: [] },
    ],
    // Corner rules (WT16): for each, the smallest puzzle, then the fewest clues, where it fires.
    [
      1,
      4,
      "1.1.",
      5,
      { rule: "line-into-1", changes: "2:1 10:2 3:2 9:2", cells: [2], dots: [4, 5] },
    ],
    [2, 3, "3.11..", 2, { rule: "line-into-3", changes: "3:1", cells: [0], dots: [4] }],
    [
      2,
      2,
      "22..",
      0,
      { rule: "two-passes-on", changes: "1:1 7:2 0:1", cells: [0, 1], dots: [0, 1, 2] },
    ],
    [2, 2, "2.2.", 0, { rule: "two-in-corner", changes: "1:1", cells: [0], dots: [0, 1] }],
    [2, 4, "2.1.11..", 0, { rule: "ones-side-by-side", changes: "4:2", cells: [2, 4], dots: [6] }],
    [
      2,
      3,
      "3.21..",
      1,
      { rule: "three-diagonal-one", changes: "13:2 5:2", cells: [0, 3], dots: [4] },
    ],
    [1, 4, ".31.", 0, { rule: "corner-chain", changes: "7:1", cells: [1, 2], dots: [4] }],
    // Colouring (WT17): for each, the smallest puzzle, then the fewest clues, where it fires.
    [2, 4, "1..11...", 3, { rule: "colour-1", changes: "17:2", cells: [4, 5], dots: [] }],
    [1, 3, ".2.", 0, { rule: "colour-2", changes: "0:1", cells: [0, 1], dots: [] }],
    [1, 4, ".32.", 0, { rule: "colour-3", changes: "8:1", cells: [1], dots: [] }],
    [3, 3, "3..2.23..", 2, { rule: "colour-chain", changes: "2:1", cells: [2, 3, 5], dots: [] }],
  ];

  for (const [w, h, clues, index, expected] of cases) {
    test(`${expected.rule} on ${w}×${h} "${clues}" (step ${index})`, () => {
      const result = solve(puzzle(w, h, clues));
      expect(result.status).toBe("solved");
      expect(brief(result.steps[index])).toEqual(expected);
    });
  }

  test("every rule id is covered above", () => {
    const covered = new Set<RuleId>(cases.map((c) => c[4].rule as RuleId));
    expect([...covered].sort()).toEqual([...RULE_IDS].sort());
  });

  test("leaving the corners group out drops its rules, and the default is every group", () => {
    const p = puzzle(1, 4, ".31.");
    const without = solve(p, { rules: [] });
    expect(without.status).toBe("solved");
    const corners = new Set<RuleId>(GROUP_RULES.corners);
    expect(without.steps.some((s) => corners.has(s.rule))).toBe(false);
    expect(without.steps[0].rule).toBe("lookahead");
    expect(solve(p, { rules: [...RULE_GROUPS] })).toEqual(solve(p));
    expect(solve(p).steps[0].rule).toBe("corner-chain");
  });

  test("without steps it reaches the same edges and records none", () => {
    const p = puzzle(3, 3, "0...11.3.");
    const full = solve(p);
    const bare = solve(p, { steps: false });
    expect(bare.status).toBe(full.status);
    expect(bare.edges).toEqual(full.edges);
    expect(bare.steps).toEqual([]);
  });

  test("leaving the colouring group out drops its rules", () => {
    // A 2 in a one-wide strip, between two outside cells: either it is inside (lines on both sides
    // beside the outside) and so are the cells above and below it, or it is outside and both of
    // those differ from it. Either way they are inside. No other rule, lookahead included, sees it.
    const p = puzzle(1, 3, ".2.");
    const without = solve(p, { rules: ["corners"] });
    expect(without.status).toBe("stuck");
    expect(without.steps).toEqual([]);
    const all = solve(p);
    expect(all.status).toBe("solved");
    expect(all.steps[0].rule).toBe("colour-2");
    expect(GROUP_RULES.colouring).toContain(all.steps[0].rule);
  });

  test("two 3s side by side do not claim their shared side", () => {
    // The only solution is the rectangle around both cells, with the shared side crossed.
    const p = puzzle(2, 1, "33");
    const result = solve(p);
    expect(result.status).toBe("solved");
    expect(encodeEdges(result.edges)).toBe(encodeEdges(bruteForceSolutions(p)[0]));
    expect(result.edges[5]).toBe(EdgeState.Cross);
  });
});

describe("solve", () => {
  for (const f of FIXTURES) {
    test(`fixture ${f.name}: status fits the solution count and steps replay`, () => {
      const p = puzzle(f.width, f.height, f.clues);
      const result = solve(p);
      if (result.status === "solved") {
        expect(f.count).toBe(1);
        expect(analyzeBoard(p, result.edges).solved).toBe(true);
        if (f.solutions !== undefined) expect(encodeEdges(result.edges)).toBe(f.solutions[0]);
      }
      if (result.status === "contradiction") expect(f.count).toBe(0);
      else expect(replay(p.grid.edgeCount, result.steps)).toEqual(result.edges);
    });
  }

  test("stops at maxSteps", () => {
    const result = solve(puzzle(2, 2, "0..."), { maxSteps: 1 });
    expect(result.status).toBe("incomplete");
    expect(result.steps.map((s) => s.rule)).toEqual(["clue-zero"]);
  });

  test("stops when the time limit passes", () => {
    let t = 0;
    const result = solve(puzzle(3, 3, "........."), { timeLimitMs: 0, now: () => t++ });
    expect(result.status).toBe("incomplete");
  });

  test("honours the time limit without lookahead too", () => {
    let t = 0;
    const result = solve(puzzle(3, 3, "........."), {
      lookahead: false,
      timeLimitMs: 0,
      now: () => t++,
    });
    expect(result.status).toBe("incomplete");
  });

  test("without lookahead it can get stuck where lookahead solves", () => {
    const p = puzzle(2, 2, "0...");
    expect(solve(p, { lookahead: false }).status).toBe("stuck");
    expect(solve(p).status).toBe("solved");
  });

  test("checks for an early loop at both ends of a path that a line joined", () => {
    // clue-gaps-5-81#5 from the WT14 corpus. Joining two paths makes their far ends the new path's
    // ends without queueing them; lookahead then missed a loop closing there too early, and the
    // solver got stuck.
    expect(solve(puzzle(5, 5, ".3.22.1.1.3..2..222132.10")).status).toBe("solved");
  });

  test("continues from a partial board and leaves its edges alone", () => {
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    const initial = solution.map((s, e) => (e % 2 === 0 ? s : EdgeState.Unknown));
    const result = solve(p, { initial });
    expect(result.status).toBe("solved");
    expect(result.edges).toEqual(solution);
    expect(replay(p.grid.edgeCount, result.steps, initial)).toEqual(solution);
  });

  test("reports a contradiction for a board that breaks a rule", () => {
    const p = puzzle(2, 2, "2222");
    // A loop around cell 0 alone: closed too early.
    const initial = decodeEdges(p.grid, "101000110000");
    expect(solve(p, { initial }).status).toBe("contradiction");
  });

  test("rejects a malformed starting board", () => {
    const p = puzzle(2, 2, "....");
    expect(() => solve(p, { initial: new Uint8Array(11) })).toThrow(RangeError);
    expect(() => solve(p, { initial: new Uint8Array(12).fill(3) })).toThrow(RangeError);
  });

  test("from a correct partial board it never contradicts the solution", () => {
    fc.assert(
      fc.property(
        arbPuzzleWithSolution(4, 4),
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        ({ puzzle: p, solution }, given) => {
          const initial = solution.map((s, e) => (given[e] ? s : EdgeState.Unknown));
          const result = solve(p, { initial });
          expect(result.status).not.toBe("contradiction");
          expect(result.status).not.toBe("incomplete");
          expect(replay(p.grid.edgeCount, result.steps, initial)).toEqual(result.edges);
          result.edges.forEach((s, e) => {
            if (s !== EdgeState.Unknown) expect(s).toBe(solution[e]);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  test("larger planted boards: sound, and solving from part of a result gives that result", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 1, max: 9 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.double({ min: 0.2, max: 1, noNaN: true }),
        fc.subarray([...RULE_GROUPS]),
        fc.boolean(),
        fc.boolean(),
        (w, h, seed, keep, rules, lookahead, steps) => {
          const grid = createGrid(w, h);
          const rng = createRng(seed);
          const solution = generateLoop(grid, rng);
          const clues = Array.from(deriveClues(grid, solution), (k) =>
            k < 4 && rng.float() < keep ? k : NO_CLUE,
          );
          const p = createPuzzle(w, h, clues);
          const options = { lookahead, rules, steps };
          const given = solution.map((s) => (rng.float() < 0.2 ? s : EdgeState.Unknown));
          const result = solve(p, { ...options, initial: given });
          expect(result.status).not.toBe("contradiction");
          result.edges.forEach((s, e) => {
            if (s !== EdgeState.Unknown) expect(s).toBe(solution[e]);
          });
          // The result does not depend on the order deductions came in, nor on whether steps are
          // recorded (colouring stops at its first step then, and runs to the end otherwise).
          const part = result.edges.map((s, e) =>
            given[e] !== EdgeState.Unknown || rng.float() < 0.5 ? s : EdgeState.Unknown,
          );
          expect(solve(p, { ...options, steps: !steps, initial: part }).edges).toEqual(
            result.edges,
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
