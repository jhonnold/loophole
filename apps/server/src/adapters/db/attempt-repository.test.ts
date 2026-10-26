import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import type { AttemptRecord } from "../../domain.ts";
import { SqliteAttemptRepository } from "./attempt-repository.ts";
import { openDatabase } from "./database.ts";
import { SqliteDisplayNameRepository } from "./display-name-repository.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";
import { SqliteUserRepository } from "./user-repository.ts";

const USERS = ["u1", "u2", "u3", "u4", "u5", "u6"];

function setup() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  for (const id of USERS) {
    users.insert({
      id,
      email: `${id}@example.com`,
      passwordHash: "h",
      emailVerifiedAt: 1,
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
      releaseAt: 0,
    });
  }
  return {
    db,
    users,
    names: new SqliteDisplayNameRepository(db),
    repo: new SqliteAttemptRepository(db),
  };
}

function attempt(changes: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    userId: "u1",
    puzzleId: "p1",
    day: "2026-10-25",
    area: 49,
    level: "hard",
    startedAt: 1000,
    finishedAt: null,
    timeMs: null,
    assisted: false,
    ranked: false,
    ...changes,
  };
}

/** A finished attempt; `ranked` unless told otherwise. */
function solved(userId: string, timeMs: number, changes: Partial<AttemptRecord> = {}) {
  return attempt({ userId, timeMs, finishedAt: 1000 + timeMs, ranked: true, ...changes });
}

describe("SqliteAttemptRepository", () => {
  test("insert keeps the first attempt; get reads it back", () => {
    const { repo } = setup();
    expect(repo.get("u1", "p1")).toBeNull();
    repo.insert(attempt());
    repo.insert(attempt({ startedAt: 5000 }));
    expect(repo.get("u1", "p1")).toEqual(attempt());
  });

  test("markAssisted and finish change only an attempt still being played", () => {
    const { repo } = setup();
    repo.insert(attempt());
    repo.markAssisted("u1", "p1");
    expect(repo.finish("u1", "p1", { finishedAt: 9000, timeMs: 8000, ranked: false })).toBe(true);
    expect(repo.get("u1", "p1")).toEqual(
      attempt({ assisted: true, finishedAt: 9000, timeMs: 8000 }),
    );
    expect(repo.finish("u1", "p1", { finishedAt: 9500, timeMs: 1, ranked: true })).toBe(false);
    expect(repo.finish("u2", "p1", { finishedAt: 9500, timeMs: 1, ranked: true })).toBe(false);
    repo.insert(attempt({ puzzleId: "p2" }));
    repo.finish("u1", "p2", { finishedAt: 9000, timeMs: 8000, ranked: true });
    repo.markAssisted("u1", "p2");
    expect(repo.get("u1", "p2")?.assisted).toBe(false);
  });

  test("lists a day's attempts, the days with a finished attempt and the best ranked times", () => {
    const { repo } = setup();
    repo.insert(solved("u1", 9000, { puzzleId: "p1", day: "2026-10-24" }));
    repo.insert(solved("u1", 7000, { puzzleId: "p2", day: "2026-10-25" }));
    repo.insert(attempt({ puzzleId: "p3", day: "2026-10-26", area: 100 }));
    expect(repo.listForDay("u1", "2026-10-25").map((a) => a.puzzleId)).toEqual(["p2"]);
    expect(repo.finishedDays("u1").sort()).toEqual(["2026-10-24", "2026-10-25"]);
    expect(repo.bests("u1")).toEqual([{ area: 49, level: "hard", timeMs: 7000 }]);
    expect(repo.bests("u2")).toEqual([]);
  });

  test("a puzzle's board ranks ranked solves by time, then by who finished first (FR-23)", () => {
    const { repo, names } = setup();
    repo.insert(solved("u1", 5000));
    repo.insert(solved("u2", 3000));
    repo.insert(solved("u3", 4000, { finishedAt: 9000 }));
    repo.insert(solved("u4", 4000, { finishedAt: 8000 }));
    repo.insert(solved("u5", 1000, { ranked: false, assisted: true }));
    repo.insert(attempt({ userId: "u6" }));
    names.set("u2", "tsuru", 0);
    expect(repo.puzzleBoard("p1", null, 10)).toEqual({
      total: 4,
      entries: [
        { rank: 1, userId: "u2", name: "tsuru", timeMs: 3000 },
        { rank: 2, userId: "u4", name: null, timeMs: 4000 },
        { rank: 3, userId: "u3", name: null, timeMs: 4000 },
        { rank: 4, userId: "u1", name: null, timeMs: 5000 },
      ],
    });
    expect(repo.puzzleBoard("p2", "u1", 10)).toEqual({ total: 0, entries: [] });
  });

  test("a slice holds the top rows and the viewer's neighbours, even outside the top", () => {
    const { repo } = setup();
    USERS.forEach((u, i) => {
      repo.insert(solved(u, 1000 * (i + 1)));
    });
    const ranks = (viewer: string | null, limit: number) =>
      repo.puzzleBoard("p1", viewer, limit).entries.map((e) => e.rank);
    expect(ranks(null, 2)).toEqual([1, 2]);
    expect(ranks("u5", 2)).toEqual([1, 2, 4, 5, 6]);
    expect(ranks("u6", 1)).toEqual([1, 5, 6]);
    expect(ranks("u2", 2)).toEqual([1, 2, 3]);
    expect(repo.puzzleBoard("p1", "u5", 2).total).toBe(6);
  });

  test("a bucket's board takes each player's best ranked time across its puzzles", () => {
    const { repo } = setup();
    repo.insert(solved("u1", 5000, { puzzleId: "p1" }));
    repo.insert(solved("u1", 2000, { puzzleId: "p2" }));
    repo.insert(solved("u2", 3000, { puzzleId: "p1" }));
    repo.insert(solved("u3", 1000, { puzzleId: "p3", area: 100 }));
    repo.insert(solved("u4", 500, { puzzleId: "p2", ranked: false }));
    expect(repo.bucketBoard(49, "hard", "u2", 10)).toEqual({
      total: 2,
      entries: [
        { rank: 1, userId: "u1", name: null, timeMs: 2000 },
        { rank: 2, userId: "u2", name: null, timeMs: 3000 },
      ],
    });
    expect(repo.bucketBoard(49, "easy", null, 10).total).toBe(0);
  });

  test("deleting the account deletes its attempts, taking it off every board (NFR-6)", () => {
    const { db, repo } = setup();
    repo.insert(solved("u1", 5000));
    repo.insert(solved("u2", 6000));
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.get("u1", "p1")).toBeNull();
    expect(repo.puzzleBoard("p1", null, 10).entries.map((e) => e.userId)).toEqual(["u2"]);
  });
});
