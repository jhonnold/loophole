import { EdgeState, type Grid, NONE } from "./grid.ts";
import type { Rng } from "./rng.ts";

/** How big a generated loop must be (PRD FR-8). Shares are fractions from 0 to 1. */
export interface LoopThresholds {
  /** Smallest share of the cells the loop must enclose. */
  readonly minCoverage: number;
  /** Smallest share of the rows, and of the columns, that the loop's bounding box must span. */
  readonly minSpan: number;
}

/** Default loop thresholds (PRD FR-8, §14 question 5). */
export const LOOP_THRESHOLDS: LoopThresholds = Object.freeze({ minCoverage: 0.4, minSpan: 0.8 });

/** Side and corner neighbours in ring order: N, NE, E, SE, S, SW, W, NW. Even slots are sides. */
const RING = [
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
] as const;

/**
 * The smallest whole number of cells (or rows, or columns) that is at least `share` of `n`, and at
 * least 1. The small epsilon keeps a product like 0.8 × 10 from rounding up past 8.
 */
export function thresholdCount(share: number, n: number): number {
  return Math.max(1, Math.ceil(share * n - 1e-9));
}

/**
 * A random single loop on `grid` that meets `thresholds`, as edge states (`Line` on the loop,
 * `Cross` elsewhere), or `null` when growth got stuck first.
 *
 * Grows a region of cells from a random cell in the middle half of the board, adding random cells
 * next to it, and stops as soon as the region covers `minCoverage` of the cells and its bounding
 * box spans `minSpan` of the rows and of the columns. The loop is the region's boundary. A cell
 * joins only when its 8 neighbours (off the board counts as outside), read around the ring, hold
 * exactly one run of region cells and that run includes a side neighbour. That keeps the region and
 * the outside each in one piece with no two cells meeting only at a corner, so the boundary is
 * always one simple loop. The whole board always meets the thresholds, so tiny boards end up with
 * the loop around the edge. `extra` grows that many more cells after the thresholds are met (fewer
 * if the region runs out of room); `generate` uses it when it has to retry.
 */
export function generateLoop(
  grid: Grid,
  rng: Rng,
  thresholds: LoopThresholds = LOOP_THRESHOLDS,
  extra = 0,
): Uint8Array | null {
  const W = grid.width;
  const H = grid.height;
  const minArea = thresholdCount(thresholds.minCoverage, grid.cellCount);
  const minRows = thresholdCount(thresholds.minSpan, H);
  const minCols = thresholdCount(thresholds.minSpan, W);
  const inside = new Uint8Array(grid.cellCount);
  const at = (r: number, c: number) => (r >= 0 && r < H && c >= 0 && c < W ? inside[r * W + c] : 0);
  const canAdd = (r: number, c: number): boolean => {
    let runs = 0;
    let side = false;
    for (let k = 0; k < 8; k++) {
      const [dr, dc] = RING[k];
      const [pr, pc] = RING[(k + 7) % 8];
      const cur = at(r + dr, c + dc);
      if (cur && !at(r + pr, c + pc)) runs++;
      if (cur && k % 2 === 0) side = true;
    }
    return runs === 1 && side;
  };

  let area = 0;
  let top = H;
  let bottom = -1;
  let left = W;
  let right = -1;
  const frontier: number[] = [];
  const add = (i: number) => {
    inside[i] = 1;
    area++;
    const r = Math.floor(i / W);
    const c = i % W;
    top = Math.min(top, r);
    bottom = Math.max(bottom, r);
    left = Math.min(left, c);
    right = Math.max(right, c);
    if (r > 0 && !inside[i - W]) frontier.push(i - W);
    if (r < H - 1 && !inside[i + W]) frontier.push(i + W);
    if (c > 0 && !inside[i - 1]) frontier.push(i - 1);
    if (c < W - 1 && !inside[i + 1]) frontier.push(i + 1);
  };
  const done = () => area >= minArea && bottom - top + 1 >= minRows && right - left + 1 >= minCols;

  const qr = Math.floor(H / 4);
  const qc = Math.floor(W / 4);
  add((qr + rng.int(H - 2 * qr)) * W + qc + rng.int(W - 2 * qc));
  // A cell that cannot join yet is dropped; it comes back when another side neighbour joins.
  let more = extra;
  while (frontier.length > 0 && (more > 0 || !done())) {
    const k = rng.int(frontier.length);
    const i = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    if (inside[i] || !canAdd(Math.floor(i / W), i % W)) continue;
    if (done()) more--;
    add(i);
  }
  if (!done()) return null;

  const edges = new Uint8Array(grid.edgeCount);
  for (let e = 0; e < grid.edgeCount; e++) {
    const a = grid.edgeCells[e * 2];
    const b = grid.edgeCells[e * 2 + 1];
    const inA = a === NONE ? 0 : inside[a];
    const inB = b === NONE ? 0 : inside[b];
    edges[e] = inA !== inB ? EdgeState.Line : EdgeState.Cross;
  }
  return edges;
}
