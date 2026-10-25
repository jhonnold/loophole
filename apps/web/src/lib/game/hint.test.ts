import { describe, expect, test } from "bun:test";
import {
  decodeEdges,
  EdgeState,
  findHint,
  type Hint,
  parsePuzzle,
  RULE_TEXT,
  RULE_TITLE,
} from "@loophole/core";
import { FIXTURE_SOLUTIONS } from "../test-support/solutions.ts";
import { hintCurrent, hintRect, hintView, puzzleSolution } from "./hint.ts";

// 2×2 all 2s; its only loop runs around the outside.
const puzzle = parsePuzzle({ v: 1, width: 2, height: 2, clues: "2222" });
const grid = puzzle.grid;
const empty = () => new Uint8Array(grid.edgeCount);

describe("hintView", () => {
  test("a step shows its rule's title and text, ghosts its changes and applies them", () => {
    const hint: Hint = {
      kind: "step",
      step: {
        rule: "clue-zero",
        changes: [
          { edge: 0, state: EdgeState.Cross },
          { edge: 7, state: EdgeState.Cross },
        ],
        cells: [0],
        dots: [],
      },
    };
    const view = hintView(grid, hint, empty());
    expect(view).toEqual({
      eyebrow: "next forced move",
      title: RULE_TITLE["clue-zero"],
      text: RULE_TEXT["clue-zero"],
      rule: "clue-zero",
      marks: {
        cells: [0],
        dots: [],
        ghosts: [
          [0, EdgeState.Cross],
          [7, EdgeState.Cross],
        ],
      },
      apply: [
        [0, EdgeState.Cross],
        [7, EdgeState.Cross],
      ],
      applyLabel: "Apply move",
      laterLabel: "I'll draw it",
      before: [EdgeState.Unknown, EdgeState.Unknown],
    });
  });

  test("a wrong line is highlighted by its dots and erased, and the others are counted", () => {
    const edges = empty();
    edges[2] = EdgeState.Line;
    const view = hintView(grid, { kind: "mistake", edge: 2, count: 3 }, edges);
    expect(view?.title).toBe("This line doesn't fit");
    expect(view?.text).toEndWith("2 more marks don't fit either.");
    expect(view?.marks).toEqual({ cells: [], dots: [3, 4], ghosts: [] });
    expect(view?.apply).toEqual([[2, EdgeState.Unknown]]);
    expect(view?.applyLabel).toBe("Erase it");
    expect(view?.laterLabel).toBe("I'll fix it");
    expect(view?.rule).toBeNull();
  });

  test("a wrong cross says the loop needs that edge", () => {
    const edges = empty();
    edges[0] = EdgeState.Cross;
    const view = hintView(grid, { kind: "mistake", edge: 0, count: 1 }, edges);
    expect(view?.title).toBe("This × doesn't fit");
    expect(view?.text).not.toContain("more");
  });

  test("a revealed line is ghosted and applied as a line", () => {
    const view = hintView(grid, { kind: "reveal", edge: 1 }, empty());
    expect(view?.marks.ghosts).toEqual([[1, EdgeState.Line]]);
    expect(view?.apply).toEqual([[1, EdgeState.Line]]);
    expect(view?.rule).toBeNull();
  });

  test("a solved board has nothing to show", () => {
    expect(hintView(grid, { kind: "solved" }, empty())).toBeNull();
  });
});

describe("hintCurrent", () => {
  const hint: Hint = {
    kind: "step",
    step: {
      rule: "clue-needs-all",
      changes: [
        { edge: 0, state: EdgeState.Line },
        { edge: 1, state: EdgeState.Line },
      ],
      cells: [0],
      dots: [],
    },
  };

  test("holds while part of the move is still to make", () => {
    const edges = empty();
    const view = hintView(grid, hint, edges);
    if (view === null) throw new Error("no view");
    expect(hintCurrent(view, edges)).toBe(true);
    edges[0] = EdgeState.Line;
    expect(hintCurrent(view, edges)).toBe(true);
    edges[5] = EdgeState.Cross; // elsewhere
    expect(hintCurrent(view, edges)).toBe(true);
  });

  test("ends when the whole move is made", () => {
    const edges = empty();
    const view = hintView(grid, hint, edges);
    if (view === null) throw new Error("no view");
    edges[0] = EdgeState.Line;
    edges[1] = EdgeState.Line;
    expect(hintCurrent(view, edges)).toBe(false);
  });

  test("ends when one of its edges is marked differently", () => {
    const edges = empty();
    const view = hintView(grid, hint, edges);
    if (view === null) throw new Error("no view");
    edges[1] = EdgeState.Cross;
    expect(hintCurrent(view, edges)).toBe(false);
  });
});

describe("hintRect", () => {
  const layout = { cell: 40, margin: 10, width: 100, height: 100 };

  test("covers cells, dots and ghost edges with half a cell around them", () => {
    // Cell 0 is centred at (30, 30); dot 8 (row 2, col 2) is at (90, 90).
    expect(hintRect(grid, layout, { cells: [0], dots: [8], ghosts: [] })).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    });
    // Edge 0 (top of cell 0) has its middle at (30, 10).
    expect(hintRect(grid, layout, { cells: [], dots: [], ghosts: [[0, EdgeState.Line]] })).toEqual({
      x: 10,
      y: -10,
      width: 40,
      height: 40,
    });
  });

  test("is null without marks", () => {
    expect(hintRect(grid, layout, { cells: [], dots: [], ghosts: [] })).toBeNull();
  });
});

describe("puzzleSolution", () => {
  test("works out a built-in puzzle's solution from its clues", () => {
    const small = parsePuzzle({
      v: 1,
      width: 7,
      height: 7,
      clues: ".11..0..23.2......2.21.0....1....01.1..3..0..1..1",
    });
    const solution = puzzleSolution(small);
    expect(solution).toEqual(decodeEdges(small.grid, FIXTURE_SOLUTIONS["small-7"]));
    expect(findHint(small, solution, solution)).toEqual({ kind: "solved" });
  });

  test("throws for a puzzle without a single solution", () => {
    expect(() => puzzleSolution(parsePuzzle({ v: 1, width: 2, height: 2, clues: "...." }))).toThrow(
      "No single solution",
    );
  });
});
