import {
  type BoardAnalysis,
  cellIndex,
  dotIndex,
  EdgeState,
  hEdgeIndex,
  NO_CLUE,
  type Puzzle,
  vEdgeIndex,
} from "@loophole/core";
import {
  cellPoint,
  dotPoint,
  edgeMidpoint,
  edgeSegment,
  type Layout,
  markSizes,
} from "./geometry.ts";
import { insideCells } from "./inside.ts";
import { type Size, type View, visibleCells } from "./viewport.ts";

/** Theme colours for the canvas, read from the app stylesheet's custom properties. */
export interface Palette {
  readonly ink: string;
  readonly pencil: string;
  readonly shu: string;
  readonly wash: string;
}

/** The part of the canvas 2D context the painter uses, so tests can pass a recorder. */
export type Painter = Pick<
  CanvasRenderingContext2D,
  | "setTransform"
  | "clearRect"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "fill"
  | "stroke"
  | "fillText"
  | "setLineDash"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "font"
  | "textAlign"
  | "textBaseline"
>;

export interface Scene {
  readonly puzzle: Puzzle;
  readonly edges: Uint8Array;
  readonly analysis: BoardAnalysis;
  /** The whole board at the current cell size. */
  readonly layout: Layout;
  readonly view: View;
  /** Viewport size in CSS pixels; the canvas holds `port × ratio` device pixels. */
  readonly port: Size;
  readonly ratio: number;
  readonly palette: Palette;
}

/** Clues are not drawn below this cell size; they would be under 5px tall. */
export const MIN_CLUE_CELL = 8;

/**
 * Draws the board on a canvas with the SVG board's look (design kit, Board): solved wash, lines
 * (dashed shu for a premature loop), crosses, dots, clues and error rings. Only the cells in the
 * viewport, plus a one-cell border, are drawn (viewport culling).
 */
export function paintBoard(ctx: Painter, scene: Scene): void {
  const { puzzle, edges, analysis, layout, view, port, ratio, palette } = scene;
  const grid = puzzle.grid;
  const S = layout.cell;
  const size = markSizes(S);
  const { r0, r1, c0, c1 } = visibleCells(grid, layout, view, port);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Math.round(port.width * ratio), Math.round(port.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, -view.x * ratio, -view.y * ratio);
  if (r1 < r0 || c1 < c0) return;

  const v = analysis.violations;
  const loop = new Uint8Array(grid.edgeCount);
  for (const e of v.loopEdges) loop[e] = 1;
  const bad = new Uint8Array(grid.cellCount);
  for (const c of v.overfullCells) bad[c] = 1;
  for (const c of v.starvedCells) bad[c] = 1;

  // Edges touching the visible cells: horizontal ones on dot rows r0..r1+1, vertical ones on dot
  // columns c0..c1+1.
  const visible: number[] = [];
  for (let r = r0; r <= r1 + 1; r++) {
    for (let c = c0; c <= c1; c++) visible.push(hEdgeIndex(grid, r, c));
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1 + 1; c++) visible.push(vEdgeIndex(grid, r, c));
  }

  if (analysis.solved) {
    const inside = insideCells(grid, edges);
    ctx.fillStyle = palette.wash;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = cellIndex(grid, r, c);
        if (inside[i] === 0) continue;
        const p = cellPoint(grid, layout, i);
        ctx.fillRect(p.x - S / 2, p.y - S / 2, S, S);
      }
    }
  }

  const strokeLines = (dashed: boolean) => {
    ctx.beginPath();
    for (const e of visible) {
      if (edges[e] !== EdgeState.Line || (loop[e] === 1) !== dashed) continue;
      const s = edgeSegment(grid, layout, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = size.line;
    ctx.lineCap = dashed ? "butt" : "round";
    ctx.strokeStyle = dashed ? palette.shu : palette.ink;
    ctx.setLineDash(dashed ? [6, 5] : []);
    ctx.stroke();
  };
  strokeLines(false);
  if (v.loopEdges.length > 0) strokeLines(true);
  ctx.setLineDash([]);

  ctx.beginPath();
  const arm = size.crossArm;
  for (const e of visible) {
    if (edges[e] !== EdgeState.Cross) continue;
    const { x, y } = edgeMidpoint(grid, layout, e);
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x + arm, y - arm);
    ctx.lineTo(x - arm, y + arm);
  }
  ctx.lineWidth = size.crossWidth;
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.pencil;
  ctx.stroke();

  ctx.beginPath();
  for (let r = r0; r <= r1 + 1; r++) {
    for (let c = c0; c <= c1 + 1; c++) {
      const p = dotPoint(grid, layout, dotIndex(grid, r, c));
      ctx.moveTo(p.x + size.dotRadius, p.y);
      ctx.arc(p.x, p.y, size.dotRadius, 0, 2 * Math.PI);
    }
  }
  ctx.fillStyle = palette.ink;
  ctx.fill();

  ctx.beginPath();
  if (S >= MIN_CLUE_CELL) {
    ctx.font = `500 ${size.clue}px "Zen Kaku Gothic New", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = cellIndex(grid, r, c);
      const clue = puzzle.clues[i];
      if (clue === NO_CLUE) continue;
      const p = cellPoint(grid, layout, i);
      if (S >= MIN_CLUE_CELL) {
        ctx.fillStyle = bad[i] === 1 ? palette.shu : palette.ink;
        ctx.fillText(String(clue), p.x, p.y);
      }
      if (bad[i] === 1) {
        ctx.moveTo(p.x + size.clueRing, p.y);
        ctx.arc(p.x, p.y, size.clueRing, 0, 2 * Math.PI);
      }
    }
  }
  for (const d of v.dots) {
    const p = dotPoint(grid, layout, d);
    ctx.moveTo(p.x + size.dotRing, p.y);
    ctx.arc(p.x, p.y, size.dotRing, 0, 2 * Math.PI);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shu;
  ctx.stroke();
}
