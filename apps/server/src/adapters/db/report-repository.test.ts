import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import { openDatabase } from "./database.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";
import { SqliteReportRepository } from "./report-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  for (const id of ["u1", "u2"]) {
    db.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($id, $email, 'h', 0)",
    ).run({ id, email: `${id}@example.com` });
  }
  const puzzles = new SqlitePuzzleRepository(db);
  for (const [id, clues] of [
    ["p1", [1, -1]],
    ["p2", [2, -1]],
  ] as const) {
    puzzles.insert({
      id,
      puzzle: createPuzzle(2, 1, clues),
      origin: "generated",
      status: "published",
      level: 1,
      solutionKey: "k",
      traceKey: null,
      createdAt: 0,
      creatorId: null,
    });
  }
  return { db, puzzles, repo: new SqliteReportRepository(db) };
}

describe("SqliteReportRepository", () => {
  test("upsert keeps one report per reporter and puzzle, newest reason", () => {
    const { repo } = setup();
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "first", createdAt: 1 });
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "second", createdAt: 2 });
    repo.upsert({ puzzleId: "p1", reporterId: "u2", reason: "other", createdAt: 3 });
    expect(repo.listForPublished(10)).toEqual([
      { puzzleId: "p1", reporterId: "u2", reason: "other", createdAt: 3 },
      { puzzleId: "p1", reporterId: "u1", reason: "second", createdAt: 2 },
    ]);
  });

  test("listForPublished leaves out unpublished puzzles; deleteForPuzzle clears one puzzle", () => {
    const { puzzles, repo } = setup();
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "a", createdAt: 1 });
    repo.upsert({ puzzleId: "p2", reporterId: "u1", reason: "b", createdAt: 2 });
    puzzles.setStatus("p2", "unpublished");
    expect(repo.listForPublished(10).map((r) => r.puzzleId)).toEqual(["p1"]);
    repo.deleteForPuzzle("p1");
    expect(repo.listForPublished(10)).toEqual([]);
  });

  test("deleting the reporter's account deletes their reports", () => {
    const { db, repo } = setup();
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "a", createdAt: 1 });
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.listForPublished(10)).toEqual([]);
  });
});
