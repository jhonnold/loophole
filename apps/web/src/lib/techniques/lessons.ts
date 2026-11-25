import {
  decodeEdges,
  EdgeState,
  type Level,
  type Puzzle,
  parsePuzzle,
  type RuleId,
  ruleLevel,
} from "@loophole/core";
import type { HintMarks } from "../game/hint.ts";
import { pattern, RULE_PATTERNS, type RulePattern } from "../game/patterns.ts";

/** One picture of a technique, with the words a screen reader reads in its place. */
export interface Frame {
  readonly caption: string;
  readonly puzzle: Puzzle;
  readonly edges: Uint8Array;
  readonly marks: HintMarks;
  /** The frame shows a rule break on purpose: where a guess leads (lookahead). */
  readonly contradiction?: boolean;
}

/** A technique on the techniques page: one solver rule, walked through a frame at a time. */
export interface Lesson {
  readonly rule: RuleId;
  readonly level: Level;
  readonly frames: readonly Frame[];
}

const NO_MARKS: HintMarks = { cells: [], dots: [], ghosts: [] };

type Captions = readonly [setup: string, reason: string, move: string, applied: string];

/**
 * The four frames of a figure: the position, the reason washed, the move as ghosts, and the move
 * drawn in with the reason still washed.
 */
function frames(p: RulePattern, [setup, reason, move, applied]: Captions): Frame[] {
  const { puzzle, edges, marks } = p;
  const wash: HintMarks = { cells: marks.cells, dots: marks.dots, ghosts: [] };
  const done = new Uint8Array(edges);
  for (const [e, s] of marks.ghosts) done[e] = s;
  return [
    { caption: setup, puzzle, edges, marks: NO_MARKS },
    { caption: reason, puzzle, edges, marks: wash },
    { caption: move, puzzle, edges, marks },
    { caption: applied, puzzle, edges: done, marks: wash },
  ];
}

function lesson(rule: RuleId, captions: Captions, figure?: RulePattern): Lesson {
  const p = figure ?? RULE_PATTERNS[rule];
  if (p === undefined) throw new Error(`no figure for ${rule}`);
  return { rule, level: ruleLevel(rule), frames: frames(p, captions) };
}

// Figures of their own, where the hint card's small figure would not do as a whole board. The hint
// figures for the first three are a single cell, and those for the corner rules close the corner
// off inside a 2×2; on their own, neither board has a loop that fits, so here the clue sits in a
// bigger board. Unreachable's figure washes the cell it fences off (its hint washes nothing), and
// loop-complete has no hint figure.
const OWN = {
  "clue-zero": pattern(2, 2, "0...", (a) => ({
    cells: [0],
    ghostCrosses: [a.h(0, 0), a.v(0, 1), a.h(1, 0), a.v(0, 0)],
  })),
  "clue-satisfied": pattern(3, 2, ".1....", (a) => ({
    lines: [a.h(0, 1)],
    cells: [a.cell(0, 1)],
    ghostCrosses: [a.v(0, 1), a.v(0, 2), a.h(1, 1)],
  })),
  "clue-needs-all": pattern(3, 2, ".1....", (a) => ({
    crosses: [a.h(0, 1), a.v(0, 1), a.h(1, 1)],
    cells: [a.cell(0, 1)],
    ghostLines: [a.v(0, 2)],
  })),
  "corner-1": pattern(3, 3, "....1....", (a) => ({
    crosses: [a.v(0, 2), a.h(1, 2)],
    cells: [a.cell(1, 1)],
    dots: [a.dot(1, 2)],
    ghostCrosses: [a.h(1, 1), a.v(1, 2)],
  })),
  "corner-3": pattern(3, 3, "....3....", (a) => ({
    crosses: [a.v(0, 2), a.h(1, 2)],
    cells: [a.cell(1, 1)],
    dots: [a.dot(1, 2)],
    ghostLines: [a.h(1, 1), a.v(1, 2)],
  })),
  "loop-complete": pattern(2, 2, "3...", (a) => ({
    lines: [a.h(0, 0), a.h(0, 1), a.v(0, 0), a.v(0, 2), a.h(1, 0), a.h(1, 1)],
    cells: [a.cell(0, 0)],
    ghostCrosses: [a.v(0, 1), a.v(1, 0), a.v(1, 1), a.v(1, 2), a.h(2, 0), a.h(2, 1)],
  })),
  unreachable: pattern(3, 3, ".........", (a) => ({
    lines: [a.h(0, 0)],
    crosses: [a.v(1, 2), a.h(2, 1), a.v(1, 3), a.h(3, 1)],
    cells: [a.cell(2, 2)],
    ghostCrosses: [a.h(2, 2), a.v(2, 3), a.h(3, 2), a.v(2, 2)],
  })),
} as const;

