import { describe, expect, test } from "bun:test";
import type { UserRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function user(id: string, email: string): UserRecord {
  return {
    id,
    email,
    passwordHash: `hash-${id}`,
    emailVerifiedAt: null,
    isAdmin: false,
    createdAt: 1000,
  };
}

describe("SqliteUserRepository", () => {
  test("get and getByEmail return what insert stored; unknown ones are null", () => {
    const repo = new SqliteUserRepository(openDatabase(":memory:"));
    const u = user("u1", "a@example.com");
    expect(repo.insert(u)).toBe(true);
    expect(repo.get("u1")).toEqual(u);
    expect(repo.getByEmail("a@example.com")).toEqual(u);
    expect(repo.get("nope")).toBeNull();
    expect(repo.getByEmail("b@example.com")).toBeNull();
  });

  test("insert refuses a taken email and keeps the first user", () => {
    const repo = new SqliteUserRepository(openDatabase(":memory:"));
    repo.insert(user("u1", "a@example.com"));
    expect(repo.insert(user("u2", "a@example.com"))).toBe(false);
    expect(repo.get("u2")).toBeNull();
    expect(repo.getByEmail("a@example.com")?.id).toBe("u1");
  });

  test("updates the password hash, the verified time (once) and the admin flag", () => {
    const repo = new SqliteUserRepository(openDatabase(":memory:"));
    repo.insert(user("u1", "a@example.com"));
    repo.setPasswordHash("u1", "new-hash");
    repo.markEmailVerified("u1", 5000);
    repo.markEmailVerified("u1", 9000);
    expect(repo.setAdmin("a@example.com", true)).toBe(true);
    expect(repo.setAdmin("b@example.com", true)).toBe(false);
    expect(repo.get("u1")).toMatchObject({
      passwordHash: "new-hash",
      emailVerifiedAt: 5000,
      isAdmin: true,
    });
    repo.setAdmin("a@example.com", false);
    expect(repo.get("u1")?.isAdmin).toBe(false);
  });

  test("delete removes the user together with their sessions and tokens", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteUserRepository(db);
    repo.insert(user("u1", "a@example.com"));
    repo.insert(user("u2", "b@example.com"));
    for (const id of ["u1", "u2"]) {
      db.run(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, 1, 2)",
        [`s-${id}`, id],
      );
      db.run(
        "INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, 'verify-email', 1, 2)",
        [`t-${id}`, id],
      );
    }
    repo.delete("u1");
    expect(repo.get("u1")).toBeNull();
    const left = (table: string) =>
      db
        .query<{ user_id: string }, []>(`SELECT user_id FROM ${table}`)
        .all()
        .map((r) => r.user_id);
    expect(left("sessions")).toEqual(["u2"]);
    expect(left("account_tokens")).toEqual(["u2"]);
  });
});
