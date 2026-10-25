import { type EdgeState, edgeCoords, type Grid, hEdgeIndex, vEdgeIndex } from "@loophole/core";

export type Direction = "up" | "down" | "left" | "right";

export type Command =
  | { readonly type: "move"; readonly direction: Direction }
  | {
      readonly type: "cycle" | "cross" | "erase" | "undo" | "redo" | "pause" | "hint" | "close";
    };

/**
 * Moves the keyboard edge cursor. Think of the edges as rows that alternate between horizontal and
 * vertical: left and right move along the current row; up and down step to the next row, keeping to
 * the left side of the column. From the top edge of a cell, down goes to the cell's left side, then
 * to its bottom edge. The cursor stops at the board's sides.
 */
export function moveCursor(grid: Grid, edge: number, direction: Direction): number {
  const W = grid.width;
  const H = grid.height;
  const { horizontal, row, col } = edgeCoords(grid, edge);
  if (horizontal) {
    switch (direction) {
      case "left":
        return col > 0 ? hEdgeIndex(grid, row, col - 1) : edge;
      case "right":
        return col < W - 1 ? hEdgeIndex(grid, row, col + 1) : edge;
      case "up":
        return row > 0 ? vEdgeIndex(grid, row - 1, col) : edge;
      case "down":
        return row < H ? vEdgeIndex(grid, row, col) : edge;
    }
  }
  switch (direction) {
    case "left":
      return col > 0 ? vEdgeIndex(grid, row, col - 1) : edge;
    case "right":
      return col < W ? vEdgeIndex(grid, row, col + 1) : edge;
    case "up":
      return hEdgeIndex(grid, row, Math.min(col, W - 1));
    case "down":
      return hEdgeIndex(grid, row + 1, Math.min(col, W - 1));
  }
}

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Keys that act on the edge under the cursor, while the board has focus (Desktop artboard). */
export function boardCommand(key: string): Command | null {
  const direction = ARROWS[key];
  if (direction !== undefined) return { type: "move", direction };
  if (key === " " || key === "Enter") return { type: "cycle" };
  if (key === "x" || key === "X") return { type: "cross" };
  if (key === "Backspace" || key === "Delete") return { type: "erase" };
  return null;
}

export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Shortcuts that work anywhere on the play screen: Z undo, Y redo, P pause, H hint, Escape to close
 * the hint card, plus Ctrl/⌘ forms of undo and redo.
 */
export function screenCommand(e: KeyInput): Command | null {
  if (e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === "z") return { type: e.shiftKey ? "redo" : "undo" };
    if (key === "y") return { type: "redo" };
    return null;
  }
  if (key === "z") return { type: "undo" };
  if (key === "y") return { type: "redo" };
  if (key === "p") return { type: "pause" };
  if (key === "h") return { type: "hint" };
  if (key === "escape") return { type: "close" };
  return null;
}

const STATE_WORDS = ["empty", "line", "cross"] as const;

/** Spoken and shown name of an edge, e.g. "Row 8 · between columns 4 and 5 · empty". 1-based. */
export function edgeLabel(grid: Grid, edge: number, state: EdgeState): string {
  const { horizontal, row, col } = edgeCoords(grid, edge);
  const where = horizontal
    ? `Row ${row + 1} · between columns ${col + 1} and ${col + 2}`
    : `Column ${col + 1} · between rows ${row + 1} and ${row + 2}`;
  return `${where} · ${STATE_WORDS[state]}`;
}
