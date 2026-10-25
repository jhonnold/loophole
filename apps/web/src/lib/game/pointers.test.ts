import { describe, expect, test } from "bun:test";
import { createGrid } from "@loophole/core";
import { BoardPointers } from "./pointers.ts";
import { clampView, zoomLimits } from "./viewport.ts";

const grid = createGrid(20, 20);
const port = { width: 354, height: 400 };
const limits = zoomLimits(grid, port);
const view = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);

describe("BoardPointers", () => {
  test("one pointer draws", () => {
    const p = new BoardPointers();
    expect(p.down(1, { x: 10, y: 10 }, view, true)).toBe("draw");
    expect(p.drawing).toBe(true);
    expect(p.move(1, { x: 20, y: 10 }, grid, port, limits)).toBeNull();
    expect(p.up(1)).toBe(true);
    expect(p.drawing).toBe(false);
  });

  test("a second finger turns the gesture into a pinch until every finger is up", () => {
    const p = new BoardPointers();
    p.down(1, { x: 100, y: 100 }, view, true);
    expect(p.down(2, { x: 200, y: 100 }, view, true)).toBe("zoom");
    expect(p.drawing).toBe(false);
    // Both fingers move left by 20: the board pans with them.
    p.move(1, { x: 80, y: 100 }, grid, port, limits);
    expect(p.move(2, { x: 180, y: 100 }, grid, port, limits)).toEqual({ ...view, x: 120 });
    expect(p.up(1)).toBe(false);
    // The finger left behind neither draws nor zooms.
    expect(p.move(2, { x: 100, y: 100 }, grid, port, limits)).toBeNull();
    expect(p.down(3, { x: 50, y: 50 }, view, true)).toBeNull();
    expect(p.up(2)).toBe(false);
    expect(p.down(4, { x: 50, y: 50 }, view, true)).toBe("draw");
  });

  test("a second pointer is ignored when the board cannot zoom", () => {
    const p = new BoardPointers();
    p.down(1, { x: 100, y: 100 }, view, false);
    expect(p.down(2, { x: 200, y: 100 }, view, false)).toBeNull();
    expect(p.has(2)).toBe(false);
    expect(p.drawing).toBe(true);
    expect(p.up(2)).toBe(false);
    expect(p.up(1)).toBe(true);
  });

  test("a third finger is ignored", () => {
    const p = new BoardPointers();
    p.down(1, { x: 100, y: 100 }, view, true);
    p.down(2, { x: 200, y: 100 }, view, true);
    expect(p.down(3, { x: 300, y: 100 }, view, true)).toBeNull();
    expect(p.move(3, { x: 0, y: 0 }, grid, port, limits)).toBeNull();
  });
});
