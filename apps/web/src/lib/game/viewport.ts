import type { Grid } from "@loophole/core";
import { type Layout, MIN_MARGIN, type Point } from "./geometry.ts";

/**
 * The part of a zoomable board on screen: the cell size, and where the viewport's top-left corner
 * sits on the board, in board pixels at that cell size. A negative offset means the board is
 * narrower than the viewport and is centred in it.
 */
export interface View {
  readonly cell: number;
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Smallest and largest cell size while zooming. */
export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

/** Largest cell when zoomed in: twice the touch minimum. */
export const ZOOM_MAX_CELL = 88;
/** Zoom factor of one press of the +/− buttons or keys. */
export const ZOOM_STEP = 1.25;
/** Boards wider or taller than this draw on a canvas instead of SVG (NFR-2). */
export const SVG_MAX_SIZE = 30;
/** Outer size of the overview map (Night artboard). */
export const MINI_BOX = 88;
/**
 * How far the board may be pulled past its top-left and bottom-right corners, so the edges under
 * the overview map (top left: 8px inset, 88px box, borders) and the zoom controls (bottom right:
 * 44px buttons, padding, borders, 8px inset) can be brought into the open and tapped.
 */
export const OVERSCROLL_START = MINI_BOX + 16;
export const OVERSCROLL_END = 68;
/** Width of the corner the zoom controls cover, from the viewport's right edge. */
export const ZOOM_CONTROLS_WIDTH = 168;

/** Paper border around the dots of a zoomable board. */
export function viewMargin(cell: number): number {
  return Math.max(MIN_MARGIN, cell * 0.34);
}

/** The whole board's pixel layout at cell size `cell`. */
export function viewLayout(grid: Grid, cell: number): Layout {
  const margin = viewMargin(cell);
  return {
    cell,
    margin,
    width: grid.width * cell + 2 * margin,
    height: grid.height * cell + 2 * margin,
  };
}

/** The largest cell for `n` cells plus margins in `length` pixels. */
function fitAlong(n: number, length: number): number {
  return Math.min((length - 2 * MIN_MARGIN) / n, length / (n + 0.68));
}

/** Zooming goes from the whole board in `port` up to `ZOOM_MAX_CELL`. */
export function zoomLimits(grid: Grid, port: Size): ZoomLimits {
  const min = Math.max(
    1,
    Math.min(fitAlong(grid.width, port.width), fitAlong(grid.height, port.height)),
  );
  return { min, max: Math.max(min, ZOOM_MAX_CELL) };
}

function clampAxis(offset: number, content: number, port: number): number {
  const over = content - port;
  if (over <= 0) return over / 2;
  // The overscroll grows with the overflow, so a board that only just overflows (such as one
  // zoomed nearly all the way out) still shows whole.
  const lo = -Math.min(OVERSCROLL_START, over);
  const hi = over + Math.min(OVERSCROLL_END, over);
  return Math.min(Math.max(offset, lo), hi);
}

/**
 * Keeps the cell size within `limits` and the board over the viewport, give or take the overscroll
 * at each end. A board that fits the viewport is centred in it.
 */
export function clampView(grid: Grid, view: View, port: Size, limits: ZoomLimits): View {
  const cell = Math.min(Math.max(view.cell, limits.min), limits.max);
  const l = viewLayout(grid, cell);
  return {
    cell,
    x: clampAxis(view.x, l.width, port.width),
    y: clampAxis(view.y, l.height, port.height),
  };
}

/**
 * Zooms to `cell` and moves the board so that the board point under `from` (viewport pixels) ends
 * up under `to`. Zoom, pan and pinch are all this one move.
 */
export function anchorView(
  grid: Grid,
  view: View,
  cell: number,
  from: Point,
  to: Point,
  port: Size,
  limits: ZoomLimits,
): View {
  const target = Math.min(Math.max(cell, limits.min), limits.max);
  const before = viewMargin(view.cell);
  const after = viewMargin(target);
  // The point under `from`, in cells from the top-left dot.
  const u = (from.x + view.x - before) / view.cell;
  const v = (from.y + view.y - before) / view.cell;
  return clampView(
    grid,
    { cell: target, x: after + u * target - to.x, y: after + v * target - to.y },
    port,
    limits,
  );
}

/** Zooms to `cell`, keeping the board point under `at` where it is. */
export function zoomAround(
  grid: Grid,
  view: View,
  cell: number,
  at: Point,
  port: Size,
  limits: ZoomLimits,
): View {
  return anchorView(grid, view, cell, at, at, port, limits);
}

/** Moves the board by (dx, dy) viewport pixels, as when dragging it. */
export function panBy(
  grid: Grid,
  view: View,
  dx: number,
  dy: number,
  port: Size,
  limits: ZoomLimits,
): View {
  return anchorView(grid, view, view.cell, { x: 0, y: 0 }, { x: dx, y: dy }, port, limits);
}

/**
 * Two-finger pinch: from the view when the second finger landed (`start`, fingers at `a0` and
 * `b0`) to the fingers now at `a1` and `b1`. The cell size follows the distance between the fingers
 * and the board follows their midpoint.
 */
export function pinchView(
  grid: Grid,
  start: View,
  a0: Point,
  b0: Point,
  a1: Point,
  b1: Point,
  port: Size,
  limits: ZoomLimits,
): View {
  const d0 = Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y));
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return anchorView(grid, start, (start.cell * d1) / d0, m0, m1, port, limits);
}

