import { describe, expect, test } from "bun:test";
import { analyzeBoard, createPuzzle, parsePuzzle, verify } from "@loophole/core";
import { suggestClue } from "./answers.ts";

// The Editor artboard's puzzle: a real puzzle with one clue removed, which leaves two answers.
const ARTBOARD = parsePuzzle({
  v: 1,
  width: 7,
  height: 7,
  clues: "..2..1.3.222...1.1..3.....2.110..0.........0.3.0.",
});

describe("suggestClue", () => {
  test("names an empty cell whose clue keeps answer A and rules out answer B", () => {
    const result = verify(ARTBOARD);
    expect(result.status).toBe("multiple");
    const [a, b] = result.solutions;
    const s = suggestClue(ARTBOARD, a, b);
    if (s === null) throw new Error("no suggestion");
    expect(ARTBOARD.clues[s.cell]).toBe(-1);
    const clues = ARTBOARD.clues.slice();
    clues[s.cell] = s.clue;
    const withClue = createPuzzle(7, 7, clues);
    expect(analyzeBoard(withClue, a).solved).toBe(true);
    expect(analyzeBoard(withClue, b).solved).toBe(false);
  });

  test("is null when no empty cell tells the answers apart", () => {
    const open = createPuzzle(2, 2);
    const [a, b] = verify(open).solutions;
    const full = createPuzzle(2, 2, [1, 1, 1, 1]);
    expect(suggestClue(full, a, b)).toBeNull();
    expect(suggestClue(open, a, a)).toBeNull();
  });
});
