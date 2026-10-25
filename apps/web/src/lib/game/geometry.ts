import {
  cellCoords,
  cellIndex,
  dotCoords,
  dotIndex,
  type Grid,
  hEdgeIndex,
  NONE,
  vEdgeIndex,
} from "@loophole/core";

/**
 * Pixel layout of a board: `cell` is the cell size S from the design kit, `margin` the paper
 * border around the dots. Dot (row, col) sits at (margin + col·cell, margin + row·cell).
 */
export interface Layout {
  readonly cell: number;
  readonly margin: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Narrowest paper border around the dots. */
export const MIN_MARGIN = 10;
/** Cells are never smaller than this on touch screens (FR-13). */
export const TOUCH_MIN_CELL = 44;
/** Smallest cell for mouse and keyboard play. */
export const POINTER_MIN_CELL = 24;
/** Largest cell, as on the desktop artboard. */
export const MAX_CELL = 58;

/**
 * The largest layout that fits `availWidth` × `availHeight`, with cells between `minCell` and
 * `maxCell`. Width always wins: the board never gets wider than `availWidth` (NFR-2), so a wide
 * puzzle on a narrow screen gets smaller cells than `minCell`; pinch-zoom for those comes later.
 * Height gives way to `minCell`, and the page scrolls vertically instead.
 */
export function fitLayout(
  cols: number,
  rows: number,
  availWidth: number,
  availHeight: number,
  minCell: number,
  maxCell: number,
): Layout {
  const byWidth = Math.floor((availWidth - 2 * MIN_MARGIN) / cols);
  const byHeight = Math.floor((availHeight - 2 * MIN_MARGIN) / rows);
  let cell = Math.min(byWidth, byHeight, maxCell);
  cell = Math.max(cell, Math.min(minCell, byWidth), 1);
  const room = Math.min(availWidth - cols * cell, availHeight - rows * cell) / 2;
  const margin = Math.max(MIN_MARGIN, Math.min(Math.round(cell * 0.34), Math.floor(room)));
  return { cell, margin, width: cols * cell + 2 * margin, height: rows * cell + 2 * margin };
}

/** The height a board needs at its smallest allowed cell size for `availWidth`. */
export function minBoardHeight(
  cols: number,
  rows: number,
  availWidth: number,
  minCell: number,
): number {
  const byWidth = Math.floor((availWidth - 2 * MIN_MARGIN) / cols);
  return rows * Math.max(1, Math.min(minCell, byWidth)) + 2 * MIN_MARGIN;
}

export function dotPoint(grid: Grid, layout: Layout, dot: number): Point {
  const { row, col } = dotCoords(grid, dot);
  return { x: layout.margin + col * layout.cell, y: layout.margin + row * layout.cell };
}

export function cellPoint(grid: Grid, layout: Layout, cell: number): Point {
  const { row, col } = cellCoords(grid, cell);
  return {
    x: layout.margin + (col + 0.5) * layout.cell,
    y: layout.margin + (row + 0.5) * layout.cell,
  };
}

/** The edge's two dot centres, top/left first. */
export function edgeSegment(grid: Grid, layout: Layout, edge: number): Segment {
  const a = dotPoint(grid, layout, grid.edgeDots[edge * 2]);
  const b = dotPoint(grid, layout, grid.edgeDots[edge * 2 + 1]);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

export function edgeMidpoint(grid: Grid, layout: Layout, edge: number): Point {
  const s = edgeSegment(grid, layout, edge);
  return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
}

/**
 * The edge whose diamond hit area contains (x, y), in board pixels. Each cell's diagonals cut it
 * into four triangles, one per side; an edge's diamond is the two triangles touching it, so the
 * diamonds tile the board with no gaps and every point picks the nearest edge (design kit, touch
 * targets). Points in the margin belong to the outer edges. Returns `NONE` more than half a cell
 * outside the dots.
 */
export function edgeAt(grid: Grid, layout: Layout, x: number, y: number): number {
  const u = (x - layout.margin) / layout.cell;
  const v = (y - layout.margin) / layout.cell;
  const W = grid.width;
  const H = grid.height;
  if (u < -0.5 || v < -0.5 || u > W + 0.5 || v > H + 0.5) return NONE;
  const c = Math.min(W - 1, Math.max(0, Math.floor(u)));
  const r = Math.min(H - 1, Math.max(0, Math.floor(v)));
  const fu = u - c;
  const fv = v - r;
  const k = cellIndex(grid, r, c) * 4; // cellEdges order: top, right, bottom, left
  if (fv <= fu && fv <= 1 - fu) return grid.cellEdges[k];
  if (fv >= fu && fv >= 1 - fu) return grid.cellEdges[k + 2];
  return fu < 0.5 ? grid.cellEdges[k + 3] : grid.cellEdges[k + 1];
}

/** The dot nearest to (x, y), clamped to the board. */
export function dotAt(grid: Grid, layout: Layout, x: number, y: number): number {
  const col = Math.min(grid.width, Math.max(0, Math.round((x - layout.margin) / layout.cell)));
  const row = Math.min(grid.height, Math.max(0, Math.round((y - layout.margin) / layout.cell)));
  return dotIndex(grid, row, col);
}

/**
 * The edges on a path from dot `from` to dot `to`: along the row first, then along the column.
 * Adjacent dots give their one shared edge; the same dot gives none.
 */
export function dotPath(grid: Grid, from: number, to: number): number[] {
  const a = dotCoords(grid, from);
  const b = dotCoords(grid, to);
  const out: number[] = [];
  let { row, col } = a;
  while (col !== b.col) {
    const next = col < b.col ? col + 1 : col - 1;
    out.push(hEdgeIndex(grid, row, Math.min(col, next)));
    col = next;
  }
  while (row !== b.row) {
    const next = row < b.row ? row + 1 : row - 1;
    out.push(vEdgeIndex(grid, Math.min(row, next), col));
    row = next;
  }
  return out;
}
