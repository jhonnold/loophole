import { type Deduction, EdgeState, type Grid, NO_CLUE, NONE, type SideFact } from "@loophole/core";

/**
 * How a hint tints a cell it places (design kit, Board): inside or outside the loop when its chain
 * reaches the board's edge, otherwise one of two relative sides, `a` or `b`. `out` and `b` are
 * hatched, so the two sides differ by more than colour. `strong` marks the cells the step is about
 * (its clue, the cells by its edge, the neighbours its facts name); the cells along a chain are
 * tinted lighter.
 */
export type SideTone = "in" | "out" | "a" | "b";

export interface SideTint {
  readonly cell: number;
  readonly tone: SideTone;
  readonly strong: boolean;
}

/** A step's side proof as the board draws it: tinted cells and the marks the chains run along. */
export interface SideMarks {
  readonly cells: readonly SideTint[];
  readonly edges: readonly number[];
}

/** Whether a tone is drawn hatched. */
export function hatched(tone: SideTone): boolean {
  return tone === "out" || tone === "b";
}

/**
 * Whether a hatched tone runs the other way: `b` slants down to the right, `out` up to the right,
 * so the two differ by more than colour when both show.
 */
export function mirrored(tone: SideTone): boolean {
  return tone === "b";
}

/** The tints and chain marks for a step with a side proof, or undefined. */
export function sideMarks(grid: Grid, step: Deduction): SideMarks | undefined {
  const proof = step.sides;
  if (proof === undefined) return undefined;
  const strong = new Set<number>(step.cells);
  for (const f of [...proof.known, ...proof.forced]) {
    strong.add(f.a);
    strong.add(f.b);
  }
  for (const c of step.changes.slice(0, 1)) {
    strong.add(grid.edgeCells[c.edge * 2]);
    strong.add(grid.edgeCells[c.edge * 2 + 1]);
  }
  return {
    cells: proof.cells.map(({ cell, group, flip }) => ({
      cell,
      tone: group === 0 ? (flip ? "in" : "out") : flip ? "b" : "a",
      strong: strong.has(cell),
    })),
    edges: [...proof.edges],
  };
}

const SIDE_NAME = ["top", "right", "bottom", "left"];
const DIRECTION = ["above", "to the right", "below", "to the left"];

/** The cell across side `j` of cell `i`, or NONE off the board. */
function across(grid: Grid, i: number, j: number): number {
  const e = grid.cellEdges[i * 4 + j];
  const a = grid.edgeCells[e * 2];
  return a === i ? grid.edgeCells[e * 2 + 1] : a;
}

