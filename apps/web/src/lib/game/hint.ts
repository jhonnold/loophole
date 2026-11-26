import {
  CONTRADICTION_TEXT,
  EdgeState,
  type Grid,
  type Hint,
  type Probe,
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
  /**
   * A try-and-see hint's supposed marks: a dotted, fainter ai line or ×, on edges still empty. They
   * are never part of the move.
   */
  readonly whatIf?: readonly EdgeChange[];
  /** Where the supposed marks break the rules: a shu wash on these cells, dots and edges. */
  readonly conflict?: ConflictMarks;
}

export interface ConflictMarks {
  readonly cells: readonly number[];
  readonly dots: readonly number[];
  readonly edges: readonly number[];
}

/** One page of a hint card: a step's words and what the board shows while it is on show. */
export interface HintPage {
  readonly title: string;
  readonly text: string;
  /** The rule whose pattern the card draws, or null for a mistake or a revealed line. */
  readonly rule: RuleId | null;
  readonly marks: HintMarks;
}

/** A hint ready to show: the card's pages, the board marks and the move "Apply" makes. */
export interface HintView {
  /** The small line above the title, e.g. "next forced move". */
  readonly eyebrow: string;
  /**
   * What the card shows, one page at a time. A step hint has a page for each step, the crosses its
   * line rests on first and the line last; on each, the board washes that step's cells and dots and
   * ghosts every change up to it. A try-and-see step's page comes after pages that suppose the other
   * choice, follow the moves it forces and show where they break the rules. Other hints have one
   * page.
   */
  readonly pages: readonly HintPage[];
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

/**
 * Turns a core hint into what the card and the board show. Null when the board is solved. A step
 * hint's move is its line and the crosses before it, made together from any page.
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
      const moves: EdgeChange[] = [];
      const pages: HintPage[] = [];
      for (const s of [...hint.before, hint.step]) {
        if (s.probe !== undefined) pages.push(...probePages(grid, s.probe, moves));
        moves.push(...s.changes.map((c): EdgeChange => [c.edge, c.state]));
        pages.push({
          title: RULE_TITLE[s.rule],
          text: s.probe === undefined ? RULE_TEXT[s.rule] : concludeText(s),
          rule: s.rule,
          marks: { cells: [...s.cells], dots: [...s.dots], ghosts: [...moves] },
        });
      }
      return view({
        eyebrow: "next forced move",
        pages,
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
        pages: [
          {
            title: line ? "This line doesn't fit" : "This × doesn't fit",
            text:
              (line
                ? "The line between the two highlighted dots is not part of the solution."
                : "The loop needs the edge between the two highlighted dots.") + more,
            rule: null,
            marks: { cells: [], dots: edgeDots(grid, hint.edge), ghosts: [] },
          },
        ],
        apply: [[hint.edge, EdgeState.Unknown]],
        applyLabel: "Erase it",
        laterLabel: "I'll fix it",
      });
    }
    case "reveal": {
      const move: EdgeChange = [hint.edge, EdgeState.Line];
      return view({
        eyebrow: "from the solution",
        pages: [
          {
            title: "No rule applies here",
            text: "None of the rules decides the next move from what is on the board, so here is one line of the solution.",
            rule: null,
            marks: { cells: [], dots: edgeDots(grid, hint.edge), ghosts: [move] },
          },
        ],
        apply: [move],
        applyLabel: "Apply move",
        laterLabel: "I'll draw it",
      });
    }
  }
}

/**
 * The pages a try-and-see step shows before its own: the supposed mark on its edge, each move that
 * follows from it, and where they break the rules. The real moves so far (`moves`) stay ghosted
 * under the supposed ones, which build up from page to page.
 */
function probePages(grid: Grid, probe: Probe, moves: readonly EdgeChange[]): HintPage[] {
  const ghosts = [...moves];
  const { edge, state } = probe.assumed;
  const line = state === EdgeState.Line;
  const whatIf: EdgeChange[] = [[edge, state]];
  const pages: HintPage[] = [
    {
      title: line ? "Suppose it's a line" : "Suppose it's crossed",
      text: `Nothing simpler settles this edge, so suppose it were ${line ? "a line" : "crossed"} and follow what that forces.`,
      rule: "lookahead",
      marks: { cells: [], dots: edgeDots(grid, edge), ghosts, whatIf: [...whatIf] },
    },
  ];
  for (const d of probe.steps) {
    whatIf.push(...d.changes.map((c): EdgeChange => [c.edge, c.state]));
    pages.push({
      title: `Then: ${RULE_TITLE[d.rule]}`,
      text: RULE_TEXT[d.rule],
      rule: d.rule,
      marks: { cells: [...d.cells], dots: [...d.dots], ghosts, whatIf: [...whatIf] },
    });
  }
  const x = probe.contradiction;
  pages.push({
    title: "That can't be",
    text: CONTRADICTION_TEXT[x.kind],
    rule: "lookahead",
    marks: {
      cells: [],
      dots: [],
      ghosts,
      whatIf,
      conflict: {
        cells: [...x.cells],
        dots: [...x.dots],
        edges: x.edge === null ? [...x.edges] : [...new Set([...x.edges, x.edge])],
      },
    },
  });
  return pages;
}

/** The last page of a try-and-see step: the supposition broke the rules, so here is the move. */
function concludeText(step: Step): string {
  return step.changes.some((c) => c.state === EdgeState.Line)
    ? "Crossing this edge breaks the rules, so it must be a line."
    : "Drawing this edge breaks the rules, so it must be crossed.";
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
  const conflict = marks.conflict;
  const points: Point[] = [
    ...marks.cells.map((c) => cellPoint(grid, layout, c)),
    ...marks.dots.map((d) => dotPoint(grid, layout, d)),
    ...marks.ghosts.map(([e]) => edgeMidpoint(grid, layout, e)),
    ...(marks.whatIf ?? []).map(([e]) => edgeMidpoint(grid, layout, e)),
    ...(conflict?.cells ?? []).map((c) => cellPoint(grid, layout, c)),
    ...(conflict?.dots ?? []).map((d) => dotPoint(grid, layout, d)),
    ...(conflict?.edges ?? []).map((e) => edgeMidpoint(grid, layout, e)),
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