function revealAxis(offset: number, start: number, length: number, port: number): number {
  if (start < offset || length > port) return start;
  if (start + length > offset + port) return start + length - port;
  return offset;
}

/**
 * The smallest pan that brings `rect` (board pixels) fully into the viewport and out from under
 * the overview map (top-left `OVERSCROLL_START` square: moved right or down, whichever is shorter)
 * and the zoom controls (bottom-right `ZOOM_CONTROLS_WIDTH` × `OVERSCROLL_END`: moved up).
 */
export function revealRect(
  grid: Grid,
  view: View,
  rect: Rect,
  port: Size,
  limits: ZoomLimits,
): View {
  let x = revealAxis(view.x, rect.x, rect.width, port.width);
  let y = revealAxis(view.y, rect.y, rect.height, port.height);
  const left = rect.x - x;
  const top = rect.y - y;
  if (left < OVERSCROLL_START && top < OVERSCROLL_START) {
    const dx = OVERSCROLL_START - left;
    const dy = OVERSCROLL_START - top;
    if (dx <= dy) x -= dx;
    else y -= dy;
  }
  const below = top + rect.height - (port.height - OVERSCROLL_END);
  if (left + rect.width > port.width - ZOOM_CONTROLS_WIDTH && below > 0) y += below;
  return clampView(grid, { cell: view.cell, x, y }, port, limits);
}

/** Cells to draw, inclusive. Empty when `r1 < r0` or `c1 < c0`. */
export interface CellRange {
  readonly r0: number;
  readonly r1: number;
  readonly c0: number;
  readonly c1: number;
}

/**
 * The cells that touch the viewport, plus one more on each side so that lines, dots and rings
 * reaching over a cell border are drawn too (viewport culling).
 */
export function visibleCells(grid: Grid, layout: Layout, view: View, port: Size): CellRange {
  const from = (offset: number) => Math.floor((offset - layout.margin) / layout.cell) - 1;
  return {
    r0: Math.max(0, from(view.y)),
    r1: Math.min(grid.height - 1, from(view.y + port.height) + 2),
    c0: Math.max(0, from(view.x)),
    c1: Math.min(grid.width - 1, from(view.x + port.width) + 2),
  };
}

const MINI_PAD = 4;

/** The board's layout on the overview map. */
export function miniLayout(grid: Grid): Layout {
  const cell = Math.min(
    (MINI_BOX - 2 * MINI_PAD) / grid.width,
    (MINI_BOX - 2 * MINI_PAD) / grid.height,
  );
  return {
    cell,
    margin: MINI_PAD,
    width: grid.width * cell + 2 * MINI_PAD,
    height: grid.height * cell + 2 * MINI_PAD,
  };
}

/** The part of the board on screen, as a rectangle on the overview map, clipped to the map. */
export function miniRect(view: View, port: Size, mini: Layout): Rect {
  const s = mini.cell / view.cell;
  const margin = viewMargin(view.cell);
  const x0 = Math.max(0, mini.margin + (view.x - margin) * s);
  const y0 = Math.max(0, mini.margin + (view.y - margin) * s);
  const x1 = Math.min(mini.width, mini.margin + (view.x + port.width - margin) * s);
  const y1 = Math.min(mini.height, mini.margin + (view.y + port.height - margin) * s);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** The view centred on the board point under (x, y) on the overview map. */
export function miniJump(
  grid: Grid,
  view: View,
  x: number,
  y: number,
  mini: Layout,
  port: Size,
  limits: ZoomLimits,
): View {
  const u = (x - mini.margin) / mini.cell;
  const v = (y - mini.margin) / mini.cell;
  const margin = viewMargin(view.cell);
  return clampView(
    grid,
    {
      cell: view.cell,
      x: margin + u * view.cell - port.width / 2,
      y: margin + v * view.cell - port.height / 2,
    },
    port,
    limits,
  );
}
