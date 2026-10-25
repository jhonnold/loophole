import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { parsePuzzle, serializePuzzle } from "./format.ts";
import { createGrid, EdgeState } from "./grid.ts";
import {
  createPuzzle,
  deriveClues,
  MAX_META_KEY_LENGTH,
  MAX_SEED_LENGTH,
  NO_CLUE,
} from "./puzzle.ts";

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

  test("rejects a seed or meta that the wire format would reject", () => {
    expect(() => createPuzzle(1, 1, undefined, { seed: "" })).toThrow(RangeError);
    expect(() => createPuzzle(1, 1, undefined, { seed: "s".repeat(129) })).toThrow(RangeError);
    expect(() => createPuzzle(1, 1, undefined, { meta: { "": "x" } })).toThrow(RangeError);
    expect(() => createPuzzle(1, 1, undefined, { meta: { k: "x".repeat(1025) } })).toThrow(
      RangeError,
    );
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, ""]));
    expect(() => createPuzzle(1, 1, undefined, { meta: tooMany })).toThrow(RangeError);
  });

  test("builds puzzles that survive a round trip through the wire format", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: MAX_SEED_LENGTH }),
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: MAX_META_KEY_LENGTH }),
          fc.string({ maxLength: 50 }),
          { maxKeys: 8, noNullPrototype: true },
        ),
        (seed, meta) => {
          const p = createPuzzle(2, 2, undefined, { seed, meta });
          const back = parsePuzzle(serializePuzzle(p));
          expect(back.seed).toBe(seed);
          expect(back.meta).toEqual(meta);
        },
      ),
    );
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
