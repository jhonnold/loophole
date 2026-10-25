import { describe, expect, test } from "bun:test";
import {
  FakeClock,
  FakeSessionRepository,
  FakeUserRepository,
  sequentialIds,
} from "../test-support/fakes.ts";
import { hashToken } from "./hash-token.ts";
import { SessionManager } from "./session-manager.ts";

function setup() {
  const clock = new FakeClock(1_000);
  const users = new FakeUserRepository();
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
  const repo = new FakeSessionRepository();
  const sessions = new SessionManager({
    sessions: repo,
    users,
    clock,
    newToken: sequentialIds("tok"),
    ttlMs: 500,
  });
  return { clock, repo, sessions };
}

describe("SessionManager", () => {
  test("create stores only the token's hash; authenticate finds the user", async () => {
    const { repo, sessions } = setup();
    expect(await sessions.create("u1")).toEqual({ token: "tok-1", expiresAt: 1_500 });
    expect([...repo.sessions.keys()]).toEqual([await hashToken("tok-1")]);
    expect((await sessions.authenticate("tok-1"))?.id).toBe("u1");
    expect(await sessions.authenticate("tok-2")).toBeNull();
  });

  test("hashToken is SHA-256 in hex", async () => {
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("an expired session no longer authenticates and is removed", async () => {
    const { clock, repo, sessions } = setup();
    await sessions.create("u1");
    clock.advance(499);
    expect(await sessions.authenticate("tok-1")).not.toBeNull();
    clock.advance(1);
    expect(await sessions.authenticate("tok-1")).toBeNull();
    expect(repo.sessions.size).toBe(0);
  });

  test("end logs one session out; endAll logs a user out everywhere", async () => {
    const { sessions } = setup();
    await sessions.create("u1");
    await sessions.create("u1");
    await sessions.create("u2");
    await sessions.end("tok-1");
    expect(await sessions.authenticate("tok-1")).toBeNull();
    expect(await sessions.authenticate("tok-2")).not.toBeNull();
    sessions.endAll("u1");
    expect(await sessions.authenticate("tok-2")).toBeNull();
    expect((await sessions.authenticate("tok-3"))?.id).toBe("u2");
  });

  test("create clears out expired sessions", async () => {
    const { clock, repo, sessions } = setup();
    await sessions.create("u1");
    clock.advance(600);
    await sessions.create("u2");
    expect(repo.sessions.size).toBe(1);
  });
});
