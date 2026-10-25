import { describe, expect, test } from "bun:test";
import { createGrid, dotIndex } from "@loophole/core";
import fc from "fast-check";
import { dotPoint } from "./geometry.ts";
import {
  anchorView,
  clampView,
  MINI_BOX,
  miniJump,
  miniLayout,
  miniRect,
  OVERSCROLL_END,
  OVERSCROLL_START,
  panBy,
  pinchView,
  revealRect,
  type View,
  viewLayout,
  viewMargin,
  visibleCells,
  wheelView,
  ZOOM_MAX_CELL,
  zoomAround,
  zoomLimits,
} from "./viewport.ts";

const grid = createGrid(20, 20);
// A phone stage, 354 wide as on the Night artboard.
const port = { width: 354, height: 400 };
const limits = zoomLimits(grid, port);

/** Viewport position of dot (row, col). */
function onScreen(view: View, row: number, col: number) {
  const p = dotPoint(grid, viewLayout(grid, view.cell), dotIndex(grid, row, col));
  return { x: p.x - view.x, y: p.y - view.y };
}

describe("zoomLimits", () => {
  test("the smallest zoom shows the whole board", () => {
    const l = viewLayout(grid, limits.min);
    expect(l.width).toBeLessThanOrEqual(port.width + 1e-9);
    expect(l.height).toBeLessThanOrEqual(port.height + 1e-9);
    expect(Math.max(l.width / port.width, l.height / port.height)).toBeCloseTo(1, 9);
    expect(limits.max).toBe(ZOOM_MAX_CELL);
  });

  test("the whole board fits at the smallest zoom for any size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 200, max: 2000 }),
        fc.integer({ min: 200, max: 2000 }),
        (w, h, pw, ph) => {
          const g = createGrid(w, h);
          const z = zoomLimits(g, { width: pw, height: ph });
          const l = viewLayout(g, z.min);
          if (z.min > 1) {
            expect(l.width).toBeLessThanOrEqual(pw + 1e-6);
            expect(l.height).toBeLessThanOrEqual(ph + 1e-6);
          }
          expect(z.max).toBeGreaterThanOrEqual(z.min);
        },
      ),
    );
  });
});

describe("viewMargin", () => {
  test("is at least 10px and a third of a cell", () => {
    expect(viewMargin(5)).toBe(10);
    expect(viewMargin(44)).toBeCloseTo(14.96, 9);
  });
});

describe("clampView", () => {
  test("keeps the cell size within the limits", () => {
    expect(clampView(grid, { cell: 500, x: 0, y: 0 }, port, limits).cell).toBe(ZOOM_MAX_CELL);
    expect(clampView(grid, { cell: 1, x: 0, y: 0 }, port, limits).cell).toBe(limits.min);
  });

  test("keeps the board over the viewport, give or take the overscroll", () => {
    const l = viewLayout(grid, 44);
    expect(clampView(grid, { cell: 44, x: -50, y: 30 }, port, limits)).toEqual({
      cell: 44,
      x: -50,
      y: 30,
    });
    expect(clampView(grid, { cell: 44, x: -9999, y: -9999 }, port, limits)).toEqual({
      cell: 44,
      x: -OVERSCROLL_START,
      y: -OVERSCROLL_START,
    });
    expect(clampView(grid, { cell: 44, x: 9999, y: 9999 }, port, limits)).toEqual({
      cell: 44,
      x: l.width - port.width + OVERSCROLL_END,
      y: l.height - port.height + OVERSCROLL_END,
    });
  });

  test("the overscroll pulls the corners clear of the overview map and zoom controls", () => {
    // Top left: the map covers 8…99px; bottom right: the controls reach 63px up from the bottom.
    expect(OVERSCROLL_START).toBeGreaterThanOrEqual(8 + MINI_BOX + 3);
    expect(OVERSCROLL_END).toBeGreaterThanOrEqual(8 + 44 + 2 * 4 + 3);
  });

  test("centres a board that fits the viewport", () => {
    const small = { min: 5, max: ZOOM_MAX_CELL };
    const v = clampView(grid, { cell: 5, x: 123, y: 456 }, port, small);
    const l = viewLayout(grid, 5);
    expect(v.x).toBeCloseTo((l.width - port.width) / 2, 9);
    expect(v.y).toBeCloseTo((l.height - port.height) / 2, 9);
  });

  test("the whole board is on screen at the smallest zoom, from any view", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (w, h, x, y) => {
          const g = createGrid(w, h);
          const z = zoomLimits(g, port);
          const v = clampView(g, { cell: z.min, x, y }, port, z);
          const l = viewLayout(g, v.cell);
          if (z.min === 1) return; // the board can't fit at all
          expect(Math.min(-v.x, port.width - (l.width - v.x))).toBeGreaterThanOrEqual(-1e-6);
          expect(Math.min(-v.y, port.height - (l.height - v.y))).toBeGreaterThanOrEqual(-1e-6);
        },
      ),
    );
  });

  test("the overscroll shrinks with the overflow", () => {
    // 20 cells of 18px plus margins overflow the 354px viewport by 26px: the board may be pulled
    // only 26px past either corner, not the full overscroll.
    const l = viewLayout(grid, 18);
    const over = l.width - port.width;
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(OVERSCROLL_END);
    expect(clampView(grid, { cell: 18, x: -999, y: 0 }, port, limits).x).toBeCloseTo(-over, 9);
    expect(clampView(grid, { cell: 18, x: 999, y: 0 }, port, limits).x).toBeCloseTo(2 * over, 9);
  });

  test("zooming out step by step ends with the whole board on screen", () => {
    let v = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    while (v.cell > limits.min) {
      v = zoomAround(
        grid,
        v,
        v.cell / 1.25,
        { x: port.width / 2, y: port.height / 2 },
        port,
        limits,
      );
      // The corner is never pulled further than the board overflows the viewport (or, once it
      // fits, than centring it takes).
      const l = viewLayout(grid, v.cell);
      const most = (over: number) => (over > 0 ? over : -over / 2) + 1e-6;
      expect(-v.x).toBeLessThanOrEqual(most(l.width - port.width));
      expect(-v.y).toBeLessThanOrEqual(most(l.height - port.height));
    }
    const l = viewLayout(grid, v.cell);
    expect(v.x).toBeLessThanOrEqual(1e-6);
    expect(v.x + port.width).toBeGreaterThanOrEqual(l.width - 1e-6);
  });
});

