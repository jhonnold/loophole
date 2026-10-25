import { describe, expect, test } from "bun:test";
import { createGrid, hEdgeIndex, NONE, vEdgeIndex } from "@loophole/core";
import fc from "fast-check";
import {
  dotAt,
  dotPath,
  edgeAt,
  edgeMidpoint,
  edgeSegment,
  fitLayout,
  type Layout,
  markSizes,
  minBoardHeight,
} from "./geometry.ts";

describe("fitLayout", () => {
  test("matches the design kit artboards", () => {
    // Small (360 wide): 7×7 at 44px cells with a 10px border, 328px across.
    expect(fitLayout(7, 7, 328, 400, 44, 46)).toEqual({
      cell: 44,
      margin: 10,
      width: 328,
      height: 328,
    });
    // Play (390 wide): 7×7 at 46px with a 16px border, 354px across.
    expect(fitLayout(7, 7, 354, 500, 44, 46)).toEqual({
      cell: 46,
      margin: 16,
      width: 354,
      height: 354,
    });
    // Desktop: 10×10 at 58px with a 20px border, 620px across.
    expect(fitLayout(10, 10, 620, 900, 24, 58).width).toBe(620);
  });

  test("never exceeds the available width, even below the minimum cell", () => {
    const l = fitLayout(10, 10, 328, 1000, 44, 58);
    expect(l.width).toBeLessThanOrEqual(328);
    expect(l.cell).toBe(30);
  });

  test("keeps the minimum cell when only the height is short", () => {
    const l = fitLayout(7, 7, 328, 200, 44, 58);
    expect(l.cell).toBe(44);
    expect(l.height).toBe(minBoardHeight(7, 7, 328, 44));
  });

  test("fits inside the box for any size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 200, max: 2000 }),
        fc.integer({ min: 200, max: 2000 }),
        (cols, rows, w, h) => {
          const l = fitLayout(cols, rows, w, h, 44, 58);
          expect(l.width).toBeLessThanOrEqual(w);
          expect(l.cell).toBeLessThanOrEqual(58);
          expect(l.margin).toBeGreaterThanOrEqual(10);
          if (l.height > h) expect(l.height).toBe(minBoardHeight(cols, rows, w, 44));
        },
      ),
    );
  });
});

const grid = createGrid(3, 2);
const layout: Layout = { cell: 40, margin: 10, width: 140, height: 100 };

describe("edgeSegment", () => {
  test("joins the edge's two dots", () => {
    expect(edgeSegment(grid, layout, hEdgeIndex(grid, 1, 2))).toEqual({
      x1: 90,
      y1: 50,
      x2: 130,
      y2: 50,
    });
    expect(edgeSegment(grid, layout, vEdgeIndex(grid, 0, 3))).toEqual({
      x1: 130,
      y1: 10,
      x2: 130,
      y2: 50,
    });
  });
});

describe("edgeAt", () => {
  test("picks the edge at its own midpoint", () => {
    for (let e = 0; e < grid.edgeCount; e++) {
      const m = edgeMidpoint(grid, layout, e);
      expect(edgeAt(grid, layout, m.x, m.y)).toBe(e);
    }
  });

  test("splits a cell along its diagonals", () => {
    // Cell (0, 0) spans x 10–50, y 10–50.
    expect(edgeAt(grid, layout, 30, 15)).toBe(hEdgeIndex(grid, 0, 0));
    expect(edgeAt(grid, layout, 30, 45)).toBe(hEdgeIndex(grid, 1, 0));
    expect(edgeAt(grid, layout, 15, 30)).toBe(vEdgeIndex(grid, 0, 0));
    expect(edgeAt(grid, layout, 45, 30)).toBe(vEdgeIndex(grid, 0, 1));
  });

  test("maps the margin to outer edges and ignores points far outside", () => {
    expect(edgeAt(grid, layout, 30, 2)).toBe(hEdgeIndex(grid, 0, 0));
    expect(edgeAt(grid, layout, 138, 70)).toBe(vEdgeIndex(grid, 1, 3));
    expect(edgeAt(grid, layout, -20, 30)).toBe(NONE);
  });

  test("always returns an edge with the nearest midpoint (diamonds tile the board)", () => {
    const g = createGrid(5, 4);
    const l: Layout = { cell: 44, margin: 14, width: 248, height: 204 };
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 248, noNaN: true }),
        fc.double({ min: 0, max: 204, noNaN: true }),
        (x, y) => {
          const e = edgeAt(g, l, x, y);
          expect(e).not.toBe(NONE);
          const dist = (k: number) => {
            const m = edgeMidpoint(g, l, k);
            return Math.abs(m.x - x) + Math.abs(m.y - y);
          };
          let best = Number.POSITIVE_INFINITY;
          for (let k = 0; k < g.edgeCount; k++) best = Math.min(best, dist(k));
          expect(dist(e)).toBeCloseTo(best, 6);
        },
      ),
    );
  });
});

describe("dotAt", () => {
  test("rounds to the nearest dot and clamps to the board", () => {
    expect(dotAt(grid, layout, 12, 8)).toBe(0);
    expect(dotAt(grid, layout, 72, 48)).toBe(1 * 4 + 2);
    expect(dotAt(grid, layout, 500, 500)).toBe(grid.dotCount - 1);
  });
});

describe("dotPath", () => {
  test("gives the shared edge of adjacent dots and nothing for the same dot", () => {
    expect(dotPath(grid, 0, 1)).toEqual([hEdgeIndex(grid, 0, 0)]);
    expect(dotPath(grid, 1, 0)).toEqual([hEdgeIndex(grid, 0, 0)]);
    expect(dotPath(grid, 0, 4)).toEqual([vEdgeIndex(grid, 0, 0)]);
    expect(dotPath(grid, 5, 5)).toEqual([]);
  });

  test("walks along the row, then the column", () => {
    // Dot (0, 0) to dot (2, 2): two horizontal edges on row 0, then two vertical on column 2.
    expect(dotPath(grid, 0, 2 * 4 + 2)).toEqual([
      hEdgeIndex(grid, 0, 0),
      hEdgeIndex(grid, 0, 1),
      vEdgeIndex(grid, 0, 2),
      vEdgeIndex(grid, 1, 2),
    ]);
  });

  test("each edge joins consecutive dots of the path", () => {
    const g = createGrid(6, 5);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: g.dotCount - 1 }),
        fc.integer({ min: 0, max: g.dotCount - 1 }),
        (a, b) => {
          const path = dotPath(g, a, b);
          let at = a;
          for (const e of path) {
            const [d0, d1] = [g.edgeDots[e * 2], g.edgeDots[e * 2 + 1]];
            expect([d0, d1]).toContain(at);
            at = d0 === at ? d1 : d0;
          }
          expect(at).toBe(b);
        },
      ),
    );
  });
});

describe("markSizes", () => {
  test("follow the design kit at 46px cells", () => {
    const s = markSizes(46);
    expect(s.line).toBe(5);
    expect(s.dotRadius).toBe(2.5);
    expect(s.clue).toBeCloseTo(25.76, 9);
  });

  test("dots and lines stay within 0.4 of a tiny cell", () => {
    const s = markSizes(4);
    expect(s.line).toBeCloseTo(1.6, 9);
    expect(s.dotRadius).toBeCloseTo(0.8, 9);
  });
});
