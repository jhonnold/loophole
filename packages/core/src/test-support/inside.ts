import { EdgeState, type Grid, vEdgeIndex } from "../grid.ts";

/**
 * 1 for each cell inside the loop `edges` draws, 0 outside: each row scanned from the left, flipping
 * at every vertical line. Assumes the lines are a closed loop, as a solution's are.
 */
export function insideCells(grid: Grid, edges: Uint8Array): Uint8Array {
  const out = new Uint8Array(grid.cellCount);
  for (let r = 0; r < grid.height; r++) {
    let inside = 0;
    for (let c = 0; c < grid.width; c++) {
      if (edges[vEdgeIndex(grid, r, c)] === EdgeState.Line) inside ^= 1;
      out[r * grid.width + c] = inside;
    }
  }
  return out;
}
