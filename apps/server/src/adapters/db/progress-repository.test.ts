import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import type { ProgressRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteProgressRepository } from "./progress-repository.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  for (const id of ["u1", "u2"]) {
    users.insert({
      id,
      email: `${id}@example.com`,
      passwordHash: "h",
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: 0,
    });
  }
  const puzzles = new SqlitePuzzleRepository(db);
  for (const id of ["p1", "p2", "p3"]) {
    puzzles.insert({
      id,
      puzzle: createPuzzle(2, 2),
      origin: "generated",
      status: "published",
      level: "hard",
      solutionKey: `puzzles/${id}/solution.txt`,
      traceKey: null,
      createdAt: 0,
      creatorId: null,
      releaseAt: null,
    });
  }
  return { db, users, repo: new SqliteProgressRepository(db) };
}

function record(changes: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    userId: "u1",
    puzzleId: "p1",
    edges: "100000000000",
    elapsedMs: 4200,
    solved: false,
    assisted: true,
    version: 1,
    device: "d1",
    createdAt: 10,
    updatedAt: 20,
    ...changes,
  };
}

describe("SqliteProgressRepository", () => {
  test("get returns what put stored; put replaces; delete removes", () => {
    const { repo } = setup();
    expect(repo.get("u1", "p1")).toBeNull();
    repo.put(record());
    expect(repo.get("u1", "p1")).toEqual(record());
    repo.put(record({ edges: "112211121121", solved: true, updatedAt: 30 }));
    expect(repo.get("u1", "p1")).toEqual(
      record({ edges: "112211121121", solved: true, updatedAt: 30 }),
    );
    expect(repo.get("u2", "p1")).toBeNull();
    repo.delete("u1", "p1");
    expect(repo.get("u1", "p1")).toBeNull();
  });

  test("listUnsolved gives one user's unsolved records, newest first, up to the limit", () => {
    const { repo } = setup();
    repo.put(record({ puzzleId: "p1", updatedAt: 10 }));
    repo.put(record({ puzzleId: "p2", updatedAt: 30 }));
    repo.put(record({ puzzleId: "p3", updatedAt: 20, solved: true }));
    repo.put(record({ userId: "u2", puzzleId: "p1", updatedAt: 40 }));
    expect(repo.listUnsolved("u1", 10).map((r) => r.puzzleId)).toEqual(["p2", "p1"]);
    expect(repo.listUnsolved("u1", 1).map((r) => r.puzzleId)).toEqual(["p2"]);
  });

  test("deleting the user deletes their progress (NFR-6)", () => {
    const { db, users, repo } = setup();
    repo.put(record());
    repo.put(record({ userId: "u2" }));
    users.delete("u1");
    expect(repo.get("u1", "p1")).toBeNull();
    expect(repo.get("u2", "p1")).not.toBeNull();
    expect(db.query("SELECT count(*) AS n FROM progress").get()).toEqual({ n: 1 });
  });

  test("a record must name an existing user and puzzle and hold only 0, 1 and 2", () => {
    const { repo } = setup();
    expect(() => repo.put(record({ userId: "ghost" }))).toThrow(/FOREIGN KEY/);
    expect(() => repo.put(record({ puzzleId: "ghost" }))).toThrow(/FOREIGN KEY/);
    expect(() => repo.put(record({ edges: "10000000000x" }))).toThrow(/CHECK/);
  });
});
