import { cellIndex, EdgeState, type Grid, vEdgeIndex } from "@loophole/core";

/**
 * Marks the cells inside the loop (1) and outside (0), for the solved wash. Scans each row from
 * the left and flips at every vertical line, so it assumes the lines form closed loops.
 */
export function insideCells(grid: Grid, edges: Uint8Array): Uint8Array {
  const out = new Uint8Array(grid.cellCount);
  for (let r = 0; r < grid.height; r++) {
    let inside = 0;
    for (let c = 0; c < grid.width; c++) {
      if (edges[vEdgeIndex(grid, r, c)] === EdgeState.Line) inside ^= 1;
      out[cellIndex(grid, r, c)] = inside;
    }
  }
  return out;
}
