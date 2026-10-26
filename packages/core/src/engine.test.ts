import { describe, expect, test } from "bun:test";
import { Budget, Engine } from "./engine.ts";
import { parsePuzzle } from "./format.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

describe("Engine", () => {
  test("undoing past the first corner pass makes the next one scan every corner dot again", () => {
    // A 3 beside a 1 in a strip: the corner rules, scanning the 3's and the 1's corner dots, decide
    // an edge (corner-chain) that tier 1 and parity do not (colouring would, so it is off).
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const options = { colouring: false };
    const engine = new Engine(puzzle(1, 4, ".31."), budget, options);
    expect(engine.local()).toBe(true);
    const before = engine.edges.slice();
    const m = engine.mark();
    expect(engine.propagate(false)).toBe(true);
    const first = engine.edges.slice();
    expect(first).not.toEqual(before);
    engine.undo(m);
    expect(engine.edges).toEqual(before);
    expect(engine.propagate(false)).toBe(true);
    expect(engine.edges).toEqual(first);
  });
});