/**
 * Lookahead, from a real position: the solver's first lookahead step on the 4×4 puzzle generated
 * with seed "la-44-150" (generator 6, hard). Supposing the top of the 2 were a line, the dot rules
 * alone run on until the middle 2 cannot get its second line.
 */
function lookahead(): Lesson {
  const puzzle = parsePuzzle({ v: 1, width: 4, height: 4, clues: ".2..12.33..2.1.." });
  const at = (text: string) => decodeEdges(puzzle.grid, text);
  const before = at("1020200021001200221010000120001100022100");
  const supposed = at("1120200021001200221010000120001100022100");
  const after = at("1120220021001200221012100122001100022100");
  const done = at("1220200021001200221010000120001100022100");
  // Edge 1 is the top of the 2 in the top row; dots 1 and 2 are its ends, cell 5 the middle 2.
  const edge = 1;
  const ends = [1, 2];
  const two = 5;
  return {
    rule: "lookahead",
    level: ruleLevel("lookahead"),
    frames: [
      {
        caption: "Nothing simpler settles the top edge of this 2. When you're stuck, try a move.",
        puzzle,
        edges: before,
        marks: { cells: [], dots: ends, ghosts: [] },
      },
      {
        caption: "Suppose the edge were a line.",
        puzzle,
        edges: supposed,
        marks: { cells: [], dots: ends, ghosts: [] },
      },
      {
        caption:
          "Then the easy dot rules run on by themselves, until the 2 in the middle has one line and nothing open: it can't get its second.",
        puzzle,
        edges: after,
        marks: { cells: [two], dots: [], ghosts: [] },
        contradiction: true,
      },
      {
        caption: "The guess leads to a broken rule, so the edge can't be a line: it is crossed.",
        puzzle,
        edges: before,
        marks: { cells: [two], dots: ends, ghosts: [[edge, EdgeState.Cross]] },
      },
      {
        caption: "Try only what quickly breaks a rule; if nothing breaks, undo and look elsewhere.",
        puzzle,
        edges: done,
        marks: { cells: [two], dots: ends, ghosts: [] },
      },
    ],
  };
}

