import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { countSolutions } from "./bruteforce.ts";
import { decodeEdges, parsePuzzle } from "./format.ts";
import { generate } from "./generate.ts";
import { EdgeState, type Grid, hEdgeIndex } from "./grid.ts";
import { findHint } from "./hint.ts";
import { LEVEL_SETTINGS, lookaheadBudget } from "./level.ts";
import { NO_CLUE, type Puzzle } from "./puzzle.ts";
import type { Deduction, Probe, RuleId, Step } from "./rules.ts";
import { solve } from "./solver.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { levelRuleIds } from "./test-support/levels.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

/**
 * Takes every hint from an empty board to the end, applying each whole: the rules its steps named,
 * and the reveals.
 */
function hintWalk(p: Puzzle, solution: Uint8Array): { rules: Set<RuleId>; reveals: number } {
  const board = new Uint8Array(p.grid.edgeCount);
  const rules = new Set<RuleId>();
  let reveals = 0;
  // Each hint decides at least one edge; the cap turns a regression into a failure, not a hang.
  for (let n = 0; n <= p.grid.edgeCount; n++) {
    const hint = findHint(p, solution, board);
    if (hint.kind === "solved") return { rules, reveals };
    if (hint.kind === "step") {
      for (const step of [...hint.before, hint.step]) {
        rules.add(step.rule);
        for (const { edge, state } of step.changes) board[edge] = state;
      }
    } else if (hint.kind === "reveal") {
      reveals++;
      board[hint.edge] = EdgeState.Line;
    } else {
      throw new Error(`unexpected ${hint.kind}`);
    }
  }
  throw new Error("the hints did not reach the solution");
}

