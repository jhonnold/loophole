import {
  cellIndex,
  dotIndex,
  EdgeState,
  type Grid,
  hEdgeIndex,
  type Puzzle,
  parsePuzzle,
  type RuleId,
  vEdgeIndex,
} from "@loophole/core";
import type { EdgeChange } from "./board.ts";
import type { HintMarks } from "./hint.ts";

/** A rule drawn small on the hint card (Hint artboard): a tiny board, its marks and the hint. */
export interface RulePattern {
  readonly puzzle: Puzzle;
  readonly edges: Uint8Array;
  readonly marks: HintMarks;
}

interface PatternSpec {
  readonly lines?: readonly number[];
  readonly crosses?: readonly number[];
  readonly cells?: readonly number[];
  readonly dots?: readonly number[];
  readonly ghostLines?: readonly number[];
  readonly ghostCrosses?: readonly number[];
}

/** Index helpers for one grid: h(r, c), v(r, c), cell(r, c), dot(r, c). */
interface At {
  readonly h: (r: number, c: number) => number;
  readonly v: (r: number, c: number) => number;
  readonly cell: (r: number, c: number) => number;
  readonly dot: (r: number, c: number) => number;
}

function pattern(
  width: number,
  height: number,
  clues: string,
  spec: (at: At) => PatternSpec,
): RulePattern {
  const puzzle = parsePuzzle({ v: 1, width, height, clues });
  const g: Grid = puzzle.grid;
  const s = spec({
    h: (r, c) => hEdgeIndex(g, r, c),
    v: (r, c) => vEdgeIndex(g, r, c),
    cell: (r, c) => cellIndex(g, r, c),
    dot: (r, c) => dotIndex(g, r, c),
  });
  const edges = new Uint8Array(g.edgeCount);
  for (const e of s.lines ?? []) edges[e] = EdgeState.Line;
  for (const e of s.crosses ?? []) edges[e] = EdgeState.Cross;
  const ghosts: EdgeChange[] = [
    ...(s.ghostLines ?? []).map((e): EdgeChange => [e, EdgeState.Line]),
    ...(s.ghostCrosses ?? []).map((e): EdgeChange => [e, EdgeState.Cross]),
  ];
  return { puzzle, edges, marks: { cells: s.cells ?? [], dots: s.dots ?? [], ghosts } };
}

/**
 * A small picture for each rule that has one. Rules about dots use a 2×2 board and its centre dot;
 * the others use the fewest cells that show the idea. Lookahead has no single picture, and a hint
 * never shows loop-complete (the board is solved by then), so neither has one.
 */
