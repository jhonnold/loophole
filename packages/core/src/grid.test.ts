import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  cellIndex,
  createGrid,
  dotIndex,
  edgeCoords,
  hEdgeIndex,
  NONE,
  vEdgeIndex,
} from "./grid.ts";

// 2×2 grid numbering used below (dots dN, edges by number):
//
//   d0 -0- d1 -1- d2
//   6      7      8
//   d3 -2- d4 -3- d5
//   9      10     11
//   d6 -4- d7 -5- d8
//
// Cells: c0 top-left, c1 top-right, c2 bottom-left, c3 bottom-right.

describe("createGrid", () => {
  test("counts cells, dots and edges", () => {
    const g = createGrid(2, 2);
    expect([g.width, g.height, g.cellCount, g.dotCount, g.hEdgeCount, g.edgeCount]).toEqual([
      2, 2, 4, 9, 6, 12,
    ]);
    const wide = createGrid(3, 1);
    expect([wide.cellCount, wide.dotCount, wide.hEdgeCount, wide.edgeCount]).toEqual([3, 8, 6, 10]);
    expect(createGrid(100, 100).edgeCount).toBe(20200);
  });

  test("lists each cell's edges as top, right, bottom, left", () => {
    expect(Array.from(createGrid(2, 2).cellEdges)).toEqual([
      0, 7, 2, 6, 1, 8, 3, 7, 2, 10, 4, 9, 3, 11, 5, 10,
    ]);
    // 3×1: edges 0-2 top row, 3-5 bottom row, 6-9 verticals.
    expect(Array.from(createGrid(3, 1).cellEdges.slice(8, 12))).toEqual([2, 9, 5, 8]);
  });

  test("lists each dot's edges as up, right, down, left", () => {
    const g = createGrid(2, 2);
    const at = (d: number) => Array.from(g.dotEdges.slice(d * 4, d * 4 + 4));
    expect(at(0)).toEqual([NONE, 0, 6, NONE]);
    expect(at(1)).toEqual([NONE, 1, 7, 0]);
    expect(at(4)).toEqual([7, 3, 10, 2]);
    expect(at(8)).toEqual([11, NONE, NONE, 5]);
  });

  test("lists each edge's dots and cells", () => {
    const g = createGrid(2, 2);
    const dots = (e: number) => [g.edgeDots[e * 2], g.edgeDots[e * 2 + 1]];
    const cells = (e: number) => [g.edgeCells[e * 2], g.edgeCells[e * 2 + 1]];
    expect(dots(0)).toEqual([0, 1]);
    expect(dots(5)).toEqual([7, 8]);
    expect(dots(6)).toEqual([0, 3]);
    expect(dots(11)).toEqual([5, 8]);
    expect(cells(0)).toEqual([NONE, 0]);
    expect(cells(2)).toEqual([0, 2]);
    expect(cells(4)).toEqual([2, NONE]);
    expect(cells(6)).toEqual([NONE, 0]);
    expect(cells(7)).toEqual([0, 1]);
    expect(cells(8)).toEqual([1, NONE]);
  });

  test("rejects sizes outside 1-100 and non-integers", () => {
    for (const [w, h] of [
      [0, 5],
      [5, 0],
      [101, 5],
      [5, 101],
      [1.5, 2],
      [Number.NaN, 2],
    ]) {
      expect(() => createGrid(w as number, h as number)).toThrow(RangeError);
    }
  });

  test("tables agree with each other on any grid", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }), (w, h) => {
        const g = createGrid(w, h);
        // Every cell's edges have that cell beside them.
        for (let i = 0; i < g.cellCount; i++) {
          for (let j = 0; j < 4; j++) {
            const e = g.cellEdges[i * 4 + j];
            expect([g.edgeCells[e * 2], g.edgeCells[e * 2 + 1]]).toContain(i);
          }
        }
        // Every edge appears in the dotEdges of exactly its two dots, and in the cellEdges of
        // exactly its non-NONE cells.
        const dotHits = new Array<number>(g.edgeCount).fill(0);
        for (let d = 0; d < g.dotCount; d++) {
          for (let j = 0; j < 4; j++) {
            const e = g.dotEdges[d * 4 + j];
            if (e === NONE) continue;
            dotHits[e]++;
            expect([g.edgeDots[e * 2], g.edgeDots[e * 2 + 1]]).toContain(d);
          }
        }
        expect(dotHits.every((n) => n === 2)).toBe(true);
        const cellHits = new Array<number>(g.edgeCount).fill(0);
        for (const e of g.cellEdges) cellHits[e]++;
        for (let e = 0; e < g.edgeCount; e++) {
          const sides =
            (g.edgeCells[e * 2] === NONE ? 0 : 1) + (g.edgeCells[e * 2 + 1] === NONE ? 0 : 1);
          expect(cellHits[e]).toBe(sides);
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe("index helpers", () => {
  test("match the documented formulas", () => {
    const g = createGrid(3, 2);
    expect(cellIndex(g, 1, 2)).toBe(5);
    expect(dotIndex(g, 2, 3)).toBe(11);
    expect(hEdgeIndex(g, 2, 1)).toBe(7);
    expect(vEdgeIndex(g, 1, 3)).toBe(9 + 7);
  });

  test("edgeCoords inverts hEdgeIndex and vEdgeIndex", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }), (w, h) => {
        const g = createGrid(w, h);
        for (let e = 0; e < g.edgeCount; e++) {
          const { horizontal, row, col } = edgeCoords(g, e);
          expect(horizontal ? hEdgeIndex(g, row, col) : vEdgeIndex(g, row, col)).toBe(e);
          expect(horizontal).toBe(e < g.hEdgeCount);
        }
      }),
      { numRuns: 30 },
    );
  });
});
