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

/** The shape of a loop (`loopShape`). Shares are fractions from 0 to 1. */
export interface LoopShape {
  /** Share of the cells inside the loop. */
  readonly area: number;
  /** Share of the dots the loop passes through. */
  readonly dots: number;
  /** Share of the 2×2 blocks of cells that are all inside or all outside; 0 with no blocks. */
  readonly solid: number;
}

/**
 * The shape `generateLoop` aims for, the same for every puzzle: half the cells inside, the loop
 * through three quarters of the dots, and at most a fifth of the 2×2 blocks solid (`solid` is a
 * ceiling; below it costs nothing). `LOOP_THRESHOLDS` stay hard floors.
 */
export const LOOP_SHAPE_TARGET: LoopShape = Object.freeze({ area: 0.5, dots: 0.75, solid: 0.2 });

/** Tunnels are carved until the loop passes through this share of the dots. */
const CARVE_DOTS = 0.65;
/** Chance that a tunnel tries to turn before it tries to go straight on. */
const TURN_CHANCE = 0.3;
/** Draws per cell at most, which bounds carving when no tunnel fits and adding `extra` cells. */
const CARVE_TRIES = 20;
/** Flips the hill climb tries per cell. */
const CLIMB_SWEEPS = 5;

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
 * Measures one loop given as edge states. A cell is inside when an odd number of vertical line
 * edges lie to its left. Each dot on a single loop has two of its edges on it, so the loop passes
 * through as many dots as it has line edges.
 */
export function loopShape(grid: Grid, edges: Uint8Array): LoopShape {
  const W = grid.width;
  const H = grid.height;
  const inside = new Uint8Array(grid.cellCount);
  let area = 0;
  for (let r = 0; r < H; r++) {
    let v = 0;
    for (let c = 0; c < W; c++) {
      if (edges[grid.hEdgeCount + r * (W + 1) + c] === EdgeState.Line) v ^= 1;
      inside[r * W + c] = v;
      area += v;
    }
  }
  let lines = 0;
  for (const s of edges) if (s === EdgeState.Line) lines++;
  let solid = 0;
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const i = r * W + c;
      const n = inside[i] + inside[i + 1] + inside[i + W] + inside[i + W + 1];
      if (n === 0 || n === 4) solid++;
    }
  }
  const blocks = (W - 1) * (H - 1);
  return {
    area: area / grid.cellCount,
    dots: lines / grid.dotCount,
    solid: blocks > 0 ? solid / blocks : 0,
  };
}

/**
 * A random single loop on `grid` that meets `thresholds`, as edge states (`Line` on the loop,
 * `Cross` elsewhere), shaped towards `LOOP_SHAPE_TARGET`.
 *
 * Every cell starts inside, so the loop starts around the edge of the board. A cell may change
 * sides only when its 8 neighbours (off the board counts as outside), read around the ring, hold
 * exactly one run of cells on the side it moves to and that run includes a side neighbour. That
 * keeps the inside and the outside each in one piece with no two cells meeting only at a corner,
 * so the boundary is always one simple loop. A cell leaves the inside only if the inside still
 * meets `thresholds` afterwards.
 *
 * 1. Carve: tunnels of outside one cell wide wind in from the border. A tunnel starts at an inside
 *    cell that touches the outside on exactly one side, and each step moves to a side neighbour
 *    that touches the outside only through the cell just carved, often straight on and sometimes
 *    turning. Carving stops when the loop passes through `CARVE_DOTS` of the dots.
 * 2. Climb: random cells change sides when that brings the loop's inside area, share of dots and
 *    share of solid 2×2 blocks no further from `LOOP_SHAPE_TARGET`.
 * 3. `extra` random outside cells join the inside (fewer if none can); `generate` uses it when it
 *    has to retry.
 *
 * Each step draws a bounded number of times, so this always finishes. Every board works: 1×1 and
 * 1×2 keep the loop around the edge, and 2×2 always ends as an L.
 */
