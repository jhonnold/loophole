import { cellCoords, cellIndex, type Grid, NO_CLUE } from "@loophole/core";
import type { Direction } from "../game/keyboard.ts";

/** What a key does to the cell under the editor's keyboard cursor. */
export type CellCommand =
  | { readonly type: "move"; readonly direction: Direction }
  | { readonly type: "set"; readonly clue: number }
  | { readonly type: "erase" }
  | { readonly type: "cycle" };

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Keys for the editor board (Editor artboard): arrows move, 0–3 place, Backspace erases. */
export function cellCommand(key: string): CellCommand | null {
  const direction = ARROWS[key];
  if (direction !== undefined) return { type: "move", direction };
  if (key === "0" || key === "1" || key === "2" || key === "3") {
    return { type: "set", clue: Number(key) };
  }
  if (key === "Backspace" || key === "Delete" || key === ".") return { type: "erase" };
  if (key === " " || key === "Enter") return { type: "cycle" };
  return null;
}

/** Moves the cell cursor one cell; it stops at the board's sides. */
export function moveCell(grid: Grid, cell: number, direction: Direction): number {
  const { row, col } = cellCoords(grid, cell);
  switch (direction) {
    case "up":
      return row > 0 ? cellIndex(grid, row - 1, col) : cell;
    case "down":
      return row < grid.height - 1 ? cellIndex(grid, row + 1, col) : cell;
    case "left":
      return col > 0 ? cellIndex(grid, row, col - 1) : cell;
    case "right":
      return col < grid.width - 1 ? cellIndex(grid, row, col + 1) : cell;
  }
}

/** What a screen reader hears for the cursor's cell, e.g. "Row 2, column 3: clue 1". */
export function cellLabel(grid: Grid, cell: number, clue: number): string {
  const { row, col } = cellCoords(grid, cell);
  return `Row ${row + 1}, column ${col + 1}: ${clue === NO_CLUE ? "empty" : `clue ${clue}`}`;
}

/** A change to one cell: what a key (or the parent, for a tap) asks for. */
export type CellEdit = Exclude<CellCommand, { readonly type: "move" }>;
