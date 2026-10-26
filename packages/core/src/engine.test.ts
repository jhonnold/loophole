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

  test("probes run the corner rules only when probeCorners is on (the verifier after deepen)", () => {
    // A 2 in a one-wide strip with colouring off: only a probe that runs the corner rules settles it.
    const p = puzzle(1, 3, ".2.");
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const shallow = new Engine(p, budget, { colouring: false });
    expect(shallow.solveRoot(true)).toBe(true);
    expect(shallow.closed).toBe(false);
    const deep = new Engine(p, budget, { colouring: false, probeCorners: true });
    expect(deep.solveRoot(true)).toBe(true);
    expect(deep.closed).toBe(true);
    const deepened = new Engine(p, budget, { colouring: false });
    deepened.deepen();
    expect(deepened.solveRoot(true)).toBe(true);
    expect(deepened.closed).toBe(true);
  });
});
