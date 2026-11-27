import { describe, expect, test } from "bun:test";
import {
  createGrid,
  type Deduction,
  decodeEdges,
  EdgeState,
  findHint,
  hEdgeIndex,
  NONE,
  parsePuzzle,
  solve,
  vEdgeIndex,
} from "@loophole/core";
import { hintView } from "./hint.ts";
import { hatchSegments, sideMarks, sideTexts, tintSquare } from "./sides.ts";

// Core's hint tests: the 10×10 hard puzzle from seed "side-188", just before a "Sides around a 3".
const p10 = parsePuzzle({
  v: 1,
  width: 10,
  height: 10,
  clues:
    "222..223.03.3..2.21..2...13..1.....2.12233..23.3.2..........3..10.......111.2.10..222...3.3......1..",
});
const p10Board = decodeEdges(
  p10.grid,
  "0110112122000012222210101222220000121211000121211200021101220002200021000220002200200000120000000000100000000000200211122100021111220000021112202002122221101012112110200200011100012200020002020002220001000001010000000000",
);

function p10Step() {
  const hint = findHint(p10, solve(p10).edges, p10Board);
  if (hint.kind !== "step") throw new Error(hint.kind);
  return hint.step;
}

describe("side proofs on the board", () => {
  test("tint cells in or out, and the step's own cells strongly", () => {
    const marks = sideMarks(p10.grid, p10Step());
    expect(marks).toEqual({
      cells: [
        { cell: 2, tone: "in", strong: true },
        { cell: 4, tone: "in", strong: false },
        { cell: 11, tone: "a", strong: true },
        { cell: 12, tone: "b", strong: true },
        { cell: 13, tone: "out", strong: true },
        { cell: 14, tone: "out", strong: false },
      ],
      edges: [2, 4, 14, 125],
    });
  });

  test("a step without a side proof has no marks or words", () => {
    const step: Deduction = { rule: "clue-zero", changes: [], cells: [0], dots: [] };
    expect(sideMarks(p10.grid, step)).toBeUndefined();
    expect(sideTexts(p10.grid, p10.clues, step)).toBeNull();
  });

  test("without the clues, a colouring step falls back to its rule's words", () => {
    expect(sideTexts(p10.grid, [], p10Step())).toBeNull();
  });

  test("a hint's pages carry them: what the marks show, then what the 3 makes of it", () => {
    const step = p10Step();
    const view = hintView(p10.grid, { kind: "step", step, before: [] }, p10Board, p10.clues);
    expect(view?.pages.map((pg) => pg.text)).toEqual([
      "Off the board is outside; a × keeps the side, a line switches it. The 2 above is inside, the cell to the right outside.",
      "A 3 has one neighbour on its side, so the cell to the left is on the other side: its left side is a line.",
    ]);
    for (const pg of view?.pages ?? []) {
      expect(pg.title).toBe("Sides around a 3");
      expect(pg.marks.sides?.edges).toEqual([2, 4, 14, 125]);
    }
  });
});