export const RULE_PATTERNS: Readonly<Partial<Record<RuleId, RulePattern>>> = {
  "clue-zero": pattern(1, 1, "0", (a) => ({
    cells: [0],
    ghostCrosses: [a.h(0, 0), a.v(0, 1), a.h(1, 0), a.v(0, 0)],
  })),
  "clue-satisfied": pattern(1, 1, "1", (a) => ({
    lines: [a.h(0, 0)],
    cells: [0],
    ghostCrosses: [a.v(0, 1), a.h(1, 0), a.v(0, 0)],
  })),
  "clue-needs-all": pattern(1, 1, "1", (a) => ({
    crosses: [a.h(0, 0), a.h(1, 0), a.v(0, 0)],
    cells: [0],
    ghostLines: [a.v(0, 1)],
  })),
  "dot-full": pattern(2, 2, "....", (a) => ({
    lines: [a.v(0, 1), a.h(1, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 1), a.v(1, 1)],
  })),
  "dot-continue": pattern(2, 2, "....", (a) => ({
    lines: [a.v(0, 1)],
    crosses: [a.h(1, 0), a.v(1, 1)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.h(1, 1)],
  })),
  "dot-dead-end": pattern(2, 2, "....", (a) => ({
    crosses: [a.v(0, 1), a.h(1, 0), a.v(1, 1)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 1)],
  })),
  // A corner of the clue whose two outside edges are crossed, here inside the board.
  "corner-1": pattern(2, 2, "..1.", (a) => ({
    crosses: [a.v(0, 1), a.h(1, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 0), a.v(1, 1)],
  })),
  "corner-3": pattern(2, 2, "..3.", (a) => ({
    crosses: [a.v(0, 1), a.h(1, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.h(1, 0), a.v(1, 1)],
  })),
  "adjacent-3s": pattern(2, 3, "..33..", (a) => ({
    cells: [a.cell(1, 0), a.cell(1, 1)],
    ghostLines: [a.v(1, 0), a.v(1, 2)],
    ghostCrosses: [a.v(0, 1), a.v(2, 1)],
  })),
  "diagonal-3s": pattern(2, 2, "3..3", (a) => ({
    cells: [a.cell(0, 0), a.cell(1, 1)],
    ghostLines: [a.h(0, 0), a.v(0, 0), a.h(2, 1), a.v(1, 2)],
  })),
  "premature-loop": pattern(2, 1, "..", (a) => ({
    lines: [a.h(0, 0), a.v(0, 0), a.h(1, 0), a.v(0, 2)],
    dots: [a.dot(0, 1), a.dot(1, 1)],
    ghostCrosses: [a.v(0, 1)],
  })),
  // Corner rules. A line comes down into the 1's top-right corner and the edge on to the right is
  // crossed: the 1's line is at that corner, so its far sides are crossed.
  "line-into-1": pattern(2, 2, "..1.", (a) => ({
    lines: [a.v(0, 1)],
    crosses: [a.h(1, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.v(1, 0), a.h(2, 0)],
  })),
  // A line comes down into the 3's top-right corner: the 3's far sides are lines, and the edge on
  // to the right is crossed.
  "line-into-3": pattern(2, 2, "..3.", (a) => ({
    lines: [a.v(0, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.v(1, 0), a.h(2, 0)],
    ghostCrosses: [a.h(1, 1)],
  })),
  // The loop passes through the 2's top-left corner (a line comes down, the edge to the left is
  // crossed), so it passes through the bottom-right corner too, where the edge below is crossed.
  "two-passes-on": pattern(3, 3, "....2....", (a) => ({
    lines: [a.v(0, 1)],
    crosses: [a.h(1, 0), a.v(2, 2)],
    cells: [a.cell(1, 1)],
    dots: [a.dot(1, 1), a.dot(2, 2)],
    ghostLines: [a.h(2, 2)],
  })),
  // Both sides at the board's corner or neither: either way the loop leaves the 2 along the border.
  "two-in-corner": pattern(2, 2, "2...", (a) => ({
    cells: [a.cell(0, 0)],
    dots: [a.dot(0, 0), a.dot(0, 1), a.dot(1, 0)],
    ghostLines: [a.h(0, 1), a.v(1, 0)],
  })),
  "ones-side-by-side": pattern(2, 2, "11..", (a) => ({
    cells: [a.cell(0, 0), a.cell(0, 1)],
    dots: [a.dot(0, 1)],
    ghostCrosses: [a.v(0, 1)],
  })),
  // The 1's far sides are crossed, so its line passes through the corner it shares with the 3, and
  // the 3's far sides are lines.
  "three-diagonal-one": pattern(2, 2, "3..1", (a) => ({
    crosses: [a.v(1, 2), a.h(2, 1)],
    cells: [a.cell(0, 0), a.cell(1, 1)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.h(0, 0), a.v(0, 0)],
  })),
  // One chain of corners: a 1 and a 3 side by side on the border. If the 3's top side were empty,
  // its shared side would be a line, which could only go on along the 1's top: two lines for the 1.
  "corner-chain": pattern(2, 2, "13..", (a) => ({
    cells: [a.cell(0, 0), a.cell(0, 1)],
    dots: [a.dot(0, 1)],
    ghostLines: [a.h(0, 1)],
  })),
  // The left cell is outside (its outer side is crossed), the right one inside (its outer side is a
  // line), so the edge between them is a line.
  parity: pattern(2, 1, "..", (a) => ({
    crosses: [a.v(0, 0)],
    lines: [a.v(0, 2)],
    cells: [a.cell(0, 0), a.cell(0, 1)],
    ghostLines: [a.v(0, 1)],
  })),
  // Colouring. The cells above and below the 1 are both outside (their outer sides are crossed),
  // and at most one cell beside a 1 differs from it, so neither does: both sides there are crossed.
  "colour-1": pattern(3, 3, "....1....", (a) => ({
    crosses: [a.h(0, 1), a.h(3, 1)],
    cells: [a.cell(0, 1), a.cell(1, 1), a.cell(2, 1)],
    ghostCrosses: [a.h(1, 1), a.h(2, 1)],
  })),
  // The cells left and right of the 2 are both outside. If the 2 is inside, both those sides are
  // lines and the cells above and below are inside like it; if outside, those two differ from it.
  // Either way they are inside, so their outer sides are lines.
  "colour-2": pattern(3, 3, "....2....", (a) => ({
    crosses: [a.v(1, 0), a.v(1, 3)],
    cells: [a.cell(1, 0), a.cell(1, 1), a.cell(1, 2)],
    ghostLines: [a.h(0, 1), a.h(3, 1)],
  })),
  // The cells above and below the 3 are both outside, and at most one cell beside a 3 is on its
  // side, so neither is: both sides there are lines.
  "colour-3": pattern(3, 3, "....3....", (a) => ({
    crosses: [a.h(0, 1), a.h(3, 1)],
    cells: [a.cell(0, 1), a.cell(1, 1), a.cell(2, 1)],
    ghostLines: [a.h(1, 1), a.h(2, 1)],
  })),
  // A position the solver reaches. The 3s' corners put both 3s inside. The left 2 then has inside
  // cells above and below it and the outside on its left, so the cell on its right is outside; the
  // right 2 sits between two outside cells, so the cells above and below it are inside.
  "colour-chain": pattern(3, 3, "3..2.23..", (a) => ({
    lines: [a.h(0, 0), a.v(0, 0), a.h(3, 0), a.v(2, 0)],
    cells: [a.cell(0, 2), a.cell(1, 0), a.cell(1, 2)],
    ghostLines: [a.h(0, 2)],
  })),
  // Connectivity. The bottom-right cell's dots have no other open edges, so no path of open edges
  // joins its sides to the line at the top (whose loop can still close around the top-left).
  unreachable: pattern(3, 3, ".........", (a) => ({
    lines: [a.h(0, 0)],
    crosses: [a.v(1, 2), a.h(2, 1), a.v(1, 3), a.h(3, 1)],
    ghostCrosses: [a.h(2, 2), a.v(2, 3), a.h(3, 2), a.v(2, 2)],
  })),
  // The bottom-right cell hangs off the rest at the centre dot: a loop through it would have to
  // pass that dot twice.
  "cut-off": pattern(2, 2, "....", (a) => ({
    lines: [a.h(0, 0)],
    crosses: [a.h(0, 1), a.v(0, 2), a.v(1, 0), a.h(2, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 1), a.v(1, 2), a.h(2, 1), a.v(1, 1)],
  })),
  // Lines at the top and at the bottom, and the middle row's outer sides crossed: only the middle
  // cell's two sides lead from the top half to the bottom half.
  "two-exits": pattern(3, 3, ".........", (a) => ({
    lines: [a.h(0, 1), a.h(3, 1)],
    crosses: [a.v(1, 0), a.v(1, 3)],
    dots: [a.dot(0, 1), a.dot(3, 1)],
    ghostLines: [a.v(1, 1), a.v(1, 2)],
  })),
};
