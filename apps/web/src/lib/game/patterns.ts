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
  // The left cell is outside (its outer side is crossed), the right one inside (its outer side is a
  // line), so the edge between them is a line.
  parity: pattern(2, 1, "..", (a) => ({
    crosses: [a.v(0, 0)],
    lines: [a.v(0, 2)],
    cells: [a.cell(0, 0), a.cell(0, 1)],
    ghostLines: [a.v(0, 1)],
  })),
};
