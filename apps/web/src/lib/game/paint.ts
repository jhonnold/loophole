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
import type { HintMarks } from "./hint.ts";
import { insideCells } from "./inside.ts";
import { hatched, hatchSegments, mirrored, tintSquare } from "./sides.ts";
import { type Size, type View, visibleCells } from "./viewport.ts";

/** Theme colours for the canvas, read from the app stylesheet's custom properties. */
export interface Palette {
  readonly ink: string;
  readonly pencil: string;
  readonly shu: string;
  readonly wash: string;
  readonly ai: string;
  readonly hintWash: string;
  /** Where a try-and-see hint's supposed marks break the rules. */
  readonly conflictWash: string;
  /** A try-and-see hint's supposed marks. */
  readonly whatIf: string;
  /** A hint's side tints: inside, outside, relative only; their hatching; the chains' marks. */
  readonly sideIn: string;
  readonly sideOut: string;
  readonly sideRel: string;
  readonly sideHatch: string;
  readonly sideChain: string;
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
  /** The player's cell shades (`CellShade`), drawn like a hint's in and out tints; none once solved. */
  readonly shades?: Uint8Array;
  readonly analysis: BoardAnalysis;
  /** The whole board at the current cell size. */
  readonly layout: Layout;
  readonly view: View;
  /** Viewport size in CSS pixels; the canvas holds `port × ratio` device pixels. */
  readonly port: Size;
  readonly ratio: number;
  readonly palette: Palette;
  /** The hint on show, or null. */
  readonly hint: HintMarks | null;
}

/** Clues are not drawn below this cell size; they would be under 5px tall. */
export const MIN_CLUE_CELL = 8;

/**
 * Draws the board on a canvas with the SVG board's look (design kit, Board): solved wash, hint and
 * conflict washes, lines (dashed shu for a premature loop), the hint's ghost moves and supposed
 * marks, crosses, dots, clues and error rings. Only the cells in the viewport, plus a one-cell
 * border, are drawn (viewport culling); a hint's few marks are drawn wherever they are.
 */
