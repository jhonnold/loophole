import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import type { DailyRecord } from "../../domain.ts";
import { SqliteDailyRepository } from "./daily-repository.ts";
import { openDatabase } from "./database.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  const puzzles = new SqlitePuzzleRepository(db);
  puzzles.insert({
    id: "j-1",
    puzzle: createPuzzle(2, 2),
    origin: "generated",
    status: "published",
    level: 1,
    solutionKey: "puzzles/j-1/solution.txt",
    traceKey: null,
    createdAt: 0,
    creatorId: null,
    releaseAt: 100,
  });
  return new SqliteDailyRepository(db);
}

const row = (changes: Partial<DailyRecord> = {}): DailyRecord => ({
  day: "2026-10-25",
  size: 7,
  attempt: 0,
  jobId: "j-1",
  puzzleId: null,
  generatorVersion: null,
  createdAt: 10,
  ...changes,
});

describe("SqliteDailyRepository", () => {
  test("insert stores one row per day and size; get and listDay read them back", () => {
    const repo = setup();
    expect(repo.insert(row())).toBe(true);
    expect(repo.insert(row({ jobId: "j-other" }))).toBe(false);
    expect(repo.insert(row({ size: 10, jobId: "j-2" }))).toBe(true);
    expect(repo.get("2026-10-25", 7)).toEqual(row());
    expect(repo.get("2026-10-26", 7)).toBeNull();
    expect(repo.listDay("2026-10-25").map((r) => r.size)).toEqual([7, 10]);
    expect(repo.listDay("2026-10-24")).toEqual([]);
  });

  test("retry moves to the next attempt only from the attempt named", () => {
    const repo = setup();
    repo.insert(row());
    expect(repo.retry("2026-10-25", 7, 0, "j-2")).toBe(true);
    expect(repo.retry("2026-10-25", 7, 0, "j-3")).toBe(false);
    expect(repo.get("2026-10-25", 7)).toMatchObject({ attempt: 1, jobId: "j-2" });
  });

  test("setPuzzle links the puzzle only while the row still names that job", () => {
    const repo = setup();
    repo.insert(row());
    expect(repo.setPuzzle("2026-10-25", 7, "j-old", "j-1", "1")).toBe(false);
    expect(repo.setPuzzle("2026-10-25", 7, "j-1", "j-1", "1")).toBe(true);
    expect(repo.get("2026-10-25", 7)).toMatchObject({ puzzleId: "j-1", generatorVersion: "1" });
    expect(repo.getByPuzzle("j-1")?.size).toBe(7);
    expect(repo.getByPuzzle("nope")).toBeNull();
    // A stocked day is never moved to a new attempt.
    expect(repo.retry("2026-10-25", 7, 0, "j-2")).toBe(false);
  });

  test("atomically keeps all of its writes or none", () => {
    const repo = setup();
    expect(repo.atomically(() => repo.insert(row()))).toBe(true);
    expect(() =>
      repo.atomically(() => {
        repo.insert(row({ size: 10, jobId: "j-2" }));
        throw new Error("queue refused");
      }),
    ).toThrow("queue refused");
    expect(repo.get("2026-10-25", 10)).toBeNull();
    expect(repo.get("2026-10-25", 7)).not.toBeNull();
  });
});
