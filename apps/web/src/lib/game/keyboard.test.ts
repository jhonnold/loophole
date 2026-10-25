import { describe, expect, test } from "bun:test";
import { createGrid, EdgeState, hEdgeIndex, vEdgeIndex } from "@loophole/core";
import fc from "fast-check";
import {
  boardCommand,
  type Direction,
  edgeLabel,
  type KeyInput,
  moveCursor,
  screenCommand,
} from "./keyboard.ts";

const grid = createGrid(3, 2);
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

describe("moveCursor", () => {
  test("left and right move along the row", () => {
    expect(moveCursor(grid, hEdgeIndex(grid, 1, 0), "right")).toBe(hEdgeIndex(grid, 1, 1));
    expect(moveCursor(grid, vEdgeIndex(grid, 0, 3), "left")).toBe(vEdgeIndex(grid, 0, 2));
  });

  test("down alternates between horizontal and vertical edges in one column", () => {
    let e = hEdgeIndex(grid, 0, 1);
    const seen = [e];
    for (let i = 0; i < 4; i++) {
      e = moveCursor(grid, e, "down");
      seen.push(e);
    }
    expect(seen).toEqual([
      hEdgeIndex(grid, 0, 1),
      vEdgeIndex(grid, 0, 1),
      hEdgeIndex(grid, 1, 1),
      vEdgeIndex(grid, 1, 1),
      hEdgeIndex(grid, 2, 1),
    ]);
  });

  test("the rightmost vertical edge steps to the last horizontal edge", () => {
    expect(moveCursor(grid, vEdgeIndex(grid, 0, 3), "down")).toBe(hEdgeIndex(grid, 1, 2));
    expect(moveCursor(grid, vEdgeIndex(grid, 0, 3), "up")).toBe(hEdgeIndex(grid, 0, 2));
  });

  test("stops at the sides", () => {
    expect(moveCursor(grid, hEdgeIndex(grid, 0, 0), "up")).toBe(hEdgeIndex(grid, 0, 0));
    expect(moveCursor(grid, hEdgeIndex(grid, 0, 0), "left")).toBe(hEdgeIndex(grid, 0, 0));
    expect(moveCursor(grid, hEdgeIndex(grid, 2, 2), "down")).toBe(hEdgeIndex(grid, 2, 2));
    expect(moveCursor(grid, vEdgeIndex(grid, 1, 3), "right")).toBe(vEdgeIndex(grid, 1, 3));
  });

  test("reaches every edge from the first one", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }), (w, h) => {
        const g = createGrid(w, h);
        const seen = new Set([0]);
        const queue = [0];
        while (queue.length > 0) {
          const e = queue.pop() as number;
          for (const d of DIRECTIONS) {
            const next = moveCursor(g, e, d);
            expect(next >= 0 && next < g.edgeCount).toBe(true);
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
        expect(seen.size).toBe(g.edgeCount);
      }),
      { numRuns: 30 },
    );
  });
});

describe("boardCommand", () => {
  test("maps the Desktop artboard keys", () => {
    expect(boardCommand("ArrowLeft")).toEqual({ type: "move", direction: "left" });
    expect(boardCommand(" ")).toEqual({ type: "cycle" });
    expect(boardCommand("Enter")).toEqual({ type: "cycle" });
    expect(boardCommand("x")).toEqual({ type: "cross" });
    expect(boardCommand("Backspace")).toEqual({ type: "erase" });
    expect(boardCommand("q")).toBeNull();
  });
});

describe("screenCommand", () => {
  const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  test("maps Z, Y and P with and without modifiers", () => {
    expect(screenCommand(key("z"))).toEqual({ type: "undo" });
    expect(screenCommand(key("Y"))).toEqual({ type: "redo" });
    expect(screenCommand(key("p"))).toEqual({ type: "pause" });
    expect(screenCommand(key("z", { ctrlKey: true }))).toEqual({ type: "undo" });
    expect(screenCommand(key("z", { metaKey: true, shiftKey: true }))).toEqual({ type: "redo" });
    expect(screenCommand(key("y", { ctrlKey: true }))).toEqual({ type: "redo" });
  });

  test("maps H to a hint and Escape to closing it", () => {
    expect(screenCommand(key("h"))).toEqual({ type: "hint" });
    expect(screenCommand(key("H", { shiftKey: true }))).toEqual({ type: "hint" });
    expect(screenCommand(key("Escape"))).toEqual({ type: "close" });
    expect(screenCommand(key("h", { ctrlKey: true }))).toBeNull();
  });

  test("ignores other keys and Alt combinations", () => {
    expect(screenCommand(key("p", { ctrlKey: true }))).toBeNull();
    expect(screenCommand(key("z", { altKey: true }))).toBeNull();
    expect(screenCommand(key("a"))).toBeNull();
  });
});

describe("edgeLabel", () => {
  test("names edges by 1-based dot rows and columns", () => {
    const g = createGrid(10, 10);
    expect(edgeLabel(g, hEdgeIndex(g, 7, 3), EdgeState.Unknown)).toBe(
      "Row 8 · between columns 4 and 5 · empty",
    );
    expect(edgeLabel(g, vEdgeIndex(g, 1, 3), EdgeState.Cross)).toBe(
      "Column 4 · between rows 2 and 3 · cross",
    );
  });
});
