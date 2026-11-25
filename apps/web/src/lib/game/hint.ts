import {
  EdgeState,
  type Grid,
  type Hint,
  type Puzzle,
  RULE_TEXT,
  RULE_TITLE,
  type RuleId,
  type Step,
  verify,
} from "@loophole/core";
import type { EdgeChange } from "./board.ts";
import { cellPoint, dotPoint, edgeMidpoint, type Layout, type Point } from "./geometry.ts";
import type { Rect } from "./viewport.ts";

/** What a hint draws on the board (design kit, Board): an ai wash and dashed ai ghost moves. */
export interface HintMarks {
  readonly cells: readonly number[];
  readonly dots: readonly number[];
  /** The forced move: a dashed ghost line or a ghost ×, on edges that are still empty. */
  readonly ghosts: readonly EdgeChange[];
}

/** A hint ready to show: the card's words, the board marks and the move "Apply" makes. */
export interface HintView {
  /** The small line above the title, e.g. "next forced move". */
  readonly eyebrow: string;
  readonly title: string;
  readonly text: string;
  /**
   * The steps the move makes before its line, by title, a run of the same rule once with a count
   * ("Dead end ×2"). Empty when the line comes first.
   */
  readonly steps: readonly string[];
  /** The rule whose pattern the card draws, or null for a mistake or a revealed line. */
  readonly rule: RuleId | null;
  readonly marks: HintMarks;
  readonly apply: readonly EdgeChange[];
  readonly applyLabel: string;
  /** The label of the button that closes the card and leaves the move to the player. */
  readonly laterLabel: string;
  /** The states of the `apply` edges when the hint was made. */
  readonly before: readonly EdgeState[];
}

/** The two dots at the ends of an edge. */
function edgeDots(grid: Grid, edge: number): number[] {
  return [grid.edgeDots[edge * 2], grid.edgeDots[edge * 2 + 1]];
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The titles of `steps`, a run of the same rule once with its count. */
function stepTitles(steps: readonly Step[]): string[] {
  const titles: string[] = [];
  for (let i = 0; i < steps.length; ) {
    let n = 1;
    while (steps[i + n]?.rule === steps[i].rule) n++;
    titles.push(RULE_TITLE[steps[i].rule] + (n > 1 ? ` ×${n}` : ""));
    i += n;
  }
  return titles;
}

/**
 * Turns a core hint into what the card and the board show. Null when the board is solved. A step
 * hint's move is its line and the crosses before it, made together.
 */
export function hintView(grid: Grid, hint: Hint, edges: Uint8Array): HintView | null {
  const view = (v: Omit<HintView, "before">): HintView => ({
    ...v,
    before: v.apply.map(([e]) => edges[e] as EdgeState),
  });
  switch (hint.kind) {
    case "solved":
      return null;
    case "step": {
      const { rule } = hint.step;
      const all = [...hint.before, hint.step];
      const moves = all.flatMap((s) => s.changes.map((c): EdgeChange => [c.edge, c.state]));
      return view({
        eyebrow: "next forced move",
        title: RULE_TITLE[rule],
        text: RULE_TEXT[rule],
        steps: stepTitles(hint.before),
        rule,
        marks: {
          cells: [...new Set(all.flatMap((s) => s.cells))],
          dots: [...new Set(all.flatMap((s) => s.dots))],
          ghosts: moves,
        },
        apply: moves,
        applyLabel: "Apply move",
        laterLabel: "I'll draw it",
      });
    }
    case "mistake": {
      const line = edges[hint.edge] === EdgeState.Line;
      const others = hint.count - 1;
      const more =
        others > 0
          ? ` ${others} more ${plural(others, "mark doesn't", "marks don't")} fit either.`
          : "";
      return view({
        eyebrow: "check your marks",
        title: line ? "This line doesn't fit" : "This × doesn't fit",
        text:
          (line
            ? "The line between the two highlighted dots is not part of the solution."
            : "The loop needs the edge between the two highlighted dots.") + more,
        steps: [],
        rule: null,
        marks: { cells: [], dots: edgeDots(grid, hint.edge), ghosts: [] },
        apply: [[hint.edge, EdgeState.Unknown]],
        applyLabel: "Erase it",
        laterLabel: "I'll fix it",
      });
    }
    case "reveal": {
      const move: EdgeChange = [hint.edge, EdgeState.Line];
      return view({
        eyebrow: "from the solution",
        title: "No rule applies here",
        text: "None of the rules decides the next move from what is on the board, so here is one line of the solution.",
        steps: [],
        rule: null,
        marks: { cells: [], dots: edgeDots(grid, hint.edge), ghosts: [move] },
        apply: [move],
        applyLabel: "Apply move",
        laterLabel: "I'll draw it",
      });
    }
  }
}

/**
 * Whether a hint still applies to the board: false once the player has made its move, or has
 * changed one of its edges to something else (say, undone a mark it asked to erase). A move that
 * draws lines is made once its lines are: the crosses before them are the player's to skip.
 */
export function hintCurrent(view: HintView, edges: Uint8Array): boolean {
  const drawsLines = view.apply.some(([, target]) => target === EdgeState.Line);
  let done = true;
  for (let i = 0; i < view.apply.length; i++) {
    const [edge, target] = view.apply[i];
    const now = edges[edge];
    if (now === target) continue;
    if (now !== view.before[i]) return false;
    if (!drawsLines || target === EdgeState.Line) done = false;
  }
  return !done;
}

/**
 * The board area a hint's marks cover, in board pixels, with half a cell around them; a zoomed board
 * pans it into view. Null when there are no marks.
 */
export function hintRect(grid: Grid, layout: Layout, marks: HintMarks): Rect | null {
  const points: Point[] = [
    ...marks.cells.map((c) => cellPoint(grid, layout, c)),
    ...marks.dots.map((d) => dotPoint(grid, layout, d)),
    ...marks.ghosts.map(([e]) => edgeMidpoint(grid, layout, e)),
  ];
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const half = layout.cell / 2;
  const x = Math.min(...xs) - half;
  const y = Math.min(...ys) - half;
  return {
    x,
    y,
    width: Math.max(...xs) + half - x,
    height: Math.max(...ys) + half - y,
  };
}

/**
 * The puzzle's solution, worked out from its clues, for hints on puzzles that come with no server
 * (the built-in ones). Throws when the puzzle has no single solution.
 */
export function puzzleSolution(puzzle: Puzzle): Uint8Array {
  const result = verify(puzzle);
  if (result.status !== "unique") throw new Error(`No single solution (${result.status})`);
  return result.solutions[0];
}
