import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import type { PuzzleRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";

function record(id: string, createdAt: number, status: PuzzleRecord["status"] = "published") {
  const puzzle = createPuzzle(2, 2, [2, 2, 2, -1], {
    seed: `seed-${id}`,
    meta: { generator: "1" },
  });
  const r: PuzzleRecord = {
    id,
    puzzle,
    origin: "generated",
    status,
    level: 1,
    solutionKey: `puzzles/${id}/solution.txt`,
    traceKey: `puzzles/${id}/trace.json`,
    createdAt,
  };
  return r;
}

describe("SqlitePuzzleRepository", () => {
  test("get returns what insert stored, and null for an unknown id", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    const r = record("a", 1000);
    repo.insert(r);
    const got = repo.get("a");
    expect(got).not.toBeNull();
    expect(serializePuzzle(got?.puzzle ?? r.puzzle)).toEqual({
      v: 1,
      width: 2,
      height: 2,
      clues: "222.",
      seed: "seed-a",
      meta: { generator: "1" },
    });
    expect({ ...got, puzzle: null }).toEqual({ ...r, puzzle: null });
    expect(repo.get("nope")).toBeNull();
  });

  test("a puzzle without seed or generator round-trips", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert({ ...record("b", 1), puzzle: createPuzzle(1, 1, [0]), traceKey: null });
    const got = repo.get("b");
    expect(got && serializePuzzle(got.puzzle)).toEqual({ v: 1, width: 1, height: 1, clues: "0" });
    expect(got?.traceKey).toBeNull();
  });

  test("listPublished is newest first, skips unpublished and honours the limit", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert(record("old", 1));
    repo.insert(record("hidden", 2, "unpublished"));
    repo.insert(record("new", 3));
    repo.insert(record("mid", 2));
    expect(repo.listPublished(10).map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(repo.listPublished(2).map((r) => r.id)).toEqual(["new", "mid"]);
  });

  test("inserting an existing id keeps the first puzzle", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert(record("a", 1));
    repo.insert(record("a", 2));
    expect(repo.get("a")?.createdAt).toBe(1);
  });
});
