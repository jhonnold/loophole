import { describe, expect, test } from "bun:test";
import { analyzeBoard, decodeEdges, EdgeState, verify } from "@loophole/core";
import { FIXTURE_SOLUTIONS } from "../test-support/solutions.ts";
import { FIXTURES, fixtureSource } from "./fixtures.ts";

describe("fixture puzzles", () => {
  test("ids are unique", () => {
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });

  test("every fixture parses and its known solution solves it", async () => {
    for (const f of FIXTURES) {
      const entry = await fixtureSource.get(f.id);
      if (entry === null) throw new Error(`missing ${f.id}`);
      const solution = FIXTURE_SOLUTIONS[f.id];
      if (solution === undefined) throw new Error(`no solution for ${f.id}`);
      const analysis = analyzeBoard(entry.puzzle, decodeEdges(entry.puzzle.grid, solution));
      expect(analysis.solved).toBe(true);
    }
  });

  test("every fixture has exactly one solution", async () => {
    for (const f of FIXTURES) {
      const entry = await fixtureSource.get(f.id);
      if (entry === null) throw new Error(`missing ${f.id}`);
      expect([f.id, verify(entry.puzzle, { maxNodes: 100_000 }).status]).toEqual([f.id, "unique"]);
    }
  });

  test("list matches the fixtures and get returns null for unknown ids", async () => {
    expect((await fixtureSource.list()).map((s) => s.id)).toEqual(FIXTURES.map((f) => f.id));
    expect(await fixtureSource.get("nope")).toBeNull();
  });

  test("hint works from the puzzle's own solution", async () => {
    const entry = await fixtureSource.get("small-7");
    if (entry === null) throw new Error("missing small-7");
    const { puzzle } = entry;
    const solution = decodeEdges(puzzle.grid, FIXTURE_SOLUTIONS["small-7"]);
    const empty = new Uint8Array(puzzle.grid.edgeCount);
    const first = await fixtureSource.hint("small-7", puzzle, empty);
    expect(first.kind).toBe("step");
    if (first.kind === "step") {
      for (const { edge, state } of first.step.changes) expect(solution[edge]).toBe(state);
    }
    const wrong = empty.slice();
    const e = solution.indexOf(EdgeState.Cross);
    wrong[e] = EdgeState.Line;
    expect(await fixtureSource.hint("small-7", puzzle, wrong)).toEqual({
      kind: "mistake",
      edge: e,
      count: 1,
    });
  });
});