describe("anchorView", () => {
  test("zoomAround keeps the point under the focus fixed", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 80 }, port, limits);
    const before = onScreen(start, 5, 5);
    const after = zoomAround(grid, start, 60, before, port, limits);
    expect(after.cell).toBe(60);
    const moved = onScreen(after, 5, 5);
    expect(moved.x).toBeCloseTo(before.x, 9);
    expect(moved.y).toBeCloseTo(before.y, 9);
  });

  test("panBy moves the board with the finger", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 80 }, port, limits);
    expect(panBy(grid, start, -30, 20, port, limits)).toEqual({ cell: 44, x: 130, y: 60 });
  });

  test("never leaves the view out of bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (cell, fx, tx) => {
          const start = clampView(grid, { cell: 44, x: 50, y: 50 }, port, limits);
          const v = anchorView(grid, start, cell, { x: fx, y: 0 }, { x: tx, y: 0 }, port, limits);
          expect(clampView(grid, v, port, limits)).toEqual(v);
        },
      ),
    );
  });
});

describe("pinchView", () => {
  test("spreading two fingers zooms around their midpoint", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);
    const mid = { x: 150, y: 200 };
    const v = pinchView(
      grid,
      start,
      { x: 130, y: 200 },
      { x: 170, y: 200 },
      { x: 120, y: 200 },
      { x: 180, y: 200 },
      port,
      limits,
    );
    expect(v.cell).toBeCloseTo(66, 9);
    // The board point under the midpoint stays under it.
    const u = (mid.x + start.x - viewMargin(44)) / 44;
    expect(viewMargin(66) + u * 66 - v.x).toBeCloseTo(mid.x, 9);
  });

  test("moving two fingers together pans", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);
    const v = pinchView(
      grid,
      start,
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 80, y: 90 },
      { x: 180, y: 90 },
      port,
      limits,
    );
    expect(v).toEqual({ cell: 44, x: 120, y: 110 });
  });
});

describe("revealRect", () => {
  test("pans just enough to show the rectangle", () => {
    const start = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    const v = revealRect(grid, start, { x: 380, y: 10, width: 60, height: 20 }, port, limits);
    expect(v).toEqual({ cell: 44, x: 440 - port.width, y: 0 });
    // Back to the left: in view, but under the overview map, so it moves out to the right.
    expect(revealRect(grid, v, { x: 100, y: 10, width: 60, height: 20 }, port, limits).x).toBe(
      100 - OVERSCROLL_START,
    );
  });

  test("moves the rectangle out from under the overview map by the shorter way", () => {
    const start = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    // 44px down clears it, 84px right would too: down it goes.
    expect(revealRect(grid, start, { x: 20, y: 60, width: 40, height: 20 }, port, limits)).toEqual({
      cell: 44,
      x: 0,
      y: 60 - OVERSCROLL_START,
    });
    expect(revealRect(grid, start, { x: 60, y: 20, width: 20, height: 40 }, port, limits)).toEqual({
      cell: 44,
      x: 60 - OVERSCROLL_START,
      y: 0,
    });
  });

  test("moves the rectangle up from under the zoom controls", () => {
    const start = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    const v = revealRect(grid, start, { x: 300, y: 350, width: 40, height: 40 }, port, limits);
    expect(v).toEqual({ cell: 44, x: 0, y: 390 - (port.height - OVERSCROLL_END) });
  });

  test("leaves the view alone when the rectangle is on screen", () => {
    const start = clampView(grid, { cell: 44, x: 40, y: 40 }, port, limits);
    // On screen and clear of both overlays.
    expect(
      revealRect(grid, start, { x: 150, y: 150, width: 40, height: 40 }, port, limits),
    ).toEqual(start);
  });
});

