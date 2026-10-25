import { describe, expect, test } from "bun:test";
import { openDatabase } from "./database.ts";
import { SqliteSessionRepository } from "./session-repository.ts";
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
  return new SqliteSessionRepository(db);
}

describe("SqliteSessionRepository", () => {
  test("get returns what insert stored; delete removes it", () => {
    const repo = setup();
    const s = { tokenHash: "h1", userId: "u1", createdAt: 10, expiresAt: 20 };
    repo.insert(s);
    expect(repo.get("h1")).toEqual(s);
    expect(repo.get("h2")).toBeNull();
    repo.delete("h1");
    expect(repo.get("h1")).toBeNull();
  });

  test("deleteForUser removes only that user's sessions", () => {
    const repo = setup();
    repo.insert({ tokenHash: "a", userId: "u1", createdAt: 0, expiresAt: 100 });
    repo.insert({ tokenHash: "b", userId: "u1", createdAt: 0, expiresAt: 100 });
    repo.insert({ tokenHash: "c", userId: "u2", createdAt: 0, expiresAt: 100 });
    repo.deleteForUser("u1");
    expect([repo.get("a"), repo.get("b"), repo.get("c")?.tokenHash]).toEqual([null, null, "c"]);
  });

  test("deleteExpired removes sessions that expired at or before now", () => {
    const repo = setup();
    repo.insert({ tokenHash: "old", userId: "u1", createdAt: 0, expiresAt: 50 });
    repo.insert({ tokenHash: "edge", userId: "u1", createdAt: 0, expiresAt: 60 });
    repo.insert({ tokenHash: "live", userId: "u1", createdAt: 0, expiresAt: 61 });
    repo.deleteExpired(60);
    expect([repo.get("old"), repo.get("edge"), repo.get("live")?.tokenHash]).toEqual([
      null,
      null,
      "live",
    ]);
  });

  test("a session must belong to an existing user", () => {
    const repo = setup();
    expect(() =>
      repo.insert({ tokenHash: "x", userId: "ghost", createdAt: 0, expiresAt: 1 }),
    ).toThrow(/FOREIGN KEY/);
  });
});
