import { describe, expect, test } from "bun:test";
import { analyzeBoard, decodeEdges, verify } from "@loophole/core";
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
});
