import { describe, expect, test } from "bun:test";
import { openDatabase } from "./database.ts";
import { SqliteDisplayNameRepository } from "./display-name-repository.ts";
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
  return { db, repo: new SqliteDisplayNameRepository(db) };
}

describe("SqliteDisplayNameRepository", () => {
  test("sets, replaces and removes a name", () => {
    const { repo } = setup();
    expect(repo.get("u1")).toBeNull();
    expect(repo.set("u1", "kuroneko", 1)).toBe(true);
    expect(repo.get("u1")).toBe("kuroneko");
    expect(repo.set("u1", "tsuru", 2)).toBe(true);
    expect(repo.get("u1")).toBe("tsuru");
    expect(repo.set("u1", null, 3)).toBe(true);
    expect(repo.get("u1")).toBeNull();
  });

  test("a name another player has is refused, ignoring case", () => {
    const { repo } = setup();
    repo.set("u1", "Kuroneko", 1);
    expect(repo.set("u2", "kuroNEKO", 2)).toBe(false);
    expect(repo.get("u2")).toBeNull();
    expect(repo.set("u1", "kuroneko", 3)).toBe(true);
  });

  test("deleting the account deletes its name and frees it (NFR-6)", () => {
    const { db, repo } = setup();
    repo.set("u1", "kuroneko", 1);
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.get("u1")).toBeNull();
    expect(repo.set("u2", "kuroneko", 2)).toBe(true);
  });
});
