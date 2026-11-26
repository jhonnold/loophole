import { describe, expect, test } from "bun:test";
import {
  CONTRADICTION_TEXT,
  decodeEdges,
  EdgeState,
  findHint,
  type Hint,
  parsePuzzle,
  RULE_TEXT,
  RULE_TITLE,
  type Step,
} from "@loophole/core";
import { FIXTURE_SOLUTIONS } from "../test-support/solutions.ts";
import type { EdgeChange } from "./board.ts";
import { hintCurrent, hintRect, hintView, puzzleSolution } from "./hint.ts";

// 2×2 all 2s; its only loop runs around the outside.
const puzzle = parsePuzzle({ v: 1, width: 2, height: 2, clues: "2222" });
const grid = puzzle.grid;
const empty = () => new Uint8Array(grid.edgeCount);

describe("hintView", () => {
  test("a lone step is one page: its rule's title and text, its changes ghosted and applied", () => {
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
      before: [],
    };
    const view = hintView(grid, hint, empty());
    expect(view).toEqual({
      eyebrow: "next forced move",
      pages: [
        {
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
        },
      ],
      apply: [
        [0, EdgeState.Cross],
        [7, EdgeState.Cross],
      ],
      applyLabel: "Apply move",
      laterLabel: "I'll draw it",
      before: [EdgeState.Unknown, EdgeState.Unknown],
    });
  });

  test("a line with steps before it: a page per step, the ghosts building up to the whole move", () => {
    const cross = (edge: number, rule: Step["rule"], cells: number[], dots: number[]): Step => ({
      rule,
      changes: [{ edge, state: EdgeState.Cross }],
      cells,
      dots,
    });
    const hint: Hint = {
      kind: "step",
      step: {
        rule: "dot-continue",
        changes: [{ edge: 3, state: EdgeState.Line }],
        cells: [],
        dots: [4],
      },
      before: [
        cross(0, "clue-satisfied", [0], []),
        cross(1, "dot-dead-end", [], [1]),
        cross(8, "dot-dead-end", [], [4]),
      ],
    };
    const view = hintView(grid, hint, empty());
    const moves: EdgeChange[] = [
      [0, EdgeState.Cross],
      [1, EdgeState.Cross],
      [8, EdgeState.Cross],
      [3, EdgeState.Line],
    ];
    expect(view?.apply).toEqual(moves);
    // A run of the same rule keeps a page for each step.
    expect(view?.pages.map((p) => [p.rule, p.title, p.text])).toEqual(
      (["clue-satisfied", "dot-dead-end", "dot-dead-end", "dot-continue"] as const).map((r) => [
        r,
        RULE_TITLE[r],
        RULE_TEXT[r],
      ]),
    );
    // Each page washes its own step's cells and dots, and ghosts every change up to it.
    expect(view?.pages.map((p) => p.marks)).toEqual([
      { cells: [0], dots: [], ghosts: moves.slice(0, 1) },
      { cells: [], dots: [1], ghosts: moves.slice(0, 2) },
      { cells: [], dots: [4], ghosts: moves.slice(0, 3) },
      { cells: [], dots: [4], ghosts: moves },
    ]);
  });

  test("a try-and-see step pages through its supposition, what it forces and where it breaks", () => {
    // The techniques page's lookahead position: supposing the top of the 4×4's first 2 were a line,
    // four moves follow and the last closes a small loop. So it is crossed, and a line goes on.
    const p = parsePuzzle({ v: 1, width: 4, height: 4, clues: ".2..12.33..2.1.." });
    const board = decodeEdges(p.grid, "1020200021001200221010000120001100022100");
    const hint = findHint(p, puzzleSolution(p), board);
    if (hint.kind !== "step") throw new Error(hint.kind);
    const probe = hint.before[0].probe;
    if (probe === undefined) throw new Error("no probe");
    const view = hintView(p.grid, hint, board);
    if (view === null) throw new Error("no view");
    expect(view.pages.map((pg) => pg.title)).toEqual([
      "Suppose it's a line",
      `Then: ${RULE_TITLE["dot-full"]}`,
      `Then: ${RULE_TITLE["dot-continue"]}`,
      `Then: ${RULE_TITLE["dot-dead-end"]}`,
      `Then: ${RULE_TITLE["clue-needs-all"]}`,
      "That can't be",
      RULE_TITLE.lookahead,
      RULE_TITLE["dot-continue"],
    ]);
    // The supposed marks build up from the assumed edge, and the last page of the probe washes the
    // loop that closed.
    const whatIf = view.pages.map((pg) => pg.marks.whatIf?.length ?? 0);
    expect(whatIf).toEqual([1, 2, 3, 4, 5, 5, 0, 0]);
    expect(view.pages[0].marks.whatIf).toEqual([[1, EdgeState.Line]]);
    expect(view.pages[5].text).toBe(CONTRADICTION_TEXT["small-loop"]);
    expect(view.pages[5].marks.conflict?.edges).toEqual([...probe.contradiction.edges]);
    expect(view.pages[6].text).toBe("Drawing this edge breaks the rules, so it must be crossed.");
    // Nothing supposed is ever part of the move, and no page after the probe shows it.
    expect(view.apply).toEqual([
      [1, EdgeState.Cross],
      [21, EdgeState.Line],
    ]);
    for (const pg of view.pages.slice(6)) {
      expect(pg.marks.whatIf).toBeUndefined();
      expect(pg.marks.conflict).toBeUndefined();
    }
    expect(view.pages[6].marks.ghosts).toEqual([[1, EdgeState.Cross]]);
  });

  test("a try-and-see step without its probe keeps the one page", () => {
    const hint: Hint = {
      kind: "step",
      step: {
        rule: "lookahead",
        changes: [{ edge: 3, state: EdgeState.Line }],
        cells: [],
        dots: [4, 5],
      },
      before: [],
    };
    const view = hintView(grid, hint, empty());
    expect(view?.pages.map((pg) => pg.text)).toEqual([RULE_TEXT.lookahead]);
  });

  test("a wrong line is highlighted by its dots and erased, and the others are counted", () => {
    const edges = empty();
    edges[2] = EdgeState.Line;
    const view = hintView(grid, { kind: "mistake", edge: 2, count: 3 }, edges);
    expect(view?.pages).toHaveLength(1);
    expect(view?.pages[0].title).toBe("This line doesn't fit");
    expect(view?.pages[0].text).toEndWith("2 more marks don't fit either.");
    expect(view?.pages[0].marks).toEqual({ cells: [], dots: [3, 4], ghosts: [] });
    expect(view?.apply).toEqual([[2, EdgeState.Unknown]]);
    expect(view?.applyLabel).toBe("Erase it");
    expect(view?.laterLabel).toBe("I'll fix it");
    expect(view?.pages[0].rule).toBeNull();
  });

  test("a wrong cross says the loop needs that edge", () => {
    const edges = empty();
    edges[0] = EdgeState.Cross;
    const view = hintView(grid, { kind: "mistake", edge: 0, count: 1 }, edges);
    expect(view?.pages[0].title).toBe("This × doesn't fit");
    expect(view?.pages[0].text).not.toContain("more");
  });

  test("a revealed line is ghosted and applied as a line", () => {
    const view = hintView(grid, { kind: "reveal", edge: 1 }, empty());
    expect(view?.pages).toHaveLength(1);
    expect(view?.pages[0].marks.ghosts).toEqual([[1, EdgeState.Line]]);
    expect(view?.apply).toEqual([[1, EdgeState.Line]]);
    expect(view?.pages[0].rule).toBeNull();
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
    before: [],
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

  test("ends when its line is drawn, though the crosses before it are still open", () => {
    const chain: Hint = {
      kind: "step",
      step: {
        rule: "dot-continue",
        changes: [{ edge: 3, state: EdgeState.Line }],
        cells: [],
        dots: [4],
      },
      before: [
        {
          rule: "clue-satisfied",
          changes: [{ edge: 0, state: EdgeState.Cross }],
          cells: [0],
          dots: [],
        },
      ],
    };
    const edges = empty();
    const view = hintView(grid, chain, edges);
    if (view === null) throw new Error("no view");
    edges[0] = EdgeState.Cross;
    expect(hintCurrent(view, edges)).toBe(true);
    edges[0] = EdgeState.Unknown;
    edges[3] = EdgeState.Line;
    expect(hintCurrent(view, edges)).toBe(false);
  });

  test("a chain ends when one of its crosses is marked as a line instead", () => {
    const chain: Hint = {
      kind: "step",
      step: {
        rule: "dot-continue",
        changes: [{ edge: 3, state: EdgeState.Line }],
        cells: [],
        dots: [4],
      },
      before: [
        {
          rule: "clue-satisfied",
          changes: [{ edge: 0, state: EdgeState.Cross }],
          cells: [0],
          dots: [],
        },
      ],
    };
    const edges = empty();
    const view = hintView(grid, chain, edges);
    if (view === null) throw new Error("no view");
    edges[0] = EdgeState.Line;
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

  test("covers supposed marks and where they break the rules too", () => {
    const marks = {
      cells: [],
      dots: [],
      ghosts: [],
      whatIf: [[0, EdgeState.Line]] as EdgeChange[],
      conflict: { cells: [], dots: [8], edges: [] },
    };
    // Edge 0's middle at (30, 10), dot 8 at (90, 90).
    expect(hintRect(grid, layout, marks)).toEqual({ x: 10, y: -10, width: 100, height: 120 });
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
