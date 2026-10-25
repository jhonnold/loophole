import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import type { SubmissionRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteSubmissionRepository } from "./submission-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  for (const id of ["u1", "u2"]) {
    db.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($id, $email, 'h', 0)",
    ).run({ id, email: `${id}@example.com` });
  }
  return { db, repo: new SqliteSubmissionRepository(db) };
}

function record(id: string, userId: string, createdAt: number): SubmissionRecord {
  return {
    id,
    userId,
    puzzle: createPuzzle(3, 1, [1, -1, 3]),
    status: "pending",
    verdict: null,
    puzzleId: null,
    jobId: `job-${id}`,
    createdAt,
    decidedAt: null,
  };
}

describe("SqliteSubmissionRepository", () => {
  test("get returns what insert stored, and null for an unknown id", () => {
    const { repo } = setup();
    repo.insert(record("a", "u1", 5));
    const got = repo.get("a");
    expect(got && serializePuzzle(got.puzzle)).toEqual({ v: 1, width: 3, height: 1, clues: "1.3" });
    expect({ ...got, puzzle: null }).toEqual({ ...record("a", "u1", 5), puzzle: null });
    expect(repo.get("nope")).toBeNull();
  });

  test("listForUser is the user's own, newest first, up to the limit", () => {
    const { repo } = setup();
    repo.insert(record("old", "u1", 1));
    repo.insert(record("other", "u2", 2));
    repo.insert(record("new", "u1", 3));
    expect(repo.listForUser("u1", 10).map((r) => r.id)).toEqual(["new", "old"]);
    expect(repo.listForUser("u1", 1).map((r) => r.id)).toEqual(["new"]);
  });

  test("decide records the decision once", () => {
    const { repo } = setup();
    repo.insert(record("a", "u1", 1));
    const decision = {
      status: "rejected",
      verdict: "multiple",
      puzzleId: null,
      decidedAt: 9,
    } as const;
    expect(repo.decide("a", decision)).toBe(true);
    expect(repo.get("a")).toMatchObject(decision);
    expect(repo.decide("a", { ...decision, verdict: "none" })).toBe(false);
    expect(repo.get("a")?.verdict).toBe("multiple");
  });

  test("deleting the account deletes its submissions", () => {
    const { db, repo } = setup();
    repo.insert(record("a", "u1", 1));
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.get("a")).toBeNull();
  });
});
