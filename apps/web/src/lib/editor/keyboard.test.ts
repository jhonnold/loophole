import { describe, expect, test } from "bun:test";
import { createGrid, NO_CLUE } from "@loophole/core";
import { cellCommand, cellLabel, moveCell } from "./keyboard.ts";

describe("editor keyboard", () => {
  test("arrows move, 0–3 place, Backspace, Delete and . erase, Space and Enter cycle", () => {
    expect(cellCommand("ArrowLeft")).toEqual({ type: "move", direction: "left" });
    expect(["0", "1", "2", "3"].map(cellCommand)).toEqual(
      [0, 1, 2, 3].map((clue) => ({ type: "set", clue })),
    );
    for (const key of ["Backspace", "Delete", "."])
      expect(cellCommand(key)).toEqual({ type: "erase" });
    for (const key of [" ", "Enter"]) expect(cellCommand(key)).toEqual({ type: "cycle" });
    for (const key of ["4", "x", "Tab"]) expect(cellCommand(key)).toBeNull();
  });

  test("the cursor moves one cell and stops at the sides", () => {
    const grid = createGrid(3, 2);
    expect(moveCell(grid, 0, "right")).toBe(1);
    expect(moveCell(grid, 0, "down")).toBe(3);
    expect(moveCell(grid, 0, "up")).toBe(0);
    expect(moveCell(grid, 0, "left")).toBe(0);
    expect(moveCell(grid, 5, "right")).toBe(5);
    expect(moveCell(grid, 5, "down")).toBe(5);
    expect(moveCell(grid, 5, "up")).toBe(2);
  });

  test("the label names the cell and its clue", () => {
    const grid = createGrid(3, 2);
    expect(cellLabel(grid, 4, 2)).toBe("Row 2, column 2: clue 2");
    expect(cellLabel(grid, 0, NO_CLUE)).toBe("Row 1, column 1: empty");
  });
});
