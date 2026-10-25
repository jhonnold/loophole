import { describe, expect, test } from "bun:test";
import { createGrid, EdgeState } from "./grid.ts";
import { createPuzzle, deriveClues, NO_CLUE } from "./puzzle.ts";

describe("createPuzzle", () => {
  test("defaults to no clues and no seed or meta", () => {
    const p = createPuzzle(2, 1);
    expect(Array.from(p.clues)).toEqual([NO_CLUE, NO_CLUE]);
    expect(p.grid.width).toBe(2);
    expect("seed" in p).toBe(false);
    expect("meta" in p).toBe(false);
  });

  test("copies clues, seed and meta", () => {
    const clues = [0, 3, NO_CLUE];
    const meta = { title: "x" };
    const p = createPuzzle(3, 1, clues, { seed: "s", meta });
    clues[0] = 2;
    meta.title = "y";
    expect(Array.from(p.clues)).toEqual([0, 3, NO_CLUE]);
    expect(p.seed).toBe("s");
    expect(p.meta).toEqual({ title: "x" });
  });

  test("rejects a wrong clue count or a clue outside 0-3", () => {
    expect(() => createPuzzle(2, 2, [1, 2, 3])).toThrow(RangeError);
    expect(() => createPuzzle(1, 1, [4])).toThrow(RangeError);
    expect(() => createPuzzle(1, 1, [-2])).toThrow(RangeError);
    expect(() => createPuzzle(0, 1)).toThrow(RangeError);
  });
});

describe("deriveClues", () => {
  test("counts line sides per cell", () => {
    const g = createGrid(2, 2);
    const edges = new Uint8Array(g.edgeCount).fill(EdgeState.Cross);
    // Loop around the top two cells: edges 0, 1, 8, 3, 2, 6.
    for (const e of [0, 1, 8, 3, 2, 6]) edges[e] = EdgeState.Line;
    expect(Array.from(deriveClues(g, edges))).toEqual([3, 3, 1, 1]);
  });

  test("gives 4 for a loop around one cell", () => {
    const g = createGrid(1, 1);
    expect(Array.from(deriveClues(g, new Uint8Array([1, 1, 1, 1])))).toEqual([4]);
  });
});
