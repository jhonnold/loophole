import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { countSolutions } from "./bruteforce.ts";
import { decodeEdges, parsePuzzle } from "./format.ts";
import { generate } from "./generate.ts";
import { EdgeState, hEdgeIndex } from "./grid.ts";
import { findHint } from "./hint.ts";
import type { Puzzle } from "./puzzle.ts";
import type { RuleId } from "./rules.ts";
import { solve } from "./solver.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { levelRuleIds } from "./test-support/levels.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

/** Takes every hint from an empty board to the end: the rules the steps named, and the reveals. */
function hintWalk(p: Puzzle, solution: Uint8Array): { rules: Set<RuleId>; reveals: number } {
  const board = new Uint8Array(p.grid.edgeCount);
  const rules = new Set<RuleId>();
  let reveals = 0;
  // Each hint decides at least one edge; the cap turns a regression into a failure, not a hang.
  for (let n = 0; n <= p.grid.edgeCount; n++) {
    const hint = findHint(p, solution, board);
    if (hint.kind === "solved") return { rules, reveals };
    if (hint.kind === "step") {
      rules.add(hint.step.rule);
      for (const { edge, state } of hint.step.changes) board[edge] = state;
    } else if (hint.kind === "reveal") {
      reveals++;
      board[hint.edge] = EdgeState.Line;
    } else {
      throw new Error(`unexpected ${hint.kind}`);
    }
  }
  throw new Error("the hints did not reach the solution");
}