/** Joins phrases as "a", "a and b", "a, b and c"; "the cell above and the cell below" as "the cells above and below". */
function list(parts: readonly string[]): string {
  const cells = parts.length > 1 && parts.every((p) => p.startsWith("the cell "));
  const words = cells ? parts.map((p) => p.slice("the cell ".length)) : parts;
  const joined =
    words.length < 2
      ? words.join("")
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return cells ? `the cells ${joined}` : joined;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MARKS = "a × keeps the side, a line switches it";

/**
 * What a step with a side proof says, in concrete words, a page each, or null to use the rule's
 * own text. A parity step has one page. A colouring step resting on one clue has two: what the
 * marks show about the clue's neighbours, then what the clue makes of it (one, when nothing was
 * known but the board's edge).
 */
export function sideTexts(grid: Grid, clues: ArrayLike<number>, step: Deduction): string[] | null {
  const proof = step.sides;
  if (proof === undefined || step.changes.length === 0) return null;
  const side = new Map(proof.cells.map((c) => [c.cell, c]));
  const { edge, state } = step.changes[0];
  const decided = state === EdgeState.Line ? "a line" : "crossed";
  const inOut = (v: number) => (side.get(v)?.flip ? "inside" : "outside");
  const placed = (v: number) => v === NONE || side.get(v)?.group === 0;

  if (step.rule === "parity") {
    const cells = [grid.edgeCells[edge * 2], grid.edgeCells[edge * 2 + 1]].filter(
      (c) => c !== NONE,
    );
    if (cells.every(placed)) {
      const sides = cells.map(inOut);
      const where =
        sides.length === 1
          ? `The cell by the marked edge is ${sides[0]}`
          : sides[0] === sides[1]
            ? `Both cells by the marked edge are ${sides[0]}`
            : "One cell by the marked edge is inside, one outside";
      return [`Off the board is outside; ${MARKS}. ${where}: ${decided}.`];
    }
    const where = state === EdgeState.Line ? "opposite sides" : "the same side";
    return [`${capital(MARKS)}, so the cells by the marked edge are on ${where}: ${decided}.`];
  }

  // One clue's relation, worked out from facts about its own cell and neighbours.
  if (proof.forced.length !== 1) return null;
  const forced = proof.forced[0];
  const clue = forced.clue;
  const k = clues[clue];
  if (k !== 1 && k !== 2 && k !== 3) return null;
  const around = [0, 1, 2, 3].map((j) => across(grid, clue, j));
  const name = (v: number): string | null => {
    if (v === clue) return `this ${k}`;
    if (v === NONE) return "off the board";
    const j = around.indexOf(v);
    if (j < 0) return null;
    const c = clues[v];
    return c !== NO_CLUE ? `the ${c} ${DIRECTION[j]}` : `the cell ${DIRECTION[j]}`;
  };
  const facts = proof.known.filter((f) => f.a !== f.b);
  const nodes = [...facts.flatMap((f) => [f.a, f.b]), forced.a, forced.b];
  if (nodes.some((v) => name(v) === null)) return null;

  // What was known: the cells linked off the board as in or out, the rest relative to each other.
  const ins: string[] = [];
  const outs: string[] = [];
  const withClue: string[] = [];
  const againstClue: string[] = [];
  const pairs: string[] = [];
  const stated = new Set<number>();
  for (const f of facts) {
    if (placed(f.a) && placed(f.b)) {
      for (const v of [f.a, f.b]) {
        if (v === NONE || stated.has(v)) continue;
        stated.add(v);
        (side.get(v)?.flip ? ins : outs).push(name(v) as string);
      }
    } else if (f.a === clue || f.b === clue) {
      (f.same ? withClue : againstClue).push(name(f.a === clue ? f.b : f.a) as string);
    } else {
      pairs.push(
        `${name(f.a)} and ${name(f.b)} are on ${f.same ? "the same side" : "opposite sides"}`,
      );
    }
  }
  const are = (names: string[], where: string) =>
    `${list(names)} ${names.length > 1 ? "are" : "is"} ${where}`;
  if (withClue.length > 0) pairs.unshift(are(withClue, `on this ${k}'s side`));
  if (againstClue.length > 0) pairs.unshift(are(againstClue, `on the other side from this ${k}`));
  const placedText =
    ins.length > 0 && outs.length > 0
      ? `${are(ins, "inside")}, ${list(outs)} outside`
      : ins.length > 0
        ? are(ins, "inside")
        : outs.length > 0
          ? are(outs, "outside")
          : "";
  const told = [placedText, ...pairs].filter((t) => t !== "");
  const rule =
    k === 1
      ? "A 1 has one neighbour on the other side"
      : k === 2
        ? "A 2 has two neighbours on each side"
        : "A 3 has one neighbour on its side";
  const j = grid.cellEdges.slice(clue * 4, clue * 4 + 4).indexOf(edge);
  const end =
    j >= 0 ? `: its ${SIDE_NAME[j]} side is ${decided}` : `: the marked edge is ${decided}`;
  const conclusion = `${rule}, so ${relation(forced, clue, name)}${end}.`;
  if (told.length === 0) return [conclusion];
  const from = placedText === "" ? capital(MARKS) : `Off the board is outside; ${MARKS}`;
  return [`${from}. ${capital(told.join("; "))}.`, capital(conclusion)];
}

/** The relation a clue forced, in words: relative to the clue when it names the clue. */
function relation(f: SideFact, clue: number, name: (v: number) => string | null): string {
  if (f.a === NONE || f.b === NONE) {
    const v = f.a === NONE ? f.b : f.a;
    return `${name(v)} is ${f.same ? "outside" : "inside"}`;
  }
  const other = f.a === clue ? f.b : f.b === clue ? f.a : null;
  if (other === null) {
    return `${name(f.a)} and ${name(f.b)} are on ${f.same ? "the same side" : "opposite sides"}`;
  }
  return `${name(other)} is on ${f.same ? "its side" : "the other side"}`;
}

/**
 * The hatching of a square cell tint: segments of lines running up to the right, `gap` apart, cut
 * to the square at (`x`, `y`) with side `s`. Both renderers draw these, so they match.
 */
export function hatchSegments(
  x: number,
  y: number,
  s: number,
  gap: number,
  mirror = false,
): number[][] {
  const out: number[][] = [];
  for (let t = gap; t < 2 * s; t += gap) {
    // The line x' + y' = t inside the square, measured from its top-left corner; mirrored, x' runs
    // from the right.
    const x1 = Math.max(0, t - s);
    const x2 = Math.min(s, t);
    const at = (dx: number) => (mirror ? x + s - dx : x + dx);
    out.push([at(x1), y + t - x1, at(x2), y + t - x2]);
  }
  return out;
}

/** The square a tint covers in a cell of size `s` centred at (`x`, `y`): full, or smaller when light. */
export function tintSquare(
  x: number,
  y: number,
  s: number,
  strong: boolean,
): { x: number; y: number; size: number } {
  const inset = strong ? 2 : s * 0.24;
  return { x: x - s / 2 + inset, y: y - s / 2 + inset, size: s - 2 * inset };
}
