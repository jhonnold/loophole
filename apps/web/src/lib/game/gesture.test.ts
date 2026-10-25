import { describe, expect, test } from "bun:test";
import { createGrid, EdgeState, hEdgeIndex, NONE, vEdgeIndex } from "@loophole/core";
import { applyChanges, createBoard } from "./board.ts";
import type { Layout } from "./geometry.ts";
import { PointerGesture } from "./gesture.ts";

const grid = createGrid(4, 4);
// Dot (r, c) is at (10 + 40c, 10 + 40r).
const layout: Layout = { cell: 40, margin: 10, width: 180, height: 180 };
const at = (r: number, c: number) => [10 + 40 * c, 10 + 40 * r] as const;

describe("PointerGesture", () => {
  test("a press without movement taps the edge under it", () => {
    const g = new PointerGesture(grid, layout);
    g.down(30, 12);
    expect(g.move(33, 14, new Uint8Array(grid.edgeCount))).toBeNull();
    expect(g.up()).toBe(hEdgeIndex(grid, 0, 0));
  });

  test("a press outside the board taps nothing", () => {
    const g = new PointerGesture(grid, layout);
    g.down(-50, -50);
    expect(g.up()).toBe(NONE);
  });

  test("dragging along a row draws a run of lines as one stroke", () => {
    const g = new PointerGesture(grid, layout);
    const edges = new Uint8Array(grid.edgeCount);
    g.down(...at(1, 0));
    const first = g.move(...at(1, 1), edges);
    expect(first).toEqual({ changes: [[hEdgeIndex(grid, 1, 0), EdgeState.Line]], merge: false });
    const rest = g.move(...at(1, 3), edges);
    expect(rest).toEqual({
      changes: [
        [hEdgeIndex(grid, 1, 1), EdgeState.Line],
        [hEdgeIndex(grid, 1, 2), EdgeState.Line],
      ],
      merge: true,
    });
    expect(g.up()).toBe(NONE);
  });

  test("a fast diagonal swipe still marks connected edges", () => {
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 0));
    const step = g.move(...at(2, 2), new Uint8Array(grid.edgeCount));
    const marked = step?.changes.map(([e]) => e) ?? [];
    expect(marked.length).toBe(4);
  });

  test("a stroke that starts on a line erases lines and leaves crosses", () => {
    let board = createBoard(grid.edgeCount);
    board = applyChanges(board, [
      [vEdgeIndex(grid, 0, 2), EdgeState.Line],
      [vEdgeIndex(grid, 1, 2), EdgeState.Cross],
      [vEdgeIndex(grid, 2, 2), EdgeState.Line],
    ]);
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 2));
    const step = g.move(...at(3, 2), board.edges);
    expect(step?.changes).toEqual([
      [vEdgeIndex(grid, 0, 2), EdgeState.Unknown],
      [vEdgeIndex(grid, 2, 2), EdgeState.Unknown],
    ]);
  });

  test("a drawing stroke draws over crosses", () => {
    const board = applyChanges(createBoard(grid.edgeCount), [
      [hEdgeIndex(grid, 0, 1), EdgeState.Cross],
    ]);
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 0));
    const step = g.move(...at(0, 2), board.edges);
    expect(step?.changes).toEqual([
      [hEdgeIndex(grid, 0, 0), EdgeState.Line],
      [hEdgeIndex(grid, 0, 1), EdgeState.Line],
    ]);
  });

  test("moves after cancel do nothing", () => {
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 0));
    g.cancel();
    expect(g.move(...at(0, 3), new Uint8Array(grid.edgeCount))).toBeNull();
    expect(g.up()).toBe(NONE);
  });
});