describe("findHint", () => {
  test("names the next rule from an empty board", () => {
    // 2×2 with a 0 in the top-left cell: the 0's four sides are crossed first.
    const p = puzzle(2, 2, "0...");
    const solution = decodeEdges(p.grid, "222121222211");
    const hint = findHint(p, solution, new Uint8Array(p.grid.edgeCount));
    expect(hint).toEqual({
      kind: "step",
      step: {
        rule: "clue-zero",
        changes: [
          { edge: 0, state: EdgeState.Cross },
          { edge: 7, state: EdgeState.Cross },
          { edge: 2, state: EdgeState.Cross },
          { edge: 6, state: EdgeState.Cross },
        ],
        cells: [0],
        dots: [],
      },
    });
  });

  test("starts from the player's marks", () => {
    // Same puzzle with the 0's sides already crossed: the next step is a different rule.
    const p = puzzle(2, 2, "0...");
    const solution = decodeEdges(p.grid, "222121222211");
    const board = decodeEdges(p.grid, "202000220000");
    const hint = findHint(p, solution, board);
    expect(hint.kind).toBe("step");
    if (hint.kind !== "step") return;
    expect(hint.step.rule).not.toBe("clue-zero");
    for (const { edge, state } of hint.step.changes) {
      expect(board[edge]).toBe(EdgeState.Unknown);
      expect(solution[edge]).toBe(state);
    }
  });

  test("reports the first wrong mark and how many there are", () => {
    // 2×2 all 2s; its only loop runs around the outside.
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    const board = new Uint8Array(p.grid.edgeCount);
    board[0] = EdgeState.Cross; // a line in the solution
    board[2] = EdgeState.Line; // a cross in the solution
    board[1] = EdgeState.Line; // right
    expect(findHint(p, solution, board)).toEqual({ kind: "mistake", edge: 0, count: 2 });
  });

  test("says when the board is already solved, crosses or not", () => {
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    expect(findHint(p, solution, solution)).toEqual({ kind: "solved" });
    const linesOnly = solution.map((s) => (s === EdgeState.Line ? s : EdgeState.Unknown));
    expect(findHint(p, solution, linesOnly)).toEqual({ kind: "solved" });
  });

  test("reveals a line of the solution when no rule applies, extending the player's line", () => {
    // 3×3 with no clues: no rule decides anything. The solution is the outer ring.
    const p = puzzle(3, 3, ".........");
    const solution = decodeEdges(p.grid, "111222222111122112211221");
    const empty = new Uint8Array(p.grid.edgeCount);
    expect(findHint(p, solution, empty)).toEqual({ kind: "reveal", edge: 0 });
    // A line on the bottom edge: the reveal continues it rather than starting at the top.
    const board = empty.slice();
    board[hEdgeIndex(p.grid, 3, 1)] = EdgeState.Line;
    expect(findHint(p, solution, board)).toEqual({
      kind: "reveal",
      edge: hEdgeIndex(p.grid, 3, 0),
    });
  });

  test("reveals a line instead when the time limit stops the search for a deduction", () => {
    // Small-7 (a web fixture): replay its solver steps up to its first lookahead, which only comes
    // after the time-checked tiers. With a clock already past the limit the hint is a reveal.
    const p = puzzle(7, 7, ".11..0..23.2......2.21.0....1....01.1..3..0..1..1");
    const full = solve(p);
    const board = new Uint8Array(p.grid.edgeCount);
    for (const step of full.steps) {
      if (step.rule === "lookahead") break;
      for (const c of step.changes) board[c.edge] = c.state;
    }
    const hint = findHint(p, full.edges, board);
    expect(hint.kind === "step" && hint.step.rule).toBe("lookahead");
    let t = 0;
    const late = findHint(p, full.edges, board, { timeLimitMs: 500, now: () => (t += 1000) });
    expect(late.kind).toBe("reveal");
  });

  test("uses only the rules of the puzzle's level", () => {
    // The default level's 10×10 "golden" puzzle needs corner rules and lookahead. Labelled easy, its
    // hints may use only the rules every level has, and reveal lines where those get stuck.
    const { puzzle: hard, solution } = generate({ width: 10, height: 10, seed: "golden" });
    const easy = levelRuleIds("easy");
    const fromHard = hintWalk(hard, solution);
    expect(fromHard.reveals).toBe(0);
    expect(fromHard.rules.has("lookahead")).toBe(true);
    expect([...fromHard.rules].some((rule) => rule !== "lookahead" && !easy.has(rule))).toBe(true);
    const labelled = { ...hard, meta: { ...hard.meta, level: "easy" } };
    const fromLabelled = hintWalk(labelled, solution);
    expect([...fromLabelled.rules].filter((rule) => !easy.has(rule))).toEqual([]);
    expect(fromLabelled.reveals).toBeGreaterThan(0);
  });

  test("an easy or medium puzzle's hints reach the solution with its own rules", () => {
    for (const level of ["easy", "medium"] as const) {
      const { puzzle: p, solution } = generate({ width: 10, height: 10, seed: "hints", level });
      const walk = hintWalk(p, solution);
      expect(walk.reveals).toBe(0);
      const allowed = levelRuleIds(level);
      expect([...walk.rules].filter((rule) => !allowed.has(rule))).toEqual([]);
    }
  });

  test("rejects boards of the wrong size", () => {
    const p = puzzle(2, 2, "2222");
    expect(() => findHint(p, new Uint8Array(12), new Uint8Array(3))).toThrow(RangeError);
  });

  test("every hint agrees with the solution (property)", () => {
    fc.assert(
      fc.property(
        arbPuzzleWithSolution(4, 4),
        fc.boolean(),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 40, maxLength: 40 }),
        ({ puzzle: p, solution }, withMistakes, picks) => {
          // A puzzle with several solutions has no mistake relative to one of them (a board can be
          // another valid solution), so the oracle only holds for puzzles with exactly one.
          if (countSolutions(p, 2) !== 1) return;
          // Per edge: 0-5 left open, 6-8 copied from the solution, 9 wrong (or open without mistakes).
          const board = new Uint8Array(p.grid.edgeCount);
          let wrong = 0;
          for (let e = 0; e < board.length; e++) {
            const pick = picks[e % picks.length];
            if (pick >= 6 && pick <= 8) board[e] = solution[e];
            else if (pick === 9 && withMistakes) {
              board[e] = solution[e] === EdgeState.Line ? EdgeState.Cross : EdgeState.Line;
              wrong++;
            }
          }
          const hint = findHint(p, solution, board);
          if (wrong > 0) {
            expect(hint.kind).toBe("mistake");
            if (hint.kind !== "mistake") return;
            expect(hint.count).toBe(wrong);
            expect(board[hint.edge]).not.toBe(solution[hint.edge]);
            return;
          }
          if (hint.kind === "solved") {
            expect(analyzeBoard(p, board).solved).toBe(true);
          } else if (hint.kind === "step") {
            for (const { edge, state } of hint.step.changes) {
              expect(board[edge]).toBe(EdgeState.Unknown);
              expect(solution[edge]).toBe(state);
            }
          } else if (hint.kind === "reveal") {
            expect(board[hint.edge]).toBe(EdgeState.Unknown);
            expect(solution[hint.edge]).toBe(EdgeState.Line);
          } else {
            throw new Error(`unexpected ${hint.kind}`);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
