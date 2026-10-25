/**
 * Grid geometry for a W×H Slitherlink board, with adjacency tables in typed arrays for hot loops.
 *
 * Indexing (W = width, H = height):
 * - cell (row r, col c), 0 ≤ r < H, 0 ≤ c < W: `r * W + c`
 * - dot (row r, col c), 0 ≤ r ≤ H, 0 ≤ c ≤ W: `r * (W + 1) + c`
 * - horizontal edge (row r, col c), 0 ≤ r ≤ H, 0 ≤ c < W, joins dot (r, c) to dot (r, c + 1): `r * W + c`
 * - vertical edge (row r, col c), 0 ≤ r < H, 0 ≤ c ≤ W, joins dot (r, c) to dot (r + 1, c):
 *   `hEdgeCount + r * (W + 1) + c`, where `hEdgeCount = (H + 1) * W`
 */

export const MIN_SIZE = 1;
export const MAX_SIZE = 100;

/** Marks a missing neighbour in `dotEdges` and `edgeCells`. */
export const NONE = -1;

/** The state of one edge. Edge states are stored in a `Uint8Array` of length `grid.edgeCount`. */
export const EdgeState = {
  Unknown: 0,
  Line: 1,
  Cross: 2,
} as const;
export type EdgeState = (typeof EdgeState)[keyof typeof EdgeState];

export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  readonly dotCount: number;
  readonly hEdgeCount: number;
  readonly edgeCount: number;
  /** 4 entries per cell, clockwise from the top: `[top, right, bottom, left]` edge indices. */
  readonly cellEdges: Int32Array;
  /** 4 entries per dot, clockwise from up: `[up, right, down, left]` edge indices, `NONE` off the board. */
  readonly dotEdges: Int32Array;
  /** 2 entries per edge: `[top or left dot, bottom or right dot]`. */
  readonly edgeDots: Int32Array;
  /** 2 entries per edge: `[cell above or left, cell below or right]`, `NONE` outside the board. */
  readonly edgeCells: Int32Array;
}

export interface EdgeCoords {
  readonly horizontal: boolean;
  readonly row: number;
  readonly col: number;
}

export function createGrid(width: number, height: number): Grid {
  if (!isValidSize(width) || !isValidSize(height)) {
    throw new RangeError(
      `grid size must be whole numbers from ${MIN_SIZE} to ${MAX_SIZE}, got ${width}×${height}`,
    );
  }
  const W = width;
  const H = height;
  const cellCount = W * H;
  const dotCount = (W + 1) * (H + 1);
  const hEdgeCount = (H + 1) * W;
  const edgeCount = hEdgeCount + H * (W + 1);

  const cellEdges = new Int32Array(cellCount * 4);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const k = (r * W + c) * 4;
      cellEdges[k] = r * W + c;
      cellEdges[k + 1] = hEdgeCount + r * (W + 1) + c + 1;
      cellEdges[k + 2] = (r + 1) * W + c;
      cellEdges[k + 3] = hEdgeCount + r * (W + 1) + c;
    }
  }

  const dotEdges = new Int32Array(dotCount * 4).fill(NONE);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c <= W; c++) {
      const k = (r * (W + 1) + c) * 4;
      if (r > 0) dotEdges[k] = hEdgeCount + (r - 1) * (W + 1) + c;
      if (c < W) dotEdges[k + 1] = r * W + c;
      if (r < H) dotEdges[k + 2] = hEdgeCount + r * (W + 1) + c;
      if (c > 0) dotEdges[k + 3] = r * W + c - 1;
    }
  }

  const edgeDots = new Int32Array(edgeCount * 2);
  const edgeCells = new Int32Array(edgeCount * 2).fill(NONE);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c < W; c++) {
      const e = r * W + c;
      edgeDots[e * 2] = r * (W + 1) + c;
      edgeDots[e * 2 + 1] = r * (W + 1) + c + 1;
      if (r > 0) edgeCells[e * 2] = (r - 1) * W + c;
      if (r < H) edgeCells[e * 2 + 1] = r * W + c;
    }
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c <= W; c++) {
      const e = hEdgeCount + r * (W + 1) + c;
      edgeDots[e * 2] = r * (W + 1) + c;
      edgeDots[e * 2 + 1] = (r + 1) * (W + 1) + c;
      if (c > 0) edgeCells[e * 2] = r * W + c - 1;
      if (c < W) edgeCells[e * 2 + 1] = r * W + c;
    }
  }

  return {
    width: W,
    height: H,
    cellCount,
    dotCount,
    hEdgeCount,
    edgeCount,
    cellEdges,
    dotEdges,
    edgeDots,
    edgeCells,
  };
}

function isValidSize(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE;
}

export function cellIndex(grid: Grid, row: number, col: number): number {
  return row * grid.width + col;
}

export function dotIndex(grid: Grid, row: number, col: number): number {
  return row * (grid.width + 1) + col;
}

export function hEdgeIndex(grid: Grid, row: number, col: number): number {
  return row * grid.width + col;
}

export function vEdgeIndex(grid: Grid, row: number, col: number): number {
  return grid.hEdgeCount + row * (grid.width + 1) + col;
}

/** Row and column of an edge, in the horizontal or vertical edge numbering described above. */
export function edgeCoords(grid: Grid, edge: number): EdgeCoords {
  if (edge < grid.hEdgeCount) {
    return { horizontal: true, row: Math.floor(edge / grid.width), col: edge % grid.width };
  }
  const v = edge - grid.hEdgeCount;
  return { horizontal: false, row: Math.floor(v / (grid.width + 1)), col: v % (grid.width + 1) };
}

export interface Coords {
  readonly row: number;
  readonly col: number;
}

/** Row and column of a cell; inverts `cellIndex`. */
export function cellCoords(grid: Grid, cell: number): Coords {
  return { row: Math.floor(cell / grid.width), col: cell % grid.width };
}

/** Row and column of a dot; inverts `dotIndex`. */
export function dotCoords(grid: Grid, dot: number): Coords {
  return { row: Math.floor(dot / (grid.width + 1)), col: dot % (grid.width + 1) };
}