export function generateLoop(
  grid: Grid,
  rng: Rng,
  thresholds: LoopThresholds = LOOP_THRESHOLDS,
  extra = 0,
): Uint8Array {
  const W = grid.width;
  const H = grid.height;
  const cells = grid.cellCount;
  const blocks = (W - 1) * (H - 1);
  const minArea = thresholdCount(thresholds.minCoverage, cells);
  const minRows = thresholdCount(thresholds.minSpan, H);
  const minCols = thresholdCount(thresholds.minSpan, W);
  const inside = new Uint8Array(cells).fill(1);
  const rowCount = new Int32Array(H).fill(W);
  const colCount = new Int32Array(W).fill(H);
  let area = cells;
  let lines = 2 * (W + H);
  let solid = blocks;
  const at = (r: number, c: number) => (r >= 0 && r < H && c >= 0 && c < W ? inside[r * W + c] : 0);

  /** How many side neighbours are on the other side from cell (r, c), or 0 if it cannot change. */
  const flippable = (r: number, c: number): number => {
    const to = inside[r * W + c] ^ 1;
    let runs = 0;
    let sides = 0;
    for (let k = 0; k < 8; k++) {
      const [dr, dc] = RING[k];
      const [pr, pc] = RING[(k + 7) % 8];
      const cur = at(r + dr, c + dc) === to;
      if (cur && at(r + pr, c + pc) !== to) runs++;
      if (cur && k % 2 === 0) sides++;
    }
    return runs === 1 ? sides : 0;
  };
  /** Solid 2×2 blocks among the (up to) four that hold cell (r, c). */
  const solidAround = (r: number, c: number): number => {
    let n = 0;
    for (let br = Math.max(0, r - 1); br <= Math.min(r, H - 2); br++) {
      for (let bc = Math.max(0, c - 1); bc <= Math.min(c, W - 2); bc++) {
        const i = br * W + bc;
        const k = inside[i] + inside[i + 1] + inside[i + W] + inside[i + W + 1];
        if (k === 0 || k === 4) n++;
      }
    }
    return n;
  };
  const span = (counts: Int32Array): number => {
    let first = -1;
    let last = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] === 0) continue;
      if (first < 0) first = i;
      last = i;
    }
    return last - first + 1;
  };
  /** Whether the inside still meets `thresholds` without inside cell (r, c). */
  const canLeave = (r: number, c: number): boolean => {
    if (area - 1 < minArea) return false;
    rowCount[r]--;
    colCount[c]--;
    const ok =
      (rowCount[r] > 0 || span(rowCount) >= minRows) &&
      (colCount[c] > 0 || span(colCount) >= minCols);
    rowCount[r]++;
    colCount[c]++;
    return ok;
  };
  /** Moves cell (r, c) to the other side; `sides` is `flippable(r, c)`. */
  const flip = (r: number, c: number, sides: number): void => {
    const i = r * W + c;
    const before = solidAround(r, c);
    const d = inside[i] ? -1 : 1;
    inside[i] ^= 1;
    solid += solidAround(r, c) - before;
    area += d;
    rowCount[r] += d;
    colCount[c] += d;
    lines += 4 - 2 * sides;
  };
  const cost = (): number =>
    Math.abs(area / cells - LOOP_SHAPE_TARGET.area) +
    Math.abs(lines / grid.dotCount - LOOP_SHAPE_TARGET.dots) +
    Math.max(0, (blocks > 0 ? solid / blocks : 0) - LOOP_SHAPE_TARGET.solid);

  // 1. Carve. A cell can join a tunnel when it is inside, touches the outside on exactly one side,
  // and can leave.
  const canCarve = (r: number, c: number) =>
    at(r, c) === 1 && flippable(r, c) === 1 && canLeave(r, c);
  const carveGoal = CARVE_DOTS * grid.dotCount;
  const maxSteps = Math.max(3, Math.floor((W + H) / 2));
  for (let t = 0; t < CARVE_TRIES * cells && lines < carveGoal; t++) {
    let r = rng.int(H);
    let c = rng.int(W);
    if (!canCarve(r, c)) continue;
    // Head away from the one outside side.
    let d = 0;
    for (let k = 0; k < 4; k++) if (!at(r + RING[2 * k][0], c + RING[2 * k][1])) d = (k + 2) % 4;
    const steps = 2 + rng.int(maxSteps);
    for (let n = 1; ; n++) {
      flip(r, c, 1);
      if (n >= steps || lines >= carveGoal) break;
      const turn = rng.int(2) === 0 ? 1 : 3;
      const order =
        rng.float() < TURN_CHANCE
          ? [(d + turn) % 4, d, (d + 4 - turn) % 4]
          : [d, (d + turn) % 4, (d + 4 - turn) % 4];
      const next = order.find((k) => canCarve(r + RING[2 * k][0], c + RING[2 * k][1]));
      if (next === undefined) break;
      r += RING[2 * next][0];
      c += RING[2 * next][1];
      d = next;
    }
  }

  // 2. Climb. A change that makes the cost worse is undone; moving the cell back has the other
  // `4 − sides` side neighbours on the far side.
  let current = cost();
  for (let t = 0; t < CLIMB_SWEEPS * cells; t++) {
    const r = rng.int(H);
    const c = rng.int(W);
    const sides = flippable(r, c);
    if (sides === 0 || (at(r, c) === 1 && !canLeave(r, c))) continue;
    flip(r, c, sides);
    const next = cost();
    if (next <= current) current = next;
    else flip(r, c, 4 - sides);
  }

  // 3. Extra cells.
  for (let t = 0, left = extra; left > 0 && t < CARVE_TRIES * cells; t++) {
    const r = rng.int(H);
    const c = rng.int(W);
    if (at(r, c) === 1) continue;
    const sides = flippable(r, c);
    if (sides === 0) continue;
    flip(r, c, sides);
    left--;
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