describe("side words", () => {
  // A 3×3 board: cells 0–8, the edge between cells 3 and 4 (row 1).
  const grid = createGrid(3, 3);
  const mid = vEdgeIndex(grid, 1, 1);
  const parity = (flips: [boolean, boolean], group: number, state: EdgeState): Deduction => ({
    rule: "parity",
    changes: [{ edge: mid, state: state as typeof EdgeState.Line }],
    cells: [3, 4],
    dots: [],
    sides: {
      cells: [
        { cell: 3, group, flip: flips[0] },
        { cell: 4, group, flip: flips[1] },
      ],
      edges: [],
      known: [],
      forced: [],
    },
  });
  const clues = new Array(9).fill(-1);

  test("parity: in or out from the board's edge", () => {
    expect(sideTexts(grid, clues, parity([true, true], 0, EdgeState.Cross))).toEqual([
      "Off the board is outside; a × keeps the side, a line switches it. Both cells by the marked edge are inside: crossed.",
    ]);
    expect(sideTexts(grid, clues, parity([true, false], 0, EdgeState.Line))).toEqual([
      "Off the board is outside; a × keeps the side, a line switches it. One cell by the marked edge is inside, one outside: a line.",
    ]);
  });

  test("parity: only relative when the chain doesn't reach the edge", () => {
    expect(sideTexts(grid, clues, parity([false, true], 1, EdgeState.Line))).toEqual([
      "A × keeps the side, a line switches it, so the cells by the marked edge are on opposite sides: a line.",
    ]);
  });

  test("parity on the border names the one cell", () => {
    const top = hEdgeIndex(grid, 0, 0);
    const step: Deduction = {
      rule: "parity",
      changes: [{ edge: top, state: EdgeState.Line }],
      cells: [0],
      dots: [],
      sides: { cells: [{ cell: 0, group: 0, flip: true }], edges: [], known: [], forced: [] },
    };
    expect(sideTexts(grid, clues, step)).toEqual([
      "Off the board is outside; a × keeps the side, a line switches it. The cell by the marked edge is inside: a line.",
    ]);
  });

  test("a clue's facts relative to itself, and a relation off the board", () => {
    // A 1 in the middle (cell 4): the 2 above and the cell to the left are on its side, so the
    // cell to the right is on the other side, and decides its right side.
    const c = clues.slice();
    c[4] = 1;
    c[1] = 2;
    const right = vEdgeIndex(grid, 1, 2);
    const sides = {
      cells: [
        { cell: 1, group: 1, flip: false },
        { cell: 3, group: 1, flip: false },
        { cell: 4, group: 1, flip: false },
        { cell: 5, group: 1, flip: true },
      ],
      edges: [],
      known: [
        { a: 4, b: 1, same: true, clue: NONE },
        { a: 4, b: 3, same: true, clue: NONE },
      ],
      forced: [{ a: 4, b: 5, same: false, clue: 4 }],
    };
    const step: Deduction = {
      rule: "colour-1",
      changes: [{ edge: right, state: EdgeState.Line }],
      cells: [4],
      dots: [],
      sides,
    };
    expect(sideTexts(grid, c, step)).toEqual([
      "A × keeps the side, a line switches it. The 2 above and the cell to the left are on this 1's side.",
      "A 1 has one neighbour on the other side, so the cell to the right is on the other side: its right side is a line.",
    ]);
    // The same clue on the border, its relation to off the board: the cell is inside.
    const corner = {
      ...step,
      sides: { ...sides, forced: [{ a: 4, b: NONE, same: false, clue: 4 }] },
    };
    expect(sideTexts(grid, c, corner)?.[1]).toContain("so this 1 is inside");
  });
});

describe("hatching", () => {
  test("stays inside the square", () => {
    for (const [x1, y1, x2, y2] of hatchSegments(10, 20, 30, 6)) {
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(10);
        expect(x).toBeLessThanOrEqual(40);
        expect(y).toBeGreaterThanOrEqual(20);
        expect(y).toBeLessThanOrEqual(50);
      }
    }
    expect(hatchSegments(0, 0, 30, 6).length).toBe(9);
  });

  test("mirrored, it runs the other way in the same square", () => {
    const [[x1, y1, x2, y2]] = hatchSegments(0, 0, 30, 6);
    const [[m1, n1, m2, n2]] = hatchSegments(0, 0, 30, 6, true);
    expect([m1, n1, m2, n2]).toEqual([30 - x1, y1, 30 - x2, y2]);
  });

  test("a light tint is a smaller square in the cell", () => {
    expect(tintSquare(50, 50, 40, true)).toEqual({ x: 32, y: 32, size: 36 });
    const light = tintSquare(50, 50, 40, false);
    expect(light.size).toBeLessThan(36);
    expect(light.x + light.size / 2).toBe(50);
  });
});