describe("findHint", () => {
  test("names the first line from an empty board and the crosses it rests on", () => {
    // 2×2 with a 0 in the top-left cell: the 0's four sides are crossed, which leaves two dots with
    // one open edge each, crossed too (and so are two more); lookahead then draws the first line.
    const p = puzzle(2, 2, "0...");
    const solution = decodeEdges(p.grid, "222121222211");
    const hint = findHint(p, solution, new Uint8Array(p.grid.edgeCount));
    expect(hint).toEqual({
      kind: "step",
      step: {
        rule: "lookahead",
        changes: [{ edge: 3, state: EdgeState.Line }],
        cells: [],
        dots: [4, 5],
        // Crossed, the edge leaves the dots around it dead ends, and no line is left anywhere.
        probe: {
          assumed: { edge: 3, state: EdgeState.Cross },
          steps: [
            {
              rule: "dot-dead-end",
              changes: [{ edge: 10, state: EdgeState.Cross }],
              cells: [],
              dots: [4],
            },
            {
              rule: "dot-dead-end",
              changes: [{ edge: 11, state: EdgeState.Cross }],
              cells: [],
              dots: [5],
            },
            {
              rule: "dot-dead-end",
              changes: [{ edge: 5, state: EdgeState.Cross }],
              cells: [],
              dots: [7],
            },
          ],
          contradiction: { kind: "no-loop", edge: null, cells: [], dots: [], edges: [] },
        },
      },
      before: [
        {
          rule: "clue-zero",
          changes: [
            { edge: 0, state: EdgeState.Cross },
            { edge: 7, state: EdgeState.Cross },
            { edge: 2, state: EdgeState.Cross },
            { edge: 6, state: EdgeState.Cross },
          ],
          cells: [0],
          dots: [],
        },
        {
          rule: "dot-dead-end",
          changes: [{ edge: 1, state: EdgeState.Cross }],
          cells: [],
          dots: [1],
        },
        {
          rule: "dot-dead-end",
          changes: [{ edge: 8, state: EdgeState.Cross }],
          cells: [],
          dots: [2],
        },
        // The probe ends with no line anywhere, which rests on every cross, these two included.
        {
          rule: "dot-dead-end",
          changes: [{ edge: 9, state: EdgeState.Cross }],
          cells: [],
          dots: [3],
        },
        {
          rule: "dot-dead-end",
          changes: [{ edge: 4, state: EdgeState.Cross }],
          cells: [],
          dots: [6],
        },
      ],
    });
  });

  test("starts from the player's marks", () => {
    // Same puzzle with the 0's sides already crossed: the next step is a different rule.
    const p = puzzle(2, 2, "0...");
    const solution = decodeEdges(p.grid, "222121222211");
    const board = decodeEdges(p.grid, "202000220000");
    const hint = findHint(p, solution, board);
    expect(hint.kind).toBe("step");
    if (hint.kind !== "step") return;
    expect(hint.before.map((s) => s.rule)).not.toContain("clue-zero");
    for (const { edge, state } of hint.step.changes) {
      expect(board[edge]).toBe(EdgeState.Unknown);
      expect(solution[edge]).toBe(state);
    }
  });

  test("leaves out the crosses of a clue that is already complete", () => {
    // Small-7 (a web fixture), replayed to the first board where the solver's next step only
    // crosses the open side of a clue that already has its lines. That is no hint: it leads to the
    // next line instead, and the clue's cross is not among the steps it rests on.
    const p = puzzle(7, 7, ".11..0..23.2......2.21.0....1....01.1..3..0..1..1");
    const full = solve(p);
    const board = new Uint8Array(p.grid.edgeCount);
    for (const step of full.steps) {
      const next = solve(p, { initial: board, maxSteps: 1 }).steps[0];
      if (next.rule === "clue-satisfied") {
        const hint = findHint(p, full.edges, board);
        expect(hint.kind).toBe("step");
        if (hint.kind !== "step") return;
        expect(hint.step.changes.some((c) => c.state === EdgeState.Line)).toBe(true);
        const crossed = new Set(next.changes.map((c) => c.edge));
        for (const s of [...hint.before, hint.step]) {
          expect(s.changes.some((c) => crossed.has(c.edge))).toBe(false);
        }
        return;
      }
      for (const c of step.changes) board[c.edge] = c.state;
    }
    throw new Error("small-7 never has a complete clue with an open side");
  });

  test("reports the first wrong mark and how many there are", () => {
    // 2×2 all 2s; its only loop runs around the outside.
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    const board = new Uint8Array(p.grid.edgeCount);
    board[0] = EdgeState.Cross; // a line in the solution
    board[2] = EdgeState.Line; // a cross in the solution
    board[1] = EdgeState.Line; // right
    expect(findHint(p, solution, board)).toEqual({ kind: "mistake", edge: 0, count: 2 });
  });

  test("says when the board is already solved, crosses or not", () => {
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    expect(findHint(p, solution, solution)).toEqual({ kind: "solved" });
    const linesOnly = solution.map((s) => (s === EdgeState.Line ? s : EdgeState.Unknown));
    expect(findHint(p, solution, linesOnly)).toEqual({ kind: "solved" });
  });

  test("reveals a line of the solution when no rule applies, extending the player's line", () => {
    // 3×3 with no clues: no rule decides anything. The solution is the outer ring.
    const p = puzzle(3, 3, ".........");
    const solution = decodeEdges(p.grid, "111222222111122112211221");
    const empty = new Uint8Array(p.grid.edgeCount);
    expect(findHint(p, solution, empty)).toEqual({ kind: "reveal", edge: 0 });
    // A line on the bottom edge: the reveal continues it rather than starting at the top.
    const board = empty.slice();
    board[hEdgeIndex(p.grid, 3, 1)] = EdgeState.Line;
    expect(findHint(p, solution, board)).toEqual({
      kind: "reveal",
      edge: hEdgeIndex(p.grid, 3, 0),
    });
  });

  test("reveals a line instead when the time limit stops the search for a deduction", () => {
    // Small-7 (a web fixture): replay its solver steps up to its first lookahead, which only comes
    // after the time-checked tiers. With a clock already past the limit the hint is a reveal.
    const p = puzzle(7, 7, ".11..0..23.2......2.21.0....1....01.1..3..0..1..1");
    const full = solve(p);
    const board = new Uint8Array(p.grid.edgeCount);
    for (const step of full.steps) {
      if (step.rule === "lookahead") break;
      for (const c of step.changes) board[c.edge] = c.state;
    }
    const hint = findHint(p, full.edges, board);
    expect(
      hint.kind === "step" && [...hint.before, hint.step].some((s) => s.rule === "lookahead"),
    ).toBe(true);
    let t = 0;
    const late = findHint(p, full.edges, board, { timeLimitMs: 500, now: () => (t += 1000) });
    expect(late.kind).toBe("reveal");
  });

  test("uses only the rules of the puzzle's level", () => {
    // The default level's 10×10 "level-1" puzzle needs corner rules and lookahead. Labelled easy,
    // its hints may use only the rules every level has, and reveal lines where those get stuck.
    const { puzzle: hard, solution } = generate({ width: 10, height: 10, seed: "level-1" });
    const easy = levelRuleIds("easy");
    const fromHard = hintWalk(hard, solution);
    expect(fromHard.reveals).toBe(0);
    expect(fromHard.rules.has("lookahead")).toBe(true);
    expect([...fromHard.rules].some((rule) => rule !== "lookahead" && !easy.has(rule))).toBe(true);
    const labelled = { ...hard, meta: { ...hard.meta, level: "easy" } };
    const fromLabelled = hintWalk(labelled, solution);
    expect([...fromLabelled.rules].filter((rule) => !easy.has(rule))).toEqual([]);
    expect(fromLabelled.reveals).toBeGreaterThan(0);
  });

  test("an easy or medium puzzle's hints reach the solution with its own rules", () => {
    for (const level of ["easy", "medium"] as const) {
      const { puzzle: p, solution } = generate({ width: 10, height: 10, seed: "hints", level });
      const walk = hintWalk(p, solution);
      expect(walk.reveals).toBe(0);
      const allowed = levelRuleIds(level);
      expect([...walk.rules].filter((rule) => !allowed.has(rule))).toEqual([]);
    }
  });

  test("rejects boards of the wrong size", () => {
    const p = puzzle(2, 2, "2222");
    expect(() => findHint(p, new Uint8Array(12), new Uint8Array(3))).toThrow(RangeError);
  });

  test("every hint agrees with the solution (property)", () => {
    fc.assert(
      fc.property(
        arbPuzzleWithSolution(4, 4),
        fc.boolean(),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 40, maxLength: 40 }),
        ({ puzzle: p, solution }, withMistakes, picks) => {
          // A puzzle with several solutions has no mistake relative to one of them (a board can be
          // another valid solution), so the oracle only holds for puzzles with exactly one.
          if (countSolutions(p, 2) !== 1) return;
          // Per edge: 0-5 left open, 6-8 copied from the solution, 9 wrong (or open without mistakes).
          const board = new Uint8Array(p.grid.edgeCount);
          let wrong = 0;
          for (let e = 0; e < board.length; e++) {
            const pick = picks[e % picks.length];
            if (pick >= 6 && pick <= 8) board[e] = solution[e];
            else if (pick === 9 && withMistakes) {
              board[e] = solution[e] === EdgeState.Line ? EdgeState.Cross : EdgeState.Line;
              wrong++;
            }
          }
          const hint = findHint(p, solution, board);
          if (wrong > 0) {
            expect(hint.kind).toBe("mistake");
            if (hint.kind !== "mistake") return;
            expect(hint.count).toBe(wrong);
            expect(board[hint.edge]).not.toBe(solution[hint.edge]);
            return;
          }
          if (hint.kind === "solved") {
            expect(analyzeBoard(p, board).solved).toBe(true);
          } else if (hint.kind === "step") {
            // Crosses first, ending in a line; each edge open on the board and set once.
            const seen = new Set<number>();
            for (const step of [...hint.before, hint.step]) {
              for (const { edge, state } of step.changes) {
                expect(board[edge]).toBe(EdgeState.Unknown);
                expect(solution[edge]).toBe(state);
                expect(seen.has(edge)).toBe(false);
                seen.add(edge);
              }
            }
            for (const step of hint.before) {
              expect(step.changes.every((c) => c.state === EdgeState.Cross)).toBe(true);
            }
            expect(hint.step.changes.some((c) => c.state === EdgeState.Line)).toBe(true);
          } else if (hint.kind === "reveal") {
            expect(board[hint.edge]).toBe(EdgeState.Unknown);
            expect(solution[hint.edge]).toBe(EdgeState.Line);
          } else {
            throw new Error(`unexpected ${hint.kind}`);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

/** Lines and open edges at dot `d`. */
function dotCounts(grid: Grid, board: Uint8Array, d: number): { lines: number; open: number } {
  let lines = 0;
  let open = 0;
  for (let j = 0; j < 4; j++) {
    const e = grid.dotEdges[d * 4 + j];
    if (e < 0) continue;
    if (board[e] === EdgeState.Line) lines++;
    else if (board[e] === EdgeState.Unknown) open++;
  }
  return { lines, open };
}

/** Lines and open edges round cell `c`. */
function cellCounts(grid: Grid, board: Uint8Array, c: number): { lines: number; open: number } {
  let lines = 0;
  let open = 0;
  for (let j = 0; j < 4; j++) {
    const s = board[grid.cellEdges[c * 4 + j]];
    if (s === EdgeState.Line) lines++;
    else if (s === EdgeState.Unknown) open++;
  }
  return { lines, open };
}

/** The dot at the far end of the line path that ends at dot `from`. */
function pathEnd(grid: Grid, board: Uint8Array, from: number): number {
  let d = from;
  let prev = -1;
  for (;;) {
    let next = -1;
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e >= 0 && e !== prev && board[e] === EdgeState.Line) next = e;
    }
    if (next < 0) return d;
    prev = next;
    d = grid.edgeDots[next * 2] === d ? grid.edgeDots[next * 2 + 1] : grid.edgeDots[next * 2];
    if (d === from) return d;
  }
}

/**
 * Checks that a probe step's rule applies on `board`, the board the hint shows just before it, so a
 * page the walk kept never rests on a step it left out. Probes in hints run only the worklist rules.
 */
function checkRuleHolds(p: Puzzle, board: Uint8Array, step: Deduction): void {
  const { grid } = p;
  const [c] = step.cells;
  const [d] = step.dots;
  switch (step.rule) {
    case "clue-zero":
      expect(p.clues[c]).toBe(0);
      break;
    case "clue-satisfied":
      expect(cellCounts(grid, board, c).lines).toBe(p.clues[c]);
      break;
    case "clue-needs-all": {
      const { lines, open } = cellCounts(grid, board, c);
      expect(lines + open).toBe(p.clues[c]);
      break;
    }
    case "dot-full":
      expect(dotCounts(grid, board, d).lines).toBe(2);
      break;
    case "dot-continue":
      expect(dotCounts(grid, board, d)).toEqual({ lines: 1, open: 1 });
      break;
    case "dot-dead-end":
      expect(dotCounts(grid, board, d)).toEqual({ lines: 0, open: 1 });
      break;
    case "corner-1":
    case "corner-3": {
      expect(p.clues[c]).toBe(step.rule === "corner-1" ? 1 : 3);
      // The dot's edges outside the cell are crossed (or off the board).
      const own = new Set(Array.from({ length: 4 }, (_, j) => grid.cellEdges[c * 4 + j]));
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[d * 4 + j];
        if (e >= 0 && !own.has(e)) expect(board[e]).toBe(EdgeState.Cross);
      }
      break;
    }
    case "premature-loop":
      expect(pathEnd(grid, board, step.dots[0])).toBe(step.dots[1]);
      break;
    default:
      throw new Error(`unexpected rule in a probe: ${step.rule}`);
  }
}

/**
 * Replays a probe on `board`: the assumed state, then its steps, each setting only open edges and
 * each rule applying where it is. Then checks the contradiction it names is there to see.
 */
function checkProbe(p: Puzzle, board: Uint8Array, probe: Probe): void {
  const { grid } = p;
  const what = board.slice();
  expect(what[probe.assumed.edge]).toBe(EdgeState.Unknown);
  what[probe.assumed.edge] = probe.assumed.state;
  for (const s of probe.steps) {
    checkRuleHolds(p, what, s);
    for (const { edge, state } of s.changes) {
      expect(what[edge]).toBe(EdgeState.Unknown);
      what[edge] = state;
    }
  }
  const x = probe.contradiction;
  switch (x.kind) {
    case "small-loop": {
      // A closed loop of lines: every dot on it meets exactly two of its edges.
      expect(x.edges.length).toBeGreaterThan(0);
      const degree = new Map<number, number>();
      for (const e of x.edges) {
        expect(what[e]).toBe(EdgeState.Line);
        for (const d of [grid.edgeDots[e * 2], grid.edgeDots[e * 2 + 1]]) {
          degree.set(d, (degree.get(d) ?? 0) + 1);
        }
      }
      for (const n of degree.values()) expect(n).toBe(2);
      break;
    }
    case "dot-three":
      expect(dotCounts(grid, what, x.dots[0]).lines).toBeGreaterThanOrEqual(3);
      break;
    case "dead-end":
      expect(dotCounts(grid, what, x.dots[0])).toEqual({ lines: 1, open: 0 });
      break;
    case "clue-over":
    case "clue-under": {
      const c = x.cells[0];
      let lines = 0;
      let open = 0;
      for (let j = 0; j < 4; j++) {
        const s = what[grid.cellEdges[c * 4 + j]];
        if (s === EdgeState.Line) lines++;
        else if (s === EdgeState.Unknown) open++;
      }
      if (x.kind === "clue-over") expect(lines).toBeGreaterThan(p.clues[c]);
      else expect(lines + open).toBeLessThan(p.clues[c]);
      break;
    }
    case "no-loop":
      expect(what.every((s) => s === EdgeState.Cross)).toBe(true);
      break;
    case "clue-corner":
      expect([1, 3]).toContain(p.clues[x.cells[0]]);
      expect(x.dots.length).toBe(1);
      break;
    default:
      throw new Error(`unexpected contradiction ${x.kind}`);
  }
}

/** Every hint from an empty board to the end, with the board each was given on. */
function hintBoards(p: Puzzle, solution: Uint8Array): { board: Uint8Array; steps: Step[] }[] {
  const board = new Uint8Array(p.grid.edgeCount);
  const out: { board: Uint8Array; steps: Step[] }[] = [];
  for (let n = 0; n <= p.grid.edgeCount; n++) {
    const hint = findHint(p, solution, board);
    if (hint.kind === "solved") return out;
    if (hint.kind === "reveal") {
      board[hint.edge] = EdgeState.Line;
      continue;
    }
    if (hint.kind !== "step") throw new Error(`unexpected ${hint.kind}`);
    const steps = [...hint.before, hint.step];
    out.push({ board: board.slice(), steps });
    for (const step of steps) for (const { edge, state } of step.changes) board[edge] = state;
  }
  throw new Error("the hints did not finish the puzzle");
}

describe("try-and-see hints", () => {
  // The techniques page's lookahead lesson: the 4×4 puzzle generated with seed "la-44-150".
  const lesson = puzzle(4, 4, ".2..12.33..2.1..");
  const lessonBoard = decodeEdges(lesson.grid, "1020200021001200221010000120001100022100");

  test("carry the assumption, the moves it forces and the loop it closes", () => {
    const solution = solve(lesson).edges;
    const hint = findHint(lesson, solution, lessonBoard);
    if (hint.kind !== "step") throw new Error(hint.kind);
    const [look] = hint.before;
    expect(look.rule).toBe("lookahead");
    expect(look.changes).toEqual([{ edge: 1, state: EdgeState.Cross }]);
    const probe = look.probe;
    if (probe === undefined) throw new Error("no probe");
    // Supposing the top of the 2 were a line, the dot rules run on until the middle 2 closes a loop.
    expect(probe.assumed).toEqual({ edge: 1, state: EdgeState.Line });
    expect(probe.steps.map((s) => s.rule)).toEqual([
      "dot-full",
      "dot-continue",
      "dot-dead-end",
      "clue-needs-all",
    ]);
    expect(probe.contradiction.kind).toBe("small-loop");
    expect(probe.contradiction.edge).toBe(27);
    checkProbe(lesson, lessonBoard, probe);
  });

  test("solve gives probes only when asked, and the same steps either way", () => {
    const plain = solve(lesson, { initial: lessonBoard });
    const explained = solve(lesson, { initial: lessonBoard, explain: true });
    const strip = (steps: readonly Step[]) =>
      steps.map(({ rule, changes, cells, dots }) => ({ rule, changes, cells, dots }));
    expect(strip(explained.steps)).toEqual(strip(plain.steps));
    expect(plain.steps.every((s) => s.probe === undefined)).toBe(true);
    const looks = explained.steps.filter((s) => s.rule === "lookahead");
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.every((s) => s.probe !== undefined)).toBe(true);
    expect(explained.edges).toEqual(plain.edges);
  });

  test("keep only the moves the contradiction rests on", () => {
    // From the solve's full probe to the hint's: fewer or the same steps, in the same order.
    const full = solve(lesson, { initial: lessonBoard, explain: true, stopAtLine: true });
    const hint = findHint(lesson, solve(lesson).edges, lessonBoard);
    if (hint.kind !== "step") throw new Error(hint.kind);
    const all = full.steps[0].probe?.steps ?? [];
    const kept = hint.before[0].probe?.steps ?? [];
    const key = (s: unknown) => JSON.stringify(s);
    let i = 0;
    for (const s of kept) {
      while (i < all.length && key(all[i]) !== key(s)) i++;
      expect(i).toBeLessThan(all.length);
      i++;
    }
  });

  test("every probe replays to the contradiction it names (property)", () => {
    let probes = 0;
    let long = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e6 }), fc.constantFrom(5, 6, 7), (n, size) => {
        const found = longLookahead(size, `la-${n}`);
        if (found === null) return;
        const { puzzle: p, solution } = found;
        for (const { board, steps } of hintBoards(p, solution)) {
          const now = board.slice();
          for (const step of steps) {
            if (step.rule === "lookahead") {
              // The replay always matches the silent probe, so every lookahead step has one.
              if (step.probe === undefined) throw new Error("lookahead step without a probe");
              checkProbe(p, now, step.probe);
              probes++;
              if (step.probe.steps.length > LEVEL_SETTINGS.hard.maxProbeSteps) long++;
            }
            for (const { edge, state } of step.changes) now[edge] = state;
          }
        }
      }),
      { numRuns: 40 },
    );
    // The property means nothing without lookahead steps, long ones (the fallback) included.
    expect(probes).toBeGreaterThan(10);
    expect(long).toBeGreaterThan(0);
  });

  test("on generated hard puzzles, chains are short and try-and-see is rare", () => {
    const { maxProbeSteps } = LEVEL_SETTINGS.hard;
    let looks = 0;
    for (let n = 0; n < 12; n++) {
      const size = 5 + (n % 6);
      const { puzzle: p, solution } = generate({ width: size, height: size, seed: `short-${n}` });
      let here = 0;
      for (const { steps } of hintBoards(p, solution)) {
        for (const step of steps) {
          if (step.rule !== "lookahead") continue;
          here++;
          expect(step.probe?.steps.length ?? 0).toBeLessThanOrEqual(maxProbeSteps);
        }
      }
      expect(here).toBeLessThanOrEqual(lookaheadBudget("hard", size * size));
      looks += here;
    }
    expect(looks).toBeGreaterThan(0);
  });
});

/**
 * A hard puzzle that needs more try-and-see than generation now allows, like puzzles generated
 * before it was kept short: the puzzle generated with `seed`, without the first clue (in cell
 * order) that the rules with unbounded lookahead can do without. Null when there is none.
 */
function longLookahead(
  size: number,
  seed: string,
): { puzzle: Puzzle; solution: Uint8Array } | null {
  const { puzzle: p } = generate({ width: size, height: size, seed });
  const clues = p.clues.slice();
  for (let i = 0; i < clues.length; i++) {
    if (clues[i] === NO_CLUE) continue;
    const k = clues[i];
    clues[i] = NO_CLUE;
    const without = { ...p, clues: clues.slice() };
    const r = solve(without);
    if (r.status === "solved" && r.lookaheads > 0) return { puzzle: without, solution: r.edges };
    clues[i] = k;
  }
  return null;
}