/** Every rule the solver uses, easiest first: the order of the techniques page. */
export const LESSONS: readonly Lesson[] = [
  // Easy: what every easy puzzle needs.
  lesson(
    "clue-zero",
    [
      "A 0 in the corner of the board.",
      "A 0 means none of its four sides is part of the loop.",
      "So all four sides get a ×.",
      "Cross out the sides of every 0 first: it's the easiest move there is.",
    ],
    OWN["clue-zero"],
  ),
  lesson(
    "clue-satisfied",
    [
      "This 1 already has a line along its top.",
      "A 1 takes exactly one line, and it has it.",
      "So its other three sides are crossed.",
      "Whenever a number has all its lines, cross off the rest of its sides.",
    ],
    OWN["clue-satisfied"],
  ),
  lesson(
    "clue-needs-all",
    [
      "Three sides of this 1 are crossed.",
      "It still needs one line, and only one side is left open.",
      "So that side must be a line.",
      "When a number needs every side it has left, draw them all.",
    ],
    OWN["clue-needs-all"],
  ),
  lesson("dot-full", [
    "Two lines meet at the middle dot.",
    "The loop passes through a dot at most once, so a dot never has more than two lines.",
    "So the dot's other two edges are crossed.",
    "A dot has either no lines or exactly two.",
  ]),
  lesson("dot-dead-end", [
    "Three edges around the middle dot are crossed.",
    "A line on the last edge would stop here, with nowhere to go.",
    "So the last edge is crossed too.",
    "A dot with no line and only one open edge is a dead end.",
  ]),
  lesson("dot-continue", [
    "A line comes down into the middle dot, and two of its other edges are crossed.",
    "The loop can't stop at a dot, and only one way out is left.",
    "So the line goes on through it.",
    "Follow the end of a line: when it has one way left, draw it.",
  ]),
  lesson("premature-loop", [
    "One line bends around the left cell; another runs down the right edge.",
    "The highlighted dots are the two ends of the same line.",
    "Joining them would close a loop and leave the other line out of it, so the edge is crossed.",
    "There is only one loop: never close it while other lines or numbers still need it.",
  ]),
  lesson(
    "corner-1",
    [
      "A 1, with both edges leading away from its top-right corner crossed.",
      "A line on either of its sides at that corner could only turn onto the other.",
      "That would give the 1 two lines, so both sides at the corner are crossed.",
      "The board's edge closes corners off too: a 1 in a corner of the board has both sides there crossed.",
    ],
    OWN["corner-1"],
  ),
  lesson(
    "corner-3",
    [
      "A 3, with both edges leading away from its top-right corner crossed.",
      "A 3 leaves just one side empty, so it uses at least one side at that corner.",
      "A line there can only turn onto the other side, so both are lines.",
      "A 3 in a corner of the board always has both sides there drawn.",
    ],
    OWN["corner-3"],
  ),
  lesson("adjacent-3s", [
    "Two 3s side by side.",
    "Try both ways for the side they share: drawn or empty.",
    "Either way the outer sides are lines, and the edges that carry on from the shared side are crossed.",
    "Look for 3s side by side early: they give lines straight away.",
  ]),
  lesson("diagonal-3s", [
    "Two 3s touching at a corner.",
    "If a 3's far side were empty, both its sides at the shared dot would be lines, and the other 3 would add a third.",
    "A dot can't take three lines, so the far sides of both 3s are lines.",
    "3s on a diagonal always have their outer corners drawn.",
  ]),
  lesson(
    "loop-complete",
    [
      "The line has closed into a loop.",
      "There is only one loop, and every number has its lines.",
      "Nothing else can be on the loop, so every other edge is crossed.",
      "The puzzle is solved.",
    ],
    OWN["loop-complete"],
  ),
  // Medium: corners of clues, and inside and outside.
  lesson("line-into-1", [
    "A line comes down to the top-right corner of a 1, and the way on to the right is crossed.",
    "The line has to turn onto one of the 1's two sides at that corner.",
    "That is the 1's only line, so its far sides, left and bottom, are crossed.",
    "A line that reaches a corner of a 1 uses the 1 up there.",
  ]),
  lesson("line-into-3", [
    "A line comes down to the top-right corner of a 3.",
    "Going on to the right would leave the 3 without either side at that corner: two lines at most.",
    "So it turns onto one of the 3's sides, its one empty side is at that corner, and its far sides are lines.",
    "A line that reaches a corner of a 3 means the opposite corner is drawn.",
  ]),
  lesson("ones-side-by-side", [
    "Two 1s side by side on the top border.",
    "A line on their shared side would have to turn along the top of one of them at the border.",
    "That 1 would have two lines, so the shared side is crossed.",
    "Two 1s side by side at the border never share a line.",
  ]),
  lesson("three-diagonal-one", [
    "A 3 and a 1 touching at a corner, with the 1's far sides crossed.",
    "The 1's line is on its top or its left, both at the dot it shares with the 3.",
    "So the loop uses just one of the 3's sides at that dot; its empty side is there and its far sides are lines.",
    "A 1 can show which way the loop goes past a 3.",
  ]),
  lesson("two-in-corner", [
    "A 2 in the corner of the board.",
    "At the board's corner, it uses both of its sides or neither.",
    "Either way, the loop leaves it along the border, so the border edges beside it are lines.",
    "Every 2 in a corner of the board gets these two lines.",
  ]),
  lesson("two-passes-on", [
    "A line comes down into the 2's top-left corner and can't go left.",
    "It has to turn onto a side of the 2, so the 2 uses exactly one side at that corner.",
    "Then it uses one side at the opposite corner too, so the loop passes through there, and the only way on is right.",
    "What holds at one corner of a 2 carries over to the opposite one.",
  ]),
  lesson("corner-chain", [
    "A 1 and a 3 side by side on the top border.",
    "If the 3's top were empty, its other three sides would be lines, the shared one too.",
    "The shared side would have to turn along the 1's top: two lines for the 1. So the 3's top is a line.",
    "Facts about clue corners chain from clue to clue; follow them a step at a time.",
  ]),
  lesson("parity", [
    "Two cells: the left one's outer side is crossed, the right one's is a line.",
    "Beyond the board is outside the loop. A × keeps neighbours on the same side; a line puts them on opposite sides.",
    "So the left cell is outside and the right one inside, and the edge between them is a line.",
    "Keep track of which cells are inside: an edge between cells on different sides is a line.",
  ]),
  // Hard: everything else, up to trying a move and seeing it fail.
  lesson("colour-1", [
    "A 1 in the middle, with crosses on the outer sides of the cells above and below it.",
    "So both those cells are outside. Just one cell beside a 1 is on the other side of the loop from it.",
    "If the 1 were inside, both would differ from it. So it's outside, and both edges between are crossed.",
    "Inside and outside settle edges that no line reaches yet.",
  ]),
  lesson("colour-2", [
    "A 2 in the middle; the cells to its left and right have crossed outer sides.",
    "So both are outside. Exactly two cells beside a 2 are on the other side of the loop from it.",
    "Inside or out, that puts the cells above and below it inside, so their border sides are lines.",
    "A 2 between two cells on the same side has its other two neighbours on the opposite side.",
  ]),
  lesson("colour-3", [
    "A 3 in the middle, with crosses on the outer sides of the cells above and below it.",
    "So both are outside. Just one cell beside a 3 is on the same side of the loop as it.",
    "If the 3 were outside, both would match it. So it's inside, and both edges between are lines.",
    "The same idea as for a 1, the other way round.",
  ]),
  lesson("colour-chain", [
    "Two 3s with their outer corners drawn, a 2 between them, and another 2 on the right.",
    "The 3s are inside. The left 2 has inside cells above and below it and the outside on its left.",
    "That puts the middle cell outside. The right 2 then sits between two outside cells, so the cells above and below it are inside: the top-right edge is a line.",
    "Inside and outside pass from clue to clue; follow the chain.",
  ]),
  lesson(
    "unreachable",
    [
      "A line at the top, and crosses fencing off the bottom-right cell.",
      "The open edges around that cell join nothing else on the board.",
      "The loop can't get to them from its line, so they are all crossed.",
      "There is only one loop: edges it can't reach are out.",
    ],
    OWN.unreachable,
  ),
  lesson("cut-off", [
    "A line at the top; the bottom-right cell is fenced off except at the middle dot.",
    "A loop around that cell would go in and come back out through the same dot.",
    "The loop passes a dot only once, and the line at the top needs it, so the cell's edges are crossed.",
    "Look for parts of the board joined to the rest at a single dot.",
  ]),
  lesson("two-exits", [
    "A line at the top and one at the bottom; the middle row's outer sides are crossed.",
    "The loop has to join the two lines, and only two edges lead from the top half to the bottom.",
    "It has to cross there and back, so both edges are lines.",
    "When just two ways lead between two parts that both need the loop, use them both.",
  ]),
  lookahead(),
];
