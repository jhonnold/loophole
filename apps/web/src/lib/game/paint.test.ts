import { describe, expect, test } from "bun:test";
import { analyzeBoard, createGrid, createPuzzle, EdgeState, hEdgeIndex } from "@loophole/core";
import { MIN_CLUE_CELL, type Painter, paintBoard, type Scene } from "./paint.ts";
import { viewLayout } from "./viewport.ts";

/** A stand-in canvas context that counts the calls the painter makes. */
function recorder() {
  const calls: Record<string, number> = {};
  const count =
    (name: string) =>
    (..._args: unknown[]) => {
      calls[name] = (calls[name] ?? 0) + 1;
    };
  const ctx = {
    setTransform: count("setTransform"),
    clearRect: count("clearRect"),
    fillRect: count("fillRect"),
    beginPath: count("beginPath"),
    moveTo: count("moveTo"),
    lineTo: count("lineTo"),
    arc: count("arc"),
    fill: count("fill"),
    stroke: count("stroke"),
    fillText: count("fillText"),
    setLineDash: count("setLineDash"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  return { ctx: ctx as unknown as Painter, calls };
}

const palette = { ink: "#000", pencil: "#888", shu: "#c00", wash: "#fee" };

function scene(width: number, cell: number, x: number, y: number, edges?: Uint8Array): Scene {
  const puzzle = createPuzzle(width, width, new Array(width * width).fill(2));
  const grid = puzzle.grid;
  const e = edges ?? new Uint8Array(grid.edgeCount);
  return {
    puzzle,
    edges: e,
    analysis: analyzeBoard(puzzle, e),
    layout: viewLayout(grid, cell),
    view: { cell, x, y },
    port: { width: 360, height: 400 },
    ratio: 2,
    palette,
  };
}

describe("paintBoard", () => {
  test("draws only the cells in view (viewport culling)", () => {
    const { ctx, calls } = recorder();
    // 44px cells, viewport 360×400 at (1000, 1000): columns 22–30 and rows 22–31 are on screen,
    // so columns 21–31 and rows 21–32 are drawn: 11×12 clues and 12×13 dots.
    paintBoard(ctx, scene(100, 44, 1000, 1000));
    expect(calls.fillText).toBe(11 * 12);
    // One arc per dot in range; no rings without errors.
    expect(calls.arc).toBe(12 * 13);
  });

  test("draws the whole of a board that fits", () => {
    const { ctx, calls } = recorder();
    paintBoard(ctx, scene(5, 44, 0, 0));
    expect(calls.fillText).toBe(25);
    expect(calls.arc).toBe(36);
  });

  test("leaves out clues on tiny cells", () => {
    const { ctx, calls } = recorder();
    paintBoard(ctx, scene(100, MIN_CLUE_CELL - 1, 0, 0));
    expect(calls.fillText ?? 0).toBe(0);
  });

  test("rings broken clues and dots", () => {
    const grid = createGrid(5, 5);
    const edges = new Uint8Array(grid.edgeCount);
    // Three lines at the dot between cells (0,0), (0,1), (1,0) and (1,1).
    for (const e of [hEdgeIndex(grid, 1, 0), hEdgeIndex(grid, 1, 1), grid.hEdgeCount + 1]) {
      edges[e] = EdgeState.Line;
    }
    const s = scene(5, 44, 0, 0, edges);
    const { ctx, calls } = recorder();
    paintBoard(ctx, s);
    const v = s.analysis.violations;
    const rings = v.dots.length + v.overfullCells.length + v.starvedCells.length;
    expect(v.dots.length).toBe(1);
    expect(calls.arc).toBe(36 + rings);
  });
});
