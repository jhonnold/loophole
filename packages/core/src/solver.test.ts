import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { bruteForceSolutions } from "./bruteforce.ts";
import { decodeEdges, encodeEdges, parsePuzzle } from "./format.ts";
import { EdgeState } from "./grid.ts";
import { RULE_IDS, type RuleId, type Step } from "./rules.ts";
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
    [2, 3, ".331..", 4, { rule: "lookahead", changes: "0:2", cells: [2], dots: [0, 1] }],
    [2, 3, ".331..", 7, { rule: "clue-satisfied", changes: "3:2", cells: [1], dots: [] }],
    [
      2,
      3,
      "33....",
      8,
      { rule: "loop-complete", changes: "4:2 5:2 6:2 7:2 14:2 15:2 16:2", cells: [], dots: [] },
    ],
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
    const p = puzzle(2, 2, "2222");
    expect(solve(p, { lookahead: false }).status).toBe("stuck");
    expect(solve(p).status).toBe("solved");
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
});
