import { describe, expect, test } from "bun:test";
import type { AccountTokenRecord } from "../../domain.ts";
import { SqliteAccountTokenRepository } from "./account-token-repository.ts";
import { openDatabase } from "./database.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  new SqliteUserRepository(db).insert({
    id: "u1",
    email: "a@example.com",
    passwordHash: "h",
    emailVerifiedAt: null,
    isAdmin: false,
    createdAt: 0,
  });
  return new SqliteAccountTokenRepository(db);
}

const token = (
  tokenHash: string,
  purpose: AccountTokenRecord["purpose"],
  expiresAt = 100,
): AccountTokenRecord => ({ tokenHash, userId: "u1", purpose, createdAt: 0, expiresAt });

describe("SqliteAccountTokenRepository", () => {
  test("take returns a token once, and only for its purpose", () => {
    const repo = setup();
    repo.replace(token("v1", "verify-email"));
    expect(repo.take("v1", "reset-password")).toBeNull();
    expect(repo.take("v1", "verify-email")).toEqual(token("v1", "verify-email"));
    expect(repo.take("v1", "verify-email")).toBeNull();
    expect(repo.take("nope", "verify-email")).toBeNull();
  });

  test("replace drops the user's earlier token for the same purpose only", () => {
    const repo = setup();
    repo.replace(token("v1", "verify-email"));
    repo.replace(token("r1", "reset-password"));
    repo.replace(token("v2", "verify-email"));
    expect(repo.take("v1", "verify-email")).toBeNull();
    expect(repo.take("v2", "verify-email")?.tokenHash).toBe("v2");
    expect(repo.take("r1", "reset-password")?.tokenHash).toBe("r1");
  });

  test("take still returns an expired token (the manager rejects it); deleteExpired drops it", () => {
    const repo = setup();
    repo.replace(token("old", "verify-email", 50));
    repo.replace(token("live", "reset-password", 51));
    repo.deleteExpired(50);
    expect(repo.take("old", "verify-email")).toBeNull();
    expect(repo.take("live", "reset-password")?.expiresAt).toBe(51);
    repo.replace(token("late", "verify-email", 10));
    expect(repo.take("late", "verify-email")?.expiresAt).toBe(10);
  });
});
