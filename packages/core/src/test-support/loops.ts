import { EdgeState, type Grid, NONE } from "../grid.ts";
import { createPuzzle, deriveClues, NO_CLUE, type Puzzle } from "../puzzle.ts";
import type { Rng } from "../rng.ts";

/**
 * A random single loop on `grid`: the boundary of a random 4-connected region of cells grown
 * from one cell until it covers about `coverage` of the board. A test and benchmark helper only;
 * the real loop generator is WT3's.
 *
 * A cell joins the region only when its 8 neighbours (off-board counts as outside), read around
 * the ring, hold exactly one run of inside cells and that run includes a side neighbour. That
 * keeps the inside and the outside each connected with no two cells meeting only at a corner, so
 * the boundary stays one simple loop.
 */
export function randomLoop(grid: Grid, rng: Rng, coverage = 0.5): Uint8Array {
  const W = grid.width;
  const H = grid.height;
  const inside = new Uint8Array(grid.cellCount);
  const at = (r: number, c: number) => (r >= 0 && r < H && c >= 0 && c < W ? inside[r * W + c] : 0);
  // Ring order: N, NE, E, SE, S, SW, W, NW. Even slots are side neighbours.
  const ring = [
    [-1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
  ];
  const canAdd = (r: number, c: number): boolean => {
    let runs = 0;
    let side = false;
    for (let k = 0; k < 8; k++) {
      const [dr, dc] = ring[k];
      const [pr, pc] = ring[(k + 7) % 8];
      const cur = at(r + dr, c + dc);
      if (cur && !at(r + pr, c + pc)) runs++;
      if (cur && k % 2 === 0) side = true;
    }
    return runs === 1 && side;
  };

  // Grow from a random cell, picking random cells next to the region. A cell that cannot join yet
  // is dropped and comes back when another of its neighbours joins.
  const target = Math.max(1, Math.floor(grid.cellCount * coverage));
  const frontier: number[] = [];
  const add = (i: number) => {
    inside[i] = 1;
    const r = Math.floor(i / W);
    const c = i % W;
    if (r > 0 && !inside[i - W]) frontier.push(i - W);
    if (r < H - 1 && !inside[i + W]) frontier.push(i + W);
    if (c > 0 && !inside[i - 1]) frontier.push(i - 1);
    if (c < W - 1 && !inside[i + 1]) frontier.push(i + 1);
  };
  add(rng.int(grid.cellCount));
  for (let size = 1; size < target && frontier.length > 0; ) {
    const k = rng.int(frontier.length);
    const i = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    if (inside[i] || !canAdd(Math.floor(i / W), i % W)) continue;
    add(i);
    size++;
  }

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

/**
 * A puzzle whose clues are derived from `loop`, keeping each clue with probability `keep`
 * (1 keeps them all). A cell with 4 lines never gets a clue.
 */
export function puzzleFromLoop(grid: Grid, loop: Uint8Array, rng: Rng, keep = 1): Puzzle {
  const clues = Array.from(deriveClues(grid, loop), (k) =>
    k <= 3 && (keep >= 1 || rng.float() < keep) ? k : NO_CLUE,
  );
  return createPuzzle(grid.width, grid.height, clues);
}
