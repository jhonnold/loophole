import { describe, expect, test } from "bun:test";
import {
  analyzeBoard,
  bruteForceSolutions,
  EdgeState,
  hasViolations,
  LEVELS,
  RULE_IDS,
  ruleLevel,
} from "@loophole/core";
import { type Frame, LESSONS } from "./lessons.ts";

/** The frame whose ghosts are the technique's move: the one with ghosts. */
function moveFrame(frames: readonly Frame[]): Frame {
  const moves = frames.filter((f) => f.marks.ghosts.length > 0);
  expect(moves.length).toBe(1);
  return moves[0];
}

describe("LESSONS", () => {
  test("every rule has one lesson, in level order, at the rule's level", () => {
    expect(LESSONS.map((l) => l.rule).sort()).toEqual([...RULE_IDS].sort());
    let last = 0;
    for (const { rule, level } of LESSONS) {
      expect([rule, level]).toEqual([rule, ruleLevel(rule)]);
      const at = LEVELS.indexOf(level);
      expect([rule, at >= last]).toEqual([rule, true]);
      last = at;
    }
  });

  test("frames: a move on empty edges, then that move drawn in", () => {
    for (const { rule, frames } of LESSONS) {
      expect([rule, frames.length >= 4]).toEqual([rule, true]);
      const move = moveFrame(frames);
      const i = frames.indexOf(move);
      expect([rule, i]).toEqual([rule, frames.length - 2]);
      const { grid } = move.puzzle;
      const applied = new Uint8Array(move.edges);
      for (const [e, s] of move.marks.ghosts) {
        expect([rule, e, move.edges[e]]).toEqual([rule, e, EdgeState.Unknown]);
        applied[e] = s;
      }
      expect([rule, [...frames[i + 1].edges]]).toEqual([rule, [...applied]]);
      for (const f of frames) {
        expect(f.puzzle).toBe(move.puzzle);
        expect(f.caption.length).toBeGreaterThan(0);
        for (const c of f.marks.cells) expect(c).toBeLessThan(grid.cellCount);
        for (const d of f.marks.dots) expect(d).toBeLessThan(grid.dotCount);
      }
    }
  });

  test("only a contradiction frame shows a rule break, and it does", () => {
    for (const { rule, frames } of LESSONS) {
      for (const [i, f] of frames.entries()) {
        const broken = hasViolations(analyzeBoard(f.puzzle, f.edges).violations);
        expect([rule, i, broken]).toEqual([rule, i, f.contradiction === true]);
      }
    }
    expect(LESSONS.flatMap((l) => l.frames).filter((f) => f.contradiction).length).toBe(1);
  });

  test("each move holds in every loop that fits its board", () => {
    // Taken as a whole puzzle, the move frame's board has at least one solution that agrees with
    // its lines and crosses, and every such solution agrees with the move.
    for (const { rule, frames } of LESSONS) {
      const { puzzle, edges, marks } = moveFrame(frames);
      const fits = bruteForceSolutions(puzzle, 2 ** 20).filter((s) =>
        edges.every((e, i) => e === EdgeState.Unknown || e === s[i]),
      );
      expect([rule, fits.length > 0]).toEqual([rule, true]);
      for (const s of fits) {
        for (const [e, state] of marks.ghosts) expect([rule, e, s[e]]).toEqual([rule, e, state]);
      }
    }
  });
});