describe("visibleCells", () => {
  test("covers the viewport plus one cell on each side, clamped to the board", () => {
    const g = createGrid(100, 100);
    const l = viewLayout(g, 44);
    // Margin 14.96: cells 4–12 touch x = 200…554 and rows 0–8 touch y = 0…400; one more each side.
    expect(visibleCells(g, l, { cell: 44, x: 200, y: 0 }, port)).toEqual({
      r0: 0,
      r1: 9,
      c0: 3,
      c1: 13,
    });
    expect(visibleCells(g, l, { cell: 44, x: 0, y: 0 }, { width: 99999, height: 99999 })).toEqual({
      r0: 0,
      r1: 99,
      c0: 0,
      c1: 99,
    });
  });

  test("every cell overlapping the viewport is in the range", () => {
    const g = createGrid(100, 100);
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 88, noNaN: true }),
        fc.double({ min: 0, max: 8000, noNaN: true }),
        fc.double({ min: 0, max: 8000, noNaN: true }),
        (cell, x, y) => {
          const l = viewLayout(g, cell);
          const r = visibleCells(g, l, { cell, x, y }, port);
          for (let c = 0; c < g.width; c++) {
            const left = l.margin + c * cell - x;
            const overlaps = left < port.width && left + cell > 0;
            if (overlaps) expect(c >= r.c0 && c <= r.c1).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("overview map", () => {
  test("fits the board in 88px", () => {
    const mini = miniLayout(createGrid(100, 100));
    expect(mini.width).toBeCloseTo(88, 9);
    expect(mini.cell).toBeCloseTo(0.8, 9);
  });

  test("shows the viewport as a rectangle and jumps to a tapped point", () => {
    const mini = miniLayout(grid);
    const view = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    const rect = miniRect(view, port, mini);
    // Map pixels per board pixel.
    const s = mini.cell / 44;
    expect(rect.x).toBeCloseTo(mini.margin - viewMargin(44) * s, 9);
    expect(rect.y).toBeCloseTo(rect.x, 9);
    expect(rect.width).toBeCloseTo(port.width * s, 9);
    expect(rect.height).toBeCloseTo(port.height * s, 9);
    // Tapping the centre of the map centres the board.
    const v = miniJump(grid, view, mini.width / 2, mini.height / 2, mini, port, limits);
    const l = viewLayout(grid, 44);
    expect(v.x).toBeCloseTo((l.width - port.width) / 2, 9);
    expect(v.y).toBeCloseTo((l.height - port.height) / 2, 9);
  });
});

describe("wheelView", () => {
  const view = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);
  const wheel = {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
  const at = { x: 100, y: 120 };

  test("the wheel pans, by lines in line mode, sideways with Shift", () => {
    expect(wheelView(grid, view, { ...wheel, deltaY: 30 }, at, port, limits)).toEqual(
      panBy(grid, view, 0, -30, port, limits),
    );
    expect(wheelView(grid, view, { ...wheel, deltaY: 2, deltaMode: 1 }, at, port, limits)).toEqual(
      panBy(grid, view, 0, -32, port, limits),
    );
    expect(
      wheelView(grid, view, { ...wheel, deltaY: 30, shiftKey: true }, at, port, limits),
    ).toEqual(panBy(grid, view, -30, 0, port, limits));
  });

  test("Ctrl or ⌘ + wheel zooms around the pointer, one notch about 1.28×", () => {
    for (const key of ["ctrlKey", "metaKey"] as const) {
      const out = wheelView(grid, view, { ...wheel, deltaY: -100, [key]: true }, at, port, limits);
      expect(out.cell / view.cell).toBeCloseTo(Math.exp(0.25), 5);
      expect(out).toEqual(zoomAround(grid, view, out.cell, at, port, limits));
    }
  });
});