export function paintBoard(ctx: Painter, scene: Scene): void {
  const { puzzle, edges, analysis, layout, view, port, ratio, palette, hint } = scene;
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

  const shades = scene.shades;
  if (shades !== undefined && !analysis.solved) {
    // The player's own shades: inside plain, outside hatched, as a hint tints them.
    ctx.beginPath();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = cellIndex(grid, r, c);
        if (shades[i] === 0) continue;
        const p = cellPoint(grid, layout, i);
        const q = tintSquare(p.x, p.y, S, true);
        ctx.fillStyle = shades[i] === 1 ? palette.sideIn : palette.sideOut;
        ctx.fillRect(q.x, q.y, q.size, q.size);
        if (shades[i] !== 2) continue;
        for (const [x1, y1, x2, y2] of hatchSegments(q.x, q.y, q.size, S / 5)) {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
      }
    }
    ctx.lineWidth = Math.max(1, S / 24);
    ctx.lineCap = "butt";
    ctx.strokeStyle = palette.sideHatch;
    ctx.stroke();
  }

  const hinted = new Uint8Array(hint === null ? 0 : grid.cellCount);
  const sides = hint?.sides;
  if (sides !== undefined) {
    // A parity or colouring step's cells by side (hatched: outside, or the second relative side),
    // then a soft band under the marks its chains run along.
    const tone = {
      in: palette.sideIn,
      out: palette.sideOut,
      a: palette.sideRel,
      b: palette.sideRel,
    };
    ctx.beginPath();
    for (const t of sides.cells) {
      const p = cellPoint(grid, layout, t.cell);
      const q = tintSquare(p.x, p.y, S, t.strong);
      ctx.fillStyle = tone[t.tone];
      ctx.fillRect(q.x, q.y, q.size, q.size);
      if (!hatched(t.tone)) continue;
      for (const [x1, y1, x2, y2] of hatchSegments(q.x, q.y, q.size, S / 5, mirrored(t.tone))) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    }
    ctx.lineWidth = Math.max(1, S / 24);
    ctx.lineCap = "butt";
    ctx.strokeStyle = palette.sideHatch;
    ctx.stroke();
    ctx.beginPath();
    for (const e of sides.edges) {
      const s = edgeSegment(grid, layout, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = size.line * 3.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = palette.sideChain;
    ctx.stroke();
    for (const t of sides.cells) hinted[t.cell] = 2;
  }
  if (hint !== null) {
    ctx.fillStyle = palette.hintWash;
    for (const i of hint.cells) {
      if (hinted[i] === 2) {
        hinted[i] = 1;
        continue;
      }
      hinted[i] = 1;
      const p = cellPoint(grid, layout, i);
      ctx.fillRect(p.x - S / 2 + 2, p.y - S / 2 + 2, S - 4, S - 4);
    }
    ctx.beginPath();
    for (const d of hint.dots) {
      const p = dotPoint(grid, layout, d);
      ctx.moveTo(p.x + S * 0.3, p.y);
      ctx.arc(p.x, p.y, S * 0.3, 0, 2 * Math.PI);
    }
    ctx.fill();
  }

  const conflict = hint?.conflict;
  if (conflict !== undefined) {
    ctx.fillStyle = palette.conflictWash;
    for (const i of conflict.cells) {
      const p = cellPoint(grid, layout, i);
      ctx.fillRect(p.x - S / 2 + 2, p.y - S / 2 + 2, S - 4, S - 4);
    }
    ctx.beginPath();
    for (const d of conflict.dots) {
      const p = dotPoint(grid, layout, d);
      ctx.moveTo(p.x + S * 0.3, p.y);
      ctx.arc(p.x, p.y, S * 0.3, 0, 2 * Math.PI);
    }
    ctx.fill();
    ctx.beginPath();
    for (const e of conflict.edges) {
      const s = edgeSegment(grid, layout, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = size.line * 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = palette.conflictWash;
    ctx.stroke();
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

  if (hint !== null && hint.ghosts.length > 0) {
    // The forced move on edges still empty: a dashed ai line, or a bolder ai ×.
    ctx.beginPath();
    for (const [e, state] of hint.ghosts) {
      if (state !== EdgeState.Line || edges[e] !== EdgeState.Unknown) continue;
      const s = edgeSegment(grid, layout, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = size.line;
    ctx.lineCap = "butt";
    ctx.strokeStyle = palette.ai;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [e, state] of hint.ghosts) {
      if (state !== EdgeState.Cross || edges[e] !== EdgeState.Unknown) continue;
      const { x, y } = edgeMidpoint(grid, layout, e);
      const a = size.crossArm;
      ctx.moveTo(x - a, y - a);
      ctx.lineTo(x + a, y + a);
      ctx.moveTo(x + a, y - a);
      ctx.lineTo(x - a, y + a);
    }
    ctx.lineWidth = size.crossWidth * 1.6;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const whatIf = hint?.whatIf ?? [];
  if (whatIf.length > 0) {
    // A try-and-see hint's supposed marks on edges still empty: a dotted line, or a fainter ×.
    ctx.beginPath();
    for (const [e, state] of whatIf) {
      if (state !== EdgeState.Line || edges[e] !== EdgeState.Unknown) continue;
      const s = edgeSegment(grid, layout, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = size.line;
    ctx.lineCap = "round";
    ctx.strokeStyle = palette.whatIf;
    ctx.setLineDash([0.1, size.line * 2.2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [e, state] of whatIf) {
      if (state !== EdgeState.Cross || edges[e] !== EdgeState.Unknown) continue;
      const { x, y } = edgeMidpoint(grid, layout, e);
      const a = size.crossArm;
      ctx.moveTo(x - a, y - a);
      ctx.lineTo(x + a, y + a);
      ctx.moveTo(x + a, y - a);
      ctx.lineTo(x - a, y + a);
    }
    ctx.lineWidth = size.crossWidth * 1.3;
    ctx.stroke();
  }

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
  const clueFont = (weight: number) =>
    `${weight} ${size.clue}px "Zen Kaku Gothic New", system-ui, sans-serif`;
  if (S >= MIN_CLUE_CELL) {
    ctx.font = clueFont(500);
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
        // A clue the hint rests on is bold and ai, as on the Hint artboard.
        const strong = hint !== null && hinted[i] === 1 && bad[i] === 0;
        if (strong) ctx.font = clueFont(700);
        ctx.fillStyle = bad[i] === 1 ? palette.shu : strong ? palette.ai : palette.ink;
        ctx.fillText(String(clue), p.x, p.y);
        if (strong) ctx.font = clueFont(500);
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
