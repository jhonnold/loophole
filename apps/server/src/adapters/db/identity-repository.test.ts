import { describe, expect, test } from "bun:test";
import { openDatabase } from "./database.ts";
import { SqliteIdentityRepository } from "./identity-repository.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  for (const id of ["u1", "u2"]) {
    users.insert({
      id,
      email: `${id}@example.com`,
      passwordHash: "h",
      hasPassword: false,
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: 0,
    });
  }
  return { users, identities: new SqliteIdentityRepository(db) };
}

const identity = { issuer: "https://idp.test", subject: "s1", userId: "u1", createdAt: 1 };

describe("SqliteIdentityRepository", () => {
  test("finds the account an identity is tied to, per issuer", () => {
    const { identities } = setup();
    expect(identities.getUserId("https://idp.test", "s1")).toBeNull();
    expect(identities.insert(identity)).toBe(true);
    expect(identities.insert({ ...identity, subject: "s2", userId: "u2" })).toBe(true);
    expect(identities.insert({ ...identity, issuer: "https://other.test", userId: "u2" })).toBe(
      true,
    );
    expect(identities.getUserId("https://idp.test", "s1")).toBe("u1");
    expect(identities.getUserId("https://idp.test", "s2")).toBe("u2");
    expect(identities.getUserId("https://other.test", "s1")).toBe("u2");
  });

  test("an identity is tied to one account only", () => {
    const { identities } = setup();
    identities.insert(identity);
    expect(identities.insert({ ...identity, userId: "u2" })).toBe(false);
    expect(identities.getUserId("https://idp.test", "s1")).toBe("u1");
  });

  test("deleting the user deletes its identities", () => {
    const { users, identities } = setup();
    identities.insert(identity);
    users.delete("u1");
    expect(identities.getUserId("https://idp.test", "s1")).toBeNull();
  });

  test("users keep whether they have a password; setting one sets it", () => {
    const { users } = setup();
    expect(users.get("u1")?.hasPassword).toBe(false);
    users.setPasswordHash("u1", "new");
    expect(users.get("u1")).toMatchObject({ passwordHash: "new", hasPassword: true });
  });
});
